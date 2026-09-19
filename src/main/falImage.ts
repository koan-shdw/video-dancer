import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { imageModelFor, imageSizePreset, REGION_LINE } from '@koan/vidancer-ui/shared/imageModels'
import { acquireFalKey, releaseFalKey, falErrorText } from './fal'

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
  // MODEL row (UI-ROUND-SPEC-2026-09-19 §6) — absent = Nano Banana, every older caller unchanged
  model?: string
  resolution?: string // the model's output-size dial, when it has one
  quality?: string // GPT Image 2's dial
  // SELECT: a white-inside / black-outside PNG at the base image's exact pixel size. A `mask`
  // model gets it as mask_url; a `drawn` model already has the outline painted on its base by the
  // renderer and gets REGION_LINE after the prompt (paste-back happens in index.ts, on the CLEAN base)
  maskImage?: string
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
  const model = imageModelFor(opts.model)
  const editing = !!opts.baseImage
  const endpoint = editing ? model.editEndpoint : model.generateEndpoint
  const region = editing && opts.maskImage ? model.region : null

  const input: Record<string, unknown> = {
    prompt: region === 'drawn' ? `${opts.prompt.trimEnd()}\n\n${REGION_LINE}` : opts.prompt,
    num_images: Math.max(1, Math.min(model.maxVariants, opts.numImages)),
    output_format: 'png'
  }
  // a selection pins the frame to the base's own shape: the mask must line up, and paste-back
  // needs the same aspect back
  const aspect = region ? 'auto' : opts.aspectRatio
  if (model.sizing === 'aspect') {
    // t2i has no 'auto' aspect — coerce to its default
    input.aspect_ratio = !editing && aspect === 'auto' ? '1:1' : aspect
    if (model.resolutions) input.resolution = model.resolutions.includes(opts.resolution ?? '') ? opts.resolution : model.resolutions[0]
  } else {
    input.image_size = !editing && aspect === 'auto' ? 'square_hd' : imageSizePreset(model, aspect, opts.resolution)
  }
  if (model.qualities) input.quality = model.qualities.includes(opts.quality ?? '') ? opts.quality : model.qualities[0]
  if (model.seed && typeof opts.seed === 'number' && opts.seed >= 0) input.seed = opts.seed

  if (editing) {
    opts.onProgress?.('uploading image(s)…')
    const urls: string[] = [await uploadLocal(opts.baseImage!)]
    for (const p of opts.refImages.slice(0, model.maxImages - 1)) urls.push(await uploadLocal(p))
    input.image_urls = urls
    if (region === 'mask') input.mask_url = await uploadLocal(opts.maskImage!)
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
    throw new Error(falErrorText(e, endpoint, Object.keys(input)))
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
