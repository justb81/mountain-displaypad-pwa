import { describe, expect, it } from 'vitest';
import {
	IMAGE_BYTES,
	PACKET_SIZE,
	REPORT_ID,
	assertValidKey,
	buildReport,
	decodeKeyStates,
	imageAnnounceMessage,
	isKeyStateReport,
	keyToGrid
} from './protocol.js';
import { RGBA_BYTES, encodeImage, encodeSolidColor, hexToRgb } from './image.js';

/** Build a zeroed 64-byte report with the given first byte. */
function report(firstByte: number): Uint8Array {
	const buf = new Uint8Array(64);
	buf[0] = firstByte;
	return buf;
}

describe('key state decoding', () => {
	it('recognises key-state reports by their report id', () => {
		expect(isKeyStateReport(report(REPORT_ID.KEY_STATE))).toBe(true);
		expect(isKeyStateReport(report(REPORT_ID.INIT_ACK))).toBe(false);
	});

	it('decodes the first key from bit 0x02 of byte 42', () => {
		const r = report(REPORT_ID.KEY_STATE);
		r[42] = 0x02;
		const states = decodeKeyStates(r);
		expect(states[0]).toBe(true);
		expect(states.filter(Boolean)).toHaveLength(1);
	});

	it('decodes the last key from bit 0x10 of byte 47', () => {
		const r = report(REPORT_ID.KEY_STATE);
		r[47] = 0x10;
		expect(decodeKeyStates(r)[11]).toBe(true);
	});

	it('decodes multiple simultaneous presses', () => {
		const r = report(REPORT_ID.KEY_STATE);
		r[42] = 0x80; // key 6
		r[47] = 0x01; // key 7
		const states = decodeKeyStates(r);
		expect(states[6]).toBe(true);
		expect(states[7]).toBe(true);
	});
});

describe('report reconstruction', () => {
	it('prepends a nonzero webhid reportId to the data view', () => {
		const data = new DataView(new Uint8Array([0xaa, 0xbb]).buffer);
		const r = buildReport(REPORT_ID.KEY_STATE, data);
		expect([...r]).toEqual([REPORT_ID.KEY_STATE, 0xaa, 0xbb]);
	});

	it('passes an unnumbered (reportId 0) report through unchanged', () => {
		const data = new DataView(new Uint8Array([REPORT_ID.INIT_ACK, 0x80, 0x00]).buffer);
		const r = buildReport(0, data);
		expect([...r]).toEqual([REPORT_ID.INIT_ACK, 0x80, 0x00]);
	});
});

describe('image announce message', () => {
	it('addresses the target key in byte 5', () => {
		expect(imageAnnounceMessage(3)[5]).toBe(3);
	});

	it('rejects out-of-range keys', () => {
		expect(() => assertValidKey(12)).toThrow(RangeError);
		expect(() => imageAnnounceMessage(-1)).toThrow(RangeError);
	});
});

describe('grid layout', () => {
	it('maps key indices to row/column', () => {
		expect(keyToGrid(0)).toEqual({ row: 0, col: 0 });
		expect(keyToGrid(6)).toEqual({ row: 1, col: 0 });
		expect(keyToGrid(11)).toEqual({ row: 1, col: 5 });
	});
});

describe('pixel encoding', () => {
	it('produces a full-size packet for a solid colour in BGR order', () => {
		const packet = encodeSolidColor(0x11, 0x22, 0x33);
		expect(packet).toHaveLength(PACKET_SIZE);
		expect([packet[0], packet[1], packet[2]]).toEqual([0x33, 0x22, 0x11]);
	});

	it('converts RGBA input to BGR, dropping alpha', () => {
		const rgba = new Uint8ClampedArray(RGBA_BYTES);
		rgba.set([10, 20, 30, 255], 0); // first pixel R=10 G=20 B=30
		const packet = encodeImage(rgba);
		expect([packet[0], packet[1], packet[2]]).toEqual([30, 20, 10]);
		expect(packet.length).toBe(PACKET_SIZE);
		expect(IMAGE_BYTES).toBeLessThan(PACKET_SIZE);
	});

	it('rejects wrongly sized RGBA input', () => {
		expect(() => encodeImage(new Uint8ClampedArray(4))).toThrow(RangeError);
	});

	it('parses #rrggbb colours', () => {
		expect(hexToRgb('#0ea5e9')).toEqual([0x0e, 0xa5, 0xe9]);
	});
});
