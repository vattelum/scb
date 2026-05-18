import { readContract, writeContract } from '@wagmi/core';
import { config } from '$lib/services/wallet-config';
import { pubkeyRegistryConfig } from '$lib/contracts';

const cache = new Map<string, `0x${string}` | null>();

/**
 * Register the caller's 64-byte uncompressed secp256k1 public key.
 * The on-chain contract validates length only — the pubkey is a separately
 * derived encryption key, not the wallet's transaction-signing key, so it
 * isn't matched against `msg.sender`. Impersonation is impossible because
 * `register` writes to `msg.sender`'s slot.
 */
export async function register(pubkey: `0x${string}`): Promise<`0x${string}`> {
	const hash = await writeContract(config, {
		...pubkeyRegistryConfig,
		functionName: 'register',
		args: [pubkey]
	});
	cache.clear();
	return hash;
}

/**
 * Returns the registered 64-byte uncompressed pubkey for `user`, or `null` if unregistered.
 */
export async function getPubkey(user: `0x${string}`): Promise<`0x${string}` | null> {
	const key = user.toLowerCase();
	if (cache.has(key)) return cache.get(key) ?? null;

	const result = (await readContract(config, {
		...pubkeyRegistryConfig,
		functionName: 'getPubkey',
		args: [user]
	})) as `0x${string}`;

	const value = result && result !== '0x' ? result : null;
	cache.set(key, value);
	return value;
}

export async function isRegistered(user: `0x${string}`): Promise<boolean> {
	return (await getPubkey(user)) !== null;
}

export function clearPubkeyCache(): void {
	cache.clear();
}
