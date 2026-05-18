<!--
	ScbSection — Smart Contract Block reference picker.

	A Smart Contract Block attaches a smart contract to a human readable
	contract. By aligning code and law, the SCB can give real legal meaning
	to a smart contract.
-->
<script lang="ts">
	import { isAddress } from 'viem';
	import { formatNetwork } from '$lib/constants/networks';
	import { fetchAndHashBytecode } from '$lib/services/bytecode-hash';
	import NetworkPicker from '$lib/components/NetworkPicker.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';

	const PROXY_WARNING = 'The bytecode hash is a snapshot of the contract at signing time. Proxy / upgradable contracts can swap their implementation later, which would invalidate this hash against the code actually running. Verify with the counterparty that the target is non-upgradable or that they accept upgrade risk.';

	const defaultChainId = Number(import.meta.env.VITE_CHAIN_ID);

	let {
		enabled = $bindable(),
		address = $bindable(),
		chainId = $bindable(),
		bytecodeHash = $bindable()
	}: {
		enabled: boolean;
		address: string;
		chainId: number;
		bytecodeHash: `0x${string}` | '';
	} = $props();

	let bytecodeLen = $state<number | null>(null);
	let error = $state('');
	let loading = $state(false);

	function onChainChange() {
		bytecodeHash = '';
		bytecodeLen = null;
	}

	function onAddressInput() {
		bytecodeHash = '';
		bytecodeLen = null;
		error = '';
	}

	async function fetchBytecode() {
		error = '';
		bytecodeLen = null;
		bytecodeHash = '';
		if (!address || !isAddress(address)) {
			error = 'Enter a valid contract address.';
			return;
		}
		if (chainId <= 0) {
			error = 'Select or enter a chain ID.';
			return;
		}
		loading = true;
		try {
			const { hash, byteLength } = await fetchAndHashBytecode(address as `0x${string}`, chainId);
			bytecodeHash = hash;
			bytecodeLen = byteLength;
		} catch (e: any) {
			error = e?.message ?? 'Failed to fetch bytecode.';
		} finally {
			loading = false;
		}
	}

	function reset() {
		address = '';
		bytecodeLen = null;
		bytecodeHash = '';
		error = '';
		chainId = defaultChainId;
	}
</script>

<div class="bg-surface border border-border rounded-lg p-3">
	<label class="flex items-start gap-2 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={enabled}
			onchange={() => { if (!enabled) reset(); }}
			class="mt-1"
		/>
		<span>
			<span class="text-sm text-text">This contract references a smart contract</span>
			<Tooltip text={PROXY_WARNING} align="left"><span class="ml-1 text-text-muted cursor-help text-xs">(?)</span></Tooltip>
			<span class="block text-xs text-text-muted mt-0.5">
				Bind this HLC to an already-deployed smart contract. The contract's bytecode hash is
				computed and stored on-chain so any verifier can later confirm the exact code the parties
				consented to. Product 4 records the reference — it does not validate the code.
			</span>
		</span>
	</label>

	{#if enabled}
		<div class="mt-3 pl-6 flex flex-col gap-2">
			<div>
				<label for="scb-address" class="block text-xs text-text-muted mb-0.5">Smart contract address</label>
				<input
					id="scb-address"
					bind:value={address}
					oninput={onAddressInput}
					placeholder="0x..."
					class="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text font-mono"
				/>
			</div>

			<div>
				<label class="block text-xs text-text-muted mb-0.5">Network</label>
				<NetworkPicker bind:value={chainId} onChange={onChainChange} />
			</div>

			<button
				onclick={fetchBytecode}
				disabled={loading || !address || chainId <= 0 || !!bytecodeHash}
				class="self-start bg-primary hover:bg-primary-hover disabled:opacity-50 text-text text-sm px-4 py-1.5 rounded transition-colors cursor-pointer disabled:cursor-not-allowed"
			>
				{loading ? 'Fetching…' : bytecodeHash ? 'Hash computed' : 'Fetch bytecode & compute hash'}
			</button>

			{#if error}
				<p class="text-xs text-red-400">{error}</p>
			{/if}

			{#if bytecodeHash}
				<div class="border border-border rounded p-2 text-xs flex flex-col gap-1">
					<div><span class="text-text-muted">Address:</span> <span class="font-mono">{address}</span></div>
					<div><span class="text-text-muted">Network:</span> {formatNetwork(chainId)}</div>
					<div><span class="text-text-muted">Bytecode length:</span> {bytecodeLen} bytes</div>
					<div class="break-all"><span class="text-text-muted">Bytecode hash:</span> <span class="font-mono">{bytecodeHash}</span></div>
				</div>
			{/if}
		</div>
	{/if}
</div>
