<script lang="ts">
	import '../app.css';
	import '$lib/services/wallet-config';
	import '$lib/services/markdown';
	import { wallet } from '$lib/stores/wallet';
	import { connectWallet, disconnectWallet } from '$lib/services/wallet-config';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { truncAddr } from '$lib/services/format';
	import Toaster from '$lib/components/Toaster.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children } = $props();

	const navItems = [
		{ href: '/', label: 'Home' },
		{ href: '/admin', label: 'Members' },
		{ href: '/propose', label: 'Propose' },
		{ href: '/vote', label: 'Vote' },
		{ href: '/contract', label: 'Contract' }
	];

	afterNavigate(() => {
		if (typeof window !== 'undefined') {
			window.scrollTo({ top: 0, left: 0 });
		}
	});
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/favicon.png" />
</svelte:head>

<div class="min-h-screen bg-bg text-text">
	<nav class="border-b border-border px-8 py-3 flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-6 ml-2">
			{#each navItems as item}
				<a
					href={item.href}
					class="text-sm font-medium transition-colors {$page.url.pathname === item.href
						? 'text-text'
						: 'text-text-secondary hover:text-text'}"
				>
					{item.label}
				</a>
			{/each}
		</div>

		<div>
			{#if $wallet.connected && $wallet.address}
				<div class="flex items-center gap-3">
					{#if $wallet.isTokenHolder}
						<span class="text-xs text-success">member</span>
					{/if}
					{#if $wallet.isAdmin}
						<span class="text-xs text-primary">admin</span>
					{/if}
					<span class="text-sm text-text-secondary">
						{truncAddr($wallet.address)}
					</span>
					<button
						onclick={() => disconnectWallet()}
						class="text-sm text-text-muted hover:text-text transition-colors cursor-pointer"
					>
						Disconnect
					</button>
				</div>
			{:else}
				<button
					onclick={() => connectWallet()}
					class="bg-primary hover:bg-primary-hover text-text text-sm px-4 py-1.5 rounded transition-colors cursor-pointer"
				>
					Connect Wallet
				</button>
			{/if}
		</div>
	</nav>

	<main class="max-w-4xl mx-auto px-6 py-8">
		{@render children()}
	</main>

	<Footer />
	<Toaster />
</div>
