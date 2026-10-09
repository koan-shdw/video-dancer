// Magnific MCP adapter — the THIRD Bridge render lane (BRIDGE-SPEC-2026-09-01). Built 2026-09-01
// from the LIVE tools/list capture (userData/bridge-tools/magnific.json):
//   video_generate { slug (verbatim from video_models_list — resolved live, cached), duration
//                    (REQUIRED with slug), prompt, aspectRatio, resolution,
//                    keyframes{start,end} (i2v), references[{type,url}] (ref2v — image/video/
//                    audio types; start frames are MUTUALLY EXCLUSIVE with references) }
//   → creation identifier(s) → creations_wait {identifiers} long-poll (≤25s server-side)
//   uploads: creations_request_upload {mimeType} → PUT → creations_finalize_upload {path}
//            → creation identifier (refs accept "asset URL or creation identifier")
// GATE (field-proven): their MCP needs a PAID Magnific plan — a free account logs in but every
// credit call refuses; that surfaces as their own error text, plainly. UNPROVEN until the
// account-holder's first render: the seedance slug names, response shapes (hunted defensively),
// audio behavior (withSoundEffects left OFF v1 — "only when model has soundEffects.allowed").
import { readFile, stat } from 'fs/promises'
import { extname, join } from 'path'
import { randomUUID } from 'crypto'
import { downloadTo, type RenderRequest, type RenderOutput } from '../../fal'
import { modelFor } from '@koan/vidancer-ui/shared/models'
import { bridgeToolCall, bridgeReady, bridgeToolNames, onBestLogin } from '../../bridge'
import { interpretBridgeReply } from '../../bridge/interpreter'
import type { McpToolResult } from '../../bridge/mcpClient'
import { payloadObjects, payloadText, hunt, humanDetail } from './hunt'
import { assertNotStopped, markProviderAccepted } from '../../jobNotifications'

