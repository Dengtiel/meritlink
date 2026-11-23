# MeritLink: Deployment and Interaction Guide

This guide takes you from a fresh clone to a deployed, source-verified `MeritLinkRegistry` on the Ethereum **Sepolia** testnet. Then it shows three ways to interact with the contract: scripts, Etherscan, and the web page.

---

## 1. Prerequisites

| Tool | Version used | Check with |
|---|---|---|
| Node.js | 20.x (LTS) | `node -v` |
| npm | 10.x | `npm -v` |
| Git | any recent | `git --version` |
| MetaMask (browser extension) | any recent | only needed for the web page's organiser/admin tabs |

Project dependencies (installed by `npm install`):

| Package | Purpose |
|---|---|
| `hardhat` 2.29 | compile, test, deploy, local blockchain |
| `@nomicfoundation/hardhat-toolbox` 5 | ethers v6, chai matchers, network helpers, gas reporter, coverage, Etherscan verification |
| `@openzeppelin/contracts` 5 | audited `AccessControl` and `Pausable` |
| `dotenv` | loads secrets from `.env` |
| `cross-env` | sets `REPORT_GAS` on Windows and macOS/Linux alike |

> **Windows note.** Run commands from `C:\Blockchain_summative` with an **upper-case** `C:`. VS Code sometimes opens the folder as `c:\…`. When that happens, Node loads two copies of `chai`, and every `.to.emit` / `.revertedWithCustomError` assertion fails with *"Invalid Chai property"*. Fix: in the terminal run `cd C:\Blockchain_summative` before `npx hardhat test`.

---

## 2. Install, compile and test locally

```bash
git clone <your-repo-url> Blockchain_summative
cd Blockchain_summative
npm install
npx hardhat compile        # -> "Compiled 7 Solidity files successfully"
npx hardhat test           # -> "42 passing"
npm run coverage           # optional: coverage table
npm run test:gas           # optional: writes docs/outputs/gas-report.txt
```

---

## 3. Dry run on a local blockchain (no keys, no faucet)

Terminal 1:

```bash
npx hardhat node
```

This starts a local chain at `http://127.0.0.1:8545` with 20 funded test accounts.

Terminal 2:

```bash
npm run deploy:local       # deploys, writes deployments/localhost.json
npm run interact:local     # runs the full pilot scenario
```

Expected output is in [outputs/local-deploy.txt](outputs/local-deploy.txt) and [outputs/local-interaction.txt](outputs/local-interaction.txt).

---

## 4. Prepare for Sepolia

### 4.1 Create a test-only wallet

1. In MetaMask, create a **new account** used only for this project. Never use a wallet that holds real funds.
2. Turn on test networks (Settings → Advanced → *Show test networks*) and select **Sepolia**.
3. Export the private key: Account details → *Show private key*.

### 4.2 Get Sepolia ETH

Deployment plus one full run of the interaction script costs about 2.8 million gas. A few hundredths of a Sepolia ETH is more than enough. Use any Sepolia faucet, for example:

- Google Cloud Web3 faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Alchemy faucet: https://www.alchemy.com/faucets/ethereum-sepolia

(Faucet rules change. Some ask for a small mainnet balance or an account login.)

### 4.3 Get an RPC URL

