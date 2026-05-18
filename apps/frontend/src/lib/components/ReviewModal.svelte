<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import LoadingButton from '$lib/components/LoadingButton.svelte';

	interface Props {
		title: string;
		/** Sanitized HTML rendered via `{@html}` — caller is responsible for sanitization. */
		bodyHtml: string;
		/** Snippet rendering the header-strip metadata chips (category, doc, strategy, etc.). */
		badges: Snippet;
		/** Raw markdown copied to the clipboard when Copy is clicked. */
		copyText: string;
		onClose: () => void;
		onSubmit: () => void;
		submitLabel?: string;
	}

	let { title, bodyHtml, badges, copyText, onClose, onSubmit, submitLabel = 'Upload & Create Proposal' }: Props = $props();

	let open = $state(true);
	let copyLabel = $state('Copy');

	function close() {
		open = false;
		onClose();
	}

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(copyText);
			copyLabel = 'Copied';
		} catch {
			copyLabel = 'Failed';
		}
		setTimeout(() => (copyLabel = 'Copy'), 2000);
	}
</script>

<Modal bind:open title={`Review: ${title}`} maxWidth="max-w-3xl" onclose={onClose}>
	<div class="text-sm text-text-secondary flex flex-wrap gap-x-6 gap-y-1 mb-4 pb-4 border-b border-border">
		{@render badges()}
	</div>

	<div class="doc-viewer prose prose-invert max-w-none text-sm">
		{@html bodyHtml}
	</div>

	{#snippet footer()}
		<div class="flex items-center justify-between w-full">
			<LoadingButton
				onclick={handleCopy}
				variant="none"
				class="border border-primary text-primary hover:bg-primary hover:text-text py-1.5"
			>
				{copyLabel}
			</LoadingButton>
			<div class="flex items-center gap-3">
				<LoadingButton onclick={close} variant="secondary" class="py-1.5">
					Back to Editor
				</LoadingButton>
				<LoadingButton onclick={onSubmit} variant="primary" class="px-6 py-1.5 font-medium">
					{submitLabel}
				</LoadingButton>
			</div>
		</div>
	{/snippet}
</Modal>
