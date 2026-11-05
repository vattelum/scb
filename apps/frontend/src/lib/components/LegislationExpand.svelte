<script lang="ts">
	import { resolveLegislation, type ResolvedLegislation } from '#lib/services/legislation-resolver.ts';
	import type { DocumentReference } from '#lib/services/contract-registry.ts';
	import { truncAddr, endOfDayUTC, formatDate } from '#lib/services/format.ts';
	import { RELATION_LABELS } from '#lib/constants/docTypes.ts';
	import CiteButton from '#lib/components/CiteButton.svelte';
	import ExportCitationButton from '#lib/components/ExportCitationButton.svelte';

	let {
		reference,
		asOf,
		compact = false,
		pickDate = false,
		categoryName = ''
	}: {
		reference: DocumentReference;
		/** Cutoff T. With `pickDate`, only the initial value; the reader picks the day. */
		asOf: bigint;
		compact?: boolean;
		/** In-force view: the reader picks a date, and the text comes with Cite, Export JSON and Copy. */
		pickDate?: boolean;
		categoryName?: string;
	} = $props();

	// In-force view: a picked day, resolved as of its last second, UTC.
	let pickedDate = $state(new Date().toISOString().slice(0, 10));
	let resolvedAsOf = $state<bigint | null>(null);
	let copyLabel = $state('Copy');

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
		await resolveAt(pickDate ? (endOfDayUTC(pickedDate) ?? asOf) : asOf);
	}

	async function resolveAt(cutoff: bigint) {
		loading = true;
		loadError = '';
		resolved = null;
		try {
			resolved = await resolveLegislation(
				{
					registryAddress: reference.registryAddress,
					categoryId: reference.categoryId,
					documentId: reference.documentId,
					version: reference.version,
					chainId: reference.chainId
				},
				cutoff
			);
			resolvedAsOf = cutoff;
		} catch (e: any) {
			loadError = e?.message ?? 'Failed to load legislation';
		} finally {
			loading = false;
		}
	}

	function showPickedDate() {
		const cutoff = endOfDayUTC(pickedDate);
		if (cutoff === null) {
			loadError = 'Pick a date.';
			return;
		}
		resolveAt(cutoff);
	}

	async function copyText() {
		if (!resolved) return;
		try {
			await navigator.clipboard.writeText(resolved.consolidatedBody);
			copyLabel = 'Copied';
		} catch {
			copyLabel = 'Failed';
		}
		setTimeout(() => (copyLabel = 'Copy'), 2000);
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
				<span>{pickDate ? 'Text in force' : (RELATION_LABELS[reference.relationType] ?? `Relation ${reference.relationType}`)}</span>
				<span class="font-mono">{truncAddr(reference.registryAddress)}</span>
				<span>Cat {reference.categoryId.toString()} / Doc {reference.documentId.toString()}{#if !pickDate} v{reference.version.toString()}{/if}</span>
				{#if resolved && !pickDate}
					<span class={statusClass(resolved.status)}>{statusLabel(resolved.status)}</span>
				{/if}
			</div>
		</div>
		<span class="text-text-muted text-xs shrink-0">{expanded ? '▾' : '▸'}</span>
	</button>
	{#if expanded}
		<div class="border-t border-border p-3">
			{#if pickDate}
				<div class="mb-3 flex items-center gap-2 text-xs text-text-muted">
					<label for="in-force-{reference.categoryId}-{reference.documentId}">In force at the end of (UTC)</label>
					<input
						id="in-force-{reference.categoryId}-{reference.documentId}"
						type="date"
						bind:value={pickedDate}
						class="bg-bg border border-border rounded px-2 py-0.5 text-text"
					/>
					<button
						onclick={showPickedDate}
						disabled={loading}
						class="px-3 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
					>
						Show
					</button>
				</div>
			{/if}
			{#if loading}
				<p class="text-xs text-text-muted">Loading consolidated text…</p>
			{:else if loadError}
				<p class="text-xs text-red-400">{loadError}</p>
			{:else if resolved}
				{#if resolved.status === 'Repealed'}
					<p class="text-xs text-text-muted">
						{pickDate && resolvedAsOf !== null
							? `This law was wholly repealed as of ${formatDate(resolvedAsOf)} UTC.`
							: 'This lineage was wholly repealed before this contract was created.'}
					</p>
				{:else if !resolved.consolidatedBody}
					<p class="text-xs text-text-muted">(Empty body)</p>
				{:else}
					<div class="prose prose-sm max-w-none text-text text-xs whitespace-pre-wrap" class:max-h-64={compact} class:overflow-y-auto={compact}>{resolved.consolidatedBody}</div>
					{#if resolved.components.length > 1}
						<div class="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
							<span>Consolidated from {resolved.components.length} source versions.</span>
						</div>
					{/if}
					{#if pickDate && resolvedAsOf !== null}
						{@const latest = resolved.components[resolved.components.length - 1]}
						{@const cutoff = resolvedAsOf}
						<div class="mt-2 pt-2 border-t border-border flex items-center justify-end gap-2">
							<CiteButton
								title={latest.title}
								version={latest.version}
								contentHash={latest.contentHash}
								timestamp={latest.timestamp}
								registryAddress={reference.registryAddress}
								chainId={Number(reference.chainId)}
								categoryId={Number(reference.categoryId)}
								documentId={Number(reference.documentId)}
								{categoryName}
								resolvedAsOf={cutoff}
							/>
							<ExportCitationButton
								title={latest.title}
								version={latest.version}
								contentHash={latest.contentHash}
								contentUri={latest.contentUri}
								timestamp={latest.timestamp}
								registryAddress={reference.registryAddress}
								chainId={Number(reference.chainId)}
								categoryId={Number(reference.categoryId)}
								documentId={Number(reference.documentId)}
								{categoryName}
								resolution={{ asOf: cutoff, text: resolved.consolidatedBody, versions: resolved.components }}
							/>
							<button
								onclick={copyText}
								class="text-xs px-3 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
							>
								{copyLabel}
							</button>
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</div>
