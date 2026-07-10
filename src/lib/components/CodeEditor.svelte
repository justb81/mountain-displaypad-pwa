<script lang="ts">
	/**
	 * A small syntax-highlighted code field for a `template` face's HTML/Mustache
	 * and transform JS fields. Wraps CodeJar (a ~2KB `contenteditable` editor
	 * that re-highlights on input) driven by Prism.js. Everything — CodeJar,
	 * Prism, its language grammars, and its theme CSS — is dynamic-imported so
	 * none of it lands in the main bundle / service-worker precache until a
	 * template face is actually opened, and it's all bundled locally (no CDN),
	 * so it still works offline once loaded.
	 */

	interface Props {
		value: string;
		language: 'handlebars' | 'javascript';
		onChange: (value: string) => void;
	}

	let { value, language, onChange }: Props = $props();

	let container = $state<HTMLDivElement>();
	let jar = $state<import('codejar').CodeJar>();

	$effect(() => {
		let cancelled = false;
		let destroyJar: (() => void) | undefined;

		void (async () => {
			const [{ CodeJar }, Prism] = await Promise.all([
				import('codejar'),
				import('prismjs'),
				import('prismjs/themes/prism-tomorrow.css')
			]);
			await Promise.all([
				import('prismjs/components/prism-clike.js'),
				import('prismjs/components/prism-javascript.js'),
				import('prismjs/components/prism-markup.js')
			]);
			// Handlebars' grammar hooks into markup via markup-templating, which must load first.
			await import('prismjs/components/prism-markup-templating.js');
			await import('prismjs/components/prism-handlebars.js');

			if (cancelled || !container) return;

			const highlight = (editor: HTMLElement) => {
				const grammar = Prism.languages[language];
				const code = editor.textContent ?? '';
				editor.innerHTML = grammar ? Prism.highlight(code, grammar, language) : code;
			};

			const instance = CodeJar(container, highlight, { tab: '  ' });
			instance.updateCode(value);
			instance.onUpdate((code) => onChange(code));
			jar = instance;
			destroyJar = () => instance.destroy();
		})();

		return () => {
			cancelled = true;
			destroyJar?.();
			jar = undefined;
		};
	});

	// Re-seed the editor when `value` changes from outside (e.g. a different key selected).
	// Both reads must happen unconditionally so Svelte tracks `value` as a dependency even
	// while `jar` is still undefined (CodeJar loads asynchronously) — short-circuiting on
	// `jar &&` before reading `value` would otherwise skip that read on the first run and
	// the effect would never rerun when `value` changes afterwards.
	$effect(() => {
		const editor = jar;
		const latest = value;
		if (editor && editor.toString() !== latest) editor.updateCode(latest);
	});
</script>

<div
	bind:this={container}
	class="min-h-24 overflow-auto rounded border border-slate-600 bg-slate-900 p-2 font-mono text-xs whitespace-pre text-white"
	spellcheck="false"
></div>
