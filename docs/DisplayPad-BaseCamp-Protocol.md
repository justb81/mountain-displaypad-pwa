# Mountain DisplayPad — BaseCamp Protocol Reverse-Engineering Report

**Source:** Mountain **BaseCamp v1.9.9** desktop app (`docs/BaseCamp_V1.9.9/`), reverse-engineered from its shipped DLLs/EXEs.
**Target device:** Mountain **DisplayPad** — a 6×2 macro pad (12 keys), each key a 102×102-pixel display. The SDK also exposes a whole-grid **800×240** image surface (`SetPanelImage`) laid across all keys — the firmware slices it into the twelve 102×102 key regions. USB HID, `VID 0x3282` / `PID 0x0009`, `REV 0x0008`.
**Method:** .NET assemblies decompiled with ILSpy (`ilspycmd` 9.0). Native DLLs analysed with `pefile`/`capstone`. Live hardware inspected with `pywinusb`/`Get-PnpDevice` against the connected pad.

> **How this maps to _this repo._** The web app (`src/lib/displaypad/`) is a clean-room WebHID re-implementation. BaseCamp is the vendor's own reference: it reaches the hardware through a native `DisplayPadSDK.dll` (below). Where BaseCamp's behaviour and this repo's `protocol.ts` disagree, both are noted. **Features BaseCamp has that this repo does not yet implement are called out in [§10](#10-features-not-yet-in-this-repo).**

---

## 1. Component map — which binary does what

BaseCamp is a multi-process app. Only the DisplayPad-relevant pieces are listed.

| Binary                                                | Managed?          | Role                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MountainDisplayPadWorker.exe`                        | ✅ .NET           | **The DisplayPad brain.** Hosts the key-event message pump, all host-side actions (macros, Spotify/Twitch/OBS, PC-info), and the P/Invoke layer into the native SDK. Exposes a JSON-over-TCP RPC server for the web UI. |
| `DisplayPadSDK.dll`                                   | ❌ native C/C++   | **The USB HID engine.** All wire-level I/O: enumerates the device, opens handles, frames pixel/control reports, parses key-state input reports, drives firmware update. The managed worker only calls its exports.      |
| `Base_Camp.exe`, `BaseCamp.UI.exe`                    | ✅ .NET (ASP.NET) | Web UI shell (Blazor/Razor + local web server) that the user configures profiles in; talks to the worker over TCP.                                                                                                      |
| `BaseCamp.Service.exe`                                | ✅ .NET           | Windows service for the **other** Mountain devices (Everest / Makalu keyboards, MacroPad) via `MacroPadSDK.dll`. Not DisplayPad.                                                                                        |
| `BaseCamp.Data.dll` / `.Repository.dll`               | ✅ .NET           | SQLite-backed profile/keymap persistence (`System.Data.SQLite`).                                                                                                                                                        |
| `BaseCamp.Spotify/Twitch/YouTube.dll`                 | ✅ .NET           | Third-party integrations used by key actions.                                                                                                                                                                           |
| `Makalu.dll`, `MacroPadSDK.dll`, `Everest360_USB.dll` | mixed             | Other devices (keyboards / macropad). Share the vendor's HID conventions but are **not** the DisplayPad.                                                                                                                |

**Operating model.** The worker starts a hidden-window message pump, registers a key callback with the native SDK, opens the USB driver, and puts each connected pad into **AP mode** (`APEnable(true)`). From then on the host owns the device: key presses arrive as callbacks and the host paints keys live. This is the same model this repo uses over WebHID.

---

## 2. The native SDK surface (`DisplayPadSDK.dll`)

Every export below is called by `MountainDisplayPadWorker` via `[DllImport("DisplayPadSDK.dll", CallingConvention = Cdecl)]`. This is the **complete, exact** P/Invoke surface (signatures verbatim from the decompiled `DisplayPadSDK` wrapper class). The last argument `ID` (a `uint`) is the device index for multi-pad setups.

### 2.1 Lifecycle / discovery

| Export           | Signature                                  | Purpose                                                                                                           |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GetDLLVersion`  | `int GetDLLVersion()`                      | SDK build version.                                                                                                |
| `OpenUSBDriver`  | `bool OpenUSBDriver(IntPtr hWnd)`          | Opens the HID driver; `hWnd` receives `WM_DEVICE_PLUG`/`WM_FW_PROGRESS` window messages.                          |
| `CloseUSBDriver` | `void CloseUSBDriver()`                    | Releases handles.                                                                                                 |
| `GetDevCount`    | `bool GetDevCount(ref int count)`          | Number of connected pads.                                                                                         |
| `IsDevicePlug`   | `bool IsDevicePlug(uint ID)`               | Presence check for one pad.                                                                                       |
| `GetDeviceInfo`  | `bool GetDeviceInfo(ref DevInfo, uint ID)` | `DevInfo { ushort vid, pid, fwVer, bootloadVer }`.                                                                |
| `GetDevAppVer`   | `ushort GetDevAppVer(uint ID)`             | App/firmware version word.                                                                                        |
| `GetFWInfo`      | `bool GetFWInfo(ref FWInfo, uint ID)`      | `FWInfo { ushort fwVer, wUndef; byte sizeProfile, byEffectModeIndex, currentlyProfileIndex, byEffectMenuIndex }`. |
| `ResetDevice`    | `bool ResetDevice(uint ID)`                | Soft reset.                                                                                                       |
| `SetKeyCallBack` | `void SetKeyCallBack(KEY_CALLBACK cb)`     | Registers `void cb(ushort wMatrix, bool bPressed, uint ID)`.                                                      |

