<script lang="ts">
	import { PRESET_NETWORKS } from '#lib/constants/networks.ts';

	let {
		value = $bindable(0),
		onChange
	}: {
		value: number;
		onChange?: (chainId: number) => void;
	} = $props();

	const isPreset = (id: number) => PRESET_NETWORKS.some((n) => n.chainId === id);
	const startsAsOther = value > 0 && !isPreset(value);
	let mode = $state<'preset' | 'other'>(startsAsOther ? 'other' : 'preset');
	// Initialise from `value` directly so we don't capture a stale snapshot of `mode`
	// at component setup. Subsequent updates flow through pickPreset / pickOther /
	// updateCustom, which keep `custom` in sync with `mode` and `value` explicitly.
	let custom = $state<number | ''>(startsAsOther ? value : '');

	function pickPreset(id: number) {
		mode = 'preset';
		value = id;
		onChange?.(id);
	}

	function pickOther() {
		mode = 'other';
		const next = typeof custom === 'number' ? custom : 0;
		value = next;
		onChange?.(next);
	}

	function updateCustom(n: number | '') {
		custom = n;
		const next = typeof n === 'number' ? n : 0;
		value = next;
		onChange?.(next);
	}
</script>

<div>
	<div class="flex flex-wrap gap-1">
		{#each PRESET_NETWORKS as net}
			<button
				type="button"
				onclick={() => pickPreset(net.chainId)}
				class="text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer {mode === 'preset' && value === net.chainId ? 'bg-primary text-text border-primary' : 'bg-surface hover:bg-surface-hover border-border text-text-secondary'}"
			>
				{net.label}
			</button>
		{/each}
		<button
			type="button"
			onclick={pickOther}
			class="text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer {mode === 'other' ? 'bg-primary text-text border-primary' : 'bg-surface hover:bg-surface-hover border-border text-text-secondary'}"
		>
			Other
		</button>
	</div>
	{#if mode === 'other'}
		<input
			type="number"
			value={custom}
			oninput={(e) =>
				updateCustom(
					(e.target as HTMLInputElement).value === ''
						? ''
						: Number((e.target as HTMLInputElement).value)
				)}
			placeholder="Enter chain ID (e.g. 56 for BNB)"
			class="mt-2 w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
		/>
	{/if}
</div>
