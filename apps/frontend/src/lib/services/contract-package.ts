/**
 * Assembles the contract package: the single markdown file that is hashed,
 * encrypted, stored, signed, printed and exported.
 *
 * Producer tooling only. A verifier hashes the file it holds and never needs this
 * module. Pure and deterministic: equal input gives identical bytes.
 */

import {
	formatCitation,
	formatDate,
	RELATION_GOVERNS,
	RELATION_IMPLEMENTS,
	toChecksumAddress,
	VERSION,
	type Document,
	type DocumentReference
} from '@vattelum/document-registry-js';
import { relationLabel } from '../constants/docTypes.ts';
import { renderParties, type PartyBindings } from './party.ts';
import type { TemplateRole } from './template-variables.ts';

/** A document held in a conforming registry: law to embed or cite, or a cited reference. */
export type RegistryLaw = {
	kind: 'registry';
	/** As sent on-chain; `version` is the version embedded or cited. */
	ref: DocumentReference;
	categoryName: string;
	networkName: string;
	/** Title of the version that last set the whole text. Used in headings. */
	title: string;
	/** 'text' embeds the law as its own part; only GOVERNS / IMPLEMENTS law is embedded. */
	include: 'text' | 'citation';
	/** Required when the law is embedded. */
	body?: string;
	/**
	 * On-chain record of every contributing version, ascending. Never empty. A cited
	 * document with more than one is cited as consolidated, not by one version.
	 */
	components: Document[];
	/** Readable link to the cited version's text, printed instead of its raw content URI. */
	textUrl?: string;
};

/** A governing document that lives in no registry. */
export type ExternalDocument = {
	kind: 'external';
	title: string;
	/** 64 lowercase hex, SHA-256 of the file bytes, no 0x. */
	hash: string;
	/** Scheme is one of ipfs, https, ar. */
	uri: string;
};

export type PackageInput = {
	templateTitle: string;
	/** Template body before substitution; used to check that values add no headings. */
	templateBody: string;
	roles: TemplateRole[];
	bindings: PartyBindings;
	/** `templateBody` with placeholders substituted. */
	filledBody: string;
	/** Every picked document, in the creator's chosen order; may be empty. */
	law: (RegistryLaw | ExternalDocument)[];
	registry: { contractRegistry: string; chainId: bigint };
	/** Cutoff T, unix seconds: every law is resolved as it stood at T. */
	asOf: bigint;
	revision?: { ofContractId: bigint; reason?: string };
};

const LINE_BREAK = /[\r\n]/;
export const EXTERNAL_URI = /^(ipfs|https|ar):\/\/\S+$/;
const EXTERNAL_HASH = /^[0-9a-f]{64}$/;

function singleLine(value: string, what: string): void {
	if (LINE_BREAK.test(value)) throw new Error(`${what} must be a single line.`);
}

function countHeadingLines(text: string): number {
	return text.split('\n').filter((line) => line.startsWith('#')).length;
}

