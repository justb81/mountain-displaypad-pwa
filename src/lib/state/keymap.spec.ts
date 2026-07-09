import { describe, expect, it } from 'vitest';
import type { KeyConfig } from '$lib/types.js';
import { keymap } from './keymap.svelte.js';

function config(label: string): KeyConfig {
	return { label, face: { type: 'color', color: '#000000' }, action: { type: 'none' } };
}

describe('keymap.swap', () => {
	it('exchanges the two configs by content, leaving other keys untouched', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));
		const before = keymap.keys.map((k) => k.label);

		keymap.swap(2, 5);

		expect(keymap.keys[2].label).toBe(before[5]);
		expect(keymap.keys[5].label).toBe(before[2]);
		keymap.keys.forEach((k, i) => {
			if (i !== 2 && i !== 5) expect(k.label).toBe(before[i]);
		});
	});

	it('is a no-op when swapping a key with itself', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));
		const before = keymap.keys.map((k) => k.label);

		keymap.swap(3, 3);

		expect(keymap.keys.map((k) => k.label)).toEqual(before);
	});
});

describe('keymap.copy', () => {
	it('overwrites the target with a copy of the source, leaving the source unchanged', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));

		keymap.copy(1, 4);

		expect(keymap.keys[4].label).toBe('k1');
		expect(keymap.keys[1].label).toBe('k1');
		expect(keymap.keys[4]).not.toBe(keymap.keys[1]);
	});

	it('is a no-op when copying a key onto itself', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));
		const before = keymap.keys[7];

		keymap.copy(7, 7);

		expect(keymap.keys[7]).toBe(before);
	});
});
