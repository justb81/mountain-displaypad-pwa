/**
 * Browser-only helper that rasterises an arbitrary image source (data URL or
 * remote URL) into the fixed-size RGBA buffer {@link encodeImage} expects.
 */

import { ICON_SIZE } from './protocol.js';
import { removeBackground, type RemoveBackgroundOptions } from './image.js';
import type { KeyTextStyle } from '$lib/types.js';

const DEFAULT_TEXT_FONT_FAMILY = 'Arial, sans-serif';
const DEFAULT_TEXT_FONT_SIZE = 14;
/** Gap in pixels kept between the canvas edge and a top/bottom-aligned label. */
const TEXT_MARGIN = 6;

/**
 * Draw `src` into an {@link ICON_SIZE}x{@link ICON_SIZE} canvas and return its
 * RGBA pixels. The image is stretched to fill the square. If `text` is given,
 * it's burned on top afterwards, mirroring how Base Camp bakes its `OptionalText`
 * label into the key image before saving.
 */
export async function rasterize(
	src: string,
	size = ICON_SIZE,
	text?: KeyTextStyle
): Promise<Uint8ClampedArray> {
	const image = await loadImage(src);
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable.');
	ctx.drawImage(image, 0, 0, size, size);
	if (text) drawTextOverlay(ctx, text, size);
	return ctx.getImageData(0, 0, size, size).data;
}

/**
 * Render a solid-colour key face with a {@link KeyTextStyle} label into the RGBA
 * buffer {@link encodeImage} expects. Only needed once a `color` face carries text —
 * a plain solid colour still goes straight to `DisplayPad.setKeyColor` without a canvas.
 */
export function rasterizeColor(
	color: string,
	text: KeyTextStyle,
	size = ICON_SIZE
): Uint8ClampedArray {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable.');
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, size, size);
	drawTextOverlay(ctx, text, size);
	return ctx.getImageData(0, 0, size, size).data;
}

/** Paint a {@link KeyTextStyle} label onto an already-drawn canvas. */
function drawTextOverlay(ctx: CanvasRenderingContext2D, style: KeyTextStyle, size: number): void {
	const text = style.text.trim();
	if (!text) return;

	const fontSize = style.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
	const weight = style.bold ? 'bold ' : '';
	const slant = style.italic ? 'italic ' : '';
	ctx.font = `${slant}${weight}${fontSize}px ${style.fontFamily || DEFAULT_TEXT_FONT_FAMILY}`;
	ctx.fillStyle = style.color;
	ctx.textAlign = 'center';

	const x = size / 2;
	let y: number;
	if (style.align === 'top') {
		ctx.textBaseline = 'top';
		y = TEXT_MARGIN;
	} else if (style.align === 'bottom') {
		ctx.textBaseline = 'bottom';
		y = size - TEXT_MARGIN;
	} else {
		ctx.textBaseline = 'middle';
		y = size / 2;
	}
	ctx.fillText(text, x, y);

	if (style.underline) {
		const width = ctx.measureText(text).width;
		const underlineY =
			style.align === 'top'
				? y + fontSize + 2
				: style.align === 'bottom'
					? y - 2
					: y + fontSize / 2 + 2;
		ctx.strokeStyle = style.color;
		ctx.lineWidth = Math.max(1, Math.round(fontSize / 12));
		ctx.beginPath();
		ctx.moveTo(x - width / 2, underlineY);
		ctx.lineTo(x + width / 2, underlineY);
		ctx.stroke();
	}
}

/**
 * Re-encode `src` as a {@link ICON_SIZE}x{@link ICON_SIZE} PNG data URL. Used to
 * shrink an image face before it's stashed as a template, since a template stash
 * of full-resolution images can bump into the localStorage quota.
 */
export async function downscaleToDataUrl(src: string, size = ICON_SIZE): Promise<string> {
	const image = await loadImage(src);
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable.');
	ctx.drawImage(image, 0, 0, size, size);
	return canvas.toDataURL('image/png');
}

/**
 * Flood-fill the background out of an image's alpha channel and return the
 * result as a `data:image/png` URL, at the image's native resolution.
 *
 * The pad itself has no concept of transparency (`encodeImage` in `image.ts`
 * drops alpha), so the cleared pixels render black on the physical key.
 */
export async function removeImageBackground(
	src: string,
	options?: RemoveBackgroundOptions
): Promise<string> {
	const image = await loadImage(src);
	const width = image.naturalWidth || image.width;
	const height = image.naturalHeight || image.height;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable.');
	ctx.drawImage(image, 0, 0);
	const imageData = ctx.getImageData(0, 0, width, height);
	removeBackground(imageData.data, width, height, options);
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
		image.src = src;
	});
}
