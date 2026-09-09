// KREA 2 on the local engine (docs/KREA2-LOCAL-SPEC-2026-09-08.md §6) — the same bundled
// headless ComfyUI that renders LTX, one worker, one port. The graph is HIS "KREA 2 REF"
// workflow rebuilt from the file (P1, 2026-09-08): turbo recipe 8 steps · cfg 1 · euler ·
// simple; ref path = user loras → unleashed → Identity Edit v1.2 → Krea2EditModelPatch;
// cond = Krea2EditGroundedEncode on ref A (grounding 768); negative = ConditioningZeroOut.
import type { WebContents } from 'electron'
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { KREA2_FILE_OF } from '@koan/vidancer-ui/shared/localModels'
import * as runtime from './runtime'
import * as ltxLocal from './ltxLocal'
import { civitCheckpointsDir, krea2Dir } from './imagePaths'

const { KREA2EDIT_SHA, KREA2EDIT_ZIP, KREA2EDIT_INNER, KREA2EDIT_DIR } = ltxLocal

const ENCODER = 'qwen3vl_4b_fp8_scaled.safetensors'
const VAE = 'qwen_image_vae.safetensors'
const IDENTITY_LORA = 'krea2_identity_edit_v1_2.safetensors'
const UNLEASHED_STEM = 'krea2filterbypass3' // his "unleashed" — a folder lora, never bundled
const STEPS = 8
const CFG = 1
const GROUNDING_PX = 768

