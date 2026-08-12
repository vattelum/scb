import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ContractRecord, LifecycleEvent, DocumentReference } from '$lib/services/contract-registry';
import { StatusLabels } from '$lib/services/contract-registry';
import { arweaveUrl } from '$lib/services/arweave';
import { stripFrontmatter, extractRevisionMeta, formatDate } from '$lib/services/format';
import { daaRegistryAddress } from '$lib/contracts';
import { chainIdToExplorer, explorerAddressUrl, formatNetwork } from '$lib/constants/networks';
import { RELATION_LABELS } from '$lib/constants/docTypes';
import {
	RELATION_AMENDS,
	RELATION_REVISES,
	RELATION_GOVERNS,
	RELATION_IMPLEMENTS,
	RELATION_REFERENCES,
	RELATION_TEMPLATE
} from '@vattelum/document-registry-js';
import {
	resolveLegislation,
	type ComponentVersion,
	type LegislationStatus
} from '$lib/services/legislation-resolver';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * PDF assembly via window.print() with print CSS.
 * Order: HLC → elective modules → DAA-wide legislation → universal standards → verification appendix.
 */

interface LegislationDoc {
	title: string;
	content: string;
	relationType: number;
	registryAddress: string;
	categoryId: number;
	documentId: number;
	version: number;
	contentUri?: string;
	contentHash?: string;
	/** Populated by resolveLegislation for lineages with amendments/revisions in force at createdAt. */
	components?: ComponentVersion[];
	status?: LegislationStatus;
}

export interface PrintOptions {
	includeAdoptedModules: boolean;
	includeGoverningLaws: boolean;
}

interface AssemblyParams {
	contractId: bigint;
	contract: ContractRecord;
	contractContent: string;
	templateName: string;
	legislation: LegislationDoc[];
	events: LifecycleEvent[];
	contractRegistryAddress: string;
	chainId: number;
	/** Logical status at print time (effectiveStatus view) — may differ from the
	 *  stored contract.status when a proposal has ripened or signing has expired. */
	effectiveStatus: number;
	options?: PrintOptions;
	/**
	 * When set, the printed document is a revision: title block adds a
	 * "Revises Contract #N (signed DD Mon YYYY)" line. The on-chain REVISES
	 * relation lives in `contract.references[]` and is rendered in the
	 * Legal References table separately.
	 */
	revisionSource?: { contractId: bigint; createdAt: bigint };
	/**
	 * When true, prepends "DRAFT — " to the title and appends " (DRAFT)" to
	 * the printed-on line. Caller is responsible for deciding what counts as
	 * a draft (typically: not all signatures collected yet).
	 */
	draft?: boolean;
}

/**
 * Fetch legislation for all references, resolving each to its consolidated
 * form as it stood when the contract was created (`asOf`). In-force amendments
 * and partial repeals are merged in before return; the printed body is always
 * the consolidated text.
 */
export async function fetchLegislation(
	references: readonly DocumentReference[],
	asOf: bigint
): Promise<LegislationDoc[]> {
	const legislation: LegislationDoc[] = [];
	for (const ref of references) {
		try {
			const resolved = await resolveLegislation(
				{
					registryAddress: ref.registryAddress,
					categoryId: ref.categoryId,
					documentId: ref.documentId,
					version: ref.version
				},
				asOf
			);
			const genesis = resolved.components[0];
			legislation.push({
				title: resolved.title || `Document ${ref.categoryId}/${ref.documentId} v${ref.version}`,
				content: resolved.consolidatedBody,
				relationType: ref.relationType,
				registryAddress: ref.registryAddress,
				categoryId: Number(ref.categoryId),
				documentId: Number(ref.documentId),
				version: Number(ref.version),
				contentUri: genesis?.contentUri,
				contentHash: genesis?.contentHash,
				components: resolved.components,
				status: resolved.status
			});
		} catch {
			legislation.push({
				title: `Document ${ref.categoryId}/${ref.documentId} v${ref.version}`,
				content: '(Failed to fetch legislation content)',
				relationType: ref.relationType,
				registryAddress: ref.registryAddress,
				categoryId: Number(ref.categoryId),
				documentId: Number(ref.documentId),
				version: Number(ref.version)
			});
		}
	}
	return legislation;
}

