/**
 * Browser-only WebHID transport for the Mountain DisplayPad.
 *
 * This wraps one or more {@link HIDDevice} handles (the pad is a composite HID
 * device: an image/"display" interface plus a control interface that also
 * reports key presses) and drives the reverse-engineered transfer protocol.
 *
 * The pure wire format lives in `protocol.ts` / `image.ts`; this file is the
 * only place that touches `navigator.hid`, so it must never be imported during
 * SSR/prerender (the app runs client-only — see `src/routes/+layout.ts`).
 *
 * NOTE: on real hardware, WebHID grants a third, unrelated generic HID interface
 * (consumer-control/keyboard) alongside the two the protocol needs, so
 * {@link DisplayPad.assignRoles} identifies control vs. display by report
 * descriptor size rather than enumeration order — see its doc comment.
 */

import {
	CHUNK_SIZE,
	HEADER_SIZE,
	INIT_MESSAGE,
	NUM_KEYS,
	PRODUCT_IDS,
	REPORT_ID,
	VENDOR_ID,
	assertValidKey,
	brightnessMessage,
	buildReport,
	decodeKeyStates,
	imageAnnounceMessage,
	isKeyStateReport,
	type BrightnessLevel
} from './protocol.js';
import { encodeImage, encodeSolidColor } from './image.js';
import { AckWatchdog } from './ackWatchdog.js';
import { debug } from '$lib/state/debug.svelte.js';

const FILTERS: HIDDeviceFilter[] = PRODUCT_IDS.map((productId) => ({
	vendorId: VENDOR_ID,
	productId
}));

/**
 * How long to wait for the firmware's ack to an announce/pixel transfer before
 * treating the connection as desynced. A healthy pad acks in well under a second,
 * so this is a generous ceiling that avoids false positives on a slow first paint.
 */
const ACK_TIMEOUT_MS = 5000;

/** Wire-protocol tracing, toggled by the debug checkbox in the UI. */
function debugLog(message: string, detail?: unknown): void {
	if (debug.enabled) console.debug(`[displaypad] ${message}`, detail);
}

/** Byte length of the largest item-array in a set of HID reports (0 if none). */
function maxReportBytes(reports: HIDReportInfo[] | undefined): number {
	if (!reports) return 0;
	let max = 0;
	for (const report of reports) {
		for (const item of report.items ?? []) {
			const bytes = ((item.reportSize ?? 0) * (item.reportCount ?? 0)) / 8;
			if (bytes > max) max = bytes;
		}
	}
	return max;
}

/** Largest report of `kind` across all of a device's top-level collections. */
function deviceReportBytes(
	device: HIDDevice,
	kind: 'inputReports' | 'outputReports' | 'featureReports'
): number {
	return Math.max(0, ...device.collections.map((c) => maxReportBytes(c[kind])));
}

/** Flat, copy-paste-friendly summary of a device's HID report descriptor. */
function summarizeDevice(device: HIDDevice): unknown {
	return {
		productId: device.productId,
		collections: device.collections.map((c) => ({
			usagePage: c.usagePage,
			usage: c.usage,
			inputReportBytes: maxReportBytes(c.inputReports),
			outputReportBytes: maxReportBytes(c.outputReports),
			featureReportBytes: maxReportBytes(c.featureReports)
		}))
	};
}

/** Detail payload for `keydown` / `keyup` events. */
export interface KeyEventDetail {
	key: number;
}

interface PendingWrite {
	keyIndex: number;
	packet: Uint8Array;
}

/**
 * A connected DisplayPad. Emits `keydown` / `keyup` ({@link KeyEventDetail}),
 * `close`, and `stale` (the firmware stopped acking — reopen from a clean INIT)
 * events. Construct via {@link DisplayPad.request} or {@link DisplayPad.fromGranted},
 * then `await pad.open()`.
 */
export class DisplayPad extends EventTarget {
	private control: HIDDevice;
	private display: HIDDevice;
	private readonly all: HIDDevice[];

	private initialized = false;
	private queue: PendingWrite[] = [];
	private keyState = new Array<boolean>(NUM_KEYS).fill(false);
	/** Fires a `stale` event when the firmware stops acking (e.g. after a suspend). */
	private readonly ack = new AckWatchdog(ACK_TIMEOUT_MS, () => this.onStale());

