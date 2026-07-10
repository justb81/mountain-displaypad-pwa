/**
 * Import/export for Mountain Base Camp `<Profile>` XML files.
 *
 * Base Camp's schema is shared across Mountain's whole product line and supports
 * nested "folder" pages our flat 12-key grid doesn't model, plus several OS-level
 * actions (locking the PC, launching a local .exe, global hotkeys, ...) a browser
 * sandbox categorically can't perform. This module always returns a full 12-key
 * result — never throws over *partial* data — and instead collects a `warnings`
 * list describing what didn't survive. See docs/basecamp-import-export.md.
 *
 * Pure and Node-testable, like the protocol layer: no browser/DOM APIs.
 */

import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { NUM_KEYS } from '$lib/displaypad/protocol.js';
import type { KeyAction, KeyConfig, KeyFace } from '$lib/types.js';

/** Result of importing a Base Camp profile: every page plus what didn't survive. */
export interface BasecampImportResult {
	/** One 12-key grid per page; `pages[0]` is the pad's top-level/root page. */
	pages: KeyConfig[][];
	warnings: string[];
	/** The profile's own name (`<ProfileName>`), if the file set one. */
	profileName?: string;
	/** The profile's own thumbnail (`<ImagePath>`) as a data URL, if inline. */
	profileImage?: string;
}

/** Profile-level identity carried through export alongside the keymap. */
export interface BasecampProfileMeta {
	profileName?: string;
	profileImage?: string;
}

/** Result of exporting a keymap: the XML document plus what didn't survive. */
export interface BasecampExportResult {
	xml: string;
	warnings: string[];
}

/** Hardware key ids for M1..M12 in order — fixed by the device, not sequential. */
const KEY_IDS = [170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 220, 221];

/** DLL matrix indices for M1..M12 in order — fixed by the device, not sequential. */
const DLL_MATRIX_INDICES = [8, 17, 26, 35, 44, 53, 62, 71, 80, 89, 98, 125];

const DEFAULT_COLOR = '#000000';

const parser = new XMLParser({
	ignoreAttributes: true,
	isArray: (name) => name === 'DisplayPadLayerBidings'
});

const builder = new XMLBuilder({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	format: true
});

interface RawBinding {
	ParentId?: number;
	KeyName?: string;
	FunctionType?: string;
	SubFunctionType?: string;
	CustomURL?: string;
	base64Image?: string;
	OptionalText?: string;
	SecondBase64Image?: string;
	IsFirstImageSelected?: boolean;
}

interface RawProfile {
	DeviceType?: string;
	ProfileName?: string;
	ImagePath?: string;
	DisplayPadKeyBindings?: { DisplayPadLayerBidings?: RawBinding[] };
}

function defaultKey(index: number): KeyConfig {
	return {
		label: `Key ${index + 1}`,
		face: { type: 'color', color: DEFAULT_COLOR },
		action: { type: 'none' }
	};
}

/** Parse a Base Camp `<Profile>` XML export into a 12-key configuration. */
export function parseBasecampProfile(xmlText: string): BasecampImportResult {
	const warnings: string[] = [];

	let doc: { Profile?: RawProfile };
	try {
		doc = parser.parse(xmlText) as { Profile?: RawProfile };
	} catch (err) {
		throw new Error(`Not a valid XML file: ${err instanceof Error ? err.message : String(err)}`, {
			cause: err
		});
	}

	const profile = doc.Profile;
	if (!profile)
		throw new Error('Not a Mountain Base Camp profile: missing a <Profile> root element.');

	if (profile.DeviceType && profile.DeviceType !== 'DisplayPad') {
		warnings.push(
			`This profile was saved for a "${profile.DeviceType}", not a DisplayPad — importing whatever DisplayPad key bindings it contains anyway.`
		);
	}

	const profileName = profile.ProfileName?.trim() || undefined;
	const profileImage = profile.ImagePath?.startsWith('data:image/') ? profile.ImagePath : undefined;

	const bindings = profile.DisplayPadKeyBindings?.DisplayPadLayerBidings ?? [];
	if (bindings.length === 0) {
		warnings.push('This profile has no DisplayPad key bindings — nothing to import.');
		return {
			pages: [Array.from({ length: NUM_KEYS }, (_, i) => defaultKey(i))],
			warnings,
			profileName,
			profileImage
		};
	}

	const pages = buildPages(bindings, warnings);
	return { pages, warnings, profileName, profileImage };
}

