import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { encodeEventTopics, type Log } from 'viem';
import { citationFromJSON, RELATION_GOVERNS, RELATION_IMPLEMENTS, RELATION_REFERENCES, RELATION_REVISES, RELATION_TEMPLATE, VERSION } from '@vattelum/document-registry-js';
import ContractRegistryABI from '#lib/contracts/ContractRegistry.abi.json';

const mocks = vi.hoisted(() => ({
	resolveForPackage: vi.fn(),
	readDocumentRecord: vi.fn(),
	readHistory: vi.fn(),
	encryptForRecipients: vi.fn(),
	uploadDocument: vi.fn(),
	verifyTurboHas: vi.fn(),
	createContract: vi.fn(),
	logs: [] as unknown[]
}));

vi.mock('#lib/services/legislation-resolver.ts', () => ({
	resolveForPackage: mocks.resolveForPackage,
	readDocumentRecord: mocks.readDocumentRecord,
	readHistory: mocks.readHistory,
	// The rule itself is tested with the resolver; here every version contributes.
	contributingVersions: (history: unknown[]) => history
}));
vi.mock('#lib/services/markdown.ts', () => ({ validateMarkdownUpload: vi.fn(async () => undefined) }));
vi.mock('#lib/services/ecies.ts', () => ({ encryptForRecipients: mocks.encryptForRecipients }));
vi.mock('#lib/services/pubkey-registry.ts', () => ({
	getPubkey: vi.fn(async () => '0xkey'),
	clearPubkeyCache: vi.fn()
}));
vi.mock('#lib/services/arweave.ts', () => ({
	arweaveUrl: (id: string) => `https://arweave.net/${id}`,
	uploadDocument: mocks.uploadDocument,
	verifyTurboHas: mocks.verifyTurboHas
}));
vi.mock('#lib/services/contract-registry.ts', () => ({ createContract: mocks.createContract }));
vi.mock('#lib/services/wallet-config.ts', () => ({
	getClient: () => ({
		getBlock: async () => ({ timestamp: 1800000000n }),
		waitForTransactionReceipt: async () => ({ logs: mocks.logs })
	})
}));
vi.mock('#lib/contracts/index.ts', async () => ({
	ContractRegistryABI: (await import('#lib/contracts/ContractRegistry.abi.json')).default
}));

import {
	assertReferencesMatchLaw,
	buildSidecar,
	commitPackage,
	contractIdFromLogs,
	preparePackage,
	sidecarJson,
	type PickedEntry,
	type PrepareRequest,
	type ScbFields
} from './contract-create.ts';

const REGISTRY_A = '0x52908400098527886e0f7030069857d2e4169ee7' as const;
const REGISTRY_B = '0x8617e340b3d01fa5f11f306f4090fd50e238070d' as const;
const CONTRACTS = '0xde709f2102306220921060314715629080e2fb77' as const;
const SIGNER = '0x27b1fdb04752bbc536007a920d24acb045561c26' as const;

const scb: ScbFields = {
	smartContractAddress: '0x0000000000000000000000000000000000000000',
	bytecodeHash: `0x${'0'.repeat(64)}`,
	smartContractChainId: 0n
};

function record(version: bigint, title = 'Act') {
	return {
		contentUri: `tx${version}`,
		contentHash: `0x${String(version).padStart(64, 'a')}`,
		title,
		version,
		timestamp: 1700000000n,
		voteId: '',
		docType: 0
	};
}

function picked(overrides: Partial<PickedEntry> = {}): PickedEntry {
	return {
		kind: 'registry',
		title: 'Act',
		categoryId: 1,
		documentId: 1,
		version: 1,
		relationType: RELATION_GOVERNS,
		registryAddress: REGISTRY_A,
		categoryName: 'Laws',
		networkName: 'Sepolia',
		include: 'text',
		...overrides
	} as PickedEntry;
}

const external: PickedEntry = { kind: 'external', title: 'Policy', hash: 'b'.repeat(64), uri: 'ipfs://abc' };

