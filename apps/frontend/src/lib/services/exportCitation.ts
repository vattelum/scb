/**
 * JSON citation envelope export.
 *
 * The envelope is always built by `citationToJSON` from
 * `@vattelum/document-registry-js` — never assembled here — so the emitted
 * shape, field order, and tag stay owned by the standards package.
 */

import { citationToJSON, type Document, type DocumentReference } from '@vattelum/document-registry-js';

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
