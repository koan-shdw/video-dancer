# LUMETRI GRADING — SPEC (PARKED 2026-08-11)

> **Status: PARKED by user call, 2026-08-11.** The edit-card half of the original combined
> spec moved to **EDIT-CARD-SPEC-2026-08-11.md** (implementation grade — build that first).
> This file keeps the Lumetri research + design so nothing is lost. Un-park by reading this
> plus a fresh look at fx/core (chain, registry) before building — verify line numbers.

Everything below was specced against the fx system as read on 2026-08-09: preview and export
share ONE WebGL chain (`fx/core/chain.ts` via Monitor and `fx/baker.ts` strict), so a Lumetri
built as registry modules gets exact preview=export parity structurally.

---

## L.0 Placement + architecture

- New **`lumetri` section at the TOP of the Effects panel**, collapsed by default. All
  existing sections (transform, mask, blend, effects) become collapsible via the existing
  `Section` `collapsible` prop; open-state persists in the ui store
  (`fxSectionsOpen: Record<string, boolean>`), lumetri's six sub-sections likewise.
- Storage: six INTERNAL fx modules, pinned entries in the stack tail, canonical order
  `[user effects…, lumBasic?, lumCreative?, lumCurves?, lumWheels?, lumHsl?, lumVignette?,
  mask?, transform?]` — `splitStack`/`joinStack` learn the six types; a section at defaults
  is DROPPED at join (untouched blocks stay byte-identical). Grading runs after creative
  effects, before mask/transform — vignette in source space before motion, Premiere's fixed
  order.
- Exact function: standard colorist algebra control-matched to Premiere (Adobe's internals
  are closed; controls, ranges, defaults, response character match — verify side-by-side on
  first build). Each section has Premiere's enable checkbox (params kept, entry not joined →
  zero GPU cost) and a ↺ reset.

## L.1 Engine extensions (fx core — renderer only, no shared/main edits)

1. Param cap 12 → 32: `uniform vec4 uPX[8]`; `uP0/1/2` stay as aliases of the first 12.
2. `FxEntry.data?: Record<string, number[] | string>` — curve points, LUT refs, swatches.
   `packFx2`/`readFx2` carry verbatim, validated on read. Persists through the whole-array
   timeline write like the v2 stack itself; schema v17 adopts later.
3. Module data textures: `makeTex?(entry) => {key, w, h, pixels} | null` — chain caches by
   content key, binds `uData`. Curve LUT strips live here.
4. 3D LUT slot: `makeLut3d?(entry, loader)` → `uLut` (TEXTURE_3D, trilinear). `.cube` parser
   (1D+3D) in `fx/lut.ts`; files via `media://` from `<project>/luts/` + bundled starters.
5. `uTexel` uniform (1/W, 1/H) for sharpen taps.
6. Scalars clamp as today; `v(k)` reads the 32-wide pack.

## L.2 The six sections — every control, Premiere-true

Ranges/defaults match Premiere's panel; verify against Premiere 2025 on first build.

**1 · Basic Correction** (`lumBasic`, color kind, ≤12 scalars + data.inputLut)
- Input LUT dropdown (None · bundled · Browse… .cube)
- WB Selector eyedropper · Temperature −100..100·0 · Tint −100..100·0
- Exposure −5..5·0 (stops) · Contrast −100..100·0 (pivot-0.5 s-curve) · Highlights ·
  Shadows · Whites · Blacks (each −100..100·0, luma-weighted range masks)
- Saturation 0..200·100 (luma-preserving)
- Auto button: percentile stretch (0.1/99.9) → exposure/contrast/whites/blacks
- HDR controls omitted (SDR app, as Premiere does in SDR)

**2 · Creative** (`lumCreative`, ≤10 scalars + data.lookLut)
- Look dropdown + Intensity 0..200·100 (LUT wet/dry, >100 extrapolates)
- Faded Film 0..100·0 · Sharpen −100..100·0 (unsharp mask, uTexel) · Vibrance −100..100·0
  (low-sat weighted) · Saturation 0..200·100
