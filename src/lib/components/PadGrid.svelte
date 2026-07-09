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

	function ondropkey(from: number, to: number, copy: boolean) {
		if (from === to) return;
		if (copy) {
			keymap.copy(from, to);
			if (connection.status === 'connected') void connection.applyKey(to);
		} else {
			keymap.swap(from, to);
			if (connection.status === 'connected') {
				void connection.applyKey(from);
				void connection.applyKey(to);
			}
		}
	}
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
			{ondropkey}
		/>
	{/each}
</div>