### 2.2 Mode / global settings

| Export                                            | Signature                                                        | Purpose                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `APEnable`                                        | `bool APEnable(bool enable, uint ID)`                            | **Enter/leave "AP" (host-controlled) mode.** Enabled right after plug + on connect. |
| `EnableKeyFunc`                                   | `bool EnableKeyFunc(bool on, uint ID)`                           | Enable/disable the device's own key handling.                                       |
| `SetMainBrightness` / `GetMainBrightness`         | `bool …(byte brightness, uint ID)` / `bool …(ref byte, uint ID)` | Panel backlight 0–100 (see note in §7).                                             |
| `SetTFTSleepTime` / `GetTFTSleepTime`             | `bool …(byte status, byte hh, byte mm, byte ss, uint ID)`        | Screen (TFT) auto-sleep timer.                                                      |
| `DisplayLogo`                                     | `bool DisplayLogo(bool enable, uint ID)`                         | Show/hide the boot/idle logo.                                                       |
| `SetSyncAcrossProfiles` / `GetSyncAcrossProfiles` | `bool …(bool enable, uint ID)`                                   | Mirror a key across all profiles.                                                   |
| `SwitchProfile`                                   | `bool SwitchProfile(int profileNo, uint ID)`                     | Activate one of the 5 on-device profiles.                                           |

### 2.3 Imaging (the display)

| Export                             | Signature                                                                                             | Purpose                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SetIconPacket`                    | `bool SetIconPacket(byte iconNumber, ref PicPacketInfo, uint ID)`                                     | **Live per-key image push (AP mode).** `iconNumber` 0–11 = key index. Transient; not persisted. This is the workhorse for both static icons and streamed GIF frames. |
| `SetIconPic`                       | `bool SetIconPic(DisplayPicInfo, IntPtr data, int len = 31212, bool copyBuffer = false, uint ID = 0)` | **Persistent per-key image → device flash** (for standalone use). Carries profile, region rect, and animation params.                                                |
| `SetPanelImage`                    | `bool SetPanelImage(uint ID, IntPtr data, uint left=0, top=0, right=799, bottom=239)`                 | **Whole-panel image (800×240).** Used for the logo / screen-saver background spanning all keys.                                                                      |
| `SavePanelImage`                   | `bool SavePanelImage(uint ID, IntPtr data)`                                                           | Persist a panel image to flash.                                                                                                                                      |
| `ResetPicture`                     | `bool ResetPicture(uint ID)`                                                                          | Clear all key images.                                                                                                                                                |
| `ResetBtnPic`                      | `bool ResetBtnPic(byte profile, byte btnIndex, uint ID)`                                              | Clear one key's image.                                                                                                                                               |
| `CalculateBMP` / `CheckBMPStorage` | `bool …(ref byte count, uint ID)`                                                                     | Query free image slots (device stores up to `FW_MAX_BMP_NUM = 86` bitmaps).                                                                                          |
| `GetBtnBMPLength`                  | `bool GetBtnBMPLength(byte profile, byte btnIndex, ref byte len, uint ID)`                            | Stored image size for a key.                                                                                                                                         |

### 2.4 Key remap / macros / launch (persisted to flash for standalone mode)

| Export              | Signature                                                                                           | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ChangeKey`         | `bool ChangeKey(int source, int target, uint ID)`                                                   | Remap a key to a single keycode.                                                        |
| `ChangeShortcutKey` | `bool ChangeShortcutKey(int source, int target, int ctrlKey, uint ID)`                              | Remap to a modifier+key shortcut.                                                       |
| `SetLaunchContent`  | `bool SetLaunchContent(int source, int len, byte[] data, uint ID)`                                  | Store an "open program / URL / path" payload (≤1000 bytes) on a key.                    |
| `SetFullMacroData`  | `bool SetFullMacroData(int src, int type, int times, int eventLen, KEYMAP_EVENT[] events, uint ID)` | Store a full macro (≤1000 events) on a key. `type` = repeat mode, `times` = loop count. |
| `GetMacroContent`   | `bool GetMacroContent(int fwProfile, int macroIndex, ref MacroContent, int interval=2, uint ID=0)`  | Read a stored macro back.                                                               |
| `ResetKeys`         | `bool ResetKeys(uint ID)`                                                                           | Clear all key bindings.                                                                 |

### 2.5 Firmware / raw flash

