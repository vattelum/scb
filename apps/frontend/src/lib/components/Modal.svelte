<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		open: boolean;
		title?: string;
		maxWidth?: string;
		closeOnBackdrop?: boolean;
		closeOnEscape?: boolean;
		onclose?: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let {
		open = $bindable(),
		title,
		maxWidth = 'max-w-lg',
		closeOnBackdrop = true,
		closeOnEscape = true,
		onclose,
		children,
		footer
	}: Props = $props();

	let container: HTMLDivElement | undefined = $state();
	let previousFocus: HTMLElement | null = null;

	function close() {
		open = false;
		onclose?.();
	}

	function onBackdropClick(e: MouseEvent) {
		if (!closeOnBackdrop) return;
		if (e.target === e.currentTarget) close();
	}

	function onKeydown(e: KeyboardEvent) {
		if (closeOnEscape && e.key === 'Escape') {
			e.stopPropagation();
			close();
			return;
		}
		if (e.key === 'Tab' && container) {
			const focusables = container.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	// Body scroll lock with refcount so stacked modals don't fight.
	function lockScroll() {
		if (typeof document === 'undefined') return;
		const w = window as any;
		w.__modalLockCount = (w.__modalLockCount || 0) + 1;
		if (w.__modalLockCount === 1) {
			w.__modalPrevOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
		}
	}

	function unlockScroll() {
		if (typeof document === 'undefined') return;
		const w = window as any;
		w.__modalLockCount = Math.max(0, (w.__modalLockCount || 0) - 1);
		if (w.__modalLockCount === 0) {
			document.body.style.overflow = w.__modalPrevOverflow || '';
		}
	}

	let locked = false;
	$effect(() => {
		if (open && !locked) {
			locked = true;
			previousFocus = (document.activeElement as HTMLElement) ?? null;
			lockScroll();
			// Focus first focusable after mount.
			queueMicrotask(() => {
				const first = container?.querySelector<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
				);
				first?.focus();
			});
		} else if (!open && locked) {
			locked = false;
			unlockScroll();
			previousFocus?.focus?.();
		}
	});

	onDestroy(() => {
		if (locked) {
			locked = false;
			unlockScroll();
		}
	});
</script>

{#if open}
	<div
		class="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 p-4"
		onclick={onBackdropClick}
		onkeydown={onKeydown}
		role="presentation"
	>
		<div
			bind:this={container}
			class="bg-surface border border-border rounded-lg w-full {maxWidth} max-h-[85vh] flex flex-col"
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			{#if title}
				<div class="flex items-center justify-between px-6 py-4 border-b border-border">
					<h2 class="text-lg font-medium">{title}</h2>
					<button
						onclick={close}
						aria-label="Close"
						class="text-text-muted hover:text-text transition-colors cursor-pointer text-lg leading-none"
					>&times;</button>
				</div>
			{/if}

			<div class="overflow-y-auto px-6 py-5 flex-1">
				{@render children()}
			</div>

			{#if footer}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
