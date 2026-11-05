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
import { rasterize, rasterizeColor } from '$lib/displaypad/raster.js';
import { fetchTemplateFace } from '$lib/displaypad/template.js';
import {
	BRIGHTNESS_LEVELS,
	NUM_KEYS,
	PRODUCT_IDS,
	VENDOR_ID,
	type BrightnessLevel
} from '$lib/displaypad/protocol.js';
import { isLiveFace, type ConnectionStatus, type KeyAction } from '$lib/types.js';
import { keymap } from './keymap.svelte.js';
import { liveFaceIndices } from './liveFaces.js';
import { secrets } from './secrets.svelte.js';

const AUTO_APPLY_STORAGE_KEY = 'displaypad.autoApplyOnConnect.v1';
const BRIGHTNESS_STORAGE_KEY = 'displaypad.brightness.v1';
const DEFAULT_BRIGHTNESS: BrightnessLevel = 100;

/** Refuse to poll a remote face more often than this, however small `refreshMinutes` is set. */
const MIN_REFRESH_MINUTES = 1;
/** Spread otherwise-identical intervals out a bit so they don't all hit their endpoints at once. */
const REFRESH_JITTER_MS = 2000;
/** Minimum gap between a key's webhook fires, so a stuck/bouncing key can't hammer an endpoint. */
const WEBHOOK_MIN_INTERVAL_MS = 500;

/** How often the standby watchdog samples the wall clock while the page is visible. */
const STANDBY_TICK_MS = 15_000;
/**
 * A gap between wall-clock samples larger than this is read as the machine having
 * been suspended (a frozen event loop). Only judged while the page is VISIBLE (or
 * once, when it becomes visible again): a hidden/minimized tab has its timers
 * heavily throttled — coalesced to roughly once a minute, and deferred further under
 * OS power management — so a large gap there is ordinary throttling, indistinguishable
 * from a real suspend by gap alone. Reopening the pad on those throttled gaps (which
 * tears down the live-face refresh timers) is exactly what stopped a minimized window
 * from updating, so a gap accrued while hidden is never treated as a wake in place.
 */
const STANDBY_THRESHOLD_MS = 90_000;
/** Wait this long before a single reconnect retry, in case USB isn't ready the instant we wake. */
const RESUME_RETRY_MS = 1500;
/**
 * The pad is a composite device (three HID interfaces), so a re-enumeration after
 * a wake fires up to three `connect` events in quick succession. Coalesce them and
 * give the interfaces a moment to all reappear before reopening, so `fromGranted()`
 * sees the whole device rather than a partial one.
 */
const HID_CONNECT_SETTLE_MS = 500;
/** Some browsers report a blocked pop-up by closing it almost immediately rather than returning null. */
const POPUP_CLOSE_CHECK_MS = 300;
const POPUP_BLOCKED_MESSAGE =
	'Pop-up blocked — allow pop-ups for this site so key presses can open links.';

class Connection {
	#status = $state<ConnectionStatus>('disconnected');
	error = $state<string | null>(null);
	pressed = $state<boolean[]>(Array(NUM_KEYS).fill(false));
	/** Per-key error from the most recent remote-face fetch, `null` once it succeeds. */
	liveFaceErrors = $state<(string | null)[]>(Array(NUM_KEYS).fill(null));
	/** Per-key warning when an `open-url` action's `window.open()` was silently swallowed by the popup blocker. */
	popupBlockedErrors = $state<(string | null)[]>(Array(NUM_KEYS).fill(null));
	/** Which face a toggle key (one with `secondFace`) is currently showing: 0 = `face`, 1 = `secondFace`. */
	toggled = $state<boolean[]>(Array(NUM_KEYS).fill(false));

	#autoApplyOnConnect = $state(false);
	#brightness = $state<BrightnessLevel>(DEFAULT_BRIGHTNESS);

