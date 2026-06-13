# Video Dancer (`vi-dancer`) — Definitive Architecture & Audit

> Engineering reference for the maintainer. Covers every subsystem, the full data model, the complete IPC surface, the generation/export pipeline, the build/publish/auto-update chain, and a consolidated risk register. Synthesized from 11 subsystem deep-dives; file:line citations are carried through verbatim.

---

## 1. What it is

**Video Dancer** is a local-first Electron desktop NLE (non-linear editor) for AI-generated video. Users author prompt "recipes" (freeform + structured scene/character/beat fields), render them through fal.ai video models (Seedance 2 `ref2v`/`i2v` is the live-verified primary, with Sora 2 partially wired), assemble the rendered takes on a Premiere-style multi-timeline with a music lane, trims, slice, and reorder, and export to mp4 via a bundled `ffmpeg-static` binary. An integrated Image Editor generates and edits stills through Nano Banana (Gemini 2.5 Flash Image on fal). API keys are bring-your-own and stored only in Electron `userData/settings.json`. Projects are self-contained folders with a `project.json` that stores all media paths relative to the project directory.

**Tech stack (exact):**

| Layer | Technology |
|---|---|
| Runtime | Electron (target 31), Node 20 (CI) |
| Build | `electron-vite` (three-root), Vite, Rollup |
| Language | TypeScript (`moduleResolution: Bundler`, `strict`, `noEmit`), `types: [node, @webgpu/types]` |
| UI | React (StrictMode **disabled**), `dockview-react` (dockable panels), Zustand (single store) |
| Video gen | `@fal-ai/client` (ESM, bundled into CJS main) — Seedance 2, Sora 2 |
| Image gen | fal.ai Nano Banana / `gemini-25-flash-image` |
| Export | `ffmpeg-static` (spawned child process; `asarUnpack`ed) |
| Packaging | `electron-builder` (NSIS on Win, DMG on Mac) |
| Auto-update | `electron-updater` (Windows-only at runtime) |
| Distribution | GitHub Releases, public repo `ahamitchell/video-dancer` |

---

## 2. Top-level architecture

### 2.1 Process model

Three independently compiled roots (one `electron-vite` build, see `electron.vite.config.ts:7-28`):

- **main** (`src/main/**`) — Node/CJS, output `out/main`. App lifecycle, `BrowserWindow`, all `ipcMain` handlers, the single in-memory `Project` singleton, fal generation, ffmpeg export, the `media://` streaming protocol, settings, and logging. `@fal-ai/client` is bundled (excluded from `externalizeDepsPlugin`) because it is ESM-only.
- **preload** (`src/preload/index.ts`) — Node/CJS, output `out/preload`. A single `contextBridge` exposure of `window.vidancer`, mapping every renderer method to an `ipcRenderer.invoke`/`on` channel. Runs **unsandboxed** (`sandbox: false`).
- **renderer** (`src/renderer/src/**`) — browser/ESM React SPA, output `out/renderer`, alias `@renderer → src/renderer/src`, HTML entry `src/renderer/index.html`. `contextIsolation: true`, no `nodeIntegration`.

`BrowserWindow`: 1440×900 (min 1024×640), `backgroundColor #0e0e11`, `autoHideMenuBar`, `show:false` until `ready-to-show` (`index.ts:120-125`).

### 2.2 End-to-end data flow

```
User edits a clip (RenderPanel)
  → local React state → 600ms debounced auto-save
  → window.vidancer.clipSetPromptData(clipId, partial)            [IPC]
  → project.ts mutates `current` Project in place → saveProject() (atomic tmp+rename)
  → returns ProjectDelta → store.applyDelta() merges by id

User clicks Render
  → window.vidancer.render(RenderArgs)                            [IPC]
  → fal.ts: upload images → fal.subscribe(endpoint, payload) → download mp4 to <proj>/renders/
  → importImage() each source → addTake() snapshots PromptData
  → returns { delta, clipId, takeId, bytes } → store merges; mp4 plays via blob

User drags clip to Timeline
  → addToTimeline → window.vidancer.timelineSet(tlId, items[])    [IPC, whole-array write]
  → ProjectDelta → store merge

Playback
  → Monitor reads keeper-take mp4 via media://x/<path> (Range/seekable)
  → onTimeUpdate → tlSetProgress → isolated Playhead/TimeReadout re-render only

Export
  → window.vidancer.exportRun(tlId)                               [IPC]
  → export.ts flattens timeline → Seg[] → single ffmpeg filter_complex → mp4
  → export:progress strings pushed to renderer
```

All media reaches the renderer through the **`media://x/<encodeURIComponent(absPath)>`** custom protocol (Range-enabled, CORS `*`), never through reading bytes over IPC — except the one render-return path that does send raw mp4 bytes (see Risks).

### 2.3 Annotated directory map

```
vi-dancer/
├─ package.json                 # version, electron-builder build config, scripts
├─ electron.vite.config.ts      # three-root build (main CJS / preload CJS / renderer ESM)
├─ tsconfig.json                # single config for all three roots; moduleResolution=Bundler
├─ .github/workflows/release.yml# CI matrix (win NSIS + mac DMG) → electron-builder --publish always
├─ TODO.md  README.md           # roadmap + public/beta docs (some STALE — see Risks)
├─ docs/                        # 6 prior self-audits & specs (architecture, UX, image-editor, export, distribution)
├─ build/icon.png               # app icon (dev only; packaged pulls from exe)
└─ src/
   ├─ shared/                   # types.ts (canonical model), models.ts (video engines), imageModels.ts
   ├─ main/
   │  ├─ index.ts               # entry: window, IPC registry, media:// handler, settings
   │  ├─ project.ts             # Project singleton, CRUD, persistence, undo/redo, deltas, dynamic stills
   │  ├─ fal.ts                 # video generation (Seedance/Sora)
   │  ├─ falImage.ts            # image generation (Nano Banana)
   │  ├─ export.ts              # timeline → mp4 via ffmpeg
   │  ├─ updater.ts             # electron-updater (Windows-only)
   │  └─ log.ts                 # file log + rotation + crash capture
   ├─ preload/index.ts          # window.vidancer contextBridge surface
   └─ renderer/src/
      ├─ main.tsx               # React root (StrictMode OFF), error forwarding
      ├─ App.tsx                # dockview host, workspaces, shortcuts, header
      ├─ store.ts               # Zustand store: full client state + all actions
      ├─ env.d.ts               # global type re-exports + VidancerApi
      ├─ panelBus.ts            # module-level openers (no prop-drilling)
      ├─ media.ts               # mediaUrl(file, rev?) builder
      ├─ emitYaml.ts            # prompt assembly (buildYaml/buildCombined/lintFields)
      ├─ prompt.tsx             # textPrompt/confirmDialog/alertDialog (native-dialog replacements)
      ├─ Thumbnail.tsx          # media:// image wrapper + hooks
      ├─ audioBus.ts            # single-owner audio arbitration
      ├─ panels/                # RenderPanel, Beats, ClipFields, Timeline, TimelineEditor,
      │  │                      #   Monitor, SourceMonitor, Bin, Library, Foldered, ImageEditor,
      │  │                      #   Settings/Workspaces/About/CheatSheet modals
      │  └─ shared/             # MentionInput.tsx, playback.tsx (Playhead/TimeReadout)
      ├─ lib/                   # timelineUtils, filmstrip, waveform, beatUtils, clipMeta,
      │                         #   dragDrop, frameGrab, time, validation
      ├─ ui/                    # tokens, controls, icons, Modal, Toast, PanelErrorBoundary
      └─ preview/WebGpuVideoSpike.tsx  # DEAD CODE (Phase-0 WebGPU/WebCodecs proof; not imported)
```

