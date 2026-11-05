import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ContractRecord, LifecycleEvent, DocumentReference } from '#lib/services/contract-registry.ts';
import { StatusLabels } from '#lib/services/contract-registry.ts';
import { arweaveUrl } from '#lib/services/arweave.ts';
import { formatDate } from '#lib/services/format.ts';
import { daaRegistryAddress } from '#lib/contracts/index.ts';
import { chainIdToExplorer, explorerAddressUrl, formatNetwork } from '#lib/constants/networks.ts';
import { RELATION_LABELS, relationLabel } from '#lib/constants/docTypes.ts';
import {
	type Document,
	RELATION_REVISES,
	RELATION_GOVERNS,
	RELATION_IMPLEMENTS,
	RELATION_REFERENCES,
	RELATION_TEMPLATE
} from '@vattelum/document-registry-js';
import { contributingVersions, readHistory } from '#lib/services/legislation-resolver.ts';
import { isPackage } from '#lib/services/contract-package.ts';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Prints the stored contract text followed by a verification appendix, via
 * window.print() with print CSS. The text is rendered as stored: nothing is
 * resolved, reordered or injected into it.
 */

/**
 * One reference in the appendix's Legal References table, with the versions that make
 * up its text at the referenced version: one for an original or revised document, the
 * last whole text and every amendment or repeal after it for a consolidated one.
 * An empty list means the on-chain read failed or the reference is to a contract.
 */
export interface ReferenceRow {
	reference: DocumentReference;
	/** Title of the version that last set the whole text. */
	title: string;
	versions: Document[];
}

interface AssemblyParams {
	contractId: bigint;
	contract: ContractRecord;
	contractContent: string;
	referenceRows: ReferenceRow[];
	events: LifecycleEvent[];
	contractRegistryAddress: string;
	chainId: number;
	/** Logical status at print time (effectiveStatus view) — may differ from the
	 *  stored contract.status when a proposal has ripened or signing has expired. */
	effectiveStatus: number;
	/** True until every signature is collected; marks the cover line UNSIGNED. */
	draft?: boolean;
}

/**
 * Read each reference's on-chain history for the appendix. No law text is fetched,
 * a failed read leaves that reference blank rather than stopping the print, and a
 * reference to another contract is not a registry document, so no lookup.
 */
export async function fetchReferenceRows(
	references: readonly DocumentReference[],
	contractRegistryAddress: string
): Promise<ReferenceRow[]> {
	return Promise.all(
		references.map(async (reference): Promise<ReferenceRow> => {
			if (reference.registryAddress.toLowerCase() === contractRegistryAddress.toLowerCase()) {
				return { reference, title: '', versions: [] };
			}
			try {
				const history = await readHistory(reference);
				const versions = contributingVersions(history.filter((v) => v.version <= reference.version));
				return { reference, title: versions[0]?.title ?? '', versions };
			} catch {
				return { reference, title: '', versions: [] };
			}
		})
	);
}

/**
 * For each reference, in order, the line naming the part of the package it belongs
 * to and its title, e.g. "Part II — Adopted Module: Data Integrity Standard".
 *
 * Read from the stored text and the reference order alone: the template and a
 * revised contract belong to Part I; law references come embedded law first, one
 * part each, then cited law and other references in the References part (see
 * `packageOrder`). Text without parts gets the relation and title only.
 */
export function referencePartLines(
	contractContent: string,
	rows: readonly ReferenceRow[],
	contractRegistryAddress: string
): string[] {
	const parts = [...contractContent.matchAll(/^# Part ([IVXLCDM]+) — (.+)$/gm)].map((m) => ({
		numeral: m[1],
		heading: m[2]
	}));
	const hasParts = parts[0]?.numeral === 'I';
	const lawParts = parts.filter((p) => p.numeral !== 'I' && p.heading !== 'References');
	const referencesPart = parts.find((p) => p.heading === 'References');
	let lawIndex = 0;

	return rows.map(({ reference: r, title }) => {
		const isContract = r.registryAddress.toLowerCase() === contractRegistryAddress.toLowerCase();
		const name = isContract ? `Contract #${r.documentId}` : title;
		const plain = `${relationLabel(r.relationType)}: ${name}`;
		if (!hasParts) return plain;

		if (r.relationType === RELATION_TEMPLATE || (isContract && r.relationType === RELATION_REVISES)) {
			return `Part I — ${plain}`;
		}
		if (r.relationType === RELATION_GOVERNS || r.relationType === RELATION_IMPLEMENTS) {
			const part = lawParts[lawIndex++];
			if (part) return `Part ${part.numeral} — ${part.heading}`;
		}
		if (
			referencesPart &&
			(r.relationType === RELATION_GOVERNS ||
				r.relationType === RELATION_IMPLEMENTS ||
				r.relationType === RELATION_REFERENCES)
		) {
			return `Part ${referencesPart.numeral} — References: ${name}`;
		}
		return plain;
	});
}

