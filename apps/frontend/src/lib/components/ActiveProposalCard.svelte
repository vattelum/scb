<script lang="ts" module>
	import type { ProposalStatus as PS, RestrictionMetadata } from '#lib/services/snapshot-x.ts';
	import type { TemplateVariable } from '#lib/services/template-variables.ts';

	/**
	 * Enriched proposal shape used by /vote's card components. Extends the raw
	 * ProposalInfo from snapshot-x with per-card UI state (expanded document
	 * body, fetch flags, derived display labels). Exported here so /vote and
	 * PassedProposalCard share the same type.
	 */
	export interface ProposalCardData {
		proposalId: number;
		author: string;
		status: PS;
		executionStrategy: string;
		executionPayload: `0x${string}`;
		maxEndBlockNumber: number;
		votesFor: bigint;
		votesAgainst: bigint;
		votesAbstain: bigint;
		metadata: {
			title: string;
			categoryId: number;
			documentId: number;
			docType: number;
			contentUri: string;
			contentHash: string;
			restrictions: RestrictionMetadata | null;
		} | null;
		categoryName: string;
		documentLabel: string;
		userVoted: boolean;
		htmlContent: string;
		templateVariables: TemplateVariable[];
		fetching: boolean;
		fetched: boolean;
	}
</script>

<script lang="ts">
	import { wallet } from '#lib/stores/wallet.ts';
	import ContentUriLink from './ContentUriLink.svelte';
	import { truncAddr } from '#lib/services/format.ts';
	import {
		ProposalStatus,
		VoteChoice,
		statusLabel,
		statusClass,
		strategyLabel,
		tallyBar,
		votingContext,
		votingContextClass,
		type StrategyQuorums
	} from '#lib/services/snapshot-x.ts';

	let {
		proposal,
		isExpanded,
		votingId,
		approvalNeeded,
		quorumNeeded,
		totalSupply,
		quorums,
		restrictionsText,
		timeRemainingText,
		blockEndText,
		onToggleExpand,
		onVote
	}: {
		proposal: ProposalCardData;
		isExpanded: boolean;
		votingId: number | null;
		approvalNeeded: bigint;
		quorumNeeded: bigint;
		totalSupply: bigint;
		quorums: StrategyQuorums;
		restrictionsText: string;
		timeRemainingText: string;
		blockEndText: string;
		onToggleExpand: () => void;
		onVote: (choice: VoteChoice) => void;
	} = $props();

	const tally = $derived(tallyBar(proposal.votesFor, proposal.votesAgainst, proposal.votesAbstain));
	const totalVotes = $derived(proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain);
</script>

<div class="border border-border rounded-lg bg-bg-light">
	<!-- Card header — always visible -->
	<div class="px-5 py-4">
		<div class="flex items-start justify-between gap-4 mb-3">
			<div>
				<div class="flex items-center gap-2 mb-1">
					<span class="font-mono text-text-muted text-xs">#{proposal.proposalId}</span>
					<span class="text-sm font-medium {statusClass(proposal.status)}">{statusLabel(proposal.status)}</span>
					<span class="text-xs {votingContextClass(proposal, totalSupply, quorums)}">{votingContext(proposal, totalSupply, quorums)}</span>
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

		<!-- Vote tally bar -->
		<div class="mt-3">
			<div class="flex h-2 rounded-full overflow-hidden bg-bg-lighter">
				{#if tally.forPct > 0}
					<div class="bg-success" style="width: {tally.forPct}%"></div>
				{/if}
				{#if tally.againstPct > 0}
					<div class="bg-error" style="width: {tally.againstPct}%"></div>
				{/if}
				{#if tally.abstainPct > 0}
					<div class="bg-text-muted" style="width: {tally.abstainPct}%"></div>
				{/if}
			</div>
			<div class="flex items-center justify-between mt-2 text-xs">
				<div class="flex gap-4">
					<span class="text-success">For: {Number(proposal.votesFor)}</span>
					<span class="text-error">Against: {Number(proposal.votesAgainst)}</span>
					<span class="text-text-muted">Abstain: {Number(proposal.votesAbstain)}</span>
				</div>
				<span class="text-text-muted">
					Approval: {Number(proposal.votesFor)}/{Number(approvalNeeded)} needed{#if quorumNeeded > 0n} · Quorum: {Number(totalVotes)}/{Number(quorumNeeded)} voted{/if}
				</span>
			</div>
		</div>

		<!-- Timing -->
		<div class="flex items-center gap-4 mt-2 text-xs text-text-muted">
			<span>Author: {truncAddr(proposal.author)}</span>
			<span>Ends in: {timeRemainingText} ({blockEndText})</span>
		</div>

		<!-- Voting controls — always visible on card -->
		{#if proposal.status === ProposalStatus.VotingPeriod || proposal.status === ProposalStatus.VotingPeriodAccepted}
			<div class="mt-4 pt-3 border-t border-border">
				{#if !$wallet.connected}
					<p class="text-text-muted text-sm">Connect your wallet to vote.</p>
				{:else if !$wallet.isTokenHolder}
					<p class="text-text-muted text-sm">
						<a href="/admin" class="text-primary hover:underline">Join the association</a> to vote.
					</p>
				{:else if proposal.userVoted}
					<p class="text-text-secondary text-sm">You have voted on this proposal.</p>
				{:else}
					<div class="flex items-center gap-3">
						<span class="text-sm text-text-secondary mr-2">Cast your vote:</span>
						<button
							onclick={() => onVote(VoteChoice.For)}
							disabled={votingId !== null}
							class="px-4 py-1.5 rounded text-sm font-medium bg-success/20 text-success hover:bg-success/30 transition-colors cursor-pointer disabled:opacity-50"
						>
							{votingId === proposal.proposalId ? 'Voting...' : 'For'}
						</button>
						<button
							onclick={() => onVote(VoteChoice.Against)}
							disabled={votingId !== null}
							class="px-4 py-1.5 rounded text-sm font-medium bg-error/20 text-error hover:bg-error/30 transition-colors cursor-pointer disabled:opacity-50"
						>
							Against
						</button>
						<button
							onclick={() => onVote(VoteChoice.Abstain)}
							disabled={votingId !== null}
							class="px-4 py-1.5 rounded text-sm font-medium bg-bg-lighter text-text-muted hover:bg-border transition-colors cursor-pointer disabled:opacity-50"
						>
							Abstain
						</button>
					</div>
				{/if}
			</div>
		{/if}
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
