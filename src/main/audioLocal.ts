// LOCAL AUDIO ENGINES (SCORE-PLAN phase 7 — rebuilt 2026-08-19 on repo-verified facts).
// ACE-Step 1.5 first: install = their uv-native repo checked out under the app runtime +
// `uv sync`; render = their own REST server (`uv run acestep-api`, API.md verified: POST
// /release_task → poll /query_result → GET /v1/audio) run under our worker lifecycle.
// Weights auto-download on the FIRST render (HF_HOME is redirected into the models folder so
// they are visible and deletable on the card) — the render button carries that on its face
// (download-honesty law). MiniMax Music 3 local (single-GPU diffusers pipeline, HF-card
// verified) lands next on the same shape with our own worker script.
import { WebContents } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { randomUUID } from 'crypto'
import * as runtime from './runtime'
import { modelsRoot } from './modelStore'

export const ACE_ID = 'ace-step-1.5'
const ACE_ZIP = 'https://codeload.github.com/ace-step/ACE-Step-1.5/zip/refs/heads/main'

const aceRoot = (): string => runtime.engineDir(ACE_ID)
const aceRepo = (): string => join(aceRoot(), 'repo')
const aceStamp = (): string => join(aceRoot(), 'vd-install.json')
const aceWeights = (): string => join(modelsRoot(), 'audio', ACE_ID)

// every ACE process (uv sync AND the server) runs with the runtime's redirects + weights
// pinned into the models folder — nothing lands in the user's home
const aceEnvBase = (): Record<string, string> => runtime.uvBaseEnv() as Record<string, string>
const aceEnv = (): Record<string, string> => ({
  ...aceEnvBase(),
  HF_HOME: aceWeights(),
  ACESTEP_LM_BACKEND: 'pt' // vllm is linux-only; pt is the honest Windows backend
})

export function aceInstalled(): boolean {
  return existsSync(aceStamp()) && existsSync(aceRepo())
}

// PER-ENGINE install state — NOTHING shared between installers (a shared `installing` flag
// once made ACE's row claim "downloading" while MiniMax installed; user-caught lie 2026-08-19)
interface Install {
  ps: ReturnType<typeof spawn> | null
  canceled: boolean
  promise: Promise<void>
}
const installs = new Map<string, Install>()
export function isInstalling(id: string): boolean {
  return installs.has(id)
}
// the card's ✕ mid-install: kill that engine's running uv stage; no stamp wrote, retry redoes clean
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

