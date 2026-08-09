// EFFECT MODULE — grid tiling v2. Repeats the picture cols × rows (each independent, 1..24),
// with a transparent gap carved around tiles, drift in cells per one play of the block, an
// OVERLAP dial that grows tiles past their cells into the neighbors, and a MIX dial for how
// overlapping tiles meet (0 = soft crossfade, 1 = additive glow).
//
// kind 'raw': a pixel inside an overlap belongs to several tiles at once, so this pass samples
// up to the 3×3 cell neighborhood and blends — a plain uv remap can't express that. Aux
// (matte/depth) follows the DOMINANT tile so masks stay glued to the picture that won.
// All 8 dial slots are spent — a 9th grid feature means dropping one or a 'grid II' module.

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
    { key: 'scrollX', label: 'drift x', min: -4, max: 4, step: 0.25, def: 0, fmt: 'raw' },
    { key: 'scrollY', label: 'drift y', min: -4, max: 4, step: 0.25, def: 0, fmt: 'raw' },
    { key: 'overlap', label: 'overlap', min: 0, max: 0.75, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'mix', label: 'mix', min: 0, max: 1, step: 0.01, def: 0, fmt: 'raw' }
  ],
  fs: `void main() {
  vec2 n = max(vec2(uP0.x, uP0.y), vec2(1.0));
  vec2 g = vec2(uP0.z, uP0.w) * 0.5;
  float ov = uP1.z;
  float mm = uP1.w;
  // drift in cells over the block's play — SUBTRACT the sample offset so positive drift moves
  // tiles right/down on screen, matching transform's tx/ty convention (adding inverts both axes)
  vec2 pos = vUv * n - vec2(uP1.x, -uP1.y) * uCtx.x;
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
    // tiles keep the frame's TRUE aspect: center-crop to fill the cell, never squash. A cell is
    // (1/cols × 1/rows) of the canvas, so the crop window per axis is min(1, rows/cols) etc.
    vec2 crop = vec2(min(1.0, n.y / n.x), min(1.0, n.x / n.y));
    vec2 tuv = 0.5 + (t - 0.5) * crop;
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
