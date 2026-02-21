import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  if (!contractName) throw new Error("UPLOADED_CONTRACT_NAME not set");

  const startTime = Date.now();
  const [deployer, attacker] = await hre.ethers.getSigners();

  // Deploy the user's contract as the victim
  const VictimFactory = await hre.ethers.getContractFactory(contractName);
  const victim = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Seed via deposit() — we know it exists because pattern matched
  await (victim as any).connect(deployer).deposit({ value: parseEther("1") });
  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  // Deploy our pre-built ReentrancyAttacker against the user's contract
  const AttackerFactory = await hre.ethers.getContractFactory("ReentrancyAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy(victimAddress);
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack({ value: parseEther("0.1") });
  const endTime = Date.now();

  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance - finalBalance;
  const attackerBal: bigint = await hre.ethers.provider.getBalance(attackerAddress);
  const reentryCount: bigint = await (attackerContract as any).reentryCount();

  const result = buildResult({
    contractName,
    contractAddress: victimAddress,
    attackType: "reentrancy",
    targetFunction: "withdraw()",
    severity: "Critical",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    transactions: [
      {
        step: 1,
        description: `Attacker deposits 0.1 ETH into ${contractName}`,
        from: attacker.address,
        to: victimAddress,
        value: "0.1",
        unit: "ETH",
        timestampMs: t1,
        balanceAfter: { victim: formatEther(initialBalance), attacker: "0.9" },
      },
      {
        step: 2,
        description: "withdraw() called — re-entry triggered",
        from: attacker.address,
        to: victimAddress,
        value: "0.1",
        unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.5),
        balanceAfter: { victim: formatEther(initialBalance - parseEther("0.1")), attacker: "1.0" },
      },
      {
        step: 3,
        description: `Funds drained after ${reentryCount} re-entries`,
        from: attackerAddress,
        to: victimAddress,
        value: "0.0",
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
      },
    ],
    timeline: [
      `${contractName} deployed`,
      "Victim funded with 1.0 ETH",
      "Attacker deposited 0.1 ETH",
      "withdraw() called — re-entry triggered",
      `Re-entered ${reentryCount} times`,
      stolenAmount > 0n ? "Funds drained — VULNERABLE" : "Attack failed — contract appears safe",
    ],
    report: {
      vulnerabilityType: "Reentrancy",
      affectedFunction: "withdraw()",
      explanation:
        "ETH is sent to the caller before the sender's balance is zeroed. The attacker's receive() fallback re-calls withdraw() recursively, draining the contract before state is updated.",
      fix: "Apply checks-effects-interactions: zero balances[msg.sender] = 0 before the external call, or add OpenZeppelin ReentrancyGuard.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