// ---- what is installed (the Models card's civit checkpoints row + the panel's MODEL groups) ----
export interface CivitCheckpointRow {
  id: string // 'civit:<versionId>'
  versionId: number
  file: string // basename inside its folder
  name: string
  versionName?: string
  baseModel?: string
  bytes: number
  homepage?: string
  thumb?: string
}
export interface CivitCheckpointSidecar {
  versionId: number
  modelId?: number
  name: string
  versionName?: string
  baseModel?: string
  sha256?: string
  homepage?: string
  images?: string[]
  file: string
}
export async function listCivitCheckpoints(): Promise<CivitCheckpointRow[]> {
  const root = civitCheckpointsDir()
  if (!existsSync(root)) return []
  const out: CivitCheckpointRow[] = []
  for (const d of await readdir(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const dir = join(root, d.name)
    const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.safetensors'))
    if (!files.length) continue
    let side: CivitCheckpointSidecar | null = null
    try {
      side = JSON.parse(await readFile(join(dir, 'civit.json'), 'utf8')) as CivitCheckpointSidecar
    } catch {
      /* no sidecar (hand-placed) — the folder name is the version id, the file name is the name */
    }
    const file = side?.file && files.includes(side.file) ? side.file : files[0]
    const bytes = (await stat(join(dir, file))).size
    out.push({
      id: `civit:${d.name}`,
      versionId: Number(d.name) || 0,
      file,
      name: side?.name ?? file.replace(/\.safetensors$/i, ''),
      versionName: side?.versionName,
      baseModel: side?.baseModel,
      bytes,
      homepage: side?.homepage,
      thumb: side?.images?.[0]
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function officialInstalled(): string[] {
  return Object.entries(KREA2_FILE_OF)
    .filter(([, f]) => existsSync(join(krea2Dir(), f)))
    .map(([id]) => id)
}
export function essentialsInstalled(): boolean {
  return [ENCODER, VAE, IDENTITY_LORA].every((f) => existsSync(join(krea2Dir(), f)))
}

// ---- the krea2edit pack inside the engine (spec §3.3) — pinned like MSR, no pip step ----
export function krea2EditInstalled(): boolean {
  return existsSync(join(ltxLocal.ltxComfyDir(), 'custom_nodes', KREA2EDIT_DIR, '__init__.py'))
}
export async function ensureKrea2EditPack(wc: WebContents): Promise<void> {
  if (!ltxLocal.ltxEngineInstalled()) throw new Error('the local engine is not installed — download it in the Models card')
  if (krea2EditInstalled()) return
  await ltxLocal.landPack(wc, KREA2EDIT_ZIP, KREA2EDIT_INNER, join(ltxLocal.ltxComfyDir(), 'custom_nodes', KREA2EDIT_DIR), 'Krea 2 refs nodes')
  await ltxLocal.stampAdd({ krea2edit: KREA2EDIT_SHA })
  runtime.killEngine(ltxLocal.LTX_ENGINE_ID) // a running worker has not loaded the new nodes
}

// ---- the graph ----
// Comfy validates loader names against ITS listing, which uses the OS separator — a
// forward-slash relative path is "not in list" on Windows (P2 catch 2026-09-09)
const comfyName = (n: string): string => (process.platform === 'win32' ? n.replace(/\//g, '\\') : n)
type G = Record<string, { class_type: string; inputs: Record<string, unknown> }>
export interface Krea2GraphParams {
  unetName: string // as Comfy resolves it: official basename, or '<versionId>/<file>' under the civit root
  prompt: string
  w: number
  h: number
  batch: number
  seed: number
  loras: { name: string; weight: number }[] // user slots (lora_name relative to a lora root)
  unleashed?: { name: string; weight: number }
  refs?: { a: string; b?: string; boost: number; boostB: number } // LoadImage names in the worker's in/ dir
  identityLora: string
}
export function buildGraph(p: Krea2GraphParams): G {
  const g: G = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: ENCODER, type: 'krea2', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: VAE } },
    lat: { class_type: 'EmptyLatentImage', inputs: { width: p.w, height: p.h, batch_size: p.batch } },
    samp: { class_type: 'KSampler', inputs: { seed: p.seed, steps: STEPS, cfg: CFG, sampler_name: 'euler', scheduler: 'simple', denoise: 1, latent_image: ['lat', 0] } },
    dec: { class_type: 'VAEDecode', inputs: { samples: ['samp', 0], vae: ['vae', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: ['dec', 0], filename_prefix: `imagegen_s${p.seed}` } }
  }
  // P1 chain order (his workflow, read from the file): user loras → unleashed → identity → patch
  let model: [string, number] = ['unet', 0]
  for (const [i, l] of p.loras.entries()) {
    g[`lora${i}`] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: comfyName(l.name), strength_model: Math.max(0, Math.min(2, l.weight)) } }
    model = [`lora${i}`, 0]
  }
  if (p.unleashed) {
    g.unleashed = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: comfyName(p.unleashed.name), strength_model: Math.max(0, Math.min(2, p.unleashed.weight)) } }
    model = ['unleashed', 0]
  }
  if (p.refs) {
    g.refA = { class_type: 'LoadImage', inputs: { image: p.refs.a } }
    if (p.refs.b) g.refB = { class_type: 'LoadImage', inputs: { image: p.refs.b } }
    g.idlora = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: p.identityLora, strength_model: 1 } }
    g.srcLat = { class_type: 'VAEEncode', inputs: { pixels: ['refA', 0], vae: ['vae', 0] } }
    g.patch = {
      class_type: 'Krea2EditModelPatch',
      inputs: {
        model: ['idlora', 0],
        source_latent: ['srcLat', 0],
        vae: ['vae', 0],
        source_image: ['refA', 0],
        ...(p.refs.b ? { source_image_b: ['refB', 0] } : {}),
        ref_boost: p.refs.boost,
        ref_boost_a: p.refs.boostB,
        fit_mode: 'fit'
      }
    }
    model = ['patch', 0]
    g.pos = { class_type: 'Krea2EditGroundedEncode', inputs: { clip: ['clip', 0], prompt: p.prompt, image: ['refA', 0], ...(p.refs.b ? { image_b: ['refB', 0] } : {}), grounding_px: GROUNDING_PX, system_prompt: '' } }
  } else {
    g.pos = { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: ['clip', 0] } }
  }
  g.neg = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['pos', 0] } }
  g.samp.inputs.model = model
  g.samp.inputs.positive = ['pos', 0]
  g.samp.inputs.negative = ['neg', 0]
  return g
}

// aspect + megapixels → a size with both sides on a multiple of 16 (P2 pins 8 vs 16)
export function sizeFor(aspect: string, megapixels: number): { w: number; h: number } {
  const [aw, ah] = aspect.split(':').map(Number)
  const ratio = aw > 0 && ah > 0 ? aw / ah : 1
  const px = Math.max(0.25, Math.min(2, megapixels)) * 1_000_000
  const h = Math.sqrt(px / ratio)
  const w = h * ratio
  const r16 = (v: number): number => Math.max(256, Math.round(v / 16) * 16)
  return { w: r16(w), h: r16(h) }
}

