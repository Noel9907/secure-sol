// packages/nextjs/utils/customChains.ts
import { defineChain } from "viem";

export const flowEVMTestnet = defineChain({
  id: 545, // Flow EVM Testnet Chain ID
  name: "Flow EVM Testnet",
  network: "flow-evm-testnet",
  nativeCurrency: {
    name: "Flow",
    symbol: "FLOW",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://testnet.evm.nodes.onflow.org"], // Flow EVM testnet RPC
    },
    public: {
      http: ["https://testnet.evm.nodes.onflow.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Flow EVM Testnet Explorer",
      url: "https://evm-testnet.flowscan.io",
    },
  },
  testnet: true,
  contracts: {
    multicall3: {
      // standard multicall contract deployed to Flow EVM testnet
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 11,
    },
  },
});
