// MINIMAX H3 LOCAL (docs/MINIMAX-H3-LOCAL-SPEC-2026-09-22.md) — rides the LTX engine: the same
// headless ComfyUI, venv and server (ltxLocal.ts); nothing here spawns a second anything. This
// module owns what H3 adds on top: the two node packs its graph needs (KJNodes' low-VRAM nodes,
// the LBH latent upscaler), the optional speed-kernels row (SageAttention + Sol-Attn, spec §2b),
// and the H3 graph + render path (his dual-sampling workflow, node for node, spec §5/§6).
// Every pin was read live 2026-09-22 (spec §1.4); nothing floats on a branch head.
import { WebContents } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { totalmem } from 'os'
import * as runtime from './runtime'
import * as ltxLocal from './ltxLocal'
import { downloadFile, lastErrors, sha256Of } from './modelStore'
import { H3_BASE_IDS, H3_CORE_ID, H3_ENCODER_IDS, localModelFor } from '@koan/vidancer-ui/shared/localModels'
import { H3_SET_DEFAULT } from '@koan/vidancer-ui/shared/models'
import type { H3LoraSet } from '@koan/vidancer-ui/shared/types'

export const H3_KERNELS_ID = 'minimax-h3-kernels'

// ---- pins (spec §1.4) ----
const KJ_SHA = 'd3cfe21625e5170126ce06fbfcfe1d88108688c3' // kijai/ComfyUI-KJNodes main 2026-09-13
const KJ_ZIP = `https://codeload.github.com/kijai/ComfyUI-KJNodes/zip/${KJ_SHA}`
const KJ_INNER = `ComfyUI-KJNodes-${KJ_SHA}`
const KJ_DIR = 'ComfyUI-KJNodes'
const UP_SHA = '40316cf008b2fd8663263270669eb4da23f89d2c' // LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler main 2026-09-17, MIT, no pip deps
const UP_ZIP = `https://codeload.github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler/zip/${UP_SHA}`
const UP_INNER = `Comfyui_Minimax_h3_latent_Upscaler-${UP_SHA}`
const UP_DIR = 'Comfyui_Minimax_h3_latent_Upscaler'
const SOL_SHA = '930a4d6e432ff8b8ed5e30ff2f72519b92d69bdf' // Saganaki22/ComfyUI-sol-attn main 2026-08-13 — Sol-Attn as a Triton kernel, written for Windows Blackwell
const SOL_ZIP = `https://codeload.github.com/Saganaki22/ComfyUI-sol-attn/zip/${SOL_SHA}`
const SOL_INNER = `ComfyUI-sol-attn-${SOL_SHA}`
const SOL_DIR = 'ComfyUI-sol-attn'
// Windows kernels: triton for the engine's torch 2.11 (the fork pairs 2.10 ↔ 3.6, 2.11 ↔ 3.7;
// 3.7.1.post27 = the last 3.7 on PyPI, cp311 win_amd64 wheel checked 2026-09-23) + woct0rdho's SageAttention wheel — CUDA 13, any torch ≥ 2.10, abi3,
// RTX 50xx kernels bundled. Size + sha read from the downloaded wheel 2026-09-22.
const TRITON_PIN = 'triton-windows==3.7.1.post27'
const SAGE_FILE = 'sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl'
const SAGE_URL = `https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post6/${SAGE_FILE}`
const SAGE_BYTES = 16656067
const SAGE_SHA256 = '1635283f5c01ec3cda58a784d0d7eabbcaffaf9511d1b263db4750e1ed7958bb'

const packDir = (d: string): string => join(ltxLocal.ltxComfyDir(), 'custom_nodes', d)
const engineRoot = (): string => ltxLocal.ltxEngineDirs()[0]
const kernelsStamp = (): string => join(engineRoot(), 'vd-kernels.json')
const packIn = (d: string): boolean => existsSync(join(packDir(d), '__init__.py'))

