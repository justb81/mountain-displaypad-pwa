<script lang="ts">
	/**
	 * Editor for a single key face — the face-kind picker plus every type's editor
	 * (color / image / remote / live template), the burned-on text label, and the
	 * live-refresh policy. Shared verbatim by the primary face and the toggle key's
	 * second face so the two are configurable identically (issue #82).
	 *
	 * Switching the face-kind control is *non-destructive*: it only reveals that
	 * kind's editor, never rewriting the stored face until the user actually enters
	 * something (issue #80). So flipping the control to "Color" or "Live" and back
	 * no longer wipes an existing image/remote/template configuration. Every real
	 * edit is committed through {@link onchange}; the parent owns persistence.
	 */
	import CodeEditor from './CodeEditor.svelte';
	import Button from './ui/Button.svelte';
	import Hint from './ui/Hint.svelte';
	import SegmentedControl from './ui/SegmentedControl.svelte';
	import { removeImageBackground } from '$lib/displaypad/raster.js';
	import { faceText, withFaceText, type KeyFace, type KeyTextStyle } from '$lib/types.js';

	interface Props {
		/** Unique radio-group name, so the primary and second-face pickers don't collide. */
		name: string;
		/** The currently-stored face this editor reflects and mutates. */
		face: KeyFace;
		/** Default text for a freshly-enabled label (usually the key's label). */
		labelFallback: string;
		/** Whether an imported profile's transforms have been approved to run. */
		scriptsApproved: boolean;
		/** The key's most recent live-face fetch/render error, if any. */
		liveError?: string | null;
		/**
		 * Bumped by the parent (e.g. on "Reset") to drop a pending reveal-override
		 * so the control snaps back to the freshly-stored face's kind.
		 */
		resetNonce?: number;
		/** Commit a replacement face. Called only on a real edit, never on a bare kind switch. */
		onchange: (face: KeyFace) => void;
		/** Open the app-wide Secrets dialog (shared with the top menu). */
		onopensecrets: () => void;
	}

	let {
		name,
		face,
		labelFallback,
		scriptsApproved,
		liveError = null,
		resetNonce = 0,
		onchange,
		onopensecrets
	}: Props = $props();

	/**
	 * Which face kind the segmented control shows. Diverges from `face.type` only
	 * while the user has picked a kind whose editor hasn't been filled in yet (an
	 * empty color/image/URL/template isn't committed). Reset when the parent bumps
	 * {@link resetNonce}; a real edit makes `face.type` match anyway.
	 */
	let faceKindOverride = $state<KeyFace['type'] | null>(null);
	$effect(() => {
		// Track resetNonce so a parent reset clears a stale reveal-override.
		void resetNonce;
		faceKindOverride = null;
	});
	const faceKind = $derived(faceKindOverride ?? face.type);

	let imageFileInput = $state<HTMLInputElement>();
	let removingBackground = $state(false);
	let backgroundError = $state<string | undefined>(undefined);

	/**
	 * Starter HTML shown as the template editor's *placeholder* (never auto-committed,
	 * per issue #80): sized to fill the key (`width/height:100%` + `border-box`) so a
	 * face built from it renders correctly rather than leaving the key partly black.
	 */
	const TEMPLATE_STARTER = `<div style="width:100%;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-family:sans-serif;text-align:center;">
  Hello
</div>`;

	/** Reveal a face kind's editor without touching the stored face — the edit itself commits. */
	function setFaceKind(kind: string) {
		faceKindOverride = kind as KeyFace['type'];
	}

	function setColor(color: string) {
		onchange({ type: 'color', color, text: faceText(face) });
	}

	function onFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () =>
			onchange({ type: 'image', dataUrl: String(reader.result), text: faceText(face) });
		reader.readAsDataURL(file);
	}

	async function removeBackground() {
		if (face.type !== 'image') return;
		removingBackground = true;
		backgroundError = undefined;
		try {
			const dataUrl = await removeImageBackground(face.dataUrl);
			onchange({ type: 'image', dataUrl, text: faceText(face) });
		} catch {
			backgroundError = 'Could not remove the background from this image.';
		} finally {
			removingBackground = false;
		}
	}

	function setRemoteUrl(url: string) {
		const current = face.type === 'remote' ? face : undefined;
		onchange({
			type: 'remote',
			url,
			refreshMinutes: current?.refreshMinutes,
			refreshOnPress: current?.refreshOnPress,
			text: faceText(face)
		});
	}

	function setRemoteRefreshMinutes(minutes: number) {
		if (face.type !== 'remote') return;
		onchange({ ...face, refreshMinutes: minutes > 0 ? minutes : undefined });
	}

	function setRemoteRefreshOnPress(refreshOnPress: boolean) {
		if (face.type !== 'remote') return;
		onchange({ ...face, refreshOnPress });
	}

	function setTemplate(template: string) {
		if (face.type === 'template') {
			onchange({ ...face, template });
			return;
		}
		// Not yet a template face: the starter is only a placeholder, so commit a real
		// template face only once the user has typed actual content (issue #80).
		if (!template.trim()) return;
		onchange({ type: 'template', template });
	}

	function setTransform(transform: string) {
		if (face.type !== 'template') return;
		onchange({ ...face, transform: transform || undefined });
	}

	function setTemplateRefreshMinutes(minutes: number) {
		if (face.type !== 'template') return;
		onchange({ ...face, refreshMinutes: minutes > 0 ? minutes : undefined });
	}

	function setTemplateRefreshOnPress(refreshOnPress: boolean) {
		if (face.type !== 'template') return;
		onchange({ ...face, refreshOnPress });
	}

	/** Toggle whether the face carries a burned-on text label (unavailable for a `template` face). */
	function toggleFaceText(enabled: boolean) {
		if (face.type === 'template') return;
		if (enabled) updateFaceText({ text: face.text?.text || labelFallback });
		else onchange(withFaceText(face, undefined));
	}

	/** Merge a patch into the face's text label, filling in defaults for a freshly-enabled label. */
	function updateFaceText(patch: Partial<KeyTextStyle>) {
		if (face.type === 'template') return;
		const text: KeyTextStyle = {
			text: '',
			color: '#ffffff',
			align: 'center',
			...face.text,
			...patch
		};
		onchange(withFaceText(face, text));
	}

	const colorValue = $derived(face.type === 'color' ? face.color : '#000000');
	const remoteFace = $derived(face.type === 'remote' ? face : undefined);
	const templateFace = $derived(face.type === 'template' ? face : undefined);
	const textStyle = $derived(faceText(face));