Create a free app on **Alchemy** (https://dashboard.alchemy.com) or **Infura** (https://app.infura.io) for *Ethereum Sepolia*, and copy the HTTPS URL.

### 4.4 Get an Etherscan API key

Sign in at https://etherscan.io/myapikey and create a key. A single Etherscan V2 key also works for Sepolia.

### 4.5 Fill in `.env`

```bash
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env
```

```ini
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/xxxxxxxx
PRIVATE_KEY=0xabc123...            # test wallet only
ETHERSCAN_API_KEY=XXXXXXXXXXXXXXXX
STUDENT_REF_SALT=any-long-random-string
```

`.env` is listed in `.gitignore`, so it is never committed.

---

## 5. Deploy to Sepolia

```bash
npm run deploy:sepolia
```

Expected output (your address and hashes will differ):

```
==============================================
 MeritLink - deploying MeritLinkRegistry
==============================================
Network  : sepolia (chainId 11155111)
Deployer : 0xYourWallet...
Balance  : 0.5 ETH
Tx hash  : 0x...
Waiting for confirmation...

MeritLinkRegistry deployed at: 0xYourContract...
Block    : ...
Gas used : 2003884
Saved    : deployments/sepolia.json

Etherscan: https://sepolia.etherscan.io/address/0xYourContract...
```

The deploying wallet becomes the university administrator (`DEFAULT_ADMIN_ROLE`).

📸 **Screenshot 1:** this terminal output.
📸 **Screenshot 2:** the contract page on Sepolia Etherscan.

## 6. Verify the source code on Etherscan

```bash
npm run verify:sepolia
```

The script runs `hardhat verify` with the address and constructor argument saved in `deployments/sepolia.json`. When it finishes, the contract's **Contract** tab on Etherscan shows a green tick, and anyone can read the Solidity that enforces the rules.

📸 **Screenshot 3:** the verified *Contract* tab.

---

## 7. Interact with the deployed contract

### Option A: interaction script (recommended for the report)

```bash
npm run interact:sepolia
```

The script reads the address from `deployments/sepolia.json` and runs seven steps, printing a transaction hash and an Etherscan link for each one:

1. Admin approves an organiser (`addOrganiser`)
2. Organiser creates "ALU Debate Club - Term 1" with the rule *8 of 10 sessions, ≥45 min* (`createActivity`)
3. Shows the simulated check-in data for Alice and Bob
4. `issueRecord`: Alice's record is issued. Bob's is **withheld by the contract** with `RuleNotMet(7, 8)` (simulated first, so no gas is wasted)
5. One-click recommendation for Alice (`issueRecommendation`)
6. Verifier checks: original → `Valid`, edited → `HashMismatch`, lookup by hash → `Valid`
7. Revocation: participation → `Revoked`, its recommendation → `ParentRevoked`

It also saves the record files to `demo-records/sepolia/` for the web verifier. One test wallet plays both admin and organiser, so you only need one funded key.

📸 **Screenshot 4:** the full terminal output.
📸 **Screenshot 5:** one `issueRecord` transaction on Etherscan, *Logs* tab, showing the `RecordIssued` event.

### Option B: directly on Etherscan

After step 6, open the contract on Sepolia Etherscan:

- **Read Contract** (no wallet): `activityCount`, `recordCount`, `getActivity(1)`, `getRecord(1)`, `verifyRecord(1, 0x<hash>)`, `verifyByHash(0x<hash>)`. The result enum is `0 NotFound, 1 Valid, 2 Revoked, 3 HashMismatch, 4 ParentRevoked`.
- **Write Contract** → *Connect to Web3* (MetaMask):
  - `createActivity("Kigali Clean-up Drive", 1, 4, 3, 60)`
  - `issueRecord(<activityId>, <studentRef>, <recordHash>, [120,90,60])`

  `studentRef` and `recordHash` are `bytes32` values such as `0x1a2b…` (64 hex characters).

### Option C: the web page

```bash
npm run frontend           # http://localhost:5173
```

- Pick **Sepolia testnet** in the network menu at the top right. The contract address loads from `deployments/sepolia.json` and is shown in the footer.
- **Verify**: drag `demo-records/sepolia/record-N-original.json` onto the drop area. A seal shows the result (genuine, revoked, altered or not issued) with the activity, rule and issuer. Then drop `record-N-TAMPERED.json`: it shows *Not issued through MeritLink*, because the edited file's fingerprint was never sealed.
- **Profile**: paste the `studentRef` from `demo-records/sepolia/README.txt` to open the student's Linktree-style list, then use *Copy profile link* to get a shareable `#profile=0x…` link.
- **Certificates with a QR code**: when a record checks out as genuine, click *Print certificate with QR code*, then *Print or save as PDF*. Organisers get the same link in the Activity panel straight after issuing a record or recommendation. The QR code holds the whole record (compressed), so scanning a printed copy rebuilds the document and checks it against Ethereum, including the student's name. If someone edits the printout, or forges a new QR, the scan says *This file was altered*. Very long recommendation letters fall back to a QR that checks only the record's fingerprint, and the certificate says so. `demo-records/<network>/README.txt` also lists ready-made QR links for the demo records.
  - To scan from a phone, the page must be reachable from that phone. Use the Sepolia network, and open the page through your computer's network address (for example `http://192.168.1.20:5173`) before printing, because `localhost` on a phone means the phone itself.
- **Organiser / Admin**: *Connect wallet* (MetaMask on Sepolia). While you type attendance minutes, the page shows which sessions qualify and whether the contract will accept the record, before you spend any gas. Issued record files download automatically.

📸 **Screenshot 6:** the Verify page showing the seal for the original file, and *Not issued through MeritLink* for the tampered copy.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `HH100: Network sepolia doesn't exist` | `.env` is missing `SEPOLIA_RPC_URL` or `PRIVATE_KEY`, or the file isn't in the project root. |
| `insufficient funds for intrinsic transaction cost` | Wallet has no Sepolia ETH. Use a faucet (section 4.2). |
| `Invalid Chai property: emit` when testing | Windows drive-letter casing. `cd C:\Blockchain_summative` (upper-case C). |
| `No deployment found` from `interact` | Run `deploy` for the same network first, or set `REGISTRY_ADDRESS=0x…`. |
| Verify fails with "already verified" | Nothing to do: the source is already public. |
| Verify fails with "does not have bytecode" | Etherscan hasn't indexed the contract yet. Wait a minute and retry. |
| Web page says "network unreachable" | For localhost, `npx hardhat node` must be running. For Sepolia, check your internet connection. |
| MetaMask "nonce too high" after restarting the local node | MetaMask → Settings → Advanced → *Clear activity tab data*. |
