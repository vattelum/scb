<script lang="ts">
	import { wallet } from '#lib/stores/wallet.ts';
	import ContractList from '#lib/components/ContractList.svelte';
	import ContractCreateForm from '#lib/components/ContractCreateForm.svelte';
	import ContractProposalBanner from '#lib/components/ContractProposalBanner.svelte';
	import LegislationExpand from '#lib/components/LegislationExpand.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import LoadingButton from '#lib/components/LoadingButton.svelte';
	import Tooltip from '#lib/components/Tooltip.svelte';

	const SCB_PROXY_WARNING = 'The bytecode hash is a snapshot of the contract at signing time. Proxy / upgradable contracts can swap their implementation later, which would invalidate this hash against the code actually running. Verify with the counterparty that the target is non-upgradable or that they accept upgrade risk.';
	import { showToast } from '#lib/stores/toasts.ts';
	import {
		getContract,
		getEvents,
		hasSigned,
		sign as signOnChain,
		decline as declineOnChain,
		dispute as disputeOnChain,
		proposeTermination as proposeTerminationOnChain,
		finalizeTermination as finalizeTerminationOnChain,
		cancelTermination as cancelTerminationOnChain,
		acceptTermination as acceptTerminationOnChain,
		rejectTermination as rejectTerminationOnChain,
		proposeCompletion as proposeCompletionOnChain,
		finalizeCompletion as finalizeCompletionOnChain,
		cancelCompletion as cancelCompletionOnChain,
		acceptCompletion as acceptCompletionOnChain,
		rejectCompletion as rejectCompletionOnChain,
		getTerminationProposal,
		getCompletionProposal,
		getTerminationAcceptCount,
		getCompletionAcceptCount,
		hasAcceptedTermination,
		hasAcceptedCompletion,
		effectiveStatus as readEffectiveStatus,
		hasActiveProposal,
		signContractTypedData,
		findRevisionSource,
		isExpired,
		Status,
		StatusLabels,
		statusClass,
		EventType,
		EventTypeLabels,
		type ContractRecord,
		type LifecycleEvent,
		type DocumentReference,
		type Proposal
	} from '#lib/services/contract-registry.ts';
	import { decryptAsRecipient, type EciesBlob } from '#lib/services/ecies.ts';
	import { isRegistered, register as registerPubkey } from '#lib/services/pubkey-registry.ts';
	import { deriveLocalPubkey, derivePrivateScalar, clearScalarCache } from '#lib/services/pubkey-derivation.ts';
	import { assembleAndPrint, fetchReferenceRows, renderContractHtml } from '#lib/services/print.ts';
	import { buildOnChainSidecar, downloadContractFiles } from '#lib/services/contract-create.ts';
	import { governingLawSection } from '#lib/services/contract-package.ts';
	import { hashBody, RELATION_REFERENCES, RELATION_TEMPLATE } from '@vattelum/document-registry-js';
	import { hashToBytes32 } from '#lib/services/hash.ts';
	import { contractRegistryAddress } from '#lib/contracts/index.ts';
	import { fetchFromArweave } from '#lib/services/arweave.ts';
	import { getClient } from '#lib/services/wallet-config.ts';
	import { truncAddr, formatDate, stripFrontmatter } from '#lib/services/format.ts';
	import { chainIdToLabel, chainIdToExplorer, formatNetwork } from '#lib/constants/networks.ts';
	const chainId = Number(import.meta.env.VITE_CHAIN_ID);

	const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

	// ────────────────── View State ─────────────────────────────

	type View = 'list' | 'create' | 'view' | 'import';

	let view = $state<View>('list');
	let loading = $state(false);
	// `error` remains for inline contextual errors tied to the contract view
	// (decrypt, hash mismatch, import). Transaction outcomes use toasts.
	let error = $state('');

	// ────────────────── List View ─────────────────────────────

	let contractListRef: ReturnType<typeof ContractList> | undefined = $state();

	// ────────────────── View/Sign State ────────────────────────

	let viewContractId = $state<bigint | null>(null);
	let viewContract = $state<ContractRecord | null>(null);
	let viewEvents = $state<LifecycleEvent[]>([]);
	let viewSigned = $state(false);
	let viewIsSignatory = $state(false);
	let viewContent = $state('');
	let viewContentVerified = $state(false);
	let showConfirmModal = $state(false);
	let signing = $state(false);
	let isProcessing = $state(false);

	// Lifecycle proposal state — null when no proposal active
	let viewTerminationProposal = $state<Proposal | null>(null);
	let viewCompletionProposal = $state<Proposal | null>(null);
	let viewTerminationAcceptCount = $state(0n);
	let viewCompletionAcceptCount = $state(0n);
	let viewSelfAcceptedTermination = $state(false);
	let viewSelfAcceptedCompletion = $state(false);
	// effectiveStatus folds in ripened proposals + expired signing windows
	let viewEffectiveStatus = $state<number | null>(null);
	const viewDisplayStatus = $derived(viewEffectiveStatus ?? viewContract?.status ?? 0);

	// ────────────────── Create View ───────────────────────────

	let createFormRef: ReturnType<typeof ContractCreateForm> | undefined = $state();
	let revisionSourceId = $state<bigint | null>(null);
	let revisionSourceSignatories = $state<`0x${string}`[] | null>(null);
	let revisionSourceContentHash = $state<`0x${string}` | null>(null);

	const viewRevisesContractId = $derived.by(() => {
		if (!viewContract) return null;
		return findRevisionSource(viewContract.references);
	});

	// "Revised by #N" — looked up in the list ref's already-built map. Both
	// ends of a revision share signatories, so the list (in 'mine' or 'all'
	// mode) carries them together when paged contiguously. The revising
	// contract's createdAt is fetched once so the synthetic timeline row
	// carries a real timestamp.
	let viewRevisedByContractId = $state<bigint | null>(null);
	let viewRevisedByCreatedAt = $state<bigint | null>(null);

	// Governing law is in the contract text. Only plain references stay out of it.
	const viewReferenceRefs = $derived.by(() => {
		if (!viewContract) return [] as DocumentReference[];
		return viewContract.references.filter((r) => r.relationType === RELATION_REFERENCES);
	});

	const viewLawSection = $derived(viewContent ? governingLawSection(viewContent) : null);
	let viewShowSource = $state(false);

	// The package just created in this session, so its creator never has to
	// re-import their own file (hash-only mode has no other copy in the app).
	let createdPackage: { id: bigint; text: string } | null = null;

	// ────────────────── Import State ───────────────────────────

	let importContent = $state('');
	let importContractId = $state('');
	let importHashMatch = $state<boolean | null>(null);

	// ────────────────── Pubkey Registration State ──────────────

	type PubkeyState = 'unknown' | 'registered' | 'unregistered' | 'registering';
	let pubkeyState = $state<PubkeyState>('unknown');
	let showRegisterModal = $state(false);

	async function checkPubkeyRegistration() {
		if (!$wallet.address) {
			pubkeyState = 'unknown';
			return;
		}
		if (!$wallet.isTokenHolder) {
			pubkeyState = 'unknown';
			return;
		}
		try {
			const registered = await isRegistered($wallet.address);
			pubkeyState = registered ? 'registered' : 'unregistered';
			if (!registered) showRegisterModal = true;
		} catch {
			pubkeyState = 'unknown';
		}
	}

	async function confirmRegisterPubkey() {
		if (!$wallet.address) return;
		pubkeyState = 'registering';
		error = '';
		try {
			const pubkey = await deriveLocalPubkey($wallet.address);
			const txHash = await registerPubkey(pubkey);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			pubkeyState = 'registered';
			showRegisterModal = false;
			showToast('success', 'Encryption key registered. You can now send and receive contracts in-app.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to register encryption key');
			pubkeyState = 'unregistered';
		}
	}

	// Delay showing non-member banner to avoid flash during async role check
	let showMemberBanner = $state(false);
	let memberBannerTimeout: ReturnType<typeof setTimeout> | null = null;

	// Check pubkey registration when wallet connects, clear scalar cache on change
	let lastWalletAddress: string | null = null;
	$effect(() => {
		const addr = $wallet.address;
		if (addr !== lastWalletAddress) {
			clearScalarCache();
			lastWalletAddress = addr;
			showMemberBanner = false;
			if (memberBannerTimeout) clearTimeout(memberBannerTimeout);
		}
		if (addr) {
			if ($wallet.isTokenHolder) {
				showMemberBanner = false;
				if (memberBannerTimeout) clearTimeout(memberBannerTimeout);
			} else {
				// Show after a short delay — checkRoles typically resolves within 1s
				if (!memberBannerTimeout) {
					memberBannerTimeout = setTimeout(() => {
						if (!$wallet.isTokenHolder) showMemberBanner = true;
						memberBannerTimeout = null;
					}, 1500);
				}
			}
			checkPubkeyRegistration();
		} else {
			pubkeyState = 'unknown';
		}
	});

	async function openContract(id: bigint, knownRevisedBy: bigint | null = null) {
		viewContractId = id;
		viewContent = '';
		viewContentVerified = false;
		loading = true;
		error = '';
		try {
			await loadContractState(id, knownRevisedBy);
			if (createdPackage?.id === id) await verifyAndSetContent(createdPackage.text);
			view = 'view';
		} catch (e: any) {
			showToast('error', e.message || 'Failed to load contract');
		} finally {
			loading = false;
		}
	}

	// Loads / refreshes everything the view needs for a contract. Called on open
	// and after any on-chain action (sign, decline, propose*, finalize*, dispute).
	async function loadContractState(id: bigint, knownRevisedBy: bigint | null = null) {
		const [contract, events, termProp, compProp, effStatus] = await Promise.all([
			getContract(id),
			getEvents(id),
			getTerminationProposal(id),
			getCompletionProposal(id),
			readEffectiveStatus(id)
		]);
		viewContract = contract;
		viewEvents = events;
		viewTerminationProposal = hasActiveProposal(termProp) ? termProp : null;
		viewCompletionProposal = hasActiveProposal(compProp) ? compProp : null;
		viewEffectiveStatus = effStatus;

		// Accept-state hydration runs only when there's an active proposal of that
		// kind and we have a wallet to check against — keeps the read path light.
		if (viewTerminationProposal && $wallet.address) {
			const [count, selfAccepted] = await Promise.all([
				getTerminationAcceptCount(id),
				hasAcceptedTermination(id, $wallet.address)
			]);
			viewTerminationAcceptCount = count;
			viewSelfAcceptedTermination = selfAccepted;
		} else {
			viewTerminationAcceptCount = 0n;
			viewSelfAcceptedTermination = false;
		}
		if (viewCompletionProposal && $wallet.address) {
			const [count, selfAccepted] = await Promise.all([
				getCompletionAcceptCount(id),
				hasAcceptedCompletion(id, $wallet.address)
			]);
			viewCompletionAcceptCount = count;
			viewSelfAcceptedCompletion = selfAccepted;
		} else {
			viewCompletionAcceptCount = 0n;
			viewSelfAcceptedCompletion = false;
		}
		viewIsSignatory = $wallet.address
			? contract.signatories.some((s) => s.toLowerCase() === $wallet.address!.toLowerCase())
			: false;
		viewSigned = $wallet.address ? await hasSigned(id, $wallet.address) : false;
		// Prefer the caller's hint (e.g. clicking "Revises Contract #M" from #N
		// implies #M is revised by #N) over the list-derived map, which goes
		// stale once ContractList unmounts on view transition.
		viewRevisedByContractId = knownRevisedBy ?? contractListRef?.getRevisedBy(id) ?? null;
		if (viewRevisedByContractId !== null) {
			try {
				const rev = await getContract(viewRevisedByContractId);
				viewRevisedByCreatedAt = rev.createdAt;
			} catch {
				viewRevisedByCreatedAt = null;
			}
		} else {
			viewRevisedByCreatedAt = null;
		}
	}

	let decrypting = $state(false);

	// Single gate for every path that populates viewContent (decrypt, import, create).
	// Recomputes SHA-256 over the body and compares to the on-chain contentHash;
	// only sets viewContentVerified = true on match. On mismatch, clears content
	// and returns false so the caller can surface the integrity violation.
	async function verifyAndSetContent(body: string): Promise<boolean> {
		if (!viewContract) {
			viewContent = '';
			viewContentVerified = false;
			return false;
		}
		const bodyHash = hashBody(body);
		const computedHash = hashToBytes32(bodyHash);
		if (computedHash === viewContract.contentHash) {
			viewContent = body;
			viewContentVerified = true;
			return true;
		}
		viewContent = '';
		viewContentVerified = false;
		return false;
	}

	async function decryptContent() {
		if (!viewContractId || !viewContract || !$wallet.address) return;
		decrypting = true;
		error = '';
		try {
			// The creator's ECIES blob is always at slot 0; later slots are the
			// append-only audit trail (signers re-push the same TX at sign time).
			// Read slot 0 explicitly rather than scanning, so the retrieval target
			// can't be influenced by later entries.
			const sharedTxId = viewContract.contentUris[0]?.length ? viewContract.contentUris[0] : undefined;
			if (!sharedTxId) {
				error = 'No encrypted copy found on Arweave. If this contract was just created, Arweave may still be propagating — try again in a minute. If this contract was created in hash-only mode, use Import to load the .md file instead.';
				return;
			}

			let raw: string;
			try {
				raw = await fetchFromArweave(sharedTxId);
			} catch (e: any) {
				const msg = typeof e?.message === 'string' ? e.message : '';
				if (msg.includes('not yet available') || msg.includes('confirming')) {
					error = 'Arweave is still propagating this contract. Try again in a minute. If this persists, the creator can share their .md file and you can Import instead.';
				} else {
					error = `Could not fetch from Arweave: ${msg || 'unknown error'}. Try again in a minute, or Import the .md file if the creator shared it.`;
				}
				return;
			}

			let blob: EciesBlob;
			try {
				blob = JSON.parse(raw) as EciesBlob;
			} catch {
				error = 'Stored content is not in ECIES format. This contract was created before the in-app signing upgrade — use Import.';
				return;
			}

			const mySlot = blob.wrappedKeys?.[$wallet.address.toLowerCase()];
			if (!mySlot) {
				error = 'You are not a recipient of this contract — no encrypted copy is addressed to your wallet.';
				return;
			}

			const scalar = await derivePrivateScalar($wallet.address);
			const decrypted = await decryptAsRecipient(blob, $wallet.address, scalar);
			const ok = await verifyAndSetContent(decrypted);
			if (!ok) {
				error = 'Content mismatch — the decrypted document does not match the on-chain content hash. Signing is disabled.';
			}
		} catch (e: any) {
			// AES-GCM decryption failures throw opaque "OperationError" in the
			// browser. Log the underlying error so we can pin root cause.
			console.error('[decryptContent] failed:', e);
			const msg = typeof e?.message === 'string' ? e.message : '';
			if (e?.name === 'OperationError') {
				error = 'Decryption failed: the encryption key derived from your wallet signature does not match the pubkey the creator encrypted to. This usually means your registered pubkey is stale. Try Import as a workaround and please report this.';
			} else {
				error = `Decryption failed: ${msg || 'unknown error'}. Try Import as a workaround.`;
			}
		} finally {
			decrypting = false;
		}
	}

	function startCreate() {
		view = 'create';
		error = '';
		revisionSourceId = null;
		revisionSourceSignatories = null;
		revisionSourceContentHash = null;
		// Defer template loading to the component's init()
		setTimeout(() => createFormRef?.init(), 0);
	}

	function startRevision() {
		if (!viewContract || !viewContractId) return;
		revisionSourceId = viewContractId;
		revisionSourceSignatories = [...viewContract.signatories];
		revisionSourceContentHash = viewContract.contentHash;
		view = 'create';
		error = '';
		setTimeout(() => createFormRef?.init(), 0);
	}

	function handleContractCreated(id: bigint, content: string) {
		createdPackage = { id, text: content };
	}

	// ────────────────── Sign Functions ─────────────────────────

	function openConfirmModal() {
		showConfirmModal = true;
	}

	async function confirmSign() {
		if (!viewContractId || !viewContract || !$wallet.address) return;
		signing = true;
		isProcessing = true;
		error = '';
		showConfirmModal = false;

		try {
			// EIP-712 sign
			const signature = await signContractTypedData(viewContractId, viewContract.contentHash);

			// Reuse the creator's shared ECIES blob (slot 0) — every signatory's
			// wrapped key is already in it. No re-encryption, no second Arweave
			// upload. Later slots are audit trail only.
			const sharedTxId = viewContract.contentUris[0]?.length ? viewContract.contentUris[0] : '';

			// Submit on-chain
			const txHash = await signOnChain(viewContractId, signature, sharedTxId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });

			viewSigned = true;
			await loadContractState(viewContractId);
			showToast('success', 'Contract signed successfully!');

			// If signing from import view, redirect to contract view
			if (view === 'import') {
				view = 'view';
			}
		} catch (e: any) {
			showToast('error', e.message || 'Failed to sign contract');
		} finally {
			signing = false;
			isProcessing = false;
		}
	}

	async function handleDecline() {
		if (!viewContractId) return;
		if (!confirm('Are you sure you want to decline this contract?')) return;
		isProcessing = true;
		loading = true;
		error = '';
		try {
			const txHash = await declineOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Contract declined.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to decline contract');
		} finally {
			loading = false;
			isProcessing = false;
		}
	}

	async function handleProposeTermination() {
		if (!viewContractId) return;
		if (!confirm('Propose termination? The other party has 30 days to accept, reject, or dispute.')) return;
		loading = true;
		error = '';
		try {
			const txHash = await proposeTerminationOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Termination proposed.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to propose termination');
		} finally {
			loading = false;
		}
	}

	async function handleProposeCompletion() {
		if (!viewContractId) return;
		if (!confirm('Propose completion? The other party has 30 days to accept, reject, or dispute.')) return;
		loading = true;
		error = '';
		try {
			const txHash = await proposeCompletionOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Completion proposed.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to propose completion');
		} finally {
			loading = false;
		}
	}

	async function handleFinalizeTermination() {
		if (!viewContractId) return;
		loading = true;
		error = '';
		try {
			const txHash = await finalizeTerminationOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Contract terminated.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to finalize termination');
		} finally {
			loading = false;
		}
	}

	async function handleFinalizeCompletion() {
		if (!viewContractId) return;
		loading = true;
		error = '';
		try {
			const txHash = await finalizeCompletionOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Contract completed.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to finalize completion');
		} finally {
			loading = false;
		}
	}

	async function handleCancelTermination() {
		if (!viewContractId) return;
		if (!confirm('Cancel your termination proposal? The contract stays Active.')) return;
		loading = true;
		error = '';
		try {
			const txHash = await cancelTerminationOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Termination proposal cancelled.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to cancel termination');
		} finally {
			loading = false;
		}
	}

	async function handleCancelCompletion() {
		if (!viewContractId) return;
		if (!confirm('Cancel your completion proposal? The contract stays Active.')) return;
		loading = true;
		error = '';
		try {
			const txHash = await cancelCompletionOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Completion proposal cancelled.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to cancel completion');
		} finally {
			loading = false;
		}
	}

	async function handleAcceptTermination() {
		if (!viewContractId) return;
		if (!confirm('Accept the termination proposal?')) return;
		loading = true;
		error = '';
		try {
			const txHash = await acceptTerminationOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Termination accepted.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to accept termination');
		} finally {
			loading = false;
		}
	}

	async function handleAcceptCompletion() {
		if (!viewContractId) return;
		if (!confirm('Accept the completion proposal?')) return;
		loading = true;
		error = '';
		try {
			const txHash = await acceptCompletionOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Completion accepted.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to accept completion');
		} finally {
			loading = false;
		}
	}

	async function handleRejectTermination() {
		if (!viewContractId) return;
		if (!confirm('Reject the termination proposal? The contract stays Active.')) return;
		loading = true;
		error = '';
		try {
			const txHash = await rejectTerminationOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Termination rejected.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to reject termination');
		} finally {
			loading = false;
		}
	}

	async function handleRejectCompletion() {
		if (!viewContractId) return;
		if (!confirm('Reject the completion proposal? The contract stays Active.')) return;
		loading = true;
		error = '';
		try {
			const txHash = await rejectCompletionOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', 'Completion rejected.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to reject completion');
		} finally {
			loading = false;
		}
	}

	async function handleDispute() {
		if (!viewContractId) return;
		const hasProposal = viewTerminationProposal || viewCompletionProposal;
		const msg = hasProposal
			? 'Raising a dispute records your objection on-chain. Continue?'
			: 'Raise a dispute on this contract? This records your objection on the timeline but does not change the contract status.';
		if (!confirm(msg)) return;
		loading = true;
		error = '';
		try {
			const txHash = await disputeOnChain(viewContractId);
			const client = getClient();
			await client.waitForTransactionReceipt({ hash: txHash });
			await loadContractState(viewContractId);
			showToast('success', hasProposal ? 'Proposal cancelled and dispute recorded.' : 'Dispute recorded.');
		} catch (e: any) {
			showToast('error', e.message || 'Failed to record dispute');
		} finally {
			loading = false;
		}
	}

	let showImportForPrint = $state(false);

	async function handlePrint() {
		if (!viewContractId || !viewContract) return;

		const hasArweave = viewContract.contentUris.some((t) => t && t.length > 0);

		// If no content loaded and no Arweave blob, prompt for import
		if (!viewContent && !hasArweave) {
			showImportForPrint = true;
			return;
		}

		loading = true;
		error = '';

		try {
			let content = viewContent;
			if (!content) {
				await decryptContent();
				content = viewContent;
			}

			if (!content) {
				error = 'No content available. Import the .md file to print this contract.';
				return;
			}

			const referenceRows = await fetchReferenceRows(viewContract.references, contractRegistryAddress);

			const isDraft =
				viewContract.signatures.length < viewContract.signatories.length;

			assembleAndPrint({
				contractId: viewContractId,
				contract: viewContract,
				contractContent: content,
				referenceRows,
				events: viewEvents,
				contractRegistryAddress,
				chainId,
				effectiveStatus: viewDisplayStatus,
				draft: isDraft
			});
		} catch (e: any) {
			showToast('error', e.message || 'Failed to prepare print document');
		} finally {
			loading = false;
		}
	}

	async function handleImportForPrint(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !viewContractId || !viewContract) return;
		error = '';

		const text = await file.text();
		const body = stripFrontmatter(text);

		if (await verifyAndSetContent(body)) {
			showImportForPrint = false;
			// Content loaded, now print
			await handlePrint();
		} else {
			error = 'Hash mismatch — this file does not match the on-chain record.';
		}
	}

	async function handleDownload() {
		if (!viewContractId || !viewContract) return;
		error = '';
		if (!viewContent && viewContract.contentUris.some((t) => t && t.length > 0)) {
			await decryptContent();
		}
		if (!viewContent) {
			error = error || 'No content available. Import the .md file first.';
			return;
		}
		downloadContractFiles(
			viewContractId,
			viewContent,
			buildOnChainSidecar(viewContractId, viewContract, contractRegistryAddress, chainId)
		);
	}

	// ────────────────── Inline Import (within contract view) ──

	async function handleInlineImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !viewContractId || !viewContract) return;
		error = '';

		const text = await file.text();
		const body = stripFrontmatter(text);

		if (await verifyAndSetContent(body)) {
			showToast('success', 'File imported and hash verified.');
		} else {
			error = 'Hash mismatch — this file does not match the on-chain record. Signing is disabled.';
		}
	}

	// ────────────────── Import Functions ───────────────────────

	async function handleImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const text = await file.text();
		importContent = text;

		// Extract contract_id from frontmatter
		const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
		if (fmMatch) {
			const cidMatch = fmMatch[1].match(/contract_id:\s*"?(\d+)"?/);
			if (cidMatch) importContractId = cidMatch[1];
		}
	}

	// The sidecar is informational: it only prefills the contract id.
	async function handleImportSidecar(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		error = '';
		try {
			const id = JSON.parse(await file.text())?.contractId;
			if (id === undefined || !/^\d+$/.test(String(id))) throw new Error();
			importContractId = String(id);
		} catch {
			error = 'This sidecar file has no contract id. Enter the id below.';
		}
	}

	async function verifyImport() {
		if (!importContractId || !importContent) return;
		error = '';
		try {
			const id = BigInt(importContractId);
			const contract = await getContract(id);

			const body = stripFrontmatter(importContent);
			viewContractId = id;
			await loadContractState(id);
			importHashMatch = await verifyAndSetContent(body);
		} catch (e: any) {
			showToast('error', e.message || 'Verification failed');
		}
	}

	// ────────────────── Helpers ────────────────────────────────

	function goBack() {
		view = 'list';
		viewContractId = null;
		viewContract = null;
		error = '';
		importHashMatch = null;
		importContent = '';
		importContractId = '';
		contractListRef?.loadContracts();
	}
