<script lang="ts">
	import { connection } from '$lib/state/connection.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { TEMPLATE_DRAG_MIME, templates } from '$lib/state/templates.svelte.js';

	interface Props {
		/** The currently selected key — "Apply" pushes a template onto this slot. */
		selected: number;
	}

	let { selected }: Props = $props();

	let renamingId = $state<string | null>(null);
	let renameValue = $state('');

	function apply(id: string) {
		const template = templates.items.find((t) => t.id === id);
		if (!template) return;
		keymap.update(selected, { ...template.config });
		if (connection.status === 'connected') void connection.applyKey(selected);
	}

	function startRename(id: string, name: string) {
		renamingId = id;
		renameValue = name;
	}

	function commitRename() {
		if (renamingId) templates.rename(renamingId, renameValue);
		renamingId = null;
	}

	function ondragstart(event: DragEvent, id: string) {
		event.dataTransfer?.setData(TEMPLATE_DRAG_MIME, id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}
</script>

<section class="flex flex-col gap-3 rounded-2xl bg-slate-800 p-5">
	<h2 class="text-lg font-semibold text-white">Template stash</h2>
	{#if templates.items.length === 0}
		<p class="text-sm text-slate-400">
			No saved templates yet — use "Save as template" on a key to stash it here.
		</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each templates.items as template (template.id)}
				<li
					draggable="true"
					ondragstart={(e) => ondragstart(e, template.id)}
					title="Drag onto a key, or use Apply to push it to the selected key"
					class="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-slate-200"
				>
					<span
						class="h-8 w-8 flex-none rounded bg-cover bg-center"
						style:background-color={template.config.face.type === 'color'
							? template.config.face.color
							: undefined}
						style:background-image={template.config.face.type === 'image'
							? `url(${template.config.face.dataUrl})`
							: template.config.face.type === 'template' && template.previewDataUrl
								? `url(${template.previewDataUrl})`
								: undefined}
					></span>
					{#if renamingId === template.id}
						<input
							class="min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-1 py-0.5 text-white"
							value={renameValue}
							oninput={(e) => (renameValue = e.currentTarget.value)}
							onblur={commitRename}
							onkeydown={(e) => e.key === 'Enter' && commitRename()}
						/>
					{:else}
						<button
							type="button"
							class="min-w-0 flex-1 truncate text-left hover:underline"
							onclick={() => startRename(template.id, template.name)}
							title="Click to rename"
						>
							{template.name}
						</button>
					{/if}
					<button
						type="button"
						onclick={() => apply(template.id)}
						class="rounded bg-emerald-600 px-2 py-1 text-xs font-medium whitespace-nowrap text-white hover:bg-emerald-500"
					>
						Apply to Key {selected + 1}
					</button>
					<button
						type="button"
						onclick={() => templates.remove(template.id)}
						aria-label={`Delete template ${template.name}`}
						class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
					>
						Delete
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
