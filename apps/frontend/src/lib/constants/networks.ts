/**
 * Chain metadata for the SCB network picker and the PDF explorer links.
 *
 * Preset list order matches the SCB toggle spec (§3.1): most common chains first,
 * Sepolia at the bottom since it's a testnet, "Other" for manual entry.
 */

export interface NetworkInfo {
	chainId: number;
	label: string;
	explorer: string;
}

export const PRESET_NETWORKS: NetworkInfo[] = [
	{ chainId: 1, label: 'Ethereum Mainnet', explorer: 'https://etherscan.io' },
	{ chainId: 8453, label: 'Base', explorer: 'https://basescan.org' },
	{ chainId: 42161, label: 'Arbitrum One', explorer: 'https://arbiscan.io' },
	{ chainId: 10, label: 'Optimism', explorer: 'https://optimistic.etherscan.io' },
	{ chainId: 137, label: 'Polygon', explorer: 'https://polygonscan.com' },
	{ chainId: 11155111, label: 'Sepolia', explorer: 'https://sepolia.etherscan.io' }
];

/** Public RPC URLs used for cross-chain `eth_getCode` calls at bytecode-hash time. */
export const PUBLIC_RPCS: Record<number, string> = {
	1: 'https://ethereum-rpc.publicnode.com',
	10: 'https://optimism-rpc.publicnode.com',
	137: 'https://polygon-bor-rpc.publicnode.com',
	8453: 'https://base-rpc.publicnode.com',
	42161: 'https://arbitrum-one-rpc.publicnode.com',
	11155111: 'https://ethereum-sepolia-rpc.publicnode.com'
};

export function chainIdToLabel(id: number): string {
	const match = PRESET_NETWORKS.find((n) => n.chainId === id);
	return match?.label ?? `Chain ${id}`;
}

export function chainIdToExplorer(id: number): string | null {
	const match = PRESET_NETWORKS.find((n) => n.chainId === id);
	return match?.explorer ?? null;
}

export function chainIdToRpc(id: number): string | null {
	return PUBLIC_RPCS[id] ?? null;
}

/**
 * Average seconds per block for the given chain. Used by /vote to convert a
 * proposal's block-numbered end into a wall-clock countdown. Off-by-Nx errors
 * here translate directly into wrong "ends in" labels — Polygon at the
 * Ethereum default (12s) would display as 6× too long.
 *
 * Values are conservative averages (post-merge for Ethereum, sequencer cadence
 * for L2s). Unknown chains fall back to 12s — close enough for L1-style
 * networks; obviously wrong for fast L2s, so add the chain id explicitly when
 * deploying to a new chain.
 */
const BLOCK_TIMES: Record<number, number> = {
	1: 12,         // Ethereum Mainnet
	10: 2,         // Optimism
	137: 2,        // Polygon PoS
	8453: 2,       // Base
	42161: 0.25,   // Arbitrum One
	11155111: 12   // Sepolia
};

export function chainIdToBlockTime(id: number): number {
	return BLOCK_TIMES[id] ?? 12;
}

export function formatNetwork(id: number): string {
	return `${chainIdToLabel(id)} (chain ${id})`;
}

/** Build an explorer URL for a transaction hash on the given chain. */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
	const base = chainIdToExplorer(chainId);
	return base ? `${base}/tx/${txHash}` : null;
}

/** Build an explorer URL for an address on the given chain. */
export function explorerAddressUrl(chainId: number, address: string): string | null {
	const base = chainIdToExplorer(chainId);
	return base ? `${base}/address/${address}` : null;
}