// ---- the render ----
export interface Krea2RenderArgs {
  jobId?: string
  model: string // registry row id or 'civit:<versionId>'
  prompt: string
  aspect: string
  megapixels: number
  batch: number
  seed?: number // undefined/0 = random
  loras: { name: string; weight: number }[]
  unleashed?: { name: string; weight: number }
  refs?: { a: string; b?: string; boost: number; boostB: number } // absolute image paths
  outDir: string
  onProgress?: (msg: string, pct?: number) => void
}
export interface Krea2RenderOut {
  files: string[]
  seed: number
  width: number
  height: number
  modelFile?: string
}

let activeJob: { jobId?: string; base: string; promptId: string | null } | null = null

async function resolveUnet(model: string): Promise<string> {
  if (model.startsWith('civit:')) {
    const vid = model.slice(6)
    const row = (await listCivitCheckpoints()).find((r) => r.id === model)
    if (!row) throw new Error('that civit checkpoint is not installed any more — pick another model')
    return comfyName(`${vid}/${row.file}`)
  }
  const f = KREA2_FILE_OF[model]
  if (!f) throw new Error(`unknown Krea 2 model row: ${model}`)
  if (!existsSync(join(krea2Dir(), f))) throw new Error(`${model} is not downloaded — the Models card has it`)
  return f
}

