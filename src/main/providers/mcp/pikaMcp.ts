// Pika MCP adapter — the FOURTH Bridge render lane (BRIDGE-SPEC-2026-09-01). Built 2026-09-01
// from the LIVE tools/list capture (userData/bridge-tools/pika.json), whose schemas are full:
//   generate_video { provider:'seedance', mode:'text_to_video'|'image_to_video', prompt,
//                    duration (4-15), aspect_ratio, resolution (480p/720p/1080p), sound, seed,
//                    image (i2v start), end_image (seedance only), background:true } → task_id
//   task_status { task_id } — server blocks ~20s per call, loop until completed/failed
//   uploads: upload_asset {filename, mime_type, size_bytes, sha256} → presigned_url+public_url
//            (already_uploaded skips the PUT; completion_required → complete_upload_asset)
//   cost gate: a cost_confirmation_required reply carries confirm_token — the user already
//   pressed render, so the SAME params are re-sent once with the token (deterministic, no AI)
// v1 scope: Seedance t2v + i2v (start/end). Multi-ref generation is their separate
// generate_reference_video tool — a later lane, not wired blind.
import { readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { downloadTo, type RenderRequest, type RenderOutput } from '../../fal'
import { bridgeToolCall, bridgeReady, bridgeToolNames, onBestLogin, currentLogin } from '../../bridge'
import { interpretBridgeReply } from '../../bridge/interpreter'
import type { McpToolResult } from '../../bridge/mcpClient'
import { payloadText, hunt, huntResult, resultText, humanDetail } from './hunt'
import { assertNotStopped, markProviderAccepted } from '../../jobNotifications'

export interface PikaMcpRenderOpts extends RenderRequest {
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

const SERVICE = 'pika' as const
export const PIKA_MCP_ENDPOINT = 'pika-mcp/generate_video'

function errText(where: string, detail: string): string {
  return `error @ ${SERVICE}/${where}: ${humanDetail(detail)}`
}

function mimeFor(p: string): string {
  const e = extname(p).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  if (e === '.mp4') return 'video/mp4'
  if (e === '.mov') return 'video/quicktime'
  if (e === '.webm') return 'video/webm'
  if (e === '.wav') return 'audio/wav'
  if (e === '.mp3') return 'audio/mpeg'
  if (e === '.m4a') return 'audio/mp4'
  return 'image/jpeg'
}

const uploadCache = new Map<string, { sig: string; url: string }>()
const UPLOAD_CACHE_MAX = 60

export async function uploadLocal(path: string, onProgress?: (m: string) => void): Promise<string> {
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  const cacheKey = `${currentLogin(SERVICE)}|${path}` // per login: another account can't see this upload (M13)
  const hit = uploadCache.get(cacheKey)
  if (hit && hit.sig === sig) return hit.url
  const buf = await readFile(path)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const init = await bridgeToolCall(SERVICE, 'upload_asset', { filename: basename(path), mime_type: mimeFor(path), size_bytes: st.size, sha256 })
  const text = payloadText(init)
  const publicUrl = hunt(init, ['public_url', 'publicUrl'])
  if (!publicUrl) throw new Error(errText('upload_asset', `no public_url in response: ${humanDetail(text)}`))
  if (!text.includes('already_uploaded') || !/already_uploaded[^a-z]{0,4}true/.test(text)) {
    const putUrl = hunt(init, ['presigned_url', 'presignedUrl', 'upload_url'])
    if (putUrl) {
      if (st.size > 8 * 1024 * 1024) onProgress?.(`uploading ${basename(path)} (${Math.round(st.size / (1024 * 1024))} MB)…`)
      const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': mimeFor(path) }, body: new Uint8Array(buf) })
      if (!put.ok) throw new Error(errText('upload PUT', `HTTP ${put.status}`))
      if (/completion_required[^a-z]{0,4}true/.test(text)) await bridgeToolCall(SERVICE, 'complete_upload_asset', { sha256 })
    }
  }
  uploadCache.set(cacheKey, { sig, url: publicUrl })
  if (uploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = uploadCache.keys().next().value
    if (oldest) uploadCache.delete(oldest)
  }
  return publicUrl
}

interface TaskState {
  status: string
  url?: string
}
function readTask(r: McpToolResult): TaskState {
  const status = (hunt(r, ['status', 'state']) ?? '').toLowerCase()
  // never from the request the reply repeats back (audit 2026-10-09 M15)
  let url = huntResult(r, ['video_url', 'videoUrl', 'result_url', 'url'])
  if (!url || !/\.(mp4|webm|mov)/.test(url)) url = resultText(r).match(/https?:\/\/[^\s"'\\]+?\.(?:mp4|webm|mov)[^\s"'\\]*/)?.[0]
  return { status, url }
}
const TERMINAL_BAD = ['failed', 'cancelled', 'canceled', 'error', 'rejected']

// list 33: one render, one login — the one with the most credits left (bridge/index.ts)
export const runPikaMcpRender = (opts: PikaMcpRenderOpts): Promise<RenderOutput> => onBestLogin(SERVICE, opts, renderOnLogin)
async function renderOnLogin(opts: PikaMcpRenderOpts): Promise<RenderOutput> {
  if (!bridgeReady(SERVICE)) throw new Error('not logged in to Pika — Bridge panel')

  // multi-ref ref2v goes through their SIBLING tool generate_reference_video (schema captured
  // 2026-09-01: seedance takes ≤9 images / ≤3 videos / ≤3 audio, combined ≤12, @Image1-style
  // anchors optional); plain t2v + i2v stay on generate_video
  const hasRefs = opts.mode === 'ref2v' && !!(opts.images.length || opts.videos?.length || opts.audios?.length)
  const tool = hasRefs ? 'generate_reference_video' : 'generate_video'
  const params: Record<string, unknown> = {
    provider: 'seedance',
    prompt: opts.prompt,
    background: true // always background — the tight-loop task_status is our poll
  }
  const dur = parseInt(opts.duration, 10)
  if (Number.isFinite(dur)) params.duration = dur
  else if (hasRefs && opts.duration === 'auto') params.auto_duration = true
  if (opts.aspectRatio && opts.aspectRatio !== 'auto') params.aspect_ratio = opts.aspectRatio
  if (opts.resolution) params.resolution = opts.resolution
  params.sound = opts.generateAudio
  if (opts.seed != null) params.seed = opts.seed
  if (hasRefs) {
    const imgs: string[] = []
    for (const p of opts.images) imgs.push(await uploadLocal(p, opts.onProgress))
    if (imgs.length) params.reference_images = imgs
    const vids: string[] = []
    for (const p of opts.videos ?? []) vids.push(await uploadLocal(p, opts.onProgress))
    if (vids.length) params.reference_videos = vids
    const auds: string[] = []
    for (const p of opts.audios ?? []) auds.push(await uploadLocal(p, opts.onProgress))
    if (auds.length) params.reference_audio = auds
  } else {
    params.mode = opts.mode === 'i2v' ? 'image_to_video' : 'text_to_video'
    if (opts.mode === 'i2v') {
      if (opts.images[0]) params.image = await uploadLocal(opts.images[0], opts.onProgress)
      if (opts.endImage) params.end_image = await uploadLocal(opts.endImage, opts.onProgress)
    }
  }

  opts.onProgress?.('submitting to Pika…')
  let sub: McpToolResult | undefined
  let taskId: string | undefined
  let interpreterRounds = 0
  let confirmed = false
  for (let attempt = 0; attempt < 5; attempt++) {
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
    sub = await bridgeToolCall(SERVICE, tool, params)
    const text = payloadText(sub)
    // their cost gate: the render button WAS the approval — confirm once with their token
    if (text.includes('cost_confirmation_required') && !confirmed) {
      const token = hunt(sub, ['confirm_token', 'confirmToken'])
      if (token) {
        confirmed = true
        params.confirm_token = token
        opts.onProgress?.('confirming the cost with Pika…')
        continue
      }
    }
    if (sub.isError) throw new Error(errText(tool, text))
    taskId = hunt(sub, ['task_id', 'taskId'])
    if (taskId) break
    // a foreground-style inline result (no task id) may already carry the file
    // ...never one of the links it was sent, never on a failure (M15)
    const inline = readTask(sub)
    if (inline.url && !JSON.stringify(params).includes(inline.url) && !TERMINAL_BAD.some((s) => inline.status.includes(s))) {
      markProviderAccepted() // the answer is the paid result
      const out = join(opts.outDir, `pika-mcp-${randomUUID().slice(0, 8)}.mp4`)
      await downloadTo(inline.url, out)
      return { file: out }
    }
    if (interpreterRounds >= 2) break
    interpreterRounds++
    const v = await interpretBridgeReply({
      service: SERVICE,
      toolCalled: tool,
      sentArgs: params,
      reply: text,
      allowedTools: bridgeToolNames(SERVICE),
      onNote: opts.onProgress
    })
    if (v.action === 'fail' || !v.tool) throw new Error(errText(tool, v.reason ?? 'Pika refused this render'))
    if (v.tool !== tool) await bridgeToolCall(SERVICE, v.tool, v.args ?? {})
    opts.onProgress?.('Claude answered — resubmitting…')
  }
  if (!taskId) throw new Error(errText(tool, `no task_id in response: ${humanDetail(payloadText(sub!))}`))
  markProviderAccepted() // the supplier has it: never sent again (audit 2026-10-09 batch 2)
  opts.onRequestId?.(taskId, PIKA_MCP_ENDPOINT)

  // task_status blocks ~20s server-side per call — tight loop, 12.11 tolerances
  const deadline = Date.now() + 45 * 60_000
  let failures = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error(errText('poll', 'render exceeded the 45-minute deadline'))
    let ts: McpToolResult
    try {
      ts = await bridgeToolCall(SERVICE, 'task_status', { task_id: taskId })
      failures = 0
    } catch (e) {
      if (++failures >= 5) throw e
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    const st = readTask(ts)
    if (st.status === 'completed' && st.url) {
      opts.onProgress?.('downloading result…')
      const out = join(opts.outDir, `pika-mcp-${taskId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
      await downloadTo(st.url, out)
      return { file: out }
    }
    if (TERMINAL_BAD.includes(st.status)) throw new Error(errText('task', `${st.status}: ${humanDetail(payloadText(ts))}`))
    opts.onProgress?.(st.status ? `Pika: ${st.status}…` : 'rendering…')
  }
}

export async function fetchPikaMcpResult(requestId: string, outDir: string): Promise<{ state: 'done'; file: string } | { state: 'running' } | { state: 'gone' }> {
  if (!bridgeReady(SERVICE)) return { state: 'running' }
  let ts: McpToolResult
  try {
    ts = await bridgeToolCall(SERVICE, 'task_status', { task_id: requestId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return /not found|unknown task|404/i.test(msg) ? { state: 'gone' } : { state: 'running' }
  }
  const st = readTask(ts)
  if (st.status === 'completed' && st.url) {
    const out = join(outDir, `pika-mcp-${requestId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(st.url, out)
    return { state: 'done', file: out }
  }
  if (TERMINAL_BAD.includes(st.status)) return { state: 'gone' }
  return { state: 'running' }
}
