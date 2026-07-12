<script lang="ts">
	import CodeEditor from './CodeEditor.svelte';
	import Button from './ui/Button.svelte';
	import Hint from './ui/Hint.svelte';
	import SegmentedControl from './ui/SegmentedControl.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { NUM_KEYS } from '$lib/displaypad/protocol.js';
	import { fetchFaviconDataUrl, hostnameFrom } from '$lib/displaypad/favicon.js';
	import { removeImageBackground } from '$lib/displaypad/raster.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { templates } from '$lib/state/templates.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';
	import {
		faceText,
		withFaceText,
		type KeyAction,
		type KeyFace,
		type KeyTextStyle
	} from '$lib/types.js';

	interface Props {
		index: number;
		/** Non-drag fallback for reordering: moves the config and follows selection to the new slot. */
		onmove: (index: number) => void;
	}

	let { index, onmove }: Props = $props();

	const config = $derived(keymap.keys[index]);
	const canApply = $derived(connection.status === 'connected');

	const colorFace = $derived(config.face.type === 'color' ? config.face : undefined);
	const imageFace = $derived(config.face.type === 'image' ? config.face : undefined);
	const remoteFace = $derived(config.face.type === 'remote' ? config.face : undefined);
	const templateFace = $derived(config.face.type === 'template' ? config.face : undefined);

	/**
	 * Which face type the Face segmented control shows. Diverges from `config.face.type`
	 * only briefly: picking "Image"/"Remote" reveals that type's editor without touching
	 * the key yet (an empty image/URL isn't a valid face), while "Color"/"Live" apply a
	 * sensible default immediately (mirrors the old always-editable inputs' behavior).
	 * The override is scoped to "the key currently open in the inspector" — it resets
	 * whenever a different key is selected.
	 */
	let faceKindOverride = $state<KeyFace['type'] | null>(null);
	const faceKind = $derived(faceKindOverride ?? config.face.type);
	$effect(() => {
		if (index >= 0) {
			faceKindOverride = null;
			lastAutoIconUrl = '';
			clearTimeout(iconDebounce);
		}
	});

	let secondFaceKindOverride = $state<'color' | 'image' | null>(null);
	const secondFaceKind = $derived(
		secondFaceKindOverride ?? (config.secondFace?.type === 'image' ? 'image' : 'color')
	);
	$effect(() => {
		if (index >= 0) secondFaceKindOverride = null;
	});

	let imageFileInput = $state<HTMLInputElement>();
	let secondImageFileInput = $state<HTMLInputElement>();

	let savingTemplate = $state(false);
	let templateName = $state('');

	function startSaveTemplate() {
		templateName = config.label;
		savingTemplate = true;
	}

	async function confirmSaveTemplate() {
		const name = templateName.trim() || config.label;
		await templates.save(name, config, keymap.scriptsApproved);
		savingTemplate = false;
		toast.success(`Saved "${name}" to the template stash.`);
	}

	async function applyToPad() {
		await connection.applyKey(index);
		const liveError = connection.liveFaceErrors[index];
		if (liveError) toast.error(liveError);
		else toast.success(`Applied Key ${index + 1} to the pad.`);
	}

	let removingBackground = $state(false);
	let removingSecondBackground = $state(false);
	let backgroundError = $state<string | undefined>(undefined);

	function moveTo(target: number) {
		if (target < 0 || target >= NUM_KEYS || target === index) return;
		keymap.swap(index, target);
		if (connection.status === 'connected') {
			void connection.applyKey(index);
			void connection.applyKey(target);
		}
		onmove(target);
	}

	function resetKey() {
		keymap.resetKey(index);
		connection.syncLiveTimer(index);
		faceKindOverride = null;
		secondFaceKindOverride = null;
		toast.info(`Key ${index + 1} reset.`);
	}

	function setColor(color: string) {
		keymap.update(index, { face: { type: 'color', color, text: faceText(config.face) } });
	}

	function onFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () =>
			keymap.update(index, {
				face: { type: 'image', dataUrl: String(reader.result), text: faceText(config.face) }
			});
		reader.readAsDataURL(file);
	}

	function setRemoteUrl(url: string) {
		const current = config.face.type === 'remote' ? config.face : undefined;
		keymap.update(index, {
			face: {
				type: 'remote',
				url,
				refreshMinutes: current?.refreshMinutes,
				refreshOnPress: current?.refreshOnPress,
				text: faceText(config.face)
			}
		});
		connection.syncLiveTimer(index);
	}

	/**
	 * Starter HTML for a freshly-enabled template face: sized to fill the key
	 * (`width/height:100%` + `border-box`) so it renders correctly out of the
	 * box — a bare `<div>` without these defaults to its content's natural
	 * size, leaving the rest of the key uncovered (black once applied).
	 */
	const TEMPLATE_STARTER = `<div style="width:100%;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-family:sans-serif;text-align:center;">
  Hello
</div>`;

	function setTemplateFace() {
		const current = config.face.type === 'template' ? config.face : undefined;
		keymap.update(index, {
			face: {
				type: 'template',
				template: current?.template ?? TEMPLATE_STARTER,
				transform: current?.transform,
				refreshMinutes: current?.refreshMinutes,
				refreshOnPress: current?.refreshOnPress
			}
		});
		connection.syncLiveTimer(index);
	}

	/** Drives the Face segmented control. Color/Live apply a default immediately; Image/Remote just switch the visible editor until real content is provided. */
	function setFaceKind(kind: string) {
		const next = kind as KeyFace['type'];
		faceKindOverride = next;
		if (next === 'color') setColor(config.face.type === 'color' ? config.face.color : '#000000');
		else if (next === 'template') setTemplateFace();
	}

	function setTemplate(template: string) {
		if (config.face.type !== 'template') return;
		keymap.update(index, { face: { ...config.face, template } });
	}

	function setTransform(transform: string) {
		if (config.face.type !== 'template') return;
		keymap.update(index, { face: { ...config.face, transform: transform || undefined } });
	}

	function setTemplateRefreshMinutes(minutes: number) {
		if (config.face.type !== 'template') return;
		keymap.update(index, {
			face: { ...config.face, refreshMinutes: minutes > 0 ? minutes : undefined }
		});
		connection.syncLiveTimer(index);
	}

	function setTemplateRefreshOnPress(refreshOnPress: boolean) {
		if (config.face.type !== 'template') return;
		keymap.update(index, { face: { ...config.face, refreshOnPress } });
		connection.syncLiveTimer(index);
	}

	/** Toggle whether the key's face carries a burned-on text label (unavailable for a `template` face). */
	function toggleFaceText(enabled: boolean) {
		if (config.face.type === 'template') return;
		if (enabled) {
			updateFaceText({ text: config.face.text?.text || config.label });
		} else {
			keymap.update(index, { face: withFaceText(config.face, undefined) });
		}
	}

	/** Merge a patch into the face's text label, filling in defaults for a freshly-enabled label. */
	function updateFaceText(patch: Partial<KeyTextStyle>) {
		if (config.face.type === 'template') return;
		const text: KeyTextStyle = {
			text: '',
			color: '#ffffff',
			align: 'center',
			...config.face.text,
			...patch
		};
		keymap.update(index, { face: withFaceText(config.face, text) });
	}

	function setRemoteRefreshMinutes(minutes: number) {
		if (config.face.type !== 'remote') return;
		keymap.update(index, {
			face: { ...config.face, refreshMinutes: minutes > 0 ? minutes : undefined }
		});
		connection.syncLiveTimer(index);
	}

	function setRemoteRefreshOnPress(refreshOnPress: boolean) {
		if (config.face.type !== 'remote') return;
		keymap.update(index, { face: { ...config.face, refreshOnPress } });
		connection.syncLiveTimer(index);
	}

	function toggleSecondFace(enabled: boolean) {
		keymap.update(index, {
			secondFace: enabled ? { type: 'color', color: '#000000' } : undefined
		});
	}

	/** Drives the second-face segmented control (Color/Image only — no live sources for a toggle's flip side). */
	function setSecondFaceKind(kind: string) {
		const next = kind as 'color' | 'image';
		secondFaceKindOverride = next;
		if (next === 'color') {
			setSecondColor(config.secondFace?.type === 'color' ? config.secondFace.color : '#000000');
		}
	}

	function setSecondColor(color: string) {
		keymap.update(index, {
			secondFace: { type: 'color', color, text: faceText(config.secondFace) }
		});
	}

	function onSecondFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () =>
			keymap.update(index, {
				secondFace: {
					type: 'image',
					dataUrl: String(reader.result),
					text: faceText(config.secondFace)
				}
			});
		reader.readAsDataURL(file);
	}

	/** Toggle whether the toggle key's second face carries a burned-on text label (unavailable for a `template` face). */
	function toggleSecondFaceText(enabled: boolean) {
		if (!config.secondFace || config.secondFace.type === 'template') return;
		if (enabled) {
			updateSecondFaceText({ text: config.secondFace.text?.text || config.label });
		} else {
			keymap.update(index, { secondFace: withFaceText(config.secondFace, undefined) });
		}
	}

	/** Merge a patch into the second face's text label, filling in defaults for a freshly-enabled label. */
	function updateSecondFaceText(patch: Partial<KeyTextStyle>) {
		if (!config.secondFace || config.secondFace.type === 'template') return;
		const text: KeyTextStyle = {
			text: '',
			color: '#ffffff',
			align: 'center',
			...config.secondFace.text,
			...patch
		};
		keymap.update(index, { secondFace: withFaceText(config.secondFace, text) });
	}

	async function removeBackground() {
		if (config.face.type !== 'image') return;
		removingBackground = true;
		backgroundError = undefined;
		try {
			const dataUrl = await removeImageBackground(config.face.dataUrl);
			keymap.update(index, { face: { type: 'image', dataUrl, text: faceText(config.face) } });
		} catch {
			backgroundError = 'Could not remove the background from this image.';
		} finally {
			removingBackground = false;
		}
	}

	async function removeSecondBackground() {
		if (config.secondFace?.type !== 'image') return;
		removingSecondBackground = true;
		backgroundError = undefined;
		try {
			const dataUrl = await removeImageBackground(config.secondFace.dataUrl);
			keymap.update(index, {
				secondFace: { type: 'image', dataUrl, text: config.secondFace.text }
			});
		} catch {
			backgroundError = 'Could not remove the background from this image.';
		} finally {
			removingSecondBackground = false;
		}
	}

	/** Debounce window before a freshly-typed Open URL auto-populates the key icon. */
	const ICON_DEBOUNCE_MS = 700;
	let loadingIcon = $state(false);
	/** The Open URL we last auto-loaded an icon for, so an unchanged URL isn't refetched. */
	let lastAutoIconUrl = '';
	let iconDebounce: ReturnType<typeof setTimeout>;

	/** A never-customised default face — the only face auto-icon is allowed to overwrite. */
	function isBlankFace(face: KeyFace): boolean {
		return face.type === 'color' && face.color === '#000000' && !face.text;
	}

	/** Update the Open URL target and, on a still-blank key, schedule an auto icon fetch. */
	function setOpenUrl(url: string) {
		keymap.update(index, { action: { type: 'open-url', url } });
		clearTimeout(iconDebounce);
		if (!isBlankFace(config.face) || !hostnameFrom(url)) return;
		const forIndex = index;
		iconDebounce = setTimeout(() => void autoLoadIcon(url, forIndex), ICON_DEBOUNCE_MS);
	}

	/** Best-effort auto-populate: fill an untouched key with the site's icon, quietly doing nothing on failure. */
	async function autoLoadIcon(url: string, forIndex: number) {
		if (url === lastAutoIconUrl) return;
		const dataUrl = await fetchFaviconDataUrl(url);
		if (!dataUrl) return;
		// Bail if selection moved, the URL was edited again, or the face is no longer blank.
		const cfg = keymap.keys[forIndex];
		if (forIndex !== index || cfg?.action.type !== 'open-url' || cfg.action.url !== url) return;
		if (!isBlankFace(cfg.face)) return;
		lastAutoIconUrl = url;
		keymap.update(forIndex, { face: { type: 'image', dataUrl } });
	}

	/** Explicit "Use site icon" button — fetches the icon and overwrites the current face (keeping any text label). */
	async function loadIconNow() {
		if (config.action.type !== 'open-url') return;
		const url = config.action.url;
		if (!hostnameFrom(url)) return;
		loadingIcon = true;
		try {
			const dataUrl = await fetchFaviconDataUrl(url);
			if (!dataUrl) {
				toast.error('Could not find an icon for that URL.');
				return;
			}
			lastAutoIconUrl = url;
			keymap.update(index, { face: { type: 'image', dataUrl, text: faceText(config.face) } });
			toast.success('Loaded the site icon.');
		} finally {
			loadingIcon = false;
		}
	}

	function setActionType(type: KeyAction['type']) {
		const action: KeyAction =
			type === 'open-url'
				? { type, url: '' }
				: type === 'copy-text'
					? { type, text: '' }
					: type === 'webhook'
						? { type, method: 'POST', url: '' }
						: type === 'open-folder'
							? { type, page: keymap.addPage() }
							: type === 'back'
								? { type }
								: { type: 'none' };
		keymap.update(index, { action });
	}

	function setFolderTarget(page: number) {
		keymap.update(index, { action: { type: 'open-folder', page } });
	}

	/** Merge a patch into the current webhook action (no-op if the action isn't a webhook). */
	function updateWebhook(patch: Partial<Extract<KeyAction, { type: 'webhook' }>>) {
		if (config.action.type !== 'webhook') return;
		keymap.update(index, { action: { ...config.action, ...patch } });
	}

	// Custom headers are edited as `Name: Value` lines; kept in local state so typing
	// blank/partial lines stays smooth, and parsed into the action's record on input.
	let headersText = $state('');
	$effect(() => {
		// Re-seed the textarea whenever a different key (or a non-webhook action) is selected.
		const headers = config.action.type === 'webhook' ? config.action.headers : undefined;
		headersText = headers
			? Object.entries(headers)
					.map(([name, value]) => `${name}: ${value}`)
					.join('\n')
			: '';
	});

	function setHeaders(text: string) {
		headersText = text;
		const headers: Record<string, string> = {};
		for (const line of text.split('\n')) {
			const colon = line.indexOf(':');
			if (colon === -1) continue;
			const name = line.slice(0, colon).trim();
			const value = line.slice(colon + 1).trim();
			if (name) headers[name] = value;
		}
		updateWebhook({ headers: Object.keys(headers).length ? headers : undefined });
	}

	/** Inline JSON-parse validation for the POST body — null when empty or valid. */
	const bodyError = $derived.by(() => {
		if (config.action.type !== 'webhook' || config.action.method !== 'POST') return null;
		const body = config.action.body;
		if (!body || !body.trim()) return null;
		try {
			JSON.parse(body);
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	});
</script>

<section class="flex flex-col gap-5 rounded-panel bg-slate-800 p-5">
	<header class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
		<h2 class="text-h1 font-semibold text-white">Key {index + 1}</h2>
		<div class="flex items-center gap-2">
			<Button
				size="sm"
				onclick={() => moveTo(index - 1)}
				disabled={index === 0}
				aria-label="Move key left"
				title="Move key left"
			>
				&larr;
			</Button>
			<Button
				size="sm"
				onclick={() => moveTo(index + 1)}
				disabled={index === NUM_KEYS - 1}
				aria-label="Move key right"
				title="Move key right"
			>
				&rarr;
			</Button>
			<Button variant="success" onclick={() => void applyToPad()} disabled={!canApply}>
				Apply to pad
			</Button>
			<Button size="sm" onclick={resetKey} aria-label="Reset key" title="Reset key to default">
				Reset
			</Button>
		</div>
	</header>

	{#if savingTemplate}
		<div class="flex items-center gap-2">
			<input
				class="min-w-0 flex-1 rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
				placeholder="Template name"
				value={templateName}
				oninput={(e) => (templateName = e.currentTarget.value)}
				onkeydown={(e) => e.key === 'Enter' && confirmSaveTemplate()}
			/>
			<Button variant="success" size="sm" onclick={confirmSaveTemplate}>Save</Button>
			<Button size="sm" onclick={() => (savingTemplate = false)}>Cancel</Button>
		</div>
	{:else}
		<Button size="sm" class="self-start" onclick={startSaveTemplate}>Save as template</Button>
	{/if}

	<label class="flex flex-col gap-1 text-label text-slate-300">
		<span class="font-medium text-slate-200">Label</span>
		<input
			class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-body text-white"
			value={config.label}
			oninput={(e) => keymap.update(index, { label: e.currentTarget.value })}
		/>
	</label>

	<fieldset class="flex flex-col gap-3 text-body text-slate-300">
		<legend class="mb-1 text-h2 font-semibold text-white">Face</legend>
		<SegmentedControl
			name={`face-kind-${index}`}
			value={faceKind}
			onchange={setFaceKind}
			options={[
				{ value: 'color', label: 'Color' },
				{ value: 'image', label: 'Image' },
				{ value: 'remote', label: 'Remote' },
				{ value: 'template', label: 'Live' }
			]}
		/>

		{#if faceKind === 'color'}
			<div class="flex items-center gap-3">
				<span class="h-10 w-10 flex-none overflow-hidden rounded-control border border-line">
					<input
						type="color"
						class="h-[150%] w-[150%] -translate-x-1/4 -translate-y-1/4 cursor-pointer border-0 p-0"
						value={colorFace?.color ?? '#000000'}
						oninput={(e) => setColor(e.currentTarget.value)}
					/>
				</span>
				<Hint>A solid colour fill for the whole key.</Hint>
			</div>
		{:else if faceKind === 'image'}
			<div class="flex items-center gap-3">
				{#if imageFace}
					<img
						src={imageFace.dataUrl}
						alt="Key preview"
						class="h-14 w-14 flex-none rounded-control border border-line object-cover"
					/>
				{:else}
					<span
						class="flex h-14 w-14 flex-none items-center justify-center rounded-control border border-dashed border-line-strong text-caption text-slate-500"
					>
						None
					</span>
				{/if}
				<div class="flex flex-col items-start gap-1.5">
					<Button size="sm" onclick={() => imageFileInput?.click()}>Choose image…</Button>
					<input
						bind:this={imageFileInput}
						type="file"
						accept="image/*"
						onchange={onFile}
						class="hidden"
					/>
					{#if imageFace}
						<Button
							size="sm"
							variant="ghost"
							onclick={() => void removeBackground()}
							disabled={removingBackground}
						>
							{removingBackground ? 'Removing background…' : 'Remove background'}
						</Button>
					{/if}
				</div>
			</div>
			{#if backgroundError}<Hint tone="danger">{backgroundError}</Hint>{/if}
		{:else if faceKind === 'remote'}
			<label class="flex flex-col gap-1">
				<span class="text-label font-medium text-slate-200">Image URL</span>
				<input
					type="url"
					placeholder="https://example.com/face.png"
					value={remoteFace?.url ?? ''}
					oninput={(e) => setRemoteUrl(e.currentTarget.value)}
					class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
				/>
			</label>
			{#if remoteFace}
				<div class="flex flex-wrap items-center gap-4 text-label text-slate-400">
					<label class="flex items-center gap-1.5">
						Refresh every
						<input
							type="number"
							min="1"
							placeholder="off"
							value={remoteFace.refreshMinutes ?? ''}
							oninput={(e) => setRemoteRefreshMinutes(Number(e.currentTarget.value))}
							class="w-16 rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
						/>
						min
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={remoteFace.refreshOnPress ?? false}
							onchange={(e) => setRemoteRefreshOnPress(e.currentTarget.checked)}
						/>
						<span>Refresh on press</span>
					</label>
				</div>
				<Hint>
					Endpoint must allow cross-origin GET (CORS). SVG responses are rasterised to PNG.
				</Hint>
				{#if connection.liveFaceErrors[index]}
					<Hint tone="danger">{connection.liveFaceErrors[index]}</Hint>
				{/if}
			{/if}
		{:else if faceKind === 'template' && templateFace}
			<div class="flex flex-col gap-3">
				<label class="flex flex-col gap-1">
					<span class="text-label font-medium text-slate-200">Template (HTML + Mustache)</span>
					<CodeEditor value={templateFace.template} language="handlebars" onChange={setTemplate} />
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-label font-medium text-slate-200">Transform (optional)</span>
					<CodeEditor
						value={templateFace.transform ?? ''}
						language="javascript"
						onChange={setTransform}
					/>
					<Hint>
						Optional sandboxed async JS — has <code>fetch</code>, <code>Date</code>, and a
						<code>ctx</code> argument; must return a plain object.
					</Hint>
				</label>
				<div class="flex flex-wrap items-center gap-4 text-label text-slate-400">
					<label class="flex items-center gap-1.5">
						Refresh every
						<input
							type="number"
							min="1"
							placeholder="off"
							value={templateFace.refreshMinutes ?? ''}
							oninput={(e) => setTemplateRefreshMinutes(Number(e.currentTarget.value))}
							class="w-16 rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
						/>
						min
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={templateFace.refreshOnPress ?? false}
							onchange={(e) => setTemplateRefreshOnPress(e.currentTarget.checked)}
						/>
						<span>Refresh on press</span>
					</label>
				</div>
				<Hint>
					The transform runs in a sandboxed, opaque-origin iframe with no access to this app — only
					<code>fetch</code> and <code>Date</code>. Its result is rendered through the template with
					Mustache (<code>{'{{var}}'}</code> escapes HTML, <code>{'{{{var}}}'}</code> doesn't).
				</Hint>
				<Hint>
					Size your root element to <code>width:100%;height:100%</code> (with
					<code>box-sizing:border-box</code>) to cover the whole key — anything it doesn't reach
					renders black, same as an unset key.
				</Hint>
				{#if templateFace.transform && !keymap.scriptsApproved}
					<Hint tone="warning">
						This script came from an imported profile and won't run until you approve it in Profile
						tools.
					</Hint>
				{/if}
				{#if connection.liveFaceErrors[index]}
					<Hint tone="danger">{connection.liveFaceErrors[index]}</Hint>
				{/if}
			</div>
		{/if}
	</fieldset>

	{#if config.face.type !== 'template'}
		<fieldset class="flex flex-col gap-2 text-body text-slate-300">
			<legend class="mb-1 text-h2 font-semibold text-white">Text label (burned onto the key)</legend
			>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={!!config.face.text}
					onchange={(e) => toggleFaceText(e.currentTarget.checked)}
				/>
				<span>Render a text label onto this face</span>
			</label>
			{#if config.face.text}
				<label class="flex items-center gap-2">
					<input
						class="min-w-0 flex-1 rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
						value={config.face.text.text}
						oninput={(e) => updateFaceText({ text: e.currentTarget.value })}
					/>
				</label>
				<div class="flex flex-wrap items-center gap-4 pl-1 text-label text-slate-400">
					<label class="flex items-center gap-1.5">
						<input
							type="color"
							value={config.face.text.color}
							oninput={(e) => updateFaceText({ color: e.currentTarget.value })}
						/>
						Colour
					</label>
					<label class="flex items-center gap-1.5">
						Align
						<select
							class="rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
							value={config.face.text.align}
							onchange={(e) =>
								updateFaceText({ align: e.currentTarget.value as KeyTextStyle['align'] })}
						>
							<option value="top">Top</option>
							<option value="center">Center</option>
							<option value="bottom">Bottom</option>
						</select>
					</label>
					<label class="flex items-center gap-1.5">
						Size
						<input
							type="number"
							min="1"
							value={config.face.text.fontSize ?? ''}
							placeholder="14"
							oninput={(e) =>
								updateFaceText({ fontSize: Number(e.currentTarget.value) || undefined })}
							class="w-14 rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
						/>
						px
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={config.face.text.bold ?? false}
							onchange={(e) => updateFaceText({ bold: e.currentTarget.checked || undefined })}
						/>
						Bold
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={config.face.text.italic ?? false}
							onchange={(e) => updateFaceText({ italic: e.currentTarget.checked || undefined })}
						/>
						Italic
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={config.face.text.underline ?? false}
							onchange={(e) => updateFaceText({ underline: e.currentTarget.checked || undefined })}
						/>
						Underline
					</label>
				</div>
			{/if}
		</fieldset>
	{/if}

	<fieldset class="flex flex-col gap-3 text-body text-slate-300">
		<legend class="mb-1 text-h2 font-semibold text-white">Toggle key (second face)</legend>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				checked={!!config.secondFace}
				onchange={(e) => toggleSecondFace(e.currentTarget.checked)}
			/>
			<span>Flip to a second face on each press</span>
		</label>
		{#if config.secondFace}
			<SegmentedControl
				name={`second-face-kind-${index}`}
				value={secondFaceKind}
				onchange={setSecondFaceKind}
				options={[
					{ value: 'color', label: 'Color' },
					{ value: 'image', label: 'Image' }
				]}
			/>

			{#if secondFaceKind === 'color'}
				<div class="flex items-center gap-3">
					<span class="h-10 w-10 flex-none overflow-hidden rounded-control border border-line">
						<input
							type="color"
							class="h-[150%] w-[150%] -translate-x-1/4 -translate-y-1/4 cursor-pointer border-0 p-0"
							value={config.secondFace.type === 'color' ? config.secondFace.color : '#000000'}
							oninput={(e) => setSecondColor(e.currentTarget.value)}
						/>
					</span>
					<Hint>A solid colour fill shown after the key is pressed.</Hint>
				</div>
			{:else}
				<div class="flex items-center gap-3">
					{#if config.secondFace.type === 'image'}
						<img
							src={config.secondFace.dataUrl}
							alt="Second face preview"
							class="h-14 w-14 flex-none rounded-control border border-line object-cover"
						/>
					{:else}
						<span
							class="flex h-14 w-14 flex-none items-center justify-center rounded-control border border-dashed border-line-strong text-caption text-slate-500"
						>
							None
						</span>
					{/if}
					<div class="flex flex-col items-start gap-1.5">
						<Button size="sm" onclick={() => secondImageFileInput?.click()}>Choose image…</Button>
						<input
							bind:this={secondImageFileInput}
							type="file"
							accept="image/*"
							onchange={onSecondFile}
							class="hidden"
						/>
						{#if config.secondFace.type === 'image'}
							<Button
								size="sm"
								variant="ghost"
								onclick={() => void removeSecondBackground()}
								disabled={removingSecondBackground}
							>
								{removingSecondBackground ? 'Removing background…' : 'Remove background'}
							</Button>
						{/if}
					</div>
				</div>
			{/if}
			{#if backgroundError}<Hint tone="danger">{backgroundError}</Hint>{/if}

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={!!faceText(config.secondFace)}
					onchange={(e) => toggleSecondFaceText(e.currentTarget.checked)}
				/>
				<span>Render a text label onto this face</span>
			</label>
			{#if config.secondFace.type !== 'template' && config.secondFace.text}
				<label class="flex items-center gap-2">
					<input
						class="min-w-0 flex-1 rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
						value={config.secondFace.text.text}
						oninput={(e) => updateSecondFaceText({ text: e.currentTarget.value })}
					/>
				</label>
				<div class="flex flex-wrap items-center gap-4 pl-1 text-label text-slate-400">
					<label class="flex items-center gap-1.5">
						<input
							type="color"
							value={config.secondFace.text.color}
							oninput={(e) => updateSecondFaceText({ color: e.currentTarget.value })}
						/>
						Colour
					</label>
					<label class="flex items-center gap-1.5">
						Align
						<select
							class="rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
							value={config.secondFace.text.align}
							onchange={(e) =>
								updateSecondFaceText({ align: e.currentTarget.value as KeyTextStyle['align'] })}
						>
							<option value="top">Top</option>
							<option value="center">Center</option>
							<option value="bottom">Bottom</option>
						</select>
					</label>
					<label class="flex items-center gap-1.5">
						Size
						<input
							type="number"
							min="1"
							value={config.secondFace.text.fontSize ?? ''}
							placeholder="14"
							oninput={(e) =>
								updateSecondFaceText({ fontSize: Number(e.currentTarget.value) || undefined })}
							class="w-14 rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
						/>
						px
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={config.secondFace.text.bold ?? false}
							onchange={(e) => updateSecondFaceText({ bold: e.currentTarget.checked || undefined })}
						/>
						Bold
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={config.secondFace.text.italic ?? false}
							onchange={(e) =>
								updateSecondFaceText({ italic: e.currentTarget.checked || undefined })}
						/>
						Italic
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={config.secondFace.text.underline ?? false}
							onchange={(e) =>
								updateSecondFaceText({ underline: e.currentTarget.checked || undefined })}
						/>
						Underline
					</label>
				</div>
			{/if}
		{/if}
	</fieldset>

	<label class="flex flex-col gap-1 text-body text-slate-300">
		<span class="text-h2 font-semibold text-white">Action</span>
		<select
			class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
			value={config.action.type}
			onchange={(e) => setActionType(e.currentTarget.value as KeyAction['type'])}
		>
			<option value="none">Do nothing</option>
			<option value="open-url">Open URL</option>
			<option value="copy-text">Copy text</option>
			<option value="webhook">Webhook (HTTP request)</option>
			<option value="open-folder">Open folder (jump to another page)</option>
			<option value="back">Back (return to the previous page)</option>
		</select>
	</label>

	{#if config.action.type === 'open-url'}
		<div class="flex items-center gap-2">
			<input
				class="min-w-0 flex-1 rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
				placeholder="https://example.com"
				value={config.action.url}
				oninput={(e) => setOpenUrl(e.currentTarget.value)}
			/>
			<Button
				size="sm"
				onclick={() => void loadIconNow()}
				disabled={loadingIcon || !hostnameFrom(config.action.url)}
			>
				{loadingIcon ? 'Loading…' : 'Use site icon'}
			</Button>
		</div>
		<Hint>
			A blank key auto-loads the site's icon when you enter a URL. "Use site icon" fetches it (favicon,
			app or social image, via unavatar.io) for an already-styled key too.
		</Hint>
		{#if connection.popupBlockedErrors[index]}
			<Hint tone="danger">{connection.popupBlockedErrors[index]}</Hint>
		{/if}
	{:else if config.action.type === 'copy-text'}
		<input
			class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
			placeholder="Text to copy"
			value={config.action.text}
			oninput={(e) =>
				keymap.update(index, { action: { type: 'copy-text', text: e.currentTarget.value } })}
		/>
	{:else if config.action.type === 'open-folder'}
		<div class="flex items-center gap-2 text-body text-slate-300">
			<select
				class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
				value={config.action.page}
				onchange={(e) => setFolderTarget(Number(e.currentTarget.value))}
			>
				{#each Array.from({ length: keymap.pageCount }, (_, i) => i) as pageIndex (pageIndex)}
					<option value={pageIndex}>{keymap.pageName(pageIndex)}</option>
				{/each}
			</select>
			<Button size="sm" onclick={() => setFolderTarget(keymap.addPage())}>+ New page</Button>
		</div>
	{:else if config.action.type === 'back'}
		<Hint>Returns to whichever page this key's folder was entered from.</Hint>
	{:else if config.action.type === 'webhook'}
		<div class="flex flex-col gap-3 text-body text-slate-300">
			<div class="flex gap-2">
				<label class="flex flex-col gap-1">
					<span class="text-label font-medium text-slate-200">Method</span>
					<select
						class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
						value={config.action.method}
						onchange={(e) => updateWebhook({ method: e.currentTarget.value as 'GET' | 'POST' })}
					>
						<option value="GET">GET</option>
						<option value="POST">POST</option>
					</select>
				</label>
				<label class="flex min-w-0 flex-1 flex-col gap-1">
					<span class="text-label font-medium text-slate-200">URL</span>
					<input
						type="url"
						placeholder="https://example.com/webhook"
						value={config.action.url}
						oninput={(e) => updateWebhook({ url: e.currentTarget.value })}
						class="min-w-0 rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
					/>
				</label>
			</div>

			{#if config.action.method === 'POST'}
				<label class="flex flex-col gap-1">
					<span class="text-label font-medium text-slate-200">JSON body</span>
					<textarea
						rows="4"
						placeholder={'{\n  "on": true\n}'}
						value={config.action.body ?? ''}
						oninput={(e) => updateWebhook({ body: e.currentTarget.value })}
						class="rounded-control border border-line bg-slate-900 px-2 py-1.5 font-mono text-white"
					></textarea>
				</label>
				{#if bodyError}<Hint tone="danger">Invalid JSON: {bodyError}</Hint>{/if}
			{/if}

			<label class="flex flex-col gap-1">
				<span class="text-label font-medium text-slate-200">Custom headers</span>
				<Hint>One <code>Name: Value</code> per line.</Hint>
				<textarea
					rows="2"
					placeholder="Authorization: Bearer …"
					value={headersText}
					oninput={(e) => setHeaders(e.currentTarget.value)}
					class="rounded-control border border-line bg-slate-900 px-2 py-1.5 font-mono text-white"
				></textarea>
			</label>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={config.action.noCors ?? false}
					onchange={(e) => updateWebhook({ noCors: e.currentTarget.checked || undefined })}
				/>
				<span>Fire-and-forget (<code>no-cors</code>) — for trigger-only endpoints without CORS</span
				>
			</label>
			<Hint>
				The request goes straight from your browser. A cross-origin endpoint must send CORS headers,
				or enable <code>no-cors</code> above (the response is then unreadable).
			</Hint>
		</div>
	{/if}
</section>
