import hre from "hardhat";
import path from "path";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";
import { seedVault } from "./seedVault";
import { analyzeAccessControl } from "./analyzeAccessControl";
import { analyzeReentrancy } from "./analyzeReentrancy";
import type { ContractAnalysis } from "./analysisTypes";

function parseArg(raw: string, type: string, attackerAddr: string, deployerAddr: string): any {
  if (type === "address") {
    if (raw === "attacker") return attackerAddr;
    if (raw === "deployer") return deployerAddr;
    return raw;
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
  const [deployer, attacker] = signers;

  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory  = await hre.ethers.getContractFactory(fullyQualified);

  // ── Read AI analysis ───────────────────────────────────────────────────────
  let ac: ContractAnalysis["accesscontrol"] | null = null;
  let seedFnFromAnalysis: ContractAnalysis["seedFn"] = null;
  const raw = process.env.ANALYSIS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ContractAnalysis;
      ac = parsed.accesscontrol;
      seedFnFromAnalysis = parsed.seedFn ?? null;
    }
    catch { console.warn("[accesscontrol] Bad ANALYSIS_JSON"); }
  }

  // ── Regex fallback if AI didn't find anything ─────────────────────────────
  if (!ac?.found || !ac.restrictedFn) {
    const sourcePath = path.join(__dirname, "../../contracts/uploaded", `${fileName}.sol`);
    const reg = analyzeAccessControl(sourcePath);
    if (reg.found && reg.restrictedFn) {
      console.log(`[accesscontrol] Regex fallback found: ${reg.restrictedFn}()`);
      ac = {
        found: true,
        restrictedFn: reg.restrictedFn,
        restrictedFnParamTypes: reg.restrictedFnParamTypes,
        restrictedFnArgs: [],
        value: "0",
        reason: reg.reason,
      };
    }
    // Also try to detect seedFn via reentrancy regex if AI didn't provide it
    if (!seedFnFromAnalysis) {
      const reentrancyResult = analyzeReentrancy(sourcePath);
      if (reentrancyResult.depositFunction) {
        seedFnFromAnalysis = reentrancyResult.depositFunction;
        console.log(`[accesscontrol] Regex fallback seedFn: ${seedFnFromAnalysis.name}()`);
      }
    }
  }

  if (!ac?.found || !ac.restrictedFn) {
    // No access control vulnerability found — deploy and report safe
    const victim = await VictimFactory.deploy();
    await victim.waitForDeployment();
    const victimAddress = await victim.getAddress();
    const bal = await hre.ethers.provider.getBalance(victimAddress);
    const result = buildResult({
      contractName, contractAddress: victimAddress, attackType: "accesscontrol",
      targetFunction: "N/A", severity: "Critical",
      initialBalance: bal, finalBalance: bal, stolenAmount: 0n,
      startTime, endTime: Date.now(), transactions: [],
      timeline: [`${contractName} deployed`, `No access control vulnerability: ${ac?.reason ?? "not analyzed"}`],
      report: {
        vulnerabilityType: "Access Control",
        affectedFunction: "N/A",
        explanation: ac?.reason ?? "No missing access control detected.",
        fix: "N/A",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  // ── Deploy and seed victim ─────────────────────────────────────────────────
  const isConstructorPayable = VictimFactory.interface.deploy.payable;
  const victim = isConstructorPayable
    ? await VictimFactory.deploy({ value: parseEther("5") })
    : await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Seed with pooled funds from multiple accounts so the attack shows real impact
  const seeded = await seedVault(victim, signers, seedFnFromAnalysis);
  // If no deposit function available, try a direct ETH send as fallback
  if (seeded === 0n && !isConstructorPayable) {
    try { await deployer.sendTransaction({ to: victimAddress, value: parseEther("5") }); }
    catch { /* contract may reject */ }
  }

  const iface = (victim as any).interface;
  const initialBalance = await hre.ethers.provider.getBalance(victimAddress);

  // ── Build call args from AI plan ───────────────────────────────────────────
  const fnAbi   = iface.getFunction(ac.restrictedFn);
  const types   = fnAbi ? fnAbi.inputs.map((i: any) => i.type) : (ac.restrictedFnParamTypes ?? []);
  const rawArgs = ac.restrictedFnArgs ?? [];
  const callArgs = rawArgs.map((a, i) => parseArg(a, types[i] ?? "uint256", attacker.address, deployer.address));
  const callValue = BigInt(ac.value ?? "0");

  const t1 = Date.now();
  let attackSucceeded = false;

  try {
    if (callValue > 0n) {
      await (victim as any).connect(attacker)[ac.restrictedFn](...callArgs, { value: callValue });
    } else {
      await (victim as any).connect(attacker)[ac.restrictedFn](...callArgs);
    }
    attackSucceeded = true;
  } catch {
    // Access properly controlled — attack blocked
  }

  const endTime      = Date.now();
  const finalBalance = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal  = await hre.ethers.provider.getBalance(attacker.address);
  const fnSig        = `${ac.restrictedFn}(${types.join(",")})`;

  const result = buildResult({
    contractName, contractAddress: victimAddress, attackType: "accesscontrol",
    targetFunction: fnSig, severity: "Critical",
    initialBalance, finalBalance, stolenAmount,
    startTime, endTime,
    transactions: attackSucceeded ? [
      {
        step: 1,
        description: `Victim contract seeded with ETH`,
        from: deployer.address, to: victimAddress,
        value: formatEther(initialBalance), unit: "ETH", timestampMs: t1 - 100,
        balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
      },
      {
        step: 2,
        description: `Attacker (non-owner) calls ${fnSig} — no access check`,
        from: attacker.address, to: victimAddress,
        value: formatEther(stolenAmount), unit: "ETH", timestampMs: endTime,
        balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
      },
    ] : [],
    timeline: attackSucceeded ? [
      `${contractName} deployed with ${formatEther(initialBalance)} ETH`,
      `Attacker calls ${fnSig} with no ownership check`,
      `Call succeeded — VULNERABLE`,
      `${formatEther(stolenAmount)} ETH drained`,
    ] : [
      `${contractName} deployed`,
      `Attacker tried ${fnSig}`,
      `Call reverted — access is correctly controlled`,
    ],
    report: {
      vulnerabilityType: "Access Control",
      affectedFunction: fnSig,
      explanation: attackSucceeded
        ? `${fnSig} has no ownership or role check. Any address can call it. Attacker drained ${formatEther(stolenAmount)} ETH.`
        : `${fnSig} was targeted but the call reverted — access control appears to be in place.`,
      fix: attackSucceeded
        ? `Add require(msg.sender == owner, "Not owner") or use OpenZeppelin Ownable/AccessControl.`
        : "No fix needed — access control is working.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => { console.error(e); process.exit(1); });