| Export             | Signature                                                                                      | Purpose                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IsUpdating`       | `bool IsUpdating(uint ID)`                                                                     | Firmware-update in progress.                                                                                                                                  |
| `StartFWUpdate`    | `bool StartFWUpdate(uint ID, FWBinUpdateInfo)`                                                 | Flash new firmware. `FWBinUpdateInfo { IntPtr image, uint len, byte targetDev, uint fwVersion }`. Progress reported via `WM_FW_PROGRESS` (0–100, or −1 fail). |
| `EraseSectorMem`   | `bool EraseSectorMem(int start, int end, uint ID)`                                             | Erase flash sectors.                                                                                                                                          |
| `WriteSectorMem`   | `bool WriteSectorMem(int sector, int addr, int len, IntPtr data, uint ID)`                     | Raw flash write.                                                                                                                                              |
| `ReadSectorMemory` | `bool ReadSectorMemory(int sector, int addr, int len, IntPtr data, int interval=2, uint ID=0)` | Raw flash read.                                                                                                                                               |
| `ResetFlash`       | `bool ResetFlash(bool all, uint ID)`                                                           | Factory reset flash.                                                                                                                                          |

### 2.6 SDK constants (from the wrapper)

```
FW_NUM_PROFILE   = 5      // 5 on-device profiles
FW_NUM_KEY       = 12     // 12 keys
FW_MAX_BMP_NUM   = 86     // max stored bitmaps
NUM_FW_ICON_PACKET = 31   // pixel packets per 102×102 icon  (31 × 1024 ≥ 31212)
MAX_KEYBOARD_EVENTS = 1000
FW_SECTOR_NUM    = 80,  FW_SECTOR_MAX_LENGTH = 4096
MAX_DEV_COUNT    = 10
// Window messages posted to the OpenUSBDriver hWnd:
WM_DEVICE_PLUG   = 0x5401 (21505)   // wParam=deviceID, lParam: 1=plug 0=remove 2=suspend
WM_FW_PROGRESS   = 0x5402 (21506)   // lParam = percent (−1 fail, 100 done)
WM_KEY_STATUS    = 0x6400 (25600)
```

---

## 3. Image / pixel wire format _(CONFIRMED from managed encoder)_

This is the exact byte layout BaseCamp produces before handing pixels to the native SDK — it matches this repo's `encodeImage`.

- **Geometry:** each key window is **102 × 102**. Full panel is **800 × 240**.
- **Pixel order on the wire: BGR, 3 bytes/pixel, no alpha, no padding.**
  BaseCamp renders into a GDI `Format32bppRgb` bitmap (in-memory byte order **B, G, R, X**), then copies bytes `[0],[1],[2]` (B, G, R) per pixel and **drops** byte `[3]` (X/alpha). → `102 × 102 × 3 = 31212` bytes/key; `800 × 240 × 3 = 576000` bytes/panel.
- **Row order:** top-to-bottom, left-to-right, exactly as GDI `LockBits` returns it (origin top-left).
- **Packetisation (per key):** the 31212-byte BGR blob is sliced into **31 packets of 1024 bytes** (`PicPacket`). Bytes fill packet `n = (i*3)/1024` at offset `(i*3)%1024`, spilling across packet boundaries — i.e. one contiguous BGR stream chopped every 1024 bytes, last packet partially filled. Each `PicPacket` also carries a `byReportID` field, set to **0**.
- **`PicPacketInfo`** = `PicPacket[31]`. `SetIconPacket(keyIndex, &packetInfo, ID)` ships one key's 31 packets.

```
PicPacket  { byte byReportID; byte byData[1024]; }          // report-id byte + 1 KiB chunk
one key    = 31 × PicPacket  (31 KiB envelope for 31212 B of BGR)
```

**Rounded corners / press animation (cosmetic, host-side).** BaseCamp doesn't send a raw square: it masks each icon to a **40 px corner-radius** rounded rect over black, and when a key is _held_ it re-renders the icon at **80×80** with a border (a "pressed" shrink effect) before sending. Purely a host rendering choice — the wire format is unchanged.

### 3.1 Persistent images & on-device animation (`SetIconPic` / `DisplayPicInfo`)

For standalone (host-less) operation BaseCamp writes images into flash with region + animation metadata:

```
DisplayPicInfo {
  byte  byProfile;                 // which of the 5 profiles
  byte  byIcon;                    // key index 0–11
  byte  byLeft, byTop, byRight, byBottom;   // destination rect within the panel
  byte  byPicNum;                  // frame count (>1 ⇒ animation)
  byte  byPicIndex;                // frame index
  ushort wPicInterval;             // per-frame interval (ms)
}
```

So the device **can** store multi-frame animations natively. BaseCamp in AP mode does **not** use this for GIFs — see §3.2. The struct maps onto the `0x21` flash-mode announce frame (see §9.3) as: `byProfile`+`byIcon` → `buf[4]` (packed nibbles `(profile<<4)|(icon&0xF)`), `byLeft/Top/Right/Bottom` → `buf[6..9]`, `byPicNum` → `buf[10]` (frame count), `byPicIndex` → `buf[11]`, `wPicInterval` → `buf[12..13]` (u16 LE) — with `buf[1]=0x01` selecting flash+animation mode.

### 3.2 GIF / animation in AP mode (host-streamed)

GIFs are **not** offloaded to the device. BaseCamp spins a per-key background task that decodes each GIF frame (GDI frame-delay from property items `0x5100`/`0x5101`), renders it to 102×102 BGR, pushes it with `SetIconPacket`, `Thread.Sleep`s the frame delay, and loops. Animation = a stream of static frames from the host. (This repo's `template`/`remote` live faces are the analogue.)

---

## 4. Key-press input _(matrix map CONFIRMED; bit layout — see §9)_

Key presses surface through the registered callback `void CallBack(ushort wMatrix, bool bPressed, uint ID)`:

- `bPressed = true` on key-down, `false` on key-up.
- `wMatrix` is a hardware **matrix scan code**, not a 0–11 index. BaseCamp maps it with `GetImageIndex()`:

| `wMatrix`     | 8   | 17  | 26  | 35  | 44  | 53  | 62  | 71  | 80  | 89  | 98  | 125 |
| ------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **key index** | 0   | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  |

The scan codes step by **9** (`8 + 9·n`) for keys 0–10, then the 12th key is **125** (not 107). The step-of-9 strongly implies a row/column matrix where each logical key occupies a 9-slot stride; the final key's offset (125) is a firmware quirk to note when decoding raw input reports.

> This repo's `protocol.ts` instead decodes key state from bitmasks at **report bytes 42 & 47** of the 64-byte control input report. The native SDK's `wMatrix` is the same information after the SDK's own bit→scan-code translation. §9 reconciles the two representations from the native disassembly.

On key-down the worker records a `PressedData{ pressed, btnIndex, deviceID }` entry and runs the key's configured action; on key-up it cancels hold/repeat macro tasks and restores the un-pressed icon.

---

## 5. On-device macro format (`KEYMAP_EVENT`)

Macros stored on the device (`SetFullMacroData`) are arrays of 4-byte events:

```
KEYMAP_EVENT (4 bytes, Pack=1) {
  byte   keyByte;          // HID usage / key code (or mouse/wheel selector)
  byte   keyActionPage;    // packed: low nibble = keyAction, high nibble = keyPage
  ushort timer;            // delay / duration, little-endian
}
// keyActionPage accessors: keyAction = keyActionPage & 0x0F;  keyPage = (keyActionPage >> 4) & 0x0F
```

Action + repeat enums (from the SDK wrapper):

```
MACRO_ACTION:  ACTION_UP=1, ACTION_DOWN=2, ACTION_WHEEL=3, ACTION_MOUSE=4,
               ACTION_ONLY_DELAY=12, ACTION_CAP_DOWN=13
