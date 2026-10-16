import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { nativeImage } from 'electron'
import { imageModelFor, imageSizePreset, pixelSize, REGION_LINE } from '@koan/vidancer-ui/shared/imageModels'
import { acquireFalKey, releaseFalKey, falErrorText } from './fal'
import { assertNotStopped, markProviderAccepted } from './jobNotifications'

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
  background?: string // list 8: GPT Image 2.5's background dial ('transparent' = a see-through PNG)
  thinking?: string // Nano Banana 2.1's thinking_level (minimal / medium / high)
  rewrite?: boolean // Krea 3's rewrite switch (fal's enable_prompt_expansion); absent = on, Krea's default
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

// ModelArk and Google make ONE image per call: several variants = several calls at once. The ones
// that land are kept even if one fails (paid) and the failure is named; all failing = the error.
export async function landVariants<T = string>(n: number, one: (i: number) => Promise<T>, onProgress?: (msg: string) => void): Promise<T[]> {
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => one(i)))
  const files = settled.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []))
  const failed = settled.find((x): x is PromiseRejectedResult => x.status === 'rejected')
  if (!files.length) throw failed?.reason instanceof Error ? failed.reason : new Error(String(failed?.reason))
  if (failed) onProgress?.(`${files.length} of ${n} made — ${failed.reason instanceof Error ? failed.reason.message : String(failed.reason)}`)
  else onProgress?.('done')
  return files
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

  const n = Math.max(1, Math.min(model.maxVariants, opts.numImages))
  const input: Record<string, unknown> = {
    prompt: region === 'drawn' ? `${opts.prompt.trimEnd()}\n\n${REGION_LINE}` : opts.prompt,
    output_format: 'png'
  }
  if (!model.onePerCall) input.num_images = n // Krea 3 takes none: each variant is its own call (below)
  // a selection pins the frame to the base's own shape: the mask must line up, and paste-back
  // needs the same aspect back
  const aspect = region ? 'auto' : opts.aspectRatio
  if (model.sizing === 'aspect') {
    // t2i has no 'auto' aspect — coerce to its default
    input.aspect_ratio = !editing && aspect === 'auto' ? '1:1' : aspect
    if (model.resolutions) input.resolution = model.resolutions.includes(opts.resolution ?? '') ? opts.resolution : model.resolutions[0]
  } else if (model.sizing === 'pixels') {
    const base = editing && aspect === 'auto' ? nativeImage.createFromPath(opts.baseImage!) : undefined
    input.image_size = pixelSize(!editing && aspect === 'auto' ? '1:1' : aspect, opts.resolution, base && !base.isEmpty() ? base.getSize() : undefined)
  } else {
    input.image_size = !editing && aspect === 'auto' ? 'square_hd' : imageSizePreset(model, aspect, opts.resolution)
  }
  if (model.qualities) input.quality = model.qualities.includes(opts.quality ?? '') ? opts.quality : model.qualities[0]
  if (model.backgrounds) input.background = model.backgrounds.includes(opts.background ?? '') ? opts.background : model.backgrounds[0]
  if (model.thinking) input.thinking_level = model.thinking.includes(opts.thinking ?? '') ? opts.thinking : model.thinking[0]
  if (model.rewrite) input.enable_prompt_expansion = opts.rewrite !== false
  if (model.seed && typeof opts.seed === 'number' && opts.seed >= 0) input.seed = opts.seed

  if (editing) {
    opts.onProgress?.('uploading image(s)…')
    const urls: string[] = [await uploadLocal(opts.baseImage!)]
    for (const p of opts.refImages.slice(0, model.maxImages - 1)) urls.push(await uploadLocal(p))
    input.image_urls = urls
    if (region === 'mask') input.mask_url = await uploadLocal(opts.maskImage!)
  }

  opts.onProgress?.(`generating with ${model.label}…`)
  assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
  const call = async (i: number): Promise<Record<string, any>> => {
    // a onePerCall model: a set seed steps by one per variant (Google's lane does the same)
    const body = i > 0 && typeof input.seed === 'number' ? { ...input, seed: input.seed + i } : input
    let result: unknown
    try {
      result = await fal.subscribe(endpoint, {
        input: body,
        logs: true,
        onEnqueue: () => markProviderAccepted(), // fal has the job: never sent again (audit 2026-10-09 batch 2)
        onQueueUpdate: (u: { status?: string }) => {
          if (u.status === 'IN_PROGRESS') opts.onProgress?.('generating…')
          else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
        }
      })
    } catch (e) {
      throw new Error(falErrorText(e, endpoint, Object.keys(body)))
    }
    return (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  }
  // every call that lands is kept (paid); one failing is named in the progress line
  const outs = model.onePerCall ? await landVariants(n, call, (m) => m !== 'done' && opts.onProgress?.(m)) : [await call(0)]
  const out = outs[0]
  const urls = outs.flatMap((o) => ((o?.images ?? []) as Array<{ url?: string }>).map((i) => i?.url).filter((u): u is string => !!u))
  if (urls.length === 0) throw new Error('No images in fal result: ' + JSON.stringify(Object.keys(out)).slice(0, 200))

  opts.onProgress?.('downloading result(s)…')
  await mkdir(opts.outDir, { recursive: true })
  // each paid variant lands on its own: one failed download never throws the others away (audit 2026-10-09 L8)
  const files = await landVariants(urls.length, async (i) => {
    const res = await fetch(urls[i])
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error('downloaded an empty file')
    const file = join(opts.outDir, `edit_${randomUUID()}.png`)
    await writeFile(file, bytes)
    return file
  }, opts.onProgress)
  const seed = typeof out?.seed === 'number' ? out.seed : undefined
  return { files, seed }
}
