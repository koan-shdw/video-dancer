// Playground shelf — sample projects the picker offers below the user's own. The zip lives on the
// public releases repo (a dedicated non-latest `playground` release, so the auto-update feed never
// sees it), downloads ONCE into userData/playgrounds/, and every open EXTRACTS A FRESH COPY into
// the user's projects folder — the shelf card is the factory master, the stamped copy is a normal
// project the user can wreck, rename or delete with zero special rules.
import { app } from 'electron'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { basename, join } from 'path'
import extract from 'extract-zip'

interface PlaygroundDef {
  id: string
  v: number // bump when the packaged zip is re-uploaded — the cache file name carries it
  name: string
  blurb: string
  bytes: number // asset size for the card + progress fallback (content-length wins when present)
  url: string
}

// the shelf — adding a playground = one entry here + one zip asset on the `playground` release
const PLAYGROUNDS: PlaygroundDef[] = [
  {
    id: '1am',
    v: 1,
    name: '1 AM',
    blurb: 'liminal-hour conbini vignettes — screen-test characters against a fixed set',
    bytes: 179_254_586, // exact asset size (playground-1am-v1.zip)
    url: 'https://github.com/koan-shdw/video-dancer/releases/download/playground/playground-1am-v1.zip'
  }
]

const busy = new Set<string>() // ids mid-download/stamp — the card shows progress, clicks bounce

const cacheDir = (): string => join(app.getPath('userData'), 'playgrounds')
const zipPath = (p: PlaygroundDef): string => join(cacheDir(), `${p.id}-v${p.v}.zip`)
const defOf = (id: string): PlaygroundDef => {
  const p = PLAYGROUNDS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown playground "${id}"`)
  return p
}

export interface PlaygroundCard {
  id: string
  name: string
  blurb: string
  bytes: number
  cached: boolean
  busy: boolean
}

export function playgroundList(): PlaygroundCard[] {
  return PLAYGROUNDS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, bytes: p.bytes, cached: existsSync(zipPath(p)), busy: busy.has(p.id) }))
}

export async function playgroundClear(id: string): Promise<boolean> {
  const p = defOf(id)
  if (busy.has(id)) return false
  await rm(zipPath(p), { force: true })
  return true
}

// stream the zip to disk with real progress — download into .part, rename only when complete, so
// a killed app never leaves a truncated zip masquerading as a cached one
async function download(p: PlaygroundDef, onProgress: (pct: number, msg?: string) => void): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
  const part = zipPath(p) + '.part'
  const res = await fetch(p.url)
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} — check your connection (the zip lives on GitHub releases)`)
  const total = Number(res.headers.get('content-length')) || p.bytes
  let got = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    got += chunk.length
    const pct = Math.min(99, Math.floor((got / total) * 100))
    if (pct !== lastPct) {
      lastPct = pct
      onProgress(pct)
    }
  })
  try {
    await pipeline(body, createWriteStream(part))
    // the registry knows the asset's exact size — a truncated or substituted zip must never be
    // cached as legitimate (it would extract as a half-project with no further checks)
    if (got !== p.bytes) throw new Error(`playground zip incomplete (${got} of ${p.bytes} expected bytes) — retry the download`)
  } catch (e) {
    await rm(part, { force: true })
    throw e
  }
  await rename(part, zipPath(p))
}

// download if needed, then extract a fresh copy as <baseDir>/<name> playground[ N] and hand the
// dir back — the caller opens it through the normal project:openPath plumbing (recents included)
export async function playgroundStamp(id: string, baseDir: string, onProgress: (pct: number, msg?: string) => void): Promise<string> {
  const p = defOf(id)
  if (busy.has(id)) throw new Error('this playground is already downloading — one moment')
  busy.add(id)
  try {
    if (!existsSync(zipPath(p))) await download(p, onProgress)
    onProgress(100, 'stamping a fresh copy…')
    let dir = join(baseDir, `${p.name} playground`)
    let n = 2
    while (existsSync(dir)) dir = join(baseDir, `${p.name} playground ${n++}`)
    await mkdir(dir, { recursive: true })
    try {
      await extract(zipPath(p), { dir })
    } catch (e) {
      await rm(dir, { recursive: true, force: true }) // a half-extracted project must not linger
      throw e
    }
    // the stamped copy is its own project — name it after its folder so two stamps stay tellable
    const jp = join(dir, 'project.json')
    const raw = JSON.parse(await readFile(jp, 'utf-8')) as { name?: string }
    raw.name = basename(dir)
    await writeFile(jp, JSON.stringify(raw, null, 2), 'utf-8')
    return dir
  } finally {
    busy.delete(id)
  }
}
