<script lang="ts">
	import { formatCitation, RELATION_REFERENCES } from '@vattelum/document-registry-js';
	import { chainIdToLabel } from '#lib/constants/networks.ts';
	import { inForceCitation } from '#lib/services/exportCitation.ts';

	let {
		title,
		version,
		contentHash,
		timestamp,
		registryAddress,
		chainId,
		categoryId,
		documentId,
		categoryName,
		targetSection = '',
		resolvedAsOf
	}: {
		title: string;
		version: number;
		contentHash: string;
		timestamp: number;
		registryAddress: string;
		chainId: number;
		categoryId: number;
		documentId: number;
		categoryName: string;
		targetSection?: string;
		/** Cite the text in force at this cutoff rather than the version alone. */
		resolvedAsOf?: bigint;
	} = $props();

	let label = $state('Cite');

	async function copyCitation() {
		const ref = {
			registryAddress,
			chainId: BigInt(chainId),
			categoryId: BigInt(categoryId),
			documentId: BigInt(documentId),
			version: BigInt(version),
			relationType: RELATION_REFERENCES,
			targetSection
		};
		const doc = {
			contentUri: '',
			contentHash,
			title,
			version: BigInt(version),
			timestamp: BigInt(timestamp),
			voteId: '',
			docType: 0
		};
		const base = formatCitation(ref, doc, {
			categoryName,
			networkName: chainIdToLabel(chainId)
		});
		const citation = resolvedAsOf === undefined ? base : inForceCitation(base, resolvedAsOf);
		try {
			await navigator.clipboard.writeText(citation);
			label = 'Copied';
			setTimeout(() => (label = 'Cite'), 2000);
		} catch {
			label = 'Failed';
			setTimeout(() => (label = 'Cite'), 2000);
		}
	}
</script>

<button
	onclick={copyCitation}
	title="Copy the canonical citation for this document version"
	class="text-xs px-3 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
>
	{label}
</button>
