/**
 * Browser-only helper that rasterises an arbitrary image source (data URL or
 * remote URL) into the fixed-size RGBA buffer {@link encodeImage} expects.
 */

import { ICON_SIZE } from './protocol.js';
import { removeBackground, type RemoveBackgroundOptions } from './image.js';

/**
 * Draw `src` into an {@link ICON_SIZE}x{@link ICON_SIZE} canvas and return its
 * RGBA pixels. The image is stretched to fill the square.
 */
export async function rasterize(src: string, size = ICON_SIZE): Promise<Uint8ClampedArray> {
	const image = await loadImage(src);
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas context unavailable.');
	ctx.drawImage(image, 0, 0, size, size);
	return ctx.getImageData(0, 0, size, size).data;
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
