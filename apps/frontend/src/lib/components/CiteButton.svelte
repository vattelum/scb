<script lang="ts">
	import { formatCitation } from '@vattelum/document-registry-js';
	import { chainIdToLabel } from '$lib/constants/networks';

	let {
		title,
		version,
		contentHash,
		timestamp,
		registryAddress,
		chainId,
		categoryName,
		targetSection = ''
	}: {
		title: string;
		version: number;
		contentHash: string;
		timestamp: number;
		registryAddress: string;
		chainId: number;
		categoryName: string;
		targetSection?: string;
	} = $props();

	let label = $state('Cite');

	async function copyCitation() {
		const ref = {
			registryAddress,
			chainId: BigInt(chainId),
			categoryId: 0n,
			documentId: 0n,
			version: BigInt(version),
			relationType: 0,
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
		const citation = formatCitation(ref, doc, {
			categoryName,
			networkName: chainIdToLabel(chainId)
		});
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
