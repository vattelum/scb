import { readContract, writeContract, signTypedData, multicall } from '@wagmi/core';
import { config } from '$lib/services/wallet-config';
import { contractRegistryConfig, contractRegistryAddress } from '$lib/contracts';
import { RELATION_GOVERNS, RELATION_REVISES } from '@vattelum/document-registry-js';

const chainId = Number(import.meta.env.VITE_CHAIN_ID);
const ZERO_REASON = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

// ────────────────── Types ──────────────────────────────────────

export interface DocumentReference {
	registryAddress: `0x${string}`;
	chainId: bigint;
	categoryId: bigint;
	documentId: bigint;
	version: bigint;
	relationType: number;
	targetSection: string;
}

export interface CreateContractParams {
	contentHash: `0x${string}`;
	signatories: `0x${string}`[];
	contentUri: string;
	references: DocumentReference[];
	smartContractAddress: `0x${string}`;
	bytecodeHash: `0x${string}`;
	smartContractChainId: bigint;
}

export interface ContractRecord {
	contentHash: `0x${string}`;
	signatories: `0x${string}`[];
	signatures: `0x${string}`[];
	contentUris: string[];
	references: DocumentReference[];
	status: number;
	createdAt: bigint;
	smartContractAddress: `0x${string}`;
	bytecodeHash: `0x${string}`;
	smartContractChainId: bigint;
}

export interface LifecycleEvent {
	eventType: number;
	actor: `0x${string}`;
	timestamp: bigint;
	reasonHash: `0x${string}`;
}

export interface Proposal {
	proposedAt: bigint;
	proposer: `0x${string}`;
	reasonHash: `0x${string}`;
	noticeExpiresAt: bigint;
}

export const Status = {
	Created: 0,
	Active: 1,
	Declined: 2,
	Expired: 3,
	Terminated: 4,
	Completed: 5
} as const;

export const StatusLabels: Record<number, string> = {
	0: 'Created',
	1: 'Active',
	2: 'Declined',
	3: 'Expired',
	4: 'Terminated',
	5: 'Completed'
};

/** Tailwind text-colour class for a contract status pill. */
export function statusClass(status: number): string {
	switch (status) {
		case Status.Created: return 'text-yellow-400';
		case Status.Active: return 'text-green-400';
		case Status.Declined: return 'text-red-400';
		case Status.Expired: return 'text-gray-400';
		case Status.Terminated: return 'text-orange-400';
		case Status.Completed: return 'text-blue-400';
		default: return 'text-text-secondary';
	}
}

// Event-type constants follow the decade-per-family scheme from the Solidity contract.
export const EventType = {
	Created: 0,
	Signed: 10,
	Declined: 11,
	Active: 12,
	TerminationProposed: 20,
	Terminated: 21,
	TerminationCancelled: 22,
	TerminationAccepted: 23,
	TerminationRejected: 24,
	CompletionProposed: 30,
	Completed: 31,
	CompletionCancelled: 32,
	CompletionAccepted: 33,
	CompletionRejected: 34,
	Disputed: 40,
	Amended: 50
} as const;

export const EventTypeLabels: Record<number, string> = {
	0: 'Created',
	10: 'Signed',
	11: 'Declined',
	12: 'Active',
	20: 'Termination proposed',
	21: 'Terminated',
	22: 'Termination cancelled',
	23: 'Termination accepted',
	24: 'Termination rejected',
	30: 'Completion proposed',
	31: 'Completed',
	32: 'Completion cancelled',
	33: 'Completion accepted',
	34: 'Completion rejected',
	40: 'Disputed',
	50: 'Amended'
};

// ────────────────── EIP-712 Signing ────────────────────────────

