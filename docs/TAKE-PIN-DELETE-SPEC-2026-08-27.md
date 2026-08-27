# Dynamic-Take Indicator + Take Delete Spec - 2026-08-27

STATUS: agreed in chat 2026-08-27, built same day (typecheck clean; gate open = in-app test).

Two changes: (1) timeline blocks that follow the keeper get a subtle ring, (2) takes can be
deleted from Clip Gen, with a warning, distinct from disable.

## Facts (code-proven, nothing to change here)

- A timeline block resolves its take as `item.takeId ?? clip.keeperTakeId`
  (timelineUtils.resolveTake; export.ts has the twin).
- Dragging a CLIP (Bin) lands a block with NO takeId - it follows the keeper, and clicking
  a take in Clip Gen sets the keeper (RenderPanel takes row), so those blocks update. DYNAMIC.
- Dragging a TAKE (Clip Gen tile, or the preview window with in/out) lands a block WITH
  takeId - keeper clicks never touch it. PINNED. Already the wanted behavior.
- The block's own take picker (take label ▾) pins a block after the fact (sets takeId);
  picking S-B sets useRecipe.

## 1. Dynamic indicator (timeline)

- A block is DYNAMIC when: video item, no `takeId`, not `useRecipe`, clip has at least one take.
- Visual: `outline: 2px dotted var(--amber); outline-offset: -2px` - new class
  `vd-clip-dyn` on `.vd-clip`; TlBlock gets a `dynamic` prop. (First pass was 1px amber-dim -
  user: not strong enough.)
- Block NAME (user round 2): pinned blocks read `KATA - take 3` (clip name + their take);
  dynamic and S-B blocks read just `KATA`. The take label row underneath is unchanged.
- State precedence untouched: selection ring, playhead border, drop edge, marquee all sit on
  other channels; a clip with no take video keeps its dashed storyboard outline (inline style
  wins over the class).
- Pinning a dynamic block via its take picker sets takeId - the ring goes away. Correct.
- The take label tooltip on a dynamic block says: "follows the ★ keeper - click a take in
  Clip Gen to change this shot".
- OPTION (strike if unwanted): dynamic blocks' take label reads `★ take n/N` (house keeper glyph).

## 2. Delete take (Clip Gen)

UI - right-click a take tile, new entry in the existing menu, grouped with disable:

    color row
    ⃠ disable Tn (dud)
    🗑 delete Tn…          ← new, danger red
    ---
    ⑂ edit Tn v2v
    ---
    export Tn video…

- ALWAYS warns (user order), house confirmDialog `{ confirmLabel: 'Delete', danger: true }`:
  "Delete take N? X pinned timeline shot(s) using it get removed; dynamic shots move to the
  keeper. The video file stays on disk. (undoable - Ctrl+Z)"
  Counts computed live across all timelines. When it is the clip's LAST take:
  "Delete take N - the clip's only take? Every timeline shot of this clip gets removed.
  The video file stays on disk. (undoable - Ctrl+Z)"

Main - new `deleteTake(clipId, takeId)` in project.ts, copying the deleteVoiceTake +
deleteClips sweep shape:

- Remove the take from clip.takes. Media file STAYS on disk (delete convention). Undo is the
  snapshot history - free.
- Keeper hop: if the deleted take was the keeper, keeper becomes the last remaining
  non-disabled take (falls back to last take if all are duds) - same dud-skip the auto-keeper
  already uses. Dynamic blocks follow it.
- Timeline sweep, every timeline:
  - video items pinned to the deleted take (`takeId ===`) are REMOVED,
  - if the clip now has ZERO takes, its dynamic items (no takeId, not useRecipe) are REMOVED too,
  - useRecipe storyboard slots always stay,
  - detached-audio blocks whose source is {clipId, takeId} of the deleted take are REMOVED,
  - rev bump + syncLinkedAudio per touched timeline, one save = one undo step.
- Delta: the clip + touched timelines.

Wiring, the exact sibling shape (`take:setMeta` family / `voice:takeDelete`):
- main/index.ts: `ipcMain.handle('take:delete', …)`
- preload: `takeDelete(clipId, takeId)`
- store: `deleteTake(clipId, takeId)` → applyDelta

Surviving references resolve to nothing (delete convention, same as voices): Video Editor
roots/sessions pointing at the deleted take. Slot-edit mode: a slot pinned to the deleted
take is simply one of the removed items.

Not touched: disable semantics, Score/Voice takes, Bin, export resolve, drag payloads.
