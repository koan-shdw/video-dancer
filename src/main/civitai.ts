import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PngSettings } from './pngMeta'

// Civitai (KREA2-LOCAL-SPEC §2 facts, read 2026-09-08): the public REST v1. Browse is keyless;
// `favorites=true` and /me need the key; downloads answer 401 keyless (the shelf's P5 fact).
// Auth rides the Authorization header (their docs: prefer it over ?token=).
const BASE = 'https://civitai.com/api/v1'

export interface CivitVersionRow {
  key: string // 'civitai:<versionId>'
  modelId: number
  versionId: number
  name: string // "<model> · <version>" when the model has several versions
  modelName: string
  versionName?: string
  author?: string
  type: 'LORA' | 'Checkpoint' | string
  baseModel: string
  triggerWords: string[]
  images: string[] // preview urls (the sidebar's hover-scroll)
  file: string // the .safetensors basename it lands as
  url: string // download url (key goes in the header at download time, never stored)
  bytes?: number
  sha256?: string
  downloads?: number
  homepage: string
  publishedAt?: string
}

interface CivitModel {
  id: number
  name: string
  type?: string
  creator?: { username?: string }
  stats?: { downloadCount?: number }
  modelVersions?: CivitVersion[]
}
interface CivitVersion {
  id: number
  modelId?: number
  name?: string
  baseModel?: string
  trainedWords?: string[]
  publishedAt?: string
  images?: { url?: string; type?: string }[]
  files?: { name?: string; sizeKB?: number; downloadUrl?: string; primary?: boolean; hashes?: { SHA256?: string } }[]
  model?: { name?: string; type?: string }
  downloadUrl?: string
}

const headers = (key?: string): Record<string, string> => ({ accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) })

const safeName = (f: string): string => f.replace(/[^\w. \-()[\]]/g, '_')

function rowsOf(m: CivitModel): CivitVersionRow[] {
  const vers = (m.modelVersions ?? []).filter((v) => (v.files ?? []).some((x) => x.name?.endsWith('.safetensors') && x.downloadUrl))
  return vers.map((v) => {
    const f = (v.files ?? []).find((x) => x.primary && x.name?.endsWith('.safetensors') && x.downloadUrl) ?? (v.files ?? []).find((x) => x.name?.endsWith('.safetensors') && x.downloadUrl)!
    return {
      key: `civitai:${v.id}`,
      modelId: m.id,
      versionId: v.id,
      name: vers.length > 1 && v.name ? `${m.name} · ${v.name}` : m.name,
      modelName: m.name,
      versionName: v.name,
      author: m.creator?.username,
      type: m.type ?? 'LORA',
      baseModel: v.baseModel ?? '',
      triggerWords: (v.trainedWords ?? []).filter((w) => w.length <= 60),
      images: (v.images ?? []).filter((i) => i.type === 'image' && i.url).map((i) => i.url!).slice(0, 12),
      file: safeName(f.name!),
      url: f.downloadUrl!,
      bytes: f.sizeKB ? Math.round(f.sizeKB * 1024) : undefined,
      sha256: f.hashes?.SHA256?.toLowerCase(),
      downloads: m.stats?.downloadCount,
      homepage: `https://civitai.com/models/${m.id}?modelVersionId=${v.id}`,
      publishedAt: v.publishedAt
    }
  })
}

