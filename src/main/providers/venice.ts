import { randomUUID } from 'crypto'
// Venice adapter — the FIFTH direct-key provider (docs/VENICE-SPEC-2026-09-08.md, list 14). Facts
// re-read 2026-09-30 at docs.venice.ai (Video Queue / Retrieve / Quote + the Seedance 2.0 & 2.5 guide):
//   quote   POST https://api.venice.ai/api/v1/video/quote     Authorization: Bearer <key>
//           { model, duration: '5s', resolution, aspect_ratio?, audio, reference_video_total_duration? }
//           → { quote } in USD. Spends nothing; the ONLY honest price (every video model is variable).
//   submit  POST …/video/queue  the quote fields + prompt, bitrate_mode, image_url / end_image_url |
//           reference_image_urls[] / reference_video_urls[] / reference_audio_urls[] → { model, queue_id }
//   poll    POST …/video/retrieve { model, queue_id } → JSON { status: 'PROCESSING' } while it runs;
//           the BODY becomes video/mp4 bytes when it is done. There is no failed status: a failed job
//           answers non-200 with the recorded error.
//   Media rides as http urls or DATA URLs — no upload endpoint. The JSON body caps at 35 MB and a
//   single file at 25 MB (413). No cancel endpoint. No seed.
//   The i2v models take NO aspect_ratio (400) — the frame's own shape decides.
//   Person-bearing media is refused on the public Seedance API (a content-policy error).
//   Ref grammar in the prompt: <Image 1> <Video 1> <Audio 1> — the app's positional @image1 /
//   @video1 / @audio1 are rewritten here, on the wire, for both Clip Gen and the Video Editor.
import { readFile, mkdir, stat } from 'fs/promises'
import { extname, join } from 'path'
import { saveResponseTo, type RenderRequest, type RenderOutput } from '../fal'
import { landVariants } from '../falImage'
import { REGION_LINE } from '@koan/vidancer-ui/shared/imageModels'
import { probeFile } from '../export'
import { modelFor } from '@koan/vidancer-ui/shared/models'
import type { EngineId } from '@koan/vidancer-ui/shared/types'

const BASE = 'https://api.venice.ai/api/v1'
const BODY_MAX = 35 * 1024 * 1024 // their documented JSON ceiling
const FILE_MAX = 25 * 1024 * 1024 // their 413 line

export interface VeniceRenderOpts extends RenderRequest {
  veniceKey: string
  veniceModel: string // the Venice model id for this mode (the descriptor's endpoints; t2v when a ref2v carries no refs)
  maxSec: number // the family's longest output (2.0: 15 · 2.5: 30)
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

// the model id for this mode (a ref2v with nothing attached is their text-to-video model: the
// reference model refuses a request with no refs) and the family's longest output
export function veniceLane(engine: EngineId | undefined, mode: 'ref2v' | 'i2v', hasRefs: boolean): { veniceModel: string; maxSec: number } {
  const m = modelFor(engine)
  return { veniceModel: (mode === 'ref2v' && !hasRefs ? m.endpoints.t2v : m.endpoints[mode]) ?? 'seedance-2-0-text-to-video-basic', maxSec: Math.max(...m.durations.map(Number).filter((n) => n > 0), 15) }
}

const authHeaders = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })

// their error bodies: { error: string } | { error: { code, message } } | { code, error } (+ details)
function errorDetail(text: string): string {
  try {
    const j = JSON.parse(text) as Record<string, any>
    const e = j.error
    const msg = typeof e === 'string' ? e : (e?.message ?? j.message ?? '')
    return [typeof e === 'object' && e?.code ? e.code : j.code, msg].filter(Boolean).join(' ') || text
  } catch {
    return text
  }
}
function veniceErrorText(status: number | string, where: string, detail?: string, sentFields?: string[]): string {
  const hint =
    status === 401 ? ' — check the Venice key (Settings); some models need a Pro plan'
    : status === 402 ? ' — out of Venice credit: top up on venice.ai'
    : status === 413 ? ' — a file is over Venice’s 25 MB limit: trim the window or use a smaller ref'
    : status === 422 ? ' — Venice’s public Seedance API refuses media with people in it'
    : ''
  const fields = sentFields?.length ? ` :: sent fields: ${sentFields.join(', ')}` : ''
  return `error (${status}) @ venice/${where}${detail ? `: ${detail.slice(0, 300)}` : ''}${hint}${fields}`
}