// ---- the two graph packs: chained on any H3 row click (models:download), idempotent ----
export function h3PacksInstalled(): boolean {
  return packIn(KJ_DIR) && packIn(UP_DIR)
}
export async function ensureH3Packs(wc: WebContents): Promise<void> {
  await ltxLocal.installLtxEngine(wc) // no-op when it's there; its row animates the cold path
  if (!packIn(KJ_DIR)) {
    await ltxLocal.landPack(wc, KJ_ZIP, KJ_INNER, packDir(KJ_DIR), 'KJNodes (H3 low-VRAM nodes)')
    // pillow / color-matcher / matplotlib / mss / opencv-headless — small; the pack imports them at load
    await ltxLocal.pipIntoEngine(wc, ['-r', join(packDir(KJ_DIR), 'requirements.txt')])
  }
  if (!packIn(UP_DIR)) await ltxLocal.landPack(wc, UP_ZIP, UP_INNER, packDir(UP_DIR), 'H3 latent upscaler nodes')
  await ltxLocal.stampAdd({ kjnodes: KJ_SHA, h3upscaler: UP_SHA })
}

// ---- the speed kernels row (spec §2b): triton + SageAttention into the engine env, the Sol-Attn
// pack beside the others. Ready = the stamp + the pack + an import probe (a wheel that doesn't
// import never shows ✓). ----
export function kernelsInstalled(): boolean {
  return existsSync(kernelsStamp()) && packIn(SOL_DIR)
}
export function kernelsStatus(): { status: 'ready' | 'downloading' | 'none' } {
  return { status: ltxLocal.isInstalling(H3_KERNELS_ID) ? 'downloading' : kernelsInstalled() ? 'ready' : 'none' }
}
export async function kernelsBytes(): Promise<number> {
  return kernelsInstalled() ? (await runtime.dirSizeCached(packDir(SOL_DIR))) + SAGE_BYTES : 0
}

let kernelsJob: Promise<void> | null = null
let kernelsAbort: AbortController | null = null
export function cancelKernels(): void {
  kernelsAbort?.abort()
  ltxLocal.cancelInstall(H3_KERNELS_ID)
}

export function installKernels(wc: WebContents): Promise<void> {
  if (kernelsInstalled()) return Promise.resolve()
  if (kernelsJob) return kernelsJob
  if (!ltxLocal.beginInstall(H3_KERNELS_ID)) return Promise.resolve()
  const note = (t: string): void => {
    if (!wc.isDestroyed()) wc.send('models:progress', { id: H3_KERNELS_ID, pct: -1, got: 0, total: 0, note: t })
  }
  kernelsJob = (async (): Promise<void> => {
    if (!wc.isDestroyed()) wc.send('models:started', { id: H3_KERNELS_ID })
    try {
      await ensureH3Packs(wc) // the engine + KJNodes (his file's Sage node lives there)
      note('installing triton…')
      await ltxLocal.pipIntoEngine(wc, [TRITON_PIN], H3_KERNELS_ID)
      // the SageAttention wheel: pinned bytes + sha, .part discipline (bible 12.3)
      const wheel = join(engineRoot(), SAGE_FILE)
      if (!existsSync(wheel)) {
        const part = `${wheel}.part`
        await rm(part, { force: true })
        kernelsAbort = new AbortController()
        let lastMB = -1
        await downloadFile(SAGE_URL, part, kernelsAbort.signal, (got) => {
          const mb = Math.round(got / (1 << 20))
          if (mb !== lastMB) {
            lastMB = mb
            note(`downloading SageAttention… ${mb} MB`)
          }
        })
        if ((await stat(part)).size !== SAGE_BYTES) {
          await rm(part, { force: true })
          throw new Error('the SageAttention wheel changed size upstream — report this')
        }
        note('verifying SageAttention…')
        if ((await sha256Of(part)) !== SAGE_SHA256) {
          await rm(part, { force: true })
          throw new Error('the SageAttention wheel failed its integrity check — retry; if it repeats, report this')
        }
        await rename(part, wheel)
      }
      note('installing SageAttention…')
      await ltxLocal.pipIntoEngine(wc, [wheel], H3_KERNELS_ID)
      if (!packIn(SOL_DIR)) await ltxLocal.landPack(wc, SOL_ZIP, SOL_INNER, packDir(SOL_DIR), 'Sol-Attn nodes')
      note('checking the kernels…')
      await probe('import triton, sageattention.core')
      await writeFile(kernelsStamp(), JSON.stringify({ id: H3_KERNELS_ID, triton: TRITON_PIN, sage: SAGE_FILE, sol: SOL_SHA, at: new Date().toISOString() }))
      runtime.invalidateSizes()
      lastErrors.delete(H3_KERNELS_ID)
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: H3_KERNELS_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: H3_KERNELS_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'canceled') lastErrors.delete(H3_KERNELS_ID)
      else lastErrors.set(H3_KERNELS_ID, msg)
      console.error(`[h3] kernels install failed: ${msg}`)
      if (!wc.isDestroyed()) wc.send('models:done', { id: H3_KERNELS_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      kernelsAbort = null
      ltxLocal.endInstall(H3_KERNELS_ID)
      kernelsJob = null
    }
  })()
  return kernelsJob
}

// one python line through the engine's own interpreter — exit 0 or the reason
function probe(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(ltxLocal.ltxEnvPython(), ['-c', code], { env: runtime.uvBaseEnv() as Record<string, string>, windowsHide: true })
    let err = ''
    ps.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-600)))
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`the kernels installed but do not import: ${err.trim().slice(-300)}`))))
  })
}

