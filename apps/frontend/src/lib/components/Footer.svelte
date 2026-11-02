<script lang="ts">
	import { formatNetwork, explorerAddressUrl } from '#lib/constants/networks.ts';

	// Reads env vars directly (not via `#lib/contracts/index.ts`) so this component is
	// portable across repos: each repo's `#lib/contracts/index.ts` exports a
	// different set of symbols, but `import.meta.env.VITE_*` is uniform. To
	// adopt in another repo, edit only the entries below to match that repo's
	// deployed contracts. Missing/unset env vars are silently dropped by the
	// filter, so a partial deployment renders cleanly with the contracts that
	// do exist.
	const chainId = Number(import.meta.env.VITE_CHAIN_ID);

	const contracts = [
		{ label: 'DAARegistry', address: import.meta.env.VITE_DAA_REGISTRY_ADDRESS },
		{ label: 'DAAToken', address: import.meta.env.VITE_DAA_TOKEN_ADDRESS },
		{ label: 'ContractRegistry', address: import.meta.env.VITE_CONTRACT_REGISTRY_ADDRESS },
		{ label: 'PubkeyRegistry', address: import.meta.env.VITE_PUBKEY_REGISTRY_ADDRESS }
	].filter((c) => c.address && c.address !== '0x') as Array<{
		label: string;
		address: `0x${string}`;
	}>;
</script>

<footer class="border-t border-border mt-12 px-8 py-6 text-xs text-text-muted">
	<div class="max-w-4xl mx-auto flex flex-col gap-2">
		<p class="text-text-secondary">
			Deployed contracts on {formatNetwork(chainId)}
		</p>
		<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">
			{#each contracts as c (c.label)}
				<span class="text-text-secondary">{c.label}</span>
				{#if explorerAddressUrl(chainId, c.address)}
					<a
						href={explorerAddressUrl(chainId, c.address)}
						target="_blank"
						rel="noreferrer"
						class="text-text-muted hover:text-text break-all"
					>{c.address}</a>
				{:else}
					<span class="break-all">{c.address}</span>
				{/if}
			{/each}
		</div>
	</div>
</footer>