	private pad: DisplayPad | null = null;
	private liveTimers = new Map<number, ReturnType<typeof setInterval>>();
	/** Last webhook fire time per key, for the {@link WEBHOOK_MIN_INTERVAL_MS} rate-guard. */
	private lastWebhookAt = new Map<number, number>();
	private standbyTimer: ReturnType<typeof setInterval> | null = null;
	/** Debounce coalescing the composite device's several `connect` events into one resume. */
	private connectSettleTimer: ReturnType<typeof setTimeout> | null = null;
	/** Wall-clock time of the last standby-watchdog tick, for gap detection. */
	private lastTickAt = 0;
	/** Guards {@link handleResume} against overlapping runs from back-to-back ticks. */
	private resuming = false;
	/** Whether a pad has been opened at least once this session (gates the resume retry). */
	private everConnected = false;

	constructor() {
		if (!browser) return;
		if (localStorage.getItem(AUTO_APPLY_STORAGE_KEY) === 'true') this.#autoApplyOnConnect = true;
		const storedBrightnessRaw = localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
		if (storedBrightnessRaw !== null) {
			const storedBrightness = Number(storedBrightnessRaw);
			if ((BRIGHTNESS_LEVELS as readonly number[]).includes(storedBrightness)) {
				this.#brightness = storedBrightness as BrightnessLevel;
			}
		}
		if (!DisplayPad.isSupported()) {
			this.status = 'unsupported';
			return;
		}
		void this.reconnect();
		this.startStandbyWatchdog();
		window.addEventListener('pagehide', () => this.syncBadge('disconnected'));
	}

	/** Connection lifecycle of the pad; setting it keeps the installed app's taskbar/dock badge in sync. */
	get status(): ConnectionStatus {
		return this.#status;
	}

	set status(value: ConnectionStatus) {
		this.#status = value;
		this.syncBadge(value);
	}

	/**
	 * Reflect connection state onto the installed app's icon via the Badging API.
	 * Feature-detected and silent everywhere it isn't supported (Firefox, Safari,
	 * an uninstalled Chromium tab) — badge state is cosmetic and must never surface
	 * as an app error. Scoped to connection state only; error counts (live-face
	 * failures, popup-blocked warnings, pending script approval) are out of scope.
	 */
	private syncBadge(status: ConnectionStatus): void {
		if (!browser || !('setAppBadge' in navigator)) return;
		const call = status === 'connected' ? navigator.setAppBadge() : navigator.clearAppBadge();
		void call.catch(() => {});
	}

	/** Whether every key's face is pushed to the hardware automatically on (re)connect. */
	get autoApplyOnConnect(): boolean {
		return this.#autoApplyOnConnect;
	}

	set autoApplyOnConnect(value: boolean) {
		this.#autoApplyOnConnect = value;
		if (browser) localStorage.setItem(AUTO_APPLY_STORAGE_KEY, String(value));
	}

	/** Last brightness level applied (or chosen while disconnected), persisted across reloads. */
	get brightness(): BrightnessLevel {
		return this.#brightness;
	}

	/** Persist the chosen brightness and push it to the pad if one is connected. */
	async setBrightness(percent: BrightnessLevel): Promise<void> {
		this.#brightness = percent;
		if (browser) localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(percent));
		if (!this.pad) return;
		try {
			await this.pad.setBrightness(percent);
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		}
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
		this.everConnected = true;
		if (this.#autoApplyOnConnect) void this.applyAll();
		for (let i = 0; i < NUM_KEYS; i++) this.syncLiveTimer(i);
	}

	/**
	 * Watch the wall clock for a large gap between samples — the fingerprint of the
	 * machine having been suspended: the event loop freezes, so the interval fires
	 * once (late) and {@link Date.now} shows far more time elapsed than the tick.
	 * On such a gap, treat it as a wake and resync the pad. There is no direct
	 * browser "OS resumed" event, hence this heuristic.
	 *
	 * Judged only while the page is visible — a hidden/minimized tab throttles its
	 * timers, so a large gap there is background throttling, not a suspend, and
	 * reopening the pad on it would tear down the live-face timers and stop a
	 * minimized window from refreshing. The hidden span is instead judged once, when
	 * the tab comes back to visible (see {@link onVisibilityChange}), which still
	 * catches a suspend that happened while minimized without churning throughout.
	 * Runs for the app's whole lifetime, even while disconnected, so a pad dropped
	 * during sleep is reopened.
	 *
	 * The gap heuristic is a fallback: the primary, focus-independent wake signal is
	 * WebHID's own `connect` event ({@link onHidConnect}). When the machine sleeps the
	 * pad usually loses USB power and re-enumerates on wake, and that event fires
	 * whether or not the tab is focused — so the pad is repainted right away instead
	 * of staying dark until the app regains focus.
	 */
	private startStandbyWatchdog(): void {
		this.lastTickAt = Date.now();
		this.standbyTimer = setInterval(() => {
			// Leave lastTickAt frozen while hidden so the throttled gap isn't misread
			// as a wake here; onVisibilityChange judges the whole hidden span on return.
			if (document.hidden) return;
			const now = Date.now();
			const gap = now - this.lastTickAt;
			this.lastTickAt = now;
			if (gap > STANDBY_THRESHOLD_MS) void this.handleResume();
		}, STANDBY_TICK_MS);
		document.addEventListener('visibilitychange', this.onVisibilityChange);
		if (DisplayPad.isSupported()) navigator.hid.addEventListener('connect', this.onHidConnect);
	}

