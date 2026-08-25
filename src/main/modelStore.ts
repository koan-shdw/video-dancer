// LOCAL MODELS (LOCAL-MODELS-PLAN phase 2) — the shared streaming downloader + folder layout.
// The Models card is the ONLY download surface; everything here serves it:
//   userData/models/<category>/...   fx files sit flat in models/fx/ (matte+depth ONNX);
//                                    every other model gets models/<category>/<id>/.
// Disk is the truth: status = registry entry × files on disk, no database. Downloads stream
// to .part then rename, with a completeness check BEFORE the rename (a truncated model cached
// forever was the original fx.ts bug class — the discipline carries over).
import { app, session, WebContents, type DownloadItem } from 'electron'
import { createReadStream, existsSync } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
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

// ---- the shared downloader (LTX-SPEC §2.4: Chromium owns the wire) ----
// downloadURL + will-download; app code only sets the save path, relays progress, and verifies
// pins after completion. Items match callers by origin URL; unmatched downloads are not ours
// and keep Electron's default behavior.
interface PendingDl {
  part: string
  take: (item: DownloadItem) => void
}
const pendingDl = new Map<string, PendingDl>()
let dlHooked = false
function hookWillDownload(): void {
  if (dlHooked) return
  dlHooked = true
  session.defaultSession.on('will-download', (_e, item) => {
    const origin = item.getURLChain()[0] ?? item.getURL()
    const p = pendingDl.get(origin)
    if (!p) return
    pendingDl.delete(origin)
    item.setSavePath(p.part) // must happen inside the handler or Electron prompts a save dialog
    p.take(item)
  })
}

function downloadFile(url: string, part: string, signal: AbortSignal, onBytes: (got: number, total: number) => void): Promise<void> {
  hookWillDownload()
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('canceled'))
    let item: DownloadItem | null = null
    let settled = false
    const succeed = (): void => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    const fail = (e: Error): void => {
      if (!settled) {
        settled = true
        reject(e)
      }
    }
    // start gate only — a mirror that never answers must not hang the job forever. NOT a
    // mid-transfer watchdog (vetoed); once will-download fires, Chromium owns the transfer.
    const startGate = setTimeout(() => {
      if (!item) fail(new Error('download failed to start — mirror unreachable; retry'))
    }, 30_000)
    const onAbort = (): void => {
      if (item) item.cancel()
      else fail(new Error('canceled')) // will-download may still fire; take() cancels it then
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pendingDl.set(url, {
      part,
      take: (it) => {
        clearTimeout(startGate)
        item = it
        if (settled || signal.aborted) {
          it.cancel()
          return
        }
        it.on('updated', (_ev, state) => {
          if (state === 'interrupted') {
            it.cancel() // fail loud; no auto-resume (user veto)
            fail(new Error('download interrupted — retry'))
            return
          }
          onBytes(it.getReceivedBytes(), it.getTotalBytes())
        })
        it.once('done', (_ev, state) => {
          signal.removeEventListener('abort', onAbort)
          if (state === 'completed') succeed()
          else fail(new Error(signal.aborted || state === 'cancelled' ? 'canceled' : `download failed (${state})`))
        })
      }
    })
    session.defaultSession.downloadURL(url)
  })
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path)
    rs.on('data', (c) => hash.update(c))
    rs.on('error', reject)
    rs.on('end', resolve)
  })
  return hash.digest('hex')
}

interface Job {
  abort: AbortController
  pct: number
  promise: Promise<string>
}
const jobs = new Map<string, Job>()

// progress rides 'models:progress' for the card; fx models ALSO forward on the legacy
// 'fx:modelProgress' channel so the Effects panel's DATA rows keep their percent
function sendProgress(wc: WebContents, m: LocalModelDef, pct: number, got: number, total: number, note?: string): void {
  if (wc.isDestroyed()) return
  wc.send('models:progress', { id: m.id, pct, got, total, note })
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
        // live speed rides the row's note slot (`NN% · N.N MB/s`), refreshed every ~2s —
        // the 1%-per-tick bar alone reads as a stall on a 42 GB file (user catch 2026-08-25)
        let lastPct = -1
        let lastSend = 0
        let lastGot = 0
        await downloadFile(files[i].url, part, abort.signal, (got, total) => {
          grandTotal = doneBytes + total // best available truth; refined as files finish
          const pct = grandTotal ? Math.floor(((doneBytes + got) / grandTotal) * 100) : 0
          const now = Date.now()
          if (pct !== lastPct || now - lastSend >= 2000) {
            const mbps = lastSend ? (got - lastGot) / ((now - lastSend) / 1000) / 1e6 : 0
            lastPct = pct
            job.pct = pct
            sendProgress(wc, m, pct, doneBytes + got, grandTotal, mbps > 0 ? `${pct}% · ${mbps.toFixed(1)} MB/s` : undefined)
            lastSend = now
            lastGot = got
          }
        })
        // pinned integrity BEFORE rename (§2.4 read-back pass): exact bytes AND sha256 — a
        // corrupted transfer or a mirror swapping content must never land at dest (the
        // 2026-08-25 lesson: 11 of 12 files arrived subtly corrupt and every check on size
        // alone passed)
        const got = (await stat(part)).size
        const pinned = files[i].bytes
        if (pinned && got !== pinned) throw new Error(`${t.file} is ${got} bytes, expected ${pinned} — the mirror changed; report this`)
        if (files[i].sha256) {
          // the read-back takes ~1-2 min on a 40 GB file — say so, or 100% reads as a hang
          sendProgress(wc, m, -1, doneBytes + got, grandTotal, `verifying ${t.file}…`)
          const digest = await sha256Of(part)
          if (digest !== files[i].sha256) throw new Error(`${t.file} failed its integrity check (sha256 mismatch) — re-download; if it repeats, report this`)
        }
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
