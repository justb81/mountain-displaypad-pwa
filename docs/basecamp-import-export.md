# Importing / exporting Mountain Base Camp profiles

Analysis of `examples/displaypad_cplace.xml` (a real profile exported from the official
**Mountain Base Camp** Windows app) and a concrete plan for reading/writing this format
from the PWA.

## 1. What the file actually is

Base Camp's `<Profile>` XML is a generic **.NET `XmlSerializer` dump** shared across Mountain's
whole product line (Makalu keyboard, Everest/Everest60 keyboards, DisplayPad). One file =
one saved profile for one device. Device sections the user doesn't own are empty
(`<MakaluLightings />`, `<EverestLightings />`, ...). In our sample:

- `<DeviceType>DisplayPad</DeviceType>` — confirms this profile belongs to the DisplayPad.
- `<EverestKeyboardSettings>` is populated (screen-saver image, brightness, keyboard layout) —
  a leftover from the shared schema; **not applicable to the DisplayPad**, ignore it.
- `<DisplayPadKeyBindings>` is the only section we care about: a flat list of
  `<DisplayPadLayerBidings>` elements (yes, misspelled in the vendor's own schema), one per
  key **per page**. Our sample has 24 = 2 pages × 12 keys (see §4.2).

Being deterministic `XmlSerializer` output is good news for a parser: no attributes on data
elements (only the root's `xmlns:xsi`/`xmlns:xsd`), empty elements always self-close
(`<Tag />`), collections are repeated sibling elements, and only `&`/`<`/`>` are ever escaped
in text content. This is a stable, boring shape — not arbitrary hand-authored XML.

## 2. Per-key fields (`DisplayPadLayerBidings`)

| Field(s)                                                                                     | Meaning                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyId` / `KeyName` / `KeyNameFull` / `DLLKeyId` / `DLLKeyName` / `DLLMatrixIndex`           | Four aliases for the same key. `KeyName` (`"M1"`..`"M12"`) is the one that plausibly maps to our `0..11` index — **needs a real-hardware sanity check**, see §6.                    |
| `ParentId`                                                                                   | `0` on the pad's top-level page. Nonzero = a sub-page opened by another key's `Create Folder` action (see §4.2).                                                                    |
| `IsActive`                                                                                   | Whether _this_ page's key state is the one currently painted on the hardware.                                                                                                       |
| `FunctionType` / `SubFunctionType` / `FunctionValue` / `FunctionEnteredValue` / `CustomURL`  | The action. See §4.1 for the catalog observed in the sample.                                                                                                                        |
| `base64Image` / `ImageFilePath`                                                              | The key face. Three shapes exist — see §4.3.                                                                                                                                        |
| `OptionalText`                                                                               | A JSON string (`TextTitle`, font, color, alignment) describing text Base Camp **already burned into** `base64Image`'s pixels before saving. We don't need to render text ourselves. |
| `SecondBase64Image` / `SecondImageFilePath` / `SecondOptionalText` / `IsFirstImageSelected`  | An optional second face+state for toggle keys (e.g. the sample's mic mute/unmute key). Imported into `KeyConfig.secondFace` — see §4.4.                                             |
| `IsKeyAssigned`, `IsTouchKey`, `IsHardWarePress`, `IsSyncAcrossProfiles`, `modified_at`, ... | Bookkeeping. Ignore on import; emit sane constants on export.                                                                                                                       |

## 3. Mapping to our `KeyConfig`

| Our field                                  | From XML                                                                                                | Notes                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `label`                                    | `OptionalText.TextTitle`, falling back to `KeyName`                                                     | Display-only in our UI (`PadKey.svelte`) — never painted onto the hardware image, so this is a safe, lossless-enough mapping.       |
| `face: {type:'image', dataUrl}`            | `base64Image`, only when it's already a `data:image/...;base64,` URL                                    | Directly compatible with `rasterize()` — no conversion needed.                                                                      |
| `face: {type:'color'}` (fallback)          | —                                                                                                       | Used whenever `base64Image` is empty or a non-data-URL path (see §4.3).                                                             |
| `secondFace` (optional)                    | `SecondBase64Image`, ordered by `IsFirstImageSelected`                                                  | Toggle key's alternate face — see §4.4.                                                                                             |
| `action: {type:'open-url', url}`           | `CustomURL`, only when `FunctionType === 'Run browser'`                                                 | The URL is **not** in `FunctionValue` (that literally holds the string `"Run browser"`) — it's in the separate `CustomURL` element. |
| `action: {type:'navigate', target}`        | `FunctionType === 'Create Folder'`, `target` (a page) resolved via `OptionalText.Id` → child `ParentId` | See §4.2.                                                                                                                           |
| `action: {type:'navigate', target:'back'}` | `FunctionType === 'Back'`                                                                               | See §4.2.                                                                                                                           |
| `action: {type:'none'}` (fallback)         | —                                                                                                       | Every other `FunctionType` (see §4.1).                                                                                              |

`webhook` has no source in this format at all (Base Camp has no HTTP-request action) — it is
browser-only, never populated from a Base Camp file, and is exported as unassigned with a warning.

## 4. Gaps — what genuinely can't round-trip

### 4.1 Action types are mostly OS-level, not browser-safe

Observed `FunctionType`s: `Default` (unassigned), `OS Commands` (e.g. _Lock computer_),
`Run browser` (→ `CustomURL`), `Run Program` (local `.exe` path), `Open Folder` (Explorer
path), `Create Folder` (push a new pad page), `Back` (pop to parent page), `Hotkey Switch`
(global keyboard shortcut string).

Only `Run browser` maps to something a PWA can actually do (`window.open`). Locking the OS,
launching a native `.exe`, opening Explorer, or sending a global hotkey are categorically
impossible from a browser sandbox — no clever workaround exists (and none should be
attempted). **Plan:** import these as `action: {type:'none'}`, keep the key's label/icon, and
surface a plain-language warning listing what was dropped and why. Don't fail the import and
don't fail silently.

### 4.2 Multi-page / page navigation

Base Camp supports nested pages: pressing a `Create Folder` key jumps to a new set of 12 keys
(linked via `ParentId` → the trigger key's own `OptionalText.Id`); a `Back` key pops up one
level. Our keymap models this directly: `parseBasecampProfile` walks the `ParentId` tree
starting from the top-level page (`ParentId === 0`) and returns `pages: KeyConfig[][]`, one
12-key grid per page. A `Create Folder` key becomes `action: {type: 'navigate', target}`
pointing at its sub-page's index; a `Back` key becomes `action: {type: 'navigate', target: 'back'}`. Sub-pages no
key links to (nobody's `Create Folder` points at their `ParentId`) are reported in `warnings`
and dropped — there'd be no way to reach them on the pad anyway.

(`IsActive` — which page's bindings are the one currently painted on hardware — turned out not
to matter for import: we always treat `ParentId === 0` as the root page, which is what every
observed export uses `IsActive` for anyway. An earlier version of this doc proposed keying off
`IsActive` instead of `ParentId`; the tree-walk below supersedes that plan.)

### 4.3 Images: only inline base64 survives

`base64Image`/`ImageFilePath` show up in three shapes:

1. **Inline `data:image/png;base64,...`** — fully portable, imports as a pixel-perfect
   `face: {type:'image'}`.
2. **App-relative stock path**, e.g. `/images/default-profile/BLACK Icon update-05.png` —
   bundled inside the Windows installer, not fetchable from a browser.
3. **Absolute Windows path**, e.g. `C:\Program Files (x86)\Mountain Base Camp\...` — never
   resolvable from a browser, not even on the same PC.

Only (1) imports as an image. (2)/(3) fall back to today's default color swatch — the key
still gets its label, just not its icon. (Optional nice-to-have, not required for v1: bundle a
handful of Base Camp's own stock icons ourselves and map the well-known `/images/...` paths to
them — see §7, Phase 2.)

### 4.4 Second image / toggle state

`KeyConfig.secondFace` (optional) holds a toggle key's alternate face. Import parses
`SecondBase64Image` the same way as the primary face (inline data URL only, else a warning +
placeholder) and normalizes on `IsFirstImageSelected` so `face` always ends up the
currently-selected state and `secondFace` the other — our runtime toggle always starts at
state 0 (`face`) and flips to state 1 (`secondFace`) on each press, repainting via
`connection.applyKey`. Export always writes `face` back out as the first/selected image and
`secondFace` (if present) as the second.

## 5. Proposed architecture

Follows the existing layering (pure protocol code vs. browser-only code, per `CLAUDE.md`):

**New pure module — `src/lib/basecamp/profile.ts`** (own top-level folder: this is an
external vendor format, not part of our HID protocol):

```ts
parseBasecampProfile(xmlText: string): { pages: KeyConfig[][]; warnings: string[] }
serializeBasecampProfile(pages: KeyConfig[][]): string
```

Both directions return **warnings**, not exceptions — a partially-lossy import/export is a
normal, expected outcome given §4, not an error state.

- **Parsing:** since the schema is deterministic `XmlSerializer` output (§1) — flat, no
  attributes on data, predictable escaping — a small hand-written parser scoped to exactly the
  elements we need is enough, and keeps the module dependency-free and Node-testable (no
  `DOMParser`, which isn't available under Vitest's `server` project). This project currently
  has **zero runtime dependencies**; recommend keeping it that way unless real-world files turn
  out messier than our sample. _(Open question for you: fine with this, or would you rather
  pull in a tiny real XML parser like `fast-xml-parser` for extra robustness? See §8.)_
- **Serializing:** just template-string construction + one XML-escaping helper
  (`&`/`<`/`>`) — no library needed.

**Store change — `src/lib/state/keymap.svelte.ts`:** the keymap holds `pages: KeyConfig[][]`
plus an `activePage` rune; `keys` reads/writes `pages[activePage]` so most of the app can keep
treating it as a flat 12-key grid. `importAll(keys)` (single page, e.g. a legacy save or a
template) and `importPages(pages)` (multi-page, e.g. a Base Camp import) both replace the whole
keymap and persist.

**UI — `ProfileTools.svelte`:** two buttons next to "Reset all keys":

- **Import**: `<input type="file" accept=".xml">` → read as text → `parseBasecampProfile` →
  `keymap.importPages(result.pages)` → show `result.warnings` in a dismissible list.
- **Export**: `serializeBasecampProfile(keymap.pages)` → download via `Blob` + a temporary
  `<a download>` (standard browser pattern, no library).

**`connection.svelte.ts`:** a `navigate` key press calls `goToPage()`/`goBack()`,
which mutate `keymap`'s `activePage` (and navigation history) and repaint via the existing
`applyAll()` if connected. `PadGrid.svelte` shows a breadcrumb (Home / Back / current page) so
the same navigation works from the UI while editing, not just on physical key presses.

## 6. Before shipping: one hardware check

Confirm `KeyName` (`"M1"`..`"M12"`) really maps 1:1 to our key index `0`..`11` in reading
order (left-to-right, top row then bottom row) — connect a real pad, press the key physically
labeled **M1**, confirm DevTools reports `keyIndex 0`. This is a two-minute check, not a
blocker for building the parser, but worth doing before trusting imported labels/actions land
on the correct physical key.

## 7. Phasing

- **Phase 1 (shipped):** single active page, image import for inline base64 only,
  `Run browser` ↔ `open-url`, everything else downgrades with a visible warning. Export always
  produces one valid single-page `<Profile>` document.
- **Phase 2 (optional, not yet done):** bundle a handful of Base Camp's own stock icons so the
  common `/images/default-profile/...` / `/images/DKD/...` paths resolve instead of falling
  back to a plain color.
- **Phase 3 (shipped):** multi-page/page navigation in our own data model (`pages:
KeyConfig[][]` + a `navigate` action), for full-fidelity round-trip of profiles that
  use `Create Folder`.

## 8. Open questions

1. Hand-written scoped parser (zero deps, matches this project's current dependency count)
   vs. pulling in `fast-xml-parser` (~30 KB, zero-dep itself, more robust against XML edge
   cases we haven't seen yet) — recommend starting hand-written given how deterministic the
   vendor output is, revisit if real-world files prove messier.
2. Phase 2/3 — build now or defer? Recommend deferring; ship Phase 1 first and see what users
   actually hit.
