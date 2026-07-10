<script lang="ts">
	import Button from './ui/Button.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';
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
		toast.success(`Applied "${template.name}" to Key ${selected + 1}.`);
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

<section class="flex flex-col gap-3 rounded-panel border border-line bg-slate-800/60 p-4">
	<h2 class="text-h2 font-semibold text-white">Template stash</h2>
	{#if templates.items.length === 0}
		<p class="text-label text-slate-400">
			No saved templates yet — use "Save as template" in the key inspector to stash one here, then
			drag it onto any key.
		</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each templates.items as template (template.id)}
				<li
					draggable="true"
					ondragstart={(e) => ondragstart(e, template.id)}
					title="Drag onto a key, or use Apply to push it to the selected key"
					class="flex cursor-grab items-center gap-2 rounded-control border border-line bg-slate-900 p-2 text-label text-slate-200 active:cursor-grabbing"
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
							class="min-w-0 flex-1 rounded-control border border-line bg-slate-950 px-1.5 py-1 text-white"
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
					<Button variant="success" size="sm" onclick={() => apply(template.id)}>
						Apply to Key {selected + 1}
					</Button>
					<Button
						size="sm"
						onclick={() => templates.remove(template.id)}
						aria-label={`Delete template ${template.name}`}
					>
						Delete
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
