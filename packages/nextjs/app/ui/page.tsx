"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Simulation Data ────────────────────────────────────────────────────
const SIM = {
  simulation: {
    id: "sim_001",
    status: "completed",
    startTime: 1708512000000,
    endTime: 1708512003420,
    durationMs: 3420,
  },
  contract: {
    address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    name: "VulnerableBank",
    initialBalance: "1.0",
    finalBalance: "0.0",
    unit: "ETH",
  },
  attack: { type: "Reentrancy", targetFunction: "withdraw()", success: true, stolenAmount: "1.0", unit: "ETH" },
  metrics: {
    securityScore: 12,
    vulnerabilityRate: { ethPerMs: 0.000292, usdPerMs: 0.82, inrPerMs: 68.5 },
    progress: 100,
    severity: "Critical",
  },
  transactions: [
    {
      step: 1,
      description: "Attacker deposits 0.1 ETH into VulnerableBank",
      value: "0.1",
      timestampMs: 1708512000300,
      balanceAfter: { victim: "1.1", attacker: "0.9" },
    },
    {
      step: 2,
      description: "Attacker calls withdraw() — re-entry begins",
      value: "0.1",
      timestampMs: 1708512001200,
      balanceAfter: { victim: "0.9", attacker: "1.0" },
    },
    {
      step: 3,
      description: "Re-entered withdraw() — iteration 1",
      value: "0.1",
      timestampMs: 1708512001400,
      balanceAfter: { victim: "0.8", attacker: "1.1" },
    },
    {
      step: 4,
      description: "Funds fully drained after 10 re-entries",
      value: "0.0",
      timestampMs: 1708512003100,
      balanceAfter: { victim: "0.0", attacker: "1.1" },
    },
  ],
  timeline: [
    "VulnerableBank deployed",
    "Victim funded with 1.0 ETH",
    "Attacker deposited 0.1 ETH",
    "withdraw() called — re-entry triggered",
    "Re-entered 10 times",
    "Funds drained",
  ],
  report: {
    vulnerabilityType: "Reentrancy",
    affectedFunction: "withdraw()",
    severity: "Critical",
    explanation:
      "ETH is sent to the caller before balances[msg.sender] is set to 0. The attacker's receive() fallback re-calls withdraw() recursively, draining the contract before the balance is ever updated.",
    fix: "Apply the checks-effects-interactions pattern: update balances[msg.sender] = 0 before the external call, or use OpenZeppelin ReentrancyGuard.",
  },
};

const NETWORKS = ["Hardhat", "Sepolia", "Goerli", "Mumbai", "Fuji"];

const DRAIN_POINTS = [
  { t: "0ms", v: 1.0 },
  { t: "300ms", v: 1.1 },
  { t: "800ms", v: 1.0 },
  { t: "1200ms", v: 0.9 },
  { t: "1400ms", v: 0.8 },
  { t: "1800ms", v: 0.6 },
  { t: "2200ms", v: 0.4 },
  { t: "2600ms", v: 0.2 },
  { t: "3100ms", v: 0.0 },
];

const ATTACK_VECTORS = [
  { name: "Reentrancy", score: 92, color: "#ef4444" },
  { name: "Overflow", score: 45, color: "#f97316" },
  { name: "Front-Run", score: 30, color: "#eab308" },
  { name: "Flash Loan", score: 65, color: "#6366f1" },
  { name: "Oracle Manip", score: 20, color: "#22c55e" },
];

const VULN_PIE = [
  { name: "Critical", pct: 38.6, color: "#ef4444" },
  { name: "High", pct: 22.5, color: "#f97316" },
  { name: "Medium", pct: 30.8, color: "#6366f1" },
  { name: "Low", pct: 8.1, color: "#22c55e" },
];

