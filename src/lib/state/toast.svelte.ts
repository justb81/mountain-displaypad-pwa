/** Transient, app-wide success/error/info notifications — never persisted. */

import { browser } from '$app/environment';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
	id: number;
	kind: ToastKind;
	text: string;
	/** A persistent toast stays until dismissed by hand (used for actionable errors like a full quota). */
	persistent?: boolean;
	/** De-dupe tag: pushing another toast with the same key replaces its text instead of stacking a copy. */
	dedupeKey?: string;
}

/** Extra push options. `persistent` disables auto-dismiss; `dedupeKey` collapses repeats onto one toast. */
export interface ToastOptions {
	persistent?: boolean;
	dedupeKey?: string;
}

const AUTO_DISMISS_MS = 4000;

class ToastStore {
	items = $state<ToastMessage[]>([]);
	#nextId = 1;

	push(text: string, kind: ToastKind = 'info', options: ToastOptions = {}): number {
		const { persistent = false, dedupeKey } = options;

		// Collapse a repeat onto the existing toast rather than stacking identical copies
		// (a full quota fires persist() on every edit — one visible message is enough).
		if (dedupeKey) {
			const existing = this.items.find((item) => item.dedupeKey === dedupeKey);
			if (existing) {
				existing.text = text;
				existing.kind = kind;
				return existing.id;
			}
		}

		const id = this.#nextId++;
		this.items.push({ id, kind, text, persistent, dedupeKey });
		if (browser && !persistent) setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
		return id;
	}

	success(text: string): void {
		this.push(text, 'success');
	}

	error(text: string): void {
		this.push(text, 'error');
	}

	info(text: string): void {
		this.push(text, 'info');
	}

	dismiss(id: number): void {
		this.items = this.items.filter((item) => item.id !== id);
	}

	/** Remove any toast tagged with `dedupeKey` (e.g. clear a "storage full" warning once a save lands). */
	dismissByKey(dedupeKey: string): void {
		this.items = this.items.filter((item) => item.dedupeKey !== dedupeKey);
	}
}

/** App-wide toast singleton. */
export const toast = new ToastStore();
