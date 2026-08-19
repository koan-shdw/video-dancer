// LOCAL RUNTIME (LOCAL-MODELS-PLAN phase 3) — the private, app-managed Python nobody sees.
//   userData/runtime/uv/uv.exe        the manager binary (astral-sh/uv, single static exe)
//   userData/runtime/python/          pinned managed Python (UV_PYTHON_INSTALL_DIR)
//   userData/runtime/cache/           uv's cache (UV_CACHE_DIR — nothing global is touched)
//   userData/runtime/envs/<engine>/   one clean venv per local engine
//   userData/runtime/workers/         worker scripts written at spawn time
// Workers are child processes serving localhost HTTP with a per-session token (the codirMcp
// trust shape): spawned on demand, ONE render at a time (VRAM is exclusive), idle-killed,
// hard-killed on app quit. The runtime itself is a ROW on the Models card — visible, sized,
// deletable; a deleted runtime just re-installs on the next local render.
import { app, WebContents } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename, rm, stat, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { createServer } from 'net'
import { randomUUID } from 'crypto'

const PYTHON_PIN = '3.11'
const UV_ZIP_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
export const RUNTIME_ID = 'python-runtime' // the registry/card row id

export const runtimeDir = (): string => join(app.getPath('userData'), 'runtime')
const uvExe = (): string => join(runtimeDir(), 'uv', 'uv.exe')
const readyStamp = (): string => join(runtimeDir(), 'ready.json')
const envDir = (engine: string): string => join(runtimeDir(), 'envs', engine)
const envPython = (engine: string): string => join(envDir(engine), 'Scripts', 'python.exe')

const uvEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  UV_PYTHON_INSTALL_DIR: join(runtimeDir(), 'python'),
  UV_CACHE_DIR: join(runtimeDir(), 'cache'),
  UV_NO_MODIFY_PATH: '1'
})

function runUv(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(uvExe(), args, { env: uvEnv(), windowsHide: true })
    let err = ''
    ps.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-1500)))
    ps.on('error', (e) => reject(new Error(`uv would not start (${e.message}) — its binary may be damaged`)))
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`uv ${args[0]} failed (${c}): ${err.trim().slice(-300)}`))))
  })
}

// a truncated/damaged uv.exe (an interrupted unpack once shipped a 2MB corpse of the 51MB
// binary — live catch 2026-08-19) must never be trusted forever: prove it RUNS or wipe it
async function uvHealthy(): Promise<boolean> {
  if (!existsSync(uvExe())) return false
  return runUv(['--version']).then(
    () => true,
    () => false
  )
}

export function isReady(): boolean {
  return existsSync(uvExe()) && existsSync(readyStamp())
}

let installing: Promise<void> | null = null
export function isInstalling(): boolean {
  return installing !== null
}

// progress rides the card's channel under the runtime row's id. Real bytes for the uv zip
// (the measurable part); the uv-driven python install reports stage NOTES with pct -1 —
// honest-progress law: no fake fill, the card shows the stage text instead of a bar.
function send(wc: WebContents, pct: number, got: number, total: number, note?: string): void {
  if (!wc.isDestroyed()) wc.send('models:progress', { id: RUNTIME_ID, pct, got, total, ...(note ? { note } : {}) })
}

export function ensureRuntime(wc: WebContents): Promise<void> {
  if (isReady()) return Promise.resolve()
  if (installing) return installing
  installing = (async (): Promise<void> => {
    if (!wc.isDestroyed()) wc.send('models:started', { id: RUNTIME_ID })
    try {
      await mkdir(runtimeDir(), { recursive: true })
      // self-heal: an existing uv that can't run is wiped and re-downloaded (resume-by-redo)
      if (existsSync(uvExe()) && !(await uvHealthy())) await rm(join(runtimeDir(), 'uv'), { recursive: true, force: true })
      if (!existsSync(uvExe())) {
        // 1) the uv binary — streamed zip with real progress, then a shell unpack
        const zip = join(runtimeDir(), 'uv.zip')
        const res = await fetch(UV_ZIP_URL)
        if (!res.ok || !res.body) throw new Error(`uv download failed: HTTP ${res.status}`)
        const total = Number(res.headers.get('content-length') ?? 0)
        let got = 0
        let lastPct = -2
        const out = createWriteStream(`${zip}.part`)
        const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
        await new Promise<void>((resolve, reject) => {
          body.on('data', (chunk: Buffer) => {
            got += chunk.length
            const pct = total ? Math.floor((got / total) * 70) : 0 // zip = the measurable 0-70
            if (pct !== lastPct) {
              lastPct = pct
              send(wc, pct, got, total)
            }
          })
          body.on('error', reject)
          out.on('error', reject)
          out.on('finish', resolve)
          body.pipe(out)
        })
        if (total > 0 && got !== total) throw new Error(`uv download incomplete (${got}/${total})`)
        await rename(`${zip}.part`, zip)
        send(wc, -1, 0, 0, 'unpacking uv…')
        // unpack to a TEMP dir, prove the binary runs, THEN rename into place — the .part
        // discipline for folders: an interrupted unpack must never leave a trusted half-file
        const tmp = join(runtimeDir(), 'uv.tmp')
        await rm(tmp, { recursive: true, force: true })
        await new Promise<void>((resolve, reject) => {
          const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { windowsHide: true })
          ps.on('error', reject)
          ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`uv unpack failed (${c})`))))
        })
        await rm(zip, { force: true })
        if (!existsSync(join(tmp, 'uv.exe'))) throw new Error('uv unpacked but uv.exe is missing')
        await rename(tmp, join(runtimeDir(), 'uv'))
        if (!(await uvHealthy())) {
          await rm(join(runtimeDir(), 'uv'), { recursive: true, force: true })
          throw new Error('unpacked uv would not run — retry re-downloads it')
        }
      }
      // 2) the pinned managed Python — uv owns download + layout, nothing global touched
      send(wc, -1, 0, 0, `installing python ${PYTHON_PIN}…`)
      // --no-bin/--no-registry: no shim in ~/.local/bin, no PEP-514 registry entry — the
      // "touches nothing on your system" promise, verified 2026-08-19 (default DOES both)
      await runUv(['python', 'install', PYTHON_PIN, '--no-bin', '--no-registry'])
      await writeFile(readyStamp(), JSON.stringify({ python: PYTHON_PIN, at: new Date().toISOString() }))
      send(wc, 100, 0, 0)
      if (!wc.isDestroyed()) wc.send('models:done', { id: RUNTIME_ID, ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id: RUNTIME_ID, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      installing = null
    }
  })()
  return installing
}

