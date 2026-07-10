# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DisplayPad Configurator — a **client-only PWA** (SvelteKit + Svelte 5 + Tailwind 4) for connecting to and configuring a **Mountain DisplayPad** straight from the browser over **WebHID**. The DisplayPad is a 6×2 macro pad with a 102×102-pixel display under each of its 12 keys. There is no backend and no OS-level agent: the app talks to the hardware directly, paints the keys, and reacts to key presses in-page.

## Commands

| Task                | Command                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| Dev server          | `npm run dev` (WebHID requires `localhost` or HTTPS in a Chromium browser) |
| Production build    | `npm run build` → static site in `build/` (adapter-static)                 |
| Preview build       | `npm run preview`                                                          |
| Type-check          | `npm run check` (runs `svelte-kit sync` + `svelte-check`)                  |
| Unit tests (once)   | `npm test`                                                                 |
| Unit tests (watch)  | `npm run test:unit`                                                        |
| Single test file    | `npx vitest run src/lib/displaypad/protocol.spec.ts`                       |
| Single test by name | `npx vitest run -t "decodes the last key"`                                 |
| Lint                | `npm run lint` (prettier `--check` + eslint)                               |
| Format              | `npm run format`                                                           |

Tests run under vitest's `server` (Node) project, which only matches `src/**/*.{test,spec}.{js,ts}` (not `*.svelte.{test,spec}.*`). `requireAssertions` is enabled — every test must make at least one assertion.

## Architecture

Four layers, low-level → UI. The key rule: the **protocol layer is pure and Node-testable**; only `device.ts`/`raster.ts`/`liveface.ts` may touch browser/hardware APIs.

1. **Protocol (pure)** — `src/lib/displaypad/protocol.ts`, `image.ts`
   The USB HID wire format, isolated so it can be unit-tested without a browser: `VENDOR_ID 0x3282` / `PRODUCT_IDS [0x0009]`, `NUM_KEYS` 12 in a 6×2 grid, `ICON_SIZE` 102 px square, images in **BGR** order (`encodeImage` flips RGBA→BGR), `PACKET_SIZE`-byte pixel payloads, the `INIT_MESSAGE`/`IMAGE_MESSAGE` control frames, and key-press decoding (`decodeKeyStates` reads bitmasks at report bytes 42 & 47).

