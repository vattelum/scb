import { describe, expect, it, vi } from 'vitest';
import { RELATION_GOVERNS, RELATION_IMPLEMENTS, RELATION_REFERENCES, RELATION_REVISES, RELATION_TEMPLATE } from '@vattelum/document-registry-js';

const mocks = vi.hoisted(() => ({ readOnChain: vi.fn() }));
const REGISTRY = vi.hoisted(() => '0x52908400098527886e0f7030069857d2e4169ee7');
const CONTRACTS = '0xde709f2102306220921060314715629080e2fb77';

vi.mock('dompurify', () => ({ default: { sanitize: (s: string) => s } }));
vi.mock('#lib/services/chain-read.ts', () => ({ readOnChain: mocks.readOnChain }));
vi.mock('#lib/services/contract-registry.ts', () => ({ StatusLabels: { 0: 'Created', 1: 'Active' } }));
vi.mock('#lib/services/arweave.ts', () => ({ arweaveUrl: (t: string) => `https://example.test/${t}` }));
vi.mock('#lib/contracts/index.ts', () => ({ daaRegistryAddress: REGISTRY, DAARegistryABI: [] }));

import { assembleHtml, fetchReferenceRows, referencePartLines } from './print.ts';

const hash = `0x${'a'.repeat(64)}`;
const law = {
	registryAddress: REGISTRY,
	chainId: 11155111n,
	categoryId: 1n,
	documentId: 2n,
	version: 3n,
	relationType: RELATION_GOVERNS,
	targetSection: ''
} as never;
const revises = {
	registryAddress: CONTRACTS,
	chainId: 11155111n,
	categoryId: 0n,
	documentId: 4n,
	version: 0n,
	relationType: RELATION_REVISES,
	targetSection: ''
} as never;

function html(contractContent: string, rows: Parameters<typeof assembleHtml>[0]['referenceRows'] = [], draft = false) {
	return assembleHtml({
		contractId: 5n,
		contract: {
			contentHash: hash,
			signatories: [],
			signatures: [],
			contentUris: [],
			references: [],
			status: 1,
			createdAt: 1700000000n,
			smartContractAddress: '0x0000000000000000000000000000000000000000',
			bytecodeHash: hash,
			smartContractChainId: 0n
		} as never,
		contractContent,
		referenceRows: rows,
		events: [],
		contractRegistryAddress: CONTRACTS,
		chainId: 11155111,
		effectiveStatus: 1,
		draft
	});
}

const version = (n: bigint, docType: number, title: string) => ({
	contentUri: `tx${n}`,
	contentHash: hash,
	title,
	version: n,
	timestamp: 1700000000n + n,
	voteId: '',
	docType
});

describe('fetchReferenceRows', () => {
	it('lists the versions making up the referenced version, and survives a failed read', async () => {
		mocks.readOnChain.mockResolvedValueOnce([
			version(1n, 0, 'Act'),
			version(2n, 2, 'Act v2'),
			version(3n, 1, 'Act v2 (Amendment)'),
			version(4n, 3, 'Act v2 (Partial Repeal)')
		]);
		const [row, contract] = await fetchReferenceRows([law, revises], CONTRACTS);
		expect(row.title).toBe('Act v2');
		expect(row.versions.map((v) => v.version)).toEqual([2n, 3n]);
		expect(contract.versions).toEqual([]);
		expect(mocks.readOnChain).toHaveBeenCalledTimes(1);

		mocks.readOnChain.mockResolvedValueOnce([version(1n, 0, 'Act'), version(2n, 2, 'Act v2')]);
		const [revised] = await fetchReferenceRows([{ ...(law as object), version: 2n } as never], CONTRACTS);
		expect(revised.versions.map((v) => v.title)).toEqual(['Act v2']);

		mocks.readOnChain.mockRejectedValueOnce(new Error('rpc down'));
		const [failed] = await fetchReferenceRows([law], CONTRACTS);
		expect(failed).toMatchObject({ title: '', versions: [] });
	});
});

