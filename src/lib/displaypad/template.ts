/**
 * Browser-only helper for the `template` {@link KeyFace}: run its optional
 * sandboxed `transform` (see `sandbox.ts`), render the result through a
 * Mustache template, and rasterise the resulting HTML to the 102x102 key
 * image. Mustache is dynamic-imported so it (and its ~2KB) stay out of the
 * main bundle / service-worker precache until a template face is used.
 *
 * `wrapHtmlInSvg` and `renderMustache` are pure string transforms — the only
 * DOM-touching step is the final `rasterize()` call, mirroring `liveface.ts`.
 */

import { ICON_SIZE } from './protocol.js';
import { rasterize } from './raster.js';
import { runTransform } from './sandbox.js';
import type { KeyFace } from '$lib/types.js';

type TemplateFace = Extract<KeyFace, { type: 'template' }>;

/**
 * Wrap `html` in an SVG `<foreignObject>` sized to `size`x`size` — the
 * primary rasterisation path (works on stable Chromium today). All CSS must
 * be inline and any external image/font embedded as a `data:` URL: the SVG
 * is loaded as an `<img>`, which runs in secure-static mode (no scripts, no
 * external resource loads).
 *
 * The wrapper div is `size`x`size` with `overflow:hidden`, but nothing forces
 * the caller's `html` itself to fill that box — content that doesn't
 * explicitly size itself to 100%/100% (see `KeyInspector`'s starter template)
 * only covers its own natural size, leaving the rest of the box uncovered.
 * The wrapper's own `background:#000` gives that leftover area the same
 * black the pad already shows for an unset key (`encodeImage` drops alpha
 * regardless, so this is a no-op for the pixels actually sent to hardware —
 * it only matters for matching that on the virtual keypad preview, which
 * unlike the pad does render transparency).
 *
 * This render is a self-contained document (an isolated `data:image/svg+xml`
 * resource, not sharing style scope with the app or other keys), so it also
 * resets every element's margin/padding and forces `border-box` sizing:
 * without it, a heading/paragraph/list's UA-default margin can collapse
 * through a size:100% wrapper `<div>` with no border/padding of its own and
 * escape past the top of the box — content still fills its full declared
 * height, but visually shifted down, leaving a gap only at the top (the
 * overflow at the bottom is simply clipped) — surprising unless you already
 * know that collapsing rule.
 */
export function wrapHtmlInSvg(html: string, size: number): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
		`<foreignObject x="0" y="0" width="${size}" height="${size}">` +
		`<div xmlns="http://www.w3.org/1999/xhtml" style="width:${size}px;height:${size}px;overflow:hidden;background:#000;">` +
		`<style>*{margin:0;padding:0;box-sizing:border-box;}</style>${html}</div>` +
		`</foreignObject></svg>`
	);
}

/** Render a Mustache `template` against `data` (or `{}` if the transform returned nothing). */
export async function renderMustache(template: string, data: unknown): Promise<string> {
	const { default: Mustache } = await import('mustache');
	return Mustache.render(template, (data as object) ?? {});
}

/** Whether the enhanced, script-friendly `drawElementImage` rasterisation path is available. */
function supportsDrawElementImage(): boolean {
	return (
		typeof CanvasRenderingContext2D !== 'undefined' &&
		'drawElementImage' in CanvasRenderingContext2D.prototype
	);
}

/**
 * Native path for the upcoming HTML-in-canvas API (not on stable Chromium
 * yet): render live DOM into an off-screen container and draw it straight
 * into the canvas, avoiding the inline-CSS/data-URL constraints the SVG path
 * needs. Falls back to the SVG path on any failure.
 */
async function rasterizeViaDrawElement(html: string, size: number): Promise<Uint8ClampedArray> {
	const container = document.createElement('div');
	container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${size}px;height:${size}px;overflow:hidden;`;
	container.innerHTML = html;
	document.body.appendChild(container);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d') as
			| (CanvasRenderingContext2D & {
					drawElementImage(el: Element, x: number, y: number, w: number, h: number): void;
			  })
			| null;
		if (!ctx) throw new Error('2D canvas context unavailable.');
		ctx.drawElementImage(container, 0, 0, size, size);
		return ctx.getImageData(0, 0, size, size).data;
	} finally {
		container.remove();
	}
}

/**
 * Rasterise `html` to a `size`x`size` RGBA buffer: prefers the native
 * `drawElementImage` path when the browser supports it, otherwise wraps it
 * in an SVG `<foreignObject>` and reuses `raster.ts`'s canvas pipeline.
 */
export async function rasterizeHtml(html: string, size = ICON_SIZE): Promise<Uint8ClampedArray> {
	if (supportsDrawElementImage()) {
		try {
			return await rasterizeViaDrawElement(html, size);
		} catch {
			// Fall through to the SVG path below.
		}
	}
	const svg = wrapHtmlInSvg(html, size);
	return rasterize(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, size);
}

/**
 * Render a `template` face end to end: run its `transform` (if any) in the
 * sandbox, feed the result through Mustache, and rasterise the HTML to the
 * key image. Callers (the connection store) are responsible for catching
 * failures into `liveFaceErrors` — this never swallows an error itself.
 *
 * `secrets` is exposed to the transform as `ctx.secrets` (a plain `KEY → VALUE`
 * object structured-cloned into the sandbox), so a transform can authenticate a
 * `fetch` without the credential living in the stored/exported config. It stays
 * a parameter rather than a direct store import so this layer keeps its
 * hardware-agnostic, dependency-light shape.
 */
export async function fetchTemplateFace(
	face: TemplateFace,
	size = ICON_SIZE,
	secrets: Record<string, string> = {}
): Promise<Uint8ClampedArray> {
	const ctx = { now: new Date(), secrets };
	const data = face.transform ? await runTransform(face.transform, ctx) : {};
	const html = await renderMustache(face.template, data);
	return rasterizeHtml(html, size);
}
