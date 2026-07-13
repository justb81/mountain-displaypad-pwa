<script lang="ts">
	import './layout.css';
	import Toast from '$lib/components/ui/Toast.svelte';
	import { browser, dev, version } from '$app/environment';
	import { base } from '$app/paths';
	import { updateStatus } from '$lib/state/update.svelte.js';

	let { children } = $props();

	if (browser) {
		// A distinct value per `vite dev`/`vite build` run — paste this when reporting a
		// bug, so we can tell whether the browser is actually running the build being debugged.
		console.info(`[displaypad] build ${version}`);

		if (dev) {
			// Registration is disabled in dev (see vite.config.ts): a cache-first worker
			// fighting Vite's dev server is exactly how a browser can keep serving a build
			// from hours ago with zero console errors. Shed any worker left over from an
			// earlier production/preview load of this same origin.
			void navigator.serviceWorker
				?.getRegistrations()
				.then((regs) => regs.forEach((r) => void r.unregister()));
		} else if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('./service-worker.js', { type: 'module' });
		}
	}
</script>

<svelte:head><link rel="icon" href="{base}/pwa-icon.svg" /></svelte:head>

{#if updateStatus.available}
	<div
		class="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-4 bg-sky-600 px-4 py-2 text-sm text-white"
	>
		<span>A new version of the DisplayPad Configurator is available.</span>
		<button
			type="button"
			onclick={() => updateStatus.reload()}
			class="rounded bg-white px-3 py-1 font-medium text-sky-700 hover:bg-slate-100"
		>
			Reload
		</button>
	</div>
{/if}

{@render children()}

<Toast />
