"use client";

import { useState } from "react";
import { type Address, formatEther, parseEther } from "viem";
import { useSendTransaction } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

export default function AttackPage() {
  const [tab, setTab] = useState<"reentrancy" | "flashloan">("reentrancy");

  // --- Reentrancy reads ---
  const { data: bankBal, refetch: refetchBank } = useScaffoldReadContract({
    contractName: "VulnerableBank",
    functionName: "getBankBalance",
    watch: true,
  });
  const { data: attackerBal, refetch: refetchAttacker } = useScaffoldReadContract({
    contractName: "ReentrancyAttacker",
    functionName: "getBalance",
    watch: true,
  });
  const { data: reentryCount } = useScaffoldReadContract({
    contractName: "ReentrancyAttacker",
    functionName: "reentryCount",
    watch: true,
  });

  // --- Flash loan reads ---
  const { data: victimBal, refetch: refetchVictim } = useScaffoldReadContract({
    contractName: "FlashLoanVictim",
    functionName: "getBalance",
    watch: true,
  });
  const { data: dexPrice } = useScaffoldReadContract({
    contractName: "SimpleDEX",
    functionName: "getPrice",
    watch: true,
  });
  const { data: flAttackerBal, refetch: refetchFlAttacker } = useScaffoldReadContract({
    contractName: "FlashLoanAttacker",
    functionName: "getBalance",
    watch: true,
  });
  const { data: flAttackerInfo } = useDeployedContractInfo("FlashLoanAttacker");

  // --- Reentrancy writes ---
  const { writeContractAsync: depositToBank } = useScaffoldWriteContract("VulnerableBank");
  const { writeContractAsync: runReentrancy } = useScaffoldWriteContract("ReentrancyAttacker");

  // --- Flash loan writes ---
  const { writeContractAsync: runFlashLoan } = useScaffoldWriteContract("FlashLoanAttacker");
  const { sendTransaction } = useSendTransaction();

  return (
    <div className="flex flex-col items-center gap-6 p-10">
      <h1 className="text-3xl font-bold">Attack Simulator</h1>

      <div role="tablist" className="tabs tabs-bordered">
        <button
          role="tab"
          className={`tab ${tab === "reentrancy" ? "tab-active" : ""}`}
          onClick={() => setTab("reentrancy")}
        >
          Reentrancy
        </button>
        <button
          role="tab"
          className={`tab ${tab === "flashloan" ? "tab-active" : ""}`}
          onClick={() => setTab("flashloan")}
        >
          Flash Loan
        </button>
      </div>

      {tab === "reentrancy" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="bg-base-200 p-6 rounded-xl w-full">
            <p>
              <b>Bank Balance:</b> {bankBal !== undefined ? formatEther(bankBal) : "..."} ETH
            </p>
            <p>
              <b>Attacker Balance:</b> {attackerBal !== undefined ? formatEther(attackerBal) : "..."} ETH
            </p>
            <p>
              <b>Reentry Count:</b> {reentryCount?.toString() ?? "..."}
            </p>
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={async () => {
              await depositToBank({ functionName: "deposit", value: parseEther("5") });
              refetchBank();
            }}
          >
            Fund Bank (5 ETH)
          </button>
          <button
            className="btn btn-error w-full"
            onClick={async () => {
              await runReentrancy({ functionName: "attack", value: parseEther("1") });
              setTimeout(() => {
                refetchBank();
                refetchAttacker();
              }, 2000);
            }}
          >
            Start Reentrancy Attack (1 ETH)
          </button>
        </div>
      )}

      {tab === "flashloan" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="alert bg-base-200 text-sm">
            <span>
              Attacker borrows 2 ETH, swaps 1 ETH into the DEX to spike its price, then buys tokens from the victim at
              the manipulated rate. Any protocol reading this DEX as a price oracle gets a falsified price. Loan is
              repaid atomically in the same transaction.
            </span>
          </div>
          <div className="bg-base-200 p-6 rounded-xl w-full">
            <p>
              <b>DEX Price:</b> {dexPrice !== undefined ? formatEther(dexPrice) : "..."} ETH/token
            </p>
            <p>
              <b>Victim Balance:</b> {victimBal !== undefined ? formatEther(victimBal) : "..."} ETH
            </p>
            <p>
              <b>Attacker Balance:</b> {flAttackerBal !== undefined ? formatEther(flAttackerBal) : "..."} ETH
            </p>
          </div>
          <button
            className="btn btn-error w-full"
            onClick={async () => {
              await runFlashLoan({ functionName: "attack", args: [parseEther("2")] });
              setTimeout(() => {
                refetchVictim();
                refetchFlAttacker();
              }, 2000);
            }}
          >
            Run Flash Loan Attack (2 ETH loan)
          </button>
          <button
            className="btn btn-outline w-full"
            onClick={() => {
              if (flAttackerInfo?.address) {
                sendTransaction({ to: flAttackerInfo.address as Address, value: parseEther("3") });
                setTimeout(refetchFlAttacker, 2000);
              }
            }}
          >
            Refund Attacker (3 ETH)
          </button>
        </div>
      )}
    </div>
  );
}
