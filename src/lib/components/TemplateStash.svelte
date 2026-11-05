<script lang="ts">
	import Button from './ui/Button.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';
	import {
		filterTemplates,
		formatKeywords,
		groupTemplatesByKeyword,
		KEY_DRAG_MIME,
		TEMPLATE_DRAG_MIME,
		templates,
		type Template
	} from '$lib/state/templates.svelte.js';
	import { actionBadge, faceBadge, TOGGLE_BADGE } from '$lib/ui/badges.js';

	interface Props {
		/** The currently selected key — "Apply" pushes a template onto this slot. */
		selected: number;
	}

	let { selected }: Props = $props();

	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let keywordsId = $state<string | null>(null);
	let keywordsValue = $state('');
	let query = $state('');
	let fileInput: HTMLInputElement;

	/** Nesting-safe drag counter, so moving over child tiles doesn't flicker the drop highlight off. */
	let dragDepth = $state(0);
	const dragActive = $derived(dragDepth > 0);

	const filtered = $derived(filterTemplates(templates.items, query));
	const groups = $derived(groupTemplatesByKeyword(filtered));
	/** Show per-keyword sub-headings once any template carries a keyword; a flat list otherwise. */
	const showHeadings = $derived(groups.some((g) => g.keyword !== null));

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

	function startEditKeywords(template: Template) {
		keywordsId = template.id;
		keywordsValue = formatKeywords(template.keywords);
	}

	function commitKeywords() {
		if (keywordsId) templates.setKeywords(keywordsId, keywordsValue);
		keywordsId = null;
	}

	function ondragstart(event: DragEvent, id: string) {
		event.dataTransfer?.setData(TEMPLATE_DRAG_MIME, id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}

	function exportStash() {
		const blob = new Blob([templates.exportJson()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'displaypad-templates.json';
		link.click();
		URL.revokeObjectURL(url);
		toast.success('Exported the template stash as displaypad-templates.json.');
	}

	async function importFromText(text: string) {
		try {
			const added = await templates.importJson(text);
			toast.success(`Imported ${added} template${added === 1 ? '' : 's'} into the stash.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not import that file.');
		}
	}

	async function handleImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) await importFromText(await file.text());
		input.value = '';
	}

	/** Stash the config currently on keypad key `index`; unless copying, clear that key afterwards. */
	async function stashFromKey(index: number, copy: boolean) {
		if (!Number.isInteger(index) || index < 0 || index >= keymap.keys.length) return;
		const config = keymap.keys[index];
		const name = config.label.trim() || `Key ${index + 1}`;
		await templates.save(name, config, keymap.scriptsApproved);
		if (copy) {
			toast.success(`Saved Key ${index + 1} to the stash.`);
			return;
		}
		keymap.resetKey(index);
		connection.syncLiveTimer(index);
		if (connection.status === 'connected') void connection.applyKey(index);
		toast.success(`Moved Key ${index + 1} into the stash.`);
	}

	/** Whether a drag carries something the stash can receive: a keypad key, or a JSON file/text. */
	function acceptsDrag(event: DragEvent): boolean {
		const types = event.dataTransfer?.types;
		if (!types) return false;
		return types.includes(KEY_DRAG_MIME) || types.includes('Files') || types.includes('text/plain');
	}

	function onSectionDragOver(event: DragEvent) {
		if (!acceptsDrag(event)) return;
		event.preventDefault();
		if (event.dataTransfer) {
			const isKey = event.dataTransfer.types.includes(KEY_DRAG_MIME);
			event.dataTransfer.dropEffect = isKey && !(event.ctrlKey || event.altKey) ? 'move' : 'copy';
		}
	}

	function onSectionDragEnter(event: DragEvent) {
		if (!acceptsDrag(event)) return;
		event.preventDefault();
		dragDepth++;
	}

	function onSectionDragLeave(event: DragEvent) {
		if (!acceptsDrag(event)) return;
		dragDepth = Math.max(0, dragDepth - 1);
	}

	async function onSectionDrop(event: DragEvent) {
		dragDepth = 0;
		const dt = event.dataTransfer;
		if (!dt) return;

		const keyRaw = dt.getData(KEY_DRAG_MIME);
		if (keyRaw !== '') {
			event.preventDefault();
			await stashFromKey(Number(keyRaw), event.ctrlKey || event.altKey);
			return;
		}
		// A stash template being dragged out (onto a key) — not a drop *into* the stash.
		if (dt.getData(TEMPLATE_DRAG_MIME)) return;

		const file = Array.from(dt.files).find((f) => /json/i.test(f.type) || /\.json$/i.test(f.name));
		if (file) {
			event.preventDefault();
			await importFromText(await file.text());
			return;
		}
		const text = dt.getData('text/plain');
		if (text.trim()) {
			event.preventDefault();
			await importFromText(text);
		}
	}

	/** The face swatch for a tile: a colour/image/template-thumbnail, or a live-face glyph fallback. */
	function swatch(template: Template): { color?: string; image?: string; glyph?: string } {
		const face = template.config.face;
		if (face.type === 'color') return { color: face.color };
		if (face.type === 'image') return { image: face.dataUrl };
		if (face.type === 'template' && template.previewDataUrl)
			return { image: template.previewDataUrl };
		return { glyph: faceBadge(face)?.glyph };
	}
</script>

{#snippet badge(glyph: string, label: string)}
	<span
		class="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-slate-950 text-[10px] leading-none text-slate-300"
		title={label}
	>
		{glyph}
	</span>
{/snippet}

{#snippet tile(template: Template)}
	{@const sw = swatch(template)}
	{@const face = faceBadge(template.config.face)}
	{@const action = actionBadge(template.config.action)}
	<li
		draggable="true"
		ondragstart={(e) => ondragstart(e, template.id)}
		title="Drag onto a key, or use Apply to push it to the selected key"
		class="flex cursor-grab flex-col gap-2 rounded-control border border-line bg-slate-900 p-2 text-label text-slate-200 active:cursor-grabbing"
	>
		<div class="flex flex-wrap items-center gap-2">
			<span
				class="flex h-8 w-8 flex-none items-center justify-center rounded bg-cover bg-center text-slate-400"
				style:background-color={sw.color}
				style:background-image={sw.image ? `url(${sw.image})` : undefined}
			>
				{#if sw.glyph}{sw.glyph}{/if}
			</span>
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
			<span
				class="flex items-center gap-1"
				aria-hidden={!face && !template.config.secondFace && !action}
			>
				{#if face}{@render badge(face.glyph, face.label)}{/if}
				{#if template.config.secondFace}{@render badge(TOGGLE_BADGE.glyph, TOGGLE_BADGE.label)}{/if}
				{#if action}{@render badge(action.glyph, action.label)}{/if}
			</span>
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
		</div>

		{#if keywordsId === template.id}
			<div class="flex items-center gap-2">
				<input
					class="min-w-0 flex-1 rounded-control border border-line bg-slate-950 px-1.5 py-1 text-white"
					placeholder="Keywords, comma separated"
					value={keywordsValue}
					oninput={(e) => (keywordsValue = e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter') commitKeywords();
						if (e.key === 'Escape') keywordsId = null;
					}}
				/>
				<Button variant="success" size="sm" onclick={commitKeywords}>Save</Button>
				<Button size="sm" onclick={() => (keywordsId = null)}>Cancel</Button>
			</div>
		{:else}
			<div class="flex flex-wrap items-center gap-1.5">
				{#each template.keywords ?? [] as keyword (keyword)}
					<button
						type="button"
						class="rounded-full bg-slate-800 px-2 py-0.5 text-caption text-slate-300 transition hover:bg-slate-700"
						onclick={() => (query = keyword)}
						title={`Filter by "${keyword}"`}
					>
						{keyword}
					</button>
				{/each}
				<button
					type="button"
					class="rounded-full px-2 py-0.5 text-caption text-slate-500 underline decoration-slate-700 underline-offset-2 transition hover:text-slate-300"
					onclick={() => startEditKeywords(template)}
				>
					{template.keywords?.length ? 'Edit keywords' : '+ keywords'}
				</button>
			</div>
		{/if}
	</li>
{/snippet}

<section
	aria-label="Template stash — drop a key or a template JSON file here"
	ondragover={onSectionDragOver}
	ondragenter={onSectionDragEnter}
	ondragleave={onSectionDragLeave}
	ondrop={onSectionDrop}
	class="flex flex-col gap-3 rounded-panel border bg-slate-800/60 p-4 transition
		{dragActive ? 'border-success ring-2 ring-success/40' : 'border-line'}"
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-h2 font-semibold text-white">Template stash</h2>
		<div class="flex flex-wrap gap-2">
			<Button size="sm" onclick={() => fileInput.click()}>Import JSON</Button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				onchange={handleImportFile}
			/>
			{#if templates.items.length > 0}
				<Button size="sm" onclick={exportStash}>Export JSON</Button>
			{/if}
		</div>
	</div>

	{#if templates.items.length === 0}
		<p class="text-label text-slate-400">
			No saved templates yet — use "Save as template" in the key inspector, drag a key from the pad
			onto this panel, or import a template JSON file. Then drag a template onto any key to apply
			it.
		</p>
	{:else}
		<input
			type="search"
			placeholder="Filter by name or keyword…"
			value={query}
			oninput={(e) => (query = e.currentTarget.value)}
			class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-label text-white placeholder:text-slate-500"
		/>

		{#if filtered.length === 0}
			<p class="text-label text-slate-400">No templates match "{query}".</p>
		{:else}
			{#each groups as group (group.key)}
				{#if showHeadings}
					<h3
						class="mt-1 flex items-center gap-2 text-caption font-semibold tracking-wide text-slate-400 uppercase"
					>
						{group.keyword ?? 'No keywords'}
						<span class="rounded-full bg-slate-900 px-1.5 text-slate-500">{group.items.length}</span
						>
					</h3>
				{/if}
				<ul class="flex flex-col gap-2">
					{#each group.items as template (template.id)}
						{@render tile(template)}
					{/each}
				</ul>
			{/each}
		{/if}
	{/if}

	<p class="text-caption text-slate-500">
		Drag a key from the pad here to stash it (it clears the key; hold ⌘/Ctrl to keep a copy), or
		drop a template JSON file to import.
	</p>
</section>
