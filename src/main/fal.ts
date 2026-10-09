import { randomUUID } from 'crypto'
import { fal } from '@fal-ai/client'
import { readFile, writeFile, mkdir, stat, rename, rm } from 'fs/promises'
import { basename, extname, join } from 'path'
import { streamBodyToFile } from './runtime'
import { modelFor } from '@koan/vidancer-ui/shared/models'
import type { EngineId } from '@koan/vidancer-ui/shared/types'
import { assertNotStopped, markProviderAccepted } from './jobNotifications'

export interface RenderRequest {
  jobId?: string // queue job id (cancel handle)
  engine?: EngineId // absent = seedance2
  mode: 'ref2v' | 'i2v'
  prompt: string
  images: string[] // local file paths
  imageAssetIds?: (string | null)[]
  endImage?: string // i2v end frame (local path), optional
  endImageAssetId?: string
  videos?: string[] // Seedance @video refs — local paths, already window-cut by the caller
  audios?: string[] // Seedance @audio refs — local paths
  duration: string // engine-dependent (see shared/models.ts)
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  seed?: number
  endUserId?: string // anonymous per-install id — fal's Seedance 2.5 terms require one per request
  draft?: boolean // list 17: Seedance 2.5's Draft — a 480p preview that can be finished at 1080p later
  draftId?: string // list 17: FINISH this Draft at 1080p. The supplier reuses everything else, so nothing else is sent
}

export interface RenderOpts extends RenderRequest {
  falKey: string
  outDir: string
  onProgress?: (msg: string) => void
  // fires the moment fal ACCEPTS the request — crash-recovery bookkeeping (the request id is the
  // handle that lets a restarted app still collect a finished render)
  onRequestId?: (requestId: string, endpoint: string) => void
}

