import { describe, expect, it } from 'vitest';
import type { KeyConfig, KeyFace } from '$lib/types.js';
import {
	configImageIds,
	dehydrateConfig,
	dehydrateFace,
	hydrateConfig,
	hydrateFace,
	inlineConfig,
	inlineFace,
	storedKeymapImageIds,
	storedStashImageIds,
	type PutImage
} from './imagePayloads.js';

/** A content-addressed fake of `imageStore.putImage`: same bytes → same id, recorded for round-tripping. */
function fakeStore() {
	const byId = new Map<string, string>();
	const put: PutImage = async (dataUrl) => {
		const id = `h:${dataUrl}`;
		byId.set(id, dataUrl);
		return id;
	};
	return { put, byId };
}

const imageFace = (dataUrl: string): KeyFace => ({ type: 'image', dataUrl });

describe('dehydrateFace', () => {
	it('replaces an inline data URL with a content-hash id and drops the data URL', async () => {
		const { put } = fakeStore();
		const out = await dehydrateFace(imageFace('data:image/png;base64,AAAA'), put);
		expect(out).toEqual({ type: 'image', dataUrl: '', imageId: 'h:data:image/png;base64,AAAA' });
	});

	it('carries a text label through', async () => {
		const { put } = fakeStore();
		const text = { text: 'Hi', color: '#fff', align: 'center' as const };
		const out = await dehydrateFace({ type: 'image', dataUrl: 'd', text }, put);
		expect(out).toEqual({ type: 'image', dataUrl: '', imageId: 'h:d', text });
	});

	it('keeps an already-dehydrated face (empty data URL, known id) without re-putting', async () => {
		let puts = 0;
		const put: PutImage = async (d) => {
			puts++;
			return `h:${d}`;
		};
		const out = await dehydrateFace({ type: 'image', dataUrl: '', imageId: 'h:x' }, put);
		expect(out).toEqual({ type: 'image', dataUrl: '', imageId: 'h:x' });
		expect(puts).toBe(0);
	});

	it('falls back to inlining the data URL when the store rejects', async () => {
		const put: PutImage = async () => {
			throw new Error('IDB down');
		};
		const out = await dehydrateFace(imageFace('data:keep'), put);
		expect(out).toEqual({ type: 'image', dataUrl: 'data:keep' });
	});

	it('passes non-image faces through untouched', async () => {
		const { put } = fakeStore();
		const face: KeyFace = { type: 'color', color: '#123456' };
		expect(await dehydrateFace(face, put)).toBe(face);
	});
});

describe('hydrateFace', () => {
	it('fills the data URL from the map and drops the id', () => {
		const map = new Map([['h:x', 'data:restored']]);
		expect(hydrateFace({ type: 'image', dataUrl: '', imageId: 'h:x' }, map)).toEqual({
			type: 'image',
			dataUrl: 'data:restored'
		});
	});

	it('leaves the data URL empty when the blob is gone', () => {
		expect(hydrateFace({ type: 'image', dataUrl: '', imageId: 'missing' }, new Map())).toEqual({
			type: 'image',
			dataUrl: ''
		});
	});

	it('passes a legacy inline face (no id) through', () => {
		const face = imageFace('data:legacy');
		expect(hydrateFace(face, new Map())).toBe(face);
	});
});

describe('dehydrate/hydrate round trip', () => {
	it('restores the original config through a content-addressed store', async () => {
		const { put, byId } = fakeStore();
		const config: KeyConfig = {
			label: 'k',
			face: imageFace('data:primary'),
			secondFace: imageFace('data:second'),
			action: { type: 'none' }
		};

		const stored = await dehydrateConfig(config, put);
		expect(stored.face).toEqual({ type: 'image', dataUrl: '', imageId: 'h:data:primary' });

		const hydrated = hydrateConfig(stored, byId);
		expect(hydrated).toEqual(config);
	});

	it('dedupes identical images onto one id', async () => {
		const { put, byId } = fakeStore();
		const config: KeyConfig = {
			label: 'k',
			face: imageFace('data:same'),
			secondFace: imageFace('data:same'),
			action: { type: 'none' }
		};

		const stored = await dehydrateConfig(config, put);
		expect(configImageIds(stored)).toEqual(['h:data:same', 'h:data:same']);
		expect(byId.size).toBe(1);
	});
});

describe('inlineFace / inlineConfig', () => {
	it('strips the persistence-only id, keeping the inline data URL for export', () => {
		expect(inlineFace({ type: 'image', dataUrl: 'data:x', imageId: 'h:x' })).toEqual({
			type: 'image',
			dataUrl: 'data:x'
		});
	});

	it('leaves a face with no id untouched', () => {
		const face = imageFace('data:x');
		expect(inlineFace(face)).toBe(face);
	});

	it('inlines both faces of a config', () => {
		const config: KeyConfig = {
			label: 'k',
			face: { type: 'image', dataUrl: 'a', imageId: 'h:a' },
			secondFace: { type: 'image', dataUrl: 'b', imageId: 'h:b' },
			action: { type: 'none' }
		};
		const inlined = inlineConfig(config);
		expect(inlined.face).toEqual({ type: 'image', dataUrl: 'a' });
		expect(inlined.secondFace).toEqual({ type: 'image', dataUrl: 'b' });
	});
});

describe('stored image-id collectors', () => {
	it('collects a config’s face ids', () => {
		expect(
			configImageIds({
				label: 'k',
				face: { type: 'image', dataUrl: '', imageId: 'a' },
				secondFace: { type: 'color', color: '#000' },
				action: { type: 'none' }
			})
		).toEqual(['a']);
	});

	it('collects ids from a stored keymap JSON string, including the profile image', () => {
		const raw = JSON.stringify({
			pages: [[{ face: { type: 'image', imageId: 'a' } }, { face: { type: 'color' } }]],
			profileImageId: 'p'
		});
		expect(storedKeymapImageIds(raw).sort()).toEqual(['a', 'p']);
	});

	it('collects ids from a stored stash JSON string, including previews', () => {
		const raw = JSON.stringify([
			{ config: { face: { type: 'image', imageId: 'a' } }, previewImageId: 'prev' },
			{ config: { face: { type: 'color' } } }
		]);
		expect(storedStashImageIds(raw).sort()).toEqual(['a', 'prev']);
	});

	it('treats a null/empty stored string as no references', () => {
		expect(storedKeymapImageIds(null)).toEqual([]);
		expect(storedStashImageIds('')).toEqual([]);
	});

	it('throws on malformed JSON so a GC sweep can abort rather than over-collect', () => {
		expect(() => storedKeymapImageIds('{not json')).toThrow();
	});
});
