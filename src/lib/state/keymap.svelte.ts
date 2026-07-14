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
 */

import { browser } from '$app/environment';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import { migratePages, type KeyConfig } from '$lib/types.js';

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

	constructor() {
		if (browser) this.load();
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

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as {
					pages?: KeyConfig[][];
					pageNames?: (string | undefined)[];
					profileName?: string;
					profileImage?: string;
					scriptsApproved?: boolean;
				};
				if (Array.isArray(parsed.pages) && parsed.pages.every((page) => page.length === NUM_KEYS)) {
					this.pages = migratePages(parsed.pages);
					this.pageNames = Array.isArray(parsed.pageNames) ? parsed.pageNames : [];
					this.profileName = parsed.profileName;
					this.profileImage = parsed.profileImage;
					this.scriptsApproved = parsed.scriptsApproved ?? true;
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

	private persist(): void {
		if (browser) {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					pages: this.pages,
					pageNames: this.pageNames,
					profileName: this.profileName,
					profileImage: this.profileImage,
					scriptsApproved: this.scriptsApproved
				})
			);
		}
	}
}

/** App-wide keymap singleton. */
export const keymap = new Keymap();
