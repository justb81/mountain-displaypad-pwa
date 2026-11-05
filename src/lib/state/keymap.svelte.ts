/**
 * Reactive per-key configuration, persisted to localStorage.
 *
 * This is the single source of truth for what each of the 12 keys should look
 * like and do. It is UI/hardware-agnostic — pushing a config onto a physical
 * pad is the connection store's job.
 *
 * The keymap is a *list of pages* (each a flat 12-`KeyConfig` grid), mirroring
 * Base Camp's page navigation: a `navigate` action either jumps `activePage` to
 * another page or returns to wherever it was entered from. `keys` always
 * reads/writes the active page, so most of the app can keep treating the
 * keymap as a flat 12-key grid.
 *
 * Config JSON lives in localStorage (small, fast, human-debuggable); bulky image
 * payloads live in IndexedDB referenced by a content-hash `imageId` (issue #102).
 * Loading is therefore async: `load()` fills the config synchronously with the
 * data URLs still empty, then `hydrate()` fills them from the blob store after the
 * first paint. Exports inline the data URLs back, so an id never leaves the app.
 */

import { browser } from '$app/environment';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import { migratePages, type KeyConfig } from '$lib/types.js';
import {
	configImageIds,
	dehydrateConfig,
	hydrateConfig,
	storedKeymapImageIds
} from '$lib/state/imagePayloads.js';
import * as imageStore from '$lib/state/imageStore.js';
import { isQuotaExceeded, QUOTA_TOAST_KEY, QUOTA_TOAST_MESSAGE } from '$lib/state/storageQuota.js';
import { toast } from '$lib/state/toast.svelte.js';

/** Whether any key on any page carries a `template` face with a (potentially untrusted) transform. */
function pagesContainTransform(pages: KeyConfig[][]): boolean {
	return pages.some((page) =>
		page.some(
			(key) =>
				(key.face.type === 'template' && !!key.face.transform) ||
				(key.secondFace?.type === 'template' && !!key.secondFace.transform)
		)
	);
}

const STORAGE_KEY = 'displaypad.keymap.v2';
/** Pre-multi-page save shape, migrated on load and never written again. */
const LEGACY_STORAGE_KEY_V1 = 'displaypad.keymap.v1';
/** Timestamp of the last auto snapshot, so hourly rolling snapshots survive reloads. */
const LAST_AUTO_SNAPSHOT_KEY = 'displaypad.snapshot.lastAutoAt.v1';

/** Keep at most this many rolling keymap snapshots in IndexedDB. */
const SNAPSHOT_MAX = 10;
/** Auto-snapshot at most this often while editing (plus always before an import/reset/restore). */
const AUTO_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

/** The stored (localStorage) keymap shape: faces reference images by `imageId`, profile image likewise. */
interface StoredKeymap {
	pages: KeyConfig[][];
	pageNames: (string | undefined)[];
	profileName?: string;
	/** Content-hash pointer to the profile thumbnail in the blob store. */
	profileImageId?: string;
	/** Legacy inline profile thumbnail, migrated to {@link profileImageId} on next save. */
	profileImage?: string;
	scriptsApproved: boolean;
}

function defaultKey(index: number): KeyConfig {
	return {
		label: `Key ${index + 1}`,
		face: { type: 'color', color: '#000000' },
		action: { type: 'none' }
	};
}

function defaultPage(): KeyConfig[] {
	return Array.from({ length: NUM_KEYS }, (_, i) => defaultKey(i));
}

class Keymap {
	pages = $state<KeyConfig[][]>([defaultPage()]);
	/** Which page is currently edited/shown on the hardware. */
	activePage = $state(0);
	/** Pages to pop back through on `back()` — runtime navigation, never persisted. */
	pageHistory = $state<number[]>([]);
	/** User-given name per page, parallel to `pages`; empty/missing falls back to a default label. */
	pageNames = $state<(string | undefined)[]>([]);
	/** The imported/exported profile's own name, if any — carried through Base Camp round-trips. */
	profileName = $state<string | undefined>(undefined);
	/** The imported/exported profile's own thumbnail, as a data URL — carried through Base Camp round-trips. */
	profileImage = $state<string | undefined>(undefined);
	/**
	 * False right after importing a profile whose pages contain a `template` face
	 * with a transform — a `template` face's `transform` is executable JS, so an
	 * imported one must not run silently. `connection.applyKey` refuses to run
	 * those transforms until {@link approveScripts} flips this back to true.
	 * Keys authored locally via {@link update}/KeyInspector never touch this flag.
	 */
	scriptsApproved = $state(true);

	/** Serialises overlapping saves so IndexedDB writes and the localStorage write don't race. */
	private persistChain: Promise<void> = Promise.resolve();

