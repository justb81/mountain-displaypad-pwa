/**
 * Low-level protocol constants and pure helpers for the Mountain DisplayPad.
 *
 * The DisplayPad is a 6x2 macro pad whose 12 keys are individually addressable
 * 102x102 pixel displays. It speaks raw USB HID; this module encodes the wire
 * format. All values here are derived from community reverse-engineering work
 * (JeLuF/mountain-displaypad, AnnikenYT/oss-mountain-displaypad) — see CLAUDE.md.
 *
 * Everything in this file is pure and browser-agnostic so it can be unit tested
 * under Node. Anything that touches `navigator.hid` lives in `device.ts`.
 */

/** USB HID vendor id reported by every DisplayPad. */
export const VENDOR_ID = 0x3282;

/** Known USB HID product ids. */
export const PRODUCT_IDS = [0x0009] as const;

/** Valid backlight brightness levels accepted by the firmware (percent). */
export const BRIGHTNESS_LEVELS = [0, 25, 50, 75, 100] as const;

/** One of the discrete brightness levels the firmware accepts. */
export type BrightnessLevel = (typeof BRIGHTNESS_LEVELS)[number];

/** Total number of keys. */
export const NUM_KEYS = 12;

/** Keys per row; the pad is laid out as NUM_KEYS_PER_ROW x NUM_ROWS. */
export const NUM_KEYS_PER_ROW = 6;

/** Number of rows. */
export const NUM_ROWS = NUM_KEYS / NUM_KEYS_PER_ROW;

/** Edge length in pixels of a single key's display (square). */
export const ICON_SIZE = 102;

/** RGB(A)-independent count of pixels per key. */
export const PIXELS_PER_KEY = ICON_SIZE * ICON_SIZE;

/** Number of colour bytes in a key image (BGR, 3 bytes per pixel). */
export const IMAGE_BYTES = PIXELS_PER_KEY * 3;

/** Size of the pixel payload the device expects for one key (image bytes + trailing padding). */
export const PACKET_SIZE = 31438;

/** Size of the image header prefixed to the pixel payload during transfer. */
export const HEADER_SIZE = 306;

/** Chunk size used when streaming pixel data to the display interface. */
export const CHUNK_SIZE = 1024;

/**
 * Control message that (re)initialises the pad before a key image can be sent.
 * Sent to the control interface; the pad answers with a {@link REPORT_ID.INIT_ACK} report.
 */
export const INIT_MESSAGE = hex(
	'00118000000100000000000000000000000000000000000000000000000000000000' +
		'00000000000000000000000000000000000000000000000000000000000000'
);

/**
 * Control message announcing an image transfer for a single key. Byte 5 is
 * overwritten with the target key index before sending (see {@link imageAnnounceMessage}).
 */
export const IMAGE_MESSAGE = hex(
	'0021000000FF3d000065650000000000000000000000000000000000000000000000' +
		'00000000000000000000000000000000000000000000000000000000000000'
);

/**
 * First byte of an inbound report, used to discriminate report types. These
 * correspond to the WebHID `reportId` of an `inputreport` event.
 */
export const REPORT_ID = {
	/** Key press / release state report. */
	KEY_STATE: 0x01,
	/** Acknowledgement of {@link INIT_MESSAGE}. */
	INIT_ACK: 0x11,
	/** Acknowledgement / progress of an image transfer. */
	IMAGE_ACK: 0x21
} as const;

/**
 * Bit position of each key within a KEY_STATE report, expressed against the
 * node-hid style buffer where byte 0 is the report id. Keys are 0-indexed.
 */
