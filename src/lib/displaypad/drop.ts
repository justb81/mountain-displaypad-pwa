/**
 * Classify an external drag-and-drop payload dropped onto a key.
 *
 * Pure and Node-testable: it only inspects file metadata (type/name) and the
 * dragged text, never reads file contents or touches the DOM. Turning the
 * resulting {@link DropPlan} into a `KeyFace` — which needs `FileReader` and so
 * is browser-only — is the caller's job (see `PadGrid.svelte`).
 *
 * The three outcomes mirror issue #53:
 *   - a local raster image file (PNG/JPG/GIF/WebP/…) → an `image` face,
 *   - a local SVG file → its source dropped into a `template` (Live) face,
 *   - a dragged image/URL from a browser → a `remote` face (a `data:` image URL
 *     becomes an inline `image` face instead, since it needs no network fetch).
 */

/** Minimal shape of a dropped file the classifier needs — a real {@link File} satisfies it. */
export interface DroppedFile {
	type: string;
	name: string;
}

/** What to do with an external drop, decided from metadata alone. */
export type DropPlan<F extends DroppedFile = File> =
	| { kind: 'image-file'; file: F }
	| { kind: 'svg-file'; file: F }
	| { kind: 'image-data-url'; url: string }
	| { kind: 'remote-url'; url: string };

/** The raw pieces pulled synchronously off a `DataTransfer` during a drop. */
export interface DropInput<F extends DroppedFile = File> {
	/** `dataTransfer.files`, if any. */
	files?: readonly F[];
	/** `dataTransfer.getData('text/uri-list')` — a browser image drag's canonical URL. */
	uriList?: string;
	/** `dataTransfer.getData('text/plain')` — a fallback URL for sources without a uri-list. */
	text?: string;
}

function isSvgFile(file: DroppedFile): boolean {
	return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

function isImageFile(file: DroppedFile): boolean {
	return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
}

/**
 * The first real URL in a `text/uri-list` value: its lines are newline-separated
 * and comment lines start with `#` (per RFC 2483), so both are skipped.
 */
export function firstUri(uriList: string): string | undefined {
	for (const line of uriList.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#')) return trimmed;
	}
	return undefined;
}

/**
 * Decide how an external drop should reconfigure a key, or `null` if it carries
 * nothing we can use (a non-image file, a non-URL text selection, …). A dropped
 * file always wins over dragged text — a browser image drag exposes both, and
 * the file is the higher-fidelity source.
 */
export function planFromDrop<F extends DroppedFile>(input: DropInput<F>): DropPlan<F> | null {
	const file = input.files?.[0];
	if (file) {
		if (isSvgFile(file)) return { kind: 'svg-file', file };
		if (isImageFile(file)) return { kind: 'image-file', file };
		return null;
	}

	const raw = (input.uriList && firstUri(input.uriList)) || input.text?.trim();
	if (!raw) return null;
	if (/^data:image\//i.test(raw)) return { kind: 'image-data-url', url: raw };
	if (/^https?:\/\//i.test(raw)) return { kind: 'remote-url', url: raw };
	return null;
}
