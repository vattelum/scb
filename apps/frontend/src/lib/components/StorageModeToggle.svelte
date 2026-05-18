<script lang="ts">
	let { hashOnly = $bindable() }: { hashOnly: boolean } = $props();
</script>

<div class="bg-surface border border-border rounded-lg p-3">
	<label class="flex items-start gap-2 cursor-pointer">
		<input type="checkbox" bind:checked={hashOnly} class="mt-1" />
		<span>
			<span class="text-sm text-text">Hash-only mode</span>
			<span class="block text-xs text-text-muted mt-0.5">
				Skip Arweave storage and ECIES encryption. The contract hash is recorded on-chain but the
				document content is only preserved in the downloaded .md file. Counterparties must import
				that file to read and sign. Use this when you prefer not to store encrypted content on a
				public network.
			</span>
		</span>
	</label>
</div>