2. **Device transport (browser-only)** — `src/lib/displaypad/device.ts`, `raster.ts`, `liveface.ts`
   `DisplayPad extends EventTarget`: `request()` / `fromGranted()` → `open()`; emits `keydown` / `keyup` / `close`. It drives the reverse-engineered transfer state machine (INIT → announce a key → pad echoes → stream pixel chunks) from inbound `inputreport` events. The pad is a **composite HID device with three interfaces** — see "Hardware caveats" below; `assignRoles()` splits the handles by report descriptor size, not enumeration order. WebHID delivers a report as `reportId` + `data`; `buildReport()` rejoins them so the protocol byte offsets line up (a no-op for the pad's unnumbered reports, where `reportId` is always 0 and `data` already starts at the real type byte). `raster.ts` turns an image URL (data URL, blob URL, or same-origin/CORS-permissive remote URL) into the 102×102 RGBA buffer the protocol expects. `liveface.ts`'s `fetchRemoteFace()` backs the `remote` `KeyFace`: it fetches a URL over GET, sniffs `content-type`, injects a `width`/`height` on SVG responses that lack one (canvas rasterisation is otherwise unpredictable), and hands the result to `rasterize()` as a blob URL — the endpoint must send CORS headers permissive to this origin or the `fetch` itself fails. Verbose `[displaypad]` wire tracing is gated behind the `debug` singleton (below) and a checkbox in the UI.

3. **State (Svelte 5 runes singletons)** — `src/lib/state/*.svelte.ts`
   - `keymap` — `pages: KeyConfig[][]` (each page 12 `KeyConfig`s: label / face / action) plus an `activePage` rune, persisted to `localStorage`. The source of truth for what each key looks like and does; hardware-agnostic. `keys` reads/writes `pages[activePage]`, so most of the app still treats it as a flat 12-key grid; `importAll(keys)` replaces the keymap with a single page, `importPages(pages)` with several. An `open-folder` action (`{ type: 'open-folder'; page }`) jumps `activePage` to another page — mirroring Base Camp's "Create Folder" — and `back` (`{ type: 'back' }`) pops `pageHistory` to return; `openPage()`/`back()`/`switchPage()` manage that navigation and history. A `remote` face (`{ type: 'remote'; url; refreshMinutes?; refreshOnPress? }`) only persists the URL + policy — fetched pixels are transient and re-fetched each cycle.
   - `connection` — owns the single `DisplayPad`, mirrors pressed state into runes, pushes keymap faces to the hardware on explicit apply only (`applyKey` / `applyAll` — neither runs automatically on connect), and runs a key's configured action when it is pressed — including `open-folder`/`back`, which call `keymap`'s page navigation and then repaint via `applyAll()` (`goToPage()` / `goBack()` / `jumpToPage()`, the last used by the UI's breadcrumb, not just physical presses). For a `remote` face, `applyKey()` calls `fetchRemoteFace()` and records failures per-key in `liveFaceErrors` instead of throwing (CORS/network failures on a live face must not break the rest of the pad). `syncLiveTimer(index)` (re)derives that key's `setInterval` from its current keymap config — call it after editing a key's face; it's a no-op while disconnected. Timers refetch+apply on a floor of 1 minute (with a little jitter) and are all cleared in `teardown()`, so a live face does no background traffic while disconnected. `refreshOnPress` is handled inline in the `keydown` listener. On construction it silently tries `DisplayPad.fromGranted()` to reopen a previously-permitted pad without prompting; `connect()` (the `ConnectButton` click handler) is the only path that calls `DisplayPad.request()` and shows the picker.
   - `debug` — one `enabled` boolean, toggled by a checkbox in `+page.svelte`, read by `device.ts`'s `debugLog()` to gate console tracing of the wire protocol.

4. **UI** — `src/routes/+page.svelte` + `src/lib/components/*.svelte` (`ConnectButton`, `PadGrid`, `PadKey`, `KeyInspector`). Presentational only; they read and mutate the two stores.

### PWA / rendering

- **Client-only.** `src/routes/+layout.ts` sets `ssr = false` + `prerender = true`. adapter-static emits a prerendered shell that hydrates and then runs entirely in the browser (WebHID has no server equivalent).
- **Offline.** `src/service-worker.ts` (SvelteKit auto-registers it in production builds) cache-first precaches the app shell and static assets. The manifest link and `theme-color` are in `src/app.html`; assets are `static/manifest.webmanifest` and `static/pwa-icon.svg`.

## Conventions & gotchas

- **There is no `svelte.config.js`.** SvelteKit config (the static adapter and the forced-runes `compilerOptions`) lives inside the `sveltekit()` plugin call in `vite.config.ts`. Change SvelteKit options there.
- **Runes are forced on** for all app code (everything outside `node_modules`). Use `$state` / `$derived` / `$props`; the stores are plain classes in `.svelte.ts` files exported as singletons.
- **Relative imports use explicit `.js` extensions** (tsconfig `rewriteRelativeImportExtensions`). Use the `$lib` alias for `src/lib`.
- **Nothing touching `navigator.hid` or the DOM may run at module top-level or during SSR.** Device access is guarded via `DisplayPad.isSupported()` and `browser` from `$app/environment`.
- **WebHID typings** come from `@types/w3c-web-hid`, referenced from `src/app.d.ts`.

## Hardware caveats (validated 2026-07-09 against a physical pad)

The protocol is reverse-engineered; the pure layer is unit-tested and both the image-write path and key-press decoding (`keydown` firing a key's `open-url` action) have been confirmed end-to-end on real hardware.

- **Three HID interfaces, not two.** `navigator.hid.requestDevice()` grants: a generic consumer-control/keyboard interface (unused — 0-byte output reports), a **display** interface (single unnumbered output report, 1024 bytes — matches `CHUNK_SIZE`, receives pixel chunks only, no input reports at all), and a **control** interface (single unnumbered input+output report, 64 bytes — receives `INIT_MESSAGE`/`IMAGE_MESSAGE`, emits key-state/ack reports). `assignRoles()` picks display/control by these report-descriptor sizes; don't go back to enumeration-order guessing.
- **Unnumbered reports need `buildReport()` to pass through unchanged.** WebHID reports `reportId: 0` for the control interface's single implicit report, and `event.data` already starts with the real type byte (0x01/0x11/0x21) — nothing was stripped, so `buildReport()` must not prepend a synthetic 0 byte for `reportId === 0` (it only reconstructs for a genuinely nonzero, numbered `reportId`). Getting this wrong silently shifts every downstream offset — including the `KEY_BITS` byte-42/47 lookups — by one.
- **`INIT_MESSAGE`/`IMAGE_MESSAGE` are 65 bytes** (a leading pseudo report-id byte + a 64-byte HID report), matching the interrupt-endpoint size used by the reference drivers — not the doubled 112-byte constants an earlier version of this file had (silent no-op writes, no visible error).
- References: [JeLuF/mountain-displaypad](https://github.com/JeLuF/mountain-displaypad) (JS/node-hid — the closest analogue to this port), [AnnikenYT/oss-mountain-displaypad](https://github.com/AnnikenYT/oss-mountain-displaypad) (Python), [Mountain-BC/DisplayPad.SDK.Demo](https://github.com/Mountain-BC/DisplayPad.SDK.Demo) (official C# SDK).
- `static/pwa-icon.svg` is a placeholder; add raster (192/512 px) icons for full install prompts.
