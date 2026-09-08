// EFFECT MODULE — push. Fake 3D from the depth data: `amount` scales near pixels out more than
// far ones (radial parallax, the dolly feel), `zoom` adds slow drift across the block's play.
// kind 'uv' with a depth lookup at the destination — the standard cheap-parallax approximation.
// No depth data → aux.g flat 0.5 → pure zoom drift (panel says so).

import { registerEffect } from '../core/registry'

registerEffect({
  key: 'push',
  label: 'push',
  chip: 'push',
  kind: 'uv',
  needs: { depth: true },
  params: [
    { key: 'amount', label: 'amount', min: 0, max: 1, step: 0.01, def: 0.35, fmt: 'raw' },
    { key: 'zoom', label: 'zoom', min: 0, max: 0.3, step: 0.005, def: 0, fmt: 'raw' }
  ],
  fs: `vec2 fxUv(vec2 uv0) {
  float d = texture(uAux, uv0).g; // WHITE = near
  float z = 1.0 + uP0.y * uCtx.x; // zoom drift over the block's play
  vec2 c = (uv0 - 0.5) / z;
  float par = 1.0 - (d - 0.5) * uP0.x * 0.12; // near samples pull toward center = loom larger
  return c * par + 0.5;
}`
})
