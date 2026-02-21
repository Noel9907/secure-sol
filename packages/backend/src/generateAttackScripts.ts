import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const GENERATED_DIR_REL = "scripts/simulate/generated";
const MODEL = process.env.NEBIUS_MODEL ?? "deepseek-ai/DeepSeek-V3.2";
const BASE_URL = "https://api.tokenfactory.us-central1.nebius.com/v1/";
const TIMEOUT_MS = 90_000;

export type GeneratedScript = {
  vulnerabilityType: string;
  relPath: string; // relative to hardhat root — passed to `npx hardhat run`
  absPath: string;
};

export async function generateAttackScripts(
  sourcePath: string,
  contractName: string,
  fileName: string,
  hardhatDir: string,
): Promise<GeneratedScript[]> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("NEBIUS_API_KEY not set");

  const source = fs.readFileSync(sourcePath, "utf-8");
  const generatedDir = path.join(hardhatDir, GENERATED_DIR_REL);
  fs.mkdirSync(generatedDir, { recursive: true });

  const client = new OpenAI({ baseURL: BASE_URL, apiKey });

  console.log(`[generateAttackScripts] Calling ${MODEL} to generate attack scripts...`);

  const response = await Promise.race([
    client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(source, contractName, fileName) },
      ],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI script generation timed out after 90s")), TIMEOUT_MS),
    ),
  ]);

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: { scripts?: Array<{ vulnerabilityType: string; script: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const scripts = parsed.scripts ?? [];
  if (scripts.length === 0) throw new Error("AI returned no scripts");

  const id = crypto.randomBytes(4).toString("hex");
  const result: GeneratedScript[] = [];

  for (const { vulnerabilityType, script } of scripts) {
    const filename = `atk_${vulnerabilityType}_${id}.ts`;
    const absPath = path.join(generatedDir, filename);
    const relPath = `${GENERATED_DIR_REL}/${filename}`;
    fs.writeFileSync(absPath, script, "utf-8");
    result.push({ vulnerabilityType, relPath, absPath });
    console.log(`[generateAttackScripts] Written: ${relPath}`);
  }

  return result;
}

export function cleanupScripts(scripts: GeneratedScript[]) {
  for (const s of scripts) {
    try { fs.unlinkSync(s.absPath); } catch { /* ignore */ }
  }
}

// ─── Prompts ────────────────────────────────────────────────────────────────

function buildUserPrompt(source: string, contractName: string, fileName: string): string {
  return `CONTRACT NAME: ${contractName}
FILE NAME: ${fileName}

Generate attack scripts for this Solidity contract. Return JSON with a "scripts" array containing exactly 4 entries — one for each vulnerability type: reentrancy, inputvalidation, overflow, accesscontrol.

\`\`\`solidity
${source}
\`\`\``;
}

const SYSTEM_PROMPT = `You are a smart contract security researcher. Your job is to analyze a Solidity contract and generate 4 complete Hardhat TypeScript attack scripts — one per vulnerability type — that run directly on a local Hardhat network.

## OUTPUT FORMAT
Return a JSON object with exactly this shape:
{
  "scripts": [
    { "vulnerabilityType": "reentrancy",      "script": "<complete TypeScript code>" },
    { "vulnerabilityType": "inputvalidation",  "script": "<complete TypeScript code>" },
    { "vulnerabilityType": "overflow",         "script": "<complete TypeScript code>" },
    { "vulnerabilityType": "accesscontrol",    "script": "<complete TypeScript code>" }
  ]
}

## SCRIPT RULES
Every script MUST:
1. Start with these exact imports (no others needed):
\`\`\`typescript
import hre from "hardhat";
import { parseEther, formatEther, ZeroAddress } from "ethers";
import { buildResult } from "../buildResult";
\`\`\`

2. Read contract identity from env vars:
\`\`\`typescript
const contractName = process.env.UPLOADED_CONTRACT_NAME!;
const fileName = process.env.UPLOADED_FILE_NAME!;
const fullyQualified = \`contracts/uploaded/\${fileName}.sol:\${contractName}\`;
\`\`\`

3. End with EXACTLY this output line (no console.log, use process.stdout.write):
\`\`\`typescript
process.stdout.write("SIMULATION_RESULT:" + JSON.stringify(result) + "\\n");
\`\`\`

4. End with:
\`\`\`typescript
main().catch(e => { console.error(e); process.exit(1); });
\`\`\`

5. Use ethers v6 syntax ONLY:
   - parseEther("1") not ethers.utils.parseEther
   - formatEther(bigint) not ethers.utils.formatEther
   - getContractFactory, deploy, waitForDeployment, getAddress
   - provider.getBalance(address) returns bigint
   - getSigners() → [deployer, attacker, victim, ...] (up to 20 accounts available)

6. Use try/catch around ALL external calls — attacks may revert

7. Use buildResult() to build the result object. Its signature:
\`\`\`typescript
buildResult({
  contractName: string,
  contractAddress: string,
  attackType: string,           // "reentrancy" | "inputvalidation" | "overflow" | "accesscontrol"
  targetFunction: string,       // e.g. "withdraw(uint256)" or "N/A"
  severity: "Critical" | "High" | "Medium" | "Low",
  initialBalance: bigint,
  finalBalance: bigint,
  stolenAmount: bigint,
  startTime: number,            // Date.now() before attack
  endTime: number,              // Date.now() after attack
  patternDetected?: boolean,    // true if pattern confirmed even without ETH theft
  transactions: Array<{
    step: number,
    description: string,
    from: string,
    to: string,
    value: string,              // ETH amount as string e.g. "1.0"
    unit: "ETH",
    timestampMs: number,
    balanceAfter: { victim: string, attacker: string }
  }>,
  timeline: string[],           // human-readable steps
  report: {
    vulnerabilityType: string,
    affectedFunction: string,
    explanation: string,
    fix: string
  }
})
\`\`\`

## AVAILABLE ATTACK CONTRACTS
These are already in the Hardhat project and can be deployed with getContractFactory:

**FlexReentrancyAttacker(address target)**
- attack(bytes depositCalldata, bytes withdrawCalldata) payable
- reentryCount() → bigint  (how many times receive() re-entered)
- The attacker's receive() re-enters target up to 10 times
- Use when: reentrancy vulnerability

**InputValidationAttacker()** (no constructor args)
- attack(address victim, bytes calldata) external
- receive() payable
- Use when: missing balance checks (just calls the victim function directly)

**OverflowAttacker()** (no constructor args)
- attack(address victim, bytes triggerData, bytes extractData) external
- receive() payable
- Use when: unchecked arithmetic underflow/overflow

For **accesscontrol**: do NOT use an attacker contract — just call the restricted function directly from the attacker EOA signer.

## HOW TO ENCODE CALLDATA
\`\`\`typescript
const iface = victim.interface;                               // or VictimFactory.interface
const calldata = iface.encodeFunctionData("fnName", [arg1, arg2]);
\`\`\`

## VULNERABILITY PATTERNS

### REENTRANCY
- The vulnerable function sends ETH BEFORE updating state
- Setup: may require multi-step state setup before the attack
  - Simple vault pattern: call deposit() to seed funds, then attack withdraw()
  - Marketplace/escrow pattern:
    1. Attacker contract calls createListing(price) to become a seller
    2. A victim account calls buy(listingId, {value:price}) to fund the escrow
    3. Attacker calls withdrawPayout() which re-enters
  - For complex setups: use deployer + attacker signers creatively
- Always seed the contract with at least 1 ETH before attacking
- gasLimit: 5_000_000 for the attack tx (re-entrant calls underestimate gas)

### INPUT VALIDATION
- Missing require(balance[msg.sender] >= amount) before transfer
- Attack: call withdraw/claim with an amount larger than deposited
- Seed the contract with ETH first via the deposit function

### OVERFLOW/UNDERFLOW
- unchecked { balances[msg.sender] -= amount } where amount > balance wraps to uint256.max
- Attack: call tokenFunction(address(0), 1) to underflow from 0 → max tokens, then redeem
- Token function must take (address, uint256) for this attack to work

### ACCESS CONTROL
- Missing onlyOwner/require(msg.sender == owner) on a privileged function
- Attack: call the privileged function (drain, withdraw, setOwner, mint, etc.) from attacker EOA
- No attacker contract needed — just: await victim.connect(attacker).privilegedFunction(...)
- Common function names: drainFunds, withdraw, transferOwnership, mint, setPrice, pause

## WHEN VULNERABILITY IS NOT PRESENT
Still output a valid result with success:false, patternDetected:false:
\`\`\`typescript
const result = buildResult({
  contractName, contractAddress: victimAddress,
  attackType: "reentrancy",
  targetFunction: "N/A",
  severity: "Critical",
  initialBalance: 0n, finalBalance: 0n, stolenAmount: 0n,
  startTime, endTime: Date.now(),
  transactions: [],
  timeline: [\`\${contractName} deployed\`, "No reentrancy vulnerability detected"],
  report: {
    vulnerabilityType: "Reentrancy",
    affectedFunction: "N/A",
    explanation: "No reentrancy pattern found in this contract.",
    fix: "N/A"
  }
});
\`\`\`

## CRITICAL RULES
- ONLY use function names that exist in the contract source
- For reentrancy marketplace setup: use signers[2] as the buyer (deployer = signers[0], attacker = signers[1])
- Always await waitForDeployment() after deploy()
- Always use getAddress() to get the deployed address
- Do not import anything other than hre, ethers functions, and buildResult
- The scripts run sequentially, each with a clean chain state — don't assume previous scripts ran`;