	/**
	 * A DisplayPad HID interface (re)appeared. This is the focus-independent wake
	 * signal: after standby the pad's USB power cycles and its interfaces re-enumerate,
	 * firing this even while the tab is hidden. Coalesce the composite device's several
	 * `connect` events, then resync the pad so it comes back fully painted without
	 * waiting for the app to regain focus. Ignores unrelated HID devices.
	 */
	private onHidConnect = (event: HIDConnectionEvent): void => {
		const { device } = event;
		if (
			device.vendorId !== VENDOR_ID ||
			!(PRODUCT_IDS as readonly number[]).includes(device.productId)
		)
			return;
		if (this.connectSettleTimer) clearTimeout(this.connectSettleTimer);
		this.connectSettleTimer = setTimeout(() => {
			this.connectSettleTimer = null;
			void this.handleResume();
		}, HID_CONNECT_SETTLE_MS);
	};

	/**
	 * On returning to a tab that was hidden long enough for the machine to have
	 * suspended meanwhile, resync once — rather than never (the watchdog stays idle
	 * while hidden) or repeatedly (which would keep breaking the live-face refreshes).
	 * A brief hide stays under {@link STANDBY_THRESHOLD_MS} and is ignored.
	 */
	private onVisibilityChange = (): void => {
		if (document.hidden) return;
		const now = Date.now();
		const gap = now - this.lastTickAt;
		this.lastTickAt = now;
		if (gap > STANDBY_THRESHOLD_MS) void this.handleResume();
		// Below the suspend threshold the pad is still alive, but a live face may have
		// gone stale while the tab's timers were throttled — repaint just those so the
		// keys are fresh the moment the user returns, without a full reopen.
		else if (this.status === 'connected') void this.applyLiveFaces();
	};

