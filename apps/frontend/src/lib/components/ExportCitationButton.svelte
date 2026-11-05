<script lang="ts">
	import { RELATION_REFERENCES } from '@vattelum/document-registry-js';
	import { chainIdToLabel } from '#lib/constants/networks.ts';
	import {
		downloadCitationJson,
		downloadInForceJson,
		type InForceResolution
	} from '#lib/services/exportCitation.ts';

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
		categoryName,
		resolution
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
		/** Export the text in force at a cutoff instead of the version's citation envelope. */
		resolution?: InForceResolution;
	} = $props();

	function exportJson() {
		if (resolution) {
			downloadInForceJson(
				{ chainId: BigInt(chainId), registryAddress, categoryId: BigInt(categoryId), documentId: BigInt(documentId) },
				resolution
			);
			return;
		}
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