function request(overrides: Partial<PrepareRequest> = {}): PrepareRequest {
	return {
		templateTitle: 'Service Agreement',
		templateContent: '---\ntitle: t\n---\n\n## §2 Terms\n\nPay {{amount}} to the {{client}}.',
		template: { categoryId: 0n, documentId: 2n, version: 3n, registryAddress: REGISTRY_A },
		roles: [{ key: 'client', label: 'Client' }] as PrepareRequest['roles'],
		bindings: { client: { signer_name: 'A', wallet: SIGNER } },
		variableValues: { amount: '5' },
		picked: [],
		signatories: [SIGNER],
		hashOnly: false,
		revision: null,
		contractRegistry: CONTRACTS,
		chainId: 11155111,
		...overrides
	};
}

function createdLog(id: bigint, address: string = CONTRACTS): Log {
	const topics = encodeEventTopics({
		abi: ContractRegistryABI,
		eventName: 'ContractCreated',
		args: { contractId: id, creator: SIGNER }
	} as never);
	return { address, topics, data: '0x' } as unknown as Log;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveForPackage.mockImplementation(async (input: { documentId: bigint }) => ({
		title: `Law ${input.documentId}`,
		body: `## §1 Law ${input.documentId} text`,
		components: [record(1n), record(2n)]
	}));
	mocks.readDocumentRecord.mockImplementation(async (r: { version: bigint }) => ({
		doc: record(r.version, 'Other'),
		categoryName: 'Templates'
	}));
	mocks.readHistory.mockImplementation(async (r: { documentId: bigint }) => [record(2n, `Law ${r.documentId}`)]);
	mocks.encryptForRecipients.mockImplementation(async (plain: string) => ({ plain }));
	mocks.uploadDocument.mockResolvedValue('txid');
	mocks.verifyTurboHas.mockResolvedValue(undefined);
	mocks.createContract.mockResolvedValue('0xhash');
	mocks.logs = [createdLog(7n)];
});

