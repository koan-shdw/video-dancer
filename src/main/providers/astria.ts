import { randomUUID } from 'crypto'
// Astria adapter — the FOURTH render provider. Astria serves Seedance 2 through its prompts API
// (docs.astria.ai/docs/features/video/, read 2026-08-08): video generation rides ON a prompt
// resource, not a dedicated endpoint. No presigned uploads — keyframe images travel INLINE as
// multipart binaries in the create call.
//   submit  POST https://api.astria.ai/tunes/{TUNE}/prompts   Authorization: Bearer <key>
//           multipart form: prompt[video_model] (e.g. seedance2_720p — RESOLUTION lives in the
//           model id), prompt[video_prompt], prompt[video_duration] (4-15 int),
//           prompt[aspect_ratio], prompt[video_first_frame] / prompt[video_last_frame] (binaries).
//           `prompt[text]` is NOT required for t2v models or when a first frame is provided.
//   poll    GET  …/prompts/{id}.json — the docs don't publish the result fields, so the extractor
//           tolerates every plausible home for the mp4 url (videos[] / images[] / video_url / url).
//   cancel  none documented — cancelAstriaJob is an honest no-op (the ✕ still stops OUR waiting).
// The path needs SOME tune id even for base-model video gens; 1504944 is Astria's shared
// Flux1.dev base tune, hard-coded across their own docs examples.
import { readFile, writeFile, mkdir } from 'fs/promises'
import { extname, join } from 'path'
import type { RenderRequest, RenderOutput } from '../fal'

const BASE = 'https://api.astria.ai'
const BASE_TUNE = 1504944 // Flux1.dev shared base tune (docs-blessed) — video params ignore it

