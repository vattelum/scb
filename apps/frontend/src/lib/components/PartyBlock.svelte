<script lang="ts">
	import type { TemplateRole } from '$lib/services/template-variables';
	import type {
		PartyBinding,
		IndividualOptionalKey,
		EntityOptionalKey
	} from '$lib/services/party';
	import {
		emptyEntityBinding,
		INDIVIDUAL_OPTIONAL_KEYS,
		ENTITY_OPTIONAL_KEYS
	} from '$lib/services/party';
	import { isAddress } from 'viem';

	let {
		role,
		binding = $bindable<PartyBinding>(),
		isCreator,
		onPickCreator,
		onWalletBlur,
		walletError = ''
	}: {
		role: TemplateRole;
		binding: PartyBinding;
		isCreator: boolean;
		onPickCreator: () => void;
		onWalletBlur?: () => void;
		walletError?: string;
	} = $props();

	interface IndividualField {
		key: IndividualOptionalKey;
		label: string;
		type?: 'text' | 'date';
		placeholder?: string;
	}
	interface EntityField {
		key: EntityOptionalKey;
		label: string;
		placeholder?: string;
	}

	const INDIVIDUAL_FIELDS: IndividualField[] = [
		{ key: 'email', label: 'Email' },
		{ key: 'phone', label: 'Phone' },
		{ key: 'address', label: 'Address' },
		{ key: 'date_of_birth', label: 'Date of birth', type: 'date' },
		{ key: 'nationality', label: 'Nationality' },
		{ key: 'government_id', label: 'Government ID', placeholder: 'Passport, SSN, DNI…' },
		{ key: 'tax_id', label: 'Tax ID' }
	];

	const ENTITY_FIELDS: EntityField[] = [
		{ key: 'jurisdiction', label: 'Jurisdiction', placeholder: 'e.g. Delaware, USA' },
		{ key: 'registration_number', label: 'Registration number' },
		{ key: 'registered_address', label: 'Registered address' },
		{ key: 'tax_id', label: 'Tax ID' },
		{ key: 'signer_role', label: "Signer's role", placeholder: 'Director, CEO, Authorized Signatory…' },
		{ key: 'email', label: 'Email' },
		{ key: 'phone', label: 'Phone' }
	];

	let moreOn = $state(false);
	const entityOn = $derived(!!binding.entity);

	// X-removed field keys. Reset whenever a mode is re-entered.
	let hiddenIndividual = $state<Record<string, boolean>>({});
	let hiddenEntity = $state<Record<string, boolean>>({});

	function clearIndividualExtras() {
		const b = binding as unknown as Record<string, unknown>;
		for (const k of INDIVIDUAL_OPTIONAL_KEYS) b[k] = undefined;
	}

	function initIndividualExtras() {
		const b = binding as unknown as Record<string, unknown>;
		for (const k of INDIVIDUAL_OPTIONAL_KEYS) b[k] = '';
	}

	function fullEntityBinding() {
		const e = emptyEntityBinding() as unknown as Record<string, unknown>;
		for (const k of ENTITY_OPTIONAL_KEYS) e[k] = '';
		return e as unknown as NonNullable<PartyBinding['entity']>;
	}

	function toggleMoreInfo() {
		if (moreOn) {
			moreOn = false;
			hiddenIndividual = {};
			clearIndividualExtras();
		} else {
			if (binding.entity) {
				binding.entity = undefined;
				hiddenEntity = {};
			}
			moreOn = true;
			hiddenIndividual = {};
			initIndividualExtras();
		}
	}

	function toggleEntity() {
		if (binding.entity) {
			binding.entity = undefined;
			hiddenEntity = {};
		} else {
			if (moreOn) {
				moreOn = false;
				hiddenIndividual = {};
				clearIndividualExtras();
			}
			binding.entity = fullEntityBinding();
			hiddenEntity = {};
		}
	}

	function removeIndividual(key: IndividualOptionalKey) {
		hiddenIndividual = { ...hiddenIndividual, [key]: true };
		(binding as unknown as Record<string, unknown>)[key] = undefined;
	}

	function removeEntity(key: EntityOptionalKey) {
		hiddenEntity = { ...hiddenEntity, [key]: true };
		if (binding.entity) (binding.entity as unknown as Record<string, unknown>)[key] = undefined;
	}

	const walletLooksValid = $derived(binding.wallet.length === 0 || isAddress(binding.wallet));

	const nameLabel = $derived(binding.entity ? 'Signer' : 'Name');
