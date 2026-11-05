/**
 * Reactive stash of saved key configurations, persisted to localStorage.
 *
 * Lets a key's full setup (label, face, action) be saved once and applied to
 * any other key later, instead of rebuilding it by hand each time. Templates can
 * carry a comma-separated list of keywords for filtering/clustering, and the whole
 * stash exports to / imports from a portable JSON file (issue #81).
 *
 * The pure keyword/filter/cluster helpers and the {@link Template} type live in the
 * runes-free `templateStash.ts` so they stay directly Node-testable; this module is
 * the thin persistence + import/export shell around them. Image payloads (face data
 * URLs and stash thumbnails) live in IndexedDB by content hash (issue #102); the
 * stored JSON references them by id and exports inline the data back.
 */

import { browser } from '$app/environment';
import { downscaleToDataUrl, pixelsToDataUrl } from '$lib/displaypad/raster.js';
import { fetchTemplateFace } from '$lib/displaypad/template.js';
import {
	configImageIds,
	dehydrateConfig,
	hydrateConfig,
	inlineConfig,
	storedStashImageIds
} from '$lib/state/imagePayloads.js';
import * as imageStore from '$lib/state/imageStore.js';
import { keymap } from '$lib/state/keymap.svelte.js';
import { secrets } from '$lib/state/secrets.svelte.js';
import { coerceKeywords, parseKeywords, type Template } from '$lib/state/templateStash.js';
import { isQuotaExceeded, QUOTA_TOAST_KEY, QUOTA_TOAST_MESSAGE } from '$lib/state/storageQuota.js';
import { toast } from '$lib/state/toast.svelte.js';
import { migrateKeyConfig, type KeyConfig, type KeyFace } from '$lib/types.js';

// Re-exported so the stash UI and tests can import the whole template stash surface from one module.
export {
	filterTemplates,
	formatKeywords,
	groupTemplatesByKeyword,
	parseKeywords,
	type Template,
	type TemplateGroup
} from '$lib/state/templateStash.js';

const STORAGE_KEY = 'displaypad.templates.v1';

/** Custom MIME type scoping drag data to stash tiles, so a key tile's own drag data can't be misread as a template. */
export const TEMPLATE_DRAG_MIME = 'application/x-displaypad-template';

/** Custom MIME type a keypad tile drag carries — used both for key↔key reordering and for dragging a key into the stash. */
export const KEY_DRAG_MIME = 'application/x-displaypad-key';

/** Versioned envelope for {@link Templates.exportJson} / {@link Templates.importJson}. */
const EXPORT_VERSION = 1;

/** One template as written to / read from an export file — the runtime `id` is dropped and re-minted on import. */
interface TemplateExportEntry {
	name: string;
	config: KeyConfig;
	keywords?: string[];
	previewDataUrl?: string;
}

/** One template as persisted to localStorage — image payloads referenced by content-hash id. */
interface StoredTemplate {
	id: string;
	name: string;
	config: KeyConfig;
	keywords?: string[];
	/** Content-hash pointer to the stash thumbnail in the blob store. */
	previewImageId?: string;
	/** Legacy inline thumbnail, migrated to {@link previewImageId} on next save. */
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

/** Whether a config runs executable JS on render (a `template` face — primary or second — with a transform). */
function configHasTransform(config: KeyConfig): boolean {
	return (
		(config.face.type === 'template' && !!config.face.transform) ||
		(config.secondFace?.type === 'template' && !!config.secondFace.transform)
	);
}

/** Whether a stored config carries an image face still inline (legacy) rather than an `imageId` pointer. */
function hasInlineImage(config: KeyConfig | undefined): boolean {
	if (!config) return false;
	const inline = (face: KeyFace | undefined) =>
		!!face && face.type === 'image' && !!face.dataUrl && !face.imageId;
	return inline(config.face) || inline(config.secondFace);
}

/** Narrow a parsed JSON value to a plausible {@link KeyConfig} before migrating it. */
function isKeyConfigLike(value: unknown): value is KeyConfig {
	if (!value || typeof value !== 'object') return false;
	const config = value as Record<string, unknown>;
	const face = config.face as Record<string, unknown> | undefined;
	const action = config.action as Record<string, unknown> | undefined;
	return (
		typeof config.label === 'string' &&
		!!face &&
		typeof face.type === 'string' &&
		!!action &&
		typeof action.type === 'string'
	);
}

/** Pull the list of raw template entries out of an export envelope (or a bare array), or `null` if there is none. */
function extractEntries(parsed: unknown): unknown[] | null {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object') {
		const list = (parsed as { templates?: unknown }).templates;
		if (Array.isArray(list)) return list;
	}
	return null;
}

