// Bridge IMAGE lane (list 9 / 50, 2026-09-30) — Image Edit on a supplier he is logged in to on the
// Bridge panel, paid from that plan's credits. His ask (09-26): "add other suppliers for nano
// banana on image edit, see if ant of our bidges allow for it". Built from each one's LIVE
// tools/list capture of that day (userData/bridge-tools) and Higgsfield's live model catalog:
//   Higgsfield  generate_image { params: { model, prompt, count, aspect_ratio, resolution ('1k'…),
//               medias[{ value: media_id, role: 'image_references' }], use_unlim: false } }
//               → results[].id; job_status { jobId, sync: true }
//   Runway      generate_image { model, promptText, ratio, imageSize ('1K'…), count,
//               referenceImages[{ url, tag }] } → a task id; get_task { id }
//   Pika        generate_image_edit { provider, images[url], prompt, aspect_ratio, resolution,
//               background: true } (no image: generate_image) → task_id; task_status { task_id }
// One image per call on all three (Pika's Gemini providers refuse a batch): several variants =
// several calls, like ModelArk and Google. The prompt goes out exactly as written. Uploads ride
// each supplier's own upload tools, shared with its video adapter.
import { nativeImage } from 'electron'
import { extname, join } from 'path'
import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { downloadTo } from '../../fal'
import { landVariants } from '../../falImage'
import { REGION_LINE, type BridgeImageService } from '@koan/vidancer-ui/shared/imageModels'
import { bridgeToolCall, bridgeReady, bridgeToolNames, onBestLogin } from '../../bridge'
import { interpretBridgeReply } from '../../bridge/interpreter'
import type { McpToolResult } from '../../bridge/mcpClient'
import { payloadText, hunt, huntString, resultObjects, resultText, humanDetail } from './hunt'
import { uploadLocal as higgsUpload, huntJobId } from './higgsfieldMcp'
import { uploadLocal as runwayUpload, huntTaskId } from './runwayMcp'
import { uploadLocal as pikaUpload } from './pikaMcp'
import { assertNotStopped, markProviderAccepted } from '../../jobNotifications'

export interface BridgeImageOpts {
  service: BridgeImageService
  slug: string // the model's id on that supplier (the VIA row's)
  label: string // the model's name, for messages
  aspects?: string[] // the ratios the supplier takes for it (the VIA row's; absent = the model's own, 'auto' included)
  prompt: string
  baseImage?: string // absent = text-to-image
  refImages: string[]
  numImages: number
  aspectRatio: string
  resolution?: string
  maskImage?: string // a selection: its outline is already drawn on the base; REGION_LINE rides after the prompt
  outDir: string
  onProgress?: (msg: string) => void
}

const NAME: Record<BridgeImageService, string> = { higgsfield: 'Higgsfield', runway: 'Runway', pika: 'Pika' }
const err = (svc: BridgeImageService, where: string, detail: string): string => `error @ ${svc}/${where}: ${humanDetail(detail)}`

// the ratio the supplier gets: his pick. On 'auto' the supplier's own auto where it has one, else
// the ratio it takes that is nearest the base image's shape (a picked ratio it can't take is
// refused here, before anything is spent)
const ratioOf = (a: string): number => {
  const [w, h] = a.split(':').map(Number)
  return w / h
}
export function bridgeRatio(o: Pick<BridgeImageOpts, 'service' | 'label' | 'aspects' | 'aspectRatio' | 'baseImage' | 'maskImage'>, baseSize?: { width: number; height: number }): string | undefined {
  const want = o.maskImage && o.baseImage ? 'auto' : o.aspectRatio // a selection keeps the base's own shape
  const takes = o.aspects
  if (want !== 'auto') {
    if (takes && !takes.includes(want)) throw new Error(`${o.label} on ${NAME[o.service]} takes ${takes.filter((a) => a !== 'auto').join(', ')} — pick one of those (nothing was spent)`)
    return want
  }
  if (!takes || takes.includes('auto')) return o.baseImage ? 'auto' : undefined
  if (!baseSize || !baseSize.width || !baseSize.height) return undefined
  const shape = baseSize.width / baseSize.height
  return [...takes].sort((a, b) => Math.abs(Math.log(ratioOf(a) / shape)) - Math.abs(Math.log(ratioOf(b) / shape)))[0]
}