</script>

<div class="border border-border rounded-lg p-3">
	<div class="flex items-center justify-between mb-2">
		<div class="text-sm font-medium">{role.label}</div>
		<label class="flex items-center gap-1 text-xs cursor-pointer">
			<input
				type="radio"
				name="creator-role"
				checked={isCreator}
				onchange={onPickCreator}
				class="accent-primary"
			/>
			<span class={isCreator ? 'text-primary' : 'text-text-muted'}>You</span>
		</label>
	</div>

	<div class="flex flex-col gap-2">
		<div>
			<label for="signer-{role.key}" class="block text-xs text-text-muted mb-0.5">{nameLabel} *</label>
			<input
				id="signer-{role.key}"
				bind:value={binding.signer_name}
				class="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
			/>
		</div>

		<div>
			<label for="wallet-{role.key}" class="block text-xs text-text-muted mb-0.5">Wallet *</label>
			<input
				id="wallet-{role.key}"
				bind:value={binding.wallet}
				onblur={() => onWalletBlur?.()}
				placeholder="0x..."
				class="w-full bg-surface border rounded px-3 py-1.5 text-sm text-text font-mono {walletError || !walletLooksValid ? 'border-red-600' : 'border-border'}"
			/>
			{#if walletError}
				<span class="text-red-400 text-xs">{walletError}</span>
			{:else if !walletLooksValid}
				<span class="text-red-400 text-xs">Invalid Ethereum address</span>
			{/if}
		</div>

		<div class="flex items-center gap-5 mt-1 flex-wrap">
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" checked={moreOn} onchange={toggleMoreInfo} />
				<span class="text-xs text-text-secondary">Add more info</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" checked={entityOn} onchange={toggleEntity} />
				<span class="text-xs text-text-secondary">Signing on behalf of a legal entity</span>
			</label>
		</div>

		{#if moreOn && !binding.entity}
			<div class="border border-border rounded p-2 bg-bg flex flex-col gap-2">
				{#each INDIVIDUAL_FIELDS as f (f.key)}
					{#if !hiddenIndividual[f.key]}
						<div>
							<div class="flex items-center justify-between mb-0.5">
								<label for="ind-{f.key}-{role.key}" class="block text-xs text-text-muted">{f.label}</label>
								<button
									type="button"
									onclick={() => removeIndividual(f.key)}
									class="text-text-muted hover:text-red-400 text-xs leading-none px-1"
									title="Remove {f.label}"
									aria-label="Remove {f.label}"
								>×</button>
							</div>
							<input
								id="ind-{f.key}-{role.key}"
								type={f.type ?? 'text'}
								value={(binding[f.key] ?? '') as string}
								oninput={(e) => {
									(binding as unknown as Record<string, unknown>)[f.key] = e.currentTarget.value;
								}}
								placeholder={f.placeholder ?? ''}
								class="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
							/>
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		{#if binding.entity}
			<div class="border border-border rounded p-2 bg-bg flex flex-col gap-2">
				<div>
					<label for="entity-name-{role.key}" class="block text-xs text-text-muted mb-0.5">Entity name *</label>
					<input
						id="entity-name-{role.key}"
						bind:value={binding.entity.legal_name}
						class="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
					/>
				</div>
				{#each ENTITY_FIELDS as f (f.key)}
					{#if !hiddenEntity[f.key]}
						<div>
							<div class="flex items-center justify-between mb-0.5">
								<label for="ent-{f.key}-{role.key}" class="block text-xs text-text-muted">{f.label}</label>
								<button
									type="button"
									onclick={() => removeEntity(f.key)}
									class="text-text-muted hover:text-red-400 text-xs leading-none px-1"
									title="Remove {f.label}"
									aria-label="Remove {f.label}"
								>×</button>
							</div>
							<input
								id="ent-{f.key}-{role.key}"
								bind:value={binding.entity[f.key]}
								placeholder={f.placeholder ?? ''}
								class="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
							/>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
