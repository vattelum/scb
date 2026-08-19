// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {
    IDocumentRegistry,
    IDocumentRegistryEnumerable,
    Document,
    DocumentReference,
    DOC_TYPE_ORIGINAL,
    DOC_TYPE_AMENDMENT,
    DOC_TYPE_REVISION,
    DOC_TYPE_REPEAL,
    DOC_TYPE_CODIFICATION,
    RELATION_AMENDS,
    RELATION_REVISES,
    RELATION_REPEALS,
    RELATION_CODIFIES,
    RELATION_GOVERNS,
    RELATION_IMPLEMENTS,
    RELATION_REFERENCES,
    RELATION_TEMPLATE
} from "@vattelum/document-registry/DocumentRegistry.sol";

/// @title DAARegistry — On-Chain Document Registry
/// @notice Append-only registry of ratified documents organized by category with a document
///         layer (categories as folders containing independent documents), external references,
///         per-document amendment restrictions, and two-tier governance authority.
contract DAARegistry is IDocumentRegistry, IDocumentRegistryEnumerable {
    // ──────────────────────── Structs ──────────────────────────

    struct DocumentInput {
        uint256 categoryId;
        uint256 documentId;
        string contentUri;
        bytes32 contentHash;
        string title;
        string voteId;
        uint8 docType;
    }

    struct AmendmentRestrictions {
        uint256 minTimeBetweenAmendments;
        uint256 lastAmendmentTime;
        uint256[] lockedSections;
    }

    // ──────────────────────── State ───────────────────────────

    address public normalAuthority;
    address public coreAuthority;
    mapping(uint256 => string) public categoryNames;
    uint256 public categoryCount;
    mapping(uint256 => uint256) private _documentCounts;
    mapping(uint256 => mapping(uint256 => uint256)) private _versionCounts;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => Document))) private _documents;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => DocumentReference[]))) private _references;
    mapping(uint256 => mapping(uint256 => AmendmentRestrictions)) private _amendmentRestrictions;

    // ──────────────────────── Events ──────────────────────────

    event CategoryAdded(uint256 indexed categoryId, string name);
    event NormalAuthorityTransferred(address indexed previous, address indexed current);
    event CoreAuthorityTransferred(address indexed previous, address indexed current);
    event AmendmentRestrictionsUpdated(uint256 indexed categoryId, uint256 indexed documentId);

    // ──────────────────────── Errors ──────────────────────────

    error NotAuthority();
    error NotCoreAuthority();
    error CategoryDoesNotExist(uint256 categoryId);
    error DocumentDoesNotExist(uint256 categoryId, uint256 documentId);
    error VersionDoesNotExist(uint256 categoryId, uint256 documentId, uint256 version);
    error InvalidAuthority();
    error AmendmentTooSoon(uint256 categoryId, uint256 documentId, uint256 earliestAllowed);
    error SectionLocked(uint256 categoryId, uint256 documentId, uint256 lockedSection);
    error IndexOutOfRange(uint256 index, uint256 count);

    // ──────────────────────── Modifiers ──────────────────────

    modifier onlyAuthority() {
        if (msg.sender != normalAuthority && msg.sender != coreAuthority) {
            revert NotAuthority();
        }
        _;
    }

    modifier onlyCoreAuthority() {
        if (msg.sender != coreAuthority) {
            revert NotCoreAuthority();
        }
        _;
    }

    // ──────────────────────── Constructor ─────────────────────

    constructor(address _coreAuthority) {
        if (_coreAuthority == address(0)) {
            revert InvalidAuthority();
        }
        coreAuthority = _coreAuthority;
        emit CoreAuthorityTransferred(address(0), _coreAuthority);
    }

    // ──────────────────────── Public / External ──────────────

    /// @notice Create a new document category.
    /// @param name Human-readable category name.
    /// @return categoryId The sequential ID assigned to the new category.
    function addCategory(string calldata name) external onlyCoreAuthority returns (uint256) {
        uint256 categoryId = categoryCount++;
        categoryNames[categoryId] = name;

        emit CategoryAdded(categoryId, name);
        return categoryId;
    }

    /// @notice Record a ratified document on-chain. Append-only.
    /// @param input Document metadata. documentId = 0 creates a new document, > 0 amends existing.
    /// @param refs Array of external references (can be empty).
    /// @return documentId The document ID (new or existing).
    /// @return version The auto-incremented version number assigned.
    function addDocument(DocumentInput calldata input, DocumentReference[] calldata refs)
        external
        onlyAuthority
        returns (uint256 documentId, uint256 version)
    {
        return _addDocument(input, refs);
    }

    /// @notice Atomically add a new document and configure its amendment restrictions in a single
    ///         transaction. Closes the bundled-restrictions documentId race: the assigned ID is
    ///         known inside this call, so no client-side prediction is needed.
    /// @dev coreAuthority-gated to match `setAmendmentRestrictions` — strictest of the two
    ///      operations governs. `input.documentId` MUST be 0; this entry point is for new docs
    ///      only. Existing-document restriction changes still go through `setAmendmentRestrictions`.
    function addDocumentWithRestrictions(
        DocumentInput calldata input,
        DocumentReference[] calldata refs,
        uint256 minTimeBetweenAmendments,
        uint256[] calldata lockedSections
    )
        external
        onlyCoreAuthority
        returns (uint256 documentId, uint256 version)
    {
        if (input.documentId != 0) {
            revert DocumentDoesNotExist(input.categoryId, input.documentId);
        }
        (documentId, version) = _addDocument(input, refs);
        AmendmentRestrictions storage r = _amendmentRestrictions[input.categoryId][documentId];
        r.minTimeBetweenAmendments = minTimeBetweenAmendments;
        r.lockedSections = lockedSections;
        emit AmendmentRestrictionsUpdated(input.categoryId, documentId);
    }

    function _addDocument(DocumentInput calldata input, DocumentReference[] calldata refs)
        internal
        returns (uint256 documentId, uint256 version)
    {
        if (input.categoryId >= categoryCount) {
            revert CategoryDoesNotExist(input.categoryId);
        }

        if (input.documentId == 0) {
            documentId = ++_documentCounts[input.categoryId];
        } else {
            if (input.documentId > _documentCounts[input.categoryId]) {
                revert DocumentDoesNotExist(input.categoryId, input.documentId);
            }
            documentId = input.documentId;
        }

        AmendmentRestrictions storage restrictions = _amendmentRestrictions[input.categoryId][documentId];
        if (
            restrictions.minTimeBetweenAmendments > 0 &&
            restrictions.lastAmendmentTime > 0 &&
            block.timestamp < restrictions.lastAmendmentTime + restrictions.minTimeBetweenAmendments
        ) {
            revert AmendmentTooSoon(
                input.categoryId,
                documentId,
                restrictions.lastAmendmentTime + restrictions.minTimeBetweenAmendments
            );
        }

        // Amendment-family docTypes (1 Amendment, 2 Revision, 3 Repeal) may not target a locked
        // section. refs[0] carries the target per C&R v6 §3.1; when refs[0] points at a local
        // document, its lockedSections govern. Multi-target targetSection strings are split on
        // commas; subsection identifiers (e.g. "3.1") resolve to their root (3) for lock purposes.
        if (input.docType == 1 || input.docType == 2 || input.docType == 3) {
            if (refs.length > 0 && refs[0].registryAddress == address(this)) {
                uint256 targetCat = refs[0].categoryId;
                uint256 targetDoc = refs[0].documentId;
                if (
                    targetCat < categoryCount &&
                    targetDoc > 0 &&
                    targetDoc <= _documentCounts[targetCat]
                ) {
                    _checkLockedSections(
                        refs[0].targetSection,
                        _amendmentRestrictions[targetCat][targetDoc].lockedSections,
                        targetCat,
                        targetDoc
                    );
                }
            }
        }

        version = ++_versionCounts[input.categoryId][documentId];

        _documents[input.categoryId][documentId][version] = Document({
            contentUri: input.contentUri,
            contentHash: input.contentHash,
            title: input.title,
            version: version,
            timestamp: block.timestamp,
            voteId: input.voteId,
            docType: input.docType
        });

        for (uint256 i = 0; i < refs.length; i++) {
            _references[input.categoryId][documentId][version].push(refs[i]);
        }

        if (restrictions.minTimeBetweenAmendments > 0) {
            restrictions.lastAmendmentTime = block.timestamp;
        }

        emit DocumentAdded(input.categoryId, documentId, version, input.contentUri, input.contentHash, input.docType);
    }

    // ──────────────────────── Read Functions ──────────────────

    /// @notice Retrieve a specific document version.
    function getDocument(uint256 categoryId, uint256 documentId, uint256 version)
        external
        view
        override
        returns (Document memory)
    {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        if (version == 0 || version > _versionCounts[categoryId][documentId]) {
            revert VersionDoesNotExist(categoryId, documentId, version);
        }
        return _documents[categoryId][documentId][version];
    }

    /// @notice Retrieve the most recent version of a document.
    function getLatest(uint256 categoryId, uint256 documentId) external view returns (Document memory) {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        uint256 latest = _versionCounts[categoryId][documentId];
        if (latest == 0) {
            revert VersionDoesNotExist(categoryId, documentId, 0);
        }
        return _documents[categoryId][documentId][latest];
    }

    /// @notice Retrieve all versions of a document.
    function getHistory(uint256 categoryId, uint256 documentId) external view override returns (Document[] memory) {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        uint256 count = _versionCounts[categoryId][documentId];
        Document[] memory docs = new Document[](count);
        for (uint256 i = 0; i < count; i++) {
            docs[i] = _documents[categoryId][documentId][i + 1];
        }
        return docs;
    }

    /// @notice Retrieve external references for a document version.
    function getReferences(uint256 categoryId, uint256 documentId, uint256 version)
        external
        view
        override
        returns (DocumentReference[] memory)
    {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        if (version == 0 || version > _versionCounts[categoryId][documentId]) {
            revert VersionDoesNotExist(categoryId, documentId, version);
        }
        return _references[categoryId][documentId][version];
    }

    /// @notice Retrieve the version count for a document.
    function getVersionCount(uint256 categoryId, uint256 documentId) external view returns (uint256) {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        return _versionCounts[categoryId][documentId];
    }

    /// @notice Retrieve the document count for a category.
    function getDocumentCount(uint256 categoryId) external view override returns (uint256) {
        _requireCategory(categoryId);
        return _documentCounts[categoryId];
    }

    /// @notice Number of categories, for position-based enumeration.
    function getCategoryCount() external view override returns (uint256) {
        return categoryCount;
    }

    /// @notice Category id at a 0-based position. Categories are numbered from 0, so position and
    ///         id coincide here; consumers read through this accessor rather than assuming that.
    function getCategoryIdAt(uint256 index) external view override returns (uint256) {
        if (index >= categoryCount) {
            revert IndexOutOfRange(index, categoryCount);
        }
        return index;
    }

    /// @notice Document id at a 0-based position within a category. Documents are numbered from 1.
    function getDocumentIdAt(uint256 categoryId, uint256 index) external view override returns (uint256) {
        _requireCategory(categoryId);
        uint256 count = _documentCounts[categoryId];
        if (index >= count) {
            revert IndexOutOfRange(index, count);
        }
        return index + 1;
    }

    /// @notice Retrieve amendment restrictions for a document.
    function getAmendmentRestrictions(uint256 categoryId, uint256 documentId)
        external
        view
        returns (uint256 minTimeBetweenAmendments, uint256 lastAmendmentTime, uint256[] memory lockedSections)
    {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        AmendmentRestrictions storage r = _amendmentRestrictions[categoryId][documentId];
        return (r.minTimeBetweenAmendments, r.lastAmendmentTime, r.lockedSections);
    }

    // ──────────────────────── Governance ──────────────────────

    /// @notice Set the normal authority address (routine governance).
    /// @param newAuthority The new normal authority (cannot be address(0)).
    function setNormalAuthority(address newAuthority) external onlyCoreAuthority {
        if (newAuthority == address(0)) {
            revert InvalidAuthority();
        }
        address previous = normalAuthority;
        normalAuthority = newAuthority;
        emit NormalAuthorityTransferred(previous, newAuthority);
    }

    /// @notice Set the core authority address (structural governance).
    /// @param newAuthority The new core authority (cannot be address(0)).
    function setCoreAuthority(address newAuthority) external onlyCoreAuthority {
        if (newAuthority == address(0)) {
            revert InvalidAuthority();
        }
        address previous = coreAuthority;
        coreAuthority = newAuthority;
        emit CoreAuthorityTransferred(previous, newAuthority);
    }

    /// @notice Configure amendment restrictions for a document.
    function setAmendmentRestrictions(
        uint256 categoryId,
        uint256 documentId,
        uint256 minTimeBetweenAmendments,
        uint256[] calldata lockedSections
    ) external onlyCoreAuthority {
        _requireCategory(categoryId);
        _requireDocument(categoryId, documentId);
        AmendmentRestrictions storage r = _amendmentRestrictions[categoryId][documentId];
        r.minTimeBetweenAmendments = minTimeBetweenAmendments;
        r.lockedSections = lockedSections;

        emit AmendmentRestrictionsUpdated(categoryId, documentId);
    }

    // ──────────────────────── Internal ────────────────────────

    function _requireCategory(uint256 categoryId) internal view {
        if (categoryId >= categoryCount) {
            revert CategoryDoesNotExist(categoryId);
        }
    }

    function _requireDocument(uint256 categoryId, uint256 documentId) internal view {
        if (documentId == 0 || documentId > _documentCounts[categoryId]) {
            revert DocumentDoesNotExist(categoryId, documentId);
        }
    }

    /// @dev Parse a targetSection string (e.g. "3", "3.1", "3,5,7.2") and revert if any
    ///      root section number appears in the provided lockedSections. Digits before a
    ///      '.' or ',' form the root; non-digit characters terminate the current number.
    function _checkLockedSections(
        string memory targetSection,
        uint256[] storage lockedSections,
        uint256 targetCategoryId,
        uint256 targetDocumentId
    ) internal view {
        if (lockedSections.length == 0) return;
        bytes memory bs = bytes(targetSection);
        if (bs.length == 0) return;

        uint256 current = 0;
        bool reading = true;
        bool hasDigit = false;

        for (uint256 i = 0; i < bs.length; i++) {
            bytes1 c = bs[i];
            if (c == 0x2C /* ',' */) {
                if (hasDigit) {
                    _revertIfLocked(current, lockedSections, targetCategoryId, targetDocumentId);
                }
                current = 0;
                reading = true;
                hasDigit = false;
            } else if (c == 0x2E /* '.' */) {
                reading = false;
            } else if (reading && c >= 0x30 && c <= 0x39) {
                current = current * 10 + (uint8(c) - 0x30);
                hasDigit = true;
            }
        }
        if (hasDigit) {
            _revertIfLocked(current, lockedSections, targetCategoryId, targetDocumentId);
        }
    }

    function _revertIfLocked(
        uint256 sectionNumber,
        uint256[] storage lockedSections,
        uint256 targetCategoryId,
        uint256 targetDocumentId
    ) internal view {
        for (uint256 i = 0; i < lockedSections.length; i++) {
            if (lockedSections[i] == sectionNumber) {
                revert SectionLocked(targetCategoryId, targetDocumentId, sectionNumber);
            }
        }
    }
}
