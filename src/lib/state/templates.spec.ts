import { describe, expect, it } from 'vitest';
import type { KeyConfig } from '$lib/types.js';
import { templates } from './templates.svelte.js';

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