function mimeFor(p: string): string {
  const e = extname(p).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function mimeAudio(p: string): string {
  const types: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.pcm': 'audio/pcm' }
  return types[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

async function uploadLocal(path: string): Promise<string> {
  const buf = await readFile(path)
  const file = new File([buf], basename(path), { type: mimeFor(path) })
  return await fal.storage.upload(file)
}

// one download rule for every provider + recovery path: STREAM to .part (a 200MB result must
// never sit whole in main's heap), verify the byte count when the server declares one, rename
// into place. Previously this block was byte-duplicated ~9 times across providers.
export async function downloadTo(url: string, outPath: string): Promise<void> {
  await saveResponseTo(await fetch(url), outPath)
}
// the same rule for a response that IS the file (Venice's retrieve answers with the mp4 bytes)
export async function saveResponseTo(res: Response, outPath: string): Promise<void> {
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  try {
    // ordered reader loop (bible 12.3) — fromWeb+pipe swapped chunks under backpressure
    const got = await streamBodyToFile(res.body as ReadableStream<Uint8Array>, `${outPath}.part`)
    if (got === 0) throw new Error('downloaded an empty file')
    if (total > 0 && got !== total) throw new Error(`download incomplete (${got}/${total} bytes)`)
  } catch (e) {
    await rm(`${outPath}.part`, { force: true }).catch(() => undefined)
    throw e
  }
  await rename(`${outPath}.part`, outPath)
}

// the @fal-ai/client is a SINGLETON — a render, an edit and an image generation can overlap, and
// whichever finishes first must not blank the credentials out from under the others (their next
// queue poll would 401 a paid job). Refcount: set on first acquire, clear when the last releases.
let falKeyUses = 0
let falKeyCurrent = ''
// fal's client re-sends a SUBMIT by itself on 502/503/504, and has no switch for it. fal may have
// taken the first one, so the re-send would be a second paid job nobody tracks (audit 2026-10-09
// L12). Here a submit that gets a gateway error stops instead, marked taken: never sent again.
const submitOnce: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (init?.method === 'POST' && url.hostname.startsWith('queue.') && !url.pathname.includes('/requests/') && [502, 503, 504].includes(res.status)) {
    markProviderAccepted()
    throw Object.assign(new Error("fal's gateway failed while taking the job, so fal may have it"), { status: res.status })
  }
  return res
}
export function acquireFalKey(key: string): void {
  // a key CHANGED in Settings while a job is mid-flight would silently rebind the first job's
  // polling to the new credentials — warn loudly (the old job's next poll may 401)
  if (falKeyUses > 0 && falKeyCurrent && falKeyCurrent !== key)
    console.error('[fal] key changed while a job is in flight — earlier job polling now uses the NEW key')
  falKeyCurrent = key
  falKeyUses++
  fal.config({ credentials: key, fetch: submitOnce })
}
export function releaseFalKey(): void {
  falKeyUses = Math.max(0, falKeyUses - 1)
  if (falKeyUses === 0) fal.config({ credentials: '', fetch: submitOnce }) // never leave the key sitting in global state
}

// in-flight fal requests by queue-job id — the Queue panel's ✕ cancels the REMOTE job (best
// effort: once fal finishes it, the money is spent and the result lands anyway)
const activeJobs = new Map<string, { endpoint: string; requestId?: string }>()
export async function cancelFalJob(jobId: string): Promise<boolean> {
  const a = activeJobs.get(jobId)
  if (!a?.requestId) return false
  try {
    await fal.queue.cancel(a.endpoint, { requestId: a.requestId })
    return true
  } catch {
    return false // already running to completion — can't be stopped
  }
}
// exported: scoreRender.ts registers its jobs in the SAME map so the Queue's ✕ cancels them too
// the request id = fal has the job: marked accepted (never sent again), and kept for the ✕ cancel
// called right before each fal submit: a ✕ pressed during the uploads stops it here (audit 2026-10-09 H12)
export function trackJob(jobId: string | undefined, endpoint: string): (rid: string) => void {
  assertNotStopped()
  if (jobId) activeJobs.set(jobId, { endpoint })
  return (requestId: string) => {
    markProviderAccepted()
    if (jobId) activeJobs.set(jobId, { endpoint, requestId })
  }
}
export function untrackJob(jobId: string | undefined): void {
  if (jobId) activeJobs.delete(jobId)
}

export async function runRender(opts: RenderOpts): Promise<RenderOutput> {
  acquireFalKey(opts.falKey)
  try {
    return await runRenderInner(opts)
  } finally {
    if (opts.jobId) activeJobs.delete(opts.jobId)
    releaseFalKey()
  }
}

// builds the engine-specific input payload — every difference between models lives in the
// capability descriptor + this switch, nowhere else
async function buildInput(opts: RenderOpts, urls: string[], videoUrls: string[], audioUrls: string[]): Promise<Record<string, unknown>> {
  const engine = opts.engine ?? 'seedance2'
  if (engine === 'omniflash' || engine === 'omniflash11') {
    // Gemini Omni Flash (fal OpenAPI 2026-07-02): prompt + INT duration 3-10 + aspect 16:9|9:16.
    // No seed, no audio toggle, no resolution — sending unknown fields risks a 422. Zero refs
    // means the base t2v endpoint (which takes no image fields at all).
    // 1.1 (fal v1.1 pages, 2026-09-30) adds a resolution on every mode and an end frame on i2v.
    const v11 = engine === 'omniflash11'
    const base: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio === '9:16' ? '9:16' : '16:9',
      duration: Math.min(10, Math.max(3, parseInt(opts.duration, 10) || 8)),
      ...(v11 ? { resolution: ['360p', '720p', '1080p', '4k'].includes(opts.resolution) ? opts.resolution : '720p' } : {})
    }
    if (opts.mode === 'i2v') return { ...base, image_url: urls[0], ...(v11 && opts.endImage ? { end_image_url: await uploadLocal(opts.endImage) } : {}) }
    // list 13: 1.1's reference door also takes up to three video refs of 3 s each (its schema, read
    // 09-30: reference_video_urls). Refs of either kind route there; none at all = plain t2v.
    const vids = v11 ? videoUrls.slice(0, 3) : []
    if (urls.length > 0 || vids.length > 0) return { ...base, ...(urls.length ? { image_urls: urls } : {}), ...(vids.length ? { reference_video_urls: vids } : {}) }
    return base
  }
  if (engine === 'h3maxlipsync') {
    // H3 Max Lip Sync (fal OpenAPI read 2026-09-30, LipSyncImageInput): the picture, the voice, a
    // size. No prompt, no duration (the video is as long as the voice), no aspect (it follows the picture).
    if (!urls[0] || !audioUrls[0]) throw new Error('H3 Max Lip Sync needs one picture and one voice')
    const size = { '480p': '480P', '768p': '768P', '1080p': '1080P', '2k': '2K' }[opts.resolution] ?? '768P'
    return { image_url: urls[0], audio_url: audioUrls[0], resolution: size }
  }
  if (engine === 'sora2') {
    // Sora 2 i2v (fal OpenAPI): prompt + image_url (FIRST frame only) + aspect/resolution + INT duration.
    // No generate_audio (always on), no seed, no end frame — sending unknown fields risks a 422.
    return {
      prompt: opts.prompt,
      image_url: urls[0],
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: parseInt(opts.duration, 10) || 4
    }
  }
  // seedance2 / seedance25 (same input family; the differences are seed + array strictness)
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    resolution: opts.resolution,
    duration: opts.duration,
    aspect_ratio: opts.aspectRatio,
    generate_audio: opts.generateAudio
  }
  // 2.5's schema has NO seed input (output-only) — sending one risks a 422
  if (engine !== 'seedance25' && typeof opts.seed === 'number' && opts.seed >= 0) input.seed = opts.seed
  // fal's Seedance 2.5 terms require a per-request end-user id; 2.0's schema takes it too
  if (opts.endUserId) input.end_user_id = opts.endUserId
  if (engine === 'seedance25' && opts.draft) input.draft = true // list 17: fal renders it at 480p whatever size is picked
  if (opts.mode === 'i2v') {
    input.image_url = urls[0]
    if (opts.endImage) input.end_image_url = await uploadLocal(opts.endImage)
  } else if (engine === 'seedance25') {
    // omit empty arrays — 2.5 is early access and empty-array minItems behavior is unverified
    if (urls.length) input.image_urls = urls
    if (videoUrls.length) input.video_urls = videoUrls
    if (audioUrls.length) input.audio_urls = audioUrls
  } else {
    input.image_urls = urls // 2.0: unconditional, exactly the proven behavior (empty = t2v-style)
    if (videoUrls.length) input.video_urls = videoUrls
    if (audioUrls.length) input.audio_urls = audioUrls
  }
  return input
}

