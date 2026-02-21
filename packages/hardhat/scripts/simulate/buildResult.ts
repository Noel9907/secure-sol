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
  /**
   * When true, the vulnerability pattern was confirmed even if no ETH was stolen.
   * Drives vulnerabilitiesFound in the upload endpoint and lowers securityScore.
   * Defaults to (stolenAmount > 0) when not provided.
   */
  patternDetected?: boolean;
};

export function buildResult(params: BuildResultParams) {
  const durationMs = params.endTime - params.startTime;
  const stolenEth = parseFloat(formatEther(params.stolenAmount));
  const initialEth = parseFloat(formatEther(params.initialBalance));
  const finalEth = parseFloat(formatEther(params.finalBalance));

  // exploited = ETH was actually stolen; patternDetected = vulnerability exists (may not be exploitable here)
  const exploited = stolenEth > 0;
  const patternDetected = params.patternDetected !== undefined ? params.patternDetected : exploited;

  const stolenPercent = initialEth > 0 ? (stolenEth / initialEth) * 100 : 0;
  const severityWeight = SEVERITY_WEIGHTS[params.severity] ?? 1.0;

  // Score:
  //   - exploited:        deduct based on % stolen × severity
  //   - pattern only:     fixed deduction of 60 pts × severity (vulnerable code, no actual theft in this run)
  //   - nothing found:    100
  const securityScore = exploited
    ? Math.max(0, Math.round(100 - stolenPercent * severityWeight))
    : patternDetected
    ? Math.max(0, Math.round(100 - 60 * severityWeight))
    : 100;

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
      /** true only if ETH was actually stolen */
      success: exploited,
      /** true if the vulnerability pattern was confirmed (even without ETH theft) */
      patternDetected,
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
