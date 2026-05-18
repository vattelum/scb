<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fetchFromArweave } from '$lib/services/arweave';
	import ActiveProposalCard from '$lib/components/ActiveProposalCard.svelte';
	import PassedProposalCard from '$lib/components/PassedProposalCard.svelte';
	import { renderSectionedMarkdown } from '$lib/services/markdown';
	import { loadCategories, loadDocuments } from '$lib/services/registry';
	import { wallet } from '$lib/stores/wallet';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { docTypeLabel } from '$lib/constants/docTypes';
	import { parseVariableSchema, type TemplateVariable } from '$lib/services/template-variables';
	import { stripFrontmatter } from '$lib/services/format';
	import {
		getProposals,
		getApprovalThreshold,
		getParticipationQuorum,
		getTotalSupply,
		hasVoted as checkHasVoted,
		vote as castVote,
		execute as executeProposal,
		ProposalStatus,
		VoteChoice,
		statusLabel,
		statusClass,
		approvalVotesNeeded,
		participationVotesNeeded,
		type ProposalInfo,
		type RestrictionMetadata,
		type StrategyQuorums
	} from '$lib/services/snapshot-x';
	import { normalStrategyAddress, coreStrategyAddress } from '$lib/contracts';
	import { chainIdToBlockTime } from '$lib/constants/networks';
	import { showToast } from '$lib/stores/toasts';

	// Per-chain average block time — Sepolia/Mainnet ~12s, Base/Polygon ~2s,
	// Arbitrum ~0.25s. Hardcoding 12 here would make the /vote countdown wrong
	// by Nx on any non-Ethereum-style chain.
	const BLOCK_TIME_SECONDS = chainIdToBlockTime(Number(import.meta.env.VITE_CHAIN_ID));

	interface ProposalCard extends ProposalInfo {
		categoryName: string;
		documentLabel: string;
		userVoted: boolean;
		htmlContent: string;
		templateVariables: TemplateVariable[];
		fetching: boolean;
		fetched: boolean;
	}

	let loading = $state(true);
	let error = $state('');
	let activeProposals = $state<ProposalCard[]>([]);
	let passedProposals = $state<ProposalCard[]>([]);
	let historyProposals = $state<ProposalCard[]>([]);
	let expandedId = $state<number | null>(null);
	let historyExpanded = $state(false);
	let historyLoaded = $state(false);

	let totalSupply = $state(0n);
	let normalApproval = $state(0);
	let coreApproval = $state(0);
	let normalParticipation = $state(0);
	let coreParticipation = $state(0);
	let currentBlock = $state(0);

	const quorums = $derived<StrategyQuorums>({
		approvalPct: {
			[normalStrategyAddress.toLowerCase()]: normalApproval,
			[coreStrategyAddress.toLowerCase()]: coreApproval
		},
		participationPct: {
			[normalStrategyAddress.toLowerCase()]: normalParticipation,
			[coreStrategyAddress.toLowerCase()]: coreParticipation
		}
	});

	let votingId = $state<number | null>(null);
	let executingId = $state<number | null>(null);

	let categoryNames = $state<Record<number, string>>({});
	let documentTitles = $state<Record<string, string>>({});
	let tickNow = $state(Date.now());
	let tickInterval: ReturnType<typeof setInterval> | null = null;
	let blockRefreshInterval: ReturnType<typeof setInterval> | null = null;
	let blockFetchedAt = $state(0);


	function formatRestrictions(r: RestrictionMetadata): string {
		const isEntire = r.lockedSections.includes(0);
		const hasTimeLock = r.minTimeBetweenAmendments > 0;
		const days = Math.round(r.minTimeBetweenAmendments / 86400);

		const scope = isEntire
			? 'Document locked'
			: r.lockedSections.length > 0
				? `\u00A7${r.lockedSections.join(', \u00A7')} locked`
				: '';

		if (scope && hasTimeLock) return `${scope}, ${days}-day interval`;
		if (scope) return scope;
		if (hasTimeLock) return `${days}-day interval`;
		return '';
	}

	/** Estimated seconds remaining until a given block, calibrated against last block fetch. */
	function secondsUntilBlock(blockNumber: number): number {
		if (currentBlock <= 0) return 0;
		const elapsed = (tickNow - blockFetchedAt) / 1000;
		const blockSeconds = (blockNumber - currentBlock) * BLOCK_TIME_SECONDS;
		return Math.max(0, blockSeconds - elapsed);
	}

	function blockToGMT(blockNumber: number): string {
		if (currentBlock <= 0) return `Block ${blockNumber}`;
		const remaining = secondsUntilBlock(blockNumber);
		const date = new Date(tickNow + remaining * 1000);
		const day = String(date.getUTCDate()).padStart(2, '0');
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const hours = String(date.getUTCHours()).padStart(2, '0');
		const mins = String(date.getUTCMinutes()).padStart(2, '0');
		return `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${hours}:${mins} GMT`;
	}

	function timeRemaining(blockNumber: number): string {
		if (currentBlock <= 0) return '';
		const totalSeconds = secondsUntilBlock(blockNumber);
		if (totalSeconds <= 0) return 'ended';
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = Math.floor(totalSeconds % 60);
		const parts: string[] = [];
		if (days > 0) parts.push(`${days}d`);
		if (hours > 0) parts.push(`${hours}h`);
		if (minutes > 0) parts.push(`${minutes}m`);
		if (days === 0) parts.push(`${seconds}s`);
		if (parts.length === 0) parts.push('0s');
		return parts.join(' ');
	}

	function buildCard(p: ProposalInfo, voted: boolean): ProposalCard {
		const catName = p.metadata ? (categoryNames[p.metadata.categoryId] ?? `Category ${p.metadata.categoryId}`) : 'Unknown';
		let docLabel = '';
		if (p.metadata) {
			if (p.metadata.documentId === 0) {
				docLabel = `New document in ${catName}`;
			} else {
				const titleKey = `${p.metadata.categoryId}-${p.metadata.documentId}`;
				const docTitle = documentTitles[titleKey];
				docLabel = docTitle
					? `${docTypeLabel(p.metadata.docType)} \u2014 ${catName}, Doc ${p.metadata.documentId}: ${docTitle}`
					: `${docTypeLabel(p.metadata.docType)} \u2014 ${catName}, Doc ${p.metadata.documentId}`;
			}
		}
		return {
			...p,
			categoryName: catName,
			documentLabel: docLabel,
			userVoted: voted,
			htmlContent: '',
			templateVariables: [],
			fetching: false,
			fetched: false
		};
	}

	async function loadPage() {
		try {
			// Load categories for name mapping
			const cats = await loadCategories();
			const names: Record<number, string> = {};
			for (const c of cats) names[c.id] = c.name;
			categoryNames = names;

			// Load governance data in parallel
			const [allProposals, supply, na, ca, np, cp] = await Promise.all([
				getProposals(),
				getTotalSupply(),
				getApprovalThreshold(normalStrategyAddress),
				getApprovalThreshold(coreStrategyAddress),
				getParticipationQuorum(normalStrategyAddress),
				getParticipationQuorum(coreStrategyAddress)
			]);

			totalSupply = supply;
			normalApproval = na;
			coreApproval = ca;
			normalParticipation = np;
			coreParticipation = cp;

			// Get current block
			const client = (await import('$lib/services/wallet-config')).getClient();
			if (client) {
				const block = await client.getBlockNumber();
				currentBlock = Number(block);
				blockFetchedAt = Date.now();
			}

			// Load document titles for amendments (documentId > 0)
			const amendedDocs = new Set<string>();
			for (const p of allProposals) {
				if (p.metadata && p.metadata.documentId > 0) {
					amendedDocs.add(`${p.metadata.categoryId}-${p.metadata.documentId}`);
				}
			}
			if (amendedDocs.size > 0) {
				const titles: Record<string, string> = {};
				for (const key of amendedDocs) {
					const [catId, docId] = key.split('-').map(Number);
					try {
						const docs = await loadDocuments(catId);
						const doc = docs.find(d => d.documentId === docId);
						if (doc) titles[key] = doc.latestTitle;
					} catch { /* skip */ }
				}
				documentTitles = titles;
			}

			// Check voted status for active proposals if wallet connected
			const active = allProposals.filter(p =>
				p.status === ProposalStatus.VotingPeriod ||
				p.status === ProposalStatus.VotingPeriodAccepted ||
				p.status === ProposalStatus.VotingDelay
			);
			const passed = allProposals.filter(p => p.status === ProposalStatus.Accepted);
			const history = allProposals.filter(p =>
				p.status === ProposalStatus.Executed ||
				p.status === ProposalStatus.Rejected ||
				p.status === ProposalStatus.Cancelled
			);

			let votedMap: Record<number, boolean> = {};
			if ($wallet.connected && $wallet.address) {
				const checks = await Promise.all(
					active.map(p => checkHasVoted(p.proposalId, $wallet.address!).catch(() => false))
				);
				active.forEach((p, i) => { votedMap[p.proposalId] = checks[i]; });
			}

			activeProposals = active.map(p => buildCard(p, votedMap[p.proposalId] ?? false));
			passedProposals = passed.map(p => buildCard(p, false));
			historyProposals = history.map(p => buildCard(p, false));
			historyLoaded = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load proposals';
		} finally {
			loading = false;
		}
	}

	function toggleExpand(proposalId: number) {
		if (expandedId === proposalId) {
			expandedId = null;
			return;
		}
		expandedId = proposalId;
		// Fetch document content if not already loaded
		const card = [...activeProposals, ...passedProposals, ...historyProposals].find(p => p.proposalId === proposalId);
		if (card && !card.fetched && !card.fetching && card.metadata?.contentUri) {
			fetchDocument(proposalId, card.metadata.contentUri);
		}
	}

	async function fetchDocument(proposalId: number, contentUri: string) {
		const updateCard = (list: ProposalCard[], update: Partial<ProposalCard>): ProposalCard[] =>
			list.map(p => p.proposalId === proposalId ? { ...p, ...update } : p);

		activeProposals = updateCard(activeProposals, { fetching: true });
		passedProposals = updateCard(passedProposals, { fetching: true });
		historyProposals = updateCard(historyProposals, { fetching: true });

		try {
			const card = [...activeProposals, ...passedProposals, ...historyProposals].find(p => p.proposalId === proposalId);
			const contentHash = card?.metadata?.contentHash ?? '';
			const text = await fetchFromArweave(contentUri, contentHash);
			const body = stripFrontmatter(text);
			const html = await renderSectionedMarkdown(body, contentHash || undefined);
			const vars = parseVariableSchema(text);
			const update = { htmlContent: html, templateVariables: vars, fetching: false, fetched: true };
			activeProposals = updateCard(activeProposals, update);
			passedProposals = updateCard(passedProposals, update);
			historyProposals = updateCard(historyProposals, update);
		} catch {
			const update = {
				htmlContent: '<p class="text-text-muted">Content unavailable. The document may still be confirming on Arweave.</p>',
				fetching: false,
				fetched: true
			};
			activeProposals = updateCard(activeProposals, update);
			passedProposals = updateCard(passedProposals, update);
			historyProposals = updateCard(historyProposals, update);
		}
	}

	async function handleVote(proposalId: number, choice: VoteChoice) {
		if (!$wallet.address) return;
		votingId = proposalId;

		try {
			await castVote($wallet.address, proposalId, choice);
			showToast('success', `Vote recorded on proposal #${proposalId}.`);
			// Update card state
			activeProposals = activeProposals.map(p =>
				p.proposalId === proposalId ? { ...p, userVoted: true } : p
			);
			// Refresh vote counts
			await loadPage();
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Vote failed';
			if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('denied')) {
				showToast('error', 'Transaction was rejected in wallet.');
			} else if (msg.toLowerCase().includes('already voted')) {
				showToast('error', 'You have already voted on this proposal.');
				activeProposals = activeProposals.map(p =>
					p.proposalId === proposalId ? { ...p, userVoted: true } : p
				);
			} else {
				showToast('error', msg);
			}
		} finally {
			votingId = null;
		}
	}

	async function handleExecute(proposal: ProposalCard) {
		if (proposal.status !== ProposalStatus.Accepted) return;
		executingId = proposal.proposalId;

		try {
			const txHash = await executeProposal(proposal.proposalId, proposal.executionPayload);
			showToast('success', `Proposal #${proposal.proposalId} executed. Tx: ${txHash.slice(0, 10)}...`);
			await loadPage();
		} catch (e) {
			showToast('error', e instanceof Error ? e.message : 'Execution failed');
		} finally {
			executingId = null;
		}
	}

	onMount(() => {
		loadPage();
		// Live countdown — tick every second
		tickInterval = setInterval(() => { tickNow = Date.now(); }, 1000);
		// Refresh block number once per chain block to recalibrate. Hardcoding
		// 12_000ms here would be 6× too slow on Polygon/Base and 48× too slow
		// on Arbitrum.
		blockRefreshInterval = setInterval(async () => {
			try {
				const client = (await import('$lib/services/wallet-config')).getClient();
				if (client) {
					const prevBlock = currentBlock;
					const block = await client.getBlockNumber();
					currentBlock = Number(block);
					blockFetchedAt = Date.now();
					// Re-fetch proposals when any active proposal's voting period has ended
					if (activeProposals.length > 0 && prevBlock > 0) {
						const anyEnded = activeProposals.some(p => currentBlock >= p.maxEndBlockNumber);
						if (anyEnded) loadPage();
					}
				}
			} catch { /* skip */ }
		}, Math.max(1000, BLOCK_TIME_SECONDS * 1000));
	});

	onDestroy(() => {
		if (tickInterval) clearInterval(tickInterval);
		if (blockRefreshInterval) clearInterval(blockRefreshInterval);
	});
