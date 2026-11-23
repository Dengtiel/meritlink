/**
 * Issues one VALID participation record and one recommendation (nothing is revoked), then saves
 * the record files and their certificate QR links. Use it to demo certificates in the web app.
 *
 *   npm run demo-record:local     (npx hardhat node must be running)
 *   npm run demo-record:sepolia
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const hre = require("hardhat");
const { canonicalize, hashRecord, studentRef, buildParticipationRecord, buildRecommendation } = require("./lib/record");

async function main() {
  const { ethers, network } = hre;
  const [wallet] = await ethers.getSigners();
  // Public RPCs are load-balanced; an extra confirmation keeps the next transaction's nonce and
  // reads consistent. The local Hardhat node needs only one.
  const CONF = ["hardhat", "localhost"].includes(network.name) ? 1 : 2;
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for ${network.name}. Run the deploy script first.`);
  const registry = await ethers.getContractAt("MeritLinkRegistry", JSON.parse(fs.readFileSync(file, "utf8")).address);

  // Make sure this wallet can issue (it is the admin from deployment).
  if (!(await registry.isOrganiser(wallet.address))) {
    await (await registry.addOrganiser(wallet.address, "ALU Debate Club")).wait(CONF);
  }
  const activity = { name: "ALU Debate Club - Term 1", category: "Leadership", totalSessions: 10, minSessions: 8, minMinutes: 45 };
  const actRcpt = await (await registry.createActivity(activity.name, 0, 10, 8, 45)).wait(CONF);
  const activityId = actRcpt.logs.map((l) => registry.interface.parseLog(l)).find((e) => e?.name === "ActivityCreated").args.activityId;

  const run = Date.now().toString(36);
  const student = { name: "Alice Uwase", email: `a.uwase+${run}@alustudent.com` };
  const minutes = [60, 50, 47, 90, 45, 55, 61, 80, 30];
  const today = new Date().toISOString().slice(0, 10);
  const organiser = await registry.organiserName(wallet.address);

  const doc = buildParticipationRecord({ student, activity, organiser, attendedMinutes: minutes, issuedOn: today });
  const ref = studentRef(student.email);
  const r1 = await (await registry.issueRecord(activityId, ref, hashRecord(doc), minutes)).wait(CONF);
  const recordId = r1.logs.map((l) => registry.interface.parseLog(l)).find((e) => e?.name === "RecordIssued").args.recordId;

  const rec = buildRecommendation({
    student, activity, organiser, participationRecordId: Number(recordId), issuedOn: today,
    text: "Alice chaired four debates this term and mentored two first-year members through their first tournament.",
  });
  const r2 = await (await registry.issueRecommendation(recordId, hashRecord(rec))).wait(CONF);
  const recId = r2.logs.map((l) => registry.interface.parseLog(l)).find((e) => e?.name === "RecordIssued").args.recordId;

  const qrLink = (id, d) =>
    `http://localhost:5173/#verify=${network.name}.${id}.d${zlib.deflateRawSync(Buffer.from(canonicalize(d), "utf8")).toString("base64url")}`;
  const outDir = path.join(__dirname, "..", "demo-records", network.name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `valid-record-${recordId}.json`), JSON.stringify(doc, null, 2));
  fs.writeFileSync(path.join(outDir, `valid-recommendation-${recId}.json`), JSON.stringify(rec, null, 2));

  console.log(`Issued VALID participation record #${recordId} and recommendation #${recId} (activity #${activityId}).`);
  console.log(`Files: demo-records/${network.name}/valid-record-${recordId}.json and valid-recommendation-${recId}.json`);
  console.log(`\nDrop either file on the Verify page, then click "Print certificate with QR code".`);
  console.log(`\nOr open a certificate QR link directly:\n  record:         ${qrLink(recordId, doc)}\n  recommendation: ${qrLink(recId, rec)}`);
  console.log(`\nProfile link: http://localhost:5173/#profile=${ref}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
