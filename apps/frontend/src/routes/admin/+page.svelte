<script lang="ts">
	import { wallet } from '$lib/stores/wallet';
	import { writeContract, waitForTransactionReceipt } from '@wagmi/core';
	import { config, checkRoles } from '$lib/services/wallet-config';
	import { daaTokenConfig } from '$lib/contracts';
	import MintForm from '$lib/components/MintForm.svelte';
	import MemberList from '$lib/components/MemberList.svelte';
	import LoadingButton from '$lib/components/LoadingButton.svelte';
	import { showToast } from '$lib/stores/toasts';

	let refreshKey = $state(0);
	let memberList = $state<ReturnType<typeof MemberList>>();
	let burning = $state(false);

	async function handleBurn() {
		if (!$wallet.address || !memberList) return;
		const tokenId = memberList.getTokenId($wallet.address);
		if (tokenId === null) {
			showToast('error', 'Could not find your token.');
			return;
		}
		if (!confirm('This is irreversible. You will lose your voting rights and membership. Continue?')) return;

		burning = true;

		try {
			const txHash = await writeContract(config, {
				...daaTokenConfig,
				functionName: 'burn',
				args: [tokenId]
			});
			await waitForTransactionReceipt(config, { hash: txHash });
			showToast('success', 'Your membership token has been burned.');
			if ($wallet.address) await checkRoles($wallet.address);
			refreshKey++;
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Burn failed';
			if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('denied')) {
				showToast('error', 'Transaction was rejected in wallet.');
			} else {
				showToast('error', msg);
			}
		} finally {
			burning = false;
		}
	}
</script>

<div>
	<h1 class="text-2xl font-semibold mb-6">Members</h1>

	<div class="flex flex-col gap-8">
		{#if $wallet.connected}
			<div class="border border-border rounded-lg p-5">
				<MintForm onminted={() => refreshKey++} />
			</div>
		{:else}
			<div class="border border-border rounded-lg p-4 text-center">
				<p class="text-text-muted text-sm">Connect your wallet to join the association.</p>
			</div>
		{/if}
		{#key refreshKey}
			<MemberList bind:this={memberList} />
		{/key}

		{#if $wallet.connected && $wallet.isTokenHolder}
			<div class="border border-error/30 rounded-lg p-5">
				<h2 class="text-lg font-medium mb-2">Resign Membership</h2>
				<p class="text-text-muted text-sm mb-4">Burn your membership token to leave the association. This is irreversible.</p>
				<LoadingButton
					onclick={handleBurn}
					loading={burning}
					loadingLabel="Burning..."
					variant="none"
					class="bg-error/80 hover:bg-error px-5 font-medium"
				>
					Burn Token &amp; Resign
				</LoadingButton>
			</div>
		{/if}
	</div>
</div>
