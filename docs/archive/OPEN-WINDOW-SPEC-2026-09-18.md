# Open window: no cap, 4x4, scroll, drag taller, folders — 2026-09-18

Status: BUILT 2026-09-18 on his GO. Typecheck clean (one pass covers vi-dancer + the shared
renderer). NOT run in the app. His walk-through (§8) is the gate. Uncommitted.

His brief, his words:
1. "right now it only supports 8 proejcts any more and they disapear" = the bug.
2. "lets first allow more then 8"
3. "lets make the window scroll"
4. "the window is dragable down to make it wider like the windwo the files are in not the
   pprojects window itself" = the card area drags taller. The window does not move.
5. "lets enable folders so we can put them in folders"
6. "lets also make it 16 4x4 while were at it"

## 0 How it works today (read 2026-09-18)

- The Open window has no list of its own. It shows `settings.recentProjects`.
- Every open / new / duplicate puts the project on top, then cuts the list to 8:
  `src/main/index.ts:911` (`noteRecent`) and `:1047` (`project:duplicateAt`). Both `.slice(0, 8)`.
- Project 9 falls off the list. Its folder on disk is untouched. The only way back is Browse.
- The window: `koan-shared/vidancer-ui/src/App.tsx:1117-1223`. Box `min(780px, 90vw)`, max 82vh,
  centered. Cards 168 wide, flex-wrap, gap 10. It already scrolls (`overflowY: auto`), but 8 cards
  never fill it.
- Cards come from `project:peekRecents` → `peekRecentCards` (`src/main/project.ts:2945`): reads each
  project.json one after another + the first Library image as a full-size base64 thumb (up to 4 MB).
- Header `▾` beside Open = a second list of the same recents, by folder name (`App.tsx:754-789`).
- His settings today: exactly 8 recents. Anything dropped before is not in the list.

## 1 No cap

- Remove both `.slice(0, 8)`. The list keeps every project he has opened, newest first.
- A project leaves the list only by: right-click "remove from this list", or "delete project".
- Type comment on `recentProjects` in `shared/types.ts:1022` loses the word "capped".
- Projects that fell off before this fix: Browse to each once. After that they stay.

## 2 Layout: 4x4, scroll, drag taller

- Card area = a fixed 4-column grid (`repeat(4, 1fr)`, gap 10). Cards stretch to the column.
  Window width unchanged.
- Opens 4 rows tall: 16 cards showing. More than 16 = the card area scrolls (house `.vd-scroll`).
- Under the card area: the house `ResizeHandle` (`ui/ResizeHandle.tsx`, the same strip every
  monitor uses). Drag down = card area taller. Title: `drag to resize the project list`.
- Height saved in settings as `openPickerH` (px), same debounce rhythm as `previewH`.
  Min = 1 row. Max = what the screen allows (window stays inside 92vh).
- The window pins its TOP edge (no longer vertically centered). Reason: a centered box grows
  up and down at once, so the handle slides away from the cursor. Pinned top = it grows down only.
- Playground shelf stays below the handle, unchanged.
- Header line reads `open a project` + dim `recent first`. No other copy changes.

## 3 Folders, the Bin's grammar

Sibling copied: `panels/Foldered.tsx` (Bin / Library / sheets / scores / voices / styles / image gens).
Same look, same gestures, nouns changed:

- Folder row: `▾/▸` + drawn Folder icon + name + `(count)`. Click = fold / unfold.
- Right-click empty space = `new folder`.
- Right-click a folder = `rename folder` · `new subfolder` · `delete folder` (contents move to the
  parent, projects are never deleted).
- Drag a card onto a folder row = move it in. Drag onto empty space = back to root. Amber hover
  mark on the target, same as the Bin.
- Right-click a card: today's menu (open · rename · duplicate · reveal · remove · delete) + the
  Bin's move block: `move to root` + one row per folder.
- ctrl-click / shift-click = multi-select. Right-click inside a selection = `new folder with N`
  + `move N to …`. Same as the Bin.
- Folders first, root cards under them. Inside every folder and at root: newest first.
- Folders live in the WINDOW only. Nothing on disk moves. No project.json is touched.

Storage (settings.json, next to `recentProjects`):
- `projectFolders?: Folder[]` with `kind: 'project'` (Folder.kind union grows `'project'`).
- `projectFolderOf?: Record<string, string>` = project dir → folder id. Absent = root.
- `projectFoldersCollapsed?: string[]` = folded folder ids (the Bin forgets this on close; the
  Open window is opened fresh every time, so it must remember).
- Renderer writes through the existing `vd().setSettings(...)`. No new IPC.
- Main keeps it clean: `project:removeRecent` and `project:deleteAt` also drop the dir from
  `projectFolderOf`. `project:duplicateAt` puts the copy in the same folder as its source.

How Foldered is reused (the one shared-widget edit):
- Foldered today reads folders from the OPEN PROJECT (`project.folders` + store actions). The
  Open window is app-level, so Foldered grows two optional props:
  - `source?: { folders, add, rename, remove, move, moveMany }` = where folders live. Absent =
    today's project store. Bin / Library behavior byte-for-byte unchanged.
  - `columns?: number` = fixed column count (the Open window passes 4). Absent = today's zoom grid.
