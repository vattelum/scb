import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashBody, stripFrontmatter } from '@vattelum/document-registry-js';

const reads = vi.hoisted(() => ({ history: [] as unknown[], refs: vi.fn(), bodies: new Map<string, string>() }));

vi.mock('#lib/services/chain-read.ts', () => ({
	readOnChain: vi.fn(async (_chain: unknown, p: { functionName: string }) =>
		p.functionName === 'getHistory' ? reads.history : reads.refs()
	)
}));
vi.mock('#lib/services/arweave.ts', () => ({
	fetchFromArweave: vi.fn(async (uri: string) => {
		const body = reads.bodies.get(uri);
		if (body === undefined) throw new Error('gateway down');
		return body;
	})
}));
vi.mock('#lib/contracts/index.ts', () => ({ DAARegistryABI: [] }));

import { contributingVersions, readHistory, resolveForPackage, resolveLegislation } from './legislation-resolver.ts';
import { readOnChain } from '#lib/services/chain-read.ts';

const REGISTRY = '0x52908400098527886e0f7030069857d2e4169ee7' as const;
const input = { registryAddress: REGISTRY, categoryId: 1n, documentId: 1n, version: 1n };

const T = 1000n;

/** A version whose stored text, when given, is fetchable and matches its content hash. */
function version(n: bigint, docType: number, body?: string, title = 'Act', timestamp = 100n) {
	if (body !== undefined) reads.bodies.set(`tx${n}`, body);
	const contentHash = `0x${hashBody(stripFrontmatter(body ?? 'unfetchable'))}`;
	return { contentUri: `tx${n}`, contentHash, title, version: n, timestamp, voteId: 'v', docType };
}

const amends = (target: string) => [
	{ relationType: 0, registryAddress: REGISTRY, categoryId: 1n, documentId: 1n, targetSection: target }
];

beforeEach(() => {
	reads.history = [];
	reads.refs = vi.fn(async () => []);
	reads.bodies.clear();
});

describe('resolveForPackage', () => {
	it('returns a single version as its stored body, preamble included', async () => {
		const stored = '# Act\n\nWHEREAS.\n\n## §1 Scope\nText directly under.';
		reads.history = [version(1n, 0, `---\ntitle: x\n---\n\n${stored}`)];
		const out = await resolveForPackage(input, T);
		expect(out.body).toBe(stored);
		expect(hashBody(out.body)).toBe(hashBody(stored));
		expect(out.components[0].version).toBe(1n);
		expect(out.components[0].voteId).toBe('v');
	});

	it('returns a law with no section headings intact', async () => {
		reads.history = [version(1n, 0, 'All of the text.')];
		expect((await resolveForPackage(input, T)).body).toBe('All of the text.');
	});

	it('keeps the preamble and applies an amendment', async () => {
		reads.history = [
			version(1n, 0, 'WHEREAS.\n\n## §1 A\n\nOld.\n\n## §2 B\n\nKept.'),
			version(2n, 1, '## §1 A\n\nNew.', 'Act (Amendment)')
		];
		reads.refs = vi.fn(async () => amends('1'));
		const out = await resolveForPackage(input, T);
		expect(out.body).toBe('WHEREAS.\n\n## §1 A\n\nNew.\n\n## §2 B\n\nKept.');
		expect(out.title).toBe('Act');
		expect(out.components.map((c) => c.version)).toEqual([1n, 2n]);
	});

	it('resolves as of the cutoff, ignoring later versions', async () => {
		reads.history = [
			version(1n, 0, '## §1 A\n\nOld.'),
			version(2n, 1, '## §1 A\n\nNew.', 'Act', T + 1n)
		];
		reads.refs = vi.fn(async () => amends('1'));
		const out = await resolveForPackage(input, T);
		expect(out.body).toBe('## §1 A\n\nOld.');
		expect(out.components.map((c) => c.version)).toEqual([1n]);
	});

	it('stops when a body does not match its content hash', async () => {
		reads.history = [{ ...version(1n, 0, '## §1 A\n\nText.'), contentHash: `0x${'0'.repeat(64)}` }];
		await expect(resolveForPackage(input, T)).rejects.toThrow(/content hash/);
	});

	it('stops when a body cannot be fetched', async () => {
		reads.history = [version(1n, 0)];
		await expect(resolveForPackage(input, T)).rejects.toThrow('gateway down');
	});

	it('stops on a failed target read rather than reading it as a whole repeal', async () => {
		reads.history = [version(1n, 0, '## §1 A\n\nText.'), version(2n, 3, '')];
		reads.refs = vi.fn(async () => {
			throw new Error('rpc down');
		});
		await expect(resolveForPackage(input, T)).rejects.toThrow(/references/);
	});

	it('refuses a repealed law and an empty body', async () => {
		reads.history = [version(1n, 0, '## §1 A\n\nText.'), version(2n, 3, '')];
		await expect(resolveForPackage(input, T)).rejects.toThrow(/repealed/);

		reads.history = [version(1n, 0, '  ')];
		await expect(resolveForPackage(input, T)).rejects.toThrow(/empty/);
	});

	it('reads from the chain named by the reference', async () => {
		reads.history = [version(1n, 0, 'Text.')];
		await resolveForPackage({ ...input, chainId: 10n }, T);
		expect(readOnChain).toHaveBeenLastCalledWith(10n, expect.objectContaining({ functionName: 'getHistory' }));
	});
});