export async function renderKrea2(a: Krea2RenderArgs): Promise<Krea2RenderOut> {
  if (!essentialsInstalled()) throw new Error('Krea 2 essentials are missing — download them in the Models card')
  if (!krea2EditInstalled()) throw new Error('the Krea 2 refs nodes are not in the engine yet — press update on the engine row in the Models card')
  const unetName = await resolveUnet(a.model)
  a.onProgress?.('starting the local engine — a cold start loads the model and can take a minute…')
  const w = await ltxLocal.ensureLtxWorker((line) => console.log(`[krea2-engine] ${line}`))
  // the LTX path holds the worker's busy flag for its own render; a Krea job queued behind it
  // WAITS with the reason on screen (the bb0689d grammar), never throws
  let waited = 0
  while (w.busy) {
    a.onProgress?.(`waiting for the engine — a video render is using it… ${waited}s`)
    await new Promise((r) => setTimeout(r, 2000))
    waited += 2
    if (w.ps.exitCode !== null) throw new Error('the local engine died while waiting — try again')
  }
  w.busy = true
  const base = `http://127.0.0.1:${w.port}`
  activeJob = { jobId: a.jobId, base, promptId: null }
  try {
    const { outDir: comfyOut, inDir } = ltxLocal.ltxWorkerScratch()
    let refs: Krea2GraphParams['refs']
    if (a.refs) {
      if (!existsSync(a.refs.a)) throw new Error('reference A is missing from disk')
      const stamp = Date.now()
      const na = `k2refA_${stamp}${extname(a.refs.a)}`
      await copyFile(a.refs.a, join(inDir, na))
      let nb: string | undefined
      if (a.refs.b) {
        if (!existsSync(a.refs.b)) throw new Error('reference B is missing from disk')
        nb = `k2refB_${stamp}${extname(a.refs.b)}`
        await copyFile(a.refs.b, join(inDir, nb))
      }
      refs = { a: na, b: nb, boost: a.refs.boost, boostB: a.refs.boostB }
    }
    const { w: gw, h: gh } = sizeFor(a.aspect, a.megapixels)
    const seed = a.seed && a.seed > 0 ? a.seed : Math.floor(Math.random() * 0xffffffff)
    const graph = buildGraph({ unetName, prompt: a.prompt, w: gw, h: gh, batch: Math.max(1, Math.min(4, a.batch)), seed, loras: a.loras, unleashed: a.unleashed, refs, identityLora: IDENTITY_LORA })
    const res = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }) })
    const j = (await res.json()) as { prompt_id?: string; error?: unknown; node_errors?: unknown }
    if (!res.ok || j.error || !j.prompt_id) throw new Error(`the engine rejected the graph: ${JSON.stringify(j.node_errors ?? j.error ?? j).slice(0, 500)}`)
    activeJob.promptId = j.prompt_id
    const t0 = Date.now()
    a.onProgress?.(`rendering ${gw}×${gh} · ${a.batch} image${a.batch > 1 ? 's' : ''}…`)
    const stepProgress = async (): Promise<{ msg: string; pct?: number }> => {
      const elapsed = Math.round((Date.now() - t0) / 1000)
      try {
        const raw = (await (await fetch(`${base}/internal/logs/raw`, { signal: AbortSignal.timeout(3000) })).json()) as { entries?: { t: string; m: string }[] }
        const since = t0 - 10_000
        let last: RegExpMatchArray | null = null
        for (const en of raw.entries ?? []) {
          if (new Date(en.t).getTime() < since) continue
          const m2 = en.m.match(/(\d+)\/(\d+) \[[^\]]*?([\d.]+)(s\/it|it\/s)\]/)
          if (m2) last = m2
        }
        if (last) {
          const done = Number(last[1])
          const total = Number(last[2])
          if (done >= total) return { msg: `decoding… ${elapsed}s`, pct: 0.95 }
          return { msg: `sampling ${done}/${total} · ${elapsed}s`, pct: 0.1 + (done / total) * 0.85 }
        }
      } catch {
        /* no log line yet */
      }
      return { msg: `loading the model… ${elapsed}s` }
    }
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500))
      if (w.ps.exitCode !== null) throw new Error(`the local engine died mid-render (exit ${w.ps.exitCode}) — usually out of memory or a driver reset; try a smaller size or batch`)
      const h = (await (await fetch(`${base}/history/${j.prompt_id}`, { signal: AbortSignal.timeout(10_000) })).json()) as Record<
        string,
        { status?: { status_str?: string; completed?: boolean; messages?: [string, { node_type?: string; exception_message?: string }][] }; outputs?: Record<string, { images?: { filename: string; subfolder?: string }[] }>; prompt?: unknown[] }
      >
      const entry = h[j.prompt_id]
      if (!entry) {
        const p = await stepProgress()
        a.onProgress?.(p.msg, p.pct)
        continue
      }
      if (entry.status?.status_str === 'error') {
        const msgs = (entry.status.messages ?? []).filter((m) => m[0] === 'execution_error').map((m) => `${m[1]?.node_type}: ${m[1]?.exception_message}`)
        throw new Error(`render failed in the engine — ${msgs.join(' | ').slice(0, 500) || 'no detail reported'}`)
      }
      if (entry.status?.completed) {
        const outs = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])
        if (!outs.length) throw new Error('the engine finished but produced no image — report this')
        const execGraph = entry.prompt?.[2] as Record<string, { inputs?: Record<string, unknown> }> | undefined
        const modelFile = typeof execGraph?.unet?.inputs?.unet_name === 'string' ? (execGraph.unet.inputs.unet_name as string) : undefined
        await mkdir(a.outDir, { recursive: true })
        const files: string[] = []
        for (const [i, out] of outs.entries()) {
          const src = join(comfyOut, out.subfolder ?? '', out.filename)
          const dest = join(a.outDir, `gen_${seed}_${Date.now()}_${i + 1}.png`)
          await copyFile(src, dest)
          await rm(src, { force: true }).catch(() => undefined)
          files.push(dest)
        }
        a.onProgress?.(`done in ${Math.round((Date.now() - t0) / 1000)}s`)
        return { files, seed, width: gw, height: gh, modelFile: modelFile ? basename(modelFile) : undefined }
      }
      const p = await stepProgress()
      a.onProgress?.(p.msg, p.pct)
    }
  } finally {
    w.busy = false
    w.lastUsed = Date.now()
    activeJob = null
    // the worker's in/ dir is scratch — refs are copied fresh every render
    void ltxLocal.ltxWorkerScratch()
  }
}

export async function cancelKrea2(jobId?: string): Promise<boolean> {
  if (!activeJob || (jobId && activeJob.jobId !== jobId)) return false
  try {
    await fetch(`${activeJob.base}/interrupt`, { method: 'POST' })
    return true
  } catch {
    return false
  }
}

export const unleashedStem = UNLEASHED_STEM

// a civit checkpoint's sidecar lands beside the file at download time
export async function writeCivitSidecar(versionId: number, side: CivitCheckpointSidecar): Promise<void> {
  const dir = join(civitCheckpointsDir(), String(versionId))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'civit.json'), JSON.stringify(side, null, 2))
}