// human-first fal error text — shared by renders, edits and image gens. NEVER leads with fal's
// bare HTTP words: "Forbidden" reads like a content block when it's really billing/auth. Shape:
// `error (403) @ endpoint: <fal's own detail> — usually the fal key or credit…`. Sent field NAMES
// only — the payload (prompt text, signed urls) never leaks into logs/UI.
export function falErrorText(e: unknown, endpoint: string, sentFields?: string[]): string {
  const err = e as { status?: number; body?: unknown; message?: string }
  const body = err.body as { detail?: unknown } | undefined
  const raw = body?.detail ?? err.body ?? err.message ?? String(e)
  let detail = typeof raw === 'string' ? raw : JSON.stringify(raw)
  if (/^(forbidden|unauthorized|payment required)\.?$/i.test((detail ?? '').trim())) detail = '' // the bare word says nothing
  const auth = err.status === 401 || err.status === 402 || err.status === 403
  const hint = auth ? ' — usually the fal key or credit (check Settings / your fal balance)' : ''
  const fields = sentFields?.length ? ` :: sent fields: ${sentFields.join(', ')}` : ''
  return `error (${err.status ?? '?'}) @ ${endpoint}${detail ? `: ${detail}` : ''}${hint}${fields}`
}

export interface RenderOutput {
  file: string
  costUsd?: number // the supplier's own price for this render when it gives one (Venice's quote)
  durationSec?: number // actual rendered length when fal reports it (sora2 does; seedance2 may not)
  draftId?: string // list 17: a Draft's id — what finishes it at 1080p
}
// list 17: fal's door that finishes a Seedance 2.5 Draft (its schema, read 09-30: { draft_id,
// resolution: '1080p' only, codec }). H264 is asked for so the file plays wherever the app plays video.
export const FAL_DRAFT_COMPLETE = 'bytedance/seedance-2.5/draft/complete'

