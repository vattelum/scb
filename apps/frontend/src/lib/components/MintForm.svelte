<script lang="ts">
	import { onMount } from 'svelte';
	import { readContract, writeContract, waitForTransactionReceipt } from '@wagmi/core';
	import { config, checkRoles } from '$lib/services/wallet-config';
	import { daaTokenConfig, daaRegistryConfig, termsCategoryId, termsDocumentId } from '$lib/contracts';
	import { wallet } from '$lib/stores/wallet';
	import { toHex, formatEther } from 'viem';
	import { fetchFromArweave } from '$lib/services/arweave';
	import { wrapSections } from '$lib/services/markdown';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import LoadingButton from '$lib/components/LoadingButton.svelte';
	import { showToast } from '$lib/stores/toasts';

	let { onminted }: { onminted?: () => void } = $props();

	let credential = $state('');
	let showAdvanced = $state(false);
	let submitting = $state(false);
	// Inline error used only for pre-submit input validation.
	let error = $state('');
	let mintFee = $state<bigint>(0n);
	let loadingFee = $state(true);
	let alreadyMember = $state(false);
	let checkingMembership = $state(true);

	// Terms of membership
	let termsHtml = $state('');
	let termsTitle = $state('');
	let loadingTerms = $state(false);
	let termsExpanded = $state(false);
	let hasTerms = $state(termsCategoryId !== null && termsDocumentId !== null);

	async function loadMintFee() {
		try {
			mintFee = (await readContract(config, {
				...daaTokenConfig,
				functionName: 'mintFee'
			})) as bigint;
		} catch {
			mintFee = 0n;
		} finally {
			loadingFee = false;
		}
	}

	async function loadTerms() {
		if (!hasTerms) return;
		loadingTerms = true;
		try {
			const doc = (await readContract(config, {
				...daaRegistryConfig,
				functionName: 'getLatest',
				args: [BigInt(termsCategoryId!), BigInt(termsDocumentId!)]
			})) as { contentUri: string; contentHash: string; title: string };

			termsTitle = doc.title;
			const text = await fetchFromArweave(doc.contentUri, doc.contentHash);
			const bodyMatch = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
			const body = bodyMatch ? bodyMatch[1].trim() : text;
			termsHtml = DOMPurify.sanitize(wrapSections(await marked.parse(body)));
		} catch {
			// Terms not available — allow minting without them
			hasTerms = false;
		} finally {
			loadingTerms = false;
		}
	}

	async function checkMembership() {
		if (!$wallet.address) {
			alreadyMember = false;
			checkingMembership = false;
			return;
		}
		try {
			const balance = (await readContract(config, {
				...daaTokenConfig,
				functionName: 'balanceOf',
				args: [$wallet.address]
			})) as bigint;
			alreadyMember = balance > 0n;
		} catch {
			alreadyMember = false;
		} finally {
			checkingMembership = false;
		}
	}

	async function handleMint() {
		if (!$wallet.address) {
			error = 'Connect your wallet first.';
			return;
		}
		if (credential.length > 256) {
			error = 'Credential must be 256 characters or fewer.';
			return;
		}

		submitting = true;
		error = '';

		try {
			const credentialBytes = credential.trim()
				? toHex(new TextEncoder().encode(credential.trim()))
				: '0x';

			const txHash = await writeContract(config, {
				...daaTokenConfig,
				functionName: 'mint',
				args: [credentialBytes],
				value: mintFee
			});

			await waitForTransactionReceipt(config, { hash: txHash });

			showToast('success', 'Membership token minted to your wallet.');
			credential = '';
			showAdvanced = false;
			alreadyMember = true;
			if ($wallet.address) await checkRoles($wallet.address);
			onminted?.();
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Mint failed';
			const lower = msg.toLowerCase();
			if (lower.includes('already holds a token') || lower.includes('singletokenperaddress')) {
				showToast('error', 'Your wallet already holds a membership token.');
				alreadyMember = true;
			} else if (lower.includes('incorrectfee') || lower.includes('incorrect fee')) {
				showToast('error', 'Incorrect fee amount. Please ensure you send the exact minting fee.');
			} else if (lower.includes('gas limit') || lower.includes('reverted')) {
				showToast('error', 'Transaction reverted. Your wallet may already hold a token.');
			} else if (lower.includes('user rejected') || lower.includes('denied')) {
				showToast('error', 'Transaction was rejected in wallet.');
			} else {
				showToast('error', msg);
			}
		} finally {
			submitting = false;
		}
	}

	$effect(() => {
		if ($wallet.address) {
			checkingMembership = true;
			checkMembership();
		} else {
			alreadyMember = false;
			checkingMembership = false;
		}
	});

	$effect(() => {
		if (!showAdvanced) credential = '';
	});

	onMount(() => {
		loadMintFee();
		loadTerms();
	});
