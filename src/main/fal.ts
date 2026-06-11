import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir } from 'fs/promises'
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

export async function runRender(opts: RenderOpts): Promise<RenderOutput> {
  fal.config({ credentials: opts.falKey })
  try {
    return await runRenderInner(opts)
  } finally {
    fal.config({ credentials: '' }) // never leave the key sitting in the fal client's global state
  }
}

// builds the engine-specific input payload — every difference between models lives in the
// capability descriptor + this switch, nowhere else
async function buildInput(opts: RenderOpts, urls: string[]): Promise<Record<string, unknown>> {
  const engine = opts.engine ?? 'seedance2'
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
  const endpoint = model.endpoints[opts.mode]
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
