"use client";

import { useEffect, useRef, useState } from "react";

// ── Backend endpoint — matches uploadHandler POST /upload ──────────────
const API_BASE =  "http://localhost:3002";

// ── Types matching backend UploadResponse ─────────────────────────────
interface SimTransaction {
  step: number;
  description: string;
  value: string;
  timestampMs: number;
  balanceAfter: { victim: string; attacker: string };
}

interface SimResult {
  simulation: { id: string; status: string; startTime: number; endTime: number; durationMs: number };
  contract: { address: string; name: string; initialBalance: string; finalBalance: string; unit: string };
  attack: { type: string; targetFunction: string; success: boolean; stolenAmount: string; unit: string; patternDetected?: boolean };
  metrics: { securityScore: number; vulnerabilityRate: { ethPerMs: number; usdPerMs: number; inrPerMs: number }; progress: number; severity: string };
  transactions: SimTransaction[];
  timeline: string[];
  report: { vulnerabilityType: string; affectedFunction: string; severity: string; explanation: string; fix: string };
}

interface UploadResponse {
  contractName: string;
  fileName: string;
  vulnerabilitiesFound: string[];
  simulations: SimResult[];
}

// ── Static constants ───────────────────────────────────────────────────
const NETWORKS = ["Hardhat", "Sepolia", "Flow", "Mumbai", "Fuji"];

const VULN_PIE = [
  { name: "Critical", pct: 38.6, color: "#ef4444" },
  { name: "High",     pct: 22.5, color: "#f97316" },
  { name: "Medium",   pct: 30.8, color: "#6366f1" },
  { name: "Low",      pct: 8.1,  color: "#22c55e" },
];

