// AI PASS WORKER — owns the ONNX engine and the models, OFF the app's main thread. The app
// stays alive while this crunches. Fresh build (the old main-thread runner is deleted, not
// wrapped); only the hard-won lessons carry over: absolute wasm paths (relative broke in dev),
// single-thread wasm when not cross-origin isolated, capped GPU start with a steady fallback,
// RVM recurrent state fed back per frame, DAv2 ImageNet norm + EMA-smoothed depth range.
//
// Protocol (all messages typed by `t`):
//   in  {t:'init', kind, modelBytes, W, H}   → out {t:'phase', label} … {t:'ready'} | {t:'fail', message}
//   in  {t:'frame', bitmap, index}           → out {t:'gray', index, data}  (buffer transferred)
//   in  {t:'close'}                          → worker exits

type Kind = 'matte' | 'depth'
type OrtNS = typeof import('onnxruntime-web')

let ort: OrtNS
let session: import('onnxruntime-web').InferenceSession
let kind: Kind = 'matte'
let W = 0
let H = 0
let inW = 0
let inH = 0
let inCanvas: OffscreenCanvas
let inCtx: OffscreenCanvasRenderingContext2D
let outCanvas: OffscreenCanvas
let outCtx: OffscreenCanvasRenderingContext2D
let chw: Float32Array
let rec: Record<string, import('onnxruntime-web').Tensor> = {}
let dsr = 1
let emaMin: number | null = null
let emaMax: number | null = null

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

const post = (m: unknown, transfer?: Transferable[]): void =>
  (self as unknown as Worker).postMessage(m, transfer ?? [])

async function init(k: Kind, modelBytes: Uint8Array, w: number, h: number): Promise<void> {
  kind = k
  W = w
  H = h
  inW = kind === 'depth' ? 518 : W
  inH = kind === 'depth' ? 518 : H
  inCanvas = new OffscreenCanvas(inW, inH)
  inCtx = inCanvas.getContext('2d', { willReadFrequently: true })!
  outCanvas = new OffscreenCanvas(W, H)
  outCtx = outCanvas.getContext('2d', { willReadFrequently: true })!
  chw = new Float32Array(3 * inW * inH)

  post({ t: 'phase', label: 'starting engine (first start can take a minute)' })
  ort = await import('onnxruntime-web')
  ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href
  if (!self.crossOriginIsolated) ort.env.wasm.numThreads = 1
  // STEADY ENGINE ONLY on this machine for now: the webgpu lane hung the app once and crashed
  // the GPU process once (black screen + reload) — two strikes. WebGPU comes back as an explicit
  // Settings toggle once this box proves it; slower per frame beats ambushing every first click.
  session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] })

  if (kind === 'matte') {
    rec = {}
    for (const n of ['r1i', 'r2i', 'r3i', 'r4i'])
      if (session.inputNames.includes(n)) rec[n] = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    dsr = Math.max(0.15, Math.min(1, 512 / Math.max(W, H)))
  }
  emaMin = null
  emaMax = null
}

