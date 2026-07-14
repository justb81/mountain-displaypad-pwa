/** Shared application types for the DisplayPad configurator. */

/** What a key does when pressed. The PWA reacts in-page; there is no OS-level agent. */
export type KeyAction =
	| { type: 'none' }
	| { type: 'open-url'; url: string }
	| {
			/** Fire an HTTP request straight from the browser (toggle a light, kick a CI job, ...). */
			type: 'webhook';
			method: 'GET' | 'POST';
			url: string;
			/** Raw request body sent as `application/json` on POST — stored verbatim as typed. */
			body?: string;
			/** Extra request headers, name → value. */
			headers?: Record<string, string>;
			/** Fire-and-forget with an opaque response: no CORS needed, but status/errors are unreadable. */
			noCors?: boolean;
	  }
	| {
			/**
			 * Jump the whole pad to another page of 12 keys, back to the page this one
			 * was entered from, or forward to the next page in sequence — the browser-side
			 * mirror of Base Camp's "Create Folder"/"Back" pair, plus a `'next'` convenience
			 * for simple sequential paging, combined into a single action.
			 */
			type: 'navigate';
			/**
			 * A page index to jump to, `'back'` to pop the previous page off the history,
			 * or `'next'` to advance to `(activePage + 1) % pageCount` (wrapping around),
			 * remembering history the same way as jumping to an explicit page.
			 */
			target: number | 'back' | 'next';
	  };

/**
 * Legacy action shapes we no longer model but may still find in stored/imported
 * data: the pre-merge `open-folder`/`back` pair (now the single `navigate`
 * action) and the removed `copy-text` action. {@link migrateAction} folds them
 * into the current {@link KeyAction} union.
 */
type LegacyKeyAction =
	{ type: 'open-folder'; page: number } | { type: 'back' } | { type: 'copy-text'; text?: string };

/** Fold a possibly-legacy action into the current {@link KeyAction} union (a no-op for already-current actions). */
export function migrateAction(action: KeyAction | LegacyKeyAction): KeyAction {
	switch (action.type) {
		case 'open-folder':
			return { type: 'navigate', target: action.page };
		case 'back':
			return { type: 'navigate', target: 'back' };
		case 'copy-text':
			return { type: 'none' };
		default:
			return action;
	}
}

/** Return `config` with any legacy action migrated, reusing the original object when nothing changed. */
export function migrateKeyConfig(config: KeyConfig): KeyConfig {
	const action = migrateAction(config.action as KeyAction | LegacyKeyAction);
	return action === config.action ? config : { ...config, action };
}

/** Migrate every key's action across a list of pages (used when loading/importing persisted keymaps). */
export function migratePages(pages: KeyConfig[][]): KeyConfig[][] {
	return pages.map((page) => page.map(migrateKeyConfig));
}

/** Vertical placement of a {@link KeyTextStyle} label, matching Base Camp's `TextAlign`. */
export type TextAlign = 'top' | 'center' | 'bottom';

/**
 * A text label burned onto a key face, mirroring Base Camp's per-key `OptionalText`/
 * `SecondOptionalText` style block. Rendered onto the 102x102 buffer on apply.
 */
export interface KeyTextStyle {
	text: string;
	color: string;
	align: TextAlign;
	fontFamily?: string;
	/** Font size in pixels at the pad's native 102x102 resolution. */
	fontSize?: number;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
}

/** How a key renders on the physical pad. */
export type KeyFace =
	| { type: 'color'; color: string; text?: KeyTextStyle }
	| {
			type: 'image';
			/** data URL of a square image, scaled to 102x102 on apply */ dataUrl: string;
			text?: KeyTextStyle;
	  }
	| {
			type: 'remote';
			/** Public URL fetched over GET; the endpoint must send CORS headers permissive to this origin. */
			url: string;
			/** Refetch this often while connected. Omitted/0 disables the timer. */
			refreshMinutes?: number;
			/** Refetch (and re-apply) whenever this key is pressed. */
			refreshOnPress?: boolean;
			text?: KeyTextStyle;
	  }
	| {
			/** Data-driven face: an optional sandboxed transform feeds a Mustache template, rasterised to the key. */
			type: 'template';
			/** HTML + Mustache; rendered with whatever `transform` returns (or {} if none). */
			template: string;
			/** Optional sandboxed async JS body: has `fetch` + `Date` + a `ctx` arg, must
			 *  return a structured-cloneable object. Runs in an opaque-origin iframe. */
			transform?: string;
			/** Refetch + re-render this often while connected. Omitted/0 disables the timer. */
			refreshMinutes?: number;
			/** Refetch + re-render whenever this key is pressed. */
			refreshOnPress?: boolean;
	  };

/** Faces with a `refreshMinutes`/`refreshOnPress` polling policy — `remote` and `template`. */
export type LiveKeyFace = Extract<KeyFace, { refreshMinutes?: number; refreshOnPress?: boolean }>;

/** Whether `face` is polled/refetched on a timer or key press, rather than static. */
export function isLiveFace(face: KeyFace): face is LiveKeyFace {
	return face.type === 'remote' || face.type === 'template';
}

/** A face's burned-on text label, if its variant carries one (a `template` face doesn't — it renders its own HTML). */
export function faceText(face: KeyFace | undefined): KeyTextStyle | undefined {
	return face && face.type !== 'template' ? face.text : undefined;
}

/** `face` with its text label replaced, if its variant carries one — a no-op for a `template` face. */
export function withFaceText(face: KeyFace, text: KeyTextStyle | undefined): KeyFace {
	return face.type === 'template' ? face : { ...face, text };
}

/** Full user-facing configuration for one of the 12 keys. */
export interface KeyConfig {
	label: string;
	face: KeyFace;
	/** Optional alternate face for a toggle key (e.g. mic mute/unmute) — a press flips
	 *  between `face` and `secondFace` and repaints the key. Absent for a normal key. */
	secondFace?: KeyFace;
	action: KeyAction;
}

/** Connection lifecycle of the pad. */
export type ConnectionStatus =
	'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';
