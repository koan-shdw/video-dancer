// Higgsfield MCP adapter — the FIRST Bridge render lane (BRIDGE-SPEC-2026-09-01 §3.2/§7 stage 2).
// Speaks bible 12.11 through the Bridge manager's authed MCP pipe instead of an API key. Built
// 2026-09-01 from the LIVE tools/list capture (userData/bridge-tools/higgsfield.json):
//   generate_video  { params: { model, prompt, duration(int), aspect_ratio, medias[{value,role}],
//                     use_unlim } } → job_id; roles: image | start_image | end_image | audio
//   media_upload    { filename, content_type } → upload_url + media_id; PUT bytes; media_confirm
//   job_status      { jobId, sync:true } → server-side poll ≤25s; poll_after_seconds when pending
// UNPROVEN until his first render (the probe): exact response field names (hunted defensively
// below), resolution handling (schema takes width/height, server clamps), audio behavior, and
// whether 'seedance_2_0' is a live model id. No cancel tool exists in the capture — a running
// Higgsfield MCP job cannot be stopped remotely.
// use_unlim is pinned FALSE (credits): omitting it can make the server hold the job and ask an
// interactive question no render pipeline can answer. A "use my unlimited generations" dial is
// his call to add later, in the UI.
import { readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { downloadTo, type RenderRequest, type RenderOutput } from '../../fal'
import { modelFor } from '@koan/vidancer-ui/shared/models'
import { bridgeToolCall, bridgeReady, bridgeToolNames } from '../../bridge'
import { interpretBridgeReply } from '../../bridge/interpreter'
import type { McpToolResult } from '../../bridge/mcpClient'

export interface HfMcpRenderOpts extends RenderRequest {
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

const SERVICE = 'higgsfield' as const
const ENDPOINT = 'higgsfield-mcp/generate_video'

import { payloadObjects, payloadText, hunt, humanDetail } from './hunt'

// the SUBMIT receipt, field-proven 2026-09-01 on THE ROCK: {"results":[{"id":"…","type":"video",
// "status":"pending","model":"seedance_2_0",…}]} — the job id lives at results[].id, which the
// generic job_id hunt missed (and a real paid job got reported as failed). results[] first.
function huntJobId(r: McpToolResult): string | undefined {
  for (const o of payloadObjects(r)) {
    const res = (o as { results?: unknown }).results
    if (Array.isArray(res) && res[0] && typeof res[0] === 'object') {
      const first = res[0] as Record<string, unknown>
      const id = first.id ?? first.job_id
      if (typeof id === 'string' && id) return id
    }
  }
  return hunt(r, ['job_id', 'jobId'])
}

function errText(where: string, detail: string): string {
  return `error @ ${SERVICE}/${where}: ${humanDetail(detail)}`
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
const mediaType = (p: string): 'image' | 'video' | 'audio' => {
  const m = mimeFor(p)
  return m.startsWith('video') ? 'video' : m.startsWith('audio') ? 'audio' : 'image'
}

// upload cache — media_ids are stable; project media is immutable (same policy as fal.ts)
const uploadCache = new Map<string, { sig: string; id: string }>()
const UPLOAD_CACHE_MAX = 60

async function uploadLocal(path: string, onProgress?: (m: string) => void): Promise<string> {
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  const hit = uploadCache.get(path)
  if (hit && hit.sig === sig) return hit.id
  const contentType = mimeFor(path)
  const up = await bridgeToolCall(SERVICE, 'media_upload', { filename: basename(path), content_type: contentType })
  const uploadUrl = hunt(up, ['upload_url', 'uploadUrl', 'url'])
  const mediaId = hunt(up, ['media_id', 'mediaId', 'id'])
  if (!uploadUrl || !mediaId) throw new Error(errText('media_upload', `no upload_url/media_id in response: ${humanDetail(payloadText(up))}`))
  if (st.size > 8 * 1024 * 1024) onProgress?.(`uploading ${basename(path)} (${Math.round(st.size / (1024 * 1024))} MB)…`)
  const buf = await readFile(path)
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Uint8Array(buf) })
  if (!put.ok) throw new Error(errText('upload PUT', `HTTP ${put.status}`))
  const conf = await bridgeToolCall(SERVICE, 'media_confirm', { type: mediaType(path), media_id: mediaId })
  if (conf.isError) throw new Error(errText('media_confirm', payloadText(conf)))
  uploadCache.set(path, { sig, id: mediaId })
  if (uploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = uploadCache.keys().next().value
    if (oldest) uploadCache.delete(oldest)
  }
  return mediaId
}

// 16:9-family frame sizes per resolution rung — the schema takes width/height and the server
// clamps to the model's nearest allowed frame, so these are hints, not law (probe-checked)
const FRAME: Record<string, [number, number]> = { '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080] }

// ----- per-model media ROLES (field lesson 2026-09-01: seedance_2_5 422'd our role 'image' —
// "mode 't2v' does not accept reference media" — roles VARY PER MODEL; their own tool docs say
// "inspect the selected model's medias[].roles" via models_explore). Looked up once per model,
// cached for the session; refs map onto what the model actually declares, and refs a model
// can't carry FAIL with the reason — never silently dropped (stable-board law). -----
const modelRolesCache = new Map<string, { roles: string[]; modes: string[] }>()
function huntRoles(r: McpToolResult): string[] {
  const out = new Set<string>()
  const walk = (o: unknown, d: number): void => {
    if (d > 8 || o === null || typeof o !== 'object') return
    if (Array.isArray(o)) {
      for (const x of o) walk(x, d + 1)
      return
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'roles' && Array.isArray(v)) for (const x of v) typeof x === 'string' && out.add(x)
      else if (k === 'role' && typeof v === 'string') out.add(v)
      else walk(v, d + 1)
    }
  }
  for (const o of payloadObjects(r)) walk(o, 0)
  // TOON/prose catalogs: only trust unmistakable role words in text (bare 'image' is everywhere)
  if (!out.size)
    for (const m of payloadText(r).matchAll(/\b(start_image|end_image|reference_image|image_references|input_image|reference_video|video_references|input_video|reference_audio|audio_references|input_audio)\b/g)) out.add(m[1])
  return [...out]
}
// generation modes hunted the same way — seedance_2_5 422s refs unless mode 'omni_reference'
// is EXPLICIT (their own error text, field-hit 2026-09-01); mode names vary per model
function huntModes(r: McpToolResult): string[] {
  const out = new Set<string>()
  const walk = (o: unknown, d: number): void => {
    if (d > 8 || o === null || typeof o !== 'object') return
    if (Array.isArray(o)) {
      for (const x of o) walk(x, d + 1)
      return
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'modes' && Array.isArray(v)) for (const x of v) typeof x === 'string' && out.add(x)
      else if (k === 'mode' && typeof v === 'string') out.add(v)
      else walk(v, d + 1)
    }
  }
  for (const o of payloadObjects(r)) walk(o, 0)
  if (!out.size) for (const m of payloadText(r).matchAll(/\b(omni_reference|[a-z]+_reference|reference_to_video)\b/g)) out.add(m[1])
  return [...out]
}
async function catalogFor(modelId: string): Promise<{ roles: string[]; modes: string[] }> {
  const hit = modelRolesCache.get(modelId)
  if (hit) return hit
  const r = await bridgeToolCall(SERVICE, 'models_explore', { action: 'get', model_id: modelId })
  const cat = { roles: huntRoles(r), modes: huntModes(r) }
  modelRolesCache.set(modelId, cat)
  return cat
}
// the declared role our ref kind maps onto; roles UNKNOWN (lookup gave nothing) → legacy default
// (the path Seedance 2.0 rendered with); roles known but no match → undefined, caller fails plainly
const pickRole = (roles: string[], candidates: string[], legacy: string): string | undefined =>
  roles.length ? candidates.find((c) => roles.includes(c)) : legacy

