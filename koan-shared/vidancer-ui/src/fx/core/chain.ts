// EFFECTS v2 — THE pass chain. Per layer: media → source pass (cover fit, aux birth) → every
// stack entry as its own compiled pass (or passes), in stack order, ping-ponging MRT targets →
// one combine pass blends the finished layers bottom-to-top onto the canvas. Preview and export
// both call render(); parity is structural.
//
// Review-fleet fixes baked in (2026-08-08):
//   · target() allocates on a scratch unit + targets resolved BEFORE sampler binds (first-frame black)
//   · aux (matte/depth) rides the chain via MRT — always aligned, reaches combine (sandwich seam)
//   · combine unpremultiplies before blending (edge fringe / soft-matte halo)
//   · uOrig = pre-stack frame kept per layer for wet/dry + masked-bypass modules
//   · multi-pass modules (fs array), FxMedia widened past HTMLVideoElement, strict mode for export
//
// Orientation: uploads are y-flipped at the source, every texture is upright, passes sample
// straight. readPixels returns GL's bottom-up rows — the export baker flips rows CPU-side.
//
// FBO slots per layer i: 8+i = orig (source output, kept), i and 4+i = ping-pong.
// Media texture slots: i = video, 16+i = matte, 20+i = depth.

import { createFxGL, mediaReady, mediaW, mediaH, type FxGL, type FxTarget } from './gl'
import { BLEND_MODES, type FxLayerInput } from './types'
import { getEffect, passesOf, type EffectModule } from './registry'

export const FX_MAX_LAYERS = 4

const SOURCE_FS = `
uniform sampler2D uTex;
uniform sampler2D uMatte;
uniform sampler2D uDepth;
uniform vec2 uCover;
uniform vec2 uHasMD; // x = matte bound, y = depth bound
void main() {
  vec2 uv = (vUv - 0.5) * uCover + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.0); outAux = vec4(0.0, 0.0, 0.0, 0.0); return; }
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
  // aux born on the SAME uv as color — alignment locked from the first pass on
  float m = uHasMD.x > 0.5 ? texture(uMatte, uv).r : 1.0;
  float d = uHasMD.y > 0.5 ? texture(uDepth, uv).r : 0.5; // sidecar convention: WHITE = near
  outAux = vec4(m, d, 0.0, 1.0);
}`

const MODULE_COMMON = `
uniform sampler2D uSrc;
uniform sampler2D uOrig;
uniform sampler2D uAux;
uniform vec4 uP0;
uniform vec4 uP1;
uniform vec4 uP2;
uniform vec2 uContent;
uniform vec2 uFrameK;
uniform vec4 uCtx;
uniform float uPass;
`

const wrapModule = (m: EffectModule, passFs: string): string => {
  if (m.kind === 'uv')
    return `${MODULE_COMMON}
${passFs}
void main() {
  vec2 uv = fxUv(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.0); outAux = vec4(0.0); return; }
  outColor = texture(uSrc, uv);
  outAux = texture(uAux, uv);
}`
  if (m.kind === 'color')
    return `${MODULE_COMMON}
${passFs}
void main() {
  outColor = fxColor(vUv);
  outAux = texture(uAux, vUv);
}`
  return `${MODULE_COMMON}\n${passFs}` // raw — module owns main, writes both outs
}

// TRANSFORM REACH — how far toward contain (0 = cover, 1 = whole clip) must the source window
// slide so everything this transform can reveal exists in the texture? Replicates the shader's
// inverse EXACTLY (translate → aspect-square rotate → scale) on the four canvas corners, then
// caps the demand at the clip's edge — reaching past the picture buys transparency, never a
// wider (softer) window. Neutral transform lands g = 0: cover, byte-identical, full res.
const transformReachG = (p: Record<string, number>, AR: number, sx: number, sy: number, cx: number, cy: number): number => {
  const cl = (k: string, mn: number, mx: number, d: number): number => {
    const raw = p[k]
    const val = typeof raw === 'number' && Number.isFinite(raw) ? raw : d
    return Math.max(mn, Math.min(mx, val))
  }
  const tx = cl('tx', -100, 100, 0) / 100
  const ty = cl('ty', -100, 100, 0) / 100
  const sc = Math.max(cl('scale', 0.05, 4, 1), 1e-4)
  const r = -cl('rotate', -180, 180, 0) * 0.017453292
  const co = Math.cos(r)
  const si = Math.sin(r)
  let ex = 0
  let ey = 0
  for (const ux of [0, 1])
    for (const uy of [0, 1]) {
      const x = (ux - 0.5 - tx) * AR
      const y = uy - 0.5 + ty
      const rx = (co * x + si * y) / AR / sc
      const ry = (-si * x + co * y) / sc
      ex = Math.max(ex, Math.abs(rx))
      ey = Math.max(ey, Math.abs(ry))
    }
  const nx = Math.min(ex * sx, 0.5) * 2 // window that holds the reachable content, clip-edge capped
  const ny = Math.min(ey * sy, 0.5) * 2
  const gx = cx > sx + 1e-6 ? (nx - sx) / (cx - sx) : 0
  const gy = cy > sy + 1e-6 ? (ny - sy) / (cy - sy) : 0
  return Math.max(0, Math.min(1, Math.max(gx, gy)))
}

