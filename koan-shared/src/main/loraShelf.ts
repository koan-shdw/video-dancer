// LORA SHELF (bible 12.10; probes P5/P6 passed 2026-08-30) — dynamic LoRA rows beside the
// static model registry. ONE COPY (koan-shared SPEC): each app injects its transport + paths
// via configureLoraShelf at startup. Three sources, one folder (userData/models/loras/):
//   official — live HF org scan (Lightricks LTX adapters appear as rows automatically)
//   civitai  — live browser (search/sort); downloads need the user's Civitai key
//   local    — any .safetensors dropped in the folder (or through the shelf's drop zone)
// Every install rides the SAME Chromium transport + pin gates as the app's model registry:
// sha proves the copy, weight scan proves the weights (runs through the LTX engine's python
// when installed; skipped-with-note otherwise — recorded in the sidecar).
import type { WebContents } from 'electron'
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { basename, join } from 'path'
import type { LoraCatalogItem, LoraRow, LoraSidecar } from '../types'

export type { LoraCatalogItem, LoraRow, LoraSidecar }

// ---- per-app injection: the transport + paths this engine rides ----
export interface LoraShelfDeps {
  // `headers` is optional: apps whose transport can carry them (Electron ≥30 downloadURL) send the
  // Civitai key as `Authorization: Bearer` (their docs' advice); an app that ignores it still works
  downloadFile: (url: string, part: string, signal: AbortSignal, onBytes: (got: number, total: number) => void, headers?: Record<string, string>) => Promise<void>
  sha256Of: (path: string) => Promise<string>
  lorasDir: () => string
  engineDirs: () => string[] // the local engine roots — [0]/env/Scripts/python.exe runs the weight scan
}
let deps: LoraShelfDeps | null = null
export function configureLoraShelf(d: LoraShelfDeps): void {
  deps = d
}
const D = (): LoraShelfDeps => {
  if (!deps) throw new Error('configureLoraShelf() must run before the shelf is used')
  return deps
}
const lorasDir = (): string => D().lorasDir()

const safeName = (f: string): string => {
  const b = basename(f).replace(/[^\w. \-()[\]]/g, '_')
  if (!b.endsWith('.safetensors')) throw new Error('loras are .safetensors files')
  return b
}
const sidecarPath = (file: string): string => join(lorasDir(), `${file}.json`)

// ---- installed rows: disk is the truth, sidecar carries the story ----
export async function listInstalled(): Promise<LoraRow[]> {
  await mkdir(lorasDir(), { recursive: true })
  const rows: LoraRow[] = []
  for (const f of await readdir(lorasDir())) {
    if (!f.endsWith('.safetensors')) continue
    const bytes = (await stat(join(lorasDir(), f))).size
    let sidecar: LoraSidecar | undefined
    try {
      sidecar = JSON.parse(await readFile(sidecarPath(f), 'utf8')) as LoraSidecar
    } catch {
      /* dropped-in file with no sidecar = a local row, still first-class */
    }
    rows.push({ file: f, bytes, sidecar })
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file))
}

