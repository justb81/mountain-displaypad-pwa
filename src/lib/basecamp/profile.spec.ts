import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import type { KeyConfig } from '$lib/types.js';
import { parseBasecampProfile, serializeBasecampProfile } from './profile.js';

const fixturePath = fileURLToPath(
	new URL('../../../examples/displaypad_cplace.xml', import.meta.url)
);
const fixture = readFileSync(fixturePath, 'utf-8');

describe('parsing the real Base Camp export', () => {
	const result = parseBasecampProfile(fixture);

	it('returns exactly one key per pad key', () => {
		expect(result.keys).toHaveLength(NUM_KEYS);
	});

	it('maps a "Run browser" key to open-url, reading the URL from CustomURL', () => {
		expect(result.keys[1].action).toEqual({
			type: 'open-url',
			url: 'https://base.cplace.io/pages/y1txfq1smt5t2978v3ghlm35u/Persoenliches-Dashboard'
		});
	});

	it('imports an inline base64 image as a face', () => {
		const face = result.keys[1].face;
		expect(face.type).toBe('image');
		expect(face.type === 'image' && face.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('downgrades an OS-level action to none and warns why', () => {
		expect(result.keys[0].action).toEqual({ type: 'none' });
		expect(result.warnings.some((w) => w.includes('M1') && w.includes('Lock computer'))).toBe(true);
	});

	it('leaves an unassigned key at its default', () => {
		expect(result.keys[4]).toEqual({
			label: 'M5',
			face: { type: 'color', color: '#000000' },
			action: { type: 'none' }
		});
	});

	it('warns about the skipped sub-menu page and only imports the top-level page', () => {
		expect(result.warnings.some((w) => w.includes('sub-menu'))).toBe(true);
		// M2's sub-page binding uses "Run Program", which never surfaces in the root-page result.
		expect(result.keys[1].action).not.toEqual({ type: 'none' });
	});

	it('falls back to a placeholder for a non-portable local image path', () => {
		// M1's root-page face is a Base Camp-bundled stock icon path, not an inline data URL.
		expect(result.keys[0].face).toEqual({ type: 'color', color: '#000000' });
		expect(result.warnings.some((w) => w.includes('M1') && w.includes("can't read"))).toBe(true);
	});

	it('carries the profile name and inline image through', () => {
		expect(result.profileName).toBe('CPLACE');
		expect(result.profileImage?.startsWith('data:image/png;base64,')).toBe(true);
	});
});

describe('parsing a toggle key (second image / IsFirstImageSelected)', () => {
	function profileWith(binding: string): string {
		return `<Profile><DeviceType>DisplayPad</DeviceType><DisplayPadKeyBindings>${binding}</DisplayPadKeyBindings></Profile>`;
	}

	function toggleBinding(isFirstImageSelected: boolean): string {
		return `<DisplayPadLayerBidings>
			<ParentId>0</ParentId>
			<KeyName>M1</KeyName>
			<FunctionType>Default</FunctionType>
			<base64Image>data:image/png;base64,AAAA</base64Image>
			<SecondBase64Image>data:image/png;base64,BBBB</SecondBase64Image>
			<IsFirstImageSelected>${isFirstImageSelected}</IsFirstImageSelected>
		</DisplayPadLayerBidings>`;
	}

	it('imports both faces, keeping them in order when the first face is selected', () => {
		const result = parseBasecampProfile(profileWith(toggleBinding(true)));
		expect(result.keys[0].face).toEqual({ type: 'image', dataUrl: 'data:image/png;base64,AAAA' });
		expect(result.keys[0].secondFace).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,BBBB'
		});
	});

	it('swaps the faces so `face` is always the currently-selected one', () => {
		const result = parseBasecampProfile(profileWith(toggleBinding(false)));
		expect(result.keys[0].face).toEqual({ type: 'image', dataUrl: 'data:image/png;base64,BBBB' });
		expect(result.keys[0].secondFace).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,AAAA'
		});
	});

	it('leaves secondFace undefined for a key with no second image', () => {
		const result = parseBasecampProfile(
			profileWith(
				`<DisplayPadLayerBidings><ParentId>0</ParentId><KeyName>M1</KeyName><FunctionType>Default</FunctionType><base64Image>data:image/png;base64,AAAA</base64Image><SecondBase64Image /></DisplayPadLayerBidings>`
			)
		);
		expect(result.keys[0].secondFace).toBeUndefined();
	});

	it('warns when the second image is a non-portable local path', () => {
		const result = parseBasecampProfile(
			profileWith(
				`<DisplayPadLayerBidings><ParentId>0</ParentId><KeyName>M1</KeyName><FunctionType>Default</FunctionType><base64Image>data:image/png;base64,AAAA</base64Image><SecondBase64Image>/images/default-profile/foo.png</SecondBase64Image><IsFirstImageSelected>true</IsFirstImageSelected></DisplayPadLayerBidings>`
			)
		);
		expect(result.keys[0].secondFace).toEqual({ type: 'color', color: '#000000' });
		expect(
			result.warnings.some(
				(w) => w.includes('M1') && w.includes('second image') && w.includes("can't read")
			)
		).toBe(true);
	});
});

