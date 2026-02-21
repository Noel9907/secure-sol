import { parseEther } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { SeedFn } from "./analysisTypes";

const SEED_PER_ACCOUNT = parseEther("5");   // 5 ETH each
const SEED_ACCOUNTS    = 3;                  // signers[2..4] — total 15 ETH pooled

/**
 * Seed the victim contract with ETH from multiple "innocent user" accounts
 * so attacks demonstrate real financial impact (stealing pooled funds, not
 * just the attacker's own deposit).
 *
 * @param victim   - deployed victim contract (any)
 * @param signers  - full signer list from hre.ethers.getSigners()
 * @param seedFn   - AI-identified deposit function, or null to try direct send
 * @returns total ETH successfully seeded (bigint, wei)
 */
export async function seedVault(
  victim: any,
  signers: HardhatEthersSigner[],
  seedFn: SeedFn | null,
): Promise<bigint> {
  let totalSeeded = 0n;

  for (let i = 0; i < SEED_ACCOUNTS; i++) {
    const signer = signers[2 + i];   // skip deployer (0) and attacker (1)
    if (!signer) break;

    try {
      if (seedFn) {
        const iface = victim.interface;
        const fnAbi = iface.getFunction(seedFn.name);
        // If the function takes a uint256 amount param, pass the seed value as that arg too
        const hasAmountParam = fnAbi?.inputs.length > 0 && fnAbi.inputs[0].type === "uint256";
        if (hasAmountParam) {
          await victim.connect(signer)[seedFn.name](SEED_PER_ACCOUNT, { value: SEED_PER_ACCOUNT });
        } else {
          await victim.connect(signer)[seedFn.name]({ value: SEED_PER_ACCOUNT });
        }
      } else {
        // No deposit function — try direct ETH send (requires receive/fallback)
        await signer.sendTransaction({ to: await victim.getAddress(), value: SEED_PER_ACCOUNT });
      }
      totalSeeded += SEED_PER_ACCOUNT;
    } catch {
      // This signer couldn't seed — skip (contract may have restrictions)
    }
  }

  if (totalSeeded > 0n) {
    const { formatEther } = await import("ethers");
    console.log(`[seed] Pooled ${formatEther(totalSeeded)} ETH from ${SEED_ACCOUNTS} accounts via ${seedFn?.name ?? "direct send"}`);
  } else {
    console.warn("[seed] Could not seed vault — attack may show 0 impact");
  }

  return totalSeeded;
}
