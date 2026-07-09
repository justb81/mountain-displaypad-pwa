<script lang="ts">
	import ConnectButton from '$lib/components/ConnectButton.svelte';
	import KeyInspector from '$lib/components/KeyInspector.svelte';
	import PadGrid from '$lib/components/PadGrid.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { debug } from '$lib/state/debug.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';

	let selected = $state(0);
</script>

<svelte:head>
	<title>DisplayPad Configurator</title>
	<meta name="description" content="Configure your Mountain DisplayPad from the browser." />
</svelte:head>

<div class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 text-slate-100">
	<header class="flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold">DisplayPad Configurator</h1>
			<p class="text-sm text-slate-400">
				Status: <span class="font-mono">{connection.status}</span>
			</p>
		</div>
		<div class="flex items-center gap-4">
			<label class="flex items-center gap-2 text-sm text-slate-400">
				<input type="checkbox" bind:checked={debug.enabled} />
				Debug logging
			</label>
			<ConnectButton />
		</div>
	</header>

	<main class="grid gap-6 md:grid-cols-[2fr_1fr]">
		<div class="flex flex-col gap-3">
			<PadGrid {selected} onselect={(i) => (selected = i)} />
			<button
				type="button"
				onclick={() => keymap.reset()}
				class="self-start text-sm text-slate-400 underline hover:text-slate-200"
			>
				Reset all keys
			</button>
		</div>
		<KeyInspector index={selected} />
	</main>
</div>
