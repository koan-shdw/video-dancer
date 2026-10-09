import { randomUUID } from 'crypto'
// list 9 (2026-09-30): Nano Banana 2 and Pro straight from Google, on his Google key (the one Watch
// uses). Gemini API Interactions (read 09-30, ai.google.dev "Image generation" + the Interactions
// reference): POST /v1beta/interactions { model, input: [text + image blocks], response_format:
// { type: 'image', aspect_ratio, image_size }, generation_config: { seed } } answers in the same
// call with ONE image, a content block { type: 'image', mime_type, data (base64) } in a
// model_output step. No aspect_ratio = the input's own shape (or 1:1). SynthID on every image.
import { readFile, writeFile, mkdir } from 'fs/promises'
import { extname, join } from 'path'
import * as electron from 'electron'
import { REGION_LINE } from '@koan/vidancer-ui/shared/imageModels'
import { landVariants } from '../falImage'
import { downloadTo } from '../fal'
import { uploadFile } from '../watch'
import { assertNotStopped, markProviderAccepted } from '../jobNotifications'

export const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta'
const API = `${GOOGLE_API}/interactions`

// one JSON POST on the Google key (voices, speech, music) — Google's own message on a failure
export async function googlePost(path: string, key: string, body: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
  const r = await fetch(`${GOOGLE_API}/${path}`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const text = await r.text().catch(() => '')
  let j: Record<string, any> = {}
  try {
    j = JSON.parse(text) as Record<string, any>
  } catch {
    // not JSON — the status line carries it
  }
  if (!r.ok) throw new Error(`error (${r.status}) @ google/${path}: ${String(j.error?.message ?? text).slice(0, 300)}${r.status === 401 || r.status === 403 ? ' — check the Google key in Settings' : ''}`)
  return j
}
// an Interactions reply's content blocks of one type, from the model's output only
export const googleBlocks = (out: Record<string, any>, type: string): Array<Record<string, any>> =>
  ((out.steps ?? []) as Array<{ type?: string; content?: Array<Record<string, any>> }>)
    .filter((x) => x.type === 'model_output')
    .flatMap((x) => x.content ?? [])
    .filter((b) => b.type === type)
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
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
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
    markProviderAccepted() // the supplier answered: paid, never sent again (audit 2026-10-09 batch 2)
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

// ---- list 13 (2026-09-30): EXTEND a video with Gemini Omni Flash 1.1, on the Google key ----
// ai.google.dev/gemini-api/docs/omni (read that day): POST /v1beta/interactions { model:
// 'gemini-omni-1.1-flash', input: [{ type: 'video', uri } , { type: 'text', text }],
// response_format: { type: 'video', delivery: 'uri' } }. "The model analyzes the input video to
// generate a 3–10 second continuation"; "you can extend videos by 10s, up to a total length of
// 40s"; "Input videos for extension must be 10 seconds or less in length when uploading (unless
// using multi-turn)": a video that came out of an earlier extend continues from that interaction
// (`previous_interaction_id`) with no upload. The reply carries the video as a Files uri (or
// inline base64 under 4 MB) and the interaction's id. No length dial exists: the prompt steers
// it. The call answers when the video is made, so it is given fifteen minutes.
// NOT PROVEN against Google (a paid call; his first extend is the probe).
export const OMNI_EXTEND_MODEL = 'gemini-omni-1.1-flash'

export interface GoogleExtendOpts {
  prompt: string
  video?: string // the video to extend, 10 s at most (absent when `previousInteractionId` carries it)
  previousInteractionId?: string // the extend that made this video — Google continues from it
  googleKey: string
  outDir: string
  onProgress?: (msg: string) => void
  signal?: AbortSignal
}

// Electron's own network stack where it exists: a plain fetch gives up on a reply that takes more
// than five minutes to start, and a video can
const longFetch = (url: string, init: RequestInit): Promise<Response> => {
  const net = (electron as { net?: { fetch?: (u: string, i: RequestInit) => Promise<Response> } }).net
  return net?.fetch ? net.fetch(url, init) : fetch(url, init)
}

export async function runGoogleOmniExtend(opts: GoogleExtendOpts): Promise<{ file: string; interactionId?: string }> {
  const say = opts.onProgress ?? (() => {})
  const waited = (): AbortSignal => (opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(15 * 60_000)]) : AbortSignal.timeout(15 * 60_000))
  const body: Record<string, unknown> = { model: OMNI_EXTEND_MODEL, response_format: { type: 'video', delivery: 'uri' } }
  let uploaded: { name: string; uri: string } | undefined
  if (opts.previousInteractionId) {
    body.previous_interaction_id = opts.previousInteractionId
    body.input = opts.prompt
  } else {
    if (!opts.video) throw new Error('nothing to extend')
    say('sending the video to google…')
    uploaded = await uploadFile(opts.googleKey, opts.video, 'video/mp4', opts.signal)
    body.input = [{ type: 'video', uri: uploaded.uri }, { type: 'text', text: opts.prompt }]
  }
  try {
    say('extending on google — this can take a few minutes…')
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
    let r: Response
    try {
      r = await longFetch(API, { method: 'POST', headers: { 'x-goog-api-key': opts.googleKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: waited() })
    } catch (e) {
      throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'no answer from google after 15 minutes' : `error (network) @ google/interactions: ${e instanceof Error ? e.message : String(e)}`)
    }
    const text = await r.text().catch(() => '')
    let out: Record<string, any> = {}
    try {
      out = JSON.parse(text) as Record<string, any>
    } catch {
      // not JSON — the status line carries it
    }
    if (!r.ok) {
      const hint = r.status === 401 || r.status === 403 ? ' — check the Google key in Settings, and that its project is on a paid plan (Omni has no free tier)' : ''
      throw new Error(`error (${r.status}) @ google/interactions: ${String(out.error?.message ?? text).slice(0, 300)}${hint}`)
    }
    markProviderAccepted() // the supplier answered: paid, never sent again (audit 2026-10-09 batch 2)
    const vid = googleBlocks(out, 'video').pop()
    if (!vid) {
      const said = googleBlocks(out, 'text').map((b) => String(b.text)).join(' ').trim()
      throw new Error(`google returned no video (${out.status ?? 'no status'})${said ? `: ${said.slice(0, 250)}` : ''}`)
    }
    await mkdir(opts.outDir, { recursive: true })
    const file = join(opts.outDir, `extend_${randomUUID()}.mp4`)
    if (typeof vid.data === 'string') await writeFile(file, Buffer.from(vid.data, 'base64'))
    else if (typeof vid.uri === 'string') {
      // a Files uri: wait for it to be ready, then fetch the bytes (the key rides in the header)
      const meta = vid.uri.replace(/:download\?.*$/, '')
      say('waiting for the file…')
      for (let i = 0; i < 90; i++) {
        const m = await fetch(meta, { headers: { 'x-goog-api-key': opts.googleKey }, signal: AbortSignal.timeout(30_000) }).then((x) => (x.ok ? (x.json() as Promise<{ state?: string }>) : null)).catch(() => null)
        if (!m || !m.state || m.state === 'ACTIVE') break
        if (m.state === 'FAILED') throw new Error('google could not finish the file')
        await new Promise((res) => setTimeout(res, 2000))
      }
      say('downloading result…')
      const dl = await fetch(/alt=media/.test(vid.uri) ? vid.uri : `${meta}:download?alt=media`, { headers: { 'x-goog-api-key': opts.googleKey }, signal: AbortSignal.timeout(10 * 60_000) })
      if (!dl.ok) throw new Error(`error (${dl.status}) @ google/files: the extended video could not be downloaded`)
      await writeFile(file, Buffer.from(await dl.arrayBuffer()))
    } else throw new Error('google returned a video with no data and no address')
    return { file, interactionId: typeof out.id === 'string' ? out.id : undefined }
  } finally {
    // the upload was only the way in — take it back down
    if (uploaded) void fetch(`${GOOGLE_API}/${uploaded.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': opts.googleKey }, signal: AbortSignal.timeout(15_000) }).catch(() => undefined)
  }
}
