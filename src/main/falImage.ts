import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { NANO_BANANA } from '../shared/imageModels'
import { acquireFalKey, releaseFalKey } from './fal'

// Nano Banana (Gemini 2.5 Flash Image) generation/editing via fal — same hygiene rules as the
// video pipeline: credentials refcounted (renders/edits can overlap this call — see fal.ts),
// errors report field NAMES only, results downloaded into the project (self-contained folders).

export interface ImageGenRequest {
  prompt: string
  baseImage?: string // local path of the image being edited (absent = text-to-image)
  refImages: string[] // local paths of Library reference images
  numImages: number // 1..maxVariants
  seed?: number
  aspectRatio: string // 'auto' only valid when editing
}

export interface ImageGenOpts extends ImageGenRequest {
  falKey: string
  outDir: string // <project>/images/edits
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

export async function runImageGen(opts: ImageGenOpts): Promise<{ files: string[]; seed?: number }> {
  acquireFalKey(opts.falKey)
  try {
    return await runInner(opts)
  } finally {
    releaseFalKey()
  }
}

async function runInner(opts: ImageGenOpts): Promise<{ files: string[]; seed?: number }> {
  const model = NANO_BANANA
  const editing = !!opts.baseImage
  const endpoint = editing ? model.editEndpoint : model.generateEndpoint

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    num_images: Math.max(1, Math.min(model.maxVariants, opts.numImages)),
    output_format: 'png'
  }
  // t2i has no 'auto' aspect — coerce to its default
  input.aspect_ratio = !editing && opts.aspectRatio === 'auto' ? '1:1' : opts.aspectRatio
  if (typeof opts.seed === 'number' && opts.seed >= 0) input.seed = opts.seed

  if (editing) {
    opts.onProgress?.('uploading image(s)…')
    const urls: string[] = [await uploadLocal(opts.baseImage!)]
    for (const p of opts.refImages.slice(0, model.maxImages - 1)) urls.push(await uploadLocal(p))
    input.image_urls = urls
  }

  opts.onProgress?.(`generating with ${model.label}…`)
  let result: unknown
  try {
    result = await fal.subscribe(endpoint, {
      input,
      logs: true,
      onQueueUpdate: (u: { status?: string }) => {
        if (u.status === 'IN_PROGRESS') opts.onProgress?.('generating…')
        else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
      }
    })
  } catch (e) {
    const err = e as { status?: number; body?: unknown; message?: string }
    const body = err.body as { detail?: unknown } | undefined
    const detail = body?.detail ?? err.body ?? err.message ?? String(e)
    throw new Error(
      `fal ${err.status ?? ''} @ ${endpoint} :: ` +
        (typeof detail === 'string' ? detail : JSON.stringify(detail)) +
        ` :: sent fields: ${Object.keys(input).join(', ')}`
    )
  }

  const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  const images = (out?.images ?? []) as Array<{ url?: string }>
  const urls = images.map((i) => i?.url).filter((u): u is string => !!u)
  if (urls.length === 0) throw new Error('No images in fal result: ' + JSON.stringify(Object.keys(out)).slice(0, 200))

  opts.onProgress?.('downloading result(s)…')
  await mkdir(opts.outDir, { recursive: true })
  const files: string[] = []
  for (const url of urls) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error('downloaded an empty file')
    const file = join(opts.outDir, `edit_${randomUUID()}.png`)
    await writeFile(file, bytes)
    files.push(file)
  }
  opts.onProgress?.('done')
  const seed = typeof out?.seed === 'number' ? out.seed : undefined
  return { files, seed }
}
