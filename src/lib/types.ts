/** Shared application types for the DisplayPad configurator. */

/** What a key does when pressed. The PWA reacts in-page; there is no OS-level agent. */
export type KeyAction =
	| { type: 'none' }
	| { type: 'open-url'; url: string }
	| { type: 'copy-text'; text: string }
	| {
			/** Fire an HTTP request straight from the browser (toggle a light, kick a CI job, ...). */
			type: 'webhook';
			method: 'GET' | 'POST';
			url: string;
			/** Raw request body sent as `application/json` on POST — stored verbatim as typed. */
			body?: string;
			/** Extra request headers, name → value. */
			headers?: Record<string, string>;
			/** Fire-and-forget with an opaque response: no CORS needed, but status/errors are unreadable. */
			noCors?: boolean;
	  }
	| {
			/** Jump the whole pad to another page of 12 keys (Base Camp's "Create Folder"). */
			type: 'open-folder';
			/** Index into the keymap's page list. */
			page: number;
	  }
	| {
			/** Pop back to the page this key's folder was entered from (Base Camp's "Back"). */
			type: 'back';
	  };

/** How a key renders on the physical pad. */
export type KeyFace =
	| { type: 'color'; color: string }
	| {
			type: 'image';
			/** data URL of a square image, scaled to 102x102 on apply */ dataUrl: string;
	  }
	| {
			type: 'remote';
			/** Public URL fetched over GET; the endpoint must send CORS headers permissive to this origin. */
			url: string;
			/** Refetch this often while connected. Omitted/0 disables the timer. */
			refreshMinutes?: number;
			/** Refetch (and re-apply) whenever this key is pressed. */
			refreshOnPress?: boolean;
	  };

/** Full user-facing configuration for one of the 12 keys. */
export interface KeyConfig {
	label: string;
	face: KeyFace;
	/** Optional alternate face for a toggle key (e.g. mic mute/unmute) — a press flips
	 *  between `face` and `secondFace` and repaints the key. Absent for a normal key. */
	secondFace?: KeyFace;
	action: KeyAction;
}

/** Connection lifecycle of the pad. */
export type ConnectionStatus =
	'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';
