// The configurator is a client-only PWA: it drives WebHID, which has no
// server-side equivalent. Prerender the static shell, but never SSR.
export const prerender = true;
export const ssr = false;