MACRO_REPEAT:  MACRO_ONCE=1, MACRO_LOOP=2, MACRO_TOGGLE=3, MACRO_PRESS=4   // → SetFullMacroData 'type'
```

`MacroContent { ushort wMacroSize; byte byKeyType, byDataIndex, byDataIndex2; KEYMAP_EVENT evt[1000]; }`.

In **AP mode** BaseCamp ignores on-device macros and replays events host-side via `InputSimulator` (SendInput): `keydown`/`keyup` with `VirtualKeyCode`, `mousedown`/`mouseup` (left/right/middle), and `wheel` — each with a per-event `delay`.

---

## 6. Full feature / action catalogue (AP mode, host-side)

Every key binding has a `FunctionType` (+ optional `SubFunctionType`). The complete set BaseCamp's DisplayPad worker dispatches:

**Navigation & profiles**

- **Create Folder / Open Folder / Back** — nested pages of keys (this repo's `open-folder`/`back`). Folder/Back keys get default glyphs.
- **Profile** — switch active profile; **Hotkey Switch** — jump to a specific profile.
- **Auto profile switching** — `ConfigureExeTracking()` watches `Win32_ProcessStartTrace`/`StopTrace` (WMI) and switches profile when a configured app launches/closes.

**Input injection**

- **Keyboard Function / Keyboard Shortcuts / Hotkey**, **Media** keys, **Mouse**, **Multi Action** (run several bindings), **Run Macro**, **Delay**, **OS Commands**.

**Launch**

- **Run Program**, **Run Browser**, **Open Folder** (filesystem). Payload marshalled through `SetLaunchContent`; app icons auto-extracted via `IconExtractor` (this repo's favicon/​icon convenience is the analogue).

**System monitor tiles** (`PC Info`, rendered as text over an icon, refreshed on a timer)

- CPU %, GPU load, RAM %, Disk, Network up/down/utilisation, LAN & Internet latency, Internet speed, **CPU ℃ / GPU ℃** (via `LibreHardwareMonitorLib`), **Clock** (12/24h, black/blue faces — see `eScreenSaverClockType`), **System Lock** screen.
- `ePCinfoType` enumerates all tile types (CpuUsage … SpotifyPlayListStart).

**Spotify** (`BaseCamp.Spotify`): Play/Pause, Next/Previous Track, Volume Up/Down/Set/Mute, Playlist Start, Play URI, Liked-Song Toggle, Save/Remove Song to/from Playlist, Song Info tile, Repeat Mode, Shuffle Mode, Change Playback Device.

**Twitch** (`TwitchLib`): Viewers tile, Chat Message, Clear/Slow/Sub/Emote/Followers Chat, Create Clip, Open Last Clip, Create Stream Marker, Play Ad, Stream Title/Game.

**YouTube** (`BaseCamp.YouTube`): Viewers tile.

**OBS** (`obs-websocket-dotnet`): scene/source control. **Zoom**, **Adobe**, **DaVinci Resolve**: app-specific hotkey bundles.

**Screen saver**: Clock face, custom image (via `SetPanelImage`), or "off" (`SetMainBrightness 0`); engaged on session-lock.

---

## 7. Behavioural notes & gotchas

- **AP mode is mandatory for live control.** `APEnable(true)` is issued on plug and on connect; without it the pad runs its own stored profile and won't deliver callbacks to the host.
- **Brightness 0 = screen off** is used deliberately for the "off" screensaver. (This repo's commit `9c47a34` "don't provide brightness 0 percent" is a UI guard — the SDK itself treats 0 as valid/off.)
- **Multi-device.** Every SDK call takes a device `ID`; the worker tracks a `List<DeviceData>` and a per-device GUID. Up to `MAX_DEV_COUNT = 10`.
- **Session lock** freezes key handling (`Common.IsSessionLock`) and shows the screensaver; unlock restores the active profile.
- **RPC surface.** The web UI drives the worker over TCP (localhost, ephemeral port): newline-free JSON `{ "Class": "DisplayPadSDK"|"OtherDeviceOperations", "MethodName": "...", "Parameters": [...] }` terminated by `<EOF>`; the worker reflects the call onto the named class and returns the result string. Not USB, but it's the app's public control plane.

---

## 8. Live hardware verification (the connected pad) _(CONFIRMED from the OS)_

The claims below were read from Windows' parsed HID descriptors (`HidP_GetCaps` via `pywinusb`) on the physically-attached pad, cross-checked with `Get-PnpDevice`. **Read-only** — no output/feature reports, init frames, or writes were issued.

**Identity.** USB composite device, bus description **"MOUNTAIN DisplayPad"**, hardware ID `USB\VID_3282&PID_0009&REV_0008` (bcdDevice `0x0008`). `product='MOUNTAIN DisplayPad'`, `manufacturer='Mountain'`, **serial empty**.

**Interfaces.** Three USB interfaces — **MI_00, MI_01, MI_03** (there is genuinely **no MI_02**; confirmed even including non-present devices). MI_00 fans out into **four** Windows HID collections; MI_01 and MI_03 are one vendor collection each. Six top-level collections total. Report byte-lengths below **include** the 1-byte report-ID prefix; the "payload" column subtracts it (that's what this repo's report/`PACKET_SIZE` constants correspond to).

| USB iface / collection | UsagePage / Usage                  | In     | Out      | Feat   | Payload                      | Report IDs                         | Role                                                   |
| ---------------------- | ---------------------------------- | ------ | -------- | ------ | ---------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `mi_00 col01`          | Generic Desktop / Keyboard         | —      | —        | —      | n/a                          | —                                  | Boot keyboard (OS-exclusive; Chrome hides from WebHID) |
| `mi_00 col02`          | `0x000C`/`0x0001` Consumer Control | 3      | **0**    | 0      | 2 in / 0 out                 | input **id=1**                     | Consumer-control TLC                                   |
| `mi_00 col03`          | `0x0001`/`0x0080` System Control   | 2      | **0**    | 0      | 1 in / 0 out                 | input **id=2**                     | System-control TLC                                     |
| `mi_00 col04`          | Generic Desktop / Mouse            | —      | —        | —      | n/a                          | —                                  | Mouse (OS-exclusive; Chrome hides from WebHID)         |
| **`mi_01`**            | **`0xFF01`/`0x0002`** vendor       | **0**  | **1025** | 0      | **1024 out, no in**          | single, **id=0** (unnumbered)      | **DISPLAY** — pixel-chunk sink                         |
| **`mi_03`**            | **`0xFF00`/`0x0001`** vendor       | **65** | **65**   | **65** | **64 in / 64 out / 64 feat** | single each, **id=0** (unnumbered) | **CONTROL** — init/image out, key-state/acks in        |

**What this confirms about this repo's `device.ts`:**

- **Display interface = 1024-byte unnumbered output, zero input reports** — exact. `OutputReportByteLength = 1025` = 1 prefix + 1024 (`CHUNK_SIZE`).
- **Control interface = 64-byte unnumbered input **and** output** — exact. The 65-byte `INIT_MESSAGE`/`IMAGE_MESSAGE` buffers (leading `0x00` pseudo-report-id + 64 data) match `OutputReportByteLength = 65`.
- **Unnumbered reports (`reportId 0`) on both vendor interfaces** — validates the `buildReport()` rule that `reportId === 0` passes `data` through unchanged (the byte-42/47 `KEY_BITS` offsets depend on it).
- **Role assignment by report-descriptor size, not enumeration order** — sound: the three WebHID-visible devices have mutually-exclusive size signatures (0-byte-output consumer/system vs 1024-output display vs 64/64 control).

**Additions / deviations to note:**

1. The "unused" MI_00 interface is richer than "consumer/keyboard": it exposes **keyboard + consumer-control + system-control + mouse** collections. Chrome strips the protected keyboard & mouse collections, so WebHID only ever sees the 0-byte-output consumer/system ones — consistent with this repo treating it as unused.
2. The **control interface also declares a 64-byte FEATURE report** (unnumbered). This repo doesn't use it; noted for completeness (a possible config/query channel).
3. Interface numbers are **0, 1, 3** — don't reintroduce any interface-number / enumeration-order assumptions.
4. MI_00's collections use **numbered** report IDs (consumer=1, system=2) — the other reason `buildReport()` keeps a nonzero-`reportId` reconstruction path even though the two interfaces the protocol uses are unnumbered.
5. A 6-second passive listen on the control interface produced **no spontaneous input** (expected — the pad emits key-state only on presses / in response to control frames). The interface opened **shared** (nothing held an exclusive lock).

### 8.1 Hardware validation — write path & persistence (tested 2026-07-15)

Driven directly against the physical pad (control via HID, pixel stream via `WriteFile`). Results:

- ✅ **Volatile whole-panel image works.** A custom **800×240** image (`0x21` panel-mode announce → **563 × 1024-byte** pixel stream) rendered across all 12 keys. The control path acked exactly as the state machine predicts: `11 80…` (init/AP echo) → `21 00 00 00` (announce echo) → `21 00 ff ff` (complete). Per-key `0x21` announce also acked.
- ⚠️ **Transport gotcha (native tools only):** the 1024-byte pixel chunks must go to the **interrupt-OUT endpoint via `WriteFile`**. `HidD_SetOutputReport`/SET_REPORT (what `pywinusb.send()` uses) silently drops them — the device acks the announce but nothing paints. **WebHID's `sendReport` routes correctly**, so this repo/the app is unaffected; it only bit the Python test harness.
- ❌ **Custom boot/idle logo: not possible.** The boot logo is a built-in firmware asset. `SavePanelImage` (`0x21`/`buf[1]=0x02`) did **not** override it and did **not** appear as the idle screen — after a power-cycle the pad showed its built-in logo, then its stored profile.
- ✅ **Standalone idle screen = the stored profile** (per-key images + macros), loaded from flash on boot. Confirmed by the power-cycle behaviour.
- ⚠️ **Per-key flash write not yet working.** A `SetIconPic` flash-mode write (`0x21`/`buf[1]=0x01`, profile in `buf[4]` high nibble) using the documented frame **did not persist** — after replug the stored profile was unchanged (written test icons absent). So one or more of {`buf[2..3]`, the 306-byte header vs none on the pixel stream, `packetCount` unit, profile-index base} is still wrong for flash mode. **Not destructive here** (profile survived intact), but a _correct_ flash write would overwrite stored profiles — needs a backup/restore path first.
- ⚠️ **`SwitchProfile` in AP mode blanks the live display** — the host must repaint; it does not auto-display flash images (BaseCamp calls `ChangeProfileFromUI` to re-push after switching).
- ⚠️ **Query/response unverified on hardware.** A `GetFWInfo` (`11 00`) probe did **not** return the expected `FF AA` reply within a short read window (though the control-in path delivers other status/ack reports). The request frames (§9.7) are sound; the **reply framing/timing needs validation** during implementation.

---

## 9. Native wire protocol (`DisplayPadSDK.dll` internals)

> **Confidence:** everything in this section is **confirmed from static disassembly** (x86, image base `0x10000000`; addresses/opcode bytes captured during analysis) and **cross-validated** where possible against the repo's own known-good frames — e.g. `SetIconColor`'s decoded announce reproduces the working `IMAGE_MESSAGE` byte-for-byte, and `APEnable` reproduces `INIT_MESSAGE`. It has **not** been exercised end-to-end on hardware here (the §8 hardware check was read-only), so a first implementation should still confirm behaviour by running it — but no USB capture is required; the frames below are complete.

**The engine is self-contained.** All HID I/O lives inside this one module — device enumeration via SetupAPI, `CreateFileA` with `FILE_FLAG_OVERLAPPED`, and overlapped `WriteFile`/`ReadFile`, plus `hid.dll` (`HidD_GetPreparsedData`/`GetAttributes`, `HidP_GetCaps`). `GetDLLVersion()` returns `12`. (The sibling `Everest360_USB.dll` / `makalu_67_dll.dll` are _other_ products and instead bundle `hidapi`; not used here.)

### 9.1 Device selection

Hard-coded in the driver constructor: **VID `0x3282`, PID `0x0009`, vendor UsagePage `0xFF00`, usage `1`.** Interfaces are matched by **VID + PID + vendor-usage-page** (never enumeration order); per-report byte lengths are read from `HidP_GetCaps`. This lines up exactly with §8: the control interface is the `0xFF00`/usage-`1` collection; the display interface is `0xFF01`/usage-`2`.

### 9.2 Transport

- **Write:** overlapped `WriteFile(hFile, buf, len, …)` where **`len` = the interface's HID `OutputReportByteLength`** (64 for control, 1025 for pixel) — not a hard-coded constant. On `ERROR_IO_PENDING` it waits ≤1000 ms.
- **Read:** a dedicated reader thread runs overlapped `ReadFile` (`len` = `InputReportByteLength`), waits infinitely, and exits on `ERROR_DEVICE_NOT_CONNECTED` (unplug).

### 9.3 Control frames — command map (writes)

Every "set" command builds a **64-byte** payload `buf[]` sent via the shared send-and-wait `0x1000b3d0`. Convention: `buf[0]`=opcode, `buf[1]`=sub-opcode, params follow. **In this repo's 65-byte message convention, `buf[i] == msg[i+1]`** (a leading `0x00` report-id byte, then the 64-byte frame). All offsets below are the 64-byte `buf[]`.

| Command                                                | buf[0] |    buf[1]     | Other bytes                                                                                                                                                   |
| ------------------------------------------------------ | :----: | :-----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APEnable`                                             | `0x11` |    `0x80`     | `buf[4]`=enable — this **is** the repo's `INIT_MESSAGE` (`buf[4]=1`)                                                                                          |
| `SetMainBrightness`                                    | `0x12` |    `0x03`     | `buf[4]`=level                                                                                                                                                |
| `SetSyncAcrossProfiles`                                | `0x12` |    `0x08`     | `buf[2..3]`=`0x0100`, `buf[4]`=flag                                                                                                                           |
| `EnableKeyFunc`                                        | `0x12` | `0x04`+enable | sub-op = `0x04` off / `0x05` on; no param byte                                                                                                                |
| `ResetFlash`                                           | `0x13` |    `0x40`     | `buf[4]`=profile (ack ≤12 s)                                                                                                                                  |
| `ResetKeys`                                            | `0x13` |    `0x60`     | — (ack ≤3 s)                                                                                                                                                  |
| `ResetPicture` (clear all images)                      | `0x13` |    `0x61`     | — (ack ≤12 s)                                                                                                                                                 |
| `ResetBtnPic` (clear one key)                          | `0x21` |    `0x00`     | `buf[5]`=`0x01`, `buf[8]`=`(profile<<4)                                                                                                                       | btn`*(nibble order inferred)*,`buf[18]`=`0xFF`                                                                                        |
| `SwitchProfile`                                        | `0x14` |    `0x00`     | `buf[4]`=profile **(1-based, `1..5`)**; ack echoes it                                                                                                         |
| `SetIconPacket` / `SetIconColor` (live image announce) | `0x21` |    `0x00`     | `buf[4]`=key, `buf[5]`=packetCount=`ceil(W·H·3/512)`, `buf[6..9]`=left/top/right/bottom (**1 byte each**)                                                     |
| `SetIconPic` (flash + animation)                       | `0x21` |    `0x01`     | `buf[4]`=`(profile<<4)                                                                                                                                        | (key&0xF)`, `buf[5]`=packetCount, `buf[6..9]`=rect, `buf[10]`=frameCount, `buf[11]`=frameIndex, `buf[12..13]`=intervalMs (**u16 LE**) |
| `SetPanelImage` (800×240)                              | `0x21` |    `0x00`     | `buf[2..3]`=`0x0100` (panel selector), `buf[4..5]`=packetCount, `buf[6..7]`=left, `buf[8..9]`=top, `buf[10..11]`=right, `buf[12..13]`=bottom — **all u16 LE** |
| `SavePanelImage`                                       | `0x21` |    `0x02`     | as `SetPanelImage`, persisted to flash                                                                                                                        |
| `SetTFTSleepTime`                                      | `0x22` |    status     | `buf[4]`=HH, `buf[5]`=MM, `buf[6]`=SS (enable flag is in `buf[1]`)                                                                                            |
| `DisplayLogo`                                          | `0x23` |    on/off     | —                                                                                                                                                             |
| `SetFullMacroData`                                     | `0x14` |    `0x18`     | header frame, then `0x15` event chunks (15 events × 4 B per frame, ≤1000)                                                                                     |
| `SetLaunchContent`                                     | `0x17` |      arg      | payload                                                                                                                                                       |

