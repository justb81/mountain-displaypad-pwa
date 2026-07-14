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
 * the thin persistence + import/export shell around them.
 */

import { browser } from '$app/environment';
import { downscaleToDataUrl, pixelsToDataUrl } from '$lib/displaypad/raster.js';
import { fetchTemplateFace } from '$lib/displaypad/template.js';
import { keymap } from '$lib/state/keymap.svelte.js';
import { secrets } from '$lib/state/secrets.svelte.js';
import { coerceKeywords, parseKeywords, type Template } from '$lib/state/templateStash.js';
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

	/** Replace a template's keywords from a comma-separated string (cleared when empty) and persist. */
	setKeywords(id: string, input: string): void {
		const keywords = parseKeywords(input);
		this.items = this.items.map((t) =>
			t.id === id ? { ...t, keywords: keywords.length ? keywords : undefined } : t
		);
		this.persist();
	}

	/** Serialise the whole stash to a portable, versioned JSON string (ids are omitted — re-minted on import). */
	exportJson(): string {
		const templates: TemplateExportEntry[] = this.items.map((t) => ({
			name: t.name,
			config: t.config,
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
			const parsed = JSON.parse(raw) as Template[];
			if (Array.isArray(parsed))
				this.items = parsed.map((t) => ({ ...t, config: migrateKeyConfig(t.config) }));
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
