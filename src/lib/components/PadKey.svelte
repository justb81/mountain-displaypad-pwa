<script lang="ts">
	import type { KeyConfig } from '$lib/types.js';

	/** Custom MIME type scoping drag data to key tiles within this app. */
	const DRAG_MIME = 'application/x-displaypad-key';

	interface Props {
		index: number;
		config: KeyConfig;
		pressed: boolean;
		selected: boolean;
		onselect: (index: number) => void;
		/** Fired when another key tile is dropped onto this one. `copy` reflects whether a modifier was held. */
		ondropkey: (from: number, to: number, copy: boolean) => void;
	}

	let { index, config, pressed, selected, onselect, ondropkey }: Props = $props();

	const background = $derived(config.face.type === 'color' ? config.face.color : undefined);
	const image = $derived(config.face.type === 'image' ? config.face.dataUrl : undefined);

	let dragOver = $state(false);

	function ondragstart(event: DragEvent) {
		event.dataTransfer?.setData(DRAG_MIME, String(index));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
	}

	function ondragover(event: DragEvent) {
		if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = event.ctrlKey || event.altKey ? 'copy' : 'move';
	}

	function ondragenter(event: DragEvent) {
		if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
		event.preventDefault();
		dragOver = true;
	}

	function ondragleave() {
		dragOver = false;
	}

	function ondrop(event: DragEvent) {
		dragOver = false;
		const raw = event.dataTransfer?.getData(DRAG_MIME);
		if (!raw) return;
		event.preventDefault();
		ondropkey(Number(raw), index, event.ctrlKey || event.altKey);
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
	class="relative flex aspect-square items-end justify-center overflow-hidden rounded-lg border-2 bg-cover bg-center p-1 text-xs font-medium text-white shadow-inner transition
		{selected
		? 'border-sky-400 ring-2 ring-sky-400/50'
		: dragOver
			? 'border-emerald-400 ring-2 ring-emerald-400/50'
			: 'border-slate-700 hover:border-slate-500'}
		{pressed ? 'scale-95 brightness-125' : ''}"
	style:background-color={background}
	style:background-image={image ? `url(${image})` : undefined}
>
	<span class="rounded bg-black/50 px-1 py-0.5">{config.label}</span>
</button>