</script>

<div class="flex flex-col gap-3 text-body text-slate-300">
	<SegmentedControl
		{name}
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
					value={colorValue}
					oninput={(e) => setColor(e.currentTarget.value)}
				/>
			</span>
			<Hint>A solid colour fill for the whole key.</Hint>
		</div>
	{:else if faceKind === 'image'}
		<div class="flex items-center gap-3">
			{#if face.type === 'image'}
				<img
					src={face.dataUrl}
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
				{#if face.type === 'image'}
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
				class="overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
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
			<Hint>Endpoint must allow cross-origin GET (CORS). SVG responses are rasterised to PNG.</Hint>
			{#if liveError}<Hint tone="danger">{liveError}</Hint>{/if}
		{/if}
	{:else if faceKind === 'template'}
		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1">
				<span class="text-label font-medium text-slate-200">Template (HTML + Mustache)</span>
				<CodeEditor
					value={templateFace?.template ?? ''}
					placeholder={TEMPLATE_STARTER}
					language="handlebars"
					onChange={setTemplate}
				/>
			</label>
			{#if templateFace}
				<div class="flex flex-col gap-1">
					<div class="flex items-center justify-between gap-2">
						<span class="text-label font-medium text-slate-200">Transform (optional)</span>
						<Button size="sm" variant="ghost" onclick={onopensecrets} title="Manage secrets">
							🔑 Secrets
						</Button>
					</div>
					<CodeEditor
						value={templateFace.transform ?? ''}
						language="javascript"
						onChange={setTransform}
					/>
					<Hint>
						Optional sandboxed async JS — has <code>fetch</code>, <code>Date</code>, and a
						<code>ctx</code> argument (read stored secrets via <code>ctx.secrets.KEY</code>); must
						return a plain object.
					</Hint>
				</div>
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
				{#if templateFace.transform && !scriptsApproved}
					<Hint tone="warning">
						This script came from an imported profile and won't run until you approve it in Profile
						tools.
					</Hint>
				{/if}
				{#if liveError}<Hint tone="danger">{liveError}</Hint>{/if}
			{/if}
		</div>
	{/if}

	{#if face.type !== 'template'}
		<div class="flex flex-col gap-2">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={!!textStyle}
					onchange={(e) => toggleFaceText(e.currentTarget.checked)}
				/>
				<span>Render a text label onto this face</span>
			</label>
			{#if textStyle}
				<label class="flex items-center gap-2">
					<input
						class="min-w-0 flex-1 overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
						value={textStyle.text}
						oninput={(e) => updateFaceText({ text: e.currentTarget.value })}
					/>
				</label>
				<div class="flex flex-wrap items-center gap-4 pl-1 text-label text-slate-400">
					<label class="flex items-center gap-1.5">
						<input
							type="color"
							value={textStyle.color}
							oninput={(e) => updateFaceText({ color: e.currentTarget.value })}
						/>
						Colour
					</label>
					<label class="flex items-center gap-1.5">
						Align
						<select
							class="rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
							value={textStyle.align}
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
							value={textStyle.fontSize ?? ''}
							placeholder="14"
							oninput={(e) => updateFaceText({ fontSize: Number(e.currentTarget.value) || undefined })}
							class="w-14 rounded-control border border-line bg-slate-900 px-1.5 py-1 text-white"
						/>
						px
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={textStyle.bold ?? false}
							onchange={(e) => updateFaceText({ bold: e.currentTarget.checked || undefined })}
						/>
						Bold
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={textStyle.italic ?? false}
							onchange={(e) => updateFaceText({ italic: e.currentTarget.checked || undefined })}
						/>
						Italic
					</label>
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={textStyle.underline ?? false}
							onchange={(e) => updateFaceText({ underline: e.currentTarget.checked || undefined })}
						/>
						Underline
					</label>
				</div>
			{/if}
		</div>
	{/if}
</div>
