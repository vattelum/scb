<script lang="ts">
	import { docTypeLabel, allowsMultipleReferences, requiresReferences } from '$lib/constants/docTypes';
	import { strategyLabel } from '$lib/services/snapshot-x';
	import { formatCountdown } from '$lib/services/format';
	import type { DocumentInfo } from '$lib/services/registry';

	interface VersionInfo {
		version: number;
		title: string;
		docType: number;
	}

	interface RefSelection {
		documentId: number;
		version: number;
	}

	interface Props {
		docType: number;
		categoryId: number;
		categoryDocuments: DocumentInfo[];
		documentId: number;
		documentVersions: VersionInfo[];
		selectedRefs: RefSelection[];
		loadingDocuments: boolean;
		loadingVersions: boolean;
		loadingRestrictions: boolean;
		lockedSections: number[];
		withinInterval: boolean;
		nextWindowTime: number;
		coreStrategyAddress: `0x${string}`;
		onDocumentSelect: (docId: number) => void;
		onToggleRef: (ref: RefSelection) => void;
	}

	let {
		docType,
		categoryId,
		categoryDocuments,
		documentId,
		documentVersions,
		selectedRefs,
		loadingDocuments,
		loadingVersions,
		loadingRestrictions,
		lockedSections,
		withinInterval,
		nextWindowTime,
		coreStrategyAddress,
		onDocumentSelect,
		onToggleRef
	}: Props = $props();

	function isRefSelected(docId: number, version: number): boolean {
		return selectedRefs.some((r) => r.documentId === docId && r.version === version);
	}
</script>

{#if requiresReferences(docType)}
	<!-- Document selector -->
	{#if !allowsMultipleReferences(docType)}
		<div>
			<label class="block text-sm text-text-secondary mb-1">
				Select document to {docTypeLabel(docType).toLowerCase()}
			</label>
			{#if categoryId < 0}
				<p class="text-text-muted text-sm">Select a category first.</p>
			{:else if loadingDocuments}
				<p class="text-text-muted text-sm">Loading documents...</p>
			{:else if categoryDocuments.length === 0}
				<p class="text-text-muted text-sm">No documents in this category.</p>
			{:else}
				<div class="flex flex-col gap-1 max-h-48 overflow-y-auto border border-border rounded p-2">
					{#each categoryDocuments as cdoc}
						<button
							type="button"
							onclick={() => onDocumentSelect(cdoc.documentId)}
							class="text-left px-3 py-1.5 rounded text-sm transition-colors cursor-pointer
								{documentId === cdoc.documentId ? 'bg-primary/20 border border-primary/40' : 'hover:bg-bg-lighter border border-transparent'}"
						>
							<span class="font-mono text-text-muted mr-2">{cdoc.documentId}.</span>
							{cdoc.latestTitle}
							<span class="text-xs text-text-muted ml-1">({cdoc.versionCount} {cdoc.versionCount === 1 ? 'version' : 'versions'})</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Amendment restrictions info -->
	{#if documentId > 0 && !loadingRestrictions && lockedSections.length > 0}
		<div class="border border-border rounded p-3">
			<p class="text-text-secondary text-sm">
				Locked sections: {lockedSections.includes(0) ? 'All' : lockedSections.map(s => '§' + s).join(', ')}
				<span class="text-text-muted"> — proposals targeting these sections require {strategyLabel(coreStrategyAddress)} approval.</span>
			</p>
			{#if withinInterval}
				<p class="text-cat-gold text-sm mt-1">Amendment interval active — locked sections require {strategyLabel(coreStrategyAddress)} until <span class="font-mono">{formatCountdown(nextWindowTime)}</span>.</p>
			{/if}
		</div>
	{/if}

	<!-- Version selector -->
	{#if (documentId > 0 && !allowsMultipleReferences(docType)) || allowsMultipleReferences(docType)}
		<div>
			<label class="block text-sm text-text-secondary mb-1">
				{allowsMultipleReferences(docType) ? 'Select versions to consolidate' : 'Select version'}
			</label>
			{#if loadingVersions}
				<p class="text-text-muted text-sm">Loading versions...</p>
			{:else if !allowsMultipleReferences(docType) && documentVersions.length === 0}
				<p class="text-text-muted text-sm">No versions found.</p>
			{:else if allowsMultipleReferences(docType) && categoryDocuments.length === 0}
				<p class="text-text-muted text-sm">Select a category first.</p>
			{:else}
				<div class="flex flex-col gap-1 max-h-48 overflow-y-auto border border-border rounded p-2">
					{#if allowsMultipleReferences(docType)}
						{#each categoryDocuments as cdoc}
							<button
								type="button"
								onclick={() => onToggleRef({ documentId: cdoc.documentId, version: 1 })}
								class="text-left px-3 py-1.5 rounded text-sm transition-colors cursor-pointer
									{isRefSelected(cdoc.documentId, 1) ? 'bg-primary/20 border border-primary/40' : 'hover:bg-bg-lighter border border-transparent'}"
							>
								<span class="font-mono text-text-muted mr-2">{cdoc.documentId}.</span>
								{cdoc.latestTitle}
							</button>
						{/each}
					{:else}
						{#each documentVersions as ver}
							<button
								type="button"
								onclick={() => onToggleRef({ documentId, version: ver.version })}
								class="text-left px-3 py-1.5 rounded text-sm transition-colors cursor-pointer
									{isRefSelected(documentId, ver.version) ? 'bg-primary/20 border border-primary/40' : 'hover:bg-bg-lighter border border-transparent'}"
							>
								<span class="font-mono text-text-muted mr-2">v{ver.version}</span>
								{ver.title}
								<span class="text-xs px-1.5 py-0.5 rounded bg-bg-lighter text-text-muted ml-1">{docTypeLabel(ver.docType)}</span>
							</button>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{/if}
