// LOCAL LTX ENGINE (docs/LTX-SPEC.md §2, phase 1) — a headless ComfyUI owned by the app runtime.
// No UI, no manager, no user-visible Comfy: install = PINNED ComfyUI checkout + PINNED
// ComfyUI-GGUF custom node + pinned torch cu130 into a uv venv (the MiniMax venv+pip shape from
// audioLocal.ts); worker = ComfyUI's own localhost server under the standard engine-shipped-
// server lifecycle (runtime.spawnServer — the ACE shape: no token, localhost binding is the
// trust boundary). Model files live in OUR models tree via extra_model_paths.yaml — visible
// and deletable on the Models card, nothing lands in the user's home. Graph submission
// (renders) arrives at spec phase 3; this module owns install / serve / delete only.
import { WebContents } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { Readable } from 'stream'
import * as runtime from './runtime'
import { modelsRoot } from './modelStore'
import { localModelFor } from '../shared/localModels'

export const LTX_ENGINE_ID = 'ltx-comfy-engine'

// THE PINS (spec §2.3 — versions move only through app updates we test; P1 re-validates):
//   ComfyUI v0.33.3 (Comfy-Org/ComfyUI, tag read live 2026-08-21) — post-dates LTX 2.5 day-one
//   support (2026-08-11). ComfyUI-GGUF main@6ea2651 (city96, head read live 2026-08-21).
//   torch cu130 trio pinned below — read from the proven dev-bench env (Blackwell-class GPUs
//   need cu128+; older RTX generations run the same wheels).
const COMFY_TAG = 'v0.33.3'
const COMFY_ZIP = `https://codeload.github.com/Comfy-Org/ComfyUI/zip/refs/tags/${COMFY_TAG}`
const COMFY_INNER = `ComfyUI-${COMFY_TAG.slice(1)}` // tag zips unwrap without the 'v'
const GGUF_SHA = '6ea2651e7df66d7585f6ffee804b20e92fb38b8a'
const GGUF_ZIP = `https://codeload.github.com/city96/ComfyUI-GGUF/zip/${GGUF_SHA}`
const GGUF_INNER = `ComfyUI-GGUF-${GGUF_SHA}`
// MSR refs pack (spec §9.2A): one nodes.py, zero pip deps, audited at this pin
const MSR_SHA = '98941179a82223a0a62219550272b2823b3e3a9c'
const MSR_ZIP = `https://codeload.github.com/liconstudio/ComfyUI-LTX2.5-MSR/zip/${MSR_SHA}`
const MSR_INNER = `ComfyUI-LTX2.5-MSR-${MSR_SHA}`
// PINNED to the proven dev-bench env (read live from the working install 2026-08-25; spec §11
// red flag closed): cu130 trio, the engine's own Blackwell requirement. Unpinned cu128 could
// never reproduce the env the P1 render was proven on.
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu130'
const TORCH_PINS = ['torch==2.11.0', 'torchvision==0.26.0', 'torchaudio==2.11.0']

const root = (): string => runtime.engineDir(LTX_ENGINE_ID)
const comfyDir = (): string => join(root(), 'ComfyUI')
const envRoot = (): string => join(root(), 'env')
const envPy = (): string => join(envRoot(), 'Scripts', 'python.exe')
const stamp = (): string => join(root(), 'vd-install.json')
// every LTX component file (transformers, encoders, VAEs, patches) lives FLAT in the one
// weights folder — the registry's video/ltx-2.5 home; loras share the app-wide loras shelf
export const ltxWeightsDir = (): string => join(modelsRoot(), 'video', 'ltx-2.5')
export const lorasDir = (): string => join(modelsRoot(), 'loras')

export function ltxEngineInstalled(): boolean {
  return existsSync(stamp()) && existsSync(envPy()) && existsSync(join(comfyDir(), 'main.py'))
}
export function ltxEngineStatus(): { status: 'ready' | 'downloading' | 'none' } {
  return { status: installs.has(LTX_ENGINE_ID) ? 'downloading' : ltxEngineInstalled() ? 'ready' : 'none' }
}
export async function ltxEngineBytes(): Promise<number> {
  return runtime.dirSizeCached(root())
}
export const ltxEngineDirs = (): string[] => [root()]

