/**
 * JSON citation envelope export.
 *
 * The envelope is always built by `citationToJSON` from
 * `@vattelum/document-registry-js` — never assembled here — so the emitted
 * shape, field order, and tag stay owned by the standards package.
 */

import {
	citationToJSON,
	formatDate,
	hashBody,
	VERSION,
	type Document,
	type DocumentReference
} from '@vattelum/document-registry-js';

export function buildCitationJson(
	ref: DocumentReference,
	doc: Document,
	categoryName: string,
	networkName: string
): string {
	return JSON.stringify(citationToJSON(ref, doc, { categoryName, networkName }), null, 2);
}

export async function copyCitationJson(
	ref: DocumentReference,
	doc: Document,
	categoryName: string,
	networkName: string
): Promise<void> {
	await navigator.clipboard.writeText(buildCitationJson(ref, doc, categoryName, networkName));
}

export function downloadCitationJson(
	ref: DocumentReference,
	doc: Document,
	categoryName: string,
	networkName: string
): void {
	const json = buildCitationJson(ref, doc, categoryName, networkName);
	const name = `vattelum-citation-${ref.chainId}-${ref.categoryId}-${ref.documentId}-v${ref.version}.json`;
	const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

// ─── In-force text ─────────────────────────────────────────────────

/** A law's text as resolved at a cutoff, with what it was resolved from. */
export interface InForceResolution {
	asOf: bigint;
	text: string;
	versions: { version: number; docType: number; targetSection: string; contentHash: string }[];
}

/** The rule a text was resolved under, as named in contracts and citations. */
export const RESOLUTION_RULE = `@vattelum/document-registry-js@${VERSION}`;

/** The law's citation, extended with the cutoff and rule version it was resolved under. */
export function inForceCitation(citation: string, asOf: bigint): string {
	return `${citation}, resolved as of ${formatDate(asOf)} UTC under @vattelum/document-registry-js ${VERSION}`;
}

export function buildInForceJson(
	law: { chainId: bigint; registryAddress: string; categoryId: bigint; documentId: bigint },
	resolution: InForceResolution
): string {
	return JSON.stringify(
		{
			law: {
				chainId: law.chainId.toString(),
				registryAddress: law.registryAddress,
				categoryId: law.categoryId.toString(),
				documentId: law.documentId.toString()
			},
			asOf: resolution.asOf.toString(),
			rule: RESOLUTION_RULE,
			versions: resolution.versions.map((v) => ({
				version: String(v.version),
				docType: v.docType,
				targetSection: v.targetSection,
				contentHash: v.contentHash
			})),
			textHash: hashBody(resolution.text)
		},
		null,
		2
	);
}

export function downloadInForceJson(
	law: { chainId: bigint; registryAddress: string; categoryId: bigint; documentId: bigint },
	resolution: InForceResolution
): void {
	const json = buildInForceJson(law, resolution);
	const name = `vattelum-in-force-${law.chainId}-${law.categoryId}-${law.documentId}-${resolution.asOf}.json`;
	const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}
