import { describe, expect, it } from 'vitest';
import type { KeyConfig } from '$lib/types.js';
import { keymap } from './keymap.svelte.js';

function config(label: string): KeyConfig {
	return { label, face: { type: 'color', color: '#000000' }, action: { type: 'none' } };
}

function templateConfig(label: string, transform?: string): KeyConfig {
	return {
		label,
		face: { type: 'template', template: '{{x}}', transform },
		action: { type: 'none' }
	};
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

describe('keymap.resetKey', () => {
	it('restores the key to its default label/face/action, leaving other keys untouched', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));
		keymap.update(4, {
			label: 'Custom',
			face: { type: 'color', color: '#ff0000' },
			action: { type: 'open-url', url: 'https://example.com' }
		});
		const before = keymap.keys.map((k) => k.label);

		keymap.resetKey(4);

		expect(keymap.keys[4]).toEqual({
			label: 'Key 5',
			face: { type: 'color', color: '#000000' },
			action: { type: 'none' }
		});
		keymap.keys.forEach((k, i) => {
			if (i !== 4) expect(k.label).toBe(before[i]);
		});
	});
});

describe('keymap.scriptsApproved', () => {
	it('is left approved when an imported profile has no template transforms', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));
		expect(keymap.scriptsApproved).toBe(true);
	});

	it('is left approved when an imported template face has no transform', () => {
		keymap.importAll(keymap.keys.map((_, i) => templateConfig(`k${i}`)));
		expect(keymap.scriptsApproved).toBe(true);
	});

	it('requires opt-in when an imported profile carries a template transform', () => {
		const keys = keymap.keys.map((_, i) => config(`k${i}`));
		keys[3] = templateConfig('k3', 'return { x: 1 };');
		keymap.importAll(keys);
		expect(keymap.scriptsApproved).toBe(false);
	});

	it('flips back to approved once approveScripts is called', () => {
		const keys = keymap.keys.map((_, i) => config(`k${i}`));
		keys[3] = templateConfig('k3', 'return { x: 1 };');
		keymap.importAll(keys);
		expect(keymap.scriptsApproved).toBe(false);

		keymap.approveScripts();
		expect(keymap.scriptsApproved).toBe(true);
	});

	it('resets to approved on reset()', () => {
		const keys = keymap.keys.map((_, i) => config(`k${i}`));
		keys[3] = templateConfig('k3', 'return { x: 1 };');
		keymap.importAll(keys);
		expect(keymap.scriptsApproved).toBe(false);

		keymap.reset();
		expect(keymap.scriptsApproved).toBe(true);
	});
});