export function assembleAndPrint(params: AssemblyParams): void {
	const html = assembleHtml(params);
	const win = window.open('', '_blank');
	if (!win) return;

	win.document.write(html);
	win.document.close();
	win.onload = () => win.print();
}

function assembleHtml(params: AssemblyParams): string {
	const {
		contractId,
		contract,
		templateName,
		legislation,
		events,
		contractRegistryAddress,
		chainId,
		effectiveStatus,
		revisionSource,
		draft
	} = params;

	// Lift revision metadata out of the body so the reason can be presented as
	// title-block context. The HTML comments would be stripped by marked +
	// DOMPurify anyway, but stripping at the source guarantees the rendered
	// body matches what we intend regardless of pipeline.
	const { reason: revisionReason, body: contractContent } = extractRevisionMeta(params.contractContent);

	const options: PrintOptions = params.options ?? {
		includeAdoptedModules: true,
		includeGoverningLaws: true
	};

	// Body sections: GOVERNS (4) and IMPLEMENTS (5) only. REFERENCES (6) live exclusively in the appendix's Legal References table.
	const governs = legislation.filter((l) => l.relationType === RELATION_GOVERNS);
	const implements_ = legislation.filter((l) => l.relationType === RELATION_IMPLEMENTS);

	function renderLawSectionFull(heading: string, docs: LegislationDoc[]): string {
		if (docs.length === 0) return '';
		const body = docs
			.map((l) => {
				const components = l.components ?? [];
				const consolidationNote =
					components.length > 1
						? `<p class="ref-line"><em>Consolidated from multiple source versions (${components
								.map((c) => `${l.categoryId}/${l.documentId}/${c.version}`)
								.join(', ')}). The Legal References lists each.</em></p>`
						: '';
				return `<div class="law-entry"><h3>${escapeHtml(l.title)}</h3><div>${formatMarkdown(l.content)}</div>${consolidationNote}</div>`;
			})
			.join('');
		return `<div class="section"><h2>${heading}</h2>${body}</div>`;
	}

	function renderLawSectionCollapsed(heading: string, docs: LegislationDoc[]): string {
		if (docs.length === 0) return '';
		const body = docs
			.map((l) => {
				const arweaveRow = l.contentUri
					? `<tr><th>Source</th><td>${linkArweave(l.contentUri)}</td></tr>`
					: '';
				const hashRow = l.contentHash
					? `<tr><th>Hash</th><td class="mono">${l.contentHash}</td></tr>`
					: '';
				return `
<div class="law-entry law-ref-only">
	<h3>${escapeHtml(l.title)}</h3>
	<table class="ref-table">
		<tr><th>Registry</th><td>${linkAddress(l.registryAddress, chainId)}</td></tr>
		<tr><th>Cat/Doc/Ver</th><td>${l.categoryId}/${l.documentId}/${l.version}</td></tr>
		${arweaveRow}
		${hashRow}
	</table>
</div>`;
			})
			.join('');
		return `<div class="section"><h2>${heading}</h2>${body}</div>`;
	}

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
    .subline { margin: 0 0 0.2em 0; font-size: 11pt; }
    .printed { margin: 0 0 1.5em 0; font-size: 10pt; color: #333; }
    .page-break { page-break-before: always; }
    .section { margin-top: 2em; border-top: 2px solid #000; padding-top: 1em; }
    .section h2 { page-break-after: avoid; }
    .law-entry { margin-bottom: 1.5em; }
    .law-entry > h3 { page-break-after: avoid; margin-bottom: 0.3em; }
    .law-entry > div h3 { margin-top: 0.4em; }
    .ref-line { font-size: 10pt; color: #333; margin: 0.3em 0 0 0; }
    .ref-table { font-size: 10pt; color: #333; margin: 0.3em 0 0 0; border-collapse: collapse; }
    .ref-table th { text-align: left; font-weight: normal; color: #555; padding: 0 0.8em 0.15em 0; vertical-align: top; white-space: nowrap; }
    .ref-table td { padding: 0 0 0.15em 0; vertical-align: top; }
    .timeline-entry { page-break-inside: avoid; }
    .timeline-entry .timestamp { font-size: 9pt; color: #555; }
    .appendix-table { width: 100%; border-collapse: collapse; margin: 1em 0; }
    .appendix-table th, .appendix-table td { border: 1px solid #000; padding: 6px 8px; text-align: left; font-size: 10pt; }
    .appendix-table th { background: #f0f0f0; }
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
    .subline { margin: 0 0 0.2em 0; font-size: 14px; }
    .printed { margin: 0 0 1.5em 0; font-size: 12px; color: #555; }
    .appendix-table { width: 100%; border-collapse: collapse; margin: 1em 0; }
    .appendix-table th, .appendix-table td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
    .appendix-table th { background: #f5f5f5; }
    .mono { font-family: monospace; font-size: 12px; word-break: break-all; }
    a { color: #0066cc; text-decoration: underline; }
    a.mono { font-family: monospace; font-size: 12px; word-break: break-all; }
    code { font-family: monospace; font-size: 12px; background: #f0f0f0; padding: 1px 3px; border-radius: 2px; }
    ul { margin: 0.3em 0; padding-left: 1.5em; }
    li { margin: 0.15em 0; }
    .page-break { margin-top: 3em; border-top: 2px solid #000; padding-top: 1em; }
    .section { margin-top: 2.5em; border-top: 2px solid #000; padding-top: 1em; }
    .law-entry { margin-bottom: 1.5em; }
    .ref-line { font-size: 12px; color: #555; margin: 0.3em 0 0 0; }
    .ref-table { font-size: 12px; color: #555; margin: 0.3em 0 0 0; border-collapse: collapse; }
    .ref-table th { text-align: left; font-weight: normal; color: #777; padding: 0 0.8em 0.15em 0; vertical-align: top; white-space: nowrap; }
    .ref-table td { padding: 0 0 0.15em 0; vertical-align: top; }
    .timeline-entry { page-break-inside: avoid; }
    .timeline-entry .timestamp { font-size: 11px; color: #777; }
    .timeline-entry { margin: 0.5em 0; padding-left: 1em; border-left: 2px solid #ccc; }
  }
</style>
</head>
<body>

<h1>${draft ? 'UNSIGNED &mdash; ' : ''}${escapeHtml(templateName)}</h1>
<p class="subline">Contract #${contractId} &mdash; Registry: ${linkAddress(contractRegistryAddress, chainId)}</p>
${revisionSource ? `<p class="subline">On ${formatDate(Number(contract.createdAt))} UTC this contract revised Contract #${revisionSource.contractId.toString()}, signed ${formatDate(Number(revisionSource.createdAt))} UTC.${revisionReason ? ` The reason for this revision is: ${escapeHtml(revisionReason)}` : ''}</p>` : ''}
<p class="printed">Printed: ${formatDate(Math.floor(Date.now() / 1000))} UTC, status: ${renderStatusLabel(contract.status, effectiveStatus)}${draft ? ' (UNSIGNED)' : ''}</p>

<h2>Contract</h2>
<div>${formatMarkdown(contractContent)}</div>

${options.includeAdoptedModules ? renderLawSectionFull('Adopted Modules', implements_) : renderLawSectionCollapsed('Adopted Modules', implements_)}
${options.includeGoverningLaws ? renderLawSectionFull('Governing Laws', governs) : renderLawSectionCollapsed('Governing Laws', governs)}

<div class="page-break">
<h2>Verification Appendix</h2>

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
<tr><th>Title</th><th>Type</th><th>Version</th><th>Cat/Doc/Ver</th><th>Registry</th><th>Arweave</th><th>Chain</th></tr>
${[...contract.references].sort((a, b) => {
	// Precedence: GOVERNS → IMPLEMENTS → REFERENCES → TEMPLATE → REVISES/AMENDS.
	// Revision/amendment links to other contracts are listed last because
	// they're cross-document lifecycle relations, not part of this contract's
	// legal stack.
	const order: Record<number, number> = {
		[RELATION_GOVERNS]: 0,
		[RELATION_IMPLEMENTS]: 1,
		[RELATION_REFERENCES]: 2,
		[RELATION_TEMPLATE]: 3,
		[RELATION_REVISES]: 4,
		[RELATION_AMENDS]: 5
	};
	return (order[a.relationType] ?? a.relationType) - (order[b.relationType] ?? b.relationType);
}).flatMap((r) => {
	const isContractRegistry = r.registryAddress.toLowerCase() === contractRegistryAddress.toLowerCase();
	const isDaaRegistry = r.registryAddress.toLowerCase() === daaRegistryAddress.toLowerCase();
	const externalTag = isDaaRegistry
		? ''
		: isContractRegistry
			? ' <em>(Contract Registry)</em>'
			: ' <em>(External)</em>';
	const refChainId = Number(r.chainId);
	const chainCell = formatNetwork(refChainId);
	const relationLabel = RELATION_LABELS[r.relationType] ?? String(r.relationType);
	const registryCell = `${linkAddress(r.registryAddress, refChainId)}${externalTag}`;
	const resolved = legislation.find(
		(l) =>
			l.registryAddress.toLowerCase() === r.registryAddress.toLowerCase() &&
			BigInt(l.categoryId) === r.categoryId &&
			BigInt(l.documentId) === r.documentId
	);
	const components = [...(resolved?.components ?? [])].sort((a, b) => a.version - b.version);
	if (components.length === 0) {
		// Contract-to-contract revision/amendment refs use the same struct but
		// don't have a category or version — display as "Contract #N" instead
		// of "0/N/0" which is meaningless to the reader.
		const isContractRef =
			r.registryAddress.toLowerCase() === contractRegistryAddress.toLowerCase() &&
			(r.relationType === RELATION_AMENDS || r.relationType === RELATION_REVISES);
		const idCell = isContractRef
			? `Contract #${r.documentId.toString()}`
			: `${r.categoryId}/${r.documentId}/${r.version}`;
		return [`
<tr>
<td></td>
<td>${relationLabel}</td>
<td></td>
<td>${idCell}</td>
<td>${registryCell}</td>
<td></td>
<td>${chainCell}</td>
</tr>`];
	}
	return components.map((c) => `
<tr>
<td>${escapeHtml(c.title)}</td>
<td>${relationLabel}</td>
<td>${docTypeLabel(c.docType)}</td>
<td>${r.categoryId}/${r.documentId}/${c.version}</td>
<td>${registryCell}</td>
<td>${c.contentUri ? linkArweave(c.contentUri) : ''}</td>
<td>${chainCell}</td>
</tr>`);
}).join('')}
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
 * Render contract / law markdown to print-safe HTML via the same `marked` +
 * `DOMPurify` pipeline used everywhere else in the app. Headings are demoted
 * one level (`##` → `###`, etc.) so the body's section headings sit below the
 * print frame's `<h2> Contract` / `<h3> {law title}` headers without clashing.
 * DOMPurify strips any embedded scripts / event handlers so user-controlled
 * body text can't inject behaviour into the print window.
 */
function formatMarkdown(md: string): string {
	const stripped = stripFrontmatter(md);
	const demoted = stripped.replace(/^(#{1,5})(\s)/gm, '#$1$2');
	const html = marked.parse(demoted, { async: false }) as string;
	return DOMPurify.sanitize(html);
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
