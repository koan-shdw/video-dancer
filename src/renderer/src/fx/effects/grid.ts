// EFFECT MODULE — grid tiling v2. Repeats the picture cols × rows (each independent, 1..24),
// with a transparent gap carved around tiles, drift in cells per one play of the block, an
// OVERLAP dial that grows tiles past their cells into the neighbors, and a MIX dial for how
// overlapping tiles meet (0 = soft crossfade, 1 = additive glow).
//
// kind 'raw': a pixel inside an overlap belongs to several tiles at once, so this pass samples
// up to the 3×3 cell neighborhood and blends — a plain uv remap can't express that. Aux
// (matte/depth) follows the DOMINANT tile so masks stay glued to the picture that won.
// SIZE (uP2.x): shrinks the clip further inside its box. FIT (uP2.y): slides the clip's
// mapping from cover (box filled, edges crop) to contain (the ENTIRE clip inside every box) —
// the chain keeps the whole clip alive in the source pass whenever fit is up (needs.fullFrame).
// LOOP (uP2.z): snaps drift to whole cells per play so the ⟲ repeat seam lands pixel-identical
// (nonzero drift rounds away from zero — never to a dead stop).

import { registerEffect } from '../core/registry'

registerEffect({
  key: 'grid',
  label: 'grid tiling',
  chip: 'grid',
  kind: 'raw',
  params: [
    { key: 'cols', label: 'cols', min: 1, max: 24, step: 1, def: 2, fmt: 'raw' },
    { key: 'rows', label: 'rows', min: 1, max: 24, step: 1, def: 2, fmt: 'raw' },
    { key: 'gapX', label: 'gap x', min: 0, max: 0.9, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'gapY', label: 'gap y', min: 0, max: 0.9, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'scrollX', label: 'drift x', min: -8, max: 8, step: 0.25, def: 0, fmt: 'raw' },
    { key: 'scrollY', label: 'drift y', min: -8, max: 8, step: 0.25, def: 0, fmt: 'raw' },
    { key: 'overlap', label: 'overlap', min: 0, max: 0.75, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'mix', label: 'mix', min: 0, max: 1, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'size', label: 'size', min: 0.25, max: 1, step: 0.01, def: 1, fmt: 'raw' },
    { key: 'fit', label: 'fit', min: 0, max: 1, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'loop', label: 'loop', min: 0, max: 1, step: 1, def: 0, fmt: 'toggle', hint: 'locks drift to whole cells per play · loops clean on ⟲ repeat' }
  ],
  needs: { fullFrame: true }, // fit re-crops per box — the source pass keeps the whole clip
  fs: `void main() {
  vec2 n = max(vec2(uP0.x, uP0.y), vec2(1.0));
  vec2 g = vec2(uP0.z, uP0.w) * 0.5;
  float ov = uP1.z;
  float mm = uP1.w;
  // drift in cells over the block's play — SUBTRACT the sample offset so positive drift moves
  // tiles right/down on screen, matching transform's tx/ty convention (adding inverts both axes).
  // LOOP on: whole cells only, so the repeat seam lands pixel-identical — nonzero drift rounds
  // away from zero (plain round would silently kill anything under 0.5)
  vec2 dr = vec2(uP1.x, uP1.y);
  if (uP2.z > 0.5) {
    vec2 r = vec2(round(dr.x), round(dr.y));
    if (r.x == 0.0 && dr.x != 0.0) r.x = sign(dr.x);
    if (r.y == 0.0 && dr.y != 0.0) r.y = sign(dr.y);
    dr = r;
  }
  vec2 pos = vUv * n - vec2(dr.x, -dr.y) * uCtx.x;
  // each tile occupies [lo, hi] in its own cell's coords — gap shrinks it, overlap grows it
  vec2 lo = g - vec2(ov);
  vec2 hi = vec2(1.0) - g + vec2(ov);
  vec2 span = max(hi - lo, vec2(1e-4));
  vec2 fw = vec2(ov) / span; // feather width across the tile (the overlap zone crossfades)
  vec3 accC = vec3(0.0);
  float accA = 0.0;
  float accW = 0.0;
  float bestW = 0.0;
  vec2 bestUv = vec2(0.5);
  for (int dy = -1; dy <= 1; dy++)
  for (int dx = -1; dx <= 1; dx++) {
    vec2 cellId = floor(pos) + vec2(float(dx), float(dy));
    vec2 local = pos - cellId;
    if (local.x < lo.x || local.x > hi.x || local.y < lo.y || local.y > hi.y) continue;
    vec2 t = (local - lo) / span; // 0..1 across this tile
    float w = 1.0;
    if (fw.x > 0.0) w *= smoothstep(0.0, fw.x, t.x) * smoothstep(0.0, fw.x, 1.0 - t.x);
    if (fw.y > 0.0) w *= smoothstep(0.0, fw.y, t.y) * smoothstep(0.0, fw.y, 1.0 - t.y);
    if (w <= 0.0) continue;
    // ---- clip → box mapping: aspect-true, gap-true, fit-aware ----
    // uContent = where the clip lives on the canvas (source pass keeps the whole clip when fit
    // is up). boxAR uses the GAP-shrunken span, so gap is pure spacing — it can never squash.
    // FIT slides cover → contain: 0 = box filled (crop, exactly the old look), 1 = the ENTIRE
    // clip inside the box, freed space transparent. SIZE then shrinks the clip further.
    float boxAR = uCtx.z * (span.x / n.x) / (span.y / n.y);
    float coverX = min(uContent.x, uContent.y * boxAR / uCtx.z);
    float containX = max(uContent.x, uContent.y * boxAR / uCtx.z);
    float sxs = mix(coverX, containX, uP2.y) / max(uP2.x, 0.05);
    float sys = sxs * uCtx.z / boxAR;
    vec2 tuv = 0.5 + (t - 0.5) * vec2(sxs, sys);
    if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) continue;
    vec4 s = texture(uSrc, tuv);
    accC += s.rgb * w;
    accA += s.a * w;
    accW += w;
    if (w > bestW) { bestW = w; bestUv = tuv; }
  }
  if (accW <= 0.0) { outColor = vec4(0.0); outAux = vec4(0.0); return; }
  // mix 0 = weight-normalized crossfade (over) · mix 1 = raw additive sum, clamped
  vec3 avg = accC / accW;
  float aAvg = accA / accW;
  outColor = vec4(mix(avg, min(accC, vec3(1.0)), mm), clamp(mix(aAvg, accA, mm), 0.0, 1.0));
  outAux = texture(uAux, bestUv);
}`
})