export async function deleteKernels(): Promise<void> {
  runtime.killAllWorkers() // the Comfy server holds the packages open
  await new Promise<void>((resolve) => {
    const ps = spawn(runtime.uvExePath(), ['pip', 'uninstall', '--python', ltxLocal.ltxEnvPython(), 'sageattention', 'triton-windows'], { env: runtime.uvBaseEnv() as Record<string, string>, windowsHide: true })
    ps.on('error', () => resolve()) // a missing package is not a failure to delete
    ps.on('close', () => resolve())
  })
  await rm(packDir(SOL_DIR), { recursive: true, force: true })
  await rm(join(engineRoot(), SAGE_FILE), { force: true })
  await rm(kernelsStamp(), { force: true })
  runtime.invalidateSizes()
}

// ================= the render path (spec §5 / §6) =================

// the pinned row on disk, else the ladder (best-first) with requestedMissing said out loud
interface H3Pick {
  row: string
  label: string
  file: string
  requestedMissing?: boolean
}
function rowFile(id: string): string | null {
  const f = localModelFor(id)?.files?.[0]?.file
  return f && existsSync(join(ltxLocal.h3WeightsDir(), f)) ? f : null
}
function pickInstalled(ids: string[], preferred: string | undefined, what: string): H3Pick {
  const order = preferred && ids.includes(preferred) ? [preferred, ...ids.filter((x) => x !== preferred)] : ids
  for (const id of order) {
    const file = rowFile(id)
    if (file) return { row: id, label: localModelFor(id)?.label ?? id, file, requestedMissing: !!preferred && id !== preferred }
  }
  throw new Error(`no MiniMax H3 ${what} is installed — download one in the Models card`)
}
// the essentials row's files by role — names come from the registry, never typed twice
function coreFile(re: RegExp): string {
  const f = (localModelFor(H3_CORE_ID)?.files ?? []).find((x) => re.test(x.file))?.file
  if (!f) throw new Error(`the H3 essentials registry has no ${re} file — report this`)
  return f
}
function coreInstalled(): boolean {
  const files = localModelFor(H3_CORE_ID)?.files ?? []
  return files.length > 0 && files.every((f) => existsSync(join(ltxLocal.h3WeightsDir(), f.file)))
}

// his ResolutionSelector: a megapixel budget + an aspect, both sides multiples of 32.
// 480p = 0.5 MP (his file), 720p = 1.0 MP (H3's 1344×768 class)
function sizeFor(resolution: string, aspect: string): { w: number; h: number } {
  const mp = resolution === '720p' ? 1_000_000 : 500_000
  const [aw, ah] = (aspect.includes(':') ? aspect : '16:9').split(':').map(Number)
  const w = Math.sqrt((mp * aw) / ah)
  const r = (v: number): number => Math.max(64, Math.round(v / 32) * 32)
  return { w: r(w), h: r((w * ah) / aw) }
}
// his frame count: max(5, round(sec·24)) padded UP to the node's 5 + 17k grid (15 s → 362)
function framesFor(sec: number): number {
  const f = Math.max(5, Math.round(sec * 24))
  return f + ((((5 - (f % 17)) % 17) + 17) % 17)
}
// the H3 worker flags (spec §6): Windows needs --disable-async-offload (a VAE-decode crash on
// CUDA 13 without it); under 48 GB of RAM the pinned-memory pool must go. LTX keeps its own set.
function h3Args(): string[] {
  return [...(process.platform === 'win32' ? ['--disable-async-offload'] : []), ...(totalmem() < 48 * 2 ** 30 ? ['--disable-pinned-memory'] : [])]
}