export async function signContractTypedData(
	contractId: bigint,
	documentHash: `0x${string}`,
	governingLawRegistry: `0x${string}`
): Promise<`0x${string}`> {
	return signTypedData(config, {
		domain: {
			name: 'ContractRegistry',
			version: '1',
			chainId: BigInt(chainId),
			verifyingContract: contractRegistryAddress
		},
		types: {
			ContractSignature: [
				{ name: 'contractId', type: 'uint256' },
				{ name: 'documentHash', type: 'bytes32' },
				{ name: 'governingLawRegistry', type: 'address' },
				{ name: 'contractRegistry', type: 'address' },
				{ name: 'networkChainId', type: 'uint256' }
			]
		},
		primaryType: 'ContractSignature',
		message: {
			contractId,
			documentHash,
			governingLawRegistry,
			contractRegistry: contractRegistryAddress,
			networkChainId: BigInt(chainId)
		}
	});
}

// ────────────────── Write Functions ─────────────────────────────

export async function createContract(params: CreateContractParams): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'createContract',
		args: [params]
	});
}

export async function sign(
	contractId: bigint,
	signature: `0x${string}`,
	contentUri: string
): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'sign',
		args: [contractId, signature, contentUri]
	});
}

export async function decline(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'decline',
		args: [contractId]
	});
}

export async function proposeTermination(
	contractId: bigint,
	reasonHash: `0x${string}` = ZERO_REASON
): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'proposeTermination',
		args: [contractId, reasonHash]
	});
}

export async function finalizeTermination(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'finalizeTermination',
		args: [contractId]
	});
}

export async function proposeCompletion(
	contractId: bigint,
	reasonHash: `0x${string}` = ZERO_REASON
): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'proposeCompletion',
		args: [contractId, reasonHash]
	});
}

export async function finalizeCompletion(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'finalizeCompletion',
		args: [contractId]
	});
}

export async function dispute(
	contractId: bigint,
	reasonHash: `0x${string}` = ZERO_REASON
): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'dispute',
		args: [contractId, reasonHash]
	});
}

export async function cancelTermination(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'cancelTermination',
		args: [contractId]
	});
}

export async function cancelCompletion(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'cancelCompletion',
		args: [contractId]
	});
}

export async function acceptTermination(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'acceptTermination',
		args: [contractId]
	});
}

export async function acceptCompletion(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'acceptCompletion',
		args: [contractId]
	});
}

export async function rejectTermination(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'rejectTermination',
		args: [contractId]
	});
}

export async function rejectCompletion(contractId: bigint): Promise<`0x${string}`> {
	return writeContract(config, {
		...contractRegistryConfig,
		functionName: 'rejectCompletion',
		args: [contractId]
	});
}

// ────────────────── Read Functions ──────────────────────────────

export async function getContract(contractId: bigint): Promise<ContractRecord> {
	const result = (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getContract',
		args: [contractId]
	})) as [
		`0x${string}`,
		`0x${string}`[],
		`0x${string}`[],
		string[],
		DocumentReference[],
		number,
		bigint,
		`0x${string}`,
		`0x${string}`,
		bigint
	];

	return {
		contentHash: result[0],
		signatories: result[1],
		signatures: result[2],
		contentUris: result[3],
		references: result[4],
		status: result[5],
		createdAt: result[6],
		smartContractAddress: result[7],
		bytecodeHash: result[8],
		smartContractChainId: result[9]
	};
}

export async function effectiveStatus(contractId: bigint): Promise<number> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'effectiveStatus',
		args: [contractId]
	})) as number;
}

export async function isStale(contractId: bigint): Promise<boolean> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'isStale',
		args: [contractId]
	})) as boolean;
}

export async function getTerminationProposal(contractId: bigint): Promise<Proposal> {
	const result = (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getTerminationProposal',
		args: [contractId]
	})) as [bigint, `0x${string}`, `0x${string}`, bigint];
	return {
		proposedAt: result[0],
		proposer: result[1],
		reasonHash: result[2],
		noticeExpiresAt: result[3]
	};
}

export async function getCompletionProposal(contractId: bigint): Promise<Proposal> {
	const result = (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getCompletionProposal',
		args: [contractId]
	})) as [bigint, `0x${string}`, `0x${string}`, bigint];
	return {
		proposedAt: result[0],
		proposer: result[1],
		reasonHash: result[2],
		noticeExpiresAt: result[3]
	};
}

