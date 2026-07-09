<script lang="ts">
	import { parseBasecampProfile, serializeBasecampProfile } from '$lib/basecamp/profile.js';
	import { debug } from '$lib/state/debug.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';

	let fileInput: HTMLInputElement;
	let warnings = $state<string[]>([]);
	let error = $state<string | null>(null);

	async function handleFile(event: Event): Promise<void> {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		error = null;
		warnings = [];
		try {
			const text = await file.text();
			const result = parseBasecampProfile(text);
			if (debug.enabled) {
				console.debug('[basecamp-import] file', {
					name: file.name,
					size: file.size,
					sha256: await sha256(text)
				});
				console.debug('[basecamp-import] parsed keys', result.keys);
				console.debug('[basecamp-import] warnings', result.warnings);
			}
			keymap.importAll(result.keys, result.profileName, result.profileImage);
			warnings = result.warnings;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			(event.target as HTMLInputElement).value = '';
		}
	}

	/** Hex SHA-256 of `text`, so a bug report can confirm which file bytes were actually read. */
	async function sha256(text: string): Promise<string> {
		const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
		return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	function exportProfile(): void {
		error = null;
		const result = serializeBasecampProfile(keymap.keys, {
			profileName: keymap.profileName,
			profileImage: keymap.profileImage
		});
		warnings = result.warnings;
		const blob = new Blob([result.xml], { type: 'application/xml' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'displaypad-profile.xml';
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="flex flex-wrap items-center gap-3 text-sm">
	<label class="flex items-center gap-2">
		<span class="text-slate-400">Profile name</span>
		<input
			type="text"
			value={keymap.profileName ?? ''}
			oninput={(e) => keymap.setProfileName((e.target as HTMLInputElement).value)}
			placeholder="DisplayPad Configurator"
			class="rounded-md bg-slate-800 px-2 py-1 text-white placeholder:text-slate-500"
		/>
	</label>

	<button
		type="button"
		onclick={() => fileInput.click()}
		class="rounded-md bg-slate-700 px-3 py-1.5 font-medium text-white transition hover:bg-slate-600"
	>
		Import Base Camp profile
	</button>
	<input bind:this={fileInput} type="file" accept=".xml" class="hidden" onchange={handleFile} />

	<button
		type="button"
		onclick={exportProfile}
		class="rounded-md bg-slate-700 px-3 py-1.5 font-medium text-white transition hover:bg-slate-600"
	>
		Export Base Camp profile
	</button>
</div>

{#if error}
	<p class="mt-2 text-sm text-red-400">{error}</p>
{/if}

{#if warnings.length > 0}
	<ul class="mt-2 space-y-1 text-sm text-amber-400">
		{#each warnings as warning (warning)}
			<li>⚠ {warning}</li>
		{/each}
	</ul>
{/if}