**The image family (`0x21`) multiplexes** on `buf[1]` (`0x00` live · `0x01` flash+animation · `0x02` save-panel) **and** `buf[2..3]` (`0x0000` per-key vs `0x0100` whole-panel). Coordinate-field **width differs**: **1 byte** for a ≤255-px key, **2-byte LE** for the 800×240 panel. `packetCount` is in **512-byte units** (`0x3D`=61 for a 102² key; `0x0465`=1125 for the full panel) and is a header field only — the pixels stream separately (§9.4). `SetIconColor`'s decode reproduces the repo's existing working `IMAGE_MESSAGE` byte-for-byte (`00 21 00 00 00 <key> 3d 00 00 65 65`), which validates the whole model end-to-end.

> **Correction to the first pass:** `SetPanelImage` coordinates are **little-endian** (low byte first), not big-endian — the _values_ `0x031F`/`0x00EF` for 799/239 are right, the byte order was stated wrong. And `SetTFTSleepTime`'s enable flag is in `buf[1]`, with HH/MM/SS at `buf[4..6]` (not all four packed from `buf[4]`).

**ACK:** after a control write the engine waits on the completion event — **500 ms** control, **600 ms** image (some resets/queries pass longer timeouts, e.g. `CheckBMPStorage` 9 s, flash reset 12 s). Success is either the query marker `response[0]==0xFF && response[1]==0xAA` (§9.7), or, for an image announce, an echo of `0x21` with a `0xFFFF` marker.

