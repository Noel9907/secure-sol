import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const contractName = process.env.UPLOADED_CONTRACT_NAME;
  const fileName = process.env.UPLOADED_FILE_NAME;
  if (!contractName || !fileName) throw new Error("UPLOADED_CONTRACT_NAME and UPLOADED_FILE_NAME must be set");

  const startTime = Date.now();
  const [deployer, attacker] = await hre.ethers.getSigners();

  const fullyQualified = `contracts/uploaded/${fileName}.sol:${contractName}`;
  const VictimFactory = await hre.ethers.getContractFactory(fullyQualified);
  const victim = await VictimFactory.deploy();
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  const iface = (victim as any).interface;

  // Check if this contract has the input validation pattern:
  // withdraw(uint256) + deposit() payable
  // ethers v6: getFunction() returns null if not found (does NOT throw)
  const withdrawFn = iface.getFunction("withdraw");
  const depositFn = iface.getFunction("deposit");
  const hasPattern =
    withdrawFn !== null &&
    depositFn !== null &&
    withdrawFn.inputs.length === 1 &&
    withdrawFn.inputs[0].type === "uint256";

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
      timeline: [`${contractName} deployed`, "No withdraw(uint256) + deposit() pattern found"],
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

  // Seed vault
  await (victim as any).connect(deployer).deposit({ value: parseEther("5") });
  const initialBalance: bigint = await hre.ethers.provider.getBalance(victimAddress);

  const AttackerFactory = await hre.ethers.getContractFactory("InputValidationAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy();
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  const callData = iface.encodeFunctionData("withdraw", [initialBalance]);

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
    transactions: attackSucceeded
      ? [
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
        ]
      : [],
    timeline: attackSucceeded
      ? [
          `${contractName} deployed`,
          "Vault seeded with 5 ETH",
          "Attacker deposited: 0 ETH",
          `Attacker called withdraw(${formatEther(initialBalance)})`,
          "No deposit check — VULNERABLE",
          "Vault drained",
        ]
      : [
          `${contractName} deployed`,
          "Vault seeded with 5 ETH",
          `Attacker tried withdraw(${formatEther(initialBalance)}) without depositing`,
          "Contract correctly blocked the call — SAFE against input validation attack",
        ],
    report: {
      vulnerabilityType: "Input Validation",
      affectedFunction: "withdraw(uint256)",
      explanation: attackSucceeded
        ? "withdraw() does not verify that the caller deposited the requested amount. Any address can withdraw the full vault balance without depositing."
        : "Contract correctly validates that the caller's deposited balance covers the requested amount. Not vulnerable to this attack.",
      fix: attackSucceeded
        ? "Add require(deposits[msg.sender] >= amount, 'Exceeds your deposit') before transferring ETH."
        : "No fix needed — input validation is correctly implemented.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