</script>

<div>
	<h1 class="text-2xl font-semibold mb-6">Governance <Tooltip text={"View active proposals, cast your vote, and execute passed legislation. All voting happens on-chain via Snapshot X. Each vote is a transaction — voters pay gas."} align="left"><span class="text-sm font-normal text-text-muted cursor-help">(?)</span></Tooltip></h1>

	{#if loading}
		<p class="text-text-secondary">Loading proposals...</p>
	{:else if error}
		<p class="text-error">{error}</p>
	{:else}
		<!-- Active Proposals -->
		<section class="mb-8">
			<h2 class="text-lg font-medium mb-4">Active Proposals <Tooltip text={"Proposals currently open for voting. Each member casts one vote (For, Against, or Abstain) per proposal. Voting is on-chain — each vote is a transaction."} align="left"><span class="text-sm font-normal text-text-muted cursor-help">(?)</span></Tooltip></h2>
			{#if activeProposals.length === 0}
				<p class="text-text-muted text-sm">No active proposals.</p>
			{:else}
				<div class="flex flex-col gap-4">
					{#each activeProposals as proposal}
						<ActiveProposalCard
							{proposal}
							isExpanded={expandedId === proposal.proposalId}
							{votingId}
							approvalNeeded={approvalVotesNeeded(proposal.executionStrategy, totalSupply, quorums)}
							quorumNeeded={participationVotesNeeded(proposal.executionStrategy, totalSupply, quorums)}
							{totalSupply}
							{quorums}
							restrictionsText={proposal.metadata?.restrictions ? formatRestrictions(proposal.metadata.restrictions) : ''}
							timeRemainingText={timeRemaining(proposal.maxEndBlockNumber)}
							blockEndText={blockToGMT(proposal.maxEndBlockNumber)}
							onToggleExpand={() => toggleExpand(proposal.proposalId)}
							onVote={(choice) => handleVote(proposal.proposalId, choice)}
						/>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Passed Proposals (ready to execute) -->
		<section class="mb-8">
			<h2 class="text-lg font-medium mb-4">Ready to Execute <Tooltip text={"These proposals passed the vote. Any connected wallet can execute them, recording the ratified document on-chain via: Snapshot X \u2192 Gnosis Safe \u2192 DAARegistry."} align="left"><span class="text-sm font-normal text-text-muted cursor-help">(?)</span></Tooltip></h2>
			{#if passedProposals.length === 0}
				<p class="text-text-muted text-sm">No proposals awaiting execution.</p>
			{:else}
				<div class="flex flex-col gap-4">
					{#each passedProposals as proposal}
						<PassedProposalCard
							{proposal}
							isExpanded={expandedId === proposal.proposalId}
							{executingId}
							approvalNeeded={approvalVotesNeeded(proposal.executionStrategy, totalSupply, quorums)}
							restrictionsText={proposal.metadata?.restrictions ? formatRestrictions(proposal.metadata.restrictions) : ''}
							onToggleExpand={() => toggleExpand(proposal.proposalId)}
							onExecute={() => handleExecute(proposal)}
						/>
					{/each}
				</div>
			{/if}
		</section>

		<!-- History (collapsible) -->
		{#if historyProposals.length > 0}
			<section>
				<button
					onclick={() => historyExpanded = !historyExpanded}
					class="flex items-center gap-2 text-lg font-medium cursor-pointer mb-4"
				>
					<span>History</span>
					<span class="text-text-muted text-xs">({historyProposals.length})</span>
					<span class="text-text-muted text-xs transition-transform {historyExpanded ? 'rotate-180' : ''}">&#9660;</span>
				</button>

				{#if historyExpanded}
					<div class="flex flex-col gap-1">
						{#each historyProposals as proposal}
							<div class="flex items-center justify-between px-4 py-2 rounded border border-border bg-bg-light">
								<div class="flex items-center gap-3">
									<span class="font-mono text-text-muted text-xs w-6 text-right">#{proposal.proposalId}</span>
									<span class="text-sm">{proposal.metadata?.title ?? `Proposal #${proposal.proposalId}`}</span>
									<span class="text-xs {statusClass(proposal.status)}">{statusLabel(proposal.status)}</span>
								</div>
								<div class="flex items-center gap-3 text-xs text-text-muted">
									{#if proposal.documentLabel}<span>{proposal.documentLabel}</span>{/if}
									<span>For: {Number(proposal.votesFor)} / Against: {Number(proposal.votesAgainst)}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		<!-- Empty state -->
		{#if activeProposals.length === 0 && passedProposals.length === 0 && historyProposals.length === 0}
			<div class="text-center py-12">
				<p class="text-text-muted">No proposals have been created yet.</p>
				{#if $wallet.isTokenHolder}
					<p class="text-text-muted text-sm mt-2">
						<a href="/propose" class="text-primary hover:underline">Create the first proposal</a>
					</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