class Templates {
	items = $state<Template[]>([]);

	/** Serialises overlapping saves so IndexedDB writes and the localStorage write don't race. */
	private persistChain: Promise<void> = Promise.resolve();
	/** Parsed stored rows kept between {@link load} and {@link hydrate} so preview ids can be matched back. */
	private pending: StoredTemplate[] | null = null;

	constructor() {
		if (!browser) return;
		this.load();
		imageStore.registerImageRefs(() => storedStashImageIds(localStorage.getItem(STORAGE_KEY)));
		void this.hydrate();
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

	/** Replace a template's keywords from a comma-separated string (cleared when empty) and persist. */
	setKeywords(id: string, input: string): void {
		const keywords = parseKeywords(input);
		this.items = this.items.map((t) =>
			t.id === id ? { ...t, keywords: keywords.length ? keywords : undefined } : t
		);
		this.persist();
	}

	/** Serialise the whole stash to a portable, versioned JSON string (ids are omitted — re-minted on import; images inlined). */
	exportJson(): string {
		const templates: TemplateExportEntry[] = this.items.map((t) => ({
			name: t.name,
			config: inlineConfig(t.config),
			...(t.keywords?.length ? { keywords: t.keywords } : {}),
			...(t.previewDataUrl ? { previewDataUrl: t.previewDataUrl } : {})
		}));
		return JSON.stringify({ version: EXPORT_VERSION, templates }, null, 2);
	}

	/**
	 * Append the templates in a JSON export (from {@link exportJson}, or a bare array of
	 * entries) to the stash, each with a fresh id, migrated config, and downscaled image
	 * faces. Invalid entries are skipped. If any imported template carries an executable
	 * `transform`, script approval is withheld (see `keymap.requireScriptApproval`) so
	 * untrusted JS can't run on apply until the user opts in. Returns the number added;
	 * throws with a user-facing message when the file is unusable.
	 */
	async importJson(text: string): Promise<number> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error('That file is not valid JSON.');
		}
		const entries = extractEntries(parsed);
		if (!entries) throw new Error('That file does not contain any templates.');

		const imported: Template[] = [];
		for (const entry of entries) {
			const template = await this.toTemplate(entry);
			if (template) imported.push(template);
		}
		if (imported.length === 0) throw new Error('No valid templates were found in that file.');

