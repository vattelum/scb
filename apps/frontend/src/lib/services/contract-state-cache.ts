import type { AbiEvent } from 'viem';
import { getClient } from '#lib/services/wallet-config.ts';
import { contractRegistryAddress, contractRegistryConfig } from '#lib/contracts/index.ts';
import type { ContractListRead } from '#lib/services/contract-registry.ts';

const chainId = Number(import.meta.env.VITE_CHAIN_ID);
const deployBlock = import.meta.env.VITE_DEPLOY_BLOCK
	? BigInt(import.meta.env.VITE_DEPLOY_BLOCK)
	: 0n;

const CACHE_PREFIX = 'contract:state:';
const TTL_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Lifecycle events whose emission implies a contract's mutable state changed.
const INVALIDATING_EVENTS = [
	'ContractSigned',
	'ContractActive',
	'ContractDeclined',
	'TerminationProposed',
	'ContractTerminated',
	'CompletionProposed',
	'ContractCompleted',
	'ContractDisputed'
] as const;

export interface CachedState {
	read: ContractListRead;
	fetchedAt: number;
}

// BigInt-safe JSON helpers — ContractListRead is laced with bigints.
function bigintReplacer(_key: string, value: unknown): unknown {
	if (typeof value === 'bigint') return `__bigint__${value.toString()}`;
	return value;
}

function bigintReviver(_key: string, value: unknown): unknown {
	if (typeof value === 'string' && value.startsWith('__bigint__')) return BigInt(value.slice(10));
	return value;
}

function cacheKey(contractId: bigint): string {
	return `${CACHE_PREFIX}${chainId}:${contractRegistryAddress.toLowerCase()}:${contractId.toString()}`;
}

export function getCached(contractId: bigint): CachedState | null {
	try {
		const raw = localStorage.getItem(cacheKey(contractId));
		return raw ? (JSON.parse(raw, bigintReviver) as CachedState) : null;
	} catch {
		return null;
	}
}

export function setCached(contractId: bigint, read: ContractListRead): void {
	try {
		localStorage.setItem(
			cacheKey(contractId),
			JSON.stringify({ read, fetchedAt: Date.now() }, bigintReplacer)
		);
	} catch {
		// localStorage quota exceeded — drop silently.
	}
}

export function invalidate(contractId: bigint): void {
	try {
		localStorage.removeItem(cacheKey(contractId));
	} catch {
		// ignore
	}
}

export function isCacheFresh(entry: CachedState): boolean {
	return Date.now() - entry.fetchedAt < TTL_MS;
}

/**
 * Sweep stale entries (> MAX_AGE_MS) out of localStorage so the cache
 * doesn't grow unbounded as users browse many contracts over time.
 */
export function cleanupOldEntries(): void {
	try {
		const now = Date.now();
		const toRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith(CACHE_PREFIX)) continue;
			const raw = localStorage.getItem(k);
			if (!raw) continue;
			try {
				const entry = JSON.parse(raw) as { fetchedAt?: number };
				if (entry.fetchedAt && now - entry.fetchedAt > MAX_AGE_MS) toRemove.push(k);
			} catch {
				toRemove.push(k);
			}
		}
		for (const k of toRemove) localStorage.removeItem(k);
	} catch {
		// ignore
	}
}

const SCAN_MARKER_KEY = `contract:scan:${chainId}:${contractRegistryAddress.toLowerCase()}`;
const BLOCK_RANGE = 50_000n;

function getLastScannedBlock(): bigint {
	try {
		const raw = localStorage.getItem(SCAN_MARKER_KEY);
		return raw ? BigInt(raw) : deployBlock;
	} catch {
		return deployBlock;
	}
}

function setLastScannedBlock(block: bigint): void {
	try {
		localStorage.setItem(SCAN_MARKER_KEY, block.toString());
	} catch {
		// ignore
	}
}

/**
 * Scan contract-registry lifecycle events since the last recorded block and
 * invalidate every cache entry whose contractId was touched. Tracks only the
 * last-scanned block (not the full log history) — we care about deltas, not
 * the complete event stream.
 *
 * Returns the set of contractIds that were invalidated so the caller can
 * re-fetch just those via multicall.
 */
export async function scanAndInvalidate(): Promise<Set<bigint>> {
	const invalidated = new Set<bigint>();
	const client = getClient();
	if (!client) return invalidated;

	const events = (contractRegistryConfig.abi as readonly AbiEvent[]).filter(
		(e) =>
			e.type === 'event' &&
			INVALIDATING_EVENTS.includes(e.name as typeof INVALIDATING_EVENTS[number])
	);

	let currentBlock: bigint;
	try {
		currentBlock = await client.getBlockNumber();
	} catch {
		return invalidated;
	}

	let from = getLastScannedBlock();
	if (from <= deployBlock) from = deployBlock;
	else from = from + 1n;

	if (from > currentBlock) return invalidated;

	let scanned = from - 1n;
	while (from <= currentBlock) {
		const to = from + BLOCK_RANGE - 1n > currentBlock ? currentBlock : from + BLOCK_RANGE - 1n;
		try {
			const logs = await client.getLogs({
				address: contractRegistryAddress,
				events: events as any,
				fromBlock: from,
				toBlock: to
			} as any);
			for (const log of logs) {
				const cid = (log as any).args?.contractId as bigint | undefined;
				if (typeof cid === 'bigint') {
					invalidate(cid);
					invalidated.add(cid);
				}
			}
			scanned = to;
			setLastScannedBlock(scanned);
			from = to + 1n;
		} catch (e) {
			console.warn(`[contract-state-cache] scan failed at blocks ${from}-${to}`, e);
			break;
		}
	}

	return invalidated;
}
