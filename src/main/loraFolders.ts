// The Image Gen sidebar's LOCAL source (KREA2-LOCAL-SPEC §5.2/5.3): his picked LoRA folders,
// read IN PLACE and recursively. Every file gets its story from (1) a sidecar beside it — ours
// (`<file>.json`) or his downloaders' (`<file>.civit.info` / `<file>.civitai.json`) — else
// (2) a sha256 → Civitai by-hash lookup, cached into OUR sidecar so it runs once. Hashing 130
// files happens in the background; the sidebar shows "reading n/N" and never blocks.
import { existsSync } from 'fs'
import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { basename, dirname, join, relative } from 'path'
import type { WebContents } from 'electron'
import { byHash } from './civitai'
import { getExtraLoraDirs, shelfLorasDir } from './imagePaths'

export interface FolderLoraRow {
  root: string // the picked folder
  rel: string // path relative to root with forward slashes — the lora_name Comfy resolves
  file: string // basename
  bytes: number
  name: string // display name
  baseModel?: string // what Civitai / the installer says
  tag?: LoraFamilyKey // his right-click family — outranks everything
  triggerWords: string[]
  thumb?: string // a local preview path or a remote url (remote = proxied through main)
  sha256?: string
  civitKey?: string // 'civitai:<versionId>' when the file is known to Civitai
  homepage?: string
  looked: boolean // the by-hash lookup ran (hit or miss) — untagged rows past this point are truly unknown
}

// a lora family the side panel knows (MINIMAX-H3-LOCAL-SPEC §4.2)
export type LoraFamilyKey = 'krea2' | 'ltx' | 'h3'
export interface LoraFolder {
  path: string
  family: LoraFamilyKey
}
// folder = family (his 09-09 rule: the folder outranks Civitai's tag). A folder picked before the
// families existed came from Image Gen = krea2. Settings: `loraFolders` (the engine roots, in
// order) + `loraFolderFamily` (path → family)
export function foldersOf(s: Record<string, unknown>): LoraFolder[] {
  const fam = (s.loraFolderFamily as Record<string, LoraFamilyKey> | undefined) ?? {}
  return ((s.loraFolders as string[] | undefined) ?? []).map((path) => ({ path, family: fam[path] ?? 'krea2' }))
}

interface OurSidecar {
  name?: string
  baseModel?: string
  tag?: LoraFamilyKey
  triggerWords?: string[]
  thumb?: string
  sha256?: string
  civitKey?: string
  homepage?: string
  looked?: boolean
}

const sha256Of = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T
  } catch {
    return null
  }
}

// his downloaders' sidecars (civicomfy / civitai-toolkit shapes): a model-version object
interface CivitInfo {
  id?: number
  modelId?: number
  name?: string
  baseModel?: string
  trainedWords?: string[]
  images?: { url?: string }[]
  files?: { hashes?: { SHA256?: string } }[]
  model?: { name?: string }
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.safetensors')) yield p
  }
}

const stemOf = (p: string): string => p.replace(/\.safetensors$/i, '')

async function rowFor(root: string, path: string): Promise<FolderLoraRow> {
  const bytes = (await stat(path)).size
  const stem = stemOf(path)
  const file = basename(path)
  const row: FolderLoraRow = { root, rel: relative(root, path).replace(/\\/g, '/'), file, bytes, name: basename(stem), triggerWords: [], looked: false }
  const ours = await readJson<OurSidecar>(`${stem}.vd.json`)
  if (ours) {
    Object.assign(row, { name: ours.name ?? row.name, baseModel: ours.baseModel, tag: ours.tag, triggerWords: ours.triggerWords ?? [], thumb: ours.thumb, sha256: ours.sha256, civitKey: ours.civitKey, homepage: ours.homepage, looked: !!ours.looked })
  }
  // the shelf's own sidecar (`<file>.safetensors.json`, written by the Models card installs):
  // its story is complete — no hash lookup needed for a shelf row
  const shelf = await readJson<{ source?: string; name?: string; author?: string; thumb?: string; triggerWords?: string[]; baseModel?: string; homepage?: string; sha256?: string }>(`${path}.json`)
  if (shelf) {
    row.name = ours?.name ?? shelf.name ?? row.name
    row.baseModel = row.baseModel ?? shelf.baseModel
    if (!row.triggerWords.length) row.triggerWords = shelf.triggerWords ?? []
    row.thumb = row.thumb ?? shelf.thumb
    row.sha256 = row.sha256 ?? shelf.sha256
    row.homepage = row.homepage ?? shelf.homepage
    if (!row.civitKey && shelf.source === 'civitai' && shelf.homepage) {
      const v = shelf.homepage.match(/modelVersionId=(\d+)/)
      if (v) row.civitKey = `civitai:${v[1]}`
    }
    row.looked = true
  }
  // his downloaders' sidecar fills whatever ours lacks
  const theirs = (await readJson<CivitInfo>(`${stem}.civit.info`)) ?? (await readJson<CivitInfo>(`${stem}.civitai.json`)) ?? (await readJson<CivitInfo>(`${stem}.civitai.info`))
  if (theirs) {
    row.name = ours?.name ?? theirs.model?.name ?? row.name
    row.baseModel = row.baseModel ?? theirs.baseModel
    if (!row.triggerWords.length) row.triggerWords = (theirs.trainedWords ?? []).filter((w) => w.length <= 60)
    row.sha256 = row.sha256 ?? theirs.files?.[0]?.hashes?.SHA256?.toLowerCase()
    if (!row.civitKey && theirs.id) row.civitKey = `civitai:${theirs.id}`
    if (!row.homepage && theirs.modelId) row.homepage = `https://civitai.com/models/${theirs.modelId}${theirs.id ? `?modelVersionId=${theirs.id}` : ''}`
    if (!row.thumb) row.thumb = theirs.images?.find((i) => i.url)?.url
    row.looked = true
  }
  // a preview image beside the file wins over a remote thumb (no proxy, no network)
  for (const cand of [`${stem}.preview.png`, `${stem}.preview.jpg`, `${stem}.preview.jpeg`, `${stem}.png`, `${stem}.jpg`, `${stem}_0.jpeg`, `${stem}_0.jpg`, `${stem}_0.png`]) {
    if (existsSync(cand)) {
      row.thumb = cand
      break
    }
  }
  return row
}