---

## 3. Subsystem deep-dives

### 3.1 App shell, windows, protocols, settings (`src/main/index.ts`, `preload/index.ts`, `log.ts`)

**What it does.** Bootstraps the app, creates the window, registers every IPC handler via `registerIpc()`, serves local media, persists settings, and logs crashes.

**Key mechanisms:**
- **`media://` protocol** — declared privileged pre-`whenReady` (`registerSchemesAsPrivileged`, `index.ts:10-12`) with `standard, secure, supportFetchAPI, stream, bypassCSP`; handler at `index.ts:552-589` decodes the abs path, gates via `insideProject()`, and streams with HTTP **Range** support (206 Partial Content), `Accept-Ranges: bytes`, `Access-Control-Allow-Origin: *`. Content-Type by extension, fallback `image/jpeg`.
- **`insideProject()` guard** (`index.ts:538-544`) — `path.resolve` both sides, lowercase on win32, reject via `path.relative` if empty / `..`-prefixed / absolute. Returns false (403) when no project open.
- **Atomic serialized settings** (`index.ts:91-105`) — module-level `settingsChain` promise serializes writes; `patchSettings()` does read-modify-write to `settings.json.tmp` then `rename`. Pretty-printed (`null, 2`).
- **Logging** (`log.ts:46-75`) — `userData/logs/`, rotates `main.log → main.prev.log` at 2 MB, tees `console.*` via synchronous `appendFileSync`, captures `uncaughtException`/`unhandledRejection` as FATAL, accepts renderer errors via `log:renderer`. All catches empty (best-effort).
- **`project:delta` push** (`index.ts:137`) — `setDeltaPush()` wires main-initiated mutations (dynamic-still reconcile) to `mainWindow.webContents.send('project:delta', d)`.
- **Single-export lock** (`index.ts:314-335`) and **auto-project creation** on first render (`index.ts:473`: silent `newProject(documents, 'Untitled')`).

**Security posture:** `contextIsolation: true`, no `nodeIntegration`, but `sandbox: false` (`index.ts:123`) — the preload runs unsandboxed, so any contextBridge escape reaches Node directly. `shell:openExternal` restricts to `https://` (`index.ts:248`).

### 3.2 Project data model & persistence (`src/main/project.ts`, `src/shared/types.ts`)

**What it does.** Holds one open project (`current: Project | null`), performs all mutations in place, persists atomically, maintains undo/redo, and returns sparse `ProjectDelta`s.

**Key mechanisms:**
- **Single open project singleton**; every renderer mutation → IPC → mutate `current` → `saveProject()` → return delta.
- **abs↔rel paths** — `toRelative()` (`project.ts:77`) strips `dir` and relativizes `file` fields before write; `toAbsolute()` (`project.ts:59`) rejoins after read. `dir` is runtime-only, never on disk.
- **Atomic serialized save** (`project.ts:139`) — synchronous snapshot to string, appended to `saveChain`, written `project.json.tmp` then renamed.
- **Snapshot undo/redo** (`project.ts:195-218`) — push prior `JSON.stringify(current)` to `undoStack` (cap 80) on each non-restoring mutation; restore via `JSON.parse`, `restoring=true` so the consequent save isn't recorded.
- **Migration** (`project.ts:98`) — `SCHEMA_VERSION = 5`; promotes legacy flat `timeline[]` → `timelines: Timeline[]`, defaults v3–v5 optional fields; `schemaVersion > 5` warns but opens best-effort.
- **Take freeze** — `addTake()` deep-copies `promptData` into `take.snapshot` (`project.ts:287`); `cloneClipFromTake()` restores from `snapshot ?? promptData` (`project.ts:477`).
- **Dynamic stills** — `scheduleDynamicReconcile()` (400ms debounce, `project.ts:698`) re-extracts first/last frames when the bound `TimelineItem`'s source frame moves; pushes delta via `deltaPush`.
- **Cross-project import** (`importClipsFrom`, `project.ts:1039`) — deep-copies clips with new UUIDs, copies mp4s into `renders/` (`import_<uuid>`), resolves `@title` collisions and rewrites references.
- **Rename cascade** (`renameImage`, `project.ts:789`) — rewrites `@title` mentions across all clip promptData and frozen take snapshots with a `(?!\w)` boundary.
- **Folder delete reparents** children to the deleted folder's parent (`project.ts:859`); media files are never deleted.

### 3.3 Build/dist/auto-update (`package.json`, `electron.vite.config.ts`, `release.yml`, `updater.ts`)

See §8 for full detail. In brief: three-root build; `dist:win`/`dist:mac` build then package `--publish never`; CI publishes on `v*` tags; `initUpdater` runs Windows-packaged-only, silent download, 4s initial check + 3h poll.

### 3.4 Renderer shell, dockview, workspaces, store (`App.tsx`, `store.ts`, `panelBus.ts`, `main.tsx`)

**What it does.** Single React tree; `App.tsx` owns the `DockviewApi` ref and workspace persistence; `store.ts` holds all client state.

**Key mechanisms:**
- **StrictMode disabled** (`main.tsx:16`) due to double-invoked effects conflicting with imperative video control. Renderer errors forwarded via `logRenderer` (`main.tsx:6-12`).
- **`onReady`** (`App.tsx:288`) captures the API ref, calls `initWorkspaces`, registers five `panelBus` openers, wires the 600ms-debounced layout-change listener (`App.tsx:371-376`), then calls `openLast()` (`App.tsx:377`).
- **Workspaces** are named layout presets in `settings.workspaces` + `activeWorkspace`; 'Default' is never persisted (`defaultLayout`, `App.tsx:34-48`). `applyWorkspace` (`App.tsx:59-73`) restores via `api.fromJSON` else `defaultLayout`, then always `ensureSource` (`App.tsx:51-56`) to backfill the source panel into older layouts.
- **`mergeDelta`** (`store.ts:10-49`) upserts by id, removes by `removedXIds`, replaces `folders`/`activeTimelineId` wholesale, preserving object identity for untouched slices. `applyDelta` (`store.ts:224-253`) then keeps `editTimelineIndex`/`tlIndex`/`selectedTlItemId`/`selectedClipId` coherent (tracks the edited slot by **item id** across reorders). `restorePatch` (`store.ts:160-169`) does the same after undo/redo.
- **`panelBus`** — five module-level slots (`opener`, `tlEditorOpener`, `imgEditorOpener`, `clipEditorOpener`, `tlMonitorOpener`), set once in `onReady`, called via `openFolderPanel`/`openTimelineEditor`/`openImageEditor`/`openClipEditor`/`raiseTimelineMonitor`; all no-op (`?.()`) if null.
- **Keyboard shortcuts** (`App.tsx:129-184`): Esc, Ctrl+Z/Shift+Z/Y, Del/Backspace, `?`, Space, ←/→, Home/End — guarded against form controls.
- **Auto-update chip** subscribes to `onUpdateStatus` (`App.tsx:97-104`); `ready` enables `updateRestart()`.

