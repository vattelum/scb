<script lang="ts">
	import { wallet } from '#lib/stores/wallet.ts';
	import {
		preparePackage,
		commitPackage,
		buildSidecar,
		downloadContractFiles,
		type PickedEntry,
		type PreparedPackage,
		type PendingUpload,
		type ScbFields
	} from '#lib/services/contract-create.ts';
	import { renderContractHtml } from '#lib/services/print.ts';
	import { contractRegistryAddress } from '#lib/contracts/index.ts';
	import { loadDocuments, loadDocumentBody, type DocumentInfo } from '#lib/services/registry.ts';
	import { readContract } from '@wagmi/core';
	import { config } from '#lib/services/wallet-config.ts';
	import { daaRegistryAddress, daaTokenConfig, contractTemplateCategoryId } from '#lib/contracts/index.ts';
	import { stripFrontmatter } from '#lib/services/format.ts';
	import { MarkdownUnsafeError } from '#lib/services/markdown.ts';
	import { type TemplateRole } from '#lib/services/template-variables.ts';
	import {
		emptyPartyBinding,
		INDIVIDUAL_OPTIONAL_KEYS,
		ENTITY_OPTIONAL_KEYS,
		INDIVIDUAL_FIELD_LABELS,
		ENTITY_FIELD_LABELS,
		type PartyBindings
	} from '#lib/services/party.ts';
	import PartiesSection from '#lib/components/PartiesSection.svelte';
	import { isAddress } from 'viem';
	import LoadingButton from '#lib/components/LoadingButton.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import StorageModeToggle from '#lib/components/StorageModeToggle.svelte';
	import TemplateSelector from '#lib/components/TemplateSelector.svelte';
	import ScbSection from '#lib/components/ScbSection.svelte';
	import VariablesSection from '#lib/components/VariablesSection.svelte';
	import LegislationPicker from '#lib/components/LegislationPicker.svelte';
	import { showToast } from '#lib/stores/toasts.ts';

	const chainId = Number(import.meta.env.VITE_CHAIN_ID);

	let {
		oncreated,
		onopencontract,
		revisionOf = null,
		revisionSourceSignatories = null,
		revisionSourceContentHash = null
	}: {
		oncreated: (id: bigint, content: string) => void;
		onopencontract: (id: bigint) => void;
		/**
		 * When set, this form creates a new contract that REVISES the given
		 * underlying contract (per Referencing Standard v10 §3.1 — REVISES means
		 * whole-document replacement). The UI shows a "Revising Contract #N"
		 * banner; submit prepends a REVISES DocumentReference to the new
		 * contract's references, enforces that signatories equal the source's
		 * signatories, and rejects a submission that differs from the source only
		 * by its revision sentences.
		 */
		revisionOf?: bigint | null;
		revisionSourceSignatories?: readonly `0x${string}`[] | null;
		revisionSourceContentHash?: `0x${string}` | null;
	} = $props();

	// User-supplied prose explaining why the underlying contract is being
	// superseded. Written into the package after the contract body (and therefore the
	// content hash, the encrypted Arweave blob, and the exported .md) so every
	// reader of the revision sees the reason.
	let revisionReason = $state('');

	// ────────────────── Template State ────────────────────────

	let templates = $state<DocumentInfo[]>([]);
	let loadingTemplates = $state(false);
	let selectedTemplate = $state<DocumentInfo | null>(null);
	let loadingTemplate = $state(false);
	let templateContent = $state('');
	// On-chain version of the selected template as actually fetched (getLatest),
	// used for the TEMPLATE reference — avoids the list-time versionCount race.
	let templateVersion = $state(0n);
	let templateVariables = $state<Array<{ name: string; label: string; type: string; required: boolean }>>([]);
	let templateRoles = $state<TemplateRole[]>([]);
	let variableValues = $state<Record<string, string>>({});

	// ────────────────── Party Bindings ────────────────────────

	let partyBindings = $state<PartyBindings>({});
	let creatorRoleKey = $state<string | null>(null);
	let partyWalletErrors = $state<Record<string, string>>({});

	// ────────────────── Creation State ────────────────────────

	let selectedLegislation = $state<PickedEntry[]>([]);
	let creating = $state(false);
	let createdContractId = $state<bigint | null>(null);
	let hashOnlyMode = $state(false);

	// ────────────────── SCB Reference State ───────────────────
	let scbEnabled = $state(false);
	let scbAddress = $state('');
	let scbChainId = $state(chainId);
	let scbBytecodeHash = $state<`0x${string}` | ''>('');

	const scbValid = $derived(scbEnabled && scbAddress.length === 42 && isAddress(scbAddress) && scbBytecodeHash !== '' && scbChainId > 0);
	const scbReady = $derived(!scbEnabled || scbValid);

	// Inline form-validation errors. Transaction-outcome messages use toasts.
	let error = $state('');

	// Persist a Turbo tx ID across retries when its post-upload verification
	// fails. Cleared on package change, on a failed re-check, and on success.
	const pendingUpload: PendingUpload = { uri: null, hash: null };

	// The package awaiting the creator's confirmation.
	let prepared = $state.raw<PreparedPackage | null>(null);
	let showPreview = $state(false);
	let canCreate = $derived($wallet.connected && $wallet.isTokenHolder);

	// ────────────────── Derived: signatories from bindings ────

	const signatoriesFromBindings = $derived.by(() => {
		const seen = new Set<string>();
		const out: `0x${string}`[] = [];
		for (const role of templateRoles) {
			const w = partyBindings[role.key]?.wallet?.trim();
			if (!w) continue;
			if (!isAddress(w)) continue;
			const lower = w.toLowerCase();
			if (seen.has(lower)) continue;
			seen.add(lower);
			out.push(w as `0x${string}`);
		}
		return out;
	});

	const creatorIsBound = $derived.by(() => {
		if (!$wallet.address) return false;
		return signatoriesFromBindings.some((s) => s.toLowerCase() === $wallet.address!.toLowerCase());
	});

	// ────────────────── Init ──────────────────────────────────

	export async function init() {
		error = '';
		createdContractId = null;
		if (contractTemplateCategoryId !== null && templates.length === 0) {
			loadingTemplates = true;
			try {
				templates = await loadDocuments(contractTemplateCategoryId);
			} catch {
				error = 'Failed to load templates';
			} finally {
				loadingTemplates = false;
			}
		}
	}

	// ────────────────── Template Selection ───────────────────

	async function selectTemplate(doc: DocumentInfo) {
		selectedTemplate = doc;
		templateVariables = [];
		templateRoles = [];
		variableValues = {};
		partyBindings = {};
		partyWalletErrors = {};
		creatorRoleKey = null;
		loadingTemplate = true;
		try {
			const loaded = await loadDocumentBody(contractTemplateCategoryId!, doc.documentId);
			templateContent = loaded.body;
			templateVersion = loaded.version;
			templateVariables = loaded.variables;
			templateRoles = loaded.roles;

			// Initialise a binding per role so the form has stable identities.
			for (const r of templateRoles) {
				partyBindings[r.key] = emptyPartyBinding();
			}

			// Pre-fill creator's wallet into the first role by default; creator can
			// re-pick via the "You" radio on a different block.
			if (templateRoles.length > 0 && $wallet.address) {
				creatorRoleKey = templateRoles[0].key;
				partyBindings[creatorRoleKey].wallet = $wallet.address;
			}

			// Revision mode: pre-fill remaining roles with the source contract's
			// signatories (in order, skipping the creator). The user must keep the
			// signatory set equal at submit; pre-filling closes the manual-typing
			// gap and surfaces who needs to sign at a glance.
			if (revisionOf !== null && revisionSourceSignatories && templateRoles.length > 0) {
				const creatorLower = $wallet.address?.toLowerCase();
				const others = revisionSourceSignatories.filter(
					(s) => s.toLowerCase() !== creatorLower
				);
				let i = 0;
				for (const r of templateRoles) {
					if (r.key === creatorRoleKey) continue;
					if (i >= others.length) break;
					partyBindings[r.key].wallet = others[i++];
				}
			}
		} catch (e: any) {
			error = e.message || 'Failed to load template';
		} finally {
			loadingTemplate = false;
		}
	}

	function pickCreatorRole(roleKey: string) {
		if (!$wallet.address) return;
		// Clear creator's wallet from the old role if it wasn't manually changed.
		if (creatorRoleKey && partyBindings[creatorRoleKey]?.wallet?.toLowerCase() === $wallet.address.toLowerCase()) {
			partyBindings[creatorRoleKey].wallet = '';
		}
		creatorRoleKey = roleKey;
		partyBindings[roleKey].wallet = $wallet.address;
	}

	async function validatePartyWallet(roleKey: string) {
		const w = partyBindings[roleKey]?.wallet?.trim();
		if (!w) {
			partyWalletErrors[roleKey] = '';
			return;
		}
		if (!isAddress(w)) {
			partyWalletErrors[roleKey] = 'Invalid Ethereum address';
			return;
		}
		// Skip membership check for creator (already verified by canCreate gate)
		if ($wallet.address && w.toLowerCase() === $wallet.address.toLowerCase()) {
			partyWalletErrors[roleKey] = '';
			return;
		}
		try {
			const balance = (await readContract(config, {
				...daaTokenConfig,
				functionName: 'balanceOf',
				args: [w as `0x${string}`]
			})) as bigint;
			partyWalletErrors[roleKey] = balance === 0n ? 'Not a DAA member' : '';
		} catch {
			partyWalletErrors[roleKey] = 'Could not verify membership';
		}
	}

	const hasPartyWalletErrors = $derived(Object.values(partyWalletErrors).some((e) => !!e));

	// ────────────────── Submit ────────────────────────────────

	async function submitCreate() {
		if (!$wallet.address || !selectedTemplate) return;
		creating = true;
		error = '';

		try {
			if (templateRoles.length === 0) {
				error = 'Template does not declare any roles. Create a new template with a `roles:` block.';
				creating = false;
				return;
			}

			// Required-field validation on parties
			const missingParty: string[] = [];
			const blankParty: string[] = [];
			for (const role of templateRoles) {
				const b = partyBindings[role.key];
				if (!b) { missingParty.push(role.label); continue; }
				if (!b.signer_name.trim()) missingParty.push(`${role.label} signer name`);
				if (!b.wallet || !isAddress(b.wallet)) missingParty.push(`${role.label} wallet`);
				if (b.entity) {
					if (!b.entity.legal_name.trim()) missingParty.push(`${role.label} entity name`);
					const entityBlanks: string[] = [];
					for (const k of ENTITY_OPTIONAL_KEYS) {
						const v = b.entity[k];
						if (typeof v === 'string' && v.trim() === '') entityBlanks.push(ENTITY_FIELD_LABELS[k]);
					}
					if (entityBlanks.length > 0) blankParty.push(`${role.label}: ${entityBlanks.join(', ')}`);
				} else {
					const individualBlanks: string[] = [];
					for (const k of INDIVIDUAL_OPTIONAL_KEYS) {
						const v = b[k];
						if (typeof v === 'string' && v.trim() === '') individualBlanks.push(INDIVIDUAL_FIELD_LABELS[k]);
					}
					if (individualBlanks.length > 0) blankParty.push(`${role.label}: ${individualBlanks.join(', ')}`);
				}
			}
			if (missingParty.length > 0) {
				error = `Required party fields missing: ${missingParty.join(', ')}.`;
				creating = false;
				return;
			}
			if (blankParty.length > 0) {
				error = `Please fill or remove (×) these optional fields — ${blankParty.join('; ')}.`;
				creating = false;
				return;
			}

			// Creator must fill one role
			if (!creatorIsBound) {
				error = 'Your wallet must be assigned to one of the roles.';
				creating = false;
				return;
			}

			// Wallet uniqueness across roles
			const seenWallets = new Map<string, string>();
			for (const role of templateRoles) {
				const w = partyBindings[role.key].wallet.toLowerCase();
				if (seenWallets.has(w)) {
					error = `${role.label} and ${seenWallets.get(w)} are assigned the same wallet. Each role must be filled by a different signatory.`;
					creating = false;
					return;
				}
				seenWallets.set(w, role.label);
			}

			// Variable required fields
			const missingVars = templateVariables.filter(v => v.required && !String(variableValues[v.name] ?? '').trim());
			if (missingVars.length > 0) {
				error = `Required variables missing: ${missingVars.map((v) => v.label).join(', ')}`;
				creating = false;
				return;
			}

			// Date sanity
			// Legacy date field check — still treat these names as dates if present,
			// purely a UI convenience. No on-chain effect since the enforcement fields
			// were removed in the realignment.
			for (const field of ['start_date', 'expires']) {
				const v = variableValues[field]?.trim();
				if (v && isNaN(new Date(v).getTime())) {
					error = `"${field}" is not a valid date. Use the date picker (YYYY-MM-DD).`;
					creating = false;
					return;
				}
			}

			// Membership check for non-creator party wallets
			const signatories = signatoriesFromBindings;
			for (const addr of signatories) {
				if (addr.toLowerCase() === $wallet.address.toLowerCase()) continue;
				try {
					const balance = (await readContract(config, {
						...daaTokenConfig,
						functionName: 'balanceOf',
						args: [addr]
					})) as bigint;
					if (balance === 0n) {
						error = `${addr} is not a DAA member. All signatories must be members.`;
						creating = false;
						return;
					}
				} catch {
					error = `Could not verify membership for ${addr}.`;
					creating = false;
					return;
				}
			}

			// Revision-mode guardrails (per Referencing Standard v10 §3.1 — REVISES
			// is whole-document replacement; the parties cannot change).
			if (revisionOf !== null) {
				const expected = (revisionSourceSignatories ?? []).map((s) => s.toLowerCase()).sort();
				const actual = signatories.map((s) => s.toLowerCase()).sort();
				const same =
					expected.length === actual.length &&
					expected.every((s, i) => s === actual[i]);
				if (!same) {
					error = `Revision signatories must match Contract #${revisionOf} exactly. Changing parties requires a new contract, not a revision.`;
					creating = false;
					return;
				}
			}

			prepared = await preparePackage({
				templateTitle: selectedTemplate.latestTitle,
				templateContent,
				template: {
					categoryId: BigInt(contractTemplateCategoryId!),
					documentId: BigInt(selectedTemplate.documentId),
					version: templateVersion,
					registryAddress: daaRegistryAddress
				},
				roles: templateRoles,
				bindings: $state.snapshot(partyBindings) as PartyBindings,
				variableValues: $state.snapshot(variableValues),
				picked: $state.snapshot(selectedLegislation) as PickedEntry[],
				signatories,
				hashOnly: hashOnlyMode,
				revision: revisionOf !== null ? { ofContractId: revisionOf, reason: revisionReason } : null,
				contractRegistry: contractRegistryAddress,
				chainId
			});
			showPreview = true;
		} catch (e: any) {
			reportFailure(e);
		} finally {
			creating = false;
		}
	}

	function reportFailure(e: any) {
		console.error('[submitCreate] CAUGHT:', e);
		const msg = e?.message || 'Failed to create contract';
		error = msg;
		if (!(e instanceof MarkdownUnsafeError)) {
			showToast('error', msg);
		}
	}

	async function confirmCreate() {
		if (!prepared) return;
		showPreview = false;
		creating = true;
		error = '';

		const scbOn = scbEnabled && scbValid;
		const scb: ScbFields = {
			smartContractAddress: scbOn ? (scbAddress as `0x${string}`) : '0x0000000000000000000000000000000000000000',
			bytecodeHash: scbOn ? (scbBytecodeHash as `0x${string}`) : '0x0000000000000000000000000000000000000000000000000000000000000000',
			smartContractChainId: scbOn ? BigInt(scbChainId) : 0n
		};

		try {
			const committed = await commitPackage(
				prepared,
				scb,
				revisionSourceContentHash,
				pendingUpload,
				contractRegistryAddress
			);
			createdContractId = committed.contractId;

			downloadContractFiles(committed.contractId, prepared.canonical, buildSidecar(prepared, committed, scb));
			oncreated(committed.contractId, prepared.canonical);

			showToast(
				'success',
				prepared.hashOnly
					? `Contract #${committed.contractId} created (hash-only). Share the downloaded .md file with counterparties so they can import and sign.`
					: `Contract #${committed.contractId} created. Counterparties can now read and sign in-app — no file transfer needed.`
			);
		} catch (e: any) {
			reportFailure(e);
		} finally {
			creating = false;
		}
	}
