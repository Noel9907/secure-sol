// Shared type — mirrors ContractAnalysis from packages/backend/src/analyzeContract.ts
// Kept here so Hardhat scripts don't cross package boundaries.

export type EscrowSetupCall = {
  from: "attackerContract" | "buyer" | "deployer";
  fn: string;
  args: string[];
  value: string;
};

/** How to deposit ETH into the contract to simulate real user funds before attacking */
export type SeedFn = {
  name: string;
  paramTypes: string[];   // [] for deposit(), ["uint256"] for deposit(uint256 amount)
  isPayable: boolean;
};

export type ContractAnalysis = {
  /** Function that lets users deposit ETH — used to seed pooled funds before every attack */
  seedFn: SeedFn | null;
  reentrancy: {
    found: boolean;
    variant: "simple" | "escrow" | null;
    vulnerableFn: { name: string; paramTypes: string[] } | null;
    depositFn: { name: string; paramTypes: string[]; isPayable: boolean } | null;
    escrowSetup: EscrowSetupCall[] | null;
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
    restrictedFn: string | null;
    restrictedFnParamTypes: string[] | null;
    restrictedFnArgs: string[] | null;
    value: string | null;
    reason: string;
  };
};
