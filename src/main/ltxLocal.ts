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
import { existsSync } from 'fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { assertNotStopped } from './jobNotifications'
import { extname, join } from 'path'
import * as runtime from './runtime'
import { lastErrors, modelsRoot, dropPrev } from './modelStore'
import { localModelFor } from '@koan/vidancer-ui/shared/localModels'
import { civitCheckpointsDir, getExtraLoraDirs, krea2Dir } from './imagePaths'

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
// Krea 2 identity-edit nodes (KREA2-LOCAL-SPEC §3.3): lbouaraba/comfyui-krea2edit v1.2.2 —
// the exact commit on his machine 2026-09-08. Constants live here (krea2Local imports this file).
export const KREA2EDIT_SHA = '223a9383eabf991cb2120663162441383da50f27'
export const KREA2EDIT_ZIP = `https://codeload.github.com/lbouaraba/comfyui-krea2edit/zip/${KREA2EDIT_SHA}`
export const KREA2EDIT_INNER = `comfyui-krea2edit-${KREA2EDIT_SHA}`
export const KREA2EDIT_DIR = 'comfyui-krea2edit'
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
// MiniMax H3 shares the engine (MINIMAX-H3-LOCAL-SPEC §2): its registry rows' folder, wired into
// every model path below so its tiers, encoders, VAEs, upscaler and lora set resolve by name
export const h3WeightsDir = (): string => join(modelsRoot(), 'video', 'minimax-h3')
export const ltxEnvPython = (): string => envPy()
// a pick's file may live in ANY lora root the engine sees (extra_model_paths below): the shelf,
// a family weights folder, the Krea essentials, his picked folders — one truth for LTX and H3
export const loraRoots = (): string[] => [lorasDir(), ltxWeightsDir(), krea2Dir(), h3WeightsDir(), ...getExtraLoraDirs()]
export const loraOnDisk = (name: string): boolean => loraRoots().some((r) => existsSync(join(r, name)))

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
// installers that ride this engine's env from another module (h3Local's speed kernels) register
// here so cancel / isInstalling / the uv progress parser see them like the engine's own stages
export function beginInstall(id: string): boolean {
  if (installs.has(id)) return false
  installs.set(id, { ps: null, canceled: false, promise: Promise.resolve() })
  return true
}
export function endInstall(id: string): void {
  installs.delete(id)
}
// `uv pip install` into the engine env, progress under `id` (the engine row by default)
export function pipIntoEngine(wc: WebContents, args: string[], id: string = LTX_ENGINE_ID): Promise<void> {
  return runUvStaged(['pip', 'install', '--python', envPy(), ...args], undefined, wc, id)
}

const note = (wc: WebContents, text: string): void => {
  if (!wc.isDestroyed()) wc.send('models:progress', { id: LTX_ENGINE_ID, pct: -1, got: 0, total: 0, note: text })
}

// staged uv progress — the audioLocal parser verbatim (package counts when uv prints them,
// honest stage notes otherwise), bound to THIS engine's install state
function runUvStaged(args: string[], cwd: string | undefined, wc: WebContents, id: string = LTX_ENGINE_ID): Promise<void> {
  const inst = installs.get(id)
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
              wc.send('models:progress', { id, pct, got: donePkgs, total: totalPkgs, ...(inFlight ? { note: inFlight } : {}) })
            }
          } else {
            wc.send('models:progress', { id, pct: -1, got: 0, total: 0, note: `env: ${line.slice(0, 80)}` })
          }
        }
      }
    })
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(inst?.canceled ? 'canceled' : `uv ${args[0]} failed (${c}): ${err.trim().slice(-300)}`))))
  })
}

