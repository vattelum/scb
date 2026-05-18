<script lang="ts">
	import { toasts, dismissToast, type ToastKind } from '$lib/stores/toasts';

	function toastClass(kind: ToastKind) {
		switch (kind) {
			case 'success':
				return 'bg-green-900/90 border-green-700 text-green-100';
			case 'error':
				return 'bg-red-900/90 border-red-700 text-red-100';
			default:
				return 'bg-surface border-border text-text';
		}
	}
</script>

<div class="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none max-w-sm">
	{#each $toasts as t (t.id)}
		<button
			type="button"
			onclick={() => dismissToast(t.id)}
			class="pointer-events-auto text-left border rounded-lg px-4 py-2 text-sm shadow-lg transition-opacity {toastClass(t.kind)} cursor-pointer"
		>
			{t.message}
		</button>
	{/each}
</div>
