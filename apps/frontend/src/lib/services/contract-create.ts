/**
 * The contract create flow, split at the creator's confirmation.
 *
 * `preparePackage` reads everything and builds the package for preview; any failure
 * stops creation with nothing produced. `commitPackage` runs after confirmation:
 * hash, duplicate-revision guard, validation, encryption, upload and transaction.
 */

import { parseEventLogs } from 'viem';
import {
	canonicalizeBody,
	citationToJSON,
	hashBody,
	RELATION_GOVERNS,
	RELATION_IMPLEMENTS,
	RELATION_REVISES,
	RELATION_TEMPLATE,
	VERSION,
	type Document,
	type DocumentReference as StandardReference
} from '@vattelum/document-registry-js';
import {
	assembleContractPackage,
	packageOrder,
	type ExternalDocument,
	type PackageInput,
	type RegistryLaw
} from '#lib/services/contract-package.ts';
import { createContract, type ContractRecord, type DocumentReference } from '#lib/services/contract-registry.ts';
import {
	contributingVersions,
	resolveForPackage,
	readDocumentRecord,
	readHistory
} from '#lib/services/legislation-resolver.ts';
import { encryptForRecipients, type RecipientPubkey } from '#lib/services/ecies.ts';
import { getPubkey, clearPubkeyCache } from '#lib/services/pubkey-registry.ts';
import { arweaveUrl, uploadDocument, verifyTurboHas } from '#lib/services/arweave.ts';
import { hashToBytes32 } from '#lib/services/hash.ts';
import { formatISODate, stripFrontmatter } from '#lib/services/format.ts';
import { validateMarkdownUpload } from '#lib/services/markdown.ts';
import { partiesToJson, type PartyBindings } from '#lib/services/party.ts';
import { getClient } from '#lib/services/wallet-config.ts';
import { ContractRegistryABI } from '#lib/contracts/index.ts';
import { chainIdToLabel } from '#lib/constants/networks.ts';
import type { TemplateRole } from '#lib/services/template-variables.ts';

/** A registry document as chosen in the picker. */
export type PickedRegistryLaw = {
	kind: 'registry';
	title: string;
	categoryId: number;
	documentId: number;
	version: number;
	relationType: number;
	registryAddress: `0x${string}`;
	chainId?: number;
	categoryName: string;
	networkName: string;
	include: 'text' | 'citation';
};

export type PickedEntry = PickedRegistryLaw | ExternalDocument;

export interface PrepareRequest {
	templateTitle: string;
	/** The template as fetched, frontmatter included. */
	templateContent: string;
	template: { categoryId: bigint; documentId: bigint; version: bigint; registryAddress: `0x${string}` };
	roles: TemplateRole[];
	bindings: PartyBindings;
	variableValues: Record<string, string>;
	picked: PickedEntry[];
	signatories: `0x${string}`[];
	hashOnly: boolean;
	revision: { ofContractId: bigint; reason: string } | null;
	contractRegistry: `0x${string}`;
	chainId: number;
}

/** A reference with what the export sidecar needs to cite it. */
interface CitedReference {
	ref: DocumentReference;
	doc: Document;
	categoryName: string;
	networkName: string;
}

export interface PreparedPackage {
	input: PackageInput;
	/** The canonical package: exactly the bytes hashed, encrypted, stored and exported. */
	canonical: string;
	references: DocumentReference[];
	cited: CitedReference[];
	/** Cutoff T: timestamp of the latest home-chain block when the package was prepared. */
	asOf: bigint;
	recipients: RecipientPubkey[];
	signatories: `0x${string}`[];
	hashOnly: boolean;
}

export interface ScbFields {
	smartContractAddress: `0x${string}`;
	bytecodeHash: `0x${string}`;
	smartContractChainId: bigint;
}

/** An upload that succeeded but could not yet be confirmed, kept for the next attempt. */
export interface PendingUpload {
	uri: string | null;
	hash: string | null;
}

/**
 * The template body with placeholders substituted. Role placeholders resolve to the
 * role label; variable placeholders resolve from `values`.
 */
export function fillTemplate(
	templateBody: string,
	roles: TemplateRole[],
	values: Record<string, string>
): string {
	let body = templateBody;
	for (const r of roles) body = body.replaceAll(`{{${r.key}}}`, r.label);
	for (const [k, v] of Object.entries(values)) body = body.replaceAll(`{{${k}}}`, formatISODate(v));
	return body;
}

function describe(p: PickedRegistryLaw): string {
	return `"${p.title}" (Cat ${p.categoryId} / Doc ${p.documentId} v${p.version}, registry ${p.registryAddress})`;
}

