<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { readContract } from '@wagmi/core';
	import { config } from '$lib/services/wallet-config';
	import { daaRegistryConfig, daaRegistryAddress, coreStrategyAddress } from '$lib/contracts';
	import { wallet } from '$lib/stores/wallet';
	import { loadCategories as fetchCategories, loadDocuments, loadAmendmentRestrictions, loadDocumentBody, type CategoryInfo, type DocumentInfo } from '$lib/services/registry';
	import Editor from '$lib/components/Editor.svelte';
	import {
		type Section,
		createSection,
		sectionsToMarkdown,
		buildDocument,
		parseDocument,
		renderSectionedMarkdown,
		wrapWithFrontmatter,
		validateMarkdownUpload,
		MarkdownUnsafeError
	} from '$lib/services/markdown';
	import { uploadDocument, verifyTurboHas } from '$lib/services/arweave';
	import ProposalConfirmation, { type ProposalConfirmationData } from '$lib/components/ProposalConfirmation.svelte';
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import LoadingButton from '$lib/components/LoadingButton.svelte';
	import { showToast } from '$lib/stores/toasts';
	import { hashBody } from '@vattelum/document-registry-js';
	import { hashToBytes32 } from '$lib/services/hash';
	import {
		DOC_TYPES,
		DOC_TYPE_TO_RELATION,
		docTypeLabel,
		relationLabel,
		requiresReferences,
		allowsMultipleReferences,
		supportsSectionTargeting
	} from '$lib/constants/docTypes';
	import { computeSectionNumber, sortByFixedNumber } from '$lib/services/markdown';
	import {
		parseVariableSchema,
		serializeVariableSchema,
		parseRoleSchema,
		serializeRoleSchema,
		type TemplateVariable,
		type TemplateRole
	} from '$lib/services/template-variables';
	import RolesEditor from '$lib/components/RolesEditor.svelte';
	import TemplateVarsEditor from '$lib/components/TemplateVarsEditor.svelte';
	import AmendmentRestrictions from '$lib/components/AmendmentRestrictions.svelte';
	import TargetDocumentPicker from '$lib/components/TargetDocumentPicker.svelte';
	import SectionTargetPicker from '$lib/components/SectionTargetPicker.svelte';
	import { contractTemplateCategoryId } from '$lib/contracts';
	import { formatDate, formatCountdown } from '$lib/services/format';
	import { createDraftStore } from '$lib/services/draft';
	import { chainIdToLabel, explorerTxUrl } from '$lib/constants/networks';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import {
		createProposal,
		encodeAddDocumentTransaction,
		encodeAddDocumentWithRestrictionsTransaction,
		encodeSetAmendmentRestrictionsTransaction,
		selectStrategy,
		strategyLabel,
		type MetaTransaction
	} from '$lib/services/snapshot-x';
	const chainId = Number(import.meta.env.VITE_CHAIN_ID);

	interface VersionInfo {
		version: number;
		title: string;
		docType: number;
	}

	// Form state
	let title = $state('');
	let categoryId = $state(-1);
	let documentId = $state(0); // 0 = new document, >0 = amend existing
	let docType = $state(0);
	let selectedRefs = $state<Array<{ documentId: number; version: number }>>([]);
	let categoryDocuments = $state<DocumentInfo[]>([]);
	let documentVersions = $state<VersionInfo[]>([]);
	let loadingDocuments = $state(false);
	let loadingVersions = $state(false);
	let sections = $state<Section[]>([createSection(1)]);

	// Section targeting
	interface TargetSectionInfo {
		number: string;
		title: string;
		content: string;
		depth: 1 | 2 | 3;
	}
	let selectedTargetSections = $state<string[]>([]);
	let availableTargetSections = $state<TargetSectionInfo[]>([]);
	let allParsedSections = $state<Section[]>([]);
	let newSectionsOnly = $state(false);
	let loadingTargetDoc = $state(false);
	let targetDocError = $state('');
	let targetDocTitle = $state('');
	let targetDocVariables = $state<TemplateVariable[]>([]);

	// Repeal state
	let repealReason = $state('');

	// Template variable builder (visible when category is Contract Templates)
	let templateVars = $state<TemplateVariable[]>([]);
	let templateRoles = $state<TemplateRole[]>([]);
	let isContractTemplate = $derived(contractTemplateCategoryId !== null && categoryId === contractTemplateCategoryId);

	// Title is auto-derived from the target for Amendment/Revision/Repeal, so the field is read-only.
	// Uniqueness is only enforced for Original — Codification keeps its name free.
	let titleLocked = $derived(docType === 1 || docType === 2 || docType === 3);
	let titleDuplicate = $derived.by(() => {
		if (docType !== 0) return false;
		const t = title.trim();
		if (!t) return false;
		return categoryDocuments.some((d) => d.latestTitle.trim() === t);
	});

	// Amendment restrictions (existing, read from contract)
	let lockedSections = $state<number[]>([]);
	let minTimeBetweenAmendments = $state(0);
	let lastAmendmentTime = $state(0);
	let loadingRestrictions = $state(false);
	let withinInterval = $state(false); // true = within time lock period, routes to 70%
	let nextWindowTime = $state(0);

	// Restriction proposal fields (new, set by proposer)
	let proposeRestrictions = $state(false);
	let proposeTimeLock = $state(0); // seconds; 0 = none
	let proposeTimeLockCustomDays = $state('');
	let proposeTimeLockPreset = $state('permanent'); // 'permanent' | '90' | '180' | '360' | 'custom'
	let proposeLockMode = $state<'entire' | 'specific'>('entire'); // default: entire document
	let proposeLockedSections = $state<number[]>([]); // specific section numbers

	/** Whether the proposer has set any restrictions */
	function hasProposedRestrictions(): boolean {
		if (!proposeRestrictions) return false;
		return proposeTimeLock > 0 || proposeLockMode === 'entire' || proposeLockedSections.length > 0;
	}

	/** Get the lockedSections array to encode on-chain. [0] = entire document sentinel. */
	function getProposedLockedSections(): bigint[] {
		if (!proposeRestrictions) return [];
		if (proposeLockMode === 'entire') return [0n]; // sentinel for entire document
		return proposeLockedSections.map(s => BigInt(s));
	}

	/** Get top-level section numbers from the current editor content */
	function getTopLevelSectionNumbers(): number[] {
		const nums = new Set<number>();
		for (const sec of sections) {
			if (sec.depth === 1 && sec.fixedNumber) {
				const num = parseInt(sec.fixedNumber.split('.')[0], 10);
				if (num > 0) nums.add(num);
			} else if (sec.depth === 1) {
				// For new originals without fixedNumber, use index-based numbering
				nums.add(sections.filter(s => s.depth === 1).indexOf(sec) + 1);
			}
		}
		return [...nums].sort((a, b) => a - b);
	}

	function resetRestrictionFields() {
		proposeRestrictions = false;
		proposeTimeLock = 0;
		proposeTimeLockPreset = 'permanent';
		proposeTimeLockCustomDays = '';
		proposeLockMode = 'entire';
		proposeLockedSections = [];
	}

	/** Whether the proposal touches any locked sections */
	function touchesLockedSections(): boolean {
		if (lockedSections.length === 0) return false;
		if (lockedSections.includes(0)) return true; // sentinel: entire document locked
		if (newSectionsOnly) return false; // adding new sections doesn't target existing locked sections
		if (selectedTargetSections.length === 0) return true; // whole document — touches everything
		return selectedTargetSections.some(sec => {
			const topLevel = parseInt(sec.split('.')[0], 10);
			return lockedSections.includes(topLevel);
		});
	}

	/** Get the strategy address based on whether locked sections are targeted or within interval */
	function getStrategyAddress(): `0x${string}` {
		// Revisions replace the entire document — always core strategy
		if (docType === 2) return selectStrategy(true);
		// Interval only applies when targeting locked sections
		if (touchesLockedSections() && withinInterval) return selectStrategy(true);
		return selectStrategy(touchesLockedSections());
	}

	/** Load amendment restrictions for the selected document */
	async function loadRestrictions(catId: number, docId: number) {
		if (catId < 0 || docId <= 0) {
			lockedSections = [];
			minTimeBetweenAmendments = 0;
			lastAmendmentTime = 0;
			withinInterval = false;
			return;
		}
		loadingRestrictions = true;
		try {
			const restrictions = await loadAmendmentRestrictions(catId, docId);
			lockedSections = restrictions.lockedSections;
			minTimeBetweenAmendments = restrictions.minTimeBetweenAmendments;
			lastAmendmentTime = restrictions.lastAmendmentTime;

			if (minTimeBetweenAmendments > 0 && lastAmendmentTime > 0) {
				const now = Math.floor(Date.now() / 1000);
				const windowOpensAt = lastAmendmentTime + minTimeBetweenAmendments;
				withinInterval = now < windowOpensAt;
				nextWindowTime = windowOpensAt;
			} else {
				withinInterval = false;
				nextWindowTime = 0;
			}
		} catch {
			lockedSections = [];
			minTimeBetweenAmendments = 0;
			lastAmendmentTime = 0;
			withinInterval = false;
		} finally {
			loadingRestrictions = false;
		}
	}

	function targetSectionValue(): string {
		return selectedTargetSections.join(',');
	}

	function titleSuffix(): string {
		if (docType === 3 && selectedTargetSections.length > 0) return 'Partial Repeal';
		return docTypeLabel(docType);
	}

	function baseTitle(t: string): string {
		return t.replace(/\s+v\d+$/, '');
	}

	function revisionTitle(targetTitle: string, targetDocType: number): string {
		if (targetDocType === 2) {
			const match = targetTitle.match(/\s+v(\d+)$/);
			const currentVersion = match ? parseInt(match[1], 10) : 2;
			return `${baseTitle(targetTitle)} v${currentVersion + 1}`;
		}
		return `${baseTitle(targetTitle)} v2`;
	}

	function updateTitle() {
		if (!targetDocTitle) return;
		title = `${targetDocTitle} (${titleSuffix()})`;
	}

	function isImplicitlySelected(sectionNumber: string): boolean {
		return selectedTargetSections.some(sel => {
			if (sel === sectionNumber) return false;
			return sectionNumber.startsWith(sel + '.');
		});
	}

	function sortedSelectedSections(): string[] {
		const order = availableTargetSections.map(s => s.number);
		return [...selectedTargetSections].sort((a, b) => order.indexOf(a) - order.indexOf(b));
	}

	function isAmendmentMode(): boolean {
		return docType === 1;
	}

	function isRepealMode(): boolean {
		return docType === 3 && selectedRefs.length === 1;
	}

	function originalSectionNumbers(): string[] {
		return availableTargetSections.map(s => s.number);
	}

	function handleNewSectionsOnlyChange(value: boolean) {
		newSectionsOnly = value;
		if (value) {
			selectedTargetSections = [];
			sections = [];
		} else {
			sections = allParsedSections.map((s, i) => {
				const sec = createSection(s.depth);
				sec.title = s.title;
				sec.content = s.content;
				sec.fixedNumber = computeSectionNumber(allParsedSections, i).replace('§', '');
				return sec;
			});
		}
		updateTitle();
	}

	// Page state
	let categories = $state<CategoryInfo[]>([]);
	let loadingCategories = $state(true);
	let submitting = $state(false);
	let submitStep = $state('');
	let submitError = $state('');
	let importError = $state('');

	// Review modal
	let showReview = $state(false);
	let reviewHtml = $state('');

	// Confirmation
	let confirmed = $state(false);
	let confirmData = $state<ProposalConfirmationData | null>(null);

	// Persist a Turbo tx ID across retries when its post-upload verification
	// fails. Cleared on body change, on a failed re-check, and on success.
	let pendingContentUri = $state<string | null>(null);
	let pendingContentHash = $state<string | null>(null);

	async function loadCategories() {
		try {
			categories = await fetchCategories();
		} catch (e) {
			submitError = e instanceof Error ? e.message : 'Failed to load categories';
		} finally {
			loadingCategories = false;
		}
	}

	async function loadDocsForCategory(catId: number) {
		if (catId < 0) {
			categoryDocuments = [];
			return;
		}
		loadingDocuments = true;
		try {
			categoryDocuments = await loadDocuments(catId);
		} catch {
			categoryDocuments = [];
		} finally {
			loadingDocuments = false;
		}
	}

	async function loadVersionsForDocument(catId: number, docId: number) {
		if (catId < 0 || docId <= 0) {
			documentVersions = [];
			return;
		}
		loadingVersions = true;
		try {
			const history = (await readContract(config, {
				...daaRegistryConfig,
				functionName: 'getHistory',
				args: [BigInt(catId), BigInt(docId)]
			})) as Array<{ title: string; version: bigint; docType: number }>;
			documentVersions = history.map((d) => ({
				version: Number(d.version),
				title: d.title,
				docType: d.docType
			}));
		} catch {
			documentVersions = [];
		} finally {
			loadingVersions = false;
		}
	}

	async function loadTargetDocSections(docId: number, version: number) {
		selectedTargetSections = [];
		newSectionsOnly = false;
		availableTargetSections = [];
		allParsedSections = [];
		targetDocError = '';
		targetDocTitle = '';
		if (version <= 0 || categoryId < 0 || docId <= 0) return;

		const ver = documentVersions.find((v) => v.version === version);
		if (!ver) return;

		targetDocTitle = ver.title;
		title = docType === 2 ? revisionTitle(ver.title, ver.docType) : `${ver.title} (${docTypeLabel(docType)})`;

		loadingTargetDoc = true;
		try {
			const doc = await loadDocumentBody(categoryId, docId, version);
			targetDocVariables = doc.variables;
			const parsed = doc.sections;
			if (parsed.length === 0) {
				targetDocError = 'No parseable sections found in the target document.';
				return;
			}

			allParsedSections = parsed;
			availableTargetSections = parsed.map((s, i) => ({
				number: computeSectionNumber(parsed, i).replace('§', ''),
				title: s.title,
				content: s.content,
				depth: s.depth
			}));

			sections = parsed.map((s, i) => {
				const sec = createSection(s.depth);
				sec.title = s.title;
				sec.content = s.content;
				sec.fixedNumber = computeSectionNumber(parsed, i).replace('§', '');
				return sec;
			});
		} catch {
			targetDocError = 'Could not fetch target document. You can still proceed with whole-document mode.';
		} finally {
			loadingTargetDoc = false;
		}
	}

	function handleSectionToggle(sectionNumber: string) {

		const isSelected = selectedTargetSections.includes(sectionNumber);
		if (isSelected) {
			selectedTargetSections = selectedTargetSections.filter(
				(s) => s !== sectionNumber && !s.startsWith(sectionNumber + '.')
			);
		} else {
			if (isImplicitlySelected(sectionNumber)) return;
			const withoutChildren = selectedTargetSections.filter(
				(s) => !s.startsWith(sectionNumber + '.')
			);
			selectedTargetSections = [...withoutChildren, sectionNumber];
		}

		selectedTargetSections = sortedSelectedSections();
		updateTitle();

		if (isRepealMode()) return;

		if (selectedTargetSections.length === 0) {
			sections = allParsedSections.map((s, i) => {
				const sec = createSection(s.depth);
				sec.title = s.title;
				sec.content = s.content;
				sec.fixedNumber = computeSectionNumber(allParsedSections, i).replace('§', '');
				return sec;
			});
		} else {
			const included = availableTargetSections.filter((s) =>
				selectedTargetSections.includes(s.number) || isImplicitlySelected(s.number)
			);
			sections = sortByFixedNumber(included.map((info) => {
				const sec = createSection(info.depth);
				sec.title = info.title;
				sec.content = info.content;
				sec.fixedNumber = info.number;
				return sec;
			}));
		}
	}

	function handleCategoryChange(newCatId: number) {
		categoryId = newCatId;
		documentId = 0;
		selectedRefs = [];
		categoryDocuments = [];
		documentVersions = [];
		selectedTargetSections = [];
		newSectionsOnly = false;
		availableTargetSections = [];
		allParsedSections = [];
		targetDocError = '';
		targetDocTitle = '';
		lockedSections = [];
		minTimeBetweenAmendments = 0;
		lastAmendmentTime = 0;
		withinInterval = false;
		templateVars = [];
		templateRoles = [];
		// Contract Templates are end products — amendment/revision/repeal/codification
		// don't apply. Pin to Original so the UI stays consistent with the locked field.
		if (contractTemplateCategoryId !== null && newCatId === contractTemplateCategoryId) {
			docType = 0;
		}
		loadDocsForCategory(newCatId);
	}

	function handleDocTypeChange(newDocType: number) {
		const prevDocType = docType;
		docType = newDocType;

		if (newDocType === 0) {
			title = '';
			documentId = 0;
			selectedRefs = [];
			selectedTargetSections = [];
		newSectionsOnly = false;
			availableTargetSections = [];
			allParsedSections = [];
			targetDocError = '';
			targetDocTitle = '';
			repealReason = '';
			documentVersions = [];
			lockedSections = [];
			withinInterval = false;
			sections = [createSection(1)];
			return;
		}

		if (newDocType === 4) {
			title = '';
			selectedRefs = [];
			selectedTargetSections = [];
		newSectionsOnly = false;
			availableTargetSections = [];
			allParsedSections = [];
			targetDocError = '';
			targetDocTitle = '';
			repealReason = '';
			sections = [createSection(1)];
			return;
		}

		if (newDocType === 2 && selectedRefs.length === 1) {
			selectedTargetSections = [];
		newSectionsOnly = false;
			availableTargetSections = [];
			allParsedSections = [];
			repealReason = '';
			if (targetDocTitle) {
				const targetVer = documentVersions.find((v) => v.version === selectedRefs[0].version);
				title = revisionTitle(targetDocTitle, targetVer?.docType ?? 0);
			}
			sections = [createSection(1)];
			return;
		}

		if (supportsSectionTargeting(prevDocType) && supportsSectionTargeting(newDocType) && selectedRefs.length === 1) {
			selectedTargetSections = [];
		newSectionsOnly = false;
			repealReason = '';
			updateTitle();
			sections = allParsedSections.map((s, i) => {
				const sec = createSection(s.depth);
				sec.title = s.title;
				sec.content = s.content;
				sec.fixedNumber = computeSectionNumber(allParsedSections, i).replace('§', '');
				return sec;
			});
			return;
		}

		title = '';
		documentId = 0;
		selectedRefs = [];
		selectedTargetSections = [];
		newSectionsOnly = false;
		availableTargetSections = [];
		allParsedSections = [];
		targetDocError = '';
		targetDocTitle = '';
		repealReason = '';
		documentVersions = [];
		lockedSections = [];
		withinInterval = false;
		sections = [createSection(1)];
	}

	function handleDocumentSelect(docId: number) {
		documentId = docId;
		selectedRefs = [];
		selectedTargetSections = [];
		newSectionsOnly = false;
		availableTargetSections = [];
		allParsedSections = [];
		targetDocError = '';
		targetDocTitle = '';
		documentVersions = [];

		if (docId > 0) {
			loadVersionsForDocument(categoryId, docId);
			loadRestrictions(categoryId, docId);
		} else {
			lockedSections = [];
			withinInterval = false;
		}
	}

	function toggleRef(ref: { documentId: number; version: number }) {
		if (allowsMultipleReferences(docType)) {
			const exists = selectedRefs.find(r => r.documentId === ref.documentId && r.version === ref.version);
			if (exists) {
				selectedRefs = selectedRefs.filter(r => !(r.documentId === ref.documentId && r.version === ref.version));
			} else {
				selectedRefs = [...selectedRefs, ref];
			}
		} else {
			const wasSelected = selectedRefs.find(r => r.documentId === ref.documentId && r.version === ref.version);
			selectedRefs = wasSelected ? [] : [ref];
			selectedTargetSections = [];
		newSectionsOnly = false;
			availableTargetSections = [];
			allParsedSections = [];
			targetDocError = '';
			targetDocTitle = '';
			if (!wasSelected && supportsSectionTargeting(docType)) {
				loadTargetDocSections(ref.documentId, ref.version);
			} else if (!wasSelected) {
				const ver = documentVersions.find((v) => v.version === ref.version);
				if (ver) {
					targetDocTitle = ver.title;
					title = docType === 2 ? revisionTitle(ver.title, ver.docType) : `${ver.title} (${docTypeLabel(docType)})`;
				}
			}
		}
	}

	function buildExternalRefs(): Array<{
		registryAddress: string;
		chainId: bigint;
		categoryId: bigint;
		documentId: bigint;
		version: bigint;
		relationType: number;
		targetSection: string;
	}> {
		if (!requiresReferences(docType) || selectedRefs.length === 0) return [];
		const relationType = DOC_TYPE_TO_RELATION[docType];
		return selectedRefs.map((ref) => ({
			registryAddress: daaRegistryAddress,
			chainId: BigInt(chainId),
			categoryId: BigInt(categoryId),
			documentId: BigInt(ref.documentId),
			version: BigInt(ref.version),
			relationType,
			targetSection: targetSectionValue()
		}));
	}

	// Draft auto-save
	interface DraftState {
		title: string;
		categoryId: number;
		documentId: number;
		docType: number;
		selectedRefs: Array<{ documentId: number; version: number }>;
		selectedTargetSections: string[];
		repealReason: string;
		sections: Array<{ depth: number; title: string; content: string; fixedNumber?: string }>;
	}

	const draft = createDraftStore<DraftState>(
		'daa:draft',
		() => {
			if (confirmed) return null;
			const hasContent = title.trim() || sections.some(s => s.title.trim() || s.content.trim());
			if (!hasContent) return null;
			return {
				title, categoryId, documentId, docType, selectedRefs,
				selectedTargetSections, repealReason,
				sections: sections.map(s => ({ depth: s.depth, title: s.title, content: s.content, fixedNumber: s.fixedNumber }))
			};
		},
		(d) => {
			title = d.title ?? '';
			categoryId = d.categoryId ?? -1;
			documentId = d.documentId ?? 0;
			docType = d.docType ?? 0;
			selectedRefs = Array.isArray(d.selectedRefs) ? d.selectedRefs : [];
			selectedTargetSections = Array.isArray(d.selectedTargetSections) ? d.selectedTargetSections : [];
			repealReason = d.repealReason ?? '';
			if (categoryId >= 0) loadDocsForCategory(categoryId);
			if (documentId > 0 && categoryId >= 0) {
				loadVersionsForDocument(categoryId, documentId);
				loadRestrictions(categoryId, documentId);
			}
			if (Array.isArray(d.sections) && d.sections.length > 0) {
				sections = d.sections.map((s) =>
					({ ...createSection(s.depth as 1 | 2 | 3), title: s.title, content: s.content, fixedNumber: s.fixedNumber })
				);
			}
		}
	);

	/**
	 * Reset every form field to its initial state. Used by both the manual
	 * "Clear All" button and the "Propose Another" flow after a successful
	 * submission.
	 *
	 * @param resetCategory — whether to wipe the selected category (true for
	 * Clear All, false for Propose Another which preserves category selection
	 * momentum).
	 */
	function resetAll(resetCategory: boolean) {
		confirmed = false;
		confirmData = null;
		title = '';
		docType = 0;
		documentId = 0;
		selectedRefs = [];
		categoryDocuments = [];
		documentVersions = [];
		selectedTargetSections = [];
		newSectionsOnly = false;
		availableTargetSections = [];
		allParsedSections = [];
		targetDocError = '';
		targetDocTitle = '';
		repealReason = '';
		lockedSections = [];
		withinInterval = false;
		templateVars = [];
		templateRoles = [];
		sections = [createSection(1)];
		resetRestrictionFields();
		draft.clear();
		if (resetCategory) categoryId = -1;
	}

	function clearAll() {
		if (!confirm('Clear all fields?')) return;
		resetAll(true);
	}

	function buildRepealBody(): string {
		const sorted = sortedSelectedSections();
		const includesChildren = sorted.some(s => availableTargetSections.some(t => t.number.startsWith(s + '.')));
		const childNote = includesChildren ? ' (and all subsections)' : '';
		let sentence: string;
		if (sorted.length === 0) {
			sentence = `"${targetDocTitle}" is repealed.`;
		} else if (sorted.length === 1) {
			sentence = `\u00A7${sorted[0]}${childNote} of "${targetDocTitle}" is repealed.`;
		} else {
			sentence = `${sorted.map(s => '\u00A7' + s).join(', ')}${childNote} of "${targetDocTitle}" are repealed.`;
		}
		let body = `## Repeal Notice\n\n${sentence}`;
		if (repealReason.trim()) {
			body += `\n\n**Reason:** ${repealReason.trim()}`;
		}
		return body;
	}

	async function openReview() {
		if (!title.trim()) {
			submitError = 'Title is required.';
			return;
		}
		if (title.length > 256) {
			submitError = 'Title must be 256 characters or fewer.';
			return;
		}
		if (categoryId < 0) {
			submitError = 'Please select a category.';
			return;
		}
		if (titleDuplicate) {
			submitError = 'A document with this title already exists in this category. Choose a different title.';
			return;
		}
		if (isRepealMode()) {
			// Repeal doesn't need editor sections
		} else if (sections.length === 0) {
			submitError = 'At least one section is required.';
			return;
		}
		if (proposeRestrictions && proposeLockMode === 'specific' && proposeLockedSections.length === 0) {
			submitError = 'Select at least one section to lock, or switch to "Entire document".';
			return;
		}
		if (requiresReferences(docType) && selectedRefs.length === 0) {
			if (allowsMultipleReferences(docType)) {
				submitError = `${docTypeLabel(docType)} requires selecting at least one document to consolidate.`;
			} else {
				submitError = `Please select a document to ${docTypeLabel(docType).toLowerCase()}.`;
			}
			return;
		}
		// Validate template variables / roles against placeholders in the document body
		if (isContractTemplate) {
			const body = sectionsToMarkdown(sections);

			// §1 Parties is system-generated at contract creation from role bindings.
			// Templates must start numbering at §2.
			if (/^##\s*§1\b/m.test(body)) {
				submitError = 'Templates must not declare §1 Parties — it is generated at contract creation from the Signatories roles. Start numbering at §2.';
				return;
			}

			const placeholders = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
			const varNames = templateVars.map((v) => v.name);
			const roleKeys = templateRoles.map((r) => r.key);
			const definedNames = [...varNames, ...roleKeys];
			const undefinedPlaceholders = placeholders.filter((p) => !definedNames.includes(p));
			const unusedVariables = varNames.filter((n) => !placeholders.includes(n));
			const warnings: string[] = [];
			if (undefinedPlaceholders.length > 0) {
				warnings.push(`Placeholders without matching variables or roles: {{${undefinedPlaceholders.join('}}, {{')}}}`);
			}
			if (unusedVariables.length > 0) {
				warnings.push(`Variables not used in document: ${unusedVariables.join(', ')}`);
			}
			if (warnings.length > 0) {
				submitError = warnings.join(' | ');
				return;
			}
		}
		submitError = '';

		if (isRepealMode()) {
			const md = buildRepealBody();
			reviewHtml = DOMPurify.sanitize(await marked.parse(md));
		} else {
			const md = sectionsToMarkdown(sections);
			reviewHtml = await renderSectionedMarkdown(md);
		}
		showReview = true;
	}

	async function handleSubmit() {
		showReview = false;
		submitting = true;
		submitError = '';

		try {
			// 1. Assemble body and compute hash
			submitStep = 'Computing content hash...';
			const body = isRepealMode() ? buildRepealBody() : sectionsToMarkdown(sections);
			const contentHash = await hashBody(body);

			// 2. Build full document with frontmatter
			const cat = categories.find((c) => c.id === categoryId);
			const frontmatter: Record<string, unknown> = {
				title,
				doc_type: docType,
				category: cat?.name ?? '',
				registry_address: daaRegistryAddress,
				network: chainIdToLabel(chainId),
				chain_id: chainId,
				submitted: formatDate(Math.floor(Date.now() / 1000)),
				content_hash: contentHash,
				...(selectedTargetSections.length > 0 ? { target_section: targetSectionValue() } : {})
			};
			let fullDocument: string;
			if (isRepealMode()) {
				fullDocument = wrapWithFrontmatter(frontmatter, body);
			} else {
				const rawYamlBlocks = isContractTemplate
					? [
						templateRoles.length > 0 ? serializeRoleSchema(templateRoles) : '',
						templateVars.length > 0 ? serializeVariableSchema(templateVars) : ''
					].filter(Boolean).join('\n') || undefined
					: undefined;
				fullDocument = buildDocument(frontmatter, sections, rawYamlBlocks);
			}

			// 2.5 Validate the assembled document is sanitization-clean before upload.
			submitStep = 'Validating content...';
			await validateMarkdownUpload(fullDocument);

			// 3. Upload to Arweave (Transaction 1)
			// Re-check pattern: if a previous upload of this exact body failed
			// verification, retry the verify against the same tx ID instead of
			// paying for a fresh upload. Body edits between attempts invalidate
			// the pending tx via the hash mismatch.
			if (pendingContentHash !== contentHash) {
				pendingContentUri = null;
				pendingContentHash = null;
			}

			let contentUri: string;
			if (pendingContentUri) {
				submitStep = 'Re-checking previous upload...';
				try {
					await verifyTurboHas(pendingContentUri);
					contentUri = pendingContentUri;
					pendingContentUri = null;
					pendingContentHash = null;
				} catch {
					pendingContentUri = null;
					pendingContentHash = null;
					throw new Error(
						"Previous upload not confirmed on Arweave. Submit again to start a fresh upload on Arweave."
					);
				}
			} else {
				submitStep = 'Uploading to Arweave...';
				contentUri = await uploadDocument(fullDocument);

				submitStep = 'Verifying upload...';
				try {
					await verifyTurboHas(contentUri);
				} catch {
					pendingContentUri = contentUri;
					pendingContentHash = contentHash;
					throw new Error(
						"Upload sent to Arweave but our system couldn't confirm it yet. Click Submit to re-check."
					);
				}
			}

			// 4. Create Snapshot X proposal (Transaction 2)
			submitStep = 'Creating governance proposal...';
			const strategyAddress = getStrategyAddress();

			const docInput = {
				categoryId: BigInt(categoryId),
				documentId: BigInt(documentId),
				contentUri,
				contentHash: hashToBytes32(contentHash),
				title,
				voteId: '', // Will be filled by the governance flow
				docType
			};
			const refs = buildExternalRefs();

			// New document + restrictions: single atomic MetaTransaction. The registry
			// assigns the documentId inside the call and applies restrictions to that
			// same ID — no client-side prediction, no execute-order race.
			// Existing document + restrictions: two-tx bundle is still safe because the
			// documentId is already known.
			// Plain document (no restrictions): single addDocument tx.
			let transactions: MetaTransaction[];
			if (hasProposedRestrictions() && documentId === 0) {
				transactions = [
					encodeAddDocumentWithRestrictionsTransaction(
						docInput,
						refs,
						BigInt(proposeTimeLock),
						getProposedLockedSections()
					)
				];
			} else if (hasProposedRestrictions()) {
				transactions = [
					encodeAddDocumentTransaction(docInput, refs),
					encodeSetAmendmentRestrictionsTransaction(
						BigInt(categoryId),
						BigInt(documentId),
						BigInt(proposeTimeLock),
						getProposedLockedSections()
					)
				];
			} else {
				transactions = [encodeAddDocumentTransaction(docInput, refs)];
			}

			// Metadata URI includes Arweave link for voter verification
			const metadataURI = `ipfs://proposal:${title}|arweave:${contentUri}`;

			const result = await createProposal(
				$wallet.address!,
				metadataURI,
				strategyAddress,
				transactions
			);

			// 5. Clear draft and show confirmation
			draft.clear();
			pendingContentUri = null;
			pendingContentHash = null;
			confirmed = true;
			let refSummary = '';
			if (selectedRefs.length > 0 && requiresReferences(docType)) {
				const relType = DOC_TYPE_TO_RELATION[docType];
				const relLabel = relationLabel(relType);
				const ref = selectedRefs[0];
				const refVer = documentVersions.find(v => v.version === ref.version);
				const refTitle = refVer?.title ?? '';
				const secs = selectedTargetSections.length > 0
					? `, \u00A7${sortedSelectedSections().join(', \u00A7')}`
					: '';
				refSummary = `${relLabel} ${refTitle || `document ${ref.documentId}`} v${ref.version}${secs}`;
			}

			confirmData = {
				txHash: result.txHash,
				contentUri,
				proposalId: result.proposalId,
				title,
				category: cat?.name ?? '',
				documentId,
				docTypeName: docTypeLabel(docType),
				refSummary,
				strategy: strategyLabel(strategyAddress)
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Proposal creation failed';
			submitError = msg;
			if (!(e instanceof MarkdownUnsafeError)) {
				showToast('error', msg);
			}
		} finally {
			submitting = false;
			submitStep = '';
		}
	}

	function handleExport() {
		const cat = categories.find((c) => c.id === categoryId);
		const body = sectionsToMarkdown(sections);
		const frontmatter: Record<string, unknown> = {
			title: title || 'Untitled',
			doc_type: docType,
			category: cat?.name ?? '',
			registry_address: daaRegistryAddress,
			network: chainIdToLabel(chainId),
			chain_id: chainId,
			...(selectedTargetSections.length > 0 ? { target_section: targetSectionValue() } : {})
		};
		const rawYamlBlocks = isContractTemplate
			? [
				templateRoles.length > 0 ? serializeRoleSchema(templateRoles) : '',
				templateVars.length > 0 ? serializeVariableSchema(templateVars) : ''
			].filter(Boolean).join('\n') || undefined
			: undefined;
		const doc = buildDocument(frontmatter, sections, rawYamlBlocks);

		const blob = new Blob([doc], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${(title || 'draft').replace(/\s+/g, '-').toLowerCase()}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleImport() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.md';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			importError = '';

			try {
				const text = await file.text();
				const { frontmatter, sections: parsedSections, rawYamlBlocks, rawRoles } = parseDocument(text);

				if (parsedSections.length === 0) {
					importError = 'No sections found. Ensure headings use \u00A7-numbered format (## \u00A71, ### \u00A71.1, #### \u00A71.1.A).';
					return;
				}

				if (frontmatter.title && docType !== 1 && docType !== 2 && docType !== 3) title = frontmatter.title;
				if (frontmatter.category) {
					const match = categories.find(
						(c) => c.name.toLowerCase() === frontmatter.category.toLowerCase()
					);
					if (match) categoryId = match.id;
				}

				// Restore template variables and roles from imported file
				if (rawYamlBlocks) {
					templateVars = parseVariableSchema(`---\n${rawYamlBlocks}\n---`);
				}
				if (rawRoles) {
					templateRoles = parseRoleSchema(`---\n${rawRoles}\n---`);
				}

				sections = parsedSections;
			} catch {
				importError = 'Failed to parse the imported file.';
			}
		};
		input.click();
	}

	function resetForm() {
		resetAll(false);
		loadCategories();
	}

	onMount(() => {
		draft.restore();
		loadCategories();
		draft.startAutosave();
	});

	onDestroy(() => {
		draft.stopAutosave();
		draft.save();
	});
</script>

<div>
	<h1 class="text-2xl font-semibold mb-6">{confirmed ? 'Proposal Submitted' : 'Propose Legislation'}</h1>

	<!-- Confirmation screen -->
	{#if confirmed && confirmData}
		<ProposalConfirmation data={confirmData} {chainId} onReset={resetForm} />

	<!-- Editor (accessible to any token holder) -->
	{:else}
		{#if loadingCategories}
			<p class="text-text-secondary">Loading categories...</p>
		{:else}
			{@const canPropose = $wallet.connected && $wallet.isTokenHolder}

			{#if !$wallet.connected}
				<div class="border border-border rounded-lg p-4 text-center mb-6">
					<p class="text-text-muted text-sm">Connect your wallet to propose legislation.</p>
				</div>
			{:else if !$wallet.isTokenHolder}
				<div class="border border-border rounded-lg p-4 text-center mb-6">
					<p class="text-text-muted text-sm">You need a membership token to propose legislation. <a href="/admin" class="text-primary hover:underline">Join the association</a> first.</p>
				</div>
			{/if}

			<div class="flex flex-col gap-5" class:opacity-50={!canPropose} class:pointer-events-none={!canPropose}>
				<!-- Metadata form -->
				<div class="flex flex-col gap-4">
					<div>
						<label for="title" class="block text-sm text-text-secondary mb-1">Title</label>
						<input
							id="title"
							type="text"
							bind:value={title}
							disabled={!canPropose}
							readonly={titleLocked}
							placeholder="Document title"
							class="w-full bg-bg-light border rounded px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50 read-only:opacity-60 read-only:cursor-not-allowed {titleDuplicate ? 'border-error' : 'border-border'}"
						/>
						{#if titleLocked}
							<p class="text-xs text-text-muted mt-1">Title is derived from the target document and cannot be edited.</p>
						{:else if titleDuplicate}
							<p class="text-xs text-error mt-1">A document with this title already exists in this category. Choose a different title.</p>
						{/if}
					</div>

					<div>
						<label for="category" class="block text-sm text-text-secondary mb-1"
							>Category <Tooltip text={"Categories are defined in the smart contract by the governance authority and represent distinct legislative domains (e.g. Governing Laws, Chain Standards, Model Agreements).\n\nNew categories can be added by the core governance authority."} align="left"><span class="text-text-muted cursor-help">(?)</span></Tooltip></label
						>
						<select
							id="category"
							value={categoryId}
							onchange={(e) => handleCategoryChange(Number((e.target as HTMLSelectElement).value))}
							disabled={!canPropose}
							class="w-full bg-bg-light border border-border rounded px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
						>
							<option value={-1} disabled>Select a category</option>
							{#each categories as cat}
								<option value={cat.id}>{cat.name}</option>
							{/each}
						</select>
					</div>

					<div>
						<label for="docType" class="block text-sm text-text-secondary mb-1"
							>Document Type <Tooltip text={"Original: new legislation.\nAmendment: modifies an existing document.\nRevision: full replacement.\nRepeal: revokes a document.\nCodification: consolidates multiple documents."} align="left"><span class="text-text-muted cursor-help">(?)</span></Tooltip></label
						>
						{#if isContractTemplate}
							<div class="w-full bg-bg-light border border-border rounded px-3 py-2 text-sm text-text-muted opacity-60">
								Original
							</div>
							<p class="text-xs text-text-muted mt-1">Contract templates are end products. Amendments and revisions are disabled.</p>
						{:else}
							<select
								id="docType"
								value={docType}
								onchange={(e) => handleDocTypeChange(Number((e.target as HTMLSelectElement).value))}
								disabled={!canPropose}
								class="w-full bg-bg-light border border-border rounded px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
							>
								{#each DOC_TYPES as dt}
									<option value={dt.value}>{dt.label}</option>
								{/each}
							</select>
						{/if}
					</div>

					<TargetDocumentPicker
						{docType}
						{categoryId}
						{categoryDocuments}
						{documentId}
						{documentVersions}
						{selectedRefs}
						{loadingDocuments}
						{loadingVersions}
						{loadingRestrictions}
						{lockedSections}
						{withinInterval}
						{nextWindowTime}
						{coreStrategyAddress}
						onDocumentSelect={handleDocumentSelect}
						onToggleRef={toggleRef}
					/>

					{#if requiresReferences(docType) && supportsSectionTargeting(docType) && selectedRefs.length === 1}
						<SectionTargetPicker
							{availableTargetSections}
							bind:selectedTargetSections
							bind:newSectionsOnly
							{loadingTargetDoc}
							{targetDocError}
							{lockedSections}
							isAmendmentMode={isAmendmentMode()}
							isRepealMode={isRepealMode()}
							{targetDocVariables}
							onToggleSection={handleSectionToggle}
							onNewSectionsOnlyChange={handleNewSectionsOnlyChange}
						/>
					{/if}
				</div>

				{#if isRepealMode()}
					<!-- Repeal UI -->
					<div class="border border-border rounded bg-bg-light p-4 flex flex-col gap-4">
						<div>
							<p class="text-sm text-text-secondary">
								{#if selectedTargetSections.length > 0}
									Repealing {sortedSelectedSections().map(s => '§' + s).join(', ')}{sortedSelectedSections().some(s => availableTargetSections.some(t => t.number.startsWith(s + '.'))) ? ' (and all subsections)' : ''} of "{targetDocTitle}"
								{:else}
									Repealing entire document "{targetDocTitle}"
								{/if}
							</p>
						</div>
						<div>
							<label for="repealReason" class="block text-sm text-text-secondary mb-1">Reason for repeal <span class="text-text-muted">(optional)</span></label>
							<textarea
								id="repealReason"
								bind:value={repealReason}
								placeholder="Explain why this document or section is being repealed..."
								rows="4"
								class="w-full bg-bg border border-border rounded p-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-primary resize-y"
							></textarea>
						</div>
					</div>
				{:else}
					<!-- Import/Export/Clear -->
					{#if canPropose}
						<div class="flex gap-3">
							<LoadingButton
								onclick={handleImport}
								variant="none"
								class="border border-primary text-primary hover:bg-primary hover:text-text py-1.5"
							>
								Import .md
							</LoadingButton>
							<LoadingButton
								onclick={handleExport}
								variant="none"
								class="border border-primary text-primary hover:bg-primary hover:text-text py-1.5"
							>
								Export .md
							</LoadingButton>
							<LoadingButton
								onclick={clearAll}
								variant="none"
								class="border border-border text-text-muted hover:border-error hover:text-error py-1.5"
							>
								Clear All
							</LoadingButton>
						</div>
					{/if}

					{#if importError}
						<p class="text-error text-sm">{importError}</p>
					{/if}

					<!-- Signatories / Roles (only for Contract Templates category) -->
					{#if isContractTemplate && canPropose}
						<RolesEditor bind:roles={templateRoles} />
					{/if}

					<!-- Template Variable Builder (only for Contract Templates category, below buttons) -->
					{#if isContractTemplate && canPropose}
						<TemplateVarsEditor bind:vars={templateVars} />
					{/if}

					<!-- Editor -->
					<Editor bind:sections amendmentMode={isAmendmentMode()} originalSectionNumbers={originalSectionNumbers()} />
				{/if}

				<!-- Amendment Restrictions (only for new documents and revisions, not amendments) -->
				{#if canPropose && docType !== 3 && !isAmendmentMode()}
					<AmendmentRestrictions
						bind:enabled={proposeRestrictions}
						bind:timeLockSeconds={proposeTimeLock}
						bind:timeLockPreset={proposeTimeLockPreset}
						bind:timeLockCustomDays={proposeTimeLockCustomDays}
						bind:lockMode={proposeLockMode}
						bind:lockedSectionNumbers={proposeLockedSections}
						topSections={getTopLevelSectionNumbers()}
					/>
				{/if}

				<!-- Strategy indicator -->
				{#if documentId > 0}
					<div class="text-xs text-text-muted flex items-center gap-2">
						<span>Voting threshold:</span>
						<span class="font-medium {touchesLockedSections() ? 'text-error' : 'text-text-secondary'}">
							{strategyLabel(getStrategyAddress())}
						</span>
						{#if touchesLockedSections() && withinInterval}
							<span class="text-error">— targets locked sections + within interval</span>
						{:else if touchesLockedSections()}
							<span class="text-error">— targets locked sections</span>
						{/if}
					</div>
				{/if}

				<!-- Submit -->
				{#if submitError}
					<p class="text-error text-sm">{submitError}</p>
				{/if}

				{#if canPropose}
					<div class="flex items-center gap-2">
						<LoadingButton
							onclick={openReview}
							loading={submitting}
							loadingLabel={submitStep || 'Submitting...'}
							variant="primary"
							class="self-start px-6"
						>
							Review &amp; Submit Proposal
						</LoadingButton>
						<Tooltip text={"The document is uploaded to Arweave (permanent storage), then a governance proposal is created on Snapshot X.\n\nMembers vote on-chain. If the proposal passes, anyone can execute it from the homepage, which records the document in the registry via the Gnosis Safe.\n\nTwo transactions: (1) Arweave upload, (2) Snapshot X proposal creation."} align="left" position="above"><span class="text-sm text-text-muted cursor-help">(?)</span></Tooltip>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- Review modal -->
{#if showReview}
	{#snippet reviewBadges()}
		<span>Category: {categories.find(c => c.id === categoryId)?.name ?? ''}</span>
		{#if documentId > 0}
			<span>Document: {documentId}</span>
		{/if}
		<span>Type: {docTypeLabel(docType)}</span>
		{#if selectedTargetSections.length > 0}
			<span>Target: {selectedTargetSections.map(s => '\u00A7' + s).join(', ')}</span>
		{/if}
		<span class={touchesLockedSections() ? 'text-error' : ''}>Strategy: {strategyLabel(getStrategyAddress())}{#if touchesLockedSections() && withinInterval} — targets locked sections + within interval{:else if touchesLockedSections()} — targets locked sections{/if}</span>
		{#if hasProposedRestrictions()}
			<span class="text-cat-gold">Restrictions: {proposeLockMode === 'entire' ? 'Entire document locked' : proposeLockedSections.map(s => '\u00A7' + s).join(', ') + ' locked'}{#if proposeTimeLock > 0}, {Math.round(proposeTimeLock / 86400)}-day interval{:else}, permanent{/if}</span>
		{/if}
	{/snippet}
	<ReviewModal
		{title}
		bodyHtml={reviewHtml}
		badges={reviewBadges}
		copyText={isRepealMode() ? buildRepealBody() : sectionsToMarkdown(sections)}
		onClose={() => showReview = false}
		onSubmit={handleSubmit}
	/>
{/if}
