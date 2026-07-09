/** Shared application types for the DisplayPad configurator. */

/** What a key does when pressed. The PWA reacts in-page; there is no OS-level agent. */
export type KeyAction =
	{ type: 'none' } | { type: 'open-url'; url: string } | { type: 'copy-text'; text: string };

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
	action: KeyAction;
}

/** Connection lifecycle of the pad. */
export type ConnectionStatus =
	'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';