export async function listFolderLoras(): Promise<FolderLoraRow[]> {
  const rows: FolderLoraRow[] = []
  // the shelf folder is a root too (MINIMAX-H3-LOCAL-SPEC §4.2): what the Models card installed
  // shows beside his picked folders, and resolves by the same relative name
  for (const root of [shelfLorasDir(), ...getExtraLoraDirs()]) {
    if (!existsSync(root)) continue
    for await (const p of walk(root)) {
      try {
        rows.push(await rowFor(root, p))
      } catch {
        /* an unreadable file is not a row */
      }
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

// the background pass: hash every unlooked file once, ask Civitai by hash, write our sidecar.
// Progress rides `imagegen:loraScan` {done, total}; a fresh listing after it carries the words.
let scanning = false
export function scanFolderLoras(wc: WebContents): void {
  if (scanning) return
  scanning = true
  void (async () => {
    try {
      const rows = (await listFolderLoras()).filter((r) => !r.looked)
      let done = 0
      for (const r of rows) {
        const path = join(r.root, r.rel)
        const stem = stemOf(path)
        const side: OurSidecar = (await readJson<OurSidecar>(`${stem}.vd.json`)) ?? {}
        try {
          const sha = side.sha256 ?? (await sha256Of(path))
          side.sha256 = sha
          const hit = await byHash(sha)
          if (hit) {
            side.name = side.name ?? hit.name
            side.baseModel = side.baseModel ?? hit.baseModel
            side.triggerWords = side.triggerWords?.length ? side.triggerWords : hit.triggerWords
            side.thumb = side.thumb ?? hit.images[0]
            side.civitKey = hit.key
            side.homepage = hit.homepage
          }
          side.looked = true
          await writeFile(`${stem}.vd.json`, JSON.stringify(side, null, 2))
        } catch (e) {
          console.warn(`[loras] lookup skipped for ${r.file}: ${e instanceof Error ? e.message : e}`)
        }
        done++
        if (!wc.isDestroyed()) wc.send('imagegen:loraScan', { done, total: rows.length })
      }
      if (!wc.isDestroyed()) wc.send('imagegen:loraScan', { done: rows.length, total: rows.length, finished: true })
    } finally {
      scanning = false
    }
  })()
}

// right-click family tag on a folder row — written to OUR sidecar only, beside Civitai's baseModel
export async function tagFolderLora(root: string, rel: string, family: LoraFamilyKey): Promise<void> {
  const stem = stemOf(join(root, rel))
  const side: OurSidecar = (await readJson<OurSidecar>(`${stem}.vd.json`)) ?? {}
  side.tag = family
  await writeFile(`${stem}.vd.json`, JSON.stringify(side, null, 2))
}

// which root holds a file by sha / basename (the sidebar's download-vs-use answer)
export async function findInstalled(rows: FolderLoraRow[], want: { sha256?: string; file?: string }): Promise<FolderLoraRow | undefined> {
  if (want.sha256) {
    const hit = rows.find((r) => r.sha256 === want.sha256)
    if (hit) return hit
  }
  if (want.file) {
    const b = basename(want.file).toLowerCase()
    return rows.find((r) => r.file.toLowerCase() === b)
  }
  return undefined
}

export const dirOfRow = (r: FolderLoraRow): string => dirname(join(r.root, r.rel))
