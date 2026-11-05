/**
 * Reactive storage visibility + durability for Profile tools (issue #102 phase 3):
 * a live usage meter (`navigator.storage.estimate()` plus a per-store breakdown), a
 * one-time durability request (`navigator.storage.persist()` so the origin isn't
 * evicted under pressure), and the rolling-snapshot restore list.
 *
 * Browser-only, like the other stores; every method is a no-op / returns empty off
 * the main thread. Pure size/quota formatting lives in `storageQuota.ts`.
 */

import { browser } from '$app/environment';
import * as imageStore from '$lib/state/imageStore.js';
import { keymap } from '$lib/state/keymap.svelte.js';
import { byteLength } from '$lib/state/storageQuota.js';
import { toast } from '$lib/state/toast.svelte.js';

const KEYMAP_KEY = 'displaypad.keymap.v2';
const TEMPLATES_KEY = 'displaypad.templates.v1';
const SECRETS_KEY = 'displaypad.secrets.v1';
/** Set once we've asked the browser to make this origin's storage durable, so we don't re-ask each load. */
const PERSISTENCE_REQUESTED_KEY = 'displaypad.storagePersistRequested.v1';

/** One labelled slice of the storage breakdown shown under the usage meter. */
export interface StorageSlice {
	label: string;
	bytes: number;
}

/** Origin-wide usage/quota as reported by the Storage API. */
export interface StorageEstimate {
	usage: number;
	quota: number;
}

function localBytes(key: string): number {
	if (!browser) return 0;
	const value = localStorage.getItem(key);
	return value ? byteLength(value) : 0;
}

class Storage {
	/** Origin-wide usage/quota, or `null` before the first refresh / where unsupported. */
	estimate = $state<StorageEstimate | null>(null);
	/** Whether the origin's storage has been granted durability, or `null` if unknown/unsupported. */
	persisted = $state<boolean | null>(null);
	/** Per-store byte breakdown, refreshed alongside {@link estimate}. */
	breakdown = $state<StorageSlice[]>([]);
	/** Rolling keymap snapshots, newest first. */
	snapshots = $state<imageStore.SnapshotMeta[]>([]);

	constructor() {
		if (!browser) return;
		void this.requestPersistenceOnce();
		void this.refresh();
	}

	/** Whether the browser exposes the Storage estimate API at all. */
	get supported(): boolean {
		return browser && 'storage' in navigator && 'estimate' in navigator.storage;
	}

	/** Recompute the usage meter, per-store breakdown, durability flag, and snapshot list. */
	async refresh(): Promise<void> {
		if (!browser) return;
		const imageBytes = await imageStore.totalImageBytes();
		this.breakdown = [
			{ label: 'Keymap', bytes: localBytes(KEYMAP_KEY) },
			{ label: 'Template stash', bytes: localBytes(TEMPLATES_KEY) },
			{ label: 'Secrets', bytes: localBytes(SECRETS_KEY) },
			{ label: 'Images (IndexedDB)', bytes: imageBytes }
		];

		if (this.supported) {
			try {
				const { usage = 0, quota = 0 } = await navigator.storage.estimate();
				this.estimate = { usage, quota };
			} catch {
				this.estimate = null;
			}
		}
		if (browser && 'storage' in navigator && 'persisted' in navigator.storage) {
			try {
				this.persisted = await navigator.storage.persisted();
			} catch {
				this.persisted = null;
			}
		}
		this.snapshots = await imageStore.listSnapshots();
	}

	/**
	 * Ask the browser to make this origin's storage durable (exempt from eviction under
	 * pressure) — once per browser, since installed PWAs are usually granted it silently
	 * and re-asking is pointless. Best-effort and silent.
	 */
	private async requestPersistenceOnce(): Promise<void> {
		if (!browser || !('storage' in navigator) || !('persist' in navigator.storage)) return;
		try {
			if (await navigator.storage.persisted()) return;
			if (localStorage.getItem(PERSISTENCE_REQUESTED_KEY) === 'true') return;
			localStorage.setItem(PERSISTENCE_REQUESTED_KEY, 'true');
			await navigator.storage.persist();
		} catch {
			// Durability is a best-effort hint — never surface a failure.
		}
	}

	/** Restore a snapshot into the keymap (a pre-restore snapshot is taken first), then refresh. */
	async restore(id: number): Promise<void> {
		const ok = await keymap.restoreSnapshot(id);
		await this.refresh();
		if (ok) toast.success('Snapshot restored.');
		else toast.error('That snapshot could not be restored.');
	}

	/** Delete a snapshot and refresh the list. */
	async deleteSnapshot(id: number): Promise<void> {
		await imageStore.deleteSnapshot(id);
		await this.refresh();
	}
}

/** App-wide storage-visibility singleton, backing the Profile-tools usage meter and snapshot list. */
export const storage = new Storage();
