/**
 * Reactive store of named secrets (KEY → VALUE), persisted to localStorage.
 *
 * The point of secrets is to keep credentials *out of the configs that travel*:
 * a webhook header/body or a live-template transform references a secret by name
 * (`{{secret.KEY}}` in text fields, `ctx.secrets.KEY` in a transform) rather than
 * embedding the value, so exporting a Base Camp profile or saving a key to the
 * template stash carries only the reference — never the secret itself.
 *
 * This is *not* encryption. Values live in this browser's `localStorage` in plain
 * text, under a key separate from the keymap ({@link STORAGE_KEY}); they are
 * device-local and never leave the machine on their own. The value is scoping,
 * not confidentiality against someone with access to the browser.
 *
 * `substituteSecrets`/`isValidSecretKey` are pure and Node-testable; only the
 * singleton touches `localStorage` (guarded by `browser`, like the other stores).
 */

import { browser } from '$app/environment';
import { isQuotaExceeded, QUOTA_TOAST_KEY, QUOTA_TOAST_MESSAGE } from '$lib/state/storageQuota.js';
import { toast } from '$lib/state/toast.svelte.js';

const STORAGE_KEY = 'displaypad.secrets.v1';

/** One stored secret. `key` is an identifier; `value` is the sensitive payload. */
export interface SecretEntry {
	key: string;
	value: string;
}

/**
 * A valid secret key: an identifier (letters/digits/underscore, not starting with
 * a digit) so it works unambiguously both as `{{secret.KEY}}` and as a `ctx.secrets`
 * property in a transform.
 */
export function isValidSecretKey(key: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

/** Matches a `{{secret.KEY}}` placeholder (optional inner whitespace), capturing KEY. */
const SECRET_PLACEHOLDER = /\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Replace every `{{secret.KEY}}` in `text` with its value from `values`. An
 * unknown key resolves to the empty string (a deleted/renamed secret drops out
 * rather than leaking a literal placeholder onto the wire). Values are inserted
 * verbatim — the caller owns whether the surrounding text (e.g. a JSON body)
 * stays well-formed.
 */
export function substituteSecrets(text: string, values: Record<string, string>): string {
	return text.replace(SECRET_PLACEHOLDER, (_match, key: string) =>
		Object.prototype.hasOwnProperty.call(values, key) ? values[key] : ''
	);
}

class Secrets {
	entries = $state<SecretEntry[]>([]);

	constructor() {
		if (browser) this.load();
	}

	/** Snapshot of the secrets as a plain `KEY → VALUE` object (blank keys dropped). */
	get values(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const { key, value } of this.entries) if (key) out[key] = value;
		return out;
	}

	/** The defined secret keys, in stored order. */
	get keys(): string[] {
		return this.entries.map((e) => e.key).filter(Boolean);
	}

	/** Whether a secret named `key` is defined. */
	has(key: string): boolean {
		return this.entries.some((e) => e.key === key);
	}

	/** Resolve `{{secret.KEY}}` placeholders in `text` against the current secrets. */
	apply(text: string): string {
		return substituteSecrets(text, this.values);
	}

	/**
	 * Replace the whole set of secrets and persist. Blank rows (no key) are dropped
	 * and later duplicates of a key win; the caller (the dialog) is responsible for
	 * surfacing validation errors before committing.
	 */
	replaceAll(entries: SecretEntry[]): void {
		const byKey: Record<string, string> = Object.create(null);
		const order: string[] = [];
		for (const { key, value } of entries) {
			const trimmed = key.trim();
			if (!trimmed) continue;
			if (!(trimmed in byKey)) order.push(trimmed);
			byKey[trimmed] = value;
		}
		this.entries = order.map((key) => ({ key, value: byKey[key] }));
		this.persist();
	}

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as SecretEntry[];
			if (Array.isArray(parsed)) {
				this.entries = parsed
					.filter((e) => e && typeof e.key === 'string' && typeof e.value === 'string')
					.map((e) => ({ key: e.key, value: e.value }));
			}
		} catch {
			// Corrupt storage — start with no secrets rather than crashing the app.
		}
	}

	private persist(): void {
		if (!browser) return;
		try {
			// Storing secret values as plaintext is intentional and documented (see the file
			// header): device-local scoping, not confidentiality. Encryption is deliberately
			// out of scope here and tracked separately (issue #102), so the clear-text-storage
			// alert on this line is an accepted risk.
			// codeql[js/clear-text-storage-of-sensitive-data]
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
			toast.dismissByKey(QUOTA_TOAST_KEY);
		} catch (err) {
			if (isQuotaExceeded(err)) {
				toast.push(QUOTA_TOAST_MESSAGE, 'error', { persistent: true, dedupeKey: QUOTA_TOAST_KEY });
			}
			// A non-quota storage failure is left to surface elsewhere; secrets stay in memory.
		}
	}
}

/** App-wide secrets singleton. */
export const secrets = new Secrets();
