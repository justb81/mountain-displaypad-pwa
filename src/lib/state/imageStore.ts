/**
 * Browser-only IndexedDB layer for the app's bulky, id-referenced payloads:
 * content-addressed image blobs (issue #102 phase 2) and rolling keymap
 * snapshots (phase 3). Kept out of `localStorage` because image data URLs are
 * large and `localStorage` is a synchronous ~5 MB box; IndexedDB is async and
 * origin-wide (GBs).
 *
 * Same layering rule as `device.ts`: nothing here runs at module top level or
 * during SSR — every entry point opens the database lazily and is a no-op /
 * rejects cleanly when IndexedDB is unavailable (SSR, private-mode lockdowns).
 * The pure quota/size helpers live in `storageQuota.ts`.
 */

import { browser } from '$app/environment';

const DB_NAME = 'displaypad-storage';
const DB_VERSION = 1;
const IMAGES_STORE = 'images';
const SNAPSHOTS_STORE = 'snapshots';

/** How long to wait after the last request before running a coalesced garbage collection. */
const GC_DEBOUNCE_MS = 2500;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	// Gate on the API itself (undefined during SSR) rather than `browser`, so the store
	// is reachable both in the browser and under a test harness that supplies a fake IDB.
	// The `browser` import stays for `scheduleGc`; callers only reach here on the client.
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is unavailable in this environment.'));
	}
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(IMAGES_STORE)) db.createObjectStore(IMAGES_STORE);
			if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
				const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id', autoIncrement: true });
				store.createIndex('createdAt', 'createdAt');
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab.'));
	});
	// Don't cache a rejected open — let the next call retry (e.g. after a transient failure).
	dbPromise.catch(() => {
		dbPromise = null;
	});
	return dbPromise;
}

/** Run `work` inside a transaction over `store`, resolving when the transaction commits. */
function withStore(
	storeName: string,
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => void
): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(storeName, mode);
				work(tx.objectStore(storeName));
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			})
	);
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Hex SHA-256 of a string — the content-hash id under which an image is stored, so identical images dedupe. */
export async function hashDataUrl(dataUrl: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store `dataUrl` under its content hash and return that id. Content-addressed, so
 * storing the same bytes twice is a no-op — copies (drag-copy, stash) share one blob.
 * Rejects if IndexedDB is unavailable; the caller decides whether to fall back to
 * inlining the data URL.
 */
export async function putImage(dataUrl: string): Promise<string> {
	const id = await hashDataUrl(dataUrl);
	await openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(IMAGES_STORE, 'readwrite');
				const store = tx.objectStore(IMAGES_STORE);
				const existing = store.get(id);
				existing.onsuccess = () => {
					if (existing.result === undefined) store.put(dataUrl, id);
				};
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			})
	);
	return id;
}

/** Fetch one stored image by id, or `null` if it isn't present (or IDB is unavailable). */
export async function getImage(id: string): Promise<string | null> {
	try {
		const db = await openDb();
		const tx = db.transaction(IMAGES_STORE, 'readonly');
		const value = await promisifyRequest(tx.objectStore(IMAGES_STORE).get(id));
		return typeof value === 'string' ? value : null;
	} catch {
		return null;
	}
}

/** Batch-fetch stored images by id into a `Map` (missing ids simply absent). */
export async function getImages(ids: Iterable<string>): Promise<Map<string, string>> {
	const unique = [...new Set(ids)];
	const out = new Map<string, string>();
	if (unique.length === 0) return out;
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IMAGES_STORE, 'readonly');
			const store = tx.objectStore(IMAGES_STORE);
			for (const id of unique) {
				const request = store.get(id);
				request.onsuccess = () => {
					if (typeof request.result === 'string') out.set(id, request.result);
				};
			}
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} catch {
		// IDB unavailable — return whatever we gathered (possibly nothing).
	}
	return out;
}

/** Every image id currently held in the store. */
export async function allImageIds(): Promise<string[]> {
	try {
		const db = await openDb();
		return await new Promise<string[]>((resolve, reject) => {
			const tx = db.transaction(IMAGES_STORE, 'readonly');
			const request = tx.objectStore(IMAGES_STORE).getAllKeys();
			request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
			request.onerror = () => reject(request.error);
		});
	} catch {
		return [];
	}
}

/** Total byte size of every stored image data URL — the IndexedDB slice of the usage meter. */
export async function totalImageBytes(): Promise<number> {
	try {
		const db = await openDb();
		return await new Promise<number>((resolve, reject) => {
			const tx = db.transaction(IMAGES_STORE, 'readonly');
			const request = tx.objectStore(IMAGES_STORE).getAll();
			request.onsuccess = () => {
				let bytes = 0;
				for (const value of request.result as unknown[]) {
					if (typeof value === 'string') bytes += value.length;
				}
				resolve(bytes);
			};
			request.onerror = () => reject(request.error);
		});
	} catch {
		return 0;
	}
}

// --- Garbage collection ------------------------------------------------------