export interface AstriaRenderOpts extends RenderRequest {
  astriaKey: string
  astriaModelBase: string // 'seedance2' — resolution is appended here (seedance2_720p)
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` } // NO content-type — fetch stamps the multipart boundary
}

function astriaErrorText(status: number | string, where: string, detail?: string, sentFields?: string[]): string {
  const auth = status === 401 || status === 403
  const hint = auth ? ' — usually the Astria key (Settings) or an out-of-credits account' : ''
  const fields = sentFields?.length ? ` :: sent fields: ${sentFields.join(', ')}` : ''
  return `error (${status}) @ astria/${where}${detail ? `: ${detail.slice(0, 300)}` : ''}${hint}${fields}`
}

function mimeFor(p: string): string {
  const e = extname(p).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  return 'image/jpeg'
}

// Astria's seedance2 family encodes resolution in the model id — compose it here so the registry
// keeps the app-wide '480p'|'720p'|'1080p' vocabulary
function modelIdFor(base: string, resolution: string): string {
  const res = ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p'
  return `${base}_${res}`
}

// find the finished mp4 wherever this response shape put it (result fields are undocumented)
function videoUrlOf(body: Record<string, any>): string | undefined {
  const isMp4 = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/.+\.(mp4|mov)(\?|$)/i.test(u)
  const fromArr = (a: unknown): string | undefined => {
    if (!Array.isArray(a)) return undefined
    for (const v of a) {
      if (isMp4(v)) return v
      const u = (v as Record<string, unknown>)?.url
      if (isMp4(u)) return u
    }
    return undefined
  }
  return fromArr(body?.videos) ?? fromArr(body?.images) ?? (isMp4(body?.video_url) ? body.video_url : undefined) ?? (isMp4(body?.url) ? body.url : undefined)
}

// no remote cancel exists on Astria's API — the map still lets the Queue's ✕ stop OUR polling wait
const activeJobs = new Map<string, { promptId?: string; cancelled?: boolean }>()
export async function cancelAstriaJob(jobId: string): Promise<boolean> {
  const a = activeJobs.get(jobId)
  if (!a) return false
  a.cancelled = true
  return false // the upstream job runs on (their credits are spent either way) — be honest about it
}

async function pollUntilDone(promptId: string, key: string, jobId: string | undefined, onProgress?: (m: string) => void): Promise<Record<string, any>> {
  let told = false
  let failures = 0
  // Astria documents NO terminal failure status — a prompt that dies without an error string
  // would poll forever; the deadline is the only backstop
  const deadline = Date.now() + 45 * 60 * 1000
  for (;;) {
    if (jobId && activeJobs.get(jobId)?.cancelled) throw new Error('cancelled (the Astria job itself cannot be stopped remotely)')
    if (Date.now() > deadline)
      throw new Error('status polling timed out after 45min — if the prompt still finishes upstream it is recovered on the next project open')
    let body: Record<string, any>
    try {
      const r = await fetch(`${BASE}/tunes/${BASE_TUNE}/prompts/${promptId}.json`, { headers: authHeaders(key) })
      if (!r.ok) throw new Error(astriaErrorText(r.status, `prompts/${promptId}`, await r.text().catch(() => '')))
      body = (await r.json()) as Record<string, any>
      failures = 0
    } catch (e) {
      // one bad poll must never throw away a minutes-long PAID render — tolerate a burst
      if (++failures > 5) throw e
      await new Promise((res) => setTimeout(res, Math.min(30000, 5000 * failures)))
      continue
    }
    const err = body?.error ?? body?.user_error
    if (typeof err === 'string' && err) throw new Error(astriaErrorText('failed', 'render', err))
    const url = videoUrlOf(body)
    if (url) return body
    if (!told) {
      told = true
      onProgress?.('rendering on astria…')
    }
    await new Promise((res) => setTimeout(res, 5000)) // video prompts take minutes — 5s is polite
  }
}

async function buildForm(opts: AstriaRenderOpts, modelId: string): Promise<FormData> {
  const fd = new FormData()
  fd.append('prompt[video_model]', modelId)
  fd.append('prompt[video_prompt]', opts.prompt)
  const dur = Math.min(15, Math.max(4, Math.round(parseFloat(opts.duration) || 5))) // Astria seedance2: 4-15s
  fd.append('prompt[video_duration]', String(dur))
  if (opts.aspectRatio && opts.aspectRatio !== 'auto') fd.append('prompt[aspect_ratio]', opts.aspectRatio)
  if (opts.mode === 'i2v') {
    const first = await readFile(opts.images[0])
    fd.append('prompt[video_first_frame]', new Blob([new Uint8Array(first)], { type: mimeFor(opts.images[0]) }), 'first_frame' + extname(opts.images[0]))
    if (opts.endImage) {
      const last = await readFile(opts.endImage)
      fd.append('prompt[video_last_frame]', new Blob([new Uint8Array(last)], { type: mimeFor(opts.endImage) }), 'last_frame' + extname(opts.endImage))
    }
  }
  return fd
}

export async function runAstriaRender(opts: AstriaRenderOpts): Promise<RenderOutput> {
  if (opts.mode === 'i2v' && !opts.images[0]) throw new Error('start frame missing')
  // the engine caps refs at 0, so this only fires if a stored clip smuggles them in
  if (opts.mode === 'ref2v' && (opts.images.length || opts.videos?.length || opts.audios?.length))
    throw new Error('Astria takes no reference media over its API — plain t2v or first/last-frame i2v only')
  const modelId = modelIdFor(opts.astriaModelBase, opts.resolution)
  if (opts.jobId) activeJobs.set(opts.jobId, {})
  try {
    const fd = await buildForm(opts, modelId)
    opts.onProgress?.(`submitting to ${modelId} (Astria)…`)
    const r = await fetch(`${BASE}/tunes/${BASE_TUNE}/prompts`, { method: 'POST', headers: authHeaders(opts.astriaKey), body: fd })
    if (!r.ok) throw new Error(astriaErrorText(r.status, 'submit', await r.text().catch(() => ''), [...fd.keys()]))
    const sub = (await r.json()) as { id?: number | string }
    if (sub.id == null) throw new Error('astria accepted the job but returned no prompt id')
    const promptId = String(sub.id)
    if (opts.jobId) activeJobs.set(opts.jobId, { promptId })
    opts.onRequestId?.(promptId, modelId)

    const done = await pollUntilDone(promptId, opts.astriaKey, opts.jobId, opts.onProgress)
    const url = videoUrlOf(done)
    if (!url) throw new Error('no video URL in astria result: ' + JSON.stringify(done).slice(0, 400))

    opts.onProgress?.('downloading result…')
    await mkdir(opts.outDir, { recursive: true })
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error('downloaded an empty file')
    const outPath = join(opts.outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await writeFile(outPath, bytes)
    opts.onProgress?.('done')
    return { file: outPath }
  } finally {
    if (opts.jobId) activeJobs.delete(opts.jobId)
  }
}

// crash recovery: prompts persist on Astria's side, same contract as the other providers
export async function fetchAstriaResult(
  promptId: string,
  key: string,
  outDir: string
): Promise<{ state: 'done'; file: string; durationSec?: number } | { state: 'running' } | { state: 'gone' }> {
  try {
    const r = await fetch(`${BASE}/tunes/${BASE_TUNE}/prompts/${promptId}.json`, { headers: authHeaders(key) })
    if (r.status === 404 || r.status === 400 || r.status === 422) return { state: 'gone' }
    if (!r.ok) return { state: 'running' }
    const body = (await r.json()) as Record<string, any>
    const err = body?.error ?? body?.user_error
    if (typeof err === 'string' && err) return { state: 'gone' }
    const url = videoUrlOf(body)
    if (!url) return { state: 'running' }
    await mkdir(outDir, { recursive: true })
    const res = await fetch(url)
    if (!res.ok) return { state: 'running' }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) return { state: 'running' }
    const outPath = join(outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await writeFile(outPath, bytes)
    return { state: 'done', file: outPath }
  } catch {
    return { state: 'running' }
  }
}

// cheap key validation for Settings: list tunes — 401/403 = bad key. Never spends credits.
export async function validateAstriaKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${BASE}/tunes`, { headers: authHeaders(key) })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected — check the Astria API key (astria.ai → Account → API)' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
