import { writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
	expiresAt: number;
}

const MAX_VISIBLE = 4;

// Per-kind defaults. Errors carry more text and merit a longer read window
// than successes; info sits between. Callers may override with the
// durationMs argument when a specific message needs more or less time.
const DEFAULT_DURATIONS: Record<ToastKind, number> = {
	success: 7000,
	error: 10000,
	info: 7000
};

export const toasts = writable<Toast[]>([]);

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function showToast(kind: ToastKind, message: string, durationMs?: number): number {
	const ttl = durationMs ?? DEFAULT_DURATIONS[kind];
	const id = nextId++;
	const toast: Toast = { id, kind, message, expiresAt: Date.now() + ttl };
	toasts.update((list) => {
		const next = [...list, toast];
		// Drop oldest if over cap.
		while (next.length > MAX_VISIBLE) {
			const dropped = next.shift();
			if (dropped) {
				const t = timers.get(dropped.id);
				if (t) {
					clearTimeout(t);
					timers.delete(dropped.id);
				}
			}
		}
		return next;
	});
	const timer = setTimeout(() => dismissToast(id), ttl);
	timers.set(id, timer);
	return id;
}

export function dismissToast(id: number) {
	const t = timers.get(id);
	if (t) {
		clearTimeout(t);
		timers.delete(id);
	}
	toasts.update((list) => list.filter((x) => x.id !== id));
}
