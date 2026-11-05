/**
 * Detects when a new service-worker version has installed and is waiting to
 * take over, so the UI can prompt the user to reload instead of silently
 * keeping whatever build was already running in the tab. See the note atop
 * `service-worker.ts` for why the worker doesn't just take over on its own.
 */

import { browser, dev } from '$app/environment';

/** How often to poll for a new service-worker version while the tab stays open. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

class UpdateStatus {
	/** True once a new version has installed and is ready to take over. */
	available = $state(false);

	private registration: ServiceWorkerRegistration | null = null;

	constructor() {
		// Dev mode never registers a worker (see vite.config.ts) — nothing to watch for.
		if (!browser || dev || !('serviceWorker' in navigator)) return;
		void this.init();
	}

	/** Tell the waiting worker to activate; the page reloads once it does. */
	reload(): void {
		this.registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
	}

	private async init(): Promise<void> {
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());

		const registration = await navigator.serviceWorker.ready;
		this.registration = registration;

		if (registration.waiting) this.available = true;

		registration.addEventListener('updatefound', () => {
			const installing = registration.installing;
			installing?.addEventListener('statechange', () => {
				// A freshly-installed worker only means an *update* if something was
				// already controlling this page — otherwise it's just the first visit.
				if (installing.state === 'installed' && navigator.serviceWorker.controller) {
					this.available = true;
				}
			});
		});

		setInterval(() => void registration.update(), CHECK_INTERVAL_MS);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void registration.update();
		});
	}
}

/** App-wide service-worker update-status singleton. */
export const updateStatus = new UpdateStatus();
