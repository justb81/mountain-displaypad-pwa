/**
 * Reactive DisplayPad connection lifecycle.
 *
 * Owns the single {@link DisplayPad} handle, mirrors its pressed-key state into
 * runes so the UI can react, and pushes {@link keymap} entries onto the hardware.
 * Browser-only: every method is a no-op or throws off the main thread during SSR.
 */

import { browser } from '$app/environment';
import { DisplayPad, type KeyEventDetail } from '$lib/displaypad/device.js';
import { hexToRgb } from '$lib/displaypad/image.js';
import { rasterize } from '$lib/displaypad/raster.js';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import type { ConnectionStatus } from '$lib/types.js';
import { keymap } from './keymap.svelte.js';

class Connection {
	status = $state<ConnectionStatus>('disconnected');
	error = $state<string | null>(null);
	pressed = $state<boolean[]>(Array(NUM_KEYS).fill(false));

	private pad: DisplayPad | null = null;

	constructor() {
		if (!browser) return;
		if (!DisplayPad.isSupported()) {
			this.status = 'unsupported';
			return;
		}
		void this.reconnect();
	}

	/** Prompt for a pad and open it. Key faces are only pushed on explicit apply. */
	async connect(): Promise<void> {
		if (this.status === 'unsupported') return;
		this.error = null;
		this.status = 'connecting';
		try {
			const pad = await DisplayPad.request();
			if (!pad) {
				this.status = 'disconnected';
				return;
			}
			await this.openAndAttach(pad);
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			this.status = 'error';
		}
	}

	/** Disconnect and reset UI state. */
	async disconnect(): Promise<void> {
		await this.pad?.close();
		this.teardown();
	}

	/** Silently reopen a previously-granted pad on load, without prompting the user. */
	private async reconnect(): Promise<void> {
		this.status = 'connecting';
		try {
			const pad = await DisplayPad.fromGranted();
			if (pad) {
				await this.openAndAttach(pad);
				return;
			}
		} catch {
			// A previously-granted pad is unreachable — fall through to disconnected.
		}
		this.status = 'disconnected';
	}

	private async openAndAttach(pad: DisplayPad): Promise<void> {
		await pad.open();
		this.attach(pad);
		this.status = 'connected';
	}

	/** Push a single key's configured face onto the hardware. */
	async applyKey(index: number): Promise<void> {
		if (!this.pad) return;
		const { face } = keymap.keys[index];
		if (face.type === 'color') {
			this.pad.setKeyColor(index, ...hexToRgb(face.color));
		} else {
			this.pad.setKeyImage(index, await rasterize(face.dataUrl));
		}
	}

	/** Push every key's face onto the hardware. */
	async applyAll(): Promise<void> {
		for (let i = 0; i < NUM_KEYS; i++) await this.applyKey(i);
	}

	private attach(pad: DisplayPad): void {
		this.pad = pad;
		pad.addEventListener('keydown', this.onKey);
		pad.addEventListener('keyup', this.onKey);
		pad.addEventListener('close', this.onClose);
	}

	private onKey = (event: Event): void => {
		const { key } = (event as CustomEvent<KeyEventDetail>).detail;
		const down = event.type === 'keydown';
		this.pressed[key] = down;
		if (down) this.runAction(key);
	};

	private runAction(index: number): void {
		const { action } = keymap.keys[index];
		if (action.type === 'open-url' && action.url) window.open(action.url, '_blank', 'noopener');
		else if (action.type === 'copy-text' && action.text)
			void navigator.clipboard?.writeText(action.text);
	}

	private onClose = (): void => this.teardown();

	private teardown(): void {
		if (this.pad) {
			this.pad.removeEventListener('keydown', this.onKey);
			this.pad.removeEventListener('keyup', this.onKey);
			this.pad.removeEventListener('close', this.onClose);
		}
		this.pad = null;
		this.pressed = Array(NUM_KEYS).fill(false);
		if (this.status !== 'unsupported') this.status = 'disconnected';
	}
}

/** App-wide connection singleton. */
export const connection = new Connection();
