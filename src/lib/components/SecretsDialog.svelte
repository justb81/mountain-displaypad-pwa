<script lang="ts">
	import Button from './ui/Button.svelte';
	import Hint from './ui/Hint.svelte';
	import { isValidSecretKey, secrets, type SecretEntry } from '$lib/state/secrets.svelte.js';
	import { toast } from '$lib/state/toast.svelte.js';

	interface Props {
		open: boolean;
		onclose: () => void;
	}

	let { open, onclose }: Props = $props();

	/** Editable working copy, committed to the store only on Save. */
	let draft = $state<SecretEntry[]>([]);
	let revealed = $state(false);
	let error = $state<string | null>(null);

	// Re-seed the draft from the store each time the dialog opens (always leaving at
	// least one blank row to type into), so a cancelled edit never touches the store.
	$effect(() => {
		if (open) {
			draft = secrets.entries.length
				? secrets.entries.map((e) => ({ ...e }))
				: [{ key: '', value: '' }];
			revealed = false;
			error = null;
		}
	});

	function addRow() {
		draft.push({ key: '', value: '' });
		error = null;
	}

	function removeRow(i: number) {
		draft.splice(i, 1);
		error = null;
	}

	function save() {
		const cleaned: SecretEntry[] = [];
		const seenKeys: string[] = [];
		for (const row of draft) {
			const key = row.key.trim();
			// A fully-blank row is just an unused input — drop it silently.
			if (!key && !row.value) continue;
			if (!key) {
				error = 'Every secret needs a key.';
				return;
			}
			if (!isValidSecretKey(key)) {
				error = `"${key}" isn't a valid key — use letters, digits, and underscores (and don't start with a digit).`;
				return;
			}
			if (seenKeys.includes(key)) {
				error = `Duplicate key "${key}" — each secret needs a unique name.`;
				return;
			}
			seenKeys.push(key);
			cleaned.push({ key, value: row.value });
		}
		secrets.replaceAll(cleaned);
		toast.success(
			cleaned.length
				? `Saved ${cleaned.length} secret${cleaned.length === 1 ? '' : 's'}.`
				: 'Cleared all secrets.'
		);
		onclose();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}

	function onBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) onclose();
	}
</script>

<svelte:window onkeydown={open ? onkeydown : undefined} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
		onclick={onBackdrop}
		role="presentation"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="secrets-dialog-title"
			class="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-panel border border-line bg-slate-900 p-5 shadow-xl"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="flex flex-col gap-1">
					<h2 id="secrets-dialog-title" class="text-h1 font-semibold text-white">Secrets</h2>
					<p class="text-caption text-slate-400">
						Reusable credentials referenced by name, so they stay out of your saved and exported
						configs.
					</p>
				</div>
				<button
					type="button"
					onclick={onclose}
					aria-label="Close"
					class="flex h-8 w-8 flex-none items-center justify-center rounded-control text-slate-400 hover:bg-slate-800 hover:text-slate-100"
				>
					✕
				</button>
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between text-label text-slate-300">
					<span class="font-medium text-slate-200">Stored secrets</span>
					<label class="flex items-center gap-1.5 text-caption text-slate-400">
						<input type="checkbox" bind:checked={revealed} />
						Show values
					</label>
				</div>

				{#each draft as row, i (i)}
					<div class="flex items-center gap-2">
						<input
							class="min-w-0 flex-1 rounded-control border border-line bg-slate-950 px-2 py-1.5 font-mono text-white placeholder:text-slate-500"
							placeholder="KEY"
							value={row.key}
							oninput={(e) => {
								draft[i].key = e.currentTarget.value;
								error = null;
							}}
						/>
						<input
							type={revealed ? 'text' : 'password'}
							autocomplete="off"
							class="min-w-0 flex-1 rounded-control border border-line bg-slate-950 px-2 py-1.5 font-mono text-white placeholder:text-slate-500"
							placeholder="value"
							value={row.value}
							oninput={(e) => {
								draft[i].value = e.currentTarget.value;
								error = null;
							}}
						/>
						<Button
							size="sm"
							variant="ghost"
							onclick={() => removeRow(i)}
							aria-label={`Remove secret ${row.key || i + 1}`}
							title="Remove"
						>
							✕
						</Button>
					</div>
				{/each}

				<Button size="sm" class="self-start" onclick={addRow}>+ Add secret</Button>

				{#if error}<Hint tone="danger">{error}</Hint>{/if}
			</div>

			<div class="flex flex-col gap-2 rounded-control border border-line bg-slate-950/60 p-3">
				<span class="text-label font-medium text-slate-200">Using a secret</span>
				<Hint>
					In a <strong>webhook</strong>'s custom headers or JSON body, write
					<code>{'{{secret.KEY}}'}</code> where the value should go — e.g.
					<code>Authorization: Bearer {'{{secret.TOKEN}}'}</code>.
				</Hint>
				<Hint>
					In a <strong>live template</strong> transform, read it from the context:
					<code>ctx.secrets.KEY</code> (e.g.
					<code>{'headers: { Authorization: ctx.secrets.TOKEN }'}</code>).
				</Hint>
				<Hint tone="warning">
					Secrets are stored in this browser only, in plain text — they are never included when you
					export a Base Camp profile or save a key to the template stash (only the reference
					travels).
				</Hint>
			</div>

			<div class="flex justify-end gap-2">
				<Button variant="secondary" onclick={onclose}>Cancel</Button>
				<Button variant="primary" onclick={save}>Save</Button>
			</div>
		</div>
	</div>
{/if}
