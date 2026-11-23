/**
 * Off-chain helpers for MeritLink records.
 *
 * The blockchain stores only a SHA-256 fingerprint of each record. These helpers build the
 * record document and compute that fingerprint the same way every time, so a verifier who
 * hashes the same document gets the same value. frontend/index.html uses an identical
 * algorithm in the browser.
 */
const crypto = require("crypto");
const { ethers } = require("ethers");

/** Category and result labels, in the same order as the Solidity enums. */
const CATEGORY = ["Leadership", "Volunteering", "StudentOrganisation", "Mentorship", "CommunityEngagement"];
const VERIFICATION = ["NotFound", "Valid", "Revoked", "HashMismatch", "ParentRevoked"];
const KIND = ["Participation", "Recommendation"];

/**
 * Deterministic JSON: object keys are sorted at every level, so two semantically equal
 * records always serialise (and hash) identically, whatever order the fields were added in.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the canonical document, as a 0x-prefixed bytes32 hex string. */
function hashRecord(doc) {
  return "0x" + crypto.createHash("sha256").update(canonicalize(doc), "utf8").digest("hex");
}

/**
 * Pseudonymous student reference: keccak256(salt + ":" + lower-cased university email).
 * Without the platform's secret salt, the reference cannot be linked back to the email.
 */
function studentRef(email, salt = process.env.STUDENT_REF_SALT || "meritlink-demo-salt") {
  return ethers.id(`${salt}:${email.trim().toLowerCase()}`);
}

/** Builds the participation record document kept in the platform database. */
function buildParticipationRecord({ student, activity, organiser, attendedMinutes, issuedOn }) {
  return {
    schema: "meritlink.participation.v1",
    student: { name: student.name, email: student.email },
    activity: {
      name: activity.name,
      category: activity.category,
      rule: `Attend at least ${activity.minSessions} of ${activity.totalSessions} sessions, each for at least ${activity.minMinutes} minutes`,
    },
    organiser,
    attendance: { minutesPerSession: attendedMinutes },
    issuedOn,
  };
}

/** Builds a recommendation document. The full text stays off-chain. Only its hash is anchored. */
function buildRecommendation({ student, activity, organiser, participationRecordId, text, issuedOn }) {
  return {
    schema: "meritlink.recommendation.v1",
    student: { name: student.name, email: student.email },
    activity: activity.name,
    organiser,
    basedOnRecord: participationRecordId,
    text,
    issuedOn,
  };
}

module.exports = {
  CATEGORY,
  VERIFICATION,
  KIND,
  canonicalize,
  hashRecord,
  studentRef,
  buildParticipationRecord,
  buildRecommendation,
};