### 3.5 Clip Inspector — the prompt/render brain (`RenderPanel.tsx`, `ClipFields.tsx`, `Beats.tsx`, `emitYaml.ts`, `MentionInput.tsx`)

**What it does.** ~1262-line component owning all clip form state and render dispatch.

**Key mechanisms:**
- **Prompt assembly** — `buildCombined(effectiveFreeform, effectiveStructured)` (`emitYaml.ts:83`) joins freeform + a YAML block (`buildYaml`, `emitYaml.ts:48-64`) whose beats become `MM.SS_MM.SS_snake(name)` keys for Seedance's `cinematic_storyboard`. Cross-clip links splice linked-clip text before the user's own (`RenderPanel.tsx:83-155`).
- **Auto-save** (`RenderPanel.tsx:558-576`) — single effect, 600ms debounce, `loadingRef` guards the post-load run, `beatsDirtyRef` excludes beats unless the user edited them here (prevents clobbering SourceMonitor's beat writes).
- **Load-and-populate** (`RenderPanel.tsx:251-318`) on `[selectedClipId, editTimelineIndex, undoTick]`.
- **Mode toggle** (`switchMode`, `RenderPanel.tsx:522`) carries images across `i2v`↔`ref2v`; `buildPromptData` maps refs per mode.
- **Two-way `@mention`↔ref binding** (`RenderPanel.tsx:380-475`); inline mention autocomplete duplicated from `MentionArea` (`MentionInput.tsx`).
- **T-chip take-field restore** (`onTakeDrop`, `RenderPanel.tsx:667-751`) restores individual snapshot fields via `MIME_TAKE`.
- **Linting** — `lintFields` (`emitYaml.ts:87`, advisory) vs `validateForm` (`validation.ts:21`, hard-block). Cost estimate at `RenderPanel.tsx:186-189`.
- **Render** (`RenderPanel.tsx:578`) → `window.vidancer.render()` → `applyDelta` + blob playback + `refreshCredit()`.

### 3.6 The main Timeline (`Timeline.tsx`, `TimelineEditor.tsx`, `timelineUtils.ts`, `filmstrip.ts`)

**What it does.** Proportional flex timeline; each block's CSS `flex` equals its `effDur` in seconds (no pixels-per-second model). Zoom = CSS width `${zoom*100}%` inside `overflow-x:auto`.

**Key mechanisms:**
- **View resolution** — `resolveView` (`timelineUtils.ts:32-46`): `useRecipe` → live promptData (trims ignored); else `resolveTake` priority `item.takeId → keeperTakeId → last take`. `effDur` (`timelineUtils.ts:72-78`) clamps in/out to source, min 0.25s.
- **Single write bottleneck** — every mutation (reorder, trim, pick, mute, add, remove, slice) calls `setTimelineItems` → `window.vidancer.timelineSet(tlId, items[])` with the **whole array**.
- **By-INDEX addressing** for all operations on a render-time array snapshot (no generation/CAS).
- **Drag** — `MIME_CLIP` (add), `MIME_TAKE` (add with take), `MIME_TLITEM` (reorder, payload = array index). `reorderMove` (`Timeline.tsx:690-695`).
- **Trim** — local `dragTrim` state, `secPerPx` captured once at mousedown, single commit on mouseup. In-edge snaps to scrubber frame; out-edge also to music beat ticks (radius 10px).
- **Slice** ('S' key / scissors, `Timeline.tsx:583-598`) — `sliceAt` splits into left/right (right = new UUID), rejects <0.15s, then fire-and-forget `imageRemapDynamic(oldId, rightId)`.
- **Filmstrip** (`filmstrip.ts`) — `extractStrip` samples 20 JPEG frames (q0.6, h90) once per file into LRU `STRIP_CACHE` (cap 50). `clearStrips()` on project switch — but `STRIP_INFLIGHT` is **not** cleared (poisoning risk).
- **TimelineEditor** (`TimelineEditor.tsx`) — name/aspect/export prefs sidebar + Export button (`startExport`).

### 3.7 Players — Monitor (program) & SourceMonitor (`Monitor.tsx`, `SourceMonitor.tsx`, `audioBus.ts`, `playback.tsx`, `waveform.ts`)

**What it does.** Monitor plays the keeper-take sequence in order; SourceMonitor previews one clip's take/recipe with beat-aware scrubbing and in/out trim.

**Key mechanisms:**
- **Per-frame isolation** — `tlSetProgress` is consumed only by `Playhead`/`TimeReadout` (`playback.tsx:7-29`), so Monitor itself doesn't re-render per frame. SourceMonitor writes playhead `style.left`/`textContent` imperatively (`SourceMonitor.tsx:79-88`) — zero React re-render except at beat boundaries.
- **`seekTick`-driven seek** (`Monitor.tsx:145-162`); **`onTimeUpdate` trim+advance** fires `tlNext()` at `outSec - 0.05` (`Monitor.tsx:327-338`).
- **Storyboard hold-clock** — rAF loop for take-less clips (`Monitor.tsx:172-195`); lighter beat-scrub effect when paused (`Monitor.tsx:199-208`).
- **Music-lane rAF sync** (`Monitor.tsx:92-135`) — targets music `currentTime` from segment geometry, hard-corrects only on drift > 0.35s.
- **Single-owner audio bus** (`audioBus.ts:1-29`) — `focusAudio` mutes prev owner, unmutes new; `muteAll` clears; SourceMonitor `subAudio`s for its mute icon; music element never registered (controlled separately).
- **Waveform/onset** (`waveform.ts:29-128`) — `OfflineAudioContext` decode at 22050Hz mono, 50 peaks/sec envelope, energy-flux onset detector (0.22s min gap, 2.2× local avg); LRU `CACHE` (max 20) + `INFLIGHT` dedup.
- **`reportTakeDuration` backfill** on `loadedmetadata` (`Monitor.tsx:323-325`, `SourceMonitor.tsx:403-406`).

### 3.8 Assets — Bin, Library, Folders, Thumbnails, Image Editor (`Bin.tsx`, `Library.tsx`, `Foldered.tsx`, `Thumbnail.tsx`, `ImageEditor.tsx`)

**What it does.** Three panels over the generic `Foldered` tree, plus `media://` thumbnails.

**Key mechanisms:**
- **Bin** (`BinPanel`) — clip tiles (`MIME_CLIP` + `MIME_MOVE`), accepts `MIME_TAKE` drops → `cloneTakeToClip` (`Bin.tsx:97-108`); cross-project import modal via `importPickProject`/`importClips` (`Bin.tsx:121-324`); timeline tiles open `TimelineEditor`.
- **Library** (`LibraryPanel`) — image tiles (`MIME_IMAGE` + `MIME_MOVE`); OS file drop split by extension → `importPaths`/`importAudioPaths` (`Library.tsx:164-195`, uses Electron `File.path`); accepts `MIME_EDITNODE` → `tagEditNode`; double-click → `setEditorImage` + `openImageEditor`; `AudioRow` probes duration on mount (`Library.tsx:25-38`).
- **Foldered** — generic `<T extends {id; folder?}>`, recursive tree from `project.folders` by `kind`; drag-to-folder via `MIME_MOVE`; "open in new tab" via `openFolderPanel`. Collapse state is local (resets on unmount).
- **Thumbnail** — `useThumbUrl` → `mediaUrl(file, rev)`; `rev` busts cache for in-place-overwritten dynamic stills.
- **ImageEditor** (`ImageEditorPanel`, ~532 lines) — always `NANO_BANANA`; `imageGenerate({rootImageId, parentNodeId, prompt, refIds, numImages, seed, aspectRatio})` → `{ok, delta, nodeIds, error}`; persistent `EditSession`/`EditNode` tree via `treeRows` DFS (`ImageEditor.tsx:25-46`); nodes draggable via `MIME_EDITNODE`; tag (`★`) → new Library image; `setPrimaryNode` swaps the file every consuming clip resolves; `@mention` autocomplete; `subtreeHasPrimary` guards branch deletion (`ImageEditor.tsx:113-134`).

### 3.9 Support libs, UI primitives, modals (`lib/*`, `ui/*`, `prompt.tsx`, modals)

**What it does.** Shared utility + chrome layer.

**Key mechanisms:**
- **`mediaUrl`** (`media.ts:5-6`) — `'media://x/' + encodeURIComponent(file) + '?r=<rev>'`; `x` host is a required placeholder.
- **`framePngBytes`** (`frameGrab.ts:5-37`) — canvas `drawImage` (not WebCodecs), optional cover-crop, `toBlob('image/png')`; relies on `crossOrigin='anonymous'` + CORS `*`. No `readyState` check.
- **`beatAtTime`** (`beatUtils.ts:7-12`), **`validateForm`** (`validation.ts:21-44`), **`smpte`** (`time.ts`, `TC_FPS=24` hardcoded).
- **`textPrompt`/`confirmDialog`/`alertDialog`** (`prompt.tsx:81-115`) — ephemeral `createRoot` mounts replacing Electron-disabled `window.prompt/confirm`.
- **`toast()` + `<Toasts>`** (`Toast.tsx:15-36`) — module-singleton `pushFn`, max 3 visible, calls before mount silently dropped.
- **`Modal`** (`Modal.tsx:7-55`) — portal + Esc + backdrop-click. **`PanelErrorBoundary`** (`PanelErrorBoundary.tsx:5-32`) wraps each panel.
- **`dragDrop.ts`** — 8 MIME constants (canonical registry).
- **`WebGpuVideoSpike.tsx`** — **dead code**, not imported; its CSS remains in `styles.css`.

---

## 4. The complete data model

Canonical source: `src/shared/types.ts`. `SCHEMA_VERSION = 5`. All `file` fields are **absolute in memory, relative on disk**.

### `Project`
```ts
{ schemaVersion: number; name: string; dir: string /* runtime-only, never on disk */;
  createdAt: number; images: ProjImage[]; audio: ProjAudio[]; clips: Clip[];
  timelines: Timeline[]; activeTimelineId: string; folders: Folder[]; editSessions: EditSession[] }
```

### `Clip`
```ts
{ id: string; name: string; promptData: PromptData; takes: Take[];
  keeperTakeId?: string; folder?: string | null }
```

### `Take`
```ts
{ id: string; file: string; createdAt: number; seed?: number;
  engine?: EngineId; durationSec?: number; snapshot?: PromptData /* frozen recipe */ }
```
> There is **no separate `Variant` entity**. The "variant/version/fork" concept is realized two ways: video alternatives are **Takes** on a Clip (with a `keeperTakeId`); image alternatives are **EditNodes** in an `EditSession` tree.

### `PromptData`
```ts
{ engine?: EngineId; mode: 'ref2v' | 'i2v'; freeform: string;
  scene: SceneFields; characters: CharacterField[]; beats: BeatField[]; production: ProductionFields;
  imageIds: string[]; endImageId?: string;
  duration: string; resolution: string; aspectRatio: string; generateAudio: boolean; seed?: number;
  promptLink?: { clipId: string; pos: 'before' | 'after' }; fieldLinks?: Record<string, string> }
```
- `SceneFields`: `{ title; referenceHandling; style; visualFeel }`
- `CharacterField`: `{ name; base; features; physics; referenceLabel }`
- `ProductionFields`: `{ audioDesign; lighting; subtext; criticalConstraint; avoid }`

### `BeatField`
```ts
{ name: string; length: number; camera: string; action: string; lighting: string;
  dialogue?: string; vfx?: string; reaction?: string; sfx?: string }
```

### `ProjImage`
```ts
{ id: string; title: string; file: string; folder?: string | null;
  editedFrom?: string; genPrompt?: string;
  dynamic?: { itemId: string; edge: 'first' | 'last'; sig?: string; rev?: number } }
```

### `ProjAudio`
```ts
{ id: string; title: string; file: string; durationSec?: number }
```

### `Folder`
```ts
{ id: string; name: string; parent: string | null; kind: 'bin' | 'lib' }
```

### `Timeline`
```ts
{ id: string; name: string; aspectRatio: string; items: TimelineItem[];
  music?: TimelineMusic; videoMuted?: boolean; musicMuted?: boolean;
  exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30' }
```

### `TimelineItem`
```ts
{ id: string; clipId: string; takeId?: string; useRecipe?: boolean;
  inSec?: number; outSec?: number; muted?: boolean }
```

### `TimelineMusic`
```ts
{ audioId: string; startSec: number; inSec?: number; outSec?: number }
```

### `EditSession` / `EditNode`
```ts
EditSession { id: string; rootImageId: string; nodes: EditNode[];
              primaryNodeId?: string; originalFile?: string }
EditNode    { id: string; parentId: string | null; file: string; prompt: string;
              seed?: number; refIds: string[]; createdAt: number; keptImageId?: string }
```

### `ProjectDelta`
```ts
{ clips?: Clip[]; removedClipIds?: string[]; images?: ProjImage[]; removedImageIds?: string[];
  audio?: ProjAudio[]; removedAudioIds?: string[]; timelines?: Timeline[]; removedTimelineIds?: string[];
  activeTimelineId?: string; folders?: Folder[]; editSessions?: EditSession[] }
```

### `Settings`
```ts
{ falKey?: string; falAdminKey?: string; astriaKey?: string; anthropicKey?: string;
  lastProjectDir?: string; recentProjects?: string[];
  workspaces?: Record<string, unknown>; activeWorkspace?: string;
  showFilmstrips?: boolean; snapPlayhead?: boolean; snapBeats?: boolean; [k: string]: unknown }
```

### `PeekProject` / `PeekClip` (cross-project import DTO)
```ts
PeekProject { dir: string; name: string; clips: PeekClip[] }
PeekClip    { id; name; takes: number; duration: string; beats: number; engine?; thumb? }
```

### Engine registries
- `EngineId = 'seedance2' | 'sora2'`
- `ModelDescriptor` (`shared/models.ts`): `{ id, label, modes, endFrame, maxRefImages, characterRefs, durations, resolutions, aspectRatios, audioToggle, seed, endpoints, pricePerSec, notes? }`; `modelFor(engine)` falls back to `seedance2`.
- `ImageModelDescriptor` (`shared/imageModels.ts`): `NANO_BANANA` = `{ id:'nano-banana', label, editEndpoint, generateEndpoint, maxImages, refWarnAt, aspectRatiosEdit, aspectRatiosGenerate, maxVariants, seed, pricePerImage }`.

---

## 5. The full IPC surface

All channels are `ipcMain.handle` (renderer→main invoke) unless marked **push** (main→renderer `webContents.send`). Exposed to the renderer as `window.vidancer.*` via `preload/index.ts`.

### Settings / account / app
| Channel | Args | Returns |
|---|---|---|
| `settings:get` | — | `Settings` |
| `settings:set` | `Partial<Settings>` | `Settings` |
| `fal:credit` | — | `{ ok, balance?, currency?, error? }` (uses `falAdminKey`) |
| `app:version` | — | `string` |
| `log:open` | — | opens `logDir()` |
| `log:renderer` | `msg: string` | void |

### Project lifecycle / history
| Channel | Args | Returns |
|---|---|---|
| `project:new` | (dialog) | `Project \| null` |
| `project:open` | (dialog) | `Project \| null` |
| `project:openLast` | — | `Project \| null` |
| `project:openPath` | `dir` | `Project \| null` |
| `project:recents` | — | `string[]` |
| `project:get` | — | `Project \| null` |
| `project:undo` / `project:redo` | — | `ProjectDelta \| null` (returns restored project state) |
| `import:pickProject` | (dialog) | `PeekProject \| null` |
| `import:clips` | `dir, clipIds[]` | `{ delta } \| null` |

### Clips / takes
`clip:rename` `(id,name)`, `clip:new` `(name?)`, `clip:setPromptData` `(clipId, Partial<PromptData>)`, `clip:delete` `(id)`, `clip:duplicate` `(id)`, `clip:fromTake` `(clipId,takeId)`, `clip:setKeeper` `(clipId,takeId)`, `take:setDuration` `(clipId,takeId,durationSec)`. All return `ProjectDelta`/`{delta,...}`.

### Images / edit sessions / dynamic stills
`image:generate` `(ImageGenRequest)` → `{ok,delta?,nodeIds?,error?}` (+ **push** `image:progress`), `image:tagNode` `(sessionId,nodeId)`, `image:deleteBranch` `(sessionId,nodeId)`, `image:setPrimary` `(sessionId,nodeId|null)`, `image:addDynamicStill` `(itemId,edge)`, `image:remapDynamic` `(oldItemId,newItemId)`, `image:delete`/`image:duplicate`/`image:rename`. `library:import`/`library:importPaths`/`library:saveFrame(bytes,note)`, `dialog:pickImages`.

### Audio
`audio:import`/`audio:importPaths`, `audio:rename`, `audio:setDuration`, `audio:delete`.

### Timelines
`timeline:set` `(tlId, TimelineItem[])` — **the single write for all item mutations**; `timeline:add`/`rename`/`setAspect`/`duplicate`/`delete`/`setActive`; `timeline:setMusic`, `timeline:setMutes` `({videoMuted?,musicMuted?})`, `timeline:setExportPrefs` `({exportRes?,exportFps?})`.

### Folders / items / layout
`folder:add` `(kind,name,parent)`, `folder:rename`, `folder:delete`, `item:move` `(kind,itemId,folderId)`. `layout:save(json)`/`layout:load` — **declared but never called by the renderer (dead channels)**.

### Render / export (with progress pushes)
| Channel | Args | Returns | Push |
|---|---|---|---|
| `render:run` | `RenderIpcRequest` | `{ok,delta?,clipId?,takeId?,bytes?:Uint8Array,error?}` | `render:progress` (string) |
| `export:run` | `timelineId` | `{ok,file?,error?}` | `export:progress` (string) |

### Shell
`shell:reveal(p)`, `shell:openExternal(url)` (https only).

### Updater (registered in `updater.ts`, **outside** `registerIpc`)
`update:restart` → `autoUpdater.quitAndInstall()`; `update:check` → `checkForUpdates().catch(()=>null)`; **push** `update:status` `{status:'downloading'|'progress'|'ready', info?:{version?,percent?}}`.

### Pushes (main → renderer)
`project:delta` (ProjectDelta), `render:progress`, `export:progress`, `image:progress`, `update:status`.

> **Static preload fields:** `window.vidancer.appName = 'Video Dancer'` and `window.vidancer.version = '0.0.1'` are **hardcoded strings** (`preload/index.ts:4-5,7`) — they do **not** reflect the real version. Use `app:version` for the live value.

---

## 6. The Zustand store (`src/renderer/src/store.ts`)

Single `create<StoreState>`. All project writes go through `applyDelta` (merge) or full replace (`setProject`/`newProject`/`openProject`/`openLast`).

### State shape
| Field | Type | Notes |
|---|---|---|
| `project` | `Project \| null` | full client copy |
| `selectedClipId` | `string \| null` | Bin selection |
| `selectedTlItemId` | `string \| null` | amber-ring; Del removes |
| `editTimelineIndex` | `number \| null` | edited slot; null = bin mode |
| `tlPlaying` | `boolean` | |
| `tlIndex` | `number` | current slot |
| `tlProgress` | `number` | 0..1, written per frame |
| `tlLoop` | `boolean` | |
| `seekOffset` | `number` | seconds |
| `seekTick` | `number` | monotonic bump triggers seek |
| `falCredit` | `{ balance?; currency?; error?; loading }` | |
| `showFilmstrips` / `snapPlayhead` / `snapBeats` | `boolean` | persisted prefs |
| `autoTime` | `boolean` | |
| `editorImageId` | `string \| null` | Image Editor target |
| `previewRecipe` | `boolean` | C-chip flag |
| `renameSignal` | `{from,to,n}` | rename propagation |
| `fileSwap` | `{from,to,n}` | primary-node file swap |
| `undoTick` | `number` | Clip Editor reload signal |
| `exportState` | `{busy,msg,file?}` | |
| `renderBusy` | `boolean` | |

### Actions (grouped)
- **Project/history:** `setProject`, `undo`, `redo`, `applyDelta`, `refresh`, `newProject`, `openProject`, `openLast`, `openPath`.
- **Prefs:** `refreshCredit`, `toggleFilmstrips`/`setShowFilmstrips`, `toggleSnapPlayhead`/`toggleSnapBeats`/`setSnapPrefs`, `toggleAutoTime`.
- **Selection:** `selectClip`, `selectTlItem`, `editTimelineSlot`, `setEditorImage`, `setPreviewRecipe`, `setRenderBusy`.
- **Library/import:** `importToLibrary`, `importPaths`, `saveFrame`, `importAudio`/`importAudioPaths`, `renameAudio`, `reportAudioDuration` (fire-and-forget), `deleteAudio`.
- **Clips:** `renameClip`, `createClip`, `saveClipPromptData`, `deleteClip`, `duplicateClip`, `cloneTakeToClip`, `setKeeper`, `reportTakeDuration` (fire-and-forget).
- **Images/edit:** `deleteImage`, `duplicateImage`, `renameImage` (+`renameSignal`), `tagEditNode`, `deleteEditBranch`, `setPrimaryNode` (+`fileSwap`).
- **Folders:** `addFolder`, `renameFolder`, `deleteFolder`, `moveItem`.
- **Timeline:** `addToTimeline`, `removeFromTimeline`, `setTimelineItems`, `deleteSelectedTlItem`, `addTimeline`/`renameTimeline`/`setTimelineAspect`/`duplicateTimeline`/`deleteTimeline`/`selectTimeline`, `setTimelineMusic`, `setTimelineMutes`, `setTimelineExportPrefs`, `startExport`, `setExportMsg`.
- **Playback (pure local):** `tlPlay`/`tlPause`/`tlSetIndex`/`tlSetProgress`/`toggleLoop`/`tlNext`/`seek`.

---

## 7. Generation & export

### 7.1 Video generation (`src/main/fal.ts`)

Handler `render:run` (`index.ts:467`) reads `s.falKey`, resolves `outDir = <proj.dir>/renders`, calls `runRender`. Credential lifecycle: `fal.config({credentials: opts.falKey})` then cleared in `finally` (`fal.ts:40,44`). Flow (`runRenderInner`, `fal.ts:86`): `modelFor(engine)` → endpoint `model.endpoints[mode]` (throws if unsupported, `fal.ts:89`) → serial `uploadLocal` per image (`fal.ts:93`) → `buildInput` → `fal.subscribe(logs:true, onQueueUpdate→onProgress)` (`fal.ts:100`) → unwrap `{data,requestId}` → extract URL via `out.video.url → out.video_url → out.url → out.output.url` → `fetch` mp4 → write `render_<Date.now()>.mp4`.

**Endpoints & payloads:**

| Engine | Mode | Endpoint | Payload |
|---|---|---|---|
| `seedance2` | `ref2v` | `bytedance/seedance-2.0/reference-to-video` | `{ prompt, resolution, duration (string), aspect_ratio, generate_audio, seed?, image_urls[] }` |
| `seedance2` | `i2v` | `bytedance/seedance-2.0/image-to-video` | `{ ...same, image_url, end_image_url? }` |
| `sora2` | `i2v` | `fal-ai/sora-2/image-to-video` | `{ prompt, image_url, aspect_ratio, resolution, duration (int) }` |

Post-render (`index.ts:482-528`): `importImage` each source → `addTake(snapshot, file)` → return `{ok, delta, clipId, takeId, bytes}` where **`bytes` is the full mp4 read from disk** (see Risks).

### 7.2 Image generation (`src/main/falImage.ts`)

Handler `image:generate` (`index.ts:361`), same credential pattern. `NANO_BANANA` endpoint = `fal-ai/gemini-25-flash-image/edit` (base present) or `fal-ai/gemini-25-flash-image` (text-to-image). Base + up to 5 refs (sliced to `maxImages-1`) placed in `image_urls` (`falImage.ts:64-66`). Result `images[].url` → download as `edit_<uuid>.png` in `<proj>/images/edits`.

- Edit payload: `{ prompt, num_images, output_format:'png', aspect_ratio, seed?, image_urls[] }`
- Generate payload: `{ prompt, num_images, output_format:'png', aspect_ratio (never 'auto'), seed? }`

### 7.3 Export pipeline (`src/main/export.ts`)

Handler `export:run` (`index.ts:315`), guarded by module-level `exporting` boolean. `ffmpeg-static` path patched `app.asar → app.asar.unpacked` (`export.ts:12`). Steps:
1. **Flatten** timeline → `Seg[]`: rendered item → `{kind:'video', file, inSec, dur, muted?}`; storyboard item → per-beat `{kind:'image', file, dur}` (ref via first `@mention` match against `images[].title`) or `{kind:'black', dur}` (`export.ts:128-149`).
2. **Geometry** from `tl.aspectRatio` + `tl.exportRes` (short-side, default 1080). FPS = `tl.exportFps` or first video's native rate (`probeFile` stderr parse, clamp 12–60, fallback 24).
3. **Single ffmpeg** with one `filter_complex`: per-segment input seek (`-ss/-t` for video, `-loop 1 -t` for image), chain `fps→scale(increase)→crop→setsar→format=yuv420p→setpts`, `concat`, optional `amix` for music (`duration=first:normalize=0`).
4. **Output:** `libx264 -preset medium -crf 18` + AAC 192k + faststart. Progress via `-progress pipe:1` `out_time_ms`.

Exported helpers: `extractFrame(video, atSec, outPng)`, `resolveTake(clip, item)`, `probeFile`.

---

## 8. Build / dev / package / auto-update pipeline

**This section feeds the publishing task — every value below must be correct before the first auto-updating release.**

### 8.1 Three-root build (`electron.vite.config.ts:7-28`)
- **main** → CJS, `out/main`, `externalizeDepsPlugin` with `@fal-ai/client` **excluded** (bundled).
- **preload** → CJS, `out/preload`, all deps externalized.
- **renderer** → ESM React, `out/renderer`, alias `@renderer`, input `src/renderer/index.html`.
- `package.json` `"main"` → `./out/main/index.js`.

### 8.2 Scripts (`package.json:33-40`)
| Script | Command |
|---|---|
| `dev` | `electron-vite dev` (HMR) |
| `build` | `electron-vite build` |
| `typecheck` | `tsc --noEmit -p tsconfig.json` (validates all three roots in one pass; DOM+Node types coexist) |
| `dist:win` | `electron-vite build && electron-builder --win --publish never` |
| `dist:mac` | `electron-vite build && electron-builder --mac --publish never` |

No `preview`, no `dist:linux`.

### 8.3 electron-builder config (inline in `package.json`)
```jsonc
appId:       "com.koan.vidancer"
productName: "Video Dancer"
asarUnpack:  ["node_modules/ffmpeg-static/**"]        // native binary reachable at runtime
win:  { icon: "build/icon.png", target: "nsis" }
mac:  { icon: "build/icon.png", target: "dmg",
        category: "public.app-category.video", identity: null }   // explicitly UNSIGNED
publish: [{ provider: "github", owner: "ahamitchell",
            repo: "video-dancer", releaseType: "release" }]
```
The `publish` block is the **single source of truth** for both CI publishing (`--publish always`) and `electron-updater`'s runtime feed URL. No token is embedded (public repo).

### 8.4 CI release (`.github/workflows/release.yml:14-50`)
- Trigger: push tag `v*` **or** `workflow_dispatch`.
- Matrix `fail-fast:false`: `windows-latest` (NSIS) + `macos-latest` (arm64 DMG).
- Steps: `checkout@v4` → `setup-node@v4` (Node 20, npm cache) → `npm ci` → `npm run typecheck` → `npm run build` → `npx electron-builder <flag> --publish always` with `GH_TOKEN: secrets.GITHUB_TOKEN`.
- `permissions: contents: write` lets the built-in token create the Release + upload assets. **No signing secrets.** Both jobs publish to the same Release; the first to finish creates it, the second upserts assets (no draft-then-promote).

### 8.5 Auto-update (`src/main/updater.ts:17-50`, called from `index.ts:131`)
- `initUpdater(win)` guarded by a `started` singleton; **early returns** if `!app.isPackaged` and if `process.platform !== 'win32'` → **macOS/Linux never auto-update**.
- `autoDownload = true`, `autoInstallOnAppQuit = true`.
- Relays to renderer (`update:status`): `update-available`→`'downloading'`, `download-progress`→`'progress'{percent}`, `update-downloaded`→`'ready'{version}`. `checking`/`not-available`/**`error`** are console-only (renderer gets **no** error signal).
- IPC: `update:restart` (`quitAndInstall`), `update:check` (`catch(()=>null)`).
- Initial check after 4s `setTimeout`, repeat every 3h `setInterval`.

### 8.6 Ship procedure & must-be-correct items
**Ship:** bump version → tag `v*` → push → CI builds + publishes.

| Must be correct | Why |
|---|---|
| **`version` ≥ tag + > installed** (`package.json:3` is `0.0.1`) | `electron-updater` compares installed vs Release tag; equal versions never update. First real release must be `v0.0.2`+ or bump before shipping. |
| `publish.owner/repo/releaseType` match the actual public repo | Wrong values → 404 feed → silent no-update (no renderer error). |
| `ffmpeg-static` in `asarUnpack` | Otherwise export `spawn` fails `ENOENT` (no startup check exists). |
| Don't hand testers `--publish never` builds | They lack a matching feed; auto-update fails silently. CI is the only safe path. |
| README "no auto-updates" note | Stale/contradicts the live updater — correct before release. |

**Not covered:** Linux (no target, no CI job — updater early-returns cleanly); x86_64 macOS (arm64-only DMG); macOS signing/notarization (needed before the darwin updater guard can be lifted; no `afterSign`/notarize hook present).

---

## 9. Risks & tech debt (consolidated, high → low)

### High
| Issue | Location |
|---|---|
| **Full mp4 bytes returned over IPC** from `render:run` (50–200 MB structured-clone through V8) — blocks main thread + renderer heap; path is already in the delta and streamable via `media://`. | `index.ts:526` |
| **`media://` path-traversal (CRIT, prior audit)** — handler historically streamed any absolute path with `bypassCSP` + CORS `*`. `insideProject()` now exists (`index.ts:538-544`); **verify the guard is actually wired and the CRIT is closed in current code** (no audit records resolution). | `audit-2026-06-09.md:11` / `index.ts:552-589` |
| **`version` is `0.0.1`** → if first Release is also `v0.0.1`, auto-update never fires. | `package.json:3` |
| **Updater error never reaches renderer** (console-only) → 404/feed-mismatch is invisible to the user. | `updater.ts:42` |
| **`sandbox: false`** → preload runs unsandboxed; a contextBridge/XSS escape reaches Node directly. | `index.ts:123` |
| **`render:run` silently creates a project** in Documents/Untitled if none open; not added to recents, no delta → renderer holds stale `null`. | `index.ts:473` |
| **`update:restart`/`update:check` have no handler unless Windows-packaged** (registered only inside `initUpdater`); invoking on dev/non-Windows → unhandled invocation. | `preload/index.ts:29-34` |
| **All timeline mutations are by-INDEX on a snapshot** with no generation/CAS → concurrent in-flight `timelineSet`s overwrite each other (trim+slice+reorder races). | `Timeline.tsx:804-806`, `store.ts:497-501` |
| **Reorder drag carries array index, not stable id** → stale-index moves the wrong item if a concurrent write reordered. | `Timeline.tsx:1042-1043` |
| **`imageRemapDynamic` after slice is fire-and-forget** outside the `timelineSet` await → dangling dynamic-still binding if the first write fails/superseded. | `Timeline.tsx:825-828` |
| **`STRIP_INFLIGHT` not cleared in `clearStrips()`** → cross-project filmstrip poisoning (old frames cached under new project). | `filmstrip.ts:16-18` |
| **Double `tlNext()` per advance** — `onEnded` + `onTimeUpdate` guard can both fire, skipping two slots; no de-dup flag. | `Monitor.tsx:321,337` |
| **`seekTick` vs `seekOffset` ordering** — storyboard hold-clock may read stale offset if writes aren't atomic. | `Monitor.tsx:172-195` |
| **Music-lane rAF closes over render-time `segsAll`** → timeline edits during playback use stale geometry until a dep changes. | `Monitor.tsx:100-135` |
| **CI publishes two jobs to one Release with no sync** → if mac job fails after win creates the Release, a public release ships missing the mac feed (`latest-mac.yml`). | `release.yml:14-50` |
| **Non-atomic saves / unguarded JSON.parse (prior audit HIGH)** — main `saveProject` is now atomic+serialized and `migrate()` exists; **verify `openProject` has try/catch and settings are atomic** in current code. | `audit-2026-06-09.md:12-13` |
| **API keys plaintext** in `userData/settings.json` (no `safeStorage`); a settings parse error silently resets all keys. | `audit-2026-06-09.md:29-30` |
| **`deleteImage`/`deleteClip`/`duplicateClip` never delete or copy media files** → unbounded disk growth, orphaned `editSession` files; no GC. | `project.ts:537,500` |
| **`importImage()` dedup compares source vs destination path** → never matches → re-copies on every drag. | `project.ts:245` |
| **`MIME_CLIP = 'text/plain'`** collides with any OS text drag onto the timeline. | `dragDrop.ts:3` |
| **`panelBus` openers never cleared** → after an HMR/remount, stale closures silently no-op all panel-open actions; no liveness check. | `panelBus.ts:1-47` |
| **`onImageProgress` re-registers per render / unbounded listeners** if the bridge doesn't return a clean unsubscribe → stale-closure `setStatus` on unmounted panel. | `ImageEditor.tsx:94` |
| **`layoutSave`/`layoutLoad` are dead IPC channels** (declared, never called) — any future use silently returns null/false. | `preload/index.ts:94-95` |
| **README first-steps describe unbuilt/partial features** (trim, slice, reorder, music, export) → testers hit dead ends. | `README.md:41-44` vs `TODO.md` |
| **FFmpeg GPL attribution legally required** once a beta ships the bundled binary; About box content needs review. | `ux-audit-2026-06-12.md:183` |
| **`confirmDialog` hardcoded "Delete" label** used as a plain info alert in ≥2 places. | `ux-audit-2026-06-12.md:110` |

### Medium
| Issue | Location |
|---|---|
| Serial image uploads before every render (no `Promise.all`) → latency for many refs. | `fal.ts:93` |
| No timeout/AbortController on `fal.subscribe` → hangs forever if the queue stalls. | `fal.ts:100`, `falImage.ts:72` |
| Seedance `duration` sent as string incl. `'auto'` → possible 422 (value omitted from error). | `fal.ts:67` |
| `probeFile` regex brittle (`N/A` duration → 0 → 5s fallback, silent). | `export.ts:65-68` |
| `patchSettings` re-reads file each write; external deletion mid-chain → patch applied to `{}` (key loss). | `index.ts:92-105` |
| `logRenderer` writes any renderer string verbatim, no length cap → disk-fill DoS. | `index.ts:252` |
| Single tsconfig (DOM+Node) → weaker typecheck (won't catch Node-in-renderer or DOM-in-main). | `tsconfig.json:15` |
| Hardcoded `window.vidancer.version = '0.0.1'` misleads any UI reading it directly. | `preload/index.ts:7` |
| macOS `identity:null` + darwin updater guard → Mac never auto-updates; no TODO tracking the flip. | `updater.ts:22`, `package.json:28-31` |
| Foldered collapse state local-only → resets on any panel unmount; no persistence. | `Foldered.tsx:63` |
| OS file drop uses Electron `File.path` → breaks in a future web build (silent drop). | `Library.tsx:190` |
| `sora2` `characterRefs:2` "not wired"; `pricePerSec` is a guess → wrong cost + silently-ignored char refs. | `models.ts:52,62` |
| `beatRefFile` matches `@maya` (with `@`) against titles stored without `@` → beat ref thumbnails always blank. | `emitYaml.ts:136-143` |
| `audioBus.current` never cleared on owner unmount → ghost owner. | `audioBus.ts:3-10` |
| `addFolder`/folder mutations serialize the whole folder array over IPC. | `project.ts:847` |
| Workspace persistence is fire-and-forget → in-memory vs on-disk divergence on failure. | `App.tsx:208` |
| `peekProject` loads all first-images as base64 simultaneously → memory spike. | `project.ts:1006` |
| Mac auto-update impossible without $99/yr Apple account. | `distribution-research-2026-06-13.md:19` |
| No app icon/productName surfaced in installer (default Electron icon). | `ux-audit-2026-06-12.md:184` |
| No timeline zoom-to-content; ruler ticks computed from total not viewport (off-screen at high zoom). | `Timeline.tsx:964-965,686-688` |

### Low
| Issue | Location |
|---|---|
| `TC_FPS = 24` hardcoded → wrong SMPTE for 25/30/60 fps source. | `time.ts:2` |
| `framePngBytes` no `readyState` check → may grab a stale frame after a seek. | `frameGrab.ts:29-36` |
| Toast queue capped at 3; overflow (incl. errors) silently dropped. | `Toast.tsx:29` |
| `render_<Date.now()>.mp4` collision within same ms. | `fal.ts:135` |
| `export:run` `exporting` flag not reset in a `finally` (mitigated by internal catch). | `index.ts:329-334` |
| Range regex serves suffix range `bytes=-500` as full file (RFC 7233 violation). | `index.ts:564-566` |
| Log keeps only `main.log`/`main.prev.log`; second rotation destroys earlier session. | `log.ts:52-55` |
| Thumbnail cache-bust omitted when `rev===0` → stale dynamic still until rev≥1. | `media.ts:6` |
| `newEmptyClip`/`addTimeline` reuse deleted counters → duplicate names. | `project.ts:329,395` |
| Two duplicate `MentionArea` implementations (RenderPanel inline vs `MentionInput.tsx`) — bugs must be fixed twice. | `RenderPanel.tsx:446-478`, `MentionInput.tsx:1-64` |
| `WebGpuVideoSpike.tsx` dead component; CSS still bundled. | `WebGpuVideoSpike.tsx:1-202` |
| Beats.tsx uses raw `'application/x-vd-beat'` literal, not `MIME_BEAT` constant → silent break on rename. | `Beats.tsx:184,188,196` |
| No error boundaries gap / no pre-render validation in older audit (now partially addressed by `PanelErrorBoundary` + `validateForm`). | `audit-2026-06-09.md:27-28` |
| fal result URLs expire ~7 days — confirm Takes store local paths, not hosted URLs. | `timeline-export-research-2026-06-11.md:152` |

---

## 10. Open questions / unknowns

**Release & versioning**
- Will the first Release be tagged `v0.0.1` (auto-update will then never fire) or bumped first?
- Universal (arm64+x86_64) macOS build, or arm64-only acceptable for beta?
- When Apple signing lands: notarize (Gatekeeper) or ad-hoc? Has the $99/yr account been purchased? Is the public releases-feed repo actually created?
- Should CI adopt a draft-then-promote strategy to avoid a half-uploaded public release?

**Main / data model**
- Exact full `Settings` shape — any keys beyond those listed?
- Does `setDeltaPush`'s callback guarantee the window exists (else delta silently dropped pre-`createWindow`)?
- Is the silent `render:run` auto-project-creation intentional UX or leftover?
- Is project relocation (move/rename folder) a supported workflow? Undo after a move embeds stale absolute paths.
- Planned GC/purge for orphaned take mp4s and image files? Should `editSessions` be pruned on root-image delete?
- `importImage` dedup: intentional re-copy, or should it content-hash?

**Generation**
- Does Seedance 2 actually accept `'auto'` as a `duration` string, or must it be omitted/sentinel?
- Is `ffmpeg-static` confirmed in `asarUnpack` on Windows (`ffmpeg.exe`)? No startup existence check.
- Why return full mp4 bytes over IPC when the path is already in the delta?
- Is Sora 2 character-identity (`characterRefs:2`) in scope, or is `sora2` a reduced-capability engine? Is the placeholder `pricePerSec` going to be verified?
- Any observed `fal.subscribe` hangs warranting a timeout?

**Renderer**
- Does the renderer consume `update:status`, and does it handle a missing `error` status?
- Are `layoutSave`/`layoutLoad` handled main-side (future per-project layout) or fully dead?
- Is StrictMode permanently off, or to be re-enabled before 1.0 with ref guards?
- Does `saveClipPromptData`'s main handler shallow- or deep-merge `Partial<PromptData>` (risk of dropping nested fields)?
- `beatRefFile` `@`-prefix mismatch — bug, or are titles actually stored with `@`?
- Should `STRIP_INFLIGHT` be cleared/cancelled on project switch? Should slice's `timelineSet`+`imageRemapDynamic` be made atomic in one handler? Should reorder switch to stable ids?
- Does Electron's `media://` handler reliably support `OfflineAudioContext.decodeAudioData` (else waveforms silently empty)?

**Prior-audit verification (no doc records any fixes)**
- Which of the 20 `audit-2026-06-09.md` issues are actually fixed in current code? Several (atomic saves, schema versioning, model registry, types unification, `STRIP_CACHE` LRU, fal credential hygiene, per-entity deltas, panel split) appear addressed by the present code structure but must be confirmed by a code scan before publishing.
- Have any P0 UX items (Space=play, fal-key first-run banner, About box + FFmpeg attribution, app icon) landed?