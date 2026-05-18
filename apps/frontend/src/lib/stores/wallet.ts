import { writable } from 'svelte/store';

interface WalletState {
	address: `0x${string}` | null;
	connected: boolean;
	connecting: boolean;
	isAdmin: boolean;
	isTokenHolder: boolean;
}

export const wallet = writable<WalletState>({
	address: null,
	connected: false,
	connecting: false,
	isAdmin: false,
	isTokenHolder: false
});
