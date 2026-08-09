// EFFECTS v2 — GL plumbing for the pass-chain compositor. One WebGL2 context, one fullscreen
// triangle, a cached program per fragment shader, and a pool of MRT render targets (color +
// aux). Every compile and link is checked and THROWS with the info log — a shader that cannot
// compile must never ship silent.
//
// MRT: every chain pass writes TWO attachments — location 0 = color (rgb + coverage alpha),
// location 1 = aux (r = matte, g = depth [sidecar convention: WHITE/1 = near], b/a spare).
// Aux rides the same geometry as color through every pass, so sidecars stay pixel-aligned with
// the picture no matter what the stack does to it. The combine pass draws to the canvas
// (single attachment) and uses the non-MRT header.
//
// Allocation discipline: all texture creation happens on a dedicated scratch unit (15) so a
// mid-setup allocation can never clobber a sampler binding a pass just made (the first-frame-
// black bug the review fleet caught).

export interface FxProgram {
  prog: WebGLProgram
  u: (name: string) => WebGLUniformLocation | null
}

export interface FxTarget {
  fb: WebGLFramebuffer
  tex: WebGLTexture // color attachment
  aux: WebGLTexture // aux attachment (matte/depth channels)
  w: number
  h: number
}

// media the chain can upload — HTMLVideoElement for live preview, ImageBitmap for the
// frame-accurate export path (WebCodecs decodes → ImageBitmap)
export type FxMedia = HTMLVideoElement | ImageBitmap

export const mediaReady = (m: FxMedia | null | undefined): m is FxMedia => {
  if (!m) return false
  if (m instanceof HTMLVideoElement) return m.readyState >= 2 && m.videoWidth > 0
  return m.width > 0
}
export const mediaW = (m: FxMedia): number => (m instanceof HTMLVideoElement ? m.videoWidth : m.width)
export const mediaH = (m: FxMedia): number => (m instanceof HTMLVideoElement ? m.videoHeight : m.height)

export interface FxGL {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement | OffscreenCanvas
  program: (fsSource: string, opts?: { mrt?: boolean }) => FxProgram
  target: (slot: number) => FxTarget
  bindTextures: (p: FxProgram, names: string[], texes: (WebGLTexture | null)[]) => void
  draw: (p: FxProgram, into: FxTarget | null) => void // null = the canvas
  sourceTexture: (slot: number) => WebGLTexture
  uploadSource: (tex: WebGLTexture, m: FxMedia) => void
  readPixels: () => Uint8Array
  resize: (w: number, h: number) => void
  destroy: () => void
}

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const HEADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
`
const HEADER_MRT = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outAux;
`

const SCRATCH_UNIT = 15

export function createFxGL(canvas: HTMLCanvasElement | OffscreenCanvas): FxGL {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null
  if (!gl) throw new Error('WebGL2 context unavailable')

  const shaders: WebGLShader[] = []
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)
    if (!sh) throw new Error('fx: WebGL context lost (createShader returned null)')
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`fx shader: ${gl.getShaderInfoLog(sh) ?? 'compile failed'}\n--- source ---\n${src}`)
    shaders.push(sh)
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, VS)

  const progCache = new Map<string, FxProgram>()
  const program = (fsSource: string, opts?: { mrt?: boolean }): FxProgram => {
    const full = (opts?.mrt ? HEADER_MRT : HEADER) + fsSource
    const hit = progCache.get(full)
    if (hit) return hit
    const prog = gl.createProgram()
    if (!prog) throw new Error('fx: WebGL context lost (createProgram returned null)')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, full))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`fx program: ${gl.getProgramInfoLog(prog) ?? 'link failed'}`)
    const locs = new Map<string, WebGLUniformLocation | null>()
    const p: FxProgram = {
      prog,
      u: (name) => {
        if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name))
        return locs.get(name)!
      }
    }
    progCache.set(full, p)
    return p
  }

  // every texture allocation rides the scratch unit — sampler bindings on units 0..14 survive
  const mkTex = (): WebGLTexture => {
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  const targets = new Map<number, FxTarget>()
  const target = (slot: number): FxTarget => {
    const W = canvas.width
    const H = canvas.height
    let t = targets.get(slot)
    if (t && t.w === W && t.h === H) return t
    if (t) {
      gl.deleteFramebuffer(t.fb)
      gl.deleteTexture(t.tex)
      gl.deleteTexture(t.aux)
    }
    const alloc = (): WebGLTexture => {
      const tex = mkTex()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      return tex
    }
    const tex = alloc()
    const aux = alloc()
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, aux, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`fx fbo incomplete: 0x${st.toString(16)}`)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    t = { fb, tex, aux, w: W, h: H }
    targets.set(slot, t)
    return t
  }

  // media textures — slot n stable, uploaded fresh each frame. FLIP_Y at upload puts the
  // picture upright in texture space; every pass then samples straight, no flip juggling.
  const srcTexes = new Map<number, WebGLTexture>()
  const sourceTexture = (slot: number): WebGLTexture => {
    let t = srcTexes.get(slot)
    if (!t) {
      t = mkTex()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
      srcTexes.set(slot, t)
    }
    return t
  }
  const uploadSource = (tex: WebGLTexture, m: FxMedia): void => {
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, m)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  const bindTextures = (p: FxProgram, names: string[], texes: (WebGLTexture | null)[]): void => {
    for (let i = 0; i < names.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, texes[i])
      gl.uniform1i(p.u(names[i]), i)
    }
  }

  const draw = (p: FxProgram, into: FxTarget | null): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null)
    gl.viewport(0, 0, into ? into.w : canvas.width, into ? into.h : canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const quad = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  return {
    gl,
    canvas,
    program,
    target,
    bindTextures,
    draw,
    sourceTexture,
    uploadSource,
    readPixels() {
      const W = canvas.width
      const H = canvas.height
      const buf = new Uint8Array(W * H * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      return buf
    },
    resize(w, h) {
      canvas.width = Math.max(2, Math.round(w))
      canvas.height = Math.max(2, Math.round(h))
    },
    destroy() {
      for (const t of targets.values()) {
        gl.deleteFramebuffer(t.fb)
        gl.deleteTexture(t.tex)
        gl.deleteTexture(t.aux)
      }
      for (const t of srcTexes.values()) gl.deleteTexture(t)
      for (const p of progCache.values()) gl.deleteProgram(p.prog)
      for (const sh of shaders) gl.deleteShader(sh)
      targets.clear()
      srcTexes.clear()
      progCache.clear()
      gl.deleteBuffer(quad)
      // deliberately NO loseContext() here: React fast-refresh can remount a component around
      // the SAME canvas, and a killed context stays dead — every later chain on that canvas then
      // fails shader creation forever (the "effects stopped working after HMR" bug). Repeated-
      // bake callers that truly want the context gone can lose it themselves on their own canvas.
    }
  }
}
