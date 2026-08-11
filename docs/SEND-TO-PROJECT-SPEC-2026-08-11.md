# SEND TO PROJECT — spec · 2026-08-11

Push assets from the OPEN project into another project on disk: clips, images, music, char
sheets, timelines. Everything lands in the destination's respective section, inside a folder
named after the source project. Sending a timeline drags every asset it uses along. The
reverse of "Import from project…" — same copy engine, pointed the other way.

Laws: files are COPIED (projects stay self-contained) · ids re-minted · colliding @titles get
the import engine's `_N` suffix + text-ref rewrite · source project untouched (sending is
risk-free by construction).

## S1 — char sheets get folders (prerequisite, user call)

- `Folder.kind` widens: `'bin' | 'lib' | 'sheet'` (shared/types.ts:82).
- `CharSheet` gains `folder?: string | null`. Both additive — NO migration.
- Bin's CHAR SHEETS section renders through the existing `Foldered` component with
  `kind="sheet"` (same folder tree, right-click folder create/rename/delete, drag-to-folder,
  multi-select). Store folder/moveItem/multiSel functions take the widened kind. Foldered's
  stretch-grid `tileMin` maps sheet → the bin zoom slider (`s.tileZoom[kind === 'lib' ? 'lib'
  : 'bin']` — no third slider).
- MIME_MOVE payloads already carry `kind` as a string — rides through.

## S2 — the send engine (main)

New `send:assets` IPC → `sendAssetsTo(destDir, sel)` in project.ts, where
`sel = { clipIds: string[]; imageIds: string[]; audioIds: string[]; sheetIds: string[]; timelineIds: string[] }`.

1. **Load** destination via `readProjectData(destDir)` (migrates in memory, exactly like
   opening it would). Refuse `destDir === current.dir` ("that's this project").
2. **Closure** (what actually gets copied):
   - timelines → their items' clipIds + their `music.audioId`
   - clips → takes (files) + recipe/snapshot imageIds + endImageId + sourceVideo pin (file
     copy, ids blanked — the import engine's `remapSourceVideo` rule) + `videoRefs[].videoId`
     Library videos + `audioRefs[].audioId` tracks
   - char sheets → their `imageId`
   - all id-deduped: an image referenced five ways copies once.
3. **Copy core**: `importClipsFromInner` (project.ts:2357) is generalized to
   `copyAssetsBetween(src, dest)` — src = current, dest = the loaded foreign Project object +
   its dir for file destinations (renders/, images/, audio/, videos/). Same ensureImage /
   rewrite / collision rules, now writing into `dest` arrays. The import path calls the same
   core with the roles swapped (one engine, two directions — no drift).
4. **Foldering**: find-or-create in dest a folder named after the SOURCE project per kind —
   `{ kind: 'bin' }` for clips, `{ kind: 'lib' }` for images, `{ kind: 'sheet' }` for sheets
   (parent null; reused on repeat sends). Copied assets get `folder: thatId`.
   - Music + Library videos have NO folder system (flat sections) → they land plain; row
     collision on title gets ` (from <Source>)`. Optional later phase S4 = Foldered audio/video
     sections if wanted.
   - Timelines are a flat row too → plain, collision-suffixed.
5. **Timeline remap**: copied timeline re-mints its id + every item id; `item.clipId` /
   `item.takeId` remap through the clip-copy maps; music.audioId remaps; fx stacks ride
   verbatim (self-contained); loop fields ride verbatim.
6. **Write** destination atomically: serialize → `project.json.tmp` → rename over, after
   copying `project.json` → `project.json.sendbak` once per send (crash mid-send leaves the
   backup). Schema stamps CURRENT version (same upgrade opening it would perform).
7. Return `{ ok, sent: { clips, images, audio, sheets, timelines, videos } }` counts for the
   toast. Missing files (dead take, gone image) are SKIPPED and counted in a `skipped` list —
   surfaced honestly, never silent.

## S3 — UX (renderer)

- Right-click entries: Bin clip menu + bulkMenu · Library image menu + bulkMenu · audio row
  menu · char sheet menu · timeline card menu → **"send to project ▸"**.
- Submenu: `settings.recentProjects` (minus the open project; name = folder basename) +
  **browse…** (existing pickFolder → validated via peekProject).
- Sends the CURRENT selection when the clicked item is part of a multi-selection (bulk rule,
  same as delete).
- Toast: `sent to <name> ✓ — 3 clips · 5 images · 1 sheet (2 skipped: files missing)`.
- No cross-project undo: the destination isn't open, its history can't hold the change. The
  toast is the receipt; a repeat send just adds copies (ids re-mint — the import model).

## Edge cases (decided)

1. Destination open in another window: impossible locally (single-instance lock).
2. Destination on OneDrive mid-sync: the atomic tmp→rename either lands or fails loudly —
   same exposure as every save; sendbak covers the half-state.
3. Send a timeline whose clip is ALSO selected: dedup, one copy, both reference it.
4. Storyboard-only clips (no takes): recipe + refs copy fine (nothing to skip).
5. Sheet with a dead imageId: sheet sends, image skipped + reported.
6. Repeat sends: a second send re-copies (new ids, `_N` titles) — matches import semantics;
   the source-named folder is REUSED, not duplicated.
7. Destination lacking dirs (images/, audio/…): mkdir recursive before copies.

## Build order (GO per phase)

| # | scope | files | gate |
|---|---|---|---|
| D1 | sheet folders: Folder.kind + CharSheet.folder + Foldered kind='sheet' + store widen | shared/types.ts · store.ts · Bin.tsx · Foldered.tsx | **app closed** (shared) |
| D2 | copy-core generalization + sendAssetsTo + send:assets IPC + preload sig | main/project.ts · main/index.ts · preload | **app closed** |
| D3 | menus + recents submenu + toasts | Bin.tsx · Library.tsx · env.d.ts | renderer |
| D4 | test sheet | — | user's eyes |

## D4 test sheet

1. Sheet folders: create/rename/delete a sheet folder, drag sheets in, restart → persists.
2. Send 2 clips → destination opens with "‹Source›" bin folder holding both, takes play,
   snapshots intact, @titles rewritten on collision.
3. Send an image + the same image via a clip in one selection → ONE copy in the lib folder.
4. Send a timeline → timeline appears, plays end-to-end: clips foldered, music present,
   take swaps still work, fx render.
5. Send a sheet → sheet in its source folder + its image in the lib folder.
6. Send music → track in audio section, plays.
7. Repeat the same send → second copies with `_N` titles, same folders reused.
8. Kill the app mid-send → destination either untouched or complete (sendbak present).
9. Import-from-project still works identically (shared core regression).
