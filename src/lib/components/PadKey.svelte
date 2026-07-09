<script lang="ts">
	import type { KeyConfig } from '$lib/types.js';

	interface Props {
		index: number;
		config: KeyConfig;
		pressed: boolean;
		selected: boolean;
		onselect: (index: number) => void;
	}

	let { index, config, pressed, selected, onselect }: Props = $props();

	const background = $derived(config.face.type === 'color' ? config.face.color : undefined);
	const image = $derived(config.face.type === 'image' ? config.face.dataUrl : undefined);
</script>

<button
	type="button"
	onclick={() => onselect(index)}
	aria-pressed={selected}
	class="relative flex aspect-square items-end justify-center overflow-hidden rounded-lg border-2 bg-cover bg-center p-1 text-xs font-medium text-white shadow-inner transition
		{selected ? 'border-sky-400 ring-2 ring-sky-400/50' : 'border-slate-700 hover:border-slate-500'}
		{pressed ? 'scale-95 brightness-125' : ''}"
	style:background-color={background}
	style:background-image={image ? `url(${image})` : undefined}
>
	<span class="rounded bg-black/50 px-1 py-0.5">{config.label}</span>
</button>