interface H3GraphParams {
  prompt: string
  w: number
  h: number
  frames: number
  seed: number
  base: string
  encoder: string
  imageNames: string[]
  videoNames: string[]
  audioNames: string[]
  set: H3LoraSet
  picks: { name: string; weight: number }[]
  upscaleBy: number | null // null = the upscale switch is off
  kernels: 'off' | 'sage' | 'sol'
}

// his workflow, node for node (spec §5): the attention chain → the lora set → the ref2v node →
// six simple steps + two intermediate, split high/low → pass 1 (high), re-noise the (upscaled)
// video latent at the split, the final AV pass (low) on the lms+realism model → decode → mp4.
export function buildH3Graph(p: H3GraphParams): ltxLocal.Graph {
  const turbo = coreFile(/turbo/)
  const lms = coreFile(/lms/)
  const realism = coreFile(/realism/)
  const upscaler = coreFile(/upscaler/)
  const vvae = coreFile(/video_vae/)
  const avae = coreFile(/audio_vae/)
  const g: ltxLocal.Graph = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: p.base, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: p.encoder, type: 'minimax', device: 'default' } },
    vvae: { class_type: 'VAELoader', inputs: { vae_name: vvae } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: avae } }
  }
  // attention (spec §2b): off = exact + KJ head-chunking (the VRAM relief); sage / sol = the patch
  // first, chunking off — his file's arrangement (his Sage run had the chunking bypassed)
  let m: [string, number] = ['unet', 0]
  if (p.kernels === 'sage') {
    g.sage = { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: m } }
    m = ['sage', 0]
  } else if (p.kernels === 'sol') {
    // his file's sparse numbers (tau 1.3 · 12288 · exact_kv_and_rows), the rest the pack's defaults
    g.sol = { class_type: 'MiniMaxH3MemoryEfficientSolAttentionPatch', inputs: { model: m, enabled: true, tau: 1.3, min_tokens: 12288, strict: false, thresh_type: 'diag', int8_qk: false, int8_pv: false, sink_conditioning: 'exact_kv_and_rows', dense_blocks: '' } }
    m = ['sol', 0]
  } else {
    g.lowv = { class_type: 'MiniMaxLowVRAMAttention', inputs: { model: m, head_chunks: 4 } }
    m = ['lowv', 0]
  }
  g.ffn = { class_type: 'MiniMaxChunkFeedForward', inputs: { model: m, chunks: 2, seq_threshold: 4096 } }
  m = ['ffn', 0]
  const lora = (key: string, from: [string, number], name: string, w: number): [string, number] => {
    g[key] = { class_type: 'LoraLoaderModelOnly', inputs: { model: from, lora_name: name, strength_model: Math.max(0, Math.min(2, w)) } }
    return [key, 0]
  }
  // the set (spec §4.4): turbo on every pass (M1); lms + realism + the user's picks on the final pass (M3)
  if (p.set.turbo.on) m = lora('turbo', m, turbo, p.set.turbo.w)
  const m1 = m
  let m3 = m1
  if (p.set.lms.on) m3 = lora('lms', m3, lms, p.set.lms.w)
  if (p.set.realism.on) m3 = lora('realism', m3, realism, p.set.realism.w)
  p.picks.forEach((l, i) => {
    m3 = lora(`pick${i}`, m3, l.name, l.weight)
  })
  // refs → the core ref2v node; its autogrow inputs are dotted keys in the API prompt
  const r2v: Record<string, unknown> = { clip: ['clip', 0], vae: ['vvae', 0], audio_vae: ['avae', 0], prompt: p.prompt, width: p.w, height: p.h, length: p.frames, ref_image_size: 'max' }
  p.imageNames.forEach((f, i) => {
    g[`img${i}`] = { class_type: 'LoadImage', inputs: { image: f } }
    r2v[`ref_images.ref_image_${i}`] = [`img${i}`, 0]
  })
  p.videoNames.forEach((f, i) => {
    g[`vid${i}`] = { class_type: 'LoadVideo', inputs: { file: f } }
    g[`vidc${i}`] = { class_type: 'GetVideoComponents', inputs: { video: [`vid${i}`, 0] } }
    r2v[`ref_videos.ref_video_${i}`] = [`vidc${i}`, 0] // frames only — his file leaves the ref videos' audio empty too
  })
  p.audioNames.forEach((f, i) => {
    g[`aud${i}`] = { class_type: 'LoadAudio', inputs: { audio: f } }
    r2v[`ref_audios.ref_audio_${i}`] = [`aud${i}`, 0]
  })
  g.r2v = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: r2v }
  // sigmas: 6 simple steps + 2 intermediate (1 → 0, linear); HIGH = the first 2 steps, LOW = the
  // rest; SPLIT = the one sigma at the cut (a zero-step pass = re-noise only)
  g.sched = { class_type: 'BasicScheduler', inputs: { model: m1, scheduler: 'simple', steps: 6, denoise: 1 } }
  g.ext = { class_type: 'ExtendIntermediateSigmas', inputs: { sigmas: ['sched', 0], steps: 2, start_at_sigma: 1, end_at_sigma: 0, spacing: 'linear' } }
  g.split = { class_type: 'SplitSigmas', inputs: { sigmas: ['ext', 0], step: 2 } }
  g.split0 = { class_type: 'SplitSigmas', inputs: { sigmas: ['split', 1], step: 0 } }
  g.samp = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } }
  g.noise = { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } }
  g.nonoise = { class_type: 'DisableNoise', inputs: {} }
  g.g1 = { class_type: 'BasicGuider', inputs: { model: m1, conditioning: ['r2v', 0] } }
  g.g3 = { class_type: 'BasicGuider', inputs: { model: m3, conditioning: ['r2v', 0] } }
  g.p1 = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['g1', 0], sampler: ['samp', 0], sigmas: ['split', 0], latent_image: ['r2v', 1] } }
  g.sep1 = { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['p1', 0] } } // [1] = the audio at the split
  g.sepd = { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['p1', 1] } } // [0] = the denoised video
  let vid: [string, number] = ['sepd', 0]
  if (p.upscaleBy) {
    g.up = { class_type: 'MinimaxH3LatentUpscaler3D', inputs: { latent: vid, model_name: upscaler, mode: 'scale by multiplier', 'mode.scale': p.upscaleBy, align: 32, enable_temporal_chunking: true, force_unload: true, device: 'cuda', precision: 'bf16' } }
    vid = ['up', 0]
  }
  g.p2 = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['g1', 0], sampler: ['samp', 0], sigmas: ['split0', 0], latent_image: vid } }
  g.cat = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['p2', 0], audio_latent: ['sep1', 1] } }
  g.pf = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['nonoise', 0], guider: ['g3', 0], sampler: ['samp', 0], sigmas: ['split', 1], latent_image: ['cat', 0] } }
  g.dec = { class_type: 'VAEDecode', inputs: { samples: ['pf', 1], vae: ['vvae', 0] } }
  g.adec = { class_type: 'VAEDecodeAudio', inputs: { samples: ['pf', 1], vae: ['avae', 0] } }
  g.vid = { class_type: 'CreateVideo', inputs: { images: ['dec', 0], fps: 24, audio: ['adec', 0], bit_depth: 8 } }
  g.save = { class_type: 'SaveVideo', inputs: { video: ['vid', 0], filename_prefix: `h3_s${p.seed}`, format: 'auto', codec: 'auto' } }
  return g
}

