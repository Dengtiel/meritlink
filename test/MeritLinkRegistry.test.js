/**
 * Test suite for MeritLinkRegistry.
 * Each test name starts with a TC-ID that matches docs/TEST_CASES.md.
 * Run:  npx hardhat test
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { hashRecord, studentRef, buildParticipationRecord, buildRecommendation } = require("../scripts/lib/record");

// Enum values, mirroring the Solidity declarations.
const Category = { Leadership: 0, Volunteering: 1, StudentOrganisation: 2, Mentorship: 3, CommunityEngagement: 4 };
const Kind = { Participation: 0, Recommendation: 1 };
const Status = { None: 0, Valid: 1, Revoked: 2 };
const Result = { NotFound: 0, Valid: 1, Revoked: 2, HashMismatch: 3, ParentRevoked: 4 };

// Debate Club rule: at least 8 of 10 sessions, each at least 45 minutes.
const RULE = { total: 10, min: 8, minutes: 45 };
const ACTIVITY = { name: "ALU Debate Club - Term 1", category: "Leadership", totalSessions: 10, minSessions: 8, minMinutes: 45 };
const ALICE = { name: "Alice Uwase", email: "a.uwase@alustudent.com" };
const BOB = { name: "Bob Mugisha", email: "b.mugisha@alustudent.com" };

// Attendance patterns (minutes between check-in and check-out per session).
const QUALIFIES = [60, 50, 47, 90, 45, 55, 61, 80, 30]; // 8 sessions >= 45 min, 1 short
const SHORT_SESSIONS = [60, 60, 60, 60, 60, 60, 60, 44, 40]; // only 7 qualify (44 and 40 are short)
const TOO_FEW = [60, 60, 60]; // left the club early

function participationDoc(student, minutes = QUALIFIES) {
  return buildParticipationRecord({
    student,
    activity: ACTIVITY,
    organiser: "ALU Debate Club",
    attendedMinutes: minutes,
    issuedOn: "2026-11-19",
  });
}

async function deployFixture() {
  const [admin, organiser, organiser2, outsider, verifier] = await ethers.getSigners();
  const registry = await ethers.deployContract("MeritLinkRegistry", [admin.address]);
  await registry.waitForDeployment();
  return { registry, admin, organiser, organiser2, outsider, verifier };
}

/** Deployed contract + one approved organiser + one activity (id 1). */
async function activityFixture() {
  const ctx = await deployFixture();
  const { registry, organiser, organiser2 } = ctx;
  await registry.addOrganiser(organiser.address, "ALU Debate Club");
  await registry.addOrganiser(organiser2.address, "ALU Volunteers Society");
  await registry.connect(organiser).createActivity(ACTIVITY.name, Category.Leadership, RULE.total, RULE.min, RULE.minutes);
  return { ...ctx, activityId: 1n };
}

/** activityFixture + a valid participation record for Alice (record id 1). */
async function issuedFixture() {
  const ctx = await activityFixture();
  const doc = participationDoc(ALICE);
  const hash = hashRecord(doc);
  const ref = studentRef(ALICE.email);
  await ctx.registry.connect(ctx.organiser).issueRecord(ctx.activityId, ref, hash, QUALIFIES);
  return { ...ctx, doc, hash, ref, recordId: 1n };
}

