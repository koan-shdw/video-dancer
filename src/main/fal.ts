import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { modelFor } from '../shared/models'
import type { EngineId } from '../shared/types'

export interface RenderRequest {
  engine?: EngineId // absent = seedance2
  mode: 'ref2v' | 'i2v'
  prompt: string
  images: string[] // local file paths
  endImage?: string // i2v end frame (local path), optional
  duration: string // engine-dependent (see shared/models.ts)
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  seed?: number
}

export interface RenderOpts extends RenderRequest {
  falKey: string
  outDir: string
  onProgress?: (msg: string) => void
}

function mimeFor(p: string): string {
  const e = extname(p).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function uploadLocal(path: string): Promise<string> {
  const buf = await readFile(path)
  const file = new File([buf], basename(path), { type: mimeFor(path) })
  return await fal.storage.upload(file)
}

// the @fal-ai/client is a SINGLETON — a render, an edit and an image generation can overlap, and
// whichever finishes first must not blank the credentials out from under the others (their next
// queue poll would 401 a paid job). Refcount: set on first acquire, clear when the last releases.
let falKeyUses = 0
export function acquireFalKey(key: string): void {
  falKeyUses++
  fal.config({ credentials: key })
}
export function releaseFalKey(): void {
  falKeyUses = Math.max(0, falKeyUses - 1)
  if (falKeyUses === 0) fal.config({ credentials: '' }) // never leave the key sitting in global state
}

export async function runRender(opts: RenderOpts): Promise<RenderOutput> {
  acquireFalKey(opts.falKey)
  try {
    return await runRenderInner(opts)
  } finally {
    releaseFalKey()
  }
}

// builds the engine-specific input payload — every difference between models lives in the
// capability descriptor + this switch, nowhere else
async function buildInput(opts: RenderOpts, urls: string[]): Promise<Record<string, unknown>> {
  const engine = opts.engine ?? 'seedance2'
  if (engine === 'omniflash') {
    // Gemini Omni Flash (fal OpenAPI 2026-07-02): prompt + INT duration 3-10 + aspect 16:9|9:16.
    // No seed, no audio toggle, no resolution — sending unknown fields risks a 422. Zero refs
    // means the base t2v endpoint (which takes no image fields at all).
    const base: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio === '9:16' ? '9:16' : '16:9',
      duration: Math.min(10, Math.max(3, parseInt(opts.duration, 10) || 8))
    }
    if (opts.mode === 'i2v') return { ...base, image_url: urls[0] }
    if (urls.length > 0) return { ...base, image_urls: urls }
    return base
  }
  if (engine === 'sora2') {
    // Sora 2 i2v (fal OpenAPI): prompt + image_url (FIRST frame only) + aspect/resolution + INT duration.
    // No generate_audio (always on), no seed, no end frame — sending unknown fields risks a 422.
    return {
      prompt: opts.prompt,
      image_url: urls[0],
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: parseInt(opts.duration, 10) || 4
    }
  }
  // seedance2
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    resolution: opts.resolution,
    duration: opts.duration,
    aspect_ratio: opts.aspectRatio,
    generate_audio: opts.generateAudio
  }
  if (typeof opts.seed === 'number' && opts.seed >= 0) input.seed = opts.seed
  if (opts.mode === 'i2v') {
    input.image_url = urls[0]
    if (opts.endImage) input.end_image_url = await uploadLocal(opts.endImage)
  } else {
    input.image_urls = urls
  }
  return input
}

export interface RenderOutput {
  file: string
  durationSec?: number // actual rendered length when fal reports it (sora2 does; seedance2 may not)
}

