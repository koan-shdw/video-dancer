import { randomUUID } from 'crypto'
// Higgsfield platform adapter — the SECOND render provider (fal.ts is the first). Same
// RenderRequest in, same RenderOutput out, so index.ts dispatches by the engine's `provider`.
// API mechanics verified against docs.higgsfield.ai + the official SDK source 2026-07-31:
//   auth    Authorization: Key <api-key>:<api-secret>   (one combined string in settings.hfKey)
//   upload  POST /files/generate-upload-url {content_type} → {upload_url, public_url}; PUT bytes
//   submit  POST /{application} with the argument object AS the json body → {request_id, ...}
//   poll    GET /requests/{id}/status → queued | in_progress | nsfw | failed | completed | cancelled
//   cancel  POST /requests/{id}/cancel (only while queued)
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { downloadTo, type RenderRequest, type RenderOutput } from '../fal'
import { assertNotStopped, markProviderAccepted } from '../jobNotifications'

const BASE = 'https://platform.higgsfield.ai'

export interface HfRenderOpts extends RenderRequest {
  hfKey: string // "api-key:api-secret"
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

function authHeaders(hfKey: string): Record<string, string> {
  return { Authorization: `Key ${hfKey}`, 'Content-Type': 'application/json' }
}

// human-first error text, mirroring falErrorText's shape and rules (never leak payload contents)
function hfErrorText(status: number | string, endpoint: string, detail?: string, sentFields?: string[]): string {
  const auth = status === 401 || status === 403
  const hint = auth ? ' — usually the Higgsfield key (Settings) or your plan (API needs Creator)' : ''
  const fields = sentFields?.length ? ` :: sent fields: ${sentFields.join(', ')}` : ''
  return `error (${status}) @ higgsfield/${endpoint}${detail ? `: ${detail.slice(0, 300)}` : ''}${hint}${fields}`
}

function mimeFor(p: string): string {
  const e = extname(p).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  if (e === '.mp4') return 'video/mp4'
  if (e === '.mov') return 'video/quicktime'
  if (e === '.wav') return 'audio/wav'
  if (e === '.mp3') return 'audio/mpeg'
  return 'image/jpeg'
}

// upload cache — Higgsfield public_urls are stable; project media is immutable (same policy as fal.ts)
const uploadCache = new Map<string, { sig: string; url: string }>()
const UPLOAD_CACHE_MAX = 60

async function uploadLocal(path: string, hfKey: string, onProgress?: (m: string) => void): Promise<string> {
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  const hit = uploadCache.get(path)
  if (hit && hit.sig === sig) return hit.url
  const contentType = mimeFor(path)
  const r = await fetch(`${BASE}/files/generate-upload-url`, {
    method: 'POST',
    headers: authHeaders(hfKey),
    body: JSON.stringify({ content_type: contentType })
  })
  if (!r.ok) throw new Error(hfErrorText(r.status, 'files/generate-upload-url', await r.text().catch(() => '')))
  const { upload_url, public_url } = (await r.json()) as { upload_url?: string; public_url?: string }
  if (!upload_url || !public_url) throw new Error('higgsfield upload: no upload_url/public_url in response')
  if (st.size > 8 * 1024 * 1024) onProgress?.(`uploading ${basename(path)} (${Math.round(st.size / (1024 * 1024))} MB)…`)
  const buf = await readFile(path)
  const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(buf) })
  if (!put.ok) throw new Error(hfErrorText(put.status, 'upload PUT', await put.text().catch(() => '')))
  uploadCache.set(path, { sig, url: public_url })
  if (uploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = uploadCache.keys().next().value
    if (oldest) uploadCache.delete(oldest)
  }
  return public_url
}

// in-flight requests by queue-job id — the Queue's ✕ cancels the REMOTE job (queued-only upstream)
const activeJobs = new Map<string, { requestId?: string }>()
export async function cancelHfJob(jobId: string, hfKey: string): Promise<boolean> {
  const a = activeJobs.get(jobId)
  if (!a?.requestId) return false
  try {
    const r = await fetch(`${BASE}/requests/${a.requestId}/cancel`, { method: 'POST', headers: authHeaders(hfKey) })
    return r.ok
  } catch {
    return false
  }
}

// pull the result URL out of a completed status payload — shape tolerated wide (like fal.ts does):
// { video: {url} } · { videos: [{url}] } · { result: { video... } } · bare { url }
function videoUrlOf(out: Record<string, any>): string | undefined {
  const v = out?.video ?? out?.result?.video ?? out?.videos?.[0] ?? out?.result?.videos?.[0]
  return (typeof v === 'string' ? v : v?.url) ?? out?.video_url ?? out?.url
}

async function pollUntilDone(
  requestId: string,
  hfKey: string,
  onProgress?: (m: string) => void
): Promise<Record<string, any>> {
  let lastStatus = ''
  let failures = 0
  const deadline = Date.now() + 45 * 60 * 1000 // a wedged upstream must not block the serial queue forever
  for (;;) {
    if (Date.now() > deadline)
      throw new Error('status polling timed out after 45min — if the job still finishes upstream it is recovered on the next project open')
    let body: Record<string, any>
    try {
      const r = await fetch(`${BASE}/requests/${requestId}/status`, { headers: authHeaders(hfKey) })
      if (!r.ok) throw new Error(hfErrorText(r.status, `requests/${requestId}/status`, await r.text().catch(() => '')))
      body = (await r.json()) as Record<string, any>
      failures = 0
    } catch (e) {
      // ONE bad poll (5xx blip, dropped socket) must never throw away a minutes-long PAID
      // render — tolerate a burst with backoff (recovery still holds the entry if we give up)
      if (++failures > 5) throw e
      await new Promise((res) => setTimeout(res, Math.min(30000, 2000 * failures)))
      continue
    }
    const status = String(body.status ?? '').toLowerCase()
    if (status !== lastStatus) {
      lastStatus = status
      onProgress?.(status === 'in_progress' ? 'rendering on higgsfield…' : status.replace(/_/g, ' '))
    }
    if (status === 'completed') return body
    if (status === 'failed') throw new Error(hfErrorText('failed', 'render', typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? '').slice(0, 200)))
    if (status === 'nsfw') throw new Error('higgsfield flagged the generation nsfw — nothing was produced')
    if (status === 'cancelled') throw new Error('cancelled on higgsfield')
    await new Promise((res) => setTimeout(res, 2000)) // renders take minutes — 2s is polite and plenty
  }
}