describe("MeritLinkRegistry", function () {
  // -------------------------------------------------------------------------
  describe("1. Deployment and administration", function () {
    it("TC-01: deployer-supplied admin holds DEFAULT_ADMIN_ROLE", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await registry.activityCount()).to.equal(0n);
      expect(await registry.recordCount()).to.equal(0n);
    });

    it("TC-02: deployment with zero admin address reverts", async function () {
      const factory = await ethers.getContractFactory("MeritLinkRegistry");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("TC-03: admin can add an organiser with a public name", async function () {
      const { registry, organiser } = await loadFixture(deployFixture);
      await expect(registry.addOrganiser(organiser.address, "ALU Debate Club"))
        .to.emit(registry, "OrganiserAdded")
        .withArgs(organiser.address, "ALU Debate Club");
      expect(await registry.isOrganiser(organiser.address)).to.equal(true);
      expect(await registry.organiserName(organiser.address)).to.equal("ALU Debate Club");
    });

    it("TC-04: non-admin cannot add an organiser", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).addOrganiser(outsider.address, "Fake Club"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, await registry.DEFAULT_ADMIN_ROLE());
    });

    it("TC-05: addOrganiser rejects zero address and empty name", async function () {
      const { registry, organiser } = await loadFixture(deployFixture);
      await expect(registry.addOrganiser(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(registry.addOrganiser(organiser.address, "")).to.be.revertedWithCustomError(registry, "EmptyName");
    });

    it("TC-06: removed organiser can no longer create activities or issue", async function () {
      const { registry, organiser, activityId } = await loadFixture(issuedFixture);
      await expect(registry.removeOrganiser(organiser.address)).to.emit(registry, "OrganiserRemoved");
      expect(await registry.isOrganiser(organiser.address)).to.equal(false);
      await expect(
        registry.connect(organiser).createActivity("New", Category.Leadership, 5, 3, 30)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB)), QUALIFIES)
      ).to.be.revertedWithCustomError(registry, "NotActivityOrganiser");
      // Records issued before removal remain valid.
      expect(await registry.verifyRecord(1n, hashRecord(participationDoc(ALICE)))).to.equal(Result.Valid);
    });
  });

  // -------------------------------------------------------------------------
  describe("2. Activities and participation rules", function () {
    it("TC-07: organiser creates an activity and the rule is stored on-chain", async function () {
      const { registry, organiser } = await loadFixture(deployFixture);
      await registry.addOrganiser(organiser.address, "ALU Debate Club");
      await expect(
        registry.connect(organiser).createActivity(ACTIVITY.name, Category.Leadership, RULE.total, RULE.min, RULE.minutes)
      )
        .to.emit(registry, "ActivityCreated")
        .withArgs(1n, organiser.address, Category.Leadership, ACTIVITY.name, RULE.total, RULE.min, RULE.minutes);

      const a = await registry.getActivity(1n);
      expect(a.organiser).to.equal(organiser.address);
      expect(a.totalSessions).to.equal(RULE.total);
      expect(a.minSessions).to.equal(RULE.min);
      expect(a.minMinutesPerSession).to.equal(RULE.minutes);
      expect(a.active).to.equal(true);
      expect(a.name).to.equal(ACTIVITY.name);
    });

    it("TC-08: non-organiser cannot create an activity", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(
        registry.connect(outsider).createActivity("X", Category.Leadership, 10, 8, 45)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("TC-09: invalid rules are rejected", async function () {
      const { registry, organiser } = await loadFixture(activityFixture);
      const org = registry.connect(organiser);
      await expect(org.createActivity("X", 0, 0, 0, 45)).to.be.revertedWithCustomError(registry, "InvalidRule"); // no sessions
      await expect(org.createActivity("X", 0, 10, 0, 45)).to.be.revertedWithCustomError(registry, "InvalidRule"); // min 0
      await expect(org.createActivity("X", 0, 5, 6, 45)).to.be.revertedWithCustomError(registry, "InvalidRule"); // min > total
      await expect(org.createActivity("X", 0, 10, 8, 0)).to.be.revertedWithCustomError(registry, "InvalidRule"); // 0 minutes
      await expect(org.createActivity("X", 0, 201, 8, 45)).to.be.revertedWithCustomError(registry, "InvalidRule"); // > MAX
      await expect(org.createActivity("", 0, 10, 8, 45)).to.be.revertedWithCustomError(registry, "EmptyName");
    });

    it("TC-10: only the activity's own organiser can close it, and closed activities cannot issue", async function () {
      const { registry, organiser, organiser2, activityId } = await loadFixture(activityFixture);
      await expect(registry.connect(organiser2).closeActivity(activityId)).to.be.revertedWithCustomError(
        registry,
        "NotActivityOrganiser"
      );
      await expect(registry.connect(organiser).closeActivity(activityId))
        .to.emit(registry, "ActivityClosed")
        .withArgs(activityId);
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(ALICE.email), hashRecord(participationDoc(ALICE)), QUALIFIES)
      ).to.be.revertedWithCustomError(registry, "ActivityClosedError");
    });

    it("TC-11: reading an unknown activity reverts", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.getActivity(99n)).to.be.revertedWithCustomError(registry, "ActivityNotFound").withArgs(99n);
    });
  });

  // -------------------------------------------------------------------------
  describe("3. Automatic rule-based issuance", function () {
    it("TC-12: record is issued when the student meets the rule (8 of 10, >=45 min)", async function () {
      const { registry, organiser, activityId } = await loadFixture(activityFixture);
      const hash = hashRecord(participationDoc(ALICE));
      const ref = studentRef(ALICE.email);

      await expect(registry.connect(organiser).issueRecord(activityId, ref, hash, QUALIFIES))
        .to.emit(registry, "RecordIssued")
        .withArgs(1n, activityId, ref, Kind.Participation, hash, organiser.address, 8);

      const r = await registry.getRecord(1n);
      expect(r.recordHash).to.equal(hash);
      expect(r.studentRef).to.equal(ref);
      expect(r.issuer).to.equal(organiser.address);
      expect(r.qualifyingSessions).to.equal(8);
      expect(r.status).to.equal(Status.Valid);
      expect(r.kind).to.equal(Kind.Participation);
      expect(r.issuedAt).to.equal(BigInt(await time.latest()));
      expect(await registry.recordIdByHash(hash)).to.equal(1n);
      expect(await registry.participationRecordOf(activityId, ref)).to.equal(1n);
    });

    it("TC-13: record is withheld when too few sessions were attended", async function () {
      const { registry, organiser, activityId } = await loadFixture(activityFixture);
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB, TOO_FEW)), TOO_FEW)
      )
        .to.be.revertedWithCustomError(registry, "RuleNotMet")
        .withArgs(3, 8);
    });

    it("TC-14: sessions shorter than the minimum duration are excluded", async function () {
      const { registry, organiser, activityId } = await loadFixture(activityFixture);
      // 9 sessions attended, but 44 and 40 minutes are below 45 => only 7 qualify.
      await expect(
        registry
          .connect(organiser)
          .issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB, SHORT_SESSIONS)), SHORT_SESSIONS)
      )
        .to.be.revertedWithCustomError(registry, "RuleNotMet")
        .withArgs(7, 8);
    });

    it("TC-15: boundary - exactly 45 minutes counts, exactly 8 sessions is enough", async function () {
      const { registry, organiser, activityId } = await loadFixture(activityFixture);
      const exact = [45, 45, 45, 45, 45, 45, 45, 45];
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB, exact)), exact)
      ).to.emit(registry, "RecordIssued");
    });

    it("TC-16: more sessions than the activity has are rejected (fabricated attendance)", async function () {
      const { registry, organiser, activityId } = await loadFixture(activityFixture);
      const eleven = Array(11).fill(60);
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB, eleven)), eleven)
      )
        .to.be.revertedWithCustomError(registry, "TooManySessions")
        .withArgs(11, 10);
    });

    it("TC-17: a student cannot receive two participation records for the same activity", async function () {
      const { registry, organiser, activityId, ref } = await loadFixture(issuedFixture);
      const otherDoc = { ...participationDoc(ALICE), issuedOn: "2026-11-20" };
      await expect(registry.connect(organiser).issueRecord(activityId, ref, hashRecord(otherDoc), QUALIFIES))
        .to.be.revertedWithCustomError(registry, "AlreadyIssued")
        .withArgs(activityId, ref, 1n);
    });

    it("TC-18: the same document hash cannot be anchored twice", async function () {
      const { registry, organiser, activityId, hash } = await loadFixture(issuedFixture);
      await expect(registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hash, QUALIFIES))
        .to.be.revertedWithCustomError(registry, "HashAlreadyAnchored")
        .withArgs(hash, 1n);
    });

    it("TC-19: empty student reference or empty hash are rejected", async function () {
      const { registry, organiser, activityId } = await loadFixture(activityFixture);
      const org = registry.connect(organiser);
      await expect(org.issueRecord(activityId, ethers.ZeroHash, hashRecord(participationDoc(BOB)), QUALIFIES)).to.be.revertedWithCustomError(
        registry,
        "InvalidStudentRef"
      );
      await expect(org.issueRecord(activityId, studentRef(BOB.email), ethers.ZeroHash, QUALIFIES)).to.be.revertedWithCustomError(
        registry,
        "InvalidRecordHash"
      );
    });

    it("TC-20: an organiser cannot issue records for another organiser's activity", async function () {
      const { registry, organiser2, activityId } = await loadFixture(activityFixture);
      await expect(
        registry.connect(organiser2).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB)), QUALIFIES)
      )
        .to.be.revertedWithCustomError(registry, "NotActivityOrganiser")
        .withArgs(activityId, organiser2.address);
    });

    it("TC-21: issuing for a non-existent activity reverts", async function () {
      const { registry, organiser } = await loadFixture(activityFixture);
      await expect(
        registry.connect(organiser).issueRecord(42n, studentRef(BOB.email), hashRecord(participationDoc(BOB)), QUALIFIES)
      )
        .to.be.revertedWithCustomError(registry, "ActivityNotFound")
        .withArgs(42n);
    });

    it("TC-22: no personal data is stored on-chain (only hashes and a pseudonymous ref)", async function () {
      const { registry, recordId, ref } = await loadFixture(issuedFixture);
      const r = await registry.getRecord(recordId);
      const onChain = JSON.stringify(r.toObject(), (_, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase();
      expect(onChain).to.not.include(ALICE.email.toLowerCase());
      expect(onChain).to.not.include("alice");
      expect(r.studentRef).to.equal(ref);
      // The ref depends on the secret salt, so it cannot be recomputed from the email alone.
      expect(studentRef(ALICE.email, "another-salt")).to.not.equal(ref);
    });
  });

  // -------------------------------------------------------------------------
  describe("4. Recommendations", function () {
    const text = "Alice chaired four debates and mentored two first-year members.";
    const recDoc = (id = 1) =>
      buildRecommendation({ student: ALICE, activity: ACTIVITY, organiser: "ALU Debate Club", participationRecordId: id, text, issuedOn: "2026-11-19" });

    it("TC-23: organiser recommends a student who met the rule", async function () {
      const { registry, organiser, recordId, ref, activityId } = await loadFixture(issuedFixture);
      const recHash = hashRecord(recDoc());
      await expect(registry.connect(organiser).issueRecommendation(recordId, recHash))
        .to.emit(registry, "RecordIssued")
        .withArgs(2n, activityId, ref, Kind.Recommendation, recHash, organiser.address, 0);
      const rec = await registry.getRecord(2n);
      expect(rec.parentRecordId).to.equal(recordId);
      expect(await registry.recommendationOf(recordId)).to.equal(2n);
      expect(await registry.verifyRecord(2n, recHash)).to.equal(Result.Valid);
    });

    it("TC-24: recommendation without a participation record is impossible", async function () {
      const { registry, organiser } = await loadFixture(activityFixture);
      await expect(registry.connect(organiser).issueRecommendation(5n, hashRecord(recDoc(5))))
        .to.be.revertedWithCustomError(registry, "RecordNotFound")
        .withArgs(5n);
    });

    it("TC-25: another organiser cannot recommend a student from someone else's activity", async function () {
      const { registry, organiser2, recordId } = await loadFixture(issuedFixture);
      await expect(registry.connect(organiser2).issueRecommendation(recordId, hashRecord(recDoc()))).to.be.revertedWithCustomError(
        registry,
        "NotActivityOrganiser"
      );
    });

    it("TC-26: only one recommendation per participation record; cannot recommend a recommendation", async function () {
      const { registry, organiser, recordId } = await loadFixture(issuedFixture);
      await registry.connect(organiser).issueRecommendation(recordId, hashRecord(recDoc()));
      const second = { ...recDoc(), text: "Second letter" };
      await expect(registry.connect(organiser).issueRecommendation(recordId, hashRecord(second)))
        .to.be.revertedWithCustomError(registry, "RecommendationExists")
        .withArgs(recordId, 2n);
      await expect(registry.connect(organiser).issueRecommendation(2n, hashRecord(second)))
        .to.be.revertedWithCustomError(registry, "NotParticipationRecord")
        .withArgs(2n);
    });

    it("TC-27: cannot recommend a student whose participation record was revoked", async function () {
      const { registry, organiser, recordId } = await loadFixture(issuedFixture);
      await registry.connect(organiser).revokeRecord(recordId, "Issued in error");
      await expect(registry.connect(organiser).issueRecommendation(recordId, hashRecord(recDoc())))
        .to.be.revertedWithCustomError(registry, "RecordNotValid")
        .withArgs(recordId);
    });

    it("TC-28: revoking the participation record invalidates its recommendation (ParentRevoked)", async function () {
      const { registry, organiser, recordId } = await loadFixture(issuedFixture);
      const recHash = hashRecord(recDoc());
      await registry.connect(organiser).issueRecommendation(recordId, recHash);
      await registry.connect(organiser).revokeRecord(recordId, "Attendance disputed");
      expect(await registry.verifyRecord(2n, recHash)).to.equal(Result.ParentRevoked);
    });
  });

  // -------------------------------------------------------------------------
  describe("5. Verification (tamper detection)", function () {
    it("TC-29: verifier confirms an untouched record is Valid (no wallet / no gas)", async function () {
      const { registry, verifier, recordId, doc } = await loadFixture(issuedFixture);
      expect(await registry.connect(verifier).verifyRecord(recordId, hashRecord(doc))).to.equal(Result.Valid);
    });

    it("TC-30: an altered record is detected (HashMismatch)", async function () {
      const { registry, recordId, doc } = await loadFixture(issuedFixture);
      const tampered = structuredClone(doc);
      tampered.attendance.minutesPerSession[8] = 90; // student edits the PDF data to look better
      expect(await registry.verifyRecord(recordId, hashRecord(tampered))).to.equal(Result.HashMismatch);
      const renamed = { ...doc, student: { ...doc.student, name: "Mallory" } }; // someone claims Alice's record
      expect(await registry.verifyRecord(recordId, hashRecord(renamed))).to.equal(Result.HashMismatch);
    });

    it("TC-31: field order does not change the hash (canonical JSON)", async function () {
      const { registry, recordId, doc } = await loadFixture(issuedFixture);
      const reordered = { issuedOn: doc.issuedOn, attendance: doc.attendance, organiser: doc.organiser, activity: doc.activity, student: doc.student, schema: doc.schema };
      expect(await registry.verifyRecord(recordId, hashRecord(reordered))).to.equal(Result.Valid);
    });

    it("TC-32: unknown record id returns NotFound", async function () {
      const { registry, doc } = await loadFixture(issuedFixture);
      expect(await registry.verifyRecord(999n, hashRecord(doc))).to.equal(Result.NotFound);
    });

    it("TC-33: verifyByHash finds the record from the document alone", async function () {
      const { registry, doc, recordId } = await loadFixture(issuedFixture);
      const [id, result] = await registry.verifyByHash(hashRecord(doc));
      expect(id).to.equal(recordId);
      expect(result).to.equal(Result.Valid);
      const [missingId, missingResult] = await registry.verifyByHash(ethers.id("not issued"));
      expect(missingId).to.equal(0n);
      expect(missingResult).to.equal(Result.NotFound);
    });

    it("TC-34: getStudentRecords lists a student's records for the profile page", async function () {
      const { registry, organiser, organiser2, ref, recordId } = await loadFixture(issuedFixture);
      // Alice also volunteers with a second organiser.
      await registry.connect(organiser2).createActivity("Kigali Clean-up Drive", Category.Volunteering, 4, 3, 60);
      await registry.connect(organiser2).issueRecord(2n, ref, ethers.id("volunteering doc"), [120, 90, 60]);
      expect(await registry.getStudentRecords(ref)).to.deep.equal([recordId, 2n]);
      expect(await registry.getStudentRecords(studentRef(BOB.email))).to.deep.equal([]);
    });

    it("TC-35: getRecord on an unknown id reverts", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.getRecord(1n)).to.be.revertedWithCustomError(registry, "RecordNotFound").withArgs(1n);
    });
  });

  // -------------------------------------------------------------------------
  describe("6. Revocation", function () {
    it("TC-36: issuer revokes a record; verification then reports Revoked", async function () {
      const { registry, organiser, recordId, doc } = await loadFixture(issuedFixture);
      await expect(registry.connect(organiser).revokeRecord(recordId, "Issued in error"))
        .to.emit(registry, "RecordRevoked")
        .withArgs(recordId, organiser.address, "Issued in error");
      const r = await registry.getRecord(recordId);
      expect(r.status).to.equal(Status.Revoked);
      expect(r.revokedAt).to.be.greaterThan(0n);
      expect(await registry.verifyRecord(recordId, hashRecord(doc))).to.equal(Result.Revoked);
    });

    it("TC-37: admin can revoke any record", async function () {
      const { registry, admin, recordId } = await loadFixture(issuedFixture);
      await expect(registry.connect(admin).revokeRecord(recordId, "Misconduct finding"))
        .to.emit(registry, "RecordRevoked")
        .withArgs(recordId, admin.address, anyValue);
    });

    it("TC-38: other organisers and outsiders cannot revoke", async function () {
      const { registry, organiser2, outsider, recordId } = await loadFixture(issuedFixture);
      await expect(registry.connect(organiser2).revokeRecord(recordId, "x"))
        .to.be.revertedWithCustomError(registry, "NotAuthorisedToRevoke")
        .withArgs(recordId, organiser2.address);
      await expect(registry.connect(outsider).revokeRecord(recordId, "x")).to.be.revertedWithCustomError(
        registry,
        "NotAuthorisedToRevoke"
      );
    });

    it("TC-39: cannot revoke twice or revoke a missing record", async function () {
      const { registry, organiser, recordId } = await loadFixture(issuedFixture);
      await registry.connect(organiser).revokeRecord(recordId, "x");
      await expect(registry.connect(organiser).revokeRecord(recordId, "x")).to.be.revertedWithCustomError(registry, "RecordNotValid");
      await expect(registry.connect(organiser).revokeRecord(77n, "x")).to.be.revertedWithCustomError(registry, "RecordNotFound");
    });
  });

  // -------------------------------------------------------------------------
  describe("7. Emergency pause", function () {
    it("TC-40: pause blocks issuance and activity creation but not verification", async function () {
      const { registry, organiser, activityId, recordId, doc } = await loadFixture(issuedFixture);
      await registry.pause();
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB)), QUALIFIES)
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(organiser).createActivity("X", 0, 5, 3, 30)).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause"
      );
      await expect(registry.connect(organiser).issueRecommendation(recordId, ethers.id("rec"))).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause"
      );
      expect(await registry.verifyRecord(recordId, hashRecord(doc))).to.equal(Result.Valid);

      await registry.unpause();
      await expect(
        registry.connect(organiser).issueRecord(activityId, studentRef(BOB.email), hashRecord(participationDoc(BOB)), QUALIFIES)
      ).to.emit(registry, "RecordIssued");
    });

    it("TC-41: only admin can pause/unpause", async function () {
      const { registry, organiser } = await loadFixture(activityFixture);
      await expect(registry.connect(organiser).pause()).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(registry.connect(organiser).unpause()).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  // -------------------------------------------------------------------------
  describe("8. End-to-end pilot scenario", function () {
    it("TC-42: full flow - setup, check-ins, auto issuance, recommendation, verification, tamper, revoke", async function () {
      const { registry, admin, organiser, verifier } = await loadFixture(deployFixture);
      await registry.connect(admin).addOrganiser(organiser.address, "ALU Debate Club");
      await registry.connect(organiser).createActivity(ACTIVITY.name, Category.Leadership, 10, 8, 45);

      const students = [
        { s: ALICE, minutes: QUALIFIES, expect: "issued" },
        { s: BOB, minutes: SHORT_SESSIONS, expect: "withheld" },
        { s: { name: "Chloe Ishimwe", email: "c.ishimwe@alustudent.com" }, minutes: Array(10).fill(60), expect: "issued" },
      ];
      const issued = [];
      for (const { s, minutes, expect: outcome } of students) {
        const doc = participationDoc(s, minutes);
        const tx = registry.connect(organiser).issueRecord(1n, studentRef(s.email), hashRecord(doc), minutes);
        if (outcome === "issued") {
          await expect(tx).to.emit(registry, "RecordIssued");
          issued.push({ doc, id: await registry.recordCount() });
        } else {
          await expect(tx).to.be.revertedWithCustomError(registry, "RuleNotMet");
        }
      }
      expect(issued.length).to.equal(2);

      for (const { doc, id } of issued) {
        expect(await registry.connect(verifier).verifyRecord(id, hashRecord(doc))).to.equal(Result.Valid);
      }
      const forged = structuredClone(issued[0].doc);
      forged.activity.name = "ALU Student Guild - President";
      expect(await registry.verifyRecord(issued[0].id, hashRecord(forged))).to.equal(Result.HashMismatch);

      await registry.connect(organiser).revokeRecord(issued[1].id, "Test revocation");
      expect(await registry.verifyRecord(issued[1].id, hashRecord(issued[1].doc))).to.equal(Result.Revoked);
    });
  });
});
