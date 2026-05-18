// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {DAARegistry} from "../src/DAARegistry.sol";
import {Document, DocumentReference} from "@vattelum/document-registry/DocumentRegistry.sol";

contract DAARegistryTest is Test {
    DAARegistry registry;

    address coreAuth = makeAddr("coreAuth");
    address normalAuth = makeAddr("normalAuth");
    address stranger = makeAddr("stranger");
    address newCore = makeAddr("newCore");

    bytes32 constant HASH_A = keccak256("document-a");
    bytes32 constant HASH_B = keccak256("document-b");
    bytes32 constant HASH_C = keccak256("document-c");

    event CategoryAdded(uint256 indexed categoryId, string name);
    event DocumentAdded(
        uint256 indexed categoryId,
        uint256 indexed documentId,
        uint256 indexed version,
        string contentUri,
        bytes32 contentHash,
        uint8 docType
    );
    event NormalAuthorityTransferred(address indexed previous, address indexed current);
    event CoreAuthorityTransferred(address indexed previous, address indexed current);
    event AmendmentRestrictionsUpdated(uint256 indexed categoryId, uint256 indexed documentId);

    function setUp() public {
        registry = new DAARegistry(coreAuth);

        // Set up normal authority
        vm.prank(coreAuth);
        registry.setNormalAuthority(normalAuth);
    }

    // ──────────────── Helpers ────────────────────────────────

    function _createCategory(string memory name) internal returns (uint256) {
        vm.prank(coreAuth);
        return registry.addCategory(name);
    }

    function _addNewDocument(
        uint256 categoryId,
        string memory contentUri,
        bytes32 contentHash,
        string memory title,
        string memory voteId_,
        uint8 docType
    ) internal returns (uint256 documentId, uint256 version) {
        return _addNewDocumentAs(normalAuth, categoryId, contentUri, contentHash, title, voteId_, docType);
    }

    function _addNewDocumentAs(
        address authority,
        uint256 categoryId,
        string memory contentUri,
        bytes32 contentHash,
        string memory title,
        string memory voteId_,
        uint8 docType
    ) internal returns (uint256 documentId, uint256 version) {
        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: categoryId,
            documentId: 0,
            contentUri: contentUri,
            contentHash: contentHash,
            title: title,
            voteId: voteId_,
            docType: docType
        });
        DocumentReference[] memory refs = new DocumentReference[](0);
        vm.prank(authority);
        return registry.addDocument(input, refs);
    }

    function _amendDocument(
        uint256 categoryId,
        uint256 documentId,
        string memory contentUri,
        bytes32 contentHash,
        string memory title,
        uint8 docType
    ) internal returns (uint256, uint256) {
        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: categoryId,
            documentId: documentId,
            contentUri: contentUri,
            contentHash: contentHash,
            title: title,
            voteId: "",
            docType: docType
        });
        DocumentReference[] memory refs = new DocumentReference[](0);
        vm.prank(normalAuth);
        return registry.addDocument(input, refs);
    }

    // ──────────────── Scenario 1: addCategory ───────────────

    function test_addCategory_createsWithSequentialId() public {
        uint256 id0 = _createCategory("Constitutional Law");
        uint256 id1 = _createCategory("Trade Regulations");

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(registry.categoryCount(), 2);
        assertEq(registry.categoryNames(0), "Constitutional Law");
        assertEq(registry.categoryNames(1), "Trade Regulations");
    }

    function test_addCategory_emitsEvent() public {
        vm.prank(coreAuth);
        vm.expectEmit(true, false, false, true);
        emit CategoryAdded(0, "Constitutional Law");
        registry.addCategory("Constitutional Law");
    }

    function test_addCategory_revertsForNormalAuthority() public {
        vm.prank(normalAuth);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.addCategory("Unauthorized");
    }

    function test_addCategory_revertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.addCategory("Unauthorized");
    }

    // ──────────────── Scenario 2: addDocument (new) ─────────

    function test_addDocument_createsNewDocument() public {
        _createCategory("Constitutional Law");
        (uint256 docId, uint256 version) = _addNewDocument(0, "tx_abc123", HASH_A, "Article 1", "snapshot-001", 0);

        assertEq(docId, 1);
        assertEq(version, 1);
        assertEq(registry.getDocumentCount(0), 1);

        Document memory doc = registry.getDocument(0, 1, 1);
        assertEq(doc.contentUri, "tx_abc123");
        assertEq(doc.contentHash, HASH_A);
        assertEq(doc.title, "Article 1");
        assertEq(doc.version, 1);
        assertEq(doc.timestamp, block.timestamp);
        assertEq(doc.voteId, "snapshot-001");
        assertEq(doc.docType, 0);
    }

    function test_addDocument_multipleDocumentsPerCategory() public {
        _createCategory("Resolutions");
        (uint256 doc1,) = _addNewDocument(0, "tx_1", HASH_A, "Policy A", "", 0);
        (uint256 doc2,) = _addNewDocument(0, "tx_2", HASH_B, "Policy B", "", 0);

        assertEq(doc1, 1);
        assertEq(doc2, 2);
        assertEq(registry.getDocumentCount(0), 2);
        assertEq(registry.getDocument(0, 1, 1).title, "Policy A");
        assertEq(registry.getDocument(0, 2, 1).title, "Policy B");
    }

    // ──────────────── Scenario 3: addDocument (amend) ───────

    function test_addDocument_amendsExistingDocument() public {
        _createCategory("Constitutional Law");
        (uint256 docId,) = _addNewDocument(0, "tx_v1", HASH_A, "Original", "", 0);
        (, uint256 v2) = _amendDocument(0, docId, "tx_v2", HASH_B, "Amended", 0);

        assertEq(v2, 2);
        assertEq(registry.getVersionCount(0, docId), 2);
        assertEq(registry.getDocument(0, docId, 1).title, "Original");
        assertEq(registry.getDocument(0, docId, 2).title, "Amended");
    }

    function test_addDocument_independentVersionChains() public {
        _createCategory("Resolutions");
        (uint256 doc1,) = _addNewDocument(0, "tx_a1", HASH_A, "Doc A v1", "", 0);
        (uint256 doc2,) = _addNewDocument(0, "tx_b1", HASH_B, "Doc B v1", "", 0);

        _amendDocument(0, doc1, "tx_a2", HASH_C, "Doc A v2", 0);

        assertEq(registry.getVersionCount(0, doc1), 2);
        assertEq(registry.getVersionCount(0, doc2), 1);
    }

    function test_addDocument_revertsForNonexistentDocument() public {
        _createCategory("Constitutional Law");

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 99,
            contentUri: "tx_1",
            contentHash: HASH_A,
            title: "Bad Doc",
            voteId: "",
            docType: 0
        });
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(normalAuth);
        vm.expectRevert(abi.encodeWithSelector(DAARegistry.DocumentDoesNotExist.selector, 0, 99));
        registry.addDocument(input, refs);
    }

    function test_addDocument_emitsEvent() public {
        _createCategory("Constitutional Law");

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
            contentUri: "tx_abc123",
            contentHash: HASH_A,
            title: "Article 1",
            voteId: "snapshot-001",
            docType: 0
        });
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(normalAuth);
        vm.expectEmit(true, true, true, true);
        emit DocumentAdded(0, 1, 1, "tx_abc123", HASH_A, 0);
        registry.addDocument(input, refs);
    }

    // ──────────────── Scenario 4: Two-tier authority ────────

    function test_addDocument_normalAuthorityCanAdd() public {
        _createCategory("Constitutional Law");
        (uint256 docId,) = _addNewDocumentAs(normalAuth, 0, "tx_1", HASH_A, "Normal Doc", "", 0);
        assertEq(docId, 1);
    }

    function test_addDocument_coreAuthorityCanAdd() public {
        _createCategory("Constitutional Law");
        (uint256 docId,) = _addNewDocumentAs(coreAuth, 0, "tx_1", HASH_A, "Core Doc", "", 0);
        assertEq(docId, 1);
    }

    function test_addDocument_strangerReverts() public {
        _createCategory("Constitutional Law");

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
            contentUri: "tx_hack",
            contentHash: HASH_A,
            title: "Unauthorized",
            voteId: "",
            docType: 0
        });
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(stranger);
        vm.expectRevert(DAARegistry.NotAuthority.selector);
        registry.addDocument(input, refs);
    }

    function test_setNormalAuthority_coreOnly() public {
        address newNormal = makeAddr("newNormal");

        vm.prank(normalAuth);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.setNormalAuthority(newNormal);

        vm.prank(coreAuth);
        registry.setNormalAuthority(newNormal);
        assertEq(registry.normalAuthority(), newNormal);
    }

    function test_setCoreAuthority_coreOnly() public {
        vm.prank(normalAuth);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.setCoreAuthority(newCore);

        vm.prank(coreAuth);
        registry.setCoreAuthority(newCore);
        assertEq(registry.coreAuthority(), newCore);
    }

    function test_setCoreAuthority_oldCoreLosesAccess() public {
        vm.prank(coreAuth);
        registry.setCoreAuthority(newCore);

        vm.prank(coreAuth);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.addCategory("Should Fail");
    }

    function test_setNormalAuthority_revertsForZeroAddress() public {
        vm.prank(coreAuth);
        vm.expectRevert(DAARegistry.InvalidAuthority.selector);
        registry.setNormalAuthority(address(0));
    }

    function test_setCoreAuthority_revertsForZeroAddress() public {
        vm.prank(coreAuth);
        vm.expectRevert(DAARegistry.InvalidAuthority.selector);
        registry.setCoreAuthority(address(0));
    }

    function test_setNormalAuthority_emitsEvent() public {
        address newNormal = makeAddr("newNormal");
        vm.prank(coreAuth);
        vm.expectEmit(true, true, false, false);
        emit NormalAuthorityTransferred(normalAuth, newNormal);
        registry.setNormalAuthority(newNormal);
    }

    function test_setCoreAuthority_emitsEvent() public {
        vm.prank(coreAuth);
        vm.expectEmit(true, true, false, false);
        emit CoreAuthorityTransferred(coreAuth, newCore);
        registry.setCoreAuthority(newCore);
    }

    // ──────────────── Scenario 5: Read functions ─────────────

    function test_getLatest_returnsMostRecentVersion() public {
        _createCategory("Constitutional Law");
        (uint256 docId,) = _addNewDocument(0, "tx_old", HASH_A, "Old", "", 0);
        _amendDocument(0, docId, "tx_new", HASH_B, "New", 0);

        Document memory latest = registry.getLatest(0, docId);
        assertEq(latest.title, "New");
        assertEq(latest.version, 2);
    }

    function test_getHistory_returnsAllVersionsInOrder() public {
        _createCategory("Constitutional Law");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "V1", "", 0);
        _amendDocument(0, docId, "tx_2", HASH_B, "V2", 0);
        _amendDocument(0, docId, "tx_3", HASH_C, "V3", 0);

        Document[] memory history = registry.getHistory(0, docId);

        assertEq(history.length, 3);
        assertEq(history[0].title, "V1");
        assertEq(history[1].title, "V2");
        assertEq(history[2].title, "V3");
    }

    function test_getReferences_returnsStoredReferences() public {
        _createCategory("Constitutional Law");

        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(0xBEEF),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 0,
            targetSection: ""
        });

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
            contentUri: "tx_ref",
            contentHash: HASH_A,
            title: "With Refs",
            voteId: "",
            docType: 0
        });

        vm.prank(normalAuth);
        (uint256 docId, uint256 version) = registry.addDocument(input, refs);

        DocumentReference[] memory stored = registry.getReferences(0, docId, version);
        assertEq(stored.length, 1);
        assertEq(stored[0].registryAddress, address(0xBEEF));
        assertEq(stored[0].documentId, 1);
    }

    function test_getDocument_revertsForNonexistentCategory() public {
        vm.expectRevert(abi.encodeWithSelector(DAARegistry.CategoryDoesNotExist.selector, 99));
        registry.getDocument(99, 1, 1);
    }

    function test_getDocument_revertsForNonexistentDocument() public {
        _createCategory("Test");

        vm.expectRevert(abi.encodeWithSelector(DAARegistry.DocumentDoesNotExist.selector, 0, 5));
        registry.getDocument(0, 5, 1);
    }

    function test_getDocument_revertsForVersionZero() public {
        _createCategory("Test");
        _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        vm.expectRevert(abi.encodeWithSelector(DAARegistry.VersionDoesNotExist.selector, 0, 1, 0));
        registry.getDocument(0, 1, 0);
    }

    // ──────────────── Scenario 6: Amendment Restrictions ─────

    function test_amendmentRestrictions_perDocument() public {
        _createCategory("Resolutions");
        (uint256 doc1,) = _addNewDocument(0, "tx_1", HASH_A, "Policy A", "", 0);
        (uint256 doc2,) = _addNewDocument(0, "tx_2", HASH_B, "Policy B", "", 0);

        uint256[] memory locked = new uint256[](2);
        locked[0] = 1;
        locked[1] = 3;

        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, doc1, 90 days, locked);

        // Doc 1 has restrictions
        (uint256 minTime,, uint256[] memory storedLocked) = registry.getAmendmentRestrictions(0, doc1);
        assertEq(minTime, 90 days);
        assertEq(storedLocked.length, 2);
        assertEq(storedLocked[0], 1);

        // Doc 2 has none (independent)
        (uint256 minTime2,, uint256[] memory locked2) = registry.getAmendmentRestrictions(0, doc2);
        assertEq(minTime2, 0);
        assertEq(locked2.length, 0);
    }

    function test_setAmendmentRestrictions_coreAuthorityOnly() public {
        _createCategory("Resolutions");
        _addNewDocument(0, "tx_1", HASH_A, "Policy A", "", 0);

        uint256[] memory locked = new uint256[](0);

        vm.prank(normalAuth);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.setAmendmentRestrictions(0, 1, 30 days, locked);

        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, 1, 30 days, locked);
    }

    function test_setAmendmentRestrictions_emitsEvent() public {
        _createCategory("Resolutions");
        _addNewDocument(0, "tx_1", HASH_A, "Policy A", "", 0);

        uint256[] memory locked = new uint256[](0);

        vm.prank(coreAuth);
        vm.expectEmit(true, true, false, false);
        emit AmendmentRestrictionsUpdated(0, 1);
        registry.setAmendmentRestrictions(0, 1, 30 days, locked);
    }

    function test_amendmentRestrictions_defaultToZero() public {
        _createCategory("Constitutional Law");
        _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        (uint256 minTime, uint256 lastTime, uint256[] memory locked) = registry.getAmendmentRestrictions(0, 1);
        assertEq(minTime, 0);
        // lastAmendmentTime only writes when minTimeBetweenAmendments > 0 — see registry-backport-spec §4.2.
        assertEq(lastTime, 0);
        assertEq(locked.length, 0);
    }

    // ──────────────── Scenario 6e: addDocumentWithRestrictions ──

    function _newDocInput(uint256 categoryId, string memory uri, bytes32 h, string memory title)
        internal
        pure
        returns (DAARegistry.DocumentInput memory)
    {
        return DAARegistry.DocumentInput({
            categoryId: categoryId,
            documentId: 0,
            contentUri: uri,
            contentHash: h,
            title: title,
            voteId: "",
            docType: 0
        });
    }

    function test_addDocumentWithRestrictions_atomicAddAndConfigure() public {
        _createCategory("Resolutions");

        uint256[] memory locked = new uint256[](2);
        locked[0] = 1;
        locked[1] = 3;

        DocumentReference[] memory refs = new DocumentReference[](0);
        vm.prank(coreAuth);
        (uint256 docId, uint256 version) = registry.addDocumentWithRestrictions(
            _newDocInput(0, "tx_1", HASH_A, "Policy"),
            refs,
            90 days,
            locked
        );

        assertEq(docId, 1);
        assertEq(version, 1);

        (uint256 minTime, uint256 lastTime, uint256[] memory storedLocked) =
            registry.getAmendmentRestrictions(0, docId);
        assertEq(minTime, 90 days);
        assertEq(lastTime, 0); // gated write — only updates on amendments, not on initial config
        assertEq(storedLocked.length, 2);
        assertEq(storedLocked[0], 1);
        assertEq(storedLocked[1], 3);
    }

    function test_addDocumentWithRestrictions_emitsBothEvents() public {
        _createCategory("Resolutions");
        uint256[] memory locked = new uint256[](0);
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(coreAuth);
        vm.expectEmit(true, true, true, true);
        emit DocumentAdded(0, 1, 1, "tx_1", HASH_A, 0);
        vm.expectEmit(true, true, false, false);
        emit AmendmentRestrictionsUpdated(0, 1);
        registry.addDocumentWithRestrictions(
            _newDocInput(0, "tx_1", HASH_A, "Policy"),
            refs,
            30 days,
            locked
        );
    }

    function test_addDocumentWithRestrictions_coreAuthorityOnly() public {
        _createCategory("Resolutions");
        uint256[] memory locked = new uint256[](0);
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(normalAuth);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.addDocumentWithRestrictions(
            _newDocInput(0, "tx_1", HASH_A, "Policy"),
            refs,
            30 days,
            locked
        );

        vm.prank(stranger);
        vm.expectRevert(DAARegistry.NotCoreAuthority.selector);
        registry.addDocumentWithRestrictions(
            _newDocInput(0, "tx_1", HASH_A, "Policy"),
            refs,
            30 days,
            locked
        );
    }

    function test_addDocumentWithRestrictions_rejectsExistingDocId() public {
        _createCategory("Resolutions");
        _addNewDocument(0, "tx_1", HASH_A, "Policy", "", 0);

        uint256[] memory locked = new uint256[](0);
        DocumentReference[] memory refs = new DocumentReference[](0);

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 1, // not allowed — combo function is new-doc only
            contentUri: "tx_2",
            contentHash: HASH_B,
            title: "Amend",
            voteId: "",
            docType: 1
        });

        vm.prank(coreAuth);
        vm.expectRevert(abi.encodeWithSelector(DAARegistry.DocumentDoesNotExist.selector, 0, 1));
        registry.addDocumentWithRestrictions(input, refs, 30 days, locked);
    }

    function test_addDocumentWithRestrictions_raceImmune() public {
        // The bundled-restrictions race: two new-doc proposals execute in reverse order.
        // With the atomic combo function, each call assigns its own ID inside the same tx,
        // so restrictions always land on the document just added — order is irrelevant.
        _createCategory("Resolutions");

        uint256[] memory lockedA = new uint256[](1);
        lockedA[0] = 5;
        uint256[] memory lockedB = new uint256[](0);
        DocumentReference[] memory refs = new DocumentReference[](0);

        // Execute B (no restrictions) first
        vm.prank(coreAuth);
        (uint256 docB,) = registry.addDocumentWithRestrictions(
            _newDocInput(0, "tx_b", HASH_B, "B"),
            refs,
            0,
            lockedB
        );

        // Then A (with restrictions)
        vm.prank(coreAuth);
        (uint256 docA,) = registry.addDocumentWithRestrictions(
            _newDocInput(0, "tx_a", HASH_A, "A"),
            refs,
            45 days,
            lockedA
        );

        assertEq(docB, 1);
        assertEq(docA, 2);

        // B (the earlier ID) has NO restrictions — the race scenario where they'd land on B
        // is impossible because the documentId is resolved inside each call.
        (uint256 minTimeB,, uint256[] memory storedLockedB) = registry.getAmendmentRestrictions(0, docB);
        assertEq(minTimeB, 0);
        assertEq(storedLockedB.length, 0);

        // A (the later ID) carries its own restrictions
        (uint256 minTimeA,, uint256[] memory storedLockedA) = registry.getAmendmentRestrictions(0, docA);
        assertEq(minTimeA, 45 days);
        assertEq(storedLockedA.length, 1);
        assertEq(storedLockedA[0], 5);
    }

    // ──────────────── Scenario 6b: AmendmentTooSoon guard ────

    function test_addDocument_amendmentTooSoon_revertsWithinWindow() public {
        _createCategory("Resolutions");
        (uint256 docId,) = _addNewDocument(0, "tx_v1", HASH_A, "Policy", "", 0);

        uint256[] memory noLocks = new uint256[](0);
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 30 days, noLocks);

        uint256 amendmentTime = block.timestamp;
        _amendDocument(0, docId, "tx_v2", HASH_B, "V2", 0);

        vm.warp(amendmentTime + 15 days);

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: docId,
            contentUri: "tx_v3",
            contentHash: HASH_C,
            title: "V3",
            voteId: "",
            docType: 0
        });
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(normalAuth);
        vm.expectRevert(abi.encodeWithSelector(
            DAARegistry.AmendmentTooSoon.selector, 0, docId, amendmentTime + 30 days
        ));
        registry.addDocument(input, refs);
    }

    function test_addDocument_amendmentTooSoon_passesAfterWindow() public {
        _createCategory("Resolutions");
        (uint256 docId,) = _addNewDocument(0, "tx_v1", HASH_A, "Policy", "", 0);

        uint256[] memory noLocks = new uint256[](0);
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 30 days, noLocks);

        uint256 amendmentTime = block.timestamp;
        _amendDocument(0, docId, "tx_v2", HASH_B, "V2", 0);

        vm.warp(amendmentTime + 31 days);

        (, uint256 v3) = _amendDocument(0, docId, "tx_v3", HASH_C, "V3", 0);
        assertEq(v3, 3);
    }

    function test_addDocument_amendmentTooSoon_skippedWhenThrottleDisabled() public {
        _createCategory("Resolutions");
        (uint256 docId,) = _addNewDocument(0, "tx_v1", HASH_A, "Policy", "", 0);

        // minTimeBetweenAmendments stays at 0 — guard must not fire.
        (, uint256 v2) = _amendDocument(0, docId, "tx_v2", HASH_B, "V2", 0);
        assertEq(v2, 2);
    }

    function test_addDocument_amendmentTooSoon_firstAmendmentAfterThrottleSetPasses() public {
        _createCategory("Resolutions");
        (uint256 docId,) = _addNewDocument(0, "tx_v1", HASH_A, "Policy", "", 0);

        // Enabling the throttle after the initial add must start the clock from now —
        // lastAmendmentTime stayed at 0 because the throttle was off at add time.
        uint256[] memory noLocks = new uint256[](0);
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 30 days, noLocks);

        (, uint256 v2) = _amendDocument(0, docId, "tx_v2", HASH_B, "V2", 0);
        assertEq(v2, 2);

        (, uint256 lastTime,) = registry.getAmendmentRestrictions(0, docId);
        assertEq(lastTime, block.timestamp);
    }

    // ──────────────── Scenario 6c: lastAmendmentTime gated write ──

    function test_addDocument_lastAmendmentTime_staysZeroWithoutThrottle() public {
        _createCategory("Test");
        _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);
        _amendDocument(0, 1, "tx_2", HASH_B, "V2", 0);

        (, uint256 lastTime,) = registry.getAmendmentRestrictions(0, 1);
        assertEq(lastTime, 0);
    }

    function test_addDocument_lastAmendmentTime_setWithThrottle() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory noLocks = new uint256[](0);
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 30 days, noLocks);

        _amendDocument(0, docId, "tx_2", HASH_B, "V2", 0);

        (, uint256 lastTime,) = registry.getAmendmentRestrictions(0, docId);
        assertEq(lastTime, block.timestamp);
    }

    // ──────────────── Scenario 6d: lockedSections enforcement ────

    function _buildLocalRef(uint256 cat, uint256 doc, uint256 ver, uint8 relationType, string memory targetSection)
        internal
        view
        returns (DocumentReference[] memory)
    {
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(registry),
            chainId: block.chainid,
            categoryId: cat,
            documentId: doc,
            version: ver,
            relationType: relationType,
            targetSection: targetSection
        });
        return refs;
    }

    function _attemptAmendment(
        uint256 cat,
        uint256 doc,
        uint8 docType,
        DocumentReference[] memory refs
    ) internal {
        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: cat,
            documentId: doc,
            contentUri: "tx_attempt",
            contentHash: HASH_B,
            title: "Attempt",
            voteId: "",
            docType: docType
        });
        vm.prank(normalAuth);
        registry.addDocument(input, refs);
    }

    function test_sectionLocked_revertsOnDirectMatch() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "3");

        vm.expectRevert(abi.encodeWithSelector(
            DAARegistry.SectionLocked.selector, 0, docId, 3
        ));
        _attemptAmendment(0, docId, 1, refs);
    }

    function test_sectionLocked_subsectionResolvesToRoot() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "3.1");

        vm.expectRevert(abi.encodeWithSelector(
            DAARegistry.SectionLocked.selector, 0, docId, 3
        ));
        _attemptAmendment(0, docId, 2, refs);
    }

    function test_sectionLocked_multiTargetWithOneLocked() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 5;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "3,5,7.2");

        vm.expectRevert(abi.encodeWithSelector(
            DAARegistry.SectionLocked.selector, 0, docId, 5
        ));
        _attemptAmendment(0, docId, 1, refs);
    }

    function test_sectionLocked_unlockedSectionPasses() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "4");
        _attemptAmendment(0, docId, 1, refs);
        assertEq(registry.getVersionCount(0, docId), 2);
    }

    function test_sectionLocked_skippedForOriginalDocType() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        // docType = 0 (Original) is not in the amendment family; the check must not fire
        // even when the targetSection syntactically matches a locked section.
        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "3");
        _attemptAmendment(0, docId, 0, refs);
        assertEq(registry.getVersionCount(0, docId), 2);
    }

    function test_sectionLocked_skippedForEmptyTargetSection() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "");
        _attemptAmendment(0, docId, 1, refs);
        assertEq(registry.getVersionCount(0, docId), 2);
    }

    function test_sectionLocked_skippedWhenRefsEmpty() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        // Traditional amend-by-version pattern — no refs, no targetSection, no check.
        _amendDocument(0, docId, "tx_v2", HASH_B, "V2", 1);
        assertEq(registry.getVersionCount(0, docId), 2);
    }

    function test_sectionLocked_skippedWhenRefsPointToOtherRegistry() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 3;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        // refs[0] points at some other registry — local locks do not apply across registries.
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(0xBEEF),
            chainId: block.chainid,
            categoryId: 0,
            documentId: docId,
            version: 1,
            relationType: 0,
            targetSection: "3"
        });
        _attemptAmendment(0, docId, 1, refs);
        assertEq(registry.getVersionCount(0, docId), 2);
    }

    function test_sectionLocked_revertsForRepealDocType() public {
        _createCategory("Test");
        (uint256 docId,) = _addNewDocument(0, "tx_1", HASH_A, "Doc", "", 0);

        uint256[] memory locked = new uint256[](1);
        locked[0] = 7;
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        DocumentReference[] memory refs = _buildLocalRef(0, docId, 1, 0, "7");

        vm.expectRevert(abi.encodeWithSelector(
            DAARegistry.SectionLocked.selector, 0, docId, 7
        ));
        _attemptAmendment(0, docId, 3, refs);
    }

    // ──────────────── Scenario 7: Constructor ───────────────

    function test_constructor_setsCoreAuthority() public view {
        assertEq(registry.coreAuthority(), coreAuth);
    }

    function test_constructor_revertsForZeroAddress() public {
        vm.expectRevert(DAARegistry.InvalidAuthority.selector);
        new DAARegistry(address(0));
    }

    // ──────────────── Documents Across Categories ───────────

    function test_documentsAcrossCategoriesAreIndependent() public {
        _createCategory("Category A");
        _createCategory("Category B");

        (uint256 docA,) = _addNewDocument(0, "tx_a1", HASH_A, "Cat A Doc 1", "", 0);
        (uint256 docB,) = _addNewDocument(1, "tx_b1", HASH_B, "Cat B Doc 1", "", 0);

        assertEq(docA, 1);
        assertEq(docB, 1);
        assertEq(registry.getDocumentCount(0), 1);
        assertEq(registry.getDocumentCount(1), 1);
        assertEq(registry.getDocument(0, 1, 1).title, "Cat A Doc 1");
        assertEq(registry.getDocument(1, 1, 1).title, "Cat B Doc 1");
    }

    // ──────────────── Gas Estimation ────────────────────────

    function test_gas_addCategory() public {
        vm.prank(coreAuth);
        uint256 gasBefore = gasleft();
        registry.addCategory("Constitutional Law");
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for addCategory", gasUsed);
    }

    function test_gas_addDocument() public {
        _createCategory("Constitutional Law");

        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
            contentUri: "tx_abc123xyz",
            contentHash: HASH_A,
            title: "Article 1: Fundamental Rights",
            voteId: "snapshot-001",
            docType: 0
        });
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(normalAuth);
        uint256 gasBefore = gasleft();
        registry.addDocument(input, refs);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for addDocument (new)", gasUsed);
    }

    // ──────────────── Fuzz Tests ────────────────────────────

    function testFuzz_addDocument_arbitraryDocType(uint8 docType) public {
        _createCategory("Test");
        (uint256 docId, uint256 v) = _addNewDocument(0, "tx_fuzz", HASH_A, "Fuzz", "", docType);

        assertEq(registry.getDocument(0, docId, v).docType, docType);
    }

    function testFuzz_addCategory_arbitraryName(string calldata name) public {
        vm.prank(coreAuth);
        uint256 id = registry.addCategory(name);

        assertEq(registry.categoryNames(id), name);
    }
}
