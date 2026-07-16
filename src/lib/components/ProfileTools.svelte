<script lang="ts">
	import Button from './ui/Button.svelte';
	import { parseBasecampProfile, serializeBasecampProfile } from '$lib/basecamp/profile.js';
	import { debug } from '$lib/state/debug.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { storage } from '$lib/state/storage.svelte.js';
	import { formatBytes } from '$lib/state/storageQuota.js';
	import { toast } from '$lib/state/toast.svelte.js';
	import type { SnapshotMeta, SnapshotReason } from '$lib/state/imageStore.js';

	let fileInput: HTMLInputElement;
	let warnings = $state<string[]>([]);
	let error = $state<string | null>(null);

	const REASON_LABELS: Record<SnapshotReason, string> = {
		auto: 'Auto',
		'pre-import': 'Before import',
		'pre-reset': 'Before reset',
		'pre-restore': 'Before restore'
	};

	/** Fraction of the quota in use (0–1), or null if the browser doesn't report figures. */
	const usageFraction = $derived(
		storage.estimate && storage.estimate.quota > 0
			? Math.min(1, storage.estimate.usage / storage.estimate.quota)
			: null
	);

	function snapshotWhen(snapshot: SnapshotMeta): string {
		return new Date(snapshot.createdAt).toLocaleString();
	}

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
			void storage.refresh();
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
			<Button variant="warning" size="sm" onclick={() => keymap.approveScripts()}>
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

	<details class="group rounded-control border border-line bg-slate-900/40">
		<summary
			class="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-label text-slate-300 select-none"
			onclick={() => void storage.refresh()}
		>
			<span class="flex items-center gap-2">
				Storage
				{#if storage.estimate}
					<span class="text-caption text-slate-500">
						{formatBytes(storage.estimate.usage)} used{storage.estimate.quota
							? ` of ~${formatBytes(storage.estimate.quota)}`
							: ''}
					</span>
				{/if}
			</span>
			<span class="text-slate-500 transition group-open:rotate-180" aria-hidden="true">⌄</span>
		</summary>

		<div class="flex flex-col gap-3 border-t border-line px-3 py-3">
			{#if usageFraction !== null}
				<div class="h-2 w-full overflow-hidden rounded-full bg-slate-800">
					<div
						class="h-full rounded-full bg-accent-strong transition-[width]"
						style:width={`${Math.max(1, Math.round(usageFraction * 100))}%`}
					></div>
				</div>
			{:else}
				<p class="text-caption text-slate-500">
					This browser doesn't report a storage estimate. IndexedDB keeps image data off the small
					localStorage quota regardless.
				</p>
			{/if}

			<ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-caption text-slate-400">
				{#each storage.breakdown as slice (slice.label)}
					<li class="flex items-center justify-between gap-2">
						<span>{slice.label}</span>
						<span class="text-slate-500">{formatBytes(slice.bytes)}</span>
					</li>
				{/each}
			</ul>

			{#if storage.persisted === false}
				<p class="text-caption text-slate-500">
					Storage is not marked durable — the browser may evict it under pressure. Installing the
					app usually grants durability. Keep an exported backup of anything important.
				</p>
			{/if}

			<div class="flex flex-col gap-1.5">
				<span class="text-label text-slate-300">Restore snapshot</span>
				{#if storage.snapshots.length === 0}
					<p class="text-caption text-slate-500">
						No snapshots yet. One is taken automatically before an import or reset, and hourly while
						you edit.
					</p>
				{:else}
					<ul class="flex flex-col gap-1.5">
						{#each storage.snapshots as snapshot (snapshot.id)}
							<li
								class="flex flex-wrap items-center justify-between gap-2 rounded-control bg-slate-900/60 px-2 py-1.5 text-caption"
							>
								<span class="flex min-w-0 flex-col">
									<span class="truncate text-slate-300">{snapshot.label}</span>
									<span class="text-slate-500">
										{REASON_LABELS[snapshot.reason]} · {snapshotWhen(snapshot)}
									</span>
								</span>
								<span class="flex flex-none gap-1.5">
									<Button size="sm" onclick={() => void storage.restore(snapshot.id)}
										>Restore</Button
									>
									<Button
										size="sm"
										variant="ghost"
										onclick={() => void storage.deleteSnapshot(snapshot.id)}
									>
										Delete
									</Button>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</details>
</div>
