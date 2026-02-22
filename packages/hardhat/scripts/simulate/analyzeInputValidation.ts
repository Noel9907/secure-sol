import fs from "fs";

export type InputValidationAnalysis = {
  found: boolean;
  withdrawFn: { name: string; paramTypes: string[] } | null;
  depositFn: { name: string; paramTypes: string[]; isPayable: boolean } | null;
  reason: string;
};

/**
 * Static analysis: finds functions that subtract from a balance mapping
 * keyed by msg.sender WITHOUT a prior require guard.
 * Skips functions that also do external ETH calls (those are reentrancy targets).
 */
export function analyzeInputValidation(sourcePath: string): InputValidationAnalysis {
  const raw = fs.readFileSync(sourcePath, "utf-8");
  const src = stripComments(raw);
  const functions = parseFunctions(src);

  let depositFn: { name: string; paramTypes: string[]; isPayable: boolean } | null = null;
  let withdrawFn: { name: string; paramTypes: string[] } | null = null;

  for (const fn of functions) {
    // Detect deposit function (payable + credits msg.sender)
    if (fn.isPayable && /\[\s*msg\.sender\s*\]\s*\+?=\s*msg\.value/.test(fn.body)) {
      depositFn = { name: fn.name, paramTypes: fn.paramTypes, isPayable: true };
    }

    // Detect functions that subtract from mapping[msg.sender]
    if (!/\[\s*msg\.sender\s*\]\s*-=/.test(fn.body)) continue;

    // Check for a require guard before the subtraction
    const subtractIdx = fn.body.search(/\[\s*msg\.sender\s*\]\s*-=/);
    const beforeSubtract = fn.body.slice(0, subtractIdx);
    const hasGuard = /require\s*\([^)]*\[\s*msg\.sender\s*\]\s*>=/.test(beforeSubtract);

    // Skip functions with external ETH calls (those are reentrancy targets, not input validation)
    const hasExternalCall = /\.call\s*\{[^}]*value\s*:/.test(fn.body);

    // Skip functions inside unchecked blocks (those are overflow targets)
    const isUnchecked = /unchecked\s*\{[^}]*\[\s*msg\.sender\s*\]\s*-=/.test(fn.body);

    if (!hasGuard && !hasExternalCall && !isUnchecked) {
      withdrawFn = { name: fn.name, paramTypes: fn.paramTypes };
    }
  }

  if (withdrawFn && depositFn) {
    return {
      found: true,
      withdrawFn,
      depositFn,
      reason: `${withdrawFn.name}() subtracts from balances[msg.sender] without require guard`,
    };
  }

  return {
    found: false,
    withdrawFn: null,
    depositFn: null,
    reason: withdrawFn
      ? "Missing guard found but no deposit function detected"
      : "All balance-subtracting functions have proper guards",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

type ParsedFn = {
  name: string;
  paramTypes: string[];
  isPayable: boolean;
  body: string;
};

function parseFunctions(src: string): ParsedFn[] {
  const results: ParsedFn[] = [];
  const headerRegex = /function\s+(\w+)\s*\(([^)]*)\)([^{]*)/g;
  let m: RegExpExecArray | null;

  while ((m = headerRegex.exec(src)) !== null) {
    const name = m[1];
    const paramsRaw = m[2];
    const modifiers = m[3];
    const isPayable = /\bpayable\b/.test(modifiers);

    const openBrace = src.indexOf("{", m.index + m[0].length);
    if (openBrace === -1) continue;

    const body = extractBraceBlock(src, openBrace);
    const paramTypes = parseParamTypes(paramsRaw);

    results.push({ name, paramTypes, isPayable, body });
  }

  return results;
}

function extractBraceBlock(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

function parseParamTypes(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map(p => {
    const parts = p.trim().split(/\s+/);
    return parts[0];
  });
}
