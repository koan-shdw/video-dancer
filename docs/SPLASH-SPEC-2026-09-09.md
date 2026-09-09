# SPLASH — the loading card (spec 2026-09-09, for his read; no code before GO)

## 0. His brief (his words, in order)

- "the app is taking a while to load now, so like an adobe style splash screen which shows
  whats being loaded while the app starts"
- "a grphic panel then info on whats loading"
- "artwork tall i think, i'll supply it"
- "i'd like there to be a list of things that are loading"

## 1. What exists (read + measured 2026-09-09)

**The boot today** (`src/main/index.ts` `app.whenReady` → `createWindow`):
1. main process starts, log opens (`==== Video Dancer 0.15.0 started ====`).
2. whenReady: reap orphaned GPU workers · read settings (LoRA folders → engine roots) · Bridge
   interpreter + Bridge logins (lazy reconnect) · warm the model-size cache (background) ·
   media:// protocol · IPC · app menu · temp + thumb pruning · settings re-encrypt.
3. `createWindow`: `BrowserWindow({ show: false, backgroundColor: '#0e0e11' })`, then
   `ready-to-show → show()`. **The window is invisible until the renderer's first paint.**
4. Renderer (`src/renderer/src/main.tsx` → `@koan/vidancer-ui` App): bundle evaluates (React,
   dockview, onnxruntime-web, the whole package) · `getSettings` → theme applied, layout
   store hydrated · dockview mounts the saved layout · `openLast()` opens the last project ·
   filmstrips extract after.

**Measured, his machine, five cold boots today** (the TEMP `[perf]` taps in App.tsx,
`logs/main.log`):

| mark | cold boot | HMR reload |
|---|---|---|
| main started → renderer "dockview ready" | 4.1–4.4 s | 0.2–0.4 s |
| open project (12 clips, 32 images) | 50–270 ms | 100 ms |
| first filmstrip after that | +1.1 s | +1.1 s |

So the wait is the renderer's own code coming up (bundle + first mount), ~4 s, during which
NOTHING is on screen; then the whole app lands at once. Project open is not the cost.

**Sibling check:** no KOAN app has a splash (grep across koan-live, KOAN.img, sprite-dancer,
koan-shared, the bible). This is the first; it enters the bible (ch. 06 WINDOWED shell,
"boot") when it ships. Bible z-order already names ONE "blocking bootstrap" layer; the splash
is its own window, so it sits outside the ladder.

## 2. From his seat

1. Double-click the icon. Within a blink (no React, a plain page): a **tall card**, centered
   on the screen, no frame, no title bar. His artwork fills the top. Under it the band:
   `VIDEO DANCER` · `0.16.0`, and a **list** that grows as things happen:

   ```
   ✓ settings
   ✓ engine folders
   ✓ bridge logins
   ✓ window
   ✓ app code
   ✓ theme
   · panels …
   ```
   Done rows dim with ✓. The live row is bright with a pulsing `…`. A failed row goes red with
   its reason (law 10), and the boot carries on.
2. `· project: viking spot …` → `✓ project: viking spot · 12 clips · 32 images`.
3. The instant the project phase closes, the app window shows and the card is gone in the same
   frame (no gap, no double window). Welcome / tour / What's New behave exactly as today, after.

## 3. The card

- **Window**: frameless, not resizable, no menu, centered on the display the cursor is on.
  In the taskbar (it IS the app starting). `alwaysOnTop` while it lives. Escape = nothing
  (the app is still loading); a click drags it (`-webkit-app-region: drag` on the art).
- **Size**: width **420**. Height = artwork height at 420 wide + band **176**. His artwork
  decides the top; spec assumes a tall image (portrait). Ships at
  `src/renderer/public/splash/art.png` (or .jpg, .webp); Vite copies `public/` into
  `out/renderer/`, so it packages with the app. The art is drawn `object-fit: cover`, width
  420, no border, no radius on top (the card has radius **8** = top-layer geometry, ch. 01).
- **Band** (176 tall, padding `12 16`): row 1 `VIDEO DANCER` logotype, mono, **20**, `--txt`
  · `0.16.0` mono **11** `--muted` on the same baseline right. Row 2: the list, mono **12**,
  line-height 18, up to 7 rows visible (the band scrolls the oldest out, newest always
  visible). Done `--muted` · live `--txt` · failed `--bad`. Nothing else: no progress bar
  (no history to fill it against, law 16), no logo second time, no buttons.
- **Theme**: the card paints in the user's theme (one var contract, ch. 01; hardcoded colors
  are violations). Mechanism: whenever the renderer applies a theme it also writes the six
  vars the card needs into settings (`splashPalette: { bg, txt, muted, bad, line, panel }`);
  main hands them to the splash page as a query string on load. First-ever boot = the AMBER
  defaults. Art stays art (no tint).

## 4. The list — what is loading, in the order it happens

Each phase is `{ id, label, state: 'doing' | 'done' | 'failed', ms, note? }`. Main owns the
list; rows are appended when a phase STARTS (the list grows), flipped when it ends.

