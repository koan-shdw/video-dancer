import { randomUUID } from 'crypto'
// list 9 (2026-09-30): Nano Banana 2 and Pro straight from Google, on his Google key (the one Watch
// uses). Gemini API Interactions (read 09-30, ai.google.dev "Image generation" + the Interactions
// reference): POST /v1beta/interactions { model, input: [text + image blocks], response_format:
// { type: 'image', aspect_ratio, image_size }, generation_config: { seed } } answers in the same
// call with ONE image, a content block { type: 'image', mime_type, data (base64) } in a
// model_output step. No aspect_ratio = the input's own shape (or 1:1). SynthID on every image.
import { readFile, writeFile, mkdir } from 'fs/promises'
import { extname, join } from 'path'
import { REGION_LINE } from '@koan/vidancer-ui/shared/imageModels'
import { landVariants } from '../falImage'

const API = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }

export interface GoogleImageOpts {
  prompt: string
  baseImage?: string // absent = text-to-image
  refImages: string[]
  numImages: number
  seed?: number
  aspectRatio: string
  resolution?: string
  maskImage?: string // a selection: the outline is already drawn on the base; REGION_LINE rides after the prompt
  googleKey: string
  googleModel: string // the Gemini model id (the VIA row's slug)
  outDir: string
  onProgress?: (msg: string) => void
}

const mimeOf = (p: string): string => {
  const e = extname(p).toLowerCase()
  return e === '.png' ? 'image/png' : e === '.webp' ? 'image/webp' : 'image/jpeg'
}

export async function runGoogleImage(opts: GoogleImageOpts): Promise<{ files: string[]; seed?: number }> {
  const region = !!(opts.baseImage && opts.maskImage) // the Nano family is `drawn`
  const input: Record<string, unknown>[] = [{ type: 'text', text: region ? `${opts.prompt.trimEnd()}\n\n${REGION_LINE}` : opts.prompt }]
  const inputs = [...(opts.baseImage ? [opts.baseImage] : []), ...opts.refImages].slice(0, 14)
  if (inputs.length) opts.onProgress?.('encoding image(s) for google…')
  for (const p of inputs) input.push({ type: 'image', mime_type: mimeOf(p), data: (await readFile(p)).toString('base64') })
  const format: Record<string, unknown> = { type: 'image' }
  const aspect = region ? 'auto' : opts.aspectRatio // a selection keeps the base's own shape
  if (aspect !== 'auto') format.aspect_ratio = aspect
  if (opts.resolution) format.image_size = opts.resolution === '0.5K' ? '512' : opts.resolution
  const seeded = typeof opts.seed === 'number' && opts.seed >= 0
  const n = Math.max(1, Math.min(4, opts.numImages))
  opts.onProgress?.(`generating on google${n > 1 ? ` (${n} at once)` : ''}…`)
  // one image per call: several variants = several calls; a set seed steps by one per variant
  const one = async (i: number): Promise<string> => {
    const body = { model: opts.googleModel, input, response_format: format, ...(seeded ? { generation_config: { seed: opts.seed! + i } } : {}) }
    let r: Response
    try {
      r = await fetch(API, { method: 'POST', headers: { 'x-goog-api-key': opts.googleKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) })
    } catch (e) {
      throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'no answer from google after 5 minutes' : `error (network) @ google/interactions: ${e instanceof Error ? e.message : String(e)}`)
    }
    const text = await r.text().catch(() => '')
    let out: Record<string, any> = {}
    try {
      out = JSON.parse(text) as Record<string, any>
    } catch {
      // not JSON — the status line carries it
    }
    if (!r.ok) {
      const hint = r.status === 401 || r.status === 403 ? ' — check the Google key in Settings, and that its project may use this model' : ''
      throw new Error(`error (${r.status}) @ google/interactions: ${String(out.error?.message ?? text).slice(0, 300)}${hint}`)
    }
    // the image is the last image block of the model's output (thought steps carry interim drafts)
    const blocks = ((out.steps ?? []) as Array<{ type?: string; content?: Array<Record<string, any>> }>).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? [])
    const img = blocks.filter((b) => b.type === 'image' && typeof b.data === 'string').pop()
    if (!img) {
      const said = blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join(' ').trim()
      throw new Error(`google returned no image (${out.status ?? 'no status'})${said ? `: ${said.slice(0, 250)}` : ''}`)
    }
    await mkdir(opts.outDir, { recursive: true })
    const file = join(opts.outDir, `edit_${randomUUID()}${EXT[String(img.mime_type)] ?? '.png'}`)
    await writeFile(file, Buffer.from(img.data as string, 'base64'))
    return file
  }
  const files = await landVariants(n, one, opts.onProgress)
  return { files, seed: seeded ? opts.seed : undefined }
}