// streamed zip download with live MB notes (codeload sends no content-length — the ACE shape).
// Writes through runtime.streamBodyToFile — the ordered reader loop; fromWeb+pipe swapped
// chunks under backpressure (bible 12.3, autopsy 2026-08-27)
async function fetchZip(url: string, dest: string, wc: WebContents, what: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${what} download failed: HTTP ${res.status}`)
  let lastMB = -1
  await runtime.streamBodyToFile(res.body as ReadableStream<Uint8Array>, `${dest}.part`, (got) => {
    const mb = Math.round(got / (1 << 20))
    if (mb !== lastMB) {
      lastMB = mb
      note(wc, `downloading ${what}… ${mb} MB`)
    }
  })
  await rename(`${dest}.part`, dest)
}

// a custom-node pack added AFTER the engine shipped (KREA2-LOCAL-SPEC §3.3: krea2edit) rides
// the same fetch + land path; the caller decides the stamp key
export async function landPack(wc: WebContents, url: string, inner: string, target: string, what: string): Promise<void> {
  const zip = join(root(), `${inner}.zip`)
  await fetchZip(url, zip, wc, what)
  note(wc, `unpacking ${what}…`)
  await landZip(zip, inner, target)
}
export const ltxComfyDir = (): string => comfyDir()
export async function stampAdd(patch: Record<string, string>): Promise<void> {
  let cur: Record<string, unknown> = {}
  try {
    cur = JSON.parse(await readFile(stamp(), 'utf8')) as Record<string, unknown>
  } catch {
    /* no stamp yet — the engine is not installed; nothing to add to */
    return
  }
  await writeFile(stamp(), JSON.stringify({ ...cur, ...patch }))
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
      // Krea 2 refs nodes (KREA2-LOCAL-SPEC §3.3) — pinned like MSR, no pip step (no deps)
      const k2Dir = join(comfyDir(), 'custom_nodes', KREA2EDIT_DIR)
      if (!existsSync(k2Dir)) {
        const zip = join(root(), 'krea2edit.zip')
        await fetchZip(KREA2EDIT_ZIP, zip, wc, 'Krea 2 refs nodes')
        note(wc, 'unpacking the Krea 2 refs nodes…')
        await landZip(zip, KREA2EDIT_INNER, k2Dir)
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
      await writeFile(stamp(), JSON.stringify({ id: LTX_ENGINE_ID, comfy: COMFY_TAG, gguf: GGUF_SHA, msr: MSR_SHA, krea2edit: KREA2EDIT_SHA, at: new Date().toISOString() }))
      runtime.invalidateSizes()
      lastErrors.delete(LTX_ENGINE_ID)
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: LTX_ENGINE_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: LTX_ENGINE_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'canceled') lastErrors.delete(LTX_ENGINE_ID)
      else lastErrors.set(LTX_ENGINE_ID, msg)
      console.error(`[ltx] engine install failed: ${msg}`)
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
  const k = krea2Dir().replace(/\\/g, '/')
  const c = civitCheckpointsDir().replace(/\\/g, '/')
  const h = h3WeightsDir().replace(/\\/g, '/')
  // his picked LoRA folders (KREA2-LOCAL-SPEC §5.2) are lora roots too — subfolder names
  // resolve exactly as his own Comfy resolves them ("KREA 2/x/x.safetensors")
  const extra = getExtraLoraDirs().map((d) => d.replace(/\\/g, '/'))
  await writeFile(
    p,
    [
      'vidancer:',
      '  diffusion_models: |',
      `    ${w}`,
      `    ${k}`,
      `    ${c}`,
      `    ${h}`,
      '  text_encoders: |',
      `    ${w}`,
      `    ${k}`,
      `    ${h}`,
      '  vae: |',
      `    ${w}`,
      `    ${k}`,
      `    ${h}`,
      `  model_patches: ${w}`,
      '  latent_upscale_models: |',
      `    ${w}`,
      `    ${h}`,
      // loras paths: the app-wide shelf + the ltx weights folder (MSR lives with its family) +
      // the Krea essentials (identity edit) + the H3 lora set + every picked folder
      '  loras: |',
      `    ${l}`,
      `    ${w}`,
      `    ${k}`,
      `    ${h}`,
      ...extra.map((d) => `    ${d}`),
      ''
    ].join('\n')
  )
  return p
}

// which model a live worker holds + which flags it was spawned with. A different model (an LTX
// size, an H3 tier) on a live worker stacks giant models in host RAM until a weight read fails
// (sprite-dancer field failure 2026-08-27) — restart first, same model stays warm. A different
// flag set (H3's Windows/RAM flags, MINIMAX-H3-LOCAL-SPEC §6) restarts the same way.
let liveLoadKey: string | null = null
let liveArgsKey = ''
export async function ensureLtxWorker(onLine?: (line: string) => void, o: { extraArgs?: string[]; loadKey?: string; onRestart?: () => void } = {}): Promise<runtime.Worker> {
  if (!ltxEngineInstalled()) throw new Error('the LTX engine is not installed — download it in the Models card')
  const argsKey = (o.extraArgs ?? []).join(' ')
  if (!runtime.hasLiveWorker(LTX_ENGINE_ID)) liveLoadKey = null
  else if ((o.loadKey && liveLoadKey && liveLoadKey !== o.loadKey) || argsKey !== liveArgsKey) {
    o.onRestart?.()
    runtime.killEngine(LTX_ENGINE_ID)
    liveLoadKey = null
  }
  const yaml = await writeModelPaths()
  const outDir = join(root(), 'out')
  const inDir = join(root(), 'in')
  // in/ is scratch: every render copies its refs there under a new name and nothing took them out
  // (2.4 GB on his PC, 10-09). A fresh engine starts it empty — no job of the last one can need them
  // (audit 2026-10-09 L18)
  if (!runtime.hasLiveWorker(LTX_ENGINE_ID)) await rm(inDir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(outDir, { recursive: true })
  await mkdir(inDir, { recursive: true })
  const w = await runtime.spawnServer(LTX_ENGINE_ID, {
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
      inDir,
      ...(o.extraArgs ?? [])
    ],
    cwd: comfyDir(),
    healthPath: '/system_stats',
    startTimeoutMs: 180_000, // cold boot imports torch — slower disks need the headroom
    onLine
  })
  if (o.loadKey) liveLoadKey = o.loadKey
  liveArgsKey = argsKey
  return w
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
// DEV (full bf16) recipe — PROVEN on 2.5 in sprite-dancer 2026-08-27 (bible ch. 12 change
// log; adapted from Lightricks' official LTX-2.0 Full workflow — no official 2.5 dev
// workflow exists): CFG 4, LTXVScheduler steps 20 / max_shift 2.05 / base_shift 0.95 /
// stretch / terminal 0.1, sampler euler, real negative prompt (text verbatim below).
// Renders ONLY by explicit pin from the engine dropdown — never via the ladder.
const DEV_STEPS = 20
const DEV_CFG = 4
const DEV_NEG = 'blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles'
// conv VAE, not video-vae-bf16 — the official bf16 decoder ships NaN weights (2026-08-25)
const VVAE = 'ltx-2.5-video-vae-conv-bf16.safetensors'
// Kijai repack, not the official audio VAE — official ships NaN vocoder weights (2026-08-25)
const AVAE = 'kijai-ltx2-audio-vae-bf16.safetensors'
const MSR_LORA = 'LTX-2.5-Licon-MSR-V1.safetensors'

interface LtxVariant {
  row: string // the registry row id ACTUALLY used — recorded on the take (snapshot honesty)
  label: string
  transformer: string
  gguf: boolean
  encoder: string
  dev?: boolean // full bf16 — renders with the DEV recipe (CFG 4 / 20 steps / euler), never via the ladder
  requestedMissing?: boolean // the pinned size wasn't on disk — ladder fallback, said out loud
}
function variantOf(row: string, label: string): LtxVariant | null {
  const m = localModelFor(row)
  const files = m?.files ?? []
  if (!files.length) return null
  const dir = ltxWeightsDir()
  if (!files.every((f) => existsSync(join(dir, f.file)))) return null
  const transformer = files.find((f) => /transformer/.test(f.file))?.file
  const encoder = files.find((f) => /gemma4-12b/.test(f.file))?.file
  if (!transformer || !encoder) return null
  return { row, label, transformer, gguf: transformer.endsWith('.gguf'), encoder }
}
// preferred = the size pick in the engine dropdown (bible 12.9): a pinned installed size
// wins; a pinned MISSING size falls down the ladder with requestedMissing set so the
// queue row says so
export function pickInstalledVariant(preferred?: string): LtxVariant {
  if (preferred === 'ltx-2.5-full') {
    // the dev recipe by explicit pin — proven live 2026-08-27 (the ladder reaches it only as its last rung)
    const v = variantOf('ltx-2.5-full', 'full (dev bf16)')
    if (v) return { ...v, dev: true }
    const ladder = pickInstalledVariant()
    return { ...ladder, requestedMissing: true }
  }
  if (preferred && preferred !== 'auto') {
    const row = RENDER_LADDER.find((v) => v.row === preferred)
    const v = row ? variantOf(row.row, row.label) : null
    if (v) return v
    const ladder = pickInstalledVariant()
    return { ...ladder, requestedMissing: true }
  }
  for (const v of RENDER_LADDER) {
    const got = variantOf(v.row, v.label)
    if (got) return got
  }
  // list 16: the last rung — full (dev bf16) when it is the ONLY size installed. Its recipe was
  // proven in the app on 2026-08-27; the old "unproven (probe pending)" block is gone.
  const full = variantOf('ltx-2.5-full', 'full (dev bf16)')
  if (full) return { ...full, dev: true }
  throw new Error('no LTX size is installed — download one in the Models card')
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
  negative?: string // the USER negative — appended to the baked line (real on dev CFG 4; distilled CFG 1 ignores it)
  w: number
  h: number
  frames: number
  fps: number
  seed: number
  audio: boolean
  imageName?: string // set = i2v
  refNames?: string[] // set = MSR refs (max 4 subjects + 1 background, spec §9.2)
  loras?: { name: string; weight: number }[] // shelf picks, already filtered to files on disk
}
function buildGraph(v: LtxVariant, p: GraphParams): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    unet: v.gguf ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: v.transformer } } : { class_type: 'UNETLoader', inputs: { unet_name: v.transformer, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: v.encoder, type: 'ltxv', device: 'default' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: ['clip', 0] } },
    // dev = the official Full recipe's real negative; distilled = the baked house line;
    // the user negative joins either (wire-honest — CFG 1 makes it inert on distilled)
    neg: { class_type: 'CLIPTextEncode', inputs: { text: [v.dev ? DEV_NEG : NEG, p.negative].filter(Boolean).join(', '), clip: ['clip', 0] } },
    vvae: { class_type: 'VAELoader', inputs: { vae_name: VVAE } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: AVAE } },
    vlat: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: p.w, height: p.h, length: p.frames, batch_size: 1 } },
    alat: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: p.frames, frame_rate: p.fps, batch_size: 1, audio_vae: ['avae', 0] } },
    cond: { class_type: 'LTXVConditioning', inputs: { positive: ['pos', 0], negative: ['neg', 0], frame_rate: p.fps } },
    // dev = true CFG (the official Full recipe); distilled = CFG 1 (guidance is baked in)
    guider: { class_type: 'LTXVDualCFGGuider', inputs: { model: ['unet', 0], positive: ['cond', 0], negative: ['cond', 1], video_cfg: v.dev ? DEV_CFG : 1, audio_cfg: v.dev ? DEV_CFG : 1 } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: v.dev ? 'euler' : 'euler_ancestral' } },
    // dev: the official LTXVScheduler ladder (token-aware shift off the video latent);
    // distilled: the proven fixed 8-sigma ladder
    sigmas: v.dev
      ? { class_type: 'LTXVScheduler', inputs: { steps: DEV_STEPS, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: ['vlat', 0] } }
      : { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } },
    samp: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['cat', 0] } },
    sep: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['samp', 0] } },
    dec: { class_type: 'VAEDecodeTiled', inputs: { samples: ['sep', 0], vae: ['vvae', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    save: { class_type: 'SaveVideo', inputs: { video: ['vid', 0], filename_prefix: `ltx25_s${p.seed}`, format: 'auto', codec: 'auto' } }
  }
  // shelf LoRAs (spec §7, P6 pass 2026-08-30): LoraLoaderModelOnly chained after the unet in
  // pick order; MSR's IC-LoRA (below) patches the END of the chain. Weight clamped to the
  // shelf's own 0-2 dial.
  let modelOut: [string, number] = ['unet', 0]
  for (const [i, l] of (p.loras ?? []).entries()) {
    const key = `slora${i}`
    g[key] = { class_type: 'LoraLoaderModelOnly', inputs: { model: modelOut, lora_name: l.name, strength_model: Math.max(0, Math.min(2, l.weight)) } }
    modelOut = [key, 0]
  }
  g.guider.inputs.model = modelOut
  if (p.imageName) {
    g.img = { class_type: 'LoadImage', inputs: { image: p.imageName } }
    g.pre = { class_type: 'LTXVPreprocess', inputs: { image: ['img', 0], img_compression: 18 } }
    g.inplace = { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['vvae', 0], image: ['pre', 0], latent: ['vlat', 0], strength: 0.7, bypass: false } }
    g.cat = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['inplace', 0], audio_latent: ['alat', 0] } }
  } else if (p.refNames?.length) {
    // MSR refs (spec §9.2, probe P2 wiring): IC-LoRA patches the model, the guide encodes each
    // ref into a trained slot, CropGuides strips guide tokens before decode. Slots are trained
    // into the LoRA: pic1..pic4 + background — five is the hard model ceiling.
    g.lora = { class_type: 'ComfyUILTX25MSRICLoRALoader', inputs: { model: modelOut, lora_name: MSR_LORA, strength_model: 1 } }
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
  negative?: string // the USER negative (real on dev CFG 4; distilled ignores it)
  loras?: { name: string; weight: number }[] // shelf picks (spec §7) — missing files skip out loud
  sizeId?: string // the size pick: a size row id pins the variant; absent/'auto' = best installed
  outDir: string
  onProgress?: (m: string, pct?: number) => void // pct 0-1 = REAL progress off the engine's step counter
}

let activeJob: { jobId?: string; base: string; promptId: string | null } | null = null

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>
// ONE submit / poll loop for every graph the engine runs — LTX here, MiniMax H3 in h3Local.ts
// (MINIMAX-H3-LOCAL-SPEC §6): POST /prompt, /history poll, the sampler's own step line as REAL
// progress (bible 12.5), a dead worker fails LOUD, the engine's executed graph echoes the model
// file it loaded (engine-side confirmation, user call 2026-08-27). The caller owns w.busy.
export async function runGraph(o: { w: runtime.Worker; graph: Graph; jobId?: string; label: string; onProgress?: (m: string, pct?: number) => void }): Promise<{ src: string; engineFile?: string; elapsedMs: number }> {
  const base = `http://127.0.0.1:${o.w.port}`
  const { outDir: comfyOut } = ltxWorkerScratch()
  activeJob = { jobId: o.jobId, base, promptId: null }
  try {
    const res = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: o.graph }) })
    const j = (await res.json()) as { prompt_id?: string; error?: unknown }
    if (!res.ok || j.error || !j.prompt_id) throw new Error(`the engine rejected the render graph: ${JSON.stringify(j.error ?? j).slice(0, 400)}`)
    activeJob.promptId = j.prompt_id
    const t0 = Date.now()
    o.onProgress?.(`rendering ${o.label}…`)
    // real progress (bible 12.5: the bar shows the RENDER, not a clock): the engine's log
    // endpoint carries the sampler's own step line — "5/8 [.. 52.05s/it]" — parsed each tick
    const stepProgress = async (): Promise<{ msg: string; pct?: number; dead?: string }> => {
      const elapsed = Math.round((Date.now() - t0) / 1000)
      try {
        const raw = (await (await fetch(`${base}/internal/logs/raw`, { signal: AbortSignal.timeout(3000) })).json()) as { entries?: { t: string; m: string }[] }
        const since = t0 - 10_000 // log is cumulative — a stale 8/8 from the LAST render must not count
        let last: RegExpMatchArray | null = null
        let lastErr = ''
        let dead: string | undefined
        for (const en of raw.entries ?? []) {
          if (new Date(en.t).getTime() < since) continue
          const m2 = en.m.match(/(\d+)\/(\d+) \[[^\]]*?([\d.]+)s\/it\]/)
          if (m2) last = m2
          const e2 = en.m.match(/Exception during processing !!! (.*)/)
          if (e2) lastErr = e2[1].trim().slice(0, 200)
          // the prompt thread itself died (2026-09-23): the server keeps answering, the queue says
          // "running" forever, history never gets the entry — without this the job hangs for hours
          if (/Exception in thread .*prompt_worker/.test(en.m)) dead = lastErr
        }
        if (dead !== undefined) return { msg: `loading the model… ${elapsed}s`, dead }
        if (last) {
          const done = Number(last[1])
          const totalSteps = Number(last[2])
          const sPerIt = Number(last[3])
          if (done >= totalSteps) return { msg: `decoding frames… ${elapsed}s`, pct: 0.95 }
          return { msg: `sampling step ${done}/${totalSteps} · ${sPerIt.toFixed(0)}s/step · ${elapsed}s`, pct: 0.05 + (done / totalSteps) * 0.87 }
        }
      } catch {
        /* log endpoint unavailable — the coarse message below still stands */
      }
      return { msg: `loading the model… ${elapsed}s` } // no step line yet = weights still loading
    }
    const tick = async (): Promise<void> => {
      const p = await stepProgress()
      if (p.dead !== undefined) {
        runtime.killEngine(LTX_ENGINE_ID) // the server answers but cannot render — the next job cold-starts a healthy one
        throw new Error(`the engine's render thread died${p.dead ? ` — ${p.dead}` : ''}; it restarts on the next render`)
      }
      o.onProgress?.(p.msg, p.pct)
    }
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000))
      // a dead worker must FAIL the job, not hang it: a GPU driver reset (nvlddmkm) killed
      // the python silently and a fetch on the half-dead socket hung forever (bible 12.5)
      if (o.w.ps.exitCode !== null)
        throw new Error(`the local engine died mid-render (exit ${o.w.ps.exitCode}) — usually a GPU driver reset or out-of-memory; try again, or a smaller size if it repeats`)
      const h = (await (await fetch(`${base}/history/${j.prompt_id}`, { signal: AbortSignal.timeout(10_000) })).json()) as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: [string, { node_type?: string; exception_message?: string }][] }; outputs?: Record<string, { images?: { filename: string; subfolder: string }[]; video?: { filename: string; subfolder: string }[] }> }>
      const entry = h[j.prompt_id]
      if (!entry) {
        await tick()
        continue
      }
      if (entry.status?.status_str === 'error') {
        const msgs = (entry.status.messages ?? []).filter((m) => m[0] === 'execution_error').map((m) => `${m[1]?.node_type}: ${m[1]?.exception_message}`)
        throw new Error(`render failed in the engine — ${msgs.join(' | ').slice(0, 400) || 'no detail reported'}`)
      }
      if (entry.status?.completed) {
        const out = Object.values(entry.outputs ?? {}).flatMap((x) => [...(x.video ?? []), ...(x.images ?? [])])[0]
        if (!out) throw new Error('the engine finished but produced no file — report this')
        // the history entry echoes the EXECUTED graph — the model file the engine loaded is
        // read from there (key `unet`), never from our request
        const execGraph = (entry as { prompt?: unknown[] }).prompt?.[2] as Record<string, { inputs?: Record<string, unknown> }> | undefined
        const engineFile = typeof execGraph?.unet?.inputs?.unet_name === 'string' ? (execGraph.unet.inputs.unet_name as string) : undefined
        return { src: join(comfyOut, out.subfolder ?? '', out.filename), engineFile, elapsedMs: Date.now() - t0 }
      }
      await tick()
    }
  } finally {
    activeJob = null
  }
}

