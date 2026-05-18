import { signTypedData } from '@wagmi/core';
import { keccak256, type Hex } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import { config } from '$lib/services/wallet-config';
import { pubkeyRegistryAddress } from '$lib/contracts';

const chainId = Number(import.meta.env.VITE_CHAIN_ID);

/**
 * EIP-712 typed-data payload signed by every wallet to derive their encryption
 * keypair. Switched from personal_sign to signTypedData for real domain
 * separation — a phishing dapp can no longer replay the derivation by asking
 * the user to sign an innocuous-looking string; the wallet prompt now shows
 * the domain name and verifyingContract, both of which hardware wallets
 * render prominently.
 *
 * MUST NOT change after deployment — the signature seeds the user's ECIES
 * keypair, so altering any field would invalidate every existing encrypted
 * contract for every user.
 */
const ENCRYPTION_KEY_DOMAIN = {
	name: 'Vattelum Contracts Encryption Key',
	version: '1'
} as const;

const ENCRYPTION_KEY_TYPES = {
	EncryptionKey: [
		{ name: 'wallet', type: 'address' },
		{ name: 'purpose', type: 'string' }
	]
} as const;

const ENCRYPTION_KEY_PURPOSE = 'encryption-key-v1';

async function signEncryptionMessage(wallet: `0x${string}`): Promise<Hex> {
	return (await signTypedData(config, {
		domain: {
			...ENCRYPTION_KEY_DOMAIN,
			chainId,
			verifyingContract: pubkeyRegistryAddress
		},
		types: ENCRYPTION_KEY_TYPES,
		primaryType: 'EncryptionKey',
		message: { wallet, purpose: ENCRYPTION_KEY_PURPOSE }
	})) as Hex;
}

/**
 * Session-only cache of the derived scalar, keyed by lowercase wallet address.
 *
 * Lives in JS module memory only — never persisted to localStorage,
 * sessionStorage, IndexedDB, or any disk-backed store. Cleared on tab close,
 * page refresh, or wallet account switch. Caching adds no marginal exposure:
 * any code that can read this variable could equivalently call signMessage()
 * and re-derive the scalar itself.
 */
let cachedScalar: { wallet: string; scalar: Uint8Array } | null = null;

export function clearScalarCache(): void {
	cachedScalar = null;
}

/**
 * Derive the user's 32-byte secp256k1 private scalar.
 *
 * Hash the deterministic signature with keccak256 to get 32 bytes uniformly
 * distributed across [0, 2^256). The probability of falling outside the
 * valid scalar range [1, n-1] is ~2^-128, but we explicitly reduce modulo
 * the curve order to be defensive.
 *
 * Cached per-wallet for the lifetime of the page so repeated decryptions
 * don't re-prompt MetaMask.
 */
export async function derivePrivateScalar(wallet: `0x${string}`): Promise<Uint8Array> {
	const key = wallet.toLowerCase();
	if (cachedScalar && cachedScalar.wallet === key) {
		return cachedScalar.scalar;
	}

	const signature = await signEncryptionMessage(wallet);
	const hash = keccak256(signature);
	const scalar = BigInt(hash) % secp256k1.CURVE.n;
	const safeScalar = scalar === 0n ? 1n : scalar;

	const out = new Uint8Array(32);
	let v = safeScalar;
	for (let i = 31; i >= 0; i--) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}

	cachedScalar = { wallet: key, scalar: out };
	return out;
}

/**
 * Derive the user's 64-byte uncompressed encryption public key (X || Y, no 0x04 prefix).
 *
 * This is what gets stored in PubkeyRegistry. It is NOT the wallet's
 * transaction-signing pubkey — it is a separate keypair seeded from a
 * deterministic wallet signature so the same wallet always reproduces the
 * same encryption identity without ever exposing a private key.
 */
export async function deriveLocalPubkey(wallet: `0x${string}`): Promise<`0x${string}`> {
	const scalar = await derivePrivateScalar(wallet);
	const pubFull = secp256k1.getPublicKey(scalar, false); // 65 bytes: 0x04 || X || Y
	const xy = pubFull.slice(1); // strip 0x04 prefix → 64 bytes
	return `0x${bytesToHex(xy)}` as `0x${string}`;
}

function bytesToHex(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
	return s;
}
