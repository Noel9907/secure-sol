import fs from "fs";

export type OverflowAnalysis = {
  found: boolean;
  /** Function containing the unchecked subtraction */
  uncheckedFn: string | null;
  uncheckedFnParamTypes: string[] | null;
  /** Name of the mapping being underflowed (e.g. "rewardPoints") */
  mappingName: string | null;
  reason: string;
};

/**
 * Static analysis: finds functions with `unchecked { mapping[x] -= y }`
 * that allow integer underflow on a balance/points mapping.
 */
export function analyzeOverflow(sourcePath: string): OverflowAnalysis {
  const raw = fs.readFileSync(sourcePath, "utf-8");
  const src = stripComments(raw);
  const functions = parseFunctions(src);

  for (const fn of functions) {
    // Look for unchecked blocks within the function body
    const uncheckedRegex = /unchecked\s*\{([^}]*)\}/g;
    let um: RegExpExecArray | null;

    while ((um = uncheckedRegex.exec(fn.body)) !== null) {
      const uncheckedBody = um[1];

      // Look for subtraction on a mapping: mappingName[x] -= y
      const subMatch = uncheckedBody.match(/(\w+)\s*\[[^\]]*\]\s*-=/);
      if (subMatch) {
        return {
          found: true,
          uncheckedFn: fn.name,
          uncheckedFnParamTypes: fn.paramTypes,
          mappingName: subMatch[1],
          reason: `${fn.name}() has unchecked subtraction on ${subMatch[1]} mapping — underflow possible`,
        };
      }
    }
  }

  return {
    found: false,
    uncheckedFn: null,
    uncheckedFnParamTypes: null,
    mappingName: null,
    reason: "No unchecked arithmetic subtraction on mappings found",
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