// the finished image's address, wherever the reply keeps it: a named result field first, then any
// image link in the payload (their shapes are undocumented — the same hunting the video lanes do)
const IMAGE_LINK = /https?:\/\/[^\s"'\\]+?\.(?:png|jpe?g|webp)(?:\?[^\s"'\\]*)?/i
export function imageUrlIn(r: McpToolResult): string | undefined {
  for (const o of resultObjects(r)) { // never from the request the reply repeats back (M15)
    // Higgsfield's job: { results: [{ url | image_url … }] } / { result: { url } }; Pika: urls[] / url
    const urls = (o as { urls?: unknown }).urls
    if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
    const hit = huntString(o, ['image_url', 'imageUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl', 'output_url', 'outputUrl', 'raw_url', 'rawUrl'])
    if (hit && /^https?:\/\//.test(hit)) return hit
  }
  return resultText(r).match(IMAGE_LINK)?.[0]
}
const extOf = (url: string): string => {
  const e = extname(new URL(url).pathname).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(e) ? e : '.png'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
// why a job failed, in their words: a named reason field first (a reply often carries the same JSON
// twice, as data and as text, which the generic digger can't parse), else whatever reads
const why = (r: McpToolResult): string => hunt(r, ['failure_reason', 'failureReason', 'failure', 'error_message', 'errorMessage', 'message', 'reason', 'detail']) ?? humanDetail(payloadText(r))

// one supplier = how to send, how to read the job's id, how to ask after it
interface Lane {
  tool: (hasImages: boolean) => string
  args: (o: BridgeImageOpts, prompt: string, inputs: string[], ratio: string | undefined) => Record<string, unknown>
  upload: (path: string, onProgress?: (m: string) => void) => Promise<string>
  jobId: (r: McpToolResult) => string | undefined
  poll: (id: string) => Promise<McpToolResult>
  done: (status: string) => boolean
  bad: string[]
  waitMs: number
}
const LANES: Record<BridgeImageService, Lane> = {
  higgsfield: {
    tool: () => 'generate_image',
    args: (o, prompt, inputs, ratio) => ({
      params: {
        model: o.slug,
        prompt,
        count: 1,
        use_unlim: false, // credits, always: left out, their server stops to ask a question no pipeline can answer
        ...(ratio ? { aspect_ratio: ratio } : {}),
        ...(o.resolution ? { resolution: o.resolution.toLowerCase() } : {}),
        ...(inputs.length ? { medias: inputs.map((value) => ({ value, role: 'image_references' })) } : {})
      }
    }),
    upload: higgsUpload,
    jobId: huntJobId,
    poll: (jobId) => bridgeToolCall('higgsfield', 'job_status', { jobId, sync: true }),
    done: (s) => /complet|succe|done|finish/.test(s),
    bad: ['failed', 'error', 'nsfw', 'cancelled', 'canceled', 'rejected'],
    waitMs: 2000
  },
  runway: {
    tool: () => 'generate_image',
    args: (o, prompt, inputs, ratio) => ({
      rationale: 'Image Edit in Video Dancer: the user pressed render on this exact prompt',
      model: o.slug,
      promptText: prompt,
      count: 1,
      ...(ratio ? { ratio } : {}),
      ...(o.resolution ? { imageSize: o.resolution } : {}),
      // the image being edited goes first, tagged "input" (their own convention); refs follow
      ...(inputs.length ? { referenceImages: inputs.map((url, i) => ({ url, tag: i === 0 && o.baseImage ? 'input' : `ref${o.baseImage ? i : i + 1}` })) } : {})
    }),
    upload: runwayUpload,
    jobId: huntTaskId,
    poll: (id) => bridgeToolCall('runway', 'get_task', { id }),
    done: (s) => s === 'succeeded',
    bad: ['failed', 'canceled', 'cancelled'], // throttled = accepted, waiting for a slot (audit 2026-10-09 H5)
    waitMs: 5000
  },
  pika: {
    tool: (hasImages) => (hasImages ? 'generate_image_edit' : 'generate_image'),
    args: (o, prompt, inputs, ratio) => ({
      provider: o.slug,
      prompt,
      background: true, // a task id straight away; task_status is the poll
      ...(ratio ? { aspect_ratio: ratio } : {}),
      ...(o.resolution ? { resolution: o.resolution } : {}),
      ...(inputs.length ? { images: inputs } : {})
    }),
    upload: pikaUpload,
    jobId: (r) => hunt(r, ['task_id', 'taskId']),
    poll: (task_id) => bridgeToolCall('pika', 'task_status', { task_id }), // blocks ~20 s on their side
    done: (s) => s === 'completed',
    bad: ['failed', 'cancelled', 'canceled', 'error', 'rejected'],
    waitMs: 1000
  }
}

async function one(o: BridgeImageOpts, prompt: string, inputs: string[], ratio: string | undefined): Promise<string> {
  const lane = LANES[o.service]
  const who = NAME[o.service]
  const tool = lane.tool(inputs.length > 0)
  const original = lane.args(o, prompt, inputs, ratio)
  let args = original
  let sub: McpToolResult | undefined
  let id: string | undefined
  let url: string | undefined
  let confirmed = false
  let rounds = 0
  for (let attempt = 0; attempt < 5 && !id && !url; attempt++) {
    assertNotStopped() // ✕ already pressed: never sent (audit 2026-10-09 H12)
    sub = await bridgeToolCall(o.service, tool, args)
    const text = payloadText(sub)
    // Pika's cost gate: the render button WAS the approval — confirm once with their token
    if (text.includes('cost_confirmation_required') && !confirmed) {
      const token = hunt(sub, ['confirm_token', 'confirmToken'])
      if (token) {
        confirmed = true
        args = { ...original, confirm_token: token }
        o.onProgress?.(`confirming the cost with ${who}…`)
        continue
      }
    }
    if (text.includes('paid_plan_required')) throw new Error(err(o.service, tool, `${who} says ${o.label} needs a paid plan on that account`))
    if (sub.isError) throw new Error(err(o.service, tool, why(sub)))
    id = lane.jobId(sub)
    if (id) break
    // an answer that already carries the picture: never one of the links it was sent, never on a
    // failure (it took the uploaded base as the finished edit) (audit 2026-10-09 M15)
    const subStatus = (hunt(sub, ['status', 'state']) ?? '').toLowerCase()
    const inline = lane.bad.some((b) => subStatus.includes(b)) ? undefined : imageUrlIn(sub)
    url = inline && !JSON.stringify(args).includes(inline) && !inputs.includes(inline) ? inline : undefined
    if (url) break
    // Higgsfield may answer with a preset offer instead of a job: decline it, the render is literal
    const preset = text.includes('preset_recommendation') ? hunt(sub, ['id', 'preset_id']) : undefined
    if (preset && o.service === 'higgsfield') {
      const p = (original.params ?? {}) as Record<string, unknown>
      args = { params: { ...p, declined_preset_id: preset } }
      continue
    }
    if (rounds >= 2) break // fail below, in their own words
    rounds++
    const v = await interpretBridgeReply({ service: o.service, toolCalled: tool, sentArgs: args, reply: text, allowedTools: bridgeToolNames(o.service), onNote: o.onProgress })
    if (v.action === 'fail' || !v.tool) throw new Error(err(o.service, tool, v.reason ?? `${who} refused this render`))
    if (v.tool !== tool) await bridgeToolCall(o.service, v.tool, v.args ?? {}) // one side call, then the SAME request again
    args = original
    o.onProgress?.('Claude answered — resubmitting…')
  }
  if (!id && !url) throw new Error(err(o.service, tool, `no job id in the reply: ${humanDetail(payloadText(sub!))}`))
  markProviderAccepted() // the supplier answered: paid, never sent again (audit 2026-10-09 batch 2)

  // an image is minutes at most: 5 bad polls or 15 minutes ends it
  const deadline = Date.now() + 15 * 60_000
  let failures = 0
  while (!url) {
    if (Date.now() > deadline) throw new Error(err(o.service, 'poll', 'the image took more than 15 minutes'))
    await sleep(lane.waitMs)
    let js: McpToolResult
    try {
      js = await lane.poll(id!)
      failures = 0
    } catch (e) {
      if (++failures >= 5) throw e
      continue
    }
    const status = (hunt(js, ['status', 'state']) ?? '').toLowerCase()
    if (lane.bad.some((b) => status.includes(b))) throw new Error(err(o.service, 'job', `${status}: ${why(js)}`))
    const found = imageUrlIn(js)
    if (found && (lane.done(status) || !status)) url = found
    else o.onProgress?.(status ? `${who}: ${status}…` : 'rendering…')
  }
  await mkdir(o.outDir, { recursive: true })
  const file = join(o.outDir, `edit_${randomUUID()}${extOf(url)}`)
  await downloadTo(url, file)
  return file
}

// list 33: one picture job, one login — the one with the most credits left (bridge/index.ts)
export const runBridgeImage = (o: BridgeImageOpts): Promise<{ files: string[]; seed?: number }> => onBestLogin(o.service, o, imageOnLogin)
async function imageOnLogin(o: BridgeImageOpts): Promise<{ files: string[]; seed?: number }> {
  const who = NAME[o.service]
  if (!bridgeReady(o.service)) throw new Error(`not logged in to ${who} — Bridge panel`)
  const region = !!(o.baseImage && o.maskImage)
  const prompt = region ? `${o.prompt.trimEnd()}\n\n${REGION_LINE}` : o.prompt
  const base = o.baseImage ? nativeImage.createFromPath(o.baseImage) : undefined
  const ratio = bridgeRatio(o, base && !base.isEmpty() ? base.getSize() : undefined) // refuses a ratio they don't take before any upload
  const paths = [...(o.baseImage ? [o.baseImage] : []), ...o.refImages]
  const inputs: string[] = []
  if (paths.length) o.onProgress?.(`sending ${paths.length} image${paths.length === 1 ? '' : 's'} to ${who}…`)
  for (const p of paths) inputs.push(await LANES[o.service].upload(p, o.onProgress))
  const n = Math.max(1, Math.min(4, o.numImages))
  o.onProgress?.(`generating on ${who}${n > 1 ? ` (${n} at once)` : ''}…`)
  return { files: await landVariants(n, () => one(o, prompt, inputs, ratio), o.onProgress) }
}
