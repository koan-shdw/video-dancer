# Timeline round 2 — production spec (2026-08-19)

Premiere is the answer key. Seven items, one round. Work tree is clean at `c9752eb`;
the only untracked file is the dead chat's handoff note (position marker only — this
spec re-derives everything from code).

Files touched: `panels/Timeline.tsx` · `panels/Monitor.tsx` · `panels/SourceMonitor.tsx`
· `panels/shared/playback.tsx` · `store.ts`. No schema changes (`TimelineMarker.color?`
already exists, types.ts:444).

---

## 1 · ONE MAGNET — everything snaps, or nothing does

**Truth today** (why the user sees "audio doesn't snap"):

| gesture | snaps? |
|---|---|
| video block move | yes (applySnap, 12px, Timeline.tsx:1940) |
| video trim in/out | **no** |
| video slip | no (correct — slip is source-window, Premiere doesn't snap it) |
| ⟲ tail drag | yes |
| audio item move | code exists (8px, :1228) — targets/threshold differ from video |
| audio item trim in/out | **no** |
| score move | code exists (8px, :762) |
| score head-trim / span-stretch | **no** |
| legacy music lane (AudioLane) move/trim | **no — zero snap code** (:515) |
| marker drag | markers can't be dragged at all |

Un-migrated projects still drag music through AudioLane — the handler with no magnet.
That is the likely "audio never snaps" path; the fix covers every path regardless.

**The design — one magnet, one target set, one threshold:**

- `snapTargetsAll(exclude: Set<string>): number[]` replaces `snapTargets`:
  - **master magnet ON** (`snapPlayhead` field, re-labeled "snap") → `0`, every video
    block edge, **every audio-item edge, every score-span edge**, markers, range
    in/out, the playhead. Audio/score edges are new — they were never targets.
  - **beat magnet ON** (`snapBeats`) → beat ticks, independent as today.
  - both OFF → empty set. **Nothing snaps — the Premiere model.** (Today edges snap
    unconditionally; the master magnet becomes what its icon promises.)
- `applySnap` stays: **12px** everywhere (kills the 8px lane threshold). Shift bypasses
  at every site. Snap-hit → the green `flashSnap` line at the hit (today video-only).
- TimelinePanel passes one object down: `snap = { targets(exclude), apply(t, targets,
  alsoEdge?), flash(at) }` → AudioItemLanes → AudioItem + ScoreBlocks, and AudioLane.

**Sites wired (every move AND every trim):**
1. video move — new targets (gains audio/score edges).
2. video trim in/out + rolling — snap the dragged edge in timeline time, convert back
   to source seconds, then apply the existing clamps.
3. ⟲ tail drag — new targets.
4. audio move — shared 12px + full set + flash. Then collision-hop as today.
5. audio trims in/out — snap the moving edge, then the collision walls clamp.
6. score move — shared.
7. score head-trim + span-stretch — snap the moving edge, then walls clamp.
8. legacy AudioLane move/in/out — same helper (cheap, closes the un-migrated hole).
9. marker drag (new, §2) — full set minus the dragged marker.
10. slice keeps its own in-block snap (playhead + beats) — already right.

**Toolbar:** magnet 1 tooltip → "snap — blocks, markers, playhead, range (S = toggle
all)". Magnet 2 (beats) unchanged. S key behavior unchanged (toggles both as a set).

---

## 2 · MARKERS — the Premiere set

`M` at playhead works (:2422). Markers render as triangles, `color` already themed
(`m.color ?? var(--amber)`, :2924). Rename + delete exist in the right-click (:3368).

