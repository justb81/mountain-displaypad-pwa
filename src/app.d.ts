/// <reference types="w3c-web-hid" />
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Window Controls Overlay isn't in TypeScript's lib.dom.d.ts yet (Chromium-only, experimental).
	interface WindowControlsOverlayGeometryChangeEvent extends Event {
		readonly titlebarAreaRect: DOMRect;
		readonly visible: boolean;
	}

	interface WindowControlsOverlay extends EventTarget {
		readonly visible: boolean;
		getTitlebarAreaRect(): DOMRect;
		addEventListener(
			type: 'geometrychange',
			listener: (event: WindowControlsOverlayGeometryChangeEvent) => void
		): void;
		removeEventListener(
			type: 'geometrychange',
			listener: (event: WindowControlsOverlayGeometryChangeEvent) => void
		): void;
	}

	interface Navigator {
		readonly windowControlsOverlay?: WindowControlsOverlay;
	}
}

export {};
