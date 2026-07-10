<script lang="ts">
	import Button from './ui/Button.svelte';
	import { parseBasecampProfile, serializeBasecampProfile } from '$lib/basecamp/profile.js';
	import { debug } from '$lib/state/debug.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';

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
				console.debug('[basecamp-import] parsed pages', result.pages);
				console.debug('[basecamp-import] warnings', result.warnings);
			}
			keymap.importPages(result.pages, result.profileName, result.profileImage);
			warnings = result.warnings;
			toast.success(
				warnings.length
					? `Imported "${result.profileName ?? file.name}" with ${warnings.length} warning(s).`
					: `Imported "${result.profileName ?? file.name}".`
			);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			toast.error(error);
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
		const result = serializeBasecampProfile(keymap.pages, {
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
		toast.success('Exported profile as displaypad-profile.xml.');
	}
</script>

<div class="flex flex-col gap-2 rounded-panel border border-line bg-slate-800/60 p-3">
	<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
		<label class="flex items-center gap-2 text-label sm:min-w-0 sm:flex-1">
			<span class="flex-none text-slate-400">Profile name</span>
			<input
				type="text"
				value={keymap.profileName ?? ''}
				oninput={(e) => keymap.setProfileName((e.target as HTMLInputElement).value)}
				placeholder="DisplayPad Configurator"
				class="min-w-0 flex-1 rounded-control border border-line bg-slate-900 px-2 py-1.5 text-white placeholder:text-slate-500"
			/>
		</label>

		<div class="flex flex-wrap gap-3">
			<Button onclick={() => fileInput.click()}>Import Base Camp profile</Button>
			<input bind:this={fileInput} type="file" accept=".xml" class="hidden" onchange={handleFile} />

			<Button onclick={exportProfile}>Export Base Camp profile</Button>
		</div>
	</div>

	{#if !keymap.scriptsApproved}
		<div
			class="flex flex-wrap items-center gap-3 rounded-control bg-amber-950 px-3 py-2 text-label text-warning"
		>
			<span>
				This profile contains a script (a template face's transform). Approve it before it can run.
			</span>
			<Button
				variant="secondary"
				size="sm"
				class="border-warning-strong bg-warning-strong text-white hover:bg-warning"
				onclick={() => keymap.approveScripts()}
			>
				Run scripts
			</Button>
		</div>
	{/if}

	{#if error}
		<p class="text-label text-danger">{error}</p>
	{/if}

	{#if warnings.length > 0}
		<ul class="space-y-1 text-label text-warning">
			{#each warnings as warning (warning)}
				<li>⚠ {warning}</li>
			{/each}
		</ul>
	{/if}
</div>
