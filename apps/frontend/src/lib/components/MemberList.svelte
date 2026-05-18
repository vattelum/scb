<script lang="ts">
	import { onMount } from 'svelte';
	import { getClient } from '$lib/services/wallet-config';
	import { daaTokenAddress } from '$lib/contracts';
	import { parseAbiItem, type PublicClient } from 'viem';
	import { getPaginatedLogs } from '$lib/services/event-log-scanner';

	const deployBlock = BigInt(import.meta.env.VITE_DEPLOY_BLOCK || '0');

	interface Member {
		address: string;
		tokenId: bigint;
	}

	const PAGE_SIZE = 25;

	let members = $state<Member[]>([]);
	let loading = $state(true);
	let error = $state('');
	let page = $state(1);

	let totalPages = $derived(Math.max(1, Math.ceil(members.length / PAGE_SIZE)));
	let pagedMembers = $derived(members.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	const mintEvent = parseAbiItem('event Minted(address indexed to, uint256 indexed tokenId)');
	const burnEvent = parseAbiItem('event Burned(address indexed from, uint256 indexed tokenId)');

	async function loadMembers() {
		try {
			// Cast to bare PublicClient — the multi-chain wallet config returns
			// a union of chain-narrowed clients (Optimism's OP-stack tx types
			// don't unify with standard chains), but getPaginatedLogs only needs
			// the unparameterised shape.
			const client = getClient() as unknown as PublicClient | undefined;
			if (!client) {
				error = 'No RPC client available';
				return;
			}

			const [mintResult, burnResult] = await Promise.all([
				getPaginatedLogs(client, {
					address: daaTokenAddress,
					event: mintEvent,
					fromBlock: deployBlock
				}, 'members:mint'),
				getPaginatedLogs(client, {
					address: daaTokenAddress,
					event: burnEvent,
					fromBlock: deployBlock
				}, 'members:burn')
			]);

			if (!mintResult.complete || !burnResult.complete) {
				console.warn('[members] Scan incomplete — showing partial results');
			}

			const allMinted = mintResult.logs.map((log: any) => ({
				address: log.args.to as string,
				tokenId: log.args.tokenId.toString()
			}));

			const allBurned = new Set(
				burnResult.logs.map((log: any) => log.args.tokenId.toString())
			);

			members = allMinted
				.filter((m) => !allBurned.has(m.tokenId))
				.map((m) => ({ address: m.address, tokenId: BigInt(m.tokenId) }));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load members';
		} finally {
			loading = false;
		}
	}

	export function refresh() {
		loading = true;
		error = '';
		loadMembers();
	}

	export function getTokenId(address: string): bigint | null {
		const member = members.find(m => m.address.toLowerCase() === address.toLowerCase());
		return member ? member.tokenId : null;
	}

	onMount(loadMembers);
</script>

<div class="flex flex-col gap-3">
	<h2 class="text-lg font-medium">Members</h2>

	{#if loading}
		<p class="text-text-secondary text-sm">Loading members...</p>
	{:else if error}
		<p class="text-error text-sm">{error}</p>
	{:else if members.length === 0}
		<p class="text-text-muted text-sm">No members yet.</p>
	{:else}
		<div class="border border-border rounded-lg overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border bg-bg-lighter">
						<th class="text-left px-4 py-2 text-text-secondary font-medium">Token</th>
						<th class="text-left px-4 py-2 text-text-secondary font-medium">Address</th>
					</tr>
				</thead>
				<tbody>
					{#each pagedMembers as member}
						<tr class="border-b border-border last:border-b-0">
							<td class="px-4 py-2 font-mono text-text-muted"
								>#{member.tokenId.toString()}</td
							>
							<td class="px-4 py-2 font-mono">{member.address}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="flex items-center justify-between">
			<p class="text-text-muted text-xs">
				{members.length}
				{members.length === 1 ? 'member' : 'members'}
			</p>
			{#if totalPages > 1}
				<div class="flex items-center gap-2 text-xs">
					<button
						onclick={() => page--}
						disabled={page <= 1}
						class="px-2 py-1 rounded border border-border hover:bg-bg-lighter text-text-secondary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
					>&laquo;</button>
					<span class="text-text-muted">Page {page} of {totalPages}</span>
					<button
						onclick={() => page++}
						disabled={page >= totalPages}
						class="px-2 py-1 rounded border border-border hover:bg-bg-lighter text-text-secondary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
					>&raquo;</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
