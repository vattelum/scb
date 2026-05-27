<script lang="ts">
	import type { DocumentInfo } from '$lib/services/registry';
	import Tooltip from '$lib/components/Tooltip.svelte';

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
	<label class="block text-sm text-text-secondary mb-1">Contract Template <Tooltip text={"Templates load from the DAARegistry category. These are set in your frontend .env file, by adding the value here: VITE_CONTRACT_TEMPLATE_CATEGORY_ID=[YOUR TEMPLATE CATEGORY NUMBER]. Category ids are assigned in creation by the deploy script (01_Deploy.s.sol logs \"Contract Templates = 3\").\n\nIf your template does not show up here, it could be that the wrong category number is added.\n\nTip: the /home page lists all categories of your registry in order. Find the category which holds your templates, and count its position starting from 0 (the first category is 0). That is the number you must fill in to seed your templates here."} align="left"><span class="text-text-muted cursor-help">(?)</span></Tooltip></label>
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