</script>

{#if !$wallet.connected}
	<div class="border border-border rounded-lg p-4 text-center mb-6">
		<p class="text-text-muted text-sm">Connect your wallet to create a contract.</p>
	</div>
{:else if !$wallet.isTokenHolder}
	<div class="border border-border rounded-lg p-4 text-center mb-6">
		<p class="text-text-muted text-sm">You need a membership token to create contracts. <a href="/admin" class="text-primary hover:underline">Join</a> first.</p>
	</div>
{/if}

{#if createdContractId}
	<div class="bg-green-900/30 border border-green-700 rounded-lg p-6 text-center">
		<p class="text-green-300 font-medium mb-2">Contract #{createdContractId.toString()} created!</p>
		<p class="text-text-secondary text-sm mb-4">Share this ID with your counterparties so they can view and sign.</p>
		<div class="flex gap-3 justify-center">
			<button
				onclick={() => onopencontract(createdContractId!)}
				class="bg-primary hover:bg-primary-hover text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
			>
				View &amp; Sign
			</button>
		</div>
	</div>
{:else}
	<div class="flex flex-col gap-5" class:opacity-50={!canCreate} class:pointer-events-none={!canCreate}>
		{#if revisionOf !== null}
			<div class="bg-amber-900/30 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-200 flex flex-col gap-2">
				<p class="font-medium">Revising Contract #{revisionOf.toString()}</p>
				<p class="text-xs text-amber-200/80">This contract will supersede Contract #{revisionOf.toString()} in full. Signatories must match the original exactly. The reason below is written into the signed document and visible to every signatory.</p>
				<label class="block text-xs text-amber-200/80">
					Reason for revision <span class="text-amber-200/60">(optional)</span>
					<textarea
						bind:value={revisionReason}
						rows="2"
						placeholder="e.g. corrected delivery date and updated payment terms"
						class="mt-1 w-full rounded border border-amber-700/60 bg-bg-secondary px-2 py-1 text-sm text-text"
					></textarea>
				</label>
			</div>
		{/if}
		<!-- Step 1: Template Selection (first — determines roles) -->
		<TemplateSelector
			{templates}
			selectedDocumentId={selectedTemplate?.documentId ?? null}
			loading={loadingTemplates}
			onselect={selectTemplate}
		/>
		{#if loadingTemplate}
			<p class="text-text-muted text-sm -mt-3">Loading template...</p>
		{/if}

		<!-- Step 2: Signatories (one block per declared role) -->
		{#if selectedTemplate}
			<PartiesSection
				{templateRoles}
				bind:partyBindings={partyBindings}
				{creatorRoleKey}
				bind:partyWalletErrors={partyWalletErrors}
				loadingRoles={loadingTemplate}
				onPickCreator={pickCreatorRole}
				onWalletBlur={validatePartyWallet}
			/>
		{/if}

		<!-- Template preview: click to expand the raw template body -->
		{#if selectedTemplate && !loadingTemplate && templateContent}
			<details class="border border-border rounded-lg">
				<summary class="text-xs text-text-secondary px-3 py-2 cursor-pointer hover:text-text transition-colors">
					Show template body
				</summary>
				<div class="border-t border-border px-3 py-3 bg-bg text-xs text-text-secondary whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">{stripFrontmatter(templateContent)}</div>
			</details>
		{/if}

		<!-- Step 3: Contract Variables -->
		<VariablesSection templateVars={templateVariables} bind:variableValues={variableValues} />

		<!-- Step 4: Governing Legislation -->
		<LegislationPicker bind:selectedLegislation={selectedLegislation} />

		<!-- Smart Contract Reference (SCB) -->
		<ScbSection
			bind:enabled={scbEnabled}
			bind:address={scbAddress}
			bind:chainId={scbChainId}
			bind:bytecodeHash={scbBytecodeHash}
		/>

		<!-- Storage Mode -->
		<StorageModeToggle bind:hashOnly={hashOnlyMode} />

		{#if error}
			<div class="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 text-sm">{error}</div>
		{/if}

		<!-- Submit -->
		<div class="pt-2 pb-12">
			<LoadingButton
				onclick={submitCreate}
				loading={creating}
				loadingLabel="Creating..."
				disabled={!selectedTemplate || templateRoles.length === 0 || !creatorIsBound || hasPartyWalletErrors || !scbReady}
				variant="primary"
				class="px-6"
			>
				Create Contract
			</LoadingButton>
		</div>
	</div>
{/if}

<!-- Preview: the exact document that will be hashed once the creator confirms -->
{#if prepared}
	<Modal bind:open={showPreview} title="Review the contract" maxWidth="max-w-3xl">
		<div class="flex flex-col gap-3 text-sm">
			<p class="text-xs text-text-muted">This is the exact document that will be hashed, stored and signed. It cannot change after you confirm.</p>
			<div class="doc-viewer prose prose-invert max-w-none text-text border-t border-border pt-3">{@html renderContractHtml(prepared.canonical)}</div>
		</div>

		{#snippet footer()}
			<LoadingButton onclick={() => (showPreview = false)} variant="secondary">Back</LoadingButton>
			<LoadingButton onclick={confirmCreate} variant="primary">Confirm &amp; Create</LoadingButton>
		{/snippet}
	</Modal>
{/if}
