import { signMessage, sendTransaction, getConnectorClient } from '@wagmi/core';
import { config } from '$lib/services/wallet-config';
import { hashBody } from '@vattelum/document-registry-js';
import { stripFrontmatter } from '$lib/services/format';

// Turbo's official upload service. Same URL the @ardrive/turbo-sdk uses
// internally (defaultUploadServiceURL); pinned here so verifyTurboHas and
// any future status calls share one source of truth.
const TURBO_UPLOAD_SERVICE = 'https://upload.ardrive.io';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let turboPromise: Promise<any> | null = null;

async function initTurbo() {
	const client = await getConnectorClient(config);
	if (!client?.account) throw new Error('Wallet not connected');

	const { TurboFactory } = await import('@ardrive/turbo-sdk/web');
	return TurboFactory.authenticated({
		walletAdapter: {
			getSigner: () => ({
				signMessage: (msg: string | Uint8Array) => {
					if (typeof msg === 'string') {
						return signMessage(config, { message: msg });
					}
					return signMessage(config, { message: { raw: msg } });
				},
				// @ts-expect-error — Turbo walletAdapter expects ethers-shaped sendTransaction;
				// the Ethereum-token path only ever calls signMessage, never sendTransaction.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				sendTransaction: (tx: any) => sendTransaction(config, tx),
				provider: client.transport
			})
		},
		token: 'ethereum'
	});
}

async function getTurbo() {
	if (!turboPromise) {
		turboPromise = initTurbo();
	}
	return turboPromise;
}

export function resetTurbo() {
	turboPromise = null;
}

export interface UploadCost {
	winc: string;
	bytes: number;
}

export async function getUploadCost(byteCount: number): Promise<UploadCost> {
	const client = await getTurbo();
	const [cost] = await client.getUploadCosts({ bytes: [byteCount] });
	return { winc: cost.winc, bytes: byteCount };
}

export async function getBalance(): Promise<string> {
	const client = await getTurbo();
	const { winc } = await client.getBalance();
	return winc;
}

export async function uploadDocument(content: string): Promise<string> {
	const client = await getTurbo();
	const encoded = new TextEncoder().encode(content);
	const result = await client.upload({
		data: encoded,
		dataItemOpts: {
			tags: [
				{ name: 'Content-Type', value: 'text/markdown; charset=utf-8' },
				{ name: 'App-Name', value: 'Vattelum DAA' }
			]
		}
	});
	return result.id;
}

// Confirm Turbo has the bytes for the given tx ID before we let the caller
// commit it on-chain. The SDK's upload() resolves on receipt-signed, which
// under rare conditions can precede the data landing in Turbo's system — and
// once an unreachable URI is in the registry the only fix is an on-chain
// amendment.
export async function verifyTurboHas(txId: string): Promise<void> {
	// Delay BEFORE each attempt: 0s, 3s, 8s, 15s. Turbo's status endpoint often
	// 404s for several seconds after upload() resolves while the bundle
	// propagates internally; tight retries just burn budget and force the
	// user through an M1→M2 resubmit on every upload.
	const delays = [0, 3000, 8000, 15000];
	for (let i = 0; i < delays.length; i++) {
		if (delays[i] > 0) await new Promise((res) => setTimeout(res, delays[i]));
		try {
			const r = await fetch(`${TURBO_UPLOAD_SERVICE}/v1/tx/${txId}/status`);
			if (r.ok) return;
		} catch {
			// network blip — fall through to retry
		}
	}
	throw new Error(
		'Turbo did not confirm the upload. Nothing was recorded on-chain. Please retry.'
	);
}

// Fetch fallover order: canonical permanent gateway first, peer mirror second, Turbo
// last as a freshly-uploaded-but-not-yet-propagated safety net.
const GATEWAYS = ['https://arweave.net', 'https://ar-io.dev', 'https://turbo.ardrive.io'];