export async function hasAcceptedTermination(
	contractId: bigint,
	signatory: `0x${string}`
): Promise<boolean> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'hasAcceptedTermination',
		args: [contractId, signatory]
	})) as boolean;
}

export async function hasAcceptedCompletion(
	contractId: bigint,
	signatory: `0x${string}`
): Promise<boolean> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'hasAcceptedCompletion',
		args: [contractId, signatory]
	})) as boolean;
}

export async function getTerminationAcceptCount(contractId: bigint): Promise<bigint> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getTerminationAcceptCount',
		args: [contractId]
	})) as bigint;
}

export async function getCompletionAcceptCount(contractId: bigint): Promise<bigint> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getCompletionAcceptCount',
		args: [contractId]
	})) as bigint;
}

export interface ContractListRead {
	contract: ContractRecord;
	effectiveStatus: number;
	stale: boolean;
	terminationProposal: Proposal;
	completionProposal: Proposal;
}

const MULTICALL_CHUNK = 20;

async function readContractBatch(ids: bigint[]): Promise<ContractListRead[]> {
	if (ids.length === 0) return [];

	const calls = ids.flatMap((id) => [
		{ ...contractRegistryConfig, functionName: 'getContract', args: [id] },
		{ ...contractRegistryConfig, functionName: 'effectiveStatus', args: [id] },
		{ ...contractRegistryConfig, functionName: 'isStale', args: [id] },
		{ ...contractRegistryConfig, functionName: 'getTerminationProposal', args: [id] },
		{ ...contractRegistryConfig, functionName: 'getCompletionProposal', args: [id] }
	]);

	const results = (await multicall(config, {
		contracts: calls as any,
		allowFailure: false
	})) as unknown[];

	return ids.map((_id, i) => {
		const base = i * 5;
		const getC = results[base] as [
			`0x${string}`,
			`0x${string}`[],
			`0x${string}`[],
			string[],
			DocumentReference[],
			number,
			bigint,
			`0x${string}`,
			`0x${string}`,
			bigint
		];
		const eff = results[base + 1] as number;
		const stale = results[base + 2] as boolean;
		const tp = results[base + 3] as [bigint, `0x${string}`, `0x${string}`, bigint];
		const cp = results[base + 4] as [bigint, `0x${string}`, `0x${string}`, bigint];
		return {
			contract: {
				contentHash: getC[0],
				signatories: getC[1],
				signatures: getC[2],
				contentUris: getC[3],
				references: getC[4],
				status: getC[5],
				createdAt: getC[6],
				smartContractAddress: getC[7],
				bytecodeHash: getC[8],
				smartContractChainId: getC[9]
			},
			effectiveStatus: eff,
			stale,
			terminationProposal: {
				proposedAt: tp[0],
				proposer: tp[1],
				reasonHash: tp[2],
				noticeExpiresAt: tp[3]
			},
			completionProposal: {
				proposedAt: cp[0],
				proposer: cp[1],
				reasonHash: cp[2],
				noticeExpiresAt: cp[3]
			}
		};
	});
}

export async function readContractBatchChunked(ids: bigint[]): Promise<ContractListRead[]> {
	const out: ContractListRead[] = [];
	for (let i = 0; i < ids.length; i += MULTICALL_CHUNK) {
		const chunk = ids.slice(i, i + MULTICALL_CHUNK);
		out.push(...(await readContractBatch(chunk)));
	}
	return out;
}

export async function getContractsByParty(party: `0x${string}`): Promise<bigint[]> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getContractsByParty',
		args: [party]
	})) as bigint[];
}

export async function getContractCount(): Promise<bigint> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getContractCount'
	})) as bigint;
}

export async function getEvents(contractId: bigint): Promise<LifecycleEvent[]> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'getEvents',
		args: [contractId]
	})) as LifecycleEvent[];
}

export async function hasSigned(contractId: bigint, signer: `0x${string}`): Promise<boolean> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'hasSigned',
		args: [contractId, signer]
	})) as boolean;
}