</script>

<div class="flex flex-col gap-4">
	<h2 class="text-lg font-medium">Join the Association <Tooltip text={"Minting a soulbound (non-transferable) ERC-721 token to your wallet. This token serves as verifiable on-chain proof of membership and grants you voting rights in governance proposals.\n\nThe token is locked at mint \u2014 it cannot be sold, transferred, or moved to another wallet. You can burn your own token to voluntarily renounce membership."} align="left"><span class="text-sm font-normal text-text-muted cursor-help">(?)</span></Tooltip></h2>

	{#if checkingMembership}
		<p class="text-text-muted text-sm">Checking membership status...</p>
	{:else if alreadyMember}
		<div class="border border-success/30 rounded p-4">
			<p class="text-success text-sm">You are a member of this association.</p>
		</div>
	{:else}
		<!-- Terms of membership -->
		{#if hasTerms && termsHtml}
			<div class="border border-border rounded-lg">
				<button
					onclick={() => termsExpanded = !termsExpanded}
					class="w-full flex items-center justify-between px-4 py-3 cursor-pointer text-left"
				>
					<span class="text-sm font-medium">Terms of Membership{termsTitle ? `: ${termsTitle}` : ''}</span>
					<span class="text-text-muted text-xs transition-transform {termsExpanded ? 'rotate-180' : ''}">&#9660;</span>
				</button>
				{#if termsExpanded}
					<div class="border-t border-border px-4 py-4 max-h-80 overflow-y-auto">
						<div class="doc-viewer prose prose-invert max-w-none text-sm">
							{@html termsHtml}
						</div>
					</div>
				{/if}
			</div>
			<p class="text-xs text-text-muted">By minting a membership token you accept the terms of membership.</p>
		{:else if hasTerms && loadingTerms}
			<p class="text-text-muted text-sm">Loading terms of membership...</p>
		{/if}

		{#if mintFee > 0n && !loadingFee}
			<p class="text-sm text-text-secondary">
				Minting fee: <span class="font-mono text-text">{formatEther(mintFee)} ETH</span>
			</p>
		{/if}

		{#if error}
			<p class="text-error text-sm">{error}</p>
		{/if}

		<LoadingButton
			onclick={handleMint}
			loading={submitting}
			loadingLabel="Minting..."
			disabled={!$wallet.connected}
			variant="primary"
			class="self-start px-5 font-medium"
		>
			{mintFee > 0n ? `Mint Token (${formatEther(mintFee)} ETH)` : 'Mint Token'}
		</LoadingButton>

		<div class="border-t border-border pt-3 flex flex-col gap-2">
			<label class="inline-flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
				<input
					type="checkbox"
					bind:checked={showAdvanced}
					class="cursor-pointer"
				/>
				Advanced credential <Tooltip text={"An optional bytes field stored on-chain alongside your membership token. The wallet address is the binding identifier on its own; the credential is an opaque commitment that a separate consumer — an identity-issuing frontend, an indexer, an integration — can resolve to a person, role, or hash.\n\nThis frontend stores the bytes at mint but does not read or display them. Consumers read via getCredential(tokenId) on DAAToken.\n\nPermanently public on-chain. Do not store sensitive data directly — use a hash of off-chain material if you need linkage to identity proof."} align="left"><span class="text-text-muted cursor-help">(?)</span></Tooltip>
			</label>

			{#if showAdvanced}
				<div>
					<label for="credential" class="block text-xs text-text-muted mb-1">
						Credential bytes (max 256 characters)
					</label>
					<input
						id="credential"
						type="text"
						bind:value={credential}
						maxlength="256"
						placeholder="Hash, DID, identifier, or leave empty"
						class="w-full bg-bg-light border border-border rounded px-3 py-2 text-sm outline-none focus:border-primary"
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>