// All user-facing hyperlinks point at arweave.net. Hard and immutable — never Turbo,
// never a mirror. A link embedded in a registry row or printed PDF must still resolve
// years later, and only the canonical gateway guarantees that.
export function arweaveUrl(txId: string): string {
	return `https://arweave.net/${txId}`;
}

const CACHE_PREFIX = 'daa:arweave:';
const CACHE_TS_PREFIX = 'daa:arweave-ts:';

const ARWEAVE_TX_REGEX = /^[A-Za-z0-9_-]{43}$/;

// Accept both 0x-prefixed and bare hex; normalise to lowercase hex without 0x.
function normaliseHash(h: string): string {
	return h.toLowerCase().replace(/^0x/, '');
}

// The registry stores a hash of the bare body. Arweave stores the body wrapped in YAML
// frontmatter (see /propose: hashBody(body) vs uploadDocument(wrapWithFrontmatter(fm, body))).
// Strip the frontmatter before hashing so verification computes over the same bytes that
// were hashed at upload time.
async function matchesContentHash(text: string, contentHash: string): Promise<boolean> {
	const computed = normaliseHash(await hashBody(stripFrontmatter(text)));
	return computed === normaliseHash(contentHash);
}

export async function fetchFromArweave(txId: string, contentHash?: string): Promise<string> {
	if (!ARWEAVE_TX_REGEX.test(txId)) {
		throw new Error('Invalid Arweave transaction ID format.');
	}

	// Check localStorage cache by content hash. Poisoned entries (from a gateway
	// that served mismatched bytes before this fix deployed) are re-verified here
	// and dropped on mismatch so the fetch retries against gateways below.
	if (contentHash) {
		try {
			const cached = localStorage.getItem(CACHE_PREFIX + contentHash);
			if (cached) {
				if (await matchesContentHash(cached, contentHash)) {
					return cached;
				}
				localStorage.removeItem(CACHE_PREFIX + contentHash);
				localStorage.removeItem(CACHE_TS_PREFIX + contentHash);
			}
		} catch {
			// storage unavailable
		}
	}

	let sawMismatch = false;
	for (const gateway of GATEWAYS) {
		try {
			const res = await fetch(`${gateway}/${txId}`);
			if (res.ok) {
				const text = await res.text();

				// When the caller gave us a hash, every gateway response is verified
				// before it propagates. Mismatches are not cached — we fall through to
				// the next gateway instead of trusting a potentially poisoned response.
				if (contentHash && !(await matchesContentHash(text, contentHash))) {
					sawMismatch = true;
					continue;
				}

				if (contentHash) {
					try {
						localStorage.setItem(CACHE_PREFIX + contentHash, text);
						localStorage.setItem(CACHE_TS_PREFIX + contentHash, String(Date.now()));
					} catch {
						// storage full — evict oldest entries
						evictOldestCache();
						try {
							localStorage.setItem(CACHE_PREFIX + contentHash, text);
							localStorage.setItem(CACHE_TS_PREFIX + contentHash, String(Date.now()));
						} catch {
							// still full, skip caching
						}
					}
				}
				return text;
			}
		} catch {
			// try next gateway
		}
	}
	if (sawMismatch) {
		throw new Error(
			'Content verification failed — every Arweave gateway returned data that does not match the registry-recorded hash.'
		);
	}
	throw new Error('Document not yet available. It may still be confirming on the Arweave network.');
}

function evictOldestCache() {
	const entries: { key: string; timestamp: number }[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key?.startsWith(CACHE_PREFIX)) {
			const hash = key.slice(CACHE_PREFIX.length);
			const ts = Number(localStorage.getItem(CACHE_TS_PREFIX + hash)) || 0;
			entries.push({ key, timestamp: ts });
		}
	}
	// Sort oldest first, remove 5
	entries.sort((a, b) => a.timestamp - b.timestamp);
	for (const entry of entries.slice(0, 5)) {
		const hash = entry.key.slice(CACHE_PREFIX.length);
		localStorage.removeItem(entry.key);
		localStorage.removeItem(CACHE_TS_PREFIX + hash);
	}
}
