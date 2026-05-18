/**
 * Generic localStorage-backed draft auto-save helper.
 *
 * Pattern previously inlined in /propose — a timer that serializes page state
 * every 30 s, a restore on mount, and a final flush on unload. Factored out so
 * any future form (e.g. /contract drafts) can opt in without duplicating the
 * setInterval / try-catch boilerplate.
 *
 * Usage (inside a Svelte component):
 *
 *   const draft = createDraftStore<MyState>('my:key', () => currentState, (s) => hydrate(s));
 *   onMount(() => { draft.restore(); draft.startAutosave(); });
 *   onDestroy(() => { draft.stopAutosave(); draft.save(); });
 *   // on successful submit: draft.clear();
 */

export interface DraftStore<T> {
	/** Write the current state snapshot to localStorage. No-op if serialize() returns null. */
	save: () => void;
	/** Read any persisted snapshot and invoke hydrate(); safe to call when absent. */
	restore: () => void;
	/** Delete any persisted snapshot. */
	clear: () => void;
	/** Begin a periodic auto-save timer (default 30 s). Idempotent — safe to call twice. */
	startAutosave: (intervalMs?: number) => void;
	/** Cancel the auto-save timer. Safe to call when not running. */
	stopAutosave: () => void;
}

export function createDraftStore<T>(
	key: string,
	serialize: () => T | null,
	hydrate: (state: T) => void
): DraftStore<T> {
	let timer: ReturnType<typeof setInterval> | null = null;

	function save() {
		try {
			const state = serialize();
			if (state === null) return;
			localStorage.setItem(key, JSON.stringify(state));
		} catch {
			// storage full, unavailable, or state non-serializable — skip
		}
	}

	function restore() {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return;
			hydrate(JSON.parse(raw) as T);
		} catch {
			// corrupt draft — ignore
		}
	}

	function clear() {
		try {
			localStorage.removeItem(key);
		} catch {
			// storage unavailable
		}
	}

	function startAutosave(intervalMs = 30_000) {
		if (timer !== null) return;
		timer = setInterval(save, intervalMs);
	}

	function stopAutosave() {
		if (timer === null) return;
		clearInterval(timer);
		timer = null;
	}

	return { save, restore, clear, startAutosave, stopAutosave };
}
