<script lang="ts">
	import { NUM_KEYS_PER_ROW } from '$lib/displaypad/protocol.js';
	import { connection } from '$lib/state/connection.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { templates } from '$lib/state/templates.svelte.js';
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

	function ondroptemplate(templateId: string, to: number) {
		const template = templates.items.find((t) => t.id === templateId);
		if (!template) return;
		keymap.update(to, { ...template.config });
		if (connection.status === 'connected') void connection.applyKey(to);
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2 text-sm text-slate-400">
		<button
			type="button"
			onclick={() => void connection.goBack()}
			disabled={keymap.pageHistory.length === 0}
			class="rounded border border-slate-600 px-2 py-1 text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
		>
			&larr; Back
		</button>
		<button
			type="button"
			onclick={() => void connection.jumpToPage(0)}
			class="hover:text-slate-200 hover:underline"
		>
			Home
		</button>
		{#each keymap.pageHistory.slice(1) as page (page)}
			<span>/</span>
			<button
				type="button"
				onclick={() => void connection.jumpToPage(page)}
				class="hover:text-slate-200 hover:underline"
			>
				Page {page + 1}
			</button>
		{/each}
		{#if keymap.pageHistory.length > 0}
			<span>/</span>
			<span class="font-medium text-slate-200">Page {keymap.activePage + 1}</span>
		{/if}
		<label class="ml-auto flex items-center gap-1 text-xs">
			Jump to
			<select
				value={keymap.activePage}
				onchange={(e) => void connection.jumpToPage(Number(e.currentTarget.value))}
				class="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200"
			>
				{#each Array.from({ length: keymap.pageCount }, (_, i) => i) as pageIndex (pageIndex)}
					<option value={pageIndex}>
						Page {pageIndex + 1}{pageIndex === 0 ? ' (home)' : ''}
					</option>
				{/each}
			</select>
		</label>
		<button
			type="button"
			onclick={() => void connection.jumpToPage(keymap.addPage())}
			class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-700"
		>
			+ Add page
		</button>
	</div>

	<div
		class="grid gap-3 rounded-2xl bg-slate-900 p-4 shadow-lg"
		style:grid-template-columns={`repeat(${NUM_KEYS_PER_ROW}, minmax(0, 1fr))`}
	>
		{#each keymap.keys as config, index (index)}
			<PadKey
				{index}
				{config}
				pressed={connection.pressed[index]}
				toggled={connection.toggled[index]}
				selected={selected === index}
				{onselect}
				{ondropkey}
				{ondroptemplate}
			/>
		{/each}
	</div>
</div>
