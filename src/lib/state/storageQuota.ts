/**
 * Pure, Node-testable storage-quota helpers shared by the persisting stores and
 * the Profile-tools usage meter (issue #102).
 *
 * Kept free of runes and browser APIs so it can be unit-tested directly; the
 * reactive singleton in `storage.svelte.ts` and the `*.svelte.ts` stores import
 * from here.
 */

/** Stable tag so the "storage full" toast collapses onto one message instead of stacking per failed save. */
export const QUOTA_TOAST_KEY = 'storage-quota';

/** The single, actionable message shown when a save is rejected for want of space. */
export const QUOTA_TOAST_MESSAGE =
	'Storage full — this change was NOT saved. Export a backup and remove unused images or templates.';

/**
 * Whether `err` is the browser's "out of storage space" signal. `localStorage.setItem`
 * throws a `DOMException` named `QuotaExceededError` (code 22) in Chromium/WebKit and
 * `NS_ERROR_DOM_QUOTA_REACHED` (code 1014) in Firefox; IndexedDB rejects with the same
 * `QuotaExceededError`. Matched by name and legacy code so every engine is covered.
 */
export function isQuotaExceeded(err: unknown): boolean {
	if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
		return (
			err.name === 'QuotaExceededError' ||
			err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
			err.code === 22 ||
			err.code === 1014
		);
	}
	if (err && typeof err === 'object') {
		const name = (err as { name?: unknown }).name;
		const code = (err as { code?: unknown }).code;
		return (
			name === 'QuotaExceededError' ||
			name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
			code === 22 ||
			code === 1014
		);
	}
	return false;
}

/** UTF-8 byte length of a string, for measuring what a localStorage value actually costs. */
export function byteLength(value: string): number {
	if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
	// Fallback for the rare environment without TextEncoder: count UTF-8 bytes by code point.
	let bytes = 0;
	for (const ch of value) {
		const cp = ch.codePointAt(0) ?? 0;
		bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
	}
	return bytes;
}

/**
 * Format a byte count as a short, human-readable size (e.g. `14.2 MB`, `~60 GB`).
 * Binary units (1024-based) to match what browsers report from `storage.estimate()`.
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '—';
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	// One decimal below 100, whole numbers above, so figures stay compact but legible.
	const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} ${units[unit]}`;
}
