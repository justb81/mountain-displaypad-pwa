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
		face: { type: 'color', color: '#1e293b' },
		action: { type: 'none' }
	};
}

function defaults(): KeyConfig[] {
	return Array.from({ length: NUM_KEYS }, (_, i) => defaultKey(i));
}

class Keymap {
	keys = $state<KeyConfig[]>(defaults());

	constructor() {
		if (browser) this.load();
	}

	/** Merge a partial update into one key and persist. */
	update(index: number, patch: Partial<KeyConfig>): void {
		this.keys[index] = { ...this.keys[index], ...patch };
		this.persist();
	}

	/** Restore every key to its default and persist. */
	reset(): void {
		this.keys = defaults();
		this.persist();
	}

	/** Replace every key at once (e.g. from an imported profile) and persist. */
	importAll(keys: KeyConfig[]): void {
		if (keys.length !== NUM_KEYS) {
			throw new RangeError(`Expected ${NUM_KEYS} keys, got ${keys.length}.`);
		}
		this.keys = keys;
		this.persist();
	}

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as KeyConfig[];
			if (Array.isArray(parsed) && parsed.length === NUM_KEYS) this.keys = parsed;
		} catch {
			// Corrupt storage — fall back to defaults rather than crashing the app.
		}
	}

	private persist(): void {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keys));
	}
}

/** App-wide keymap singleton. */
export const keymap = new Keymap();
