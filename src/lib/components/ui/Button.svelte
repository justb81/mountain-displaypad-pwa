<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost';
		size?: 'sm' | 'md';
		children?: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		type = 'button',
		class: extraClass = '',
		children,
		...rest
	}: Props = $props();

	const sizeClass = $derived(size === 'sm' ? 'px-2 py-1 text-caption' : 'px-3 py-1.5 text-label');

	const variantClass = $derived(
		{
			primary: 'bg-accent-strong text-white hover:bg-accent',
			secondary: 'border border-line text-slate-200 hover:bg-slate-700/60',
			success: 'bg-success-strong text-white hover:bg-success',
			danger: 'bg-danger-strong text-white hover:bg-danger',
			warning: 'bg-warning-strong text-white hover:bg-warning',
			ghost: 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
		}[variant]
	);
</script>

<button
	{type}
	{...rest}
	class="focus-visible:outline-accent inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition
		disabled:cursor-not-allowed disabled:opacity-40
		focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
		{sizeClass} {variantClass} {extraClass}"
>
	{@render children?.()}
</button>
