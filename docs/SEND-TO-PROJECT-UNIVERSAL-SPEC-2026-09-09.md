# SEND TO PROJECT, universal + mass select — spec 2026-09-09 (for his read; no code before GO)

## 0. His brief (his words)

"i need to add ability to mass select items in the BIN and send them to other projects, so mass
select image gen and send to DEV for example" · "send to project should be universal for all
items in bins and libraries"

## 1. What exists (read 2026-09-09)

**Multi-select** lives in ONE place, `panels/Foldered.tsx` (the folder grid every Bin card and the
Library images use): ctrl/⌘-click toggles, shift-click ranges from the anchor, plain click = just
that one; the selection is `store.multiSel { kind, ids, anchor }`, kinds `bin · lib · sheet · score
· voice · style · imagegen`. Dragging a selected tile carries the whole selection.

**Send to project** = `lib/sendToProject.tsx` `sendToProjectEntry(sel, count)` — the `send N to
project ▸` entry with a submenu of recent projects (minus the open one) + `browse…`; main
`sendAssetsTo(destDir, sel)` copies through `makeAssetCopier` (dedup'd files, @title collisions
renamed and rewritten, dead files reported in the toast, atomic write behind `project.json.sendbak`);
copies land in a folder named after the SOURCE project (clips · images · sheets), music / videos /
timelines flat with a collision suffix. No cross-project undo; the toast is the receipt.

| kind | multi-select today | send entry today | copier today |
|---|---|---|---|
| clips (Bin) | yes | yes, bulk | yes (takes, refs, snapshots, sidecars) |
| char sheets (Bin) | yes | yes, bulk | yes |
| timelines (Bin) | **no** (own tiles, not Foldered) | single only | yes (items, audio, music) |
| **image gens (Bin)** | yes | **none** | **none** |
| **scores (Bin)** | yes | **none** | **none** |
| **voices (Bin)** | yes | **none** | **none** |
| **styles (Bin)** | yes | **none** | **none** |
| images (Library) | yes | yes, bulk | yes |
| music (Library) | **no** (plain rows) | single only | yes |
| videos (Library) | **no** (plain tiles) | single only | yes |

So "send 12 image gens to DEV" fails twice today: no entry on the tile, and the copier has never
heard of an image gen.

## 2. From his seat

1. In any Bin card or Library card, ctrl-click tiles (shift-click a run). Right-click one of them
   → **`send 12 to project ▸`** → `DEV` (or any recent project, or `browse…`). The toast is the
   receipt: `sent to DEV ✓ — 12 image gens · 3 images` (refs ride along), skips listed on click.
2. The same gesture on timelines, music rows and video tiles — the three that had no multi-select
   grow the same ctrl/shift-click, the same `send N to project`.
3. A single right-click with nothing selected sends just that one, as today.
4. In DEV the copies sit in a folder named after this project inside the matching card (image gens
   card → folder "<source>"; scores, voices, styles the same). Music, videos, timelines stay flat
   as today. Nothing here changes in the source project.

## 3. The copier learns four kinds (`src/main/project.ts` `makeAssetCopier`)

- **image gens**: `mintImageGens(ids)` pre-mints job ids; `copyImageGen(g)` = the job (name,
  recipe, keeper) with every take's PNG copied to `<dest>/images/gen/<newJobId>/<newTakeId>.png`
  (the panel's own layout), take ids re-minted, `keptImageId` dropped (a Library link in the
  source), recipe + snapshots: `refA` / `refB` through `ensureImage` (dedup'd, dead = dropped and
  reported), `loras[]` and `model` ride verbatim (file names — the destination's own folders may
  or may not hold them; the panel already greys a missing pick with the reason). Folder: the
  source project's name, kind `imagegen`.
- **scores**: `copyScore(sc)` = beats + recipe verbatim (`ScoreRecipe` = engine + options only — read
  2026-09-09, nothing points at the source project), takes' audio to `<dest>/scores/`, ids re-minted,
  keeper kept. Folder kind `score`.
- **voices**: `copyVoice(vc)` = recipe with its two Library links carried the dedup'd way —
  `imageId` through `ensureImage`, `refAudioId` (the clone sample) through `ensureAudio`; dead = dropped
  and reported, the design text stays; takes' audio to `<dest>/voices/`. Folder kind `voice`.
- **styles**: `copyStyle(st)` = scene + production fields with `rewrite()` on the text lanes
  (renamed @titles), `enhanced` verbatim. Folder kind `style`.
- `commit()` pushes the four new lists; `SendSelection` gains `imageGenIds · scoreIds · voiceIds ·
  styleIds`; `SendResult.sent` gains their counts; `sendAssetsTo` folders them per kind like clips.
- Skips stay honest: a take whose file is gone is skipped and named in the toast, the job still
  arrives.

## 4. Renderer

- **`lib/multiSelect.ts`** (new, ~20 lines): the click gesture lifted out of Foldered —
  `multiClick(e, kind, id, flatIds)`; Foldered calls it (one gesture, law 11), and so do the
  timeline tiles, the music rows and the video tiles. `store.multiSel.kind` gains `tl · audio ·
  video`; the selection is drawn on those tiles the way Foldered draws it (the amber ring).
- **`sendToProjectEntry`** on the four Bin menus that lack it (image gen · score · voice · style),
  honouring the multi-selection exactly as the sheet menu does (`selIds`), placed where the sheet
  menu places it (after duplicate, before delete). Timeline / music / video menus keep their
  entry and grow the count the same way.
- **`doSend`** receipt words: `image gen(s) · score(s) · voice(s) · style(s)`.
- Escape clears the selection (Foldered's rule, unchanged).

## 5. Files

- main: `src/main/project.ts` (copier + `sendAssetsTo`), koan-shared `shared/types.ts`
  (`SendSelection`, `SendResult`, `multiSel` kinds in `store.ts`)
- koan-shared: `lib/multiSelect.ts` (new), `panels/Foldered.tsx` (uses it), `panels/Bin.tsx`
  (four menus + timeline tiles), `panels/Library.tsx` (music rows, video tiles),
  `lib/sendToProject.tsx` (receipt)
- docs at the next PUSH IT: manual §14 "send to project" line lists every kind; What's New.

## 6. OPEN — his calls

1. Copies of the four new kinds land in a folder named after the source project (today's rule
   for clips / images / sheets). Fine?
2. Timelines, music and videos gain ctrl/shift-click multi-select (they never had it). Fine?
3. `send N to project` when the selection mixes kinds: the Bin's cards are one kind each, so a
   right-click sends the card's selection only. Cross-card sends = one card at a time. Fine?

## 7. Proof (untested until his session)

- Ctrl-click 3 image gens → right-click → `send 3 to project ▸ DEV` → DEV opens with an "image gens
  · <source>" folder holding 3 jobs, every take present, ★ kept, refs in the Library folder.
- A score with 2 takes, a voice with an image + a clone sample, a style with @titles → all arrive,
  the toast names each count; the voice's image and sample sit in the Library folder.
- Shift-click 4 music rows → `send 4 to project`; a video tile the same.
- A take file deleted on disk → the job arrives without it, the toast lists the skip.
