<script lang="ts">
	import { tick } from 'svelte';
	import {
		type Section,
		createSection,
		computeSectionNumber,
		sectionsToMarkdown,
		renderSectionedMarkdown,
		collectAllNumbers,
		nextChildNumber,
		nextSiblingNumber,
		sortByFixedNumber
	} from '$lib/services/markdown';

	let {
		sections = $bindable<Section[]>([]),
		amendmentMode = false,
		originalSectionNumbers = [] as string[]
	}: {
		sections: Section[];
		amendmentMode?: boolean;
		originalSectionNumbers?: string[];
	} = $props();

	let preview = $state(false);
	let previewHtml = $state('');
	let activeTextarea: HTMLTextAreaElement | null = $state(null);
	let activeSectionIdx: number | null = $state(null);

	/** The minimum depth among selected sections — sibling add only allowed at this depth */
	function minSelectedDepth(): number {
		if (!amendmentMode || sections.length === 0) return 1;
		return Math.min(...sections.map(s => s.depth));
	}

	async function togglePreview() {
		if (!preview) {
			// No cache key — the editor body changes on every keystroke, so caching
			// the rendered HTML would be wrong. The shared helper handles the
			// marked + DOMPurify + section-wrap pipeline; we just skip the cache.
			previewHtml = await renderSectionedMarkdown(sectionsToMarkdown(sections));
		}
		preview = !preview;
	}

	/** Find the index after the last child/descendant of sections[index] */
	function endOfSubtree(index: number): number {
		const depth = sections[index].depth;
		let end = index + 1;
		while (end < sections.length && sections[end].depth > depth) {
			end++;
		}
		return end;
	}

	function addSibling(index: number) {
		if (amendmentMode) {
			const section = sections[index];
			if (!section.fixedNumber) return;
			const allNums = collectAllNumbers(sections, originalSectionNumbers);
			const result = nextSiblingNumber(section.fixedNumber, section.depth, allNums);
			const newSection = createSection(result.depth);
			newSection.fixedNumber = result.number;
			sections = sortByFixedNumber([...sections, newSection]);
		} else {
			const depth = sections[index].depth;
			const insertAt = endOfSubtree(index);
			const newSection = createSection(depth);
			sections = [...sections.slice(0, insertAt), newSection, ...sections.slice(insertAt)];
		}
	}

	function addChild(index: number) {
		const section = sections[index];
		if (section.depth >= 3) return;

		if (amendmentMode) {
			if (!section.fixedNumber) return;
			const allNums = collectAllNumbers(sections, originalSectionNumbers);
			const result = nextChildNumber(section.fixedNumber, section.depth, allNums);
			if (!result) return;
			const newSection = createSection(result.depth);
			newSection.fixedNumber = result.number;
			sections = sortByFixedNumber([...sections, newSection]);
		} else {
			const insertAt = endOfSubtree(index);
			const newSection = createSection((section.depth + 1) as 1 | 2 | 3);
			sections = [...sections.slice(0, insertAt), newSection, ...sections.slice(insertAt)];
		}
	}

	function addTopLevel() {
		if (amendmentMode) {
			const allNums = collectAllNumbers(sections, originalSectionNumbers);
			const topNums = allNums.filter(n => !n.includes('.')).map(n => parseInt(n)).filter(n => !isNaN(n));
			const next = topNums.length > 0 ? Math.max(...topNums) + 1 : 1;
			const newSection = createSection(1);
			newSection.fixedNumber = String(next);
			sections = sortByFixedNumber([...sections, newSection]);
		} else {
			sections = [...sections, createSection(1)];
		}
	}

	function removeSection(index: number) {
		if (amendmentMode) {
			// In amendment mode, just remove this one section (no cascading children)
			sections = [...sections.slice(0, index), ...sections.slice(index + 1)];
		} else {
			const depth = sections[index].depth;
			let end = index + 1;
			while (end < sections.length && sections[end].depth > depth) {
				end++;
			}
			sections = [...sections.slice(0, index), ...sections.slice(end)];
		}
	}

	function onTextareaFocus(el: HTMLTextAreaElement, index: number) {
		activeTextarea = el;
		activeSectionIdx = index;
	}

	function applyFormat(prefix: string, suffix: string) {
		if (!activeTextarea || activeSectionIdx === null) return;
		const ta = activeTextarea;
		const idx = activeSectionIdx;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const text = sections[idx].content;
		const selected = text.slice(start, end);

		sections[idx] = {
			...sections[idx],
			content: text.slice(0, start) + prefix + selected + suffix + text.slice(end)
		};

		tick().then(() => {
			ta.focus();
			ta.setSelectionRange(start + prefix.length, end + prefix.length);
		});
	}

	function applyList() {
		if (!activeTextarea || activeSectionIdx === null) return;
		const ta = activeTextarea;
		const idx = activeSectionIdx;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const text = sections[idx].content;

		const before = text.lastIndexOf('\n', start - 1) + 1;
		const after = text.indexOf('\n', end);
		const lineEnd = after === -1 ? text.length : after;
		const selectedLines = text.slice(before, lineEnd);
		const prefixed = selectedLines
			.split('\n')
			.map((l) => `- ${l}`)
			.join('\n');

		sections[idx] = {
			...sections[idx],
			content: text.slice(0, before) + prefixed + text.slice(lineEnd)
		};

		tick().then(() => {
			ta.focus();
		});
	}

	function depthIndent(depth: number): string {
		return `${(depth - 1) * 1.5}rem`;
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Toolbar -->
	<div class="flex items-center gap-2 border-b border-border pb-3">
		<button
			onclick={togglePreview}
			class="text-sm px-3 py-1 rounded border border-border hover:bg-bg-lighter transition-colors cursor-pointer
				{preview ? 'bg-bg-lighter text-text' : 'text-text-secondary'}"
		>
			{preview ? 'Edit' : 'Preview'}
		</button>

		{#if !preview}
			<div class="w-px h-5 bg-border mx-1"></div>
			<button
				onclick={() => applyFormat('**', '**')}
				class="text-sm px-2 py-1 rounded hover:bg-bg-lighter text-text-secondary hover:text-text transition-colors cursor-pointer font-bold"
				title="Bold"
			>
				B
			</button>
			<button
				onclick={() => applyFormat('*', '*')}
				class="text-sm px-2 py-1 rounded hover:bg-bg-lighter text-text-secondary hover:text-text transition-colors cursor-pointer italic"
				title="Italic"
			>
				I
			</button>
			<button
				onclick={applyList}
				class="text-sm px-2 py-1 rounded hover:bg-bg-lighter text-text-secondary hover:text-text transition-colors cursor-pointer"
				title="Bullet list"
			>
				&bull; List
			</button>
		{/if}
	</div>

	<!-- Preview mode -->
	{#if preview}
		<div class="doc-viewer prose prose-invert max-w-none text-sm p-4 border border-border rounded bg-bg">
			{@html previewHtml}
		</div>

	<!-- Edit mode -->
	{:else}
		{#if sections.length === 0}
			<div class="text-center py-8">
				<button
					onclick={addTopLevel}
					class="text-sm px-4 py-1.5 rounded bg-primary hover:bg-primary-hover text-text transition-colors cursor-pointer"
				>
					Add new section
				</button>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each sections as section, i (section.id)}
					{@const num = section.fixedNumber ? `§${section.fixedNumber}` : computeSectionNumber(sections, i)}
					{@const canAddSibling = !amendmentMode || section.depth === minSelectedDepth()}
					<div
						class="border-l-2 border-primary rounded-r bg-bg-light"
						style="margin-left: {depthIndent(section.depth)}"
					>
						<div class="px-4 py-3">
							<!-- Section header -->
							<div class="flex items-center gap-2 mb-2">
								<span class="text-xs font-mono text-text-muted shrink-0">{num}</span>
								<input
									type="text"
									bind:value={section.title}
									placeholder="Section title"
									class="flex-1 bg-bg border border-border rounded px-2 py-1 focus:border-primary outline-none text-sm text-text placeholder:text-text-muted"
								/>
								<div class="flex items-center gap-1.5 shrink-0">
									{#if canAddSibling}
										<button
											onclick={() => addSibling(i)}
											class="text-xs px-2.5 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
											title="Add section at same level"
										>
											+ Section
										</button>
									{/if}
									{#if section.depth < 3}
										<button
											onclick={() => addChild(i)}
											class="text-xs px-2.5 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
											title="Add subsection inside this section"
										>
											+ Sub
										</button>
									{/if}
									<button
										onclick={() => removeSection(i)}
										class="text-xs px-2.5 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-error transition-colors cursor-pointer"
										title="Remove section"
									>
										Remove
									</button>
								</div>
							</div>

							<!-- Section content -->
							<textarea
								bind:value={section.content}
								onfocus={(e) => onTextareaFocus(e.currentTarget as HTMLTextAreaElement, i)}
								placeholder="Section content..."
								rows="3"
								class="w-full bg-bg border border-border rounded p-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-primary resize-y font-mono"
							></textarea>
						</div>
					</div>
				{/each}
			</div>

			{#if !amendmentMode || minSelectedDepth() === 1}
				<button
					onclick={addTopLevel}
					class="text-sm text-text-muted hover:text-text transition-colors cursor-pointer mt-2"
				>
					+ Add section
				</button>
			{/if}
		{/if}
	{/if}
</div>
