/**
 * Small glyph "badges" describing what a key does and how its face behaves.
 *
 * Pure and Node-testable: they map a {@link KeyAction}/{@link KeyFace} to a glyph
 * plus an accessible label, with no DOM or hardware access. Shared so the physical
 * keypad tile (`PadKey`) and the template stash render the *same* icons — issue #81
 * asks the stash to show "Face and Action type (icons like on the keypad)".
 */

import type { KeyAction, KeyFace } from '$lib/types.js';

/** A glyph + its accessible label, rendered as a small chip in the UI. */
export interface Badge {
	glyph: string;
	label: string;
}

/** What a key does on press, as a glyph badge — `undefined` for a `none` action. */
export function actionBadge(action: KeyAction): Badge | undefined {
	switch (action.type) {
		case 'open-url':
			return { glyph: '↗', label: 'Opens a URL in the browser when pressed' };
		case 'webhook':
			return { glyph: '⚡', label: 'Fires a webhook when pressed' };
		case 'navigate':
			return action.target === 'back'
				? { glyph: '↩', label: 'Returns to the previous page when pressed' }
				: action.target === 'next'
					? { glyph: '↪', label: 'Advances to the next page when pressed' }
					: { glyph: '⊞', label: 'Opens another page when pressed' };
		default:
			return undefined;
	}
}

/** How a live face refreshes, as a glyph badge — `undefined` for a static `color`/`image` face. */
export function faceBadge(face: KeyFace): Badge | undefined {
	switch (face.type) {
		case 'remote':
			return { glyph: '⟳', label: 'Live: refreshes from a URL' };
		case 'template':
			return { glyph: '{}', label: 'Live: rendered from a template' };
		default:
			return undefined;
	}
}

/** The badge marking a toggle key that flips between two faces on each press. */
export const TOGGLE_BADGE: Badge = { glyph: '⇄', label: 'Flips to a second face when pressed' };
