// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {DAAToken} from "../src/DAAToken.sol";
import {ContractRegistry} from "../src/ContractRegistry.sol";
import {DocumentReference} from "@vattelum/document-registry/DocumentRegistry.sol";

contract ContractRegistryTest is Test {
    DAAToken token;
    ContractRegistry registry;

    address admin = makeAddr("admin");
    address alice;
    uint256 alicePk;
    address bob;
    uint256 bobPk;
    address charlie;
    uint256 charliePk;
    address stranger = makeAddr("stranger");

    bytes32 constant HASH_A = keccak256("document-a");
    bytes32 constant HASH_B = keccak256("document-b");
    bytes32 constant REASON_A = keccak256("reason-a");

    // Mirror events for expectEmit
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

    function setUp() public {
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk) = makeAddrAndKey("bob");
        (charlie, charliePk) = makeAddrAndKey("charlie");

        token = new DAAToken(admin, true, false);
        registry = new ContractRegistry(address(token));

        vm.prank(alice);
        token.mint("");
        vm.prank(bob);
        token.mint("");
        vm.prank(charlie);
        token.mint("");
    }

    // ──────────────── Helpers ────────────────────────────────────

    function _defaultParams(address creator, address counterparty)
        internal
        pure
        returns (ContractRegistry.CreateParams memory)
    {
        address[] memory sigs = new address[](2);
        sigs[0] = creator;
        sigs[1] = counterparty;
        DocumentReference[] memory refs = new DocumentReference[](0);

        return ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_creator_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });
    }

    function _defaultParamsWithRefs(address creator, address counterparty)
        internal
        view
        returns (ContractRegistry.CreateParams memory)
    {
        address[] memory sigs = new address[](2);
        sigs[0] = creator;
        sigs[1] = counterparty;
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(registry),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 4, // GOVERNS
            targetSection: ""
        });

        return ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_creator_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });
    }

    function _createContract(address creator, address counterparty) internal returns (uint256) {
        ContractRegistry.CreateParams memory p = _defaultParamsWithRefs(creator, counterparty);
        vm.prank(creator);
        return registry.createContract(p);
    }

    function _status(uint256 cid) internal view returns (uint8) {
        (,,,,, uint8 status,,,,) = registry.getContract(cid);
        return status;
    }

    function _eip712Digest(uint256 contractId, bytes32 contentHash, address governingLawRegistry)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ContractSignature(uint256 contractId,bytes32 documentHash,address governingLawRegistry,address contractRegistry,uint256 networkChainId)"
                ),
                contractId,
                contentHash,
                governingLawRegistry,
                address(registry),
                block.chainid
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
    }

    function _signContract(uint256 contractId, uint256 pk, address governingLawRegistry)
        internal
        view
        returns (bytes memory)
    {
        (bytes32 contentHash,,,,,,,,,) = registry.getContract(contractId);
        bytes32 digest = _eip712Digest(contractId, contentHash, governingLawRegistry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _createAndSignAll(address creator, uint256 creatorPk, address counterparty, uint256 counterpartyPk)
        internal
        returns (uint256)
    {
        uint256 cid = _createContract(creator, counterparty);
        bytes memory sig1 = _signContract(cid, creatorPk, address(registry));
        vm.prank(creator);
        registry.sign(cid, sig1, "ar_alice_tx");

        bytes memory sig2 = _signContract(cid, counterpartyPk, address(registry));
        vm.prank(counterparty);
        registry.sign(cid, sig2, "ar_bob_tx");

        return cid;
    }

    /// @dev Three-party Active contract (alice creator + bob + charlie),
    ///      one GOVERNS reference back to the registry itself.
    function _createAndSignAllThreeParty() internal returns (uint256) {
        address[] memory sigs = new address[](3);
        sigs[0] = alice;
        sigs[1] = bob;
        sigs[2] = charlie;
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(registry),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 4,
            targetSection: ""
        });
        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_creator_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        uint256 cid = registry.createContract(p);

        bytes memory s1 = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        registry.sign(cid, s1, "ar_alice_tx");

        bytes memory s2 = _signContract(cid, bobPk, address(registry));
        vm.prank(bob);
        registry.sign(cid, s2, "ar_bob_tx");

        bytes memory s3 = _signContract(cid, charliePk, address(registry));
        vm.prank(charlie);
        registry.sign(cid, s3, "ar_charlie_tx");

        return cid;
    }

    // ══════════════════════════════════════════════════════════════
    // Creation
    // ══════════════════════════════════════════════════════════════

    function test_createContract_validTokenHolder() public {
        uint256 cid = _createContract(alice, bob);

        assertEq(cid, 1);
        assertEq(registry.getContractCount(), 1);

        (bytes32 contentHash, address[] memory sigs,, string[] memory txIds,, uint8 status, uint256 createdAt,,,) =
            registry.getContract(cid);

        assertEq(contentHash, HASH_A);
        assertEq(sigs.length, 2);
        assertEq(sigs[0], alice);
        assertEq(sigs[1], bob);
        assertEq(txIds.length, 1);
        assertEq(txIds[0], "ar_creator_tx");
        assertEq(status, uint8(ContractRegistry.Status.Created));
        assertEq(createdAt, block.timestamp);
    }

    function test_createContract_revertsForNonHolder() public {
        ContractRegistry.CreateParams memory p = _defaultParams(stranger, bob);
        vm.prank(stranger);
        vm.expectRevert(ContractRegistry.NotTokenHolder.selector);
        registry.createContract(p);
    }

    function test_createContract_emitsEvent() public {
        ContractRegistry.CreateParams memory p = _defaultParamsWithRefs(alice, bob);
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ContractCreated(1, alice);
        registry.createContract(p);
    }

    function test_createContract_lifecycleEventRecorded() public {
        uint256 cid = _createContract(alice, bob);
        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);

        assertEq(events.length, 1);
        assertEq(events[0].eventType, registry.EVENT_CREATED());
        assertEq(events[0].actor, alice);
        assertEq(events[0].timestamp, block.timestamp);
    }

    function test_createContract_partyLookup() public {
        uint256 cid = _createContract(alice, bob);

        uint256[] memory aliceContracts = registry.getContractsByParty(alice);
        uint256[] memory bobContracts = registry.getContractsByParty(bob);

        assertEq(aliceContracts.length, 1);
        assertEq(aliceContracts[0], cid);
        assertEq(bobContracts.length, 1);
        assertEq(bobContracts[0], cid);
    }

    function test_createContract_referencesStored() public {
        uint256 cid = _createContract(alice, bob);
        (,,,, DocumentReference[] memory refs,,,,,) = registry.getContract(cid);

        assertEq(refs.length, 1);
        assertEq(refs[0].registryAddress, address(registry));
        assertEq(refs[0].relationType, 4);
    }

    // ══════════════════════════════════════════════════════════════
    // Signing
    // ══════════════════════════════════════════════════════════════

    function test_sign_validEIP712Signature() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));

        vm.prank(alice);
        registry.sign(cid, sig, "ar_alice_tx");

        assertTrue(registry.hasSigned(cid, alice));
        (,, bytes[] memory signatures, string[] memory txIds,,,,,,) = registry.getContract(cid);
        assertEq(signatures.length, 1);
        assertEq(txIds.length, 2);
    }

    function test_sign_revertsForNonSignatory() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, charliePk, address(registry));

        vm.prank(charlie);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.NotSignatory.selector, cid, charlie));
        registry.sign(cid, sig, "ar_charlie_tx");
    }

    function test_sign_revertsForInvalidSignature() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, bobPk, address(registry));

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.InvalidSignature.selector);
        registry.sign(cid, sig, "ar_alice_tx");
    }

    function test_sign_revertsForHighSMalleatedSignature() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));

        // Extract r, s, v; mutate to (r, n - s, flipped v) — the other valid
        // recover for the same digest. Canonical-low-s rule rejects this.
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory malleated = abi.encodePacked(r, highS, flippedV);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.InvalidSignature.selector);
        registry.sign(cid, malleated, "ar_alice_tx");
    }

    function test_sign_revertsForInvalidV() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));

        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
        }

        for (uint8 badV = 0; badV < 30; badV++) {
            if (badV == 27 || badV == 28) continue;
            if (badV != 0 && badV != 1 && badV != 29) continue;
            bytes memory bad = abi.encodePacked(r, s, badV);
            vm.prank(alice);
            vm.expectRevert(ContractRegistry.InvalidSignature.selector);
            registry.sign(cid, bad, "ar_alice_tx");
        }
    }

    function test_sign_revertsForAlreadySigned() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        registry.sign(cid, sig, "ar_alice_tx");

        bytes memory sig2 = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.AlreadySigned.selector, cid, alice));
        registry.sign(cid, sig2, "ar_alice_tx2");
    }

    function test_sign_emitsEvent() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ContractSigned(cid, alice);
        registry.sign(cid, sig, "ar_alice_tx");
    }

    function test_sign_autoActivatesWhenAllSign() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_sign_emitsActiveEvent() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig1 = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        registry.sign(cid, sig1, "ar_alice_tx");

        bytes memory sig2 = _signContract(cid, bobPk, address(registry));
        vm.prank(bob);
        vm.expectEmit(true, false, false, false);
        emit ContractActive(cid);
        registry.sign(cid, sig2, "ar_bob_tx");
    }

    function test_sign_activeLifecycleEvents() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);

        assertEq(events.length, 4);
        assertEq(events[0].eventType, registry.EVENT_CREATED());
        assertEq(events[1].eventType, registry.EVENT_SIGNED());
        assertEq(events[1].actor, alice);
        assertEq(events[2].eventType, registry.EVENT_SIGNED());
        assertEq(events[2].actor, bob);
        assertEq(events[3].eventType, registry.EVENT_ACTIVE());
    }

    function test_sign_revertsAfterExpiry() public {
        uint256 cid = _createContract(alice, bob);
        vm.warp(block.timestamp + 30 days + 1);

        bytes memory sig = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.SigningWindowExpired.selector, cid));
        registry.sign(cid, sig, "ar_alice_tx");
    }

    function test_sign_succeedsAtExactExpiry() public {
        uint256 cid = _createContract(alice, bob);
        vm.warp(block.timestamp + 30 days);

        bytes memory sig = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        registry.sign(cid, sig, "ar_alice_tx");
        assertTrue(registry.hasSigned(cid, alice));
    }

    function test_sign_threeParty() public {
        address[] memory sigs = new address[](3);
        sigs[0] = alice;
        sigs[1] = bob;
        sigs[2] = charlie;
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(registry),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 4,
            targetSection: ""
        });

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_creator_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        uint256 cid = registry.createContract(p);

        bytes memory sig1 = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        registry.sign(cid, sig1, "ar_alice_tx");

        bytes memory sig2 = _signContract(cid, bobPk, address(registry));
        vm.prank(bob);
        registry.sign(cid, sig2, "ar_bob_tx");

        assertEq(_status(cid), uint8(ContractRegistry.Status.Created));

        bytes memory sig3 = _signContract(cid, charliePk, address(registry));
        vm.prank(charlie);
        registry.sign(cid, sig3, "ar_charlie_tx");

        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    // ══════════════════════════════════════════════════════════════
    // Decline
    // ══════════════════════════════════════════════════════════════

    function test_decline_unsignedSignatory() public {
        uint256 cid = _createContract(alice, bob);

        vm.prank(bob);
        registry.decline(cid);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Declined));
    }

    function test_decline_revertsForAlreadySigned() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));
        vm.prank(alice);
        registry.sign(cid, sig, "ar_alice_tx");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.AlreadySigned.selector, cid, alice));
        registry.decline(cid);
    }

    function test_decline_emitsEvent() public {
        uint256 cid = _createContract(alice, bob);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit ContractDeclined(cid, bob);
        registry.decline(cid);
    }

    function test_decline_lifecycleEventRecorded() public {
        uint256 cid = _createContract(alice, bob);

        vm.prank(bob);
        registry.decline(cid);

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        assertEq(events.length, 2);
        assertEq(events[1].eventType, registry.EVENT_DECLINED());
        assertEq(events[1].actor, bob);
    }

    // ══════════════════════════════════════════════════════════════
    // Termination — propose / finalize
    // ══════════════════════════════════════════════════════════════

    function test_proposeTermination_happyPath() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        (uint256 proposedAt, address proposer, bytes32 reason, uint256 expiresAt) =
            registry.getTerminationProposal(cid);
        assertEq(proposedAt, block.timestamp);
        assertEq(proposer, alice);
        assertEq(reason, REASON_A);
        assertEq(expiresAt, block.timestamp + 30 days);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_proposeTermination_emitsEvent() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit TerminationProposed(cid, alice, REASON_A, block.timestamp + 30 days);
        registry.proposeTermination(cid, REASON_A);
    }

    function test_proposeTermination_lifecycleEventRecorded() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        ContractRegistry.LifecycleEvent memory last = events[events.length - 1];
        assertEq(last.eventType, registry.EVENT_TERMINATION_PROPOSED());
        assertEq(last.actor, alice);
        assertEq(last.reasonHash, REASON_A);
    }

    function test_proposeTermination_revertsOnNonActive() public {
        uint256 cid = _createContract(alice, bob);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ContractRegistry.InvalidStatus.selector,
                cid,
                uint8(ContractRegistry.Status.Created),
                uint8(ContractRegistry.Status.Active)
            )
        );
        registry.proposeTermination(cid, bytes32(0));
    }

    function test_proposeTermination_revertsForNonSignatory() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.NotSignatory.selector, cid, stranger));
        registry.proposeTermination(cid, bytes32(0));
    }

    function test_proposeTermination_revertsWhenAlreadyProposed() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        vm.expectRevert(ContractRegistry.ProposalAlreadyActive.selector);
        registry.proposeTermination(cid, bytes32(0));
    }

    function test_finalizeTermination_afterWindow() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.warp(block.timestamp + 30 days);

        vm.prank(bob);
        registry.finalizeTermination(cid);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
        (uint256 proposedAt,,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, 0); // cleared
    }

    function test_finalizeTermination_reasonHashCarriedFromProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.warp(block.timestamp + 30 days);
        vm.prank(bob);
        registry.finalizeTermination(cid);

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        ContractRegistry.LifecycleEvent memory last = events[events.length - 1];
        assertEq(last.eventType, registry.EVENT_TERMINATED());
        assertEq(last.reasonHash, REASON_A);
    }

    function test_finalizeTermination_emitsEvent() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.warp(block.timestamp + 30 days);

        vm.prank(charlie);
        vm.expectEmit(true, true, false, false);
        emit ContractTerminated(cid, charlie);
        registry.finalizeTermination(cid);
    }

    function test_finalizeTermination_revertsBeforeWindow() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.warp(block.timestamp + 29 days);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.NoticeWindowNotElapsed.selector);
        registry.finalizeTermination(cid);
    }

    function test_finalizeTermination_revertsWithoutProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.NoActiveProposal.selector);
        registry.finalizeTermination(cid);
    }

    function test_finalizeTermination_callableByAnySignatory() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.warp(block.timestamp + 30 days);

        // bob (not the proposer) can finalize
        vm.prank(bob);
        registry.finalizeTermination(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
    }

    // ══════════════════════════════════════════════════════════════
    // Completion — propose / finalize
    // ══════════════════════════════════════════════════════════════

    function test_proposeCompletion_happyPath() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        (uint256 proposedAt, address proposer, bytes32 reason, uint256 expiresAt) =
            registry.getCompletionProposal(cid);
        assertEq(proposedAt, block.timestamp);
        assertEq(proposer, alice);
        assertEq(reason, REASON_A);
        assertEq(expiresAt, block.timestamp + 30 days);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_proposeCompletion_emitsEvent() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit CompletionProposed(cid, alice, REASON_A, block.timestamp + 30 days);
        registry.proposeCompletion(cid, REASON_A);
    }

    function test_proposeCompletion_lifecycleEventRecorded() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        ContractRegistry.LifecycleEvent memory last = events[events.length - 1];
        assertEq(last.eventType, registry.EVENT_COMPLETION_PROPOSED());
        assertEq(last.actor, alice);
    }

    function test_proposeCompletion_revertsWhenAlreadyProposed() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(bob);
        vm.expectRevert(ContractRegistry.ProposalAlreadyActive.selector);
        registry.proposeCompletion(cid, bytes32(0));
    }

    function test_finalizeCompletion_afterWindow() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.warp(block.timestamp + 30 days);

        vm.prank(bob);
        registry.finalizeCompletion(cid);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Completed));
        (uint256 proposedAt,,,) = registry.getCompletionProposal(cid);
        assertEq(proposedAt, 0);
    }

    function test_finalizeCompletion_emitsEvent() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);
        vm.warp(block.timestamp + 30 days);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit ContractCompleted(cid, bob);
        registry.finalizeCompletion(cid);
    }

    function test_finalizeCompletion_revertsBeforeWindow() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.warp(block.timestamp + 29 days);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.NoticeWindowNotElapsed.selector);
        registry.finalizeCompletion(cid);
    }

    function test_finalizeCompletion_revertsWithoutProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.NoActiveProposal.selector);
        registry.finalizeCompletion(cid);
    }

    // ══════════════════════════════════════════════════════════════
    // Dispute — cancels proposals + pure record
    // ══════════════════════════════════════════════════════════════

    function test_dispute_activeContract_noProposal_statusUnchanged() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.dispute(cid, REASON_A);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_dispute_cancelsTerminationProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        registry.dispute(cid, keccak256("deliverables-outstanding"));

        (uint256 proposedAt,,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_dispute_cancelsCompletionProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(bob);
        registry.dispute(cid, bytes32(0));

        (uint256 proposedAt,,,) = registry.getCompletionProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_dispute_proposerCanWithdrawOwnProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        // Alice withdraws her own proposal via dispute
        vm.prank(alice);
        registry.dispute(cid, bytes32(0));

        (uint256 proposedAt,,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, 0);
    }

    function test_dispute_terminatedContract_statusUnchanged() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, bytes32(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        registry.finalizeTermination(cid);

        vm.prank(bob);
        registry.dispute(cid, REASON_A);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
    }

    function test_dispute_completedContract_statusUnchanged() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, bytes32(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        registry.finalizeCompletion(cid);

        vm.prank(bob);
        registry.dispute(cid, REASON_A);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Completed));
    }

    function test_dispute_multipleDisputesAllowed() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.dispute(cid, REASON_A);
        vm.prank(bob);
        registry.dispute(cid, keccak256("reason-b"));
        vm.prank(alice);
        registry.dispute(cid, keccak256("reason-c"));

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        uint256 disputeCount = 0;
        for (uint256 i = 0; i < events.length; i++) {
            if (events[i].eventType == registry.EVENT_DISPUTED()) disputeCount++;
        }
        assertEq(disputeCount, 3);
    }

    function test_dispute_revertsOnCreatedContract() public {
        uint256 cid = _createContract(alice, bob);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ContractRegistry.InvalidStatus.selector,
                cid,
                uint8(ContractRegistry.Status.Created),
                uint8(ContractRegistry.Status.Active)
            )
        );
        registry.dispute(cid, bytes32(0));
    }

    function test_dispute_emitsEvent() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ContractDisputed(cid, alice);
        registry.dispute(cid, REASON_A);
    }

    function test_dispute_reProposeAfterDisputeSucceeds() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.prank(bob);
        registry.dispute(cid, bytes32(0));

        // Alice can propose again
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        (uint256 proposedAt,,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, block.timestamp);
    }

    // ══════════════════════════════════════════════════════════════
    // Cancel / Accept (Termination)
    // ══════════════════════════════════════════════════════════════

    function test_cancelTermination_proposerHappyPath() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit TerminationCancelled(cid, alice);
        registry.cancelTermination(cid);

        (uint256 proposedAt, address proposer,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(proposer, address(0));
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        assertEq(events[events.length - 1].eventType, registry.EVENT_TERMINATION_CANCELLED());
        assertEq(events[events.length - 1].actor, alice);
    }

    function test_cancelTermination_revertsForNonProposer() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        vm.expectRevert(ContractRegistry.NotProposer.selector);
        registry.cancelTermination(cid);
    }

    function test_cancelTermination_revertsWithNoActiveProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        vm.expectRevert(ContractRegistry.NoActiveProposal.selector);
        registry.cancelTermination(cid);
    }

    function test_acceptTermination_revertsForProposer() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.ProposerCannotAccept.selector);
        registry.acceptTermination(cid);
    }

    function test_acceptTermination_revertsForNonSignatory() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.NotSignatory.selector, cid, stranger));
        registry.acceptTermination(cid);
    }

    function test_acceptTermination_revertsWithNoActiveProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(bob);
        vm.expectRevert(ContractRegistry.NoActiveProposal.selector);
        registry.acceptTermination(cid);
    }

    function test_acceptTermination_twoPartyTransitionsImmediately() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        registry.acceptTermination(cid);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
        // Proposal state cleared post-transition
        (uint256 proposedAt,,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(registry.getTerminationAcceptCount(cid), 0);
        assertFalse(registry.hasAcceptedTermination(cid, bob));
        // Reason hash carried through to terminal event
        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        assertEq(events[events.length - 1].eventType, registry.EVENT_TERMINATED());
        assertEq(events[events.length - 1].reasonHash, REASON_A);
    }

    function test_acceptTermination_threePartyQuorum() public {
        uint256 cid = _createAndSignAllThreeParty();
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        // First non-proposer accept: status stays Active
        vm.prank(bob);
        registry.acceptTermination(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
        assertEq(registry.getTerminationAcceptCount(cid), 1);
        assertTrue(registry.hasAcceptedTermination(cid, bob));

        // Second non-proposer accept: status flips to Terminated
        vm.prank(charlie);
        registry.acceptTermination(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
        // Accept tracking cleared by clear-on-transition
        assertEq(registry.getTerminationAcceptCount(cid), 0);
        assertFalse(registry.hasAcceptedTermination(cid, bob));
        assertFalse(registry.hasAcceptedTermination(cid, charlie));
    }

    function test_acceptTermination_duplicateRevertsForSameCaller() public {
        uint256 cid = _createAndSignAllThreeParty();
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        registry.acceptTermination(cid);

        vm.prank(bob);
        vm.expectRevert(ContractRegistry.AlreadyAccepted.selector);
        registry.acceptTermination(cid);
    }

    function test_acceptTermination_afterWindowStillWorks() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.warp(block.timestamp + 30 days + 1);

        vm.prank(bob);
        registry.acceptTermination(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
    }

    function test_acceptTermination_emitsEvent() public {
        uint256 cid = _createAndSignAllThreeParty();
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit TerminationAccepted(cid, bob);
        registry.acceptTermination(cid);
    }

    function test_cancelTermination_rePropose_freshClockAndCleanAudit() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        uint256 firstProposedAt = block.timestamp;

        vm.warp(block.timestamp + 10 days);
        vm.prank(alice);
        registry.cancelTermination(cid);

        vm.warp(block.timestamp + 1 days);
        bytes32 newReason = keccak256("revised-reason");
        vm.prank(alice);
        registry.proposeTermination(cid, newReason);

        (uint256 proposedAt,, bytes32 reason,) = registry.getTerminationProposal(cid);
        assertGt(proposedAt, firstProposedAt);
        assertEq(reason, newReason);

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        // Last three events: TERMINATION_PROPOSED, TERMINATION_CANCELLED, TERMINATION_PROPOSED
        uint256 n = events.length;
        assertEq(events[n - 3].eventType, registry.EVENT_TERMINATION_PROPOSED());
        assertEq(events[n - 2].eventType, registry.EVENT_TERMINATION_CANCELLED());
        assertEq(events[n - 1].eventType, registry.EVENT_TERMINATION_PROPOSED());
    }

    function test_disputeCancel_clearsAcceptTracking() public {
        uint256 cid = _createAndSignAllThreeParty();
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        // Bob accepts, then charlie disputes — proposal clears and bob's accept
        // must reset so a re-propose starts from a clean slate.
        vm.prank(bob);
        registry.acceptTermination(cid);
        assertTrue(registry.hasAcceptedTermination(cid, bob));

        vm.prank(charlie);
        registry.dispute(cid, bytes32(0));
        assertFalse(registry.hasAcceptedTermination(cid, bob));
        assertEq(registry.getTerminationAcceptCount(cid), 0);

        // Re-propose: bob has not accepted the new proposal.
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        assertFalse(registry.hasAcceptedTermination(cid, bob));
        assertEq(registry.getTerminationAcceptCount(cid), 0);
    }

    function test_rejectTermination_nonProposerHappyPath() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit TerminationRejected(cid, bob);
        registry.rejectTermination(cid);

        (uint256 proposedAt,,,) = registry.getTerminationProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        assertEq(events[events.length - 1].eventType, registry.EVENT_TERMINATION_REJECTED());
        assertEq(events[events.length - 1].actor, bob);
    }

    function test_rejectTermination_revertsForProposer() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.prank(alice);
        vm.expectRevert(ContractRegistry.ProposerCannotReject.selector);
        registry.rejectTermination(cid);
    }

    function test_rejectTermination_revertsForNonSignatory() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.NotSignatory.selector, cid, stranger));
        registry.rejectTermination(cid);
    }

    function test_rejectTermination_revertsWithNoActiveProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(bob);
        vm.expectRevert(ContractRegistry.NoActiveProposal.selector);
        registry.rejectTermination(cid);
    }

    function test_rejectTermination_clearsAcceptTracking() public {
        uint256 cid = _createAndSignAllThreeParty();
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        registry.acceptTermination(cid);
        assertTrue(registry.hasAcceptedTermination(cid, bob));

        vm.prank(charlie);
        registry.rejectTermination(cid);
        assertFalse(registry.hasAcceptedTermination(cid, bob));
        assertEq(registry.getTerminationAcceptCount(cid), 0);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    // ══════════════════════════════════════════════════════════════
    // Cancel / Accept (Completion) — symmetric mirror
    // ══════════════════════════════════════════════════════════════

    function test_cancelCompletion_proposerHappyPath() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit CompletionCancelled(cid, alice);
        registry.cancelCompletion(cid);

        (uint256 proposedAt,,,) = registry.getCompletionProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_cancelCompletion_revertsForNonProposer() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);
        vm.prank(bob);
        vm.expectRevert(ContractRegistry.NotProposer.selector);
        registry.cancelCompletion(cid);
    }

    function test_acceptCompletion_twoPartyTransitionsImmediately() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(bob);
        registry.acceptCompletion(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Completed));
        assertEq(registry.getCompletionAcceptCount(cid), 0);
    }

    function test_acceptCompletion_threePartyQuorum() public {
        uint256 cid = _createAndSignAllThreeParty();
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(bob);
        registry.acceptCompletion(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
        assertEq(registry.getCompletionAcceptCount(cid), 1);

        vm.prank(charlie);
        registry.acceptCompletion(cid);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Completed));
    }

    function test_acceptCompletion_revertsForProposer() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.ProposerCannotAccept.selector);
        registry.acceptCompletion(cid);
    }

    function test_rejectCompletion_nonProposerHappyPath() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit CompletionRejected(cid, bob);
        registry.rejectCompletion(cid);

        (uint256 proposedAt,,,) = registry.getCompletionProposal(cid);
        assertEq(proposedAt, 0);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_rejectCompletion_revertsForProposer() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, REASON_A);
        vm.prank(alice);
        vm.expectRevert(ContractRegistry.ProposerCannotReject.selector);
        registry.rejectCompletion(cid);
    }

    // ══════════════════════════════════════════════════════════════
    // effectiveStatus
    // ══════════════════════════════════════════════════════════════

    function test_effectiveStatus_createdReturnsCreatedBeforeExpiry() public {
        uint256 cid = _createContract(alice, bob);
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Created));
    }

    function test_effectiveStatus_createdReturnsExpiredAfterWindow() public {
        uint256 cid = _createContract(alice, bob);
        vm.warp(block.timestamp + 30 days + 1);
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Expired));
    }

    function test_effectiveStatus_activeReturnsActiveWithoutProposal() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_effectiveStatus_activeWithPendingTerminationReturnsActive() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, bytes32(0));

        vm.warp(block.timestamp + 15 days);
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Active));
    }

    function test_effectiveStatus_ripenedTerminationReturnsTerminated() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, bytes32(0));

        vm.warp(block.timestamp + 30 days);
        // Stored status still Active
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
        // But effective status is Terminated
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Terminated));
    }

    function test_effectiveStatus_ripenedCompletionReturnsCompleted() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeCompletion(cid, bytes32(0));

        vm.warp(block.timestamp + 30 days);
        assertEq(_status(cid), uint8(ContractRegistry.Status.Active));
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Completed));
    }

    function test_effectiveStatus_unaffectedByDeclined() public {
        uint256 cid = _createContract(alice, bob);
        vm.prank(bob);
        registry.decline(cid);
        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Declined));
    }

    function test_effectiveStatus_matchesAfterFinalize() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, bytes32(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        registry.finalizeTermination(cid);

        assertEq(registry.effectiveStatus(cid), uint8(ContractRegistry.Status.Terminated));
        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
    }

    // ══════════════════════════════════════════════════════════════
    // isStale
    // ══════════════════════════════════════════════════════════════

    function test_isStale_freshContractNotStale() public {
        uint256 cid = _createContract(alice, bob);
        assertFalse(registry.isStale(cid));
    }

    function test_isStale_oldContractIsStale() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.warp(block.timestamp + 366 days);
        assertTrue(registry.isStale(cid));
    }

    function test_isStale_completedNeverStale() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeCompletion(cid, bytes32(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        registry.finalizeCompletion(cid);

        vm.warp(block.timestamp + 500 days);
        assertFalse(registry.isStale(cid));
    }

    function test_isStale_declinedNeverStale() public {
        uint256 cid = _createContract(alice, bob);
        vm.prank(bob);
        registry.decline(cid);
        vm.warp(block.timestamp + 500 days);
        assertFalse(registry.isStale(cid));
    }

    function test_isStale_recentActivityResetsStaleness() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.warp(block.timestamp + 300 days);

        vm.prank(alice);
        registry.dispute(cid, bytes32(0));

        vm.warp(block.timestamp + 300 days);
        // 300 < 365 threshold since last event
        assertFalse(registry.isStale(cid));
    }

    // ══════════════════════════════════════════════════════════════
    // Edge cases
    // ══════════════════════════════════════════════════════════════

    function test_createContract_revertsForZeroSignatories() public {
        address[] memory sigs = new address[](0);
        DocumentReference[] memory refs = new DocumentReference[](0);

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.NoSignatories.selector);
        registry.createContract(p);
    }

    function test_createContract_revertsForEmptyContentHash() public {
        address[] memory sigs = new address[](1);
        sigs[0] = alice;
        DocumentReference[] memory refs = new DocumentReference[](0);

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: bytes32(0),
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.EmptyContentHash.selector);
        registry.createContract(p);
    }

    function test_createContract_revertsCreatorNotInSignatories() public {
        address[] memory sigs = new address[](1);
        sigs[0] = bob;
        DocumentReference[] memory refs = new DocumentReference[](0);

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        vm.expectRevert(ContractRegistry.CreatorNotInSignatories.selector);
        registry.createContract(p);
    }

    function test_createContract_revertsOnDuplicateSignatory() public {
        address[] memory sigs = new address[](3);
        sigs[0] = alice;
        sigs[1] = bob;
        sigs[2] = bob; // duplicate — should revert
        DocumentReference[] memory refs = new DocumentReference[](0);

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.DuplicateSignatory.selector, bob));
        registry.createContract(p);
    }

    function test_createContract_revertsOnDuplicateCreator() public {
        // Creator listed twice should also revert — the second occurrence trips
        // the duplicate guard before reaching the partyContracts push.
        address[] memory sigs = new address[](2);
        sigs[0] = alice;
        sigs[1] = alice;
        DocumentReference[] memory refs = new DocumentReference[](0);

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.DuplicateSignatory.selector, alice));
        registry.createContract(p);
    }

    function test_createContract_scbFieldsDefaultToZero() public {
        uint256 cid = _createContract(alice, bob);

        (,,,,,,, address sca, bytes32 bch, uint256 chainId) = registry.getContract(cid);
        assertEq(sca, address(0));
        assertEq(bch, bytes32(0));
        assertEq(chainId, 0);
    }

    function test_createContract_scbFieldsStoredWhenProvided() public {
        address[] memory sigs = new address[](2);
        sigs[0] = alice;
        sigs[1] = bob;
        DocumentReference[] memory refs = new DocumentReference[](0);

        address scAddr = makeAddr("smartContract");
        bytes32 bcHash = keccak256("bytecode");

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: scAddr,
            bytecodeHash: bcHash,
            smartContractChainId: 42
        });

        vm.prank(alice);
        uint256 cid = registry.createContract(p);

        (,,,,,,, address storedSc, bytes32 storedBc, uint256 storedChainId) = registry.getContract(cid);
        assertEq(storedSc, scAddr);
        assertEq(storedBc, bcHash);
        assertEq(storedChainId, 42);
    }

    function test_getContract_revertsForNonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.ContractDoesNotExist.selector, 99));
        registry.getContract(99);
    }

    function test_getContract_revertsForZeroId() public {
        vm.expectRevert(abi.encodeWithSelector(ContractRegistry.ContractDoesNotExist.selector, 0));
        registry.getContract(0);
    }

    function test_referencesStoredAndRetrievedCorrectly() public {
        address[] memory sigs = new address[](2);
        sigs[0] = alice;
        sigs[1] = bob;

        DocumentReference[] memory refs = new DocumentReference[](3);
        refs[0] = DocumentReference({
            registryAddress: address(0xBEEF),
            chainId: 1,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 4,
            targetSection: "section-1"
        });
        refs[1] = DocumentReference({
            registryAddress: address(0xCAFE),
            chainId: 11155111,
            categoryId: 2,
            documentId: 3,
            version: 2,
            relationType: 5,
            targetSection: ""
        });
        refs[2] = DocumentReference({
            registryAddress: address(0xFACE),
            chainId: 1,
            categoryId: 0,
            documentId: 5,
            version: 1,
            relationType: 7,
            targetSection: "1.1,1.2"
        });

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: HASH_A,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        uint256 cid = registry.createContract(p);

        (,,,, DocumentReference[] memory stored,,,,,) = registry.getContract(cid);
        assertEq(stored.length, 3);
        assertEq(stored[0].registryAddress, address(0xBEEF));
        assertEq(stored[0].relationType, 4);
        assertEq(stored[0].targetSection, "section-1");
        assertEq(stored[1].registryAddress, address(0xCAFE));
        assertEq(stored[1].chainId, 11155111);
        assertEq(stored[2].targetSection, "1.1,1.2");
    }

    // ══════════════════════════════════════════════════════════════
    // Lifecycle sequence / timeline ordering
    // ══════════════════════════════════════════════════════════════

    function test_lifecycle_proposeDisputeReproposeFinalize() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.prank(bob);
        registry.dispute(cid, keccak256("I-object"));

        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);

        vm.warp(block.timestamp + 30 days);

        vm.prank(bob);
        registry.finalizeTermination(cid);

        assertEq(_status(cid), uint8(ContractRegistry.Status.Terminated));
    }

    function test_lifecycle_eventTimelineOrdering() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        registry.dispute(cid, bytes32(0));

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        registry.proposeTermination(cid, bytes32(0));

        ContractRegistry.LifecycleEvent[] memory events = registry.getEvents(cid);
        for (uint256 i = 1; i < events.length; i++) {
            assertGe(events[i].timestamp, events[i - 1].timestamp);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Gas estimation
    // ══════════════════════════════════════════════════════════════

    function test_gas_createContract() public {
        ContractRegistry.CreateParams memory p = _defaultParamsWithRefs(alice, bob);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        registry.createContract(p);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for createContract", gasUsed);
    }

    function test_gas_sign() public {
        uint256 cid = _createContract(alice, bob);
        bytes memory sig = _signContract(cid, alicePk, address(registry));

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        registry.sign(cid, sig, "ar_alice_tx");
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for sign", gasUsed);
    }

    function test_gas_decline() public {
        uint256 cid = _createContract(alice, bob);

        vm.prank(bob);
        uint256 gasBefore = gasleft();
        registry.decline(cid);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for decline", gasUsed);
    }

    function test_gas_proposeTermination() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        registry.proposeTermination(cid, REASON_A);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for proposeTermination", gasUsed);
    }

    function test_gas_finalizeTermination() public {
        uint256 cid = _createAndSignAll(alice, alicePk, bob, bobPk);
        vm.prank(alice);
        registry.proposeTermination(cid, REASON_A);
        vm.warp(block.timestamp + 30 days);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        registry.finalizeTermination(cid);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for finalizeTermination", gasUsed);
    }

    // ══════════════════════════════════════════════════════════════
    // Fuzz
    // ══════════════════════════════════════════════════════════════

    function testFuzz_createContract_arbitraryContentHash(bytes32 hash) public {
        vm.assume(hash != bytes32(0));

        address[] memory sigs = new address[](1);
        sigs[0] = alice;
        DocumentReference[] memory refs = new DocumentReference[](0);

        ContractRegistry.CreateParams memory p = ContractRegistry.CreateParams({
            contentHash: hash,
            signatories: sigs,
            contentUri: "ar_tx",
            references: refs,
            smartContractAddress: address(0),
            bytecodeHash: bytes32(0),
            smartContractChainId: 0
        });

        vm.prank(alice);
        uint256 cid = registry.createContract(p);

        (bytes32 stored,,,,,,,,,) = registry.getContract(cid);
        assertEq(stored, hash);
    }
}
