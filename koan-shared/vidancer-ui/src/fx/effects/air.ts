// EFFECT MODULE — air. Atmospheric perspective from the depth data: `haze` fades far pixels
// toward a pale sky tone like fog, `grade` tilts color (+ = warm near / cool far, − = flipped),
// `vignette` darkens the corners. No depth data → flat haze/tint (panel says so).

import { registerEffect } from '../core/registry'

registerEffect({
  key: 'air',
  label: 'air',
  chip: 'air',
  kind: 'color',
  needs: { depth: true },
  params: [
    { key: 'haze', label: 'haze', min: 0, max: 1, step: 0.01, def: 0.4, fmt: 'raw' },
    { key: 'grade', label: 'grade', min: -1, max: 1, step: 0.01, def: 0, fmt: 'raw' },
    { key: 'vignette', label: 'vignette', min: 0, max: 1, step: 0.01, def: 0, fmt: 'raw' }
  ],
  fs: `vec4 fxColor(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  float far = 1.0 - texture(uAux, uv).g; // depth: WHITE = near
  vec3 col = mix(c.rgb, vec3(0.82, 0.85, 0.90), far * uP0.x); // haze lifts the distance
  float g = uP0.y;
  vec3 warm = vec3(1.06, 1.00, 0.94);
  vec3 cool = vec3(0.94, 0.99, 1.08);
  vec3 nearTint = g >= 0.0 ? warm : cool;
  vec3 farTint = g >= 0.0 ? cool : warm;
  col *= mix(vec3(1.0), mix(nearTint, farTint, far), abs(g));
  col *= 1.0 - uP0.z * smoothstep(0.35, 0.75, distance(uv, vec2(0.5)));
  return vec4(col, c.a);
}`
})
