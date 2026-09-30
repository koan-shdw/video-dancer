import { randomUUID } from 'crypto'
// BytePlus ModelArk adapter — ByteDance's OFFICIAL Seedance API, the third render provider.
// Docs read in full 2026-07-31 (docs.byteplus.com/en/docs/ModelArk/1520757):
//   submit  POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
//           Authorization: Bearer <ARK_API_KEY>
//           { model, content: [ {type:'text',text}, {type:'image_url',image_url:{url},role},
//             {type:'audio_url',audio_url:{url},role:'reference_audio'} … ],
//             resolution, ratio, duration, generate_audio, watermark, safety_identifier }
//   images/audio may be BASE64 data-urls (body ≤64MB) — no hosting needed. Videos need PUBLIC
//   urls, which is why the seedance2ark engine parks video refs at 0 for now.
//   poll    GET  …/tasks/{id} → status queued|running|succeeded|failed|expired (+cancelled)
//   cancel  DELETE …/tasks/{id} (docs: "Cancel or delete a video generation task")
//   tasks live 7 days server-side — plenty for crash recovery.
import { readFile, writeFile, mkdir } from 'fs/promises'
import { extname, join } from 'path'
import { nativeImage } from 'electron'
import { REGION_LINE } from '@koan/vidancer-ui/shared/imageModels'
import { downloadTo, type RenderRequest, type RenderOutput } from '../fal'
import { landVariants } from '../falImage'

const BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3'

