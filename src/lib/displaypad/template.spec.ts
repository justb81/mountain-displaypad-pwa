import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { renderMustache, wrapHtmlInSvg } from './template.js';

describe('wrapHtmlInSvg', () => {
	it('produces a well-formed SVG document at the requested size', () => {
		const svg = wrapHtmlInSvg('<b>Hi</b>', 102);
		expect(() => new XMLParser({ ignoreAttributes: false }).parse(svg)).not.toThrow();
		expect(svg).toContain('width="102"');
		expect(svg).toContain('height="102"');
	});

	it('embeds the given HTML inside a foreignObject', () => {
		const svg = wrapHtmlInSvg('<span id="x">hello</span>', 50);
		expect(svg).toContain('<foreignObject');
		expect(svg).toContain('<span id="x">hello</span>');
	});

	it('stays well-formed even when the embedded HTML has unescaped special characters', () => {
		const svg = wrapHtmlInSvg('<p>a &amp; b</p>', 102);
		expect(() => new XMLParser().parse(svg)).not.toThrow();
	});
});

describe('renderMustache', () => {
	it('substitutes a simple variable', async () => {
		await expect(renderMustache('Price: {{price}}', { price: 42 })).resolves.toBe('Price: 42');
	});

	it('HTML-escapes double-stache variables by default', async () => {
		await expect(renderMustache('{{value}}', { value: '<b>x</b>' })).resolves.toBe(
			'&lt;b&gt;x&lt;&#x2F;b&gt;'
		);
	});

	it('does not escape triple-stache variables', async () => {
		await expect(renderMustache('{{{value}}}', { value: '<b>x</b>' })).resolves.toBe('<b>x</b>');
	});

	it('renders sections and inverted sections', async () => {
		const template = '{{#show}}yes{{/show}}{{^show}}no{{/show}}';
		await expect(renderMustache(template, { show: true })).resolves.toBe('yes');
		await expect(renderMustache(template, { show: false })).resolves.toBe('no');
	});

	it('renders missing fields as empty', async () => {
		await expect(renderMustache('[{{missing}}]', {})).resolves.toBe('[]');
	});

	it('treats undefined data as an empty context', async () => {
		await expect(renderMustache('static text', undefined)).resolves.toBe('static text');
	});
});
