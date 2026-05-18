<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		loading?: boolean;
		disabled?: boolean;
		loadingLabel?: string;
		variant?: 'primary' | 'secondary' | 'danger' | 'none';
		type?: 'button' | 'submit' | 'reset';
		title?: string;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	}

	let {
		loading = false,
		disabled = false,
		loadingLabel,
		variant = 'primary',
		type = 'button',
		title,
		class: klass = '',
		onclick,
		children
	}: Props = $props();

	const variantClass = $derived(
		variant === 'primary'
			? 'bg-primary hover:bg-primary-hover text-text'
			: variant === 'danger'
				? 'bg-red-800 hover:bg-red-700 text-text'
				: variant === 'secondary'
					? 'bg-surface hover:bg-surface-hover border border-border text-text'
					: 'text-text'
	);

	const isDisabled = $derived(loading || disabled);
</script>

<button
	{type}
	{title}
	disabled={isDisabled}
	onclick={onclick}
	class="text-sm px-4 py-2 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed {variantClass} {klass}"
>
	{#if loading && loadingLabel}
		{loadingLabel}
	{:else}
		{@render children()}
	{/if}
</button>
