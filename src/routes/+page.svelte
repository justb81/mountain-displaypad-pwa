<script lang="ts">
	import ConnectButton from '$lib/components/ConnectButton.svelte';
	import KeyInspector from '$lib/components/KeyInspector.svelte';
	import PadGrid from '$lib/components/PadGrid.svelte';
	import ProfileTools from '$lib/components/ProfileTools.svelte';
	import SecretsDialog from '$lib/components/SecretsDialog.svelte';
	import TemplateStash from '$lib/components/TemplateStash.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import OverflowMenu from '$lib/components/ui/OverflowMenu.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import { browser } from '$app/environment';
	import { connection } from '$lib/state/connection.svelte.js';
	import { debug } from '$lib/state/debug.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';
	import { windowChrome } from '$lib/state/windowChrome.svelte.js';
	import { BRIGHTNESS_LEVELS, type BrightnessLevel } from '$lib/displaypad/protocol.js';
	import pkg from '../../package.json';

	let selected = $state(0);
	let confirmResetAll = $state(false);
	let secretsOpen = $state(false);

	/** How long to wait for a granted pad to (re)connect after the "Apply all" shortcut, before giving up. */
	const APPLY_ALL_SHORTCUT_TIMEOUT_MS = 5000;

	/**
	 * Set while waiting for the "Apply all keys" install shortcut (`?action=apply-all`,
	 * see `static/manifest.webmanifest`) to find a connected pad. The shortcut can't
	 * prompt the WebHID picker itself (no user gesture), so it piggybacks on the
	 * silent `fromGranted()` reconnect the connection store already runs on load.
	 */
	let pendingApplyAllShortcut = $state(false);

	if (browser) {
		const url = new URL(location.href);
		if (url.searchParams.get('action') === 'apply-all') {
			// Strip the param immediately so a reload never re-triggers this.
			url.searchParams.delete('action');
			history.replaceState(null, '', url);
			pendingApplyAllShortcut = true;
			setTimeout(() => {
				if (!pendingApplyAllShortcut) return;
				pendingApplyAllShortcut = false;
				toast.info('Connect your DisplayPad, then use "Apply all to pad" to push your keys.');
			}, APPLY_ALL_SHORTCUT_TIMEOUT_MS);
		}
	}

	$effect(() => {
		if (pendingApplyAllShortcut && connection.status === 'connected') {
			pendingApplyAllShortcut = false;
			void applyAll();
		}
	});

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

<SecretsDialog open={secretsOpen} onclose={() => (secretsOpen = false)} />

<div
	class="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-5 p-4 text-slate-100 sm:p-6"
	style={windowChrome.visible
		? `padding-top: calc(${windowChrome.rect.height}px + 1rem)`
		: undefined}
>
	<header
		class="app-header flex flex-wrap items-center justify-between gap-4
			{windowChrome.visible
				? 'flex-nowrap bg-accent-strong px-3 py-0'
				: 'border-b border-line pb-4'}"
		data-wco={windowChrome.visible}
	>
		<div class="flex min-w-0 items-center gap-3">
			<span
				class="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-accent-strong/20 text-accent-soft {windowChrome.visible
					? 'h-7 w-7 bg-white/15 text-white'
					: ''}"
			>
				<!-- DisplayPad 6×2 key grid — matches static/pwa-icon.svg (the app icon/favicon).
				     fill="currentColor" so it inherits the badge colour in both normal and WCO modes. -->
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5" aria-hidden="true">
					<rect x="2.1" y="8.9" width="2.8" height="2.8" rx="0.6" />
					<rect x="5.5" y="8.9" width="2.8" height="2.8" rx="0.6" />
					<rect x="8.9" y="8.9" width="2.8" height="2.8" rx="0.6" />
					<rect x="12.3" y="8.9" width="2.8" height="2.8" rx="0.6" />
					<rect x="15.7" y="8.9" width="2.8" height="2.8" rx="0.6" />
					<rect x="19.1" y="8.9" width="2.8" height="2.8" rx="0.6" />
					<rect x="2.1" y="12.3" width="2.8" height="2.8" rx="0.6" />
					<rect x="5.5" y="12.3" width="2.8" height="2.8" rx="0.6" />
					<rect x="8.9" y="12.3" width="2.8" height="2.8" rx="0.6" />
					<rect x="12.3" y="12.3" width="2.8" height="2.8" rx="0.6" />
					<rect x="15.7" y="12.3" width="2.8" height="2.8" rx="0.6" />
					<rect x="19.1" y="12.3" width="2.8" height="2.8" rx="0.6" />
				</svg>
			</span>
			<h1
				class="truncate text-h1 font-semibold text-white {windowChrome.visible
					? 'hidden sm:block'
					: ''}"
			>
				DisplayPad Configurator
			</h1>
		</div>
		<div class="app-header-no-drag flex flex-none items-center gap-3">
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
				<button
					type="button"
					onclick={() => (secretsOpen = true)}
					class="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left hover:bg-slate-800"
				>
					<span>Secrets…</span>
					<span aria-hidden="true">🔑</span>
				</button>
				<div class="flex flex-col gap-1.5 rounded-control px-2 py-1.5">
					<span>Brightness</span>
					<SegmentedControl
						name="brightness"
						value={String(connection.brightness)}
						onchange={(v) => void connection.setBrightness(Number(v) as BrightnessLevel)}
						options={BRIGHTNESS_LEVELS.map((level) => ({
							value: String(level),
							label: `${level}%`
						}))}
					/>
				</div>
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

		<KeyInspector
			index={selected}
			onmove={(i) => (selected = i)}
			onopensecrets={() => (secretsOpen = true)}
		/>
	</main>

	<footer class="mt-auto border-t border-line pt-4 text-caption text-slate-500">
		<div class="flex items-center justify-between">
			<span>v{pkg.version}</span>
			<a
				href="https://github.com/justb81/mountain-displaypad-pwa"
				target="_blank"
				rel="noreferrer"
				class="flex items-center gap-2 text-slate-400 transition hover:text-accent-soft"
				title="View on GitHub"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5" aria-hidden="true">
					<path
						d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
					/>
				</svg>
				GitHub
			</a>
		</div>
	</footer>
</div>
