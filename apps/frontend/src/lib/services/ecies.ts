import { secp256k1 } from '@noble/curves/secp256k1';

// Narrowing helper: Web Crypto's BufferSource excludes Uint8Array<SharedArrayBuffer>,
// but @noble/curves and ArrayBuffer-derived Uint8Arrays come typed as
// Uint8Array<ArrayBufferLike>. Runtime is always fine; this satisfies TS.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/**
 * Hybrid ECIES encryption (Option B): one symmetric key wraps the payload,
 * that key is then individually wrapped for each recipient's secp256k1 pubkey.
 *
 * Produces a single Arweave-friendly blob shared by all signatories. Each
 * recipient finds their own wrapped key by address, unwraps it with their
 * derived secp256k1 private scalar, and decrypts the shared payload.
 */

/**
 * HKDF info bytes for deriving the per-recipient key-wrapping AES key.
 *
 * Frozen — these bytes hash into the wrap key, so changing them would
 * invalidate every existing encrypted blob. The concatenated form preserves
 * the exact byte sequence emitted by the original two-constant implementation
 * (`'vattelum-contract-content-v1' + 'vattelum-contract-wrap-v1'`). Do not
 * touch unless you're rotating the encryption format end-to-end.
 */
const KEY_WRAP_INFO = new TextEncoder().encode(
	'vattelum-contract-content-v1vattelum-contract-wrap-v1'
);

export interface WrappedKey {
	/** Ephemeral secp256k1 pubkey, 64 bytes uncompressed (X || Y, no 0x04 prefix), hex. */
	ephPub: `0x${string}`;
	/** AES-GCM IV used to wrap the content key, base64. */
	wrapIv: string;
	/** AES-GCM ciphertext of the content key, base64. */
	wrappedKey: string;
}

export interface EciesBlob {
	/** Format version. */
	v: 1;
	/** AES-GCM IV used on the content payload, base64. */
	iv: string;
	/** AES-GCM ciphertext of the content payload, base64. */
	ciphertext: string;
	/** Per-recipient wrapped keys, keyed by lowercase address. */
	wrappedKeys: Record<string, WrappedKey>;
}

export interface RecipientPubkey {
	address: `0x${string}`;
	/** 64-byte uncompressed pubkey (X || Y, no 0x04 prefix), hex. */
	pubkey: `0x${string}`;
}

// ────────────────── Encrypt ─────────────────────────────────────

export async function encryptForRecipients(
	plaintext: string,
	recipients: RecipientPubkey[]
): Promise<EciesBlob> {
	if (recipients.length === 0) throw new Error('At least one recipient required');

	const contentKey = await crypto.subtle.generateKey(
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt']
	);

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: bs(iv) },
		contentKey,
		bs(new TextEncoder().encode(plaintext))
	);

	const rawContentKey = new Uint8Array(await crypto.subtle.exportKey('raw', contentKey));

	const wrappedKeys: Record<string, WrappedKey> = {};
	for (const r of recipients) {
		wrappedKeys[r.address.toLowerCase()] = await wrapKeyFor(rawContentKey, r.pubkey);
	}

	return {
		v: 1,
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		wrappedKeys
	};
}

async function wrapKeyFor(
	rawContentKey: Uint8Array,
	recipientPubkeyHex: `0x${string}`
): Promise<WrappedKey> {
	const recipientPub = uncompressedPubkeyBytes(recipientPubkeyHex);

	const ephPriv = secp256k1.utils.randomSecretKey();
	const ephPub = secp256k1.getPublicKey(ephPriv, false); // 65 bytes: 0x04 || X || Y

	const sharedPoint = secp256k1.getSharedSecret(ephPriv, recipientPub); // 33 bytes compressed
	const wrapKey = await deriveAesKey(sharedPoint);

	const wrapIv = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: bs(wrapIv) },
		wrapKey,
		bs(rawContentKey)
	);

	return {
		ephPub: `0x${bytesToHex(ephPub.slice(1))}` as `0x${string}`,
		wrapIv: bytesToBase64(wrapIv),
		wrappedKey: bytesToBase64(new Uint8Array(wrapped))
	};
}

// ────────────────── Decrypt ─────────────────────────────────────

export async function decryptAsRecipient(
	blob: EciesBlob,
	recipientAddress: `0x${string}`,
	recipientPrivateScalar: Uint8Array
): Promise<string> {
	if (blob.v !== 1) throw new Error(`Unsupported ECIES blob version: ${blob.v}`);

	const slot = blob.wrappedKeys[recipientAddress.toLowerCase()];
	if (!slot) throw new Error(`No wrapped key for recipient ${recipientAddress}`);

	const ephPubFull = uncompressedPubkeyBytes(slot.ephPub);
	const sharedPoint = secp256k1.getSharedSecret(recipientPrivateScalar, ephPubFull);
	const wrapKey = await deriveAesKey(sharedPoint);

	const wrapIv = base64ToBytes(slot.wrapIv);
	const rawContentKey = new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: bs(wrapIv) },
			wrapKey,
			bs(base64ToBytes(slot.wrappedKey))
		)
	);

	const contentKey = await crypto.subtle.importKey(
		'raw',
		bs(rawContentKey),
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const iv = base64ToBytes(blob.iv);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: bs(iv) },
		contentKey,
		bs(base64ToBytes(blob.ciphertext))
	);

	return new TextDecoder().decode(plaintext);
}

// ────────────────── Helpers ─────────────────────────────────────

/**
 * Convert a 64-byte uncompressed pubkey hex (no 0x04 prefix) into the 65-byte
 * format expected by @noble/curves (0x04 || X || Y).
 */
function uncompressedPubkeyBytes(pubkeyHex: `0x${string}`): Uint8Array {
	const xy = hexToBytes(pubkeyHex);
	if (xy.length !== 64) throw new Error(`Pubkey must be 64 bytes, got ${xy.length}`);
	const out = new Uint8Array(65);
	out[0] = 0x04;
	out.set(xy, 1);
	return out;
}

async function deriveAesKey(sharedPoint: Uint8Array): Promise<CryptoKey> {
	const ikm = await crypto.subtle.importKey('raw', bs(sharedPoint), 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: bs(new Uint8Array(32)),
			info: bs(KEY_WRAP_INFO)
		},
		ikm,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function bytesToHex(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
	return s;
}

function bytesToBase64(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
	return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
