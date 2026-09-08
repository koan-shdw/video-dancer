// EFFECT MODULE — focus. Depth of field from the depth data: `plane` picks the distance that
// stays sharp (WHITE = near), `aperture` sets how hard everything else blurs. Single-pass
// variable-radius disc blur (13 taps) — honest preview DOF without murdering the frame rate;
// the multi-pass fancy version can land later without touching this contract.
// No depth data → aux.g sits at 0.5 flat → uniform blur by |0.5 − plane| · aperture (usable,
// just flat — the panel says so).

import { registerEffect } from '../core/registry'

registerEffect({
  key: 'focus',
  label: 'focus',
  chip: 'focus',
  kind: 'color',
  needs: { depth: true },
  params: [
    { key: 'plane', label: 'plane', min: 0, max: 1, step: 0.01, def: 0.5, fmt: 'raw' },
    { key: 'aperture', label: 'aperture', min: 0, max: 1, step: 0.01, def: 0.35, fmt: 'raw' }
  ],
  fs: `vec4 fxColor(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  float d = texture(uAux, uv).g;
  float coc = clamp(abs(d - uP0.x) * uP0.y * 2.0, 0.0, 1.0); // circle of confusion
  vec2 px = 1.0 / vec2(textureSize(uSrc, 0));
  float r = coc * 20.0; // max blur radius in texels
  if (r < 0.5) return c;
  vec3 acc = c.rgb;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988; // 2π/12
    float rr = r * (mod(float(i), 2.0) < 0.5 ? 1.0 : 0.55); // two rings — cheap disc feel
    acc += texture(uSrc, uv + vec2(cos(a), sin(a)) * px * rr).rgb;
  }
  return vec4(acc / 13.0, c.a);
}`
})
