<script lang="ts">
	import CodeEditor from './CodeEditor.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { NUM_KEYS } from '$lib/displaypad/protocol.js';
	import { removeImageBackground } from '$lib/displaypad/raster.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { templates } from '$lib/state/templates.svelte.js';
	import { faceText, withFaceText, type KeyAction, type KeyTextStyle } from '$lib/types.js';

	interface Props {
		index: number;
		/** Non-drag fallback for reordering: moves the config and follows selection to the new slot. */
		onmove: (index: number) => void;
	}

	let { index, onmove }: Props = $props();

	const config = $derived(keymap.keys[index]);
	const canApply = $derived(connection.status === 'connected');

	let savingTemplate = $state(false);
	let templateName = $state('');

	function startSaveTemplate() {
		templateName = config.label;
		savingTemplate = true;
	}

	async function confirmSaveTemplate() {
		await templates.save(templateName.trim() || config.label, config);
		savingTemplate = false;
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

<section class="flex flex-col gap-4 rounded-2xl bg-slate-800 p-5">
	<header class="flex items-center justify-between">
		<h2 class="text-lg font-semibold text-white">Key {index + 1}</h2>
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => moveTo(index - 1)}
				disabled={index === 0}
				aria-label="Move key left"
				title="Move key left"
				class="rounded border border-slate-600 px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
			>
				&larr;
			</button>
			<button
				type="button"
				onclick={() => moveTo(index + 1)}
				disabled={index === NUM_KEYS - 1}
				aria-label="Move key right"
				title="Move key right"
				class="rounded border border-slate-600 px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
			>
				&rarr;
			</button>
			<button
				type="button"
				onclick={() => void connection.applyKey(index)}
				disabled={!canApply}
				class="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
			>
				Apply to pad
			</button>
		</div>
	</header>

	{#if savingTemplate}
		<div class="flex items-center gap-2 text-sm">
			<input
				class="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
				placeholder="Template name"
				value={templateName}
				oninput={(e) => (templateName = e.currentTarget.value)}
				onkeydown={(e) => e.key === 'Enter' && confirmSaveTemplate()}
			/>
			<button
				type="button"
				onclick={confirmSaveTemplate}
				class="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
			>
				Save
			</button>
			<button
				type="button"
				onclick={() => (savingTemplate = false)}
				class="rounded border border-slate-600 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
			>
				Cancel
			</button>
		</div>
	{:else}
		<button
			type="button"
			onclick={startSaveTemplate}
			class="self-start rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
		>
			Save as template
		</button>
	{/if}

	<label class="flex flex-col gap-1 text-sm text-slate-300">
		Label
		<input
			class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
			value={config.label}
			oninput={(e) => keymap.update(index, { label: e.currentTarget.value })}
		/>
	</label>

	<fieldset class="flex flex-col gap-2 text-sm text-slate-300">
		<legend class="mb-1">Face</legend>
		<label class="flex items-center gap-2">
			<input
				type="color"
				value={config.face.type === 'color' ? config.face.color : '#000000'}
				oninput={(e) => setColor(e.currentTarget.value)}
			/>
			Solid colour
		</label>
		<label class="flex items-center gap-2">
			Image
			<input type="file" accept="image/*" onchange={onFile} class="text-slate-400" />
		</label>
		{#if config.face.type === 'image'}
			<div class="flex items-center gap-2">
				<img src={config.face.dataUrl} alt="Key preview" class="h-16 w-16 rounded object-cover" />
				<button
					type="button"
					onclick={() => void removeBackground()}
					disabled={removingBackground}
					class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{removingBackground ? 'Removing…' : 'Remove background'}
				</button>
			</div>
		{/if}
		{#if backgroundError}
			<p class="pl-1 text-xs text-rose-400">{backgroundError}</p>
		{/if}
		<label class="flex items-center gap-2">
			Remote URL
			<input
				type="url"
				placeholder="https://example.com/face.png"
				value={config.face.type === 'remote' ? config.face.url : ''}
				oninput={(e) => setRemoteUrl(e.currentTarget.value)}
				class="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
			/>
		</label>
		{#if config.face.type === 'remote'}
			<div class="flex flex-wrap items-center gap-3 pl-1 text-xs text-slate-400">
				<label class="flex items-center gap-1">
					Refresh every
					<input
						type="number"
						min="1"
						placeholder="off"
						value={config.face.refreshMinutes ?? ''}
						oninput={(e) => setRemoteRefreshMinutes(Number(e.currentTarget.value))}
						class="w-16 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-white"
					/>
					min
				</label>
				<label class="flex items-center gap-1">
					<input
						type="checkbox"
						checked={config.face.refreshOnPress ?? false}
						onchange={(e) => setRemoteRefreshOnPress(e.currentTarget.checked)}
					/>
					Refresh on press
				</label>
			</div>
			<p class="pl-1 text-xs text-slate-500">
				Endpoint must allow cross-origin GET (CORS). SVG responses are rasterised to PNG.
			</p>
			{#if connection.liveFaceErrors[index]}
				<p class="pl-1 text-xs text-rose-400">{connection.liveFaceErrors[index]}</p>
			{/if}
		{/if}

		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				checked={config.face.type === 'template'}
				onchange={(e) => (e.currentTarget.checked ? setTemplateFace() : setColor('#000000'))}
			/>
			Template (transform + Mustache HTML, rendered to the key)
		</label>
		{#if config.face.type === 'template'}
			<div class="flex flex-col gap-2 pl-1">
				<label class="flex flex-col gap-1 text-xs text-slate-400">
					Template (HTML + Mustache)
					<CodeEditor value={config.face.template} language="handlebars" onChange={setTemplate} />
				</label>
				<label class="flex flex-col gap-1 text-xs text-slate-400">
					Transform (optional sandboxed JS — has <code>fetch</code>, <code>Date</code>, and a
					<code>ctx</code> argument; must return a plain object)
					<CodeEditor
						value={config.face.transform ?? ''}
						language="javascript"
						onChange={setTransform}
					/>
				</label>
				<div class="flex flex-wrap items-center gap-3 text-xs text-slate-400">
					<label class="flex items-center gap-1">
						Refresh every
						<input
							type="number"
							min="1"
							placeholder="off"
							value={config.face.refreshMinutes ?? ''}
							oninput={(e) => setTemplateRefreshMinutes(Number(e.currentTarget.value))}
							class="w-16 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-white"
						/>
						min
					</label>
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							checked={config.face.refreshOnPress ?? false}
							onchange={(e) => setTemplateRefreshOnPress(e.currentTarget.checked)}
						/>
						Refresh on press
					</label>
				</div>
				<p class="text-xs text-slate-500">
					The transform runs in a sandboxed, opaque-origin iframe with no access to this app — only
					<code>fetch</code> and <code>Date</code>. Its result is rendered through the template with
					Mustache (<code>{'{{var}}'}</code> escapes HTML, <code>{'{{{var}}}'}</code> doesn't).
				</p>
				<p class="text-xs text-slate-500">
					Size your root element to <code>width:100%;height:100%</code> (with
					<code>box-sizing:border-box</code>) to cover the whole key — anything it doesn't
					reach renders black, same as an unset key.
				</p>
				{#if config.face.transform && !keymap.scriptsApproved}
					<p class="text-xs text-amber-400">
						This script came from an imported profile and won't run until you approve it in Profile
						tools.
					</p>
				{/if}
				{#if connection.liveFaceErrors[index]}
					<p class="text-xs text-rose-400">{connection.liveFaceErrors[index]}</p>
				{/if}
			</div>
		{/if}
	</fieldset>

	{#if config.face.type !== 'template'}
		<fieldset class="flex flex-col gap-2 text-sm text-slate-300">
			<legend class="mb-1">Text label (burned onto the key)</legend>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={!!config.face.text}
					onchange={(e) => toggleFaceText(e.currentTarget.checked)}
				/>
				Render a text label onto this face
			</label>
			{#if config.face.text}
				<label class="flex items-center gap-2">
					<input
						class="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
						value={config.face.text.text}
						oninput={(e) => updateFaceText({ text: e.currentTarget.value })}
					/>
				</label>
				<div class="flex flex-wrap items-center gap-3 pl-1 text-xs text-slate-400">
					<label class="flex items-center gap-1">
						<input
							type="color"
							value={config.face.text.color}
							oninput={(e) => updateFaceText({ color: e.currentTarget.value })}
						/>
						Colour
					</label>
					<label class="flex items-center gap-1">
						Align
						<select
							class="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-white"
							value={config.face.text.align}
							onchange={(e) =>
								updateFaceText({ align: e.currentTarget.value as KeyTextStyle['align'] })}
						>
							<option value="top">Top</option>
							<option value="center">Center</option>
							<option value="bottom">Bottom</option>
						</select>
					</label>
					<label class="flex items-center gap-1">
						Size
						<input
							type="number"
							min="1"
							value={config.face.text.fontSize ?? ''}
							placeholder="14"
							oninput={(e) =>
								updateFaceText({ fontSize: Number(e.currentTarget.value) || undefined })}
							class="w-14 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-white"
						/>
						px
					</label>
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							checked={config.face.text.bold ?? false}
							onchange={(e) => updateFaceText({ bold: e.currentTarget.checked || undefined })}
						/>
						Bold
					</label>
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							checked={config.face.text.italic ?? false}
							onchange={(e) => updateFaceText({ italic: e.currentTarget.checked || undefined })}
						/>
						Italic
					</label>
					<label class="flex items-center gap-1">
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

	<fieldset class="flex flex-col gap-2 text-sm text-slate-300">
		<legend class="mb-1">Toggle key (second face)</legend>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				checked={!!config.secondFace}
				onchange={(e) => toggleSecondFace(e.currentTarget.checked)}
			/>
			Flip to a second face on each press
		</label>
		{#if config.secondFace}
			<label class="flex items-center gap-2">
				<input
					type="color"
					value={config.secondFace.type === 'color' ? config.secondFace.color : '#000000'}
					oninput={(e) => setSecondColor(e.currentTarget.value)}
				/>
				Solid colour
			</label>
			<label class="flex items-center gap-2">
				Image
				<input type="file" accept="image/*" onchange={onSecondFile} class="text-slate-400" />
			</label>
			{#if config.secondFace.type === 'image'}
				<div class="flex items-center gap-2">
					<img
						src={config.secondFace.dataUrl}
						alt="Second face preview"
						class="h-16 w-16 rounded object-cover"
					/>
					<button
						type="button"
						onclick={() => void removeSecondBackground()}
						disabled={removingSecondBackground}
						class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{removingSecondBackground ? 'Removing…' : 'Remove background'}
					</button>
				</div>
			{/if}
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={!!faceText(config.secondFace)}
					onchange={(e) => toggleSecondFaceText(e.currentTarget.checked)}
				/>
				Render a text label onto this face
			</label>
			{#if config.secondFace.type !== 'template' && config.secondFace.text}
				<label class="flex items-center gap-2">
					<input
						class="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
						value={config.secondFace.text.text}
						oninput={(e) => updateSecondFaceText({ text: e.currentTarget.value })}
					/>
				</label>
				<div class="flex flex-wrap items-center gap-3 pl-1 text-xs text-slate-400">
					<label class="flex items-center gap-1">
						<input
							type="color"
							value={config.secondFace.text.color}
							oninput={(e) => updateSecondFaceText({ color: e.currentTarget.value })}
						/>
						Colour
					</label>
					<label class="flex items-center gap-1">
						Align
						<select
							class="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-white"
							value={config.secondFace.text.align}
							onchange={(e) =>
								updateSecondFaceText({ align: e.currentTarget.value as KeyTextStyle['align'] })}
						>
							<option value="top">Top</option>
							<option value="center">Center</option>
							<option value="bottom">Bottom</option>
						</select>
					</label>
					<label class="flex items-center gap-1">
						Size
						<input
							type="number"
							min="1"
							value={config.secondFace.text.fontSize ?? ''}
							placeholder="14"
							oninput={(e) =>
								updateSecondFaceText({ fontSize: Number(e.currentTarget.value) || undefined })}
							class="w-14 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-white"
						/>
						px
					</label>
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							checked={config.secondFace.text.bold ?? false}
							onchange={(e) => updateSecondFaceText({ bold: e.currentTarget.checked || undefined })}
						/>
						Bold
					</label>
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							checked={config.secondFace.text.italic ?? false}
							onchange={(e) =>
								updateSecondFaceText({ italic: e.currentTarget.checked || undefined })}
						/>
						Italic
					</label>
					<label class="flex items-center gap-1">
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

	<label class="flex flex-col gap-1 text-sm text-slate-300">
		Action
		<select
			class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
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
		<input
			class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
			placeholder="https://example.com"
			value={config.action.url}
			oninput={(e) =>
				keymap.update(index, { action: { type: 'open-url', url: e.currentTarget.value } })}
		/>
	{:else if config.action.type === 'copy-text'}
		<input
			class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
			placeholder="Text to copy"
			value={config.action.text}
			oninput={(e) =>
				keymap.update(index, { action: { type: 'copy-text', text: e.currentTarget.value } })}
		/>
	{:else if config.action.type === 'open-folder'}
		<div class="flex items-center gap-2 text-sm text-slate-300">
			<select
				class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
				value={config.action.page}
				onchange={(e) => setFolderTarget(Number(e.currentTarget.value))}
			>
				{#each Array.from({ length: keymap.pageCount }, (_, i) => i) as pageIndex (pageIndex)}
					<option value={pageIndex}>Page {pageIndex + 1}{pageIndex === 0 ? ' (home)' : ''}</option>
				{/each}
			</select>
			<button
				type="button"
				onclick={() => setFolderTarget(keymap.addPage())}
				class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
			>
				+ New page
			</button>
		</div>
	{:else if config.action.type === 'back'}
		<p class="text-xs text-slate-500">
			Returns to whichever page this key's folder was entered from.
		</p>
	{:else if config.action.type === 'webhook'}
		<div class="flex flex-col gap-2 text-sm text-slate-300">
			<div class="flex gap-2">
				<label class="flex flex-col gap-1">
					Method
					<select
						class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
						value={config.action.method}
						onchange={(e) => updateWebhook({ method: e.currentTarget.value as 'GET' | 'POST' })}
					>
						<option value="GET">GET</option>
						<option value="POST">POST</option>
					</select>
				</label>
				<label class="flex min-w-0 flex-1 flex-col gap-1">
					URL
					<input
						type="url"
						placeholder="https://example.com/webhook"
						value={config.action.url}
						oninput={(e) => updateWebhook({ url: e.currentTarget.value })}
						class="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white"
					/>
				</label>
			</div>

			{#if config.action.method === 'POST'}
				<label class="flex flex-col gap-1">
					JSON body
					<textarea
						rows="4"
						placeholder={'{\n  "on": true\n}'}
						value={config.action.body ?? ''}
						oninput={(e) => updateWebhook({ body: e.currentTarget.value })}
						class="rounded border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-white"
					></textarea>
				</label>
				{#if bodyError}
					<p class="text-xs text-rose-400">Invalid JSON: {bodyError}</p>
				{/if}
			{/if}

			<label class="flex flex-col gap-1">
				Custom headers <span class="text-xs text-slate-500"
					>(one <code>Name: Value</code> per line)</span
				>
				<textarea
					rows="2"
					placeholder="Authorization: Bearer …"
					value={headersText}
					oninput={(e) => setHeaders(e.currentTarget.value)}
					class="rounded border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-white"
				></textarea>
			</label>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={config.action.noCors ?? false}
					onchange={(e) => updateWebhook({ noCors: e.currentTarget.checked || undefined })}
				/>
				Fire-and-forget (<code>no-cors</code>) — for trigger-only endpoints without CORS
			</label>
			<p class="text-xs text-slate-500">
				The request goes straight from your browser. A cross-origin endpoint must send CORS headers,
				or enable <code>no-cors</code> above (the response is then unreadable).
			</p>
		</div>
	{/if}
</section>
