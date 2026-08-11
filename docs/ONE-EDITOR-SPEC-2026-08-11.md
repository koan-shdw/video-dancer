# ONE EDITOR — merge spec · 2026-08-11

User call: both edit surfaces are the same machine, one has the non-destructive tree. So keep
the tree, kill the card. Keeping a result = drag it out of the tree. One editor, no fast lane.

Supersedes the panel half of EDIT-CARD-SPEC-2026-08-11.md (its B1–B4 are BUILT; the shared
widgets, runV2vEngine, and recipe plumbing all survive — the ClipEdit panel itself dies here).

## The grammar

- Video Editor = THE editor. Roots on a Library video or any take. Every generation = a tree
  node. Nothing lands anywhere until the user takes it out.
- **Drag a node out** (new, replaces bake-menu as the primary gesture; menu stays):
  - onto empty Bin space → new clip, node = take 1
  - onto a clip card in the Bin → new take on that clip
  - onto the timeline → new clip + block placed at the drop point (same seam as the existing
    Library-video drop, Timeline.tsx:1680/2323)
- **⑂ anywhere opens the tree** rooted on that take, timeline trims prefilled as the window.
- **↻ regenerate** = node context-menu entry: re-run THIS node's frozen recipe as a sibling.
- Clip Edit panel deleted. Existing edit clips are ordinary clips (takes, keeper, snapshots —
  untouched).

## C1 — nodes carry the full recipe (shared + main, APP CLOSED)

1. `VideoEditNode` (shared/types.ts) gains optional recipe fields:
   `imageRefIds?: string[]`, `videoRefs?: VideoRef[]`, `audioRefs?: AudioRef[]`,
   `duration?: string`, `resolution?: string`, `aspectRatio?: string`, `generateAudio?: boolean`.
   Additive optionals in project.json — NO migration.
2. `vedit:run` (main/index.ts) passes the req's re-gen block into `appendVideoEditNode`;
   project.ts writes it on the node. Omni nodes store none (prompt+window is the whole recipe).
3. `bakeVideoNodeToClip` (project.ts:2113) extends its promptData with the node's recipe block
   (imageIds/videoRefs/audioRefs/duration→req'd value/resolution/aspectRatio/generateAudio when
   present) — baked takes get COMPLETE snapshots, same promise as the card gave.
4. **Delete the card's IPC lane**: `edit:createClip` + `edit:run` handlers (main/index.ts),
   preload `editRun`/`editCreateClip`, env.d.ts signatures, `EditArgs`/`EditResult` in
   shared/types.ts. Queue kind 'edit': loader drops stale persisted 'edit' jobs with one toast
   ("an old Clip Edit job was discarded — re-run it in the Video Editor"); kind union sheds
   'edit'. runV2vEngine stays (vedit:run's engine).

## C2 — drag-out (renderer)

1. `MIME_VEDIT_NODE` in lib/dragDrop.ts — payload `{ sessionId, nodeId }` JSON.
2. Tree rows (VideoEditor.tsx) become `draggable`; dragstart sets the MIME + a drag image from
   the node thumb.
3. Drop targets:
   - Bin.tsx panel background → `veditBakeClip(sessionId, nodeId, {})`, select the new clip,
     toast. Clip cards → `veditBakeClip(..., { clipId })`, toast "new take".
   - Timeline.tsx: the existing MIME_VIDEO drop seam (1680) grows a MIME_VEDIT_NODE branch —
     bake to new clip, then place the block exactly like the video-drop path places its
     auto-clip (same track/time math). Dragover gate (2323) adds the MIME.
   - Dashed-amber outline on valid hover, Clip Gen slot grammar.
4. Double-bake is legal (two drops = two takes) — user action, no guard.

## C3 — ⑂ repoint + card death (renderer)

1. `editorVideoRoot` (store.ts:169) gains `inSec?/outSec?`; VideoEditor's srcKey effect
   prefills the window from them (falls back to today's 0..cap).
2. Every ⑂/edit entry repoints to `setEditorVideo` + front the Video Editor panel:
   RenderPanel.tsx takes row ⑂, Timeline.tsx block ⑂ (passes the block's trims), Bin.tsx
   context entries, existing "edit in Video Editor (tree)" stays as-is. panelBus:
   `openClipEdit` → `openVideoEditor`.
3. Delete panels/ClipEdit.tsx; remove the 'clipedit' dockview registration (App.tsx); saved
   workspace layouts strip unknown panel ids on restore (guard in the layout loader — a dead
   id must not blank the dock).
4. `editTarget`/`setEditTarget` leave store.ts.
5. Tree composer ports the card's two leftovers: ResizeHandle on the preview (store previewH
   key 'videoEditor'), and ↻ regenerate in the node context menu (builds a VeditArgs from the
   node's stored recipe, parent = the node's parent → sibling; greyed with reason on
   recipe-less pre-C1 nodes).

## C4 — shakedown sheet

1. Omni + Seedance node renders still land in the tree (regression).
2. Drag node → empty Bin = new clip · → clip card = take · → timeline = clip + block at drop
   point; baked take snapshot holds engine/prompt/window/refs/options (inspect project.json).
3. ⑂ on a Clip Gen take and on a timeline block (trimmed) → tree opens, right root, window
   prefilled with the trims.
4. ↻ on a node reproduces it as a sibling; greyed on old nodes.
5. Old edit clips: open, play takes, keeper swap — untouched.
6. Restart with a saved workspace that contained Clip Edit → dock restores, no blank.
7. Persisted old 'edit' queue job → dropped with the toast, queue alive.
8. Engine switch in the tree keeps refs/options (store-everything — already shipped, re-check).

## Order

C1 app closed → C2 → C3 → C4 with the user's eyes. GO per phase. The B5 sheet from
EDIT-CARD-SPEC is superseded by C4 (its still-valid rows folded in above).
