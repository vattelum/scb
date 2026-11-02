<script lang="ts">
	import { slugifyRoleKey, type TemplateRole } from '#lib/services/template-variables.ts';

	let { roles = $bindable<TemplateRole[]>([]) }: { roles: TemplateRole[] } = $props();

	function addRole() {
		roles = [...roles, { key: '', label: '' }];
	}

	function removeRole(i: number) {
		roles = roles.filter((_, idx) => idx !== i);
	}

	function onLabelInput(i: number, newLabel: string) {
		roles[i].label = newLabel;
		roles[i].key = slugifyRoleKey(newLabel);
	}

	function labelError(i: number): string {
		const label = roles[i].label.trim();
		if (!label) return '';
		const key = roles[i].key;
		if (!key) return 'Label must contain at least one letter or digit.';
		if (!/^[a-z][a-z0-9_]*$/.test(key)) return 'Label must start with a letter.';
		const dupe = roles.some((r, idx) => idx !== i && r.key === key);
		if (dupe) return 'Duplicate role — labels must be distinct.';
		return '';
	}
</script>

<div class="border border-border rounded-lg p-4">
	<div class="flex items-center justify-between mb-2">
		<h3 class="text-sm font-medium">Signatories</h3>
		<button
			onclick={addRole}
			class="text-xs px-3 py-1 rounded border border-primary text-primary hover:bg-primary hover:text-text transition-colors cursor-pointer"
		>
			+ Add signatory
		</button>
	</div>
	<p class="text-xs text-text-muted mb-3">
		Define the parties this contract is between. The template specifies only the roles; actual
		people and wallets are filled in when the contract is created.
	</p>

	{#if roles.length === 0}
		<p class="text-xs text-text-muted">No signatories declared. Add at least two for a typical two-party contract.</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each roles as r, i}
				{@const err = labelError(i)}
				<div class="flex items-start gap-2 bg-bg rounded p-2 border border-border">
					<div class="flex-1 flex flex-col gap-1">
						<input
							bind:value={roles[i].label}
							oninput={(e) => onLabelInput(i, (e.currentTarget as HTMLInputElement).value)}
							placeholder="Signatory name (e.g. Website Owner)"
							class="bg-surface border rounded px-2 py-1 text-sm text-text {err ? 'border-red-600' : 'border-border'}"
						/>
						{#if err}
							<span class="text-red-400 text-xs">{err}</span>
						{:else if r.key}
							<span class="text-xs text-text-muted font-mono">Reference: {'{{' + r.key + '}}'}</span>
						{/if}
					</div>
					{#if r.key}
						<button
							onclick={() => { navigator.clipboard.writeText(`{{${r.key}}}`); }}
							title={`Copy {{${r.key}}} to clipboard`}
							class="text-xs px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-primary hover:border-primary transition-colors cursor-pointer"
						>
							&#123;&#123;&#125;&#125;
						</button>
					{/if}
					<button
						onclick={() => removeRole(i)}
						class="text-red-400 hover:text-red-300 text-xs px-1 cursor-pointer"
					>
						&times;
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
