import { formatEther } from "ethers";

const ETH_USD = 3500;
const USD_INR = 83.5;
const SEVERITY_WEIGHTS: Record<string, number> = {
  Critical: 1.0,
  High: 0.8,
  Medium: 0.5,
  Low: 0.2,
};

export type SimTransaction = {
  step: number;
  description: string;
  from: string;
  to: string;
  value: string;
  unit: string;
  timestampMs: number;
  balanceAfter: { victim: string; attacker: string };
};

export type SimReport = {
  vulnerabilityType: string;
  affectedFunction: string;
  explanation: string;
  fix: string;
};

export type BuildResultParams = {
  contractName: string;
  contractAddress: string;
  attackType: string;
  targetFunction: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  initialBalance: bigint;
  finalBalance: bigint;
  stolenAmount: bigint;
  startTime: number;
  endTime: number;
  transactions: SimTransaction[];
  timeline: string[];
  report: SimReport;
};

export function buildResult(params: BuildResultParams) {
  const durationMs = params.endTime - params.startTime;
  const stolenEth = parseFloat(formatEther(params.stolenAmount));
  const initialEth = parseFloat(formatEther(params.initialBalance));
  const finalEth = parseFloat(formatEther(params.finalBalance));

  const stolenPercent = initialEth > 0 ? (stolenEth / initialEth) * 100 : 0;
  const severityWeight = SEVERITY_WEIGHTS[params.severity] ?? 1.0;
  const securityScore = Math.max(0, Math.round(100 - stolenPercent * severityWeight));

  const ethPerMs = durationMs > 0 ? stolenEth / durationMs : 0;
  const usdPerMs = ethPerMs * ETH_USD;
  const inrPerMs = usdPerMs * USD_INR;

  return {
    simulation: {
      id: `sim_${params.startTime}`,
      status: "completed",
      startTime: params.startTime,
      endTime: params.endTime,
      durationMs,
    },
    contract: {
      address: params.contractAddress,
      name: params.contractName,
      initialBalance: initialEth.toFixed(4),
      finalBalance: finalEth.toFixed(4),
      unit: "ETH",
    },
    attack: {
      type: params.attackType,
      targetFunction: params.targetFunction,
      success: stolenEth > 0,
      stolenAmount: stolenEth.toFixed(4),
      unit: "ETH",
    },
    metrics: {
      securityScore,
      vulnerabilityRate: {
        ethPerMs: parseFloat(ethPerMs.toFixed(6)),
        usdPerMs: parseFloat(usdPerMs.toFixed(4)),
        inrPerMs: parseFloat(inrPerMs.toFixed(2)),
      },
      progress: 100,
      severity: params.severity,
    },
    transactions: params.transactions,
    timeline: params.timeline,
    report: {
      ...params.report,
      severity: params.severity,
    },
  };
}
