/**
 * Reactive stash of saved key configurations, persisted to localStorage.
 *
 * Lets a key's full setup (label, face, action) be saved once and applied to
 * any other key later, instead of rebuilding it by hand each time.
 */

import { browser } from '$app/environment';
import { downscaleToDataUrl, pixelsToDataUrl } from '$lib/displaypad/raster.js';
import { fetchTemplateFace } from '$lib/displaypad/template.js';
import { secrets } from '$lib/state/secrets.svelte.js';
import type { KeyConfig, KeyFace } from '$lib/types.js';

const STORAGE_KEY = 'displaypad.templates.v1';

/** Custom MIME type scoping drag data to stash tiles, so a key tile's own drag data can't be misread as a template. */
export const TEMPLATE_DRAG_MIME = 'application/x-displaypad-template';

export interface Template {
	id: string;
	name: string;
	config: KeyConfig;
	/**
	 * Snapshot of a `template` face's rendered output at the moment it was stashed, so the
	 * stash tray can show a thumbnail without re-running a (possibly stale-by-then, and for
	 * an unapproved transform unsafe-to-run) live render. `undefined` for every other face
	 * type, and for a `template` face whose render failed or whose transform wasn't approved.
	 */
	previewDataUrl?: string;
}

async function shrinkFace(face: KeyFace): Promise<KeyFace> {
	if (face.type !== 'image' || !browser) return face;
	return { ...face, dataUrl: await downscaleToDataUrl(face.dataUrl) };
}

/** Render a `template` face's current output to a data URL for the stash thumbnail — `undefined` if that isn't possible or safe right now. */
async function renderPreview(face: KeyFace, scriptsApproved: boolean): Promise<string | undefined> {
	if (face.type !== 'template' || !browser) return undefined;
	if (face.transform && !scriptsApproved) return undefined;
	try {
		return pixelsToDataUrl(await fetchTemplateFace(face, undefined, secrets.values));
	} catch {
		return undefined;
	}
}

class Templates {
	items = $state<Template[]>([]);

	constructor() {
		if (browser) this.load();
	}

	/**
	 * Save a copy of `config` as a new named template (image faces downscaled to icon size,
	 * a template face's current render captured as its thumbnail) and persist. `scriptsApproved`
	 * mirrors `connection`/`templatePreview`'s gate: an unapproved transform is never run, even
	 * just to produce a thumbnail.
	 */
	async save(name: string, config: KeyConfig, scriptsApproved: boolean): Promise<Template> {
		const template: Template = {
			id: crypto.randomUUID(),
			name,
			config: {
				...config,
				face: await shrinkFace(config.face),
				secondFace: config.secondFace && (await shrinkFace(config.secondFace))
			},
			previewDataUrl: await renderPreview(config.face, scriptsApproved)
		};
		this.items = [...this.items, template];
		this.persist();
		return template;
	}

	/** Remove a template by id and persist. */
	remove(id: string): void {
		this.items = this.items.filter((t) => t.id !== id);
		this.persist();
	}

	/** Rename a template and persist. */
	rename(id: string, name: string): void {
		const trimmed = name.trim();
		if (!trimmed) return;
		this.items = this.items.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
		this.persist();
	}

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Template[];
			if (Array.isArray(parsed)) this.items = parsed;
		} catch {
			// Corrupt storage — fall back to an empty stash rather than crashing the app.
		}
	}

	private persist(): void {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
	}
}

/** App-wide template stash singleton. */
export const templates = new Templates();