async function resolveRecipients(signatories: `0x${string}`[]): Promise<RecipientPubkey[]> {
	const recipients: RecipientPubkey[] = [];
	const unregistered: `0x${string}`[] = [];
	// Bypass the session pubkey cache so encryption targets the keys currently
	// registered on-chain (a signatory may have re-registered since it was warmed).
	clearPubkeyCache();
	for (const addr of signatories) {
		const pk = await getPubkey(addr);
		if (pk) recipients.push({ address: addr, pubkey: pk });
		else unregistered.push(addr);
	}
	if (unregistered.length > 0) {
		throw new Error(
			`These addresses have not registered an encryption key yet: ${unregistered.join(', ')}. Ask each one to visit the app and connect their wallet so they can register before you create the contract.`
		);
	}
	return recipients;
}

/** A bare Arweave transaction id becomes a gateway link; any other URI is kept as stored. */
function textLink(contentUri: string): string {
	return /^[A-Za-z0-9_-]{43}$/.test(contentUri) ? arweaveUrl(contentUri) : contentUri;
}

function isEmbeddable(p: PickedRegistryLaw): boolean {
	return p.relationType === RELATION_GOVERNS || p.relationType === RELATION_IMPLEMENTS;
}

function pickedRef(p: PickedRegistryLaw, homeChainId: number, version: bigint): DocumentReference {
	return {
		registryAddress: p.registryAddress,
		chainId: BigInt(p.chainId ?? homeChainId),
		categoryId: BigInt(p.categoryId),
		documentId: BigInt(p.documentId),
		version,
		relationType: p.relationType,
		targetSection: ''
	};
}

/**
 * Resolve the chosen law and build the package. Laws are read strictly: a failure
 * names the law and nothing is substituted. Every law, on any chain, is resolved as
 * of one cutoff T, the timestamp of the latest home-chain block. An embedded law's
 * reference names the latest version at T, not the version seen when it was picked.
 */
export async function preparePackage(req: PrepareRequest): Promise<PreparedPackage> {
	const recipients = req.hashOnly ? [] : await resolveRecipients(req.signatories);
	const asOf = (await getClient().getBlock()).timestamp;

	const law: PackageInput['law'] = [];
	const cited = new Map<RegistryLaw, CitedReference>();

	for (const p of req.picked) {
		if (p.kind === 'external') {
			law.push(p);
			continue;
		}
		try {
			let entry: RegistryLaw;
			let ref: DocumentReference;
			let doc: Document;
			if (isEmbeddable(p) && p.include === 'text') {
				const resolved = await resolveForPackage(
					{
						registryAddress: p.registryAddress,
						categoryId: BigInt(p.categoryId),
						documentId: BigInt(p.documentId),
						version: BigInt(p.version),
						chainId: BigInt(p.chainId ?? req.chainId)
					},
					asOf
				);
				doc = resolved.components[resolved.components.length - 1];
				ref = pickedRef(p, req.chainId, doc.version);
				entry = {
					kind: 'registry',
					ref,
					categoryName: p.categoryName,
					networkName: p.networkName,
					title: resolved.title,
					include: 'text',
					body: resolved.body,
					components: resolved.components
				};
			} else {
				// Named, not included: no text is fetched. The versions in force at T
				// decide whether it is cited by one version or as consolidated.
				const history = await readHistory({
					registryAddress: p.registryAddress,
					chainId: BigInt(p.chainId ?? req.chainId),
					categoryId: BigInt(p.categoryId),
					documentId: BigInt(p.documentId)
				});
				const components = contributingVersions(history.filter((v) => v.timestamp <= asOf));
				if (components.length === 0) throw new Error('it has no version at the time of creation.');
				doc = components[components.length - 1];
				ref = pickedRef(p, req.chainId, doc.version);
				entry = {
					kind: 'registry',
					ref,
					categoryName: p.categoryName,
					networkName: p.networkName,
					title: components[0].title,
					include: 'citation',
					components,
					textUrl: textLink(doc.contentUri)
				};
			}
			law.push(entry);
			cited.set(entry, { ref, doc, categoryName: p.categoryName, networkName: p.networkName });
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			throw new Error(`Could not retrieve ${describe(p)}: ${reason}`, { cause: e });
		}
	}

	const templateRef: DocumentReference = {
		registryAddress: req.template.registryAddress,
		chainId: BigInt(req.chainId),
		categoryId: req.template.categoryId,
		documentId: req.template.documentId,
		version: req.template.version,
		relationType: RELATION_TEMPLATE,
		targetSection: ''
	};
	const template = await readDocumentRecord(templateRef);
	const templateCited: CitedReference = {
		ref: templateRef,
		doc: template.doc,
		categoryName: template.categoryName,
		networkName: chainIdToLabel(req.chainId)
	};

	// On-chain order: template, revised contract, then the picked documents in
	// package order (see `packageOrder`).
	const order = packageOrder(law);
	const pickedInOrder = [...order.embedded, ...order.citedLaw, ...order.references].map((l) => cited.get(l)!);
	const references: DocumentReference[] = [
		templateRef,
		...(req.revision
			? [
					{
						registryAddress: req.contractRegistry,
						chainId: BigInt(req.chainId),
						categoryId: 0n,
						documentId: req.revision.ofContractId,
						version: 0n,
						relationType: RELATION_REVISES,
						targetSection: ''
					} satisfies DocumentReference
				]
			: []),
		...pickedInOrder.map((c) => c.ref)
	];

	const templateBody = stripFrontmatter(req.templateContent);
	const reason = req.revision?.reason.replace(/\s+/g, ' ').trim();
	const input: PackageInput = {
		templateTitle: req.templateTitle,
		templateBody,
		roles: req.roles,
		bindings: req.bindings,
		filledBody: fillTemplate(templateBody, req.roles, req.variableValues),
		law,
		registry: { contractRegistry: req.contractRegistry, chainId: BigInt(req.chainId) },
		asOf,
		revision: req.revision ? { ofContractId: req.revision.ofContractId, reason } : undefined
	};

	assertReferencesMatchLaw(references, law);

	return {
		input,
		canonical: canonicalize(input),
		references,
		cited: [templateCited, ...pickedInOrder],
		asOf,
		recipients,
		signatories: req.signatories,
		hashOnly: req.hashOnly
	};
}

