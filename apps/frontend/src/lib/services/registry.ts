import { readContract } from '@wagmi/core';
import { config } from '#lib/services/wallet-config.ts';
import { readOnChain } from '#lib/services/chain-read.ts';
import { daaRegistryConfig, DAARegistryABI } from '#lib/contracts/index.ts';
import { fetchFromArweave } from '#lib/services/arweave.ts';
import { stripFrontmatter } from '#lib/services/format.ts';
import { markdownToSections, type Section } from '#lib/services/markdown.ts';
import {
	parseVariableSchema,
	parseRoleSchema,
	type TemplateVariable,
	type TemplateRole
} from '#lib/services/template-variables.ts';

export interface CategoryInfo {
	id: number;
	name: string;
	documentCount: number;
}

export interface DocumentInfo {
	categoryId: number;
	documentId: number;
	versionCount: number;
	latestTitle: string;
}

export async function loadCategories(): Promise<CategoryInfo[]> {
	const count = (await readContract(config, {
		...daaRegistryConfig,
		functionName: 'categoryCount'
	})) as bigint;

	const cats: CategoryInfo[] = [];
	for (let i = 0n; i < count; i++) {
		const [name, docCount] = await Promise.all([
			readContract(config, {
				...daaRegistryConfig,
				functionName: 'categoryNames',
				args: [i]
			}),
			readContract(config, {
				...daaRegistryConfig,
				functionName: 'getDocumentCount',
				args: [i]
			})
		]);
		cats.push({
			id: Number(i),
			name: name as string,
			documentCount: Number(docCount as bigint)
		});
	}
	return cats;
}

export async function loadDocuments(categoryId: number): Promise<DocumentInfo[]> {
	const docCount = (await readContract(config, {
		...daaRegistryConfig,
		functionName: 'getDocumentCount',
		args: [BigInt(categoryId)]
	})) as bigint;

	const docs: DocumentInfo[] = [];
	for (let i = 1n; i <= docCount; i++) {
		const [versionCount, original] = await Promise.all([
			readContract(config, {
				...daaRegistryConfig,
				functionName: 'getVersionCount',
				args: [BigInt(categoryId), i]
			}) as Promise<bigint>,
			readContract(config, {
				...daaRegistryConfig,
				functionName: 'getDocument',
				args: [BigInt(categoryId), i, 1n]
			}) as Promise<{ title: string }>
		]);
		docs.push({
			categoryId,
			documentId: Number(i),
			versionCount: Number(versionCount),
			latestTitle: original.title
		});
	}
	return docs;
}

export async function getDocumentCount(categoryId: number): Promise<number> {
	const count = (await readContract(config, {
		...daaRegistryConfig,
		functionName: 'getDocumentCount',
		args: [BigInt(categoryId)]
	})) as bigint;
	return Number(count);
}

/**
 * Load categories from any registry that implements the standard interface (Referencing Standard §3.3).
 * Uses the DAARegistry ABI — all Vattelum registries share the same contract interface.
 */
export async function loadCategoriesFrom(
	registryAddress: `0x${string}`,
	chainId?: number
): Promise<CategoryInfo[]> {
	const extConfig = { address: registryAddress, abi: DAARegistryABI } as const;
	const count = (await readOnChain(chainId, {
		...extConfig,
		functionName: 'categoryCount'
	})) as bigint;

	const cats: CategoryInfo[] = [];
	for (let i = 0n; i < count; i++) {
		const [name, docCount] = await Promise.all([
			readOnChain(chainId, { ...extConfig, functionName: 'categoryNames', args: [i] }),
			readOnChain(chainId, { ...extConfig, functionName: 'getDocumentCount', args: [i] })
		]);
		cats.push({ id: Number(i), name: name as string, documentCount: Number(docCount as bigint) });
	}
	return cats;
}

/**
 * Load documents from any registry that implements the standard interface.
 */
