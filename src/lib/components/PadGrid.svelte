<script lang="ts">
	import { NUM_KEYS_PER_ROW } from '$lib/displaypad/protocol.js';
	import { connection } from '$lib/state/connection.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import PadKey from './PadKey.svelte';

	interface Props {
		selected: number;
		onselect: (index: number) => void;
	}

	let { selected, onselect }: Props = $props();
</script>

<div
	class="grid gap-3 rounded-2xl bg-slate-900 p-4 shadow-lg"
	style:grid-template-columns={`repeat(${NUM_KEYS_PER_ROW}, minmax(0, 1fr))`}
>
	{#each keymap.keys as config, index (index)}
		<PadKey
			{index}
			{config}
			pressed={connection.pressed[index]}
			selected={selected === index}
			{onselect}
		/>
	{/each}
</div>
