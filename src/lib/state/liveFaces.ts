import { isLiveFace, type KeyConfig } from '$lib/types.js';

/**
 * Indices of the keys whose *currently shown* face is live (remote/template).
 *
 * Mirrors the "which face is on screen" rule used when applying a key — a toggle
 * key flipped to its `secondFace` is timed/refreshed by that face, otherwise by
 * `face`. Pure so it can be unit-tested; used to repaint only the faces that can
 * go stale (color/image faces never do) on a cheap resync.
 */
export function liveFaceIndices(keys: KeyConfig[], toggled: boolean[]): number[] {
	const out: number[] = [];
	keys.forEach((cfg, i) => {
		const face = toggled[i] && cfg.secondFace ? cfg.secondFace : cfg.face;
		if (isLiveFace(face)) out.push(i);
	});
	return out;
}
