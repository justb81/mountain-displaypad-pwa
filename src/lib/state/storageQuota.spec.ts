import { describe, expect, it } from 'vitest';
import { byteLength, formatBytes, isQuotaExceeded } from './storageQuota.js';

describe('isQuotaExceeded', () => {
	it('matches a DOMException named QuotaExceededError', () => {
		expect(isQuotaExceeded(new DOMException('full', 'QuotaExceededError'))).toBe(true);
	});

	it("matches Firefox's NS_ERROR_DOM_QUOTA_REACHED", () => {
		expect(isQuotaExceeded(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
	});

	it('matches a plain error object carrying the legacy quota codes', () => {
		expect(isQuotaExceeded({ name: 'QuotaExceededError' })).toBe(true);
		expect(isQuotaExceeded({ code: 22 })).toBe(true);
		expect(isQuotaExceeded({ code: 1014 })).toBe(true);
	});

	it('does not match unrelated errors', () => {
		expect(isQuotaExceeded(new DOMException('nope', 'AbortError'))).toBe(false);
		expect(isQuotaExceeded(new Error('boom'))).toBe(false);
		expect(isQuotaExceeded(null)).toBe(false);
		expect(isQuotaExceeded('QuotaExceededError')).toBe(false);
	});
});

describe('byteLength', () => {
	it('counts ASCII as one byte each', () => {
		expect(byteLength('hello')).toBe(5);
	});

	it('counts multi-byte UTF-8 code points', () => {
		expect(byteLength('é')).toBe(2);
		expect(byteLength('😀')).toBe(4);
	});
});

describe('formatBytes', () => {
	it('formats bytes, KB, MB, and GB', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1024)).toBe('1 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
		expect(formatBytes(60 * 1024 * 1024 * 1024)).toBe('60 GB');
	});

	it('renders an em dash for a non-finite or negative size', () => {
		expect(formatBytes(NaN)).toBe('—');
		expect(formatBytes(-1)).toBe('—');
	});
});