/**
 * Walk the `ParentId` tree into a flat list of pages, starting from the
 * top-level page (`ParentId === 0`). A "Create Folder" key's sub-page is
 * linked via the trigger key's own `OptionalText.Id` — see docs/basecamp-import-export.md §4.2.
 * Sub-pages nobody's "Create Folder" key points to are reported and dropped.
 */
function buildPages(bindings: RawBinding[], warnings: string[]): KeyConfig[][] {
	const byParent = new Map<number, RawBinding[]>();
	for (const binding of bindings) {
		const parentId = binding.ParentId ?? 0;
		const list = byParent.get(parentId);
		if (list) list.push(binding);
		else byParent.set(parentId, [binding]);
	}

	const pages: KeyConfig[][] = [];
	const linked = new Set<number>([0]);

	function buildPage(parentId: number, ancestry: Set<number>): number {
		const pageIndex = pages.length;
		const keys = Array.from({ length: NUM_KEYS }, (_, i) => defaultKey(i));
		pages.push(keys);

		const childAncestry = new Set(ancestry);
		childAncestry.add(parentId);

		for (const binding of byParent.get(parentId) ?? []) {
			const match = /^M(\d+)$/.exec(binding.KeyName ?? '');
			const index = match ? Number(match[1]) - 1 : -1;
			if (index < 0 || index >= NUM_KEYS) {
				warnings.push(`Skipped a key with an unrecognised name "${binding.KeyName}".`);
				continue;
			}

			const { config, folderTriggerId } = keyConfigFromBinding(binding, index, warnings);
			if (folderTriggerId === undefined) {
				keys[index] = config;
				continue;
			}

			if (childAncestry.has(folderTriggerId)) {
				warnings.push(
					`${binding.KeyName}: its "Create Folder" page folds back into one of its own ancestor pages — imported without an action.`
				);
				keys[index] = config;
			} else if (byParent.has(folderTriggerId)) {
				linked.add(folderTriggerId);
				const childPage = buildPage(folderTriggerId, childAncestry);
				keys[index] = { ...config, action: { type: 'open-folder', page: childPage } };
			} else {
				warnings.push(
					`${binding.KeyName}: its "Create Folder" sub-page is empty — imported without an action.`
				);
				keys[index] = config;
			}
		}

		return pageIndex;
	}

	buildPage(0, new Set());

	const orphanCount = [...byParent.keys()].filter(
		(parentId) => parentId !== 0 && !linked.has(parentId)
	).length;
	if (orphanCount > 0) {
		warnings.push(
			`This profile has ${orphanCount} sub-menu page${orphanCount === 1 ? '' : 's'} that no key links to — skipped.`
		);
	}

	return pages;
}