async function runRenderInner(opts: RenderOpts): Promise<RenderOutput> {
  const model = modelFor(opts.engine)
  // list 17: finishing a Draft sends its id and nothing else — no uploads, no prompt
  if (opts.draftId) return submitAndLand(FAL_DRAFT_COMPLETE, { draft_id: opts.draftId, resolution: '1080p', codec: 'H264' }, opts, `${model.label} (finishing the draft at 1080p)`)
  let endpoint = model.endpoints[opts.mode]
  // a ref2v render with zero refs OF ANY KIND is plain text-to-video — engines with a dedicated
  // t2v endpoint (Omni Flash: reference-to-video REQUIRES 1-10 images) route there instead
  const refless = opts.images.length === 0 && !opts.videos?.length && !opts.audios?.length
  if (opts.mode === 'ref2v' && refless && model.endpoints.t2v) endpoint = model.endpoints.t2v
  if (!endpoint) throw new Error(`${model.label} does not support ${opts.mode}`)

  opts.onProgress?.('uploading image(s)…')
  const urls: string[] = []
  for (const p of opts.images) urls.push(await uploadLocal(p))

  // Seedance multimodal refs — guard fal's hard size caps BEFORE any money/time is spent
  const videoUrls: string[] = []
  const audioUrls: string[] = []
  if (opts.videos?.length || opts.audios?.length) {
    let vBytes = 0
    for (const v of opts.videos ?? []) vBytes += (await stat(v)).size
    if (vBytes > 50 * 1024 * 1024)
      throw new Error(`video refs are ${Math.round(vBytes / (1024 * 1024))} MB combined — fal caps them at 50 MB. Trim the windows shorter.`)
    // (Seedance's per-file audio cap — a talking still takes a voice of up to 15 minutes)
    for (const a of model.talkingStill ? [] : (opts.audios ?? [])) {
      const aBytes = (await stat(a)).size
      if (aBytes > 15 * 1024 * 1024) throw new Error(`audio ref ${basename(a)} is ${Math.round(aBytes / (1024 * 1024))} MB — fal caps each at 15 MB.`)
    }
    for (const v of opts.videos ?? []) videoUrls.push(await uploadVideoCached(v, undefined, opts.onProgress))
    opts.onProgress?.('uploading audio ref(s)…')
    for (const a of opts.audios ?? []) audioUrls.push(await uploadAudioCached(a))
  }

  const input = await buildInput(opts, urls, videoUrls, audioUrls)
  return submitAndLand(endpoint, input, opts, `${model.label} (${opts.mode})`)
}

