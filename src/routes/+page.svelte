<script lang="ts">
	import ConnectButton from '$lib/components/ConnectButton.svelte';
	import KeyInspector from '$lib/components/KeyInspector.svelte';
	import PadGrid from '$lib/components/PadGrid.svelte';
	import ProfileTools from '$lib/components/ProfileTools.svelte';
	import TemplateStash from '$lib/components/TemplateStash.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import OverflowMenu from '$lib/components/ui/OverflowMenu.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { debug } from '$lib/state/debug.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';

	let selected = $state(0);
	let confirmResetAll = $state(false);

	/** Reset the selected key on Delete, unless the keypress belongs to a text field/editor. */
	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Delete') return;
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable) return;
		const tag = target?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		keymap.resetKey(selected);
		connection.syncLiveTimer(selected);
		toast.info(`Key ${selected + 1} reset.`);
	}

	async function applyAll() {
		await connection.applyAll();
		toast.success('Applied all keys to the pad.');
	}

	function confirmResetAllKeys() {
		keymap.reset();
		confirmResetAll = false;
		toast.success('All keys reset to defaults.');
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<svelte:head>
	<title>DisplayPad Configurator</title>
	<meta name="description" content="Configure your Mountain DisplayPad from the browser." />
</svelte:head>

<ConfirmModal
	open={confirmResetAll}
	title="Reset all keys?"
	message="Every key on every page will be restored to its default label, face, and action. This can't be undone."
	confirmLabel="Reset all"
	onconfirm={confirmResetAllKeys}
	oncancel={() => (confirmResetAll = false)}
/>

<div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-4 text-slate-100 sm:p-6">
	<header class="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
		<div class="flex items-center gap-3">
			<span
				class="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-accent-strong/20 text-accent-soft"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					class="h-5 w-5"
					aria-hidden="true"
				>
					<rect x="3" y="4" width="18" height="12" rx="2" />
					<path d="M8 20h8M12 16v4" stroke-linecap="round" />
				</svg>
			</span>
			<h1 class="text-h1 font-semibold text-white">DisplayPad Configurator</h1>
		</div>
		<div class="flex items-center gap-3">
			<ConnectButton />
			<OverflowMenu>
				<label
					class="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 hover:bg-slate-800"
				>
					<span>Debug logging</span>
					<input type="checkbox" bind:checked={debug.enabled} />
				</label>
				<label
					class="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 hover:bg-slate-800"
				>
					<span>Apply all on (re)connect</span>
					<input type="checkbox" bind:checked={connection.autoApplyOnConnect} />
				</label>
				<div class="my-1 border-t border-line"></div>
				<a
					href="https://github.com/justb81/mountain-displaypad-pwa#readme"
					target="_blank"
					rel="noreferrer"
					class="rounded-control px-2 py-1.5 hover:bg-slate-800"
				>
					Help &amp; documentation
				</a>
			</OverflowMenu>
		</div>
	</header>

	<ProfileTools />

	<main class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
		<div class="flex flex-col gap-4">
			<PadGrid {selected} onselect={(i) => (selected = i)} />

			<div class="flex flex-wrap items-center justify-between gap-3">
				<Button
					variant="primary"
					onclick={() => void applyAll()}
					disabled={connection.status !== 'connected'}
				>
					Apply all to pad
				</Button>
				<button
					type="button"
					onclick={() => (confirmResetAll = true)}
					class="text-caption text-slate-500 underline decoration-slate-700 underline-offset-2 transition hover:text-danger"
				>
					Reset all keys…
				</button>
			</div>

			<TemplateStash {selected} />
		</div>

		<KeyInspector index={selected} onmove={(i) => (selected = i)} />
	</main>
</div>
