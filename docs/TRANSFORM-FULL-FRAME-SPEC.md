# TRANSFORM FULL FRAME — spec

2026-08-10 · status: BUILT (same day; window math shipped aspect-true — see Exact math)

## Problem

The source pass cover-crops every clip to the canvas before the stack runs. Transform is a
plain uv remap on that cropped texture — shrink a portrait clip on a landscape timeline and
you move a pre-cropped rectangle around. The cut-off picture is gone before transform ever
sees it. Premiere reveals the full frame when you scale down; we must too.

## Behavior (automatic — no toggle)

- Transform at neutral values, or absent: pixels byte-identical to today.
- Scale down / move / rotate: the crop boundary recedes exactly as far as the transform can
  reach — at scale 0.5 you see twice the cover field, at contain-scale you see the whole clip.
- Resolution is graded: the source keeps only as much extra picture as the transform can show,
  so a barely-touched transform stays as crisp as today (no blanket contain softening).

## Mechanism

Grid fit already proved the plumbing: the source pass can keep a wider window of the clip
(`uCover` interpolates cover→contain) and a module re-maps it. Transform joins in:

1. **transform.ts** gains `needs: { fullFrame: true }`.
2. **chain.ts** widens the per-layer source window by what the transform can reach.
3. **transform's shader** multiplies its result by a compensation factor so its own
   neutral framing still lands exactly on the old cover look.

### Exact math (chain.ts, JS side)

Existing per-axis factors: cover `s = (sx, sy)`, contain `c = (cx, cy)` (one of each pair
is 1; `c ≥ s` per axis). Source window `w ∈ [s, c]` per axis; texture texel `q` holds clip
uv `(q−0.5)·w + 0.5`; texture holds clip content up to half-extent `0.5·w` in clip uv.

For the layer's pinned transform entry (params clamped to spec ranges like `v()` does):

- For each canvas corner `uv0 ∈ {0,1}²`, replicate the shader inverse EXACTLY
  (translate → aspect-square rotate → scale) to get `uv`; take `E = max |uv − 0.5|` per axis.
- Window that holds the reachable content: `n = 2·min(E·s, 0.5)` per axis — the `0.5` cap
  means "never keep more than the whole clip" (movement past the clip's edge buys
  transparency, not resolution loss).
- Transform's demand as a single dial: `gT = clamp(max over axes of (n−s)/(c−s), 0, 1)`
  (axes where `c = s` contribute 0).
- Final window: ONE aspect-true interp for both axes, `g = max(gridFit, gT)`,
  `w = s + (c−s)·g`. Aspect-true (not per-axis minimal) keeps `uContent` truthful, so grid's
  per-box framing math stays exact when grid and transform share a block; the cost is a
  slightly conservative window when only one axis needs reveal. `uContent` formula unchanged.

New uniform for every module pass: `uFrameK = (sx/wx, sy/wy)` (≤ 1). Only transform reads it.

### Shader (transform.ts)

```glsl
  uv /= max(uP0.z, 1e-4);
  return uv * uFrameK + 0.5;   // was: uv + 0.5 — uFrameK re-zooms the widened source
```

The uv-kind wrapper's bounds discard and the source pass's transparent out-of-clip texels
handle every edge — no other shader changes.

### Verified numeric cases (portrait 9:16 on 16:9 → s=(1, .3164), c=(3.1605, 1))

| transform | E | g | w | result |
|---|---|---|---|---|
| present, neutral (scale 1) | (.5, .5) | 0 | (1, .3164) = cover | byte-identical, crisp |
| scale 0.5 | (1, 1) | .463 | (2.00, .6328) | 2× field revealed, graded res |
| tx 50, scale 1 | (1, .5) | 0 | cover | cap at clip edge — no wasted softening |
| rotate 90° | (.281, .889) | .36 | (1.778, .5625) | vertical overflow fills the turn |

## Files touched — renderer only, safe next to a running dev app

1. `src/renderer/src/fx/core/chain.ts` — `transformReachG` helper; the fit block becomes the
   shared SOURCE WINDOW block; `uFrameK` in MODULE_COMMON + set per pass (~45 lines)
2. `src/renderer/src/fx/effects/transform.ts` — needs flag, one shader line, header comment

Not touched: main/preload/shared, gl.ts, combine, export path (same chain), Monitor DOM path
(no-fx blocks keep CSS cover).

## Edge cases / accepted trade-offs

- **Old projects change where transforms already sit** — they now show more picture. That is
  the point (user-approved 2026-08-10).
- Effects that run BEFORE the pinned transform see the widened window. Grid is immune (its
  uContent math is windowing-aware by design); color fx are per-pixel; push's center zoom
  acts on the letterboxed picture — subtly different under transform+push, accepted.
- Unused `uFrameK` in other modules: GLSL drops it; null-location uniform sets are no-ops.
- All-module shader sources change by one COMMON line → one-time program recompiles, cached.

## Test plan

1. Portrait clip, landscape canvas, transform scale 100 → pixels identical to before.
2. Scale to 50, drag y — the hidden top/bottom of the clip comes into view.
3. Scale to ~31 — the ENTIRE portrait clip visible, pillarboxed, still sharp for its size.
4. Rotate 90 at scale 100 — vertical overflow fills the turn, no transparent corners where
   picture exists.
5. Landscape clip on portrait canvas — mirrored axes behave the same.
6. Grid fit + transform on one block — both windows honored (max wins).
7. Block with color fx + transform — no framing shift beyond the reveal.
8. Export a transformed block — file matches Monitor.
