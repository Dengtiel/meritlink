# MeritLink

**Blockchain-verified records of student extracurricular participation, shared through one Linktree-style profile.**

Summative assessment, Blockchain course, African Leadership University.
Deng Mayen Deng Akol · Application area: **Education** (identity management)
Repository: https://github.com/dengtiel/meritlink

---

Students build real skills running clubs, volunteering and mentoring, but the evidence ends up scattered and nobody can check it. MeritLink lets an organiser set an activity up once with a participation rule ("8 of 10 sessions, at least 45 minutes each"). Students check in and out with rotating QR codes. When a student meets the rule, the `MeritLinkRegistry` smart contract on Ethereum **checks the rule itself** and anchors a SHA-256 fingerprint of the record. Anyone can then verify the record for free, and any edit to the document is detected.

| | |
|---|---|
| Smart contract | [`contracts/MeritLinkRegistry.sol`](contracts/MeritLinkRegistry.sol) (Solidity 0.8.24, OpenZeppelin 5) |
| Tests | [`test/MeritLinkRegistry.test.js`](test/MeritLinkRegistry.test.js): **42 passing**, 100% line coverage |
| Report | [`docs/REPORT.md`](docs/REPORT.md) · Word version for submission: [`docs/MeritLink_Report.docx`](docs/MeritLink_Report.docx) |
| Deployment guide | [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) |
| Test cases | [`docs/TEST_CASES.md`](docs/TEST_CASES.md) |
| Presentation | [`docs/MeritLink_Presentation.pptx`](docs/MeritLink_Presentation.pptx) |
| Terminal evidence | [`docs/outputs/`](docs/outputs/) |
| Sepolia contract | [`0xE1385041B4F6b3276c458Ecf5598DF77Ca867f3a`](https://sepolia.etherscan.io/address/0xE1385041B4F6b3276c458Ecf5598DF77Ca867f3a#code) (source verified) |

## Quick start

```bash
npm install
npx hardhat test                 # 42 passing  (Windows: run from C:\ with a capital C)

# local blockchain demo
npx hardhat node                 # terminal 1
npm run deploy:local             # terminal 2
npm run interact:local

# Sepolia (fill in .env first, see docs/DEPLOYMENT_GUIDE.md)
npm run deploy:sepolia
npm run verify:sepolia
npm run interact:sepolia

# web page: verifier, student profile, organiser, admin
npm run frontend                 # http://localhost:5173
```

## How it works

```
organiser sets rule once ─► students scan QR in/out ─► minutes per session
                                                          │
                       issueRecord(activity, studentRef, sha256(record), minutes[])
                                                          ▼
                            MeritLinkRegistry re-applies the rule on-chain
                     issued ✔  or  RuleNotMet(qualifying, required) ✘
                                                          │
       verifier hashes the document they hold ─► verifyRecord(id, hash)
                     Valid · Revoked · HashMismatch · NotFound · ParentRevoked
```

Only fingerprints, the rule and a salted pseudonymous student reference go on-chain. Names, emails and recommendation text stay off-chain.

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | Run the test suite |
| `npm run test:gas` | Tests + gas report → `docs/outputs/gas-report.txt` |
| `npm run coverage` | Solidity coverage |
| `npm run deploy:<local\|sepolia>` | Deploy, save address to `deployments/` |
| `npm run interact:<local\|sepolia>` | Full scenario: approve organiser → activity → issue / withhold → recommend → verify → tamper → revoke |
| `npm run verify:sepolia` | Publish source on Etherscan |
| `npm run frontend` | Serve `frontend/index.html` |
