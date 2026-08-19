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
const aceEnv = (): Record<string, string> => ({
  ...(runtime.uvBaseEnv() as Record<string, string>),
  HF_HOME: aceWeights(),
  ACESTEP_LM_BACKEND: 'pt' // vllm is linux-only; pt is the honest Windows backend
})

export function aceInstalled(): boolean {
  return existsSync(aceStamp()) && existsSync(aceRepo())
}

let installing: Promise<void> | null = null
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
        await new Promise<void>((resolve, reject) => {
          const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { windowsHide: true })
          ps.on('error', reject)
          ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`unpack failed (${c})`))))
        })
        await rm(zip, { force: true })
        // the zip wraps everything in ACE-Step-1.5-main/ — that folder IS the repo
        const inner = join(tmp, 'ACE-Step-1.5-main')
        await rename(existsSync(inner) ? inner : tmp, aceRepo())
        await rm(tmp, { recursive: true, force: true })
      }
      // 2) uv sync — their repo is uv-native; torch CUDA makes this the long stage
      note(wc, 'building the environment (uv sync — the torch stage is the long one)…')
      await new Promise<void>((resolve, reject) => {
        const ps = spawn(runtime.uvExePath(), ['sync'], { cwd: aceRepo(), env: aceEnv(), windowsHide: true })
        let err = ''
        ps.stderr?.on('data', (d: Buffer) => {
          err = (err + d.toString()).slice(-1500)
          const line = d.toString().split('\n').map((x) => x.trim()).filter(Boolean).pop()
          if (line) note(wc, `env: ${line.slice(0, 120)}`)
        })
        ps.on('error', reject)
        ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`uv sync failed (${c}): ${err.trim().slice(-300)}`))))
      })
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
    }
  })()
  return installing
}

export async function deleteAce(): Promise<void> {
  runtime.killAllWorkers() // the ACE server may hold the repo open
  await rm(aceRoot(), { recursive: true, force: true })
  await rm(aceWeights(), { recursive: true, force: true })
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
  o.onProgress?.(firstRun ? 'starting ACE-Step — first run downloads its core models (~10 GB)…' : 'starting ACE-Step…')
  const w = await runtime.spawnServer(ACE_ID, {
    exe: runtime.uvExePath(),
    args: ['run', 'acestep-api'],
    cwd: aceRepo(),
    env: aceEnv() as Record<string, string>,
    healthPath: '/health',
    // a cold first start downloads weights before it answers — give it room, narrate the wait
    startTimeoutMs: 45 * 60_000,
    onLine: (l) => o.onProgress?.(`ace: ${l}`)
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