const MIME: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }
async function toDataUrl(path: string): Promise<string> {
  const size = (await stat(path)).size
  if (size > FILE_MAX) throw new Error(veniceErrorText(413, 'encode', `${Math.round(size / (1024 * 1024))} MB file`))
  return `data:${MIME[extname(path).toLowerCase()] ?? 'image/jpeg'};base64,${(await readFile(path)).toString('base64')}`
}

// the app's positional tags → Venice's grammar (angle brackets, capital, a space before the number)
export const veniceTags = (prompt: string): string => prompt.replace(/@(image|video|audio)(\d+)(?!\w)/gi, (_m, kind: string, n: string) => `<${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()} ${n}>`)

async function buildBody(opts: VeniceRenderOpts): Promise<{ quote: Record<string, unknown>; queue: Record<string, unknown> }> {
  const videos = opts.mode === 'ref2v' ? (opts.videos ?? []) : []
  let refVideoSec = 0
  for (const v of videos) refVideoSec += (await probeFile(v)).duration
  // 'auto' = the source's own length (an edit / re-gen); with no video to match it is 5 s
  const asked = opts.duration === 'auto' ? (videos.length ? refVideoSec : 5) : parseFloat(opts.duration) || 5
  const quote: Record<string, unknown> = {
    model: opts.veniceModel,
    duration: `${Math.min(opts.maxSec, Math.max(4, Math.round(asked)))}s`,
    resolution: opts.resolution,
    audio: opts.generateAudio
  }
  // i2v takes no aspect_ratio; elsewhere 'auto' follows the source video when one rides, else 16:9
  if (opts.mode !== 'i2v') quote.aspect_ratio = opts.aspectRatio === 'auto' ? (videos.length ? 'adaptive' : '16:9') : opts.aspectRatio
  if (videos.length) quote.reference_video_total_duration = Math.round(refVideoSec * 10) / 10
  const { reference_video_total_duration: _q, ...shared } = quote
  const queue: Record<string, unknown> = { ...shared, prompt: veniceTags(opts.prompt), bitrate_mode: 'high' } // high always (his answer 09-08); the quote takes no bitrate_mode
  opts.onProgress?.('encoding media for venice…')
  if (opts.mode === 'i2v') {
    queue.image_url = await toDataUrl(opts.images[0])
    if (opts.endImage) queue.end_image_url = await toDataUrl(opts.endImage)
  } else {
    if (opts.images.length) queue.reference_image_urls = await Promise.all(opts.images.map(toDataUrl))
    if (videos.length) queue.reference_video_urls = await Promise.all(videos.map(toDataUrl))
    if (opts.audios?.length) queue.reference_audio_urls = await Promise.all(opts.audios.map(toDataUrl))
  }
  return { quote, queue }
}

// no remote cancel exists — the map lets the Queue's ✕ stop OUR wait (the job runs on, and is billed)
const activeJobs = new Map<string, { cancelled?: boolean }>()
export async function cancelVeniceJob(jobId: string): Promise<boolean> {
  const a = activeJobs.get(jobId)
  if (a) a.cancelled = true
  return false
}

// one retrieve: the finished video lands in outPath ('done'), or the job still runs, or it failed
async function retrieve(queueId: string, model: string, key: string, outPath: string): Promise<'done' | 'running'> {
  const r = await fetch(`${BASE}/video/retrieve`, { method: 'POST', headers: authHeaders(key), body: JSON.stringify({ model, queue_id: queueId }) })
  if (!r.ok) throw Object.assign(new Error(veniceErrorText(r.status, 'retrieve', errorDetail(await r.text().catch(() => '')))), { status: r.status })
  if ((r.headers.get('content-type') ?? '').startsWith('video/')) {
    await saveResponseTo(r, outPath)
    return 'done'
  }
  await r.text().catch(() => '') // { status: 'PROCESSING' | 'COMPLETED', … } — the bytes follow on a later call
  return 'running'
}