describe('create flow', () => {
	it('stores what it hashes, with law in the text and references in step', async () => {
		const prepared = await preparePackage(
			request({
				picked: [
					picked({ documentId: 1 }),
					picked({ documentId: 2, relationType: RELATION_IMPLEMENTS, include: 'citation' }),
					external,
					picked({ documentId: 3, relationType: RELATION_REFERENCES })
				]
			})
		);
		const committed = await commitPackage(prepared, scb, null, { uri: null, hash: null }, CONTRACTS);

		const plaintext = mocks.encryptForRecipients.mock.calls[0][0] as string;
		expect(`0x${sha256(plaintext)}`).toBe(committed.contentHash);
		expect(plaintext).toContain('## §1 Law 1 text');
		expect(plaintext).not.toContain('Resolved from');
		expect(plaintext).not.toContain('Law 2 text');
		expect(plaintext).toContain('Text at: tx2');
		expect(plaintext).toContain('Text at: ipfs://abc');
		expect(plaintext).toContain('# Part II — Governing Law: Law 1');
		expect(plaintext).toContain('# Part III — References');
		expect(plaintext).not.toContain('Record');
		expect(plaintext).toContain('Pay 5 to the Client.');

		const sent = mocks.createContract.mock.calls[0][0];
		expect(sent.contentHash).toBe(committed.contentHash);
		expect(sent.contentUri).toBe('txid');
		expect(sent.references.map((r: { relationType: number }) => r.relationType)).toEqual([
			RELATION_TEMPLATE,
			RELATION_GOVERNS,
			RELATION_IMPLEMENTS,
			RELATION_REFERENCES
		]);
		expect(committed.contractId).toBe(7n);
	});

	it('resolves every law as of the latest home-chain block', async () => {
		const prepared = await preparePackage(request({ picked: [picked()] }));
		expect(prepared.asOf).toBe(1800000000n);
		expect(mocks.resolveForPackage).toHaveBeenCalledWith(expect.anything(), 1800000000n);
	});

	it('records the version embedded, not the version picked', async () => {
		const prepared = await preparePackage(request({ picked: [picked({ version: 1 })] }));
		expect(prepared.references[1].version).toBe(2n);
	});

	it('moves text and references together when the order changes', async () => {
		const a = picked({ documentId: 1, registryAddress: REGISTRY_A });
		const b = picked({ documentId: 2, registryAddress: REGISTRY_B });
		const ab = await preparePackage(request({ picked: [a, b] }));
		const ba = await preparePackage(request({ picked: [b, a] }));

		const first = (text: string) => text.includes('# Part II — Governing Law: Law 1');
		expect(first(ab.canonical)).toBe(true);
		expect(first(ba.canonical)).toBe(false);

		const registries = (refs: typeof ab.references) =>
			refs.filter((r) => r.relationType === RELATION_GOVERNS).map((r) => r.registryAddress);
		expect(registries(ab.references)).toEqual([REGISTRY_A, REGISTRY_B]);
		expect(registries(ba.references)).toEqual([REGISTRY_B, REGISTRY_A]);
	});

	it('records embedded law before cited law, whatever the picked order', async () => {
		const cited = picked({ documentId: 2, include: 'citation' });
		const prepared = await preparePackage(request({ picked: [cited, picked({ documentId: 1 })] }));
		expect(prepared.references.map((r) => r.documentId)).toEqual([2n, 1n, 2n]);
		expect(prepared.canonical.indexOf('# Part II — Governing Law: Law 1')).toBeLessThan(
			prepared.canonical.indexOf('## Governing Law: Law 2')
		);
	});

	it('cites an amended document as consolidated at T, without hash or link, and never fetches its text', async () => {
		mocks.readHistory.mockResolvedValue([
			record(1n, 'Code'),
			{ ...record(2n, 'Code (Amendment)'), docType: 1 },
			{ ...record(3n, 'Code (Amendment)'), docType: 1, timestamp: 1900000000n }
		]);
		const prepared = await preparePackage(
			request({ picked: [picked({ documentId: 5, relationType: RELATION_REFERENCES, include: 'citation' })] })
		);
		expect(prepared.canonical).toContain('## Reference: Code\n\n"Code", Laws, ');
		expect(prepared.canonical).toContain('Consolidated as in force at ');
		expect(prepared.canonical).toContain('(unix 1800000000)');
		expect(prepared.canonical).not.toContain('Text at: tx');
		expect(prepared.references[1].version).toBe(2n);
		expect(mocks.resolveForPackage).not.toHaveBeenCalled();
	});

	it('names the law and produces nothing when a law cannot be retrieved', async () => {
		mocks.resolveForPackage.mockRejectedValue(new Error('gateway down'));
		await expect(preparePackage(request({ picked: [picked({ title: 'Broken Act' })] }))).rejects.toThrow(
			/Broken Act.*gateway down/
		);
		expect(mocks.uploadDocument).not.toHaveBeenCalled();
		expect(mocks.createContract).not.toHaveBeenCalled();
	});

	it('writes a revision as text, references the source and has no comments', async () => {
		const prepared = await preparePackage(
			request({ revision: { ofContractId: 4n, reason: 'New\n date' } })
		);
		expect(prepared.canonical).toContain('This agreement revises contract #4 in the same registry.');
		expect(prepared.canonical).toContain('Reason for revision: New date');
		expect(prepared.canonical).not.toContain('<!--');
		expect(prepared.references.map((r) => r.relationType)).toEqual([RELATION_TEMPLATE, RELATION_REVISES]);
		expect(prepared.references[1].documentId).toBe(4n);
	});

	it('refuses a revision that differs from its source only by the revision sentences', async () => {
		const source = await preparePackage(request());
		const sourceHash = `0x${sha256(source.canonical)}` as `0x${string}`;
		const prepared = await preparePackage(request({ revision: { ofContractId: 4n, reason: '' } }));
		await expect(
			commitPackage(prepared, scb, sourceHash, { uri: null, hash: null }, CONTRACTS)
		).rejects.toThrow(/identical/);
		expect(mocks.createContract).not.toHaveBeenCalled();
	});

	it('uploads nothing in hash-only mode', async () => {
		const prepared = await preparePackage(request({ hashOnly: true }));
		await commitPackage(prepared, scb, null, { uri: null, hash: null }, CONTRACTS);
		expect(mocks.uploadDocument).not.toHaveBeenCalled();
		expect(mocks.createContract.mock.calls[0][0].contentUri).toBe('');
	});

	it('leaves the chain untouched when an upload is refused', async () => {
		mocks.uploadDocument.mockRejectedValue(new Error('refused'));
		const prepared = await preparePackage(request());
		await expect(
			commitPackage(prepared, scb, null, { uri: null, hash: null }, CONTRACTS)
		).rejects.toThrow('refused');
		expect(mocks.createContract).not.toHaveBeenCalled();
	});

	it('re-checks an unconfirmed upload instead of uploading again', async () => {
		mocks.verifyTurboHas.mockRejectedValueOnce(new Error('not yet'));
		const prepared = await preparePackage(request());
		const pending = { uri: null, hash: null };
		await expect(commitPackage(prepared, scb, null, pending, CONTRACTS)).rejects.toThrow(/re-check/);
		await commitPackage(prepared, scb, null, pending, CONTRACTS);
		expect(mocks.uploadDocument).toHaveBeenCalledTimes(1);
		expect(mocks.createContract.mock.calls[0][0].contentUri).toBe('txid');
	});
});