function keyConfigFromBinding(
	binding: RawBinding,
	index: number,
	warnings: string[]
): { config: KeyConfig; folderTriggerId?: number } {
	const keyLabel = binding.KeyName || `Key ${index + 1}`;

	let title: string | undefined;
	let optionalId: number | undefined;
	if (binding.OptionalText) {
		try {
			const optional = JSON.parse(binding.OptionalText) as { TextTitle?: string; Id?: number };
			title = optional.TextTitle;
			optionalId = optional.Id;
		} catch {
			// Not valid JSON — fall back to the key name below.
		}
	}
	const label = title?.trim() || keyLabel;

	let face = resolveFace(binding.base64Image, keyLabel, 'image', warnings);
	let secondFace: KeyFace | undefined;
	if (binding.SecondBase64Image) {
		secondFace = resolveFace(binding.SecondBase64Image, keyLabel, 'second image', warnings);
	}
	// Normalize so `face` is always the currently-selected state: our runtime toggle
	// starts at state 0 (`face`) and flips to state 1 (`secondFace`) on each press.
	if (secondFace && binding.IsFirstImageSelected === false) {
		[face, secondFace] = [secondFace, face];
	}

	let action: KeyAction = { type: 'none' };
	let folderTriggerId: number | undefined;
	if (binding.FunctionType === 'Run browser' && binding.CustomURL) {
		action = { type: 'open-url', url: binding.CustomURL };
	} else if (binding.FunctionType === 'Create Folder') {
		if (optionalId !== undefined) {
			// Finalized by the caller once the sub-page's index is known.
			folderTriggerId = optionalId;
		} else {
			warnings.push(
				`${keyLabel}: "Create Folder" is missing its sub-page id — imported without an action.`
			);
		}
	} else if (binding.FunctionType === 'Back') {
		action = { type: 'back' };
	} else if (binding.FunctionType && binding.FunctionType !== 'Default') {
		const detail = binding.SubFunctionType
			? `${binding.FunctionType} → ${binding.SubFunctionType}`
			: binding.FunctionType;
		warnings.push(
			`${keyLabel}: "${detail}" isn't something a browser can do — imported without an action.`
		);
	}

	return {
		config: { label, face, ...(secondFace ? { secondFace } : {}), action },
		folderTriggerId
	};
}

/** Resolve one `base64Image`-shaped field to a face, warning if it's a non-portable local path. */
function resolveFace(
	base64Image: string | undefined,
	keyLabel: string,
	fieldLabel: 'image' | 'second image',
	warnings: string[]
): KeyFace {
	if (base64Image?.startsWith('data:image/')) {
		return { type: 'image', dataUrl: base64Image };
	}
	if (base64Image) {
		warnings.push(
			`${keyLabel}: its ${fieldLabel} is a file on the original PC (${base64Image}), which a browser can't read — imported without an icon.`
		);
	}
	return { type: 'color', color: DEFAULT_COLOR };
}

/** Serialize a keymap's pages into a Base Camp `<Profile>` XML export, walking every `open-folder` link. */
export function serializeBasecampProfile(
	pages: KeyConfig[][],
	meta: BasecampProfileMeta = {}
): BasecampExportResult {
	if (pages.length === 0 || pages.some((page) => page.length !== NUM_KEYS)) {
		throw new RangeError(`Each page must have ${NUM_KEYS} keys.`);
	}

	const warnings: string[] = [];
	const now = new Date().toISOString();
	const bindings: ReturnType<typeof bindingFromKeyConfig>['binding'][] = [];
	let nextFolderId = 1;

	function walk(pageIndex: number, parentId: number, ancestry: Set<number>): void {
		if (pageIndex < 0 || pageIndex >= pages.length) {
			warnings.push(
				`A key points at page ${pageIndex + 1}, which doesn't exist — exported without a destination.`
			);
			return;
		}
		if (ancestry.has(pageIndex)) {
			warnings.push(
				`Page ${pageIndex + 1} folds back into one of its own ancestor pages — exported without following the cycle.`
			);
			return;
		}
		const childAncestry = new Set(ancestry);
		childAncestry.add(pageIndex);

		for (const [index, key] of pages[pageIndex].entries()) {
			const { binding, folderId, childPage } = bindingFromKeyConfig(
				key,
				index,
				now,
				warnings,
				parentId,
				() => nextFolderId++
			);
			bindings.push(binding);
			if (childPage !== undefined && folderId !== undefined)
				walk(childPage, folderId, childAncestry);
		}
	}

	walk(0, 0, new Set());

	const doc = {
		'?xml': { '@_version': '1.0', '@_encoding': 'utf-8' },
		Profile: {
			'@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'@_xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
			ProfileId: 1,
			Id: 1,
			DeviceType: 'DisplayPad',
			ProfileName: meta.profileName || 'DisplayPad Configurator',
			OrderNo: 1,
			ImagePath: meta.profileImage ?? '',
			IsSelected: 1,
			modified_at: now,
			IsDefaultProfileImage: !meta.profileImage,
			IsCloseExeTracking: false,
			MakaluLightings: '',
			MakaluKeyBindings: '',
			MakaluSettings: '',
			EverestLightings: '',
			EverestKeyBindings: '',
			Everest60Lightings: '',
			Everest60KeyBindings: '',
			Everest60Settings: '',
			DisplayPadKeyBindings: { DisplayPadLayerBidings: bindings }
		}
	};

	return { xml: builder.build(doc) as string, warnings };
}

