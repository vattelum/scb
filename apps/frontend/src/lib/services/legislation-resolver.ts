import { readContract } from '@wagmi/core';
import { config } from '$lib/services/wallet-config';
import { DAARegistryABI } from '$lib/contracts';
import { fetchFromArweave } from '$lib/services/arweave';
import {
	markdownToSections,
	sectionsToMarkdown,
	parseDocument,
	compareSectionNumbers,
	type Section
} from '$lib/services/markdown';

export type LegislationStatus = 'InForce' | 'PartiallyAmended' | 'Repealed';

export interface ComponentVersion {
	title: string;
	docType: number;
	version: number;
	contentUri: string;
	contentHash: `0x${string}`;
	timestamp: number;
	targetSection: string;
}

export interface ResolvedLegislation {
	title: string;
	consolidatedBody: string;
	components: ComponentVersion[];
	status: LegislationStatus;
}

interface RawVersion {
	contentUri: string;
	contentHash: `0x${string}`;
	title: string;
	version: bigint;
	timestamp: bigint;
	voteId: string;
	docType: number;
}

interface RawReference {
	registryAddress: `0x${string}`;
	chainId: bigint;
	categoryId: bigint;
	documentId: bigint;
	version: bigint;
	relationType: number;
	targetSection: string;
}

interface VersionContribution {
	version: number;
	docType: number;
	title: string;
	timestamp: number;
	contentUri: string;
	contentHash: `0x${string}`;
	targetSection: string;
	body: string;
}

export interface ResolveInput {
	registryAddress: `0x${string}`;
	categoryId: bigint;
	documentId: bigint;
	/** The version the creator cited. Used for the title fallback. Not used to limit history. */
	version: bigint;
}

import {
	DOC_TYPE_ORIGINAL as DOCTYPE_ORIGINAL,
	DOC_TYPE_AMENDMENT as DOCTYPE_AMENDMENT,
	DOC_TYPE_REVISION as DOCTYPE_REVISION,
	DOC_TYPE_REPEAL as DOCTYPE_REPEAL,
	DOC_TYPE_CODIFICATION as DOCTYPE_CODIFICATION,
	RELATION_AMENDS,
	RELATION_REVISES,
	RELATION_REPEALS
} from '@vattelum/document-registry-js';

/**
 * Resolve a legislation reference into its consolidated form as of `asOf`.
 *
 * Walks the document's on-chain version history, fetches each version's body
 * from Arweave, and applies amendment/revision/repeal replay rules. Only
 * versions with `timestamp ≤ asOf` are considered — later versions do not
 * exist from this contract's perspective.
 */
export async function resolveLegislation(
	input: ResolveInput,
	asOf: bigint
): Promise<ResolvedLegislation> {
	const history = (await readContract(config, {
		address: input.registryAddress,
		abi: DAARegistryABI,
		functionName: 'getHistory',
		args: [input.categoryId, input.documentId]
	})) as readonly RawVersion[];

	const inWindow = history.filter((v) => v.timestamp <= asOf);
	if (inWindow.length === 0) {
		return {
			title: `Document ${input.categoryId}/${input.documentId}`,
			consolidatedBody: '',
			components: [],
			status: 'InForce'
		};
	}

	const contributions: VersionContribution[] = [];
	for (const v of inWindow) {
		const body = v.contentUri ? await fetchFromArweave(v.contentUri, v.contentHash) : '';
		let targetSection = '';
		if (
			v.docType === DOCTYPE_AMENDMENT ||
			v.docType === DOCTYPE_REVISION ||
			v.docType === DOCTYPE_REPEAL
		) {
			targetSection = await readReferenceTargetSection(
				input.registryAddress,
				input.categoryId,
				input.documentId,
				v.version,
				v.docType
			);
		}
		contributions.push({
			version: Number(v.version),
			docType: v.docType,
			title: v.title,
			timestamp: Number(v.timestamp),
			contentUri: v.contentUri,
			contentHash: v.contentHash,
			targetSection,
			body
		});
	}

	const { sections, status, usedContributions } = replay(contributions);

	const components: ComponentVersion[] = usedContributions.map((c) => ({
		title: c.title,
		docType: c.docType,
		version: c.version,
		contentUri: c.contentUri,
		contentHash: c.contentHash,
		timestamp: c.timestamp,
		targetSection: c.targetSection
	}));

	const title = deriveTitle(usedContributions);

	return {
		title,
		consolidatedBody: sectionsToMarkdown(sections),
		components,
		status
	};
}

/**
 * Pure replay. Exported for testability.
 *
 * Takes an ordered list of contributing versions (as their parsed bodies and
 * metadata) and produces the consolidated `Section[]` plus status. Section
 * numbers are literal (`fixedNumber`) — never recomputed. Surrounding
 * sections are never renumbered.
 */
