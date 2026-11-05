import { replay, type Document, type ReplayVersion } from '@vattelum/document-registry-js';
import { readOnChain } from '#lib/services/chain-read.ts';
import { DAARegistryABI } from '#lib/contracts/index.ts';
import { fetchFromArweave } from '#lib/services/arweave.ts';

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

/** One on-chain version with its stored text, in the shape `replay` takes. */
interface VersionContribution extends ReplayVersion {
	title: string;
	contentUri: string;
	contentHash: `0x${string}`;
	voteId: string;
}

export interface ResolveInput {
	registryAddress: `0x${string}`;
	categoryId: bigint;
	documentId: bigint;
	/** The version the creator cited. Used for the title fallback. Not used to limit history. */
	version: bigint;
	/** Chain holding the registry. Omitted means the home chain. */
	chainId?: bigint;
}

/** A law fixed for embedding in a contract package. See `resolveForPackage`. */
export interface PackageLaw {
	/** Title of the version that last set the whole text. */
	title: string;
	body: string;
	/** On-chain record of every contributing version, ascending. Never empty. */
	components: Document[];
}

import {
	DOC_TYPE_AMENDMENT as DOCTYPE_AMENDMENT,
	DOC_TYPE_REVISION as DOCTYPE_REVISION,
	DOC_TYPE_REPEAL as DOCTYPE_REPEAL,
	RELATION_AMENDS,
	RELATION_REVISES,
	RELATION_REPEALS
} from '@vattelum/document-registry-js';

/**
 * Resolve a legislation reference into its consolidated form as of `asOf`.
 *
 * Walks the document's on-chain version history, fetches each version's body
 * from Arweave, and applies the standard's replay rule. Only versions with
 * `timestamp ≤ asOf` are considered — later versions do not exist from this
 * contract's perspective.
 */
export async function resolveLegislation(
	input: ResolveInput,
	asOf: bigint
): Promise<ResolvedLegislation> {
	const contributions = await loadContributions(input, asOf, false);
	if (contributions.length === 0) {
		return {
			title: `Document ${input.categoryId}/${input.documentId}`,
			consolidatedBody: '',
			components: [],
			status: 'InForce'
		};
	}

	const { text, used, repealed } = replay(contributions, asOf);

	return {
		title: deriveTitle(used),
		consolidatedBody: text,
		components: used.map((c) => ({
			title: c.title,
			docType: c.docType,
			version: Number(c.version),
			contentUri: c.contentUri,
			contentHash: c.contentHash,
			timestamp: Number(c.timestamp),
			targetSection: c.targetSection
		})),
		status: repealed ? 'Repealed' : used.length > 1 ? 'PartiallyAmended' : 'InForce'
	};
}

/**
 * Resolve a law for embedding in a contract package as of `asOf`, with no
 * tolerance for failure, because the result is hashed and signed.
 *
 * A failed fetch, reference read or hash check throws, as does a repealed or
 * empty result.
 */
export async function resolveForPackage(input: ResolveInput, asOf: bigint): Promise<PackageLaw> {
	const contributions = await loadContributions(input, asOf, true);
	const label = `Document ${input.categoryId}/${input.documentId} on ${input.registryAddress}`;
	if (contributions.length === 0) throw new Error(`${label} has no versions.`);

	const { text, used, repealed } = replay(contributions, asOf, { verifyHashes: true });
	if (repealed) throw new Error(`${label} has been repealed.`);
	if (!text) throw new Error(`${label} resolved to an empty body.`);

	return {
		title: deriveTitle(used),
		body: text,
		components: used.map((c) => ({
			contentUri: c.contentUri,
			contentHash: c.contentHash,
			title: c.title,
			version: c.version,
			timestamp: c.timestamp,
			voteId: c.voteId,
			docType: c.docType
		}))
	};
}

