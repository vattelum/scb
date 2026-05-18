<script lang="ts">
	import type { TemplateVariable } from '$lib/services/template-variables';

	export interface TargetSectionInfo {
		number: string;
		title: string;
		content: string;
		depth: 1 | 2 | 3;
	}

	interface Props {
		availableTargetSections: TargetSectionInfo[];
		selectedTargetSections: string[];
		newSectionsOnly: boolean;
		loadingTargetDoc: boolean;
		targetDocError: string;
		lockedSections: number[];
		isAmendmentMode: boolean;
		isRepealMode: boolean;
		targetDocVariables: TemplateVariable[];
		onToggleSection: (sectionNumber: string) => void;
		onNewSectionsOnlyChange: (value: boolean) => void;
	}

	let {
		availableTargetSections,
		selectedTargetSections = $bindable(),
		newSectionsOnly = $bindable(),
		loadingTargetDoc,
		targetDocError,
		lockedSections,
		isAmendmentMode,
		isRepealMode,
		targetDocVariables,
		onToggleSection,
		onNewSectionsOnlyChange
	}: Props = $props();

	function isImplicitlySelected(sectionNumber: string): boolean {
		return selectedTargetSections.some((sel) => {
			if (sel === sectionNumber) return false;
			return sectionNumber.startsWith(sel + '.');
		});
	}

	function isSectionLocked(sectionNumber: string): boolean {
		if (lockedSections.length === 0) return false;
		if (lockedSections.includes(0)) return true; // sentinel: entire document locked
		const topLevel = parseInt(sectionNumber.split('.')[0], 10);
		return lockedSections.includes(topLevel);
	}

	function sortedSelected(): string[] {
		const order = availableTargetSections.map((s) => s.number);
		return [...selectedTargetSections].sort((a, b) => order.indexOf(a) - order.indexOf(b));
	}
</script>

<!-- Section picker (Amendment + Repeal only) -->
<div>
	<label class="block text-sm text-text-secondary mb-1">
		Target sections <span class="text-text-muted">(select specific sections, or leave all unselected for whole document)</span>
	</label>
	{#if loadingTargetDoc}
		<p class="text-text-muted text-sm">Loading document sections...</p>
	{:else if targetDocError}
		<p class="text-text-muted text-sm">{targetDocError}</p>
	{:else if availableTargetSections.length > 0}
		<div class="flex flex-col gap-1 max-h-48 overflow-y-auto border border-border rounded p-2 {newSectionsOnly ? 'opacity-40 pointer-events-none' : ''}">
			{#each availableTargetSections as sec}
				{@const explicit = !newSectionsOnly && selectedTargetSections.includes(sec.number)}
				{@const implicit = !newSectionsOnly && isImplicitlySelected(sec.number)}
				{@const locked = isSectionLocked(sec.number)}
				<button
					type="button"
					onclick={() => onToggleSection(sec.number)}
					disabled={newSectionsOnly}
					class="text-left rounded text-sm transition-colors cursor-pointer
						{explicit ? 'bg-primary/20 border border-primary/40' : implicit ? 'bg-primary/10 border border-primary/20 opacity-60' : 'hover:bg-bg-lighter border border-transparent'}"
					style="padding: 6px 12px 6px {12 + (sec.depth - 1) * 16}px"
				>
					<span class="font-mono text-text-muted mr-2">§{sec.number}</span>
					{sec.title}
					{#if implicit}<span class="text-xs text-text-muted ml-1">(included)</span>{/if}
					{#if locked}<span class="text-xs text-error ml-1">(locked)</span>{/if}
				</button>
			{/each}
		</div>
		{#if newSectionsOnly}
			<p class="text-xs text-text-muted mt-1">
				Adding new sections only. Use the editor to add clauses.
			</p>
		{:else if selectedTargetSections.length > 0}
			<p class="text-xs text-text-muted mt-1">
				Targeting {sortedSelected().map(s => '§' + s).join(', ')}{sortedSelected().some(s => availableTargetSections.some(t => t.number.startsWith(s + '.'))) ? ' (and all subsections)' : ''}{isRepealMode ? '' : ' — editor loaded with selected sections.'}
			</p>
		{:else}
			<p class="text-xs text-text-muted mt-1">
				All sections loaded. Select specific sections to narrow the scope.
			</p>
		{/if}
		{#if isAmendmentMode}
			<label class="flex items-center gap-2 cursor-pointer mt-2">
				<input
					type="checkbox"
					checked={newSectionsOnly}
					onchange={(e) => onNewSectionsOnlyChange((e.target as HTMLInputElement).checked)}
					class="accent-primary"
				/>
				<span class="text-sm text-text-secondary">Add new section instead</span>
			</label>
		{/if}
	{/if}
</div>

{#if targetDocVariables.length > 0}
	<details class="border border-border rounded p-3 mt-2">
		<summary class="text-xs text-text-muted cursor-pointer hover:text-text-secondary">Template Variables ({targetDocVariables.length})</summary>
		<div class="mt-2 flex flex-col gap-1">
			{#each targetDocVariables as v}
				<div class="text-xs flex items-center gap-2">
					<span class="font-mono text-text-secondary">{v.name}</span>
					<span class="text-text-muted">{v.type}</span>
					{#if v.required}<span class="text-primary">required</span>{/if}
				</div>
			{/each}
		</div>
	</details>
{/if}