const ROMAN: [number, string][] = [
	[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
	[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];

function roman(n: number): string {
	let out = '';
	for (const [value, numeral] of ROMAN) {
		while (n >= value) {
			out += numeral;
			n -= value;
		}
	}
	return out;
}

function isLawRelation(relationType: number): boolean {
	return relationType === RELATION_GOVERNS || relationType === RELATION_IMPLEMENTS;
}

/**
 * The package's order of picked documents: law embedded as its own part, then law
 * cited only, then other registry references, then external documents; each group
 * in the creator's order. The on-chain references follow the same order, which is
 * how the print appendix maps each reference to its part.
 */
export function packageOrder(law: PackageInput['law']): {
	embedded: RegistryLaw[];
	citedLaw: RegistryLaw[];
	references: RegistryLaw[];
	external: ExternalDocument[];
} {
	const registry = law.filter((l): l is RegistryLaw => l.kind === 'registry');
	return {
		embedded: registry.filter((l) => isLawRelation(l.ref.relationType) && l.include === 'text'),
		citedLaw: registry.filter((l) => isLawRelation(l.ref.relationType) && l.include === 'citation'),
		references: registry.filter((l) => !isLawRelation(l.ref.relationType)),
		external: law.filter((l): l is ExternalDocument => l.kind === 'external')
	};
}

function resolvedLine(asOf: bigint): string {
	return `Resolved as of ${formatDate(asOf)} UTC (unix ${asOf}) under @vattelum/document-registry-js ${VERSION}.`;
}

function renderEmbedded(law: RegistryLaw, part: string, asOf: bigint): string[] {
	singleLine(law.title, 'Law title');
	if (law.components.length === 0) throw new Error(`"${law.title}" has no versions.`);
	if (!law.body?.trim()) throw new Error(`"${law.title}" has no text to embed.`);
	return [
		`# Part ${part} — ${relationLabel(law.ref.relationType)}: ${law.title}`,
		resolvedLine(asOf),
		law.body.trim()
	];
}

function renderCited(law: RegistryLaw, asOf: bigint): string[] {
	singleLine(law.title, 'Document title');
	if (law.components.length === 0) throw new Error(`"${law.title}" has no versions.`);
	const heading = `## ${relationLabel(law.ref.relationType)}: ${law.title}`;
	const latest = law.components[law.components.length - 1];
	if (law.components.length === 1) {
		return [
			heading,
			formatCitation(law.ref, latest, { categoryName: law.categoryName, networkName: law.networkName }),
			`Text at: ${law.textUrl ?? latest.contentUri}`
		];
	}
	// Amended: no single stored file holds this text, so no hash or link is given.
	return [
		heading,
		`"${law.title}", ${law.categoryName}, ${toChecksumAddress(law.ref.registryAddress)}, ${law.networkName}`,
		`Consolidated as in force at ${formatDate(asOf)} UTC (unix ${asOf}) under @vattelum/document-registry-js ${VERSION}.`
	];
}

function renderExternal(doc: ExternalDocument): string[] {
	singleLine(doc.title, 'External document title');
	singleLine(doc.uri, 'External document link');
	if (!EXTERNAL_URI.test(doc.uri)) {
		throw new Error('External document link must start with ipfs://, https:// or ar://.');
	}
	if (!EXTERNAL_HASH.test(doc.hash)) {
		throw new Error('External document hash must be 64 lowercase hex characters.');
	}
	return [`## External Document: ${doc.title}`, `SHA-256: ${doc.hash}`, `Text at: ${doc.uri}`];
}

export function assembleContractPackage(input: PackageInput): string {
	if (!input.templateTitle.trim()) throw new Error('A contract package must start with its title.');
	singleLine(input.templateTitle, 'Template title');
	if (countHeadingLines(input.filledBody) > countHeadingLines(input.templateBody)) {
		throw new Error('A filled-in value cannot begin a line with "#": it would read as a heading.');
	}

	const blocks: string[] = [`# Part I — Contract: ${input.templateTitle}`];

	// A revision says so first, under the Part I heading and before any section.
	if (input.revision) {
		blocks.push(`This agreement revises contract #${input.revision.ofContractId} in the same registry.`);
		const reason = input.revision.reason?.trim();
		if (reason) {
			singleLine(reason, 'Reason for revision');
			blocks.push(`Reason for revision: ${reason}`);
		}
	}

	blocks.push(renderParties(input.roles, input.bindings), input.filledBody.trim());

	const { embedded, citedLaw, references, external } = packageOrder(input.law);
	let part = 1;
	for (const law of embedded) blocks.push(...renderEmbedded(law, roman(++part), input.asOf));

	const cited = [...citedLaw, ...references].flatMap((law) => renderCited(law, input.asOf));
	const outside = external.flatMap(renderExternal);
	if (cited.length + outside.length > 0) {
		blocks.push(`# Part ${roman(++part)} — References`, ...cited, ...outside);
	}

	return blocks.filter((b) => b !== '').join('\n\n').trim();
}

/** A package starts with its title; earlier contracts stored a bare body that never does. */
export function isPackage(text: string): boolean {
	return text.startsWith('# ');
}

/**
 * The parts of a package that hold law or references, e.g. "Part II" or
 * "Parts II–IV"; null when there are none. Part I is the contract itself.
 */
export function governingLawSection(text: string): string | null {
	const parts = [...text.matchAll(/^# Part ([IVXLCDM]+) — /gm)].map((m) => m[1]).filter((p) => p !== 'I');
	if (parts.length === 0) return null;
	return parts.length === 1 ? `Part ${parts[0]}` : `Parts ${parts[0]}–${parts[parts.length - 1]}`;
}