export function replay(contributions: VersionContribution[]): {
	sections: Section[];
	status: LegislationStatus;
	usedContributions: VersionContribution[];
} {
	if (contributions.length === 0) {
		return { sections: [], status: 'InForce', usedContributions: [] };
	}

	const used: VersionContribution[] = [];
	let sections: Section[] = [];
	let altered = false;
	let wholeRepealed = false;

	for (const c of contributions) {
		const bodySections = parseBody(c.body);

		// v1 sets the starting array regardless of docType.
		if (used.length === 0) {
			sections = bodySections;
			used.push(c);
			continue;
		}

		if (c.docType === DOCTYPE_REVISION || c.docType === DOCTYPE_CODIFICATION) {
			sections = bodySections;
			altered = true;
			used.push(c);
			continue;
		}

		if (c.docType === DOCTYPE_REPEAL) {
			const targets = splitTargets(c.targetSection);
			if (targets.length === 0) {
				// Whole-document repeal.
				wholeRepealed = true;
				used.push(c);
				break;
			}
			for (const n of targets) {
				sections = removeSubtree(sections, n);
			}
			altered = true;
			used.push(c);
			continue;
		}

		if (c.docType === DOCTYPE_AMENDMENT) {
			let targets = splitTargets(c.targetSection);
			if (targets.length === 0) {
				// Back-compat: derive targets from body's top-level sections when on-chain targetSection is empty.
				targets = topMostNumbers(bodySections);
			}
			if (targets.length === 0) {
				continue;
			}
			let appliedAny = false;
			for (const n of targets) {
				const replacement = bodySections.filter((s) => belongsUnder(s, n));
				if (replacement.length === 0) {
					continue;
				}
				sections = spliceSubtree(sections, n, replacement);
				appliedAny = true;
			}
			if (appliedAny) {
				altered = true;
				used.push(c);
			}
			continue;
		}

		// docType=0 Original encountered as non-first version is unexpected; treat as replace (defensive).
		if (c.docType === DOCTYPE_ORIGINAL) {
			sections = bodySections;
			altered = true;
			used.push(c);
		}
	}

	let status: LegislationStatus = 'InForce';
	if (wholeRepealed) status = 'Repealed';
	else if (altered) status = 'PartiallyAmended';

	return { sections: wholeRepealed ? [] : sections, status, usedContributions: used };
}

function parseBody(body: string): Section[] {
	if (!body) return [];
	const parsed = parseDocument(body);
	return parsed.sections;
}

function splitTargets(targetSection: string): string[] {
	if (!targetSection) return [];
	return targetSection
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Top-most fixedNumbers in a section list (skip any whose ancestor is also present). */
function topMostNumbers(sections: Section[]): string[] {
	const all = sections.map((s) => s.fixedNumber).filter((n): n is string => !!n);
	const set = new Set(all);
	return all.filter((n) => {
		const parts = n.split('.');
		for (let i = 1; i < parts.length; i++) {
			if (set.has(parts.slice(0, i).join('.'))) return false;
		}
		return true;
	});
}

/** Whether a section's fixedNumber is equal to N or a descendant of N. */
function belongsUnder(section: Section, n: string): boolean {
	if (!section.fixedNumber) return false;
	return section.fixedNumber === n || section.fixedNumber.startsWith(n + '.');
}

/**
 * Remove all sections whose fixedNumber equals N or starts with "N.".
 * Used by Repeal and as a building block for Amendment replacement.
 */
function removeSubtree(sections: Section[], n: string): Section[] {
	return sections.filter((s) => !belongsUnder(s, n));
}

/**
 * Replace the subtree rooted at N with the given replacement sections.
 * Insertion happens at the original position of the first removed section.
 * If N is absent, the replacement is appended at the end (defensive).
 */
function spliceSubtree(sections: Section[], n: string, replacement: Section[]): Section[] {
	const firstIdx = sections.findIndex((s) => belongsUnder(s, n));
	const filtered = removeSubtree(sections, n);
	if (firstIdx < 0) {
		// Additive: insert at the natural numerical position. If nothing is greater, append.
		const lead = replacement[0]?.fixedNumber ?? n;
		const insertIdx = filtered.findIndex(
			(s) => s.fixedNumber && compareSectionNumbers(s.fixedNumber, lead) > 0
		);
		if (insertIdx < 0) return [...filtered, ...replacement];
		return [...filtered.slice(0, insertIdx), ...replacement, ...filtered.slice(insertIdx)];
	}
	const insertAt = Math.min(firstIdx, filtered.length);
	return [...filtered.slice(0, insertAt), ...replacement, ...filtered.slice(insertAt)];
}

async function readReferenceTargetSection(
	registryAddress: `0x${string}`,
	categoryId: bigint,
	documentId: bigint,
	version: bigint,
	docType: number
): Promise<string> {
	const expectedRelation =
		docType === DOCTYPE_AMENDMENT
			? RELATION_AMENDS
			: docType === DOCTYPE_REVISION
				? RELATION_REVISES
				: docType === DOCTYPE_REPEAL
					? RELATION_REPEALS
					: -1;
	if (expectedRelation < 0) return '';

	try {
		const refs = (await readContract(config, {
			address: registryAddress,
			abi: DAARegistryABI,
			functionName: 'getReferences',
			args: [categoryId, documentId, version]
		})) as readonly RawReference[];
		// The ref must target THIS document on THIS registry, not merely carry the
		// expected relation type — an external ref with colliding local IDs must not
		// be mistaken for a self-target. Version is intentionally not filtered.
		const match = refs.find(
			(r) =>
				r.relationType === expectedRelation &&
				r.registryAddress.toLowerCase() === registryAddress.toLowerCase() &&
				r.categoryId === categoryId &&
				r.documentId === documentId
		);
		return match?.targetSection ?? '';
	} catch {
		return '';
	}
}

function deriveTitle(contributions: VersionContribution[]): string {
	if (contributions.length === 0) return '';
	const genesis = contributions[0];
	// Strip any " (Amendment)" / " (Revision)" / " (Repeal)" suffix propagated from later versions.
	// The genesis title is the authoritative package title.
	return genesis.title;
}