- Shadow Tint wheel + Highlight Tint wheel (2D) + Tint Balance −100..100·0

**3 · Curves** (`lumCurves`, all in data → 256×9 LUT strip via makeTex)
- RGB Curves: Master + R + G + B splines — click adds, drag moves, dbl-click removes;
  monotone-cubic (Fritsch-Carlson, no overshoot)
- Hue Saturation Curves: Hue vs Sat · Hue vs Hue · Hue vs Luma · Luma vs Sat · Sat vs Sat —
  hue axes wrap, eyedropper seeds a 3-point band
- SVG curve editor widget, house tokens, spectrum strips on hue axes, per-curve ↺

**4 · Color Wheels & Match** (`lumWheels`, 9 scalars)
- 3-Way Wheels: Shadows · Midtones · Highlights — 2D wheel + vertical luma slider each,
  lift/gamma/gain-style smooth range weights
- Comparison View: Monitor split — reference frame (frameGrab) vs current, side-by-side + wipe
- Apply Match: LAB mean/σ transfer from reference → WRITES wheels+temp/tint (an action, not
  a runtime param — how Premiere applies it)
- Face Detection checkbox: PARKED grey — needs a face model; match runs frame-global

**5 · HSL Secondary** (`lumHsl`, ~23 scalars, 3-pass raw module)
- Key: Set Color eyedropper (+ add/subtract swatches), H/S/L dual-range sliders with feather
  triangles, per-channel enables
- Show Mask: Color/Gray toggle + invert
- Refine: Denoise 0..100·0 · Blur 0..100·0 (on the key matte)
- Correction: center wheel + luma, Temperature, Tint, Contrast, Sharpen, Saturation
- Pass plan: p0 key → aux.b · p1 blur/denoise key · p2 correction gated by key
  (aux.r matte / aux.g depth untouched)

**6 · Vignette** (`lumVignette`, 4 scalars)
- Amount −5..5·0 · Midpoint 0..100·50 · Roundness −100..100·0 · Feather 0..100·50 —
  aspect-aware ellipse, pre-transform

## L.3 Monitor + panel integration

- Eyedropper: panelBus `fxPick(kind)` → Monitor pick mode (crosshair), click samples the
  rendered frame (post-stack readPixels, Premiere-style), returns rgb via bus. Esc cancels.
- Copy/paste grade (block context menu) + save-as-preset into project styles + preset
  dropdown at section head.
- Scopes strip (toggleable): Waveform luma/RGB · RGB Parade · Vectorscope · Histogram — fed
  by downsampled readback of the fx canvas at ≤10 Hz, off unless open. LAST phase.
- fxDraft live-preview + 400ms commit + undo: existing paths, entries ride the stack
  machinery. Timeline fx badge lights automatically.

## L.4 Performance + parity guards

- Neutral sections never join → untouched projects render zero extra passes.
- Full grade ≈ 8 passes/layer; budget 1080p preview ≥30fps with full grade on 2 layers
  (measure on the STAGED boot rig).
- Curve/LUT textures cached by content hash.
- Baker: zero changes (same chain, strict). Export test: grade → export → frame-compare vs
  Monitor.

## Phases when un-parked

L0 fx-core extensions → L1 basic/creative(no LUT)/vignette + collapsible sections → L2
curves + editor → L3 wheels + HSL + eyedroppers → L4 LUTs + comparison/match + presets
(small main handler possible — app closed) → L5 scopes.

Open picks deferred to L4: bundled .cube starter set; preset home (default: project styles).

## Test sheet (when un-parked)

Every control moves preview live · section enables · ↺ three levels · untouched block JSON
byte-identical · export frame matches Monitor · undo/redo · 2 graded layers + blend + mask +
transform · .cube round-trip · eyedropper pixel-true · HSL key leaves matte/depth effects
alone · perf budget above.
