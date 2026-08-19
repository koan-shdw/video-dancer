// LOCAL MODELS (LOCAL-MODELS-PLAN phase 2) — the shared streaming downloader + folder layout.
// The Models card is the ONLY download surface; everything here serves it:
//   userData/models/<category>/...   fx files sit flat in models/fx/ (matte+depth ONNX);
//                                    every other model gets models/<category>/<id>/.
// Disk is the truth: status = registry entry × files on disk, no database. Downloads stream
// to .part then rename, with a completeness check BEFORE the rename (a truncated model cached
// forever was the original fx.ts bug class — the discipline carries over).
import { app, WebContents } from 'electron'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { LOCAL_MODELS, localModelFor, type LocalModelDef } from '../shared/localModels'

export const modelsRoot = (): string => join(app.getPath('userData'), 'models')

// fx files live flat in models/fx/ (plan: "existing matte+depth ONNX migrate here");
// everything else gets its own folder under its category
const dirOf = (m: LocalModelDef): string => (m.category === 'fx' ? join(modelsRoot(), 'fx') : join(modelsRoot(), m.category, m.id))
export const fileTargets = (m: LocalModelDef): { file: string; dest: string }[] => (m.files ?? []).map((f) => ({ file: f.file, dest: join(dirOf(m), f.file) }))

// ---- one-time migration: pre-phase-2 fx ONNX lived FLAT in userData/models/ ----
// Files move on first touch; the retired mobilenet weights are cleaned (plan: old flat paths
// cleaned). Never throws — a locked file just stays put and the legacy path keeps resolving.
let migrated = false
export async function migrateLayout(): Promise<void> {
  if (migrated) return
  migrated = true
  const root = modelsRoot()
  const fxDir = join(root, 'fx')
  try {
    await mkdir(fxDir, { recursive: true })
    for (const m of LOCAL_MODELS.filter((x) => x.category === 'fx')) {
      for (const f of m.files ?? []) {
        const flat = join(root, f.file)
        const dest = join(fxDir, f.file)
        if (existsSync(flat) && !existsSync(dest)) await rename(flat, dest).catch(() => undefined)
      }
    }
    await rm(join(root, 'rvm_mobilenetv3_fp32.onnx'), { force: true }).catch(() => undefined)
  } catch (e) {
    console.error('[models] layout migration skipped:', e instanceof Error ? e.message : e)
  }
}

// primary on-disk path for a model's first file — legacy flat path honored until migration ran
export function primaryPath(id: string): string | null {
  const m = localModelFor(id)
  if (!m?.files?.length) return null
  const dest = join(dirOf(m), m.files[0].file)
  if (existsSync(dest)) return dest
  const flat = join(modelsRoot(), m.files[0].file) // pre-migration location
  return m.category === 'fx' && existsSync(flat) ? flat : null
}

// ---- status ----
export interface LocalModelRow {
  id: string
  status: 'ready' | 'downloading' | 'none'
  bytes: number // real size on disk when ready (0 otherwise)
  pct: number // download progress when downloading
}

async function bytesOf(m: LocalModelDef): Promise<number> {
  let sum = 0
  for (const t of fileTargets(m)) {
    if (existsSync(t.dest)) sum += (await stat(t.dest)).size
  }
  return sum
}

export async function list(): Promise<LocalModelRow[]> {
  await migrateLayout()
  const rows: LocalModelRow[] = []
  for (const m of LOCAL_MODELS) {
    const job = jobs.get(m.id)
    const targets = fileTargets(m)
    const ready = targets.length > 0 && targets.every((t) => existsSync(t.dest))
    rows.push({
      id: m.id,
      status: job ? 'downloading' : ready ? 'ready' : 'none',
      bytes: ready ? await bytesOf(m) : 0,
      pct: job?.pct ?? 0
    })
  }
  return rows
}

// ---- the shared streaming downloader ----
interface Job {
  abort: AbortController
  pct: number
  promise: Promise<string>
}
const jobs = new Map<string, Job>()

// progress rides 'models:progress' for the card; fx models ALSO forward on the legacy
// 'fx:modelProgress' channel so the Effects panel's DATA rows keep their percent
function sendProgress(wc: WebContents, m: LocalModelDef, pct: number, got: number, total: number): void {
  if (wc.isDestroyed()) return
  wc.send('models:progress', { id: m.id, pct, got, total })
  if (m.category === 'fx') wc.send('fx:modelProgress', { kind: m.id, pct, got, total })
}

