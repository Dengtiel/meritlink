/**
 * Walks through the full MeritLink pilot flow against a deployed MeritLinkRegistry and prints
 * every step. Its output is the evidence of deployment and interaction for the report.
 *
 *   Local:    npx hardhat run scripts/interact.js --network localhost
 *   Sepolia:  npx hardhat run scripts/interact.js --network sepolia
 *
 * The contract address is read from deployments/<network>.json (written by deploy.js) or from
 * the REGISTRY_ADDRESS environment variable. On Sepolia a single wallet plays both admin and
 * organiser, so only one funded test key is needed.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const hre = require("hardhat");
const {
  canonicalize,
  CATEGORY,
  VERIFICATION,
  hashRecord,
  studentRef,
  buildParticipationRecord,
  buildRecommendation,
} = require("./lib/record");

const line = () => console.log("-".repeat(70));
const step = (n, title) => {
  console.log();
  line();
  console.log(`STEP ${n}: ${title}`);
  line();
};

function loadAddress(networkName) {
  if (process.env.REGISTRY_ADDRESS) return process.env.REGISTRY_ADDRESS;
  const file = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment found. Run scripts/deploy.js --network ${networkName} first.`);
  return JSON.parse(fs.readFileSync(file, "utf8")).address;
}

async function main() {
  const { ethers, network } = hre;
  const [admin] = await ethers.getSigners();
  const organiser = admin; // one funded key plays both roles (enough for a testnet demo)
  const address = loadAddress(network.name);
  const registry = await ethers.getContractAt("MeritLinkRegistry", address);
  const explorer = network.name === "sepolia" ? "https://sepolia.etherscan.io/tx/" : null;

  /** Sends a transaction, waits for it and prints hash, block and gas. */
  // Public RPC endpoints are load-balanced: a read sent right after a transaction can reach a
  // node that has not seen the new block yet. Waiting for an extra confirmation and retrying
  // reads briefly avoids false "not found" results. The local Hardhat node needs neither.
  const isLocal = ["hardhat", "localhost"].includes(network.name);
  const CONFIRMATIONS = isLocal ? 1 : 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function read(fn, attempts = isLocal ? 1 : 6) {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i >= attempts || err.final) throw err; // final = a real contract answer, not a lagging node
        await sleep(3000);
      }
    }
  }

  async function send(label, txPromise) {
    const tx = await txPromise;
    const rcpt = await tx.wait(CONFIRMATIONS);
    console.log(`  ✔ ${label}`);
    console.log(`    tx: ${tx.hash}  block: ${rcpt.blockNumber}  gas: ${rcpt.gasUsed}`);
    if (explorer) console.log(`    ${explorer}${tx.hash}`);
    return rcpt;
  }
  /**
   * Turns a reverted call into { name, args } using the contract ABI. Different providers nest
   * the revert data differently (ethers err.revert, Hardhat ProviderError.data.data, an RPC
   * error.data), so this searches the error object for the first hex payload it can decode.
   */
  function decodeRevert(err) {
    if (err.revert) return err.revert;
    const seen = new Set();
    const stack = [err];
    while (stack.length) {
      const v = stack.pop();
      if (!v || seen.has(v)) continue;
      if (typeof v === "string") {
        if (/^0x[0-9a-fA-F]{8,}$/.test(v)) {
          try {
            const e = registry.interface.parseError(v);
            if (e) return e;
          } catch {}
        }
        continue;
      }
      if (typeof v === "object") {
        seen.add(v);
        for (const k of ["data", "error", "info", "cause"]) stack.push(v[k]);
      }
    }
    return null;
  }
  /** Reads a RecordIssued event from a receipt and returns the new record id. */
  const issuedId = (rcpt) =>
    rcpt.logs.map((l) => registry.interface.parseLog(l)).find((e) => e && e.name === "RecordIssued").args.recordId;

  console.log(`MeritLink interaction demo on ${network.name}`);
  console.log(`Registry : ${address}`);
  console.log(`Wallet   : ${admin.address}`);

  // ------------------------------------------------------------------
  step(1, "Administrator approves an activity organiser");
  if (!(await registry.isOrganiser(organiser.address))) {
    await send("addOrganiser(ALU Debate Club)", registry.connect(admin).addOrganiser(organiser.address, "ALU Debate Club"));
  } else {
    console.log("  (organiser already approved, skipping)");
  }
  console.log(`  organiserName = "${await read(() => registry.organiserName(organiser.address))}"`);

  // ------------------------------------------------------------------
  step(2, "Organiser creates an activity with a participation rule");
  const activity = { name: "ALU Debate Club - Term 1", category: "Leadership", totalSessions: 10, minSessions: 8, minMinutes: 45 };
  const rcptAct = await send(
    `createActivity("${activity.name}", Leadership, 10 sessions, min 8, >=45 min)`,
    registry.connect(organiser).createActivity(activity.name, 0, activity.totalSessions, activity.minSessions, activity.minMinutes)
  );
  const activityId = rcptAct.logs.map((l) => registry.interface.parseLog(l)).find((e) => e && e.name === "ActivityCreated").args.activityId;
  const a = await read(() => registry.getActivity(activityId));
  console.log(`  activityId=${activityId}  category=${CATEGORY[Number(a.category)]}  rule=${a.minSessions}/${a.totalSessions} sessions >= ${a.minMinutesPerSession} min`);

  // ------------------------------------------------------------------
  step(3, "Check-in data from rotating QR scans (simulated, validated off-chain)");
  // Unique emails per run, so the demo can be repeated on the same deployment.
  const run = Date.now().toString(36);
  const students = [
    { name: "Alice Uwase", email: `a.uwase+${run}@alustudent.com`, minutes: [60, 50, 47, 90, 45, 55, 61, 80, 30] },
    { name: "Bob Mugisha", email: `b.mugisha+${run}@alustudent.com`, minutes: [60, 60, 60, 60, 60, 60, 60, 44, 40] },
  ];
  for (const s of students) {
    const q = s.minutes.filter((m) => m >= activity.minMinutes).length;
    console.log(`  ${s.name.padEnd(12)} minutes per session: [${s.minutes.join(", ")}]  -> ${q} qualifying`);
  }

  // ------------------------------------------------------------------
  step(4, "Automatic issuance: contract applies the rule on-chain");
  const issued = {};
  for (const s of students) {
    const doc = buildParticipationRecord({
      student: s,
      activity,
      organiser: "ALU Debate Club",
      attendedMinutes: s.minutes,
      issuedOn: new Date().toISOString().slice(0, 10),
    });
    const hash = hashRecord(doc);
    const ref = studentRef(s.email);
    try {
      // Simulate first, so a rule failure is reported without spending gas.
      await read(async () => {
        try {
          await registry.connect(organiser).issueRecord.staticCall(activityId, ref, hash, s.minutes);
        } catch (err) {
          if (decodeRevert(err)?.name === "RuleNotMet") throw Object.assign(err, { final: true });
          throw err; // e.g. a lagging node that has not seen the activity yet: retry
        }
      });
      const rcpt = await send(`issueRecord for ${s.name}`, registry.connect(organiser).issueRecord(activityId, ref, hash, s.minutes));
      const id = issuedId(rcpt);
      issued[s.name] = { id, doc, hash, ref };
      console.log(`    recordId=${id}  sha256=${hash}`);
    } catch (err) {
      const decoded = decodeRevert(err);
      if (!decoded) throw err; // not a rule failure: surface the real problem
      console.log(`  ✘ ${s.name}: record WITHHELD by contract -> ${decoded.name}(${decoded.args.join(", ")})`);
    }
  }

  // ------------------------------------------------------------------
  step(5, "Organiser issues a one-click recommendation for an eligible student");
  const alice = issued["Alice Uwase"];
  const recDoc = buildRecommendation({
    student: students[0],
    activity,
    organiser: "ALU Debate Club",
    participationRecordId: Number(alice.id),
    text: "Alice chaired four debates this term and mentored two first-year members.",
    issuedOn: new Date().toISOString().slice(0, 10),
  });
  const recHash = hashRecord(recDoc);
  const rcptRec = await send("issueRecommendation for Alice", registry.connect(organiser).issueRecommendation(alice.id, recHash));
  const recId = issuedId(rcptRec);
  console.log(`    recommendationId=${recId}  sha256=${recHash}`);

  // ------------------------------------------------------------------
  step(6, "External verifier checks the records (read-only, free, no wallet)");
  const show = async (label, id, hash) => console.log(`  ${label.padEnd(44)} -> ${VERIFICATION[Number(await read(() => registry.verifyRecord(id, hash)))]}`);
  await show(`Alice participation record #${alice.id} (original)`, alice.id, alice.hash);
  await show(`Alice recommendation #${recId} (original)`, recId, recHash);

  const tampered = structuredClone(alice.doc);
  tampered.attendance.minutesPerSession[8] = 90;
  await show(`Alice record #${alice.id} (one session edited)`, alice.id, hashRecord(tampered));
  const forged = structuredClone(alice.doc);
  forged.student.name = "Mallory Impostor";
  await show(`Alice record #${alice.id} (name changed)`, alice.id, hashRecord(forged));
  const [foundId, res] = await read(() => registry.verifyByHash(alice.hash));
  console.log(`  ${"verifyByHash(original document)".padEnd(44)} -> recordId=${foundId} ${VERIFICATION[Number(res)]}`);
  console.log(`  Alice's profile record ids: [${(await read(() => registry.getStudentRecords(alice.ref))).join(", ")}]`);

  // Save the documents so they can be checked again in the web verifier (frontend/index.html).
  const outDir = path.join(__dirname, "..", "demo-records", network.name);
  fs.mkdirSync(outDir, { recursive: true });
  const save = (name, obj) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2));
  save(`record-${alice.id}-original.json`, alice.doc);
  save(`record-${alice.id}-TAMPERED.json`, tampered);
  save(`recommendation-${recId}.json`, recDoc);
  // Same link format the web page puts inside a certificate's QR code:
  // #verify=<network>.<recordId>.d<deflate-raw + base64url of the canonical record>
  const qrLink = (id, doc) =>
    `http://localhost:5173/#verify=${network.name}.${id}.d${zlib.deflateRawSync(Buffer.from(canonicalize(doc), "utf8")).toString("base64url")}`;
  save(
    "README.txt",
    [
      `Drop these files on the Verify page of the web app (npm run frontend).`,
      `Alice studentRef (for the Profile page): ${alice.ref}`,
      ``,
      `Certificate QR links (open in the browser to simulate scanning a printed certificate):`,
      `Participation record #${alice.id}:`,
      qrLink(alice.id, alice.doc),
      `Recommendation #${recId}:`,
      qrLink(recId, recDoc),
      ``,
    ].join("\n")
  );
  console.log(`  Saved record files for the web verifier in demo-records/${network.name}/`);

  // ------------------------------------------------------------------
  step(7, "Revocation: organiser withdraws the participation record");
  await send(`revokeRecord(#${alice.id}, "Demo revocation")`, registry.connect(organiser).revokeRecord(alice.id, "Demo revocation"));
  await show(`Alice participation record #${alice.id}`, alice.id, alice.hash);
  await show(`Alice recommendation #${recId} (depends on it)`, recId, recHash);

  console.log();
  line();
  console.log(`Done. activityCount=${await read(() => registry.activityCount())} recordCount=${await read(() => registry.recordCount())}`);
  line();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
