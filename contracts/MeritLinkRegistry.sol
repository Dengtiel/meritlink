// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  MeritLinkRegistry
 * @author Deng Mayen Deng Akol (African Leadership University)
 * @notice On-chain integrity layer for MeritLink, a Linktree-style platform where students
 *         share verified records of their extracurricular participation and digital
 *         recommendations.
 *
 * @dev    How the pieces fit together
 *         ---------------------------
 *         1. A university administrator (DEFAULT_ADMIN_ROLE) approves activity organisers
 *            (club leaders, staff who run events) by granting them ORGANISER_ROLE.
 *         2. An organiser creates an activity once and sets its participation rule, e.g.
 *            "attend at least 8 of 10 sessions, each for at least 45 minutes".
 *         3. During each session, students scan a rotating QR code at check-in and check-out.
 *            The web app (off-chain) checks the QR token, the session time window and the
 *            device location, and works out how many minutes each student attended.
 *         4. When the organiser (or the platform acting with the organiser's key) submits a
 *            student's attended minutes, THIS CONTRACT re-applies the participation rule.
 *            The record is anchored only if the rule is met. Nobody reviews claims by hand,
 *            and nobody can issue a record that breaks the rule the organiser published.
 *         5. Only a SHA-256 fingerprint of the full record is stored on-chain, along with the
 *            issuing organiser and the issue date. Names, emails and recommendation text stay
 *            in the platform's access-controlled database. Students are identified by a
 *            salted pseudonymous reference (`studentRef`), never by personal data.
 *         6. Anyone (an employer, a scholarship committee) can call `verifyRecord` with the
 *            hash of the document they were given. The contract reports whether it is valid,
 *            revoked, unknown, or whether the document was altered.
 *
 *         Design notes
 *         - The contract never holds ether and makes no external calls, so re-entrancy is
 *           not a concern. Access control uses OpenZeppelin's audited AccessControl.
 *         - Custom errors are used instead of revert strings to save gas and to give
 *           callers machine-readable failure reasons.
 *         - Pausable lets the administrator freeze issuance if an organiser key is
 *           compromised. Verification (read-only) keeps working while paused.
 */
contract MeritLinkRegistry is AccessControl, Pausable {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @notice Role held by approved activity organisers (club leaders, event staff).
    bytes32 public constant ORGANISER_ROLE = keccak256("ORGANISER_ROLE");

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Contribution categories supported in the pilot (proposal section 1.5).
    enum Category {
        Leadership,
        Volunteering,
        StudentOrganisation,
        Mentorship,
        CommunityEngagement
    }

    /// @notice A record is either proof of participation or a recommendation that builds on one.
    enum RecordKind {
        Participation,
        Recommendation
    }

    /// @notice Lifecycle status stored for each record.
    enum RecordStatus {
        None, // default value: the record does not exist
        Valid,
        Revoked
    }

    /// @notice Outcome returned to a verifier by `verifyRecord`.
    enum VerificationResult {
        NotFound, // no record with this id
        Valid, // record exists, is not revoked, and the hash matches
        Revoked, // record was revoked by its issuer or the administrator
        HashMismatch, // the document presented differs from what was issued (altered)
        ParentRevoked // a recommendation whose underlying participation record was revoked
    }

    /// @notice An activity and its participation rule, as defined by the organiser.
    struct Activity {
        address organiser; // organiser who owns the activity and may issue its records
        uint16 totalSessions; // number of sessions planned
        uint16 minSessions; // qualifying sessions a student needs
        uint16 minMinutesPerSession; // minutes (check-in to check-out) for a session to qualify
        uint64 createdAt; // block timestamp at creation
        bool active; // closed activities cannot issue new records
        Category category;
        string name; // public, non-personal activity title (e.g. "ALU Debate Club - Term 1")
    }

    /// @notice An issued participation record or recommendation.
    struct Record {
        bytes32 recordHash; // SHA-256 of the canonical off-chain record document
        bytes32 studentRef; // salted pseudonymous student reference (no personal data)
        uint256 activityId; // activity this record belongs to
        uint256 parentRecordId; // for recommendations: the participation record it builds on
        address issuer; // organiser address that issued the record
        uint64 issuedAt; // block timestamp of issuance
        uint64 revokedAt; // 0 while valid
        uint16 qualifyingSessions; // sessions that met the duration rule (participation only)
        RecordKind kind;
        RecordStatus status;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Public display name of each organiser address (shown to verifiers).
    mapping(address => string) public organiserName;

    /// @notice Activity id => activity. Ids start at 1 so that 0 can mean "none".
    mapping(uint256 => Activity) private _activities;

    /// @notice Record id => record. Ids start at 1 so that 0 can mean "none".
    mapping(uint256 => Record) private _records;

    /// @notice Record hash => record id, so a verifier holding only a document can find its record.
    mapping(bytes32 => uint256) public recordIdByHash;

    /// @notice Student reference => ids of all their records (feeds the Linktree-style profile).
    mapping(bytes32 => uint256[]) private _studentRecords;

    /// @notice activityId => studentRef => participation record id (stops duplicate issuance).
    mapping(uint256 => mapping(bytes32 => uint256)) public participationRecordOf;

    /// @notice Participation record id => recommendation record id (one recommendation per record).
    mapping(uint256 => uint256) public recommendationOf;

    /// @notice Number of activities created so far (also the latest activity id).
    uint256 public activityCount;

    /// @notice Number of records issued so far (also the latest record id).
    uint256 public recordCount;

    /// @dev Upper bound on sessions per activity. It keeps the rule-checking loop cheap.
    uint16 public constant MAX_SESSIONS = 200;

    // ---------------------------------------------------------------------
    // Events (indexed fields let the web app and verifiers filter logs cheaply)
    // ---------------------------------------------------------------------

    event OrganiserAdded(address indexed organiser, string name);
    event OrganiserRemoved(address indexed organiser);

    event ActivityCreated(
        uint256 indexed activityId,
        address indexed organiser,
        Category category,
        string name,
        uint16 totalSessions,
        uint16 minSessions,
        uint16 minMinutesPerSession
    );
    event ActivityClosed(uint256 indexed activityId);

    event RecordIssued(
        uint256 indexed recordId,
        uint256 indexed activityId,
        bytes32 indexed studentRef,
        RecordKind kind,
        bytes32 recordHash,
        address issuer,
        uint16 qualifyingSessions
    );
    event RecordRevoked(uint256 indexed recordId, address indexed revokedBy, string reason);

    // ---------------------------------------------------------------------
    // Custom errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error EmptyName();
    error InvalidRule();
    error ActivityNotFound(uint256 activityId);
    error ActivityClosedError(uint256 activityId);
    error NotActivityOrganiser(uint256 activityId, address caller);
    error InvalidStudentRef();
    error InvalidRecordHash();
    error HashAlreadyAnchored(bytes32 recordHash, uint256 existingRecordId);
    error AlreadyIssued(uint256 activityId, bytes32 studentRef, uint256 existingRecordId);
    error TooManySessions(uint256 provided, uint16 allowed);
    error RuleNotMet(uint16 qualifyingSessions, uint16 requiredSessions);
    error RecordNotFound(uint256 recordId);
    error RecordNotValid(uint256 recordId);
    error NotParticipationRecord(uint256 recordId);
    error RecommendationExists(uint256 participationRecordId, uint256 recommendationId);
    error NotAuthorisedToRevoke(uint256 recordId, address caller);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    /// @dev Reverts unless `activityId` exists and the caller is the organiser who created it
    ///      and still holds ORGANISER_ROLE.
    modifier onlyActivityOrganiser(uint256 activityId) {
        Activity storage a = _activities[activityId];
        if (a.organiser == address(0)) revert ActivityNotFound(activityId);
        if (a.organiser != msg.sender || !hasRole(ORGANISER_ROLE, msg.sender)) {
            revert NotActivityOrganiser(activityId, msg.sender);
        }
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param admin Address of the university administrator who approves organisers.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // =====================================================================
    // Administration
    // =====================================================================

    /**
     * @notice Approve an organiser so they can create activities and issue records.
     * @param organiser Wallet address of the organiser.
     * @param name      Public display name shown to verifiers (e.g. "ALU Debate Club").
     */
    function addOrganiser(address organiser, string calldata name) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (organiser == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        organiserName[organiser] = name;
        _grantRole(ORGANISER_ROLE, organiser);
        emit OrganiserAdded(organiser, name);
    }

    /**
     * @notice Remove an organiser. They can no longer issue records, but records they already
     *         issued stay valid. To withdraw a record, revoke it explicitly.
     */
    function removeOrganiser(address organiser) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ORGANISER_ROLE, organiser);
        emit OrganiserRemoved(organiser);
    }

    /// @notice Emergency stop: blocks activity creation and issuance. Verification still works.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resume normal operation after a pause.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =====================================================================
    // Activities
    // =====================================================================

    /**
     * @notice Create an activity and publish its participation rule. The organiser sets this up
     *         once and does not review individual students afterwards.
     * @param name                 Public activity title.
     * @param category             Contribution category.
     * @param totalSessions        Sessions planned (1..MAX_SESSIONS).
     * @param minSessions          Qualifying sessions needed (1..totalSessions).
     * @param minMinutesPerSession Minutes between check-in and check-out for a session to count (>0).
     * @return activityId          Id of the new activity.
     */
    function createActivity(
        string calldata name,
        Category category,
        uint16 totalSessions,
        uint16 minSessions,
        uint16 minMinutesPerSession
    ) external onlyRole(ORGANISER_ROLE) whenNotPaused returns (uint256 activityId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (
            totalSessions == 0 ||
            totalSessions > MAX_SESSIONS ||
            minSessions == 0 ||
            minSessions > totalSessions ||
            minMinutesPerSession == 0
        ) revert InvalidRule();

        activityId = ++activityCount;
        _activities[activityId] = Activity({
            organiser: msg.sender,
            totalSessions: totalSessions,
            minSessions: minSessions,
            minMinutesPerSession: minMinutesPerSession,
            createdAt: uint64(block.timestamp),
            active: true,
            category: category,
            name: name
        });

        emit ActivityCreated(activityId, msg.sender, category, name, totalSessions, minSessions, minMinutesPerSession);
    }

    /// @notice Close an activity so no further records can be issued for it.
    function closeActivity(uint256 activityId) external onlyActivityOrganiser(activityId) {
        _activities[activityId].active = false;
        emit ActivityClosed(activityId);
    }

    // =====================================================================
    // Issuance
    // =====================================================================

    /**
     * @notice Issue a participation record. The contract applies the activity's rule to the
     *         attendance evidence itself, so a record cannot be issued if the rule is not met.
     *
     * @param activityId      Activity the student took part in.
     * @param studentRef      Salted pseudonymous reference for the student (no personal data).
     * @param recordHash      SHA-256 of the canonical record document stored off-chain.
     * @param attendedMinutes Minutes between check-in and check-out for each session the student
     *                        scanned into. The scans were validated off-chain (rotating QR,
     *                        session window, location). Sessions shorter than the activity's
     *                        minimum are ignored.
     * @return recordId       Id of the new record.
     */
    function issueRecord(
        uint256 activityId,
        bytes32 studentRef,
        bytes32 recordHash,
        uint16[] calldata attendedMinutes
    ) external onlyActivityOrganiser(activityId) whenNotPaused returns (uint256 recordId) {
        Activity storage a = _activities[activityId];
        if (!a.active) revert ActivityClosedError(activityId);
        if (studentRef == bytes32(0)) revert InvalidStudentRef();
        _requireFreshHash(recordHash);

        uint256 existing = participationRecordOf[activityId][studentRef];
        if (existing != 0) revert AlreadyIssued(activityId, studentRef, existing);

        // Apply the participation rule on-chain.
        uint16 qualifying = _countQualifyingSessions(a, attendedMinutes);
        if (qualifying < a.minSessions) revert RuleNotMet(qualifying, a.minSessions);

        recordId = _storeRecord(recordHash, studentRef, activityId, 0, qualifying, RecordKind.Participation);
        participationRecordOf[activityId][studentRef] = recordId;
    }

    /**
     * @notice Issue a recommendation for a student who already holds a valid participation
     *         record in one of the caller's activities. This enforces the proposal's rule that
     *         organisers can only recommend students who met the participation rule.
     * @param participationRecordId The student's participation record for the activity.
     * @param recommendationHash    SHA-256 of the recommendation document (text stays off-chain).
     * @return recordId             Id of the new recommendation record.
     */
    function issueRecommendation(
        uint256 participationRecordId,
        bytes32 recommendationHash
    ) external whenNotPaused returns (uint256 recordId) {
        Record storage p = _records[participationRecordId];
        if (p.status == RecordStatus.None) revert RecordNotFound(participationRecordId);
        if (p.kind != RecordKind.Participation) revert NotParticipationRecord(participationRecordId);
        if (p.status != RecordStatus.Valid) revert RecordNotValid(participationRecordId);

        // Only the organiser of the underlying activity may recommend, and only while approved.
        Activity storage a = _activities[p.activityId];
        if (a.organiser != msg.sender || !hasRole(ORGANISER_ROLE, msg.sender)) {
            revert NotActivityOrganiser(p.activityId, msg.sender);
        }

        uint256 existing = recommendationOf[participationRecordId];
        if (existing != 0) revert RecommendationExists(participationRecordId, existing);
        _requireFreshHash(recommendationHash);

        recordId = _storeRecord(
            recommendationHash,
            p.studentRef,
            p.activityId,
            participationRecordId,
            0,
            RecordKind.Recommendation
        );
        recommendationOf[participationRecordId] = recordId;
    }

    // =====================================================================
    // Revocation
    // =====================================================================

    /**
     * @notice Revoke a record, for example after it was issued in error or misconduct was found.
     *         The record stays on-chain for audit, but verification reports it as revoked.
     *         A recommendation that depends on a revoked participation record is reported as
     *         `ParentRevoked`.
     * @dev    Allowed for the original issuer while they still hold ORGANISER_ROLE, or the admin.
     * @param recordId Record to revoke.
     * @param reason   Short public reason (kept in the event log only, which saves storage gas).
     */
    function revokeRecord(uint256 recordId, string calldata reason) external {
        Record storage r = _records[recordId];
        if (r.status == RecordStatus.None) revert RecordNotFound(recordId);
        if (r.status != RecordStatus.Valid) revert RecordNotValid(recordId);

        bool isIssuer = r.issuer == msg.sender && hasRole(ORGANISER_ROLE, msg.sender);
        if (!isIssuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorisedToRevoke(recordId, msg.sender);
        }

        r.status = RecordStatus.Revoked;
        r.revokedAt = uint64(block.timestamp);
        emit RecordRevoked(recordId, msg.sender, reason);
    }

    // =====================================================================
    // Verification and read functions (free to call; no wallet needed)
    // =====================================================================

    /**
     * @notice Check a document a verifier was given against the on-chain record.
     * @param recordId      Record id printed on the PDF or shown on the profile.
     * @param candidateHash SHA-256 of the document the verifier holds.
     * @return result       Outcome of the check (see VerificationResult).
     */
    function verifyRecord(uint256 recordId, bytes32 candidateHash) public view returns (VerificationResult result) {
        Record storage r = _records[recordId];
        if (r.status == RecordStatus.None) return VerificationResult.NotFound;
        if (r.recordHash != candidateHash) return VerificationResult.HashMismatch;
        if (r.status == RecordStatus.Revoked) return VerificationResult.Revoked;
        if (r.kind == RecordKind.Recommendation && _records[r.parentRecordId].status != RecordStatus.Valid) {
            return VerificationResult.ParentRevoked;
        }
        return VerificationResult.Valid;
    }

    /// @notice Verify using only the document hash (for when the record id is not known).
    function verifyByHash(bytes32 candidateHash) external view returns (uint256 recordId, VerificationResult result) {
        recordId = recordIdByHash[candidateHash];
        result = recordId == 0 ? VerificationResult.NotFound : verifyRecord(recordId, candidateHash);
    }

    /// @notice Full details of a record.
    function getRecord(uint256 recordId) external view returns (Record memory) {
        if (_records[recordId].status == RecordStatus.None) revert RecordNotFound(recordId);
        return _records[recordId];
    }

    /// @notice Full details of an activity, including its participation rule.
    function getActivity(uint256 activityId) external view returns (Activity memory) {
        if (_activities[activityId].organiser == address(0)) revert ActivityNotFound(activityId);
        return _activities[activityId];
    }

    /// @notice All record ids belonging to a student (used to build their public profile).
    function getStudentRecords(bytes32 studentRef) external view returns (uint256[] memory) {
        return _studentRecords[studentRef];
    }

    /// @notice True if `account` is a currently approved organiser.
    function isOrganiser(address account) external view returns (bool) {
        return hasRole(ORGANISER_ROLE, account);
    }

    // =====================================================================
    // Internal helpers
    // =====================================================================

    /// @dev Counts sessions whose attended minutes meet the activity minimum.
    function _countQualifyingSessions(
        Activity storage a,
        uint16[] calldata attendedMinutes
    ) private view returns (uint16 qualifying) {
        uint256 len = attendedMinutes.length;
        // A student cannot have attended more sessions than the activity has.
        if (len > a.totalSessions) revert TooManySessions(len, a.totalSessions);
        uint16 minMinutes = a.minMinutesPerSession;
        for (uint256 i; i < len; ) {
            if (attendedMinutes[i] >= minMinutes) {
                unchecked {
                    ++qualifying; // bounded by totalSessions <= MAX_SESSIONS, cannot overflow
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Reverts if the hash is empty or already anchored. A unique hash means every record
    ///      id resolves to one document, and one document resolves to one record id.
    function _requireFreshHash(bytes32 recordHash) private view {
        if (recordHash == bytes32(0)) revert InvalidRecordHash();
        uint256 existing = recordIdByHash[recordHash];
        if (existing != 0) revert HashAlreadyAnchored(recordHash, existing);
    }

    /// @dev Writes a new record, indexes it and emits RecordIssued.
    function _storeRecord(
        bytes32 recordHash,
        bytes32 studentRef,
        uint256 activityId,
        uint256 parentRecordId,
        uint16 qualifyingSessions,
        RecordKind kind
    ) private returns (uint256 recordId) {
        recordId = ++recordCount;
        _records[recordId] = Record({
            recordHash: recordHash,
            studentRef: studentRef,
            activityId: activityId,
            parentRecordId: parentRecordId,
            issuer: msg.sender,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0,
            qualifyingSessions: qualifyingSessions,
            kind: kind,
            status: RecordStatus.Valid
        });
        recordIdByHash[recordHash] = recordId;
        _studentRecords[studentRef].push(recordId);

        emit RecordIssued(recordId, activityId, studentRef, kind, recordHash, msg.sender, qualifyingSessions);
    }
}
