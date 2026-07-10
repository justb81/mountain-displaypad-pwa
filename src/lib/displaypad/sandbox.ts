/**
 * Runs a `template` {@link KeyFace}'s `transform` in an opaque-origin iframe
 * (`sandbox="allow-scripts"`, no `allow-same-origin`): it cannot read the
 * app's `localStorage`/keymap or touch `navigator.hid`/the app DOM, and every
 * `fetch` it makes is cross-origin from an opaque origin — CORS-enforced,
 * no ambient cookies/credentials. `fetch` and `Date` are simply the iframe's
 * own globals; nothing needs to be injected for them.
 *
 * The message contract below (`runOverChannel`) is deliberately split from
 * the real iframe/`postMessage` plumbing (`createIframeChannel`) so the
 * timeout/error/non-object-result handling is Node-testable against a fake
 * {@link SandboxChannel}.
 */

/** One structured-clone `postMessage` round trip, abstracted for testing. */
export interface SandboxChannel {
	post(message: unknown): void;
	/** Register a listener for inbound messages; returns an unsubscribe function. */
	onMessage(handler: (data: unknown) => void): () => void;
	/** Tear down the channel (e.g. remove the iframe). Safe to call more than once. */
	destroy(): void;
}

/** Hard ceiling on how long a transform may run before its iframe is torn down. */
export const SANDBOX_TIMEOUT_MS = 5000;

interface SandboxResponse {
	ok: boolean;
	data?: unknown;
	error?: unknown;
}

function isSandboxResponse(message: unknown): message is SandboxResponse {
	return !!message && typeof message === 'object' && 'ok' in message;
}

/**
 * Send `{ code, ctx }` over `channel` and resolve with the transform's
 * returned object, or reject on a thrown error, a non-object return, a
 * malformed response, or `timeoutMs` elapsing first. Always destroys the
 * channel before settling.
 */
export function runOverChannel(
	channel: SandboxChannel,
	code: string,
	ctx: unknown,
	timeoutMs = SANDBOX_TIMEOUT_MS
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let settled = false;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			channel.destroy();
			fn();
		};

		const timer = setTimeout(() => {
			settle(() => reject(new Error(`Transform timed out after ${timeoutMs}ms.`)));
		}, timeoutMs);

		const unsubscribe = channel.onMessage((message) => {
			settle(() => {
				if (!isSandboxResponse(message)) {
					reject(new Error('Malformed response from the sandbox.'));
				} else if (!message.ok) {
					reject(new Error(String(message.error ?? 'Transform failed.')));
				} else if (!message.data || typeof message.data !== 'object') {
					reject(new Error('Transform must return a plain object.'));
				} else {
					resolve(message.data as Record<string, unknown>);
				}
			});
		});

		channel.post({ code, ctx });
	});
}

/** Run `code` as an async transform body with a hard timeout, in a fresh opaque-origin iframe. */
export async function runTransform(
	code: string,
	ctx: unknown,
	timeoutMs = SANDBOX_TIMEOUT_MS
): Promise<Record<string, unknown>> {
	return runOverChannel(createIframeChannel(), code, ctx, timeoutMs);
}

/** Inline `<script>` run inside the sandboxed iframe's own opaque origin. */
const SANDBOX_SCRIPT = `
window.addEventListener('message', async (event) => {
	const { code, ctx } = event.data || {};
	let result;
	try {
		const run = new Function('ctx', 'return (async () => {\\n' + code + '\\n})();');
		result = { ok: true, data: await run(ctx) };
	} catch (err) {
		result = { ok: false, error: err && err.message ? err.message : String(err) };
	}
	try {
		parent.postMessage(result, '*');
	} catch {
		parent.postMessage({ ok: false, error: 'Transform result is not cloneable.' }, '*');
	}
});
`;

const SANDBOX_HTML = `<!doctype html><html><head></head><body><script>${SANDBOX_SCRIPT}</script></body></html>`;

/** Create a real, opaque-origin `sandbox="allow-scripts"` iframe channel. Browser-only. */
function createIframeChannel(): SandboxChannel {
	const iframe = document.createElement('iframe');
	iframe.setAttribute('sandbox', 'allow-scripts');
	iframe.style.display = 'none';
	iframe.srcdoc = SANDBOX_HTML;

	let ready = false;
	const queued: unknown[] = [];
	const onLoad = () => {
		ready = true;
		for (const message of queued.splice(0)) iframe.contentWindow?.postMessage(message, '*');
	};
	iframe.addEventListener('load', onLoad, { once: true });
	document.body.appendChild(iframe);

	let handler: ((event: MessageEvent) => void) | null = null;

	return {
		post(message) {
			if (ready) iframe.contentWindow?.postMessage(message, '*');
			else queued.push(message);
		},
		onMessage(cb) {
			handler = (event: MessageEvent) => {
				if (event.source === iframe.contentWindow) cb(event.data);
			};
			window.addEventListener('message', handler);
			return () => {
				if (handler) window.removeEventListener('message', handler);
				handler = null;
			};
		},
		destroy() {
			if (handler) window.removeEventListener('message', handler);
			handler = null;
			iframe.removeEventListener('load', onLoad);
			iframe.remove();
		}
	};
}
