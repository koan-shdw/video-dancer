// SCORE renders (SCORE-PLAN phase 3) — beats + recipe → engine-specific prompt → fal → a WAV in
// <project>/scores/. Wire schemas read off fal's OpenAPI 2026-08-19 (field names below are
// verbatim from the schemas — see audioModels.ts). Reuses fal.ts's key refcount, job tracking
// (Queue ✕ cancels score jobs too), downloader and error text.
import { randomUUID } from 'crypto'
import { fal } from '@fal-ai/client'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { acquireFalKey, releaseFalKey, trackJob, untrackJob, downloadTo, falErrorText, uploadVideoCached } from './fal'
import { probeFile } from './export'
import { audioModelFor } from '@koan/vidancer-ui/shared/audioModels'
import { scoreModel } from '@koan/vidancer-ui/shared/scoreRequest'
import { emitScoreInput } from '@koan/vidancer-ui/shared/emitScore'
import { googlePost, googleBlocks } from './providers/google'
import type { ScoreBeat } from '@koan/vidancer-ui/shared/types'

export interface ScoreRenderOpts {
  jobId?: string
  engine: string // audio-registry id
  beats: ScoreBeat[]
  options: Record<string, string | number | boolean>
  falKey: string
  elevenKey?: string // the ElevenLabs Music door (SCORE-WATCH-SPEC §4) — direct API, not fal
  googleKey?: string // list 20: Lyria 3.5 composes on the Google key
  outDir: string // <project>/scores
  videoPath?: string // video-to-music engines: the rendered span proxy to upload + score
  images?: { mime_type: string; data: string }[] // list 20: pictures the music follows (Lyria), ready for the wire
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

export interface ScoreOutput {
  file: string
  durationSec?: number
  seed?: number
}

const audioUrlOf = (out: Record<string, any>): string | undefined => out?.audio?.url ?? out?.audio_url ?? out?.url
const audioDurOf = (out: Record<string, any>): number | undefined => {
  const d = out?.duration ?? out?.metadata?.duration ?? out?.audio?.duration
  return typeof d === 'number' && d > 0 ? d : undefined
}
// the download keeps the wire format's real extension (Sonilo returns AAC .m4a, the others wav)
const audioExtOf = (url: string): string => (/\.m4a(\?|$)/i.test(url) ? '.m4a' : /\.mp3(\?|$)/i.test(url) ? '.mp3' : /\.aac(\?|$)/i.test(url) ? '.aac' : '.wav')
async function scoreDuration(file: string, out: Record<string, any>): Promise<number | undefined> {
  const duration = audioDurOf(out)
  if (duration) return duration
  try { return (await probeFile(file)).duration || undefined } catch { return undefined }
}

export async function runScoreRender(opts: ScoreRenderOpts): Promise<ScoreOutput> {
  // shared emit (shared/emitScore.ts) — the Score card previews EXACTLY this content
  const { endpoint, input } = emitScoreInput(opts.engine, opts.beats, opts.options)
  const model = scoreModel(opts.engine)
  if (model.provider === 'elevenlabs') return renderEleven(opts, input, endpoint.slice(endpoint.indexOf(':') + 1))
  if (model.provider === 'google') return renderGoogle(opts, input)
  if (model.provider !== 'fal') throw new Error(`${model.label} must use its local runtime.`)
  if (!opts.falKey) throw new Error('No fal key saved — add it in Settings → API → fal.')
  acquireFalKey(opts.falKey)
  try {
    if (model.videoToMusic) {
      // the span proxy is the real input — upload replaces the preview placeholder
      if (!opts.videoPath) throw new Error(`${model.label} needs the rendered span video — stretch this score over the timeline first`)
      input.video_url = await uploadVideoCached(opts.videoPath, undefined, opts.onProgress)
    }
    opts.onProgress?.(`submitting to ${audioModelFor(opts.engine).label}…`)
    const track = trackJob(opts.jobId, endpoint)
    let result: unknown
    try {
      result = await fal.subscribe(endpoint, {
        input,
        logs: true,
        onEnqueue: (requestId: string) => {
          track?.(requestId)
          opts.onRequestId?.(requestId, endpoint)
        },
        onQueueUpdate: (u: { status?: string }) => {
          if (u.status === 'IN_PROGRESS') opts.onProgress?.('composing on fal…')
          else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
        }
      })
    } catch (e) {
      throw new Error(falErrorText(e, endpoint, Object.keys(input)))
    }
    const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
    const url = audioUrlOf(out)
    if (!url) throw new Error('No audio URL in fal result: ' + JSON.stringify(out).slice(0, 400))
    opts.onProgress?.('downloading score…')
    await mkdir(opts.outDir, { recursive: true })
    const outPath = join(opts.outDir, `score_${Date.now()}_${randomUUID().slice(0, 8)}${audioExtOf(url)}`)
    await downloadTo(url, outPath)
    opts.onProgress?.('done')
    return { file: outPath, durationSec: await scoreDuration(outPath, out), seed: typeof out?.seed === 'number' ? out.seed : undefined }
  } finally {
    untrackJob(opts.jobId)
    releaseFalKey()
  }
}

// ---- ElevenLabs Music v2 (SCORE-WATCH-SPEC §4, API read 2026-09-08): POST /v1/music with
// xi-api-key; body = a composition_plan (our beats as chunks) or a prompt; the response is the
// audio bytes (mp3). No queue: a failed POST is a failed take, nothing to recover. ----
const ELEVEN_API = 'https://api.elevenlabs.io'
const elevenJobs = new Map<string, AbortController>() // every DIRECT score job (ElevenLabs, and list 20's Lyria)
// Stops our request/wait. Neither ElevenLabs nor Google exposes a remote cancel for these.
export function cancelScoreJob(jobId: string): boolean {
  const controller = elevenJobs.get(jobId)
  if (!controller) return false
  controller.abort()
  return true
}
// `path` = the door the engine's registry row names: /v1/music, or (list 22) /v1/sound-generation
async function renderEleven(opts: ScoreRenderOpts, input: Record<string, unknown>, path: string): Promise<ScoreOutput> {
  if (!opts.elevenKey) throw new Error('No ElevenLabs key saved — paste it in Settings → API → ElevenLabs.')
  const controller = new AbortController()
  if (opts.jobId) elevenJobs.set(opts.jobId, controller)
  try {
  opts.onProgress?.(path === '/v1/music' ? 'composing on ElevenLabs…' : 'making the sound on ElevenLabs…')
  const res = await fetch(`${ELEVEN_API}${path}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': opts.elevenKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify(input),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)])
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    let msg = t.slice(0, 300)
    try {
      const j = JSON.parse(t) as { detail?: { message?: string; status?: string } | string }
      msg = typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? msg)
    } catch {
      /* not json */
    }
    throw new Error(`ElevenLabs ${res.status}: ${msg || 'rejected the request'}`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  controller.signal.throwIfAborted()
  if (bytes.length < 1000) throw new Error('ElevenLabs returned no audio')
  opts.onProgress?.('saving score…')
  await mkdir(opts.outDir, { recursive: true })
  const outPath = join(opts.outDir, `score_${Date.now()}_${randomUUID().slice(0, 8)}.mp3`)
  await writeFile(outPath, bytes)
  let durationSec: number | undefined
  try {
    durationSec = (await probeFile(outPath)).duration || undefined
  } catch {
    /* duration unknown — the take still lands */
  }
  opts.onProgress?.('done')
  return { file: outPath, durationSec }
  } finally {
    if (opts.jobId && elevenJobs.get(opts.jobId) === controller) elevenJobs.delete(opts.jobId)
  }
}
// ---- Lyria 3.5 (list 20; facts on its registry row): one Interactions call that answers with the
// song (and its lyrics / structure as text). No queue: nothing to recover. The ✕ stops our wait. ----
async function renderGoogle(opts: ScoreRenderOpts, input: Record<string, unknown>): Promise<ScoreOutput> {
  if (!opts.googleKey) throw new Error('No Google key saved — paste it in Settings → API → Google AI.')
  const controller = new AbortController()
  if (opts.jobId) elevenJobs.set(opts.jobId, controller)
  try {
    opts.onProgress?.('composing on Lyria 3.5…')
    // pictures ride beside the prompt (their documented shape): the text first, then each image
    const body = opts.images?.length ? { ...input, input: [{ type: 'text', text: input.input }, ...opts.images.map((i) => ({ type: 'image', ...i }))] } : input
    let out: Record<string, any>
    try {
      out = await googlePost('interactions', opts.googleKey, body, AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]))
    } catch (e) {
      throw controller.signal.aborted ? new Error('cancelled') : e
    }
    const audio = googleBlocks(out, 'audio').filter((b) => typeof b.data === 'string').pop()
    if (!audio) {
      const said = googleBlocks(out, 'text').map((b) => String(b.text)).join(' ').trim()
      throw new Error(`Lyria returned no song (${out.status ?? 'no status'})${said ? `: ${said.slice(0, 250)}` : ''}`)
    }
    const bytes = Buffer.from(audio.data as string, 'base64')
    if (bytes.length < 1000) throw new Error('Lyria returned no audio')
    opts.onProgress?.('saving score…')
    await mkdir(opts.outDir, { recursive: true })
    const outPath = join(opts.outDir, `score_${Date.now()}_${randomUUID().slice(0, 8)}${/wav/i.test(String(audio.mime_type)) ? '.wav' : '.mp3'}`)
    await writeFile(outPath, bytes)
    let durationSec: number | undefined
    try {
      durationSec = (await probeFile(outPath)).duration || undefined
    } catch {
      /* duration unknown — the take still lands */
    }
    opts.onProgress?.('done')
    return { file: outPath, durationSec }
  } finally {
    if (opts.jobId && elevenJobs.get(opts.jobId) === controller) elevenJobs.delete(opts.jobId)
  }
}
// "test key": GET /v1/user — checks the key, spends nothing
export async function validateElevenKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${ELEVEN_API}/v1/user`, { headers: { 'xi-api-key': key } })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected — create one at elevenlabs.io → Profile → API keys' }
    if (!r.ok) return { ok: false, error: `ElevenLabs error ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// crash recovery for score renders — the audio sibling of fal.ts fetchRenderResult
export async function fetchScoreResult(
  endpoint: string,
  requestId: string,
  falKey: string,
  outDir: string
): Promise<{ state: 'done'; file: string; durationSec?: number; seed?: number } | { state: 'running' } | { state: 'gone' }> {
  acquireFalKey(falKey)
  try {
    try {
      const status = (await fal.queue.status(endpoint, { requestId, logs: false })) as { status?: string }
      if (status.status !== 'COMPLETED') return { state: 'running' }
    } catch (e) {
      const st = (e as { status?: number }).status
      return st === 400 || st === 404 || st === 422 ? { state: 'gone' } : { state: 'running' }
    }
    const result = await fal.queue.result(endpoint, { requestId })
    const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
    const url = audioUrlOf(out)
    if (!url) return { state: 'gone' }
    await mkdir(outDir, { recursive: true })
    const outPath = join(outDir, `score_${Date.now()}_${randomUUID().slice(0, 8)}${audioExtOf(url)}`)
    await downloadTo(url, outPath)
    return { state: 'done', file: outPath, durationSec: await scoreDuration(outPath, out), seed: typeof out?.seed === 'number' ? out.seed : undefined }
  } finally {
    releaseFalKey()
  }
}
