// LOCAL LTX ENGINE (docs/LTX-SPEC.md §2, phase 1) — a headless ComfyUI owned by the app runtime.
// No UI, no manager, no user-visible Comfy: install = PINNED ComfyUI checkout + PINNED
// ComfyUI-GGUF custom node + torch cu128 into a uv venv (the MiniMax venv+pip shape from
// audioLocal.ts); worker = ComfyUI's own localhost server under the standard engine-shipped-
// server lifecycle (runtime.spawnServer — the ACE shape: no token, localhost binding is the
// trust boundary). Model files live in OUR models tree via extra_model_paths.yaml — visible
// and deletable on the Models card, nothing lands in the user's home. Graph submission
// (renders) arrives at spec phase 3; this module owns install / serve / delete only.
import { WebContents } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import * as runtime from './runtime'
import { modelsRoot } from './modelStore'

export const LTX_ENGINE_ID = 'ltx-comfy-engine'

// THE PINS (spec §2.3 — versions move only through app updates we test; P1 re-validates):
//   ComfyUI v0.33.3 (Comfy-Org/ComfyUI, tag read live 2026-08-21) — post-dates LTX 2.5 day-one
//   support (2026-08-11). ComfyUI-GGUF main@6ea2651 (city96, head read live 2026-08-21).
//   torch from the cu128 index — the app's proven wheel source (audioLocal MM_TORCH_INDEX,
//   Blackwell-class GPUs need cu128+; older RTX generations run the same wheels).
const COMFY_TAG = 'v0.33.3'
const COMFY_ZIP = `https://codeload.github.com/Comfy-Org/ComfyUI/zip/refs/tags/${COMFY_TAG}`
const COMFY_INNER = `ComfyUI-${COMFY_TAG.slice(1)}` // tag zips unwrap without the 'v'
const GGUF_SHA = '6ea2651e7df66d7585f6ffee804b20e92fb38b8a'
const GGUF_ZIP = `https://codeload.github.com/city96/ComfyUI-GGUF/zip/${GGUF_SHA}`
const GGUF_INNER = `ComfyUI-GGUF-${GGUF_SHA}`
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'

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
      note(wc, 'creating the environment…')
      await rm(envRoot(), { recursive: true, force: true })
      await runUvStaged(['venv', envRoot(), '--python', '3.11'], undefined, wc)
      // torch trio from the CUDA index FIRST — satisfying the requirements resolver up front
      // so it never swaps in CPU wheels
      note(wc, 'installing torch (the big one)…')
      await runUvStaged(['pip', 'install', '--python', envPy(), '--index-url', TORCH_INDEX, 'torch', 'torchvision', 'torchaudio'], undefined, wc)
      note(wc, 'installing ComfyUI…')
      await runUvStaged(['pip', 'install', '--python', envPy(), '-r', join(comfyDir(), 'requirements.txt')], undefined, wc)
      note(wc, 'installing the GGUF loader…')
      await runUvStaged(['pip', 'install', '--python', envPy(), '-r', join(ggufDir, 'requirements.txt')], undefined, wc)
      await mkdir(ltxWeightsDir(), { recursive: true })
      await mkdir(lorasDir(), { recursive: true })
      await writeFile(stamp(), JSON.stringify({ id: LTX_ENGINE_ID, comfy: COMFY_TAG, gguf: GGUF_SHA, at: new Date().toISOString() }))
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
      `  loras: ${l}`,
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