### 9.4 Image transfer

`SetIconPacket` sends the 64-byte `0x21` announce frame (fields decoded in §9.3: key/profile, `packetCount`, rect), sets a `0xFFFF` pending marker, then streams the BGR pixels to the **display** interface in **1024-byte chunks** (per key: 31212 image bytes → the repo pads to 31 × 1024 via a leading `HEADER_SIZE` zero prefix; full panel: 576000 bytes → 563 chunks). This is exactly this repo's INIT→announce→stream→echo state machine. The three image modes (live / flash+animation / save-panel) and per-key vs whole-panel targeting are all selected by the announce frame's `buf[1]` and `buf[2..3]` — the pixel-stream mechanics are identical across them.

### 9.5 Input reports & key decoding

- `report[0]` = HID report ID; **`report[1]` = event type** (`1` = key-state; `0x11`/`0x19` = data replies).
- **Key-state bitmap sits at report bytes `0x2C–0x2F` (44–47).** The engine change-detects by reading the two words there.
- Per key, from a runtime key table: state bit = `report[(bitPos >> 3) + 2]`, bit `bitPos & 7` (the `+2` skips report-ID byte 0 and type byte 1). The reported **`wMatrix`** is a separate field of that table entry.
- On a changed bit the engine queues `{wMatrix, pressed, ID}` and a dispatch thread calls the registered callback.

