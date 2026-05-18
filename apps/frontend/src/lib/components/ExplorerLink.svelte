<script lang="ts">
	import { explorerTxUrl, explorerAddressUrl } from '$lib/constants/networks';

	interface Props {
		chainId: number;
		tx?: string;
		address?: string;
		label?: string;
	}

	let { chainId, tx, address, label }: Props = $props();

	let href = $derived(tx ? explorerTxUrl(chainId, tx) : address ? explorerAddressUrl(chainId, address) : null);
	let text = $derived(label ?? tx ?? address ?? '');
</script>

{#if href}
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class="font-mono text-primary hover:underline"
	>{text}</a>
{:else}
	<span class="font-mono text-text-muted">{text}</span>
{/if}