/** Canonicalize once, on the whole string; every derived byte comes from this result. */
function canonicalize(input: PackageInput): string {
	return canonicalizeBody(assembleContractPackage(input)).trim();
}

function contentHashOf(canonical: string): `0x${string}` {
	return hashToBytes32(hashBody(canonical)) as `0x${string}`;
}

/** The package and the on-chain references must name the same law, in the same order. */
export function assertReferencesMatchLaw(
	references: readonly DocumentReference[],
	law: PackageInput['law']
): void {
	const key = (r: StandardReference) =>
		[r.registryAddress.toLowerCase(), r.chainId, r.categoryId, r.documentId, r.version, r.relationType].join('/');
	const isLaw = (r: StandardReference) => r.relationType === RELATION_GOVERNS || r.relationType === RELATION_IMPLEMENTS;
	const { embedded, citedLaw } = packageOrder(law);
	const sent = references.filter(isLaw).map(key);
	const written = [...embedded, ...citedLaw].map((l) => key(l.ref));
	if (sent.join('|') !== written.join('|')) {
		throw new Error('The references to record do not match the law in the document.');
	}
}

/**
 * A revision that changes nothing but its own revision sentences repeats its source.
 * A source that is itself a revision carries different sentences, so it compares
 * unequal; that case is accepted.
 */
function assertNotDuplicateRevision(prepared: PreparedPackage, sourceHash: `0x${string}` | null): void {
	if (!prepared.input.revision || !sourceHash) return;
	const variant = canonicalize({ ...prepared.input, revision: undefined });
	if (contentHashOf(variant) === sourceHash) {
		throw new Error('Revision content is identical to the underlying contract. Change something, or cancel.');
	}
}

async function uploadEncrypted(
	prepared: PreparedPackage,
	contentHash: `0x${string}`,
	pending: PendingUpload
): Promise<string> {
	// Re-check pattern: if a previous upload of this exact package failed
	// verification, retry the verify against the same tx ID instead of paying for a
	// fresh upload. Any change to the package invalidates it via the hash mismatch.
	if (pending.hash !== contentHash) {
		pending.uri = null;
		pending.hash = null;
	}

	if (pending.uri) {
		const uri = pending.uri;
		pending.uri = null;
		pending.hash = null;
		try {
			await verifyTurboHas(uri);
			return uri;
		} catch {
			throw new Error('Previous upload not confirmed on Arweave. Submit again to start a fresh upload on Arweave.');
		}
	}

	const blob = await encryptForRecipients(prepared.canonical, prepared.recipients);
	const uri = await uploadDocument(JSON.stringify(blob));
	try {
		await verifyTurboHas(uri);
	} catch {
		pending.uri = uri;
		pending.hash = contentHash;
		throw new Error("Upload sent to Arweave but our system couldn't confirm it yet. Click Submit to re-check.");
	}
	return uri;
}

export interface CommittedContract {
	contractId: bigint;
	contentHash: `0x${string}`;
	contentUri: string;
}

