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

describe('keymap.removePage', () => {
	function navigateConfig(label: string, target: number | 'back'): KeyConfig {
		return {
			label,
			face: { type: 'color', color: '#000000' },
			action: { type: 'navigate', target }
		};
	}

	it('drops the page, its name, and shifts later pages down', () => {
		keymap.importPages([
			keymap.keys.map((_, i) => config(`a${i}`)),
			keymap.keys.map((_, i) => config(`b${i}`)),
			keymap.keys.map((_, i) => config(`c${i}`))
		]);
		keymap.setPageName(0, 'First');
		keymap.setPageName(2, 'Third');

		keymap.removePage(1);

		expect(keymap.pageCount).toBe(2);
		expect(keymap.pages[1][0].label).toBe('c0');
		expect(keymap.pageName(0)).toBe('First');
		expect(keymap.pageName(1)).toBe('Third');
	});

	it('is a no-op when only one page remains', () => {
		keymap.importAll(keymap.keys.map((_, i) => config(`k${i}`)));

		keymap.removePage(0);

		expect(keymap.pageCount).toBe(1);
		expect(keymap.keys[0].label).toBe('k0');
	});

	it('clears page links to the removed page and re-targets links to shifted pages', () => {
		const linkPage = keymap.keys.map((_, i) => config(`l${i}`));
		linkPage[0] = navigateConfig('to-1', 1);
		linkPage[1] = navigateConfig('to-2', 2);
		keymap.importPages([
			linkPage,
			keymap.keys.map((_, i) => config(`b${i}`)),
			keymap.keys.map((_, i) => config(`c${i}`))
		]);

		keymap.removePage(1);

		expect(keymap.pages[0][0].action).toEqual({ type: 'none' });
		expect(keymap.pages[0][1].action).toEqual({ type: 'navigate', target: 1 });
	});

	it('leaves a "back" navigate action untouched when a page is removed', () => {
		const linkPage = keymap.keys.map((_, i) => config(`l${i}`));
		linkPage[0] = navigateConfig('back', 'back');
		keymap.importPages([
			linkPage,
			keymap.keys.map((_, i) => config(`b${i}`)),
			keymap.keys.map((_, i) => config(`c${i}`))
		]);

		keymap.removePage(1);

		expect(keymap.pages[0][0].action).toEqual({ type: 'navigate', target: 'back' });
	});

	it('keeps activePage pointing at the same page after an earlier one is removed', () => {
		keymap.importPages([
			keymap.keys.map((_, i) => config(`a${i}`)),
			keymap.keys.map((_, i) => config(`b${i}`)),
			keymap.keys.map((_, i) => config(`c${i}`))
		]);
		keymap.switchPage(2);

		keymap.removePage(0);

		expect(keymap.activePage).toBe(1);
		expect(keymap.keys[0].label).toBe('c0');
	});
});

describe('keymap legacy action migration', () => {
	it('folds legacy open-folder/back/copy-text actions into the current union on import', () => {
		const keys = keymap.keys.map((_, i) => config(`k${i}`));
		// Cast through `unknown`: these shapes are no longer part of the KeyConfig union.
		keys[0] = {
			...keys[0],
			action: { type: 'open-folder', page: 2 } as unknown as KeyConfig['action']
		};
		keys[1] = { ...keys[1], action: { type: 'back' } as unknown as KeyConfig['action'] };
		keys[2] = {
			...keys[2],
			action: { type: 'copy-text', text: 'hi' } as unknown as KeyConfig['action']
		};

		keymap.importAll(keys);

		expect(keymap.keys[0].action).toEqual({ type: 'navigate', target: 2 });
		expect(keymap.keys[1].action).toEqual({ type: 'navigate', target: 'back' });
		expect(keymap.keys[2].action).toEqual({ type: 'none' });
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