| id | label on the card | who reports | when |
|---|---|---|---|
| `orphans` | `gpu workers` | main | `runtime.reapOrphans()` start → done (note: `n reaped` if any) |
| `settings` | `settings` | main | `loadSettings()` |
| `lora-dirs` | `engine folders` | main | `setExtraLoraDirs` after settings |
| `bridge` | `bridge logins` | main | `bridge.initBridge` (note: `n accounts`) |
| `window` | `window` | main | `createWindow()` → `did-start-loading` |
| `app` | `app code` | renderer | first line of `main.tsx` (bundle evaluated) |
| `theme` | `theme` | renderer | `applyTheme(...)` in App's settings effect (note: theme name) |
| `panels` | `panels` | renderer | dockview ready (replaces the TEMP `[perf] dockview ready` tap) |
| `project` | `project: <name>` | renderer | `openLast()` → done note `12 clips · 32 images`, or label `no project` when none, or failed `project moved` (App already knows: `noProjectAtBoot`) |

Not on the card (they run after show, in the background, as today): model-size cache warm,
temp/thumb pruning, filmstrips, updater check. They are not "loading the app".

Every phase change also logs `[boot] <id> <state> @ <ms>` to main.log — the boot measurement
becomes permanent and the two TEMP `[perf]` boot taps in App.tsx retire into it. The
`[perf] longtask` tracer is a separate pin (his call), untouched here.

## 5. Mechanics

- **`src/main/boot.ts`** (new): the list + `phase(id, label)` / `done(id, note?)` /
  `fail(id, why)`; `openSplash(palette)` builds the splash `BrowserWindow` (loads
  `out/renderer/splash.html`, dev: `ELECTRON_RENDERER_URL + '/splash.html'`), pushes the
  whole list on every change (`splash:list`); `closeSplash()`.
- **whenReady** wraps its steps in phases (order as §4). `createWindow` keeps `show: false`
  but **stops showing on `ready-to-show`**; instead `boot.done('project')` (or `fail`, or
  `no project`) triggers `mainWindow.show()` + `closeSplash()` in one tick.
  Guards: `ready-to-show` arms a **6 s** fallback that shows main + closes the splash if the
  renderer never reports (old bridge, crash); `render-process-gone` does the same at once. A
  second app instance (single-instance lock) never opens a splash.
- **Preload**: `bootPhase(id, state, note?)` = `ipcRenderer.send('boot:phase', …)` (fire and
  forget, the same lane as `mirror:state`). `vidancer-ui/src/env.d.ts` gains the signature.
- **Renderer** (`@koan/vidancer-ui` App.tsx + vi-dancer `main.tsx`): four calls (§4) where the
  events already are; no new state, no new component. The splash page itself is
  `src/renderer/splash.html` + `splash.ts`: plain DOM, ~80 lines, same CSP meta as
  index.html (no inline script), listens on `window.vidancer.onBootList` (preload exposes it
  to this page too — same preload, the page only uses that one call).
- **Build**: `electron.vite.config.ts` renderer `rollupOptions.input` becomes
  `{ index: index.html, splash: splash.html }`. `package.json` `files` already ships `out/**`.
- **Dev**: the splash shows on `npm run dev` too (he sees it every restart); an HMR reload of
  the renderer does not re-open it (only `whenReady` does).

## 6. Files

- new `src/main/boot.ts`, `src/renderer/splash.html`, `src/renderer/src/splash.ts`,
  `src/renderer/public/splash/art.<ext>` (his file)
- edit `src/main/index.ts` (whenReady phases, createWindow handover + guards),
  `src/preload/index.ts` (`bootPhase`, `onBootList`), `electron.vite.config.ts`
- edit koan-shared `vidancer-ui/src/App.tsx` (theme · panels · project phases; the two TEMP
  taps retire), `env.d.ts`, `lib/themes.ts` (write `splashPalette` on apply),
  vi-dancer `src/renderer/src/main.tsx` (`app` phase)
- docs: README (dev) one line; public README + manual: one line under Setup ("a loading card
  lists what the app is doing while it starts"); bible ch. 06 gains "boot: the splash card".

## 7. OPEN — his calls

**Decided 2026-09-09 (his words: "theme colors, card only while loading, works like adobe"):**
theme colors for the band · the card lives only while loading, in the taskbar like Adobe's ·
row words stay as written. Still open: the artwork file (he supplies; the app icon stands in
at `src/renderer/public/splash/art.png` until then). **PINNED** — a more urgent change came
first; build on his next GO for this spec.

1. **The artwork**: the file (he supplies). Its size sets the card's height at 420 wide.
   Width 420 itself: fine, or bigger?
2. **Taskbar**: the card shows in the taskbar while it lives (spec default). Or hidden?
3. **Theme-follow** for the band (spec default) or the fixed dark ground?
4. **Row labels**: the words in §4 are mine, lowercase per the tooltip law. Rewrite any.

## 8. Proof (untested until his boot)

- Cold boot on his machine: the card is on screen under 300 ms after the icon (main.log
  `[boot] window doing` vs the splash `did-finish-load`), the list grows in §4 order, the
  handover has no gap (screen recording), main.log carries the `[boot]` lines.
- Failure walk: rename the last project folder → `project moved` row in red, app opens on the
  no-project prompt as today.
- Old-bridge walk (dev, stale preload): the 6 s guard shows the app.
- Packaged: `npm run dist:win` → the card packages (`out/renderer/splash.html`, the art) and
  shows from the installed exe.