// ONE uv stage runner with the honest package-count bar (uv: "Resolved N packages" then one
// "Downloaded X" per package). A big package streams for minutes between ticks, so the
// in-flight "Downloading torch (3.0GiB)" line rides ALONG the bar as its note.
function runUvStaged(args: string[], cwd: string | undefined, wc: WebContents, id: string, extraEnv?: Record<string, string>): Promise<void> {
  const inst = installs.get(id)
  return new Promise<void>((resolve, reject) => {
    const ps = spawn(runtime.uvExePath(), args, { cwd, env: { ...aceEnvBase(), ...extraEnv }, windowsHide: true })
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
export function aceStatus(): { status: 'ready' | 'downloading' | 'none' } {
  return { status: isInstalling(ACE_ID) ? 'downloading' : aceInstalled() ? 'ready' : 'none' }
}
export async function aceBytes(): Promise<number> {
  return (await runtime.dirSizeCached(aceRoot())) + (await runtime.dirSizeCached(aceWeights()))
}
export async function aceWeightsBytes(): Promise<number> {
  return runtime.dirSizeCached(aceWeights())
}
export const aceDirs = (): string[] => [aceRoot(), aceWeights()]

const note = (wc: WebContents, text: string): void => {
  if (!wc.isDestroyed()) wc.send('models:progress', { id: ACE_ID, pct: -1, got: 0, total: 0, note: text })
}

export function installAce(wc: WebContents): Promise<void> {
  if (aceInstalled()) return Promise.resolve()
  const existing = installs.get(ACE_ID)
  if (existing) return existing.promise
  const inst: Install = { ps: null, canceled: false, promise: undefined as unknown as Promise<void> }
  installs.set(ACE_ID, inst)
  inst.promise = (async (): Promise<void> => {
    if (!wc.isDestroyed()) wc.send('models:started', { id: ACE_ID })
    try {
      await runtime.ensureRuntime(wc) // chains the runtime install first — its row animates too
      await mkdir(aceRoot(), { recursive: true })
      if (!existsSync(aceRepo())) {
        // 1) their repo as a zip (codeload sends no content-length — the note carries live MB)
        const zip = join(aceRoot(), 'src.zip')
        const res = await fetch(ACE_ZIP)
        if (!res.ok || !res.body) throw new Error(`ACE-Step code download failed: HTTP ${res.status}`)
        let got = 0
        const out = createWriteStream(`${zip}.part`)
        const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
        await new Promise<void>((resolve, reject) => {
          body.on('data', (c: Buffer) => {
            got += c.length
            if (got % (1 << 20) < c.length) note(wc, `downloading ACE-Step code… ${Math.round(got / (1 << 20))} MB`)
          })
          body.on('error', reject)
          out.on('error', reject)
          out.on('finish', resolve)
          body.pipe(out)
        })
        await rename(`${zip}.part`, zip)
        note(wc, 'unpacking…')
        const tmp = join(aceRoot(), 'src.tmp')
        await rm(tmp, { recursive: true, force: true })
        await runtime.extractZip(zip, tmp) // bsdtar — validates CRCs, corrupt zip self-deletes
        await rm(zip, { force: true })
        // the zip wraps everything in ACE-Step-1.5-main/ — that folder IS the repo
        const inner = join(tmp, 'ACE-Step-1.5-main')
        await rename(existsSync(inner) ? inner : tmp, aceRepo())
        await rm(tmp, { recursive: true, force: true })
      }
      // 2) uv sync — their repo is uv-native; torch CUDA makes this the long stage
      note(wc, 'building the environment (uv sync — the torch stage is the long one)…')
      await runUvStaged(['sync'], aceRepo(), wc, ACE_ID, aceEnv())
      await mkdir(aceWeights(), { recursive: true })
      await writeFile(aceStamp(), JSON.stringify({ id: ACE_ID, at: new Date().toISOString() }))
      runtime.invalidateSizes()
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: ACE_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: ACE_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id: ACE_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      installs.delete(ACE_ID)
    }
  })()
  return inst.promise
}

export async function deleteAce(): Promise<void> {
  runtime.killAllWorkers() // the ACE server may hold the repo open
  await rm(aceRoot(), { recursive: true, force: true })
  await rm(aceWeights(), { recursive: true, force: true })
  runtime.invalidateSizes()
}

// ================= MiniMax Music 3 (local) =================
// HF-card verified 2026-08-19: SINGLE GPU via the diffusers ModularPipeline — full bf16 <24GB,
// auto CPU offload ~22GB, LM leaf-streaming fits 8GB (slower). diffusers must come from their
// PR commit — installed from the commit ZIP url so no git is required on the machine.
// Weights land on the first render via HF_HOME → models/audio/minimax-music-3.
export const MM_ID = 'minimax-music-3'
const MM_DIFFUSERS = 'diffusers @ https://github.com/huggingface/diffusers/archive/dafe3733fcfdbf3c48915fe77be3aef65b5d6a2d.zip'
const MM_TORCH_INDEX = 'https://download.pytorch.org/whl/cu128' // Blackwell-class GPUs need cu128+

const mmRoot = (): string => runtime.engineDir(MM_ID)
const mmStamp = (): string => join(mmRoot(), 'vd-env.json')
const mmPython = (): string => join(mmRoot(), 'Scripts', 'python.exe')
const mmWeights = (): string => join(modelsRoot(), 'audio', MM_ID)
const mmEnv = (): Record<string, string> => ({ ...aceEnvBase(), HF_HOME: mmWeights() })

export function mmInstalled(): boolean {
  return existsSync(mmStamp()) && existsSync(mmPython())
}
let mmWorkerQuant: boolean | null = null // which precision the live worker holds
export function mmStatus(): { status: 'ready' | 'downloading' | 'none' } {
  return { status: isInstalling(MM_ID) ? 'downloading' : mmInstalled() ? 'ready' : 'none' }
}
export async function mmBytes(): Promise<number> {
  return (await runtime.dirSizeCached(mmRoot())) + (await runtime.dirSizeCached(mmWeights()))
}
export async function mmWeightsBytes(): Promise<number> {
  return runtime.dirSizeCached(mmWeights())
}
export const mmDirs = (): string[] => [mmRoot(), mmWeights()]

export function installMinimax(wc: WebContents): Promise<void> {
  if (mmInstalled()) return Promise.resolve()
  const existing = installs.get(MM_ID)
  if (existing) return existing.promise
  const inst: Install = { ps: null, canceled: false, promise: undefined as unknown as Promise<void> }
  installs.set(MM_ID, inst)
  inst.promise = (async (): Promise<void> => {
    if (!wc.isDestroyed()) wc.send('models:started', { id: MM_ID })
    const mmNote = (t: string): void => {
      if (!wc.isDestroyed()) wc.send('models:progress', { id: MM_ID, pct: -1, got: 0, total: 0, note: t })
    }
    try {
      await runtime.ensureRuntime(wc)
      mmNote('creating the environment…')
      await rm(mmRoot(), { recursive: true, force: true })
      await runUvStaged(['venv', mmRoot(), '--python', '3.11'], undefined, wc, MM_ID)
      mmNote('installing torch (the big one)…')
      await runUvStaged(['pip', 'install', '--python', mmPython(), '--index-url', MM_TORCH_INDEX, 'torch'], undefined, wc, MM_ID)
      mmNote('installing the pipeline…')
      await runUvStaged(['pip', 'install', '--python', mmPython(), MM_DIFFUSERS, 'transformers', 'accelerate', 'soundfile', 'bitsandbytes'], undefined, wc, MM_ID)
      await mkdir(mmWeights(), { recursive: true })
      await writeFile(mmStamp(), JSON.stringify({ id: MM_ID, at: new Date().toISOString() }))
      runtime.invalidateSizes()
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: MM_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: MM_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id: MM_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      installs.delete(MM_ID)
    }
  })()
  return inst.promise
}

export async function deleteMinimax(): Promise<void> {
  runtime.killAllWorkers()
  await rm(mmRoot(), { recursive: true, force: true })
  await rm(mmWeights(), { recursive: true, force: true })
  runtime.invalidateSizes()
}

// our worker — SUBMIT-AND-POLL (a single long-held /render died at Node fetch's 5-minute
// header timeout on a 30-minute render; live catch 2026-08-19): POST /render starts a thread
// and answers instantly with a task id, GET /result polls it. Stdlib-only startup keeps the
// health check instant; offload tiers straight from the HF card; token-gated like the stub.
const MM_PY = `${runtime.PY_PARENT_WATCH}
import os, json, threading, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
TOKEN = os.environ.get('VD_TOKEN', '')
PORT = int(os.environ.get('VD_PORT', '0'))
_pipe = None
_lock = threading.Lock()
jobs = {}
QUANT = os.environ.get('VD_MM_QUANT', '0') == '1'
def load():
    global _pipe
    with _lock:
        if _pipe is not None:
            return _pipe
        import torch
        from diffusers import ComponentsManager, ModularPipeline
        vram = torch.cuda.get_device_properties(0).total_memory / (1 << 30) if torch.cuda.is_available() else 0
        if QUANT:
            # the user-picked faster tier: official 4-bit (bitsandbytes) on the 8B LM only —
            # same weights, quantized at load; the manager places components (a bnb model
            # refuses .to(), so the offload path is the correct one for it)
            from transformers import BitsAndBytesConfig
            q = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_quant_type='nf4')
            manager = ComponentsManager()
            manager.enable_auto_cpu_offload(device='cuda')
            pipe = ModularPipeline.from_pretrained('MiniMaxAI/MiniMax-Music3', components_manager=manager)
            pipe.load_components(dtype=torch.bfloat16, quantization_config={'language_model': q})
        elif vram >= 24:
            pipe = ModularPipeline.from_pretrained('MiniMaxAI/MiniMax-Music3')
            pipe.load_components(dtype=torch.bfloat16)
            pipe.to('cuda')
        else:
            manager = ComponentsManager()
            manager.enable_auto_cpu_offload(device='cuda')
            pipe = ModularPipeline.from_pretrained('MiniMaxAI/MiniMax-Music3', components_manager=manager)
            pipe.load_components(dtype=torch.bfloat16)
            if vram < 22:
                from diffusers.hooks import apply_group_offloading
                apply_group_offloading(pipe.language_model, onload_device=torch.device('cuda'), offload_type='leaf_level', use_stream=True)
        _pipe = pipe
        return pipe
def do_render(jid, data):
    try:
        import torch, soundfile as sf
        pipe = load()
        kwargs = dict(prompt=data.get('prompt', ''), lyrics=data.get('lyrics', ''), audio_duration=float(data.get('duration', 60)), output='audios')
        if data.get('seed') is not None:
            kwargs['generator'] = torch.Generator('cuda').manual_seed(int(data['seed']))
        audio = pipe(**kwargs)[0]
        path = os.path.join(data['outDir'], data['outName'])
        # the pipeline may hand back a torch tensor OR a numpy array (live catch 2026-08-19:
        # numpy came back and .float() threw AFTER a finished render) — accept both
        import numpy as np
        arr = audio
        if hasattr(arr, 'cpu'):
            arr = arr.float().cpu().numpy()
        arr = np.asarray(arr, dtype='float32')
        if arr.ndim == 2 and arr.shape[0] <= 8:
            arr = arr.T
        sf.write(path, arr, pipe.sampling_rate)
        jobs[jid] = {'status': 'done', 'file': path, 'duration': (arr.shape[0] if arr.ndim else 0) / pipe.sampling_rate}
    except Exception as e:
        import traceback
        jobs[jid] = {'status': 'error', 'error': str(e), 'trace': traceback.format_exc()[-800:]}
class H(BaseHTTPRequestHandler):
    def _ok(self): return self.headers.get('x-vd-token', '') == TOKEN
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/health':
            code = 200 if self._ok() else 401
            self.send_response(code); self.end_headers()
            if code == 200: self.wfile.write(b'ok')
            return
        if u.path == '/result':
            if not self._ok(): self.send_response(401); self.end_headers(); return
            jid = (parse_qs(u.query).get('id') or [''])[0]
            self._json(200, jobs.get(jid, {'status': 'unknown'}))
            return
        self.send_response(404); self.end_headers()
    def do_POST(self):
        if not self._ok(): self.send_response(401); self.end_headers(); return
        n = int(self.headers.get('content-length', '0') or 0)
        try:
            data = json.loads(self.rfile.read(n) or b'{}')
            jid = uuid.uuid4().hex
            jobs[jid] = {'status': 'running'}
            threading.Thread(target=do_render, args=(jid, data), daemon=True).start()
            self._json(200, {'task': jid})
        except Exception as e:
            self._json(500, {'error': str(e)})
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', PORT), H).serve_forever()
`

export async function renderMinimaxScore(o: { input: Record<string, unknown>; outDir: string; onProgress?: (m: string) => void }): Promise<{ file: string; durationSec?: number; seed?: number }> {
  if (!mmInstalled()) throw new Error("MiniMax Music 3 (local) isn't installed — its Models card row installs it")
  const firstRun = (await mmWeightsBytes()) < 10 * (1 << 30)
  o.onProgress?.(firstRun ? 'first render downloads + loads the model (~20 GB) — the slow one…' : 'loading MiniMax Music 3…')
  await mkdir(o.outDir, { recursive: true })
  const outName = `score_${Date.now()}_${randomUUID().slice(0, 8)}.wav`
  const quant = o.input.quant4bit === true
  return runtime.withGpu(async () => {
    // EVERYTHING that claims the GPU happens INSIDE the lock (audit catch 2026-08-19)
    // a loaded pipeline can't switch precision in place — a mode change reloads the worker
    if (mmWorkerQuant !== null && mmWorkerQuant !== quant) runtime.killEngine(MM_ID)
    mmWorkerQuant = quant
    runtime.evictOtherEngines(MM_ID) // rule 4 first: frees other engines' VRAM before measuring
    if (!runtime.hasLiveWorker(MM_ID)) {
      // VRAM preflight — COLD starts only. A warm worker already OWNS its memory; the preflight
      // once counted the loaded model as "not enough free" and blocked the render that would
      // have reused it (live catch 2026-08-19).
      const freeMB = await runtime.gpuFreeMB()
      const needMB = quant ? 6_000 : 12_000
      if (freeMB !== null && freeMB < needMB) {
        throw new Error(`not enough free GPU memory: ${(freeMB / 1024).toFixed(1)} GB free, ~${needMB / 1024} GB needed — close other GPU-heavy apps and retry`)
      }
      if (quant) {
        // bitsandbytes rode in after some installs — ensure it idempotently (no-op when present)
        o.onProgress?.('preparing 4-bit…')
        await new Promise<void>((resolve, reject) => {
          const ps = spawn(runtime.uvExePath(), ['pip', 'install', '--python', mmPython(), 'bitsandbytes'], { env: mmEnv(), windowsHide: true })
          let err = ''
          ps.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-800)))
          ps.on('error', reject)
          ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`bitsandbytes install failed: ${err.trim().slice(-200)}`))))
        })
      }
    }
    const w = await runtime.ensureScriptWorker(MM_ID, MM_PY, { ...mmEnv(), VD_MM_QUANT: quant ? '1' : '0' })
    w.busy = true
    try {
      const base = `http://127.0.0.1:${w.port}`
      const hdr = { 'content-type': 'application/json', 'x-vd-token': w.token }
      const rel = await fetch(`${base}/render`, { method: 'POST', headers: hdr, body: JSON.stringify({ ...o.input, outDir: o.outDir, outName }) })
      if (!rel.ok) throw new Error(`MiniMax worker: HTTP ${rel.status}`)
      const { task } = (await rel.json()) as { task?: string }
      if (!task) throw new Error('MiniMax worker returned no task id')
      o.onProgress?.('composing locally…')
      let lastBeat = Date.now()
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000))
        // the worker dying mid-render (OOM is the realistic killer) must fail LOUD, not hang
        if (w.ps.exitCode !== null) throw new Error('the MiniMax worker died mid-render — likely out of memory; try a shorter piece')
        const q = await fetch(`${base}/result?id=${task}`, { headers: { 'x-vd-token': w.token } }).catch(() => null)
        if (!q?.ok) continue
        const st = (await q.json()) as { status: string; file?: string; duration?: number; error?: string }
        if (st.status === 'done' && st.file) {
          o.onProgress?.('done')
          const seed = typeof o.input.seed === 'number' ? (o.input.seed as number) : undefined
          return { file: st.file, durationSec: st.duration, seed }
        }
        if (st.status === 'error') throw new Error('MiniMax render failed: ' + (st.error ?? 'no detail'))
        if (Date.now() - lastBeat > 30_000) {
          lastBeat = Date.now()
          o.onProgress?.(firstRun ? 'still composing — the first run also downloads and loads ~20 GB…' : 'still composing…')
        }
      }
    } finally {
      w.busy = false
      w.lastUsed = Date.now()
    }
  })
}

