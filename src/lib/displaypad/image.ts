/**
 * Pixel encoding for DisplayPad keys.
 *
 * A key expects a {@link PACKET_SIZE}-byte payload whose leading {@link IMAGE_BYTES}
 * bytes are the 102x102 image in **BGR** order (bottom-standard for these panels),
 * followed by zero padding. These helpers are pure so they can be unit tested;
 * turning a `<canvas>`/`ImageBitmap` into RGBA is the caller's job (browser only).
 */

import { ICON_SIZE, IMAGE_BYTES, PACKET_SIZE, PIXELS_PER_KEY } from './protocol.js';

/** Number of RGBA bytes expected by {@link encodeImage}. */
export const RGBA_BYTES = PIXELS_PER_KEY * 4;

/**
 * Convert a row-major RGBA buffer (as produced by `CanvasRenderingContext2D`
 * or `ImageData.data`) into the BGR packet the device expects.
 *
 * @param rgba Exactly {@link RGBA_BYTES} bytes: {@link ICON_SIZE}x{@link ICON_SIZE} pixels, 4 bytes each.
 */
export function encodeImage(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
	if (rgba.length !== RGBA_BYTES) {
		throw new RangeError(
			`Expected ${RGBA_BYTES} RGBA bytes (${ICON_SIZE}x${ICON_SIZE}), got ${rgba.length}`
		);
	}
	const packet = new Uint8Array(PACKET_SIZE);
	for (let px = 0; px < PIXELS_PER_KEY; px++) {
		const src = px * 4;
		const dst = px * 3;
		packet[dst] = rgba[src + 2]; // B
		packet[dst + 1] = rgba[src + 1]; // G
		packet[dst + 2] = rgba[src]; // R
	}
	return packet;
}

/**
 * Build a packet that fills a whole key with one solid colour.
 *
 * @param r Red 0..255
 * @param g Green 0..255
 * @param b Blue 0..255
 */
export function encodeSolidColor(r: number, g: number, b: number): Uint8Array {
	assertByte(r, 'r');
	assertByte(g, 'g');
	assertByte(b, 'b');
	const packet = new Uint8Array(PACKET_SIZE);
	for (let i = 0; i + 2 < IMAGE_BYTES; i += 3) {
		packet[i] = b;
		packet[i + 1] = g;
		packet[i + 2] = r;
	}
	return packet;
}

/** Parse a `#rrggbb` string into `[r, g, b]`. */
export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!m) throw new TypeError(`Expected an #rrggbb colour, got "${hex}"`);
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function assertByte(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 255) {
		throw new RangeError(`Expected ${name} to be 0..255, got ${value}`);
	}
}
