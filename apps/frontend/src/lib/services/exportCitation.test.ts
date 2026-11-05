import { describe, expect, it } from 'vitest';
import { hashBody, VERSION } from '@vattelum/document-registry-js';
import { buildInForceJson, inForceCitation } from './exportCitation.ts';
import { endOfDayUTC } from './format.ts';

describe('in-force view', () => {
	it('takes the last second of the picked day, UTC', () => {
		expect(endOfDayUTC('2026-11-04')).toBe(BigInt(Date.UTC(2026, 10, 4, 23, 59, 59) / 1000));
		expect(endOfDayUTC('')).toBeNull();
		expect(endOfDayUTC('4 Nov 2026')).toBeNull();
	});

	it('cites the law with the cutoff and rule version, as the contract does', () => {
		const asOf = endOfDayUTC('2026-11-04')!;
		expect(inForceCitation('"Act", v2, Laws', asOf)).toBe(
			`"Act", v2, Laws, resolved as of 04 Nov 2026 UTC under @vattelum/document-registry-js ${VERSION}`
		);
	});

	it('exports the law, cutoff, rule, contributing versions and the text hash', () => {
		const json = JSON.parse(
			buildInForceJson(
				{ chainId: 11155111n, registryAddress: '0xabc', categoryId: 1n, documentId: 2n },
				{
					asOf: 1800000000n,
					text: '## §1 A\n\nNew.',
					versions: [
						{ version: 1, docType: 0, targetSection: '', contentHash: '0x01' },
						{ version: 2, docType: 1, targetSection: '1', contentHash: '0x02' }
					]
				}
			)
		);
		expect(json).toEqual({
			law: { chainId: '11155111', registryAddress: '0xabc', categoryId: '1', documentId: '2' },
			asOf: '1800000000',
			rule: `@vattelum/document-registry-js@${VERSION}`,
			versions: [
				{ version: '1', docType: 0, targetSection: '', contentHash: '0x01' },
				{ version: '2', docType: 1, targetSection: '1', contentHash: '0x02' }
			],
			textHash: hashBody('## §1 A\n\nNew.')
		});
	});
});