/** Runs after the creator confirms the preview. */
export async function commitPackage(
	prepared: PreparedPackage,
	scb: ScbFields,
	revisionSourceHash: `0x${string}` | null,
	pending: PendingUpload,
	contractRegistry: `0x${string}`
): Promise<CommittedContract> {
	const contentHash = contentHashOf(prepared.canonical);
	assertNotDuplicateRevision(prepared, revisionSourceHash);

	// In hash-only mode the exported file is the sole record, so its bytes must be
	// safe too.
	await validateMarkdownUpload(prepared.canonical);

	const contentUri = prepared.hashOnly ? '' : await uploadEncrypted(prepared, contentHash, pending);

	const txHash = await createContract({
		contentHash,
		signatories: prepared.signatories,
		contentUri,
		references: prepared.references,
		...scb
	});
	const receipt = await getClient().waitForTransactionReceipt({ hash: txHash });

	pending.uri = null;
	pending.hash = null;

	return { contractId: contractIdFromLogs(receipt.logs, contractRegistry), contentHash, contentUri };
}

/** The id this transaction created; a count read afterwards could be someone else's. */
export function contractIdFromLogs(
	logs: Parameters<typeof parseEventLogs>[0]['logs'],
	contractRegistry: `0x${string}`
): bigint {
	// The ABI is JSON, so the event's shape is not known to the type system.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const events = parseEventLogs({ abi: ContractRegistryABI as any, logs, eventName: 'ContractCreated' }) as any[];
	const created = events.find((l) => l.address.toLowerCase() === contractRegistry.toLowerCase());
	if (!created) throw new Error('The transaction did not create a contract.');
	return created.args.contractId as bigint;
}

// ────────────────── Export ───────────────────────────────────────

function saveFile(name: string, content: string, type: string): void {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/** JSON with bigints written as decimal strings. */
export function sidecarJson(sidecar: object): string {
	return JSON.stringify(sidecar, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

function scbJson(scb: ScbFields): object | null {
	return scb.smartContractChainId === 0n
		? null
		: {
				address: scb.smartContractAddress,
				bytecodeHash: scb.bytecodeHash,
				chainId: scb.smartContractChainId
			};
}

/**
 * What the "Resolved as of" lines in the package say, for agents that read the
 * JSON: the cutoff, the rule version and, per embedded law, its contributing versions.
 */
function resolutionJson(input: PackageInput): object {
	return {
		asOf: input.asOf,
		rule: `@vattelum/document-registry-js@${VERSION}`,
		laws: packageOrder(input.law).embedded.map((l) => ({
			chainId: l.ref.chainId,
			registryAddress: l.ref.registryAddress,
			categoryId: l.ref.categoryId,
			documentId: l.ref.documentId,
			title: l.title,
			versions: l.components.map((c) => ({ version: c.version, contentHash: c.contentHash }))
		}))
	};
}

/** The full sidecar. Only creation has the bindings and external documents it carries. */
export function buildSidecar(
	prepared: PreparedPackage,
	committed: CommittedContract,
	scb: ScbFields
): object {
	const { input } = prepared;
	return {
		contentHash: committed.contentHash,
		contractRegistry: input.registry.contractRegistry,
		chainId: input.registry.chainId,
		contractId: committed.contractId,
		contentUris: committed.contentUri ? [committed.contentUri] : [],
		references: prepared.cited.map((c) =>
			citationToJSON(c.ref, c.doc, { categoryName: c.categoryName, networkName: c.networkName })
		),
		externalDocuments: input.law.flatMap((l) =>
			l.kind === 'external' ? [{ title: l.title, hash: l.hash, uri: l.uri }] : []
		),
		signatories: prepared.signatories,
		scb: scbJson(scb),
		revision: input.revision ?? null,
		parties: partiesToJson(input.roles, input.bindings),
		resolution: resolutionJson(input)
	};
}

/** The sidecar the contract page can offer: on-chain fields only. */
export function buildOnChainSidecar(contractId: bigint, contract: ContractRecord, contractRegistry: string, chainId: number): object {
	const revises = contract.references.find(
		(r) => r.relationType === RELATION_REVISES && r.registryAddress.toLowerCase() === contractRegistry.toLowerCase()
	);
	return {
		contentHash: contract.contentHash,
		contractRegistry,
		chainId,
		contractId,
		contentUris: contract.contentUris.filter((u) => u.length > 0),
		references: contract.references.filter((r) => r !== revises),
		signatories: contract.signatories,
		scb: scbJson(contract),
		revision: revises ? { ofContractId: revises.documentId } : null
	};
}

/** The package first: in hash-only mode it is the only copy. */
export function downloadContractFiles(contractId: bigint, canonical: string, sidecar: object): void {
	saveFile(`contract-${contractId}.md`, canonical, 'text/markdown;charset=utf-8');
	saveFile(`contract-${contractId}.json`, sidecarJson(sidecar), 'application/json');
}

