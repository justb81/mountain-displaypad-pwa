import { describe, expect, it } from 'vitest';
import { faviconServiceUrl, hostnameFrom } from './favicon.js';

describe('hostnameFrom', () => {
	it('extracts the host from a full URL, dropping path/query/fragment', () => {
		expect(hostnameFrom('https://github.com/justb81/repo?tab=x#y')).toBe('github.com');
	});

	it('assumes https for a scheme-less bare host', () => {
		expect(hostnameFrom('github.com')).toBe('github.com');
		expect(hostnameFrom('sub.example.co.uk/path')).toBe('sub.example.co.uk');
	});

	it('accepts an explicit http URL', () => {
		expect(hostnameFrom('http://example.com')).toBe('example.com');
	});

	it('trims surrounding whitespace', () => {
		expect(hostnameFrom('   https://example.com   ')).toBe('example.com');
	});

	it('returns null for empty or whitespace-only input', () => {
		expect(hostnameFrom('')).toBeNull();
		expect(hostnameFrom('   ')).toBeNull();
	});

	it('rejects non-http(s) schemes', () => {
		expect(hostnameFrom('javascript://alert(1)')).toBeNull();
		expect(hostnameFrom('ftp://example.com')).toBeNull();
		expect(hostnameFrom('data://foo')).toBeNull();
	});
});

describe('faviconServiceUrl', () => {
	it('builds an unavatar.io URL with fallback disabled', () => {
		expect(faviconServiceUrl('https://github.com/x')).toBe(
			'https://unavatar.io/github.com?fallback=false'
		);
	});

	it('works from a bare host', () => {
		expect(faviconServiceUrl('example.com')).toBe('https://unavatar.io/example.com?fallback=false');
	});

	it('returns null when there is no usable host', () => {
		expect(faviconServiceUrl('')).toBeNull();
		expect(faviconServiceUrl('mailto:someone@example.com')).toBeNull();
	});
});
