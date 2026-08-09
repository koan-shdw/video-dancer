// EFFECTS v2 — the module registry. ONE table drives everything: the panel builds its rows from
// `params`, the sanitizer clamps against min/max, the chain compiles each pass in `fs`. Adding
// an effect to the app = one new file in fx/effects/ calling registerEffect. Nothing else.
//
// Module kinds — the chain wraps the module's GLSL per kind so color AND aux (matte/depth)
// stay pixel-aligned through the whole stack without module authors thinking about it:
//
//   'uv'    — geometric. fs defines `vec2 fxUv(vec2 uv)` (+ helpers). The chain samples BOTH
//             color and aux at the returned uv, with bounds discard. transform/grid/push live here.
//   'color' — photometric. fs defines `vec4 fxColor(vec2 uv)` returning STRAIGHT color +
//             coverage alpha. May sample uSrc (prior pass color), uOrig (pre-stack dry frame),
//             uAux (r = matte, g = depth, WHITE/1 = near). Aux passes through untouched.
//   'raw'   — escape hatch. fs defines main itself and writes outColor AND outAux (MRT header
//             provided). For modules that must rewrite aux (depth remap, matte grow/shrink).
//
// `fs` may be an array — each entry is one full pass (ping-ponged in order, uPass = index).
// Separable blur, bloom chains, feedback stacks all express as multi-pass modules.
//
// Uniforms every module pass gets:
//   uP0, uP1, uP2 — params packed in spec order (uP0.xyzw = [0..3], uP1 = [4..7], uP2 = [8..11])
//   uCtx     — x = progress through the block (0..1), y = fade, z = canvas aspect (w/h),
//              w = hasDepth (1/0)
//   uPass    — float pass index within this module (multi-pass modules)

import type { FxParamSpec } from './types'

export type FxModuleKind = 'uv' | 'color' | 'raw'

export interface EffectModule {
  key: string
  label: string // panel section heading
  chip: string // add-effect chip text
  kind: FxModuleKind
  params: FxParamSpec[]
  needs?: { matte?: boolean; depth?: boolean; fullFrame?: boolean } // fullFrame: module re-crops per box — the source pass must keep the WHOLE clip (fit)
  internal?: boolean // pinned-section machinery (transform, mask) — never an add-chip
  fs: string | string[]
}

const modules = new Map<string, EffectModule>()

export function registerEffect(m: EffectModule): void {
  if (m.params.length > 12) throw new Error(`fx module ${m.key}: max 12 params (uP0+uP1+uP2)`)
  modules.set(m.key, m)
}
export function getEffect(key: string): EffectModule | undefined {
  return modules.get(key)
}
export function allEffects(): EffectModule[] {
  return [...modules.values()]
}
export function passesOf(m: EffectModule): string[] {
  return Array.isArray(m.fs) ? m.fs : [m.fs]
}