export async function isSignatory(contractId: bigint, addr: `0x${string}`): Promise<boolean> {
	return (await readContract(config, {
		...contractRegistryConfig,
		functionName: 'isSignatory',
		args: [contractId, addr]
	})) as boolean;
}

// ────────────────── Helpers ────────────────────────────────────

export function getGoverningLawRegistry(references: DocumentReference[]): `0x${string}` {
	const governs = references.find((r) => r.relationType === RELATION_GOVERNS);
	return governs?.registryAddress ?? '0x0000000000000000000000000000000000000000';
}

// ────────────────── Revision-chain helpers ──────────────────────
//
// A contract revision is a new contract whose `references[]` includes an
// DocumentReference pointing back at the underlying contract with
// `registryAddress = ContractRegistry` and `relationType = 1 (REVISES)`. Per
// Citation & Referencing Standard v10, REVISES denotes whole-document
// replacement — which is exactly what a superseding contract is. The registry
// contract is shared — detection is client-side by scanning refs.


/**
 * Returns the contractId this contract revises, or null if it is not a
 * revision. Only references pointing at the ContractRegistry with
 * relationType=REVISES count.
 */
export function findRevisionSource(
	references: readonly DocumentReference[]
): bigint | null {
	const ref = references.find(
		(r) =>
			r.relationType === RELATION_REVISES &&
			r.registryAddress.toLowerCase() === contractRegistryAddress.toLowerCase()
	);
	return ref ? ref.documentId : null;
}

/**
 * Given a list of (id, contract) pairs, build forward- and reverse-revision
 * maps. `revisedBy` maps sourceId → revisingId (the contract that supersedes
 * it). `revises` maps revisingId → sourceId.
 */
export function buildRevisionGraph(
	contracts: readonly { id: bigint; contract: ContractRecord }[]
): { revisedBy: Map<bigint, bigint>; revises: Map<bigint, bigint> } {
	const revisedBy = new Map<bigint, bigint>();
	const revises = new Map<bigint, bigint>();
	for (const { id, contract } of contracts) {
		const src = findRevisionSource(contract.references);
		if (src === null) continue;
		revises.set(id, src);
		revisedBy.set(src, id);
	}
	return { revisedBy, revises };
}

/**
 * Walk `revises` backward from `id` to find the root contract. Returns the
 * full chain ordered root → … → id.
 */
export function getRevisionChain(
	id: bigint,
	revises: Map<bigint, bigint>,
	revisedBy: Map<bigint, bigint>
): bigint[] {
	// Walk back to root.
	const back: bigint[] = [id];
	let cur = id;
	while (revises.has(cur)) {
		cur = revises.get(cur)!;
		if (back.includes(cur)) break; // defensive against cycles
		back.unshift(cur);
	}
	// Walk forward to tip.
	cur = id;
	while (revisedBy.has(cur)) {
		cur = revisedBy.get(cur)!;
		if (back.includes(cur)) break;
		back.push(cur);
	}
	return back;
}

export function getRevisionTip(
	id: bigint,
	revisedBy: Map<bigint, bigint>
): bigint {
	let cur = id;
	const seen = new Set<bigint>([cur]);
	while (revisedBy.has(cur)) {
		const next = revisedBy.get(cur)!;
		if (seen.has(next)) break;
		seen.add(next);
		cur = next;
	}
	return cur;
}

export function isExpired(createdAt: bigint): boolean {
	const expiryTime = createdAt + 30n * 24n * 60n * 60n;
	return BigInt(Math.floor(Date.now() / 1000)) > expiryTime;
}

/** Returns true if a proposal is active (proposedAt != 0). */
export function hasActiveProposal(proposal: Proposal): boolean {
	return proposal.proposedAt !== 0n;
}

/** Returns true if an active proposal's notice window has elapsed. */
export function isProposalRipe(proposal: Proposal): boolean {
	if (proposal.proposedAt === 0n) return false;
	return BigInt(Math.floor(Date.now() / 1000)) >= proposal.noticeExpiresAt;
}