/** On-chain record and category name of one referenced version. No body is fetched. */
export async function readDocumentRecord(ref: {
	registryAddress: `0x${string}`;
	chainId?: bigint;
	categoryId: bigint;
	documentId: bigint;
	version: bigint;
}): Promise<{ doc: Document; categoryName: string }> {
	const registry = { address: ref.registryAddress, abi: DAARegistryABI };
	const [raw, categoryName] = await Promise.all([
		readOnChain(ref.chainId, {
			...registry,
			functionName: 'getDocument',
			args: [ref.categoryId, ref.documentId, ref.version]
		}) as Promise<RawVersion>,
		readOnChain(ref.chainId, {
			...registry,
			functionName: 'categoryNames',
			args: [ref.categoryId]
		}) as Promise<string>
	]);
	return {
		doc: {
			contentUri: raw.contentUri,
			contentHash: raw.contentHash,
			title: raw.title,
			version: raw.version,
			timestamp: raw.timestamp,
			voteId: raw.voteId,
			docType: raw.docType
		},
		categoryName
	};
}

/**
 * Walk the on-chain history up to `asOf` and fetch each version's body. In strict
 * mode a version with no stored text or an unreadable target section throws.
 */
async function loadContributions(
	input: ResolveInput,
	asOf: bigint,
	strict: boolean
): Promise<VersionContribution[]> {
	const history = (await readOnChain(input.chainId, {
		address: input.registryAddress,
		abi: DAARegistryABI,
		functionName: 'getHistory',
		args: [input.categoryId, input.documentId]
	})) as readonly RawVersion[];

	const contributions: VersionContribution[] = [];
	for (const v of history.filter((h) => h.timestamp <= asOf)) {
		if (strict && !v.contentUri) {
			throw new Error(
				`Document ${input.categoryId}/${input.documentId} v${v.version} has no stored text.`
			);
		}
		const body = v.contentUri ? await fetchFromArweave(v.contentUri, v.contentHash) : '';
		let targetSection = '';
		if (
			v.docType === DOCTYPE_AMENDMENT ||
			v.docType === DOCTYPE_REVISION ||
			v.docType === DOCTYPE_REPEAL
		) {
			targetSection = await readReferenceTargetSection(input, v.version, v.docType, strict);
		}
		contributions.push({
			version: v.version,
			docType: v.docType,
			title: v.title,
			timestamp: v.timestamp,
			contentUri: v.contentUri,
			contentHash: v.contentHash,
			targetSection,
			body,
			voteId: v.voteId
		});
	}
	return contributions;
}

async function readReferenceTargetSection(
	input: ResolveInput,
	version: bigint,
	docType: number,
	strict: boolean
): Promise<string> {
	const { registryAddress, categoryId, documentId } = input;
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
		const refs = (await readOnChain(input.chainId, {
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
	} catch (e) {
		// An empty target means "whole document" to replay, so an unreadable target
		// must not reach signed text as one.
		if (strict) {
			throw new Error(
				`Could not read the references of document ${categoryId}/${documentId} v${version} on ${registryAddress}.`,
				{ cause: e }
			);
		}
		return '';
	}
}

/**
 * A law's title: that of the version that last set the whole text (the first
 * contributing version). Amendment and repeal titles never become the law's title.
 */
function deriveTitle(contributions: VersionContribution[]): string {
	if (contributions.length === 0) return '';
	return contributions[0].title;
}

/** A document's full on-chain history, oldest first. No text is fetched. */
export async function readHistory(ref: {
	registryAddress: `0x${string}`;
	chainId?: bigint;
	categoryId: bigint;
	documentId: bigint;
}): Promise<Document[]> {
	const history = (await readOnChain(ref.chainId, {
		address: ref.registryAddress,
		abi: DAARegistryABI,
		functionName: 'getHistory',
		args: [ref.categoryId, ref.documentId]
	})) as readonly RawVersion[];
	return history.map((v) => ({
		contentUri: v.contentUri,
		contentHash: v.contentHash,
		title: v.title,
		version: v.version,
		timestamp: v.timestamp,
		voteId: v.voteId,
		docType: v.docType
	}));
}

/**
 * The versions that make up a document's text, from the given history: the last
 * version that set the whole text (Original, Revision, Codification) and every
 * amendment or repeal after it. Decided by document type alone, without text.
 */
export function contributingVersions(history: readonly Document[]): Document[] {
	const isChange = (t: number) => t === DOCTYPE_AMENDMENT || t === DOCTYPE_REPEAL;
	const base = history.findLastIndex((v) => !isChange(v.docType));
	return history.slice(Math.max(base, 0));
}
