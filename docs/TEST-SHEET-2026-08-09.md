# MORNING TEST SHEET — 2026-08-09 dawn build

Everything typecheck + build green. Nothing below live-tested in the app yet. Top to bottom, ~10 min.

## 1 · Soft mask (rebuilt: real pixel feather)

- [ ] Open Effects on your matted block. cut 0.5, soft 0 → knife edge, no staircase.
- [ ] Drag soft up slowly → a feather BAND grows in pixels. .25 ≈ 12px. It should finally look soft, not jank.
- [ ] Low cut (.05-.1) + soft up → NO grey halo ring around him. That ring was the old bug.
- [ ] Depth mask: same moves on plane/soft.
- FYI: .01/.02/.03 now = near-knife. Real range lives .1-.5.

## 2 · Loop tail (new — replaces loop to fill)

- [ ] Right-click a block → "⟲ loop". Faded repeat strip appears after it, to the next clip or song end.
- [ ] What you SEE: faded copies, seam line each cycle, ⟲ per cycle, amber grip at the end.
- [ ] Trim the block's edges → tail re-tiles instantly with the new cycle.
- [ ] Add an effect → every repeat shows it. One undo clears everywhere.
- [ ] Drag the amber grip left → tail shortens, snaps. Drag back to the wall → auto-fill again.
- [ ] Drop a block inside the tail → tail ends at it. Delete that block → tail springs back.
- [ ] Play across seams → clip cycles, audio loops with it. Small seam hitch = report it.
- [ ] Scrub inside the tail → correct wrapped frame.
- [ ] Export a looped span → repeats + audio in the file, dissolve only at the very end.
- [ ] Reopen the project → tonight's old stamped copies are plain blocks now, no toasts.

## 3 · Feel checks (carried from last night)

- [ ] Drag snapping: 12px magnet on edges/playhead/beats — still numb or good now?
- [ ] focus / air / push judged on REAL generated depth (you have depth ✓ generated).
- [ ] Maximize + divider drags: still smooth (strips repaint a beat after rest).

## 4 · Approve / know

- [x] FIXED in re-read: razor could cut inside a tail (nothing there to cut) — now guarded.
- Known limits, say if any matters:
  - Co-Director set_timeline_clips rewrites drop loop flags.
  - Very long tails (50+ cycles) = heavy export command; typical 4-10 cycles fine.
  - Inside a tail the clock is wall-time (AV lock = vernier-grade, seam timer is frame-aimed).
  - Tail strips go flat past 24 cycles; 200 cycle cells max.
  - Slicing a looping block: left half keeps loop (walls at right half = zero tail).
- [ ] Still pending from last night (task #5): passes + export bake end-to-end.
- Build note: prod build was broken by the fx worker (iife) — fixed via worker format 'es'. Lab: all shaders compile, 26-row battery ran.