/**
 * Render the assembled document into a hidden same-document iframe and raise
 * the print dialog on it.
 *
 * Deliberately not a pop-up. window.open needs the click's user activation,
 * which has long expired by the time decryption and the legislation fetches
 * resolve, and it puts printing behind a per-site pop-up permission for no
 * benefit. An iframe needs neither. The assembled HTML carries its own styles
 * and references no external assets, so it is ready to print as soon as the
 * document is closed.
 */
export function assembleAndPrint(params: AssemblyParams): void {
	const html = assembleHtml(params);

	const frame = document.createElement('iframe');
	frame.setAttribute('aria-hidden', 'true');
	frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
	document.body.appendChild(frame);

	const doc = frame.contentDocument;
	const win = frame.contentWindow;
	if (!doc || !win) {
		frame.remove();
		throw new Error('Unable to prepare the print document.');
	}

	doc.open();
	doc.write(html);
	doc.close();

	// Fires on both completion and cancellation, so the frame is always reclaimed.
	win.onafterprint = () => frame.remove();

	const run = () => {
		win.focus();
		win.print();
	};

	// close() can finish parsing before this runs, in which case load has already
	// fired and an onload handler would never be called.
	if (doc.readyState === 'complete') run();
	else frame.onload = run;
}

export function assembleHtml(params: AssemblyParams): string {
	const {
		contractId,
		contract,
		contractContent,
		referenceRows,
		events,
		contractRegistryAddress,
		chainId,
		effectiveStatus,
		draft
	} = params;

	const templateName =
		referenceRows.find((r) => r.reference.relationType === RELATION_TEMPLATE)?.title ||
		`Contract #${contractId}`;

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Contract #${contractId} — ${escapeHtml(templateName)}</title>
<style>
  @media print {
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; margin: 2cm; color: #000; }
    h1 { font-size: 18pt; margin-bottom: 0.2em; }
    h2 { font-size: 14pt; margin-top: 1.5em; border-bottom: 1px solid #000; padding-bottom: 4px; }
    h3 { font-size: 12pt; margin-top: 1em; }
    .page-break { page-break-before: always; }
    .cover { margin: 0 0 1.5em 0; padding: 6px 8px; border: 1px solid #000; font-size: 10pt; }
    .timeline-entry { page-break-inside: avoid; }
    .timeline-entry .timestamp { font-size: 9pt; color: #555; }
    .appendix-table { width: 100%; border-collapse: collapse; margin: 1em 0; }
    .appendix-table th, .appendix-table td { border: 1px solid #000; padding: 6px 8px; text-align: left; font-size: 10pt; }
    .appendix-table th { background: #f0f0f0; }
    .appendix-table .ref-change { padding-left: 20px; }
    .mono { font-family: 'Courier New', monospace; font-size: 9pt; word-break: break-all; }
    a { color: #000; text-decoration: underline; }
    a.mono { font-family: 'Courier New', monospace; font-size: 9pt; word-break: break-all; }
    code { font-family: 'Courier New', monospace; font-size: 10pt; background: #f0f0f0; padding: 1px 3px; }
    ul { margin: 0.3em 0; padding-left: 1.5em; }
    li { margin: 0.15em 0; }
    .timeline { margin: 1em 0; }
    .timeline-entry { margin: 0.5em 0; padding-left: 1em; border-left: 2px solid #000; }
  }
  @media screen {
    body { font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.6; max-width: 800px; margin: 2em auto; padding: 0 1em; }
    h1 { font-size: 24px; margin-bottom: 0.2em; }
    h2 { font-size: 18px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .appendix-table { width: 100%; border-collapse: collapse; margin: 1em 0; }
    .appendix-table th, .appendix-table td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
    .appendix-table th { background: #f5f5f5; }
    .appendix-table .ref-change { padding-left: 20px; }
    .mono { font-family: monospace; font-size: 12px; word-break: break-all; }
    a { color: #0066cc; text-decoration: underline; }
    a.mono { font-family: monospace; font-size: 12px; word-break: break-all; }
    code { font-family: monospace; font-size: 12px; background: #f0f0f0; padding: 1px 3px; border-radius: 2px; }
    ul { margin: 0.3em 0; padding-left: 1.5em; }
    li { margin: 0.15em 0; }
    .page-break { margin-top: 3em; border-top: 2px solid #000; padding-top: 1em; }
    .cover { margin: 0 0 1.5em 0; padding: 6px 8px; border: 1px solid #ccc; font-size: 12px; }
    .timeline-entry { page-break-inside: avoid; }
    .timeline-entry .timestamp { font-size: 11px; color: #777; }
    .timeline-entry { margin: 0.5em 0; padding-left: 1em; border-left: 2px solid #ccc; }
  }
</style>
</head>
<body>

<p class="cover">Rendering of contract #${contractId} &mdash; printed ${formatDate(Math.floor(Date.now() / 1000))} UTC &mdash; status: ${renderStatusLabel(contract.status, effectiveStatus)}${draft ? ' (UNSIGNED)' : ''}${isPackage(contractContent) ? '' : ' (created before the package format; governing law is identified in the Legal References)'}</p>

<div>${renderContractHtml(contractContent)}</div>

<div class="page-break">
<h2>Verification Appendix</h2>

<p>This document is a rendering of the agreement identified by content hash <span class="mono">${contract.contentHash}</span>, recorded as contract #${contractId} in ContractRegistry <span class="mono">${contractRegistryAddress}</span> on chain ${chainId}. To verify, obtain the agreement file from a party, compute its SHA-256, and compare to the hash above and to the registry record.</p>

<h3>Contract Details</h3>
<table class="appendix-table">
<tr><th>Field</th><th>Value</th></tr>
<tr><td>Contract ID</td><td>${contractId}</td></tr>
<tr><td>Content Hash</td><td class="mono">${contract.contentHash}</td></tr>
<tr><td>Contract Registry</td><td>${linkAddress(contractRegistryAddress, chainId)}</td></tr>
<tr><td>Content URI</td><td>${(() => { const tx = contract.contentUris.find((t) => t && t.length > 0); return tx ? linkArweave(tx) : '<span class="mono">None (hash-only)</span>'; })()}</td></tr>
<tr><td>Chain ID</td><td>${formatNetwork(chainId)}</td></tr>
<tr><td>Status</td><td>${renderStatusLabel(contract.status, effectiveStatus)}</td></tr>
<tr><td>Created</td><td>${formatDate(Number(contract.createdAt))} UTC</td></tr>
</table>

${renderScbSection(contract)}

<h3>Signatories &amp; Signatures</h3>
<table class="appendix-table">
<tr><th>#</th><th>Address</th><th>Signature</th></tr>
${(() => {
	// on-chain signatures[] is append-only in sign-order (not slot-per-signatory),
	// and the SIGNED event is pushed immediately before the signature — so the
	// k-th SIGNED event's actor owns signatures[k].
	const signedOrder = events.filter((e) => e.eventType === 10).map((e) => e.actor.toLowerCase());
	const sigByAddr: Record<string, string> = {};
	for (let k = 0; k < signedOrder.length; k++) sigByAddr[signedOrder[k]] = contract.signatures[k];
	return contract.signatories.map((addr, i) => `
<tr>
<td>${i + 1}</td>
<td>${linkAddress(addr, chainId)}</td>
<td class="mono">${sigByAddr[addr.toLowerCase()] || 'Pending'}</td>
</tr>`).join('');
})()}
</table>

<h3>Legal References</h3>
<table class="appendix-table">
<tr><th>Title</th><th>Document type</th><th>Cat/Doc/Ver</th><th>Registry</th><th>Arweave</th><th>Content Hash</th><th>Chain</th></tr>
${(() => {
	const partLines = referencePartLines(contractContent, referenceRows, contractRegistryAddress);
	let lastRelation = '';
	return referenceRows.map((row, i) => {
	const r = row.reference;
	const relation = RELATION_LABELS[r.relationType] ?? String(r.relationType);
	const isContractRegistry = r.registryAddress.toLowerCase() === contractRegistryAddress.toLowerCase();
	const isDaaRegistry = r.registryAddress.toLowerCase() === daaRegistryAddress.toLowerCase();
	const externalTag = isDaaRegistry
		? ''
		: isContractRegistry
			? ' <em>(Contract Registry)</em>'
			: ' <em>(External)</em>';
	const refChainId = Number(r.chainId);
	const registryCell = `<td>${linkAddress(r.registryAddress, refChainId)}${externalTag}</td>`;
	const chainCell = `<td>${formatNetwork(refChainId)}</td>`;
	// A relation header opens each run of references with the same relation.
	const header = relation === lastRelation ? '' : `\n<tr class="ref-relation"><th colspan="7">${escapeHtml(relation)}</th></tr>`;
	lastRelation = relation;
	// The header names the relation, so the part line keeps only part and title.
	const partLine = partLines[i].replace(/^((?:Part [IVXLCDM]+ — )?)[^:]+: /, '$1');
	const versionRows = isContractRegistry
		? `<tr><td>Contract #${r.documentId.toString()}</td><td></td><td></td>${registryCell}<td></td><td></td>${chainCell}</tr>`
		: row.versions.length === 0
			? `<tr><td></td><td></td><td>${r.categoryId}/${r.documentId}/${r.version}</td>${registryCell}<td></td><td></td>${chainCell}</tr>`
			: row.versions.map((v, n) => `<tr>
<td${n > 0 ? ' class="ref-change"' : ''}>${escapeHtml(v.title)}</td>
<td>${docTypeLabel(v.docType)}</td>
<td>${r.categoryId}/${r.documentId}/${v.version}</td>
${registryCell}
<td>${linkArweave(v.contentUri)}</td>
<td class="mono">${v.contentHash}</td>
${chainCell}
</tr>`).join('');
	return `${header}
<tr><td colspan="7"><strong>${escapeHtml(partLine)}</strong></td></tr>
${versionRows}`;
	}).join('');
})()}
</table>

<h3>Lifecycle Timeline</h3>
<div class="timeline">
${events.map((e) => `
<div class="timeline-entry">
<strong>${eventLabel(e.eventType)}</strong> by ${linkAddress(e.actor, chainId)}<br>
<span class="timestamp">${formatDate(Number(e.timestamp))} UTC</span>
${e.reasonHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? `<br>Reason: <span class="mono">${e.reasonHash}</span>` : ''}
</div>`).join('')}
</div>

</div>

</body>
</html>`;
}


/**
 * Render stored contract markdown through the same `marked` + `DOMPurify` pipeline
 * used everywhere else in the app. DOMPurify strips any embedded scripts or event
 * handlers so body text can't inject behaviour into the page or print frame.
 */
export function renderContractHtml(md: string): string {
	return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const DOCTYPE_LABELS: Record<number, string> = {
	0: 'Original',
	1: 'Amendment',
	2: 'Revision',
	3: 'Repeal',
	4: 'Codification'
};

function docTypeLabel(t: number): string {
	return DOCTYPE_LABELS[t] ?? `Type ${t}`;
}

/**
 * Status label for the printed record. Uses the read-time effectiveStatus so a
 * ripened-but-unfinalized proposal shows its logical outcome, marked "(pending
 * finalization)" until a finalize tx brings the stored status into line.
 */
function renderStatusLabel(storedStatus: number, effectiveStatus: number): string {
	if (effectiveStatus !== storedStatus && (effectiveStatus === 4 || effectiveStatus === 5)) {
		return `${StatusLabels[effectiveStatus] ?? 'Unknown'} (pending finalization)`;
	}
	if (effectiveStatus === 3) return 'Expired';
	return StatusLabels[effectiveStatus] ?? 'Unknown';
}

function linkAddress(address: string, chainId: number): string {
	const url = explorerAddressUrl(chainId, address);
	if (!url) return `<span class="mono">${address}</span>`;
	return `<a class="mono" href="${url}" target="_blank" rel="noopener">${address}</a>`;
}

/**
 * Explorer link routed via the chain's own block explorer (not etherscan when the chain isn't Ethereum).
 * Used by the SCB row so cross-chain references resolve to the correct explorer.
 */
function linkAddressOnChain(address: string, chainId: number): string {
	const explorer = chainIdToExplorer(chainId);
	if (!explorer) return `<span class="mono">${address}</span>`;
	return `<a class="mono" href="${explorer}/address/${address}" target="_blank" rel="noopener">${address}</a>`;
}

function renderScbSection(contract: ContractRecord): string {
	if (contract.smartContractAddress === ZERO_ADDRESS) return '';
	const scChainId = Number(contract.smartContractChainId);
	return `<h3>Associated Smart Contract</h3>
<table class="appendix-table">
<tr><th>Field</th><th>Value</th></tr>
<tr><td>Address</td><td>${linkAddressOnChain(contract.smartContractAddress, scChainId)}</td></tr>
<tr><td>Network</td><td>${formatNetwork(scChainId)}</td></tr>
<tr><td>Bytecode Hash</td><td class="mono">${contract.bytecodeHash}</td></tr>
</table>`;
}

function linkArweave(txId: string): string {
	if (!txId || txId === '—') return '<span class="mono">—</span>';
	return `<a class="mono" href="${arweaveUrl(txId)}" target="_blank" rel="noopener">${txId}</a>`;
}

const EVENT_LABELS: Record<number, string> = {
	0: 'Created',
	10: 'Signed',
	11: 'Declined',
	12: 'Activated',
	20: 'Termination proposed',
	21: 'Terminated',
	22: 'Termination cancelled',
	23: 'Termination accepted',
	24: 'Termination rejected',
	30: 'Completion proposed',
	31: 'Completed',
	32: 'Completion cancelled',
	33: 'Completion accepted',
	34: 'Completion rejected',
	40: 'Disputed',
	50: 'Amended'
};

function eventLabel(eventType: number): string {
	return EVENT_LABELS[eventType] ?? `Event ${eventType}`;
}