function bindingFromKeyConfig(
	key: KeyConfig,
	index: number,
	timestamp: string,
	warnings: string[],
	parentId: number,
	allocateFolderId: () => number
): { binding: Record<string, unknown>; folderId?: number; childPage?: number } {
	const keyName = `M${index + 1}`;
	let action = key.action;
	if (action.type === 'copy-text') {
		warnings.push(
			`${keyName} ("${key.label}"): "copy text" has no equivalent in the DisplayPad profile format — exported as unassigned.`
		);
		action = { type: 'none' };
	} else if (action.type === 'webhook') {
		warnings.push(
			`${keyName} ("${key.label}"): "webhook" has no equivalent in the DisplayPad profile format — exported as unassigned.`
		);
		action = { type: 'none' };
	}

	let functionType = 'Default';
	let subFunctionType = '';
	let functionValue = '';
	let optionalText = '';
	let folderId: number | undefined;
	let childPage: number | undefined;

	if (action.type === 'open-url') {
		functionType = 'Run browser';
		subFunctionType = 'Run browser';
		functionValue = 'Run browser';
	} else if (action.type === 'open-folder') {
		folderId = allocateFolderId();
		childPage = action.page;
		functionType = 'Create Folder';
		subFunctionType = key.label;
		functionValue = key.label;
		optionalText = JSON.stringify({ Id: folderId, TextTitle: key.label });
	} else if (action.type === 'back') {
		functionType = 'Back';
		functionValue = 'Back';
	}
	const isBrowserAction = action.type === 'open-url';

	return {
		binding: {
			ProfileId: 1,
			ParentId: parentId,
			KeyId: KEY_IDS[index],
			KeyName: keyName,
			KeyNameFull: `SW${index + 1}(${keyName})`,
			IsKeyAssigned: isBrowserAction,
			IsTouchKey: true,
			FunctionType: functionType,
			SubFunctionType: subFunctionType,
			FunctionValue: functionValue,
			FunctionEnteredValue: '',
			OnPressRelease: 'Press',
			IsSyncAcrossProfiles: false,
			base64Image: key.face.type === 'image' ? key.face.dataUrl : '',
			ImageFilePath: '',
			IsDefaultTouchKeyImage: key.face.type !== 'image',
			modified_at: timestamp,
			DLLKeyId: KEY_IDS[index],
			DLLKeyName: keyName,
			DLLMatrixIndex: DLL_MATRIX_INDICES[index],
			CustomURL: action.type === 'open-url' ? action.url : undefined,
			IsActive: parentId === 0,
			OptionalText: optionalText,
			SecondBase64Image: key.secondFace?.type === 'image' ? key.secondFace.dataUrl : '',
			SecondImageFilePath: '',
			SecondOptionalText: '',
			IsSecondDefaultTouchKeyImage: key.secondFace?.type !== 'image',
			IsHardWarePress: false,
			// `face` always round-trips as the first/selected state; `secondFace` (if any) as the second.
			IsFirstImageSelected: true,
			IsFirstImageDeleted: false,
			IsSecondImageDeleted: false
		},
		folderId,
		childPage
	};
}