**Add — drag to move:**
- pointerdown on a marker arms a drag; >3px = drag, no move = jump (today's click).
- while dragging: the marker follows, snaps (§1, excluding itself), and a floating
  timecode chip rides above the ruler at the marker's x — `smpte(at)`, mono 10px,
  `--txt-hi` on `rgba(0,0,0,.8)`, 1px `--line2`, radius 4.
- commit once on release via `setTimelineMeta` (one write, one undo).

**Add — right-click menu entries** (existing menu at :3368):
- **color row**: one menu row of 9 swatches — default (amber) + the Premiere eight:
  `#4caf50 #e53935 #ab47bc #fb8c00 #fdd835 #ffffff #42a5f5 #26c6da`. Each swatch is a
  14×14 radius-3 square, current one ring-marked; click sets `color` and closes the
  menu (swatch handlers own the click; the row entry itself is inert).
- **delete all markers (n)** — danger entry, real count on the label, immediate
  (undoable — the meta write rides the normal undo path). Existing rename/delete stay.

Tooltip on markers gains the drag verb: "click = jump · drag = move · right-click =
color / rename / delete".

---

## 3 · RULER — exact Premiere timecode, density that follows zoom

Today: a fixed step ladder (0.5/1/5/10/30 by visible span, :2633), `Ns` labels at 8px,
no minor ticks, one DOM node per tick. Sparse when zoomed, node-heavy when long.

**The design — canvas ruler, adaptive ladder:**
- the ruler strip grows 16 → **18px** (the rail header at :2786 matches — they align).
- ticks draw on a **viewport-sized canvas**, `position: sticky; left: 0` inside the
  scrolling wrap, redrawn with a `scrollLeft` offset on scroll / zoom / resize / total
  change. Explicit CSS width/height + pixel size from clientRect × dpr (THE positioned-
  canvas law, 2026-08-19). Colors read from computed style at draw time (canvas can't
  resolve vars): majors `--line2`, minors `--line`, labels `--dim`.
- **ladder** (seconds): `1/24 · 2/24 · 3/24 · 6/24 · 12/24 · 1 · 2 · 5 · 10 · 30 · 60 ·
  120 · 300 · 600`. Major step = the smallest with `step × pxPerSec ≥ 80px`
  (`pxPerSec = viewport × zoom / total`). Labels can't collide by construction.
- **majors**: full-height 1px tick + `smpte(t)` label, 9px mono (the type-scale floor),
  3px right of the tick. Exact Premiere timecode — `00:00:05:00`, frames included.
- **minors**: major/5, floored at one frame and ≥5px spacing (else none); 5px stubs
  rising from the ruler's bottom edge.
- scrub/markers/range stay DOM on the strip exactly as today — the canvas is visual
  only, `pointerEvents: none`.

---

## 4–7 · THE MONITORS — one transport grammar, centered

### Clip Monitor (SourceMonitor.tsx) — the canon, re-centered + loop

**Bar layout** (row at :541) becomes three zones:
- left: `flex:1`, `justify-content: flex-end` — carries `grabMsg` (sits just left of
  the cluster).
- **center cluster**, in order: **▶/⏸ · ▶in→out · ⟲ loop (NEW) · 🔇/🔊 · S-B ·
  take n/m ▾ · 📷 · ⊢first / last⊣ (slot mode)**. Dead center of the bar.
- right: `flex:1`, `justify-content: flex-end` — **ⓘ details** (stays pinned right).

Timecode row below is already centered (mono 13px current / dim total) — unchanged.

**⟲ loop (new, session-local state, lit = on / 0.4 = off like the timeline toolbar):**
- normal play: the clip repeats (native `video.loop` while window-play is not armed).
- in→out play: at the out-point the head returns to `inSec` and keeps playing
  (onTimeUpdate branch at :527 — loop ? seek-in : pause).
- storyboard clock (:158): at the end, loop restarts from where the run began
  (0, or `inSec` for a window run) instead of stopping.
- tooltip: "loop — the clip repeats · in→out repeats the window".

### Timeline Monitor (Monitor.tsx) — gets the same bar, the same readout

Today it has no transport at all; 📷/raw/⛶/details float top-right over the picture.

**Restructure**: the panel becomes a column — stage (flex:1, the existing absolute
players/canvas/overlays inside it, geometry RO unchanged) + a bottom bar `padding
6px 8px, background --bg0`, same three zones:
- left: `flex:1` end-justified — `grabMsg`.
- **center cluster**: **▶/⏸ · ▶in→out · ⟲ loop · 🔇 · 📷 · raw**.
  - **▶/⏸** — `tlPlaying ? tlPause() : tlPlay()`. Title: "play / pause (Space · K/L)".
  - **▶in→out** — plays the in/out range once (below). No range set → dimmed with the
    reason: "set the range first — I / O on the timeline ruler" (law 7).
  - **⟲ loop** — the existing `tlLoop`/`toggleLoop`. Title: "loop — the timeline, or
    the in/out range when one is set". (Item 6's timeline behavior already exists;
    this puts the button where the hand expects it.)
  - **🔇** — the master clip-audio mute (`videoMuted`, same toggle as the timeline
    toolbar's — one job, one state, two access points).
  - **📷 / raw** — move from the floating cluster into the bar, behavior unchanged.
- right: `flex:1` end-justified — **⛶ guides · ⓘ details** (details pinned right,
  same as the Clip Monitor). The floating top-right button cluster is removed; the
  details/beat overlay content itself still renders over the picture as today.

**Timecode readout** — centered line between bar and nothing (mirrors the Clip
Monitor): `<TimeReadout total={contentEnd}/>` in a centered div, mono 13px
`--txt-hi`, letterSpacing .5. `TimeReadout`'s total span gains `fontSize: '.85em'`
so current/total carry the Clip Monitor's 13/11 ratio everywhere it's used (the
timeline toolbar's drops 11 → ~9.4px total — above the 9px floor). One widget, one
look (law 3). `contentEnd` = `timelineEnd(...)` — the sequence length, not the padded
view total.

**in→out once — store + engine:**
- store: `tlPlayRangeOnce: boolean` + `tlPlayInOut()` — if both range ends set and
  `rangeOut > rangeIn`: `tlTime = rangeIn`, `seekTick++`, `tlPlaying = true`,
  `tlPlayRangeOnce = true`. `tlPause()` and user `tlSeek()` clear the flag.
- engine (Monitor tick, :551): when the flag is up and a range exists, `endT =
  rangeOut`; reaching it → `tlPause()` + clear (loop OFF path). With loop ON the
  existing range-loop already owns the end — the flag is moot there by design.

---

## Order of work (one commit per numbered block)

1. Monitors (items 4–7) — visible instantly, zero risk to edit mechanics.
2. Ruler (item 3).
3. Markers (item 2).
4. ONE MAGNET (item 1) — last: touches every gesture site; verified block-type by
   block-type in the running app (green flash proves the path fired).

## Verification (live app, after each block)

- drag every block type — video, green audio, teal file, purple score, blue companion
  (no drag — selection only), legacy ♪ if present — against a marker, a clip edge, the
  playhead: 12px catch + green flash on all. Shift kills it. Both magnets off kills it.
- trim every edge type against a marker: snaps.
- drag a marker: timecode chip reads exact smpte; release lands it; right-click →
  recolor / delete all.
- zoom 1× → 8×: ruler labels stay ~80px+ apart, minors appear/disappear, frames legible
  at max zoom; ruler and rail rows still align (18px header).
- both monitors: cluster dead-center at three panel widths (wrap folds, nothing clips);
  details pinned right; timecode centered and live during play.
- clip loop: whole clip repeats; in→out repeats the window; storyboard clock repeats.
- timeline in→out: plays the range once, parks at out; loop on → range repeats;
  no range → the button is dimmed and says why.
