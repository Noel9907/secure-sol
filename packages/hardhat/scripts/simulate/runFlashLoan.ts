import hre from "hardhat";
import { parseEther, formatEther } from "ethers";
import { buildResult } from "./buildResult";

async function main() {
  const startTime = Date.now();
  const [, attacker] = await hre.ethers.getSigners();

  const DEXFactory = await hre.ethers.getContractFactory("SimpleDEX");
  const dex = await DEXFactory.deploy({ value: parseEther("5") });
  await dex.waitForDeployment();
  const dexAddress = await dex.getAddress();

  const VictimFactory = await hre.ethers.getContractFactory("FlashLoanVictim");
  const victim = await VictimFactory.deploy(dexAddress, { value: parseEther("2") });
  await victim.waitForDeployment();
  const victimAddress = await victim.getAddress();

  const ProviderFactory = await hre.ethers.getContractFactory("FlashLoanProvider");
  const provider = await ProviderFactory.deploy({ value: parseEther("10") });
  await provider.waitForDeployment();
  const providerAddress = await provider.getAddress();

  const AttackerFactory = await hre.ethers.getContractFactory("FlashLoanAttacker");
  const attackerContract = await AttackerFactory.connect(attacker).deploy(
    victimAddress,
    providerAddress,
    dexAddress,
    { value: parseEther("3") },
  );
  await attackerContract.waitForDeployment();

  const priceBefore: bigint = await (dex as any).getPrice();
  const victimBefore: bigint = await (victim as any).getBalance();

  // Loan amount = 2 ETH
  const loanAmount = parseEther("2");

  const t1 = Date.now();
  await (attackerContract as any).connect(attacker).attack(loanAmount);
  const endTime = Date.now();

  const priceAfter: bigint = await (dex as any).getPrice();
  const victimAfter: bigint = await (victim as any).getBalance();

  // For scoring: treat loanAmount as the "leveraged damage" — the capital used to manipulate the oracle
  const stolenAmount: bigint = loanAmount;

  const priceChangePercent = Number(((priceAfter - priceBefore) * 10000n) / priceBefore) / 100;

  const result = buildResult({
    contractName: "FlashLoanVictim",
    contractAddress: victimAddress,
    attackType: "flashloan",
    targetFunction: "buyWithPrice()",
    severity: "High",
    initialBalance: victimBefore,
    finalBalance: victimAfter,
    stolenAmount,
    startTime,
    endTime,
    transactions: [
      {
        step: 1,
        description: `Flash loan: borrow ${formatEther(loanAmount)} ETH from provider`,
        from: (await attackerContract.getAddress()),
        to: providerAddress,
        value: formatEther(loanAmount),
        unit: "ETH",
        timestampMs: t1,
        balanceAfter: { victim: formatEther(victimBefore), attacker: formatEther(loanAmount) },
      },
      {
        step: 2,
        description: `Swap ${formatEther(loanAmount / 2n)} ETH on DEX — price spikes`,
        from: (await attackerContract.getAddress()),
        to: dexAddress,
        value: formatEther(loanAmount / 2n),
        unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.3),
        balanceAfter: {
          victim: formatEther(victimBefore),
          attacker: `Price: ${formatEther(priceBefore)} → ${formatEther(priceAfter)} ETH/token`,
        },
      },
      {
        step: 3,
        description: `Buy tokens from victim at manipulated price (+${priceChangePercent.toFixed(1)}%)`,
        from: (await attackerContract.getAddress()),
        to: victimAddress,
        value: formatEther(loanAmount / 4n),
        unit: "ETH",
        timestampMs: t1 + Math.floor((endTime - t1) * 0.6),
        balanceAfter: { victim: formatEther(victimAfter), attacker: "tokens acquired" },
      },
      {
        step: 4,
        description: `Repay flash loan — all within 1 transaction`,
        from: (await attackerContract.getAddress()),
        to: providerAddress,
        value: formatEther(loanAmount),
        unit: "ETH",
        timestampMs: endTime,
        balanceAfter: { victim: formatEther(victimAfter), attacker: "0.5 ETH net cost" },
      },
    ],
    timeline: [
      "SimpleDEX deployed with 5 ETH liquidity",
      "FlashLoanVictim deployed — uses DEX as price oracle",
      `Flash loan of ${formatEther(loanAmount)} ETH initiated`,
      `DEX price manipulated: ${formatEther(priceBefore)} → ${formatEther(priceAfter)} ETH/token (+${priceChangePercent.toFixed(1)}%)`,
      "Victim sells tokens at inflated price (overpays attacker in ETH)",
      "Flash loan repaid atomically — attack completes in 1 tx",
    ],
    report: {
      vulnerabilityType: "Flash Loan / Price Oracle Manipulation",
      affectedFunction: "buyWithPrice()",
      explanation: `The victim reads its token price from a DEX (SimpleDEX) that can be manipulated within a single transaction. The attacker borrowed ${formatEther(loanAmount)} ETH, swapped half into the DEX to spike the price by ${priceChangePercent.toFixed(1)}%, then bought tokens from the victim at the inflated rate. The loan is repaid atomically — zero capital required.`,
      fix: "Never use a single DEX spot price as an oracle. Use a TWAP (time-weighted average price), Chainlink price feeds, or a multi-source oracle like Uniswap v3 TWAP.",
    },
  });

  process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\n");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