**Reconciliation with this repo.** The managed scan codes `8,17,…,125` (§4) are the `wMatrix` _labels_; the physical report **bit positions are a different field** whose bytes land at `0x2C–0x2F`. So this repo's byte-42/47 `KEY_BITS` and BaseCamp's `wMatrix` describe two different fields — both internally consistent. The exact per-key bit positions are built at runtime from a layout config and **could not be extracted statically**, so 42/47 vs 44–47 can't be settled from the binary alone — but the engine's own bitmap read at 44–47 corroborates this repo's offsets (and §8 confirmed the 64-byte control report where they live).

### 9.6 Extra exports (not used by the managed worker)

Beyond §2, the native module also exports `GetExtendInfo`/`SetExtendInfo`, `GetFWLayout`, `GetBtnInfo`, `SetIconColor`, and `RemoveDeviceDriver` — additional capability surface (e.g. `SetIconColor` = solid-colour key fill without a bitmap) worth knowing about.

### 9.7 Query / response commands (reads)

Read commands send a 64-byte request (same convention as §9.3) and the device replies with a **control-interface input report** carrying a fixed marker:

```
data[0] = 0xFF        reply marker
data[1] = 0xAA        reply marker
data[2] = opcode echo     (correlate reply → request)
data[3] = sub-op echo
data[4..] = payload
```

