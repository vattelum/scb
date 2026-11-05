// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {DocumentReference} from "@vattelum/document-registry/DocumentRegistry.sol";
import {DAAToken} from "./DAAToken.sol";

/// @title ContractRegistry — On-Chain Individual Contracts
/// @notice Stores contract records with content hashes, signatories, EIP-712 signatures,
///         legislation references, encrypted Arweave TX IDs, lifecycle events, and status.
///         Termination and completion use a propose/finalize model with a 30-day notice
///         window; any signatory can dispute an active proposal to cancel it. The stored
///         `status` only changes when a transaction records it — read `effectiveStatus()`
///         for the current logical state (e.g. a ripened proposal whose finalize tx
///         hasn't happened yet).
contract ContractRegistry {
    // ──────────────────────── Constants ───────────────────────────
    // Event-type constants use a decade-per-family scheme so additions
    // within a family can slot in without renumbering.

    // Creation / signing (0–19)
    uint8 public constant EVENT_CREATED = 0;
    uint8 public constant EVENT_SIGNED = 10;
    uint8 public constant EVENT_DECLINED = 11;
    uint8 public constant EVENT_ACTIVE = 12;

    // Termination family (20–29)
    uint8 public constant EVENT_TERMINATION_PROPOSED = 20;
    uint8 public constant EVENT_TERMINATED = 21;
    uint8 public constant EVENT_TERMINATION_CANCELLED = 22;
    uint8 public constant EVENT_TERMINATION_ACCEPTED = 23;
    uint8 public constant EVENT_TERMINATION_REJECTED = 24;

    // Completion family (30–39)
    uint8 public constant EVENT_COMPLETION_PROPOSED = 30;
    uint8 public constant EVENT_COMPLETED = 31;
    uint8 public constant EVENT_COMPLETION_CANCELLED = 32;
    uint8 public constant EVENT_COMPLETION_ACCEPTED = 33;
    uint8 public constant EVENT_COMPLETION_REJECTED = 34;

    // Dispute (40) — records objection, cancels any active proposal
    uint8 public constant EVENT_DISPUTED = 40;

    // Reserved (50) — unused in Product 4a, held for future amendment support
    uint8 public constant EVENT_AMENDED = 50;

    uint256 public constant SIGNING_WINDOW = 30 days;
    uint256 public constant TERMINATION_NOTICE_DAYS = 30 days;
    uint256 public constant COMPLETION_NOTICE_DAYS = 30 days;
    uint256 public constant STALE_THRESHOLD = 365 days;

    // ──────────────────────── Enums ──────────────────────────────

    enum Status {
        Created,
        Active,
        Declined,
        Expired,
        Terminated,
        Completed
    }

    // ──────────────────────── Structs ─────────────────────────────

    struct LifecycleEvent {
        uint8 eventType;
        address actor;
        uint256 timestamp;
        bytes32 reasonHash;
    }

    struct CreateParams {
        bytes32 contentHash;
        address[] signatories;
        string contentUri;
        DocumentReference[] references;
        address smartContractAddress;
        bytes32 bytecodeHash;
        uint256 smartContractChainId;
    }

    struct Contract {
        bytes32 contentHash;
        address[] signatories;
        bytes[] signatures;
        // Append-only audit trail of Arweave TX IDs supplied at each lifecycle step:
        // index 0 is the creator's upload; subsequent entries are pushed in sign-order
        // by each signing signatory. Every signatory in normal flow reuses the
        // creator's TX ID (one shared ECIES blob per contract), so all entries are
        // typically identical — but slot index does NOT correspond to signatory index.
        // Length grows from 1 (after createContract) up to 1 + signatures.length.
        string[] contentUris;
        DocumentReference[] references;
        uint8 status;
        LifecycleEvent[] events;
        uint256 createdAt;
        // Smart Contract Block reference — pointer to an external smart contract
        // that carries any on-chain enforcement logic for this contract.
        address smartContractAddress;
        bytes32 bytecodeHash;
        uint256 smartContractChainId;
    }

    // ──────────────────────── State ──────────────────────────────

    DAAToken public immutable daaToken;

    uint256 public contractCount;
    mapping(uint256 => Contract) private _contracts;
    mapping(address => uint256[]) private _partyContracts;
    mapping(uint256 => mapping(address => bool)) private _hasSigned;
    mapping(uint256 => mapping(address => bool)) private _isSignatory;

    // Termination proposal state — 0 / address(0) / bytes32(0) when no proposal active.
    mapping(uint256 => uint256) private _terminationProposedAt;
    mapping(uint256 => address) private _terminationProposer;
    mapping(uint256 => bytes32) private _terminationReasonHash;

    // Completion proposal state — 0 / address(0) / bytes32(0) when no proposal active.
    mapping(uint256 => uint256) private _completionProposedAt;
    mapping(uint256 => address) private _completionProposer;
    mapping(uint256 => bytes32) private _completionReasonHash;

    // Per-proposal acceptance tracking. Quorum rule: every non-proposer signatory
    // must call accept to short-circuit the 30-day window. Flags + count are
    // cleared whenever the underlying proposal clears (cancel / dispute / finalize
    // / quorum-reached transition), keeping the next proposal's slate clean.
    mapping(uint256 => mapping(address => bool)) private _terminationAccepted;
    mapping(uint256 => uint256) private _terminationAcceptCount;
    mapping(uint256 => mapping(address => bool)) private _completionAccepted;
    mapping(uint256 => uint256) private _completionAcceptCount;

    // ──────────────────────── Events ─────────────────────────────

    event ContractCreated(uint256 indexed contractId, address indexed creator);
    event ContractSigned(uint256 indexed contractId, address indexed signer);
    event ContractActive(uint256 indexed contractId);
    event ContractDeclined(uint256 indexed contractId, address indexed decliner);
    event ContractTerminated(uint256 indexed contractId, address indexed finalizer);
    event ContractCompleted(uint256 indexed contractId, address indexed finalizer);
    event ContractDisputed(uint256 indexed contractId, address indexed disputant);

    event TerminationProposed(
        uint256 indexed contractId,
        address indexed proposer,
        bytes32 reasonHash,
        uint256 noticeExpiresAt
    );
    event CompletionProposed(
        uint256 indexed contractId,
        address indexed proposer,
        bytes32 reasonHash,
        uint256 noticeExpiresAt
    );

    event TerminationCancelled(uint256 indexed contractId, address indexed proposer);
    event TerminationAccepted(uint256 indexed contractId, address indexed signatory);
    event TerminationRejected(uint256 indexed contractId, address indexed signatory);
    event CompletionCancelled(uint256 indexed contractId, address indexed proposer);
    event CompletionAccepted(uint256 indexed contractId, address indexed signatory);
    event CompletionRejected(uint256 indexed contractId, address indexed signatory);

    // ──────────────────────── Errors ─────────────────────────────

    error NotTokenHolder();
    error EmptyContentHash();
    error NoSignatories();
    error CreatorNotInSignatories();
    error DuplicateSignatory(address signatory);
    error ContractDoesNotExist(uint256 contractId);
    error NotSignatory(uint256 contractId, address caller);
    error AlreadySigned(uint256 contractId, address signer);
    error SigningWindowExpired(uint256 contractId);
    error InvalidStatus(uint256 contractId, uint8 current, uint8 required);
    error InvalidSignature();
    error ProposalAlreadyActive();
    error NoActiveProposal();
    error NoticeWindowNotElapsed();
    error NotProposer();
    error ProposerCannotAccept();
    error ProposerCannotReject();
    error AlreadyAccepted();

    // ──────────────────────── EIP-712 ─────────────────────────────

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private constant CONTRACT_SIGNATURE_TYPEHASH =
        keccak256(
            "ContractSignature(uint256 contractId,bytes32 documentHash,address contractRegistry,uint256 networkChainId)"
        );

    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    // ──────────────────────── Constructor ─────────────────────────

    constructor(address _daaToken) {
        daaToken = DAAToken(_daaToken);
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    // ──────────────────────── Public / External ──────────────────

    /// @notice Create a new contract record on-chain.
    function createContract(CreateParams calldata params) external returns (uint256 contractId) {
        if (daaToken.balanceOf(msg.sender) == 0) revert NotTokenHolder();
        if (params.contentHash == bytes32(0)) revert EmptyContentHash();
        if (params.signatories.length == 0) revert NoSignatories();

        // Creator must be in signatories array. Future agent model may remove this.
        bool creatorFound = false;
        for (uint256 i = 0; i < params.signatories.length; i++) {
            if (params.signatories[i] == msg.sender) {
                creatorFound = true;
                break;
            }
        }
        if (!creatorFound) revert CreatorNotInSignatories();

        contractId = ++contractCount;
        Contract storage c = _contracts[contractId];

        c.contentHash = params.contentHash;
        c.status = uint8(Status.Created);
        c.createdAt = block.timestamp;
        c.smartContractAddress = params.smartContractAddress;
        c.bytecodeHash = params.bytecodeHash;
        c.smartContractChainId = params.smartContractChainId;

        for (uint256 i = 0; i < params.signatories.length; i++) {
            address sig = params.signatories[i];
            // Reject duplicates so direct-RPC callers can't pollute _partyContracts
            // with repeated entries; the frontend already enforces uniqueness, this
            // is a safety net for non-UI contract creation paths.
            if (_isSignatory[contractId][sig]) revert DuplicateSignatory(sig);
            _isSignatory[contractId][sig] = true;
            c.signatories.push(sig);
            _partyContracts[sig].push(contractId);
        }

        c.contentUris.push(params.contentUri);

        for (uint256 i = 0; i < params.references.length; i++) {
            c.references.push(params.references[i]);
        }

        c.events.push(LifecycleEvent({
            eventType: EVENT_CREATED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit ContractCreated(contractId, msg.sender);
    }

    /// @notice Sign a contract with an EIP-712 signature.
    function sign(uint256 contractId, bytes calldata signature, string calldata contentUri) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Created)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Created));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_hasSigned[contractId][msg.sender]) {
            revert AlreadySigned(contractId, msg.sender);
        }
        if (block.timestamp > c.createdAt + SIGNING_WINDOW) {
            revert SigningWindowExpired(contractId);
        }

        address recovered = _verifySignature(contractId, signature);
        if (recovered != msg.sender) revert InvalidSignature();

        _hasSigned[contractId][msg.sender] = true;
        c.signatures.push(signature);
        c.contentUris.push(contentUri);

        c.events.push(LifecycleEvent({
            eventType: EVENT_SIGNED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit ContractSigned(contractId, msg.sender);

        if (_allSigned(contractId)) {
            c.status = uint8(Status.Active);
            c.events.push(LifecycleEvent({
                eventType: EVENT_ACTIVE,
                actor: msg.sender,
                timestamp: block.timestamp,
                reasonHash: bytes32(0)
            }));
            emit ContractActive(contractId);
        }
    }

    /// @notice Decline a contract. Only unsigned signatories on Created contracts.
    function decline(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Created)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Created));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_hasSigned[contractId][msg.sender]) {
            revert AlreadySigned(contractId, msg.sender);
        }

        c.status = uint8(Status.Declined);

        c.events.push(LifecycleEvent({
            eventType: EVENT_DECLINED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit ContractDeclined(contractId, msg.sender);
    }

    /// @notice Propose termination of an Active contract. Starts a 30-day notice window.
    ///         Any signatory can dispute during the window to cancel the proposal.
    function proposeTermination(uint256 contractId, bytes32 reasonHash) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_terminationProposedAt[contractId] != 0) revert ProposalAlreadyActive();

        _terminationProposedAt[contractId] = block.timestamp;
        _terminationProposer[contractId] = msg.sender;
        _terminationReasonHash[contractId] = reasonHash;

        c.events.push(LifecycleEvent({
            eventType: EVENT_TERMINATION_PROPOSED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: reasonHash
        }));

        emit TerminationProposed(
            contractId,
            msg.sender,
            reasonHash,
            block.timestamp + TERMINATION_NOTICE_DAYS
        );
    }

    /// @notice Finalize a termination proposal after the notice window has elapsed.
    ///         Anyone may call — the window is the gate, not caller identity.
    function finalizeTermination(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        uint256 proposedAt = _terminationProposedAt[contractId];
        if (proposedAt == 0) revert NoActiveProposal();
        if (block.timestamp < proposedAt + TERMINATION_NOTICE_DAYS) {
            revert NoticeWindowNotElapsed();
        }

        bytes32 storedReason = _terminationReasonHash[contractId];

        _clearTerminationProposal(contractId);

        c.status = uint8(Status.Terminated);

        c.events.push(LifecycleEvent({
            eventType: EVENT_TERMINATED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: storedReason
        }));

        emit ContractTerminated(contractId, msg.sender);
    }

    /// @notice Cancel an active termination proposal. Restricted to the original
    ///         proposer — non-proposers must dispute (which also cancels as a
    ///         side effect, but registers an objection rather than a withdrawal).
    function cancelTermination(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (_terminationProposedAt[contractId] == 0) revert NoActiveProposal();
        if (_terminationProposer[contractId] != msg.sender) revert NotProposer();

        _clearTerminationProposal(contractId);

        c.events.push(LifecycleEvent({
            eventType: EVENT_TERMINATION_CANCELLED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit TerminationCancelled(contractId, msg.sender);
    }

    /// @notice Accept an active termination proposal. Restricted to non-proposer
    ///         signatories. Quorum is unanimous-among-non-proposers: status flips
    ///         to Terminated on the last accept. Mirrors the silence-for-30-days
    ///         tacit quorum (all non-proposers must agree).
    function acceptTermination(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_terminationProposedAt[contractId] == 0) revert NoActiveProposal();
        if (_terminationProposer[contractId] == msg.sender) revert ProposerCannotAccept();
        if (_terminationAccepted[contractId][msg.sender]) revert AlreadyAccepted();

        _terminationAccepted[contractId][msg.sender] = true;
        uint256 newCount = _terminationAcceptCount[contractId] + 1;
        _terminationAcceptCount[contractId] = newCount;

        c.events.push(LifecycleEvent({
            eventType: EVENT_TERMINATION_ACCEPTED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit TerminationAccepted(contractId, msg.sender);

        // Quorum: every signatory except the proposer has now accepted.
        if (newCount == c.signatories.length - 1) {
            bytes32 storedReason = _terminationReasonHash[contractId];
            _clearTerminationProposal(contractId);

            c.status = uint8(Status.Terminated);
            c.events.push(LifecycleEvent({
                eventType: EVENT_TERMINATED,
                actor: msg.sender,
                timestamp: block.timestamp,
                reasonHash: storedReason
            }));
            emit ContractTerminated(contractId, msg.sender);
        }
    }

    /// @notice Reject an active termination proposal. Restricted to non-proposer
    ///         signatories. Clears proposal state (including accept tracking)
    ///         without registering the heavier `Disputed` legal posture — a
    ///         lightweight "no thanks, do not terminate" signal. Dispute remains
    ///         available as a separate posture-level action via `dispute()`.
    function rejectTermination(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_terminationProposedAt[contractId] == 0) revert NoActiveProposal();
        if (_terminationProposer[contractId] == msg.sender) revert ProposerCannotReject();

        _clearTerminationProposal(contractId);

        c.events.push(LifecycleEvent({
            eventType: EVENT_TERMINATION_REJECTED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit TerminationRejected(contractId, msg.sender);
    }

    /// @notice Propose completion of an Active contract. Starts a 30-day notice window.
    ///         Silence for the full window equals tacit agreement — any signatory may
    ///         finalize after the window elapses. Any signatory can dispute to cancel.
    function proposeCompletion(uint256 contractId, bytes32 reasonHash) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_completionProposedAt[contractId] != 0) revert ProposalAlreadyActive();

        _completionProposedAt[contractId] = block.timestamp;
        _completionProposer[contractId] = msg.sender;
        _completionReasonHash[contractId] = reasonHash;

        c.events.push(LifecycleEvent({
            eventType: EVENT_COMPLETION_PROPOSED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: reasonHash
        }));

        emit CompletionProposed(
            contractId,
            msg.sender,
            reasonHash,
            block.timestamp + COMPLETION_NOTICE_DAYS
        );
    }

    /// @notice Finalize a completion proposal after the notice window has elapsed.
    function finalizeCompletion(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        uint256 proposedAt = _completionProposedAt[contractId];
        if (proposedAt == 0) revert NoActiveProposal();
        if (block.timestamp < proposedAt + COMPLETION_NOTICE_DAYS) {
            revert NoticeWindowNotElapsed();
        }

        bytes32 storedReason = _completionReasonHash[contractId];

        _clearCompletionProposal(contractId);

        c.status = uint8(Status.Completed);

        c.events.push(LifecycleEvent({
            eventType: EVENT_COMPLETED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: storedReason
        }));

        emit ContractCompleted(contractId, msg.sender);
    }

    /// @notice Cancel an active completion proposal. Symmetric to cancelTermination.
    function cancelCompletion(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (_completionProposedAt[contractId] == 0) revert NoActiveProposal();
        if (_completionProposer[contractId] != msg.sender) revert NotProposer();

        _clearCompletionProposal(contractId);

        c.events.push(LifecycleEvent({
            eventType: EVENT_COMPLETION_CANCELLED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit CompletionCancelled(contractId, msg.sender);
    }

    /// @notice Accept an active completion proposal. Symmetric to acceptTermination.
    function acceptCompletion(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_completionProposedAt[contractId] == 0) revert NoActiveProposal();
        if (_completionProposer[contractId] == msg.sender) revert ProposerCannotAccept();
        if (_completionAccepted[contractId][msg.sender]) revert AlreadyAccepted();

        _completionAccepted[contractId][msg.sender] = true;
        uint256 newCount = _completionAcceptCount[contractId] + 1;
        _completionAcceptCount[contractId] = newCount;

        c.events.push(LifecycleEvent({
            eventType: EVENT_COMPLETION_ACCEPTED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit CompletionAccepted(contractId, msg.sender);

        if (newCount == c.signatories.length - 1) {
            bytes32 storedReason = _completionReasonHash[contractId];
            _clearCompletionProposal(contractId);

            c.status = uint8(Status.Completed);
            c.events.push(LifecycleEvent({
                eventType: EVENT_COMPLETED,
                actor: msg.sender,
                timestamp: block.timestamp,
                reasonHash: storedReason
            }));
            emit ContractCompleted(contractId, msg.sender);
        }
    }

    /// @notice Reject an active completion proposal. Symmetric to rejectTermination.
    function rejectCompletion(uint256 contractId) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status != uint8(Status.Active)) {
            revert InvalidStatus(contractId, c.status, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }
        if (_completionProposedAt[contractId] == 0) revert NoActiveProposal();
        if (_completionProposer[contractId] == msg.sender) revert ProposerCannotReject();

        _clearCompletionProposal(contractId);

        c.events.push(LifecycleEvent({
            eventType: EVENT_COMPLETION_REJECTED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: bytes32(0)
        }));

        emit CompletionRejected(contractId, msg.sender);
    }

    /// @notice Record a dispute. If an active termination or completion proposal
    ///         exists, the proposal is cancelled. Otherwise this is a pure timeline
    ///         record (no state change). Callable on Active, Terminated, or Completed.
    function dispute(uint256 contractId, bytes32 reasonHash) external {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        uint8 s = c.status;
        if (s != uint8(Status.Active) && s != uint8(Status.Terminated) && s != uint8(Status.Completed)) {
            revert InvalidStatus(contractId, s, uint8(Status.Active));
        }
        if (!_isSignatory[contractId][msg.sender]) {
            revert NotSignatory(contractId, msg.sender);
        }

        // Dispute absorbs "contest": cancel any active proposal. Clearing also
        // resets per-signatory accept tracking so a future re-propose starts
        // from a clean slate.
        _clearTerminationProposal(contractId);
        _clearCompletionProposal(contractId);

        c.events.push(LifecycleEvent({
            eventType: EVENT_DISPUTED,
            actor: msg.sender,
            timestamp: block.timestamp,
            reasonHash: reasonHash
        }));

        emit ContractDisputed(contractId, msg.sender);
    }

    // ──────────────────────── Read Functions ─────────────────────

    /// @notice Returns the contract record's core + SCB fields.
    /// @dev Lifecycle events are returned by `getEvents` instead — keeping them
    ///      out of this tuple avoids unbounded return sizes for long-lived
    ///      contracts. Frontend callers fan out the two reads in parallel.
    function getContract(uint256 contractId)
        external
        view
        returns (
            bytes32 contentHash,
            address[] memory signatories,
            bytes[] memory signatures,
            string[] memory contentUris,
            DocumentReference[] memory references,
            uint8 status,
            uint256 createdAt,
            address smartContractAddress,
            bytes32 bytecodeHash,
            uint256 smartContractChainId
        )
    {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];
        return (
            c.contentHash,
            c.signatories,
            c.signatures,
            c.contentUris,
            c.references,
            c.status,
            c.createdAt,
            c.smartContractAddress,
            c.bytecodeHash,
            c.smartContractChainId
        );
    }

    /// @notice Returns the effective status of a contract, computed at read time.
    ///         Resolves two divergences between stored status and logical truth:
    ///          - Created contracts past the signing window → Expired
    ///          - Active contracts with a ripened termination proposal → Terminated
    ///          - Active contracts with a ripened completion proposal → Completed
    ///         The stored status only changes when a transaction records it
    ///         (decline / auto-activate / finalize). UI should render this.
    function effectiveStatus(uint256 contractId) external view returns (uint8) {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];

        if (c.status == uint8(Status.Created)) {
            if (block.timestamp > c.createdAt + SIGNING_WINDOW) {
                return uint8(Status.Expired);
            }
            return c.status;
        }

        if (c.status != uint8(Status.Active)) return c.status;

        uint256 tp = _terminationProposedAt[contractId];
        if (tp > 0 && block.timestamp >= tp + TERMINATION_NOTICE_DAYS) {
            return uint8(Status.Terminated);
        }
        uint256 cp = _completionProposedAt[contractId];
        if (cp > 0 && block.timestamp >= cp + COMPLETION_NOTICE_DAYS) {
            return uint8(Status.Completed);
        }
        return c.status;
    }

    /// @notice Returns true if a contract has had no lifecycle activity in STALE_THRESHOLD.
    ///         Completed / Declined / Expired contracts are never stale.
    function isStale(uint256 contractId) external view returns (bool) {
        _requireContract(contractId);
        Contract storage c = _contracts[contractId];
        if (c.status == uint8(Status.Completed)) return false;
        if (c.status == uint8(Status.Declined)) return false;
        if (c.status == uint8(Status.Expired)) return false;
        if (c.events.length == 0) return false;
        uint256 lastEventAt = c.events[c.events.length - 1].timestamp;
        return block.timestamp > lastEventAt + STALE_THRESHOLD;
    }

    /// @notice Returns the active termination proposal, if any.
    ///         proposedAt == 0 means no proposal is active.
    function getTerminationProposal(uint256 contractId)
        external
        view
        returns (uint256 proposedAt, address proposer, bytes32 reasonHash, uint256 noticeExpiresAt)
    {
        _requireContract(contractId);
        proposedAt = _terminationProposedAt[contractId];
        proposer = _terminationProposer[contractId];
        reasonHash = _terminationReasonHash[contractId];
        noticeExpiresAt = proposedAt == 0 ? 0 : proposedAt + TERMINATION_NOTICE_DAYS;
    }

    /// @notice Returns the active completion proposal, if any.
    ///         proposedAt == 0 means no proposal is active.
    function getCompletionProposal(uint256 contractId)
        external
        view
        returns (uint256 proposedAt, address proposer, bytes32 reasonHash, uint256 noticeExpiresAt)
    {
        _requireContract(contractId);
        proposedAt = _completionProposedAt[contractId];
        proposer = _completionProposer[contractId];
        reasonHash = _completionReasonHash[contractId];
        noticeExpiresAt = proposedAt == 0 ? 0 : proposedAt + COMPLETION_NOTICE_DAYS;
    }

    /// @notice Returns whether a signatory has accepted the active termination proposal.
    ///         False if no proposal is active.
    function hasAcceptedTermination(uint256 contractId, address signatory) external view returns (bool) {
        return _terminationAccepted[contractId][signatory];
    }

    /// @notice Returns the number of accepts on the active termination proposal.
    ///         Quorum is `signatories.length - 1` (every non-proposer).
    function getTerminationAcceptCount(uint256 contractId) external view returns (uint256) {
        return _terminationAcceptCount[contractId];
    }

    /// @notice Returns whether a signatory has accepted the active completion proposal.
    function hasAcceptedCompletion(uint256 contractId, address signatory) external view returns (bool) {
        return _completionAccepted[contractId][signatory];
    }

    /// @notice Returns the number of accepts on the active completion proposal.
    function getCompletionAcceptCount(uint256 contractId) external view returns (uint256) {
        return _completionAcceptCount[contractId];
    }

    /// @notice Returns contract IDs where the address is a listed signatory.
    function getContractsByParty(address party) external view returns (uint256[] memory) {
        return _partyContracts[party];
    }

    /// @notice Returns the total number of contracts created.
    function getContractCount() external view returns (uint256) {
        return contractCount;
    }

    /// @notice Returns the lifecycle events for a contract.
    function getEvents(uint256 contractId) external view returns (LifecycleEvent[] memory) {
        _requireContract(contractId);
        return _contracts[contractId].events;
    }

    /// @notice Returns the EIP-712 domain separator. Recomputed on chain-id mismatch
    ///         so forked chains cannot reuse the cached mainnet separator.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    /// @notice Returns whether a signatory has signed a contract.
    function hasSigned(uint256 contractId, address signer) external view returns (bool) {
        return _hasSigned[contractId][signer];
    }

    /// @notice Returns whether an address is a signatory on a contract.
    function isSignatory(uint256 contractId, address addr) external view returns (bool) {
        return _isSignatory[contractId][addr];
    }

    // ──────────────────────── Internal ────────────────────────────

    function _requireContract(uint256 contractId) internal view {
        if (contractId == 0 || contractId > contractCount) {
            revert ContractDoesNotExist(contractId);
        }
    }

    function _verifySignature(uint256 contractId, bytes calldata signature)
        internal
        view
        returns (address)
    {
        Contract storage c = _contracts[contractId];

        bytes32 structHash = keccak256(
            abi.encode(
                CONTRACT_SIGNATURE_TYPEHASH,
                contractId,
                c.contentHash,
                address(this),
                block.chainid
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), structHash)
        );

        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // EIP-2: reject non-canonical (high-s) signatures outright.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert InvalidSignature();
        }
        if (v != 27 && v != 28) revert InvalidSignature();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();

        return recovered;
    }

    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
        return _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("ContractRegistry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @dev Zero the termination proposal slots AND any per-signatory accept
    ///      flags + count. Called from every path that ends a termination
    ///      proposal (cancel, dispute, finalize, quorum-reached transition).
    function _clearTerminationProposal(uint256 contractId) internal {
        if (_terminationProposedAt[contractId] == 0) return;
        _terminationProposedAt[contractId] = 0;
        _terminationProposer[contractId] = address(0);
        _terminationReasonHash[contractId] = bytes32(0);
        address[] storage sigs = _contracts[contractId].signatories;
        for (uint256 i = 0; i < sigs.length; i++) {
            if (_terminationAccepted[contractId][sigs[i]]) {
                _terminationAccepted[contractId][sigs[i]] = false;
            }
        }
        _terminationAcceptCount[contractId] = 0;
    }

    /// @dev Symmetric to _clearTerminationProposal. See its docs.
    function _clearCompletionProposal(uint256 contractId) internal {
        if (_completionProposedAt[contractId] == 0) return;
        _completionProposedAt[contractId] = 0;
        _completionProposer[contractId] = address(0);
        _completionReasonHash[contractId] = bytes32(0);
        address[] storage sigs = _contracts[contractId].signatories;
        for (uint256 i = 0; i < sigs.length; i++) {
            if (_completionAccepted[contractId][sigs[i]]) {
                _completionAccepted[contractId][sigs[i]] = false;
            }
        }
        _completionAcceptCount[contractId] = 0;
    }

    function _allSigned(uint256 contractId) internal view returns (bool) {
        Contract storage c = _contracts[contractId];
        for (uint256 i = 0; i < c.signatories.length; i++) {
            if (!_hasSigned[contractId][c.signatories[i]]) {
                return false;
            }
        }
        return true;
    }
}
