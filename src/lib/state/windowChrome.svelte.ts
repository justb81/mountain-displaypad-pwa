/**
 * Tracks the Window Controls Overlay (WCO) state for an installed, Chromium-desktop
 * app: whether it's active right now, and the titlebar-area rect the app is allowed
 * to draw into. WCO can be toggled at runtime from the window's chevron menu, so this
 * is a live rune store, not a one-time check at boot — components read `visible`/`rect`
 * reactively instead of branching once on load.
 */

import { browser } from '$app/environment';

interface TitlebarRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

const EMPTY_RECT: TitlebarRect = { x: 0, y: 0, width: 0, height: 0 };

/** `geometrychange` fires continuously while the window is being dragged/resized. */
const GEOMETRY_DEBOUNCE_MS = 60;

class WindowChrome {
	visible = $state(false);
	rect = $state<TitlebarRect>(EMPTY_RECT);

	private debounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		const overlay = browser ? navigator.windowControlsOverlay : undefined;
		if (!overlay) return;

		this.sync(overlay);
		overlay.addEventListener('geometrychange', () => {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => this.sync(overlay), GEOMETRY_DEBOUNCE_MS);
		});
	}

	private sync(overlay: WindowControlsOverlay): void {
		this.visible = overlay.visible;
		const rect = overlay.getTitlebarAreaRect();
		this.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	}
}

/** App-wide Window Controls Overlay singleton. */
export const windowChrome = new WindowChrome();
