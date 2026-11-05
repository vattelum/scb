import { readContract } from '@wagmi/core';
import { createPublicClient, http, type PublicClient } from 'viem';
import { config } from '#lib/services/wallet-config.ts';
import { chainIdToRpc } from '#lib/constants/networks.ts';

const homeChainId = Number(import.meta.env.VITE_CHAIN_ID);
const clients = new Map<number, PublicClient>();

/** Parameters of a contract read; the ABI is JSON, so the call is not typed per function. */
export interface ChainReadParams {
	address: `0x${string}`;
	abi: unknown;
	functionName: string;
	args?: readonly unknown[];
}

/**
 * Read a contract on the given chain. The home chain (or no chain) goes through
 * the wallet config; any other chain uses its keyless public RPC, and a chain
 * with no configured RPC is an error rather than a silent read from home.
 */
export async function readOnChain(
	chainId: number | bigint | undefined,
	params: ChainReadParams
): Promise<unknown> {
	const id = chainId === undefined ? homeChainId : Number(chainId);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if (id === homeChainId) return readContract(config, params as any);

	let client = clients.get(id);
	if (!client) {
		const rpc = chainIdToRpc(id);
		if (!rpc) throw new Error(`No public RPC configured for chain ${id}.`);
		client = createPublicClient({ transport: http(rpc) }) as PublicClient;
		clients.set(id, client);
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return client.readContract(params as any);
}
