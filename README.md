# DisplayPad Configurator

A browser-based PWA for connecting to and configuring a **Mountain DisplayPad** — the 6×2 macro pad with a 102×102-pixel display under each of its 12 keys — over **WebHID**. Assign each key a colour or image, choose what it does when pressed, and push it straight to the hardware. No install, no driver, no backend.

Built with SvelteKit + Svelte 5, Tailwind CSS 4, and `adapter-static`. Runs entirely client-side and works offline once loaded.

## Requirements

- A **Chromium-based browser** (Chrome/Edge) — WebHID is not available in Firefox or Safari.
- Served over `localhost` or **HTTPS** (WebHID is a secure-context API).

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

Click **Connect DisplayPad** and pick the device in the browser's HID prompt.

## Scripts

```sh
npm run dev        # dev server
npm run build      # static build → build/
npm run preview    # serve the production build
npm run check      # type-check (svelte-check)
npm test           # run unit tests once
npm run lint       # prettier --check + eslint
npm run format     # prettier --write
```

## Project layout

- `src/lib/displaypad/` — the HID protocol (`protocol.ts`, `image.ts`) and the WebHID transport (`device.ts`, `raster.ts`).
- `src/lib/state/` — reactive `keymap` and `connection` stores (Svelte 5 runes).
- `src/lib/components/`, `src/routes/` — UI.

See [CLAUDE.md](./CLAUDE.md) for the full architecture, conventions, and hardware notes.

## Status

The DisplayPad protocol is reverse-engineered from community projects and the pure encoding/decoding layer is unit-tested, but the end-to-end transport has not yet been validated against physical hardware. Credit to [JeLuF/mountain-displaypad](https://github.com/JeLuF/mountain-displaypad), [AnnikenYT/oss-mountain-displaypad](https://github.com/AnnikenYT/oss-mountain-displaypad), and Mountain's [official SDK demo](https://github.com/Mountain-BC/DisplayPad.SDK.Demo).
