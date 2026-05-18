<script lang="ts">
	type TemplateVariable = { name: string; label: string; type: string; required: boolean };

	let {
		templateVars,
		variableValues = $bindable()
	}: {
		templateVars: TemplateVariable[];
		variableValues: Record<string, string>;
	} = $props();

	function inputType(v: TemplateVariable): string {
		if (v.name === 'start_date' || v.name === 'expires') return 'date';
		if (v.type === 'number') return 'number';
		return 'text';
	}
</script>

{#if templateVars.length > 0}
	<div>
		<label class="block text-sm text-text-secondary mb-2">Contract Variables</label>
		<div class="flex flex-col gap-3">
			{#each templateVars as v}
				<div>
					<label for="var-{v.name}" class="block text-xs text-text-muted mb-0.5">
						{v.label}{v.required ? ' *' : ''}
					</label>
					<input
						id="var-{v.name}"
						type={inputType(v)}
						value={variableValues[v.name] ?? ''}
						oninput={(e) => (variableValues[v.name] = (e.target as HTMLInputElement).value)}
						required={v.required}
						class="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
					/>
				</div>
			{/each}
		</div>
	</div>
{/if}