describe('assembleHtml', () => {
	it('renders the package between the cover line and the appendix', () => {
		const out = html('# Title\n\n## §1 Parties');
		expect(out).toContain('Rendering of contract #5');
		expect(out).not.toContain('created before the package format');
		expect(out.indexOf('Rendering of contract')).toBeLessThan(out.indexOf('<h1'));
		expect(out.indexOf('<h1')).toBeLessThan(out.indexOf('Verification Appendix'));
		expect(out).toContain(`identified by content hash <span class="mono">${hash}</span>`);
	});

	it('renders identically twice', () => {
		const region = (s: string) => s.slice(s.indexOf('<h1'), s.indexOf('Verification Appendix'));
		expect(region(html('# Title\n\nText'))).toBe(region(html('# Title\n\nText')));
	});

	it('marks a legacy contract and an unsigned one', () => {
		expect(html('## §1 Parties')).toContain('created before the package format');
		expect(html('# Title', [], true)).toContain('(UNSIGNED)');
	});

	it('groups the versions of each reference under a relation header and a part line', () => {
		const pkg = '# Part I — Contract: Lease\n\nx\n\n# Part II — Governing Law: Act\n\ny';
		const template = { ...(law as object), relationType: RELATION_TEMPLATE } as never;
		const out = html(pkg, [
			{ reference: template, title: 'Lease', versions: [version(1n, 0, 'Lease')] },
			{ reference: revises, title: '', versions: [] },
			{ reference: law, title: 'Act', versions: [version(1n, 0, 'Act'), version(2n, 1, 'Act (Amendment)'), version(3n, 3, 'Act (Partial Repeal)')] }
		]);
		expect(out).toContain('<th>Title</th><th>Document type</th><th>Cat/Doc/Ver</th>');
		const headers = [...out.matchAll(/<th colspan="7">(.*?)<\/th>/g)].map((m) => m[1]);
		expect(headers).toEqual(['Template', 'Revises', 'Governing Law']);
		const lines = [...out.matchAll(/<td colspan="7"><strong>(.*?)<\/strong><\/td>/g)].map((m) => m[1]);
		expect(lines).toEqual(['Part I — Lease', 'Part I — Contract #4', 'Part II — Act']);
		for (const n of ['1/2/1', '1/2/2', '1/2/3']) expect(out).toContain(`<td>${n}</td>`);
		expect(out).toContain('<td class="ref-change">Act (Partial Repeal)</td>');
		expect(out).not.toContain('ratified');
	});

	it('opens one header for consecutive references with the same relation', () => {
		const second = { ...(law as object), documentId: 9n } as never;
		const out = html('# Part I — Contract: Lease\n\n# Part II — Governing Law: Act\n\n# Part III — Governing Law: Code', [
			{ reference: law, title: 'Act', versions: [version(1n, 0, 'Act')] },
			{ reference: second, title: 'Code', versions: [version(1n, 0, 'Code')] }
		]);
		expect([...out.matchAll(/<th colspan="7">(.*?)<\/th>/g)].map((m) => m[1])).toEqual(['Governing Law']);
	});
});

describe('referencePartLines', () => {
	const ref = (relationType: number, documentId = 2n) => ({ ...(law as object), relationType, documentId }) as never;
	const pkg = [
		'# Part I — Contract: Lease',
		'# Part II — Governing Law: Act',
		'# Part III — Adopted Module: Data Integrity Standard',
		'# Part IV — References',
		'## Governing Law: Cited',
		'## Reference: Guide'
	].join('\n\n');

	it('maps embedded law to its part and the rest to References', () => {
		const rows = [
			{ reference: ref(RELATION_TEMPLATE), title: 'Lease', versions: [] },
			{ reference: ref(RELATION_GOVERNS), title: 'Act', versions: [] },
			{ reference: ref(RELATION_IMPLEMENTS), title: 'DIS', versions: [] },
			{ reference: ref(RELATION_GOVERNS, 3n), title: 'Cited', versions: [] },
			{ reference: ref(RELATION_REFERENCES), title: 'Guide', versions: [] }
		];
		expect(referencePartLines(pkg, rows, CONTRACTS)).toEqual([
			'Part I — Template: Lease',
			'Part II — Governing Law: Act',
			'Part III — Adopted Module: Data Integrity Standard',
			'Part IV — References: Cited',
			'Part IV — References: Guide'
		]);
	});

	it('gives relation and title only for text without parts', () => {
		const rows = [
			{ reference: ref(RELATION_GOVERNS), title: 'Act', versions: [] },
			{ reference: revises, title: '', versions: [] }
		];
		expect(referencePartLines('## §1 Parties', rows, CONTRACTS)).toEqual(['Governing Law: Act', 'Revises: Contract #4']);
	});
});