// PER-ENGINE install state — NOTHING shared between installers (the audioLocal law: a shared
// flag once made one row lie about another's download; user-caught 2026-08-19)
interface Install {
  ps: ReturnType<typeof spawn> | null
  canceled: boolean
  promise: Promise<void>
}
const installs = new Map<string, Install>()
export function isInstalling(id: string): boolean {
  return installs.has(id)
}
export function cancelInstall(id: string): void {
  const inst = installs.get(id)
  if (!inst) return
  inst.canceled = true
  try {
    inst.ps?.kill()
  } catch {
    /* already gone */
  }
}

const note = (wc: WebContents, text: string): void => {
  if (!wc.isDestroyed()) wc.send('models:progress', { id: LTX_ENGINE_ID, pct: -1, got: 0, total: 0, note: text })
}

// staged uv progress — the audioLocal parser verbatim (package counts when uv prints them,
// honest stage notes otherwise), bound to THIS engine's install state
function runUvStaged(args: string[], cwd: string | undefined, wc: WebContents): Promise<void> {
  const inst = installs.get(LTX_ENGINE_ID)
  return new Promise<void>((resolve, reject) => {
    const ps = spawn(runtime.uvExePath(), args, { cwd, env: runtime.uvBaseEnv(), windowsHide: true })
    if (inst) inst.ps = ps
    let err = ''
    let totalPkgs = 0
    let donePkgs = 0
    let inFlight = ''
    let lastSent = ''
    ps.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      err = (err + text).slice(-1500)
      for (const line of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const res = line.match(/Resolved (\d+) packages/)
        if (res) totalPkgs = Number(res[1])
        const dl = line.match(/^Downloading (\S+.*)$/)
        if (dl) inFlight = dl[1].slice(0, 60)
        if (/^Downloaded /.test(line)) {
          donePkgs++
          inFlight = ''
        }
        if (!wc.isDestroyed()) {
          if (totalPkgs > 0) {
            const pct = Math.min(95, Math.round((donePkgs / totalPkgs) * 100))
            const key = `${pct}|${inFlight}`
            if (key !== lastSent) {
              lastSent = key
              wc.send('models:progress', { id: LTX_ENGINE_ID, pct, got: donePkgs, total: totalPkgs, ...(inFlight ? { note: inFlight } : {}) })
            }
          } else {
            wc.send('models:progress', { id: LTX_ENGINE_ID, pct: -1, got: 0, total: 0, note: `env: ${line.slice(0, 80)}` })
          }
        }
      }
    })
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(inst?.canceled ? 'canceled' : `uv ${args[0]} failed (${c}): ${err.trim().slice(-300)}`))))
  })
}

