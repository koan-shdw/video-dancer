// EFFECT MODULE — transform. Position / scale / rotate, the first (and simplest) stack entry.
// kind 'uv': the module is ONLY the uv math — the chain samples color AND aux (matte/depth)
// at the returned uv, so sidecars stay glued to the picture through any transform for free.
// Rotation is aspect-corrected: uv stretches to square space before the rotate so a 90° turn
// stays a turn, not a shear (the v16 shader skipped this — visible on every non-square canvas).

import { registerEffect } from '../core/registry'

registerEffect({
  key: 'transform',
  label: 'transform',
  chip: 'transform',
  kind: 'uv',
  internal: true,
  params: [
    { key: 'tx', label: 'x', min: -100, max: 100, step: 0.5, def: 0, fmt: 'pct' },
    { key: 'ty', label: 'y', min: -100, max: 100, step: 0.5, def: 0, fmt: 'pct' },
    { key: 'scale', label: 'scale', min: 0.05, max: 4, step: 0.01, def: 1, fmt: 'pct' },
    { key: 'rotate', label: 'rotate', min: -180, max: 180, step: 0.5, def: 0, fmt: 'deg' }
  ],
  fs: `vec2 fxUv(vec2 uv0) {
  // inverse transform: undo translate, then rotate (aspect-true), then scale, around center.
  // tx right / ty down in screen terms; vUv.y grows upward, hence the sign split.
  vec2 uv = uv0 - 0.5 - vec2(uP0.x, -uP0.y) / 100.0;
  float r = -uP0.w * 0.017453292;
  float c = cos(r), s = sin(r);
  uv.x *= uCtx.z;
  uv = mat2(c, -s, s, c) * uv;
  uv.x /= uCtx.z;
  uv /= max(uP0.z, 1e-4);
  return uv + 0.5;
}`
})
