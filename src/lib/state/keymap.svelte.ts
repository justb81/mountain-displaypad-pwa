/**
 * Reactive per-key configuration, persisted to localStorage.
 *
 * This is the single source of truth for what each of the 12 keys should look
 * like and do. It is UI/hardware-agnostic — pushing a config onto a physical
 * pad is the connection store's job.
 */

import { browser } from '$app/environment';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import type { KeyConfig } from '$lib/types.js';

const STORAGE_KEY = 'displaypad.keymap.v1';

function defaultKey(index: number): KeyConfig {
	return {
		label: `Key ${index + 1}`,
		face: { type: 'color', color: '#000000' },
		action: { type: 'none' }
	};
}

function defaults(): KeyConfig[] {
	return Array.from({ length: NUM_KEYS }, (_, i) => defaultKey(i));
}

class Keymap {
	keys = $state<KeyConfig[]>(defaults());
	/** The imported/exported profile's own name, if any — carried through Base Camp round-trips. */
	profileName = $state<string | undefined>(undefined);
	/** The imported/exported profile's own thumbnail, as a data URL — carried through Base Camp round-trips. */
	profileImage = $state<string | undefined>(undefined);

	constructor() {
		if (browser) this.load();
	}

	/** Merge a partial update into one key and persist. */
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

	/** Restore every key to its default and persist. */
	reset(): void {
		this.keys = defaults();
		this.persist();
	}

	/** Replace every key at once (e.g. from an imported profile) and persist. */
	importAll(keys: KeyConfig[], profileName?: string, profileImage?: string): void {
		if (keys.length !== NUM_KEYS) {
			throw new RangeError(`Expected ${NUM_KEYS} keys, got ${keys.length}.`);
		}
		this.keys = keys;
		this.profileName = profileName;
		this.profileImage = profileImage;
		this.persist();
	}

	/** Update the profile's own name and persist. */
	setProfileName(name: string): void {
		this.profileName = name.trim() || undefined;
		this.persist();
	}

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as
				KeyConfig[] | { keys: KeyConfig[]; profileName?: string; profileImage?: string };
			if (Array.isArray(parsed)) {
				if (parsed.length === NUM_KEYS) this.keys = parsed;
			} else if (Array.isArray(parsed.keys) && parsed.keys.length === NUM_KEYS) {
				this.keys = parsed.keys;
				this.profileName = parsed.profileName;
				this.profileImage = parsed.profileImage;
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
					keys: this.keys,
					profileName: this.profileName,
					profileImage: this.profileImage
				})
			);
		}
	}
}

/** App-wide keymap singleton. */
export const keymap = new Keymap();
