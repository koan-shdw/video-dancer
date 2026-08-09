// EFFECT MODULE — grid tiling v2. Repeats the picture cols × rows (each independent, 1..24),
// with a transparent gap carved around tiles, drift in cells per one play of the block, an
// OVERLAP dial that grows tiles past their cells into the neighbors, and a MIX dial for how
// overlapping tiles meet (0 = soft crossfade, 1 = additive glow).
//
// kind 'raw': a pixel inside an overlap belongs to several tiles at once, so this pass samples
// up to the 3×3 cell neighborhood and blends — a plain uv remap can't express that. Aux
// (matte/depth) follows the DOMINANT tile so masks stay glued to the picture that won.
// SIZE (9th dial, first tenant of uP2): widens each tile's SOURCE window — the aspect-true
// fill crop clips the frame's edges, and pulling size below 1 letterboxes the whole clip into
// the tile instead; the freed border is transparent, exactly like the gap.

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
    { key: 'mix', label: 'mix', min: 0, max: 1, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'size', label: 'size', min: 0.25, max: 1, step: 0.01, def: 1, fmt: 'raw' },
    { key: 'fit', label: 'fit', min: 0, max: 1, step: 0.01, def: 0, fmt: 'raw' }
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
    // tiles keep the frame's TRUE aspect, never squash. FIT slides the framing continuously:
    // 0 = FILL (center-crop to cover the cell — wide clips lose their edges) · 1 = the whole
    // frame letterboxed inside the tile (nothing clipped, transparent bars like the gap) ·
    // between = partial crop. SIZE then scales the content further within the tile.
    vec2 cov = vec2(min(1.0, n.y / n.x), min(1.0, n.x / n.y));
    vec2 fitW = vec2(max(1.0, n.y / n.x), max(1.0, n.x / n.y));
    vec2 win = mix(cov, fitW, uP2.y);
    vec2 tuv = 0.5 + (t - 0.5) * win / max(uP2.x, 0.05);
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
