<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label?: string;
		children: Snippet;
	}

	let { label = 'Settings', children }: Props = $props();

	let open = $state(false);
	let container = $state<HTMLDivElement>();

	function onWindowClick(event: MouseEvent) {
		if (open && container && !container.contains(event.target as Node)) open = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={open ? onkeydown : undefined} />

<div class="relative" bind:this={container}>
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-haspopup="true"
		aria-expanded={open}
		aria-label={label}
		title={label}
		class="focus-visible:outline-accent flex h-9 w-9 items-center justify-center rounded-control border border-line text-slate-300 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
	>
		<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
			<circle cx="4" cy="10" r="1.5" />
			<circle cx="10" cy="10" r="1.5" />
			<circle cx="16" cy="10" r="1.5" />
		</svg>
	</button>
	{#if open}
		<div
			class="absolute top-full right-0 z-40 mt-2 flex w-64 flex-col gap-1 rounded-panel border border-line bg-slate-900 p-3 text-label text-slate-200 shadow-xl"
		>
			{@render children()}
		</div>
	{/if}
</div>
