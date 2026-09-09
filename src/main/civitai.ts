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
