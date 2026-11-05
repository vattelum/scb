import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashBody, RELATION_GOVERNS, RELATION_IMPLEMENTS, RELATION_REFERENCES, VERSION, type Document } from '@vattelum/document-registry-js';
import {
	assembleContractPackage,
	governingLawSection,
	isPackage,
	packageOrder,
	type ExternalDocument,
	type PackageInput,
	type RegistryLaw
} from './contract-package.ts';

const ADDRESS = '0x52908400098527886e0f7030069857d2e4169ee7';

function doc(version: bigint, title = 'Act'): Document {
	return {
		contentUri: `tx${version}`,
		contentHash: `0x${version.toString(16).padStart(64, 'a')}`,
		title,
		version,
		timestamp: 1700000000n,
		voteId: '',
		docType: version === 1n ? 0 : 1
	};
}

function law(overrides: Partial<RegistryLaw> = {}): RegistryLaw {
	const relationType = overrides.ref?.relationType ?? RELATION_GOVERNS;
	return {
		kind: 'registry',
		ref: {
			registryAddress: ADDRESS,
			chainId: 11155111n,
			categoryId: 1n,
			documentId: 1n,
			version: 1n,
			relationType,
			targetSection: ''
		},
		categoryName: 'Laws',
		networkName: 'Sepolia',
		title: 'Act',
		include: 'text',
		body: '## §1 Scope\n\nLaw text.',
		components: [doc(1n)],
		...overrides
	};
}

const external: ExternalDocument = {
	kind: 'external',
	title: 'Policy',
	hash: 'b'.repeat(64),
	uri: 'ipfs://abc'
};

function input(overrides: Partial<PackageInput> = {}): PackageInput {
	const body = '## §2 Terms\n\nPay {{amount}}.\n\n## §7 End\n\nDone.';
	return {
		templateTitle: 'Service Agreement',
		templateBody: body,
		roles: [{ key: 'client', label: 'Client' }] as PackageInput['roles'],
		bindings: { client: { signer_name: 'A', wallet: ADDRESS as `0x${string}` } },
		filledBody: body.replace('{{amount}}', '5'),
		law: [],
		registry: { contractRegistry: ADDRESS, chainId: 11155111n },
		asOf: 1700000000n,
		...overrides
	};
}

const RESOLVED = `Resolved as of 14 Nov 2023 UTC (unix 1700000000) under @vattelum/document-registry-js ${VERSION}.`;

