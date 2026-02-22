<div align="center">

```
 ███████╗███████╗ ██████╗██╗   ██╗██████╗ ███████╗   ███████╗ ██████╗ ██╗     
 ██╔════╝██╔════╝██╔════╝██║   ██║██╔══██╗██╔════╝   ██╔════╝██╔═══██╗██║     
 ███████╗█████╗  ██║     ██║   ██║██████╔╝█████╗     ███████╗██║   ██║██║     
 ╚════██║██╔══╝  ██║     ██║   ██║██╔══██╗██╔══╝     ╚════██║██║   ██║██║     
 ███████║███████╗╚██████╗╚██████╔╝██║  ██║███████╗   ███████║╚██████╔╝███████╗
 ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚══════╝ ╚═════╝ ╚══════╝
```

> **⚔️ Upload any Solidity contract. Fund the attacker. Watch the exploit. Fix your code.**

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.x-F0D060?style=for-the-badge&logo=ethereum&logoColor=black)](https://hardhat.org)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.x-363636?style=for-the-badge&logo=solidity)](https://soliditylang.org)
[![Flow EVM](https://img.shields.io/badge/Flow_EVM-Testnet-00EF8B?style=for-the-badge)](https://flow.com)
[![wagmi](https://img.shields.io/badge/wagmi-v2-7C3AED?style=for-the-badge)](https://wagmi.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)

<br/>

![status](https://img.shields.io/badge/status-active-22c55e?style=flat-square)
![hackathon](https://img.shields.io/badge/built_at-MakeATon_2025-6366f1?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-f97316?style=flat-square)

</div>

---

## 🧨 What is Secure.sol?

**Secure.sol** is a realtime contract attack simulator. It doesn't just scan your code with static analysis — it **deploys your contract to a live blockchain**, funds attacker contracts using your own wallet, and executes real exploits against them.

Upload a `.sol` file →  attacker contracts with real attacks with tokens locally → three classes of exploits fire against your deployed code → you get a full security report with drain timelines, live transaction logs, a security score, and exactly what code to add to fix each vulnerability.

```
  📄  Upload .sol file
        ↓
  🔨  Compile with Hardhat
        ↓
  🚀  Deploy victim + attacker contracts on-chain
        
        ↓
  💀  Real attacks execute — Reentrancy, Overflow, Input Validation
        ↓
  📊  Full security report with scores, drain chart & fixes
```

---

## 💥 Attack Vectors

| # | Attack                            |   Severity   | What Happens                                                                     |
|---|----------------------------------|--------------------------------------------------------------------------------------------------|
| 1 | 🔄 **Reentrancy**                 | 🔴 Critical | Recursive `.call{value}` drain before state update                                 |
| 2 | 📥 **Input Validation**           | 🟠 High     | Withdraw full vault without verifying deposited balance                            |
| 3 | 💥 **Integer Overflow**           | 🟠 High     | Arithmetic wrap via `unchecked {}` to underflow balances                           |
| 4 | 🔐 **Missing Access Control**     | 🔴 Critical | Call unguarded admin functions (`claimFees`, `changeOwner`, `setPaused`)           |
| 5 | 🧾 **tx.origin Auth**             | 🟠 High     | Phishable auth bypass via intermediary contracts                                   |
| 6 | ⏱️ **Block Timestamp**            | 🟡 Low      | Miner-manipulable timing logic                                                     |
| 7 | 📌 **Floating Pragma**            | 🟡 Low      | Unlocked compiler version allows unexpected behaviour                              |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                          │
│                                                                  │
│   ┌──────────────────────┐      ┌───────────────────────────┐   │
│   │    Upload Screen      │      │        Dashboard          │   │
│   │                      │      │                           │   │
│   │  • Drag & drop .sol  │      │  • Live drain chart       │   │
│   │  • Stand At Aweeeee  │      │  • Transaction log        │   │
│   │  • Wallet connect    │      │  • Security score ring    │   │
│   │  • Funding modal     │      │  • Attack severity bars   │   │
│   │    (real wallet txs) │      │  • Vulnerability report   │   │
│   └──────────┬───────────┘      └───────────────────────────┘   │
└──────────────┼──────────────────────────────────────────────────┘
               │  HTTP REST  +  wagmi wallet signing
┌──────────────▼──────────────────────────────────────────────────┐
│                     Express Backend (Node.js)                    │
│                                                                  │
│   POST /upload-compile  →  Compile .sol via Hardhat              │
│   POST /deploy          →  Deploy victim + attacker contracts    │
│   POST /attack          →  Run 3 attack scripts sequentially     │
│   POST /upload          →  All-in-one flow (localhost only)      │
└──────────────┬──────────────────────────────────────────────────┘
               │  child_process spawn
┌──────────────▼──────────────────────────────────────────────────┐
│                    Hardhat (TypeScript scripts)                   │
│                                                                  │
│   deployForAttack.ts         Deploy all 4 contracts              │
│   runReentrancyUpload.ts     FlexReentrancyAttacker exploit      │
│   runInputValidation.ts      InputValidationAttacker exploit      │
│   runOverflowUpload.ts       OverflowAttacker exploit            │
│   buildResult.ts             Normalised SimResult output         │
│                                                                  │
│   Static Analysis fallback → regex pattern detection             │
│   mergeStaticFindings()    → enrich failed live runs             │
└──────────────┬──────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────┐
│                      Blockchain Networks                         │
│                                                                  │
│   🔷  Hardhat localhost:8545    free, instant, no wallet needed  │  
└──────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18
- Yarn
- MetaMask _(testnet mode only)_

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/secure-sol.git
cd secure-sol
yarn install
```

### 2. Environment Setup

```bash

> For **testnet** runs, fund that deployer address at [faucet.flow.com](https://faucet.flow.com/fund-account)

### 3. Run (3 terminals)

```bash
# Terminal 1 — Hardhat node (localhost only)
cd packages/hardhat
npx hardhat node

# Terminal 2 — Backend API
cd packages/backend
yarn start

# Terminal 3 — Frontend
cd packages/nextjs
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) · select **Hardhat** · upload a `.sol` file · click **Start Attack Simulation** 🚀

---

## 🌐 Testnet Mode (Flow EVM)

To run real on-chain attacks with wallet signing:

1. Select **Flow** in the network bar
2. Click **Connect Wallet** (MetaMask)
3. Ensure your wallet has testnet FLOW → [faucet.flow.com](https://faucet.flow.com/fund-account)
4. Upload your `.sol` file and click **Start Attack Simulation**
5. A **Funding Modal** appears showing exactly what each contract costs
6. Sign the transactions — typically 2–3 MetaMask prompts
7. Attacks run against your live funded contracts on-chain

**Estimated cost per full scan: ~21 FLOW**

| Contract | Amount | Purpose |
|----------|--------|---------|
| 🏦 Victim Vault | 15 FLOW | Seeds the vault — gives the attacker something to steal |
| 🔄 Reentrancy Attacker | 5 FLOW | Deposit before re-entering |
| 💥 Overflow Attacker | 1 FLOW | Trigger arithmetic edge cases |

---

## 📁 Project Structure

```
secure-sol/
├── packages/
│   ├── nextjs/                           # Next.js 14 frontend
│   │   └── app/
│   │       └── page.tsx                  # Upload screen + Dashboard
│   │
│   ├── backend/                          # Express.js API
│   │   └── src/
│   │       ├── index.ts                  # Route registration
│   │       ├── upload.ts                 # All-in-one localhost handler
│   │       ├── uploadCompile.ts          # Testnet step 1: compile only
│   │       ├── deploy.ts                 # Testnet step 2: deploy contracts
│   │       └── attack.ts                 # Testnet step 3: run exploits
│   │
│   └── hardhat/                          # Contracts + attack scripts
│       ├── contracts/
│       │   ├── uploaded/                 # User contracts land here
│       │   │   └── VulnerableVault.sol   # Example vulnerable contract
│       │   └── attackers/
│       │       ├── FlexReentrancyAttacker.sol
│       │       ├── InputValidationAttacker.sol
│       │       ├── OverflowAttacker.sol
│       │       └── AccessControlAttacker.sol
│       ├── scripts/simulate/
│       │   ├── deployForAttack.ts
│       │   ├── runReentrancyUpload.ts
│       │   ├── runInputValidationUpload.ts
│       │   ├── runOverflowUpload.ts
│       │   └── buildResult.ts
│       └── hardhat.config.ts
```

---

## 🧪 Try It With This Contract

Save as `VulnerableVault.sol` and upload — Secure.sol will detect **6 vulnerabilities**:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VulnerableVault {
    mapping(address => uint256) public balances;
    address public owner;
    bool public paused;
    uint256 public feeRate;

    constructor() { owner = msg.sender; }

    // 🔴 REENTRANCY — external call before state update
    function withdraw(uint256 _amount) external {
        require(balances[msg.sender] >= _amount);
        (bool ok,) = msg.sender.call{value: _amount}("");
        require(ok);
        balances[msg.sender] -= _amount; // ← too late!
    }

    // 🟠 INPUT VALIDATION — no msg.value > 0 check
    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // 🔴 MISSING ACCESS CONTROL — anyone can drain fees
    function claimFees() external {
        payable(msg.sender).transfer(address(this).balance / 10);
    }

    // 🔴 MISSING ACCESS CONTROL — anyone can take ownership
    function changeOwner(address _o) external { owner = _o; }
    function setPaused(bool _p) external { paused = _p; }
    function setFeeRate(uint256 _r) external { feeRate = _r; }

    receive() external payable {}
}
```

---

## 🔒 How The Wallet Funding Flow Works

```
User clicks "Start Attack Simulation"
         │
         ▼
POST /upload-compile ──→ Hardhat compiles .sol
         │                returns: { contractName, fileName }
         ▼
POST /deploy ──────────→ Hardhat deploys victim + 3 attacker contracts
         │                returns: { victimAddress, attackerAddresses, fundingRequired }
         ▼
 ┌───────────────────────────────────┐
 │         Funding Modal             │
 │                                   │
 │  🏦 Victim Vault      15 FLOW ✅  │
 │  🔄 Reentrancy         5 FLOW ⏳  │
 │  💥 Overflow           1 FLOW     │
 │                                   │
 │  [Cancel]  [Sign 3 Transactions]  │
 └───────────────────────────────────┘
         │  User signs each tx in MetaMask
         ▼
walletClient.sendTransaction() × N
publicClient.waitForTransactionReceipt() per tx
         │
         ▼
POST /attack ──────────→ Hardhat scripts attack pre-funded contracts
         │                env: VICTIM_ADDRESS, ATTACKER_ADDRESS
         ▼
Dashboard renders live results
```

---

## 🛡️ Static Analysis Fallback

When live execution fails (no gas, RPC timeout, unfunded wallet), Secure.sol automatically falls back to **regex-based static analysis** and merges findings into the result. You always get signal.

| Pattern | Vuln Detected |
|---------|--------------|
| `.call{value:` before `balances[` update | Reentrancy |
| `function withdraw` without `require(balances[msg.sender] >=` | Input Validation |
| `claimFees`/`changeOwner`/`setPaused` without `onlyOwner` | Missing Access Control |
| `pragma solidity ^0.[0-7].` without SafeMath | Overflow |
| `tx.origin` anywhere in source | Auth Vulnerability |
| `block.timestamp` or `now` | Timestamp Dependence |
| `pragma solidity ^` | Floating Pragma |

---

## 📊 Dashboard Features

| Feature | Description |
|---------|-------------|
| **Security Score Ring** | Animated 0–100 score, colour-coded by risk level |
| **Balance Drain Chart** | Real-time SVG showing ETH draining from victim contract |
| **Transaction Log** | Step-by-step table of every on-chain action with before/after balances |
| **Attack Timeline** | Animated event feed — what happened and when |
| **Drain Rate** | ETH/ms, USD/ms, ₹/ms live conversion |
| **Attack Severity Bars** | Per-vector vulnerability score across all 5 attack types |
| **All Attack Results** | VULNERABLE / SAFE badge for each of the 3 simulation runs |
| **Vulnerability Report** | Exact explanation of what failed + code snippet to fix it |

---

## ⚙️ Supported Networks

| Network | Type | Chain ID | Gas Token | Wallet Required |
|---------|------|----------|-----------|-----------------|
| Hardhat | Local | 31337 | ETH (free) | ❌ |
| Flow EVM Testnet | Testnet | 545 | FLOW | ✅ |
| Sepolia | Testnet | 11155111 | ETH | ✅ |
| Polygon Mumbai | Testnet | 80001 | MATIC | ✅ |
| Avalanche Fuji | Testnet | 43113 | AVAX | ✅ |

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript |
| Wallet | wagmi v2, viem, MetaMask |
| Backend | Express.js, TypeScript, Multer |
| Blockchain tooling | Hardhat, ethers.js v6 |
| Smart Contracts | Solidity 0.8.x |
| Styling | Pure inline CSS (zero UI lib dependencies) |

---

## 🤝 Contributing

Pull requests are welcome. For major changes, open an issue first to discuss what you'd like to change.

```bash
# Fork the repo, then:
git checkout -b feature/your-attack-vector
git commit -m "feat: add flash loan attack simulation"
git push origin feature/your-attack-vector
# Open a PR
```

Ideas for new attack vectors:
- [ ] Flash loan price manipulation
- [ ] Sandwich attack simulation
- [ ] Selfdestruct / forceful ETH injection
- [ ] Signature replay attacks
- [ ] Front-running simulation

---

## ⚠️ Disclaimer

Secure.sol is built for **educational and security research purposes only**. Only test contracts you own or have explicit written permission to test. Never run attack scripts against mainnet contracts or contracts you do not own. The authors accept no liability for misuse.

---

## 📄 License

MIT © 2025

---

<div align="center">

Built with 🔥 at **MakeATon 2025** by developers who got rugged one too many times

<br/>

**If this helped you secure a contract, drop a ⭐ — it means a lot**

</div>
