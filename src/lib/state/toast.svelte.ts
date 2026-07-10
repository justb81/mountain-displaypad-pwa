/** Transient, app-wide success/error/info notifications — never persisted. */

import { browser } from '$app/environment';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
	id: number;
	kind: ToastKind;
	text: string;
}

const AUTO_DISMISS_MS = 4000;

class ToastStore {
	items = $state<ToastMessage[]>([]);
	#nextId = 1;

	push(text: string, kind: ToastKind = 'info'): void {
		const id = this.#nextId++;
		this.items.push({ id, kind, text });
		if (browser) setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
	}

	success(text: string): void {
		this.push(text, 'success');
	}

	error(text: string): void {
		this.push(text, 'error');
	}

	dismiss(id: number): void {
		this.items = this.items.filter((item) => item.id !== id);
	}
}

/** App-wide toast singleton. */
export const toast = new ToastStore();
