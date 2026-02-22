import OpenAI from "openai";
import fs from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContractAnalysis = {
  /** Payable function that deposits ETH for a user — used to seed pooled funds before every attack */
  seedFn: { name: string; paramTypes: string[]; isPayable: boolean } | null;
  reentrancy: {
    found: boolean;
    /**
     * "simple"  – attacker calls deposit() then attack withdraw().
     * "escrow"  – attacker contract must call a setup fn first (e.g. createListing)
     *             so its address gets credited in the mapping; a separate buyer then
     *             funds the escrow; attacker then calls the vulnerable withdraw.
     */
    variant: "simple" | "escrow" | null;
    vulnerableFn: { name: string; paramTypes: string[] } | null;
    // simple variant
    depositFn: { name: string; paramTypes: string[]; isPayable: boolean } | null;
    // escrow variant – ordered setup calls before the attack
    escrowSetup: Array<{
      /** Who makes this call */
      from: "attackerContract" | "buyer" | "deployer";
      fn: string;
      /** Args as strings. uint256 → wei string, address → "attacker" | "deployer" | "0x..." */
      args: string[];
      /** ETH value in wei as string, "0" if none */
      value: string;
    }> | null;
    reason: string;
  };
  inputvalidation: {
    found: boolean;
    withdrawFn: { name: string; paramTypes: string[] } | null;
    depositFn: { name: string; paramTypes: string[]; isPayable: boolean } | null;
    reason: string;
  };
  overflow: {
    found: boolean;
    tokenFn: string | null;
    tokenFnParamTypes: string[] | null;
    redeemFn: string | null;
    redeemFnParamTypes: string[] | null;
    reason: string;
  };
  accesscontrol: {
    found: boolean;
    /** The function that lacks proper access control */
    restrictedFn: string | null;
    restrictedFnParamTypes: string[] | null;
    /** Args to pass — use "attacker" as placeholder for attacker EOA address */
    restrictedFnArgs: string[] | null;
    /** ETH value in wei string if the function is payable, else "0" */
    value: string | null;
    reason: string;
  };
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_ANALYSIS: ContractAnalysis = {
  seedFn:          null,
  reentrancy:      { found: false, variant: null, vulnerableFn: null, depositFn: null, escrowSetup: null, reason: "AI unavailable" },
  inputvalidation: { found: false, withdrawFn: null, depositFn: null, reason: "AI unavailable" },
  overflow:        { found: false, tokenFn: null, tokenFnParamTypes: null, redeemFn: null, redeemFnParamTypes: null, reason: "AI unavailable" },
  accesscontrol:   { found: false, restrictedFn: null, restrictedFnParamTypes: null, restrictedFnArgs: null, value: null, reason: "AI unavailable" },
};

// ─── Main export ──────────────────────────────────────────────────────────────

const TIMEOUT_MS = 60_000;
const MODEL    = process.env.NEBIUS_MODEL    ?? "deepseek-ai/DeepSeek-V3.2";
const BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.us-central1.nebius.com/v1/";

export async function analyzeContract(sourcePath: string): Promise<ContractAnalysis> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) {
    console.warn("[analyzeContract] NEBIUS_API_KEY not set — using fallback detection");
    return DEFAULT_ANALYSIS;
  }

  let source: string;
  try { source = fs.readFileSync(sourcePath, "utf-8"); }
  catch (e: any) { console.warn("[analyzeContract] Cannot read source:", e.message); return DEFAULT_ANALYSIS; }

  try {
    const client = new OpenAI({ baseURL: BASE_URL, apiKey });
    console.log(`[analyzeContract] Calling ${MODEL}...`);

    const result = await Promise.race([
      client.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: [{ type: "text", text: "Analyze this contract:\n\n```solidity\n" + source + "\n```" }] },
        ],
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
    ]);

    const parsed = JSON.parse(result.choices[0]?.message?.content ?? "{}") as ContractAnalysis;
    console.log("[analyzeContract] Done:", JSON.stringify({
      reentrancy: `${parsed.reentrancy?.found} (${parsed.reentrancy?.variant})`,
      inputvalidation: parsed.inputvalidation?.found,
      overflow: parsed.overflow?.found,
      accesscontrol: parsed.accesscontrol?.found,
    }));
    return parsed;
  } catch (e: any) {
    console.warn("[analyzeContract] Failed:", e.message, "— using fallback");
    return DEFAULT_ANALYSIS;
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Solidity security auditor. Analyze the contract and return JSON matching this schema exactly (no markdown, no extra keys):

{
  "seedFn": { "name": string, "paramTypes": string[], "isPayable": true } | null,
  "reentrancy": {
    "found": boolean,
    "variant": "simple" | "escrow" | null,
    "vulnerableFn": { "name": string, "paramTypes": string[] } | null,
    "depositFn": { "name": string, "paramTypes": string[], "isPayable": boolean } | null,
    "escrowSetup": [ { "from": "attackerContract"|"buyer"|"deployer", "fn": string, "args": string[], "value": string } ] | null,
    "reason": string
  },
  "inputvalidation": {
    "found": boolean,
    "withdrawFn": { "name": string, "paramTypes": string[] } | null,
    "depositFn": { "name": string, "paramTypes": string[], "isPayable": boolean } | null,
    "reason": string
  },
  "overflow": {
    "found": boolean,
    "tokenFn": string | null,
    "tokenFnParamTypes": string[] | null,
    "redeemFn": string | null,
    "redeemFnParamTypes": string[] | null,
    "reason": string
  },
  "accesscontrol": {
    "found": boolean,
    "restrictedFn": string | null,
    "restrictedFnParamTypes": string[] | null,
    "restrictedFnArgs": string[] | null,
    "value": string | null,
    "reason": string
  }
}

SEEDING (seedFn):
- Identify the payable function that lets a user deposit ETH into the contract (deposit, stake, fund, addLiquidity, contribute, buy, etc.).
- This is used to pre-seed the vault with pooled funds from multiple accounts before running attacks, so the attacker steals real money.
- paramTypes = [] for deposit(), ["uint256"] for deposit(uint256 amount), etc.
- If no such function exists (e.g. contract is funded only via constructor), set seedFn to null.

RULES:
- Only use function names that exist VERBATIM in the source.
- Canonical Solidity types: "uint256" not "uint", "address", "bool".
- paramTypes = type only, not name: "uint256 amount" → "uint256".
- All wei values as decimal strings: 1 ETH = "1000000000000000000".
- Use "attacker" as a placeholder in args where the attacker EOA address is needed.

REENTRANCY — "simple" variant:
- vulnerableFn: sends ETH via .call{value:} BEFORE updating msg.sender's mapping entry.
- depositFn: payable function that credits msg.sender DIRECTLY (balances[msg.sender] += msg.value). NOT a function that credits a third party.
- found: true only if BOTH exist.

REENTRANCY — "escrow" variant (marketplace/escrow pattern):
- The ETH is credited to a mapping keyed by seller/owner address (NOT msg.sender of the buy call).
- vulnerableFn: sends ETH before zeroing the seller's pending balance.
- escrowSetup: ordered list of calls needed so the attacker contract ends up with a positive balance.
  Example for marketplace: [
    { "from": "attackerContract", "fn": "createListing", "args": ["1000000000000000000"], "value": "0" },
    { "from": "buyer", "fn": "buy", "args": ["0"], "value": "1000000000000000000" }
  ]
  - "attackerContract" = attacker contract calls this (it becomes the credited seller)
  - "buyer" = a victim/buyer EOA calls this (funds the escrow)
  - "deployer" = deployer EOA calls this
- depositFn: null for escrow variant (no simple deposit function).
- found: true if vulnerableFn + escrowSetup both exist.

INPUT VALIDATION:
- withdrawFn: a function that subtracts from balances[msg.sender] (or equivalent mapping keyed by msg.sender) WITHOUT a prior require(balances[msg.sender] >= amount) guard. This covers:
  * Single-param: withdraw(uint256) — paramTypes: ["uint256"]
  * Two-param: transferBalance(address, uint256) — paramTypes: ["address","uint256"] where the second param is the unchecked amount
  * Any similar function regardless of name where the guard is absent.
- IMPORTANT: Do NOT pick the same function as reentrancy.vulnerableFn if a different function is the actual input-validation target. Look specifically for the missing-balance-check pattern, not re-entry.
- depositFn: payable function that records msg.sender's deposit.
- found: true if the balance check is genuinely absent (no require/if guard before the subtraction). Even if Solidity 0.8+ default arithmetic would revert at runtime, flag it — the missing guard is a real code-level vulnerability.

OVERFLOW/UNDERFLOW:
- tokenFn: any function that modifies a balance/reward/points mapping using unchecked arithmetic (inside "unchecked { }") such that subtracting more than the current balance wraps to uint256.max. Does NOT have to be named sendTokens or transfer — look for unchecked { mapping[x] -= amount } anywhere.
- tokenFnParamTypes: actual param types of tokenFn, e.g. ["address","uint256"] or ["uint256"].
- redeemFn: any function that converts an inflated balance/reward into ETH or tokens. Look for functions that pay out based on a balance mapping (redeem, withdraw, claimRewards, convertRewards, cashOut).
- found: true if ANY function uses unchecked subtraction on a balance mapping AND a payout function exists — regardless of function names.

ACCESS CONTROL:
- restrictedFn: privileged function (drain, mint, setOwner, withdraw all funds) with NO onlyOwner or msg.sender check.
- restrictedFnArgs: args to call it. Use "attacker" where attacker EOA address is needed, wei strings for ETH amounts.
- value: wei string if function is payable, else "0".
- found: only if a non-owner can call it and cause damage.`;
