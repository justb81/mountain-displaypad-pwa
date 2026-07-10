/**
 * Reactive per-key configuration, persisted to localStorage.
 *
 * This is the single source of truth for what each of the 12 keys should look
 * like and do. It is UI/hardware-agnostic — pushing a config onto a physical
 * pad is the connection store's job.
 *
 * The keymap is a *list of pages* (each a flat 12-`KeyConfig` grid), mirroring
 * Base Camp's folder navigation: an `open-folder` action jumps `activePage` to
 * another page, `back` returns to wherever it was entered from. `keys` always
 * reads/writes the active page, so most of the app can keep treating the
 * keymap as a flat 12-key grid.
 */

import { browser } from '$app/environment';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import type { KeyConfig } from '$lib/types.js';

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
	/** The imported/exported profile's own name, if any — carried through Base Camp round-trips. */
	profileName = $state<string | undefined>(undefined);
	/** The imported/exported profile's own thumbnail, as a data URL — carried through Base Camp round-trips. */
	profileImage = $state<string | undefined>(undefined);

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

	/** Restore the keymap to a single default page and persist. */
	reset(): void {
		this.pages = [defaultPage()];
		this.activePage = 0;
		this.pageHistory = [];
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
		this.pages = pages;
		this.activePage = 0;
		this.pageHistory = [];
		this.profileName = profileName;
		this.profileImage = profileImage;
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
		for (const page of this.pages) {
			for (let i = 0; i < page.length; i++) {
				const action = page[i].action;
				if (action.type !== 'open-folder') continue;
				if (action.page === index) page[i] = { ...page[i], action: { type: 'none' } };
				else if (action.page > index)
					page[i] = { ...page[i], action: { ...action, page: action.page - 1 } };
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
					profileName?: string;
					profileImage?: string;
				};
				if (Array.isArray(parsed.pages) && parsed.pages.every((page) => page.length === NUM_KEYS)) {
					this.pages = parsed.pages;
					this.profileName = parsed.profileName;
					this.profileImage = parsed.profileImage;
				}
				return;
			}

			const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY_V1);
			if (!legacyRaw) return;
			const legacy = JSON.parse(legacyRaw) as
				KeyConfig[] | { keys: KeyConfig[]; profileName?: string; profileImage?: string };
			if (Array.isArray(legacy)) {
				if (legacy.length === NUM_KEYS) this.pages = [legacy];
			} else if (Array.isArray(legacy.keys) && legacy.keys.length === NUM_KEYS) {
				this.pages = [legacy.keys];
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
					profileName: this.profileName,
					profileImage: this.profileImage
				})
			);
		}
	}
}

/** App-wide keymap singleton. */
export const keymap = new Keymap();
