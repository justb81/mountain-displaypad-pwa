<script lang="ts">
	import Button from './Button.svelte';

	interface Props {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let { open, title, message, confirmLabel = 'Confirm', onconfirm, oncancel }: Props = $props();

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') oncancel();
	}
</script>

<svelte:window onkeydown={open ? onkeydown : undefined} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
		<div
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-modal-title"
			class="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-line bg-slate-900 p-5 shadow-xl"
		>
			<h2 id="confirm-modal-title" class="text-h1 font-semibold text-white">{title}</h2>
			<p class="text-body text-slate-300">{message}</p>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" onclick={oncancel}>Cancel</Button>
				<Button variant="danger" onclick={onconfirm}>{confirmLabel}</Button>
			</div>
		</div>
	</div>
{/if}