describe('assembleContractPackage', () => {
	it('is deterministic and keeps the shape that makes both hashes equal', () => {
		const out = assembleContractPackage(input({ law: [law()] }));
		expect(out).toBe(assembleContractPackage(input({ law: [law()] })));
		expect(out.startsWith('# Part I — Contract: Service Agreement\n\n')).toBe(true);
		expect(out.endsWith('\n')).toBe(false);
		expect(hashBody(out)).toBe(createHash('sha256').update(out, 'utf8').digest('hex'));
		expect(out.match(/^## §1 Parties$/gm)).toHaveLength(1);
	});

	it('lays out the contract, each embedded law and the references as parts', () => {
		const cited = law({ title: 'Cited', include: 'citation', ref: { ...law().ref, documentId: 2n } });
		const ref = law({ title: 'Guide', include: 'citation', ref: { ...law().ref, relationType: RELATION_REFERENCES } });
		const module = law({ title: 'Module', ref: { ...law().ref, relationType: RELATION_IMPLEMENTS } });
		const out = assembleContractPackage(
			input({ law: [external, cited, law(), ref, module], revision: { ofContractId: 4n, reason: 'New date' } })
		);
		expect(out.split('\n\n').slice(0, 3)).toEqual([
			'# Part I — Contract: Service Agreement',
			'This agreement revises contract #4 in the same registry.',
			'Reason for revision: New date'
		]);
		const blocks = out.slice(out.indexOf('## §2 Terms')).split('\n\n');
		const citation = expect.stringMatching(/ratified .* UTC, hash: [0-9a-f]{64}$/);
		expect(blocks).toEqual([
			'## §2 Terms',
			'Pay 5.',
			'## §7 End',
			'Done.',
			'# Part II — Governing Law: Act',
			RESOLVED,
			'## §1 Scope',
			'Law text.',
			'# Part III — Adopted Module: Module',
			RESOLVED,
			'## §1 Scope',
			'Law text.',
			'# Part IV — References',
			'## Governing Law: Cited',
			citation,
			'Text at: tx1',
			'## Reference: Guide',
			citation,
			'Text at: tx1',
			'## External Document: Policy',
			`SHA-256: ${external.hash}`,
			'Text at: ipfs://abc'
		]);
		expect(out.indexOf('Reason for revision')).toBeLessThan(out.indexOf('# Part II'));
		expect(out.match(/ratified/g)).toHaveLength(2);
	});

	it('writes no clauses: no Record, no section numbers of its own, no end lines', () => {
		const out = assembleContractPackage(input({ law: [law()] }));
		expect(out).not.toContain('Record');
		expect(out).not.toContain('recorded in the ContractRegistry');
		expect(out).not.toContain('— end of');
		expect(out).not.toContain('Text as in force');
		expect(out).not.toMatch(/## §8|### §/);
	});

	it('refuses a value that begins a line with #', () => {
		expect(() =>
			assembleContractPackage(input({ filledBody: '## §2 Terms\n\n## §40 X\n\n## §7 End\n\nDone.' }))
		).toThrow(/heading/);
	});

	it('has no further parts without law or references', () => {
		const out = assembleContractPackage(input());
		expect(out).not.toContain('# Part II');
		expect(governingLawSection(out)).toBeNull();
	});

	it('embeds an unamended body that still hashes to its own hash', () => {
		const body = '## §1 Scope\n\nLaw text.';
		const out = assembleContractPackage(input({ law: [law({ body })] }));
		expect(out.endsWith(`${RESOLVED}\n\n${body}`)).toBe(true);
		expect(hashBody(out.slice(out.indexOf(body)))).toBe(hashBody(body));
		expect(out).not.toContain('Resolved from');
	});

	it('names no versions in the text of an amended law', () => {
		const body = '## §1 Scope\n\nLaw text.';
		const out = assembleContractPackage(
			input({ law: [law({ body, components: [doc(1n), doc(2n), doc(3n)] })] })
		);
		expect(out.endsWith(`${RESOLVED}\n\n${body}`)).toBe(true);
		expect(out).not.toContain('Resolved from');
		expect(out).not.toMatch(/hash: [0-9a-f]{64}/);
	});

	it('gives citation and link but no body for a citation-only law of one version', () => {
		const out = assembleContractPackage(input({ law: [law({ include: 'citation', components: [doc(2n)] })] }));
		expect(out).toContain('# Part II — References\n\n## Governing Law: Act');
		expect(out).toContain(', v2, Laws,');
		expect(out).toContain('Text at: tx2');
		expect(out).not.toContain('Law text.');
		expect(out).not.toContain('Resolved');
		expect(out).not.toContain('Consolidated');
	});

	it('cites an amended citation-only law as consolidated, with no hash or link', () => {
		const out = assembleContractPackage(input({ law: [law({ include: 'citation', components: [doc(1n), doc(2n)] })] }));
		expect(out).toContain('## Governing Law: Act\n\n"Act", Laws, ');
		expect(out).toContain(`Consolidated as in force at `);
		expect(out).not.toContain('Text at:');
		expect(out).not.toMatch(/hash: [0-9a-f]{64}/);
	});

	it('prints the readable link for a cited document when one is given', () => {
		const textUrl = 'https://arweave.net/abc';
		const out = assembleContractPackage(input({ law: [law({ include: 'citation', textUrl })] }));
		expect(out).toContain(`Text at: ${textUrl}`);
	});

	it('writes revision as visible text, with or without a reason', () => {
		const without = assembleContractPackage(input({ revision: { ofContractId: 4n } }));
		expect(without).toContain('This agreement revises contract #4 in the same registry.');
		expect(without).not.toContain('Reason for revision');
		const withReason = assembleContractPackage(input({ revision: { ofContractId: 4n, reason: 'New date' } }));
		expect(withReason).toContain('Reason for revision: New date');
		expect(withReason).not.toContain('<!--');
	});

	it.each([
		['an empty title', input({ templateTitle: '' })],
		['a multi-line title', input({ templateTitle: 'A\nB' })],
		['a multi-line reason', input({ revision: { ofContractId: 1n, reason: 'a\nb' } })],
		['a multi-line law title', input({ law: [law({ title: 'A\nB' })] })],
		['a multi-line uri', input({ law: [{ ...external, uri: 'ipfs://a\nb' }] })],
		['a disallowed scheme', input({ law: [{ ...external, uri: 'javascript://x' }] })],
		['a malformed hash', input({ law: [{ ...external, hash: 'ABC' }] })],
		['empty components', input({ law: [law({ components: [] })] })],
		['an empty body', input({ law: [law({ body: ' ' })] })]
	])('throws on %s', (_name, bad) => {
		expect(() => assembleContractPackage(bad)).toThrow();
	});
});

describe('package helpers', () => {
	it('tells a package from a legacy body', () => {
		expect(isPackage('# Part I — Contract: Title\n\nx')).toBe(true);
		expect(isPackage('## §1 Parties')).toBe(false);
		expect(isPackage('<!-- revision-of: 1 -->\n\n## §1 Parties')).toBe(false);
	});

	it('names the parts that hold law or references', () => {
		const one = assembleContractPackage(input({ law: [law()] }));
		expect(governingLawSection(one)).toBe('Part II');
		const three = assembleContractPackage(input({ law: [law(), law({ title: 'B' }), external] }));
		expect(governingLawSection(three)).toBe('Parts II–IV');
	});

	it('orders embedded law, cited law, references, then external documents', () => {
		const cited = law({ title: 'C', include: 'citation' });
		const ref = law({ title: 'R', include: 'citation', ref: { ...law().ref, relationType: RELATION_REFERENCES } });
		const order = packageOrder([external, ref, cited, law({ title: 'E' })]);
		expect(order.embedded.map((l) => l.title)).toEqual(['E']);
		expect(order.citedLaw.map((l) => l.title)).toEqual(['C']);
		expect(order.references.map((l) => l.title)).toEqual(['R']);
		expect(order.external).toEqual([external]);
	});
});
