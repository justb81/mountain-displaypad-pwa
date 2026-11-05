/**
 * Renders a key's `template` face for the in-browser "virtual keypad" tile
 * (`PadKey`), independent of whether a physical pad is connected — so the
 * grid always shows the face's current render rather than a blank or stale
 * one. Mirrors `connection.ts`'s `fetchTemplateFace()` + refresh-timer +
 * script-approval handling, but takes the face/approval state as arguments
 * (rather than reading the keymap itself) so callers' reactive reads of them
 * double as this store's dependency tracking.
 */

import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import { pixelsToDataUrl } from '$lib/displaypad/raster.js';
import { fetchTemplateFace } from '$lib/displaypad/template.js';
import type { KeyFace } from '$lib/types.js';

/** Refuse to auto-refresh a preview more often than this, however small `refreshMinutes` is set. */
const MIN_REFRESH_MINUTES = 1;
/** Spread otherwise-identical refresh intervals out a bit so they don't all re-render at once. */
const REFRESH_JITTER_MS = 2000;
/** Debounce a possible change before re-rendering, so typing in the template/transform editors doesn't spin up a sandbox iframe per keystroke. */
const EDIT_DEBOUNCE_MS = 300;

class TemplatePreview {
	/** Rendered data URL per key on the active page; `null` when there's nothing to show. */
	images = $state<(string | null)[]>(Array(NUM_KEYS).fill(null));
	/** Per-key render error, `null` once a render succeeds (or the face isn't a template). */
	errors = $state<(string | null)[]>(Array(NUM_KEYS).fill(null));

	private timers = new Map<number, ReturnType<typeof setInterval>>();
	private debounces = new Map<number, ReturnType<typeof setTimeout>>();
	/** Bumped per key on every render so a slow, superseded render can't clobber a newer one. */
	private tokens: number[] = Array(NUM_KEYS).fill(0);

	/**
	 * Debounce a re-render of key `index` for `face` — call whenever a key's face,
	 * script approval, or secret values may have changed. `secretValues` is exposed
	 * to the transform as `ctx.secrets`, mirroring `connection.applyKey`.
	 */
	scheduleRender(
		index: number,
		face: KeyFace,
		scriptsApproved: boolean,
		secretValues: Record<string, string> = {}
	): void {
		const pending = this.debounces.get(index);
		if (pending !== undefined) clearTimeout(pending);
		this.debounces.set(
			index,
			setTimeout(() => {
				this.debounces.delete(index);
				void this.render(index, face, scriptsApproved, secretValues);
			}, EDIT_DEBOUNCE_MS)
		);
	}

	private async render(
		index: number,
		face: KeyFace,
		scriptsApproved: boolean,
		secretValues: Record<string, string>
	): Promise<void> {
		this.clearTimer(index);
		if (face.type !== 'template') {
			this.images[index] = null;
			this.errors[index] = null;
			return;
		}
		if (face.transform && !scriptsApproved) {
			this.images[index] = null;
			this.errors[index] =
				'This key runs a script from an imported profile — approve scripts in Profile tools before it can render.';
			return;
		}

		const token = ++this.tokens[index];
		try {
			const pixels = await fetchTemplateFace(face, undefined, secretValues);
			if (token !== this.tokens[index]) return;
			this.images[index] = pixelsToDataUrl(pixels);
			this.errors[index] = null;
		} catch (err) {
			if (token !== this.tokens[index]) return;
			this.images[index] = null;
			this.errors[index] = err instanceof Error ? err.message : String(err);
		}
		if (face.refreshMinutes)
			this.scheduleTimer(index, face.refreshMinutes, face, scriptsApproved, secretValues);
	}

	private scheduleTimer(
		index: number,
		refreshMinutes: number,
		face: KeyFace,
		scriptsApproved: boolean,
		secretValues: Record<string, string>
	): void {
		const minutes = Math.max(MIN_REFRESH_MINUTES, refreshMinutes);
		const delay = minutes * 60_000 + Math.random() * REFRESH_JITTER_MS;
		this.timers.set(
			index,
			setInterval(() => void this.render(index, face, scriptsApproved, secretValues), delay)
		);
	}

	private clearTimer(index: number): void {
		const id = this.timers.get(index);
		if (id !== undefined) clearInterval(id);
		this.timers.delete(index);
	}
}

/** App-wide template-face preview singleton, backing the virtual keypad's live render. */
export const templatePreview = new TemplatePreview();
