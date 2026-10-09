// Runway MCP adapter — the SECOND Bridge render lane (BRIDGE-SPEC-2026-09-01 §3.2/§7 stage 3).
// Built 2026-09-01 from the LIVE tools/list capture (userData/bridge-tools/runway.json), whose
// schemas are unusually complete:
//   generate_video { model: 'seedance-2'|'seedance-2.5'|…, promptText (req), ratio, duration(n),
//                    resolution ('480p'…'4k'), generateAudio, startFrame{url}, endFrame{url},
//                    referenceImages[{url,tag}] } → task id; poll get_task {id} → SUCCEEDED + url
//   uploads: init_upload {filename,fileSize,mimeType} → uploadId + PUT url(s);
//            PUT bytes (capture the etag header) → complete_upload {uploadId, parts} → assetUrl
// Facts that shaped this lane (their own docs, capture 2026-09-01): referenceVideo is an EDIT
// source (v2v restyle), NOT a Seedance-style @video reference — video/audio refs stay 0 here.
// Prompts TRUNCATE at 3500 chars on seedance-2 (2.5 takes 15000) — the queue row warns. Seedance
// tiers are paid-plan models; a free workspace answers paid_plan_required → plain error. No seed
// param exists. No cancel tool exists.
import { readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { downloadTo, type RenderRequest, type RenderOutput } from '../../fal'
import { modelFor } from '@koan/vidancer-ui/shared/models'
import { bridgeToolCall, bridgeReady, bridgeToolNames, onBestLogin, currentLogin } from '../../bridge'
import { interpretBridgeReply } from '../../bridge/interpreter'
import type { McpToolResult } from '../../bridge/mcpClient'
import { payloadObjects, payloadText, hunt, huntResult, resultText, humanDetail } from './hunt'
import { assertNotStopped, markProviderAccepted } from '../../jobNotifications'

export interface RunwayMcpRenderOpts extends RenderRequest {
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

const SERVICE = 'runway' as const
export const RUNWAY_MCP_ENDPOINT = 'runway-mcp/generate_video'

function errText(where: string, detail: string): string {
  return `error @ ${SERVICE}/${where}: ${humanDetail(detail)}`
}

function mimeFor(p: string): string {
  const e = extname(p).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  if (e === '.mp4') return 'video/mp4'
  if (e === '.mov') return 'video/quicktime'
  if (e === '.webm') return 'video/webm'
  return 'image/jpeg'
}

// upload cache — their asset URLs are stable per their docs; project media is immutable
const uploadCache = new Map<string, { sig: string; url: string }>()
const UPLOAD_CACHE_MAX = 60

export async function uploadLocal(path: string, onProgress?: (m: string) => void): Promise<string> {
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  const cacheKey = `${currentLogin(SERVICE)}|${path}` // per login: another account can't see this upload (M13)
  const hit = uploadCache.get(cacheKey)
  if (hit && hit.sig === sig) return hit.url
  const init = await bridgeToolCall(SERVICE, 'init_upload', { filename: basename(path), fileSize: st.size, mimeType: mimeFor(path) })
  const uploadId = hunt(init, ['uploadId', 'upload_id'])
  // single-part is the normal case for ref media; multi-part URLs would arrive as an array we
  // don't parse yet — fail plainly rather than corrupt an upload
  let putUrl = hunt(init, ['uploadUrl', 'upload_url', 'url'])
  if (!putUrl) {
    const m = payloadText(init).match(/https?:\/\/[^\s"'\\]+/g)
    putUrl = m?.find((u) => !u.includes('runway.com/')) ?? m?.[0]
  }
  if (!uploadId || !putUrl) throw new Error(errText('init_upload', `no uploadId/upload URL in response: ${humanDetail(payloadText(init))}`))
  if (st.size > 8 * 1024 * 1024) onProgress?.(`uploading ${basename(path)} (${Math.round(st.size / (1024 * 1024))} MB)…`)
  const buf = await readFile(path)
  const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': mimeFor(path) }, body: new Uint8Array(buf) })
  if (!put.ok) throw new Error(errText('upload PUT', `HTTP ${put.status}`))
  const etag = (put.headers.get('etag') ?? '').replace(/"/g, '')
  if (!etag) throw new Error(errText('upload PUT', 'no ETag header on the upload response — cannot complete the upload'))
  const done = await bridgeToolCall(SERVICE, 'complete_upload', { uploadId, parts: [{ partNumber: 1, etag }] })
  const assetUrl = hunt(done, ['assetUrl', 'asset_url']) ?? payloadText(done).match(/https?:\/\/[^\s"'\\]+\/datasets\/[^\s"'\\]+/)?.[0]
  if (!assetUrl) throw new Error(errText('complete_upload', `no assetUrl in response: ${humanDetail(payloadText(done))}`))
  uploadCache.set(cacheKey, { sig, url: assetUrl })
  if (uploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = uploadCache.keys().next().value
    if (oldest) uploadCache.delete(oldest)
  }
  return assetUrl
}

interface TaskState {
  status: string
  url?: string
}
function readTask(r: McpToolResult): TaskState {
  const status = (hunt(r, ['status', 'state']) ?? '').toUpperCase()
  // never from the request the reply repeats back (audit 2026-10-09 M15)
  let url = huntResult(r, ['video_url', 'videoUrl', 'assetUrl', 'output_url', 'outputUrl'])
  if (!url) url = resultText(r).match(/https?:\/\/[^\s"'\\]+?\.mp4[^\s"'\\]*/)?.[0]
  return { status, url }
}
// THROTTLED is NOT here: Runway parks an accepted task there until a slot frees, then runs (and
// bills) it, so it is polled like PENDING (audit 2026-10-09 H5)
const TERMINAL_BAD = ['FAILED', 'CANCELED', 'CANCELLED']

export function huntTaskId(r: McpToolResult): string | undefined {
  const direct = hunt(r, ['task_id', 'taskId'])
  if (direct) return direct
  for (const o of payloadObjects(r)) {
    const task = (o as { task?: { id?: unknown } }).task
    if (task && typeof task.id === 'string') return task.id
    const id = (o as { id?: unknown }).id
    if (typeof id === 'string' && /^[0-9a-f-]{20,}$/i.test(id)) return id
  }
  // prose replies: "Task ID: xxxx" / "task `xxxx`"
  return payloadText(r).match(/task[^0-9a-f]{0,8}([0-9a-f-]{20,})/i)?.[1]
}

// list 33: one render, one login — the one with the most credits left (bridge/index.ts)
export const runRunwayMcpRender = (opts: RunwayMcpRenderOpts): Promise<RenderOutput> => onBestLogin(SERVICE, opts, renderOnLogin)
async function renderOnLogin(opts: RunwayMcpRenderOpts): Promise<RenderOutput> {
  if (!bridgeReady(SERVICE)) throw new Error('not logged in to Runway — Bridge panel')
  const model = modelFor(opts.engine)
  const modelId = model.endpoints[opts.mode]
  if (!modelId) throw new Error(`${model.label} does not support ${opts.mode}`)

  if (modelId === 'seedance-2' && opts.prompt.length > 3400)
    opts.onProgress?.(`prompt is ${opts.prompt.length} chars — Runway truncates seedance-2 at 3500; Seedance 2.5 (Runway Bridge) takes 15000`)

  const params: Record<string, unknown> = { model: modelId, promptText: opts.prompt }
  const dur = parseInt(opts.duration, 10)
  if (Number.isFinite(dur)) params.duration = dur
  if (opts.aspectRatio && opts.aspectRatio !== 'auto') params.ratio = opts.aspectRatio
  if (opts.resolution) params.resolution = opts.resolution
  params.generateAudio = opts.generateAudio

  if (opts.mode === 'i2v') {
    if (opts.images[0]) params.startFrame = { url: await uploadLocal(opts.images[0], opts.onProgress) }
    if (opts.endImage) params.endFrame = { url: await uploadLocal(opts.endImage, opts.onProgress) }
  } else if (opts.images.length) {
    const refs: { url: string }[] = []
    for (const p of opts.images) refs.push({ url: await uploadLocal(p, opts.onProgress) })
    params.referenceImages = refs
  }

  opts.onProgress?.('submitting to Runway…')
  let sub: McpToolResult | undefined
  let taskId: string | undefined
  let interpreterRounds = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
    sub = await bridgeToolCall(SERVICE, 'generate_video', params)
    const text = payloadText(sub)
    if (text.includes('paid_plan_required'))
      throw new Error(errText('generate_video', `Runway says ${modelId} needs a paid workspace plan — upgrade the Runway account or render this clip on fal`))
    if (sub.isError) throw new Error(errText('generate_video', text))
    taskId = huntTaskId(sub)
    if (taskId) break
    if (interpreterRounds >= 2) break
    interpreterRounds++
    const v = await interpretBridgeReply({
      service: SERVICE,
      toolCalled: 'generate_video',
      sentArgs: params,
      reply: text,
      allowedTools: bridgeToolNames(SERVICE),
      onNote: opts.onProgress
    })
    if (v.action === 'fail' || !v.tool) throw new Error(errText('generate_video', v.reason ?? 'Runway refused this render'))
    if (v.tool !== 'generate_video') await bridgeToolCall(SERVICE, v.tool, v.args ?? {})
    opts.onProgress?.('Claude answered — resubmitting…')
  }
  if (!taskId) throw new Error(errText('generate_video', `no task id in response: ${humanDetail(payloadText(sub!))}`))
  markProviderAccepted() // the supplier has it: never sent again (audit 2026-10-09 batch 2)
  opts.onRequestId?.(taskId, RUNWAY_MCP_ENDPOINT)

  // poll get_task — their guidance is a slow cadence for video; 12.11 tolerances still apply
  const deadline = Date.now() + 45 * 60_000
  let failures = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error(errText('poll', 'render exceeded the 45-minute deadline'))
    await new Promise((r) => setTimeout(r, 10_000))
    let ts: McpToolResult
    try {
      ts = await bridgeToolCall(SERVICE, 'get_task', { id: taskId })
      failures = 0
    } catch (e) {
      if (++failures >= 5) throw e
      continue
    }
    const st = readTask(ts)
    if (st.status === 'SUCCEEDED' && st.url) {
      opts.onProgress?.('downloading result…')
      const out = join(opts.outDir, `runway-mcp-${taskId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
      await downloadTo(st.url, out)
      return { file: out }
    }
    if (TERMINAL_BAD.includes(st.status)) throw new Error(errText('task', `${st.status}: ${humanDetail(payloadText(ts))}`))
    opts.onProgress?.(st.status ? `Runway: ${st.status.toLowerCase()}…` : 'rendering…')
  }
}

export async function fetchRunwayMcpResult(requestId: string, outDir: string): Promise<{ state: 'done'; file: string } | { state: 'running' } | { state: 'gone' }> {
  if (!bridgeReady(SERVICE)) return { state: 'running' } // logged out ≠ job gone — retry next open
  let ts: McpToolResult
  try {
    ts = await bridgeToolCall(SERVICE, 'get_task', { id: requestId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return /not found|unknown task|404/i.test(msg) ? { state: 'gone' } : { state: 'running' }
  }
  const st = readTask(ts)
  if (st.status === 'SUCCEEDED' && st.url) {
    const out = join(outDir, `runway-mcp-${requestId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(st.url, out)
    return { state: 'done', file: out }
  }
  if (TERMINAL_BAD.includes(st.status)) return { state: 'gone' }
  return { state: 'running' }
}
