# MeritLink: Test Cases

**Contract:** `contracts/MeritLinkRegistry.sol`
**Test file:** `test/MeritLinkRegistry.test.js` (each test name starts with its TC-ID)
**Framework:** Hardhat 2.29, Mocha, Chai, `@nomicfoundation/hardhat-chai-matchers`
**Command:** `npx hardhat test`
**Last run:** 19 November 2026, **42 passing, 0 failing** (full log: [outputs/test-results.txt](outputs/test-results.txt))
**Coverage (`npx hardhat coverage`):** 100% statements, 97.83% branches, 100% functions, 100% lines ([outputs/coverage.txt](outputs/coverage.txt))

Fixed test data used throughout:

- Activity "ALU Debate Club - Term 1". Rule: **at least 8 of 10 sessions, each at least 45 minutes**.
- Alice's attendance: `[60, 50, 47, 90, 45, 55, 61, 80, 30]`. 8 sessions qualify (the 30-minute one does not).
- Bob's attendance: `[60, 60, 60, 60, 60, 60, 60, 44, 40]`. Only 7 qualify (44 and 40 are short).

## 1. Deployment and administration

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-01 | Admin role set at deployment | Deploy with `admin` address | `admin` holds `DEFAULT_ADMIN_ROLE`; counters are 0 | Pass |
| TC-02 | Zero admin rejected | Deploy with `0x000…0` | Revert `ZeroAddress` | Pass |
| TC-03 | Admin approves an organiser | `addOrganiser(org, "ALU Debate Club")` | `OrganiserAdded` event; `isOrganiser` true; name stored | Pass |
| TC-04 | Only admin can approve organisers | Outsider calls `addOrganiser` | Revert `AccessControlUnauthorizedAccount` | Pass |
| TC-05 | Input validation on approval | Zero address; empty name | Revert `ZeroAddress`; revert `EmptyName` | Pass |
| TC-06 | Removing an organiser | `removeOrganiser(org)`, then org tries to create/issue | `OrganiserRemoved`; both actions revert; Alice's earlier record still `Valid` | Pass |

## 2. Activities and participation rules

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-07 | Organiser creates an activity | `createActivity(name, Leadership, 10, 8, 45)` | `ActivityCreated` event with all fields; `getActivity(1)` returns the stored rule | Pass |
| TC-08 | Non-organiser cannot create | Outsider calls `createActivity` | Revert `AccessControlUnauthorizedAccount` | Pass |
| TC-09 | Invalid rules rejected | total 0; min 0; min > total; 0 minutes; total 201; empty name | Revert `InvalidRule` (×5), `EmptyName` | Pass |
| TC-10 | Closing an activity | Organiser 2 tries to close; owner closes; owner tries to issue | `NotActivityOrganiser`; `ActivityClosed` event; issuance reverts `ActivityClosedError` | Pass |
| TC-11 | Unknown activity | `getActivity(99)` | Revert `ActivityNotFound(99)` | Pass |

## 3. Automatic rule-based issuance

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-12 | Record issued when the rule is met | Alice's attendance | `RecordIssued(1, 1, ref, Participation, hash, org, 8)`; record stored as `Valid` with 8 qualifying sessions | Pass |
| TC-13 | Record withheld: too few sessions | `[60, 60, 60]` | Revert `RuleNotMet(3, 8)` | Pass |
| TC-14 | Short sessions excluded | Bob's attendance | Revert `RuleNotMet(7, 8)` | Pass |
| TC-15 | Boundary values | Exactly 8 sessions of exactly 45 min | Record issued | Pass |
| TC-16 | Fabricated attendance | 11 sessions for a 10-session activity | Revert `TooManySessions(11, 10)` | Pass |
| TC-17 | No duplicate records per student per activity | Second record for Alice, different hash | Revert `AlreadyIssued(1, ref, 1)` | Pass |
| TC-18 | Hash reuse blocked | Alice's hash reused for Bob | Revert `HashAlreadyAnchored(hash, 1)` | Pass |
| TC-19 | Empty identifiers | `studentRef = 0x0`; `recordHash = 0x0` | Revert `InvalidStudentRef`; `InvalidRecordHash` | Pass |
| TC-20 | Organisers stay in their own lane | Organiser 2 issues for organiser 1's activity | Revert `NotActivityOrganiser(1, org2)` | Pass |
| TC-21 | Unknown activity | Issue for activity 42 | Revert `ActivityNotFound(42)` | Pass |
| TC-22 | No personal data on-chain | Read Alice's record back from the chain | No email or name in the stored data; a different salt gives a different `studentRef` | Pass |

## 4. Recommendations

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-23 | Recommend an eligible student | `issueRecommendation(1, recHash)` | `RecordIssued(2, …, Recommendation, …)`; `parentRecordId = 1`; verifies `Valid` | Pass |
| TC-24 | No participation, no recommendation | Recommend on record 5 (missing) | Revert `RecordNotFound(5)` | Pass |
| TC-25 | Only the activity's organiser can recommend | Organiser 2 recommends Alice | Revert `NotActivityOrganiser` | Pass |
| TC-26 | One recommendation per record; no chaining | Second recommendation; recommend a recommendation | `RecommendationExists(1, 2)`; `NotParticipationRecord(2)` | Pass |
| TC-27 | Revoked students cannot be recommended | Revoke record 1, then recommend | Revert `RecordNotValid(1)` | Pass |
| TC-28 | Revocation cascades to verification | Recommend, then revoke the participation record | Recommendation verifies as `ParentRevoked` | Pass |