// one clean venv per engine; packages pinned by each engine's plan phase. Stamped so a
// half-provisioned env (crash mid-pip) re-provisions instead of half-working.
export async function ensureEnv(engine: string, packages: string[], wc?: WebContents): Promise<string> {
  const dir = envDir(engine)
  const stamp = join(dir, 'vd-env.json')
  if (existsSync(stamp) && existsSync(envPython(engine))) return envPython(engine)
  if (wc) send(wc, -1, 0, 0, `preparing ${engine} environment…`)
  await rm(dir, { recursive: true, force: true })
  await runUv(['venv', dir, '--python', PYTHON_PIN])
  if (packages.length) await runUv(['pip', 'install', '--python', envPython(engine), ...packages])
  await writeFile(stamp, JSON.stringify({ engine, packages, at: new Date().toISOString() }))
  return envPython(engine)
}

// list provisioned envs (the card's indented rows under the runtime)
export async function listEnvs(): Promise<{ engine: string; bytes: number }[]> {
  const root = join(runtimeDir(), 'envs')
  if (!existsSync(root)) return []
  const out: { engine: string; bytes: number }[] = []
  for (const name of await readdir(root)) {
    if (existsSync(join(root, name, 'vd-env.json'))) out.push({ engine: name, bytes: await dirSize(join(root, name)) })
  }
  return out
}

export async function dirSize(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  let sum = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sum += await dirSize(p)
    else sum += (await stat(p).catch(() => ({ size: 0 }))).size
  }
  return sum
}

// ---- workers: localhost HTTP + per-session token, one per engine, idle-killed ----
interface Worker {
  engine: string
  port: number
  token: string
  ps: ReturnType<typeof spawn>
  lastUsed: number
  busy: boolean
}
const workers = new Map<string, Worker>()
const IDLE_KILL_MS = 120_000

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))))
    })
    srv.on('error', reject)
  })

// the stub worker — proves the whole path (spawn → health → tokened POST → JSON back) with
// nothing but the stdlib. Real engine workers (LTX, ACE-Step…) replace the script, not the shape.
const STUB_PY = `import os, json
from http.server import BaseHTTPRequestHandler, HTTPServer
TOKEN = os.environ.get('VD_TOKEN', '')
PORT = int(os.environ.get('VD_PORT', '0'))
class H(BaseHTTPRequestHandler):
    def _ok(self): return self.headers.get('x-vd-token', '') == TOKEN
    def do_GET(self):
        code = 200 if (self.path == '/health' and self._ok()) else (401 if self.path == '/health' else 404)
        self.send_response(code); self.end_headers()
        if code == 200: self.wfile.write(b'ok')
    def do_POST(self):
        if not self._ok(): self.send_response(401); self.end_headers(); return
        n = int(self.headers.get('content-length', '0') or 0)
        try: data = json.loads(self.rfile.read(n) or b'{}')
        except Exception: data = {}
        out = json.dumps({'pong': data.get('ping'), 'engine': 'stub'}).encode()
        self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers()
        self.wfile.write(out)
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', PORT), H).serve_forever()
`

