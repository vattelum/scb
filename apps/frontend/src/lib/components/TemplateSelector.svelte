<script lang="ts">
	import type { DocumentInfo } from '$lib/services/registry';

	let {
		templates,
		selectedDocumentId,
		loading,
		onselect
	}: {
		templates: DocumentInfo[];
		selectedDocumentId: number | null;
		loading: boolean;
		onselect: (t: DocumentInfo) => void;
	} = $props();
</script>

<div>
	<label class="block text-sm text-text-secondary mb-1">Contract Template</label>
	{#if loading}
		<p class="text-text-muted text-sm">Loading templates...</p>
	{:else if templates.length === 0}
		<p class="text-text-muted text-sm">No templates available in the registry.</p>
	{:else}
		<div
			class="flex flex-col gap-1 {templates.length > 10 ? 'max-h-80 overflow-y-auto border border-border rounded p-1' : ''}"
		>
			{#each templates as tpl}
				<button
					onclick={() => onselect(tpl)}
					class="text-left p-3 rounded border transition-colors cursor-pointer {selectedDocumentId === tpl.documentId ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface-hover'}"
				>
					<span class="text-sm">{tpl.latestTitle}</span>
				</button>
			{/each}
		</div>
		{#if templates.length > 10}
			<p class="text-[11px] text-text-muted mt-1">{templates.length} templates — scroll to see more.</p>
		{/if}
	{/if}
</div>
