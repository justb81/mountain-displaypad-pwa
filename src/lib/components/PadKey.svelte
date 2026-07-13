<script lang="ts">
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { secrets } from '$lib/state/secrets.svelte.js';
	import { templatePreview } from '$lib/state/templatePreview.svelte.js';
	import { TEMPLATE_DRAG_MIME } from '$lib/state/templates.svelte.js';
	import type { DropInput } from '$lib/displaypad/drop.js';
	import type { KeyConfig } from '$lib/types.js';

	/** Custom MIME type scoping drag data to key tiles within this app. */
	const DRAG_MIME = 'application/x-displaypad-key';

	interface Props {
		index: number;
		config: KeyConfig;
		pressed: boolean;
		/** Whether a toggle key is currently showing its `secondFace` instead of `face`. */
		toggled: boolean;
		selected: boolean;
		onselect: (index: number) => void;
		/** Fired when another key tile is dropped onto this one. `copy` reflects whether a modifier was held. */
		ondropkey: (from: number, to: number, copy: boolean) => void;
		/** Fired when a stash template tile is dropped onto this one. */
		ondroptemplate: (templateId: string, to: number) => void;
		/** Fired when an external image/SVG file or image URL is dropped onto this one. */
		ondropexternal: (payload: DropInput, to: number) => void;
	}

	let {
		index,
		config,
		pressed,
		toggled,
		selected,
		onselect,
		ondropkey,
		ondroptemplate,
		ondropexternal
	}: Props = $props();

	const activeFace = $derived(toggled && config.secondFace ? config.secondFace : config.face);
	const background = $derived(activeFace.type === 'color' ? activeFace.color : undefined);
	const image = $derived(activeFace.type === 'image' ? activeFace.dataUrl : undefined);
	const isRemote = $derived(activeFace.type === 'remote');
	const isTemplate = $derived(activeFace.type === 'template');
	const templateImage = $derived(isTemplate ? templatePreview.images[index] : undefined);
	const templateError = $derived(isTemplate ? templatePreview.errors[index] : undefined);
	const previewImage = $derived(image ?? templateImage ?? undefined);

	/** What happens on press, as a small badge glyph + accessible label — `undefined` for 'none'. */
	const actionBadge = $derived.by((): { glyph: string; label: string } | undefined => {
		switch (config.action.type) {
			case 'open-url':
				return { glyph: '↗', label: 'Opens a URL when pressed' };
			case 'copy-text':
				return { glyph: '⧉', label: 'Copies text when pressed' };
			case 'webhook':
				return { glyph: '⚡', label: 'Fires a webhook when pressed' };
			case 'open-folder':
				return { glyph: '⊞', label: 'Opens another page when pressed' };
			case 'back':
				return { glyph: '↩', label: 'Returns to the previous page when pressed' };
			default:
				return undefined;
		}
	});

	/** Keep this tile's template render current: re-render whenever its face, script approval, or secrets change. */
	$effect(() => {
		templatePreview.scheduleRender(index, config.face, keymap.scriptsApproved, secrets.values);
	});

	let dragOver = $state(false);

	function ondragstart(event: DragEvent) {
		event.dataTransfer?.setData(DRAG_MIME, String(index));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
	}

	/** An internal key/template drag reorders keys; anything else is an external file/URL drop. */
	function isInternalDrag(types: readonly string[]): boolean {
		return types.includes(DRAG_MIME) || types.includes(TEMPLATE_DRAG_MIME);
	}

	function acceptsDrag(event: DragEvent): boolean {
		const types = event.dataTransfer?.types;
		if (!types) return false;
		// Internal reorder/template drags, plus external files or a dragged image URL.
		return (
			isInternalDrag(types) ||
			types.includes('Files') ||
			types.includes('text/uri-list') ||
			types.includes('text/plain')
		);
	}

	function ondragover(event: DragEvent) {
		if (!acceptsDrag(event)) return;
		event.preventDefault();
		if (event.dataTransfer) {
			const types = event.dataTransfer.types;
			event.dataTransfer.dropEffect =
				!isInternalDrag(types) || types.includes(TEMPLATE_DRAG_MIME)
					? 'copy'
					: event.ctrlKey || event.altKey
						? 'copy'
						: 'move';
		}
	}

	function ondragenter(event: DragEvent) {
		if (!acceptsDrag(event)) return;
		event.preventDefault();
		dragOver = true;
	}

	function ondragleave() {
		dragOver = false;
	}

	function ondrop(event: DragEvent) {
		dragOver = false;
		const dt = event.dataTransfer;
		if (!dt) return;

		const templateId = dt.getData(TEMPLATE_DRAG_MIME);
		if (templateId) {
			event.preventDefault();
			ondroptemplate(templateId, index);
			return;
		}
		const raw = dt.getData(DRAG_MIME);
		if (raw) {
			event.preventDefault();
			ondropkey(Number(raw), index, event.ctrlKey || event.altKey);
			return;
		}
		// External drop: pull everything off the DataTransfer synchronously (it is
		// emptied once the handler returns), then hand it up for async processing.
		const payload: DropInput = {
			files: Array.from(dt.files),
			uriList: dt.getData('text/uri-list'),
			text: dt.getData('text/plain')
		};
		if (!payload.files?.length && !payload.uriList && !payload.text) return;
		event.preventDefault();
		ondropexternal(payload, index);
	}
</script>

<button
	type="button"
	draggable="true"
	onclick={() => onselect(index)}
	{ondragstart}
	{ondragover}
	{ondragenter}
	{ondragleave}
	{ondrop}
	aria-pressed={selected}
	title={`Key ${index + 1}: ${config.label}`}
	class="group relative flex aspect-square cursor-grab items-end justify-center overflow-hidden rounded-tile bg-cover bg-center p-1 text-white shadow-inner transition active:cursor-grabbing
		{selected
		? 'border-[3px] border-accent ring-2 ring-accent/40'
		: dragOver
			? 'border-[3px] border-success ring-2 ring-success/40'
			: 'border-2 border-slate-700 hover:border-slate-500'}
		{pressed ? 'scale-95 brightness-125' : ''}"
	style:background-color={background}
	style:background-image={previewImage ? `url(${previewImage})` : undefined}
>
	<span
		class="pointer-events-none absolute top-1 left-1 flex items-center gap-0.5 opacity-90"
		aria-hidden="true"
	>
		{#if actionBadge}
			<span
				class="flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none"
				title={actionBadge.label}
			>
				{actionBadge.glyph}
			</span>
		{/if}
		{#if config.secondFace}
			<span
				class="flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none"
				title="Flips to a second face when pressed"
			>
				⇄
			</span>
		{/if}
	</span>

	{#if isRemote}
		<span
			class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none"
			title="Live: refreshes from a URL"
		>
			⟳
		</span>
	{/if}
	{#if isTemplate}
		<span
			class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none {templateError
				? 'text-danger'
				: ''}"
			title={templateError ?? 'Live: rendered from a template'}
		>
			{'{}'}
		</span>
	{/if}

	<span
		class="pointer-events-none absolute top-1 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-white/0 transition group-hover:bg-white/25"
		aria-hidden="true"
	></span>

	<span
		class="max-w-full truncate rounded bg-slate-950/70 px-1.5 py-0.5 text-[11px] font-medium [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]"
	>
		{config.label}
	</span>
</button>
