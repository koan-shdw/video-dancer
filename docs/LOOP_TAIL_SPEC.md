# LOOP TAIL — spec (2026-08-09)

Replaces "⟲ loop to fill" (stamped copies + loopOf linking). That system dies. This is the loop.

## 1. Grammar

- One verb, two edges. The timeline's edge verb already exists: grab a right edge, drag, the thing ends there. Loop adds a second edge, no new verb.
- **Solid edge** = the clip's own trim handles (start AND end). They shape the cycle: what one repeat contains. Untouched code path.
- **Faded edge** = the tail's end handle. Where repeating stops.
- The tail is a **projection, not objects**. Zero items created. Every repeat resolves through the one block: take, trims, speed, fx, blend, mute, size. Edit the block, the whole tail is already updated. One undo.
- **Elastic by default**: tail fills to the wall. Wall = next block on the same track, else the sequence hard end (other blocks / music end).
- **Set by drag**: pull the handle, tail ends where you dropped it. Release against the wall = elastic again.
- Tail is not occupancy: drops and marquee pass through it; a block dropped inside it becomes the wall.

## 2. Data

- `TimelineItem` gains:
  - `loop?: true` — tail on.
  - `loopTailSec?: number` — user-set tail LENGTH in timeline seconds. Absent = elastic fill.
    (BUILD DEVIATION 2026-08-09: spec first said absolute `loopEndSec`. Length won: it rides
    every move/ripple/paste path for free; an absolute end would need shifting in six spots.
    `E = base + loopTailSec`, still clamped by walls, springs back when a neighbor leaves.)
- Derived, never stored:
  - `cycle = effDur(it)` · `base = startOf(it) + cycle`
  - `nextOnTrack` = earliest `startOf(x)` on the same track with `startOf(x) > startOf(it) + ε`
  - `hardEnd` = max(physical ends of all OTHER items on ALL tracks, `loopEndSec` of other SET tails, music end). Elastic tails of others excluded — two elastic tails can never inflate each other.
  - **Effective tail end** `E`:
    - elastic: `E = clamp(nextOnTrack ?? hardEnd, base, ∞)`
    - set: `E = clamp(min(loopEndSec, nextOnTrack ?? ∞), base, ∞)` — a later neighbor compresses it; neighbor leaves, it springs back to its stored end.
  - tail width `E - base < 0.05` → nub only, nothing plays.
- Seams at `base + k·cycle`. Last cycle may be partial: drawn cut, plays cut.
- **Kill list** (same change):
  - `fxData.ts` `loopOfId/stampLoopOf/clearLoopOf` + imports.
  - `store.ts` commitItemFx ripple + detach toast (~666-676) → plain single-item write.
  - `Timeline.tsx` "⟲ loop to fill" menu block (~2229-2269).
- **Migration** (schema bump): loader strips `loopOf` keys. Old stamped copies remain as plain independent blocks. No toasts, no linking, ever.

## 3. Code map

- `lib/timelineUtils.ts` owns the math: `tailEndOf(it, items, clips, musicEnd)`, `loopSeams(it, …)`, and loop-aware `itemAt / itemUnderAt / sourceTimeAt / nextBoundary / timelineEnd`.
- `export.ts` mirrors it inside its own planner (it already mirrors effDur/resolveTake — house pattern; comment points here).
- `Timeline.tsx` renders tail + handle; context menu toggles `loop`.

## 4. Timeline UI — what you SEE

- Toggle: right-click block → **"⟲ loop"** / **"⟲ loop off"**. No take gate — storyboard/recipe blocks loop too (stills repeat).
- Loop on: block unchanged; after it a same-height **tail** from `base` to `E`:
  - filmstrips on → the block's own sampled frames repeated per cycle at ~35% opacity (frames already sampled — no new decode work).
  - filmstrips off → the block's flat tint at ~35%.
  - 1px seam line at every cycle boundary. Partial last cycle drawn cropped.
  - small ⟲ per cycle when the cycle is ≥24px wide.
- **Handle**: ~10px grip at `E`, always present when loop is on — zero-width tail shows it as a ⟲ nub just past the block's right edge (never fights the trim handle). `data-noblockdrag`, `ew-resize`.
  - Drag = live re-tile. Uses the existing snap machinery (edges/playhead/beats, 12px).
  - Release within ~6px of the wall → `loopEndSec` cleared (elastic). Else stored. One `setTimelineItems` write = one undo.
- Tail body: `pointer-events: none`. Row clicks, marquee, drops all land on the row. Selecting the clip = click the clip.
- No async, no failure screens. Degenerate case is just the nub.

## 5. Playback

- `itemAt/itemUnderAt`: a loop item's span runs to `E`. Topmost-track rule unchanged — a higher track still wins over a tail.
- `sourceTimeAt`: past `base` wraps — `local = (T − startOf) mod cycle`, `src = in + local·speed`.
- `nextBoundary`: seams included → the A/B player treats each seam as a cut to the same file (preload + hard-bind already handle same-file seeks via the 'seek' ready gate). No new player logic.
- `editPoints/blockStarts`: seams excluded — ↑/↓ and Alt-jumps skip them; they're not edits.
- `timelineEnd`: includes `E` — a set tail extends the sequence; elastic math can't runaway (walls are physical-only).
- Monitor per-block progress strip: modulo cycle.
- `transitionOutSec`: fires at `E` only. Seams never dissolve.
- fx window (`fxUtils`): the whole span incl. tail — same item, same stack.

## 6. Export

- Planner extents → `E` (bounds, `topAt`, `fullEnd`).
- Every seam inside the window joins `bounds` → each cycle is its own interval; per interval `srcIn = in + ((a − itStart) mod effOf)·sp`.
- Audio rides each video seg as today → clip audio loops with it. `muted` / `audioDetachedId` honored per repeat.
- `fadeOut` only when the interval ends at `E`.
- Recipe/storyboard loops: beat-image lookup uses the wrapped `srcT` (same modulo).
- FX bakes are absolute-time — unaffected.

## 7. Edge cases

- Trim/speed/take-swap/S-B on the block → cycle changes → tail re-tiles instantly; `E` holds (set) or re-resolves (elastic).
- `disabled` block → span incl. tail vanishes (skipped by resolution, still occupies).
- Hidden/solo tracks → normal.
- In/out range → normal (range slices expanded time).
- Ripple/insert/clampShiftLeft → untouched; tails aren't items, they compress by nature.
- Lone clip, no music: elastic width 0 → pull the nub to grow the tail by hand.
- `audioDetachedId`: video repeats stay silent (existing mute path); the detached audio block itself does NOT loop — it's physical.
- Music end = music start + trimmed length (resolve via the existing music accessor in Timeline).

## 8. Acceptance — what you SEE

1. Right-click block → ⟲ loop → faded repeats fill to the next block / song end, instantly.
2. Drag the block's trim in/out → tail re-tiles with the new cycle. Same reach.
3. Add an effect → every repeat shows it live. One undo clears it everywhere.
4. Pull the tail handle left → shortens, snaps, sticks. Pull back to the wall → elastic again.
5. Drop a block inside the tail → tail now ends at its start. Delete that block → tail springs back.
6. Play across seams → clip cycles clean, no black, no stall. Scrub inside the tail → correct wrapped frame.
7. Export → repeats and their audio in the file; dissolve only at the very end of the tail.
8. Load tonight's project → old stamped copies are plain blocks. No link toasts. `loopOf` gone.

## 9. Not in this build

Per-cycle variation, crossfaded seams, looping audio-lane items, ping-pong.
