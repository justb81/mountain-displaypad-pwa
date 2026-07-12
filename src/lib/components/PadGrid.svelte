<script lang="ts">
	import { NUM_KEYS_PER_ROW } from '$lib/displaypad/protocol.js';
	import { connection } from '$lib/state/connection.svelte.js';
	import { keymap } from '$lib/state/keymap.svelte.js';
	import { templates } from '$lib/state/templates.svelte.js';
	import PadKey from './PadKey.svelte';

	interface Props {
		selected: number;
		onselect: (index: number) => void;
	}

	let { selected, onselect }: Props = $props();

	let renamingPage = $state<number | null>(null);
	let renameValue = $state('');

	function startRename(page: number) {
		renamingPage = page;
		renameValue = keymap.pageName(page);
	}

	function commitRename() {
		if (renamingPage !== null) keymap.setPageName(renamingPage, renameValue);
		renamingPage = null;
	}

	function deletePage(page: number) {
		const confirmed = confirm(
			`Delete "${keymap.pageName(page)}"? Its keys will be removed and any folder links to it cleared.`
		);
		if (confirmed) void connection.deletePage(page);
	}

	function ondropkey(from: number, to: number, copy: boolean) {
		if (from === to) return;
		if (copy) {
			keymap.copy(from, to);
			if (connection.status === 'connected') void connection.applyKey(to);
		} else {
			keymap.swap(from, to);
			if (connection.status === 'connected') {
				void connection.applyKey(from);
				void connection.applyKey(to);
			}
		}
	}

	function ondroptemplate(templateId: string, to: number) {
		const template = templates.items.find((t) => t.id === templateId);
		if (!template) return;
		keymap.update(to, { ...template.config });
		if (connection.status === 'connected') void connection.applyKey(to);
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2">
		{#if keymap.pageHistory.length > 0}
			<button
				type="button"
				onclick={() => void connection.goBack()}
				class="flex items-center gap-1 rounded-control border border-line px-2.5 py-1.5 text-label text-slate-300 transition hover:bg-slate-700/60"
			>
				<span aria-hidden="true">&larr;</span> Back
			</button>
		{/if}

		<div
			class="flex flex-wrap items-center gap-1.5"
			role={renamingPage === null ? 'tablist' : undefined}
			aria-label="Pages"
		>
			{#each Array.from({ length: keymap.pageCount }, (_, i) => i) as pageIndex (pageIndex)}
				{@const active = pageIndex === keymap.activePage}
				<div class="flex items-center gap-0.5">
					{#if renamingPage === pageIndex}
						<input
							class="w-28 rounded-control border border-accent bg-slate-900 px-2 py-1 text-label text-white"
							value={renameValue}
							oninput={(e) => (renameValue = e.currentTarget.value)}
							onblur={commitRename}
							onkeydown={(e) => {
								if (e.key === 'Enter') commitRename();
								if (e.key === 'Escape') renamingPage = null;
							}}
						/>
					{:else}
						<button
							type="button"
							role="tab"
							aria-selected={active}
							ondblclick={() => startRename(pageIndex)}
							onclick={() => void connection.jumpToPage(pageIndex)}
							title="Double-click to rename"
							class="rounded-control px-3 py-1.5 text-label font-medium transition
								{active
								? 'bg-accent-strong text-white'
								: 'border border-line text-slate-300 hover:bg-slate-700/60'}"
						>
							{keymap.pageName(pageIndex)}
						</button>
						{#if active}
							<button
								type="button"
								onclick={() => startRename(pageIndex)}
								aria-label="Rename this page"
								title="Rename this page"
								class="rounded-control p-1.5 text-slate-500 transition hover:bg-slate-700/60 hover:text-slate-200"
							>
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5" aria-hidden="true">
									<path
										d="M13.586 3.586a2 2 0 0 1 2.828 2.828l-8.5 8.5a1 1 0 0 1-.39.242l-3 1a1 1 0 0 1-1.265-1.265l1-3a1 1 0 0 1 .242-.39l8.5-8.5.585-.415Z"
									/>
								</svg>
							</button>
							{#if keymap.pageCount > 1}
								<button
									type="button"
									onclick={() => deletePage(pageIndex)}
									aria-label="Delete this page"
									title="Delete this page"
									class="rounded-control p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
								>
									<svg
										viewBox="0 0 20 20"
										fill="currentColor"
										class="h-3.5 w-3.5"
										aria-hidden="true"
									>
										<path
											fill-rule="evenodd"
											d="M8.75 1a1 1 0 0 0-.95.68L7.36 3H4a1 1 0 0 0 0 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a1 1 0 1 0 0-2h-3.36l-.44-1.32A1 1 0 0 0 11.25 1h-2.5ZM8 7a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1Z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
							{/if}
						{/if}
					{/if}
				</div>
			{/each}
		</div>

		<button
			type="button"
			onclick={() => void connection.jumpToPage(keymap.addPage())}
			class="rounded-control border border-dashed border-line px-2.5 py-1.5 text-label text-slate-400 transition hover:border-line-strong hover:text-slate-200"
		>
			+ Page
		</button>
	</div>

	<div
		class="rounded-panel border border-slate-700/60 bg-gradient-to-b from-slate-800 to-slate-900 p-3 shadow-lg sm:p-4"
	>
		<div
			class="grid gap-2 overflow-x-auto rounded-tile bg-slate-950/60 p-3 shadow-inner sm:gap-3"
			style:grid-template-columns={`repeat(${NUM_KEYS_PER_ROW}, minmax(3rem, 1fr))`}
		>
			{#each keymap.keys as config, index (index)}
				<PadKey
					{index}
					{config}
					pressed={connection.pressed[index]}
					toggled={connection.toggled[index]}
					selected={selected === index}
					{onselect}
					{ondropkey}
					{ondroptemplate}
				/>
			{/each}
		</div>
	</div>

	<p class="text-caption text-slate-500">
		Drag a key onto another to swap them (hold ⌘/Ctrl to copy instead), or drag a saved template
		from the stash below onto a key.
	</p>
</div>