// build the seedance_2_0 argument object from the app-wide RenderRequest (field names follow the
// CLI catalog's snake_case flags; media ride as uploaded public URLs)
async function buildArgs(opts: HfRenderOpts): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio,
    duration: Math.max(1, Math.round(parseFloat(opts.duration) || 5)), // integer seconds ('auto' → 5)
    resolution: opts.resolution,
    generate_audio: opts.generateAudio
  }
  opts.onProgress?.('uploading media to higgsfield…')
  if (opts.mode === 'i2v') {
    args.start_image = await uploadLocal(opts.images[0], opts.hfKey, opts.onProgress)
    if (opts.endImage) args.end_image = await uploadLocal(opts.endImage, opts.hfKey, opts.onProgress)
  } else {
    if (opts.images.length) {
      const urls: string[] = []
      for (const p of opts.images) urls.push(await uploadLocal(p, opts.hfKey, opts.onProgress))
      args.image_references = urls
    }
  }
  if (opts.videos?.length) {
    const urls: string[] = []
    for (const p of opts.videos) urls.push(await uploadLocal(p, opts.hfKey, opts.onProgress))
    args.video_references = urls
  }
  if (opts.audios?.length) {
    const urls: string[] = []
    for (const p of opts.audios) urls.push(await uploadLocal(p, opts.hfKey, opts.onProgress))
    args.audio_references = urls
  }
  return args
}

export async function runHfRender(opts: HfRenderOpts): Promise<RenderOutput> {
  const endpoint = opts.mode === 'i2v' ? 'seedance_2_0' : 'seedance_2_0' // one application serves both today
  if (opts.mode === 'i2v' && !opts.images[0]) throw new Error('start frame missing')
  if (opts.jobId) activeJobs.set(opts.jobId, {})
  try {
    const args = await buildArgs(opts)
    opts.onProgress?.('submitting to Seedance 2 (Higgsfield)…')
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
    const r = await fetch(`${BASE}/${endpoint}`, { method: 'POST', headers: authHeaders(opts.hfKey), body: JSON.stringify(args) })
    if (!r.ok) throw new Error(hfErrorText(r.status, endpoint, await r.text().catch(() => ''), Object.keys(args)))
    const sub = (await r.json()) as { request_id?: string }
    if (!sub.request_id) throw new Error('higgsfield accepted the job but returned no request_id')
    if (opts.jobId) activeJobs.set(opts.jobId, { requestId: sub.request_id })
    markProviderAccepted() // the supplier has it: never sent again (audit 2026-10-09 batch 2)
    opts.onRequestId?.(sub.request_id, endpoint)

    const done = await pollUntilDone(sub.request_id, opts.hfKey, opts.onProgress)
    const url = videoUrlOf(done)
    if (!url) throw new Error('no video URL in higgsfield result: ' + JSON.stringify(done).slice(0, 400))

    opts.onProgress?.('downloading result…')
    await mkdir(opts.outDir, { recursive: true })
    const outPath = join(opts.outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(url, outPath)
    opts.onProgress?.('done')
    const reported = done?.video?.duration ?? done?.result?.video?.duration
    return { file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined }
  } finally {
    if (opts.jobId) activeJobs.delete(opts.jobId)
  }
}

// crash recovery: ask Higgsfield about a previously-submitted request (mirrors fal.fetchRenderResult)
export async function fetchHfResult(
  requestId: string,
  hfKey: string,
  outDir: string
): Promise<{ state: 'done'; file: string; durationSec?: number } | { state: 'running' } | { state: 'gone' }> {
  try {
    const r = await fetch(`${BASE}/requests/${requestId}/status`, { headers: authHeaders(hfKey) })
    if (r.status === 404 || r.status === 400 || r.status === 422) return { state: 'gone' }
    if (!r.ok) return { state: 'running' } // network/5xx — retry next open
    const body = (await r.json()) as Record<string, any>
    const status = String(body.status ?? '').toLowerCase()
    if (status === 'failed' || status === 'nsfw' || status === 'cancelled') return { state: 'gone' }
    if (status !== 'completed') return { state: 'running' }
    const url = videoUrlOf(body)
    if (!url) return { state: 'gone' }
    await mkdir(outDir, { recursive: true })
        const outPath = join(outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(url, outPath)
    const reported = body?.video?.duration
    return { state: 'done', file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined }
  } catch {
    return { state: 'running' }
  }
}

// cheap key validation for Settings: an authenticated status probe — 401/403 = bad key,
// 404 = key fine (the request just doesn't exist). Never spends credits.
export async function validateHfKey(hfKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${BASE}/requests/00000000-0000-0000-0000-000000000000/status`, { headers: authHeaders(hfKey) })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected — check the api-key:api-secret pair (and that your plan includes API access)' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
