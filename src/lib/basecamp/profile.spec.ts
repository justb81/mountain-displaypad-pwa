import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import { faceText } from '$lib/types.js';
import type { KeyConfig } from '$lib/types.js';
import { parseBasecampProfile, serializeBasecampProfile } from './profile.js';

const fixturePath = fileURLToPath(
	new URL('../../../examples/displaypad_cplace.xml', import.meta.url)
);
const fixture = readFileSync(fixturePath, 'utf-8');

describe('parsing the real Base Camp export', () => {
	const result = parseBasecampProfile(fixture);

	it('returns two pages: the root page plus the one sub-menu it links to', () => {
		expect(result.pages).toHaveLength(2);
		expect(result.pages[0]).toHaveLength(NUM_KEYS);
		expect(result.pages[1]).toHaveLength(NUM_KEYS);
	});

	it('maps the "Create Folder" key to an open-folder action pointing at the sub-page', () => {
		expect(result.pages[0][5].action).toEqual({ type: 'open-folder', page: 1 });
	});

	it('maps the sub-page\'s "Back" key to a back action', () => {
		expect(result.pages[1][0].action).toEqual({ type: 'back' });
	});

	it('maps a "Run browser" key to open-url, reading the URL from CustomURL', () => {
		expect(result.pages[0][1].action).toEqual({
			type: 'open-url',
			url: 'https://base.cplace.io/pages/y1txfq1smt5t2978v3ghlm35u/Persoenliches-Dashboard'
		});
	});

	it('imports an inline base64 image as a face', () => {
		const face = result.pages[0][1].face;
		expect(face.type).toBe('image');
		expect(face.type === 'image' && face.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('downgrades an OS-level action to none and warns why', () => {
		expect(result.pages[0][0].action).toEqual({ type: 'none' });
		expect(result.warnings.some((w) => w.includes('M1') && w.includes('Lock computer'))).toBe(true);
	});

	it('leaves an unassigned key at its default', () => {
		expect(result.pages[0][4]).toEqual({
			label: 'M5',
			face: { type: 'color', color: '#000000' },
			action: { type: 'none' }
		});
	});

	it("imports the sub-page's bindings instead of dropping them", () => {
		// The sub-page's M2 uses "Run Program" — an OS-level action we can't perform,
		// but it still proves the binding was read (and downgraded, not discarded).
		expect(result.warnings.some((w) => w.includes('Run Program') && w.includes('ReSI.exe'))).toBe(
			true
		);
	});

	it('falls back to a placeholder for a non-portable local image path', () => {
		// M1's root-page face is a Base Camp-bundled stock icon path, not an inline data URL.
		expect(result.pages[0][0].face).toEqual({ type: 'color', color: '#000000' });
		expect(result.warnings.some((w) => w.includes('M1') && w.includes("can't read"))).toBe(true);
	});

	it('carries the profile name and inline image through', () => {
		expect(result.profileName).toBe('CPLACE');
		expect(result.profileImage?.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('parses the full OptionalText style block onto the face, not just the title', () => {
		// M10 ("Discuss"): Center-aligned, default weight.
		expect(faceText(result.pages[0][9].face)).toEqual({
			text: 'Discuss',
			color: '#ffffff',
			align: 'center',
			fontFamily: 'Arial',
			fontSize: 12
		});
		// M12 ("Citizen Dev"): Bottom-aligned label over its inline image face.
		expect(result.pages[0][11].face.type).toBe('image');
		expect(faceText(result.pages[0][11].face)).toEqual({
			text: 'Citizen Dev',
			color: '#ffffff',
			align: 'bottom',
			fontFamily: 'Arial',
			fontSize: 12
		});
	});
});

describe('parsing multi-page / folder navigation', () => {
	function profileWith(bindings: string): string {
		return `<Profile><DeviceType>DisplayPad</DeviceType><DisplayPadKeyBindings>${bindings}</DisplayPadKeyBindings></Profile>`;
	}

	it('links a "Create Folder" key to its sub-page via OptionalText.Id', () => {
		const xml = profileWith(`
			<DisplayPadLayerBidings>
				<ParentId>0</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
				<OptionalText>{"Id":42,"TextTitle":"Sub"}</OptionalText>
			</DisplayPadLayerBidings>
			<DisplayPadLayerBidings>
				<ParentId>42</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Back</FunctionType>
			</DisplayPadLayerBidings>
		`);
		const result = parseBasecampProfile(xml);
		expect(result.pages).toHaveLength(2);
		expect(result.pages[0][0].action).toEqual({ type: 'open-folder', page: 1 });
		expect(result.pages[0][0].label).toBe('Sub');
		expect(result.pages[1][0].action).toEqual({ type: 'back' });
	});

	it('supports folders nested more than one level deep', () => {
		const xml = profileWith(`
			<DisplayPadLayerBidings>
				<ParentId>0</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
				<OptionalText>{"Id":10}</OptionalText>
			</DisplayPadLayerBidings>
			<DisplayPadLayerBidings>
				<ParentId>10</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
				<OptionalText>{"Id":20}</OptionalText>
			</DisplayPadLayerBidings>
			<DisplayPadLayerBidings>
				<ParentId>20</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Back</FunctionType>
			</DisplayPadLayerBidings>
		`);
		const result = parseBasecampProfile(xml);
		expect(result.pages).toHaveLength(3);
		expect(result.pages[0][0].action).toEqual({ type: 'open-folder', page: 1 });
		expect(result.pages[1][0].action).toEqual({ type: 'open-folder', page: 2 });
		expect(result.pages[2][0].action).toEqual({ type: 'back' });
	});

	it('warns and skips a "Create Folder" key when its sub-page id is missing', () => {
		const xml = profileWith(`
			<DisplayPadLayerBidings>
				<ParentId>0</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
			</DisplayPadLayerBidings>
		`);
		const result = parseBasecampProfile(xml);
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0][0].action).toEqual({ type: 'none' });
		expect(result.warnings.some((w) => w.includes('missing its sub-page id'))).toBe(true);
	});

	it('warns and skips a "Create Folder" key whose sub-page has no bindings', () => {
		const xml = profileWith(`
			<DisplayPadLayerBidings>
				<ParentId>0</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
				<OptionalText>{"Id":99}</OptionalText>
			</DisplayPadLayerBidings>
		`);
		const result = parseBasecampProfile(xml);
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0][0].action).toEqual({ type: 'none' });
		expect(result.warnings.some((w) => w.includes('sub-page is empty'))).toBe(true);
	});

	it('reports sub-menu pages that no key links to', () => {
		const xml = profileWith(`
			<DisplayPadLayerBidings>
				<ParentId>0</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Default</FunctionType>
			</DisplayPadLayerBidings>
			<DisplayPadLayerBidings>
				<ParentId>77</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Default</FunctionType>
			</DisplayPadLayerBidings>
		`);
		const result = parseBasecampProfile(xml);
		expect(result.pages).toHaveLength(1);
		expect(
			result.warnings.some((w) => w.includes('sub-menu page') && w.includes('no key links to'))
		).toBe(true);
	});

	it('does not infinitely recurse when a folder link cycles back to an ancestor', () => {
		const xml = profileWith(`
			<DisplayPadLayerBidings>
				<ParentId>0</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
				<OptionalText>{"Id":5}</OptionalText>
			</DisplayPadLayerBidings>
			<DisplayPadLayerBidings>
				<ParentId>5</ParentId>
				<KeyName>M1</KeyName>
				<FunctionType>Create Folder</FunctionType>
				<OptionalText>{"Id":0}</OptionalText>
			</DisplayPadLayerBidings>
		`);
		const result = parseBasecampProfile(xml);
		expect(result.pages).toHaveLength(2);
		expect(result.pages[1][0].action).toEqual({ type: 'none' });
		expect(result.warnings.some((w) => w.includes('folds back'))).toBe(true);
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
		expect(result.pages[0][0].face).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,AAAA'
		});
		expect(result.pages[0][0].secondFace).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,BBBB'
		});
	});

	it('swaps the faces so `face` is always the currently-selected one', () => {
		const result = parseBasecampProfile(profileWith(toggleBinding(false)));
		expect(result.pages[0][0].face).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,BBBB'
		});
		expect(result.pages[0][0].secondFace).toEqual({
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
		expect(result.pages[0][0].secondFace).toBeUndefined();
	});

	it('warns when the second image is a non-portable local path', () => {
		const result = parseBasecampProfile(
			profileWith(
				`<DisplayPadLayerBidings><ParentId>0</ParentId><KeyName>M1</KeyName><FunctionType>Default</FunctionType><base64Image>data:image/png;base64,AAAA</base64Image><SecondBase64Image>/images/default-profile/foo.png</SecondBase64Image><IsFirstImageSelected>true</IsFirstImageSelected></DisplayPadLayerBidings>`
			)
		);
		expect(result.pages[0][0].secondFace).toEqual({ type: 'color', color: '#000000' });
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
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0]).toHaveLength(NUM_KEYS);
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
		const { xml, warnings } = serializeBasecampProfile([source]);
		expect(warnings).toHaveLength(0);

		const reimported = parseBasecampProfile(xml);
		expect(reimported.warnings).toHaveLength(0);
		expect(reimported.pages[0][2].action).toEqual({ type: 'open-url', url: 'https://example.com' });
	});

	it('round-trips an inline image face', () => {
		const dataUrl = 'data:image/png;base64,AAAA';
		const source = keys({
			5: { label: 'Icon', face: { type: 'image', dataUrl }, action: { type: 'none' } }
		});
		const { xml } = serializeBasecampProfile([source]);
		expect(parseBasecampProfile(xml).pages[0][5].face).toEqual({ type: 'image', dataUrl });
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
		const { xml, warnings } = serializeBasecampProfile([source]);
		expect(warnings).toHaveLength(0);
		const reimported = parseBasecampProfile(xml);
		expect(reimported.pages[0][7].secondFace).toEqual({
			type: 'image',
			dataUrl: 'data:image/png;base64,BBBB'
		});
	});

	it('round-trips a two-page profile linked by an open-folder key, with a back key on the sub-page', () => {
		const root = keys({
			0: {
				label: 'Sub menu',
				face: { type: 'color', color: '#000000' },
				action: { type: 'open-folder', page: 1 }
			}
		});
		const sub = keys({
			0: { label: 'Back', face: { type: 'color', color: '#000000' }, action: { type: 'back' } },
			1: {
				label: 'Docs',
				face: { type: 'color', color: '#000000' },
				action: { type: 'open-url', url: 'https://example.com' }
			}
		});
		const { xml, warnings } = serializeBasecampProfile([root, sub]);
		expect(warnings).toHaveLength(0);

		const reimported = parseBasecampProfile(xml);
		expect(reimported.warnings).toHaveLength(0);
		expect(reimported.pages).toHaveLength(2);
		expect(reimported.pages[0][0].action).toEqual({ type: 'open-folder', page: 1 });
		expect(reimported.pages[1][0].action).toEqual({ type: 'back' });
		expect(reimported.pages[1][1].action).toEqual({
			type: 'open-url',
			url: 'https://example.com'
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
		const { xml, warnings } = serializeBasecampProfile([source]);
		expect(warnings.some((w) => w.includes('copy text'))).toBe(true);
		expect(parseBasecampProfile(xml).pages[0][0].action).toEqual({ type: 'none' });
	});

	it('downgrades a webhook action on export with a warning, since Base Camp has no such action', () => {
		const source = keys({
			3: {
				label: 'Toggle light',
				face: { type: 'color', color: '#000000' },
				action: {
					type: 'webhook',
					method: 'POST',
					url: 'https://example.com/hook',
					body: '{"on":true}'
				}
			}
		});
		const { xml, warnings } = serializeBasecampProfile([source]);
		expect(warnings.some((w) => w.includes('webhook'))).toBe(true);
		expect(parseBasecampProfile(xml).pages[0][3].action).toEqual({ type: 'none' });
	});

	it('rejects a keys array of the wrong length', () => {
		expect(() => serializeBasecampProfile([[]])).toThrow(RangeError);
	});

	it('rejects an empty page list', () => {
		expect(() => serializeBasecampProfile([])).toThrow(RangeError);
	});

	it('round-trips a text label burned onto a colour-fallback face', () => {
		const source = keys({
			8: {
				label: 'Citizen Dev',
				face: {
					type: 'color',
					color: '#000000',
					text: {
						text: 'Citizen Dev',
						color: '#ff0000',
						align: 'bottom',
						fontFamily: 'Arial',
						fontSize: 16,
						bold: true
					}
				},
				action: { type: 'none' }
			}
		});
		const { xml, warnings } = serializeBasecampProfile([source]);
		expect(warnings).toHaveLength(0);
		expect(parseBasecampProfile(xml).pages[0][8].face).toEqual({
			type: 'color',
			color: '#000000',
			text: {
				text: 'Citizen Dev',
				color: '#ff0000',
				align: 'bottom',
				fontFamily: 'Arial',
				fontSize: 16,
				bold: true
			}
		});
	});

	it('round-trips a text label on the second face independently of the first', () => {
		const source = keys({
			6: {
				label: 'Mic',
				face: { type: 'color', color: '#000000' },
				secondFace: {
					type: 'image',
					dataUrl: 'data:image/png;base64,BBBB',
					text: { text: 'Muted', color: '#ffffff', align: 'top' }
				},
				action: { type: 'none' }
			}
		});
		const { xml } = serializeBasecampProfile([source]);
		const reimported = parseBasecampProfile(xml);
		expect(faceText(reimported.pages[0][6].face)).toBeUndefined();
		expect(faceText(reimported.pages[0][6].secondFace)).toEqual({
			text: 'Muted',
			color: '#ffffff',
			align: 'top',
			fontFamily: 'Arial',
			fontSize: 12
		});
	});

	it('omits OptionalText entirely for a face with no label', () => {
		const source = keys({});
		const { xml, warnings } = serializeBasecampProfile([source]);
		expect(warnings).toHaveLength(0);
		expect(parseBasecampProfile(xml).pages[0].every((k) => faceText(k.face) === undefined)).toBe(
			true
		);
	});

	it('round-trips a custom profile name and image instead of the hardcoded default', () => {
		const source = keys({});
		const { xml } = serializeBasecampProfile([source], {
			profileName: 'My Profile',
			profileImage: 'data:image/png;base64,AAAA'
		});
		const reimported = parseBasecampProfile(xml);
		expect(reimported.profileName).toBe('My Profile');
		expect(reimported.profileImage).toBe('data:image/png;base64,AAAA');
	});

	it('falls back to the default profile name when none is given', () => {
		const { xml } = serializeBasecampProfile([keys({})]);
		expect(parseBasecampProfile(xml).profileName).toBe('DisplayPad Configurator');
	});
});
