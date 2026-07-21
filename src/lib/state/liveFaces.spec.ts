import { describe, expect, it } from 'vitest';
import { liveFaceIndices } from './liveFaces.js';
import type { KeyConfig, KeyFace } from '$lib/types.js';

const color = (): KeyFace => ({ type: 'color', color: '#000000' });
const image = (): KeyFace => ({ type: 'image', dataUrl: '' });
const remote = (): KeyFace => ({ type: 'remote', url: 'https://example.com/x.png' });
const template = (): KeyFace => ({ type: 'template', template: '<b>hi</b>' });

const key = (face: KeyFace, secondFace?: KeyFace): KeyConfig => ({
	label: '',
	face,
	...(secondFace ? { secondFace } : {}),
	action: { type: 'none' }
});

describe('liveFaceIndices', () => {
	it('returns the indices of remote and template primary faces only', () => {
		const keys = [key(color()), key(remote()), key(template()), key(image())];
		expect(liveFaceIndices(keys, [false, false, false, false])).toEqual([1, 2]);
	});

	it('reads the second face when a toggle key is flipped', () => {
		const keys = [key(color(), remote())]; // static primary, live second
		expect(liveFaceIndices(keys, [false])).toEqual([]); // showing the static primary
		expect(liveFaceIndices(keys, [true])).toEqual([0]); // flipped to the live second
	});

	it('reads the primary face when a toggle key is not flipped, even if the second is live', () => {
		const keys = [key(remote(), color())]; // live primary, static second
		expect(liveFaceIndices(keys, [false])).toEqual([0]);
		expect(liveFaceIndices(keys, [true])).toEqual([]);
	});

	it('falls back to the primary when a key is toggled but has no second face', () => {
		const keys = [key(remote())];
		expect(liveFaceIndices(keys, [true])).toEqual([0]);
	});

	it('returns an empty list for an all-static keymap', () => {
		const keys = [key(color()), key(image())];
		expect(liveFaceIndices(keys, [false, false])).toEqual([]);
	});
});
