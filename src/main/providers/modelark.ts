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
import { downloadTo, type RenderRequest, type RenderOutput } from '../fal'

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
