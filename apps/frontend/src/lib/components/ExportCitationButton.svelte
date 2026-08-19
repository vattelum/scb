<script lang="ts">
	import { RELATION_REFERENCES } from '@vattelum/document-registry-js';
	import { chainIdToLabel } from '$lib/constants/networks';
	import { downloadCitationJson } from '$lib/services/exportCitation';

	let {
		title,
		version,
		contentHash,
		contentUri,
		timestamp,
		registryAddress,
		chainId,
		categoryId,
		documentId,
		categoryName
	}: {
		title: string;
		version: number;
		contentHash: string;
		contentUri: string;
		timestamp: number;
		registryAddress: string;
		chainId: number;
		categoryId: number;
		documentId: number;
		categoryName: string;
	} = $props();

	function exportJson() {
		const ref = {
			registryAddress,
			chainId: BigInt(chainId),
			categoryId: BigInt(categoryId),
			documentId: BigInt(documentId),
			version: BigInt(version),
			relationType: RELATION_REFERENCES,
			targetSection: ''
		};
		const doc = {
			contentUri,
			contentHash,
			title,
			version: BigInt(version),
			timestamp: BigInt(timestamp),
			voteId: '',
			docType: 0
		};
		downloadCitationJson(ref, doc, categoryName, chainIdToLabel(chainId));
	}
</script>

<button
	onclick={exportJson}
	title="Download the JSON citation envelope for this document version"
	class="text-xs px-3 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
>
	Export JSON
</button>