const KEY_BITS: ReadonlyArray<{ byte: number; mask: number }> = [
	{ byte: 42, mask: 0x02 }, // key 0
	{ byte: 42, mask: 0x04 }, // key 1
	{ byte: 42, mask: 0x08 }, // key 2
	{ byte: 42, mask: 0x10 }, // key 3
	{ byte: 42, mask: 0x20 }, // key 4
	{ byte: 42, mask: 0x40 }, // key 5
	{ byte: 42, mask: 0x80 }, // key 6
	{ byte: 47, mask: 0x01 }, // key 7
	{ byte: 47, mask: 0x02 }, // key 8
	{ byte: 47, mask: 0x04 }, // key 9
	{ byte: 47, mask: 0x08 }, // key 10
	{ byte: 47, mask: 0x10 } // key 11
];

/** True when `report` is a key-state report. */
export function isKeyStateReport(report: Uint8Array): boolean {
	return report[0] === REPORT_ID.KEY_STATE;
}

/**
 * Decode the pressed state of every key from a KEY_STATE report.
 *
 * @param report The full report buffer, as reconstructed by {@link buildReport}.
 * @returns A boolean per key, `true` = pressed, indexed 0..{@link NUM_KEYS}-1.
 */
export function decodeKeyStates(report: Uint8Array): boolean[] {
	return KEY_BITS.map(({ byte, mask }) => (report[byte] & mask) !== 0);
}

/**
 * Reconstruct the node-hid style report buffer WebHID splits into `reportId`
 * and `data`, so the offsets in {@link KEY_BITS} line up.
 *
 * The control interface uses a single unnumbered report, so WebHID always
 * reports `reportId` 0 and `data` already contains the full report starting
 * with the type byte — nothing was stripped, so nothing gets prepended back.
 * A nonzero `reportId` means WebHID genuinely split a real id byte off, which
 * this restores so downstream offsets (into what would be node-hid's buffer)
 * line up the same way either way.
 */
export function buildReport(reportId: number, data: DataView): Uint8Array {
	const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	if (reportId === 0) return bytes;
	const report = new Uint8Array(data.byteLength + 1);
	report[0] = reportId;
	report.set(bytes, 1);
	return report;
}

/** Copy of {@link IMAGE_MESSAGE} addressed to `keyIndex`. */
export function imageAnnounceMessage(keyIndex: number): Uint8Array {
	assertValidKey(keyIndex);
	const msg = IMAGE_MESSAGE.slice();
	msg[5] = keyIndex;
	return msg;
}

/**
 * Encode a brightness-set command for the control interface. Fire-and-forget —
 * unlike {@link INIT_MESSAGE}/{@link IMAGE_MESSAGE}, the firmware sends no ack
 * for this command.
 */
export function brightnessMessage(percent: BrightnessLevel): Uint8Array {
	assertValidBrightness(percent);
	const msg = new Uint8Array(65);
	msg[1] = 0x12;
	msg[2] = 0x03;
	msg[5] = percent;
	return msg;
}

/** Throws unless `percent` is one of {@link BRIGHTNESS_LEVELS}. */
export function assertValidBrightness(percent: number): asserts percent is BrightnessLevel {
	if (!(BRIGHTNESS_LEVELS as readonly number[]).includes(percent)) {
		throw new RangeError(
			`Expected a brightness level of ${BRIGHTNESS_LEVELS.join('|')}, got ${percent}`
		);
	}
}

/** Grid coordinate (row, column) for a key index. */
export function keyToGrid(keyIndex: number): { row: number; col: number } {
	assertValidKey(keyIndex);
	return { row: Math.floor(keyIndex / NUM_KEYS_PER_ROW), col: keyIndex % NUM_KEYS_PER_ROW };
}

/** Throws unless `keyIndex` is a valid key. */
export function assertValidKey(keyIndex: number): void {
	if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= NUM_KEYS) {
		throw new RangeError(`Expected a key index 0..${NUM_KEYS - 1}, got ${keyIndex}`);
	}
}

/** Parse a hex string into a byte array. */
function hex(s: string): Uint8Array {
	const bytes = new Uint8Array(s.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(s.substr(i * 2, 2), 16);
	}
	return bytes;
}