	/**
	 * React to a detected wake from standby. Drops any handle that may be stale or
	 * firmware-desynced after sleep, then silently reopens the previously-granted
	 * pad from a clean INIT and repaints every key. A wake leaves the pad's screens
	 * dark, so — unlike a fresh connect, which honours {@link autoApplyOnConnect} —
	 * a resume always pushes the faces back so the pad comes fully alive again
	 * without the user having to focus the app.
	 */
	async handleResume(): Promise<void> {
		if (!browser || this.status === 'unsupported' || this.status === 'connecting') return;
		if (this.resuming) return;
		this.resuming = true;
		try {
			if (this.pad) {
				// Closing releases the HID handles (and their inputreport/disconnect
				// listeners) so the reopen re-runs INIT and doesn't double-subscribe;
				// teardown() then guarantees a clean slate even if close() threw before
				// dispatching its 'close' event. Closing does not clear the pad's
				// screens, so with the toggle off nothing is blanked.
				try {
					await this.pad.close();
				} catch {
					// Handle already gone (e.g. the OS dropped it during sleep) — ignore.
				}
				this.teardown();
			}
			await this.reconnect();
			// USB may not be fully re-enumerated the instant the event loop resumes.
			// If a pad was open earlier this session but the first attempt didn't take,
			// give it a moment and try once more.
			if (this.everConnected && this.status !== 'connected') {
				await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_MS));
				await this.reconnect();
			}
			// Bring the (dark) pad fully back. When autoApplyOnConnect is on,
			// openAndAttach already repainted during reconnect(), so only apply here
			// when it didn't — a wake refreshes regardless of that toggle.
			if (this.status === 'connected' && !this.#autoApplyOnConnect) await this.applyAll();
		} finally {
			this.resuming = false;
		}
	}

	/** Push a single key's configured face onto the hardware (the toggled face, if any). */
	async applyKey(index: number): Promise<void> {
		if (!this.pad) return;
		const config = keymap.keys[index];
		const face = this.toggled[index] && config.secondFace ? config.secondFace : config.face;
		if (face.type === 'color') {
			if (face.text?.text.trim()) {
				this.pad.setKeyImage(index, rasterizeColor(face.color, face.text));
			} else {
				this.pad.setKeyColor(index, ...hexToRgb(face.color));
			}
			return;
		}
		if (face.type === 'image') {
			// A data URL can be transiently empty between load and IndexedDB hydration
			// (issue #102) — skip rather than rasterise a blank source into an error.
			if (face.dataUrl)
				this.pad.setKeyImage(index, await rasterize(face.dataUrl, undefined, face.text));
			return;
		}
		if (face.type === 'template' && face.transform && !keymap.scriptsApproved) {
			this.liveFaceErrors[index] =
				'This key runs a script from an imported profile — approve scripts in Profile tools before it can render.';
			return;
		}
		try {
			const pixels =
				face.type === 'remote'
					? await fetchRemoteFace(face.url, undefined, face.text)
					: await fetchTemplateFace(face, undefined, secrets.values);
			this.pad.setKeyImage(index, pixels);
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
	 * Repaint only the keys whose currently-shown face is live (remote/template) —
	 * the ones that can go stale. Color/image faces never change on their own, so
	 * this avoids a needless full re-push (and network burst) on a cheap resync.
	 */
	private async applyLiveFaces(): Promise<void> {
		for (const i of liveFaceIndices(keymap.keys, this.toggled)) await this.applyKey(i);
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

		// Time the currently-shown face — a toggle key flipped to a live second face
		// refreshes on its own policy, just like a primary live face would.
		const config = keymap.keys[index];
		const face = this.toggled[index] && config.secondFace ? config.secondFace : config.face;
		if (!isLiveFace(face) || !face.refreshMinutes) return;

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
		pad.addEventListener('stale', this.onStale);
	}

	/**
	 * The pad's firmware stopped acking (see {@link DisplayPad}) — typically after a
	 * suspend that left the display dark and desynced. Reopen from a clean INIT and
	 * repaint, focus-independently: because a live-face refresh timer fires this via
	 * its own (throttled) tick, a minimized/hidden window recovers without the app
	 * needing focus, and only on a genuine desync — no churn on a healthy pad.
	 */
	private onStale = (): void => {
		void this.handleResume();
	};

	private onKey = (event: Event): void => {
		const { key } = (event as CustomEvent<KeyEventDetail>).detail;
		const down = event.type === 'keydown';
		this.pressed[key] = down;
		if (down) {
			const config = keymap.keys[key];
			if (config.secondFace) {
				this.toggled[key] = !this.toggled[key];
				void this.applyKey(key);
				// The now-shown face may have a different refresh policy than the other one.
				this.syncLiveTimer(key);
			} else if (isLiveFace(config.face) && config.face.refreshOnPress) {
				void this.applyKey(key);
			}
			this.runAction(key);
		}
	};

	private runAction(index: number): void {
		const { action } = keymap.keys[index];
		if (action.type === 'open-url' && action.url) this.openUrl(index, action.url);
		else if (action.type === 'webhook' && action.url) this.fireWebhook(index, action);
		else if (action.type === 'navigate') {
			if (action.target === 'back') void this.goBack();
			else if (action.target === 'next') void this.goNext();
			else void this.goToPage(action.target);
		}
	}

	/**
	 * Open a key's `open-url` action target and detect a popup-blocker swallowing it.
	 * This fires from the WebHID `keydown` handler (an async `inputreport` event), not
	 * a real DOM click, so it likely lacks "user activation" and can be silently blocked
	 * even while the window is focused. We sever `opener` manually (rather than via the
	 * `noopener` window-feature) so we still get a window reference back to inspect —
	 * passing `noopener` itself makes browsers return `null` unconditionally, which would
	 * make success and blocked indistinguishable.
	 */
	private openUrl(index: number, url: string): void {
		const win = window.open(url, '_blank');
		if (win) win.opener = null;
		if (!win || win.closed) {
			this.popupBlockedErrors[index] = POPUP_BLOCKED_MESSAGE;
			return;
		}
		this.popupBlockedErrors[index] = null;
		setTimeout(() => {
			if (win.closed) this.popupBlockedErrors[index] = POPUP_BLOCKED_MESSAGE;
		}, POPUP_CLOSE_CHECK_MS);
	}

	/** Navigate to `page`, remembering history, and repaint the hardware if connected. */
	async goToPage(page: number): Promise<void> {
		keymap.openPage(page);
		await this.afterNavigate();
	}

	/** Pop one level of page history and repaint the hardware if connected. */
	async goBack(): Promise<void> {
		keymap.back();
		await this.afterNavigate();
	}

	/** Advance to the next page in sequence (wrapping around), remembering history, and repaint the hardware if connected. */
	async goNext(): Promise<void> {
		keymap.next();
		await this.afterNavigate();
	}

	/** Jump straight to `page` without pushing history (e.g. a breadcrumb click) and repaint if connected. */
	async jumpToPage(page: number): Promise<void> {
		keymap.switchPage(page);
		await this.afterNavigate();
	}

	/** Delete `page` (a no-op on the last remaining page) and repaint the now-active page if connected. */
	async deletePage(page: number): Promise<void> {
		keymap.removePage(page);
		await this.afterNavigate();
	}

	/** Re-derive per-key runtime state for the now-active page and push it to the hardware. */
	private async afterNavigate(): Promise<void> {
		this.toggled = Array(NUM_KEYS).fill(false);
		for (let i = 0; i < NUM_KEYS; i++) this.syncLiveTimer(i);
		if (this.pad) await this.applyAll();
	}

	/**
	 * Fire a key's `webhook` action straight from the browser, fire-and-forget.
	 * Rate-guarded per key so a bouncing key can't flood the endpoint; failures are
	 * surfaced via {@link error} rather than thrown (they must not block the key).
	 */
	private fireWebhook(index: number, action: Extract<KeyAction, { type: 'webhook' }>): void {
		const now = Date.now();
		const last = this.lastWebhookAt.get(index);
		if (last !== undefined && now - last < WEBHOOK_MIN_INTERVAL_MS) return;
		this.lastWebhookAt.set(index, now);

		// Resolve `{{secret.KEY}}` references so credentials live in the secrets store,
		// not in the (persisted/exported) action config. Header names are left literal.
		const headers: Record<string, string> = {};
		for (const [name, value] of Object.entries(action.headers ?? {})) {
			headers[name] = secrets.apply(value);
		}
		const init: RequestInit = { method: action.method, headers };
		if (action.method === 'POST' && action.body) {
			const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
			if (!hasContentType) headers['Content-Type'] = 'application/json';
			init.body = secrets.apply(action.body);
		}
		if (action.noCors) init.mode = 'no-cors';

		void fetch(action.url, init)
			.then((res) => {
				// In no-cors mode the response is opaque (status 0) — nothing to check.
				if (!action.noCors && !res.ok)
					this.error = `Webhook (key ${index + 1}) returned HTTP ${res.status}.`;
			})
			.catch((err) => {
				this.error = `Webhook (key ${index + 1}) failed: ${
					err instanceof Error ? err.message : String(err)
				}`;
			});
	}

	private onClose = (): void => this.teardown();

	private teardown(): void {
		if (this.pad) {
			this.pad.removeEventListener('keydown', this.onKey);
			this.pad.removeEventListener('keyup', this.onKey);
			this.pad.removeEventListener('close', this.onClose);
			this.pad.removeEventListener('stale', this.onStale);
		}
		this.pad = null;
		this.pressed = Array(NUM_KEYS).fill(false);
		this.toggled = Array(NUM_KEYS).fill(false);
		for (const id of this.liveTimers.values()) clearInterval(id);
		this.liveTimers.clear();
		if (this.status !== 'unsupported') this.status = 'disconnected';
	}
}

/** App-wide connection singleton. */
export const connection = new Connection();