export async function loadDocumentsFrom(registryAddress: `0x${string}`, categoryId: number): Promise<DocumentInfo[]> {
	const extConfig = { address: registryAddress, abi: DAARegistryABI } as const;
	const docCount = (await readContract(config, {
		...extConfig,
		functionName: 'getDocumentCount',
		args: [BigInt(categoryId)]
	})) as bigint;

	const docs: DocumentInfo[] = [];
	for (let i = 1n; i <= docCount; i++) {
		const [versionCount, original] = await Promise.all([
			readContract(config, { ...extConfig, functionName: 'getVersionCount', args: [BigInt(categoryId), i] }) as Promise<bigint>,
			readContract(config, { ...extConfig, functionName: 'getDocument', args: [BigInt(categoryId), i, 1n] }) as Promise<{ title: string }>
		]);
		docs.push({ categoryId, documentId: Number(i), versionCount: Number(versionCount), latestTitle: original.title });
	}
	return docs;
}

export type LegislationStatus = 'InForce' | 'PartiallyAmended' | 'Repealed';

export interface LegislationPackageInfo {
	categoryId: number;
	documentId: number;
	title: string;
	status: LegislationStatus;
	genesisDocType: number;
	versionCount: number;
	/** For Codifications: the lineages consolidated (CODIFIES references on the genesis). */
	codifies: Array<{ registryAddress: `0x${string}`; categoryId: number; documentId: number }>;
}

/**
 * On-chain document shape — mirrors the `Document` struct exported by
 * `@vattelum/document-registry` and shared by every Vattelum registry
 * (Registry, BVSRegistry, DAARegistry). Kept locally so cross-registry
 * readers don't have to round-trip the package's BigInt-typed shape.
 */
export interface RegistryDocument {
	contentUri: string;
	contentHash: `0x${string}`;
	title: string;
	version: bigint;
	timestamp: bigint;
	voteId: string;
	docType: number;
}

/**
 * On-chain reference shape — mirrors `DocumentReference` from
 * `@vattelum/document-registry`. Duplicated from `contract-registry.ts`
 * so cross-registry readers don't pull a contract-side import.
 */
export interface RegistryReference {
	registryAddress: `0x${string}`;
	chainId: bigint;
	categoryId: bigint;
	documentId: bigint;
	version: bigint;
	relationType: number;
	targetSection: string;
}

export interface AmendmentRestrictions {
	minTimeBetweenAmendments: number;
	lastAmendmentTime: number;
	lockedSections: number[];
}

import {
	RELATION_CODIFIES,
	RELATION_REPEALS,
	DOC_TYPE_AMENDMENT as DOCTYPE_AMENDMENT,
	DOC_TYPE_REPEAL as DOCTYPE_REPEAL
} from '@vattelum/document-registry-js';

/**
 * Load one legislation package per documentId, enriched with status and genesis
 * metadata. Hides bare amendments/repeals masquerading as their own lineages
 * (genesis docType = 1 or 3) and fully-repealed lineages. Intended for use in
 * the /contract legislation picker.
 *
 * Uses the DAA-local registry by default; pass a different address for external registries.
 */
export async function loadLegislationPackages(
	categoryId: number,
	registryAddress?: `0x${string}`,
	chainId?: number
): Promise<LegislationPackageInfo[]> {
	const cfg = registryAddress
		? ({ address: registryAddress, abi: DAARegistryABI } as const)
		: daaRegistryConfig;

	const docCount = (await readOnChain(chainId, {
		...cfg,
		functionName: 'getDocumentCount',
		args: [BigInt(categoryId)]
	})) as bigint;

	const packages: LegislationPackageInfo[] = [];
	for (let i = 1n; i <= docCount; i++) {
		const history = (await readOnChain(chainId, {
			...cfg,
			functionName: 'getHistory',
			args: [BigInt(categoryId), i]
		})) as readonly RegistryDocument[];

		if (history.length === 0) continue;
		const genesis = history[0];

		// Hide bare Amendment or bare Repeal lineages (malformed but defensive).
		if (genesis.docType === DOCTYPE_AMENDMENT || genesis.docType === DOCTYPE_REPEAL) continue;

		// Determine status from the history.
		let status: LegislationStatus = 'InForce';
		let wholelyRepealed = false;

		if (history.length > 1) {
			// Amended only by amendments or repeals after the last version that set the
			// whole text (Original, Revision, Codification); a revised law is in force.
			const isChange = (t: number) => t === DOCTYPE_AMENDMENT || t === DOCTYPE_REPEAL;
			const lastWhole = history.findLastIndex((v) => !isChange(v.docType));
			if (history.slice(lastWhole + 1).some((v) => isChange(v.docType))) status = 'PartiallyAmended';
			for (let j = 1; j < history.length; j++) {
				const v = history[j];
				if (v.docType !== DOCTYPE_REPEAL) continue;
				const refs = (await readOnChain(chainId, {
					...cfg,
					functionName: 'getReferences',
					args: [BigInt(categoryId), i, v.version]
				})) as readonly RegistryReference[];
				const repealRef = refs.find((r) => r.relationType === RELATION_REPEALS);
				if (repealRef && repealRef.targetSection.trim() === '') {
					wholelyRepealed = true;
					break;
				}
			}
		}

		if (wholelyRepealed) continue; // hide wholly-repealed lineages

		// Resolve codifies list from the genesis references.
		let codifies: LegislationPackageInfo['codifies'] = [];
		try {
			const genesisRefs = (await readOnChain(chainId, {
				...cfg,
				functionName: 'getReferences',
				args: [BigInt(categoryId), i, 1n]
			})) as readonly RegistryReference[];
			codifies = genesisRefs
				.filter((r) => r.relationType === RELATION_CODIFIES)
				.map((r) => ({
					registryAddress: r.registryAddress,
					categoryId: Number(r.categoryId),
					documentId: Number(r.documentId)
				}));
		} catch {
			codifies = [];
		}

		packages.push({
			categoryId,
			documentId: Number(i),
			title: genesis.title,
			status,
			genesisDocType: genesis.docType,
			versionCount: history.length,
			codifies
		});
	}
	return packages;
}