// streamed zip download with live MB notes (codeload sends no content-length — the ACE shape)
async function fetchZip(url: string, dest: string, wc: WebContents, what: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${what} download failed: HTTP ${res.status}`)
  let got = 0
  const out = createWriteStream(`${dest}.part`)
  const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
  await new Promise<void>((resolve, reject) => {
    body.on('data', (c: Buffer) => {
      got += c.length
      if (got % (1 << 20) < c.length) note(wc, `downloading ${what}… ${Math.round(got / (1 << 20))} MB`)
    })
    body.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolve)
    body.pipe(out)
  })
  await rename(`${dest}.part`, dest)
}

// unpack a codeload zip whose single inner folder IS the payload → land it at `target`
async function landZip(zip: string, inner: string, target: string): Promise<void> {
  const tmp = `${target}.tmp`
  await rm(tmp, { recursive: true, force: true })
  await runtime.extractZip(zip, tmp) // bsdtar — validates CRCs, corrupt zip self-deletes
  await rm(zip, { force: true })
  const src = join(tmp, inner)
  await rename(existsSync(src) ? src : tmp, target)
  await rm(tmp, { recursive: true, force: true })
}

export function installLtxEngine(wc: WebContents): Promise<void> {
  if (ltxEngineInstalled()) return Promise.resolve()
  const existing = installs.get(LTX_ENGINE_ID)
  if (existing) return existing.promise
  const inst: Install = { ps: null, canceled: false, promise: undefined as unknown as Promise<void> }
  installs.set(LTX_ENGINE_ID, inst)
  inst.promise = (async (): Promise<void> => {
    if (!wc.isDestroyed()) wc.send('models:started', { id: LTX_ENGINE_ID })
    try {
      await runtime.ensureRuntime(wc) // chains the runtime install first — its row animates too
      await mkdir(root(), { recursive: true })
      if (!existsSync(join(comfyDir(), 'main.py'))) {
        const zip = join(root(), 'comfy.zip')
        await fetchZip(COMFY_ZIP, zip, wc, `ComfyUI ${COMFY_TAG}`)
        note(wc, 'unpacking ComfyUI…')
        await rm(comfyDir(), { recursive: true, force: true })
        await landZip(zip, COMFY_INNER, comfyDir())
      }
      const ggufDir = join(comfyDir(), 'custom_nodes', 'ComfyUI-GGUF')
      if (!existsSync(ggufDir)) {
        const zip = join(root(), 'gguf.zip')
        await fetchZip(GGUF_ZIP, zip, wc, 'GGUF loader')
        note(wc, 'unpacking the GGUF loader…')
        await landZip(zip, GGUF_INNER, ggufDir)
      }
      const msrDir = join(comfyDir(), 'custom_nodes', 'ComfyUI-LTX2.5-MSR')
      if (!existsSync(msrDir)) {
        const zip = join(root(), 'msr.zip')
        await fetchZip(MSR_ZIP, zip, wc, 'MSR refs nodes')
        note(wc, 'unpacking the MSR refs nodes…')
        await landZip(zip, MSR_INNER, msrDir)
      }
      note(wc, 'creating the environment…')
      await rm(envRoot(), { recursive: true, force: true })
      await runUvStaged(['venv', envRoot(), '--python', '3.11'], undefined, wc)
      // torch trio from the CUDA index FIRST — satisfying the requirements resolver up front
      // so it never swaps in CPU wheels
      note(wc, 'installing torch (the big one)…')
      await runUvStaged(['pip', 'install', '--python', envPy(), '--index-url', TORCH_INDEX, ...TORCH_PINS], undefined, wc)
      note(wc, 'installing ComfyUI…')
      await runUvStaged(['pip', 'install', '--python', envPy(), '-r', join(comfyDir(), 'requirements.txt')], undefined, wc)
      note(wc, 'installing the GGUF loader…')
      await runUvStaged(['pip', 'install', '--python', envPy(), '-r', join(ggufDir, 'requirements.txt')], undefined, wc)
      await mkdir(ltxWeightsDir(), { recursive: true })
      await mkdir(lorasDir(), { recursive: true })
      await writeFile(stamp(), JSON.stringify({ id: LTX_ENGINE_ID, comfy: COMFY_TAG, gguf: GGUF_SHA, msr: MSR_SHA, at: new Date().toISOString() }))
      runtime.invalidateSizes()
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: LTX_ENGINE_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: LTX_ENGINE_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id: LTX_ENGINE_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      installs.delete(LTX_ENGINE_ID)
    }
  })()
  return inst.promise
}

export async function deleteLtxEngine(): Promise<void> {
  runtime.killAllWorkers() // the Comfy server may hold the checkout open
  await rm(root(), { recursive: true, force: true })
  runtime.invalidateSizes()
  // weights are their own card rows (spec §3) — deleting the engine never touches them
}

// ---- the worker: ComfyUI serving on a private localhost port ----
// extra_model_paths.yaml points Comfy at OUR models tree; written fresh at every spawn so a
// moved userData can never leave a stale path behind
async function writeModelPaths(): Promise<string> {
  const p = join(root(), 'extra_model_paths.yaml')
  const w = ltxWeightsDir().replace(/\\/g, '/')
  const l = lorasDir().replace(/\\/g, '/')
  await writeFile(
    p,
    [
      'vidancer:',
      `  diffusion_models: ${w}`,
      `  text_encoders: ${w}`,
      `  vae: ${w}`,
      `  model_patches: ${w}`,
      `  latent_upscale_models: ${w}`,
      // two loras paths: the app-wide shelf + the ltx weights folder (MSR lives with its family)
      '  loras: |',
      `    ${l}`,
      `    ${w}`,
      ''
    ].join('\n')
  )
  return p
}

export async function ensureLtxWorker(onLine?: (line: string) => void): Promise<runtime.Worker> {
  if (!ltxEngineInstalled()) throw new Error('the LTX engine is not installed — download it in the Models card')
  const yaml = await writeModelPaths()
  const outDir = join(root(), 'out')
  const inDir = join(root(), 'in')
  await mkdir(outDir, { recursive: true })
  await mkdir(inDir, { recursive: true })
  return runtime.spawnServer(LTX_ENGINE_ID, {
    exe: envPy(),
    args: [
      join(comfyDir(), 'main.py'),
      '--listen',
      '127.0.0.1',
      '--port',
      '{PORT}',
      '--disable-auto-launch',
      '--extra-model-paths-config',
      yaml,
      '--output-directory',
      outDir,
      '--input-directory',
      inDir
    ],
    cwd: comfyDir(),
    healthPath: '/system_stats',
    startTimeoutMs: 180_000, // cold boot imports torch — slower disks need the headroom
    onLine
  })
}
export const ltxWorkerScratch = (): { outDir: string; inDir: string } => ({ outDir: join(root(), 'out'), inDir: join(root(), 'in') })

// ---- phase 3: the render path (LTX-SPEC §9.1) ----
// The graph is the PROVEN probe graph (scripts/probe-ltx.mjs t2vGraph — the official distilled
// recipe: 8-step sigma ladder, CFG 1.0, euler_ancestral, one pass at full size, no upscaler).
// Dev bf16 has NO proven sampling recipe (the official template ships distilled-only) — it
// REFUSES with the reason until a probe pins it. i2v = the official template's image chain
// (LoadImage → LTXVPreprocess(18) → LTXVImgToVideoInplace strength 0.7; schemas read from the
// installed engine's nodes_lt.py 2026-08-25).

// distilled sizes only, best first (highest-quality-default law); dev bf16 excluded on purpose
const RENDER_LADDER: { row: string; label: string }[] = [
  { row: 'ltx-2.5-quality', label: 'quality (int8)' },
  { row: 'ltx-2.5-standard', label: 'standard (Q5)' },
  { row: 'ltx-2.5-compact', label: 'compact (Q4)' },
  { row: 'ltx-2.5-small', label: 'small (Q3)' },
  { row: 'ltx-2.5-minimum', label: 'minimum (Q2)' }
]
const SIGMAS = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'
const NEG = 'pc game, console game, video game, cartoon, childish, ugly'
// conv VAE, not video-vae-bf16 — the official bf16 decoder ships NaN weights (2026-08-25)
const VVAE = 'ltx-2.5-video-vae-conv-bf16.safetensors'
// Kijai repack, not the official audio VAE — official ships NaN vocoder weights (2026-08-25)
const AVAE = 'kijai-ltx2-audio-vae-bf16.safetensors'
const MSR_LORA = 'LTX-2.5-Licon-MSR-V1.safetensors'

interface LtxVariant {
  label: string
  transformer: string
  gguf: boolean
  encoder: string
}
function pickInstalledVariant(): LtxVariant {
  for (const v of RENDER_LADDER) {
    const m = localModelFor(v.row)
    const files = m?.files ?? []
    if (!files.length) continue
    const dir = ltxWeightsDir()
    if (!files.every((f) => existsSync(join(dir, f.file)))) continue
    const transformer = files.find((f) => /transformer/.test(f.file))?.file
    const encoder = files.find((f) => /gemma4-12b/.test(f.file))?.file
    if (!transformer || !encoder) continue
    return { label: v.label, transformer, gguf: transformer.endsWith('.gguf'), encoder }
  }
  const full = localModelFor('ltx-2.5-full')
  const fullIn = (full?.files ?? []).length > 0 && (full?.files ?? []).every((f) => existsSync(join(ltxWeightsDir(), f.file)))
  throw new Error(
    fullIn
      ? 'only the full (dev bf16) size is installed — its render recipe is unproven (probe pending). Download a distilled size (quality/standard/…) in the Models card to render now.'
      : 'no LTX size is installed — download one in the Models card'
  )
}

// resolution label → /32 dims per aspect (spec §1 ladder; floor keeps the canonical widths)
function sizeFor(resolution: string, aspect: string): { w: number; h: number } {
  const base = resolution === '1080p' ? 1088 : resolution === '480p' ? 480 : 736
  const [aw, ah] = (aspect.includes(':') ? aspect : '16:9').split(':').map(Number)
  const long = Math.max(32, Math.floor((base * Math.max(aw, ah)) / Math.min(aw, ah) / 32) * 32)
  return aw >= ah ? { w: long, h: base } : { w: base, h: long }
}

interface GraphParams {
  prompt: string
  w: number
  h: number
  frames: number
  fps: number
  seed: number
  audio: boolean
  imageName?: string // set = i2v
  refNames?: string[] // set = MSR refs (max 4 subjects + 1 background, spec §9.2)
}
function buildGraph(v: LtxVariant, p: GraphParams): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    unet: v.gguf ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: v.transformer } } : { class_type: 'UNETLoader', inputs: { unet_name: v.transformer, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: v.encoder, type: 'ltxv', device: 'default' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: ['clip', 0] } },
    neg: { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['clip', 0] } },
    vvae: { class_type: 'VAELoader', inputs: { vae_name: VVAE } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: AVAE } },
    vlat: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: p.w, height: p.h, length: p.frames, batch_size: 1 } },
    alat: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: p.frames, frame_rate: p.fps, batch_size: 1, audio_vae: ['avae', 0] } },
    cond: { class_type: 'LTXVConditioning', inputs: { positive: ['pos', 0], negative: ['neg', 0], frame_rate: p.fps } },
    guider: { class_type: 'LTXVDualCFGGuider', inputs: { model: ['unet', 0], positive: ['cond', 0], negative: ['cond', 1], video_cfg: 1, audio_cfg: 1 } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    sigmas: { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } },
    samp: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['cat', 0] } },
    sep: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['samp', 0] } },
    dec: { class_type: 'VAEDecodeTiled', inputs: { samples: ['sep', 0], vae: ['vvae', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    save: { class_type: 'SaveVideo', inputs: { video: ['vid', 0], filename_prefix: `ltx25_s${p.seed}`, format: 'auto', codec: 'auto' } }
  }
  if (p.imageName) {
    g.img = { class_type: 'LoadImage', inputs: { image: p.imageName } }
    g.pre = { class_type: 'LTXVPreprocess', inputs: { image: ['img', 0], img_compression: 18 } }
    g.inplace = { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['vvae', 0], image: ['pre', 0], latent: ['vlat', 0], strength: 0.7, bypass: false } }
    g.cat = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['inplace', 0], audio_latent: ['alat', 0] } }
  } else if (p.refNames?.length) {
    // MSR refs (spec §9.2, probe P2 wiring): IC-LoRA patches the model, the guide encodes each
    // ref into a trained slot, CropGuides strips guide tokens before decode. Slots are trained
    // into the LoRA: pic1..pic4 + background — five is the hard model ceiling.
    g.lora = { class_type: 'ComfyUILTX25MSRICLoRALoader', inputs: { model: ['unet', 0], lora_name: MSR_LORA, strength_model: 1 } }
    const pics: Record<string, unknown> = {}
    p.refNames.slice(0, 5).forEach((f, i) => {
      const key = `ref${i}`
      g[key] = { class_type: 'LoadImage', inputs: { image: f } }
      pics[i === 4 ? 'background' : `pic${i + 1}`] = [key, 0]
    })
    g.guide = { class_type: 'ComfyUILTX25MSRMultiReferenceGuide', inputs: { positive: ['cond', 0], negative: ['cond', 1], vae: ['vvae', 0], latent: ['vlat', 0], ...pics, msr_parameters: ['lora', 1], strength: 1, reference_frames: '33', use_tiled_encode: false, tile_size: 256, tile_overlap: 64 } }
    g.guider.inputs.model = ['lora', 0]
    g.guider.inputs.positive = ['guide', 0]
    g.guider.inputs.negative = ['guide', 1]
    g.cat = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['guide', 2], audio_latent: ['alat', 0] } }
    g.crop = { class_type: 'LTXVCropGuides', inputs: { positive: ['guide', 0], negative: ['guide', 1], latent: ['sep', 0] } }
    g.dec.inputs.samples = ['crop', 2]
  } else {
    g.cat = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['vlat', 0], audio_latent: ['alat', 0] } }
  }
  if (p.audio) {
    g.adec = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['sep', 1], audio_vae: ['avae', 0] } }
    g.vid = { class_type: 'CreateVideo', inputs: { images: ['dec', 0], fps: p.fps, audio: ['adec', 0], bit_depth: 8 } }
  } else {
    g.vid = { class_type: 'CreateVideo', inputs: { images: ['dec', 0], fps: p.fps, bit_depth: 8 } }
  }
  return g
}

export interface LtxRenderArgs {
  jobId?: string
  mode: 'ref2v' | 'i2v'
  prompt: string
  images: string[]
  duration: string
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  seed?: number
  outDir: string
  onProgress?: (m: string) => void
}

let activeJob: { jobId?: string; base: string; promptId: string | null } | null = null

export async function renderLtxClip(a: LtxRenderArgs): Promise<{ file: string; durationSec: number; seed: number }> {
  const variant = pickInstalledVariant()
  a.onProgress?.('starting the LTX engine — a cold start loads the model and can take minutes…')
  const w = await ensureLtxWorker()
  if (w.busy) throw new Error('the LTX engine is already rendering — one local render at a time')
  w.busy = true
  const base = `http://127.0.0.1:${w.port}`
  activeJob = { jobId: a.jobId, base, promptId: null }
  try {
    const { outDir: comfyOut, inDir } = ltxWorkerScratch()
    let imageName: string | undefined
    let refNames: string[] | undefined
    if (a.mode === 'i2v') {
      const src = a.images[0]
      if (!src || !existsSync(src)) throw new Error('i2v needs a start image')
      imageName = `start_${Date.now()}${extname(src)}`
      await copyFile(src, join(inDir, imageName))
    } else if (a.images.length) {
      refNames = []
      for (const [i, src] of a.images.slice(0, 5).entries()) {
        if (!existsSync(src)) throw new Error(`reference image missing: ${src}`)
        const name = `ref${i}_${Date.now()}${extname(src)}`
        await copyFile(src, join(inDir, name))
        refNames.push(name)
      }
    }
    const fps = 24
    const secs = Math.max(1, Number(a.duration) || 4)
    const frames = secs * fps + 1 // num_frames % 8 == 1 (model law) — holds for whole seconds at 24fps
    const { w: gw, h: gh } = sizeFor(a.resolution, a.aspectRatio)
    const seed = a.seed ?? Math.floor(Math.random() * 0xffffffff)
    const graph = buildGraph(variant, { prompt: a.prompt, w: gw, h: gh, frames, fps, seed, audio: a.generateAudio, imageName, refNames })
    const res = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }) })
    const j = (await res.json()) as { prompt_id?: string; error?: unknown }
    if (!res.ok || j.error || !j.prompt_id) throw new Error(`the engine rejected the render graph: ${JSON.stringify(j.error ?? j).slice(0, 400)}`)
    activeJob.promptId = j.prompt_id
    const t0 = Date.now()
    a.onProgress?.(`rendering ${gw}x${gh} · ${secs}s · ${variant.label}…`)
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000))
      const h = (await (await fetch(`${base}/history/${j.prompt_id}`)).json()) as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: [string, { node_type?: string; exception_message?: string }][] }; outputs?: Record<string, { images?: { filename: string; subfolder: string }[]; video?: { filename: string; subfolder: string }[] }> }>
      const entry = h[j.prompt_id]
      if (!entry) {
        a.onProgress?.(`rendering… ${Math.round((Date.now() - t0) / 1000)}s`)
        continue
      }
      if (entry.status?.status_str === 'error') {
        const msgs = (entry.status.messages ?? []).filter((m) => m[0] === 'execution_error').map((m) => `${m[1]?.node_type}: ${m[1]?.exception_message}`)
        throw new Error(`render failed in the engine — ${msgs.join(' | ').slice(0, 400) || 'no detail reported'}`)
      }
      if (entry.status?.completed) {
        const out = Object.values(entry.outputs ?? {}).flatMap((o) => [...(o.video ?? []), ...(o.images ?? [])])[0]
        if (!out) throw new Error('the engine finished but produced no file — report this')
        const src = join(comfyOut, out.subfolder ?? '', out.filename)
        await mkdir(a.outDir, { recursive: true })
        const dest = join(a.outDir, `ltx25_${seed}_${Date.now()}${extname(out.filename) || '.mp4'}`)
        await copyFile(src, dest)
        await rm(src, { force: true }).catch(() => undefined)
        a.onProgress?.(`done in ${Math.round((Date.now() - t0) / 1000)}s`)
        return { file: dest, durationSec: secs, seed }
      }
      a.onProgress?.(`rendering… ${Math.round((Date.now() - t0) / 1000)}s`)
    }
  } finally {
    w.busy = false
    w.lastUsed = Date.now()
    activeJob = null
  }
}

// cancel = interrupt the running prompt (the polling loop then surfaces the engine's error);
// the worker survives for the next job (spec §2.2)
export async function cancelLtxRender(jobId: string): Promise<boolean> {
  if (!activeJob || activeJob.jobId !== jobId) return false
  try {
    await fetch(`${activeJob.base}/interrupt`, { method: 'POST' })
    return true
  } catch {
    return false
  }
}