async function spawnWorker(engine: string, script: string): Promise<Worker> {
  const existing = workers.get(engine)
  if (existing && existing.ps.exitCode === null) {
    existing.lastUsed = Date.now()
    return existing
  }
  workers.delete(engine)
  const py = envPython(engine)
  if (!existsSync(py)) throw new Error(`no ${engine} environment — provision it first`)
  const dir = join(runtimeDir(), 'workers')
  await mkdir(dir, { recursive: true })
  const scriptPath = join(dir, `${engine}.py`)
  await writeFile(scriptPath, script)
  const port = await freePort()
  const token = randomUUID()
  const ps = spawn(py, [scriptPath], { env: { ...process.env, VD_PORT: String(port), VD_TOKEN: token }, windowsHide: true })
  const w: Worker = { engine, port, token, ps, lastUsed: Date.now(), busy: false }
  workers.set(engine, w)
  // health poll — fail fast if the process dies, give a cold spawn 15s
  const t0 = Date.now()
  for (;;) {
    if (ps.exitCode !== null) throw new Error(`${engine} worker exited at startup (${ps.exitCode})`)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { 'x-vd-token': token } })
      if (r.ok) break
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 15_000) {
      killWorker(engine)
      throw new Error(`${engine} worker never answered /health`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return w
}

function killWorker(engine: string): void {
  const w = workers.get(engine)
  workers.delete(engine)
  if (w) {
    try {
      w.ps.kill()
    } catch {
      /* already gone */
    }
  }
}

export function killAllWorkers(): void {
  for (const engine of [...workers.keys()]) killWorker(engine)
}

// idle sweep — a worker holding VRAM while nobody renders is theft
setInterval(() => {
  for (const w of [...workers.values()]) {
    if (!w.busy && Date.now() - w.lastUsed > IDLE_KILL_MS) killWorker(w.engine)
  }
}, 30_000).unref()

// ONE local job at a time app-wide (VRAM is exclusive) — the queue serializes behind this
let gpuLock: Promise<unknown> = Promise.resolve()
export function withGpu<T>(fn: () => Promise<T>): Promise<T> {
  const run = gpuLock.then(fn, fn)
  gpuLock = run.catch(() => undefined)
  return run
}

export async function workerCall(engine: string, script: string, path: string, payload: unknown): Promise<unknown> {
  return withGpu(async () => {
    const w = await spawnWorker(engine, script)
    w.busy = true
    try {
      const r = await fetch(`http://127.0.0.1:${w.port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vd-token': w.token },
        body: JSON.stringify(payload ?? {})
      })
      if (!r.ok) throw new Error(`${engine} worker: HTTP ${r.status}`)
      return await r.json()
    } finally {
      w.busy = false
      w.lastUsed = Date.now()
    }
  })
}

// ---- GPU probe (wizard + card): one nvidia-smi spawn, cached; graceful no-NVIDIA path ----
let gpuCache: { name: string; vramMB: number } | null | undefined
export function gpuProbe(): Promise<{ name: string; vramMB: number } | null> {
  if (gpuCache !== undefined) return Promise.resolve(gpuCache)
  return new Promise((resolve) => {
    const ps = spawn('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { windowsHide: true })
    let out = ''
    ps.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    const finish = (): void => {
      const line = out.split('\n')[0]?.trim()
      const m = line?.match(/^(.*),\s*(\d+)\s*MiB/i)
      gpuCache = m ? { name: m[1].trim(), vramMB: Number(m[2]) } : null
      resolve(gpuCache)
    }
    ps.on('error', () => {
      gpuCache = null
      resolve(null)
    })
    ps.on('close', finish)
  })
}

// ---- the phase-3 gate, runnable from the card: full round-trip through a stub worker ----
export async function runtimeTest(wc: WebContents): Promise<{ ok: boolean; detail: string }> {
  try {
    await ensureRuntime(wc)
    await ensureEnv('stub', [], wc)
    const res = (await workerCall('stub', STUB_PY, '/render', { ping: 'vi-dancer' })) as { pong?: string }
    if (res.pong !== 'vi-dancer') return { ok: false, detail: `stub answered wrong: ${JSON.stringify(res)}` }
    // the token must actually gate: an unauthenticated call has to bounce
    const w = workers.get('stub')
    if (w) {
      const bad = await fetch(`http://127.0.0.1:${w.port}/render`, { method: 'POST', body: '{}' }).catch(() => null)
      if (bad && bad.status !== 401) return { ok: false, detail: `token not enforced (HTTP ${bad.status})` }
    }
    killWorker('stub')
    return { ok: true, detail: 'runtime ok — python answered through a tokened worker' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

// runtime row status/size for the card + full removal (workers die first; next render re-installs)
export async function runtimeRow(): Promise<{ status: 'ready' | 'downloading' | 'none'; bytes: number }> {
  if (installing) return { status: 'downloading', bytes: 0 }
  if (!isReady()) return { status: 'none', bytes: 0 }
  return { status: 'ready', bytes: await dirSize(runtimeDir()) }
}

export async function removeRuntime(): Promise<void> {
  killAllWorkers()
  await rm(runtimeDir(), { recursive: true, force: true })
}