interface JobState {
  status: string
  url?: string
  waitSec: number
}
function readJobState(r: McpToolResult): JobState {
  const status = (hunt(r, ['status', 'state']) ?? '').toLowerCase()
  // the finished video: prefer an explicit result url key, fall back to any .mp4 link in the payload
  let url = hunt(r, ['video_url', 'result_url', 'download_url'])
  if (!url) {
    const m = payloadText(r).match(/https?:\/\/[^\s"'\\]+?\.mp4[^\s"'\\]*/)
    if (m) url = m[0]
  }
  const waitRaw = hunt(r, ['poll_after_seconds'])
  const waitSec = waitRaw ? Number(waitRaw) || 3 : 3
  return { status, url, waitSec }
}
const TERMINAL_BAD = ['failed', 'error', 'nsfw', 'cancelled', 'canceled', 'rejected']

export async function runHfMcpRender(opts: HfMcpRenderOpts): Promise<RenderOutput> {
  if (!bridgeReady(SERVICE)) throw new Error('not logged in to Higgsfield — Bridge panel')
  const model = modelFor(opts.engine)
  const modelId = model.endpoints[opts.mode]
  if (!modelId) throw new Error(`${model.label} does not support ${opts.mode}`)

  // refs → media_ids through their own upload lane, bound with the roles THIS model declares
  const anyRefs = opts.mode === 'i2v' ? !!(opts.images[0] || opts.endImage) : !!(opts.images.length || opts.videos?.length || opts.audios?.length)
  const catalog = anyRefs ? await catalogFor(modelId) : { roles: [], modes: [] }
  const roles = catalog.roles
  const needRole = (kind: string, candidates: string[], legacy: string): string => {
    const r = pickRole(roles, candidates, legacy)
    if (!r) throw new Error(errText('refs', `${modelId} declares no role for ${kind} references (has: ${roles.join(', ') || 'none'}) — remove those refs or render this clip on fal`))
    return r
  }
  const medias: { value: string; role: string }[] = []
  if (opts.mode === 'i2v') {
    if (opts.images[0]) medias.push({ value: await uploadLocal(opts.images[0], opts.onProgress), role: needRole('start-frame', ['start_image', 'image', 'input_image'], 'start_image') })
    if (opts.endImage) medias.push({ value: await uploadLocal(opts.endImage, opts.onProgress), role: needRole('end-frame', ['end_image'], 'end_image') })
  } else {
    // Seedance 2 / 2.5 on Higgsfield name the REFERENCE roles image_references / video_references /
    // audio_references (their catalog, field-read 2026-09-08). Without them in the candidate list a
    // ref2v render fell through to start_image — the ref became a first frame, the job failed at
    // intake, and the record carried no reason.
    const imgRole = opts.images.length ? needRole('image', ['image_references', 'reference_image', 'input_image', 'image', 'start_image'], 'image') : ''
    for (const p of opts.images) medias.push({ value: await uploadLocal(p, opts.onProgress), role: imgRole })
    const vidRole = opts.videos?.length ? needRole('video', ['video_references', 'reference_video', 'input_video', 'video'], 'video') : ''
    for (const p of opts.videos ?? []) medias.push({ value: await uploadLocal(p, opts.onProgress), role: vidRole })
    const audRole = opts.audios?.length ? needRole('audio', ['audio_references', 'reference_audio', 'input_audio', 'audio'], 'audio') : ''
    for (const p of opts.audios ?? []) medias.push({ value: await uploadLocal(p, opts.onProgress), role: audRole })
  }

  let params: Record<string, unknown> = {
    model: modelId,
    prompt: opts.prompt,
    use_unlim: false // pinned — see header
  }
  const dur = parseInt(opts.duration, 10)
  if (Number.isFinite(dur)) params.duration = dur
  if (opts.aspectRatio && opts.aspectRatio !== 'auto') params.aspect_ratio = opts.aspectRatio
  const frame = FRAME[opts.resolution]
  if (frame && (!opts.aspectRatio || opts.aspectRatio === 'auto' || opts.aspectRatio === '16:9')) {
    params.width = frame[0]
    params.height = frame[1]
  } else if (frame) {
    params.height = frame[1] // odd ratios: pin the rung by height, let the server derive width
  }
  if (medias.length) {
    params.medias = medias
    // refs need the model's reference mode stated EXPLICITLY (else their backend defaults to
    // t2v and 422s) — pick it from the catalog; the 422 backstop below self-heals if this misses
    const refMode = catalog.modes.find((m) => m.includes('reference'))
    if (refMode) params.mode = refMode
  }

  opts.onProgress?.('submitting to Higgsfield…')
  // their server may answer with an interactive QUESTION instead of a job. Known shape
  // (field-hit 2026-09-01, "3D RENDER"): preset_recommendation → decline by id, resubmit —
  // the render is LITERAL, always. Anything else unknown goes to the INTERPRETER (spec §3.5):
  // one Claude sub-call answers it, max 2 rounds, and it can never touch these params —
  // `original` is re-imposed in code on every resubmit.
  const original = { ...params }
  let sub: McpToolResult | undefined
  let jobId: string | undefined
  let interpreterRounds = 0
  let modeRetried = false
  for (let attempt = 0; attempt < 6; attempt++) {
    sub = await bridgeToolCall(SERVICE, 'generate_video', { params })
    if (sub.isError) {
      // 422 backstop: their validation errors NAME the required mode ("start_image and
      // end_image are only allowed for mode 'omni_reference'") — take the hint, retry once
      const t = payloadText(sub)
      const m = t.match(/only allowed for mode '([\w-]+)'/) ?? t.match(/requires mode '([\w-]+)'/)
      if (m && !modeRetried && medias.length) {
        modeRetried = true
        params.mode = m[1]
        original.mode = m[1] // survives interpreter resubmits too
        opts.onProgress?.(`switching to their '${m[1]}' mode — resubmitting…`)
        continue
      }
      throw new Error(errText('generate_video', t))
    }
    jobId = huntJobId(sub)
    if (jobId) break
    const text = payloadText(sub)
    const presetId = text.includes('preset_recommendation') ? hunt(sub, ['id', 'preset_id']) : undefined
    if (presetId) {
      opts.onProgress?.('declining a Higgsfield preset suggestion — generating your prompt literally…')
      params.declined_preset_id = presetId
      continue
    }
    if (interpreterRounds >= 2) break // fail honestly below, with the server's own words
    interpreterRounds++
    const v = await interpretBridgeReply({
      service: SERVICE,
      toolCalled: 'generate_video',
      sentArgs: { params },
      reply: text,
      allowedTools: bridgeToolNames(SERVICE),
      onNote: opts.onProgress
    })
    if (v.action === 'fail' || !v.tool) throw new Error(errText('generate_video', v.reason ?? 'the provider refused this render'))
    if (v.tool === 'generate_video') {
      const p = ((v.args?.params as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
      params = { ...p, ...original } // the laws: Claude may ADD procedural fields, never change ours
    } else {
      await bridgeToolCall(SERVICE, v.tool, v.args ?? {}) // one procedural side call, then resubmit unchanged
    }
    opts.onProgress?.('Claude answered — resubmitting…')
  }
  if (!jobId) throw new Error(errText('generate_video', `no job_id in response: ${humanDetail(payloadText(sub!))}`))
  opts.onRequestId?.(jobId, ENDPOINT)

  // poll — sync:true long-polls ~25s server-side; 12.11 tolerances (5 bad polls, 45-min deadline)
  const deadline = Date.now() + 45 * 60_000
  let failures = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error(errText('poll', 'render exceeded the 45-minute deadline'))
    let js: McpToolResult
    try {
      js = await bridgeToolCall(SERVICE, 'job_status', { jobId, sync: true })
      failures = 0
    } catch (e) {
      if (++failures >= 5) throw e
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    const st = readJobState(js)
    if (st.url) {
      opts.onProgress?.('downloading result…')
      const out = join(opts.outDir, `hf-mcp-${jobId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
      await downloadTo(st.url, out)
      return { file: out }
    }
    if (TERMINAL_BAD.some((s) => st.status.includes(s)))
      throw new Error(errText('job', `${st.status || 'failed'}: ${humanDetail(payloadText(js))}`))
    opts.onProgress?.(st.status ? `Higgsfield: ${st.status}…` : 'rendering…')
    await new Promise((r) => setTimeout(r, Math.min(15, Math.max(2, st.waitSec)) * 1000))
  }
}

// crash recovery — one status read; 'gone' only when the server explicitly doesn't know the job
export async function fetchHfMcpResult(requestId: string, outDir: string): Promise<{ state: 'done'; file: string } | { state: 'running' } | { state: 'gone' }> {
  if (!bridgeReady(SERVICE)) return { state: 'running' } // logged out ≠ job gone — retry next open
  let js: McpToolResult
  try {
    js = await bridgeToolCall(SERVICE, 'job_status', { jobId: requestId, sync: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return /not found|unknown job|404/i.test(msg) ? { state: 'gone' } : { state: 'running' }
  }
  const st = readJobState(js)
  if (st.url) {
    const out = join(outDir, `hf-mcp-${requestId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(st.url, out)
    return { state: 'done', file: out }
  }
  if (TERMINAL_BAD.some((s) => st.status.includes(s))) return { state: 'gone' }
  return { state: 'running' }
}

// the capture has NO cancel tool — a running job can't be stopped remotely (Queue ✕ still
// abandons it locally; if it finishes, recovery lands the take, same law as fal best-effort)
export function cancelHfMcpJob(): boolean {
  return false
}