// ── Tiny SVG Area Chart ────────────────────────────────────────────────
function DrainChart({ progress }: { progress: number }) {
  const W = 600,
    H = 160,
    PAD = { t: 16, r: 20, b: 32, l: 44 };
  const IW = W - PAD.l - PAD.r,
    IH = H - PAD.t - PAD.b;

  const pts = DRAIN_POINTS.map((p, i) => ({
    x: PAD.l + (i / (DRAIN_POINTS.length - 1)) * IW,
    y: PAD.t + IH - (p.v / 1.2) * IH,
    label: p.t,
  }));

  const visibleCount = Math.max(2, Math.round((progress / 100) * pts.length));
  const visPts = pts.slice(0, visibleCount);

  const linePath = visPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    visPts.length > 1
      ? `${linePath} L${visPts[visPts.length - 1].x.toFixed(1)},${(PAD.t + IH).toFixed(1)} L${visPts[0].x.toFixed(1)},${(PAD.t + IH).toFixed(1)} Z`
      : "";

  const yTicks = [0, 0.3, 0.6, 0.9, 1.2];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {yTicks.map(v => {
        const y = PAD.t + IH - (v / 1.2) * IH;
        return (
          <g key={v}>
            <line x1={PAD.l} y1={y} x2={PAD.l + IW} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
              {v}
            </text>
          </g>
        );
      })}
      {pts
        .filter((_, i) => i % 2 === 0)
        .map(p => (
          <text key={p.label} x={p.x} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {p.label}
          </text>
        ))}
      {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
      {visPts.length > 1 && (
        <path d={linePath} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {visPts.length > 0 && (
        <circle
          cx={visPts[visPts.length - 1].x}
          cy={visPts[visPts.length - 1].y}
          r="4"
          fill="#ef4444"
          stroke="#fff"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

// ── Bar Chart ──────────────────────────────────────────────────────────
function AttackBars() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {ATTACK_VECTORS.map(v => (
        <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 80, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{v.name}</span>
          <div style={{ flex: 1, height: 8, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${v.score}%`,
                background: v.color,
                borderRadius: 99,
                transition: "width 1s ease",
              }}
            />
          </div>
          <span style={{ width: 28, fontSize: 12, fontWeight: 600, color: "#374151", textAlign: "right" }}>
            {v.score}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Donut Chart ────────────────────────────────────────────────────────
function DonutChart() {
  // Increased circle by ~8%: R 52→56, CX/CY 70→76, STROKE 18→19
  const R = 56,
    CX = 76,
    CY = 76,
    STROKE = 19;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = VULN_PIE.map(s => {
    const dash = (s.pct / 100) * circ;
    const gap = circ - dash;
    const el = { ...s, dash, gap, offset };
    offset += dash;
    return el;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      {/* Increased SVG size by ~8%: 140→152 */}
      <svg width={152} height={152} viewBox="0 0 152 152" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        <circle cx={CX} cy={CY} r={R - STROKE / 2 - 2} fill="white" />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">
          38.6%
        </text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fill="#9ca3af">
          Critical
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {VULN_PIE.map(s => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Increased dot by ~10%: 9→10 */}
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#374151", width: 56 }}>{s.name}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Score Ring ─────────────────────────────────────────────────────────
function ScoreRing({ score, color }: { score: number; color: string }) {
  // Increased by ~10%: R 36→40, size 88→97
  const R = 40,
    C = 2 * Math.PI * R;
  const dash = (score / 100) * C;
  return (
    <svg width={97} height={97} viewBox="0 0 97 97">
      <circle cx={48} cy={48} r={R} fill="none" stroke="#f3f4f6" strokeWidth={9} />
      <circle
        cx={48}
        cy={48}
        r={R}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeDasharray={`${dash} ${C}`}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dasharray 1.2s ease" }}
      />
      <text x={48} y={53} textAnchor="middle" fontSize="17" fontWeight="800" fill={color}>
        {score}
      </text>
    </svg>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function Page() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [txIdx, setTxIdx] = useState(-1);
  const [balance, setBalance] = useState(1.0);
  const [score, setScore] = useState(100);
  const [activeNet, setActiveNet] = useState("Hardhat");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0 = useRef(0);

  const isDraining = balance < 1.0;
  const stolen = Math.max(0, 1.0 - balance).toFixed(2);
  const balColor = balance <= 0 ? "#ef4444" : balance < 0.5 ? "#f97316" : "#16a34a";
  const elapsed = Math.min(elapsedMs, SIM.simulation.durationMs);

  function run() {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase("running");
    setProgress(0);
    setElapsedMs(0);
    setTxIdx(-1);
    setBalance(1.0);
    setScore(100);
    t0.current = Date.now();

    timerRef.current = setInterval(() => {
      const e = Date.now() - t0.current;
      const total = SIM.simulation.durationMs;
      const pct = Math.min(100, (e / total) * 100);
      const sc = Math.max(SIM.metrics.securityScore, Math.round(100 - (88 * pct) / 100));
      setProgress(pct);
      setElapsedMs(e);
      setScore(sc);

      const idx = Math.min(SIM.transactions.length - 1, Math.floor((e / total) * SIM.transactions.length) - 1);
      if (idx >= 0) {
        setTxIdx(idx);
        setBalance(parseFloat(SIM.transactions[idx].balanceAfter.victim));
      }

      if (e >= total) {
        clearInterval(timerRef.current!);
        setProgress(100);
        setTxIdx(SIM.transactions.length - 1);
        setBalance(0);
        setScore(SIM.metrics.securityScore);
        setPhase("done");
      }
    }, 40);
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const curTx = txIdx >= 0 ? SIM.transactions[txIdx] : null;

  // card style helper — reduced width by 20% via padding adjustments, increased padding by ~7%
  const card = (extra?: object): React.CSSProperties => ({
    background: "#fff",
    borderRadius: 15,
    boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)",
    padding: "22px 24px",
    border: "1px solid #f1f5f9",
    ...extra,
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header
        style={{
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 32px",
          height: 60,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
            }}
          >
            ⚔️
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", lineHeight: 1 }}>ContractShield</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Smart Contract Attack Simulator</div>
          </div>
        </div>

        {/* Network selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", marginRight: 4 }}>Network</span>
          {NETWORKS.map(n => (
            <button
              key={n}
              onClick={() => setActiveNet(n)}
              style={{
                padding: "5px 13px",
                borderRadius: 20,
                fontSize: 12,
                cursor: "pointer",
                border: activeNet === n ? "1.5px solid #6366f1" : "1.5px solid #e5e7eb",
                background: activeNet === n ? "#eef2ff" : "#fff",
                color: activeNet === n ? "#6366f1" : "#6b7280",
                fontWeight: activeNet === n ? 600 : 400,
                transition: "all .15s",
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Wallet + Timer + Run */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              padding: "6px 14px",
              background: "#f8fafc",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Contract Balance</div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: balColor,
                fontVariantNumeric: "tabular-nums",
                transition: "color .3s",
              }}
            >
              {balance.toFixed(4)} ETH
            </div>
          </div>
          <div
            style={{
              padding: "6px 14px",
              background: "#f8fafc",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Elapsed</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", fontVariantNumeric: "tabular-nums" }}>
              {(elapsed / 1000).toFixed(2)}s
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              background: phase === "running" ? "#fef3c7" : phase === "done" ? "#ecfdf5" : "#f3f4f6",
              color: phase === "running" ? "#92400e" : phase === "done" ? "#065f46" : "#6b7280",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                flexShrink: 0,
                background: phase === "running" ? "#f59e0b" : phase === "done" ? "#10b981" : "#9ca3af",
                animation: phase === "running" ? "pulse 1s ease-in-out infinite" : "none",
              }}
            />
            {phase === "running" ? "Simulating" : phase === "done" ? "Complete" : "Idle"}
          </div>
          <button
            onClick={run}
            disabled={phase === "running"}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: phase === "running" ? "not-allowed" : "pointer",
              background: phase === "running" ? "#e5e7eb" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: phase === "running" ? "#9ca3af" : "#fff",
              border: "none",
              transition: "all .2s",
            }}
          >
            {phase === "running" ? "Running…" : phase === "done" ? "▶ Run Again" : "▶ Run Simulation"}
          </button>
        </div>
      </header>

      {/* Main content — add bottom padding to avoid fixed bar overlap */}
      <main style={{ padding: "28px 32px 110px", maxWidth: 1400, margin: "0 auto" }}>
        {/* ── Stat Cards Row — reduced width via narrower max grid, increased card size ~8% ── */}
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24, maxWidth: "80%" }}
        >
          {[
            {
              label: "Security Score",
              value: score,
              suffix: "/100",
              color: score < 30 ? "#ef4444" : score < 60 ? "#f97316" : "#16a34a",
              tag: "Risk Level",
              tagColor: "#fef2f2",
              tagText: "#ef4444",
              tagVal: "Critical",
            },
            {
              label: "Stolen Amount",
              value: phase === "done" ? "1.0" : stolen,
              suffix: " ETH",
              color: "#ef4444",
              tag: "Change",
              tagColor: "#fef2f2",
              tagText: "#ef4444",
              tagVal: "−100%",
            },
            {
              label: "Drain Rate",
              value: `$${SIM.metrics.vulnerabilityRate.usdPerMs.toFixed(2)}`,
              suffix: "/ms",
              color: "#374151",
              tag: "Speed",
              tagColor: "#fef2f2",
              tagText: "#f97316",
              tagVal: "Fast",
            },
            {
              label: "Duration",
              value: (SIM.simulation.durationMs / 1000).toFixed(2),
              suffix: " sec",
              color: "#374151",
              tag: "Total",
              tagColor: "#f0fdf4",
              tagText: "#16a34a",
              tagVal: "Completed",
            },
          ].map((s, i) => (
            <div
              key={i}
              style={{
                ...card(),
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: "24px 26px",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>{s.label}</div>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 800,
                    color: s.color,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {s.value}
                  <span style={{ fontSize: 14, fontWeight: 500, color: "#9ca3af" }}>{s.suffix}</span>
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: s.tagColor,
                  color: s.tagText,
                }}
              >
                {s.tagVal}
              </span>
            </div>
          ))}
        </div>

        {/* ── Main Grid — reduced right column width ~20% ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 272px", gap: 20 }}>
          {/* LEFT column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Balance Drain Timeline */}
            <div style={card()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Balance Drain Timeline</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>
                    Contract balance vs attacker gain over {SIM.simulation.durationMs}ms
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span
                      style={{ width: 24, height: 2, background: "#ef4444", display: "inline-block", borderRadius: 2 }}
                    />
                    <span style={{ color: "#6b7280" }}>Victim</span>
                  </span>
                </div>
              </div>
              <div style={{ height: 160 }}>
                <DrainChart progress={progress} />
              </div>
            </div>

            {/* Two-col: Attack Vectors + Vuln Distribution */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={card()}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Attack Severity</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Vulnerability score by vector</div>
                <AttackBars />
              </div>
              <div style={card()}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                  Vulnerability Distribution
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>By severity classification</div>
                <DonutChart />
              </div>
            </div>

            {/* Transaction Log Table */}
            <div style={card()}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Transaction Log</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Real-time attack steps</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                    {["Step", "Description", "Victim ETH", "Attacker ETH", "Status"].map(h => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "0 12px 10px 0",
                          color: "#9ca3af",
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SIM.transactions.map((tx, i) => {
                    const active = phase === "done" || (phase === "running" && i <= txIdx);
                    const current = phase === "running" && i === txIdx;
                    return (
                      <tr
                        key={tx.step}
                        style={{
                          borderBottom: "1px solid #f8fafc",
                          background: current ? "#fef9f0" : "transparent",
                          opacity: active ? 1 : 0.35,
                          transition: "opacity .4s, background .3s",
                        }}
                      >
                        <td style={{ padding: "10px 12px 10px 0" }}>
                          {/* Increased step circle: 22→25 */}
                          <span
                            style={{
                              width: 25,
                              height: 25,
                              borderRadius: "50%",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 700,
                              background: active ? (current ? "#f97316" : "#6366f1") : "#f3f4f6",
                              color: active ? "#fff" : "#9ca3af",
                            }}
                          >
                            {tx.step}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px 10px 0", color: "#374151" }}>{tx.description}</td>
                        <td
                          style={{
                            padding: "10px 12px 10px 0",
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                            color: parseFloat(tx.balanceAfter.victim) < 1 ? "#ef4444" : "#374151",
                          }}
                        >
                          {tx.balanceAfter.victim} ETH
                        </td>
                        <td
                          style={{
                            padding: "10px 12px 10px 0",
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                            color: "#16a34a",
                          }}
                        >
                          {tx.balanceAfter.attacker} ETH
                        </td>
                        <td style={{ padding: "10px 0" }}>
                          {active ? (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "2px 8px",
                                borderRadius: 12,
                                background: "#ecfdf5",
                                color: "#065f46",
                                fontWeight: 600,
                              }}
                            >
                              ✓ Done
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "2px 8px",
                                borderRadius: 12,
                                background: "#f3f4f6",
                                color: "#9ca3af",
                              }}
                            >
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Vulnerability Report */}
            <div style={card()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Vulnerability Report</div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 10px",
                    borderRadius: 12,
                    background: "#fef2f2",
                    color: "#ef4444",
                    fontWeight: 600,
                    border: "1px solid #fecaca",
                  }}
                >
                  🔴 Critical
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
                  {SIM.report.affectedFunction}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div
                  style={{ background: "#fef2f2", border: "1px solid #fee2e2", borderRadius: 11, padding: "15px 17px" }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#dc2626",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    ⚠️ What Went Wrong
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#7f1d1d", lineHeight: 1.65 }}>
                    {SIM.report.explanation}
                  </p>
                </div>
                <div
                  style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 11, padding: "15px 17px" }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#16a34a",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    ✅ How to Fix
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#14532d", lineHeight: 1.65 }}>{SIM.report.fix}</p>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT column — 272px (~20% narrower than original 340px) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Security Score Card — boxes ~10% larger */}
            <div style={{ ...card({ textAlign: "center" as const }), padding: "24px 22px" }}>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>Security Score</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                <ScoreRing score={score} color={score < 30 ? "#ef4444" : score < 60 ? "#f97316" : "#16a34a"} />
              </div>
              <div
                style={{ fontSize: 12, fontWeight: 700, color: score < 30 ? "#ef4444" : "#16a34a", marginBottom: 6 }}
              >
                {score < 30 ? "🔴 Critical Risk" : score < 60 ? "🟠 High Risk" : "🟢 Secure"}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>
                {score < 30 ? "Severe vulnerabilities detected. Immediate action required." : "Contract appears safe."}
              </div>
            </div>

            {/* Active Attack Card */}
            <div
              style={{
                ...card(),
                padding: "22px 20px",
                border:
                  phase === "running"
                    ? "1.5px solid #fde68a"
                    : phase === "done"
                      ? "1.5px solid #fecaca"
                      : "1px solid #f1f5f9",
                background: phase === "running" ? "#fffbeb" : phase === "done" ? "#fef2f2" : "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 17 }}>{phase === "running" ? "🔥" : phase === "done" ? "💀" : "🛡️"}</span>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: phase === "running" ? "#92400e" : phase === "done" ? "#991b1b" : "#374151",
                  }}
                >
                  {phase === "running"
                    ? "Attack In Progress"
                    : phase === "done"
                      ? "Attack Complete"
                      : "Ready to Simulate"}
                </div>
              </div>
              {[
                { label: "Attack Type", val: SIM.attack.type, mono: false },
                { label: "Target", val: SIM.attack.targetFunction, mono: true },
                { label: "Severity", val: SIM.metrics.severity, mono: false },
                { label: "Progress", val: `${Math.round(progress)}%`, mono: true },
              ].map(row => (
                <div
                  key={row.label}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}
                >
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: row.label === "Severity" ? "#ef4444" : "#374151",
                      fontFamily: row.mono ? "monospace" : "inherit",
                    }}
                  >
                    {row.val}
                  </span>
                </div>
              ))}
            </div>

            {/* Drain Rate */}
            <div style={{ ...card(), padding: "22px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Drain Rate</div>
              {[
                { label: "₹ per millisecond", val: `₹${SIM.metrics.vulnerabilityRate.inrPerMs.toFixed(1)}`, big: true },
                { label: "USD per millisecond", val: `$${SIM.metrics.vulnerabilityRate.usdPerMs.toFixed(3)}` },
                { label: "ETH per millisecond", val: `${SIM.metrics.vulnerabilityRate.ethPerMs.toFixed(6)} ETH` },
              ].map(r => (
                <div key={r.label} style={{ marginBottom: r.big ? 14 : 10 }}>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{r.label}</div>
                  <div
                    style={{
                      fontSize: r.big ? 22 : 14,
                      fontWeight: r.big ? 800 : 600,
                      color: isDraining ? "#ef4444" : "#374151",
                      fontVariantNumeric: "tabular-nums",
                      transition: "color .3s",
                    }}
                  >
                    {r.val}
                  </div>
                </div>
              ))}
              <div
                style={{
                  marginTop: 4,
                  padding: "11px 13px",
                  borderRadius: 9,
                  background: isDraining ? "#fef2f2" : "#f8fafc",
                  border: `1px solid ${isDraining ? "#fecaca" : "#e5e7eb"}`,
                  transition: "all .4s",
                }}
              >
                <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>Total Stolen</div>
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 800,
                    color: isDraining ? "#ef4444" : "#9ca3af",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {phase === "done" ? SIM.attack.stolenAmount : stolen} ETH
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div style={{ ...card(), padding: "22px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Attack Timeline</div>
              {SIM.timeline.map((evt, i) => {
                const done =
                  phase === "done" || (phase === "running" && i < Math.floor((progress / 100) * SIM.timeline.length));
                return (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      {/* Timeline dot increased: 8→9 */}
                      <div
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          flexShrink: 0,
                          marginTop: 3,
                          background: done ? "#6366f1" : "#e5e7eb",
                          boxShadow: done ? "0 0 0 3px #eef2ff" : "none",
                          transition: "all .3s",
                        }}
                      />
                      {i < SIM.timeline.length - 1 && (
                        <div
                          style={{
                            width: 1,
                            flex: 1,
                            background: done ? "#c7d2fe" : "#e5e7eb",
                            minHeight: 14,
                            transition: "background .3s",
                          }}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: done ? "#374151" : "#9ca3af",
                        paddingBottom: 8,
                        transition: "color .3s",
                        lineHeight: 1.4,
                      }}
                    >
                      {evt}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* ── Bottom Progress Bar — fixed, floating above bottom, reduced width, text INSIDE bar ── */}
      <div
        style={{
          position: "fixed",
          bottom: 24 /* float above the very bottom edge */,
          left: "50%",
          transform: "translateX(-50%)",
          width: 480 /* reduced width (was full-width) */,
          zIndex: 100,
          background: "rgba(255,255,255,0.96)",
          backdropFilter: "blur(14px)",
          borderRadius: 14,
          boxShadow: "0 4px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06)",
          border: "1px solid #e5e7eb",
          padding: "12px 18px 14px",
        }}
      >
        {/* Label row above track */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Attack Progress</span>
            {phase !== "idle" && (
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 8px",
                  borderRadius: 10,
                  fontWeight: 600,
                  background: phase === "done" ? "#ecfdf5" : "#fef3c7",
                  color: phase === "done" ? "#065f46" : "#92400e",
                }}
              >
                {phase === "done" ? "✓ Complete" : `Step ${txIdx + 1} of ${SIM.transactions.length}`}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: progress >= 100 ? "#16a34a" : "#374151",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {progress.toFixed(1)}%
          </span>
        </div>

        {/* Progress track — text rendered INSIDE the bar */}
        <div style={{ height: 22, background: "#f3f4f6", borderRadius: 99, overflow: "hidden", position: "relative" }}>
          {/* Filled portion */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${progress}%`,
              background:
                progress >= 100 ? "linear-gradient(90deg,#16a34a,#22c55e)" : "linear-gradient(90deg,#6366f1,#ef4444)",
              transition: "width .1s linear",
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            {phase === "running" && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent)",
                  animation: "shimmer 1.2s linear infinite",
                }}
              />
            )}
          </div>
          {/* Text centered over entire bar (sits above fill) */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: progress > 45 ? "#fff" : "#6b7280",
              transition: "color .3s",
              letterSpacing: "0.02em",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {curTx && phase === "running"
              ? `${curTx.description.slice(0, 42)}${curTx.description.length > 42 ? "…" : ""}`
              : phase === "done"
                ? "✓ Attack simulation complete"
                : phase === "idle"
                  ? "Ready — press Run Simulation"
                  : "Initialising…"}
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        * { box-sizing: border-box; }
        button { font-family: inherit; }
      `}</style>
    </div>
  );
}
