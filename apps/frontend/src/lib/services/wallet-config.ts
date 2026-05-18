import {
	createConfig,
	http,
	connect,
	disconnect,
	reconnect,
	readContract,
	watchAccount,
	getPublicClient
} from '@wagmi/core';
import { mainnet, sepolia, base, optimism, polygon, arbitrum } from 'viem/chains';
import { injected } from '@wagmi/connectors';
import { wallet } from '$lib/stores/wallet';
import { resetTurbo } from '$lib/services/arweave';
import { daaTokenConfig, daaRegistryConfig } from '$lib/contracts';

const chainId = Number(import.meta.env.VITE_CHAIN_ID);
const rpcUrl = import.meta.env.VITE_RPC_URL as string;

// Branch per chain so TS keeps the literal tie between `chains[0].id` and the
// `transports` key (it widens to `number` across an object-literal boundary,
// which trips `Record<id, Transport>` otherwise). Falling back to Sepolia for
// unknown chain ids would silently mis-tag fee estimation and replay-protection
// checks; preferable to refuse the build than misbehave at runtime.
export const config = (() => {
	switch (chainId) {
		case mainnet.id:
			return createConfig({
				chains: [mainnet],
				connectors: [injected()],
				transports: { [mainnet.id]: http(rpcUrl) }
			});
		case base.id:
			return createConfig({
				chains: [base],
				connectors: [injected()],
				transports: { [base.id]: http(rpcUrl) }
			});
		case optimism.id:
			return createConfig({
				chains: [optimism],
				connectors: [injected()],
				transports: { [optimism.id]: http(rpcUrl) }
			});
		case polygon.id:
			return createConfig({
				chains: [polygon],
				connectors: [injected()],
				transports: { [polygon.id]: http(rpcUrl) }
			});
		case arbitrum.id:
			return createConfig({
				chains: [arbitrum],
				connectors: [injected()],
				transports: { [arbitrum.id]: http(rpcUrl) }
			});
		case sepolia.id:
			return createConfig({
				chains: [sepolia],
				connectors: [injected()],
				transports: { [sepolia.id]: http(rpcUrl) }
			});
		default:
			throw new Error(
				`wallet-config: VITE_CHAIN_ID=${chainId} has no viem chain mapping. ` +
					`Add the chain to wallet-config.ts or set VITE_CHAIN_ID to a supported chain ` +
					`(1, 10, 137, 8453, 42161, 11155111).`
			);
	}
})();

watchAccount(config, {
	onChange(account) {
		resetTurbo();
		wallet.set({
			address: account.address ?? null,
			connected: account.isConnected,
			connecting: account.isConnecting,
			isAdmin: false,
			isTokenHolder: false
		});
		if (account.address) {
			checkRoles(account.address);
		}
	}
});

reconnect(config);

export async function connectWallet() {
	return connect(config, { connector: injected() });
}

export async function disconnectWallet() {
	return disconnect(config);
}

export function getClient() {
	// Return type intentionally inferred — the multi-chain config produces a
	// union of chain-narrowed PublicClients that Optimism's OP-stack tx types
	// can't reconcile with the standard tx union. Consumers that need the bare
	// PublicClient shape (e.g. getPaginatedLogs) cast at the call site.
	return getPublicClient(config);
}

export async function checkRoles(address: `0x${string}`) {
	try {
		const [tokenOwner, normalAuth, coreAuth, balance] = await Promise.all([
			readContract(config, { ...daaTokenConfig, functionName: 'owner' }),
			readContract(config, { ...daaRegistryConfig, functionName: 'normalAuthority' }),
			readContract(config, { ...daaRegistryConfig, functionName: 'coreAuthority' }),
			readContract(config, { ...daaTokenConfig, functionName: 'balanceOf', args: [address] })
		]);
		const lower = address.toLowerCase();
		const admin =
			lower === (tokenOwner as string).toLowerCase() ||
			lower === (normalAuth as string).toLowerCase() ||
			lower === (coreAuth as string).toLowerCase();
		wallet.update((w) => ({ ...w, isAdmin: admin, isTokenHolder: (balance as bigint) > 0n }));
	} catch {
		wallet.update((w) => ({ ...w, isAdmin: false, isTokenHolder: false }));
	}
}
