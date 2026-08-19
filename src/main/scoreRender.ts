// SCORE renders (SCORE-PLAN phase 3) — beats + recipe → engine-specific prompt → fal → a WAV in
// <project>/scores/. Wire schemas read off fal's OpenAPI 2026-08-19 (field names below are
// verbatim from the schemas — see audioModels.ts). Reuses fal.ts's key refcount, job tracking
// (Queue ✕ cancels score jobs too), downloader and error text.
import { randomUUID } from 'crypto'
import { fal } from '@fal-ai/client'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { acquireFalKey, releaseFalKey, trackJob, untrackJob, downloadTo, falErrorText, uploadVideoCached } from './fal'
import { audioModelFor } from '../shared/audioModels'
import { emitScoreInput } from '../shared/emitScore'
import type { ScoreBeat } from '../shared/types'

export interface ScoreRenderOpts {
  jobId?: string
  engine: string // audio-registry id
  beats: ScoreBeat[]
  options: Record<string, string | number | boolean>
  falKey: string
  outDir: string // <project>/scores
  videoPath?: string // video-to-music engines: the rendered span proxy to upload + score
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
  const d = out?.duration ?? out?.metadata?.duration
  return typeof d === 'number' && d > 0 ? d : undefined
}
// the download keeps the wire format's real extension (Sonilo returns AAC .m4a, the others wav)
const audioExtOf = (url: string): string => (/\.m4a(\?|$)/i.test(url) ? '.m4a' : /\.mp3(\?|$)/i.test(url) ? '.mp3' : /\.aac(\?|$)/i.test(url) ? '.aac' : '.wav')

export async function runScoreRender(opts: ScoreRenderOpts): Promise<ScoreOutput> {
  // shared emit (shared/emitScore.ts) — the Score card previews EXACTLY this content
  const { endpoint, input } = emitScoreInput(opts.engine, opts.beats, opts.options)
  const model = audioModelFor(opts.engine)
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
    return { file: outPath, durationSec: audioDurOf(out), seed: typeof out?.seed === 'number' ? out.seed : undefined }
  } finally {
    untrackJob(opts.jobId)
    releaseFalKey()
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
    return { state: 'done', file: outPath, durationSec: audioDurOf(out), seed: typeof out?.seed === 'number' ? out.seed : undefined }
  } finally {
    releaseFalKey()
  }
}