	constructor() {
		if (!browser) return;
		this.load();
		imageStore.registerImageRefs(() => storedKeymapImageIds(localStorage.getItem(STORAGE_KEY)));
		void this.hydrate();
	}

	/** The active page's 12 keys. */
	get keys(): KeyConfig[] {
		return this.pages[this.activePage] ?? defaultPage();
	}

	set keys(value: KeyConfig[]) {
		this.pages[this.activePage] = value;
	}

	get pageCount(): number {
		return this.pages.length;
	}

	/** The display name for `page` — its custom name if set, otherwise a positional default. */
	pageName(page: number): string {
		const custom = this.pageNames[page]?.trim();
		if (custom) return custom;
		return page === 0 ? 'Home' : `Page ${page + 1}`;
	}

	/** Set page `index`'s custom name (blank clears it back to the positional default) and persist. */
	setPageName(index: number, name: string): void {
		this.pageNames[index] = name.trim() || undefined;
		this.persist();
	}

	/** Merge a partial update into one key (on the active page) and persist. */
	update(index: number, patch: Partial<KeyConfig>): void {
		this.keys[index] = { ...this.keys[index], ...patch };
		this.persist();
	}

	/** Swap two keys' configs in place (contents, not array identity) and persist. */
	swap(a: number, b: number): void {
		if (a === b) return;
		[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
		this.persist();
	}

	/** Copy one key's config onto another slot, overwriting it, and persist. */
	copy(from: number, to: number): void {
		if (from === to) return;
		this.keys[to] = { ...this.keys[from] };
		this.persist();
	}

	/** Restore one key (on the active page) to its default label/face/action and persist. */
	resetKey(index: number): void {
		this.keys[index] = defaultKey(index);
		this.persist();
	}

	/** Restore the keymap to a single default page and persist. */
	reset(): void {
		this.captureSnapshot('pre-reset');
		this.pages = [defaultPage()];
		this.activePage = 0;
		this.pageHistory = [];
		this.pageNames = [];
		this.scriptsApproved = true;
		this.persist();
	}

	/** Replace the keymap with a single imported page (e.g. a flat template) and persist. */
	importAll(keys: KeyConfig[], profileName?: string, profileImage?: string): void {
		this.importPages([keys], profileName, profileImage);
	}

	/** Replace the whole keymap with an imported multi-page profile and persist. */
	importPages(pages: KeyConfig[][], profileName?: string, profileImage?: string): void {
		if (pages.length === 0 || pages.some((page) => page.length !== NUM_KEYS)) {
			throw new RangeError(`Each page must have ${NUM_KEYS} keys.`);
		}
		this.captureSnapshot('pre-import');
		this.pages = migratePages(pages);
		this.activePage = 0;
		this.pageHistory = [];
		this.pageNames = [];
		this.profileName = profileName;
		this.profileImage = profileImage;
		this.scriptsApproved = !pagesContainTransform(pages);
		this.persist();
	}

	/** Explicitly allow running the `transform`s an imported profile brought in. */
	approveScripts(): void {
		this.scriptsApproved = true;
		this.persist();
	}

	/**
	 * Withhold approval for imported executable `transform`s until the user opts in
	 * via {@link approveScripts}. Called when an imported template stash carries a
	 * `template` face with a transform (the stash's equivalent of {@link importPages}'
	 * safety gate) so untrusted JS never runs on apply without a deliberate approval.
	 */
	requireScriptApproval(): void {
		this.scriptsApproved = false;
		this.persist();
	}

	/** Append a new blank page and persist. Returns its index. */
	addPage(): number {
		this.pages.push(defaultPage());
		this.persist();
		return this.pages.length - 1;
	}

	/** Remove page `index` (a no-op if it's the last remaining page) and persist. */
	removePage(index: number): void {
		if (this.pages.length <= 1 || index < 0 || index >= this.pages.length) return;
		this.pages.splice(index, 1);
		this.pageNames.splice(index, 1);
		for (const page of this.pages) {
			for (let i = 0; i < page.length; i++) {
				const action = page[i].action;
				if (action.type !== 'navigate' || action.target === 'back' || action.target === 'next')
					continue;
				if (action.target === index) page[i] = { ...page[i], action: { type: 'none' } };
				else if (action.target > index)
					page[i] = { ...page[i], action: { ...action, target: action.target - 1 } };
			}
		}
		if (this.activePage >= this.pages.length) this.activePage = this.pages.length - 1;
		else if (this.activePage > index) this.activePage -= 1;
		this.pageHistory = this.pageHistory
			.filter((page) => page !== index)
			.map((page) => (page > index ? page - 1 : page));
		this.persist();
	}

	/** Navigate to `page`, remembering the current page so {@link back} can return to it. */
	openPage(page: number): void {
		if (page < 0 || page >= this.pages.length || page === this.activePage) return;
		this.pageHistory.push(this.activePage);
		this.activePage = page;
	}

	/** Pop one level of navigation history, or go to the root page if there is none. */
	back(): void {
		this.activePage = this.pageHistory.pop() ?? 0;
	}

	/** Advance to the next page in sequence, wrapping around after the last, remembering history so {@link back} can return. */
	next(): void {
		this.openPage((this.activePage + 1) % this.pages.length);
	}

	/** Jump straight to `page` without pushing navigation history (e.g. a breadcrumb click). */
	switchPage(page: number): void {
		if (page < 0 || page >= this.pages.length) return;
		this.activePage = page;
		this.pageHistory = [];
	}

	/** Update the profile's own name and persist. */
	setProfileName(name: string): void {
		this.profileName = name.trim() || undefined;
		this.persist();
	}

	// --- Snapshots (issue #102 phase 3) --------------------------------------

	/**
	 * Restore a previously-captured snapshot by id. A `pre-restore` snapshot of the
	 * *current* state is taken first, so a bad restore is itself undoable. Returns
	 * whether the snapshot was found and applied.
	 */
	async restoreSnapshot(id: number): Promise<boolean> {
		if (!browser) return false;
		this.captureSnapshot('pre-restore');
		const record = await imageStore.getSnapshot(id);
		if (!record || !record.data || typeof record.data !== 'object') return false;
		this.applyStored(record.data as StoredKeymap);
		await this.hydrate();
		this.persist();
		return true;
	}

	/**
	 * Capture the current keymap as a rolling snapshot in IndexedDB, dehydrating its
	 * images to shared blobs. Fire-and-forget and best-effort: the plain state is
	 * snapshotted synchronously (so callers can snapshot *before* mutating), the IDB
	 * write is queued. `auto` snapshots are throttled to {@link AUTO_SNAPSHOT_INTERVAL_MS}.
	 */
	captureSnapshot(reason: imageStore.SnapshotReason): void {
		if (!browser) return;
		if (reason === 'auto') {
			const last = Number(localStorage.getItem(LAST_AUTO_SNAPSHOT_KEY) ?? 0);
			if (Date.now() - last < AUTO_SNAPSHOT_INTERVAL_MS) return;
			localStorage.setItem(LAST_AUTO_SNAPSHOT_KEY, String(Date.now()));
		}
		const plain = $state.snapshot({
			pages: this.pages,
			pageNames: this.pageNames,
			profileName: this.profileName,
			profileImage: this.profileImage,
			scriptsApproved: this.scriptsApproved
		}) as {
			pages: KeyConfig[][];
			pageNames: (string | undefined)[];
			profileName?: string;
			profileImage?: string;
			scriptsApproved: boolean;
		};
		const createdAt = Date.now();
		const label = `${this.profileName ?? 'Keymap'} · ${plain.pages.length} page${plain.pages.length === 1 ? '' : 's'}`;
		this.persistChain = this.persistChain
			.then(async () => {
				const { data, imageIds } = await this.serialize(plain);
				await imageStore.putSnapshot({ createdAt, reason, label, data, imageIds });
				await imageStore.pruneSnapshots(SNAPSHOT_MAX);
			})
			.catch(() => {
				// Snapshots are a safety net, not the primary store — never surface a failure.
			});
	}

	private applyStored(stored: StoredKeymap): void {
		this.pages = migratePages(Array.isArray(stored.pages) ? stored.pages : [defaultPage()]);
		this.activePage = 0;
		this.pageHistory = [];
		this.pageNames = Array.isArray(stored.pageNames) ? stored.pageNames : [];
		this.profileName = stored.profileName;
		this.profileImage = stored.profileImage;
		this.scriptsApproved = stored.scriptsApproved ?? true;
		// Remember the profile image's id so hydrate() can fill it from the blob store.
		this.pendingProfileImageId = stored.profileImageId;
	}

	/** Set between {@link applyStored}/{@link load} and {@link hydrate} to fetch the profile thumbnail. */
	private pendingProfileImageId: string | undefined;

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<StoredKeymap>;
				if (Array.isArray(parsed.pages) && parsed.pages.every((page) => page.length === NUM_KEYS)) {
					this.applyStored({
						pages: parsed.pages,
						pageNames: parsed.pageNames ?? [],
						profileName: parsed.profileName,
						profileImageId: parsed.profileImageId,
						profileImage: parsed.profileImage,
						scriptsApproved: parsed.scriptsApproved ?? true
					});
				}
				return;
			}

