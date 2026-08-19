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

let installing: Promise<void> | null = null
let currentInstallPs: ReturnType<typeof spawn> | null = null
let installCanceled = false
// the card's ✕ mid-install: kill the running uv stage; the stamp never wrote, retry redoes clean
export function cancelAceInstall(): void {
  installCanceled = true
  try {
    currentInstallPs?.kill()
  } catch {
    /* already gone */
  }
}

// ONE uv stage runner with the honest package-count bar (uv: "Resolved N packages" then one
// "Downloaded X" per package) — ACE's sync and MiniMax's pip installs share it
function runUvStaged(args: string[], cwd: string | undefined, wc: WebContents, id: string, extraEnv?: Record<string, string>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ps = spawn(runtime.uvExePath(), args, { cwd, env: { ...aceEnvBase(), ...extraEnv }, windowsHide: true })
    currentInstallPs = ps
    let err = ''
    let totalPkgs = 0
    let donePkgs = 0
    let lastPct = -2
    ps.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      err = (err + text).slice(-1500)
      for (const line of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const res = line.match(/Resolved (\d+) packages/)
        if (res) totalPkgs = Number(res[1])
        if (/^Downloaded /.test(line)) donePkgs++
        if (totalPkgs > 0) {
          const pct = Math.min(95, Math.round((donePkgs / totalPkgs) * 100))
          if (pct !== lastPct && !wc.isDestroyed()) {
            lastPct = pct
            wc.send('models:progress', { id, pct, got: donePkgs, total: totalPkgs })
          }
        } else if (!wc.isDestroyed()) {
          wc.send('models:progress', { id, pct: -1, got: 0, total: 0, note: `env: ${line.slice(0, 80)}` })
        }
      }
    })
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(installCanceled ? 'canceled' : `uv ${args[0]} failed (${c}): ${err.trim().slice(-300)}`))))
  })
}
export function aceStatus(): { status: 'ready' | 'downloading' | 'none' } {
  return { status: installing ? 'downloading' : aceInstalled() ? 'ready' : 'none' }
}
export async function aceBytes(): Promise<number> {
  return (await runtime.dirSize(aceRoot())) + (await runtime.dirSize(aceWeights()))
}
export async function aceWeightsBytes(): Promise<number> {
  return runtime.dirSize(aceWeights())
}

const note = (wc: WebContents, text: string): void => {
  if (!wc.isDestroyed()) wc.send('models:progress', { id: ACE_ID, pct: -1, got: 0, total: 0, note: text })
}

export function installAce(wc: WebContents): Promise<void> {
  if (aceInstalled()) return Promise.resolve()
  if (installing) return installing
  installing = (async (): Promise<void> => {
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
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: ACE_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: ACE_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id: ACE_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      installing = null
      currentInstallPs = null
      installCanceled = false
    }
  })()
  return installing
}