async function runRenderInner(opts: RenderOpts): Promise<RenderOutput> {
  const model = modelFor(opts.engine)
  let endpoint = model.endpoints[opts.mode]
  // a ref2v render with zero refs is plain text-to-video — engines with a dedicated t2v endpoint
  // (Omni Flash: reference-to-video REQUIRES 1-10 images) route there instead
  if (opts.mode === 'ref2v' && opts.images.length === 0 && model.endpoints.t2v) endpoint = model.endpoints.t2v
  if (!endpoint) throw new Error(`${model.label} does not support ${opts.mode}`)

  opts.onProgress?.('uploading image(s)…')
  const urls: string[] = []
  for (const p of opts.images) urls.push(await uploadLocal(p))

  const input = await buildInput(opts, urls)

  opts.onProgress?.(`submitting to ${model.label} (${opts.mode})…`)
  let result: unknown
  try {
    result = await fal.subscribe(endpoint, {
      input,
      logs: true,
      onQueueUpdate: (u: { status?: string }) => {
        if (u.status === 'IN_PROGRESS') opts.onProgress?.('rendering on fal…')
        else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
      }
    })
  } catch (e) {
    // surface fal's validation detail (422 body) so we can see the exact bad field — but never
    // dump the payload itself (prompt text + signed upload urls don't belong in error logs/UI)
    const err = e as { status?: number; body?: unknown; message?: string }
    const body = err.body as { detail?: unknown } | undefined
    const detail = body?.detail ?? err.body ?? err.message ?? String(e)
    throw new Error(
      `fal ${err.status ?? ''} @ ${endpoint} :: ` +
        (typeof detail === 'string' ? detail : JSON.stringify(detail)) +
        ` :: sent fields: ${Object.keys(input).join(', ')}`
    )
  }

  // @fal-ai/client returns { data, requestId }; older shapes returned the data directly.
  const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  const url: string | undefined =
    out?.video?.url ?? out?.video_url ?? out?.url ?? out?.output?.url
  if (!url) {
    throw new Error('No video URL in fal result: ' + JSON.stringify(out).slice(0, 400))
  }

  opts.onProgress?.('downloading result…')
  await mkdir(opts.outDir, { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) throw new Error('downloaded an empty file')
  const outPath = join(opts.outDir, `render_${Date.now()}.mp4`)
  await writeFile(outPath, bytes)
  opts.onProgress?.('done')
  const reported = out?.video?.duration
  return { file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined }
}

// ---- vid2vid: edit an existing video with a natural-language instruction ----

export interface EditOpts {
  engine?: EngineId
  prompt: string
  video: string // local path of the source (already window-cut when a sub-range was chosen)
  cacheKey?: string // stable upload-cache key (source path + window) — temp cut paths change every run
  falKey: string
  outDir: string
  onProgress?: (msg: string) => void
}

// source uploads are big (tens of MB) and re-rolls reuse the same content — cache the fal.storage
// URL. Keyed by the caller's stable key (source path + window: take files are immutable, so the
// cut content never changes) or, without one, by path + size/mtime signature. Capped: oldest out.
const videoUploadCache = new Map<string, { sig: string; url: string }>()
const UPLOAD_CACHE_MAX = 40

export function hasUploadCached(cacheKey: string): boolean {
  return videoUploadCache.has(cacheKey)
}

async function uploadVideoCached(path: string, cacheKey?: string, onProgress?: (msg: string) => void): Promise<string> {
  if (cacheKey) {
    const hit = videoUploadCache.get(cacheKey)
    if (hit) return hit.url
  }
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  if (!cacheKey) {
    const hit = videoUploadCache.get(path)
    if (hit && hit.sig === sig) return hit.url
  }
  onProgress?.(`uploading source video (${Math.round(st.size / (1024 * 1024))} MB)…`)
  const buf = await readFile(path)
  const file = new File([buf], basename(path), { type: 'video/mp4' })
  const url = await fal.storage.upload(file)
  videoUploadCache.set(cacheKey ?? path, { sig, url })
  if (videoUploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = videoUploadCache.keys().next().value
    if (oldest) videoUploadCache.delete(oldest)
  }
  return url
}

export async function runEdit(opts: EditOpts): Promise<RenderOutput> {
  acquireFalKey(opts.falKey)
  try {
    return await runEditInner(opts)
  } finally {
    releaseFalKey()
  }
}

async function runEditInner(opts: EditOpts): Promise<RenderOutput> {
  const model = modelFor(opts.engine)
  const caps = model.v2v
  if (!caps) throw new Error(`${model.label} cannot edit video`)

  const videoUrl = await uploadVideoCached(opts.video, opts.cacheKey, opts.onProgress)
  const input: Record<string, unknown> = { prompt: opts.prompt, video_url: videoUrl }

  opts.onProgress?.(`submitting edit to ${model.label}…`)
  let result: unknown
  try {
    result = await fal.subscribe(caps.endpoint, {
      input,
      logs: true,
      onQueueUpdate: (u: { status?: string }) => {
        if (u.status === 'IN_PROGRESS') opts.onProgress?.('editing on fal…')
        else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
      }
    })
  } catch (e) {
    // same policy as renders: surface fal's 422 detail + sent field NAMES, never the payload
    const err = e as { status?: number; body?: unknown; message?: string }
    const body = err.body as { detail?: unknown } | undefined
    const detail = body?.detail ?? err.body ?? err.message ?? String(e)
    throw new Error(
      `fal ${err.status ?? ''} @ ${caps.endpoint} :: ` +
        (typeof detail === 'string' ? detail : JSON.stringify(detail)) +
        ` :: sent fields: ${Object.keys(input).join(', ')}`
    )
  }

  const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  const url: string | undefined = out?.video?.url ?? out?.video_url ?? out?.url ?? out?.output?.url
  if (!url) throw new Error('No video URL in fal edit result: ' + JSON.stringify(out).slice(0, 400))

  opts.onProgress?.('downloading result…')
  await mkdir(opts.outDir, { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) throw new Error('downloaded an empty file')
  const outPath = join(opts.outDir, `edit_${Date.now()}.mp4`)
  await writeFile(outPath, bytes)
  opts.onProgress?.('done')
  const reported = out?.video?.duration
  return { file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined }
}
