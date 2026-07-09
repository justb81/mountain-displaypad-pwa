<script lang="ts">
	import { connection } from '$lib/state/connection.svelte.js';
	import { NUM_KEYS } from '$lib/displaypad/protocol.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import type { KeyAction } from '$lib/types.js';

	interface Props {
		index: number;
		/** Non-drag fallback for reordering: moves the config and follows selection to the new slot. */
		onmove: (index: number) => void;
	}

	let { index, onmove }: Props = $props();

	const config = $derived(keymap.keys[index]);
	const canApply = $derived(connection.status === 'connected');

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
		keymap.update(index, { face: { type: 'color', color } });
	}

	function onFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () =>
			keymap.update(index, { face: { type: 'image', dataUrl: String(reader.result) } });
		reader.readAsDataURL(file);
	}

	function setRemoteUrl(url: string) {
		const current = config.face.type === 'remote' ? config.face : undefined;
		keymap.update(index, {
			face: {
				type: 'remote',
				url,
				refreshMinutes: current?.refreshMinutes,
				refreshOnPress: current?.refreshOnPress
			}
		});
		connection.syncLiveTimer(index);
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

	function setActionType(type: KeyAction['type']) {
		const action: KeyAction =
			type === 'open-url'
				? { type, url: '' }
				: type === 'copy-text'
					? { type, text: '' }
					: { type: 'none' };
		keymap.update(index, { action });
	}
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
			<img src={config.face.dataUrl} alt="Key preview" class="h-16 w-16 rounded object-cover" />
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
	{/if}
</section>
