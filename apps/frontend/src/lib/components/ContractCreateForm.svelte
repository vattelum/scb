<script lang="ts">
	import { wallet } from '$lib/stores/wallet';
	import {
		createContract,
		type DocumentReference,
		type CreateContractParams
	} from '$lib/services/contract-registry';
	import { encryptForRecipients, type RecipientPubkey } from '$lib/services/ecies';
	import { getPubkey, clearPubkeyCache } from '$lib/services/pubkey-registry';
	import { hashBody, canonicalizeBody, RELATION_TEMPLATE, RELATION_REVISES } from '@vattelum/document-registry-js';
	import { hashToBytes32 } from '$lib/services/hash';
	import { uploadDocument, verifyTurboHas } from '$lib/services/arweave';
	import { contractRegistryAddress } from '$lib/contracts';
	import { loadDocuments, loadDocumentBody, type DocumentInfo } from '$lib/services/registry';
	import { readContract } from '@wagmi/core';
	import { config } from '$lib/services/wallet-config';
	import { daaRegistryAddress, daaTokenConfig, contractTemplateCategoryId } from '$lib/contracts';
	import { getClient } from '$lib/services/wallet-config';
	import { stripFrontmatter, formatISODate } from '$lib/services/format';
	import { validateMarkdownUpload, MarkdownUnsafeError } from '$lib/services/markdown';
	import { type TemplateRole } from '$lib/services/template-variables';
	import {
		renderParties,
		serializePartiesYaml,
		emptyPartyBinding,
		INDIVIDUAL_OPTIONAL_KEYS,
		ENTITY_OPTIONAL_KEYS,
		INDIVIDUAL_FIELD_LABELS,
		ENTITY_FIELD_LABELS,
		type PartyBindings
	} from '$lib/services/party';
	import PartiesSection from '$lib/components/PartiesSection.svelte';
	import { isAddress } from 'viem';
	import LoadingButton from '$lib/components/LoadingButton.svelte';
	import StorageModeToggle from '$lib/components/StorageModeToggle.svelte';
	import TemplateSelector from '$lib/components/TemplateSelector.svelte';
	import ScbSection from '$lib/components/ScbSection.svelte';
	import VariablesSection from '$lib/components/VariablesSection.svelte';
	import LegislationPicker from '$lib/components/LegislationPicker.svelte';
	import { showToast } from '$lib/stores/toasts';

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
		 * signatories, and rejects a submission whose contentHash is identical
		 * to the source's.
		 */
		revisionOf?: bigint | null;
		revisionSourceSignatories?: readonly `0x${string}`[] | null;
		revisionSourceContentHash?: `0x${string}` | null;
	} = $props();

	// User-supplied prose explaining why the underlying contract is being
	// superseded. Embedded in the assembled body (and therefore the content
	// hash, the encrypted Arweave blob, and the archive .md) so every reader
	// of the revision sees the reason.
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

	let selectedLegislation = $state<Array<{ title: string; categoryId: number; documentId: number; version: number; relationType: number; registryAddress: `0x${string}`; chainId?: number }>>([]);
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
	// fails. Cleared on body change, on a failed re-check, and on success.
	let pendingContentUri = $state<string | null>(null);
	let pendingContentHash = $state<string | null>(null);
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

	// ────────────────── Assembly ──────────────────────────────

	/**
	 * Build the hashed body = rendered §1 Parties + filled template body.
	 *
	 * Role placeholders `{{role_key}}` resolve to the role label (bare, no
	 * article — authors write "the {{role}}" explicitly when needed).
	 * Variable placeholders `{{var}}` resolve from `variableValues`.
	 */
	function assembleBody(): string {
		const renderedParties = renderParties(templateRoles, partyBindings);
		const roleSubs: Record<string, string> = {};
		for (const r of templateRoles) roleSubs[r.key] = r.label;
		let body = stripFrontmatter(templateContent);
		for (const [k, v] of Object.entries(roleSubs)) {
			body = body.replaceAll(`{{${k}}}`, v);
		}
		for (const [k, v] of Object.entries(variableValues)) {
			body = body.replaceAll(`{{${k}}}`, formatISODate(v));
		}
		// Revision metadata: emitted as HTML comments at the top of the body so
		// the values are part of the hashed/encrypted/signed string, but vanish
		// from rendered output (marked + DOMPurify strip HTML comments). Print
		// and view extract these via extractRevisionMeta() and lift the reason
		// into a title-block / context banner.
		let preamble = '';
		if (revisionOf !== null) {
			preamble = `<!-- revision-of: ${revisionOf.toString()} -->\n`;
			if (revisionReason.trim()) {
				preamble += `<!-- revision-reason: ${revisionReason.trim()} -->\n`;
			}
			preamble += '\n';
		}
		// Canonicalize once, here, so the single assembled string feeds hash,
		// validation, ECIES encryption, the hash-only archive, and the .md
		// download identically (S-4). Verifier paths must NOT re-canonicalize.
		return canonicalizeBody(`${preamble}${renderedParties}\n\n${body.trimStart()}`);
	}

	// ────────────────── Archive export ───────────────────────

	function downloadArchiveMd(
		contractId: bigint,
		contentHash: `0x${string}`,
		body: string,
		signatories: `0x${string}`[],
		references: DocumentReference[]
	) {
		const refsYaml = references.length === 0
			? '[]'
			: '\n' + references.map((r) =>
				`  - registry: "${r.registryAddress}"\n    chain_id: ${r.chainId}\n    category_id: ${r.categoryId}\n    document_id: ${r.documentId}\n    version: ${r.version}\n    relation_type: ${r.relationType}`
			).join('\n');

		const partiesYaml = templateRoles.length > 0
			? '\n' + serializePartiesYaml(templateRoles, partyBindings)
			: '';

		const fm = `---
contract_id: "${contractId}"
content_hash: "${contentHash}"
contract_registry_address: "${contractRegistryAddress}"
chain_id: ${chainId}
signatories:
${signatories.map((s) => `  - "${s}"`).join('\n')}
references:${refsYaml}${partiesYaml}
---

`;
		const md = fm + body;
		const blob = new Blob([md], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `contract-${contractId}-archive.md`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

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

			// Assemble + hash
			const completeDoc = assembleBody();

			// Validate the assembled body is sanitization-clean before hashing,
			// encrypting, or uploading. Covers both ECIES and hash-only paths
			// (in hash-only mode the .md archive is the sole record, so its
			// bytes must also be safe).
			await validateMarkdownUpload(completeDoc);

			const bodyHash = hashBody(completeDoc);
			const contentHash = hashToBytes32(bodyHash) as `0x${string}`;

			if (revisionOf !== null && revisionSourceContentHash && contentHash === revisionSourceContentHash) {
				error = 'Revision content is identical to the underlying contract. Change something, or cancel.';
				creating = false;
				return;
			}

			let contentUri = '';

			if (!hashOnlyMode) {
				const recipients: RecipientPubkey[] = [];
				const unregistered: `0x${string}`[] = [];
				// Bypass the session pubkey cache so encryption targets the keys
				// currently registered on-chain (a signatory may have re-registered
				// since the cache was warmed).
				clearPubkeyCache();
				for (const addr of signatories) {
					const pk = await getPubkey(addr);
					if (pk) recipients.push({ address: addr, pubkey: pk });
					else unregistered.push(addr);
				}
				if (unregistered.length > 0) {
					error = `These addresses have not registered an encryption key yet: ${unregistered.join(', ')}. Ask each one to visit the app and connect their wallet so they can register before you create the contract.`;
					creating = false;
					return;
				}

				// Re-check pattern: if a previous upload of this exact body failed
				// verification, retry the verify against the same tx ID instead of
				// paying for a fresh upload. Body edits between attempts invalidate
				// the pending tx via the hash mismatch.
				if (pendingContentHash !== contentHash) {
					pendingContentUri = null;
					pendingContentHash = null;
				}

				if (pendingContentUri) {
					try {
						await verifyTurboHas(pendingContentUri);
						contentUri = pendingContentUri;
						pendingContentUri = null;
						pendingContentHash = null;
					} catch {
						pendingContentUri = null;
						pendingContentHash = null;
						throw new Error(
							"Previous upload not confirmed on Arweave. Submit again to start a fresh upload on Arweave."
						);
					}
				} else {
					const blob = await encryptForRecipients(completeDoc, recipients);
					contentUri = await uploadDocument(JSON.stringify(blob));
					try {
						await verifyTurboHas(contentUri);
					} catch {
						pendingContentUri = contentUri;
						pendingContentHash = contentHash;
						throw new Error(
							"Upload sent to Arweave but our system couldn't confirm it yet. Click Submit to re-check."
						);
					}
				}
			}

			const references: DocumentReference[] = [
				...(revisionOf !== null
					? [
							{
								registryAddress: contractRegistryAddress,
								chainId: BigInt(chainId),
								categoryId: 0n,
								documentId: revisionOf,
								version: 0n,
								relationType: RELATION_REVISES,
								targetSection: ''
							} satisfies DocumentReference
						]
					: []),
				{
					registryAddress: daaRegistryAddress,
					chainId: BigInt(chainId),
					categoryId: BigInt(contractTemplateCategoryId!),
					documentId: BigInt(selectedTemplate.documentId),
					version: templateVersion,
					relationType: RELATION_TEMPLATE,
					targetSection: ''
				},
				...selectedLegislation.map((leg) => ({
					registryAddress: leg.registryAddress,
					chainId: BigInt(leg.chainId ?? chainId),
					categoryId: BigInt(leg.categoryId),
					documentId: BigInt(leg.documentId),
					version: BigInt(leg.version),
					relationType: leg.relationType,
					targetSection: ''
				}))
			];

			const scbOn = scbEnabled && scbValid;
			const params: CreateContractParams = {
				contentHash,
				signatories,
				contentUri,
				references,
				smartContractAddress: scbOn ? (scbAddress as `0x${string}`) : '0x0000000000000000000000000000000000000000',
				bytecodeHash: scbOn ? (scbBytecodeHash as `0x${string}`) : '0x0000000000000000000000000000000000000000000000000000000000000000',
				smartContractChainId: scbOn ? BigInt(scbChainId) : 0n
			};

			const txHash = await createContract(params);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });

			pendingContentUri = null;
			pendingContentHash = null;

			const count = await import('$lib/services/contract-registry').then(m => m.getContractCount());
			createdContractId = count;

			downloadArchiveMd(count, contentHash, completeDoc, signatories, references);
			oncreated(count, completeDoc);

			showToast(
				'success',
				hashOnlyMode
					? `Contract #${count} created (hash-only). Share the downloaded .md file with counterparties so they can import and sign.`
					: `Contract #${count} created. Counterparties can now read and sign in-app — no file transfer needed.`
			);
		} catch (e: any) {
			console.error('[submitCreate] CAUGHT:', e);
			const msg = e?.message || 'Failed to create contract';
			error = msg;
			if (!(e instanceof MarkdownUnsafeError)) {
				showToast('error', msg);
			}
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
				<p class="text-xs text-amber-200/80">This contract will supersede Contract #{revisionOf.toString()} in full. Signatories must match the original exactly. The reason below is embedded in the signed document and visible to every signatory.</p>
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