export async function runVeniceRender(opts: VeniceRenderOpts): Promise<RenderOutput> {
  if (opts.mode === 'i2v' && !opts.images[0]) throw new Error('start frame missing')
  if (opts.jobId) activeJobs.set(opts.jobId, {})
  try {
    const { quote, queue } = await buildBody(opts)
    const body = JSON.stringify(queue)
    if (body.length > BODY_MAX) throw new Error(`the refs are ${Math.round(body.length / (1024 * 1024))} MB once encoded — Venice takes 35 MB per request. Shorten the video windows or drop a ref. Nothing was spent.`)

    // quote first: the provider's own number, before any money moves. A failed quote never blocks the render.
    let quoteUsd: number | undefined
    try {
      const q = await fetch(`${BASE}/video/quote`, { method: 'POST', headers: authHeaders(opts.veniceKey), body: JSON.stringify(quote) })
      const n = q.ok ? ((await q.json()) as { quote?: number }).quote : undefined
      if (typeof n === 'number' && n >= 0) quoteUsd = n
    } catch {
      // no quote — the row says so
    }
    opts.onProgress?.(`${quoteUsd != null ? `$${quoteUsd.toFixed(2)} quoted` : 'no quote'} — submitting to ${opts.veniceModel} (Venice)…`)

    const r = await fetch(`${BASE}/video/queue`, { method: 'POST', headers: authHeaders(opts.veniceKey), body })
    if (!r.ok) throw new Error(veniceErrorText(r.status, 'queue', errorDetail(await r.text().catch(() => '')), Object.keys(queue)))
    const sub = (await r.json()) as { queue_id?: string }
    if (!sub.queue_id) throw new Error('venice accepted the job but returned no queue id')
    opts.onRequestId?.(sub.queue_id, opts.veniceModel)

    await mkdir(opts.outDir, { recursive: true })
    const outPath = join(opts.outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    const deadline = Date.now() + 45 * 60 * 1000 // a wedged upstream must not block the serial queue forever
    let failures = 0
    let told = false
    for (;;) {
      if (opts.jobId && activeJobs.get(opts.jobId)?.cancelled) throw new Error('cancelled (the Venice job itself cannot be stopped — if it finishes it is collected on the next project open)')
      if (Date.now() > deadline) throw new Error('status polling timed out after 45min — if the job still finishes upstream it is recovered on the next project open')
      try {
        if ((await retrieve(sub.queue_id, opts.veniceModel, opts.veniceKey, outPath)) === 'done') break
        failures = 0
      } catch (e) {
        // a recorded job failure (4xx) is final; a network blip or a 5xx/429 burst must never throw
        // away a minutes-long PAID render
        const st = (e as { status?: number }).status
        if ((st && st >= 400 && st < 500 && st !== 429) || ++failures > 5) throw e
        await new Promise((res) => setTimeout(res, Math.min(30000, 3000 * failures)))
        continue
      }
      if (!told) {
        told = true
        opts.onProgress?.('rendering on venice…')
      }
      await new Promise((res) => setTimeout(res, 3000))
    }
    opts.onProgress?.('done')
    return { file: outPath, costUsd: quoteUsd }
  } finally {
    if (opts.jobId) activeJobs.delete(opts.jobId)
  }
}

// crash recovery — the queue id + model (kept as the pending entry's endpoint) collect a finished job
export async function fetchVeniceResult(
  queueId: string,
  model: string,
  key: string,
  outDir: string
): Promise<{ state: 'done'; file: string; durationSec?: number } | { state: 'running' } | { state: 'gone' }> {
  try {
    await mkdir(outDir, { recursive: true })
    const outPath = join(outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    return (await retrieve(queueId, model, key, outPath)) === 'done' ? { state: 'done', file: outPath } : { state: 'running' }
  } catch (e) {
    const st = (e as { status?: number }).status
    return st && st >= 400 && st < 500 && st !== 401 && st !== 402 && st !== 429 ? { state: 'gone' } : { state: 'running' } // expired / failed upstream = gone; a key or network problem = try again next open
  }
}

// GET /api_keys/rate_limits — authenticated, spends nothing: the Settings test AND the Bridge row's balance
export async function veniceBalance(key: string): Promise<{ ok: true; usd: number; diem: number } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${BASE}/api_keys/rate_limits`, { headers: authHeaders(key) })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected — check the Venice API key (venice.ai → Settings → API)' }
    if (!r.ok) return { ok: false, error: `Venice API error ${r.status}` }
    const b = ((await r.json()) as { data?: { balances?: { USD?: number; DIEM?: number } } }).data?.balances
    return { ok: true, usd: Number(b?.USD) || 0, diem: Number(b?.DIEM) || 0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
export async function validateVeniceKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const b = await veniceBalance(key)
  return b.ok ? { ok: true } : { ok: false, error: b.error }
}

// ---- Image Edit on the Venice key (list 9 / 50). Read 2026-09-30, docs.venice.ai:
//   edit      POST /image/multi-edit { modelId: '<slug>-edit', prompt, images: [base, …refs] (data URLs),
//             aspect_ratio? (absent = the base's own), resolution, output_format, safe_mode } → the image BYTES
//   generate  POST /image/generate { model, prompt, aspect_ratio, resolution, format, return_binary, seed? } → bytes
// One image per call. safe_mode is OFF (theirs is ON by default and blurs what it flags — a blurred
// result is a paid-for wrong image); hide_watermark ON. No mask input: `drawn` models only.
const VENICE_ASPECTS = ['1:1', '3:2', '16:9', '21:9', '9:16', '2:3', '3:4', '4:3', '4:5']

export interface VeniceImageOpts {
  prompt: string
  baseImage?: string // absent = text-to-image
  refImages: string[]
  numImages: number
  seed?: number
  aspectRatio: string
  resolution?: string
  maskImage?: string // a selection: the outline is already drawn on the base; REGION_LINE rides after the prompt
  veniceKey: string
  veniceModel: string // the generation id (the VIA row's slug); its edit door is `${slug}-edit`
  outDir: string
  onProgress?: (msg: string) => void
}

export async function runVeniceImage(opts: VeniceImageOpts): Promise<{ files: string[]; seed?: number }> {
  const region = !!(opts.baseImage && opts.maskImage)
  const aspect = region ? 'auto' : opts.aspectRatio // a selection keeps the base's own shape
  const prompt = region ? `${opts.prompt.trimEnd()}\n\n${REGION_LINE}` : opts.prompt
  let where: string
  let body: Record<string, unknown>
  if (opts.baseImage) {
    opts.onProgress?.('encoding image(s) for venice…')
    where = 'image/multi-edit'
    body = { modelId: `${opts.veniceModel}-edit`, prompt, images: await Promise.all([opts.baseImage, ...opts.refImages].map(toDataUrl)), output_format: 'png', safe_mode: false }
    if (VENICE_ASPECTS.includes(aspect)) body.aspect_ratio = aspect
  } else {
    where = 'image/generate'
    body = { model: opts.veniceModel, prompt, aspect_ratio: VENICE_ASPECTS.includes(aspect) ? aspect : '1:1', format: 'png', return_binary: true, safe_mode: false, hide_watermark: true }
  }
  if (opts.resolution) body.resolution = opts.resolution
  const seeded = !opts.baseImage && typeof opts.seed === 'number' && opts.seed >= 0 // only their generate door takes one
  const n = Math.max(1, Math.min(4, opts.numImages))
  opts.onProgress?.(`generating on venice${n > 1 ? ` (${n} at once)` : ''}…`)
  const one = async (i: number): Promise<string> => {
    let r: Response
    try {
      r = await fetch(`${BASE}/${where}`, { method: 'POST', headers: authHeaders(opts.veniceKey), body: JSON.stringify(seeded ? { ...body, seed: opts.seed! + i } : body), signal: AbortSignal.timeout(300_000) })
    } catch (e) {
      throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'no answer from venice after 5 minutes' : veniceErrorText('network', where, e instanceof Error ? e.message : String(e)))
    }
    if (!r.ok) throw new Error(veniceErrorText(r.status, where, errorDetail(await r.text().catch(() => '')), Object.keys(body)))
    if (r.headers.get('x-venice-is-content-violation') === 'true') throw new Error(veniceErrorText('refused', where, 'Venice flagged this as a content violation'))
    if (!(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('venice returned no image: ' + (await r.text().catch(() => '')).slice(0, 200))
    await mkdir(opts.outDir, { recursive: true })
    const file = join(opts.outDir, `edit_${randomUUID()}.png`)
    await saveResponseTo(r, file)
    return file
  }
  return { files: await landVariants(n, one, opts.onProgress), seed: seeded ? opts.seed : undefined }
}
