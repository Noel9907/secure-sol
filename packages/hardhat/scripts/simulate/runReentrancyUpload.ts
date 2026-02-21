import hre from "hardhat";
import path from "path";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";
import { analyzeReentrancy } from "./analyzeReentrancy";
import type { ContractAnalysis } from "./analysisTypes";
import { seedVault } from "./seedVault";

// ─── Arg parser for AI-provided string args ──────────────────────────────────

function parseArg(raw: string, type: string, signers: Record<string, string>): any {
  if (type === "address") {
    if (raw === "attacker")  return signers.attacker;
    if (raw === "deployer")  return signers.deployer;
    if (raw === "buyer")     return signers.buyer;
    if (raw === "attackerContract") return signers.attackerContract;
    return raw; // literal address
  }
  if (type === "uint256" || type === "uint") return BigInt(raw);
  if (type === "bool") return raw === "true";
  return raw;
}

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME!;
  const fileName     = process.env.UPLOADED_FILE_NAME!;
  if (!contractName || !fileName) throw new Error("UPLOADED_CONTRACT_NAME / UPLOADED_FILE_NAME missing");

  const startTime = Date.now();
  const signers   = await hre.ethers.getSigners();
  const deployer  = signers[0];
  const attacker  = signers[1];
  const buyer     = signers[2];

  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory  = await hre.ethers.getContractFactory(fullyQualified);
  const victim         = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();
  const iface         = (victim as any).interface;

  // ── Seed vault with pooled funds from multiple "innocent user" accounts ───
  const seedFn = (() => {
    try { return process.env.ANALYSIS_JSON ? (JSON.parse(process.env.ANALYSIS_JSON) as ContractAnalysis).seedFn : null; }
    catch { return null; }
  })();
  await seedVault(victim, signers, seedFn);

  // ── Load analysis ──────────────────────────────────────────────────────────
  let analysis: ContractAnalysis["reentrancy"] | null = null;
  const raw = process.env.ANALYSIS_JSON;
  if (raw) {
    try { analysis = (JSON.parse(raw) as ContractAnalysis).reentrancy; }
    catch { console.warn("[reentrancy] Bad ANALYSIS_JSON — falling back to regex"); }
  }

  // Regex fallback (simple variant only)
  if (!analysis || !analysis.found) {
    if (!analysis) {
      const sourcePath = path.join(__dirname, "../../contracts/uploaded", `${fileName}.sol`);
      const reg = analyzeReentrancy(sourcePath);
      if (reg.found && reg.vulnerableFunction && reg.depositFunction) {
        analysis = {
          found: true, variant: "simple",
          vulnerableFn: { name: reg.vulnerableFunction.name, paramTypes: reg.vulnerableFunction.paramTypes },
          depositFn:    { name: reg.depositFunction.name,    paramTypes: reg.depositFunction.paramTypes, isPayable: true },
          escrowSetup: null,
          reason: reg.reason,
        };
      } else {
        analysis = { found: false, variant: null, vulnerableFn: null, depositFn: null, escrowSetup: null, reason: reg.reason };
      }
    }
  }

  // ── Not vulnerable ─────────────────────────────────────────────────────────
  if (!analysis.found || !analysis.vulnerableFn) {
    const bal = await hre.ethers.provider.getBalance(victimAddress);
    const result = buildResult({
      contractName, contractAddress: victimAddress, attackType: "reentrancy",
      targetFunction: "N/A", severity: "Critical",
      initialBalance: bal, finalBalance: bal, stolenAmount: 0n,
      startTime, endTime: Date.now(), transactions: [],
      timeline: [`${contractName} deployed`, `No reentrancy: ${analysis.reason}`],
      report: { vulnerabilityType: "Reentrancy", affectedFunction: "N/A", explanation: analysis.reason, fix: "N/A" },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  const vulnerableFn = analysis.vulnerableFn;
  const depositAmount = parseEther("0.1");

  // ════════════════════════════════════════════════════════════════════════════
  // SIMPLE VARIANT — attacker deposits directly, then re-enters withdraw
  // ════════════════════════════════════════════════════════════════════════════
  if (analysis.variant === "simple" && analysis.depositFn) {
    const depositFn = analysis.depositFn;
    const depositFnAbi = iface.getFunction(depositFn.name);

    // Seed victim with 1 ETH
    const seedArgs: any[] =
      depositFnAbi?.inputs.length > 0 && depositFnAbi.inputs[0].type === "uint256"
        ? [parseEther("1")]
        : [];
    try {
      await (victim as any).connect(deployer)[depositFn.name](...seedArgs, { value: parseEther("1") });
    } catch (e: any) {
      // Seed failed — report not applicable
      const bal = await hre.ethers.provider.getBalance(victimAddress);
      const result = buildResult({
        contractName, contractAddress: victimAddress, attackType: "reentrancy",
        targetFunction: "N/A", severity: "Critical",
        initialBalance: bal, finalBalance: bal, stolenAmount: 0n,
        startTime, endTime: Date.now(), transactions: [],
        timeline: [`${contractName} deployed`, `Seed via ${depositFn.name}() failed: ${e.message?.slice(0,80)}`],
        report: { vulnerabilityType: "Reentrancy", affectedFunction: "N/A", explanation: "Could not seed contract for attack.", fix: "N/A" },
      });
      process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
      return;
    }

    const initialBalance = await hre.ethers.provider.getBalance(victimAddress);

    // Encode calldata
    const depositCalldata: string =
      depositFnAbi?.inputs.length > 0 && depositFnAbi.inputs[0].type === "uint256"
        ? iface.encodeFunctionData(depositFn.name, [depositAmount])
        : iface.encodeFunctionData(depositFn.name, []);

    let withdrawCalldata: string;
    const vulnAbi = iface.getFunction(vulnerableFn.name);
    if (!vulnAbi || vulnAbi.inputs.length === 0) {
      withdrawCalldata = iface.encodeFunctionData(vulnerableFn.name, []);
    } else if (vulnAbi.inputs[0].type === "uint256") {
      withdrawCalldata = iface.encodeFunctionData(vulnerableFn.name, [depositAmount]);
    } else {
      const bal = await hre.ethers.provider.getBalance(victimAddress);
      const result = buildResult({
        contractName, contractAddress: victimAddress, attackType: "reentrancy",
        targetFunction: `${vulnerableFn.name}()`, severity: "Critical",
        initialBalance: bal, finalBalance: bal, stolenAmount: 0n,
        startTime, endTime: Date.now(), transactions: [],
        timeline: [`Unsupported param type in ${vulnerableFn.name}()`],
        report: { vulnerabilityType: "Reentrancy", affectedFunction: vulnerableFn.name, explanation: "Unsupported param type for automation.", fix: "Apply checks-effects-interactions." },
      });
      process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
      return;
    }

    const AttackerFactory   = await hre.ethers.getContractFactory("FlexReentrancyAttacker");
    const attackerContract  = await AttackerFactory.connect(attacker).deploy(victimAddress);
    await attackerContract.waitForDeployment();
    const attackerAddress   = await attackerContract.getAddress();

    const t1 = Date.now();
    let attackSucceeded = false;
    try {
      await (attackerContract as any).connect(attacker)
        .attack(depositCalldata, withdrawCalldata, { value: depositAmount, gasLimit: 5_000_000 });
      attackSucceeded = true;
    } catch { /* may have reentrancy guard */ }

    await emitResult({
      hre, contractName, victimAddress, attackerAddress, attackerContract,
      vulnerableFn, depositFn, initialBalance, depositAmount, startTime, t1,
      attackSucceeded, variant: "simple",
    });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ESCROW VARIANT — attacker contract does setup, buyer funds, then re-enter
  // ════════════════════════════════════════════════════════════════════════════
  if (analysis.variant === "escrow" && analysis.escrowSetup) {
    const AttackerFactory  = await hre.ethers.getContractFactory("EscrowReentrancyAttacker");
    const attackerContract = await AttackerFactory.connect(attacker).deploy(victimAddress);
    await attackerContract.waitForDeployment();
    const attackerAddress  = await attackerContract.getAddress();

    const signerMap: Record<string, string> = {
      attacker: attacker.address, deployer: deployer.address,
      buyer: buyer.address, attackerContract: attackerAddress,
    };

    // Run setup calls in order
    for (const step of analysis.escrowSetup) {
      const fnAbi  = iface.getFunction(step.fn);
      const types  = fnAbi ? fnAbi.inputs.map((i: any) => i.type) : [];
      const args   = step.args.map((a, i) => parseArg(a, types[i] ?? "uint256", signerMap));
      const value  = BigInt(step.value ?? "0");
      const calldata = iface.encodeFunctionData(step.fn, args);

      if (step.from === "attackerContract") {
        await (attackerContract as any).connect(attacker)
          .execute(calldata, value, { value, gasLimit: 500_000 });
      } else {
        const fromSigner = step.from === "buyer" ? buyer : deployer;
        const fnArgs = [...args, ...(value > 0n ? [{ value }] : [])];
        await (victim as any).connect(fromSigner)[step.fn](...fnArgs);
      }
    }

    const initialBalance = await hre.ethers.provider.getBalance(victimAddress);
    const vulnAbi = iface.getFunction(vulnerableFn.name);
    const withdrawCalldata = vulnAbi?.inputs.length === 0
      ? iface.encodeFunctionData(vulnerableFn.name, [])
      : iface.encodeFunctionData(vulnerableFn.name,
          vulnAbi.inputs.map((inp: any) => inp.type === "uint256" ? initialBalance : "0x"));

    const t1 = Date.now();
    let attackSucceeded = false;
    try {
      await (attackerContract as any).connect(attacker)
        .attack(withdrawCalldata, { gasLimit: 5_000_000 });
      attackSucceeded = true;
    } catch { /* may have reentrancy guard */ }

    await emitResult({
      hre, contractName, victimAddress, attackerAddress, attackerContract,
      vulnerableFn, depositFn: null, initialBalance, depositAmount: 0n, startTime, t1,
      attackSucceeded, variant: "escrow",
    });
    return;
  }

  // Fallback — unknown variant
  const bal = await hre.ethers.provider.getBalance(victimAddress);
  const result = buildResult({
    contractName, contractAddress: victimAddress, attackType: "reentrancy",
    targetFunction: "N/A", severity: "Critical",
    initialBalance: bal, finalBalance: bal, stolenAmount: 0n,
    startTime, endTime: Date.now(), transactions: [],
    timeline: ["Unknown reentrancy variant — cannot simulate"],
    report: { vulnerabilityType: "Reentrancy", affectedFunction: "N/A", explanation: "Unknown variant.", fix: "N/A" },
  });
  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

// ─── Shared result emitter ────────────────────────────────────────────────────

async function emitResult(p: {
  hre: typeof hre; contractName: string; victimAddress: string;
  attackerAddress: string; attackerContract: any;
  vulnerableFn: { name: string; paramTypes: string[] };
  depositFn: { name: string; paramTypes: string[]; isPayable: boolean } | null;
  initialBalance: bigint; depositAmount: bigint;
  startTime: number; t1: number; attackSucceeded: boolean;
  variant: "simple" | "escrow";
}) {
  const { hre, contractName, victimAddress, attackerAddress, attackerContract,
          vulnerableFn, depositFn, initialBalance, depositAmount,
          startTime, t1, attackSucceeded, variant } = p;

  const endTime      = Date.now();
  const finalBalance = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal  = await hre.ethers.provider.getBalance(attackerAddress);
  const reentryCount: bigint = await attackerContract.reentryCount();

  const patternDetected = attackSucceeded && reentryCount > 0n;
  const exploited       = stolenAmount > 0n;
  const fnSig           = `${vulnerableFn.name}(${vulnerableFn.paramTypes.join(",")})`;
  const depositLabel    = variant === "escrow" ? "escrow setup" : (depositFn?.name ?? "deposit") + "()";

  const result = buildResult({
    contractName, contractAddress: victimAddress, attackType: "reentrancy",
    targetFunction: fnSig, severity: "Critical",
    initialBalance, finalBalance, stolenAmount,
    startTime, endTime, patternDetected,
    transactions: patternDetected ? [
      {
        step: 1,
        description: variant === "escrow"
          ? `Attacker contract ran escrow setup → ${formatEther(initialBalance)} ETH credited`
          : `Attacker deposits ${formatEther(depositAmount)} ETH via ${depositLabel}`,
        from: attackerAddress, to: victimAddress,
        value: formatEther(variant === "escrow" ? initialBalance : depositAmount), unit: "ETH",
        timestampMs: t1,
        balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
      },
      {
        step: 2,
        description: `${fnSig} triggered — ETH sent to attacker BEFORE state update`,
        from: attackerAddress, to: victimAddress, value: formatEther(depositAmount), unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.4),
        balanceAfter: { victim: formatEther(initialBalance), attacker: formatEther(depositAmount) },
      },
      {
        step: 3,
        description: exploited
          ? `Re-entered ${reentryCount}× — ${formatEther(stolenAmount)} ETH drained`
          : `Re-entered ${reentryCount}× — pattern confirmed (state updated after call)`,
        from: attackerAddress, to: victimAddress,
        value: exploited ? formatEther(stolenAmount) : "0.0", unit: "ETH",
        timestampMs: endTime,
        balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
      },
    ] : [],
    timeline: patternDetected ? [
      `${contractName} deployed`,
      variant === "escrow" ? "Escrow setup complete — attacker credited in mapping" : `Seeded via ${depositLabel}`,
      `${fnSig} triggered — ETH sent before state update`,
      `Re-entered ${reentryCount}×`,
      exploited ? `${formatEther(stolenAmount)} ETH drained — VULNERABLE` : "Pattern confirmed — VULNERABLE",
    ] : [
      `${contractName} deployed`,
      `Reentrancy pattern found in ${fnSig}`,
      "Attack reverted — contract may have a guard",
    ],
    report: {
      vulnerabilityType: "Reentrancy",
      affectedFunction: fnSig,
      explanation: patternDetected
        ? `${fnSig} sends ETH to the caller before updating their balance in storage. Re-entered ${reentryCount}× — ${exploited ? `${formatEther(stolenAmount)} ETH stolen` : "pattern confirmed, no net theft in this run (attacker balance == own deposit)"}.`
        : `Reentrancy pattern detected in ${fnSig} but attack reverted — contract may have a reentrancy guard.`,
      fix: "Apply checks-effects-interactions: update state BEFORE the external call, or use OpenZeppelin ReentrancyGuard.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => { console.error(e); process.exit(1); });