// ---- civitai browse (P5: API stable; metadata carries trainedWords + SHA256 + downloadUrl) ----
// `baseModels` (KREA2-LOCAL-SPEC §5.6): the family the caller browses for — LTX callers keep the
// LTXV pair by default, the Image Gen sidebar passes ['Krea 2']
export async function civitaiSearch(query: string, sort: 'downloads' | 'newest', baseModels: string[] = ['LTXV 2.5', 'LTXV 2.3']): Promise<LoraCatalogItem[]> {
  const u = new URL('https://civitai.com/api/v1/models')
  u.searchParams.set('types', 'LORA')
  u.searchParams.set('limit', '24')
  for (const b of baseModels) u.searchParams.append('baseModels', b)
  u.searchParams.set('sort', sort === 'newest' ? 'Newest' : 'Most Downloaded')
  if (query.trim()) u.searchParams.set('query', query.trim())
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`Civitai answered ${r.status} — try again in a moment`)
  const j = (await r.json()) as { items?: CivitaiModel[] }
  const out: LoraCatalogItem[] = []
  for (const m of j.items ?? []) {
    // one row per VERSION, not per model (2026-08-31 user catch: "LTX 2.3 - Enhancers" hid its
    // Crisp Enhance version behind the model name and made Soft Enhance unreachable). Versions
    // without a .safetensors download (config-only workflow jsons) are not shelf rows.
    const vers = (m.modelVersions ?? []).filter((v) => (v.files ?? []).some((x) => x.name?.endsWith('.safetensors') && x.downloadUrl))
    for (const v of vers) {
      const f = (v.files ?? []).find((x) => x.name?.endsWith('.safetensors') && x.downloadUrl)!
      out.push({
        key: `civitai:${v.id}`,
        source: 'civitai',
        name: vers.length > 1 && v.name ? `${m.name} · ${v.name}` : m.name,
        author: m.creator?.username,
        thumb: v.images?.find((i) => i.type === 'image')?.url ?? v.images?.[0]?.url,
        triggerWords: (v.trainedWords ?? []).filter((w) => w.length <= 60), // sentence-length "words" are usage notes, not triggers
        baseModel: v.baseModel ?? '',
        file: safeName(f.name!),
        url: f.downloadUrl!,
        bytes: f.sizeKB ? Math.round(f.sizeKB * 1024) : undefined,
        sha256: f.hashes?.SHA256?.toLowerCase(),
        downloads: m.stats?.downloadCount,
        homepage: `https://civitai.com/models/${m.id}`
      })
    }
  }
  return out
}
interface CivitaiModel {
  id: number
  name: string
  creator?: { username?: string }
  stats?: { downloadCount?: number }
  modelVersions?: {
    id: number
    name?: string
    baseModel?: string
    trainedWords?: string[]
    images?: { url?: string; type?: string }[]
    files?: { name?: string; sizeKB?: number; downloadUrl?: string; hashes?: { SHA256?: string } }[]
  }[]
}

