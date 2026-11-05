<script lang="ts">
	import {
		loadCategories,
		loadCategoriesFrom,
		loadLegislationPackages,
		type CategoryInfo,
		type LegislationPackageInfo
	} from '#lib/services/registry.ts';
	import { daaRegistryAddress, contractTemplateCategoryId } from '#lib/contracts/index.ts';
	import { RELATION_LABELS } from '#lib/constants/docTypes.ts';
	import {
		RELATION_GOVERNS,
		RELATION_IMPLEMENTS,
		RELATION_REFERENCES
	} from '@vattelum/document-registry-js';
	import { chainIdToLabel, chainIdToRpc } from '#lib/constants/networks.ts';
	import { EXTERNAL_URI } from '#lib/services/contract-package.ts';
	import type { PickedEntry, PickedRegistryLaw } from '#lib/services/contract-create.ts';
	import NetworkPicker from '#lib/components/NetworkPicker.svelte';

	const chainId = Number(import.meta.env.VITE_CHAIN_ID);

	let { selectedLegislation = $bindable() }: { selectedLegislation: PickedEntry[] } = $props();

	const registryEntries = $derived(
		selectedLegislation.filter((l): l is PickedRegistryLaw => l.kind === 'registry')
	);

	let legCategories = $state<CategoryInfo[]>([]);
	let legCategoryId = $state(-1);
	let legPackages = $state<LegislationPackageInfo[]>([]);
	let legLoadingDocs = $state(false);
	let legRelationType = $state(RELATION_GOVERNS);

	let legRegistryMode = $state<'local' | 'external' | 'document'>('local');
	let extRegistryAddress = $state('');
	let extChainId = $state(chainId);
	let extCategories = $state<CategoryInfo[]>([]);
	let extCategoryId = $state(-1);
	let extPackages = $state<LegislationPackageInfo[]>([]);
	let extLoadingCats = $state(false);
	let extLoadingDocs = $state(false);
	let extError = $state('');
	let loadError = $state('');

	let extDocTitle = $state('');
	let extDocUri = $state('');
	let extDocHash = $state('');
	let extDocError = $state('');

	$effect(() => {
		if (legCategories.length === 0) loadLegislationCategories();
	});

	async function loadLegislationCategories() {
		try {
			const allCats = await loadCategories();
			legCategories = allCats.filter((c) => c.id !== contractTemplateCategoryId);
			refineCategoryCounts(legCategories, undefined, undefined, (next) => (legCategories = next));
		} catch {
			loadError = 'Failed to load legislation categories';
		}
	}

	// Replace each category's raw on-chain documentCount with the count of
	// *selectable* packages (filtered identically to loadLegislationDocuments —
	// hides bare amendments/repeals and wholly-repealed lineages). Runs in
	// parallel across categories so the badge fills in within one round-trip.
	async function refineCategoryCounts(
		cats: CategoryInfo[],
		registry: `0x${string}` | undefined,
		onChain: number | undefined,
		commit: (next: CategoryInfo[]) => void
	) {
		const filtered = await Promise.all(
			cats.map(async (c) => {
				try {
					const pkgs = await loadLegislationPackages(c.id, registry, onChain);
					return { ...c, documentCount: pkgs.length };
				} catch {
					return c;
				}
			})
		);
		commit(filtered);
	}

	async function loadLegislationDocuments(catId: number) {
		legCategoryId = catId;
		legPackages = [];
		if (catId < 0) return;
		legLoadingDocs = true;
		try {
			legPackages = await loadLegislationPackages(catId);
		} catch {
			loadError = 'Failed to load legislation documents';
		} finally {
			legLoadingDocs = false;
		}
	}

	async function loadExternalCategories() {
		const addr = extRegistryAddress.trim();
		if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
			extError = 'Enter a valid registry address (0x...)';
			return;
		}
		if (extChainId !== chainId && !chainIdToRpc(extChainId)) {
			extError = `No public RPC is configured for chain ${extChainId}, so its registries cannot be read.`;
			return;
		}
		extError = '';
		extLoadingCats = true;
		extCategories = [];
		extPackages = [];
		extCategoryId = -1;
		try {
			extCategories = await loadCategoriesFrom(addr as `0x${string}`, extChainId);
			refineCategoryCounts(
				extCategories,
				addr as `0x${string}`,
				extChainId,
				(next) => (extCategories = next)
			);
		} catch {
			extError = 'Failed to load categories. Ensure the address is a compatible registry on the selected chain.';
		} finally {
			extLoadingCats = false;
		}
	}

	async function loadExternalDocuments(catId: number) {
		extCategoryId = catId;
		extPackages = [];
		if (catId < 0) return;
		extLoadingDocs = true;
		try {
			extPackages = await loadLegislationPackages(catId, extRegistryAddress.trim() as `0x${string}`, extChainId);
		} catch {
			extError = 'Failed to load documents from external registry.';
		} finally {
			extLoadingDocs = false;
		}
	}

	function addExternalLegislation(pkg: LegislationPackageInfo) {
		const addr = extRegistryAddress.trim() as `0x${string}`;
		const extChain = extChainId || chainId;
		const already = registryEntries.some(
			(l) => l.registryAddress.toLowerCase() === addr.toLowerCase() && l.categoryId === pkg.categoryId && l.documentId === pkg.documentId
		);
		if (already) return;
		selectedLegislation = [
			...selectedLegislation,
			{
				kind: 'registry',
				title: pkg.title,
				categoryId: pkg.categoryId,
				documentId: pkg.documentId,
				version: pkg.versionCount,
				relationType: legRelationType,
				registryAddress: addr,
				chainId: extChain,
				categoryName: extCategories.find((c) => c.id === pkg.categoryId)?.name ?? '',
				networkName: chainIdToLabel(extChain),
				include: 'text'
			}
		];
	}

	function addLegislation(pkg: LegislationPackageInfo) {
		const already = registryEntries.some(
			(l) => l.categoryId === pkg.categoryId && l.documentId === pkg.documentId
		);
		if (already) return;
		selectedLegislation = [
			...selectedLegislation,
			{
				kind: 'registry',
				title: pkg.title,
				categoryId: pkg.categoryId,
				documentId: pkg.documentId,
				version: pkg.versionCount,
				relationType: legRelationType,
				registryAddress: daaRegistryAddress,
				categoryName: legCategories.find((c) => c.id === pkg.categoryId)?.name ?? '',
				networkName: chainIdToLabel(chainId),
				include: 'text'
			}
		];
	}

	const codificationOverlap = $derived.by(() => {
		const notes: string[] = [];
		const selectedKey = (l: PickedRegistryLaw) =>
			`${l.registryAddress.toLowerCase()}/${l.categoryId}/${l.documentId}`;
		const selectedKeys = new Set(registryEntries.map(selectedKey));
		const allPackages = [...legPackages, ...extPackages];
		for (const leg of registryEntries) {
			const pkg = allPackages.find(
				(p) => p.categoryId === leg.categoryId && p.documentId === leg.documentId
			);
			if (!pkg || pkg.genesisDocType !== 4 || pkg.codifies.length === 0) continue;
			for (const c of pkg.codifies) {
				const k = `${c.registryAddress.toLowerCase()}/${c.categoryId}/${c.documentId}`;
				if (selectedKeys.has(k)) {
					notes.push(
						`Cat ${leg.categoryId} / Doc ${leg.documentId} (Codification) consolidates Cat ${c.categoryId} / Doc ${c.documentId}, which is also selected.`
					);
				}
			}
		}
		return notes;
	});

	function statusChipClass(status: string): string {
		if (status === 'InForce') return 'bg-green-900/30 text-green-300';
		if (status === 'PartiallyAmended') return 'bg-amber-900/30 text-amber-300';
		return 'bg-surface text-text-muted';
	}

	function statusChipLabel(status: string): string {
		if (status === 'InForce') return 'In Force';
		if (status === 'PartiallyAmended') return 'Partially Amended';
		return status;
	}

	function removeLegislation(index: number) {
		selectedLegislation = selectedLegislation.filter((_, i) => i !== index);
	}

	function moveLegislation(index: number, delta: -1 | 1) {
		const next = [...selectedLegislation];
		[next[index], next[index + delta]] = [next[index + delta], next[index]];
		selectedLegislation = next;
	}

	function setInclude(index: number, include: PickedRegistryLaw['include']) {
		selectedLegislation = selectedLegislation.map((l, i) =>
			i === index && l.kind === 'registry' ? { ...l, include } : l
		);
	}

	function addExternalDocument() {
		const title = extDocTitle.replace(/\s+/g, ' ').trim();
		const uri = extDocUri.trim();
		const hash = extDocHash.trim().toLowerCase().replace(/^0x/, '');
		if (!title) {
			extDocError = 'Enter a title.';
		} else if (!EXTERNAL_URI.test(uri)) {
			extDocError = 'The link must start with ipfs://, https:// or ar://.';
		} else if (!/^[0-9a-f]{64}$/.test(hash)) {
			extDocError = 'The hash must be a SHA-256: 64 hexadecimal characters.';
		} else {
			selectedLegislation = [...selectedLegislation, { kind: 'external', title, uri, hash }];
			extDocTitle = '';
			extDocUri = '';
			extDocHash = '';
			extDocError = '';
		}
	}
