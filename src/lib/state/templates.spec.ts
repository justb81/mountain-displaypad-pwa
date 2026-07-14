import { describe, expect, it } from 'vitest';
import type { KeyConfig } from '$lib/types.js';
import { keymap } from './keymap.svelte.js';
import {
	filterTemplates,
	formatKeywords,
	groupTemplatesByKeyword,
	parseKeywords,
	templates,
	type Template
} from './templates.svelte.js';

function config(label: string): KeyConfig {
	return { label, face: { type: 'color', color: '#000000' }, action: { type: 'none' } };
}

function templateConfig(label: string, transform?: string): KeyConfig {
	return {
		label,
		face: { type: 'template', template: '{{x}}', transform },
		action: { type: 'none' }
	};
}

/** A bare {@link Template} for the pure keyword helpers (no persistence involved). */
function tmpl(name: string, keywords?: string[]): Template {
	return { id: name, name, config: config(name), keywords };
}

describe('templates.save', () => {
	it('adds a new template with a fresh id and a snapshot of the given config', async () => {
		const before = templates.items.length;
		const source = config('Mute mic');

		const saved = await templates.save('Mute mic', source, true);

		expect(templates.items).toHaveLength(before + 1);
		expect(templates.items.at(-1)).toEqual(saved);
		expect(saved.name).toBe('Mute mic');
		expect(saved.config).toEqual(source);
		expect(saved.config).not.toBe(source);
	});

	it('mutating the original config afterwards does not affect the saved template', async () => {
		const source = config('Open Jira');

		const saved = await templates.save('Open Jira', source, true);
		source.label = 'mutated';

		expect(saved.config.label).toBe('Open Jira');
	});

	it('leaves previewDataUrl unset for a non-template face', async () => {
		const saved = await templates.save('Solid colour', config('Solid colour'), true);

		expect(saved.previewDataUrl).toBeUndefined();
	});

	it('does not throw and leaves previewDataUrl unset for a template face outside the browser', async () => {
		const saved = await templates.save('Clock', templateConfig('Clock', 'return { x: 1 };'), true);

		expect(saved.previewDataUrl).toBeUndefined();
	});

	it('never runs an unapproved transform, even just to render a thumbnail', async () => {
		const saved = await templates.save(
			'Untrusted',
			templateConfig('Untrusted', 'return { x: 1 };'),
			false
		);

		expect(saved.previewDataUrl).toBeUndefined();
	});
});

describe('templates.rename', () => {
	it('renames the matching template and trims whitespace', async () => {
		const saved = await templates.save('Old name', config('x'), true);

		templates.rename(saved.id, '  New name  ');

		expect(templates.items.find((t) => t.id === saved.id)?.name).toBe('New name');
	});

	it('ignores a blank new name', async () => {
		const saved = await templates.save('Keep me', config('x'), true);

		templates.rename(saved.id, '   ');

		expect(templates.items.find((t) => t.id === saved.id)?.name).toBe('Keep me');
	});
});

describe('templates.remove', () => {
	it('removes only the matching template', async () => {
		const a = await templates.save('a', config('a'), true);
		const b = await templates.save('b', config('b'), true);

		templates.remove(a.id);

		expect(templates.items.find((t) => t.id === a.id)).toBeUndefined();
		expect(templates.items.find((t) => t.id === b.id)).toEqual(b);
	});
});

describe('parseKeywords', () => {
	it('trims, drops blanks, and de-duplicates case-insensitively (first casing wins)', () => {
		expect(parseKeywords('Home, home , Work,,  ')).toEqual(['Home', 'Work']);
	});

	it('returns an empty list for a blank string', () => {
		expect(parseKeywords('   ,  , ')).toEqual([]);
	});
});

describe('formatKeywords', () => {
	it('joins keywords with a comma and space', () => {
		expect(formatKeywords(['a', 'b'])).toBe('a, b');
	});

	it('renders undefined as an empty string', () => {
		expect(formatKeywords(undefined)).toBe('');
	});
});

describe('filterTemplates', () => {
	const items = [tmpl('Mute mic', ['audio']), tmpl('Open Jira', ['work', 'web']), tmpl('Plain')];

	it('returns everything for a blank query', () => {
		expect(filterTemplates(items, '   ')).toHaveLength(3);
	});

	it('matches on name, case-insensitively', () => {
		expect(filterTemplates(items, 'jira').map((t) => t.name)).toEqual(['Open Jira']);
	});

	it('matches on a keyword', () => {
		expect(filterTemplates(items, 'audio').map((t) => t.name)).toEqual(['Mute mic']);
	});
});

