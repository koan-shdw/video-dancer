# GRID DRIFT LOOP — spec

2026-08-10 · status: BUILT (same day)

## Problem

Grid drift x/y is already *cells per one play of the block*: the shader multiplies drift by
`uCtx.x` (progress 0..1 through the block), and progress restarts on every ⟲ repeat (Monitor
`prog()` and baker use the same per-cycle math). Every cell shows the same picture, so a drift
of exactly 1.0 lands pixel-identical at the seam — whole-number drift already loops clean.

Two gaps:
1. The sliders step 0.25 (range −4..4). Any fractional value visibly snaps back at every
   loop seam. Nothing locks the value to clean-looping whole cells.
2. Max is 4 cells per play; five-per-loop is out of reach.

## Feature

One `loop` toggle row in the grid effect section.

- **OFF (default)** — exactly today's behavior, bit for bit.
- **ON** — the drift the shader uses snaps to whole cells per play, so the seam is invisible.
  Values that would round to 0 but aren't 0 snap away from zero to ±1 instead — motion the
  user dialed in never silently dies (decision: plain `round()` would kill 0.25).
- Drift range widens −4..4 → **−8..8** on both axes (step stays 0.25).

## UX

- New row under drift y: label `loop`, a button in the house `ctl` style reading `off` / `on`,
  amber text + border when on. Reset ↺ appears when on (`dirty` = value ≠ def, as every row).
- Drift sliders unchanged. Readout keeps showing the raw slider value; while loop is on the
  motion uses the rounded value. Button tooltip carries this: "locks drift to whole cells per
  play · loops clean on ⟲ repeat".

## Data

- New param on the grid module, appended after `fit`:
  `{ key: 'loop', label: 'loop', min: 0, max: 1, step: 1, def: 0, fmt: 'toggle' }`
  → param index 10 → uniform slot `uP2.z` (free today; grid uses uP2.x size, uP2.y fit).
- fx v2 stack params gain a `loop` key only when the user touches the button. Untouched
  projects stay byte-identical (chain's `v()` falls back to `def` 0 and clamps). No migration,
  no schema change, no main/preload/shared edits.

## Plumbing

- `FxParamSpec.fmt` union gains `'toggle'` (fx/core/types.ts).
- `ParamRow` (EffectsPanel.tsx): when `fmt === 'toggle'`, render the button instead of the
  range input; `fmtVal` returns `on`/`off`. Generic — any future effect can declare a toggle.

## Shader (grid.ts)

```glsl
vec2 dr = vec2(uP1.x, uP1.y);
if (uP2.z > 0.5) {
  vec2 r = vec2(round(dr.x), round(dr.y));
  if (r.x == 0.0 && dr.x != 0.0) r.x = sign(dr.x);
  if (r.y == 0.0 && dr.y != 0.0) r.y = sign(dr.y);
  dr = r;
}
vec2 pos = vUv * n - vec2(dr.x, -dr.y) * uCtx.x;
```

Header comment gains one line about the toggle. `scrollX`/`scrollY` min/max become ±8.

## Files touched — renderer only, safe next to a running dev app

1. `src/renderer/src/fx/core/types.ts` — fmt union + one comment word
2. `src/renderer/src/fx/effects/grid.ts` — param, ±8 range, fs snap
3. `src/renderer/src/panels/EffectsPanel.tsx` — ParamRow toggle branch, fmtVal case
4. ~~WhatsNew.tsx~~ — deferred: its convention writes lines only when a release is cut
   (current card = shipped 0.8.0). Line to add then: "Grid drift learned to loop — a `loop`
   button locks drift to whole tiles per play, so ⟲ repeats glide with no snap-back, and the
   drift dials now reach 8 tiles."

Not touched: main/preload/shared, export path (same chain + uniforms), baker (params are
generic), push.ts zoom drift, transform.

## Edge cases

- loop on, drift 0 → still 0, no motion invented.
- loop on, drift 0.25 → 1 cell; −0.25 → −1 cell.
- loop on, drift 1.5 → 2 cells (nearest).
- Block without ⟲: progress runs 0→1 once; toggle just makes total travel whole cells. Harmless.
- Hand-edited fx: chain clamps loop into 0..1; 0.7 reads as on.
- Export: same chain, same `uCtx.x` per-cycle progress — preview and file match.

## Test plan

1. Grid 3×3, drift x = 1, ⟲ on, toggle ON → seam invisible across repeats.
2. Same with drift x = 1.25, toggle OFF → visible snap at seam (today's behavior kept).
   Toggle ON → clean loop at 1 cell per play.
3. drift 0.25 ON → exactly 1 cell per play; −0.25 → 1 cell leftward.
4. drift y variant of 1–3.
5. drift 5 reachable on the slider; 5 cells per play loops clean with toggle ON.
6. Old project with a gridded block: pixels unchanged until the button is touched.
7. Export one looped gridded block → seam clean in the rendered file.