type RefProvider = () => Iterable<string>;
const refProviders = new Set<RefProvider>();
let gcTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Register a source of currently-referenced image ids (the keymap and the stash each
 * register one). {@link runGc} unions every provider so a blob referenced by *any*
 * live store survives; snapshot-held ids are added by {@link runGc} itself.
 */
export function registerImageRefs(provider: RefProvider): void {
	refProviders.add(provider);
}

/**
 * Delete every stored image not in `referenced`. Returns the number removed. Safe to
 * call with an incomplete root set only via {@link runGc}, which gathers *all* roots.
 */
export async function collectGarbage(referenced: Iterable<string>): Promise<number> {
	const live = new Set(referenced);
	try {
		const db = await openDb();
		return await new Promise<number>((resolve, reject) => {
			const tx = db.transaction(IMAGES_STORE, 'readwrite');
			const store = tx.objectStore(IMAGES_STORE);
			const keysRequest = store.getAllKeys();
			let removed = 0;
			keysRequest.onsuccess = () => {
				for (const key of keysRequest.result as IDBValidKey[]) {
					if (!live.has(String(key))) {
						store.delete(key);
						removed++;
					}
				}
			};
			tx.oncomplete = () => resolve(removed);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} catch {
		return 0;
	}
}

/**
 * Sweep orphaned image blobs: union every registered store's referenced ids with the
 * ids held by all snapshots, then delete the rest. Snapshots count as roots so a
 * restore never lands on a collected image. Returns the number of blobs removed.
 */
export async function runGc(): Promise<number> {
	const referenced = new Set<string>();
	for (const provider of refProviders) {
		try {
			for (const id of provider()) referenced.add(id);
		} catch {
			// A provider that throws must not abort the sweep, but we also must not
			// then delete ids it would have protected — bail rather than over-collect.
			return 0;
		}
	}
	try {
		for (const snapshot of await listSnapshots()) {
			for (const id of snapshot.imageIds) referenced.add(id);
		}
	} catch {
		return 0;
	}
	return collectGarbage(referenced);
}

/** Debounced {@link runGc}; stores call this after load so multiple triggers coalesce into one sweep. */
export function scheduleGc(): void {
	if (!browser) return;
	if (gcTimer !== null) clearTimeout(gcTimer);
	gcTimer = setTimeout(() => {
		gcTimer = null;
		void runGc();
	}, GC_DEBOUNCE_MS);
}

// --- Snapshots ---------------------------------------------------------------

/** Why a snapshot was taken, shown in the restore list. */
export type SnapshotReason = 'auto' | 'pre-import' | 'pre-reset' | 'pre-restore';

/** Snapshot list entry (metadata only — the payload is fetched on restore). */
export interface SnapshotMeta {
	id: number;
	createdAt: number;
	reason: SnapshotReason;
	label: string;
	/** Image ids the snapshot references, so GC keeps those blobs alive. */
	imageIds: string[];
}

/** A full snapshot including its stored keymap payload. */
export interface SnapshotRecord extends SnapshotMeta {
	data: unknown;
}

/** Persist one keymap snapshot. `data` is the same shape `Keymap.persist()` writes. */
export async function putSnapshot(record: {
	createdAt: number;
	reason: SnapshotReason;
	label: string;
	data: unknown;
	imageIds: string[];
}): Promise<void> {
	await openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
				tx.objectStore(SNAPSHOTS_STORE).add(record);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			})
	);
}

/** All snapshots, newest first, without their payloads. */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
	try {
		const db = await openDb();
		const records = await new Promise<SnapshotRecord[]>((resolve, reject) => {
			const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
			const request = tx.objectStore(SNAPSHOTS_STORE).getAll();
			request.onsuccess = () => resolve(request.result as SnapshotRecord[]);
			request.onerror = () => reject(request.error);
		});
		return records
			.map(({ id, createdAt, reason, label, imageIds }) => ({
				id,
				createdAt,
				reason,
				label,
				imageIds: Array.isArray(imageIds) ? imageIds : []
			}))
			.sort((a, b) => b.createdAt - a.createdAt);
	} catch {
		return [];
	}
}

/** Fetch one full snapshot (payload included), or `null` if it's gone. */
export async function getSnapshot(id: number): Promise<SnapshotRecord | null> {
	try {
		const value = await openDb().then(
			(db) =>
				new Promise<SnapshotRecord | undefined>((resolve, reject) => {
					const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
					const request = tx.objectStore(SNAPSHOTS_STORE).get(id);
					request.onsuccess = () => resolve(request.result as SnapshotRecord | undefined);
					request.onerror = () => reject(request.error);
				})
		);
		return value ?? null;
	} catch {
		return null;
	}
}

/** Delete one snapshot by id. */
export async function deleteSnapshot(id: number): Promise<void> {
	try {
		await withStore(SNAPSHOTS_STORE, 'readwrite', (store) => {
			store.delete(id);
		});
	} catch {
		// Best-effort — a failed delete just leaves the row for the next prune.
	}
}

/** Keep only the newest `max` snapshots, dropping the rest. */
export async function pruneSnapshots(max: number): Promise<void> {
	const all = await listSnapshots();
	const doomed = all.slice(max);
	for (const snapshot of doomed) await deleteSnapshot(snapshot.id);
}