export async function deleteAce(): Promise<void> {
  runtime.killAllWorkers() // the ACE server may hold the repo open
  await rm(aceRoot(), { recursive: true, force: true })
  await rm(aceWeights(), { recursive: true, force: true })
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
export function mmStatus(): { status: 'ready' | 'downloading' | 'none' } {
  return { status: installing ? 'downloading' : mmInstalled() ? 'ready' : 'none' }
}
export async function mmBytes(): Promise<number> {
  return (await runtime.dirSize(mmRoot())) + (await runtime.dirSize(mmWeights()))
}
export async function mmWeightsBytes(): Promise<number> {
  return runtime.dirSize(mmWeights())
}

export function installMinimax(wc: WebContents): Promise<void> {
  if (mmInstalled()) return Promise.resolve()
  if (installing) return installing
  installing = (async (): Promise<void> => {
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
      await runUvStaged(['pip', 'install', '--python', mmPython(), MM_DIFFUSERS, 'transformers', 'accelerate', 'soundfile'], undefined, wc, MM_ID)
      await mkdir(mmWeights(), { recursive: true })
      await writeFile(mmStamp(), JSON.stringify({ id: MM_ID, at: new Date().toISOString() }))
      if (!wc.isDestroyed()) {
        wc.send('models:progress', { id: MM_ID, pct: 100, got: 0, total: 0 })
        wc.send('models:done', { id: MM_ID, ok: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id: MM_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      installing = null
      currentInstallPs = null
      installCanceled = false
    }
  })()
  return installing
}

export async function deleteMinimax(): Promise<void> {
  runtime.killAllWorkers()
  await rm(mmRoot(), { recursive: true, force: true })
  await rm(mmWeights(), { recursive: true, force: true })
}

// our worker: lazy-loads the pipeline on the first /render (stdlib-only startup keeps the
// health check instant), offload tiers straight from the HF card, token-gated like the stub
const MM_PY = `import os, json
from http.server import BaseHTTPRequestHandler, HTTPServer
TOKEN = os.environ.get('VD_TOKEN', '')
PORT = int(os.environ.get('VD_PORT', '0'))
_pipe = None
def load():
    global _pipe
    if _pipe is not None:
        return _pipe
    import torch
    from diffusers import ComponentsManager, ModularPipeline
    vram = torch.cuda.get_device_properties(0).total_memory / (1 << 30) if torch.cuda.is_available() else 0
    if vram >= 24:
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
class H(BaseHTTPRequestHandler):
    def _ok(self): return self.headers.get('x-vd-token', '') == TOKEN
    def do_GET(self):
        code = 200 if (self.path == '/health' and self._ok()) else (401 if self.path == '/health' else 404)
        self.send_response(code); self.end_headers()
        if code == 200: self.wfile.write(b'ok')
    def do_POST(self):
        if not self._ok(): self.send_response(401); self.end_headers(); return
        n = int(self.headers.get('content-length', '0') or 0)
        try:
            data = json.loads(self.rfile.read(n) or b'{}')
            import torch, soundfile as sf
            pipe = load()
            kwargs = dict(prompt=data.get('prompt', ''), lyrics=data.get('lyrics', ''), audio_duration=float(data.get('duration', 60)), output='audios')
            if data.get('seed') is not None:
                kwargs['generator'] = torch.Generator('cuda').manual_seed(int(data['seed']))
            audio = pipe(**kwargs)[0]
            path = os.path.join(data['outDir'], data['outName'])
            arr = audio.T.float().cpu().numpy()
            sf.write(path, arr, pipe.sampling_rate)
            out = json.dumps({'file': path, 'duration': arr.shape[0] / pipe.sampling_rate}).encode()
            self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers()
            self.wfile.write(out)
        except Exception as e:
            import traceback
            msg = json.dumps({'error': str(e), 'trace': traceback.format_exc()[-800:]}).encode()
            self.send_response(500); self.send_header('content-type', 'application/json'); self.end_headers()
            self.wfile.write(msg)
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', PORT), H).serve_forever()
`

export async function renderMinimaxScore(o: { input: Record<string, unknown>; outDir: string; onProgress?: (m: string) => void }): Promise<{ file: string; durationSec?: number; seed?: number }> {
  if (!mmInstalled()) throw new Error("MiniMax Music 3 (local) isn't installed — its Models card row installs it")
  const firstRun = (await mmWeightsBytes()) < 1 << 30
  o.onProgress?.(firstRun ? 'first render downloads + loads the model (~20 GB) — the slow one…' : 'loading MiniMax Music 3…')
  await mkdir(o.outDir, { recursive: true })
  const outName = `score_${Date.now()}_${randomUUID().slice(0, 8)}.wav`
  o.onProgress?.('composing locally…')
  const res = (await runtime.workerCall(MM_ID, MM_PY, '/render', { ...o.input, outDir: o.outDir, outName }, mmEnv())) as { file?: string; duration?: number; error?: string }
  if (!res.file) throw new Error('MiniMax worker returned no file: ' + (res.error ?? JSON.stringify(res)).slice(0, 300))
  o.onProgress?.('done')
  const seed = typeof o.input.seed === 'number' ? (o.input.seed as number) : undefined
  return { file: res.file, durationSec: res.duration, seed }
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
  return runtime.withGpu(async () => {
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
        const q = await fetch(`${base}/query_result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_id_list: [taskId] }) })
        if (!q.ok) throw new Error(`ACE query_result: HTTP ${q.status}`)
        const rows = ((await q.json()) as { data?: AceTaskRow[] }).data ?? []
        const row = rows.find((x) => x.task_id === taskId) ?? rows[0]
        if (!row || row.status === 0) continue
        if (row.status === 2) throw new Error('ACE-Step render failed: ' + (row.result ?? 'no detail').slice(0, 300))
        const items = JSON.parse(row.result ?? '[]') as { file?: string; metas?: { duration?: number }; seed_value?: string }[]
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
