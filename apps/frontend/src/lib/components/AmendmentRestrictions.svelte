<script lang="ts">
	import Tooltip from '$lib/components/Tooltip.svelte';

	interface Props {
		enabled: boolean;
		timeLockSeconds: number;
		timeLockPreset: string;
		timeLockCustomDays: string;
		lockMode: 'entire' | 'specific';
		lockedSectionNumbers: number[];
		/** Top-level section numbers from the current editor content (used in 'specific' mode). */
		topSections: number[];
	}

	let {
		enabled = $bindable(),
		timeLockSeconds = $bindable(),
		timeLockPreset = $bindable(),
		timeLockCustomDays = $bindable(),
		lockMode = $bindable(),
		lockedSectionNumbers = $bindable(),
		topSections
	}: Props = $props();

	const TIME_LOCK_PRESETS = [
		{ value: 'permanent', label: 'Permanent', seconds: 0 },
		{ value: '90', label: '90 days', seconds: 7_776_000 },
		{ value: '180', label: '180 days', seconds: 15_552_000 },
		{ value: '360', label: '360 days', seconds: 31_104_000 },
		{ value: 'custom', label: 'Custom', seconds: 0 }
	];

	function handlePresetChange(preset: string) {
		timeLockPreset = preset;
		if (preset === 'permanent') {
			timeLockSeconds = 0;
			timeLockCustomDays = '';
		} else if (preset === 'custom') {
			const days = parseInt(timeLockCustomDays, 10);
			timeLockSeconds = days > 0 ? days * 86400 : 0;
		} else {
			const found = TIME_LOCK_PRESETS.find((p) => p.value === preset);
			if (found) timeLockSeconds = found.seconds;
			timeLockCustomDays = '';
		}
	}

	function handleCustomDaysChange(value: string) {
		timeLockCustomDays = value;
		const days = parseInt(value, 10);
		timeLockSeconds = days > 0 ? days * 86400 : 0;
	}

	function toggleSection(sectionNum: number) {
		if (lockedSectionNumbers.includes(sectionNum)) {
			lockedSectionNumbers = lockedSectionNumbers.filter((s) => s !== sectionNum);
		} else {
			lockedSectionNumbers = [...lockedSectionNumbers, sectionNum].sort((a, b) => a - b);
		}
	}
</script>

<div class="border border-border rounded-lg p-4">
	<label class="flex items-center gap-2 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={enabled}
			class="accent-primary"
		/>
		<span class="text-sm text-text-secondary">Set amendment restrictions on this document</span>
		<Tooltip text={"Bundle amendment restrictions with this proposal. Restrictions protect the document from frequent or trivial changes.\n\nIncludes time locks (minimum wait between amendments) and section locks (require 70% supermajority to amend).\n\nRestrictions route the proposal to Core strategy (70%)."} align="left"><span class="text-text-muted cursor-help text-xs">(?)</span></Tooltip>
	</label>

	{#if enabled}
		<div class="mt-4 flex flex-col gap-4">
			<!-- Locked sections (first) -->
			<div>
				<label class="block text-sm text-text-secondary mb-1">Locked sections <span class="text-text-muted">(require 70% to amend)</span></label>
				<div class="flex items-center gap-4 mb-2">
					<label class="flex items-center gap-1.5 cursor-pointer text-sm">
						<input
							type="radio"
							name="lockMode"
							value="entire"
							checked={lockMode === 'entire'}
							onchange={() => { lockMode = 'entire'; lockedSectionNumbers = []; }}
							class="accent-primary"
						/>
						Entire document
					</label>
					<label class="flex items-center gap-1.5 cursor-pointer text-sm">
						<input
							type="radio"
							name="lockMode"
							value="specific"
							checked={lockMode === 'specific'}
							onchange={() => lockMode = 'specific'}
							class="accent-primary"
						/>
						Specific sections
					</label>
				</div>
				{#if lockMode === 'specific'}
					{#if topSections.length > 0}
						<div class="flex flex-wrap gap-2">
							{#each topSections as secNum}
								{@const isChecked = lockedSectionNumbers.includes(secNum)}
								<button
									type="button"
									onclick={() => toggleSection(secNum)}
									class="px-3 py-1 rounded text-sm border transition-colors cursor-pointer
										{isChecked ? 'bg-primary/20 border-primary/40 text-text' : 'border-border text-text-muted hover:border-primary/40'}"
								>
									&sect;{secNum}
								</button>
							{/each}
						</div>
						{#if lockedSectionNumbers.length > 0}
							<p class="text-xs text-text-muted mt-1">Locking {lockedSectionNumbers.map(s => '§' + s).join(', ')} (cascade: subsections included)</p>
						{/if}
					{:else}
						<p class="text-xs text-text-muted">Add sections to the editor to select which to lock.</p>
					{/if}
				{:else}
					<p class="text-xs text-text-muted">All sections will require 70% supermajority to amend.</p>
				{/if}
			</div>

			<!-- Duration (second) -->
			<div>
				<label class="block text-sm text-text-secondary mb-1">Duration <span class="text-text-muted">(minimum time between amendments to locked sections)</span></label>
				<div class="flex items-center gap-2">
					<select
						value={timeLockPreset}
						onchange={(e) => handlePresetChange((e.target as HTMLSelectElement).value)}
						class="bg-bg-light border border-border rounded px-3 py-2 text-sm outline-none focus:border-primary"
					>
						{#each TIME_LOCK_PRESETS as preset}
							<option value={preset.value}>{preset.label}</option>
						{/each}
					</select>
					{#if timeLockPreset === 'custom'}
						<input
							type="number"
							min="1"
							placeholder="Days"
							value={timeLockCustomDays}
							oninput={(e) => handleCustomDaysChange((e.target as HTMLInputElement).value)}
							class="w-24 bg-bg-light border border-border rounded px-3 py-2 text-sm outline-none focus:border-primary"
						/>
						<span class="text-xs text-text-muted">days</span>
					{/if}
				</div>
				{#if timeLockPreset === 'permanent'}
					<p class="text-xs text-text-muted mt-1">Locked sections always require 70% supermajority.</p>
				{:else if timeLockSeconds > 0}
					<p class="text-xs text-text-muted mt-1">After an amendment, locked sections require 70% for {Math.round(timeLockSeconds / 86400)} days before returning to 50%.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