// submit → wait → download: one path for a render and for the finish of a Draft
async function submitAndLand(endpoint: string, input: Record<string, unknown>, opts: RenderOpts, what: string): Promise<RenderOutput> {
  opts.onProgress?.(`submitting to ${what}…`)
  const track = trackJob(opts.jobId, endpoint)
  const onEnqueue = (requestId: string): void => {
    track?.(requestId)
    opts.onRequestId?.(requestId, endpoint)
  }
  let result: unknown
  try {
    result = await fal.subscribe(endpoint, {
      input,
      logs: true,
      onEnqueue,
      onQueueUpdate: (u: { status?: string }) => {
        if (u.status === 'IN_PROGRESS') opts.onProgress?.('rendering on fal…')
        else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
      }
    })
  } catch (e) {
    throw new Error(falErrorText(e, endpoint, Object.keys(input)))
  }

  // @fal-ai/client returns { data, requestId }; older shapes returned the data directly.
  const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  const url: string | undefined =
    out?.video?.url ?? out?.video_url ?? out?.url ?? out?.output?.url
  if (!url) {
    throw new Error('No video URL in fal result: ' + JSON.stringify(out).slice(0, 400))
  }

  opts.onProgress?.('downloading result…')
  await mkdir(opts.outDir, { recursive: true })
  const outPath = join(opts.outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
  await downloadTo(url, outPath)
  opts.onProgress?.('done')
  const reported = out?.video?.duration ?? out?.duration // (H3 Max Lip Sync reports it beside the video, list 23)
  return { file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined, ...(typeof out?.draft_id === 'string' && out.draft_id ? { draftId: out.draft_id } : {}) }
}

// ---- crash recovery: ask fal about a PREVIOUSLY submitted request (from pending-renders.json) ----
// recovery's one question to fal (renders, scores, voices): is this request's result ready? 400 / 404 / 422
// from EITHER call is final ('gone': expired, unknown, or failed upstream). fal reports a failed request
// COMPLETED and then refuses its result with 422; that refusal used to throw past the mapping, so the entry
// was asked again every 30 s for good (his log 10-02: three Seedance renders of 09-27/28). Anything else
// (network, 5xx) = ask again on the next pass.
export async function falRecoveryFetch(endpoint: string, requestId: string): Promise<{ state: 'ready'; out: Record<string, any> } | { state: 'running' } | { state: 'gone' }> {
  const final = (e: unknown): boolean => [400, 404, 422].includes((e as { status?: number }).status ?? 0)
  try {
    const status = (await fal.queue.status(endpoint, { requestId, logs: false })) as { status?: string }
    if (status.status !== 'COMPLETED') return { state: 'running' }
  } catch (e) {
    return final(e) ? { state: 'gone' } : { state: 'running' }
  }
  try {
    const result = await fal.queue.result(endpoint, { requestId })
    return { state: 'ready', out: (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any> }
  } catch (e) {
    if (final(e)) return { state: 'gone' }
    throw e
  }
}

// 'done' downloads the mp4 into outDir; 'running' = leave the entry and retry next open;
// 'gone' = fal no longer knows the request, or refused it for good — the caller drops the entry.
export async function fetchRenderResult(
  endpoint: string,
  requestId: string,
  falKey: string,
  outDir: string
): Promise<{ state: 'done'; file: string; durationSec?: number; draftId?: string } | { state: 'running' } | { state: 'gone' }> {
  acquireFalKey(falKey)
  try {
    const r = await falRecoveryFetch(endpoint, requestId)
    if (r.state !== 'ready') return r
    const out = r.out
    const url: string | undefined = out?.video?.url ?? out?.video_url ?? out?.url ?? out?.output?.url
    if (!url) return { state: 'gone' }
    await mkdir(outDir, { recursive: true })
    const outPath = join(outDir, `render_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(url, outPath)
    const reported = out?.video?.duration ?? out?.duration
    return { state: 'done', file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined, ...(typeof out?.draft_id === 'string' && out.draft_id ? { draftId: out.draft_id } : {}) }
  } finally {
    releaseFalKey()
  }
}

// ---- vid2vid: edit an existing video with a natural-language instruction ----

export interface EditOpts {
  jobId?: string // queue job id (cancel handle)
  engine?: EngineId
  prompt: string
  video: string // local path of the source (already window-cut when a sub-range was chosen)
  cacheKey?: string // stable upload-cache key (source path + window) — temp cut paths change every run
  resolution?: string // only sent to an edit door that has the dial (v2v.resolutions — Omni 1.1)
  audio?: string // list 23: a lip-sync door — the local sound the mouths follow
  syncMode?: string // list 23: its rule for a length mismatch (sync-3)
  falKey: string
  outDir: string
  onProgress?: (msg: string) => void
}

// source uploads are big (tens of MB) and re-rolls reuse the same content — cache the fal.storage
// URL. Keyed by the caller's stable key (source path + window: take files are immutable, so the
// cut content never changes) or, without one, by path + size/mtime signature. Capped: oldest out.
const videoUploadCache = new Map<string, { sig: string; url: string }>()
const UPLOAD_CACHE_MAX = 40

export function hasUploadCached(cacheKey: string): boolean {
  return videoUploadCache.has(cacheKey)
}

export async function uploadVideoCached(path: string, cacheKey?: string, onProgress?: (msg: string) => void): Promise<string> {
  if (cacheKey) {
    const hit = videoUploadCache.get(cacheKey)
    if (hit) return hit.url
  }
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  if (!cacheKey) {
    const hit = videoUploadCache.get(path)
    if (hit && hit.sig === sig) return hit.url
  }
  onProgress?.(`uploading source video (${Math.round(st.size / (1024 * 1024))} MB)…`)
  const buf = await readFile(path)
  const file = new File([buf], basename(path), { type: 'video/mp4' })
  const url = await fal.storage.upload(file)
  videoUploadCache.set(cacheKey ?? path, { sig, url })
  if (videoUploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = videoUploadCache.keys().next().value
    if (oldest) videoUploadCache.delete(oldest)
  }
  return url
}

// Keep typed references in separate cache entries: an image/audio upload must never reuse a
// URL created with video/mp4 metadata. This also preserves correct MIME types on voice re-rolls.
async function uploadReferenceCached(path: string, type: string, onProgress?: (msg: string) => void): Promise<string> {
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  const cacheKey = `${type}:${path}`
  const hit = videoUploadCache.get(cacheKey)
  if (hit && hit.sig === sig) return hit.url
  onProgress?.(`uploading ${type.startsWith('image/') ? 'image' : 'audio'} (${(st.size / (1024 * 1024)).toFixed(1)} MB)…`)
  const buf = await readFile(path)
  const file = new File([buf], basename(path), { type })
  const url = await fal.storage.upload(file)
  videoUploadCache.set(cacheKey, { sig, url })
  if (videoUploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = videoUploadCache.keys().next().value
    if (oldest) videoUploadCache.delete(oldest)
  }
  return url
}

export function uploadAudioCached(path: string, onProgress?: (msg: string) => void): Promise<string> {
  return uploadReferenceCached(path, mimeAudio(path), onProgress)
}

export function uploadImageCached(path: string, onProgress?: (msg: string) => void): Promise<string> {
  return uploadReferenceCached(path, mimeFor(path), onProgress)
}

export async function runEdit(opts: EditOpts): Promise<RenderOutput> {
  acquireFalKey(opts.falKey)
  try {
    return await runEditInner(opts)
  } finally {
    if (opts.jobId) activeJobs.delete(opts.jobId)
    releaseFalKey()
  }
}

async function runEditInner(opts: EditOpts): Promise<RenderOutput> {
  const model = modelFor(opts.engine)
  const caps = model.v2v
  if (!caps) throw new Error(`${model.label} cannot edit video`)

  const videoUrl = await uploadVideoCached(opts.video, opts.cacheKey, opts.onProgress)
  let input: Record<string, unknown> = { prompt: opts.prompt, video_url: videoUrl }
  if (caps.resolutions) input.resolution = caps.resolutions.includes(opts.resolution ?? '') ? opts.resolution : '720p'
  if (caps.lipsync) {
    // list 23: a lip-sync door takes the video and the sound, no words (sync-3 / VEED schemas,
    // read 09-30). sync_mode only where the door has it, and only a value it lists.
    if (!opts.audio) throw new Error(`${model.label} needs the voice the mouths follow`)
    opts.onProgress?.('uploading the voice…')
    input = { video_url: videoUrl, audio_url: await uploadAudioCached(opts.audio) }
    if (caps.lipsync.modes) input.sync_mode = caps.lipsync.modes.includes(opts.syncMode ?? '') ? opts.syncMode : caps.lipsync.modes[0]
  }

  opts.onProgress?.(`submitting edit to ${model.label}…`)
  const onEnqueue = trackJob(opts.jobId, caps.endpoint)
  let result: unknown
  try {
    result = await fal.subscribe(caps.endpoint, {
      input,
      logs: true,
      onEnqueue,
      onQueueUpdate: (u: { status?: string }) => {
        if (u.status === 'IN_PROGRESS') opts.onProgress?.('editing on fal…')
        else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
      }
    })
  } catch (e) {
    throw new Error(falErrorText(e, caps.endpoint, Object.keys(input)))
  }

  const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  const url: string | undefined = out?.video?.url ?? out?.video_url ?? out?.url ?? out?.output?.url
  if (!url) throw new Error('No video URL in fal edit result: ' + JSON.stringify(out).slice(0, 400))

  opts.onProgress?.('downloading result…')
  await mkdir(opts.outDir, { recursive: true })
  const outPath = join(opts.outDir, `edit_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
  await downloadTo(url, outPath)
  opts.onProgress?.('done')
  const reported = out?.video?.duration
  return { file: outPath, durationSec: typeof reported === 'number' && reported > 0 ? reported : undefined }
}