// ---- official rows: live HF org scan — a new Lightricks adapter appears without a re-pin.
// (Proven worthwhile day one: IC-LoRA HDR shipped between two hand-lists, 2026-08-30.) ----
let officialCache: { at: number; rows: LoraCatalogItem[] } | null = null
export async function officialList(): Promise<LoraCatalogItem[]> {
  if (officialCache && Date.now() - officialCache.at < 10 * 60_000) return officialCache.rows
  const r = await fetch('https://huggingface.co/api/models?author=Lightricks&search=LoRA&limit=50', { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`Hugging Face answered ${r.status}`)
  const repos = ((await r.json()) as { id: string }[]).filter((m) => /^Lightricks\/LTX-2(\.\d+)?-.*LoRA/i.test(m.id))
  const rows: LoraCatalogItem[] = []
  for (const repo of repos) {
    try {
      const t = await fetch(`https://huggingface.co/api/models/${repo.id}/tree/main`, { signal: AbortSignal.timeout(15_000) })
      if (!t.ok) continue
      const files = (await t.json()) as { path: string; size: number; lfs?: { oid?: string } }[]
      const f = files.find((x) => x.path.endsWith('.safetensors'))
      if (!f) continue
      const is25 = /LTX-2\.5/i.test(repo.id)
      rows.push({
        key: `hf:${repo.id}`,
        source: 'hf',
        name: repo.id.replace(/^Lightricks\//, ''),
        author: 'Lightricks',
        triggerWords: [],
        baseModel: is25 ? 'LTXV 2.5' : 'LTXV 2.3',
        file: safeName(basename(f.path)),
        url: `https://huggingface.co/${repo.id}/resolve/main/${f.path}`,
        bytes: f.size,
        sha256: f.lfs?.oid?.toLowerCase(),
        homepage: `https://huggingface.co/${repo.id}`
      })
    } catch {
      /* one unreadable repo must not empty the list */
    }
  }
  officialCache = { at: Date.now(), rows }
  return rows
}

// ---- weight scan (the 2026-08-25 law): runs through the LTX engine's own python; without
// an installed engine the scan is honestly skipped and the sidecar says so ----
function enginePython(): string | null {
  const p = join(D().engineDirs()[0], 'env', 'Scripts', 'python.exe')
  return existsSync(p) ? p : null
}
const SCAN_PY = [
  'import sys, torch',
  'from safetensors.torch import load_file',
  'sd = load_file(sys.argv[1])',
  'bad = sum(1 for v in sd.values() if not torch.isfinite(v.float()).all())',
  "print('SCAN', 'CLEAN' if bad == 0 else f'BAD {bad}')"
].join('\n')
function scanWeights(file: string): Promise<'clean' | 'bad' | 'skipped'> {
  const py = enginePython()
  if (!py) return Promise.resolve('skipped')
  return new Promise((resolve) => {
    const ps = spawn(py, ['-c', SCAN_PY, file])
    let out = ''
    ps.stdout.on('data', (d) => (out += d))
    ps.on('error', () => resolve('skipped'))
    ps.on('exit', (c) => resolve(c === 0 ? (out.includes('SCAN CLEAN') ? 'clean' : 'bad') : 'skipped'))
  })
}

// ---- install: one job per file, same gates as the registry ----
interface Job {
  abort: AbortController
  pct: number
}
const jobs = new Map<string, Job>()
export const lastErrors = new Map<string, string>()
export function activeJobs(): { file: string; pct: number }[] {
  return [...jobs.entries()].map(([file, j]) => ({ file, pct: j.pct }))
}

export async function install(item: LoraCatalogItem, civitaiKey: string, wc: WebContents): Promise<void> {
  const file = safeName(item.file)
  if (jobs.has(file)) return
  if (item.source === 'civitai' && !civitaiKey) throw new Error('Civitai downloads need a key — paste one in Settings')
  await mkdir(lorasDir(), { recursive: true })
  const dest = join(lorasDir(), file)
  if (existsSync(dest)) {
    lastErrors.delete(file)
    if (!wc.isDestroyed()) wc.send('loras:done', { file, ok: true })
    return
  }
  // the key rides the Authorization header (Civitai docs: prefer it over ?token=, which lands in
  // logs and caches); the url itself stays clean
  const url = item.url
  const headers = item.source === 'civitai' ? { authorization: `Bearer ${civitaiKey}` } : undefined
  const part = `${dest}.part`
  const abort = new AbortController()
  const job: Job = { abort, pct: 0 }
  jobs.set(file, job)
  const send = (pct: number, note?: string): void => {
    job.pct = pct
    if (!wc.isDestroyed()) wc.send('loras:progress', { file, pct, note })
  }
  try {
    let lastSend = 0
    let lastGot = 0
    await D().downloadFile(url, part, abort.signal, (got, total) => {
      const pct = total ? Math.floor((got / total) * 100) : 0
      const now = Date.now()
      if (now - lastSend >= 1000) {
        const mbps = lastSend ? (got - lastGot) / ((now - lastSend) / 1000) / 1e6 : 0
        send(pct, mbps > 0 ? `${pct}% · ${mbps.toFixed(1)} MB/s` : undefined)
        lastSend = now
        lastGot = got
      }
    }, headers)
    // pin gates before the rename (the 2026-08-25 corruption lesson carries over verbatim)
    const got = (await stat(part)).size
    if (item.bytes && Math.abs(got - item.bytes) > Math.max(1024 * 1024, item.bytes * 0.02)) {
      // civitai sizes come from sizeKB (rounded) — allow slack; HF sizes are exact but share the gate
      if (item.source === 'hf') throw new Error(`${file} is ${got} bytes, expected ${item.bytes} — the source changed; report this`)
    }
    if (item.sha256) {
      send(-1, `verifying ${file}…`)
      const digest = await D().sha256Of(part)
      if (digest !== item.sha256) throw new Error(`${file} failed its integrity check (sha256 mismatch) — re-download; if it repeats, report this`)
    }
    send(-1, 'scanning weights…')
    const scan = await scanWeights(part)
    if (scan === 'bad') throw new Error(`${file} has broken weights (non-finite values) — the file is discarded; report this to its publisher`)
    await rename(part, dest)
    const sidecar: LoraSidecar = {
      source: item.source,
      name: item.name,
      author: item.author,
      thumb: item.thumb,
      triggerWords: item.triggerWords,
      baseModel: item.baseModel,
      homepage: item.homepage,
      sha256: item.sha256,
      scanned: scan === 'clean'
    }
    await writeFile(sidecarPath(file), JSON.stringify(sidecar, null, 2))
    lastErrors.delete(file)
    console.log(`[loras] landed ${file} (${got} bytes, scan ${scan})`)
    if (!wc.isDestroyed()) wc.send('loras:done', { file, ok: true })
  } catch (e) {
    await rm(part, { force: true }).catch(() => undefined)
    const msg = abort.signal.aborted ? 'canceled' : e instanceof Error ? e.message : String(e)
    if (msg === 'canceled') lastErrors.delete(file)
    else lastErrors.set(file, msg)
    console.error(`[loras] install ${file} failed: ${msg}`)
    if (!wc.isDestroyed()) wc.send('loras:done', { file, ok: false, error: msg })
    if (msg !== 'canceled') throw new Error(msg)
  } finally {
    jobs.delete(file)
  }
}

export function cancel(file: string): void {
  jobs.get(file)?.abort.abort()
}

// ---- thumb proxy: the renderer's CSP (audit hardening) blocks remote img-src on purpose —
// thumbnails come through main as data URLs instead of widening the policy. In-memory cache,
// capped; a miss or over-size answers null and the row keeps its drawn icon. ----
const thumbCache = new Map<string, string | null>()
export async function thumb(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null
  if (thumbCache.has(url)) return thumbCache.get(url) ?? null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const type = r.headers.get('content-type') ?? ''
    if (!r.ok || !/^image\//.test(type)) throw new Error('not an image')
    const buf = Buffer.from(await r.arrayBuffer())
    const data = buf.byteLength <= 4 * 1024 * 1024 ? `data:${type};base64,${buf.toString('base64')}` : null
    if (thumbCache.size > 300) thumbCache.clear() // crude cap — thumbs re-fetch, nothing breaks
    thumbCache.set(url, data)
    return data
  } catch {
    thumbCache.set(url, null)
    return null
  }
}

// tag a dropped-in file's family by hand (right-click on an untagged row) — merges into the
// sidecar; never guesses from the filename
export async function tagLora(file: string, baseModel: string): Promise<void> {
  const f = safeName(file)
  let sidecar: LoraSidecar = { source: 'local', name: f.replace(/\.safetensors$/, '') }
  try {
    sidecar = { ...sidecar, ...(JSON.parse(await readFile(sidecarPath(f), 'utf8')) as LoraSidecar) }
  } catch {
    /* no sidecar yet — the local skeleton above is the base */
  }
  sidecar.baseModel = baseModel
  await writeFile(sidecarPath(f), JSON.stringify(sidecar, null, 2))
}

// drop-zone import (user order 2026-08-31): copy a .safetensors from anywhere on disk into the
// shelf folder — it becomes an OWN row, no sidecar, family set by right-click like any drop
export async function importFile(src: string): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    const file = safeName(src)
    await mkdir(lorasDir(), { recursive: true })
    const dest = join(lorasDir(), file)
    if (!existsSync(dest)) await copyFile(src, dest)
    return { ok: true, file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteLora(file: string): Promise<void> {
  const f = safeName(file)
  cancel(f)
  lastErrors.delete(f)
  await rm(join(lorasDir(), f), { force: true })
  await rm(sidecarPath(f), { force: true })
}
