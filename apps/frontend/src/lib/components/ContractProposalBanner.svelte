<script lang="ts">
	import LoadingButton from '#lib/components/LoadingButton.svelte';
	import { truncAddr, formatDate } from '#lib/services/format.ts';
	import { isProposalRipe, type Proposal } from '#lib/services/contract-registry.ts';

	// Actions split by viewer identity:
	// - Proposer: Cancel proposal.
	// - Non-proposer signatory who hasn't accepted: Accept now + Reject.
	// - Non-proposer signatory who has accepted: indicator only (no action).
	// - Any signatory once the 30-day window elapses: Finalize.
	// Dispute is intentionally absent from the banner — it lives only as the
	// posture-level action in the footer Contract Actions card.

	type Props = {
		proposal: Proposal;
		label: string;
		viewIsSignatory: boolean;
		currentAddress: string | null;
		selfAccepted: boolean;
		acceptCount: bigint;
		signatoryCount: number;
		loading: boolean;
		onCancel: () => void;
		onAccept: () => void;
		onReject: () => void;
		onFinalize: () => void;
	};

	let {
		proposal,
		label,
		viewIsSignatory,
		currentAddress,
		selfAccepted,
		acceptCount,
		signatoryCount,
		loading,
		onCancel,
		onAccept,
		onReject,
		onFinalize
	}: Props = $props();

	const ripe = $derived(isProposalRipe(proposal));
	const daysLeft = $derived(
		Math.max(
			0,
			Math.ceil(Number(proposal.noticeExpiresAt - BigInt(Math.floor(Date.now() / 1000))) / 86400)
		)
	);
	const isProposer = $derived(
		!!currentAddress && proposal.proposer.toLowerCase() === currentAddress.toLowerCase()
	);
	const nonProposerTotal = $derived(Math.max(0, signatoryCount - 1));
</script>

<div class="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
	<div class="flex items-start justify-between gap-3 mb-2">
		<div>
			<div class="text-sm font-medium text-yellow-200">{label} proposed</div>
			<div class="text-xs text-yellow-300 mt-1">
				By <span class="font-mono">{truncAddr(proposal.proposer)}</span> on {formatDate(proposal.proposedAt)}
			</div>
		</div>
		<span class="text-xs text-yellow-200 bg-yellow-900/50 px-2 py-0.5 rounded">
			{ripe ? 'Window elapsed' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`}
		</span>
	</div>
	{#if viewIsSignatory}
		<div class="flex gap-2 flex-wrap mt-3">
			{#if isProposer}
				<LoadingButton onclick={onCancel} {loading} loadingLabel="Cancelling..." variant="secondary">
					Cancel proposal
				</LoadingButton>
			{:else if selfAccepted}
				<span class="text-xs text-green-300 self-center">You have accepted — waiting on others.</span>
			{:else}
				<LoadingButton onclick={onAccept} {loading} loadingLabel="Accepting..." variant="primary">
					Accept now
				</LoadingButton>
				<LoadingButton onclick={onReject} {loading} loadingLabel="Rejecting..." variant="secondary">
					Reject
				</LoadingButton>
			{/if}
			{#if ripe}
				<LoadingButton onclick={onFinalize} {loading} loadingLabel="Finalizing..." variant="primary">
					Finalize {label}
				</LoadingButton>
			{/if}
		</div>
		{#if nonProposerTotal > 1}
			<p class="text-xs text-yellow-300/80 mt-2">
				{acceptCount} of {nonProposerTotal} non-proposer signatories accepted.
			</p>
		{/if}
	{/if}
</div>