</script>

<div class="border border-border rounded-lg p-4">
	<label class="block text-sm text-text-secondary mb-1">Governing Legislation</label>
	<p class="text-xs text-text-muted mb-2">Pick legislation from the local registry or an external one. You can mix governing laws, adopted modules, and citations. Selected items appear below and become an integral part of the contract you submit.</p>

	<div class="flex gap-2 mb-3">
		<button
			onclick={() => { legRegistryMode = 'local'; }}
			class="text-xs px-3 py-1 rounded transition-colors cursor-pointer {legRegistryMode === 'local' ? 'bg-primary text-text' : 'bg-surface hover:bg-surface-hover border border-border text-text-secondary'}"
		>
			Local Registry
		</button>
		<button
			onclick={() => { legRegistryMode = 'external'; }}
			class="text-xs px-3 py-1 rounded transition-colors cursor-pointer {legRegistryMode === 'external' ? 'bg-primary text-text' : 'bg-surface hover:bg-surface-hover border border-border text-text-secondary'}"
		>
			External Registry
		</button>
		<button
			onclick={() => { legRegistryMode = 'document'; }}
			class="text-xs px-3 py-1 rounded transition-colors cursor-pointer {legRegistryMode === 'document' ? 'bg-primary text-text' : 'bg-surface hover:bg-surface-hover border border-border text-text-secondary'}"
		>
			External Document
		</button>
	</div>

	{#if legRegistryMode !== 'document'}
	<div class="mb-2">
		<select
			bind:value={legRelationType}
			class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
		>
			<option value={RELATION_GOVERNS}>Governing Law</option>
			<option value={RELATION_IMPLEMENTS}>Adopted Module</option>
			<option value={RELATION_REFERENCES}>Reference</option>
		</select>
	</div>
	{/if}

	{#if legRegistryMode === 'local'}
		<div class="mb-2">
			<select
				onchange={(e) => loadLegislationDocuments(Number((e.target as HTMLSelectElement).value))}
				class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text w-full"
			>
				<option value="-1">Select category...</option>
				{#each legCategories as cat}
					<option value={cat.id}>{cat.name} ({cat.documentCount})</option>
				{/each}
			</select>
		</div>

		{#if legLoadingDocs}
			<p class="text-text-muted text-xs">Loading documents...</p>
		{:else if legCategoryId >= 0 && legPackages.length > 0}
			<div class="flex flex-col gap-1">
				{#each legPackages as pkg}
					{@const alreadyAdded = registryEntries.some(l => l.registryAddress === daaRegistryAddress && l.categoryId === pkg.categoryId && l.documentId === pkg.documentId)}
					<button
						onclick={() => addLegislation(pkg)}
						disabled={alreadyAdded}
						class="text-left p-2 rounded border text-sm transition-colors cursor-pointer flex items-center justify-between gap-2
							{alreadyAdded ? 'border-green-700/50 text-text-muted cursor-not-allowed' : 'border-border bg-surface hover:bg-surface-hover'}"
					>
						<span>
							{pkg.title}
							{#if pkg.genesisDocType === 4}
								<span class="text-xs text-text-muted ml-1">(Codification)</span>
							{/if}
							{#if alreadyAdded}
								<span class="text-green-400 text-xs ml-1">added</span>
							{/if}
						</span>
						<span class="text-xs px-1.5 py-0.5 rounded {statusChipClass(pkg.status)}">
							{statusChipLabel(pkg.status)}
						</span>
					</button>
				{/each}
			</div>
		{:else if legCategoryId >= 0}
			<p class="text-text-muted text-xs">No documents in this category.</p>
		{/if}
	{:else if legRegistryMode === 'document'}
		<div class="flex flex-col gap-2">
			<input
				bind:value={extDocTitle}
				placeholder="Title"
				class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
			/>
			<input
				bind:value={extDocUri}
				placeholder="Link (ipfs://, https:// or ar://)"
				class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text font-mono"
			/>
			<input
				bind:value={extDocHash}
				placeholder="SHA-256 hash (64 hex characters)"
				class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text font-mono"
			/>
			{#if extDocError}
				<p class="text-red-400 text-xs">{extDocError}</p>
			{/if}
			<button
				onclick={addExternalDocument}
				class="self-start bg-primary hover:bg-primary-hover text-text text-sm px-4 py-1.5 rounded transition-colors cursor-pointer"
			>
				Add document
			</button>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			<div class="flex gap-2">
				<input
					bind:value={extRegistryAddress}
					placeholder="Registry address (0x...)"
					class="flex-1 bg-surface border border-border rounded px-3 py-1.5 text-sm text-text font-mono"
				/>
				<button
					onclick={loadExternalCategories}
					disabled={extLoadingCats}
					class="bg-primary hover:bg-primary-hover text-text text-sm px-4 py-1.5 rounded transition-colors cursor-pointer disabled:opacity-50"
				>
					{extLoadingCats ? 'Loading...' : 'Load'}
				</button>
			</div>
			<div>
				<label class="block text-xs text-text-muted mb-0.5">Network</label>
				<NetworkPicker bind:value={extChainId} />
			</div>
			{#if extError}
				<p class="text-red-400 text-xs">{extError}</p>
			{/if}
			{#if extCategories.length > 0}
				<select
					onchange={(e) => loadExternalDocuments(Number((e.target as HTMLSelectElement).value))}
					class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text w-full"
				>
					<option value="-1">Select category...</option>
					{#each extCategories as cat}
						<option value={cat.id}>{cat.name}{cat.documentCount > 0 ? ` (${cat.documentCount})` : ''}</option>
					{/each}
				</select>
			{/if}
			{#if extLoadingDocs}
				<p class="text-text-muted text-xs">Loading documents...</p>
			{:else if extCategoryId >= 0 && extPackages.length > 0}
				<div class="flex flex-col gap-1">
					{#each extPackages as pkg}
						{@const extAddr = extRegistryAddress.trim() as `0x${string}`}
						{@const alreadyAdded = registryEntries.some(l => l.registryAddress === extAddr && l.categoryId === pkg.categoryId && l.documentId === pkg.documentId)}
						<button
							onclick={() => addExternalLegislation(pkg)}
							disabled={alreadyAdded}
							class="text-left p-2 rounded border text-sm transition-colors cursor-pointer flex items-center justify-between gap-2
								{alreadyAdded ? 'border-green-700/50 text-text-muted cursor-not-allowed' : 'border-border bg-surface hover:bg-surface-hover'}"
						>
							<span>
								{pkg.title}
								{#if pkg.genesisDocType === 4}
									<span class="text-xs text-text-muted ml-1">(Codification)</span>
								{/if}
								{#if alreadyAdded}
									<span class="text-green-400 text-xs ml-1">added</span>
								{/if}
							</span>
							<span class="text-xs px-1.5 py-0.5 rounded {statusChipClass(pkg.status)}">
								{statusChipLabel(pkg.status)}
							</span>
						</button>
					{/each}
				</div>
			{:else if extCategoryId >= 0}
				<p class="text-text-muted text-xs">No documents in this category.</p>
			{/if}
		</div>
	{/if}

	{#if loadError}
		<p class="text-red-400 text-xs mt-2">{loadError}</p>
	{/if}

	{#if selectedLegislation.length > 0}
		<div class="mt-4 pt-3 border-t border-border">
			<div class="text-sm text-text-secondary mb-2">Selected legislation</div>
			<div class="flex flex-col gap-1.5">
				{#each selectedLegislation as leg, i}
					<div class="flex items-start justify-between bg-surface border border-border rounded p-2 gap-2">
						<div class="text-xs flex-1 min-w-0">
							{#if leg.kind === 'external'}
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-text font-medium truncate">{leg.title}</span>
									<span class="px-1.5 py-0.5 rounded text-xs bg-surface text-text-muted">External document</span>
								</div>
								<div class="text-text-muted mt-0.5 break-all">{leg.uri}</div>
								<div class="text-text-muted mt-0.5 font-mono break-all">SHA-256: {leg.hash}</div>
							{:else}
								{@const isExternal = leg.registryAddress.toLowerCase() !== daaRegistryAddress.toLowerCase()}
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-text font-medium truncate">{leg.title}</span>
									<span class="px-1.5 py-0.5 rounded text-xs {leg.relationType === RELATION_GOVERNS ? 'bg-primary/20 text-primary' : leg.relationType === RELATION_IMPLEMENTS ? 'bg-blue-900/30 text-blue-300' : leg.relationType === RELATION_REFERENCES ? 'bg-yellow-900/30 text-yellow-300' : 'bg-surface text-text-muted'}">
										{RELATION_LABELS[leg.relationType]}
									</span>
								</div>
								<div class="text-text-muted mt-0.5">
									Cat {leg.categoryId} / Doc {leg.documentId} v{leg.version}
									<span class="mx-1">·</span>
									Registry:
									{#if isExternal}
										<span class="font-mono">{leg.registryAddress.slice(0, 6)}…{leg.registryAddress.slice(-4)}</span>
										<span class="ml-1 text-text-muted/70">(external)</span>
									{:else}
										<span>Local</span>
									{/if}
								</div>
								{#if leg.relationType === RELATION_GOVERNS || leg.relationType === RELATION_IMPLEMENTS}
									<select
										value={leg.include}
										onchange={(e) => setInclude(i, (e.target as HTMLSelectElement).value as PickedRegistryLaw['include'])}
										class="mt-1 bg-surface border border-border rounded px-2 py-0.5 text-xs text-text"
									>
										<option value="text">Include full text</option>
										<option value="citation">Include citation only</option>
									</select>
								{/if}
							{/if}
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button
								onclick={() => moveLegislation(i, -1)}
								disabled={i === 0}
								aria-label="Move up"
								class="text-text-secondary hover:text-text text-xs px-1 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
							>↑</button>
							<button
								onclick={() => moveLegislation(i, 1)}
								disabled={i === selectedLegislation.length - 1}
								aria-label="Move down"
								class="text-text-secondary hover:text-text text-xs px-1 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
							>↓</button>
							<button
								onclick={() => removeLegislation(i)}
								class="text-red-400 hover:text-red-300 text-xs px-2 cursor-pointer"
							>
								Remove
							</button>
						</div>
					</div>
				{/each}
			</div>
			{#if codificationOverlap.length > 0}
				<div class="text-xs text-amber-300 bg-amber-900/20 border border-amber-800/40 rounded p-2 mt-2">
					<p class="font-medium mb-1">Notice — overlapping selections</p>
					<p class="text-amber-200/80 mb-1">You have selected both a Codification and its underlying lineage. These may contain overlapping provisions.</p>
					<ul class="list-disc pl-4">
						{#each codificationOverlap as line}
							<li>{line}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>