describe('resolveLegislation', () => {
	it('keeps its forgiving behaviour and output shape', async () => {
		reads.history = [version(1n, 0, '## §1 A\n\nText.'), version(2n, 3, '')];
		const repealed = await resolveLegislation(input, T);
		expect(repealed.status).toBe('Repealed');
		expect(repealed.consolidatedBody).toBe('');

		const before = await resolveLegislation(input, 50n);
		expect(before.components).toEqual([]);
		expect(before.status).toBe('InForce');
	});

	it('marks an amended law and keeps its preamble', async () => {
		reads.history = [
			version(1n, 0, 'WHEREAS.\n\n## §1 A\n\nOld.'),
			version(2n, 1, '## §1 A\n\nNew.')
		];
		reads.refs = vi.fn(async () => amends('1'));
		const out = await resolveLegislation(input, T);
		expect(out.status).toBe('PartiallyAmended');
		expect(out.consolidatedBody).toBe('WHEREAS.\n\n## §1 A\n\nNew.');
	});

	it('resolves a revised law to the revision alone, in force, as stored', async () => {
		const revised = '## §1 A\n\nRevised   text, kept as stored.';
		reads.history = [version(1n, 0, '## §1. A\n\nOld.'), version(2n, 2, revised)];
		const out = await resolveLegislation(input, T);
		expect(out.status).toBe('InForce');
		expect(out.components.map((c) => c.version)).toEqual([2]);
		expect(out.consolidatedBody).toBe(revised);
		expect(`0x${hashBody(out.consolidatedBody)}`).toBe((reads.history[1] as { contentHash: string }).contentHash);
	});
});

describe('contributingVersions', () => {
	it('starts at the last version that set the whole text and keeps the changes after it', async () => {
		reads.history = [
			version(1n, 0, undefined, 'Act'),
			version(2n, 1, undefined, 'Act (Amendment)'),
			version(3n, 2, undefined, 'Act v2'),
			version(4n, 1, undefined, 'Act v2 (Amendment)'),
			version(5n, 3, undefined, 'Act v2 (Partial Repeal)')
		];
		const history = await readHistory(input);
		const titles = (n: bigint) => contributingVersions(history.filter((v) => v.version <= n)).map((v) => v.title);
		expect(titles(1n)).toEqual(['Act']);
		expect(titles(2n)).toEqual(['Act', 'Act (Amendment)']);
		expect(titles(3n)).toEqual(['Act v2']);
		expect(titles(5n)).toEqual(['Act v2', 'Act v2 (Amendment)', 'Act v2 (Partial Repeal)']);
	});
});