describe('parsing malformed input', () => {
	it('rejects text that is not XML at all', () => {
		expect(() => parseBasecampProfile('not xml')).toThrow();
	});

	it('rejects XML without a <Profile> root', () => {
		expect(() => parseBasecampProfile('<Other></Other>')).toThrow(/Profile/);
	});

	it('returns all-default keys with a warning when there are no key bindings', () => {
		const result = parseBasecampProfile('<Profile><DeviceType>DisplayPad</DeviceType></Profile>');
		expect(result.keys).toHaveLength(NUM_KEYS);
		expect(result.warnings[0]).toMatch(/no DisplayPad key bindings/);
	});
});

describe('exporting and re-importing', () => {
	function keys(overrides: Partial<Record<number, KeyConfig>>): KeyConfig[] {
		return Array.from({ length: NUM_KEYS }, (_, i) => {
			return (
				overrides[i] ?? {
					label: `Key ${i + 1}`,
					face: { type: 'color', color: '#000000' },
					action: { type: 'none' }
				}
			);
		});
	}

	it('round-trips a browser-openable key exactly', () => {
		const source = keys({
			2: {
				label: 'Docs',
				face: { type: 'color', color: '#000000' },
				action: { type: 'open-url', url: 'https://example.com' }
			}
		});
		const { xml, warnings } = serializeBasecampProfile(source);
		expect(warnings).toHaveLength(0);

		const reimported = parseBasecampProfile(xml);
		expect(reimported.warnings).toHaveLength(0);
		expect(reimported.keys[2].action).toEqual({ type: 'open-url', url: 'https://example.com' });
	});

	it('round-trips an inline image face', () => {
		const dataUrl = 'data:image/png;base64,AAAA';
		const source = keys({
			5: { label: 'Icon', face: { type: 'image', dataUrl }, action: { type: 'none' } }
		});
		const { xml } = serializeBasecampProfile(source);
		expect(parseBasecampProfile(xml).keys[5].face).toEqual({ type: 'image', dataUrl });
	});

	it('round-trips a toggle key with both faces', () => {
		const source = keys({
			7: {
				label: 'Mic',
				face: { type: 'color', color: '#000000' },
				secondFace: { type: 'image', dataUrl: 'data:image/png;base64,BBBB' },
				action: { type: 'none' }
			}
		});
		const { xml, warnings } = serializeBasecampProfile(source);
		expect(warnings).toHaveLength(0);
		const reimported = parseBasecampProfile(xml);
		expect(reimported.keys[7].secondFace).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,BBBB'
		});
	});

	it('downgrades copy-text on export with a warning, since Base Camp has no such action', () => {
		const source = keys({
			0: {
				label: 'Snippet',
				face: { type: 'color', color: '#000000' },
				action: { type: 'copy-text', text: 'hello' }
			}
		});
		const { xml, warnings } = serializeBasecampProfile(source);
		expect(warnings.some((w) => w.includes('copy text'))).toBe(true);
		expect(parseBasecampProfile(xml).keys[0].action).toEqual({ type: 'none' });
	});

	it('rejects a keys array of the wrong length', () => {
		expect(() => serializeBasecampProfile([])).toThrow(RangeError);
	});

	it('round-trips a custom profile name and image instead of the hardcoded default', () => {
		const source = keys({});
		const { xml } = serializeBasecampProfile(source, {
			profileName: 'My Profile',
			profileImage: 'data:image/png;base64,AAAA'
		});
		const reimported = parseBasecampProfile(xml);
		expect(reimported.profileName).toBe('My Profile');
		expect(reimported.profileImage).toBe('data:image/png;base64,AAAA');
	});

	it('falls back to the default profile name when none is given', () => {
		const { xml } = serializeBasecampProfile(keys({}));
		expect(parseBasecampProfile(xml).profileName).toBe('DisplayPad Configurator');
	});
});
