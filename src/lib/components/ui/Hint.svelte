<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tone?: 'default' | 'warning' | 'danger';
		children: Snippet;
	}

	let { tone = 'default', children }: Props = $props();

	const toneClass = $derived(
		{ default: 'text-slate-500', warning: 'text-warning', danger: 'text-danger' }[tone]
	);
</script>

<!--
	A block element (not a flex container): text + inline `<code>` runs flow as one
	normal paragraph here. Putting this prose directly inside a `flex`/`flex-col`
	label instead turns every text run and `<code>` tag into its own flex item, each
	wrapping independently — the app's two worst rendering bugs were exactly that.
-->
<p
	class="text-caption leading-relaxed {toneClass} [&_code]:rounded [&_code]:bg-slate-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-300"
>
	{@render children()}
</p>
