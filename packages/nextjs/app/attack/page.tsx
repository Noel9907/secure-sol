"use client";

import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

export default function AttackPage() {
  const [bankBalance, setBankBalance] = useState("0");
  const [attackerBalance, setAttackerBalance] = useState("0");
  const [reentryCount, setReentryCount] = useState("0");

  // Read Bank Balance
  const { data: bankBal, refetch: refetchBank } = useScaffoldReadContract({
    contractName: "VulnerableBank",
    functionName: "getBankBalance",
    watch: true,
  });

  // Read Attacker Balance
  const { data: attackerBal, refetch: refetchAttacker } = useScaffoldReadContract({
    contractName: "reentrancy",
    functionName: "getBalance",
    watch: true,
  });

  // Read Reentry Count
  const { data: reentry } = useScaffoldReadContract({
    contractName: "reentrancy",
    functionName: "reentryCount",
    watch: true,
  });

  // Fund Bank
  const { writeContractAsync: depositToBank } = useScaffoldWriteContract("VulnerableBank");

  // Start Attack
  const { writeContractAsync: startAttack } = useScaffoldWriteContract("reentrancy");

  useEffect(() => {
    if (bankBal) setBankBalance(formatEther(bankBal));
    if (attackerBal) setAttackerBalance(formatEther(attackerBal));
    if (reentry) setReentryCount(reentry.toString());
  }, [bankBal, attackerBal, reentry]);

  return (
    <div className="flex flex-col items-center gap-6 p-10">
      <h1 className="text-3xl font-bold">Reentrancy Attack Live Simulation</h1>

      <div className="bg-base-200 p-6 rounded-xl w-96">
        <p>
          <b>Bank Balance:</b> {bankBalance} ETH
        </p>
        <p>
          <b>Attacker Balance:</b> {attackerBalance} ETH
        </p>
        <p>
          <b>Reentry Count:</b> {reentryCount}
        </p>
      </div>

      <button
        className="btn btn-primary"
        onClick={async () => {
          await depositToBank({
            functionName: "deposit",
            value: parseEther("5"),
          });
          refetchBank();
        }}
      >
        Fund Bank (5 ETH)
      </button>

      <button
        className="btn btn-error"
        onClick={async () => {
          await startAttack({
            functionName: "simulateAttack",
            value: parseEther("1"),
          });

          setTimeout(() => {
            refetchBank();
            refetchAttacker();
          }, 2000);
        }}
      >
        Start Reentrancy Attack (1 ETH)
      </button>
    </div>
  );
}