export interface MagnificMcpRenderOpts extends RenderRequest {
  outDir: string
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

const SERVICE = 'magnific' as const
export const MAGNIFIC_MCP_ENDPOINT = 'magnific-mcp/video_generate'

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

// ----- model slugs — the catalog is TOON text; the registry stores a family key ('2.0'/'2.5')
// and the live slug is resolved once per session ("copy it verbatim from video_models_list") ----
let slugCache: string[] | null = null
async function seedanceSlug(versionKey: string): Promise<string> {
  if (!slugCache) {
    const r = await bridgeToolCall(SERVICE, 'video_models_list', { search: 'seedance' })
    slugCache = [...new Set(payloadText(r).match(/[a-z0-9][a-z0-9.-]*seedance[a-z0-9.-]*/gi) ?? [])].map((s) => s.toLowerCase())
  }
  const want = versionKey === '2.5' ? slugCache.filter((s) => s.includes('2.5')) : slugCache.filter((s) => s.includes('2.0') || !s.includes('2.5'))
  const slug = want[0]
  if (!slug) throw new Error(errText('video_models_list', `no seedance ${versionKey} model in Magnific's catalog (saw: ${slugCache.join(', ') || 'none'})`))
  return slug
}

// upload cache — creation identifiers are stable; project media is immutable
const uploadCache = new Map<string, { sig: string; id: string }>()
const UPLOAD_CACHE_MAX = 60

async function uploadLocal(path: string, onProgress?: (m: string) => void): Promise<string> {
  const st = await stat(path)
  const sig = `${st.size}|${st.mtimeMs}`
  const hit = uploadCache.get(path)
  if (hit && hit.sig === sig) return hit.id
  const req = await bridgeToolCall(SERVICE, 'creations_request_upload', { mimeType: mimeFor(path) })
  const putUrl = hunt(req, ['uploadUrl', 'upload_url', 'url', 'putUrl'])
  const tmpPath = hunt(req, ['path', 'tempPath', 'temp_path'])
  if (!putUrl || !tmpPath) throw new Error(errText('creations_request_upload', `no upload url/path in response: ${humanDetail(payloadText(req))}`))
  if (st.size > 8 * 1024 * 1024) onProgress?.(`uploading ${path.split(/[\\/]/).pop()} (${Math.round(st.size / (1024 * 1024))} MB)…`)
  const buf = await readFile(path)
  const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': mimeFor(path) }, body: new Uint8Array(buf) })
  if (!put.ok) throw new Error(errText('upload PUT', `HTTP ${put.status}`))
  const fin = await bridgeToolCall(SERVICE, 'creations_finalize_upload', { path: tmpPath })
  const id = hunt(fin, ['identifier', 'creationIdentifier', 'creation_identifier', 'id'])
  if (!id) throw new Error(errText('creations_finalize_upload', `no creation identifier in response: ${humanDetail(payloadText(fin))}`))
  uploadCache.set(path, { sig, id })
  if (uploadCache.size > UPLOAD_CACHE_MAX) {
    const oldest = uploadCache.keys().next().value
    if (oldest) uploadCache.delete(oldest)
  }
  return id
}

function huntIdentifiers(r: McpToolResult): string[] {
  const out = new Set<string>()
  const walk = (o: unknown, d: number): void => {
    if (d > 7 || o === null || typeof o !== 'object') return
    if (Array.isArray(o)) {
      for (const x of o) walk(x, d + 1)
      return
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (/identifier/i.test(k) && typeof v === 'string' && v) out.add(v)
      else walk(v, d + 1)
    }
  }
  for (const o of payloadObjects(r)) walk(o, 0)
  return [...out]
}

interface CreationState {
  status: string
  url?: string
}
function readCreation(r: McpToolResult): CreationState {
  const status = (hunt(r, ['status', 'state']) ?? '').toLowerCase()
  let url = hunt(r, ['originalUrl', 'original_url', 'video_url', 'videoUrl', 'url'])
  if (!url || !/\.(mp4|mov|webm)/.test(url)) {
    const m = payloadText(r).match(/https?:\/\/[^\s"'\\]+?\.(?:mp4|mov|webm)[^\s"'\\]*/)
    if (m) url = m[0]
  }
  return { status, url }
}
const TERMINAL_BAD = ['failed', 'error', 'rejected', 'cancelled', 'canceled', 'moderated']

// list 33: one render, one login — the one with the most credits left (bridge/index.ts)
export const runMagnificMcpRender = (opts: MagnificMcpRenderOpts): Promise<RenderOutput> => onBestLogin(SERVICE, opts, renderOnLogin)
async function renderOnLogin(opts: MagnificMcpRenderOpts): Promise<RenderOutput> {
  if (!bridgeReady(SERVICE)) throw new Error('not logged in to Magnific — Bridge panel')
  const model = modelFor(opts.engine)
  const versionKey = model.endpoints[opts.mode]
  if (!versionKey) throw new Error(`${model.label} does not support ${opts.mode}`)
  const slug = await seedanceSlug(versionKey)

  const params: Record<string, unknown> = { slug, prompt: opts.prompt }
  const dur = parseInt(opts.duration, 10)
  params.duration = Number.isFinite(dur) ? dur : 5 // duration is REQUIRED with slug
  if (opts.aspectRatio && opts.aspectRatio !== 'auto') params.aspectRatio = opts.aspectRatio
  if (opts.resolution) params.resolution = opts.resolution

  if (opts.mode === 'i2v') {
    const start = opts.images[0] ? await uploadLocal(opts.images[0], opts.onProgress) : undefined
    if (start) {
      const kf: Record<string, unknown> = { start: { type: 'image', url: start } }
      if (opts.endImage) kf.end = { type: 'image', url: await uploadLocal(opts.endImage, opts.onProgress) }
      params.keyframes = kf
    }
  } else {
    // start frames are mutually exclusive with references (their schema) — ref2v uses references[]
    const refs: { type: string; url: string }[] = []
    for (const p of opts.images) refs.push({ type: 'image', url: await uploadLocal(p, opts.onProgress) })
    for (const p of opts.videos ?? []) refs.push({ type: 'video', url: await uploadLocal(p, opts.onProgress) })
    for (const p of opts.audios ?? []) refs.push({ type: 'audio', url: await uploadLocal(p, opts.onProgress) })
    if (refs.length) params.references = refs
  }

  opts.onProgress?.('submitting to Magnific…')
  let sub: McpToolResult | undefined
  let ids: string[] = []
  let interpreterRounds = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
    sub = await bridgeToolCall(SERVICE, 'video_generate', params)
    const text = payloadText(sub)
    if (sub.isError) throw new Error(errText('video_generate', text))
    ids = huntIdentifiers(sub)
    if (ids.length) break
    if (interpreterRounds >= 2) break
    interpreterRounds++
    const v = await interpretBridgeReply({
      service: SERVICE,
      toolCalled: 'video_generate',
      sentArgs: params,
      reply: text,
      allowedTools: bridgeToolNames(SERVICE),
      onNote: opts.onProgress
    })
    if (v.action === 'fail' || !v.tool) throw new Error(errText('video_generate', v.reason ?? 'Magnific refused this render'))
    if (v.tool !== 'video_generate') await bridgeToolCall(SERVICE, v.tool, v.args ?? {})
    opts.onProgress?.('Claude answered — resubmitting…')
  }
  if (!ids.length) throw new Error(errText('video_generate', `no creation identifier in response: ${humanDetail(payloadText(sub!))}`))
  const creationId = ids[0]
  markProviderAccepted() // the supplier has it: never sent again (audit 2026-10-09 batch 2)
  opts.onRequestId?.(creationId, MAGNIFIC_MCP_ENDPOINT)

  const deadline = Date.now() + 45 * 60_000
  let failures = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error(errText('poll', 'render exceeded the 45-minute deadline'))
    let cw: McpToolResult
    try {
      cw = await bridgeToolCall(SERVICE, 'creations_wait', { identifiers: [creationId], timeoutSeconds: 25 })
      failures = 0
    } catch (e) {
      if (++failures >= 5) throw e
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    const st = readCreation(cw)
    if (st.url && (st.status.includes('complete') || st.status.includes('succeed') || st.status.includes('done') || st.status === '')) {
      opts.onProgress?.('downloading result…')
      const out = join(opts.outDir, `magnific-mcp-${creationId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
      await downloadTo(st.url, out)
      return { file: out }
    }
    if (TERMINAL_BAD.some((s) => st.status.includes(s))) throw new Error(errText('creation', `${st.status}: ${humanDetail(payloadText(cw))}`))
    opts.onProgress?.(st.status ? `Magnific: ${st.status}…` : 'rendering…')
  }
}

export async function fetchMagnificMcpResult(requestId: string, outDir: string): Promise<{ state: 'done'; file: string } | { state: 'running' } | { state: 'gone' }> {
  if (!bridgeReady(SERVICE)) return { state: 'running' }
  let cw: McpToolResult
  try {
    cw = await bridgeToolCall(SERVICE, 'creation_status', { creationIdentifier: requestId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return /not found|unknown|404/i.test(msg) ? { state: 'gone' } : { state: 'running' }
  }
  const st = readCreation(cw)
  if (st.url && !TERMINAL_BAD.some((s) => st.status.includes(s))) {
    const out = join(outDir, `magnific-mcp-${requestId.slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`)
    await downloadTo(st.url, out)
    return { state: 'done', file: out }
  }
  if (TERMINAL_BAD.some((s) => st.status.includes(s))) return { state: 'gone' }
  return { state: 'running' }
}