// ---- render: submit → poll → fetch, through their task API ----
interface AceTaskRow {
  task_id: string
  status: number // 0 queued/running · 1 succeeded · 2 failed
  result?: string // JSON STRING of an array; [0].file = "/v1/audio?path=..."
}

export async function renderAceScore(o: { input: Record<string, unknown>; outDir: string; onProgress?: (m: string) => void }): Promise<{ file: string; durationSec?: number; seed?: number }> {
  if (!aceInstalled()) throw new Error("ACE-Step 1.5 isn't installed — its Models card row installs it")
  const firstRun = (await aceWeightsBytes()) < 1 << 30
  return runtime.withGpu(async () => {
    // EVERYTHING that claims the GPU happens INSIDE the lock (audit catch 2026-08-19: evict/
    // preflight/server-start at submit time measured a GPU another queued job still held)
    runtime.evictOtherEngines(ACE_ID)
    if (!runtime.hasLiveWorker(ACE_ID)) {
      // VRAM preflight — COLD starts only (a warm server already owns its memory)
      const aceFree = await runtime.gpuFreeMB()
      if (aceFree !== null && aceFree < 8_000) {
        throw new Error(`not enough free GPU memory: ${(aceFree / 1024).toFixed(1)} GB free, ~8 GB needed — close other GPU-heavy apps and retry`)
      }
    }
    o.onProgress?.(firstRun ? 'starting ACE-Step — first run downloads its models (~15 GB)…' : 'starting ACE-Step…')
    // LM planner ON (quality law) — sized to the GPU per their ladder (≥24GB 4B · ≥12GB 1.7B ·
    // else 0.6B), pt backend (vllm is linux-only)
    const gpu = await runtime.gpuProbe()
    const vramGB = (gpu?.vramMB ?? 0) / 1024
    const lm = vramGB >= 24 ? 'acestep-5Hz-lm-4B' : vramGB >= 12 ? 'acestep-5Hz-lm-1.7B' : 'acestep-5Hz-lm-0.6B'
    const w = await runtime.spawnServer(ACE_ID, {
      exe: runtime.uvExePath(),
      args: ['run', 'acestep-api'],
      cwd: aceRepo(),
      env: { ...(aceEnv() as Record<string, string>), ACESTEP_INIT_LLM: 'true', ACESTEP_LM_MODEL_PATH: lm },
      portEnvVars: ['ACESTEP_API_PORT'], // their server_cli.py's own variable; PORT is ignored
      healthPath: '/health',
      // a cold first start downloads weights before it answers — give it room, narrate the wait
      startTimeoutMs: 45 * 60_000,
      // the queue row is not a log: only REAL progress passes — a percent from their download
      // lines; everything else goes to the main log quietly
      onLine: (l) => {
        const pc = l.includes('%') ? l.match(/(\d{1,3})%/) : null
        if (pc) o.onProgress?.(`downloading models · ${pc[1]}%`)
        else console.log('[ace]', l)
      }
    })
    w.busy = true
    try {
      const base = `http://127.0.0.1:${w.port}`
      o.onProgress?.('composing locally…')
      const rel = await fetch(`${base}/release_task`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o.input) })
      if (!rel.ok) throw new Error(`ACE release_task: HTTP ${rel.status}`)
      const relBody = (await rel.json()) as { data?: { task_id?: string } | string }
      const taskId = typeof relBody.data === 'string' ? relBody.data : relBody.data?.task_id
      if (!taskId) throw new Error('ACE returned no task id: ' + JSON.stringify(relBody).slice(0, 200))
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000))
        // a dead server must fail in English, not as a raw "fetch failed" (same class as the
        // MiniMax poll — patched BOTH the day the audit missed this one)
        const q = await fetch(`${base}/query_result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_id_list: [taskId] }) }).catch(() => null)
        if (!q) {
          if (w.ps.exitCode !== null) throw new Error('the ACE-Step server died mid-render — retry; if it repeats, delete and reinstall its Models card row')
          continue
        }
        if (!q.ok) throw new Error(`ACE query_result: HTTP ${q.status}`)
        const rows = ((await q.json()) as { data?: AceTaskRow[] }).data ?? []
        const row = rows.find((x) => x.task_id === taskId) ?? rows[0]
        if (!row || row.status === 0) continue
        if (row.status === 2) throw new Error('ACE-Step render failed: ' + (row.result ?? 'no detail').slice(0, 300))
        let items: { file?: string; metas?: { duration?: number }; seed_value?: string }[]
        try {
          items = JSON.parse(row.result ?? '[]') as typeof items
        } catch {
          throw new Error('ACE returned an unreadable result: ' + (row.result ?? '').slice(0, 200))
        }
        const fileUrl = items[0]?.file
        if (!fileUrl) throw new Error('ACE result has no audio file: ' + (row.result ?? '').slice(0, 300))
        o.onProgress?.('saving score…')
        await mkdir(o.outDir, { recursive: true })
        const ext = /\.mp3(\?|$)/i.test(fileUrl) ? '.mp3' : /\.flac(\?|$)/i.test(fileUrl) ? '.flac' : '.wav'
        const outPath = join(o.outDir, `score_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`)
        const audio = await fetch(fileUrl.startsWith('http') ? fileUrl : `${base}${fileUrl}`)
        if (!audio.ok || !audio.body) throw new Error(`ACE audio fetch: HTTP ${audio.status}`)
        await new Promise<void>((resolve, reject) => {
          const outStream = createWriteStream(outPath)
          const body = Readable.fromWeb(audio.body as unknown as import('stream/web').ReadableStream)
          body.on('error', reject)
          outStream.on('error', reject)
          outStream.on('finish', resolve)
          body.pipe(outStream)
        })
        const seedStr = items[0]?.seed_value?.split(',')[0]
        const seed = seedStr && /^\d+$/.test(seedStr) ? Number(seedStr) : undefined
        o.onProgress?.('done')
        return { file: outPath, durationSec: items[0]?.metas?.duration, seed }
      }
    } finally {
      w.busy = false
      w.lastUsed = Date.now()
    }
  })
}
