import type { PublicClient, AbiEvent, GetLogsParameters } from 'viem';

const BLOCK_RANGE = 50_000n;

// BigInt-safe JSON helpers — viem logs contain BigInt values that JSON.stringify cannot handle.
function jsonReplacer(_key: string, value: unknown): unknown {
	if (typeof value === 'bigint') return `__bigint__${value.toString()}`;
	return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
	if (typeof value === 'string' && value.startsWith('__bigint__')) return BigInt(value.slice(10));
	return value;
}

export interface PaginatedLogsResult {
	logs: Awaited<ReturnType<PublicClient['getLogs']>>;
	lastScannedBlock: bigint;
	complete: boolean;
}

/**
 * Paginated event log scanner with per-chunk progress persistence.
 * Saves progress after each successful chunk so interrupted scans
 * resume from where they left off rather than restarting.
 */
export async function getPaginatedLogs<T extends AbiEvent>(
	client: PublicClient,
	params: Omit<GetLogsParameters<T>, 'fromBlock' | 'toBlock'> & { fromBlock: bigint },
	cacheKey?: string
): Promise<PaginatedLogsResult> {
	const currentBlock = await client.getBlockNumber();
	const saved = cacheKey ? getScanProgress(cacheKey) : null;
	let from = saved && BigInt(saved.lastBlock) >= params.fromBlock
		? BigInt(saved.lastBlock) + 1n
		: params.fromBlock;
	const allLogs: Awaited<ReturnType<PublicClient['getLogs']>> = [
		...(saved?.logs ?? [])
	];

	if (from > currentBlock) {
		return { logs: allLogs, lastScannedBlock: currentBlock, complete: true };
	}

	const totalChunks = Number((currentBlock - from) / BLOCK_RANGE) + 1;
	let chunk = 0;

	while (from <= currentBlock) {
		const to = from + BLOCK_RANGE - 1n > currentBlock ? currentBlock : from + BLOCK_RANGE - 1n;
		chunk++;

		try {
			console.log(`[logs] ${cacheKey ?? 'scan'}: chunk ${chunk}/${totalChunks} (blocks ${from}–${to})`);
			const logs = await client.getLogs({ ...params, fromBlock: from, toBlock: to } as any);
			allLogs.push(...logs);

			if (cacheKey) {
				setScanProgress(cacheKey, {
					lastBlock: to.toString(),
					logs: allLogs
				});
			}

			from = to + 1n;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`[logs] ${cacheKey ?? 'scan'}: chunk ${chunk} failed at blocks ${from}–${to}: ${msg}`);
			// Return what we have so far — progress is already saved
			return { logs: allLogs, lastScannedBlock: from - 1n, complete: false };
		}
	}

	return { logs: allLogs, lastScannedBlock: currentBlock, complete: true };
}

// ──────────────────────── Scan progress cache ──────────────────

interface ScanProgress {
	lastBlock: string;
	logs: any[];
}

function getScanProgress(key: string): ScanProgress | null {
	try {
		const raw = localStorage.getItem(`daa:scan:${key}`);
		return raw ? JSON.parse(raw, jsonReviver) : null;
	} catch {
		return null;
	}
}

function setScanProgress(key: string, data: ScanProgress) {
	try {
		localStorage.setItem(`daa:scan:${key}`, JSON.stringify(data, jsonReplacer));
	} catch {
		// storage full or unavailable
	}
}

