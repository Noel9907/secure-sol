import hre from "hardhat";
import path from "path";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";
import { analyzeReentrancy } from "./analyzeReentrancy";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  const fileName = process.env.UPLOADED_FILE_NAME;
  if (!contractName || !fileName) throw new Error("UPLOADED_CONTRACT_NAME and UPLOADED_FILE_NAME must be set");

  const startTime = Date.now();
  const [deployer, attacker] = await hre.ethers.getSigners();

  // Analyze source BEFORE deploying so we know what to do
  const sourcePath = path.join(__dirname, "../../contracts/uploaded", `${fileName}.sol`);
  const analysis = analyzeReentrancy(sourcePath);

  // Use fully qualified name to avoid ambiguity when multiple files share a contract name
  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory = await hre.ethers.getContractFactory(fullyQualified);
  const victim = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // If no reentrancy pattern found, return a safe result immediately
  if (!analysis.found || !analysis.vulnerableFunction || !analysis.depositFunction) {
    const endTime = Date.now();
    const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
    const result = buildResult({
      contractName,
      contractAddress: victimAddress,
      attackType: "reentrancy",
      targetFunction: "N/A",
      severity: "Critical",
      initialBalance,
      finalBalance: initialBalance,
      stolenAmount: 0n,
      startTime,
      endTime,
      transactions: [],
      timeline: [`${contractName} deployed`, `Analysis: ${analysis.reason}`],
      report: {
        vulnerabilityType: "Reentrancy",
        affectedFunction: "N/A",
        explanation: analysis.reason,
        fix: "No reentrancy vulnerability detected in this contract.",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  const { vulnerableFunction, depositFunction } = analysis;
  const depositAmount = parseEther("0.1");

  // Seed victim with 1 ETH via the detected deposit function
  await (victim as any).connect(deployer)[depositFunction.name]({ value: parseEther("1") });
  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  // Encode deposit calldata — handles deposit() and deposit(uint256)
  const iface = (victim as any).interface;
  const depositCalldata: string =
    depositFunction.paramTypes.length === 0
      ? iface.encodeFunctionData(depositFunction.name, [])
      : iface.encodeFunctionData(depositFunction.name, [depositAmount]);

  // Encode withdraw calldata — handles withdraw() and withdraw(uint256 amount)
  let withdrawCalldata: string;
  if (vulnerableFunction.paramTypes.length === 0) {
    withdrawCalldata = iface.encodeFunctionData(vulnerableFunction.name, []);
  } else if (vulnerableFunction.paramTypes[0] === "uint256") {
    // Use depositAmount — attacker re-enters to drain the full balance in increments
    withdrawCalldata = iface.encodeFunctionData(vulnerableFunction.name, [depositAmount]);
  } else {
    // Unknown parameter type — cannot attack
    const endTime = Date.now();
    const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
    const result = buildResult({
      contractName,
      contractAddress: victimAddress,
      attackType: "reentrancy",
      targetFunction: `${vulnerableFunction.name}()`,
      severity: "Critical",
      initialBalance,
      finalBalance,
      stolenAmount: 0n,
      startTime,
      endTime,
      transactions: [],
      timeline: [`Reentrancy pattern found in ${vulnerableFunction.name}() but param type not supported`],
      report: {
        vulnerabilityType: "Reentrancy",
        affectedFunction: `${vulnerableFunction.name}()`,
        explanation: `Pattern detected but attacker does not support parameter type: ${vulnerableFunction.paramTypes.join(", ")}`,
        fix: "Apply checks-effects-interactions pattern.",
      },
    });
    process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
    return;
  }

  // Deploy FlexReentrancyAttacker
  const AttackerFactory = await hre.ethers.getContractFactory("FlexReentrancyAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy(victimAddress);
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  const t1 = Date.now();
  let attackSucceeded = false;

  try {
    // Use a high explicit gasLimit — eth_estimateGas underestimates for re-entrant calls
    // because the recursive execution path is hard to simulate pre-execution.
    // 5M gas is well above what 10 re-entries need (~50K gas per level).
    await (attackerContract as any)
      .connect(attacker)
      .attack(depositCalldata, withdrawCalldata, { value: depositAmount, gasLimit: 5_000_000 });
    attackSucceeded = true;
  } catch {
    // Attack reverted — contract may have reentrancy guard or other protection
  }

  const endTime = Date.now();
  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance > finalBalance ? initialBalance - finalBalance : 0n;
  const attackerBal: bigint = await hre.ethers.provider.getBalance(attackerAddress);
  const reentryCount: bigint = await (attackerContract as any).reentryCount();

  // patternDetected: the reentrancy pattern was confirmed if the attack tx ran AND re-entry occurred.
  // success (from buildResult) is stricter: ETH must actually be stolen.
  // These can differ when Solidity 0.8+ checked arithmetic prevents net fund theft despite re-entry.
  const patternDetected = attackSucceeded && reentryCount > 0n;
  const exploited = stolenAmount > 0n;

  const fnSig = `${vulnerableFunction.name}(${vulnerableFunction.paramTypes.join(",")})`;

  const result = buildResult({
    contractName,
    contractAddress: victimAddress,
    attackType: "reentrancy",
    targetFunction: fnSig,
    severity: "Critical",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    patternDetected,
    transactions: patternDetected
      ? [
          {
            step: 1,
            description: `Attacker deposits ${formatEther(depositAmount)} ETH via ${depositFunction.name}()`,
            from: attacker.address,
            to: victimAddress,
            value: formatEther(depositAmount),
            unit: "ETH",
            timestampMs: t1,
            // victim balance after deposit = initialBalance (seeded) + depositAmount
            balanceAfter: {
              victim: formatEther(initialBalance + depositAmount),
              attacker: formatEther(depositAmount),
            },
          },
          {
            step: 2,
            description: `${fnSig} triggered — ETH sent to attacker BEFORE state update`,
            from: attacker.address,
            to: victimAddress,
            value: formatEther(depositAmount),
            unit: "ETH",
            timestampMs: t1 + Math.floor((endTime - t1) * 0.4),
            // victim lost depositAmount on first send (before re-entry)
            balanceAfter: {
              victim: formatEther(initialBalance),
              attacker: formatEther(depositAmount),
            },
          },
          {
            step: 3,
            description: exploited
              ? `Re-entered ${reentryCount} times — ${formatEther(stolenAmount)} ETH drained`
              : `Re-entered ${reentryCount} time(s) — pattern confirmed; state update after call is exploitable`,
            from: attackerAddress,
            to: victimAddress,
            value: exploited ? formatEther(stolenAmount) : "0.0",
            unit: "ETH",
            timestampMs: endTime,
            balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
          },
        ]
      : [],
    timeline: patternDetected
      ? [
          `${contractName} deployed`,
          `Seeded with 1 ETH via ${depositFunction.name}()`,
          `Attacker deposited ${formatEther(depositAmount)} ETH`,
          `${fnSig} triggered — ETH sent before state update`,
          `Re-entered ${reentryCount} time(s)`,
          exploited
            ? `${formatEther(stolenAmount)} ETH drained — VULNERABLE`
            : "Re-entry confirmed — VULNERABLE PATTERN (checks-effects-interactions violated)",
        ]
      : [
          `${contractName} deployed`,
          `Reentrancy pattern detected in ${fnSig}`,
          "Attack attempted but failed — contract has protection",
        ],
    report: {
      vulnerabilityType: "Reentrancy",
      affectedFunction: fnSig,
      explanation: patternDetected
        ? exploited
          ? `${fnSig} sends ETH to the caller before updating balances[msg.sender]. The attacker deposited ${formatEther(depositAmount)} ETH and triggered the vulnerable function; their receive() re-called it ${reentryCount} time(s), draining ${formatEther(stolenAmount)} ETH before the state was ever updated.`
          : `${fnSig} sends ETH to the caller before updating balances[msg.sender] — a violation of the checks-effects-interactions pattern. Re-entry was confirmed (${reentryCount} re-entry). The exploit did not produce net ETH theft in this run because the amount withdrawn equals the attacker's own deposit; in a scenario with multiple depositors or larger balances, this pattern is directly exploitable. Fix the ordering now.`
        : `Reentrancy pattern detected (ETH sent before state update in ${fnSig}) but the attack did not succeed — contract may have a reentrancy guard or other protection.`,
      fix: "Move the state update BEFORE the external call: set balances[msg.sender] = 0 (or -= amount) BEFORE calling msg.sender. Alternatively, add OpenZeppelin ReentrancyGuard to all withdraw functions.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
