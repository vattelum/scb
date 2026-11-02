<script lang="ts">
	import { onMount } from 'svelte';
	import { wallet } from '#lib/stores/wallet.ts';
	import {
		getContractsByParty,
		getContractCount,
		readContractBatchChunked,
		hasActiveProposal,
		findRevisionSource,
		statusClass,
		StatusLabels,
		type ContractListRead,
		type DocumentReference
	} from '#lib/services/contract-registry.ts';
	import {
		getCached,
		setCached,
		isCacheFresh,
		cleanupOldEntries,
		scanAndInvalidate
	} from '#lib/services/contract-state-cache.ts';
	import { formatDate } from '#lib/services/format.ts';

	interface ContractListItem {
		id: bigint;
		status: number;
		effectiveStatus: number;
		stale: boolean;
		hasProposal: boolean;
		signatories: `0x${string}`[];
		createdAt: bigint;
		contentHash: `0x${string}`;
		references: DocumentReference[];
		revises: bigint | null;
	}

	let {
		pubkeyRegistered = false,
		oncreate,
		onimport,
		onopencontract
	}: {
		pubkeyRegistered: boolean;
		oncreate: () => void;
		onimport: () => void;
		onopencontract: (id: bigint) => void;
	} = $props();

	let contracts = $state<ContractListItem[]>([]);
	let lookupId = $state('');
	let listMode = $state<'mine' | 'all'>('all');
	const LIST_PAGE_SIZE = 25;
	let listPage = $state(1);
	let totalContracts = $state(0);
	let loading = $state(false);
	let error = $state('');

	let listTotalPages = $derived(Math.max(1, Math.ceil(
		listMode === 'all' ? totalContracts : contracts.length
	) / LIST_PAGE_SIZE));
	let pagedContracts = $derived(
		listMode === 'all'
			? contracts
			: contracts.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE)
	);

	$effect(() => {
		const _ = [$wallet.address, listMode, listPage];
		if (listMode === 'mine' && !$wallet.address) {
			contracts = [];
			return;
		}
		loadContracts();
	});

	function toItem(id: bigint, read: ContractListRead): ContractListItem {
		return {
			id,
			status: read.contract.status,
			effectiveStatus: read.effectiveStatus,
			stale: read.stale,
			hasProposal:
				hasActiveProposal(read.terminationProposal) ||
				hasActiveProposal(read.completionProposal),
			signatories: read.contract.signatories,
			createdAt: read.contract.createdAt,
			contentHash: read.contract.contentHash,
			references: read.contract.references,
			revises: findRevisionSource(read.contract.references)
		};
	}

	// Reverse revision graph across the current list: for each contract that
	// revises another, mark the source as "revisedBy" that revision. Scoped to
	// the currently-loaded page — cross-page chains surface when both ends are
	// visible.
	const revisedBy = $derived.by(() => {
		const map = new Map<bigint, bigint>();
		for (const c of contracts) {
			if (c.revises !== null) map.set(c.revises, c.id);
		}
		return map;
	});

	// Public lookup for the contract view, which renders a "Revised by #N"
	// badge on contract #1 when a revision exists in the loaded list. The
	// signatories of the revision equal those of the source by construction
	// (FR-037), so a 'mine'-mode list always contains both ends.
	export function getRevisedBy(id: bigint): bigint | null {
		return revisedBy.get(id) ?? null;
	}

	function mergeAndSort(
		ids: bigint[],
		entries: Map<bigint, ContractListRead>,
		reverse: boolean
	): ContractListItem[] {
		const items: ContractListItem[] = [];
		for (const id of ids) {
			const read = entries.get(id);
			if (read) items.push(toItem(id, read));
		}
		return reverse ? items.reverse() : items;
	}

	async function fetchAndCache(ids: bigint[]): Promise<ContractListRead[]> {
		const fetched = await readContractBatchChunked(ids);
		for (let i = 0; i < ids.length; i++) setCached(ids[i], fetched[i]);
		return fetched;
	}

	export async function loadContracts() {
		loading = true;
		error = '';
		try {
			let ids: bigint[];
			let reverse = false;
			if (listMode === 'mine') {
				if (!$wallet.address) return;
				ids = await getContractsByParty($wallet.address);
				reverse = true;
			} else {
				const count = Number(await getContractCount());
				totalContracts = count;
				const offset = (listPage - 1) * LIST_PAGE_SIZE;
				ids = [];
				for (let i = count - offset; i > Math.max(0, count - offset - LIST_PAGE_SIZE); i--) {
					ids.push(BigInt(i));
				}
			}

			// Split cached-fresh vs stale — render cached immediately for fast first paint.
			const entries = new Map<bigint, ContractListRead>();
			const toFetch: bigint[] = [];
			for (const id of ids) {
				const cached = getCached(id);
				if (cached && isCacheFresh(cached)) {
					entries.set(id, cached.read);
				} else {
					toFetch.push(id);
				}
			}
			contracts = mergeAndSort(ids, entries, reverse);

			if (toFetch.length > 0) {
				const fetched = await fetchAndCache(toFetch);
				for (let i = 0; i < toFetch.length; i++) entries.set(toFetch[i], fetched[i]);
				contracts = mergeAndSort(ids, entries, reverse);
			}

			// Background: scan lifecycle events, invalidate touched IDs, refresh them.
			scanAndInvalidate()
				.then(async (invalidated) => {
					const refresh = ids.filter((id) => invalidated.has(id));
					if (refresh.length === 0) return;
					const fetched = await fetchAndCache(refresh);
					for (let i = 0; i < refresh.length; i++) entries.set(refresh[i], fetched[i]);
					contracts = mergeAndSort(ids, entries, reverse);
				})
				.catch((e) => console.warn('[contract-list] event scan failed', e));
		} catch (e: any) {
			error = e.message || 'Failed to load contracts';
		} finally {
			loading = false;
		}
	}

	// One-shot cleanup of very old cache entries. Inside onMount so localStorage
	// access never runs during SSR.
	onMount(() => {
		cleanupOldEntries();
	});

	async function lookupContract() {
		const id = lookupId.trim();
		if (!id) return;
		try {
			onopencontract(BigInt(id));
		} catch {
			error = `Contract #${id} not found`;
		}
	}
