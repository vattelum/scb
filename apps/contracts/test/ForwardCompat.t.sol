// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {DAAToken} from "../src/DAAToken.sol";
import {DAARegistry} from "../src/DAARegistry.sol";
import {IDocumentRegistry, Document, DocumentReference} from "@vattelum/document-registry/DocumentRegistry.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";

/// @dev Mock verifier that approves only whitelisted addresses.
contract MockVerifier is IVerifier {
    mapping(address => bool) public approved;

    function setApproved(address account, bool status) external {
        approved[account] = status;
    }

    function isVerified(address account) external view override returns (bool) {
        return approved[account];
    }
}

/// @title Forward Compatibility Tests (US3)
/// @notice Verify that all forward-compatibility fields are present, stored,
///         and retrievable.
contract ForwardCompatTest is Test {
    DAAToken token;
    DAARegistry registry;
    MockVerifier verifier;

    address admin = makeAddr("admin");
    address coreAuth = makeAddr("coreAuth");
    address normalAuth = makeAddr("normalAuth");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant HASH_A = keccak256("forward-compat-a");
    bytes32 constant HASH_B = keccak256("forward-compat-b");
    bytes constant CREDENTIAL = hex"deadbeef";

    function setUp() public {
        token = new DAAToken(admin, true, true);
        registry = new DAARegistry(coreAuth);
        verifier = new MockVerifier();

        vm.startPrank(coreAuth);
        registry.setNormalAuthority(normalAuth);
        registry.addCategory("Constitutional Law");
        vm.stopPrank();
    }

    // ──────────────── Helpers ────────────────────────────────

    function _addDocument(
        string memory contentUri,
        bytes32 contentHash,
        string memory title,
        uint8 docType
    ) internal returns (uint256 documentId, uint256 version) {
        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
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

    function _addDocumentWithRefs(
        string memory contentUri,
        bytes32 contentHash,
        string memory title,
        uint8 docType,
        DocumentReference[] memory refs
    ) internal returns (uint256 documentId, uint256 version) {
        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
            contentUri: contentUri,
            contentHash: contentHash,
            title: title,
            voteId: "",
            docType: docType
        });
        vm.prank(normalAuth);
        return registry.addDocument(input, refs);
    }

    // ──────────────── Scenario 1: docType = 0 round-trip ─────

    function test_docType0_storedAndRetrieved() public {
        (uint256 docId, uint256 v) = _addDocument("tx_dt0", HASH_A, "Legislation", 0);

        Document memory doc = registry.getDocument(0, docId, v);
        assertEq(doc.docType, 0);
    }

    // ──────────────── Scenario 2: docType = 1 round-trip ─────

    function test_docType1_storedAndRetrieved() public {
        (uint256 docId, uint256 v) = _addDocument("tx_dt1", HASH_A, "Amendment", 1);

        Document memory doc = registry.getDocument(0, docId, v);
        assertEq(doc.docType, 1);
    }

    function test_docType_mixedInSameCategory() public {
        (uint256 doc1, uint256 v1) = _addDocument("tx_leg", HASH_A, "Legislation", 0);
        (uint256 doc2, uint256 v2) = _addDocument("tx_amd", HASH_B, "Amendment", 1);

        assertEq(registry.getDocument(0, doc1, v1).docType, 0);
        assertEq(registry.getDocument(0, doc2, v2).docType, 1);
    }

    function test_docType_emittedInEvent() public {
        DAARegistry.DocumentInput memory input = DAARegistry.DocumentInput({
            categoryId: 0,
            documentId: 0,
            contentUri: "tx_evt",
            contentHash: HASH_A,
            title: "Event Test",
            voteId: "",
            docType: 1
        });
        DocumentReference[] memory refs = new DocumentReference[](0);

        vm.prank(normalAuth);
        vm.expectEmit(true, true, true, true);
        emit IDocumentRegistry.DocumentAdded(0, 1, 1, "tx_evt", HASH_A, 1);
        registry.addDocument(input, refs);
    }

    // ──────────────── Scenario 3: relationType = 0 (GOVERNS) ─

    function test_relationType0_governs_storedAndRetrieved() public {
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(0xBEEF),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 0, // GOVERNS
            targetSection: ""
        });

        (uint256 docId, uint256 v) = _addDocumentWithRefs("tx_gov", HASH_A, "Governing Doc", 0, refs);

        DocumentReference[] memory stored = registry.getReferences(0, docId, v);
        assertEq(stored.length, 1);
        assertEq(stored[0].relationType, 0);
        assertEq(stored[0].registryAddress, address(0xBEEF));
    }

    // ──────────────── Scenario 4: All relationTypes 0–4 ──────

    function test_allRelationTypes_storedAndRetrieved() public {
        DocumentReference[] memory refs = new DocumentReference[](5);

        for (uint8 i = 0; i < 5; i++) {
            refs[i] = DocumentReference({
                registryAddress: address(uint160(0x1000 + i)),
                chainId: block.chainid,
                categoryId: i,
                documentId: i + 1,
                version: i + 1,
                relationType: i,
                targetSection: ""
            });
        }

        (uint256 docId, uint256 v) = _addDocumentWithRefs("tx_all_rel", HASH_A, "All Relations", 0, refs);

        DocumentReference[] memory stored = registry.getReferences(0, docId, v);
        assertEq(stored.length, 5);
        for (uint8 i = 0; i < 5; i++) {
            assertEq(stored[i].relationType, i);
            assertEq(stored[i].registryAddress, address(uint160(0x1000 + i)));
            assertEq(stored[i].documentId, i + 1);
            assertEq(stored[i].version, i + 1);
        }
    }

    // ──────────────── Scenario 5: Verifier set/gate ──────────

    function test_verifier_setByAdmin() public {
        vm.prank(admin);
        token.setVerifier(address(verifier));

        assertEq(address(token.verifier()), address(verifier));
    }

    function test_verifier_gatesMinting() public {
        vm.prank(admin);
        token.setVerifier(address(verifier));

        // Unapproved address — mint should revert
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.VerifierRejected.selector, alice));
        token.mint(CREDENTIAL);

        // Approve and retry — should succeed
        verifier.setApproved(alice, true);
        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    function test_verifier_noVerifierAllowsAll() public {
        assertEq(address(token.verifier()), address(0));

        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    function test_verifier_removedWithZeroAddress() public {
        vm.startPrank(admin);
        token.setVerifier(address(verifier));
        token.setVerifier(address(0));
        vm.stopPrank();

        assertEq(address(token.verifier()), address(0));

        // Should mint without verification
        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    // ──────────────── Scenario 6: Amendment restrictions passthrough ──

    function test_amendmentRestrictions_defaultDoNotBlock() public {
        // No restrictions set — addDocument should succeed freely
        _addDocument("tx_no_restrict_1", HASH_A, "First", 0);
        (uint256 doc2,) = _addDocument("tx_no_restrict_2", HASH_B, "Second", 0);

        assertEq(doc2, 2);
    }

    function test_amendmentRestrictions_zeroMinTimeDoesNotBlock() public {
        (uint256 docId,) = _addDocument("tx_pre", HASH_A, "Pre-doc", 0);

        uint256[] memory locked = new uint256[](0);
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, locked);

        // Adding new documents still works (no enforcement on-chain)
        _addDocument("tx_z1", HASH_A, "First", 0);
        (uint256 doc2,) = _addDocument("tx_z2", HASH_B, "Immediate Second", 0);
        assertEq(doc2, 3);
    }

    // ──────────────── Scenario 7: Amendment restriction fields round-trip ─

    function test_lockedSections_roundTrip() public {
        (uint256 docId,) = _addDocument("tx_pre", HASH_A, "Pre-doc", 0);

        uint256[] memory sections = new uint256[](4);
        sections[0] = 1;
        sections[1] = 3;
        sections[2] = 7;
        sections[3] = 12;

        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, sections);

        (,, uint256[] memory stored) = registry.getAmendmentRestrictions(0, docId);
        assertEq(stored.length, 4);
        assertEq(stored[0], 1);
        assertEq(stored[1], 3);
        assertEq(stored[2], 7);
        assertEq(stored[3], 12);
    }

    function test_allOptionalFields_combinedRoundTrip() public {
        (uint256 docId,) = _addDocument("tx_pre", HASH_A, "Pre-doc", 0);

        uint256[] memory sections = new uint256[](2);
        sections[0] = 0;
        sections[1] = 5;

        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 90 days, sections);

        (uint256 minTime,, uint256[] memory stored) = registry.getAmendmentRestrictions(0, docId);

        assertEq(minTime, 90 days);
        assertEq(stored.length, 2);
        assertEq(stored[0], 0);
        assertEq(stored[1], 5);
    }

    function test_optionalFields_overwritable() public {
        (uint256 docId,) = _addDocument("tx_pre", HASH_A, "Pre-doc", 0);

        uint256[] memory sections1 = new uint256[](2);
        sections1[0] = 1;
        sections1[1] = 2;

        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 30 days, sections1);

        // Overwrite with different values
        uint256[] memory sections2 = new uint256[](1);
        sections2[0] = 99;

        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 60 days, sections2);

        (uint256 minTime,, uint256[] memory stored) = registry.getAmendmentRestrictions(0, docId);

        assertEq(minTime, 60 days);
        assertEq(stored.length, 1);
        assertEq(stored[0], 99);
    }

    function test_optionalFields_emptyLockedSections() public {
        (uint256 docId,) = _addDocument("tx_pre", HASH_A, "Pre-doc", 0);

        uint256[] memory empty = new uint256[](0);
        vm.prank(coreAuth);
        registry.setAmendmentRestrictions(0, docId, 0, empty);

        (uint256 minTime,, uint256[] memory stored) = registry.getAmendmentRestrictions(0, docId);

        assertEq(minTime, 0);
        assertEq(stored.length, 0);
    }

    // ──────────────── Fuzz: docType any uint8 ────────────────

    function testFuzz_docType_anyValue(uint8 docType) public {
        (uint256 docId, uint256 v) = _addDocument("tx_fuzz_dt", HASH_A, "Fuzz DocType", docType);
        assertEq(registry.getDocument(0, docId, v).docType, docType);
    }

    // ──────────────── Fuzz: relationType any uint8 ───────────

    function testFuzz_relationType_anyValue(uint8 relationType) public {
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(0xDEAD),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: relationType,
            targetSection: "2.1.A"
        });

        (uint256 docId, uint256 v) = _addDocumentWithRefs("tx_fuzz_rt", HASH_A, "Fuzz RelType", 0, refs);
        assertEq(registry.getReferences(0, docId, v)[0].relationType, relationType);
        assertEq(registry.getReferences(0, docId, v)[0].targetSection, "2.1.A");
    }

    // ──────────────── targetSection round-trip ─────────────────

    function test_targetSection_emptyStringForWholeDocument() public {
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

        (uint256 docId, uint256 v) = _addDocumentWithRefs("tx_ts_empty", HASH_A, "Whole Doc Ref", 0, refs);
        assertEq(registry.getReferences(0, docId, v)[0].targetSection, "");
    }

    function test_targetSection_specificSection() public {
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(0xBEEF),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 0,
            targetSection: "1.4"
        });

        (uint256 docId, uint256 v) = _addDocumentWithRefs("tx_ts_sec", HASH_A, "Section Ref", 0, refs);
        assertEq(registry.getReferences(0, docId, v)[0].targetSection, "1.4");
    }

    function test_targetSection_multipleCommaSeparated() public {
        DocumentReference[] memory refs = new DocumentReference[](1);
        refs[0] = DocumentReference({
            registryAddress: address(0xBEEF),
            chainId: block.chainid,
            categoryId: 0,
            documentId: 1,
            version: 1,
            relationType: 2,
            targetSection: "1,2.1,3"
        });

        (uint256 docId, uint256 v) = _addDocumentWithRefs("tx_ts_multi", HASH_A, "Multi Section", 0, refs);
        assertEq(registry.getReferences(0, docId, v)[0].targetSection, "1,2.1,3");
    }
}