			const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY_V1);
			if (!legacyRaw) return;
			const legacy = JSON.parse(legacyRaw) as
				KeyConfig[] | { keys: KeyConfig[]; profileName?: string; profileImage?: string };
			if (Array.isArray(legacy)) {
				if (legacy.length === NUM_KEYS) this.pages = migratePages([legacy]);
			} else if (Array.isArray(legacy.keys) && legacy.keys.length === NUM_KEYS) {
				this.pages = migratePages([legacy.keys]);
				this.profileName = legacy.profileName;
				this.profileImage = legacy.profileImage;
			}
		} catch {
			// Corrupt storage — fall back to defaults rather than crashing the app.
		}
	}

	/**
	 * Fill image data URLs from the blob store after the synchronous {@link load}. Faces
	 * loaded as `imageId` pointers get their `dataUrl` filled in; legacy inline data URLs
	 * are left as-is and migrated to the blob store by the follow-up {@link persist}.
	 * Runs once on startup; a no-op off the browser.
	 */
	private async hydrate(): Promise<void> {
		if (!browser) return;
		// Gather the ids from the *in-memory* pages (not localStorage) so this also serves
		// the restore path, where the pages come from a snapshot rather than the live store.
		const ids: string[] = [];
		let legacyInline = false;
		for (const page of this.pages)
			for (const key of page) {
				ids.push(...configImageIds(key));
				if (key.face.type === 'image' && key.face.dataUrl && !key.face.imageId) legacyInline = true;
				if (key.secondFace?.type === 'image' && key.secondFace.dataUrl && !key.secondFace.imageId)
					legacyInline = true;
			}

		const images = await imageStore.getImages([
			...ids,
			...(this.pendingProfileImageId ? [this.pendingProfileImageId] : [])
		]);
		this.pages = this.pages.map((page) => page.map((config) => hydrateConfig(config, images)));
		if (this.pendingProfileImageId) {
			this.profileImage = images.get(this.pendingProfileImageId) ?? undefined;
			this.pendingProfileImageId = undefined;
		}

		// Rewrite legacy inline data URLs into the blob store, then sweep orphans.
		if (legacyInline) this.persist();
		imageStore.scheduleGc();
	}

	/** Build the stored keymap object (images dehydrated to blobs) and the ids it references. */
	private async serialize(plain: {
		pages: KeyConfig[][];
		pageNames: (string | undefined)[];
		profileName?: string;
		profileImage?: string;
		scriptsApproved: boolean;
	}): Promise<{ data: StoredKeymap; imageIds: string[] }> {
		const pages = await Promise.all(
			plain.pages.map((page) =>
				Promise.all(page.map((c) => dehydrateConfig(c, imageStore.putImage)))
			)
		);
		let profileImageId: string | undefined;
		let profileImage: string | undefined;
		if (plain.profileImage) {
			try {
				profileImageId = await imageStore.putImage(plain.profileImage);
			} catch {
				profileImage = plain.profileImage; // IDB unavailable — keep it inline.
			}
		}
		const data: StoredKeymap = {
			pages,
			pageNames: plain.pageNames,
			profileName: plain.profileName,
			profileImageId,
			profileImage,
			scriptsApproved: plain.scriptsApproved
		};
		const imageIds = storedKeymapImageIds(JSON.stringify(data));
		return { data, imageIds };
	}

	/**
	 * Persist the keymap: image payloads to IndexedDB, config JSON (with `imageId`
	 * pointers) to localStorage. Async and serialised, but callers keep firing it
	 * synchronously — a `QuotaExceededError` surfaces as a persistent, actionable toast
	 * rather than an exception thrown mid-edit, so rune state and storage never diverge
	 * silently.
	 */
	persist(): void {
		if (!browser) return;
		const plain = $state.snapshot({
			pages: this.pages,
			pageNames: this.pageNames,
			profileName: this.profileName,
			profileImage: this.profileImage,
			scriptsApproved: this.scriptsApproved
		}) as {
			pages: KeyConfig[][];
			pageNames: (string | undefined)[];
			profileName?: string;
			profileImage?: string;
			scriptsApproved: boolean;
		};
		this.persistChain = this.persistChain
			.then(async () => {
				const { data } = await this.serialize(plain);
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
					toast.dismissByKey(QUOTA_TOAST_KEY);
				} catch (err) {
					if (isQuotaExceeded(err)) {
						toast.push(QUOTA_TOAST_MESSAGE, 'error', {
							persistent: true,
							dedupeKey: QUOTA_TOAST_KEY
						});
					} else {
						throw err;
					}
				}
			})
			.catch(() => {
				// A non-quota failure (serialisation, IDB) must not wedge the persist chain.
			});
		this.captureSnapshot('auto');
	}
}

/** App-wide keymap singleton. */
export const keymap = new Keymap();