// blend math per W3C compositing spec, vectorized. `b` = backdrop (acc), `t` = source (straight).
const COMBINE_FS = `
uniform sampler2D uL0; uniform sampler2D uL1; uniform sampler2D uL2; uniform sampler2D uL3;
uniform sampler2D uA0; uniform sampler2D uA1; uniform sampler2D uA2; uniform sampler2D uA3;
uniform vec4 uBlend[4]; // x = mode index, y = opacity*fade, z = sandwich flag (phase C), w = layer depth dial
uniform int uCount;

vec3 blendPix(int mode, vec3 b, vec3 t) {
  if (mode == 1) return b * t;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - t);
  if (mode == 3) return mix(2.0 * b * t, 1.0 - 2.0 * (1.0 - b) * (1.0 - t), step(0.5, b));
  if (mode == 4) return min(b + t, 1.0);
  if (mode == 5) return min(b, t);
  if (mode == 6) return max(b, t);
  if (mode == 7) {
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
    return mix(b - (1.0 - 2.0 * t) * b * (1.0 - b), b + (2.0 * t - 1.0) * (d - b), step(0.5, t));
  }
  return t;
}

void layerIn(inout vec3 acc, inout float accA, vec4 s, vec4 bl) {
  float a = s.a * bl.y;
  if (a <= 0.0) return;
  vec3 cs = s.rgb / max(s.a, 1e-4); // edge/soft-matte texels arrive premultiplied — undo before blending
  // W3C: blend modes engage only where a backdrop EXISTS — over transparency the source lands
  // straight (else multiply/darken/overlay on the bottom-most layer grind the picture to black)
  vec3 eff = mix(cs, blendPix(int(bl.x + 0.5), acc, cs), accA);
  acc = mix(acc, eff, a);
  accA = a + accA * (1.0 - a);
}

void main() {
  vec3 acc = vec3(0.0);
  float accA = 0.0;
  if (uCount > 0) layerIn(acc, accA, texture(uL0, vUv), uBlend[0]);
  if (uCount > 1) layerIn(acc, accA, texture(uL1, vUv), uBlend[1]);
  if (uCount > 2) layerIn(acc, accA, texture(uL2, vUv), uBlend[2]);
  if (uCount > 3) layerIn(acc, accA, texture(uL3, vUv), uBlend[3]);
  outColor = vec4(acc, 1.0);
}`

export interface FxChain {
  render(layers: FxLayerInput[]): void
  readPixels(): Uint8Array
  resize(w: number, h: number): void
  canvasW(): number
  canvasH(): number
  destroy(): void
}