</script>

{#if error}
	<div class="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 mb-4 text-sm">{error}</div>
{/if}

{#if $wallet.connected}
	<div class="flex gap-3 mb-6">
		<button
			onclick={oncreate}
			disabled={!$wallet.isTokenHolder || !pubkeyRegistered}
			title={!pubkeyRegistered ? 'Register your encryption key first' : ''}
			class="bg-primary hover:bg-primary-hover disabled:opacity-50 text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer disabled:cursor-not-allowed"
		>
			Create Contract
		</button>
		<button
			onclick={onimport}
			class="bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
		>
			Import
		</button>
	</div>
{/if}

<div class="flex gap-2 mb-6">
	<input
		bind:value={lookupId}
		placeholder="Enter Contract ID"
		class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text flex-1"
		onkeydown={(e) => { if (e.key === 'Enter') lookupContract(); }}
	/>
	<button
		onclick={lookupContract}
		class="bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-1.5 rounded transition-colors cursor-pointer"
	>
		View
	</button>
</div>

<div class="flex gap-2 mb-4">
	<button
		onclick={() => { listMode = 'all'; listPage = 1; }}
		class="text-sm px-3 py-1 rounded transition-colors cursor-pointer {listMode === 'all' ? 'bg-primary text-text' : 'bg-surface hover:bg-surface-hover border border-border text-text-secondary'}"
	>
		All Contracts
	</button>
	{#if $wallet.connected}
		<button
			onclick={() => { listMode = 'mine'; listPage = 1; }}
			class="text-sm px-3 py-1 rounded transition-colors cursor-pointer {listMode === 'mine' ? 'bg-primary text-text' : 'bg-surface hover:bg-surface-hover border border-border text-text-secondary'}"
		>
			My Contracts
		</button>
	{/if}
</div>

{#if loading}
	<p class="text-text-secondary text-sm">Loading contracts...</p>
{:else if contracts.length === 0}
	<p class="text-text-muted text-sm">
		{listMode === 'mine' ? 'No contracts found for your address.' : 'No contracts yet.'}
	</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each pagedContracts as c}
			<button
				onclick={() => onopencontract(c.id)}
				class="flex items-center justify-between bg-surface hover:bg-surface-hover border border-border rounded-lg p-4 text-left transition-colors cursor-pointer w-full"
			>
				<div>
					<span class="text-sm font-medium">Contract #{c.id.toString()}</span>
					<span class="text-xs text-text-muted ml-2">
						{c.signatories.length} {c.signatories.length === 1 ? 'party' : 'parties'}
					</span>
					{#if c.revises !== null}
						<span class="text-[11px] text-text-muted ml-2">Revises #{c.revises.toString()}</span>
					{/if}
					{#if revisedBy.has(c.id)}
						<span class="text-[11px] text-amber-300 ml-2">• Revised by #{revisedBy.get(c.id)!.toString()}</span>
					{/if}
				</div>
				<div class="flex items-center gap-3">
					<span class="text-xs text-text-muted">{formatDate(c.createdAt)}</span>
					{#if c.hasProposal}
						<span class="text-[11px] text-yellow-300 bg-yellow-900/40 px-1.5 py-0.5 rounded">Proposal pending</span>
					{/if}
					{#if c.stale}
						<span class="text-[11px] text-text-muted bg-bg px-1.5 py-0.5 rounded">Inactive</span>
					{/if}
					<span class="text-xs font-medium {statusClass(c.effectiveStatus)}">
						{StatusLabels[c.effectiveStatus] ?? 'Unknown'}
					</span>
				</div>
			</button>
		{/each}
	</div>
	{#if listTotalPages > 1}
		<div class="flex items-center justify-center gap-2 mt-4 text-xs">
			<button
				onclick={() => listPage--}
				disabled={listPage <= 1}
				class="px-2 py-1 rounded border border-border hover:bg-bg-lighter text-text-secondary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
			>&laquo;</button>
			<span class="text-text-muted">Page {listPage} of {listTotalPages}</span>
			<button
				onclick={() => listPage++}
				disabled={listPage >= listTotalPages}
				class="px-2 py-1 rounded border border-border hover:bg-bg-lighter text-text-secondary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
			>&raquo;</button>
		</div>
	{/if}
{/if}
