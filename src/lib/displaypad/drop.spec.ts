import { describe, expect, it } from 'vitest';
import { firstUri, planFromDrop, type DroppedFile } from './drop.js';

/** A file stub — only `type`/`name` are read by the classifier. */
function file(name: string, type: string): DroppedFile {
	return { name, type };
}

describe('firstUri', () => {
	it('returns the first non-comment, non-blank line', () => {
		const list = '# some comment\r\n\r\nhttps://example.com/a.png\r\nhttps://example.com/b.png';
		expect(firstUri(list)).toBe('https://example.com/a.png');
	});

	it('returns undefined when every line is a comment or blank', () => {
		expect(firstUri('# only a comment\r\n')).toBeUndefined();
	});
});

describe('planFromDrop', () => {
	it('treats a raster image file as an inline image face', () => {
		expect(planFromDrop({ files: [file('logo.png', 'image/png')] })).toEqual({
			kind: 'image-file',
			file: file('logo.png', 'image/png')
		});
	});

	it('recognises a raster image by extension when the MIME type is missing', () => {
		expect(planFromDrop({ files: [file('photo.JPEG', '')] })).toMatchObject({ kind: 'image-file' });
	});

	it('routes an SVG file to the template (Live) editor', () => {
		expect(planFromDrop({ files: [file('icon.svg', 'image/svg+xml')] })).toEqual({
			kind: 'svg-file',
			file: file('icon.svg', 'image/svg+xml')
		});
	});

	it('recognises an SVG by extension even when the MIME type is generic', () => {
		expect(planFromDrop({ files: [file('icon.svg', 'application/octet-stream')] })).toMatchObject({
			kind: 'svg-file'
		});
	});

	it('prefers a dropped file over any accompanying dragged URL', () => {
		const plan = planFromDrop({
			files: [file('logo.png', 'image/png')],
			uriList: 'https://example.com/other.png'
		});
		expect(plan).toMatchObject({ kind: 'image-file' });
	});

	it('ignores a non-image file', () => {
		expect(planFromDrop({ files: [file('notes.txt', 'text/plain')] })).toBeNull();
	});

	it('maps a dragged http(s) URL to a remote face', () => {
		expect(planFromDrop({ uriList: 'https://example.com/face.png' })).toEqual({
			kind: 'remote-url',
			url: 'https://example.com/face.png'
		});
	});

	it('falls back to text/plain when there is no uri-list', () => {
		expect(planFromDrop({ text: 'http://example.com/x.gif' })).toEqual({
			kind: 'remote-url',
			url: 'http://example.com/x.gif'
		});
	});

	it('inlines a data: image URL as an image face rather than a remote fetch', () => {
		const url = 'data:image/png;base64,AAAA';
		expect(planFromDrop({ text: url })).toEqual({ kind: 'image-data-url', url });
	});

	it('ignores dragged plain text that is not a URL', () => {
		expect(planFromDrop({ text: 'just some words' })).toBeNull();
	});

	it('returns null for an empty payload', () => {
		expect(planFromDrop({})).toBeNull();
	});
});
