<script lang="ts">
	import { type TemplateVariable } from '#lib/services/template-variables.ts';

	interface Props {
		vars: TemplateVariable[];
	}

	let { vars = $bindable() }: Props = $props();

	function addCustom() {
		vars = [...vars, { name: '', label: '', type: 'text', required: false }];
	}

	function removeAt(i: number) {
		vars = vars.filter((_, idx) => idx !== i);
	}

	function copyPlaceholder(name: string) {
		navigator.clipboard.writeText(`{{${name}}}`);
	}
</script>

<div class="border border-border rounded-lg p-4">
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-sm font-medium">Template Variables</h3>
		<button
			onclick={addCustom}
			class="text-xs px-3 py-1 rounded border border-primary text-primary hover:bg-primary hover:text-text transition-colors cursor-pointer"
		>
			+ Custom
		</button>
	</div>

	{#if vars.length === 0}
		<p class="text-xs text-text-muted">No variables defined. Add presets or custom variables to create a contract template.</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each vars as v, i}
				<div class="flex items-center gap-2 bg-bg rounded p-2 border border-border">
					<input
						bind:value={vars[i].name}
						placeholder="name"
						class="bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-text w-36"
					/>
					<input
						bind:value={vars[i].label}
						placeholder="Label"
						class="bg-surface border border-border rounded px-2 py-1 text-xs text-text flex-1"
					/>
					<select
						bind:value={vars[i].type}
						class="bg-surface border border-border rounded px-2 py-1 text-xs text-text"
					>
						<option value="text">text</option>
						<option value="number">number</option>
					</select>
					<label class="flex items-center gap-1 text-xs text-text-muted">
						<input
							type="checkbox"
							bind:checked={vars[i].required}
							class="accent-primary"
						/>
						Req
					</label>
					<button
						onclick={() => copyPlaceholder(v.name)}
						title={`Copy {{${v.name}}} to clipboard`}
						class="text-xs px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-primary hover:border-primary transition-colors cursor-pointer"
					>
						&#123;&#123;&#125;&#125;
					</button>
					<button
						onclick={() => removeAt(i)}
						class="text-red-400 hover:text-red-300 text-xs px-1 cursor-pointer"
					>
						&times;
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
