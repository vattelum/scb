<script lang="ts">
	import { type TemplateRole } from '$lib/services/template-variables';
	import { type PartyBindings } from '$lib/services/party';
	import PartyBlock from '$lib/components/PartyBlock.svelte';

	let {
		templateRoles,
		partyBindings = $bindable(),
		creatorRoleKey,
		partyWalletErrors = $bindable(),
		loadingRoles,
		onPickCreator,
		onWalletBlur
	}: {
		templateRoles: TemplateRole[];
		partyBindings: PartyBindings;
		creatorRoleKey: string | null;
		partyWalletErrors: Record<string, string>;
		loadingRoles: boolean;
		onPickCreator: (roleKey: string) => void;
		onWalletBlur: (roleKey: string) => Promise<void>;
	} = $props();
</script>

{#if loadingRoles}
	<p class="text-text-muted text-sm">Loading roles...</p>
{:else if templateRoles.length > 0}
	<div class="flex flex-col gap-3">
		<div>
			<h3 class="text-sm text-text-secondary mb-1">Signatories</h3>
			<p class="text-xs text-text-muted">One party block per role declared by this template. Pick which role you occupy with the "You" radio.</p>
		</div>
		{#each templateRoles as role}
			<PartyBlock
				{role}
				bind:binding={partyBindings[role.key]}
				isCreator={creatorRoleKey === role.key}
				onPickCreator={() => onPickCreator(role.key)}
				onWalletBlur={() => onWalletBlur(role.key)}
				walletError={partyWalletErrors[role.key] ?? ''}
			/>
		{/each}
	</div>
{:else}
	<div class="border border-red-800/40 bg-red-900/20 text-red-300 text-xs rounded p-3">
		This template has no `roles:` declared. Create a new template on /propose with a Signatories block so parties can be bound at contract time.
	</div>
{/if}