export function createFxChain(canvas: HTMLCanvasElement | OffscreenCanvas, opts?: { strict?: boolean }): FxChain {
  const G: FxGL = createFxGL(canvas)
  const { gl } = G
  const pSource = G.program(SOURCE_FS, { mrt: true })
  const pCombine = G.program(COMBINE_FS)
  const strict = !!opts?.strict

  const runLayer = (i: number, L: FxLayerInput): { color: FxTarget } | null => {
    if (!mediaReady(L.video)) {
      if (strict) throw new Error(`fx: layer ${i} media not ready at render (strict mode)`)
      return null
    }
    // resolve every render target BEFORE any sampler binding — allocation is bind-safe now,
    // but hoisting keeps the invariant visible and belt-and-braces
    const orig = G.target(8 + i)
    const ping = G.target(i)
    const pong = G.target(4 + i)

    const vidTex = G.sourceTexture(i)
    G.uploadSource(vidTex, L.video)
    const hasMatte = mediaReady(L.matte)
    const hasDepth = mediaReady(L.depth)
    const matteTex = hasMatte ? G.sourceTexture(16 + i) : null
    if (matteTex && L.matte) G.uploadSource(matteTex, L.matte)
    const depthTex = hasDepth ? G.sourceTexture(20 + i) : null
    if (depthTex && L.depth) G.uploadSource(depthTex, L.depth)

    const W = canvas.width
    const H = canvas.height
    const canvasAR = W / H
    const vidAR = mediaW(L.video) / mediaH(L.video)
    const sx = vidAR > canvasAR ? canvasAR / vidAR : 1
    const sy = vidAR > canvasAR ? 1 : vidAR / canvasAR
    // SOURCE WINDOW plumbing: fullFrame modules decide how much of the WHOLE clip the source
    // pass must keep — one aspect-true family, cover (g = 0) → contain (g = 1). Grid's fit dial
    // demands its dial value (fit 0 = classic cover, identical to always). Transform demands
    // only what its scale/move/rotate can actually reveal (transformReachG). The widest demand
    // wins; uContent tells modules where the clip lives; uFrameK lets transform re-zoom so its
    // neutral framing stays exact cover.
    const cx = vidAR > canvasAR ? 1 : canvasAR / vidAR
    const cy = vidAR > canvasAR ? vidAR / canvasAR : 1
    let gf = 0
    for (const entry of L.fx?.stack ?? []) {
      if (!getEffect(entry.type)?.needs?.fullFrame) continue
      if (entry.type === 'transform') gf = Math.max(gf, transformReachG(entry.params ?? {}, canvasAR, sx, sy, cx, cy))
      else {
        const f = Number((entry.params ?? {}).fit ?? 0)
        if (Number.isFinite(f)) gf = Math.max(gf, Math.min(1, Math.max(0, f)))
      }
    }
    const wx = sx + (cx - sx) * gf
    const wy = sy + (cy - sy) * gf

    gl.useProgram(pSource.prog)
    G.bindTextures(pSource, ['uTex', 'uMatte', 'uDepth'], [vidTex, matteTex, depthTex])
    gl.uniform2f(pSource.u('uCover'), wx, wy)
    gl.uniform2f(pSource.u('uHasMD'), hasMatte ? 1 : 0, hasDepth ? 1 : 0)
    G.draw(pSource, orig)

    let cur = orig
    let next = ping
    for (const entry of L.fx?.stack ?? []) {
      const mod = getEffect(entry.type)
      if (!mod) continue // unknown module (old project / removed effect) — pass through untouched
      const passes = passesOf(mod)
      for (let pi = 0; pi < passes.length; pi++) {
        const p = G.program(wrapModule(mod, passes[pi]), { mrt: true })
        gl.useProgram(p.prog)
        G.bindTextures(p, ['uSrc', 'uOrig', 'uAux'], [cur.tex, orig.tex, cur.aux])
        // clamp against the module's declared range — main persists the v2 stack VERBATIM, so a
        // hand-edited/foreign value must never reach a uniform raw; a missing params object
        // must never throw in the hot loop (it would burn the Monitor's 3-strike latch)
        const v = (k: number): number => {
          const spec = mod.params[k]
          if (!spec) return 0
          const raw = (entry.params ?? {})[spec.key]
          const val = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.def
          return Math.max(spec.min, Math.min(spec.max, val))
        }
        gl.uniform4f(p.u('uP0'), v(0), v(1), v(2), v(3))
        gl.uniform4f(p.u('uP1'), v(4), v(5), v(6), v(7))
        gl.uniform4f(p.u('uP2'), v(8), v(9), v(10), v(11))
        gl.uniform2f(p.u('uContent'), Math.min(1, 1 / wx), Math.min(1, 1 / wy)) // the clip's rect on the canvas
        gl.uniform2f(p.u('uFrameK'), sx / wx, sy / wy) // cover ÷ kept window — transform's re-zoom
        // NEST (list 3): an entry from a nest (or a clip inside one) runs its arc over ITS block,
        // not over the piece of it on screen now
        const pr = entry.span && L.time != null ? Math.max(0, Math.min(1, (L.time - entry.span[0]) / Math.max(0.01, entry.span[1]))) : L.progress
        gl.uniform4f(p.u('uCtx'), pr, L.fade, canvasAR, hasDepth ? 1 : 0)
        gl.uniform1f(p.u('uPass'), pi)
        G.draw(p, next)
        const swap = cur === orig ? pong : cur // orig is never a ping-pong destination
        cur = next
        next = swap
      }
    }
    return { color: cur }
  }

  return {
    render(layers) {
      // a lost context makes every draw a silent no-op and only NEW program compiles throw —
      // after first use everything is cached, so without this check the self-heal never fires
      // and the fx canvas freezes forever after a GPU reset
      if (gl.isContextLost()) throw new Error('fx: WebGL context lost')
      const W = canvas.width
      const H = canvas.height
      if (W < 2 || H < 2) return
      const n = Math.min(layers.length, FX_MAX_LAYERS)
      const finals: (FxTarget | null)[] = [null, null, null, null]
      for (let i = 0; i < n; i++) finals[i] = runLayer(i, layers[i])?.color ?? null

      gl.useProgram(pCombine.prog)
      G.bindTextures(
        pCombine,
        ['uL0', 'uL1', 'uL2', 'uL3', 'uA0', 'uA1', 'uA2', 'uA3'],
        [...finals.map((f) => f?.tex ?? null), ...finals.map((f) => f?.aux ?? null)]
      )
      for (let i = 0; i < FX_MAX_LAYERS; i++) {
        const L = layers[i]
        const bl = L?.fx?.blend
        const mode = bl ? Math.max(0, BLEND_MODES.indexOf(bl.mode)) : 0
        const op = (bl?.opacity ?? 1) * (L?.fade ?? 1) * (finals[i] ? 1 : 0)
        gl.uniform4f(pCombine.u(`uBlend[${i}]`), mode, op, 0, L?.flatDepth ?? 0.5)
      }
      gl.uniform1i(pCombine.u('uCount'), n)
      G.draw(pCombine, null)
    },
    readPixels: () => G.readPixels(),
    resize: (w, h) => G.resize(w, h),
    canvasW: () => canvas.width,
    canvasH: () => canvas.height,
    destroy: () => G.destroy()
  }
}
