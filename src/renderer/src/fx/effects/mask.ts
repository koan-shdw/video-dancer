// MASK MODULES — the block-level mask, NOT creative stack effects. The panel presents mask as a
// fixed section (transform · mask · blend); these registry entries are its implementation: the
// chain runs the mask as a pinned pass after the creative stack (so a gridded block masks per
// tile — aux rides the chain) and before transform. Both carve the block's coverage alpha from
// the AI sidecar riding aux (r = subject matte, g = depth, WHITE = near); everything downstream
// sees the cutout automatically. kind 'color': aux passes through untouched.
//
// subject: RVM alpha re-cut at `cut`. depth: keeps what's NEARER than the plane (invert flips).
// `soft` is a PIXEL feather, not a value-window: the matte is near-binary (its whole edge lives
// in 1-3 px), so widening the smoothstep in VALUE space never softens — it only decides which
// semi-alpha background crumbs light up, and around a low cut it half-lifts the backdrop into a
// halo ring. Instead: cut FIRST (per tap, screen-pixel AA knife), then AVERAGE a 17-tap disc
// whose radius is the slider in aux pixels — a true coverage ramp that grows with the slider,
// centered on the contour, dead background staying dead (an isolated crumb is ≤ 1/17).
// Without a generated sidecar the aux defaults (matte 1, depth 0.5) make both no-ops — gated in
// the panel, never a crash. `internal` keeps them out of the add-chips list.

import { registerEffect } from '../core/registry'

// two golden-ratio-free rings — 8 @ 0.45R, 8 @ 1.0R offset 22.5° — plus the presampled center.
// fixed taps, no per-pixel jitter: video shimmers under animated noise.
const DISC = `const vec2 TAPS[16] = vec2[16](
  vec2( 0.450, 0.000), vec2( 0.318, 0.318), vec2( 0.000, 0.450), vec2(-0.318, 0.318),
  vec2(-0.450, 0.000), vec2(-0.318,-0.318), vec2( 0.000,-0.450), vec2( 0.318,-0.318),
  vec2( 0.924, 0.383), vec2( 0.383, 0.924), vec2(-0.383, 0.924), vec2(-0.924, 0.383),
  vec2(-0.924,-0.383), vec2(-0.383,-0.924), vec2( 0.383,-0.924), vec2( 0.924,-0.383));`

registerEffect({
  key: 'maskSubject',
  label: 'mask · subject',
  chip: 'mask',
  kind: 'color',
  internal: true,
  needs: { matte: true },
  params: [
    { key: 'threshold', label: 'cut', min: 0.02, max: 0.98, step: 0.01, def: 0.5, fmt: 'raw' },
    { key: 'soft', label: 'soft', min: 0, max: 0.5, step: 0.01, def: 0.25, fmt: 'raw' },
    { key: 'invert', label: 'invert', min: 0, max: 1, step: 1, def: 0, fmt: 'raw' }
  ],
  fs: `${DISC}
vec4 fxColor(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  vec2 tx = 1.0 / vec2(textureSize(uAux, 0));
  // 4-tap cross presample — eats codec crumbs stuck to the matte's edge
  float m0 = texture(uAux, uv).r * 0.4
           + (texture(uAux, uv + vec2(tx.x, 0.0)).r + texture(uAux, uv - vec2(tx.x, 0.0)).r
            + texture(uAux, uv + vec2(0.0, tx.y)).r + texture(uAux, uv - vec2(0.0, tx.y)).r) * 0.15;
  // fwidth widens the knife just enough to stay one SCREEN pixel smooth at any zoom
  float aa = max(fwidth(m0), 1e-4);
  float cut = uP0.x;
  float m = smoothstep(cut - aa, cut + aa, m0);
  float R = uP0.y * 48.0; // soft 0..0.5 → 0..24 aux-pixel feather radius
  if (R >= 0.75) {
    float acc = m;
    for (int i = 0; i < 16; i++) {
      float t = texture(uAux, uv + TAPS[i] * R * tx).r;
      acc += smoothstep(cut - aa, cut + aa, t); // cut THEN average — never average then cut
    }
    m = acc / 17.0;
    m = m * m * (3.0 - 2.0 * m); // S-shape the ramp — photographic feather, not linear haze
  }
  if (uP0.z > 0.5) m = 1.0 - m;
  return vec4(c.rgb, c.a * m);
}`
})

registerEffect({
  key: 'maskDepth',
  label: 'mask · depth',
  chip: 'mask',
  kind: 'color',
  internal: true,
  needs: { depth: true },
  params: [
    { key: 'plane', label: 'plane', min: 0.02, max: 0.98, step: 0.01, def: 0.5, fmt: 'raw' },
    { key: 'soft', label: 'soft', min: 0, max: 0.5, step: 0.01, def: 0.08, fmt: 'raw' },
    { key: 'invert', label: 'invert', min: 0, max: 1, step: 1, def: 0, fmt: 'raw' }
  ],
  fs: `${DISC}
vec4 fxColor(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  vec2 tx = 1.0 / vec2(textureSize(uAux, 0));
  float d0 = texture(uAux, uv).g * 0.4
           + (texture(uAux, uv + vec2(tx.x, 0.0)).g + texture(uAux, uv - vec2(tx.x, 0.0)).g
            + texture(uAux, uv + vec2(0.0, tx.y)).g + texture(uAux, uv - vec2(0.0, tx.y)).g) * 0.15; // WHITE = near
  float aa = max(fwidth(d0), 1e-4);
  float plane = uP0.x;
  float m = smoothstep(plane - aa, plane + aa, d0); // keep nearer than the plane
  float R = uP0.y * 48.0;
  if (R >= 0.75) {
    float acc = m;
    for (int i = 0; i < 16; i++) {
      float t = texture(uAux, uv + TAPS[i] * R * tx).g;
      acc += smoothstep(plane - aa, plane + aa, t);
    }
    m = acc / 17.0;
    m = m * m * (3.0 - 2.0 * m);
  }
  if (uP0.z > 0.5) m = 1.0 - m;
  return vec4(c.rgb, c.a * m);
}`
})
