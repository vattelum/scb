<script lang="ts">
	let { text, align = 'center', position = 'below', children } = $props<{
		text: string;
		align?: 'center' | 'left' | 'right';
		position?: 'below' | 'above';
		children: any;
	}>();

	let visible = $state(false);

	function toggle() {
		visible = !visible;
	}

	function hide() {
		visible = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && visible) {
			visible = false;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<span class="tooltip-wrap">
	<button
		type="button"
		class="tooltip-trigger"
		onclick={toggle}
		onblur={hide}
		aria-label="Show help"
	>
		{@render children()}
	</button>
	<span
		class="tooltip-text"
		class:visible
		class:align-left={align === 'left'}
		class:align-right={align === 'right'}
		class:above={position === 'above'}
		role="tooltip"
	>{text}</span>
</span>

<style>
	.tooltip-wrap {
		position: relative;
		display: inline-block;
	}

	.tooltip-trigger {
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		color: inherit;
		font: inherit;
		line-height: inherit;
		cursor: help;
	}
	.tooltip-trigger:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
		border-radius: 2px;
	}

	.tooltip-text {
		display: none;
		opacity: 0;
		position: absolute;
		left: 50%;
		top: 100%;
		transform: translateX(-50%);
		margin-top: 6px;
		padding: 8px 12px;
		background: var(--color-bg-lighter, #2a2a2e);
		color: var(--color-text, #e0e0e0);
		font-size: 0.75rem;
		line-height: 1.5;
		border-radius: 6px;
		border: 1px solid var(--color-border, #3a3a3e);
		max-width: min(380px, calc(100vw - 24px));
		width: max-content;
		word-wrap: break-word;
		white-space: pre-line;
		z-index: 50;
		transition: opacity 0.15s ease;
		pointer-events: none;
	}

	.tooltip-text.above {
		top: auto;
		bottom: 100%;
		margin-top: 0;
		margin-bottom: 6px;
	}

	.tooltip-text.align-left {
		left: 0;
		transform: none;
	}

	.tooltip-text.align-right {
		left: auto;
		right: 0;
		transform: none;
	}

	.tooltip-wrap:hover .tooltip-text,
	.tooltip-wrap:focus-within .tooltip-text,
	.tooltip-text.visible {
		display: block;
		opacity: 1;
	}
</style>
