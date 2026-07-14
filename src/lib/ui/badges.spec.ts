import { describe, expect, it } from 'vitest';
import type { KeyAction, KeyFace } from '$lib/types.js';
import { actionBadge, faceBadge, TOGGLE_BADGE } from './badges.js';

describe('actionBadge', () => {
	it('returns undefined for a "none" action', () => {
		expect(actionBadge({ type: 'none' })).toBeUndefined();
	});

	it('maps open-url and webhook to their glyphs', () => {
		expect(actionBadge({ type: 'open-url', url: 'https://x' })?.glyph).toBe('↗');
		expect(actionBadge({ type: 'webhook', method: 'GET', url: 'https://x' })?.glyph).toBe('⚡');
	});

	it('distinguishes the three navigate targets', () => {
		const back: KeyAction = { type: 'navigate', target: 'back' };
		const next: KeyAction = { type: 'navigate', target: 'next' };
		const page: KeyAction = { type: 'navigate', target: 2 };
		expect(actionBadge(back)?.glyph).toBe('↩');
		expect(actionBadge(next)?.glyph).toBe('↪');
		expect(actionBadge(page)?.glyph).toBe('⊞');
	});

	it('gives every badge an accessible label', () => {
		expect(actionBadge({ type: 'open-url', url: 'https://x' })?.label).toMatch(/url/i);
	});
});

describe('faceBadge', () => {
	it('returns undefined for static colour and image faces', () => {
		expect(faceBadge({ type: 'color', color: '#000000' })).toBeUndefined();
		expect(faceBadge({ type: 'image', dataUrl: 'data:,' })).toBeUndefined();
	});

	it('marks remote and template faces as live', () => {
		const remote: KeyFace = { type: 'remote', url: 'https://x' };
		const template: KeyFace = { type: 'template', template: '{{x}}' };
		expect(faceBadge(remote)?.glyph).toBe('⟳');
		expect(faceBadge(template)?.glyph).toBe('{}');
	});
});

describe('TOGGLE_BADGE', () => {
	it('has a glyph and a label', () => {
		expect(TOGGLE_BADGE.glyph).toBe('⇄');
		expect(TOGGLE_BADGE.label).toMatch(/flip/i);
	});
});
