import fs from "fs";

export type FunctionInfo = {
  name: string;
  paramTypes: string[]; // e.g. ["uint256"] or []
  isPayable: boolean;
};

export type ReentrancyAnalysis = {
  found: boolean;
  vulnerableFunction: FunctionInfo | null;
  depositFunction: FunctionInfo | null;
  reason: string;
};

/**
 * Reads a Solidity source file and detects reentrancy vulnerability by checking:
 *   1. Any function that does an external ETH call (.call{value:)
 *   2. AND has a state update on msg.sender's balance AFTER that call
 *
 * Also detects a deposit function (payable + credits msg.sender).
 */
export function analyzeReentrancy(sourcePath: string): ReentrancyAnalysis {
  const raw = fs.readFileSync(sourcePath, "utf-8");
  const src = stripComments(raw);
  const functions = parseFunctions(src);

  let vulnerableFunction: FunctionInfo | null = null;
  let depositFunction: FunctionInfo | null = null;

  for (const fn of functions) {
    // --- Deposit detection ---
    // Payable function that assigns msg.value to msg.sender's entry in a mapping
    if (fn.isPayable && /\[\s*msg\.sender\s*\]\s*\+?=\s*msg\.value/.test(fn.body)) {
      depositFunction = { name: fn.name, paramTypes: fn.paramTypes, isPayable: true };
    }

    // --- Reentrancy detection ---
    // Find the position of the external ETH call
    const callIdx = fn.body.search(/\.call\s*\{[^}]*value\s*:/);
    if (callIdx !== -1) {
      // Find where the call statement ends (first ; after the call)
      const semiIdx = fn.body.indexOf(";", callIdx);
      if (semiIdx !== -1) {
        const afterCall = fn.body.slice(semiIdx + 1);
        // Check if a mapping keyed on msg.sender is updated after the call
        // Matches patterns like: balances[msg.sender] -= / balances[msg.sender] = 0
        if (/\[\s*msg\.sender\s*\]\s*[-+]?=/.test(afterCall)) {
          vulnerableFunction = {
            name: fn.name,
            paramTypes: fn.paramTypes,
            isPayable: fn.isPayable,
          };
        }
      }
    }
  }

  if (vulnerableFunction && depositFunction) {
    return {
      found: true,
      vulnerableFunction,
      depositFunction,
      reason: `Reentrancy: ${vulnerableFunction.name}() sends ETH before updating balances[msg.sender]`,
    };
  }

  if (vulnerableFunction && !depositFunction) {
    return {
      found: false,
      vulnerableFunction,
      depositFunction: null,
      reason: `External ETH call before state update found in ${vulnerableFunction.name}() but no deposit function detected`,
    };
  }

  return {
    found: false,
    vulnerableFunction: null,
    depositFunction,
    reason: "No reentrancy pattern found (no function sends ETH before updating caller state)",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ") // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, " "); // multi-line comments
}

type ParsedFn = {
  name: string;
  paramTypes: string[];
  isPayable: boolean;
  body: string;
};

function parseFunctions(src: string): ParsedFn[] {
  const results: ParsedFn[] = [];
  // Match: function <name>(<params>) <modifiers> {
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
    // "uint256 _amount" → "uint256", "address payable recipient" → "address"
    const parts = p.trim().split(/\s+/);
    return parts[0];
  });
}