// ── SVG Drain Chart ────────────────────────────────────────────────────
function DrainChart({ drainPoints, progress }: { drainPoints: { t: string; v: number }[]; progress: number }) {
  const W = 600, H = 160, PAD = { t: 16, r: 20, b: 32, l: 44 };
  const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;
  const maxV = Math.max(...drainPoints.map(p => p.v), 1.2);
  const pts = drainPoints.map((p, i) => ({
    x: PAD.l + (i / Math.max(drainPoints.length - 1, 1)) * IW,
    y: PAD.t + IH - (p.v / maxV) * IH,
    label: p.t,
  }));
  const visPts = pts.slice(0, Math.max(2, Math.round((progress / 100) * pts.length)));
  const linePath = visPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = visPts.length > 1
    ? `${linePath} L${visPts[visPts.length - 1].x.toFixed(1)},${(PAD.t + IH).toFixed(1)} L${visPts[0].x.toFixed(1)},${(PAD.t + IH).toFixed(1)} Z`
    : "";
  const yTicks = [0, maxV * 0.25, maxV * 0.5, maxV * 0.75, maxV];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {yTicks.map(v => {
        const y = PAD.t + IH - (v / maxV) * IH;
        return (
          <g key={v}>
            <line x1={PAD.l} y1={y} x2={PAD.l + IW} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{v.toFixed(2)}</text>
          </g>
        );
      })}
      {pts.filter((_, i) => i % 2 === 0).map(p => (
        <text key={p.label} x={p.x} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">{p.label}</text>
      ))}
      {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
      {visPts.length > 1 && <path d={linePath} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {visPts.length > 0 && (
        <circle cx={visPts[visPts.length - 1].x} cy={visPts[visPts.length - 1].y} r="4" fill="#ef4444" stroke="#fff" strokeWidth="2" />
      )}
    </svg>
  );
}

// ── Attack Bars ────────────────────────────────────────────────────────
function AttackBars({ vectors }: { vectors: { name: string; score: number; color: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {vectors.map(v => (
        <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 80, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{v.name}</span>
          <div style={{ flex: 1, height: 8, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${v.score}%`, background: v.color, borderRadius: 99, transition: "width 1s ease" }} />
          </div>
          <span style={{ width: 28, fontSize: 12, fontWeight: 600, color: "#374151", textAlign: "right" }}>{v.score}</span>
        </div>
      ))}
    </div>
  );
}

// ── Donut Chart ────────────────────────────────────────────────────────
function DonutChart() {
  const R = 56, CX = 76, CY = 76, STROKE = 19;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = VULN_PIE.map(s => {
    const dash = (s.pct / 100) * circ;
    const el = { ...s, dash, gap: circ - dash, offset };
    offset += dash;
    return el;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={152} height={152} viewBox="0 0 152 152" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <circle key={i} cx={CX} cy={CY} r={R} fill="none" stroke={s.color} strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={-s.offset} transform={`rotate(-90 ${CX} ${CY})`} />
        ))}
        <circle cx={CX} cy={CY} r={R - STROKE / 2 - 2} fill="white" />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">38.6%</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fill="#9ca3af">Critical</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {VULN_PIE.map(s => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
  const R = 40, C = 2 * Math.PI * R, dash = (score / 100) * C;
  return (
    <svg width={97} height={97} viewBox="0 0 97 97">
      <circle cx={48} cy={48} r={R} fill="none" stroke="#f3f4f6" strokeWidth={9} />
      <circle cx={48} cy={48} r={R} fill="none" stroke={color} strokeWidth={9}
        strokeDasharray={`${dash} ${C}`} strokeLinecap="round" transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dasharray 1.2s ease" }} />
      <text x={48} y={53} textAnchor="middle" fontSize="17" fontWeight="800" fill={color}>{score}</text>
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ── UPLOAD SCREEN ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
function UploadScreen({
  activeNet,
  setActiveNet,
  onResult,
}: {
  activeNet: string;
  setActiveNet: (n: string) => void;
  onResult: (data: UploadResponse) => void;
}) {
  const [file, setFile]           = useState<File | null>(null);
  const [dragOver, setDragOver]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File) {
    if (!f.name.endsWith(".sol")) { setError("Only .sol Solidity files are accepted."); return; }
    setFile(f); setError(null);
  }

  async function startAttack() {
    if (!file) { setError("Please select a .sol file first."); return; }
    setUploading(true); setError(null); setUploadPct(0);

    const messages = [
      "Uploading contract…",
      "Compiling with Hardhat…",
      "Deploying to local node…",
      "Running Reentrancy attack…",
      "Running Input Validation attack…",
      "Running Overflow attack…",
      "Generating security report…",
    ];
    let msgIdx = 0;
    setStatusMsg(messages[0]);
    const ticker = setInterval(() => {
      setUploadPct(p => {
        const next = Math.min(p + 1.4, 90);
        const step = Math.floor((next / 90) * (messages.length - 1));
        if (step !== msgIdx) { msgIdx = step; setStatusMsg(messages[step]); }
        return next;
      });
    }, 200);

    try {
      const form = new FormData();
      // field name must be "contract" — matches req.file from multer in uploadHandler
      form.append("contract", file);
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
      clearInterval(ticker);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        console.error("Upload error:", err);
        throw new Error(err.error ?? "Upload failed");
      }
      const data: UploadResponse = await res.json();
      setUploadPct(100);
      setStatusMsg("Done! Opening results…");
      setTimeout(() => onResult(data), 600);
    } catch (e: any) {
      clearInterval(ticker);
      setError(e.message ?? "Unknown error");
      setUploading(false); setUploadPct(0); setStatusMsg("");
    }
  }

  const cardBase: React.CSSProperties = {
    background: "#fff", borderRadius: 14,
    boxShadow: "0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)",
    border: "1px solid #f1f5f9",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>⚔️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", lineHeight: 1 }}>Secure.sol</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Smart Contract Attack Simulator</div>
          </div>
        </div>
        {/* <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", marginRight: 4 }}>Network</span>
          {NETWORKS.map(n => (
            <button key={n} onClick={() => setActiveNet(n)} style={{ padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: activeNet === n ? "1.5px solid #6366f1" : "1.5px solid #e5e7eb", background: activeNet === n ? "#eef2ff" : "#fff", color: activeNet === n ? "#6366f1" : "#6b7280", fontWeight: activeNet === n ? 600 : 400, transition: "all .15s" }}>{n}</button>
          ))}
        </div> */}
        {/* <div style={{ width: 160 }} /> */}
      </header>

      {/* Hero body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 32px" }}>
        <div style={{ width: "100%", maxWidth: 520 }}>
          {/* Badge + headline */}
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eef2ff", color: "#6366f1", fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 20, marginBottom: 16 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1" }} />
              Automated Vulnerability Scanner
            </span>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: "#111827", margin: "0 0 12px", lineHeight: 1.2 }}>
              Test your smart contract<br />against real attacks
            </h1>
            <p style={{ fontSize: 14, color: "#9ca3af", margin: 0, lineHeight: 1.7, maxWidth: 400, marginInline: "auto" }}>
              Upload a Solidity file and we'll compile it, deploy it, then run Reentrancy, Overflow,
              and Input Validation exploits — giving you a full security report.
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }}
            onClick={() => !uploading && inputRef.current?.click()}
            style={{
              borderRadius: 16, border: `2px dashed ${dragOver ? "#6366f1" : file ? "#22c55e" : "#d1d5db"}`,
              background: dragOver ? "#eef2ff" : file ? "#f0fdf4" : "#fff",
              padding: "40px 32px", cursor: uploading ? "default" : "pointer",
              transition: "all .2s", textAlign: "center", marginBottom: 0,
            }}
          >
            <input ref={inputRef} type="file" accept=".sol" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />

            {uploading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 32, animation: "spin 1.5s linear infinite" }}>⚙️</div>
                <div style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                    <span>{statusMsg}</span>
                    <span style={{ fontWeight: 700 }}>{Math.round(uploadPct)}%</span>
                  </div>
                  <div style={{ height: 8, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${uploadPct}%`, background: "linear-gradient(90deg,#6366f1,#8b5cf6)", borderRadius: 99, transition: "width .3s" }} />
                  </div>
                  <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>Hardhat is running all attack scripts — this may take 30–60 seconds…</p>
                </div>
              </div>
            ) : file ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>✅</div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, color: "#111827", fontSize: 14 }}>{file.name}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>{(file.size / 1024).toFixed(1)} KB · Solidity contract</p>
                </div>
                <button onClick={e => { e.stopPropagation(); setFile(null); }} style={{ background: "none", border: "none", fontSize: 12, color: "#9ca3af", cursor: "pointer", textDecoration: "underline" }}>
                  Remove file
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>📄</div>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, color: "#374151", fontSize: 14 }}>Drop your .sol file here</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>or click to browse</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["Reentrancy", "Overflow", "Input Validation"].map(t => (
                    <span key={t} style={{ fontSize: 10, padding: "2px 10px", background: "#f3f4f6", color: "#6b7280", borderRadius: 20 }}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ marginTop: 14, padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, display: "flex", gap: 8 }}>
              <span style={{ color: "#ef4444" }}>⚠️</span>
              <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* Network hint */}
          <div style={{ marginTop: 14, padding: "10px 16px", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#6366f1" }}>🔗</span>
            <p style={{ margin: 0, fontSize: 12, color: "#4338ca" }}>
              Running on <strong>{activeNet}</strong> — change network in the top bar before uploading
            </p>
          </div>

          {/* CTA */}
          <button onClick={startAttack} disabled={!file || uploading} style={{ marginTop: 20, width: "100%", padding: "15px 0", borderRadius: 14, fontSize: 14, fontWeight: 700, border: "none", cursor: !file || uploading ? "not-allowed" : "pointer", background: !file || uploading ? "#e5e7eb" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: !file || uploading ? "#9ca3af" : "#fff", boxShadow: file && !uploading ? "0 4px 18px rgba(99,102,241,.35)" : "none", transition: "all .2s" }}>
            {uploading ? "Running attacks…" : "🚀 Start Attack Simulation"}
          </button>

          {/* Attack type mini-cards */}
          <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { icon: "🔄", name: "Reentrancy",      desc: "Recursive drain" },
              { icon: "📥", name: "Input Validation", desc: "Auth bypass" },
              { icon: "💥", name: "Overflow",         desc: "Arithmetic wrap" },
            ].map(a => (
              <div key={a.name} style={{ ...cardBase, padding: "14px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{a.icon}</div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#374151" }}>{a.name}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        button { font-family: inherit; }
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ── DASHBOARD  (exact inline-style layout from doc 3, fed live data) ──
// ══════════════════════════════════════════════════════════════════════
function Dashboard({
  uploadData,
  activeNet,
  setActiveNet,
  onReset,
}: {
  uploadData: UploadResponse;
  activeNet: string;
  setActiveNet: (n: string) => void;
  onReset: () => void;
}) {
  // Best simulation: first with success/patternDetected, else first
 const SIM: SimResult =
    uploadData.simulations.find(s => s.attack?.success) ??
    uploadData.simulations.find(s => s.attack?.patternDetected) ??
    uploadData.simulations[0];

  if (!SIM) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>🛡️</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>No vulnerabilities detected</p>
          <p style={{ color: "#9ca3af", marginBottom: 20 }}>Your contract passed all attack simulations.</p>
          <button onClick={onReset} style={{ padding: "10px 24px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← Test Another Contract</button>
        </div>
      </div>
    );
  }

  const initialBal = parseFloat(SIM.contract.initialBalance);

  // Build drain points from real backend transactions
  const drainPoints = [
    { t: "0ms", v: initialBal },
    ...SIM.transactions.map(tx => ({
      t: `${tx.timestampMs - SIM.simulation.startTime}ms`,
      v: parseFloat(tx.balanceAfter.victim),
    })),
  ];

  // Build attack vector scores from all simulations
  const vScore: Record<string, number> = {};
  uploadData.simulations.forEach(s => {
    const t = (s.attack?.type ?? "").toLowerCase().replace(/\s+/g, "");
    const hit = s.attack?.success || s.attack?.patternDetected;
    const sc = hit ? Math.max(100 - (s.metrics?.securityScore ?? 0), 30) : 0;  // was 8
    if (t.includes("reentr"))  vScore["Reentrancy"]    = sc;
    if (t.includes("overflow")) vScore["Overflow"]     = sc;
    if (t.includes("input"))   vScore["Input Valid."] = sc;
    if (t.includes("flash"))   vScore["Flash Loan"]   = sc;
    if (t.includes("access"))  vScore["Access Ctrl"]  = sc;
  });
  const attackVectors = [
    { name: "Reentrancy",   score: vScore["Reentrancy"]   ?? 0, color: "#ef4444" },
    { name: "Overflow",     score: vScore["Overflow"]     ?? 0, color: "#f97316" },
    { name: "Input Valid.", score: vScore["Input Valid."] ?? 0, color: "#eab308" },
    { name: "Flash Loan",   score: vScore["Flash Loan"]  ?? 0, color: "#6366f1" },
    { name: "Access Ctrl",  score: vScore["Access Ctrl"] ?? 0, color: "#22c55e" },
  ];

  // Animation
  const [phase, setPhase]     = useState<"running" | "done">("running");
  const [progress, setProg]   = useState(0);
  const [elapsedMs, setElap]  = useState(0);
  const [txIdx, setTxIdx]     = useState(-1);
  const [balance, setBalance] = useState(initialBal);
  const [score, setScore]     = useState(100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0       = useRef(Date.now());

  useEffect(() => {
    t0.current = Date.now();
    timerRef.current = setInterval(() => {
      const e     = Date.now() - t0.current;
      const total = SIM.simulation.durationMs;
      const pct   = Math.min(100, (e / total) * 100);
      setProg(pct); setElap(e);
      setScore(Math.max(SIM.metrics.securityScore, Math.round(100 - (88 * pct) / 100)));
      const idx = Math.min(SIM.transactions.length - 1, Math.floor((e / total) * SIM.transactions.length) - 1);
      if (idx >= 0) { setTxIdx(idx); setBalance(parseFloat(SIM.transactions[idx].balanceAfter.victim)); }
      if (e >= total) {
        clearInterval(timerRef.current!);
        setProg(100); setTxIdx(SIM.transactions.length - 1);
        setBalance(parseFloat(SIM.contract.finalBalance));
        setScore(SIM.metrics.securityScore); setPhase("done");
      }
    }, 40);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const isDraining = balance < initialBal;
  const stolen     = Math.max(0, initialBal - balance).toFixed(2);
  const balColor   = balance <= 0 ? "#ef4444" : balance < initialBal * 0.5 ? "#f97316" : "#16a34a";
  const elapsed    = Math.min(elapsedMs, SIM.simulation.durationMs);
  const curTx      = txIdx >= 0 ? SIM.transactions[txIdx] : null;
  const scoreColor = score < 30 ? "#ef4444" : score < 60 ? "#f97316" : "#16a34a";

  const card = (extra?: object): React.CSSProperties => ({
    background: "#fff", borderRadius: 15,
    boxShadow: "0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)",
    padding: "22px 24px", border: "1px solid #f1f5f9",
    ...extra,
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <header style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", top: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>⚔️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", lineHeight: 1 }}>Secure.sol</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>{SIM.contract.name} · {uploadData.fileName}</div>
          </div>
        </div>
        {/* <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", marginRight: 4 }}>Network</span>
          {NETWORKS.map(n => (
            <button key={n} onClick={() => setActiveNet(n)} style={{ padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: activeNet === n ? "1.5px solid #6366f1" : "1.5px solid #e5e7eb", background: activeNet === n ? "#eef2ff" : "#fff", color: activeNet === n ? "#6366f1" : "#6b7280", fontWeight: activeNet === n ? 600 : 400, transition: "all .15s" }}>{n}</button>
          ))}
        </div> */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ padding: "6px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Contract Balance</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: balColor, fontVariantNumeric: "tabular-nums", transition: "color .3s" }}>{balance.toFixed(4)} ETH</div>
          </div>
          <div style={{ padding: "6px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Elapsed</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", fontVariantNumeric: "tabular-nums" }}>{(elapsed / 1000).toFixed(2)}s</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: phase === "running" ? "#fef3c7" : "#ecfdf5", color: phase === "running" ? "#92400e" : "#065f46" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: phase === "running" ? "#f59e0b" : "#10b981", animation: phase === "running" ? "pulse 1s ease-in-out infinite" : "none" }} />
            {phase === "running" ? "Simulating" : "Complete"}
          </div>
          <button onClick={onReset} style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", transition: "all .2s" }}>
            ← New Contract
          </button>
        </div>
      </header>

      <main style={{ padding: "28px 32px 110px", maxWidth: 1400, margin: "0 auto" }}>

        {/* ── Stat Cards ──────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24, maxWidth: "80%" }}>
          {[
            { label: "Security Score", value: score,                                                   suffix: "/100", color: scoreColor, tagColor: "#fef2f2", tagText: "#ef4444", tagVal: SIM.metrics.severity },
            { label: "Stolen Amount",  value: phase === "done" ? SIM.attack.stolenAmount : stolen,     suffix: ` ${SIM.contract.unit}`, color: "#ef4444", tagColor: "#fef2f2", tagText: "#ef4444", tagVal: "−100%" },
            { label: "Drain Rate",     value: `$${SIM.metrics.vulnerabilityRate.usdPerMs.toFixed(2)}`, suffix: "/ms",  color: "#374151", tagColor: "#fef2f2", tagText: "#f97316", tagVal: "Fast" },
            { label: "Duration",       value: (SIM.simulation.durationMs / 1000).toFixed(2),           suffix: " sec", color: "#374151", tagColor: "#f0fdf4", tagText: "#16a34a", tagVal: "Completed" },
          ].map((s, i) => (
            <div key={i} style={{ ...card(), display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "24px 26px" }}>
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {s.value}<span style={{ fontSize: 14, fontWeight: 500, color: "#9ca3af" }}>{s.suffix}</span>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: s.tagColor, color: s.tagText }}>{s.tagVal}</span>
            </div>
          ))}
        </div>

        {/* ── Main Grid ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 272px", gap: 20 }}>

          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Balance Drain Timeline */}
            <div style={card()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Balance Drain Timeline</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>Contract balance vs attacker gain over {SIM.simulation.durationMs}ms</div>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 24, height: 2, background: "#ef4444", display: "inline-block", borderRadius: 2 }} />
                    <span style={{ color: "#6b7280" }}>Victim</span>
                  </span>
                </div>
              </div>
              <div style={{ height: 160 }}><DrainChart drainPoints={drainPoints} progress={progress} /></div>
            </div>

            {/* Attack Severity + Donut */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={card()}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Attack Severity</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Vulnerability score by vector</div>
                <AttackBars vectors={attackVectors} />
              </div>
              <div style={card()}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Vulnerability Distribution</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>By severity classification</div>
                <DonutChart />
              </div>
            </div>

            {/* Transaction Log */}
            <div style={card()}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Transaction Log</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Real-time attack steps</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                    {["Step", "Description", "Victim ETH", "Attacker ETH", "Status"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "0 12px 10px 0", color: "#9ca3af", fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SIM.transactions.map((tx, i) => {
                    const active  = phase === "done" || (phase === "running" && i <= txIdx);
                    const current = phase === "running" && i === txIdx;
                    return (
                      <tr key={tx.step} style={{ borderBottom: "1px solid #f8fafc", background: current ? "#fef9f0" : "transparent", opacity: active ? 1 : 0.35, transition: "opacity .4s,background .3s" }}>
                        <td style={{ padding: "10px 12px 10px 0" }}>
                          <span style={{ width: 25, height: 25, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: active ? (current ? "#f97316" : "#6366f1") : "#f3f4f6", color: active ? "#fff" : "#9ca3af" }}>{tx.step}</span>
                        </td>
                        <td style={{ padding: "10px 12px 10px 0", color: "#374151" }}>{tx.description}</td>
                        <td style={{ padding: "10px 12px 10px 0", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: parseFloat(tx.balanceAfter.victim) < initialBal ? "#ef4444" : "#374151" }}>{tx.balanceAfter.victim} ETH</td>
                        <td style={{ padding: "10px 12px 10px 0", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#16a34a" }}>{tx.balanceAfter.attacker} ETH</td>
                        <td style={{ padding: "10px 0" }}>
                          {active
                            ? <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "#ecfdf5", color: "#065f46", fontWeight: 600 }}>✓ Done</span>
                            : <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "#f3f4f6", color: "#9ca3af" }}>Pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* All simulations summary (shown when multiple attacks ran) */}
            {uploadData.simulations.length > 1 && (
              <div style={card()}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>All Attack Results</div>
                  <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 12, background: "#eef2ff", color: "#6366f1", fontWeight: 600 }}>
                    {uploadData.vulnerabilitiesFound.length} vulnerabilities detected
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {uploadData.simulations.map((sim, i) => {
                    const vuln = sim.attack?.success || sim.attack?.patternDetected;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: vuln ? "#fef2f2" : "#f0fdf4", border: `1px solid ${vuln ? "#fecaca" : "#bbf7d0"}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontSize: 16 }}>{vuln ? "🔴" : "🟢"}</span>
                          <div>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#111827" }}>{sim.attack?.type ?? "Unknown"}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{sim.report?.affectedFunction ?? "—"}</p>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: vuln ? "#ef4444" : "#16a34a" }}>{vuln ? "VULNERABLE" : "SAFE"}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>Score: {sim.metrics?.securityScore ?? "—"}/100</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Vulnerability Report */}
            <div style={card()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Vulnerability Report</div>
                <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 12, background: "#fef2f2", color: "#ef4444", fontWeight: 600, border: "1px solid #fecaca" }}>
                  🔴 {SIM.report.severity}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{SIM.report.affectedFunction}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ background: "#fef2f2", border: "1px solid #fee2e2", borderRadius: 11, padding: "15px 17px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>⚠️ What Went Wrong</div>
                  <p style={{ margin: 0, fontSize: 13, color: "#7f1d1d", lineHeight: 1.65 }}>{SIM.report.explanation}</p>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 11, padding: "15px 17px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>✅ How to Fix</div>
                  <p style={{ margin: 0, fontSize: 13, color: "#14532d", lineHeight: 1.65 }}>{SIM.report.fix}</p>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Score Card */}
            <div style={{ ...card({ textAlign: "center" as const }), padding: "24px 22px" }}>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>Security Score</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                <ScoreRing score={score} color={scoreColor} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor, marginBottom: 6 }}>
                {score < 30 ? "🔴 Critical Risk" : score < 60 ? "🟠 High Risk" : "🟢 Secure"}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>
                {score < 30 ? "Severe vulnerabilities detected. Immediate action required." : "Contract appears safe."}
              </div>
            </div>

            {/* Active Attack */}
            <div style={{ ...card(), padding: "22px 20px", border: phase === "running" ? "1.5px solid #fde68a" : "1.5px solid #fecaca", background: phase === "running" ? "#fffbeb" : "#fef2f2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 17 }}>{phase === "running" ? "🔥" : "💀"}</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: phase === "running" ? "#92400e" : "#991b1b" }}>
                  {phase === "running" ? "Attack In Progress" : "Attack Complete"}
                </div>
              </div>
              {[
                { label: "Attack Type", val: SIM.attack.type,            mono: false },
                { label: "Target",      val: SIM.attack.targetFunction,  mono: true  },
                { label: "Severity",    val: SIM.metrics.severity,       mono: false },
                { label: "Progress",    val: `${Math.round(progress)}%`, mono: true  },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: row.label === "Severity" ? "#ef4444" : "#374151", fontFamily: row.mono ? "monospace" : "inherit" }}>{row.val}</span>
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
                  <div style={{ fontSize: r.big ? 22 : 14, fontWeight: r.big ? 800 : 600, color: isDraining ? "#ef4444" : "#374151", fontVariantNumeric: "tabular-nums", transition: "color .3s" }}>{r.val}</div>
                </div>
              ))}
              <div style={{ marginTop: 4, padding: "11px 13px", borderRadius: 9, background: isDraining ? "#fef2f2" : "#f8fafc", border: `1px solid ${isDraining ? "#fecaca" : "#e5e7eb"}`, transition: "all .4s" }}>
                <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>Total Stolen</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: isDraining ? "#ef4444" : "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                  {phase === "done" ? SIM.attack.stolenAmount : stolen} ETH
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div style={{ ...card(), padding: "22px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Attack Timeline</div>
              {SIM.timeline.map((evt, i) => {
                const done = phase === "done" || (phase === "running" && i < Math.floor((progress / 100) * SIM.timeline.length));
                return (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 3, background: done ? "#6366f1" : "#e5e7eb", boxShadow: done ? "0 0 0 3px #eef2ff" : "none", transition: "all .3s" }} />
                      {i < SIM.timeline.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: done ? "#c7d2fe" : "#e5e7eb", minHeight: 14, transition: "background .3s" }} />
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: done ? "#374151" : "#9ca3af", paddingBottom: 8, transition: "color .3s", lineHeight: 1.4 }}>{evt}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* ── Floating Progress Bar ─────────────────────────────── */}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", width: 480, zIndex: 100, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(14px)", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,.10),0 1px 4px rgba(0,0,0,.06)", border: "1px solid #e5e7eb", padding: "12px 18px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Attack Progress</span>
            <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, fontWeight: 600, background: phase === "done" ? "#ecfdf5" : "#fef3c7", color: phase === "done" ? "#065f46" : "#92400e" }}>
              {phase === "done" ? "✓ Complete" : `Step ${txIdx + 1} of ${SIM.transactions.length}`}
            </span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: progress >= 100 ? "#16a34a" : "#374151", fontVariantNumeric: "tabular-nums" }}>{progress.toFixed(1)}%</span>
        </div>
        <div style={{ height: 22, background: "#f3f4f6", borderRadius: 99, overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, width: `${progress}%`, background: progress >= 100 ? "linear-gradient(90deg,#16a34a,#22c55e)" : "linear-gradient(90deg,#6366f1,#ef4444)", transition: "width .1s linear", borderRadius: 99, overflow: "hidden" }}>
            {phase === "running" && (
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent)", animation: "shimmer 1.2s linear infinite" }} />
            )}
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: progress > 45 ? "#fff" : "#6b7280", transition: "color .3s", pointerEvents: "none", whiteSpace: "nowrap" }}>
            {curTx && phase === "running"
              ? `${curTx.description.slice(0, 42)}${curTx.description.length > 42 ? "…" : ""}`
              : phase === "done" ? "✓ Attack simulation complete" : "Initialising…"}
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

// ══════════════════════════════════════════════════════════════════════
// ── ROOT CONTROLLER ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
export default function Page() {
  const [screen, setScreen]         = useState<"upload" | "dashboard">("upload");
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [activeNet, setActiveNet]   = useState("Hardhat");

  if (screen === "dashboard" && uploadData) {
    return (
      <Dashboard
        uploadData={uploadData}
        activeNet={activeNet}
        setActiveNet={setActiveNet}
        onReset={() => { setUploadData(null); setScreen("upload"); }}
      />
    );
  }

  return (
    <UploadScreen
      activeNet={activeNet}
      setActiveNet={setActiveNet}
      onResult={data => { setUploadData(data); setScreen("dashboard"); }}
    />
  );
}