async function frame(bitmap: ImageBitmap): Promise<Uint8Array> {
  inCtx.drawImage(bitmap, 0, 0, inW, inH)
  bitmap.close()
  const img = inCtx.getImageData(0, 0, inW, inH).data
  const px = inW * inH
  for (let p = 0; p < px; p++) {
    const r = img[p * 4] / 255
    const g = img[p * 4 + 1] / 255
    const b = img[p * 4 + 2] / 255
    if (kind === 'depth') {
      chw[p] = (r - MEAN[0]) / STD[0]
      chw[px + p] = (g - MEAN[1]) / STD[1]
      chw[2 * px + p] = (b - MEAN[2]) / STD[2]
    } else {
      chw[p] = r
      chw[px + p] = g
      chw[2 * px + p] = b
    }
  }
  const feeds: Record<string, import('onnxruntime-web').Tensor> = {
    [session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, inH, inW])
  }
  if (kind === 'matte') {
    Object.assign(feeds, rec)
    if (session.inputNames.includes('downsample_ratio'))
      feeds['downsample_ratio'] = new ort.Tensor('float32', new Float32Array([dsr]), [1])
  }
  const out = await session.run(feeds)

  const gray = new Uint8Array(W * H)
  if (kind === 'matte') {
    const pha = out['pha'] ?? out[session.outputNames[1] ?? session.outputNames[0]]
    const d = pha.dims
    const mw = d[d.length - 1]
    const mh = d[d.length - 2]
    const data = pha.data as Float32Array
    const id = new ImageData(mw, mh)
    for (let p = 0; p < mw * mh; p++) {
      const v = Math.max(0, Math.min(255, Math.round(data[p] * 255)))
      id.data[p * 4] = v
      id.data[p * 4 + 1] = v
      id.data[p * 4 + 2] = v
      id.data[p * 4 + 3] = 255
    }
    if (mw === W && mh === H) {
      outCtx.putImageData(id, 0, 0)
    } else {
      const tmp = new OffscreenCanvas(mw, mh)
      tmp.getContext('2d')!.putImageData(id, 0, 0)
      outCtx.drawImage(tmp, 0, 0, W, H)
    }
    const nextRec: typeof rec = {}
    for (const [a, b] of [['r1o', 'r1i'], ['r2o', 'r2i'], ['r3o', 'r3i'], ['r4o', 'r4i']] as const)
      if (out[a]) nextRec[b] = out[a]
    rec = nextRec
  } else {
    const dep = out[session.outputNames[0]]
    const d = dep.dims
    const dw = d[d.length - 1]
    const dh = d[d.length - 2]
    const data = dep.data as Float32Array
    let mn = Infinity
    let mx = -Infinity
    for (let p = 0; p < dw * dh; p++) {
      const v = data[p]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    // EMA-smoothed range — per-frame minmax alone flickers the whole depth field
    emaMin = emaMin == null ? mn : emaMin * 0.85 + mn * 0.15
    emaMax = emaMax == null ? mx : emaMax * 0.85 + mx * 0.15
    const range = Math.max(1e-5, emaMax - emaMin)
    const id = new ImageData(dw, dh)
    for (let p = 0; p < dw * dh; p++) {
      // DA v2 = inverse-depth-ish (bigger = nearer) → normalized value IS near-white
      const v = Math.max(0, Math.min(255, Math.round(((data[p] - (emaMin as number)) / range) * 255)))
      id.data[p * 4] = v
      id.data[p * 4 + 1] = v
      id.data[p * 4 + 2] = v
      id.data[p * 4 + 3] = 255
    }
    if (dw === W && dh === H) {
      outCtx.putImageData(id, 0, 0)
    } else {
      const tmp = new OffscreenCanvas(dw, dh)
      tmp.getContext('2d')!.putImageData(id, 0, 0)
      outCtx.drawImage(tmp, 0, 0, W, H)
    }
  }
  const outImg = outCtx.getImageData(0, 0, W, H).data
  for (let p = 0; p < W * H; p++) gray[p] = outImg[p * 4]
  return gray
}

self.onmessage = (e: MessageEvent): void => {
  const m = e.data as { t: string; kind?: Kind; modelBytes?: Uint8Array; W?: number; H?: number; bitmap?: ImageBitmap; index?: number }
  if (m.t === 'init') {
    init(m.kind!, m.modelBytes!, m.W!, m.H!)
      .then(() => post({ t: 'ready' }))
      .catch((err) => post({ t: 'fail', message: err instanceof Error ? err.message : String(err) }))
  } else if (m.t === 'frame') {
    frame(m.bitmap!)
      .then((data) => post({ t: 'gray', index: m.index, data }, [data.buffer]))
      .catch((err) => post({ t: 'fail', message: err instanceof Error ? err.message : String(err) }))
  } else if (m.t === 'close') {
    self.close()
  }
}
