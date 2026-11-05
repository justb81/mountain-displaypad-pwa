/**
 * Pure, Node-testable bridge between the *in-memory* face shape (inline `dataUrl`,
 * what everything renders/exports from) and the *stored* face shape (an `imageId`
 * pointer into the IndexedDB blob store — issue #102 phase 2).
 *
 * The dehydrate/hydrate functions take the IndexedDB put/get as arguments rather than
 * importing `imageStore`, so they can be unit-tested with fakes and stay free of any
 * browser API. The stores wire in the real `imageStore` calls.
 */

import type { KeyConfig, KeyFace, KeyTextStyle } from '$lib/types.js';

/** Stores a data URL and resolves to its content-hash id. */
export type PutImage = (dataUrl: string) => Promise<string>;

/** Rebuild an image face with a fresh `dataUrl`/`imageId`, carrying its text label through. */
function imageFace(
	fields: { dataUrl?: string; imageId?: string },
	text: KeyTextStyle | undefined
): KeyFace {
	return { type: 'image', dataUrl: '', ...fields, ...(text ? { text } : {}) };
}

/**
 * Return `face` in stored form. An image face's inline `dataUrl` is written via `put`
 * and replaced by its `imageId` (the data URL is dropped so it never lands in
 * `localStorage`); a face still awaiting hydration (empty `dataUrl`, known `imageId`)
 * keeps its id. If `put` rejects (IndexedDB unavailable) the inline `dataUrl` is kept,
 * so an image is never silently lost. Non-image faces pass through untouched.
 */
export async function dehydrateFace(face: KeyFace, put: PutImage): Promise<KeyFace> {
	if (face.type !== 'image') return face;
	if (face.dataUrl) {
		try {
			return imageFace({ imageId: await put(face.dataUrl) }, face.text);
		} catch {
			return imageFace({ dataUrl: face.dataUrl }, face.text);
		}
	}
	if (face.imageId) return imageFace({ imageId: face.imageId }, face.text);
	return face;
}

/** Dehydrate both of a config's faces for storage. */
export async function dehydrateConfig(config: KeyConfig, put: PutImage): Promise<KeyConfig> {
	return {
		...config,
		face: await dehydrateFace(config.face, put),
		...(config.secondFace ? { secondFace: await dehydrateFace(config.secondFace, put) } : {})
	};
}

/**
 * Return `face` hydrated for use: an image face carrying an `imageId` gets its
 * `dataUrl` filled from `images` (and its `imageId` dropped — the in-memory steady
 * state is a plain inline face). An id missing from `images` leaves `dataUrl` empty
 * (the blob is gone); a legacy inline face (already has `dataUrl`, no `imageId`)
 * passes through. Non-image faces pass through.
 */
export function hydrateFace(face: KeyFace, images: Map<string, string>): KeyFace {
	if (face.type !== 'image' || !face.imageId) return face;
	return imageFace({ dataUrl: images.get(face.imageId) ?? '' }, face.text);
}

/** Hydrate both of a config's faces from an id→dataUrl map. */
export function hydrateConfig(config: KeyConfig, images: Map<string, string>): KeyConfig {
	return {
		...config,
		face: hydrateFace(config.face, images),
		...(config.secondFace ? { secondFace: hydrateFace(config.secondFace, images) } : {})
	};
}

/** Strip the persistence-only `imageId` from a face, leaving the self-contained (inline `dataUrl`) shape an export needs. */
export function inlineFace(face: KeyFace): KeyFace {
	if (face.type !== 'image' || face.imageId === undefined) return face;
	return imageFace({ dataUrl: face.dataUrl }, face.text);
}

/** Strip persistence-only `imageId`s from both of a config's faces (for exports). */
export function inlineConfig(config: KeyConfig): KeyConfig {
	return {
		...config,
		face: inlineFace(config.face),
		...(config.secondFace ? { secondFace: inlineFace(config.secondFace) } : {})
	};
}

/** The content-hash ids a face carries pending hydration (empty for anything else). */
function faceImageIds(face: unknown): string[] {
	if (face && typeof face === 'object') {
		const f = face as { type?: unknown; imageId?: unknown };
		if (f.type === 'image' && typeof f.imageId === 'string') return [f.imageId];
	}
	return [];
}

/** Every image id referenced by one (possibly stored) config's faces. */
export function configImageIds(config: unknown): string[] {
	if (!config || typeof config !== 'object') return [];
	const c = config as { face?: unknown; secondFace?: unknown };
	return [...faceImageIds(c.face), ...faceImageIds(c.secondFace)];
}

/**
 * Every image id referenced by a *stored* keymap JSON string (pages + profile image).
 * Used as a garbage-collection root: it reads what is actually persisted, so it stays
 * accurate regardless of in-memory hydration state. Throws on malformed JSON so the
 * caller can abort the sweep rather than over-collect; a null/empty string is no refs.
 */
export function storedKeymapImageIds(raw: string | null): string[] {
	if (!raw) return [];
	const parsed = JSON.parse(raw) as {
		pages?: unknown;
		profileImageId?: unknown;
	};
	const ids: string[] = [];
	if (Array.isArray(parsed.pages)) {
		for (const page of parsed.pages) {
			if (!Array.isArray(page)) continue;
			for (const config of page) ids.push(...configImageIds(config));
		}
	}
	if (typeof parsed.profileImageId === 'string') ids.push(parsed.profileImageId);
	return ids;
}

/** Every image id referenced by a *stored* template-stash JSON string (configs + previews). */
export function storedStashImageIds(raw: string | null): string[] {
	if (!raw) return [];
	const parsed = JSON.parse(raw) as unknown;
	const items = Array.isArray(parsed) ? parsed : [];
	const ids: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		const t = item as { config?: unknown; previewImageId?: unknown };
		ids.push(...configImageIds(t.config));
		if (typeof t.previewImageId === 'string') ids.push(t.previewImageId);
	}
	return ids;
}