describe('checks', () => {
	it('catches references that disagree with the law section', async () => {
		const prepared = await preparePackage(request({ picked: [picked()] }));
		expect(() => assertReferencesMatchLaw(prepared.references, prepared.input.law)).not.toThrow();
		expect(() => assertReferencesMatchLaw([], prepared.input.law)).toThrow();
	});

	it('takes the id from this registry\'s event in the receipt', () => {
		expect(contractIdFromLogs([createdLog(9n, REGISTRY_A), createdLog(7n)], CONTRACTS)).toBe(7n);
		expect(() => contractIdFromLogs([], CONTRACTS)).toThrow();
	});
});

describe('sidecar', () => {
	it('carries citations, external documents and parties, and serializes', async () => {
		const prepared = await preparePackage(
			request({
				picked: [picked(), external],
				revision: { ofContractId: 4n, reason: 'x' },
				bindings: {
					client: { signer_name: 'A', wallet: SIGNER, email: 'a@b.c', phone: ' ' }
				}
			})
		);
		const json = JSON.parse(
			sidecarJson(buildSidecar(prepared, { contractId: 7n, contentHash: '0xabc', contentUri: 'txid' }, scb))
		);
		expect(json.contractId).toBe('7');
		expect(json.revision).toEqual({ ofContractId: '4', reason: 'x' });
		expect(json.externalDocuments).toEqual([{ title: 'Policy', hash: 'b'.repeat(64), uri: 'ipfs://abc' }]);
		expect(json.parties).toEqual({ client: { signer_name: 'A', wallet: SIGNER, email: 'a@b.c' } });
		expect(json.references).toHaveLength(2);
		for (const envelope of json.references) expect(() => citationFromJSON(envelope)).not.toThrow();
		expect(json.resolution).toEqual({
			asOf: '1800000000',
			rule: `@vattelum/document-registry-js@${VERSION}`,
			laws: [
				{
					chainId: '11155111',
					registryAddress: REGISTRY_A,
					categoryId: '1',
					documentId: '1',
					title: 'Law 1',
					versions: [
						{ version: '1', contentHash: record(1n).contentHash },
						{ version: '2', contentHash: record(2n).contentHash }
					]
				}
			]
		});
	});
});
