<script lang="ts">
	import { toast } from '$lib/state/toast.svelte.js';

	const toneClass: Record<string, string> = {
		success: 'border-success/40 bg-emerald-950/90 text-success',
		error: 'border-danger/40 bg-rose-950/90 text-danger',
		info: 'border-line bg-slate-900/90 text-slate-200'
	};
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
	aria-live="polite"
>
	{#each toast.items as item (item.id)}
		<div
			class="pointer-events-auto flex max-w-sm items-center gap-3 rounded-control border px-3 py-2 text-label shadow-lg backdrop-blur {toneClass[
				item.kind
			]}"
		>
			<span class="flex-1">{item.text}</span>
			<button
				type="button"
				onclick={() => toast.dismiss(item.id)}
				aria-label="Dismiss notification"
				class="flex-none text-current/70 hover:text-current"
			>
				✕
			</button>
		</div>
	{/each}
</div>
