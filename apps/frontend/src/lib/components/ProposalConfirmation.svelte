<script lang="ts">
	import ContentUriLink from '$lib/components/ContentUriLink.svelte';
	import ExplorerLink from '$lib/components/ExplorerLink.svelte';

	export interface ProposalConfirmationData {
		txHash: string;
		contentUri: string;
		proposalId: number;
		title: string;
		category: string;
		documentId: number;
		docTypeName: string;
		refSummary: string;
		strategy: string;
	}

	interface Props {
		data: ProposalConfirmationData;
		chainId: number;
		onReset: () => void;
	}

	let { data, chainId, onReset }: Props = $props();
</script>

<div class="border border-success/40 rounded-lg p-6">
	<h2 class="text-lg font-medium text-success mb-4">Proposal Created</h2>

	<div class="flex flex-col gap-3 text-sm">
		<div>
			<span class="text-text-muted">Title:</span>
			<span class="ml-2">{data.title}</span>
		</div>
		<div>
			<span class="text-text-muted">Category:</span>
			<span class="ml-2">{data.category}</span>
		</div>
		<div>
			<span class="text-text-muted">Type:</span>
			<span class="ml-2">{data.docTypeName}</span>
		</div>
		<div>
			<span class="text-text-muted">Proposal ID:</span>
			<span class="ml-2 font-mono">{data.proposalId}</span>
		</div>
		<div>
			<span class="text-text-muted">Strategy:</span>
			<span class="ml-2">{data.strategy}</span>
		</div>
		{#if data.refSummary}
			<div>
				<span class="text-text-muted">References:</span>
				<span class="ml-2">{data.refSummary}</span>
			</div>
		{/if}
		<div>
			<span class="text-text-muted">Transaction:</span>
			<span class="ml-2 text-xs">
				<ExplorerLink
					{chainId}
					tx={data.txHash}
					label={`${data.txHash.slice(0, 10)}...${data.txHash.slice(-8)}`}
				/>
			</span>
		</div>
		<div>
			<span class="text-text-muted">Arweave:</span>
			<span class="ml-2 text-xs"><ContentUriLink uri={data.contentUri} /></span>
		</div>
	</div>

	<p class="text-text-secondary text-sm mt-4">
		Members can now vote on this proposal on the Vote page.
	</p>

	<div class="flex gap-3 mt-6">
		<a
			href="/vote"
			class="text-sm px-4 py-1.5 rounded bg-primary hover:bg-primary-hover text-text transition-colors"
		>
			Vote on the Proposal
		</a>
		<button
			onclick={onReset}
			class="text-sm px-4 py-1.5 rounded border border-border hover:bg-bg-lighter text-text-secondary transition-colors cursor-pointer"
		>
			Propose Another
		</button>
	</div>
</div>