export interface ArkRenderOpts extends RenderRequest {
  arkKey: string
  arkModel: string // dated ModelArk model id — comes from the engine descriptor's endpoints
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

function authHeaders(arkKey: string): Record<string, string> {
  return { Authorization: `Bearer ${arkKey}`, 'Content-Type': 'application/json' }
}

function arkErrorText(status: number | string, where: string, detail?: string, sentFields?: string[]): string {
  const auth = status === 401 || status === 403
  const hint = auth ? ' — usually the ModelArk key (Settings) or the model not activated in your BytePlus console' : ''
  const fields = sentFields?.length ? ` :: sent fields: ${sentFields.join(', ')}` : ''
  return `error (${status}) @ modelark/${where}${detail ? `: ${detail.slice(0, 300)}` : ''}${hint}${fields}`
}

// images + audio go inline as base64 data-urls — the docs bless this up to a 64MB body
async function toDataUrl(path: string): Promise<string> {
  const e = extname(path).toLowerCase()
  const mime =
    e === '.png' ? 'image/png'
    : e === '.webp' ? 'image/webp'
    : e === '.gif' ? 'image/gif'
    : e === '.bmp' ? 'image/bmp'
    : e === '.wav' ? 'audio/wav'
    : e === '.mp3' ? 'audio/mpeg'
    : 'image/jpeg'
  const buf = await readFile(path)
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function buildBody(opts: ArkRenderOpts, model: string): Promise<Record<string, unknown>> {
  const content: Record<string, unknown>[] = []
  if (opts.prompt.trim()) content.push({ type: 'text', text: opts.prompt })
  opts.onProgress?.('encoding media for modelark…')
  if (opts.mode === 'i2v') {
    // first/last-frame scenario — roles are REQUIRED when an end frame rides along
    content.push({ type: 'image_url', image_url: { url: await toDataUrl(opts.images[0]) }, ...(opts.endImage ? { role: 'first_frame' } : {}) })
    if (opts.endImage) content.push({ type: 'image_url', image_url: { url: await toDataUrl(opts.endImage) }, role: 'last_frame' })
  } else {
    for (const p of opts.images) content.push({ type: 'image_url', image_url: { url: await toDataUrl(p) }, role: 'reference_image' })
  }
  if (opts.videos?.length) throw new Error('ModelArk video refs need public URLs — not wired yet (the engine caps them at 0)')
  for (const p of opts.audios ?? []) content.push({ type: 'audio_url', audio_url: { url: await toDataUrl(p) }, role: 'reference_audio' })

  const body: Record<string, unknown> = {
    model,
    content,
    resolution: opts.resolution === '4k' ? '4K' : opts.resolution, // Ark spells it uppercase
    ratio: opts.aspectRatio === 'auto' ? 'adaptive' : opts.aspectRatio,
    duration: opts.duration === 'auto' ? -1 : Math.max(4, Math.round(parseFloat(opts.duration) || 5)),
    generate_audio: opts.generateAudio,
    watermark: false
  }
  if (opts.endUserId) body.safety_identifier = opts.endUserId
  return body
}

const activeJobs = new Map<string, { taskId?: string }>()
export async function cancelArkJob(jobId: string, arkKey: string): Promise<boolean> {
  const a = activeJobs.get(jobId)
  if (!a?.taskId) return false
  try {
    const r = await fetch(`${BASE}/contents/generations/tasks/${a.taskId}`, { method: 'DELETE', headers: authHeaders(arkKey) })
    return r.ok
  } catch {
    return false
  }
}

// result shape per docs: the retrieve payload carries content.video_url when succeeded
function videoUrlOf(body: Record<string, any>): string | undefined {
  return body?.content?.video_url ?? body?.video_url ?? body?.content?.video?.url ?? body?.result?.video_url
}

async function pollUntilDone(taskId: string, arkKey: string, onProgress?: (m: string) => void): Promise<Record<string, any>> {
  let last = ''
  let failures = 0
  const deadline = Date.now() + 45 * 60 * 1000 // a wedged upstream must not block the serial queue forever
  for (;;) {
    if (Date.now() > deadline)
      throw new Error('status polling timed out after 45min — if the task still finishes upstream it is recovered on the next project open')
    let body: Record<string, any>
    try {
      const r = await fetch(`${BASE}/contents/generations/tasks/${taskId}`, { headers: authHeaders(arkKey) })
      if (!r.ok) throw new Error(arkErrorText(r.status, `tasks/${taskId}`, await r.text().catch(() => '')))
      body = (await r.json()) as Record<string, any>
      failures = 0
    } catch (e) {
      // one bad poll must never throw away a minutes-long PAID render — tolerate a burst
      if (++failures > 5) throw e
      await new Promise((res) => setTimeout(res, Math.min(30000, 3000 * failures)))
      continue
    }
    const status = String(body.status ?? '').toLowerCase()
    if (status !== last) {
      last = status
      onProgress?.(status === 'running' ? 'rendering on modelark…' : status.replace(/_/g, ' '))
    }
    if (status === 'succeeded') return body
    if (status === 'failed') {
      const err = body?.error?.message ?? body?.error ?? ''
      throw new Error(arkErrorText('failed', 'render', typeof err === 'string' ? err : JSON.stringify(err).slice(0, 250)))
    }
    if (status === 'expired') throw new Error('modelark task expired before completing')
    if (status === 'cancelled') throw new Error('cancelled on modelark')
    await new Promise((res) => setTimeout(res, 3000))
  }
}

export async function runArkRender(opts: ArkRenderOpts): Promise<RenderOutput> {
  const model = opts.arkModel
  if (opts.mode === 'i2v' && !opts.images[0]) throw new Error('start frame missing')
  if (opts.jobId) activeJobs.set(opts.jobId, {})
  try {
    const body = await buildBody(opts, model)
    opts.onProgress?.('submitting to Seedance 2 (ModelArk)…')
    const r = await fetch(`${BASE}/contents/generations/tasks`, { method: 'POST', headers: authHeaders(opts.arkKey), body: JSON.stringify(body) })
    if (!r.ok) throw new Error(arkErrorText(r.status, 'submit', await r.text().catch(() => ''), Object.keys(body)))
    const sub = (await r.json()) as { id?: string }
    if (!sub.id) throw new Error('modelark accepted the job but returned no task id')
    if (opts.jobId) activeJobs.set(opts.jobId, { taskId: sub.id })
    opts.onRequestId?.(sub.id, model)

    const done = await pollUntilDone(sub.id, opts.arkKey, opts.onProgress)
    const url = videoUrlOf(done)
    if (!url) throw new Error('no video URL in modelark result: ' + JSON.stringify(done).slice(0, 400))

    opts.onProgress?.('downloading result…')
    await mkdir(opts.outDir, { recursive: true })
    const outPath = join(opts.outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(url, outPath)
    opts.onProgress?.('done')
    const reported = done?.content?.duration ?? done?.duration
    return { file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined }
  } finally {
    if (opts.jobId) activeJobs.delete(opts.jobId)
  }
}

// crash recovery — tasks persist 7 days upstream, same contract as the other providers
export async function fetchArkResult(
  taskId: string,
  arkKey: string,
  outDir: string
): Promise<{ state: 'done'; file: string; durationSec?: number } | { state: 'running' } | { state: 'gone' }> {
  try {
    const r = await fetch(`${BASE}/contents/generations/tasks/${taskId}`, { headers: authHeaders(arkKey) })
    if (r.status === 404 || r.status === 400) return { state: 'gone' }
    if (!r.ok) return { state: 'running' }
    const body = (await r.json()) as Record<string, any>
    const status = String(body.status ?? '').toLowerCase()
    if (status === 'failed' || status === 'expired' || status === 'cancelled') return { state: 'gone' }
    if (status !== 'succeeded') return { state: 'running' }
    const url = videoUrlOf(body)
    if (!url) return { state: 'gone' }
    await mkdir(outDir, { recursive: true })
        const outPath = join(outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(url, outPath)
    // the live path reports content.duration — recovery must not lose the metadata it can see
    const reported = body?.content?.duration ?? body?.duration
    return { state: 'done', file: outPath, ...(typeof reported === 'number' && reported > 0 ? { durationSec: reported } : {}) }
  } catch {
    return { state: 'running' }
  }
}

// cheap key validation: list tasks (page of 1) — 401/403 = bad key; anything authed = fine.
// Never creates a task, never spends tokens.
export async function validateArkKey(arkKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${BASE}/contents/generations/tasks?page_size=1`, { headers: authHeaders(arkKey) })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected — check the ModelArk API key (and that Seedance is activated in your BytePlus console)' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- list 10: Seedream 5.0 on ModelArk's IMAGE API (read 09-30, docs.byteplus.com ModelArk "Image
// generation API"): POST /images/generations answers in the same call (no task to poll), ONE image
// per call (5.0 Pro / Flash have no batch), up to 10 input images as data URLs, a watermark unless
// told not to. size = '1K' | '1.5K' | '2K' (the model picks the shape) or WxH, 921,600..4,624,220 px.
const ARK_SIZES: Record<string, Record<string, string>> = {
  '1K': { '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '16:9': '1424x800', '9:16': '800x1424', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1568x672' },
  '1.5K': { '1:1': '1536x1536', '4:3': '1792x1344', '3:4': '1344x1792', '16:9': '2048x1152', '9:16': '1152x2048', '3:2': '1872x1248', '2:3': '1248x1872', '21:9': '2352x1008' },
  '2K': { '1:1': '2048x2048', '4:3': '2368x1776', '3:4': '1776x2368', '16:9': '2816x1584', '9:16': '1584x2816', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' }
}
const TIER_SIDE: Record<string, number> = { '1K': 1024, '1.5K': 1536, '2K': 2048 }

// a named aspect = the doc's own table; 'auto' on an edit = the base's exact shape at the tier's
// pixel count (paste-back needs the same shape back); otherwise the tier word
export function arkImageSize(aspect: string, resolution?: string, base?: { width: number; height: number }): string {
  const tier = ARK_SIZES[resolution ?? ''] ? resolution! : '2K'
  if (ARK_SIZES[tier][aspect]) return ARK_SIZES[tier][aspect]
  if (aspect === 'auto' && base && base.width > 0 && base.height > 0) {
    const px = TIER_SIDE[tier] ** 2
    const r = Math.min(16, Math.max(1 / 16, base.width / base.height))
    const w = Math.round(Math.sqrt(px * r) / 16) * 16
    const h = Math.round(Math.sqrt(px / r) / 16) * 16
    if (w * h >= 921600 && w * h <= 4624220) return `${w}x${h}`
  }
  return tier
}

export interface ArkImageOpts {
  prompt: string
  baseImage?: string // absent = text-to-image
  refImages: string[]
  numImages: number
  aspectRatio: string
  resolution?: string
  maskImage?: string // a selection: the outline is already drawn on the base; REGION_LINE rides after the prompt
  arkKey: string
  arkModel: string // the ModelArk model id (the VIA row's slug)
  outDir: string
  onProgress?: (msg: string) => void
}

export async function runArkImage(opts: ArkImageOpts): Promise<{ files: string[]; seed?: number }> {
  const region = !!(opts.baseImage && opts.maskImage) // Seedream is a `drawn` model on every supplier
  const base = opts.baseImage ? nativeImage.createFromPath(opts.baseImage) : undefined
  const body: Record<string, unknown> = {
    model: opts.arkModel,
    prompt: region ? `${opts.prompt.trimEnd()}\n\n${REGION_LINE}` : opts.prompt,
    size: arkImageSize(region ? 'auto' : opts.aspectRatio, opts.resolution, base && !base.isEmpty() ? base.getSize() : undefined),
    output_format: 'png',
    response_format: 'url',
    watermark: false
  }
  const inputs = [...(opts.baseImage ? [opts.baseImage] : []), ...opts.refImages].slice(0, 10)
  if (inputs.length) {
    opts.onProgress?.('encoding image(s) for modelark…')
    body.image = await Promise.all(inputs.map(toDataUrl))
  }
  const n = Math.max(1, Math.min(4, opts.numImages))
  opts.onProgress?.(`generating on modelark${n > 1 ? ` (${n} at once)` : ''}…`)
  const one = async (): Promise<string> => {
    let r: Response
    try {
      r = await fetch(`${BASE}/images/generations`, { method: 'POST', headers: authHeaders(opts.arkKey), body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) })
    } catch (e) {
      throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'no answer from modelark after 5 minutes' : arkErrorText('network', 'images', e instanceof Error ? e.message : String(e)))
    }
    const text = await r.text().catch(() => '')
    let out: Record<string, any> = {}
    try {
      out = JSON.parse(text) as Record<string, any>
    } catch {
      // not JSON — the status line carries it
    }
    if (!r.ok || out.error) {
      const err = out.error as { code?: string; message?: string } | undefined
      throw new Error(arkErrorText(r.ok ? 'failed' : r.status, 'images', err?.message ? `${err.code ?? ''} ${err.message}`.trim() : text, Object.keys(body)))
    }
    const url = ((out.data ?? []) as Array<{ url?: string }>).map((d) => d?.url).find((u): u is string => !!u)
    if (!url) throw new Error('modelark returned no image: ' + text.slice(0, 200))
    await mkdir(opts.outDir, { recursive: true })
    const file = join(opts.outDir, `edit_${randomUUID()}.png`)
    await downloadTo(url, file)
    return file
  }
  return { files: await landVariants(n, one, opts.onProgress) }
}
