import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { basename, extname, join } from 'path'

// Verified fal Seedance 2 endpoints (2026-06-08): two separate apps.
//  - ref2v: prompt + image_urls[] (up to 9), first/last via @mention in prompt
//  - i2v:   prompt + image_url (start) [+ end_image_url (end)]
const ENDPOINT = {
  ref2v: 'bytedance/seedance-2.0/reference-to-video',
  i2v: 'bytedance/seedance-2.0/image-to-video'
} as const

export interface RenderRequest {
  mode: 'ref2v' | 'i2v'
  prompt: string
  images: string[] // local file paths
  endImage?: string // i2v end frame (local path), optional
  duration: string // "auto" | "4".."15"
  resolution: string // "480p" | "720p" | "1080p"
  aspectRatio: string // "auto" | "16:9" | ...
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

export async function runSeedance(opts: RenderOpts): Promise<string> {
  fal.config({ credentials: opts.falKey })

  opts.onProgress?.('uploading image(s)…')
  const urls: string[] = []
  for (const p of opts.images) urls.push(await uploadLocal(p))

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

  opts.onProgress?.(`submitting to Seedance 2 (${opts.mode})…`)
  let result: unknown
  try {
    result = await fal.subscribe(ENDPOINT[opts.mode], {
      input,
      logs: true,
      onQueueUpdate: (u: { status?: string }) => {
        if (u.status === 'IN_PROGRESS') opts.onProgress?.('rendering on fal…')
        else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
      }
    })
  } catch (e) {
    // surface fal's validation detail (422 body) so we can see the exact bad field
    const err = e as { status?: number; body?: unknown; message?: string }
    const body = err.body as { detail?: unknown } | undefined
    const detail = body?.detail ?? err.body ?? err.message ?? String(e)
    throw new Error(
      `fal ${err.status ?? ''} @ ${ENDPOINT[opts.mode]} :: ` +
        (typeof detail === 'string' ? detail : JSON.stringify(detail)) +
        ` :: sent ${JSON.stringify(input)}`
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
  return outPath
}