	private constructor(devices: HIDDevice[]) {
		super();
		this.all = devices;
		const { control, display } = DisplayPad.assignRoles(devices);
		this.control = control;
		this.display = display;
		devices.forEach((device, index) => {
			debugLog(`device[${index}]`, {
				assignedRole: device === control ? 'control' : device === display ? 'display' : 'unknown',
				...(summarizeDevice(device) as object)
			});
		});
	}

	/** Whether this browser exposes the WebHID API at all. */
	static isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'hid' in navigator;
	}

	/** Prompt the user to pick a DisplayPad. Returns `null` if they cancel. */
	static async request(): Promise<DisplayPad | null> {
		if (!DisplayPad.isSupported()) throw new Error('WebHID is not available in this browser.');
		const devices = await navigator.hid.requestDevice({ filters: FILTERS });
		return devices.length ? new DisplayPad(devices) : null;
	}

	/** Wrap an already-granted pad without prompting, if one is present. */
	static async fromGranted(): Promise<DisplayPad | null> {
		if (!DisplayPad.isSupported()) return null;
		const devices = (await navigator.hid.getDevices()).filter(
			(d) => d.vendorId === VENDOR_ID && (PRODUCT_IDS as readonly number[]).includes(d.productId)
		);
		return devices.length ? new DisplayPad(devices) : null;
	}

	/** Open the underlying HID handles, subscribe to reports and initialise the pad. */
	async open(): Promise<void> {
		for (const device of this.all) {
			if (!device.opened) await device.open();
			device.addEventListener('inputreport', this.onInputReport);
		}
		navigator.hid.addEventListener('disconnect', this.onDisconnect);
		await this.reset();
	}

	/** Close every handle and detach listeners. */
	async close(): Promise<void> {
		this.ack.clear();
		navigator.hid.removeEventListener('disconnect', this.onDisconnect);
		for (const device of this.all) {
			device.removeEventListener('inputreport', this.onInputReport);
			if (device.opened) await device.close();
		}
		this.dispatchEvent(new Event('close'));
	}

	/** Paint a key a solid colour. */
	setKeyColor(keyIndex: number, r: number, g: number, b: number): void {
		assertValidKey(keyIndex);
		this.enqueue(keyIndex, encodeSolidColor(r, g, b));
	}

	/** Paint a key from a row-major RGBA buffer (102x102, 4 bytes per pixel). */
	setKeyImage(keyIndex: number, rgba: Uint8Array | Uint8ClampedArray): void {
		assertValidKey(keyIndex);
		this.enqueue(keyIndex, encodeImage(rgba));
	}

	/** Set the backlight brightness. Fire-and-forget — the firmware sends no ack. */
	async setBrightness(percent: BrightnessLevel): Promise<void> {
		debugLog('setBrightness', { percent });
		await this.sendMessage(this.control, brightnessMessage(percent));
	}

	/** Current pressed/released snapshot, indexed by key. */
	get pressed(): readonly boolean[] {
		return this.keyState;
	}

	// --- protocol driver -----------------------------------------------------

	private enqueue(keyIndex: number, packet: Uint8Array): void {
		this.queue.push({ keyIndex, packet });
		debugLog('enqueue', {
			keyIndex,
			queueLength: this.queue.length,
			initialized: this.initialized
		});
		if (this.initialized && this.queue.length === 1) void this.announceNext();
	}

	private async reset(): Promise<void> {
		this.initialized = false;
		debugLog('reset: sending INIT_MESSAGE', { bytes: INIT_MESSAGE.length - 1 });
		await this.sendMessage(this.control, INIT_MESSAGE);
	}

	private async announceNext(): Promise<void> {
		const next = this.queue[0];
		if (!next) return;
		debugLog('announceNext: sending IMAGE_MESSAGE', { keyIndex: next.keyIndex });
		await this.sendMessage(this.control, imageAnnounceMessage(next.keyIndex));
		// Expect the pad to echo the announce (see onInputReport); if it never does
		// the firmware has desynced (typically after a suspend) — treat it as stale.
		this.ack.arm();
	}

	private async streamPixels(): Promise<void> {
		const next = this.queue[0];
		if (!next) return;
		const payload = new Uint8Array(HEADER_SIZE + next.packet.length);
		payload.set(next.packet, HEADER_SIZE); // header stays zero-filled
		debugLog('streamPixels: starting transfer', {
			keyIndex: next.keyIndex,
			totalBytes: payload.length,
			chunks: Math.ceil(payload.length / CHUNK_SIZE)
		});
		for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
			// Pixel chunks go out under report id 0x00 (the display interface is unnumbered).
			await this.write(this.display, 0x00, payload.subarray(offset, offset + CHUNK_SIZE));
		}
		debugLog('streamPixels: all chunks written', { keyIndex: next.keyIndex });
		// Now await the transfer-complete ack; a silent firmware is caught here too.
		this.ack.arm();
	}

	/**
	 * The firmware stopped acking a pending write — after a suspend it resets and
	 * ignores writes until re-INIT'd, with no error surfacing (sends are
	 * fire-and-forget). Drop our now-meaningless queue/`initialized` state and emit
	 * `stale` so the owner can reopen from a clean INIT. Handles aren't touched here;
	 * that's the reopener's job.
	 */
	private onStale(): void {
		debugLog('onStale: firmware stopped acking, signalling reopen');
		this.initialized = false;
		this.queue = [];
		this.dispatchEvent(new Event('stale'));
	}

	private onDisconnect = (event: HIDConnectionEvent): void => {
		if (this.all.includes(event.device)) this.dispatchEvent(new Event('close'));
	};

	private onInputReport = (event: HIDInputReportEvent): void => {
		const report = buildReport(event.reportId, event.data);

		if (isKeyStateReport(report)) {
			this.applyKeyStates(decodeKeyStates(report));
			return;
		}
		debugLog('onInputReport', {
			deviceProductId: (event.target as HIDDevice)?.productId,
			reportId: event.reportId,
			length: report.length,
			firstBytes: [...report.subarray(0, 8)]
		});
		if (report[0] === REPORT_ID.INIT_ACK) {
			this.ack.clear();
			this.initialized = true;
			if (this.queue.length) void this.announceNext();
			return;
		}
		if (report[0] === REPORT_ID.IMAGE_ACK) {
			// report[1]/report[2] follow the node-hid layout (reportId prepended).
			if (report[1] === 0x00 && report[2] === 0x00) {
				this.ack.clear(); // announce acked
				void this.streamPixels(); // pad echoed the announce; pixels may flow
			} else if (report[1] === 0x00 && report[2] === 0xff) {
				this.ack.clear(); // transfer acked
				this.queue.shift(); // transfer complete
				void this.announceNext();
			}
		}
	};

	private applyKeyStates(states: boolean[]): void {
		states.forEach((down, key) => {
			if (down === this.keyState[key]) return;
			this.keyState[key] = down;
			this.dispatchEvent(
				new CustomEvent<KeyEventDetail>(down ? 'keydown' : 'keyup', { detail: { key } })
			);
		});
	}

	private sendMessage(device: HIDDevice, message: Uint8Array): Promise<void> {
		// node-hid style messages carry the report id in byte 0; WebHID takes it separately.
		return this.write(device, message[0], message.subarray(1));
	}

	private write(device: HIDDevice, reportId: number, data: Uint8Array): Promise<void> {
		// Copy into a fresh ArrayBuffer-backed view so the argument is a valid BufferSource.
		return device.sendReport(reportId, new Uint8Array(data));
	}

	/**
	 * Split the composite device's HID handles into control and display roles.
	 * With a single handle both roles share it. Otherwise the pad exposes an
	 * extra generic consumer-control/keyboard interface alongside the two we
	 * need, so enumeration order isn't reliable — instead the roles are picked
	 * by their actual report descriptor sizes: the display interface is the one
	 * with a {@link CHUNK_SIZE}-or-larger output report (pixel chunks), and the
	 * control interface is the one with small (sub-chunk) input *and* output
	 * reports (it both accepts {@link INIT_MESSAGE}/announce writes and emits
	 * key-state/ack reports back).
	 */
	private static assignRoles(devices: HIDDevice[]): { control: HIDDevice; display: HIDDevice } {
		if (devices.length === 1) return { control: devices[0], display: devices[0] };

		const display = devices.find((d) => deviceReportBytes(d, 'outputReports') >= CHUNK_SIZE);
		const control = devices.find((d) => {
			const input = deviceReportBytes(d, 'inputReports');
			const output = deviceReportBytes(d, 'outputReports');
			return input > 0 && output > 0 && output < CHUNK_SIZE;
		});

		if (!display || !control) {
			throw new Error(
				'Could not identify the DisplayPad control/display interfaces among the granted HID devices.'
			);
		}
		return { control, display };
	}
}
