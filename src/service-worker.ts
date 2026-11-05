/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// SvelteKit auto-registers this file in production builds. It precaches the app
// shell + static assets for offline use and serves them cache-first, so the
// configurator keeps working without a network connection.
//
// A newly installed worker deliberately does NOT call skipWaiting() itself —
// it sits in the "waiting" state so the already-open page keeps running on the
// version it loaded, until the user opts in via the update banner (driven by
// `$lib/state/update.svelte.ts`), which posts SKIP_WAITING below. Without this,
// an update can silently take over mid-session with no way for the page to
// know its already-executing JS is stale.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `displaypad-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(event.request);
			if (cached) return cached;

			try {
				const response = await fetch(event.request);
				const url = new URL(event.request.url);
				if (response.ok && url.origin === location.origin) {
					cache.put(event.request, response.clone());
				}
				return response;
			} catch (err) {
				const fallback = await cache.match(event.request);
				if (fallback) return fallback;
				throw err;
			}
		})()
	);
});
