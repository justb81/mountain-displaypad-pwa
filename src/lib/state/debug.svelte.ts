/** Toggles verbose WebHID wire-protocol tracing to the console. */
class Debug {
	enabled = $state(false);
}

/** App-wide debug-logging singleton. */
export const debug = new Debug();