export interface DocumentBody {
	title: string;
	/** Raw markdown with YAML frontmatter stripped, leading whitespace trimmed. */
	body: string;
	/** Parsed sections from `body` (via markdownToSections). */
	sections: Section[];
	/** Template variables declared in the frontmatter (empty when absent). */
	variables: TemplateVariable[];
	/** Template roles declared in the frontmatter (empty when absent). */
	roles: TemplateRole[];
	contentUri: string;
	contentHash: `0x${string}`;
	docType: number;
	/** On-chain version actually fetched (getLatest/getDocument) — authoritative for TEMPLATE references. */
	version: bigint;
}

/**
 * Fetch one document version by (catId, docId, ver) from the given registry
 * (defaults to the local DAARegistry), pull its body from Arweave, strip
 * frontmatter, parse sections, and parse any `variables:` / `roles:` blocks.
 *
 * Pass `version` to fetch a specific version via `getDocument`; omit it to
 * fetch the latest via `getLatest`.
 */
export async function loadDocumentBody(
	categoryId: number,
	documentId: number,
	version?: number,
	registryAddress?: `0x${string}`
): Promise<DocumentBody> {
	const cfg = registryAddress
		? ({ address: registryAddress, abi: DAARegistryABI } as const)
		: daaRegistryConfig;

	const raw = version !== undefined
		? (await readContract(config, {
			...cfg,
			functionName: 'getDocument',
			args: [BigInt(categoryId), BigInt(documentId), BigInt(version)]
		})) as { contentUri: string; contentHash: `0x${string}`; title: string; docType: number; version: bigint }
		: (await readContract(config, {
			...cfg,
			functionName: 'getLatest',
			args: [BigInt(categoryId), BigInt(documentId)]
		})) as { contentUri: string; contentHash: `0x${string}`; title: string; docType: number; version: bigint };

	const text = await fetchFromArweave(raw.contentUri, raw.contentHash);
	const body = stripFrontmatter(text);
	return {
		title: raw.title,
		body,
		sections: markdownToSections(body),
		variables: parseVariableSchema(text),
		roles: parseRoleSchema(text),
		contentUri: raw.contentUri,
		contentHash: raw.contentHash,
		docType: raw.docType,
		version: raw.version
	};
}

export async function loadAmendmentRestrictions(
	categoryId: number,
	documentId: number
): Promise<AmendmentRestrictions> {
	const result = (await readContract(config, {
		...daaRegistryConfig,
		functionName: 'getAmendmentRestrictions',
		args: [BigInt(categoryId), BigInt(documentId)]
	})) as [bigint, bigint, bigint[]];

	return {
		minTimeBetweenAmendments: Number(result[0]),
		lastAmendmentTime: Number(result[1]),
		lockedSections: result[2].map(Number)
	};
}