</script>

<div>
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold">
			{#if view === 'list'}Contracts
			{:else if view === 'create'}Create Contract
			{:else if view === 'view'}Contract #{viewContractId}
			{:else if view === 'import'}Import Contract
			{/if}
		</h1>
		{#if view !== 'list'}
			<button onclick={goBack} class="text-sm text-text-secondary hover:text-text transition-colors cursor-pointer">
				&larr; Back
			</button>
		{/if}
	</div>

	{#if $wallet.connected && showMemberBanner && !$wallet.isTokenHolder}
		<div class="bg-yellow-900/30 border border-yellow-700 text-yellow-200 rounded-lg p-3 mb-4 text-sm">
			You must be a DAA member to use contracts. <a href="/admin" class="text-primary hover:underline">Join</a> first.
		</div>
	{:else if $wallet.connected && pubkeyState === 'unregistered'}
		<div class="bg-yellow-900/30 border border-yellow-700 text-yellow-200 rounded-lg p-3 mb-4 text-sm flex items-center justify-between gap-3">
			<span>Register your encryption key (one-time) so you can send and receive contracts in-app.</span>
			<button
				onclick={() => (showRegisterModal = true)}
				class="bg-yellow-700 hover:bg-yellow-600 text-white text-xs px-3 py-1 rounded transition-colors cursor-pointer whitespace-nowrap"
			>
				Register
			</button>
		</div>
	{/if}

	<!-- ═══════════════ LIST VIEW ═══════════════ -->
	{#if view === 'list'}
		<ContractList
			bind:this={contractListRef}
			pubkeyRegistered={pubkeyState === 'registered'}
			oncreate={startCreate}
			onimport={() => { view = 'import'; }}
			onopencontract={openContract}
		/>

	<!-- ═══════════════ CREATE VIEW ═══════════════ -->
	{:else if view === 'create'}
		<ContractCreateForm
			bind:this={createFormRef}
			oncreated={handleContractCreated}
			onopencontract={openContract}
			revisionOf={revisionSourceId}
			revisionSourceSignatories={revisionSourceSignatories}
			revisionSourceContentHash={revisionSourceContentHash}
		/>

	<!-- ═══════════════ VIEW / SIGN ═══════════════ -->
	{:else if view === 'view' && viewContract}
		<div class="flex flex-col gap-4">
			<!-- Status & Info Card -->
			<div class="bg-surface border border-border rounded-lg p-4">
				<div class="flex items-center justify-between mb-3">
					<span class="text-lg font-medium {viewRevisedByContractId !== null ? 'text-amber-300' : statusClass(viewDisplayStatus)}">
						{viewRevisedByContractId !== null ? 'Revised' : (StatusLabels[viewDisplayStatus] ?? 'Unknown')}
					</span>
					<span class="text-xs text-text-muted">Created {formatDate(viewContract.createdAt)}</span>
				</div>

				{#if viewRevisesContractId !== null}
					<div class="mb-3 text-xs text-amber-300">
						Revises
						<button
							onclick={() => openContract(viewRevisesContractId!, viewContractId)}
							class="underline hover:text-amber-200 cursor-pointer"
						>Contract #{viewRevisesContractId.toString()}</button>
					</div>
				{/if}
				{#if viewRevisedByContractId !== null}
					<div class="mb-3 text-xs text-amber-300">
						Revised by
						<button
							onclick={() => openContract(viewRevisedByContractId!)}
							class="underline hover:text-amber-200 cursor-pointer"
						>Contract #{viewRevisedByContractId.toString()}</button>
					</div>
				{/if}

				<div class="text-xs text-text-muted mb-1">Content Hash</div>
				<div class="text-xs font-mono text-text-secondary mb-3 break-all">{viewContract.contentHash}</div>

				<div class="text-xs text-text-muted mb-1">Signatories</div>
				<div class="flex flex-col gap-1">
					{#each viewContract.signatories as addr}
						{@const lower = addr.toLowerCase()}
						{@const signed = viewEvents.some((e) => e.eventType === EventType.Signed && e.actor.toLowerCase() === lower)}
						{@const declined = viewContract.status === Status.Declined && viewEvents.some((e) => e.eventType === EventType.Declined && e.actor.toLowerCase() === lower)}
						<div class="flex items-center gap-2 text-sm">
							<span class="font-mono text-text-secondary">{truncAddr(addr)}</span>
							{#if signed}
								<span class="text-green-400 text-xs">signed</span>
							{:else if declined}
								<span class="text-red-400 text-xs">declined</span>
							{:else}
								<span class="text-yellow-400 text-xs">pending</span>
							{/if}
						</div>
					{/each}
				</div>

				{#if viewContract.status === Status.Created && isExpired(viewContract.createdAt)}
					<div class="mt-3 text-xs text-red-400">Signing window expired</div>
				{:else if viewContract.status === Status.Created}
					<div class="mt-3 text-xs text-text-muted">
						{viewContract.signatures.length} of {viewContract.signatories.length} signed
					</div>
				{/if}

				<!-- Print button in the info card — available on Active, Terminated, Completed, plus a draft-print on Created. -->
				{#if viewIsSignatory && (viewContract.status === Status.Active || viewContract.status === Status.Terminated || viewContract.status === Status.Completed || (viewContract.status === Status.Created && viewContentVerified))}
					<div class="mt-4 pt-3 border-t border-border flex gap-2 flex-wrap">
						<button
							onclick={handlePrint}
							class="bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
						>
							{viewContract.status === Status.Created ? 'Print unsigned version' : 'Print Contract'}
						</button>
						<button
							onclick={handleDownload}
							class="bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
						>
							Download contract file
						</button>
						{#if viewContract.status === Status.Active && viewRevisedByContractId === null}
							<button
								onclick={startRevision}
								class="bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
							>
								Propose Revision
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Signing Actions (Created contracts only, content must be loaded) -->
			{#if viewIsSignatory && !viewSigned && viewContract.status === Status.Created && !isExpired(viewContract.createdAt)}
				<div class="flex gap-3 flex-wrap">
					<LoadingButton
						onclick={openConfirmModal}
						loading={signing}
						loadingLabel="Signing..."
						disabled={isProcessing || !viewContent || !viewContentVerified}
						title={!viewContent ? 'Load contract content first' : !viewContentVerified ? 'Content failed hash verification' : ''}
						variant="none"
						class="bg-green-700 hover:bg-green-600"
					>
						Sign
					</LoadingButton>
					<LoadingButton
						onclick={handleDecline}
						disabled={isProcessing}
						variant="danger"
					>
						Decline
					</LoadingButton>
				</div>
				{#if !viewContent}
					<p class="text-xs text-text-muted">Decrypt or import the contract content to enable signing.</p>
				{/if}
			{/if}

			{#if error}
				<div class="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 text-sm">{error}</div>
			{/if}

			<!-- Contract Content (decrypt or import to view) -->
			{#if viewIsSignatory && viewContract.status === Status.Created}
				{@const hasArweave = viewContract.contentUris.some((t) => t && t.length > 0)}
				<div class="bg-surface border border-border rounded-lg p-4">
					{#if viewContent && viewContentVerified}
						<div class="flex items-center gap-2 mb-3">
							<span class="text-green-400 text-xs">Content verified</span>
						</div>
						<div class="flex justify-end">
							<button
								onclick={() => (viewShowSource = !viewShowSource)}
								class="text-xs text-text-secondary hover:text-text underline cursor-pointer"
							>
								{viewShowSource ? 'Show document' : 'Show source'}
							</button>
						</div>
						{#if viewShowSource}
							<div class="text-text text-xs font-mono whitespace-pre-wrap break-words border-t border-border pt-3 mt-2">{viewContent}</div>
						{:else}
							<div class="doc-viewer prose prose-invert max-w-none text-text text-sm border-t border-border pt-3 mt-2">{@html renderContractHtml(viewContent)}</div>
						{/if}
					{:else if !hasArweave}
						<div class="flex items-center gap-2 mb-2">
							<span class="text-yellow-400 text-xs">Not stored on Arweave</span>
						</div>
						<p class="text-xs text-text-muted mb-2">This contract was created in hash-only mode. Import the .md file from the contract creator to view and sign.</p>
						<label class="inline-block bg-primary hover:bg-primary-hover text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer">
							Import File
							<input type="file" accept=".md" onchange={handleInlineImport} class="hidden" />
						</label>
					{:else}
						<p class="text-xs text-text-muted mb-2">Load the contract content to review before signing.</p>
						<div class="flex gap-2">
							<button
								onclick={decryptContent}
								disabled={decrypting}
								class="bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
							>
								{decrypting ? 'Decrypting...' : 'Decrypt from Arweave'}
							</button>
							<label class="inline-block bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer">
								Import File
								<input type="file" accept=".md" onchange={handleInlineImport} class="hidden" />
							</label>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Referenced documents (not part of the contract text) -->
			{#if viewReferenceRefs.length > 0}
				<div class="bg-surface border border-border rounded-lg p-4">
					<h3 class="text-sm font-medium mb-1">Referenced Documents</h3>
					<p class="text-xs text-text-muted mb-3">Click each entry to expand the full consolidated text as it stood when the contract was created.</p>
					<div class="flex flex-col gap-1">
						{#each viewReferenceRefs as ref}
							<LegislationExpand reference={ref} asOf={viewContract.createdAt} />
						{/each}
					</div>
				</div>
			{/if}

			<!-- Smart Contract Reference (SCB) -->
			{#if viewContract.smartContractAddress !== ZERO_ADDRESS}
				{@const scbExplorer = chainIdToExplorer(Number(viewContract.smartContractChainId))}
				<div class="bg-surface border border-border rounded-lg p-4">
					<h3 class="text-sm font-medium mb-3">Smart Contract</h3>
					<div class="flex flex-col gap-2 text-xs">
						<div>
							<span class="text-text-muted">Address:</span>
							<span class="font-mono ml-1 break-all">{viewContract.smartContractAddress}</span>
						</div>
						<div>
							<span class="text-text-muted">Network:</span>
							<span class="ml-1">{formatNetwork(Number(viewContract.smartContractChainId))}</span>
						</div>
						<div class="break-all">
							<span class="text-text-muted">Bytecode hash:</span>
							<Tooltip text={SCB_PROXY_WARNING} align="left"><span class="ml-1 text-text-muted cursor-help text-xs">(?)</span></Tooltip>
							<span class="font-mono ml-1">{viewContract.bytecodeHash}</span>
						</div>
						{#if scbExplorer}
							<div>
								<a href="{scbExplorer}/address/{viewContract.smartContractAddress}" target="_blank" rel="noopener" class="text-primary hover:underline">
									View on {chainIdToLabel(Number(viewContract.smartContractChainId))} explorer →
								</a>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			{#if viewTerminationProposal && viewContract}
				<ContractProposalBanner
					proposal={viewTerminationProposal}
					label="Termination"
					{viewIsSignatory}
					currentAddress={$wallet.address ?? null}
					selfAccepted={viewSelfAcceptedTermination}
					acceptCount={viewTerminationAcceptCount}
					signatoryCount={viewContract.signatories.length}
					{loading}
					onCancel={handleCancelTermination}
					onAccept={handleAcceptTermination}
					onReject={handleRejectTermination}
					onFinalize={handleFinalizeTermination}
				/>
			{/if}
			{#if viewCompletionProposal && viewContract}
				<ContractProposalBanner
					proposal={viewCompletionProposal}
					label="Completion"
					{viewIsSignatory}
					currentAddress={$wallet.address ?? null}
					selfAccepted={viewSelfAcceptedCompletion}
					acceptCount={viewCompletionAcceptCount}
					signatoryCount={viewContract.signatories.length}
					{loading}
					onCancel={handleCancelCompletion}
					onAccept={handleAcceptCompletion}
					onReject={handleRejectCompletion}
					onFinalize={handleFinalizeCompletion}
				/>
			{/if}

			<!-- Lifecycle Actions Card -->
			{#if viewIsSignatory && (viewContract.status === Status.Active || viewContract.status === Status.Terminated || viewContract.status === Status.Completed)}
				<div class="bg-surface border border-border rounded-lg p-4">
					<h3 class="text-sm font-medium mb-3">Contract Actions</h3>
					<div class="flex gap-3 flex-wrap">
						{#if viewContract.status === Status.Active && !viewCompletionProposal}
							<LoadingButton
								onclick={handleProposeCompletion}
								loading={loading}
								loadingLabel="Working..."
								variant="none"
								class="bg-blue-800 hover:bg-blue-700"
							>
								Propose Completion
							</LoadingButton>
						{/if}
						{#if viewContract.status === Status.Active && !viewTerminationProposal}
							<LoadingButton
								onclick={handleProposeTermination}
								loading={loading}
								loadingLabel="Working..."
								variant="none"
								class="bg-orange-800 hover:bg-orange-700"
							>
								Propose Termination
							</LoadingButton>
						{/if}
						<LoadingButton
							onclick={handleDispute}
							loading={loading}
							loadingLabel="Working..."
							variant="none"
							class="bg-yellow-700 hover:bg-yellow-600"
						>
							Dispute
						</LoadingButton>
					</div>
					{#if viewContract.status === Status.Active && (viewTerminationProposal || viewCompletionProposal)}
						<p class="text-xs text-text-muted mt-3">
							A proposal is already active. Use the banner above to act on it.
						</p>
					{/if}
				</div>
			{/if}

			<!-- Lifecycle Timeline -->
			{#if viewEvents.length > 0 || viewRevisedByContractId !== null}
				<div class="bg-surface border border-border rounded-lg p-4">
					<h3 class="text-sm font-medium mb-3">Timeline</h3>
					<div class="flex flex-col gap-2">
						{#each viewEvents as event}
							<div class="flex items-start gap-3 text-xs">
								<span class="text-text-muted min-w-[140px]">
									{new Date(Number(event.timestamp) * 1000).toLocaleString()}
								</span>
								<span class="font-medium">
									{EventTypeLabels[event.eventType] ?? `Event ${event.eventType}`}
								</span>
								<span class="font-mono text-text-secondary">{truncAddr(event.actor)}</span>
							</div>
						{/each}
						{#if viewRevisedByContractId !== null}
							<div class="flex items-start gap-3 text-xs">
								<span class="text-text-muted min-w-[140px]">
									{viewRevisedByCreatedAt !== null
										? new Date(Number(viewRevisedByCreatedAt) * 1000).toLocaleString()
										: '—'}
								</span>
								<span class="font-medium text-amber-300">Revised</span>
								<button
									onclick={() => openContract(viewRevisedByContractId!)}
									class="underline text-amber-300 hover:text-amber-200 cursor-pointer"
								>by Contract #{viewRevisedByContractId.toString()}</button>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

	<!-- ═══════════════ IMPORT VIEW ═══════════════ -->
	{:else if view === 'import'}
		<div class="flex flex-col gap-4">
			<div>
				<label for="import-file" class="block text-sm text-text-secondary mb-1">Import Contract File</label>
				<label class="inline-block bg-primary hover:bg-primary-hover text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer">
					Choose .md file
					<input
						id="import-file"
						type="file"
						accept=".md"
						onchange={handleImport}
						class="hidden"
					/>
				</label>
				<label class="inline-block ml-2 bg-surface hover:bg-surface-hover border border-border text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer">
					Choose .json sidecar (optional)
					<input type="file" accept=".json" onchange={handleImportSidecar} class="hidden" />
				</label>
				<p class="text-xs text-text-muted mt-2">An untouched file also matches with <code>sha256sum</code>. A file re-saved by an editor that appends a newline still passes this check, but not <code>sha256sum</code>.</p>
				{#if error}
					<p class="text-red-400 text-xs mt-2">{error}</p>
				{/if}
			</div>

			{#if importContent}
				<div>
					<label for="import-id" class="block text-sm text-text-secondary mb-1">Contract ID</label>
					<div class="flex gap-2">
						<input
							id="import-id"
							bind:value={importContractId}
							placeholder="Contract ID"
							class="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text flex-1"
						/>
						<button
							onclick={verifyImport}
							class="bg-primary hover:bg-primary-hover text-text text-sm px-4 py-1.5 rounded transition-colors cursor-pointer"
						>
							Verify
						</button>
					</div>
				</div>

				{#if importHashMatch === true}
					<div class="bg-green-900/30 border border-green-700 text-green-300 rounded-lg p-3 text-sm">
						Hash verified — document matches on-chain record.
					</div>
					{#if viewContract}
						{#if viewSigned || viewContract.status !== Status.Created}
							<div class="bg-green-900/30 border border-green-700 text-green-300 rounded-lg p-3 text-sm flex items-center justify-between">
								<span>{viewSigned ? 'You have signed this contract.' : `Contract is ${StatusLabels[viewContract.status]}.`}</span>
								<button
									onclick={() => { view = 'view'; }}
									class="bg-primary hover:bg-primary-hover text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
								>
									View Contract
								</button>
							</div>
						{:else if viewIsSignatory && !viewSigned && viewContract.status === Status.Created}
							<div class="flex gap-3">
								<button
									onclick={openConfirmModal}
									class="bg-green-700 hover:bg-green-600 text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
								>
									Sign
								</button>
								<button
									onclick={handleDecline}
									class="bg-red-800 hover:bg-red-700 text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer"
								>
									Decline
								</button>
							</div>
						{/if}
					{/if}
				{:else if importHashMatch === false}
					<div class="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 text-sm">
						Hash mismatch — this document does not match the on-chain record. Signing is disabled.
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- ═══════════════ CONFIRM MODAL ═══════════════ -->
	{#if viewContract && viewContractId}
		{@const templateRef = viewContract.references.find(r => r.relationType === RELATION_TEMPLATE)}
		<Modal bind:open={showConfirmModal} title="Confirm Signature" maxWidth="max-w-lg">
			<div class="flex flex-col gap-3 text-sm">
				<div>
					<span class="text-text-muted">Contract ID:</span>
					<span class="font-mono ml-1">#{viewContractId.toString()}</span>
					{#if templateRef}
						<div class="text-xs text-text-muted mt-0.5">
							<span class="font-mono">{truncAddr(templateRef.registryAddress)}</span>
							<span class="ml-1">Cat {templateRef.categoryId.toString()} / Doc {templateRef.documentId.toString()} v{templateRef.version.toString()}</span>
						</div>
					{/if}
				</div>
				<div>
					<span class="text-text-muted">Content Hash:</span>
					<div class="font-mono text-xs break-all mt-0.5">{viewContract.contentHash}</div>
				</div>
				<div>
					<span class="text-text-muted">Signatories:</span>
					<div class="mt-1">
						{#each viewContract.signatories as addr}
							<div class="font-mono text-xs">{addr}</div>
						{/each}
					</div>
				</div>
				{#if viewLawSection !== null}
					<p class="text-xs text-text-secondary">Governing law is included in or cited by the document you are signing ({viewLawSection}).</p>
				{/if}
				{#if viewContract.smartContractAddress !== ZERO_ADDRESS}
					<div>
						<span class="text-text-muted">Smart Contract Reference:</span>
						<div class="mt-1 text-xs flex flex-col gap-0.5">
							<div><span class="text-text-muted">Address:</span> <span class="font-mono break-all">{viewContract.smartContractAddress}</span></div>
							<div><span class="text-text-muted">Network:</span> {formatNetwork(Number(viewContract.smartContractChainId))}</div>
							<div class="break-all"><span class="text-text-muted">Bytecode hash:</span> <span class="font-mono">{viewContract.bytecodeHash}</span></div>
						</div>
					</div>
				{/if}
				<p class="text-xs text-text-muted">
					You are about to sign Contract #{viewContractId.toString()}. This binds you to the terms described in the contract. Your signature will be permanently recorded on-chain.
				</p>
			</div>

			{#snippet footer()}
				<LoadingButton onclick={() => (showConfirmModal = false)} variant="secondary">Cancel</LoadingButton>
				<LoadingButton onclick={confirmSign} variant="none" class="bg-green-700 hover:bg-green-600">Confirm &amp; Sign</LoadingButton>
			{/snippet}
		</Modal>
	{/if}

	<!-- ═══════════════ IMPORT FOR PRINT MODAL ═══════════════ -->
	<Modal bind:open={showImportForPrint} title="Import Contract to Print" maxWidth="max-w-lg">
		<p class="text-xs text-text-muted">
			This contract was created in hash-only mode. Import the .md file to load the content for printing.
		</p>

		{#snippet footer()}
			<LoadingButton onclick={() => (showImportForPrint = false)} variant="secondary">Cancel</LoadingButton>
			<label class="inline-block bg-primary hover:bg-primary-hover text-text text-sm px-4 py-2 rounded transition-colors cursor-pointer">
				Choose .md file
				<input type="file" accept=".md" onchange={handleImportForPrint} class="hidden" />
			</label>
		{/snippet}
	</Modal>

	<!-- ═══════════════ PUBKEY REGISTRATION MODAL ═══════════════ -->
	{#if pubkeyState !== 'registered'}
		<Modal bind:open={showRegisterModal} title="Register Encryption Key" maxWidth="max-w-lg" closeOnBackdrop={pubkeyState !== 'registering'} closeOnEscape={pubkeyState !== 'registering'}>
			<p class="text-sm text-text-secondary mb-3">
				This is a one-time setup so other members can send contracts directly to your wallet.
				Your wallet will sign a deterministic message — that signature derives your encryption key.
				The key never leaves your browser.
			</p>
			<p class="text-sm text-text-secondary mb-3">
				You'll then submit one transaction to publish your encryption public key to the on-chain
				PubkeyRegistry. After that, contracts addressed to your wallet can be read in-app
				without anyone sending you a file.
			</p>
			<p class="bg-yellow-900/30 border border-yellow-700 text-yellow-200 rounded-lg p-3 text-xs">
				<strong>Only sign this inside Vattelum.</strong> This signature derives the key that
				lets you encrypt and read contracts addressed to your wallet. It is not a payment or a transaction.
			</p>

			{#snippet footer()}
				<LoadingButton
					onclick={() => (showRegisterModal = false)}
					disabled={pubkeyState === 'registering'}
					variant="secondary"
				>
					Later
				</LoadingButton>
				<LoadingButton
					onclick={confirmRegisterPubkey}
					loading={pubkeyState === 'registering'}
					loadingLabel="Registering…"
					variant="primary"
				>
					Register
				</LoadingButton>
			{/snippet}
		</Modal>
	{/if}
</div>