- AS BUILT: `source` also carries the selection + fold state (`sel / setSel / collapsed /
  setCollapsed`). The store's `multiSel` is welded to the open project (its pools drop unknown
  ids on every project patch), so the window's selection stays in the window. `MultiKind` is
  untouched; only Foldered's own `kind` prop grew `'project'`. Same three click rules.
- With a source, a multi-selection's right-click = the move block alone (no send / duplicate /
  delete-N lane exists for projects).
- Tile-on-tile reorder stays off for `'project'` (list order = newest first). A card dropped on
  another card joins THAT card's folder.
- HIS CATCH 2026-09-18 ("where is the add to folder function on right click?"): a card's
  right-click always carries `new folder…` (one card) / `new folder with N` (many): makes the
  folder and puts the card(s) in it. `move to root` hides when the card is already at root.
  Open window only. The Bin has the same hole (single item = no new-folder entry), untouched
  until he says.

## 4 Load time with no cap

Today each card = one full project.json parse + one full-size image read, one after another.
Fine at 8. At 40+ the "reading recent projects…" line would sit for seconds.
- Reads run in parallel (pool of 6).
- Thumbs: `nativeImage.createFromPath(file).resize({ width: 336 })` → JPEG data URL (png / jpg).
  webp / gif keep today's raw read (nativeImage cannot decode them).
- MEASURED 2026-09-18 on his 8 projects (scratch script, the repo's electron, warm disk):
  OLD 20-31 ms + 10.5 MB of thumbs sent to the window · NEW ~100 ms + 234 KB. The shrink costs
  ~12 ms a card (nativeImage is synchronous) and cuts the payload 45x. Both instant at 8. The
  payload is what grows with the list: 50 projects = ~65 MB the old way, ~1.5 MB the new way.
  UNPROVEN at that size. The handler logs `[projects] Open window: N cards in X ms` every open.

## 5 Header ▾ list

Same `recentProjects` list. With no cap it would grow without end.
- `project:recents` returns the first 8 that still exist. The ▾ stays a quick list.
- The Open window is the full list.

## 6 Files touched

- vi-dancer `src/main/index.ts`: two slices out; `project:recents` first 8; removeRecent /
  deleteAt / duplicateAt folder upkeep.
- vi-dancer `src/main/project.ts`: `peekRecentCards` parallel + small thumbs.
- koan-shared `vidancer-ui/src/shared/types.ts`: Folder.kind + four settings keys.
- koan-shared `vidancer-ui/src/panels/Foldered.tsx`: `source` + `columns` props, `'project'` kind.
- koan-shared `vidancer-ui/src/store.ts`: `MultiKind` grows `'project'`.
- koan-shared `vidancer-ui/src/App.tsx`: the window body → Foldered + ResizeHandle + top pin.
- Main-side edits restart the dev app. Build only while he is not rendering.

## 7 His calls (answered 2026-09-18)

1. CLICK = **double**. Click selects, double-click opens, same as the Bin. ctrl / shift-click =
   multi-select. Card tooltip: `double-click = open · right-click = rename / duplicate / delete…`.
2. FOLDERED = **reuse**. The Bin's widget with the two new props (§3).
3. ▾ LIST = **keep the 8** (§5).
4. LOST PROJECTS = "all previosu projects brought back" (§7.1).

### 7.1 Bring back

One scan, two doors:
- `findProjectsIn(base)`: every direct subfolder of `base` (and `base` itself) holding a readable
  `project.json` (with `clips` + `images` arrays) is a project. Light check: no migrate, no
  `.bak` side effect.
- DRY RUN 2026-09-18 on his disk (read-only script, same rules): 4 come back — BODE - LINEUP,
  MONK, _MIGRATION_TEST (named SNAKE QUEEN), bode. Two levels deep finds the same 4.
- DOOR 1, automatic, once: first boot after the update (settings flag `projectsRecovered`), scan
  the parent folder of every known project (`recentProjects`, `lastProjectDir`, the keys of
  `lastExportDirs`) + Documents (where New starts). Found projects join the END of the list,
  newest `project.json` first. Known ones keep their place. Runs after the window shows, never
  blocks boot.
- DOOR 2, his hand: header button `find projects…` left of `Browse…` → pick a folder → same scan,
  two levels deep → toast `N projects added` / `no new projects in that folder`. IPC
  `project:findIn`.

## 8 Walk-through (goes in the build report, his test = the gate)

1. Open → 4 across, 4 rows. Open a 9th project, reopen the window → all 9 there.
2. Drag the strip under the cards down → taller. Close, reopen → same height.
3. Right-click empty space → new folder. Drag a card onto it. Fold it. Close, reopen → still
   folded, card still inside.
4. ctrl-click three cards → right-click → new folder with 3.
5. Delete the folder → its projects drop to root. Nothing deleted on disk.
6. ▾ beside Open → 8 newest only.