## 5. Verification and tamper detection

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-29 | Verifier checks an original record | Any account calls `verifyRecord(1, hash(original))` | `Valid` (view call, no gas) | Pass |
| TC-30 | Altered documents detected | Change one session's minutes; change the student name | `HashMismatch` both times | Pass |
| TC-31 | Field order does not matter | Same record with keys in a different order | `Valid` (canonical JSON gives the same hash) | Pass |
| TC-32 | Unknown record id | `verifyRecord(999, …)` | `NotFound` | Pass |
| TC-33 | Lookup by document only | `verifyByHash(hash)`; random hash | `(1, Valid)`; `(0, NotFound)` | Pass |
| TC-34 | Profile listing | Alice earns a second record from another organiser | `getStudentRecords(ref)` returns `[1, 2]`; Bob returns `[]` | Pass |
| TC-35 | Unknown record read | `getRecord(1)` on an empty registry | Revert `RecordNotFound(1)` | Pass |

## 6. Revocation

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-36 | Issuer revokes | `revokeRecord(1, "Issued in error")` | `RecordRevoked` event; status `Revoked`; `revokedAt > 0`; verifies `Revoked` | Pass |
| TC-37 | Admin revokes any record | Admin calls `revokeRecord` | `RecordRevoked` event | Pass |
| TC-38 | Others cannot revoke | Organiser 2 and outsider call `revokeRecord` | Revert `NotAuthorisedToRevoke` | Pass |
| TC-39 | Invalid revocations | Revoke twice; revoke record 77 | `RecordNotValid`; `RecordNotFound` | Pass |

## 7. Emergency pause

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-40 | Pause stops writes, not reads | `pause()`, then issue / create / recommend / verify; `unpause()`, then issue | Writes revert `EnforcedPause`; verification still `Valid`; issuance works after unpause | Pass |
| TC-41 | Only admin can pause | Organiser calls `pause` / `unpause` | Revert `AccessControlUnauthorizedAccount` | Pass |

## 8. End-to-end scenario

| ID | What is tested | Input / action | Expected outcome | Actual result |
|---|---|---|---|---|
| TC-42 | Full pilot flow | Admin approves organiser → activity created → 3 students submitted (2 qualify, 1 does not) → verifier checks → forged activity name → revoke | 2 records issued, 1 withheld (`RuleNotMet`); both verify `Valid`; forgery gives `HashMismatch`; revoked record gives `Revoked` | Pass |

## Gas measurements (from `REPORT_GAS=true npx hardhat test`)

| Function | Average gas |
|---|---|
| Deployment | 2,003,884 |
| `addOrganiser` | 74,479 |
| `createActivity` | 120,245 |
| `issueRecord` | 258,437 |
| `issueRecommendation` | 249,683 |
| `revokeRecord` | 34,893 |
| `closeActivity` | 32,462 |
| `pause` / `unpause` | 47,085 / 25,122 |
| `verifyRecord`, `verifyByHash`, `getRecord`, … | 0 (read-only `view` calls) |

Full table: [outputs/gas-report.txt](outputs/gas-report.txt). These figures use Hardhat's local gas rules. Sepolia now runs the Glamsterdam upgrade (EIP-8037), which charges more for creating new state, so the same calls cost more there: `issueRecord` used 1,138,696 gas and deployment 14,061,232. See report section 6.3.

## Testnet verification (Sepolia, 22 November 2026)

| ID | What is tested | Expected outcome | Actual result |
|---|---|---|---|
| TN-01 | `npm run deploy:sepolia` | Contract deployed; address on Sepolia Etherscan | Pass: `0xE1385041B4F6b3276c458Ecf5598DF77Ca867f3a`, block 12,190,149 ([log](outputs/sepolia-deploy.txt)) |
| TN-02 | `npm run verify:sepolia` | Source shows a green "Verified" tick on Etherscan | Pass: [https://sepolia.etherscan.io/address/0xE1385041B4F6b3276c458Ecf5598DF77Ca867f3a#code](https://sepolia.etherscan.io/address/0xE1385041B4F6b3276c458Ecf5598DF77Ca867f3a#code) |
| TN-03 | `npm run interact:sepolia` | Same outcomes as the local run: Alice issued, Bob `RuleNotMet(7, 8)`, tamper `HashMismatch`, revoke `Revoked` / `ParentRevoked` | Pass: all outcomes match ([log](outputs/sepolia-interaction.txt)) |
| TN-04 | Web verifier on Sepolia | A valid record file shows "Genuine and current" and offers a certificate; the `TAMPERED` file shows "Not issued through MeritLink" | Pass: `valid-record-3.json` → Genuine and current; `record-1-TAMPERED.json` → Not issued |
| TN-05 | Certificate QR (local test chain) | QR on a printed certificate decodes to the verify link; scanning gives "Genuine and current"; a QR with the student name changed gives "This file was altered" | Pass: decoded by a QR reader library, all three outcomes as expected |
