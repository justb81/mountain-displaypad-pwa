/**
 * Browser-only helper for the `remote` {@link KeyFace} case: fetch an image
 * over GET from a public URL and rasterise it into the RGBA buffer
 * {@link encodeImage} expects. The endpoint must send CORS headers permissive
 * to this origin — a cross-origin fetch without them fails outright, and (per
 * `rasterize`'s canvas readback) a same-origin-but-tainted response would
 * throw on `getImageData` — see CLAUDE.md's "Hardware caveats" for context on
 * why the rest of this app avoids exactly that class of surprise.
 */

import { ICON_SIZE } from './protocol.js';
import { rasterize } from './raster.js';

/** Fetch `url`, sniff its content type, and rasterise the result to `size`x`size`. */
export async function fetchRemoteFace(url: string, size = ICON_SIZE): Promise<Uint8ClampedArray> {
	const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	const contentType = response.headers.get('content-type') ?? '';
	const blob = contentType.includes('svg')
		? new Blob([ensureSvgSize(await response.text(), size)], { type: 'image/svg+xml' })
		: await response.blob();

	const objectUrl = URL.createObjectURL(blob);
	try {
		return await rasterize(objectUrl, size);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/** SVGs without an intrinsic width/height don't rasterise predictably in a canvas. */
function ensureSvgSize(svg: string, size: number): string {
	return /<svg[^>]*\swidth=/.test(svg)
		? svg
		: svg.replace('<svg', `<svg width="${size}" height="${size}"`);
}