describe('groupTemplatesByKeyword', () => {
	it('clusters per keyword, sorts headings, and puts the keyword-less group last', () => {
		const a = tmpl('A', ['Work', 'media']);
		const b = tmpl('B', ['work']);
		const c = tmpl('C');
		const d = tmpl('D', ['Alpha']);

		const groups = groupTemplatesByKeyword([a, b, c, d]);

		expect(groups.map((g) => g.keyword)).toEqual(['Alpha', 'media', 'Work', null]);
		const work = groups.find((g) => g.keyword === 'Work');
		expect(work?.items).toEqual([a, b]);
		expect(groups.at(-1)?.items).toEqual([c]);
	});

	it('returns a single keyword-less group when nothing is tagged', () => {
		const groups = groupTemplatesByKeyword([tmpl('X'), tmpl('Y')]);

		expect(groups).toHaveLength(1);
		expect(groups[0].keyword).toBeNull();
	});
});

describe('templates.setKeywords', () => {
	it('parses and stores keywords, and clears them when blank', async () => {
		const t = await templates.save('kw', config('kw'), true);

		templates.setKeywords(t.id, 'a, a, b');
		expect(templates.items.find((x) => x.id === t.id)?.keywords).toEqual(['a', 'b']);

		templates.setKeywords(t.id, '   ');
		expect(templates.items.find((x) => x.id === t.id)?.keywords).toBeUndefined();
	});
});

describe('templates.exportJson', () => {
	it('emits a versioned envelope without runtime ids', async () => {
		await templates.save('exported', config('exported'), true);

		const parsed = JSON.parse(templates.exportJson());

		expect(parsed.version).toBe(1);
		expect(Array.isArray(parsed.templates)).toBe(true);
		expect(parsed.templates.every((t: Record<string, unknown>) => !('id' in t))).toBe(true);
	});
});

describe('templates.importJson', () => {
	it('imports a JSON envelope with fresh ids and cleaned keywords', async () => {
		const json = JSON.stringify({
			version: 1,
			templates: [{ name: 'From file', config: config('x'), keywords: ['Home', 'home', ' Work '] }]
		});
		const before = templates.items.length;

		const added = await templates.importJson(json);

		expect(added).toBe(1);
		expect(templates.items).toHaveLength(before + 1);
		const imported = templates.items.at(-1)!;
		expect(imported.name).toBe('From file');
		expect(imported.keywords).toEqual(['Home', 'Work']);
		expect(imported.config).toEqual(config('x'));
	});

	it('accepts a bare array of entries and falls back to the config label for a missing name', async () => {
		const added = await templates.importJson(JSON.stringify([{ config: config('Bare') }]));

		expect(added).toBe(1);
		expect(templates.items.at(-1)?.name).toBe('Bare');
	});

	it('skips invalid entries but keeps the valid ones', async () => {
		const json = JSON.stringify({
			templates: [{ nope: true }, { name: 'Good', config: config('g') }]
		});

		const added = await templates.importJson(json);

		expect(added).toBe(1);
		expect(templates.items.at(-1)?.name).toBe('Good');
	});

	it('throws on invalid JSON', async () => {
		await expect(templates.importJson('definitely not json')).rejects.toThrow(/JSON/);
	});

	it('throws when the file has no usable templates', async () => {
		await expect(
			templates.importJson(JSON.stringify({ templates: [{ nope: 1 }] }))
		).rejects.toThrow();
	});

	it('withholds keymap script approval when an imported template carries a transform', async () => {
		keymap.approveScripts();
		const json = JSON.stringify({
			templates: [{ name: 'Clock', config: templateConfig('Clock', 'return { x: 1 };') }]
		});

		await templates.importJson(json);

		expect(keymap.scriptsApproved).toBe(false);
	});

	it('leaves script approval untouched when no imported template has a transform', async () => {
		keymap.approveScripts();
		const json = JSON.stringify({ templates: [{ name: 'Static', config: config('static') }] });

		await templates.importJson(json);

		expect(keymap.scriptsApproved).toBe(true);
	});
});