The control interface is unnumbered (report id 0), so **SDK `reply[N]` == the WebHID `inputreport` `event.data` byte `N`** (this repo's `buildReport` is a no-op for report id 0). A WebHID reader matches replies with `report[0]===0xFF && report[1]===0xAA` — distinct from the `0x01` key-state / `0x11` init-ack / `0x21` image-ack reports in §9.5, so it coexists cleanly. (The first pass's "reply types `0x11`/`0x19`" were the **opcode echo at `data[2]`**, not `data[0]`.)

| Query                   | request `buf[0] buf[1]` (extra)            | reply payload (offsets into `data`)                                                                          |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GetDeviceInfo`         | `0x30 0xAA` (`buf[2]=0x55, buf[3]=0x80`)   | `vid`=`data[5..6]`, `pid`=`data[7..8]`, `fwVer`=`data[9..10]`, `bootloadVer`=`data[11..12]` — **all u16 LE** |
| `GetFWInfo`             | `0x11 0x00`                                | `fwVer`=`data[4..5]` (u16 LE), **profileCount**=`data[8]`, **activeProfile**=`data[10]` (0-based)            |
| `GetFWLayout`           | `0x11 0x12`                                | `layout`=`data[4]`                                                                                           |
| `GetMainBrightness`     | `0x12 0x00` (`buf[3]=0x01`)                | `brightness`=`data[5]`                                                                                       |
| `GetTFTSleepTime`       | `0x22 0x00` (`buf[3]=0x01`)                | 4 config bytes `data[4..7]` (status,HH,MM,SS)                                                                |
| `GetSyncAcrossProfiles` | `0x12 0x08`                                | `enabled` = `data[4] != 0`                                                                                   |
| `CalculateBMP`          | `0x11 0x03`                                | free-slot result `data[4]`                                                                                   |
| `CheckBMPStorage`       | `0x11 0x04`                                | status `data[4]` — **9 s** reply timeout                                                                     |
| `GetBtnBMPLength`       | `0x11 0x05` (`buf[4]=profile, buf[5]=btn`) | echoes `data[4..5]`, length `data[6]`                                                                        |

`GetDevAppVer` is **not** a wire query — it reads the USB `bcdDevice` release word from enumeration (unavailable to WebHID); use `GetFWInfo`/`GetDeviceInfo` for a firmware version instead.

> **Profile-index gotcha (both confirmed):** `SwitchProfile` takes a **1-based** index (`1..5`), but `GetFWInfo`'s `activeProfile` (`data[10]`) is **0-based** — "switch to profile _N_" ⇒ `activeProfile == N-1`. `GetFWInfo`'s `profileCount` field is the raw device byte at `data[8]`; the managed `FWInfo.sizeProfile` stores `data[8]-1`.

---

## 10. Features not yet in this repo

Opportunities surfaced by BaseCamp that the current WebHID app doesn't (yet) use:

1. **Whole-panel image (`SetPanelImage`, 800×240).** A single background image spanning all 12 keys (logo / screensaver / wallpaper), rather than 12 independent icons. This repo paints per-key only.
2. **Persistent / standalone config.** `SetIconPic` (flash images per profile), `ChangeKey`/`ChangeShortcutKey`, `SetLaunchContent`, `SetFullMacroData` let the pad work with **no host running**. This repo is purely live/AP-mode.
3. **On-device multi-frame animation** (`DisplayPicInfo.byPicNum`/`wPicInterval`) instead of host-streamed GIF frames.
4. **Brightness & TFT sleep timer** (`SetMainBrightness`, `SetTFTSleepTime`) — global panel controls.
5. **5 hardware profiles** with `SwitchProfile` + "sync key across profiles".
6. **Firmware update & raw flash** (`StartFWUpdate`, `Read/Write/EraseSectorMem`) — power-user territory, but fully documented above.
7. **`DisplayLogo` / boot logo** toggle.

---

## Appendix A — Reproduction

```bash
# Decompile the managed worker (has the full P/Invoke surface + all logic):
ilspycmd -p -o out/ MountainDisplayPadWorker.exe
#   → DisplayPadWorker.Helpers/DisplayPadSDK.cs        (P/Invoke signatures, structs, constants)
#   → DisplayPadWorker.Helpers/DisplayPadOperations.cs (image encoder, GIF streamer, actions)
#   → DisplayPadWorker.Helpers/DisplayPadMessagePumpManager.cs (key callback → index map)

# Files are stored in docs/BaseCamp_V1.9.9/ with a "_<crc32>" suffix after the real extension;
# strip the suffix before decompiling.
```

The native `DisplayPadSDK.dll`, `SDKDLL.dll`, `MacroPadSDK.dll`, `Everest360_USB.dll`, and `makalu_67_dll.dll` are **native** PE files (no managed metadata) — analyse with a disassembler, not ILSpy. `Makalu.dll` is managed (a different device's app).
