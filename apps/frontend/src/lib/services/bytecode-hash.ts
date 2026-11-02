import { createPublicClient, http, keccak256 } from 'viem';
import { chainIdToRpc } from '#lib/constants/networks.ts';

/**
 * Fetch the deployed runtime bytecode of a contract on a specific chain.
 * Returns the raw hex string (with `0x` prefix). Throws if there is no
 * code at the address (i.e. the address is an EOA or nothing is deployed).
 */
export async function fetchBytecode(
	address: `0x${string}`,
	chainId: number
): Promise<`0x${string}`> {
	const rpc = chainIdToRpc(chainId);
	if (!rpc) {
		throw new Error(`No public RPC configured for chain ${chainId}.`);
	}
	const client = createPublicClient({ transport: http(rpc) });
	const code = await client.getCode({ address });
	if (!code || code === '0x') {
		throw new Error('No contract deployed at this address on the selected chain.');
	}
	return code;
}

/**
 * Compute `keccak256` over the raw bytecode (post-`0x` stripping).
 * This is the standardised bytecode hash — any third party with the address
 * can fetch `eth_getCode` on the declared chain and recompute the same value.
 */
export function computeBytecodeHash(bytecode: `0x${string}`): `0x${string}` {
	return keccak256(bytecode);
}

/** Convenience: fetch + hash in one call. */
export async function fetchAndHashBytecode(
	address: `0x${string}`,
	chainId: number
): Promise<{ bytecode: `0x${string}`; hash: `0x${string}`; byteLength: number }> {
	const bytecode = await fetchBytecode(address, chainId);
	const hash = computeBytecodeHash(bytecode);
	// 2 hex chars per byte, minus the 0x prefix.
	const byteLength = (bytecode.length - 2) / 2;
	return { bytecode, hash, byteLength };
}
