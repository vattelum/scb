<script lang="ts">
	import { resolveLegislation, type ResolvedLegislation } from '#lib/services/legislation-resolver.ts';
	import type { DocumentReference } from '#lib/services/contract-registry.ts';
	import { truncAddr } from '#lib/services/format.ts';
	import { RELATION_LABELS } from '#lib/constants/docTypes.ts';

	let {
		reference,
		asOf,
		compact = false
	}: {
		reference: DocumentReference;
		asOf: bigint;
		compact?: boolean;
	} = $props();

	let expanded = $state(false);
	let loading = $state(false);
	let loadError = $state('');
	let resolved = $state<ResolvedLegislation | null>(null);

	async function toggle() {
		if (expanded) {
			expanded = false;
			return;
		}
		expanded = true;
		if (resolved || loading) return;
		loading = true;
		loadError = '';
		try {
			resolved = await resolveLegislation(
				{
					registryAddress: reference.registryAddress,
					categoryId: reference.categoryId,
					documentId: reference.documentId,
					version: reference.version
				},
				asOf
			);
		} catch (e: any) {
			loadError = e?.message ?? 'Failed to load legislation';
		} finally {
			loading = false;
		}
	}

	function statusLabel(s: string): string {
		if (s === 'InForce') return 'In Force';
		if (s === 'PartiallyAmended') return 'Partially Amended';
		return s;
	}

	function statusClass(s: string): string {
		if (s === 'InForce') return 'text-green-400';
		if (s === 'PartiallyAmended') return 'text-amber-400';
		return 'text-text-muted';
	}
</script>

<div class="border border-border rounded bg-surface/50">
	<button
		onclick={toggle}
		class="w-full text-left p-2 flex items-center justify-between gap-2 hover:bg-surface transition-colors cursor-pointer"
	>
		<div class="flex flex-col gap-0.5 min-w-0">
			<div class="text-xs text-text-secondary truncate">
				{resolved?.title ?? `Cat ${reference.categoryId.toString()} / Doc ${reference.documentId.toString()}`}
			</div>
			<div class="text-[11px] text-text-muted flex items-center gap-2 flex-wrap">
				<span>{RELATION_LABELS[reference.relationType] ?? `Relation ${reference.relationType}`}</span>
				<span class="font-mono">{truncAddr(reference.registryAddress)}</span>
				<span>Cat {reference.categoryId.toString()} / Doc {reference.documentId.toString()} v{reference.version.toString()}</span>
				{#if resolved}
					<span class={statusClass(resolved.status)}>{statusLabel(resolved.status)}</span>
				{/if}
			</div>
		</div>
		<span class="text-text-muted text-xs shrink-0">{expanded ? '▾' : '▸'}</span>
	</button>
	{#if expanded}
		<div class="border-t border-border p-3">
			{#if loading}
				<p class="text-xs text-text-muted">Loading consolidated text…</p>
			{:else if loadError}
				<p class="text-xs text-red-400">{loadError}</p>
			{:else if resolved}
				{#if resolved.status === 'Repealed'}
					<p class="text-xs text-text-muted">This lineage was wholly repealed before this contract was created.</p>
				{:else if !resolved.consolidatedBody}
					<p class="text-xs text-text-muted">(Empty body)</p>
				{:else}
					<div class="prose prose-sm max-w-none text-text text-xs whitespace-pre-wrap" class:max-h-64={compact} class:overflow-y-auto={compact}>{resolved.consolidatedBody}</div>
					{#if resolved.components.length > 1}
						<div class="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
							<span>Consolidated from {resolved.components.length} source versions.</span>
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</div>
