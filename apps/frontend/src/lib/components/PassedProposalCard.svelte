<script lang="ts">
	import { wallet } from '$lib/stores/wallet';
	import ContentUriLink from './ContentUriLink.svelte';
	import { statusLabel, strategyLabel } from '$lib/services/snapshot-x';
	import type { ProposalCardData } from './ActiveProposalCard.svelte';

	let {
		proposal,
		isExpanded,
		executingId,
		approvalNeeded,
		restrictionsText,
		onToggleExpand,
		onExecute
	}: {
		proposal: ProposalCardData;
		isExpanded: boolean;
		executingId: number | null;
		approvalNeeded: bigint;
		restrictionsText: string;
		onToggleExpand: () => void;
		onExecute: () => void;
	} = $props();
</script>

<div class="border border-cat-gold/40 rounded-lg bg-bg-light">
	<!-- Card header — always visible -->
	<div class="px-5 py-4">
		<div class="flex items-start justify-between gap-4 mb-2">
			<div>
				<div class="flex items-center gap-2 mb-1">
					<span class="font-mono text-text-muted text-xs">#{proposal.proposalId}</span>
					<span class="text-sm font-medium text-cat-gold">{statusLabel(proposal.status)}</span>
					<span class="text-xs text-text-muted">{strategyLabel(proposal.executionStrategy)}</span>
				</div>
				<h3 class="text-base font-medium">{proposal.metadata?.title ?? `Proposal #${proposal.proposalId}`}</h3>
				{#if proposal.documentLabel}
					<div class="flex items-center gap-3 mt-1">
						<span class="text-xs text-text-muted">{proposal.documentLabel}</span>
					</div>
				{/if}
				{#if restrictionsText}
					<div class="flex items-center gap-1 mt-1">
						<span class="text-xs text-cat-gold">Restrictions: {restrictionsText}</span>
					</div>
				{/if}
			</div>
		</div>

		<div class="flex items-center justify-between text-xs text-text-muted">
			<span>For: {Number(proposal.votesFor)} / Against: {Number(proposal.votesAgainst)} / Abstain: {Number(proposal.votesAbstain)}</span>
			<span>Approval: {Number(proposal.votesFor)}/{Number(approvalNeeded)}</span>
		</div>

		<!-- Execute button — always visible -->
		<div class="mt-4 pt-3 border-t border-border">
			{#if $wallet.connected}
				<button
					onclick={onExecute}
					disabled={executingId === proposal.proposalId}
					class="px-5 py-2 rounded text-sm font-medium bg-cat-gold/20 text-cat-gold hover:bg-cat-gold/30 transition-colors cursor-pointer disabled:opacity-50"
				>
					{executingId === proposal.proposalId ? 'Executing...' : 'Execute Proposal'}
				</button>
			{:else}
				<p class="text-text-muted text-sm">Connect your wallet to execute this proposal.</p>
			{/if}
		</div>
	</div>

	<!-- Document fold — click to expand/collapse -->
	<div class="border-t border-border">
		<button
			onclick={onToggleExpand}
			class="w-full text-left px-5 py-2 cursor-pointer flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
		>
			<span class="transition-transform {isExpanded ? 'rotate-180' : ''}">&#9660;</span>
			<span>{isExpanded ? 'Hide document' : 'View document'}</span>
		</button>
		{#if isExpanded}
			<div class="px-5 pb-4">
				{#if proposal.fetching}
					<p class="text-text-secondary text-sm">Loading document from permanent storage...</p>
				{:else if proposal.fetched}
					<div class="p-4 rounded bg-bg border border-border">
						<div class="doc-viewer prose prose-invert max-w-none text-sm">
							{@html proposal.htmlContent}
						</div>
						{#if proposal.templateVariables.length > 0}
							<details class="mt-3 pt-3 border-t border-border">
								<summary class="text-xs text-text-muted cursor-pointer hover:text-text-secondary">Template Variables ({proposal.templateVariables.length})</summary>
								<div class="mt-2 flex flex-col gap-1">
									{#each proposal.templateVariables as v}
										<div class="text-xs flex items-center gap-2">
											<span class="font-mono text-text-secondary">{v.name}</span>
											<span class="text-text-muted">{v.type}</span>
											{#if v.required}<span class="text-primary">required</span>{/if}
										</div>
									{/each}
								</div>
							</details>
						{/if}
						{#if proposal.metadata?.contentUri}
							<div class="mt-3 pt-3 border-t border-border text-xs text-text-muted">
								Content URI: <ContentUriLink uri={proposal.metadata.contentUri} />
							</div>
						{/if}
					</div>
				{:else if !proposal.metadata?.contentUri}
					<p class="text-text-muted text-sm">No document content available.</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
