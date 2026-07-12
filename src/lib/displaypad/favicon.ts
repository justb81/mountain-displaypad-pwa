/**
 * Derive a key face image from a URL — the "auto icon from an Open URL action"
 * feature (issue #41).
 *
 * A client-only app can't reliably scrape a target page itself for its
 * `<link rel="icon">`, apple-touch-icon, or `<meta property="og:image">`: the
 * target would have to send CORS headers permissive to this origin, which
 * almost none do. Instead we delegate to unavatar.io — an aggregator that tries
 * exactly those sources in turn (favicon, mobile/app icons, social images) and,
 * crucially, serves the result with `Access-Control-Allow-Origin: *`, so a
 * browser `fetch` (and the canvas readback in `rasterize` on apply) can read it.
 * `?fallback=false` makes it answer 404 rather than a generic placeholder when
 * it finds nothing, which is how we tell "no icon" from "an icon".
 *
 * `hostnameFrom`/`faviconServiceUrl` are pure and Node-testable; only
 * `fetchFaviconDataUrl` touches browser APIs (`fetch` + `FileReader`) — the same
 * pure/browser split `template.ts` uses.
 */

/** unavatar.io aggregates favicon / app-icon / social-image sources and sends permissive CORS. */
const ICON_SERVICE_BASE = 'https://unavatar.io';

/**
 * Extract a fetchable hostname from a user-typed URL, or `null` if there isn't
 * one. A bare host (`github.com`) is accepted by assuming `https://`; anything
 * that isn't an `http(s)` URL (a `mailto:`/`javascript:` scheme, empty input,
 * junk) yields `null` so no request is ever built for it.
 */
export function hostnameFrom(rawUrl: string): string | null {
	const trimmed = rawUrl.trim();
	if (!trimmed) return null;

	// If it parses with a scheme already (https://, mailto:, javascript:, ...),
	// honour it: only http(s) yields a host, everything else is rejected.
	try {
		const { protocol, hostname } = new URL(trimmed);
		if (protocol !== 'http:' && protocol !== 'https:') return null;
		return hostname || null;
	} catch {
		// Not a full URL — fall through and treat it as a scheme-less bare host.
	}

	try {
		return new URL(`https://${trimmed}`).hostname || null;
	} catch {
		return null;
	}
}

/**
 * The unavatar.io URL that resolves `rawUrl`'s host to its best available icon,
 * or `null` if `rawUrl` has no usable host. `fallback=false` → a 404 (not a
 * placeholder) when nothing is found.
 */
export function faviconServiceUrl(rawUrl: string): string | null {
	const host = hostnameFrom(rawUrl);
	if (!host) return null;
	return `${ICON_SERVICE_BASE}/${encodeURIComponent(host)}?fallback=false`;
}

/**
 * Best-effort: fetch the icon for `rawUrl`'s site and return it as a data URL
 * suitable for an `image` {@link KeyFace}, or `null` when there's no usable URL,
 * no icon was found (404), or the fetch failed (offline/CORS). Never throws —
 * an auto-populate must not disrupt editing, and the manual path treats `null`
 * as "couldn't find one".
 */
export async function fetchFaviconDataUrl(rawUrl: string): Promise<string | null> {
	const serviceUrl = faviconServiceUrl(rawUrl);
	if (!serviceUrl) return null;

	let response: Response;
	try {
		response = await fetch(serviceUrl, { mode: 'cors', cache: 'no-store' });
	} catch {
		return null;
	}
	if (!response.ok) return null;

	const blob = await response.blob();
	return blobToDataUrl(blob);
}

/** Read a fetched image blob into a `data:` URL (same-origin, so it rasterises taint-free later). */
function blobToDataUrl(blob: Blob): Promise<string | null> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(blob);
	});
}