export async function renderLtxClip(a: LtxRenderArgs): Promise<{ file: string; durationSec: number; seed: number; sizeId: string; engineFile?: string }> {
  const variant = pickInstalledVariant(a.sizeId)
  if (variant.requestedMissing) a.onProgress?.(`the pinned size is not installed — rendering with ${variant.label} instead`)
  a.onProgress?.('starting the LTX engine — a cold start loads the model and can take minutes…')
  // engine output reaches main.log — a dead-silent engine crash (GPU driver reset killed the
  // worker mid-render, sprite-dancer field 2026-08-27) left NOTHING to diagnose from
  const w = await ensureLtxWorker((line) => console.log(`[ltx-engine] ${line}`), { loadKey: `ltx:${variant.row}`, onRestart: () => a.onProgress?.(`switching model — restarting the engine for ${variant.label}…`) })
  assertNotStopped() // ✕ during the engine's cold start: the graph is never queued (audit 2026-10-09 M18)
  if (w.busy) throw new Error('the LTX engine is already rendering — one local render at a time')
  w.busy = true
  try {
    const { inDir } = ltxWorkerScratch()
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
    // shelf LoRAs: a pick whose file left the disk skips OUT LOUD, never silently (stable-board law)
    const loras = (a.loras ?? []).filter((l) => {
      const ok = loraOnDisk(l.name)
      if (!ok) a.onProgress?.(`lora ${l.name} is not installed — rendering without it`)
      return ok
    })
    const graph = buildGraph(variant, { prompt: a.prompt, negative: a.negative, w: gw, h: gh, frames, fps, seed, audio: a.generateAudio, imageName, refNames, loras })
    const out = await runGraph({ w, graph, jobId: a.jobId, label: `${gw}x${gh} · ${secs}s · ${variant.label}`, onProgress: a.onProgress })
    await mkdir(a.outDir, { recursive: true })
    const dest = join(a.outDir, `ltx25_${seed}_${Date.now()}${extname(out.src) || '.mp4'}`)
    await copyFile(out.src, dest)
    await rm(out.src, { force: true }).catch(() => undefined)
    a.onProgress?.(`done in ${Math.round(out.elapsedMs / 1000)}s`)
    void dropPrev('ltx-2.5-') // a render landed: files an update replaced (kept as .prev) are no longer needed
    return { file: dest, durationSec: secs, seed, sizeId: variant.row, engineFile: out.engineFile }
  } finally {
    w.busy = false
    w.lastUsed = Date.now()
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
