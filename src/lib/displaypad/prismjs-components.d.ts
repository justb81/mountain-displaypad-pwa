/**
 * `@types/prismjs` only covers the package root — the individual language
 * component files (`prismjs/components/prism-*.js`) are plain side-effecting
 * scripts with no types of their own. Declared here so `CodeEditor.svelte`
 * can dynamic-import them without a "could not find a declaration file" error.
 */
declare module 'prismjs/components/prism-*.js';
