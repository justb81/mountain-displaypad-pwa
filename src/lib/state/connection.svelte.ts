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
import { fetchRemoteFace } from '$lib/displaypad/liveface.js';
import { rasterize } from '$lib/displaypad/raster.js';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import type { ConnectionStatus } from '$lib/types.js';
import { keymap } from './keymap.svelte.js';

const AUTO_APPLY_STORAGE_KEY = 'displaypad.autoApplyOnConnect.v1';

/** Refuse to poll a remote face more often than this, however small `refreshMinutes` is set. */
const MIN_REFRESH_MINUTES = 1;
/** Spread otherwise-identical intervals out a bit so they don't all hit their endpoints at once. */
const REFRESH_JITTER_MS = 2000;

class Connection {
	status = $state<ConnectionStatus>('disconnected');
	error = $state<string | null>(null);
	pressed = $state<boolean[]>(Array(NUM_KEYS).fill(false));
	/** Per-key error from the most recent remote-face fetch, `null` once it succeeds. */
	liveFaceErrors = $state<(string | null)[]>(Array(NUM_KEYS).fill(null));

	#autoApplyOnConnect = $state(false);

	private pad: DisplayPad | null = null;
	private liveTimers = new Map<number, ReturnType<typeof setInterval>>();

	constructor() {
		if (!browser) return;
		if (localStorage.getItem(AUTO_APPLY_STORAGE_KEY) === 'true') this.#autoApplyOnConnect = true;
		if (!DisplayPad.isSupported()) {
			this.status = 'unsupported';
			return;
		}
		void this.reconnect();
	}

	/** Whether every key's face is pushed to the hardware automatically on (re)connect. */
	get autoApplyOnConnect(): boolean {
		return this.#autoApplyOnConnect;
	}

	set autoApplyOnConnect(value: boolean) {
		this.#autoApplyOnConnect = value;
		if (browser) localStorage.setItem(AUTO_APPLY_STORAGE_KEY, String(value));
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
		if (this.#autoApplyOnConnect) void this.applyAll();
		for (let i = 0; i < NUM_KEYS; i++) this.syncLiveTimer(i);
	}

	/** Push a single key's configured face onto the hardware. */
	async applyKey(index: number): Promise<void> {
		if (!this.pad) return;
		const { face } = keymap.keys[index];
		if (face.type === 'color') {
			this.pad.setKeyColor(index, ...hexToRgb(face.color));
			return;
		}
		if (face.type === 'image') {
			this.pad.setKeyImage(index, await rasterize(face.dataUrl));
			return;
		}
		try {
			this.pad.setKeyImage(index, await fetchRemoteFace(face.url));
			this.liveFaceErrors[index] = null;
		} catch (err) {
			this.liveFaceErrors[index] = err instanceof Error ? err.message : String(err);
		}
	}

	/** Push every key's face onto the hardware. */
	async applyAll(): Promise<void> {
		for (let i = 0; i < NUM_KEYS; i++) await this.applyKey(i);
	}

	/**
	 * Re-derive key `index`'s refresh timer from its current keymap config. Call
	 * after editing a key's face so a changed/removed remote source and refresh
	 * policy take effect immediately; a no-op while disconnected — timers are
	 * only live between {@link openAndAttach} and {@link teardown}.
	 */
	syncLiveTimer(index: number): void {
		this.clearLiveTimer(index);
		if (this.status !== 'connected') return;

		const { face } = keymap.keys[index];
		if (face.type !== 'remote' || !face.refreshMinutes) return;

		const minutes = Math.max(MIN_REFRESH_MINUTES, face.refreshMinutes);
		const delay = minutes * 60_000 + Math.random() * REFRESH_JITTER_MS;
		this.liveTimers.set(
			index,
			setInterval(() => void this.applyKey(index), delay)
		);
	}

	private clearLiveTimer(index: number): void {
		const id = this.liveTimers.get(index);
		if (id !== undefined) clearInterval(id);
		this.liveTimers.delete(index);
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
		if (down) {
			const { face } = keymap.keys[key];
			if (face.type === 'remote' && face.refreshOnPress) void this.applyKey(key);
			this.runAction(key);
		}
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
		for (const id of this.liveTimers.values()) clearInterval(id);
		this.liveTimers.clear();
		if (this.status !== 'unsupported') this.status = 'disconnected';
	}
}

/** App-wide connection singleton. */
export const connection = new Connection();