// download every file of a model; resolves to the primary file's path. A second call while
// running returns the SAME promise (one job per model). The card raises on 'models:started'.
export function download(id: string, wc: WebContents): Promise<string> {
  const existing = jobs.get(id)
  if (existing) return existing.promise
  const m = localModelFor(id)
  if (!m) return Promise.reject(new Error(`unknown model: ${id}`))
  const files = m.files
  if (!files?.length) return Promise.reject(new Error(`${m.label} can't install yet — it needs the local runtime (a later build)`))
  const abort = new AbortController()
  const job: Job = { abort, pct: 0, promise: undefined as unknown as Promise<string> }
  job.promise = (async (): Promise<string> => {
    await migrateLayout()
    const targets = fileTargets(m)
    if (targets.every((t) => existsSync(t.dest))) return targets[0].dest
    if (!wc.isDestroyed()) wc.send('models:started', { id })
    await mkdir(dirOf(m), { recursive: true })
    // multi-file aggregate: done bytes of finished files + live bytes of the current one
    let doneBytes = 0
    let grandTotal = 0
    try {
      for (const [i, t] of targets.entries()) {
        if (existsSync(t.dest)) {
          doneBytes += (await stat(t.dest)).size
          continue
        }
        const part = `${t.dest}.part`
        const res = await fetch(files[i].url, { signal: abort.signal })
        if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
        const total = Number(res.headers.get('content-length') ?? 0)
        grandTotal = doneBytes + total // best available truth; refined as files finish
        let got = 0
        let lastPct = -1
        const out = createWriteStream(part)
        const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
        await new Promise<void>((resolve, reject) => {
          abort.signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true })
          body.on('data', (chunk: Buffer) => {
            got += chunk.length
            const pct = grandTotal ? Math.floor(((doneBytes + got) / grandTotal) * 100) : 0
            if (pct !== lastPct) {
              lastPct = pct
              job.pct = pct
              sendProgress(wc, m, pct, doneBytes + got, grandTotal)
            }
          })
          body.on('error', reject)
          out.on('error', reject)
          out.on('finish', resolve)
          body.pipe(out)
        })
        // completeness BEFORE rename — truncated files must never land at dest
        if (total > 0 && got !== total) throw new Error(`download incomplete (${got}/${total} bytes)`)
        await rename(part, t.dest)
        doneBytes += got
      }
      sendProgress(wc, m, 100, doneBytes, doneBytes)
      if (!wc.isDestroyed()) wc.send('models:done', { id, ok: true })
      return targets[0].dest
    } catch (e) {
      for (const t of targets) await rm(`${t.dest}.part`, { force: true }).catch(() => undefined)
      // a user cancel reads as 'canceled' whether it landed mid-fetch (AbortError) or mid-stream
      const msg = abort.signal.aborted ? 'canceled' : e instanceof Error ? e.message : String(e)
      if (!wc.isDestroyed()) wc.send('models:done', { id, ok: false, error: msg })
      throw new Error(msg)
    } finally {
      jobs.delete(id)
    }
  })()
  jobs.set(id, job)
  return job.promise
}

export function cancel(id: string): void {
  jobs.get(id)?.abort.abort()
}

// delete = row flips back to not-downloaded; nothing else breaks (re-downloadable any time).
// A running download is canceled first. fx models remove their files; foldered models remove
// the whole model folder.
export async function deleteModel(id: string): Promise<void> {
  const m = localModelFor(id)
  if (!m) return
  cancel(id)
  await jobs.get(id)?.promise.catch(() => undefined)
  if (m.category === 'fx') {
    for (const t of fileTargets(m)) await rm(t.dest, { force: true })
  } else {
    await rm(dirOf(m), { recursive: true, force: true })
  }
}

// app-quit discipline (the abortAllJobs shape from fx.ts): kill streams, sweep .part files
export async function abortAll(): Promise<void> {
  for (const [id, job] of [...jobs.entries()]) {
    job.abort.abort()
    const m = localModelFor(id)
    if (m) for (const t of fileTargets(m)) await rm(`${t.dest}.part`, { force: true }).catch(() => undefined)
  }
  jobs.clear()
}
