// LOCAL MODELS (LOCAL-MODELS-PLAN phase 2) — the shared streaming downloader + folder layout.
// The Models card is the ONLY download surface; everything here serves it:
//   userData/models/<category>/...   fx files sit flat in models/fx/ (matte+depth ONNX);
//                                    every other model gets models/<category>/<id>/.
// Disk is the truth: status = registry entry × files on disk, no database. Downloads stream
// to .part then rename, with a completeness check BEFORE the rename (a truncated model cached
// forever was the original fx.ts bug class — the discipline carries over).
import { app, WebContents } from 'electron'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, open, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { LOCAL_MODELS, localModelFor, type LocalModelDef } from '../shared/localModels'

export const modelsRoot = (): string => join(app.getPath('userData'), 'models')

// fx files live flat in models/fx/ (plan: "existing matte+depth ONNX migrate here");
// rows with an explicit `folder` share it (LTX sizes — common files download once);
// everything else gets its own folder under its category
const dirOf = (m: LocalModelDef): string => (m.folder ? join(modelsRoot(), ...m.folder.split('/')) : m.category === 'fx' ? join(modelsRoot(), 'fx') : join(modelsRoot(), m.category, m.id))
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
  for (const m of LOCAL_MODELS.filter((x) => x.category !== 'runtime' && x.files?.length)) {
    // runtime + installer-driven rows (ACE) are merged in by the models:list handler; entries
    // with no files yet default to not-downloaded in the card
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

// ---- chunked transfer: HF throttles single connections hard; parallel byte-ranges of the
// SAME file typically run 3-5x faster. Small files (and servers without range support) take
// the plain single-stream path. The .part is preallocated, each chunk streams straight to
// its offset, and every chunk verifies its own byte count — the .part-then-rename discipline
// and the pinned-size check are unchanged.
const CHUNK = 32 * 1024 * 1024
const WIRES = 8 // measured on the HF CDN 2026-08-21: ~1 MB/s per connection, gains near-linear

async function streamRange(url: string, part: string, start: number, end: number, abort: AbortController, bump: (n: number) => void): Promise<void> {
  const want = end - start + 1
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    // one quiet retry per chunk — a transient reset must not sink a 20 GB file
    let written = 0
    let onAbort: (() => void) | undefined
    try {
      const res = await fetch(url, { signal: abort.signal, headers: { Range: `bytes=${start}-${end}` } })
      if (res.status !== 206 || !res.body) throw new Error(`range download failed: HTTP ${res.status}`)
      const out = createWriteStream(part, { flags: 'r+', start })
      const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
      try {
        await new Promise<void>((resolve, reject) => {
          onAbort = (): void => reject(new Error('canceled'))
          abort.signal.addEventListener('abort', onAbort, { once: true })
          body.on('data', (c: Buffer) => {
            written += c.length
            bump(c.length)
          })
          body.on('error', reject)
          out.on('error', reject)
          out.on('finish', resolve)
          body.pipe(out)
        })
      } finally {
        out.destroy()
        body.destroy()
      }
      if (written !== want) throw new Error(`range incomplete (${written}/${want} bytes)`)
      return
    } catch (e) {
      bump(-written) // the aggregate stays honest: a failed attempt un-counts itself
      lastErr = e
      if (abort.signal.aborted) throw e
    } finally {
      if (onAbort) abort.signal.removeEventListener('abort', onAbort)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function downloadRanged(url: string, part: string, total: number, abort: AbortController, bump: (n: number) => void): Promise<void> {
  const fh = await open(part, 'w')
  await fh.truncate(total)
  await fh.close()
  const chunks: { start: number; end: number }[] = []
  for (let s = 0; s < total; s += CHUNK) chunks.push({ start: s, end: Math.min(s + CHUNK, total) - 1 })
  let next = 0
  let failed: Error | null = null
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++
      if (i >= chunks.length) return
      try {
        await streamRange(url, part, chunks[i].start, chunks[i].end, abort, bump)
      } catch (e) {
        failed = failed ?? (e instanceof Error ? e : new Error(String(e)))
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WIRES, chunks.length) }, () => worker()))
  if (failed) throw failed
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
    if (targets.every((t) => existsSync(t.dest))) {
      // already complete (the LTX chain re-checks essentials on every size click): release
      // the job entry HERE — this exit sits before the try/finally, and a job left in the
      // map reads as "downloading 0%" forever in the card
      jobs.delete(id)
      if (!wc.isDestroyed()) wc.send('models:done', { id, ok: true })
      return targets[0].dest
    }
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
        // probe with a REAL 1-byte range request — a 206 is definitive proof ranges work
        // (trusting the accept-ranges header on a HEAD reply is guesswork on CDNs); the
        // content-range denominator carries the true size. A failed probe = plain path.
        let total = 0
        let ranged = false
        try {
          const probe = await fetch(files[i].url, { headers: { Range: 'bytes=0-0' }, signal: abort.signal })
          const denom = probe.headers.get('content-range')?.split('/')[1]
          total = denom ? Number(denom) : Number(probe.headers.get('content-length') ?? 0)
          ranged = probe.status === 206 && Number.isFinite(total) && total > CHUNK
          await probe.arrayBuffer().catch(() => undefined) // drain the 1-byte body
        } catch (e) {
          if (abort.signal.aborted) throw e
        }
        console.log(`[models] ${t.file}: ${ranged ? `chunked x${WIRES}` : 'single stream'}, ${(total / 1e9).toFixed(2)} GB`)
        let got = 0
        let lastPct = -1
        const bump = (n: number): void => {
          got += n
          grandTotal = doneBytes + (total || got) // best available truth; refined as files finish
          const pct = grandTotal ? Math.floor(((doneBytes + got) / grandTotal) * 100) : 0
          if (pct !== lastPct) {
            lastPct = pct
            job.pct = pct
            sendProgress(wc, m, pct, doneBytes + got, grandTotal)
          }
        }
        if (ranged) {
          await downloadRanged(files[i].url, part, total, abort, bump)
        } else {
          const res = await fetch(files[i].url, { signal: abort.signal })
          if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
          if (!total) total = Number(res.headers.get('content-length') ?? 0)
          const out = createWriteStream(part)
          const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
          await new Promise<void>((resolve, reject) => {
            abort.signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true })
            body.on('data', (chunk: Buffer) => bump(chunk.length))
            body.on('error', reject)
            out.on('error', reject)
            out.on('finish', resolve)
            body.pipe(out)
          })
        }
        // completeness BEFORE rename — truncated files must never land at dest
        // (ranged path: every chunk already verified its own byte count)
        if (total > 0 && got !== total) throw new Error(`download incomplete (${got}/${total} bytes)`)
        // pinned-size integrity (LTX mirrors): a file that isn't byte-for-byte the pinned
        // release fails LOUD — a mirror must never silently swap what users run
        const pinned = files[i].bytes
        if (pinned && got !== pinned) throw new Error(`${t.file} is ${got} bytes, expected ${pinned} — the mirror changed; report this`)
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
  if (m.category === 'fx' || m.folder) {
    // flat/shared folders delete PER FILE — a shared home (LTX sizes) must survive siblings.
    // Files also claimed by ANOTHER ready row stay put (the Q5 encoder serves three sizes).
    const keep = new Set(
      LOCAL_MODELS.filter((x) => x.id !== m.id && x.folder === m.folder && (x.files ?? []).every((f) => existsSync(join(dirOf(x), f.file)))).flatMap((x) => (x.files ?? []).map((f) => f.file))
    )
    for (const t of fileTargets(m)) if (!keep.has(t.file)) await rm(t.dest, { force: true })
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
