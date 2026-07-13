<script lang="ts">
	import Button from './ui/Button.svelte';
	import Hint from './ui/Hint.svelte';
	import FaceEditor from './FaceEditor.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { NUM_KEYS } from '$lib/displaypad/protocol.js';
	import { fetchFaviconDataUrl, hostnameFrom } from '$lib/displaypad/favicon.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { templates } from '$lib/state/templates.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';
	import { faceText, type KeyAction, type KeyFace } from '$lib/types.js';

	interface Props {
		index: number;
		/** Non-drag fallback for reordering: moves the config and follows selection to the new slot. */
		onmove: (index: number) => void;
		/** Open the app-wide Secrets dialog (shared with the top menu). */
		onopensecrets: () => void;
	}

	let { index, onmove, onopensecrets }: Props = $props();

	const config = $derived(keymap.keys[index]);
	const canApply = $derived(connection.status === 'connected');

	/** Bumped on reset so each {@link FaceEditor} drops any pending face-kind reveal. */
	let resetNonce = $state(0);

	$effect(() => {
		if (index >= 0) {
			lastAutoIconUrl = '';
			pendingIcon = null;
			clearTimeout(iconDebounce);
		}
	});

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
		resetNonce++;
		toast.info(`Key ${index + 1} reset.`);
	}

	/** Commit an edit to the primary face and re-derive its live-refresh timer. */
	function setFace(face: KeyFace) {
		keymap.update(index, { face });
		connection.syncLiveTimer(index);
	}

	/** Commit an edit to the toggle key's second face and re-derive its live-refresh timer. */
	function setSecondFace(face: KeyFace) {
		keymap.update(index, { secondFace: face });
		connection.syncLiveTimer(index);
	}

	function toggleSecondFace(enabled: boolean) {
		keymap.update(index, {
			secondFace: enabled ? { type: 'color', color: '#000000' } : undefined
		});
		connection.syncLiveTimer(index);
	}

	/** Debounce window before a freshly-typed Open URL auto-populates the key icon. */
	const ICON_DEBOUNCE_MS = 700;
	let loadingIcon = $state(false);
	/** A fetched icon awaiting confirmation before it overwrites a non-blank face — see {@link loadIconNow}. */
	let pendingIcon = $state<string | null>(null);
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

	/**
	 * Explicit "Use site icon" button — fetches the icon and shows it as a preview.
	 * It is never applied silently: {@link applyPendingIcon} does the actual overwrite
	 * once the user confirms, so an existing face (image, colour, template) is never
	 * clobbered without them seeing the replacement first.
	 */
	async function loadIconNow() {
		if (config.action.type !== 'open-url') return;
		const url = config.action.url;
		if (!hostnameFrom(url)) return;
		loadingIcon = true;
		pendingIcon = null;
		try {
			const dataUrl = await fetchFaviconDataUrl(url);
			if (!dataUrl) {
				toast.error('Could not find an icon for that URL.');
				return;
			}
			pendingIcon = dataUrl;
		} finally {
			loadingIcon = false;
		}
	}

	/** Commit the previewed icon as the key's image face (keeping any text label) and dismiss the preview. */
	function applyPendingIcon() {
		if (!pendingIcon) return;
		if (config.action.type === 'open-url') lastAutoIconUrl = config.action.url;
		keymap.update(index, {
			face: { type: 'image', dataUrl: pendingIcon, text: faceText(config.face) }
		});
		pendingIcon = null;
		toast.success('Loaded the site icon.');
	}

	function setActionType(type: KeyAction['type']) {
		const action: KeyAction =
			type === 'open-url'
				? { type, url: '' }
				: type === 'webhook'
					? { type, method: 'POST', url: '' }
					: type === 'navigate'
						? { type, target: 'back' }
						: { type: 'none' };
		keymap.update(index, { action });
	}

	function setNavigateTarget(target: number | 'back') {
		keymap.update(index, { action: { type: 'navigate', target } });
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

{#snippet secretsButton()}
	<Button size="sm" variant="ghost" onclick={onopensecrets} title="Manage secrets">
		🔑 Secrets
	</Button>
{/snippet}

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
				class="min-w-0 flex-1 overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
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
			class="overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 text-body text-white"
			value={config.label}
			oninput={(e) => keymap.update(index, { label: e.currentTarget.value })}
		/>
	</label>

	<fieldset class="flex flex-col gap-3 text-body text-slate-300">
		<legend class="mb-1 text-h2 font-semibold text-white">Face</legend>
		{#key index}
			<FaceEditor
				name={`face-kind-${index}`}
				face={config.face}
				labelFallback={config.label}
				scriptsApproved={keymap.scriptsApproved}
				liveError={connection.liveFaceErrors[index]}
				{resetNonce}
				onchange={setFace}
				{onopensecrets}
			/>
		{/key}
	</fieldset>

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
			{#key index}
				<FaceEditor
					name={`second-face-kind-${index}`}
					face={config.secondFace}
					labelFallback={config.label}
					scriptsApproved={keymap.scriptsApproved}
					liveError={connection.liveFaceErrors[index]}
					{resetNonce}
					onchange={setSecondFace}
					{onopensecrets}
				/>
			{/key}
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
			<option value="open-url">Open URL in Browser</option>
			<option value="webhook">Webhook (HTTP request)</option>
			<option value="navigate">Page navigation</option>
		</select>
	</label>

	{#if config.action.type === 'open-url'}
		<div class="flex items-center gap-2">
			<input
				class="min-w-0 flex-1 overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
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
			A blank key auto-loads the site's icon when you enter a URL. "Use site icon" fetches it
			(favicon, app or social image) for an already-styled key too — icons by
			<a
				href="https://unavatar.io"
				target="_blank"
				rel="noreferrer"
				class="text-accent-soft underline underline-offset-2">unavatar.io</a
			>.
		</Hint>
		{#if pendingIcon}
			<div class="flex items-center gap-3 rounded-control border border-line bg-slate-900 p-2">
				<img
					src={pendingIcon}
					alt="Fetched icon preview"
					class="h-14 w-14 flex-none rounded-control border border-line bg-slate-950 object-contain"
				/>
				<div class="flex flex-col items-start gap-1.5 text-label text-slate-300">
					<span>
						{config.face.type === 'color' && config.face.color === '#000000' && !config.face.text
							? 'Use this icon as the key face?'
							: 'Replace the current face with this icon?'}
					</span>
					<div class="flex gap-2">
						<Button size="sm" variant="success" onclick={applyPendingIcon}>Use this icon</Button>
						<Button size="sm" onclick={() => (pendingIcon = null)}>Cancel</Button>
					</div>
				</div>
			</div>
		{/if}
		{#if connection.popupBlockedErrors[index]}
			<Hint tone="danger">{connection.popupBlockedErrors[index]}</Hint>
		{/if}
	{:else if config.action.type === 'navigate'}
		<div class="flex items-center gap-2 text-body text-slate-300">
			<select
				class="rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
				value={config.action.target === 'back' ? 'back' : String(config.action.target)}
				onchange={(e) =>
					setNavigateTarget(
						e.currentTarget.value === 'back' ? 'back' : Number(e.currentTarget.value)
					)}
			>
				<option value="back">← Back to the previous page</option>
				{#each Array.from({ length: keymap.pageCount }, (_, i) => i) as pageIndex (pageIndex)}
					<option value={String(pageIndex)}>{keymap.pageName(pageIndex)}</option>
				{/each}
			</select>
			<Button size="sm" onclick={() => setNavigateTarget(keymap.addPage())}>+ New page</Button>
		</div>
		{#if config.action.target === 'back'}
			<Hint>Returns to whichever page this key was entered from.</Hint>
		{/if}
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
						class="min-w-0 overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white"
					/>
				</label>
			</div>

			{#if config.action.method === 'POST'}
				<div class="flex flex-col gap-1">
					<div class="flex items-center justify-between gap-2">
						<span class="text-label font-medium text-slate-200">JSON body</span>
						{@render secretsButton()}
					</div>
					<textarea
						rows="4"
						placeholder={'{\n  "on": true\n}'}
						value={config.action.body ?? ''}
						oninput={(e) => updateWebhook({ body: e.currentTarget.value })}
						class="overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 font-mono text-white"
					></textarea>
					<Hint>Insert a stored secret with <code>{'{{secret.KEY}}'}</code>.</Hint>
					{#if bodyError}<Hint tone="danger">Invalid JSON: {bodyError}</Hint>{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-2">
					<span class="text-label font-medium text-slate-200">Custom headers</span>
					{@render secretsButton()}
				</div>
				<Hint>
					One <code>Name: Value</code> per line. Insert a stored secret with
					<code>{'{{secret.KEY}}'}</code> (e.g.
					<code>Authorization: Bearer {'{{secret.TOKEN}}'}</code>).
				</Hint>
				<textarea
					rows="2"
					placeholder="Authorization: Bearer …"
					value={headersText}
					oninput={(e) => setHeaders(e.currentTarget.value)}
					class="overflow-x-auto rounded-control border border-line bg-slate-900 px-2 py-1.5 font-mono text-white"
				></textarea>
			</div>

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