export interface H3RenderArgs {
  jobId?: string
  prompt: string
  images: string[]
  videos: string[]
  audios: string[]
  duration: string
  resolution: string
  aspectRatio: string
  seed?: number
  loras?: { name: string; weight: number }[]
  sizeId?: string // the base tier pin (rides PromptData.ltxSize); absent = best installed
  encoderId?: string
  upscale?: boolean
  upscaleBy?: number
  kernels?: 'off' | 'sage' | 'sol'
  set?: H3LoraSet
  outDir: string
  onProgress?: (m: string, pct?: number) => void
}

export async function renderH3Clip(a: H3RenderArgs): Promise<{ file: string; durationSec: number; seed: number; sizeId: string; engineFile?: string; encoderRow: string }> {
  const tier = pickInstalled(H3_BASE_IDS, a.sizeId, 'size')
  const enc = pickInstalled(H3_ENCODER_IDS, a.encoderId, 'encoder')
  if (tier.requestedMissing) a.onProgress?.(`the pinned size is not installed — rendering with ${tier.label} instead`)
  if (enc.requestedMissing) a.onProgress?.(`the pinned encoder is not installed — rendering with ${enc.label} instead`)
  if (!coreInstalled()) throw new Error('MiniMax H3 essentials are missing — the Models card row installs them')
  if (!h3PacksInstalled()) throw new Error('the H3 node packs are missing — download any MiniMax H3 row in the Models card again')
  let kernels = a.kernels ?? 'off'
  if (kernels !== 'off' && !kernelsInstalled()) {
    a.onProgress?.('the speed kernels are not installed — rendering with exact attention')
    kernels = 'off'
  }
  a.onProgress?.('starting the engine for MiniMax H3 — a cold start loads the model and can take minutes…')
  const w = await ltxLocal.ensureLtxWorker((line) => console.log(`[ltx-engine] ${line}`), {
    extraArgs: h3Args(),
    loadKey: `h3:${tier.row}:${enc.row}`,
    onRestart: () => a.onProgress?.(`switching model — restarting the engine for ${tier.label}…`)
  })
  if (w.busy) throw new Error('the local engine is already rendering — one local render at a time')
  w.busy = true
  try {
    const { inDir } = ltxLocal.ltxWorkerScratch()
    const stamp = Date.now()
    const land = async (files: string[], tag: string, max: number): Promise<string[]> => {
      const out: string[] = []
      for (const [i, src] of files.slice(0, max).entries()) {
        if (!existsSync(src)) throw new Error(`reference file missing: ${src}`)
        const name = `h3${tag}${i}_${stamp}${extname(src)}`
        await copyFile(src, join(inDir, name))
        out.push(name)
      }
      return out
    }
    const imageNames = await land(a.images, 'img', 9)
    const videoNames = await land(a.videos, 'vid', 3)
    const audioNames = await land(a.audios, 'aud', 3)
    const secs = Math.max(4, Math.min(15, Number(a.duration) || 4))
    const frames = framesFor(secs)
    const { w: gw, h: gh } = sizeFor(a.resolution, a.aspectRatio)
    const seed = a.seed ?? Math.floor(Math.random() * 0xffffffff)
    const set = a.set ?? H3_SET_DEFAULT
    const upscaleBy = a.upscale === false ? null : a.upscaleBy === 1.5 ? 1.5 : 1.25
    // a pick whose file left the disk skips OUT LOUD, never silently (stable-board law)
    const picks = (a.loras ?? []).filter((l) => {
      const ok = ltxLocal.loraOnDisk(l.name)
      if (!ok) a.onProgress?.(`lora ${l.name} is not installed — rendering without it`)
      return ok
    })
    // the realism lora's trigger word rides the prompt while that row is on (spec §1.2b)
    const prompt = set.realism.on ? `r34l1sm\n\n${a.prompt}` : a.prompt
    const graph = buildH3Graph({ prompt, w: gw, h: gh, frames, seed, base: tier.file, encoder: enc.file, imageNames, videoNames, audioNames, set, picks, upscaleBy, kernels })
    // the token line (spec §6): Blackwell cards reported noise above ~150k tokens — a note, never a block
    const fw = upscaleBy ? Math.round((gw * upscaleBy) / 32) * 32 : gw
    const fh = upscaleBy ? Math.round((gh * upscaleBy) / 32) * 32 : gh
    const tokens = Math.ceil(frames / 4) * (fw / 32) * (fh / 32)
    const tokNote = `~${Math.round(tokens / 1000)}k tokens${tokens > 150_000 ? ' — above the line where Blackwell cards reported noise' : ''}`
    const out = await ltxLocal.runGraph({ w, graph, jobId: a.jobId, label: `${gw}x${gh}${upscaleBy ? ` → ×${upscaleBy}` : ''} · ${secs}s · ${tier.label} · ${tokNote}`, onProgress: a.onProgress })
    await mkdir(a.outDir, { recursive: true })
    const dest = join(a.outDir, `h3_${seed}_${Date.now()}${extname(out.src) || '.mp4'}`)
    await copyFile(out.src, dest)
    await rm(out.src, { force: true }).catch(() => undefined)
    a.onProgress?.(`done in ${Math.round(out.elapsedMs / 1000)}s`)
    return { file: dest, durationSec: secs, seed, sizeId: tier.row, engineFile: out.engineFile, encoderRow: enc.row }
  } finally {
    w.busy = false
    w.lastUsed = Date.now()
  }
}
