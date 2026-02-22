import fs from "fs";

export type AccessControlAnalysis = {
  found: boolean;
  restrictedFn: string | null;
  restrictedFnParamTypes: string[] | null;
  reason: string;
};

/**
 * Static analysis: finds functions that send ETH or drain the contract
 * without an owner/access-control check.
 */
export function analyzeAccessControl(sourcePath: string): AccessControlAnalysis {
  const raw = fs.readFileSync(sourcePath, "utf-8");
  const src = stripComments(raw);
  const functions = parseFunctions(src);

  for (const fn of functions) {
    if (["constructor", "receive", "fallback"].includes(fn.name)) continue;

    const sendsEth =
      /\.call\s*\{[^}]*value\s*:/.test(fn.body) ||
      /\.transfer\s*\(/.test(fn.body) ||
      /\.send\s*\(/.test(fn.body);

    if (!sendsEth) continue;

    // Check for access control patterns
    const hasOwnerCheck =
      /msg\.sender\s*==\s*owner/.test(fn.body) ||
      /owner\s*==\s*msg\.sender/.test(fn.body) ||
      /require\s*\([^)]*msg\.sender/.test(fn.body) ||
      /onlyOwner/.test(fn.modifiers);

    if (hasOwnerCheck) continue;

    // Standard user withdraw: checks balance mapping for msg.sender before sending
    const hasBalanceCheck =
      /\[\s*msg\.sender\s*\]/.test(fn.body) &&
      /require\s*\(/.test(fn.body);

    if (hasBalanceCheck) continue;

    return {
      found: true,
      restrictedFn: fn.name,
      restrictedFnParamTypes: fn.paramTypes,
      reason: `${fn.name}() sends ETH without owner/access check`,
    };
  }

  return {
    found: false,
    restrictedFn: null,
    restrictedFnParamTypes: null,
    reason: "No unguarded privileged function found",
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
  modifiers: string;
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

    results.push({ name, paramTypes, isPayable, modifiers, body });
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
