// VOICE renders (VOICES-SPEC-2026-08-20) — a description or a clone reference + spoken text →
// engine → audio under <project>/voices/tree/. Wire field names are VERBATIM from fal's schemas
// (read 2026-08-20; pinned in audioModels.ts comments). Reuses fal.ts's key refcount, job
// tracking (Queue ✕ cancels voice jobs too), uploader, downloader and error text.
import { randomUUID } from 'crypto'
import { fal } from '@fal-ai/client'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { acquireFalKey, releaseFalKey, trackJob, untrackJob, downloadTo, falErrorText, uploadVideoCached } from './fal'
import { audioModelFor } from '@koan/vidancer-ui/shared/audioModels'

export interface VoiceRenderOpts {
  jobId?: string
  engine: string // audio-registry voice engine id
  mode: 'design' | 'clone'
  text: string // the spoken test line / dialogue ('' = design engines may speak their default)
  desc?: string // design mode: the voice description
  refAudioPath?: string // clone mode: the reference sample (absolute path — uploaded here)
  imagePath?: string // Seed Audio design: the character's image (its schema: an image ref EXCLUDES audio refs)
  options: Record<string, string | number | boolean> // engine dials
  falKey: string
  outDir: string // <project>/voices/tree
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

export interface VoiceOutput {
  file: string
  durationSec?: number
  seed?: number
}

const num = (v: string | number | boolean | undefined): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
const audioUrlOf = (out: Record<string, any>): string | undefined => out?.audio?.url ?? out?.audio_url?.url ?? out?.audio_url ?? out?.url
const audioExtOf = (url: string): string => (/\.wav(\?|$)/i.test(url) ? '.wav' : /\.ogg(\?|$)/i.test(url) ? '.ogg' : '.mp3')

// engine-specific wire input — every field name verbatim from the 2026-08-20 schema reads
function emitVoiceInput(engineId: string, o: { text: string; desc?: string; refUrl?: string; imageUrl?: string; options: Record<string, string | number | boolean> }): { endpoint: string; input: Record<string, unknown> } {
  const m = audioModelFor(engineId)
  const endpoint = m.endpoint ?? ''
  if (!endpoint) throw new Error(`${m.label}: no render path yet`)
  if (m.maxTextChars && o.text.length > m.maxTextChars) throw new Error(`${m.label} takes ${m.maxTextChars} characters per render — this text is ${o.text.length}. Split it.`)
  const d = o.options
  switch (engineId) {
    case 'chatterbox-api':
      return {
        endpoint,
        input: {
          text: o.text,
          ...(o.refUrl ? { audio_url: o.refUrl } : {}),
          exaggeration: num(d.exaggeration) ?? 0.5,
          cfg: num(d.cfg) ?? 0.5,
          temperature: num(d.temperature) ?? 0.8,
          ...(num(d.seed) != null ? { seed: num(d.seed) } : {}),
          high_quality_audio: true // 48kHz — highest quality is the default, always
        }
      }
    case 'chatterbox-multilingual':
      return {
        endpoint,
        input: {
          text: o.text,
          ...(o.refUrl ? { audio_url: o.refUrl } : {}), // presence on this variant confirmed at the first live render
          ...(typeof d.language === 'string' && d.language ? { voice: d.language } : {}),
          exaggeration: num(d.exaggeration) ?? 0.5,
          cfg_scale: num(d.cfg) ?? 0.5,
          temperature: num(d.temperature) ?? 0.8,
          ...(num(d.seed) != null ? { seed: num(d.seed) } : {})
        }
      }
    case 'f5-tts-api':
      if (!o.refUrl) throw new Error('F5-TTS clones — it needs a reference sample')
      return {
        endpoint,
        input: { gen_text: o.text, ref_audio_url: o.refUrl, ref_text: '', model_type: 'F5-TTS', remove_silence: true }
      }
    case 'seed-audio-1': {
      // design: the description IS the prompt; clone: @Audio1 binds the reference (schema law:
      // an image ref would EXCLUDE audio refs — this path never sends one)
      const say = o.text.trim() ? `\n\nThe voice says: ${JSON.stringify(o.text.trim())}` : ''
      const prompt = o.refUrl
        ? `@Audio1 is the voice reference — speak in exactly that voice.${say}`
        : `${(o.desc ?? '').trim()}${say}`
      if (!prompt.trim()) throw new Error('Seed Audio needs a voice description or a reference')
      return {
        endpoint,
        input: {
          prompt,
          ...(o.refUrl ? { audio_urls: [o.refUrl] } : {}),
          ...(o.imageUrl && !o.refUrl ? { image_url: o.imageUrl } : {}), // schema law: image EXCLUDES audio refs
          output_format: 'mp3',
          sample_rate: 48000 // highest quality is the default, always
        }
      }
    }
    default:
      throw new Error(`${m.label}: no render path yet`)
  }
}

// crash recovery for voice renders — the voice sibling of fetchScoreResult
export async function fetchVoiceResult(
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
    const outPath = join(outDir, `voice_${Date.now()}_${randomUUID().slice(0, 8)}${audioExtOf(url)}`)
    await downloadTo(url, outPath)
    const dur = out?.duration ?? out?.metadata?.duration
    return { state: 'done', file: outPath, durationSec: typeof dur === 'number' && dur > 0 ? dur : undefined, seed: typeof out?.seed === 'number' ? out.seed : undefined }
  } finally {
    releaseFalKey()
  }
}

export async function runVoiceRender(opts: VoiceRenderOpts): Promise<VoiceOutput> {
  const model = audioModelFor(opts.engine)
  acquireFalKey(opts.falKey)
  try {
    let refUrl: string | undefined
    if (opts.refAudioPath) {
      opts.onProgress?.('uploading the reference…')
      refUrl = await uploadVideoCached(opts.refAudioPath, undefined, opts.onProgress) // cached fal.storage upload — any file type
    }
    let imageUrl: string | undefined
    if (opts.imagePath && !refUrl) {
      opts.onProgress?.('uploading the character image…')
      imageUrl = await uploadVideoCached(opts.imagePath, undefined, opts.onProgress)
    }
    const { endpoint, input } = emitVoiceInput(opts.engine, { text: opts.text, desc: opts.desc, refUrl, imageUrl, options: opts.options })
    opts.onProgress?.(`submitting to ${model.label}…`)
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
          if (u.status === 'IN_PROGRESS') opts.onProgress?.('speaking on fal…')
          else if (u.status) opts.onProgress?.(u.status.toLowerCase().replace(/_/g, ' '))
        }
      })
    } catch (e) {
      throw new Error(falErrorText(e, endpoint, Object.keys(input)))
    }
    const out = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
    const url = audioUrlOf(out)
    if (!url) throw new Error('No audio URL in fal result: ' + JSON.stringify(out).slice(0, 400))
    opts.onProgress?.('downloading the voice…')
    await mkdir(opts.outDir, { recursive: true })
    const outPath = join(opts.outDir, `voice_${Date.now()}_${randomUUID().slice(0, 8)}${audioExtOf(url)}`)
    await downloadTo(url, outPath)
    opts.onProgress?.('done')
    const dur = out?.duration ?? out?.metadata?.duration
    return { file: outPath, durationSec: typeof dur === 'number' && dur > 0 ? dur : undefined, seed: typeof out?.seed === 'number' ? out.seed : undefined }
  } finally {
    untrackJob(opts.jobId)
    releaseFalKey()
  }
}