		this.items = [...this.items, ...imported];
		this.persist();
		if (imported.some((t) => configHasTransform(t.config))) keymap.requireScriptApproval();
		return imported.length;
	}

	/** Validate + normalise one raw export entry into a {@link Template}, or `null` if it's unusable. */
	private async toTemplate(entry: unknown): Promise<Template | null> {
		if (!entry || typeof entry !== 'object') return null;
		const raw = entry as Record<string, unknown>;
		if (!isKeyConfigLike(raw.config)) return null;
		const config = migrateKeyConfig(raw.config);
		const name =
			typeof raw.name === 'string' && raw.name.trim()
				? raw.name.trim()
				: config.label || 'Imported template';
		const keywords = coerceKeywords(raw.keywords);
		const previewDataUrl = typeof raw.previewDataUrl === 'string' ? raw.previewDataUrl : undefined;
		return {
			id: crypto.randomUUID(),
			name,
			config: {
				...config,
				face: await shrinkFace(config.face),
				secondFace: config.secondFace && (await shrinkFace(config.secondFace))
			},
			...(keywords.length ? { keywords } : {}),
			...(previewDataUrl ? { previewDataUrl } : {})
		};
	}

	private load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return;
			this.pending = parsed as StoredTemplate[];
			this.items = this.pending.map((t) => ({
				id: typeof t.id === 'string' ? t.id : crypto.randomUUID(),
				name: t.name,
				config: migrateKeyConfig(t.config),
				...(t.keywords ? { keywords: t.keywords } : {}),
				...(t.previewDataUrl ? { previewDataUrl: t.previewDataUrl } : {})
			}));
		} catch {
			// Corrupt storage — fall back to an empty stash rather than crashing the app.
		}
	}

	/**
	 * Fill image data URLs (face payloads and thumbnails) from the blob store after the
	 * synchronous {@link load}. Legacy inline data URLs are left in place and migrated to
	 * the blob store by the follow-up {@link persist}. Runs once on startup.
	 */
	private async hydrate(): Promise<void> {
		if (!browser || !this.pending) return;
		const pending = this.pending;
		this.pending = null;

		const ids: string[] = [];
		let legacyInline = false;
		for (const t of pending) {
			ids.push(...configImageIds(t.config));
			if (typeof t.previewImageId === 'string') ids.push(t.previewImageId);
			if (hasInlineImage(t.config) || (t.previewDataUrl && !t.previewImageId)) legacyInline = true;
		}
		const images = await imageStore.getImages(ids);
		this.items = pending.map((t) => {
			const config = hydrateConfig(migrateKeyConfig(t.config), images);
			const previewDataUrl = t.previewImageId
				? (images.get(t.previewImageId) ?? undefined)
				: t.previewDataUrl;
			return {
				id: typeof t.id === 'string' ? t.id : crypto.randomUUID(),
				name: t.name,
				config,
				...(t.keywords ? { keywords: t.keywords } : {}),
				...(previewDataUrl ? { previewDataUrl } : {})
			};
		});

		if (legacyInline) this.persist();
		imageStore.scheduleGc();
	}

	/** Build one stored template row, dehydrating its image payloads into the blob store. */
	private async serializeItem(t: Template): Promise<StoredTemplate> {
		const config = await dehydrateConfig(t.config, imageStore.putImage);
		let previewImageId: string | undefined;
		let previewDataUrl: string | undefined;
		if (t.previewDataUrl) {
			try {
				previewImageId = await imageStore.putImage(t.previewDataUrl);
			} catch {
				previewDataUrl = t.previewDataUrl; // IDB unavailable — keep it inline.
			}
		}
		return {
			id: t.id,
			name: t.name,
			config,
			...(t.keywords?.length ? { keywords: t.keywords } : {}),
			...(previewImageId ? { previewImageId } : {}),
			...(previewDataUrl ? { previewDataUrl } : {})
		};
	}

	/**
	 * Persist the stash: image payloads to IndexedDB, config JSON (with `imageId`
	 * pointers) to localStorage. Async and serialised; a `QuotaExceededError` surfaces as
	 * a persistent, actionable toast rather than an exception thrown mid-edit.
	 */
	private persist(): void {
		if (!browser) return;
		const plain = $state.snapshot(this.items) as Template[];
		this.persistChain = this.persistChain
			.then(async () => {
				const stored = await Promise.all(plain.map((t) => this.serializeItem(t)));
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
					toast.dismissByKey(QUOTA_TOAST_KEY);
				} catch (err) {
					if (isQuotaExceeded(err)) {
						toast.push(QUOTA_TOAST_MESSAGE, 'error', {
							persistent: true,
							dedupeKey: QUOTA_TOAST_KEY
						});
					} else {
						throw err;
					}
				}
			})
			.catch(() => {
				// A non-quota failure (serialisation, IDB) must not wedge the persist chain.
			});
	}
}

/** App-wide template stash singleton. */
export const templates = new Templates();