export interface BrowseArgs {
  type: 'LORA' | 'Checkpoint'
  baseModels: string[]
  query?: string
  sort?: 'downloads' | 'newest'
  favorites?: boolean
  cursor?: string
  limit?: number
}
export async function browse(a: BrowseArgs, key?: string): Promise<{ items: CivitVersionRow[]; nextCursor?: string }> {
  if (a.favorites && !key) throw new Error('favorites need your Civitai key — paste it in Settings')
  const u = new URL(`${BASE}/models`)
  u.searchParams.set('types', a.type)
  u.searchParams.set('limit', String(Math.min(100, a.limit ?? 40)))
  for (const b of a.baseModels) u.searchParams.append('baseModels', b)
  u.searchParams.set('sort', a.sort === 'newest' ? 'Newest' : 'Most Downloaded')
  u.searchParams.set('nsfw', 'true')
  if (a.query?.trim()) u.searchParams.set('query', a.query.trim())
  if (a.favorites) u.searchParams.set('favorites', 'true')
  if (a.cursor) u.searchParams.set('cursor', a.cursor)
  const r = await fetch(u, { headers: headers(key), signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(r.status === 401 ? 'Civitai rejected the key (401)' : `Civitai answered ${r.status} — try again in a moment`)
  const j = (await r.json()) as { items?: CivitModel[]; metadata?: { nextCursor?: string } }
  const items = (j.items ?? []).flatMap(rowsOf).filter((row) => a.baseModels.some((b) => row.baseModel.toLowerCase() === b.toLowerCase()))
  return { items, nextCursor: j.metadata?.nextCursor }
}

// by-hash: public. The automatic trigger words + previews + family for a file in his folder.
export async function byHash(sha256: string): Promise<CivitVersionRow | null> {
  const r = await fetch(`${BASE}/model-versions/by-hash/${sha256}`, { headers: headers(), signal: AbortSignal.timeout(15_000) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Civitai answered ${r.status}`)
  const v = (await r.json()) as CivitVersion & { model?: { name?: string; type?: string } }
  const m: CivitModel = { id: v.modelId ?? 0, name: v.model?.name ?? v.name ?? 'unknown', type: v.model?.type, modelVersions: [v] }
  return rowsOf(m)[0] ?? null
}

export async function me(key: string): Promise<{ username: string; tier?: string; status?: string }> {
  const r = await fetch(`${BASE}/me`, { headers: headers(key), signal: AbortSignal.timeout(15_000) })
  if (r.status === 401) throw new Error('Civitai rejected the key (401)')
  if (!r.ok) throw new Error(`Civitai answered ${r.status}`)
  const j = (await r.json()) as { username?: string; tier?: string; status?: string }
  if (!j.username) throw new Error('no username in the reply')
  return { username: j.username, tier: j.tier, status: j.status }
}

// the raw model-version object — written beside a downloaded LoRA as `<stem>.civit.info`, the
// same file his downloaders leave (the sidebar reads it for words · family · previews)
export async function versionRaw(versionId: number, key?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/model-versions/${versionId}`, { headers: headers(key), signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`Civitai answered ${r.status} for version ${versionId}`)
  return (await r.json()) as Record<string, unknown>
}

// a version id → the SAME row shape the browser hands the downloader (CIVIT-DRAG-SPEC-2026-09-19
// §4): a liked image's generation data only names its loras by version id, and `get + use` must
// ride the ONE download path (imagegen:civitDownload), not a second one
export async function rowForVersion(versionId: number, key?: string): Promise<CivitVersionRow | null> {
  const v = (await versionRaw(versionId, key)) as unknown as CivitVersion
  const m: CivitModel = { id: v.modelId ?? 0, name: v.model?.name ?? v.name ?? 'unknown', type: v.model?.type, modelVersions: [v] }
  return rowsOf(m)[0] ?? null
}

// preview images to disk (best effort — a missing preview never fails the download)
export async function fetchPreview(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') ?? '')) return null
    return Buffer.from(await r.arrayBuffer())
  } catch {
    return null
  }
}


// ---- CIVIT LIKES (CIVIT-LIKES-SPEC-2026-09-09 §1): the images he reacted to on civitai.com and their
// generation data live ONLY on Civitai's own site lane (/api/trpc), which accepts the same key as Bearer.
// Undocumented — when it changes, every call here says so in one line and the local tab keeps working.
const SITE = 'https://civitai.com/api/trpc'
const CDN = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA' // the account hash was identical on every image probed
const SITE_OFF = 'civitai changed its site api — the likes list is off until we catch up'

// trpc answers in the devalue wire format: an array of nodes, every value an index into it
function devalueParse(arr: unknown[]): unknown {
  const seen = new Map<number, unknown>()
  const h = (i: number): unknown => {
    if (i === -1) return undefined
    if (i === -2) return NaN
    if (i === -3) return Infinity
    if (i === -4) return -Infinity
    if (i === -5) return -0
    if (seen.has(i)) return seen.get(i)
    const v = arr[i]
    if (typeof v !== 'object' || v === null) {
      seen.set(i, v)
      return v
    }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {
        const t = v[0]
        if (t === 'Date') return new Date(v[1] as string)
        if (t === 'Set') return new Set(v.slice(1).map((x) => h(x as number)))
        if (t === 'Map') {
          const m = new Map<unknown, unknown>()
          for (let k = 1; k < v.length; k += 2) m.set(h(v[k] as number), h(v[k + 1] as number))
          return m
        }
        if (t === 'RegExp') return new RegExp(v[1] as string, v[2] as string)
        if (t === 'Object') return Object(h(v[1] as number))
        if (t === 'BigInt') return BigInt(v[1] as string)
        if (t === 'null') {
          const o: Record<string, unknown> = Object.create(null)
          for (let k = 1; k < v.length; k += 2) o[v[k] as string] = h(v[k + 1] as number)
          return o
        }
      }
      const out: unknown[] = []
      seen.set(i, out)
      for (const x of v) out.push(h(x as number))
      return out
    }
    const o: Record<string, unknown> = {}
    seen.set(i, o)
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = h(x as number)
    return o
  }
  return h(0)
}

async function trpcGet(proc: string, input: Record<string, unknown>, key: string): Promise<unknown> {
  const r = await fetch(`${SITE}/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, { headers: headers(key), signal: AbortSignal.timeout(20_000) })
  if (r.status === 401) throw new Error('Civitai rejected the key (401)')
  if (!r.ok) throw new Error(`${SITE_OFF} (${r.status})`)
  const j = (await r.json()) as { result?: { data?: unknown }; error?: { message?: string } }
  if (j.error) throw new Error(`${SITE_OFF} (${j.error.message ?? 'error'})`)
  let d = j.result?.data
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d)
    } catch {
      throw new Error(SITE_OFF)
    }
  }
  if (Array.isArray(d)) return devalueParse(d)
  if (d && typeof d === 'object' && 'json' in d) return (d as { json: unknown }).json
  return d
}

export interface CivitLikedImage {
  id: number
  thumbUrl: string // width=450 — the tile
  fullUrl: string // the original — imports and slot drops
  width: number
  height: number
  username?: string
  hasPrompt: boolean
  cachedFile?: string // already on disk → a drag carries a real file (clip slots take it as they take a Watched file)
}
interface SiteImage {
  id: number
  url: string
  width?: number
  height?: number
  hasPositivePrompt?: boolean
  user?: { username?: string }
  type?: string
}

const cacheDir = (): string => join(app.getPath('userData'), 'civit-cache')
const cachePath = (id: number, ext: string): string => join(cacheDir(), `${id}.${ext}`)
const cachedFor = (id: number): string | undefined => ['jpeg', 'png', 'webp'].map((e) => cachePath(id, e)).find((p) => existsSync(p))

// the images he LIKED, newest first (the caller's key IS the filter — never pass a userId, that returns nothing)
export async function liked(key: string, cursor?: string | number): Promise<{ items: CivitLikedImage[]; nextCursor?: string | number }> {
  const d = (await trpcGet(
    'image.getInfinite',
    { reactions: ['Like'], period: 'AllTime', sort: 'Newest', limit: 40, useIndex: true, withMeta: false, browsingLevel: 31, ...(cursor != null ? { cursor } : {}) },
    key
  )) as { items?: SiteImage[]; nextCursor?: string | number | null } | null
  if (!d || !Array.isArray(d.items)) throw new Error(SITE_OFF)
  const items = d.items
    .filter((i) => i && typeof i.id === 'number' && typeof i.url === 'string' && (i.type ?? 'image') === 'image')
    .map((i) => ({
      id: i.id,
      thumbUrl: `${CDN}/${i.url}/width=450`,
      fullUrl: `${CDN}/${i.url}/original=true`,
      width: i.width ?? 0,
      height: i.height ?? 0,
      username: i.user?.username,
      hasPrompt: !!i.hasPositivePrompt,
      cachedFile: cachedFor(i.id)
    }))
  return { items, nextCursor: d.nextCursor ?? undefined }
}

interface SiteGen {
  meta?: { prompt?: string; negativePrompt?: string; steps?: number; sampler?: string; cfgScale?: number; seed?: number; Model?: string; width?: number; height?: number; Size?: string } | null
  resources?: { modelName?: string; modelType?: string; versionName?: string; versionId?: number; strength?: number | null }[]
}
// generation data in the PNG reader's own shape — one menu serves both (settingsMenu.tsx)
export async function generationData(key: string, id: number): Promise<PngSettings> {
  const g = (await trpcGet('image.getGenerationData', { id }, key)) as SiteGen | null
  const m = g?.meta ?? {}
  const res = g?.resources ?? []
  const ckpt = res.find((r) => r.modelType === 'Checkpoint')
  const size = typeof m.Size === 'string' ? m.Size.split('x').map(Number) : []
  // the BASE each lora was made for (his call: a lora for another model is skipped). The generation
  // data does not carry it; the version object does. Best effort, in parallel — an unknown base
  // stays undefined and is never treated as a mismatch.
  const loraRes = res.filter((r) => r.modelType === 'LORA' && r.modelName)
  const bases = await Promise.all(
    loraRes.map((r) => (r.versionId ? versionRaw(r.versionId, key).then((v) => (typeof v.baseModel === 'string' ? v.baseModel : undefined)).catch(() => undefined) : Promise.resolve(undefined)))
  )
  return {
    source: 'civit',
    prompt: m.prompt ?? '',
    negative: m.negativePrompt || undefined,
    model: ckpt?.modelName ?? m.Model,
    width: m.width ?? size[0],
    height: m.height ?? size[1],
    seed: m.seed,
    steps: m.steps,
    cfg: m.cfgScale,
    sampler: m.sampler,
    loras: loraRes.map((r, i) => ({ name: r.versionName && r.versionName !== r.modelName ? `${r.modelName} · ${r.versionName}` : r.modelName!, weight: typeof r.strength === 'number' ? r.strength : 1, versionId: r.versionId, baseModel: bases[i] }))
  }
}

// the full image to disk, once — Library imports and slot drops need a real file
export async function imageFile(id: number, fullUrl: string): Promise<string> {
  const have = cachedFor(id)
  if (have) return have
  const r = await fetch(fullUrl, { signal: AbortSignal.timeout(60_000) })
  if (!r.ok) throw new Error(`Civitai answered ${r.status} for the image`)
  const ct = r.headers.get('content-type') ?? ''
  const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : 'jpeg'
  await mkdir(cacheDir(), { recursive: true })
  const p = cachePath(id, ext)
  await writeFile(p, Buffer.from(await r.arrayBuffer()))
  return p
}
