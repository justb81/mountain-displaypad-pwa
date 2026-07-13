import { describe, expect, it } from 'vitest';
import { isValidSecretKey, secrets, substituteSecrets } from './secrets.svelte.js';

describe('substituteSecrets', () => {
	it('replaces a placeholder with its value', () => {
		expect(substituteSecrets('Bearer {{secret.TOKEN}}', { TOKEN: 'abc' })).toBe('Bearer abc');
	});

	it('replaces every occurrence and multiple distinct keys', () => {
		const out = substituteSecrets('{{secret.A}}-{{secret.B}}-{{secret.A}}', { A: '1', B: '2' });
		expect(out).toBe('1-2-1');
	});

	it('tolerates inner whitespace in the placeholder', () => {
		expect(substituteSecrets('{{ secret.KEY }}', { KEY: 'v' })).toBe('v');
	});

	it('resolves an unknown key to the empty string', () => {
		expect(substituteSecrets('x={{secret.MISSING}}', {})).toBe('x=');
	});

	it('inserts the value verbatim, even with regex/JSON-special characters', () => {
		expect(substituteSecrets('{{secret.K}}', { K: '$1 "a" \\ b' })).toBe('$1 "a" \\ b');
	});

	it('leaves text without placeholders unchanged', () => {
		expect(substituteSecrets('no placeholders here', { A: '1' })).toBe('no placeholders here');
	});

	it('ignores a bare Mustache variable (only the secret. namespace substitutes)', () => {
		expect(substituteSecrets('{{TOKEN}}', { TOKEN: 'abc' })).toBe('{{TOKEN}}');
	});
});

describe('isValidSecretKey', () => {
	it('accepts identifier-shaped keys', () => {
		for (const key of ['A', '_x', 'API_KEY', 'token2', 'a_b_c']) {
			expect(isValidSecretKey(key)).toBe(true);
		}
	});

	it('rejects empty, leading-digit, and non-identifier keys', () => {
		for (const key of ['', '1abc', 'a-b', 'a b', 'a.b', 'ä', 'a!']) {
			expect(isValidSecretKey(key)).toBe(false);
		}
	});
});

describe('secrets store', () => {
	it('exposes values as a plain object and resolves placeholders through apply()', () => {
		secrets.replaceAll([
			{ key: 'TOKEN', value: 'sk-123' },
			{ key: 'HOST', value: 'example.com' }
		]);
		expect(secrets.values).toEqual({ TOKEN: 'sk-123', HOST: 'example.com' });
		expect(secrets.has('TOKEN')).toBe(true);
		expect(secrets.keys).toEqual(['TOKEN', 'HOST']);
		expect(secrets.apply('https://{{secret.HOST}}/?t={{secret.TOKEN}}')).toBe(
			'https://example.com/?t=sk-123'
		);
	});

	it('drops blank-key rows and lets a later duplicate win on replaceAll', () => {
		secrets.replaceAll([
			{ key: '  ', value: 'ignored' },
			{ key: 'DUP', value: 'first' },
			{ key: 'DUP', value: 'second' }
		]);
		expect(secrets.values).toEqual({ DUP: 'second' });
	});

	it('trims surrounding whitespace from keys', () => {
		secrets.replaceAll([{ key: '  PADDED  ', value: 'v' }]);
		expect(secrets.values).toEqual({ PADDED: 'v' });
	});
});
