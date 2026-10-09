// VOICE renders (VOICES-SPEC-2026-08-20) — a description or a clone reference + spoken text →
// engine → audio under <project>/voices/tree/. Wire field names are VERBATIM from fal's schemas
// (read 2026-08-20; pinned in audioModels.ts comments). Reuses fal.ts's key refcount, job
// tracking (Queue ✕ cancels voice jobs too), uploader, downloader and error text.
import { randomUUID } from 'crypto'
import { fal } from '@fal-ai/client'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { acquireFalKey, releaseFalKey, trackJob, untrackJob, downloadTo, falErrorText, falRecoveryFetch, uploadAudioCached, uploadImageCached } from './fal'
import { audioModelFor, dialogueTurns } from '@koan/vidancer-ui/shared/audioModels'
import { googlePost, googleBlocks, GOOGLE_API } from './providers/google'
import { lostWait } from './jobNotifications'

export interface VoiceRenderOpts {
  jobId?: string
  engine: string // audio-registry voice engine id
  mode: 'design' | 'clone'
  text: string // the spoken test line / dialogue ('' = design engines may speak their default)
  desc?: string // design mode: the voice description
  refAudioPath?: string // clone mode: the reference sample (absolute path — uploaded here)
  consentAudioPath?: string // list 18: Gemini copies the sample only with the speaker's consent clip beside it (both 24 kHz mono WAV, made by the caller)
  speaker2?: { name: string; voice: string; style?: string } // list 18: the second voice of a two-speaker take
  imagePath?: string // Seed Audio design: the character's image (its schema: an image ref EXCLUDES audio refs)
  options: Record<string, string | number | boolean> // engine dials
  falKey?: string
  googleKey?: string // list 18: Gemini 3.8 TTS speaks on the Google key
  elevenKey?: string // list 19: Eleven v4 speaks on the ElevenLabs key
  voice?: string // the supplier's own voice to speak in (a pick, or the playing take's) — absent = design / clone one
  name?: string // the voice's name — a designed or cloned voice is saved under it on the supplier's side
  outDir: string // <project>/voices/tree
  onProgress?: (msg: string) => void
  onRequestId?: (requestId: string, endpoint: string) => void
}

export interface VoiceOutput {
  file: string
  durationSec?: number
  seed?: number
  voiceId?: string // the supplier voice it spoke in (Gemini / ElevenLabs)
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
    const r = await falRecoveryFetch(endpoint, requestId)
    if (r.state !== 'ready') return r
    const out = r.out
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

// ---- DIRECT suppliers (list 18 Gemini, list 19 ElevenLabs): one request that answers with the
// audio — no queue to poll, nothing to recover. The Queue's ✕ stops our wait. ----
const directJobs = new Map<string, AbortController>()
export function cancelVoiceJob(jobId: string): boolean {
  const c = directJobs.get(jobId)
  if (!c) return false
  c.abort()
  return true
}
async function direct(opts: VoiceRenderOpts, who: string, run: (o: VoiceRenderOpts, signal: AbortSignal) => Promise<VoiceOutput>): Promise<VoiceOutput> {
  const c = new AbortController()
  if (opts.jobId) directJobs.set(opts.jobId, c)
  try {
    return await run(opts, AbortSignal.any([c.signal, AbortSignal.timeout(300_000)]))
  } catch (e) {
    throw lostWait(who, e, c.signal) // L10
  } finally {
    if (opts.jobId && directJobs.get(opts.jobId) === c) directJobs.delete(opts.jobId)
  }
}
async function landAudio(opts: VoiceRenderOpts, bytes: Buffer, ext: string): Promise<string> {
  if (bytes.length < 1000) throw new Error('the supplier returned no audio')
  await mkdir(opts.outDir, { recursive: true })
  const file = join(opts.outDir, `voice_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`)
  await writeFile(file, bytes)
  opts.onProgress?.('done')
  return file
}

// Gemini 3.8 TTS (facts pinned on its registry rows). The voice: a pick (one of its library, or the
// playing take's own voice), else a COPY of the sample when the speaker's consent clip is beside
// it, else DESIGNED here from the description. A made voice is stored in his Google project.
async function renderGoogle(opts: VoiceRenderOpts, signal: AbortSignal): Promise<VoiceOutput> {
  if (!opts.googleKey) throw new Error('No Google key saved — paste it in Settings → API → Google AI.')
  const model = audioModelFor(opts.engine)
  const display_name = (opts.name || 'Video Dancer voice').slice(0, 60)
  const idOf = (made: Record<string, any>, what: string): string => {
    const id = made.id ?? made.voice?.id ?? (typeof made.name === 'string' ? made.name.split('/').pop() : undefined)
    if (!id) throw new Error(`google ${what} no voice: ` + JSON.stringify(made).slice(0, 200))
    return id as string
  }
  let voice = opts.voice
  if (!voice && opts.refAudioPath && opts.consentAudioPath) {
    opts.onProgress?.('copying the sample on google…')
    const wav = async (f: string): Promise<{ mime_type: string; data: string }> => ({ mime_type: 'audio/wav', data: (await readFile(f)).toString('base64') })
    voice = idOf(await googlePost('voices', opts.googleKey, { store: true, voice: { model: model.endpoint, type: 'replicated', display_name, replicated: { source_audio: await wav(opts.refAudioPath), consent_audio: await wav(opts.consentAudioPath) } } }, signal), 'copied')
  } else if (!voice) {
    const desc = (opts.desc ?? '').trim()
    if (!desc) throw new Error(`describe the voice first, or pick one of ${model.label}’s voices`)
    opts.onProgress?.('designing the voice on google…')
    voice = idOf(await googlePost('voices', opts.googleKey, { store: true, voice: { model: model.endpoint, type: 'prompted', display_name, prompted: { input: desc } } }, signal), 'designed')
  }
  opts.onProgress?.(`speaking on ${model.label}…`)
  const style = typeof opts.options.style === 'string' ? opts.options.style.trim() : ''
  // two speakers: one text item per turn, each naming who speaks it; a turn's own "(how)" beats
  // its voice's style line. One speaker: the whole text, as before.
  const two = opts.speaker2
  const me = (opts.name ?? '').trim() || 'Speaker 1'
  const turns = two ? dialogueTurns(opts.text, [me, two.name]) : []
  if (two && me.toLowerCase() === two.name.trim().toLowerCase()) throw new Error(`the two speakers are both called “${me}” — rename one so the lines can tell them apart`)
  if (two && !turns.some((t) => t.speaker === two.name.trim())) throw new Error(`no line for ${two.name} — start its lines with “${two.name}:”`)
  const out = await googlePost(
    'interactions',
    opts.googleKey,
    {
      model: model.endpoint,
      input: [
        {
          type: 'user_input',
          content: two
            ? turns.map((t) => {
                const how = t.style ?? (t.speaker === me ? style : (two.style ?? '').trim())
                return { type: 'text', text: t.text, annotations: [{ type: 'speech_metadata', speaker: t.speaker, ...(how ? { style: how } : {}) }] }
              })
            : [{ type: 'text', text: opts.text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }]
        }
      ],
      response_format: { type: 'audio' }, // unary default: a complete 24 kHz mono WAV
      generation_config: { speech_config: two ? { mode: 'conversational', speakers: [{ speaker: me, voice }, { speaker: two.name.trim(), voice: two.voice }] } : [{ voice }] }
    },
    signal
  )
  const audio = googleBlocks(out, 'audio').filter((b) => typeof b.data === 'string').pop()
  if (!audio) throw new Error(`google returned no audio (${out.status ?? 'no status'})`)
  return { file: await landAudio(opts, Buffer.from(audio.data as string, 'base64'), '.wav'), voiceId: voice }
}

// list 18: Google's voice library for the card's pick — his own stored voices first, then the
// catalog (the 30 and hundreds more), narrowed by his search words. GET /v1beta/voices, spends nothing.
export async function googleVoices(key: string, search = ''): Promise<{ ok: boolean; voices?: { id: string; label: string; title?: string }[]; error?: string }> {
  try {
    const q = new URLSearchParams({ page_size: '100', ...(search.trim() ? { search: search.trim() } : {}) })
    const r = await fetch(`${GOOGLE_API}/voices?${q}`, { headers: { 'x-goog-api-key': key } })
    if (!r.ok) return { ok: false, error: r.status === 401 || r.status === 403 ? 'key rejected — check the Google key in Settings' : `Google error ${r.status}` }
    const j = (await r.json()) as { voices?: Record<string, any>[] }
    const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')
    const row = (v: Record<string, any>): { id: string; label: string; title?: string } => {
      const bits = [str(v.gender), str(v.accent) || str(v.language_code)].filter(Boolean)
      return { id: v.id as string, label: `${str(v.display_name) || v.id}${bits.length ? ' — ' + bits.join(' · ').toLowerCase() : ''}`, ...(str(v.description) ? { title: str(v.description) } : {}) }
    }
    return { ok: true, voices: (j.voices ?? []).filter((v) => typeof v.id === 'string' && v.id).map(row) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Eleven v4 (facts pinned on its registry rows). The voice: a pick from his account (or the
// playing take's), else an instant clone of the sample, else one designed from the description —
// both saved in his ElevenLabs account under the voice's name.
const ELEVEN_API = 'https://api.elevenlabs.io'
async function elevenPost(path: string, key: string, body: FormData | Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  const form = body instanceof FormData
  const r = await fetch(`${ELEVEN_API}${path}`, { method: 'POST', headers: { 'xi-api-key': key, ...(form ? {} : { 'content-type': 'application/json' }) }, body: form ? body : JSON.stringify(body), signal })
  if (r.ok) return r
  const t = await r.text().catch(() => '')
  let msg = t.slice(0, 300)
  try {
    const j = JSON.parse(t) as { detail?: { message?: string } | string }
    msg = typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? msg)
  } catch {
    // not JSON
  }
  throw new Error(`ElevenLabs ${r.status} @ ${path.split('?')[0]}: ${msg || 'rejected the request'}`)
}
async function renderEleven(opts: VoiceRenderOpts, signal: AbortSignal): Promise<VoiceOutput> {
  if (!opts.elevenKey) throw new Error('No ElevenLabs key saved — paste it in Settings → API → ElevenLabs.')
  const model = audioModelFor(opts.engine)
  if (model.maxTextChars && opts.text.length > model.maxTextChars) throw new Error(`${model.label} takes ${model.maxTextChars} characters per render — this text is ${opts.text.length}. Split it.`)
  const name = (opts.name || 'Video Dancer voice').slice(0, 80)
  let voice = opts.voice
  if (!voice && opts.refAudioPath) {
    opts.onProgress?.('cloning the sample on ElevenLabs…')
    const fd = new FormData()
    fd.append('name', name)
    const e = extname(opts.refAudioPath).toLowerCase()
    fd.append('files', new Blob([new Uint8Array(await readFile(opts.refAudioPath))], { type: e === '.wav' ? 'audio/wav' : e === '.m4a' ? 'audio/mp4' : 'audio/mpeg' }), basename(opts.refAudioPath))
    voice = ((await (await elevenPost('/v1/voices/add', opts.elevenKey, fd, signal)).json()) as { voice_id?: string }).voice_id
  } else if (!voice) {
    const desc = (opts.desc ?? '').trim()
    if (!desc) throw new Error('describe the voice first, add a sample, or pick one of your ElevenLabs voices')
    opts.onProgress?.('designing the voice on ElevenLabs…')
    const design = (await (await elevenPost('/v1/text-to-voice/design', opts.elevenKey, { voice_description: desc, model_id: 'eleven_ttv_v3', auto_generate_text: true }, signal)).json()) as { previews?: { generated_voice_id?: string }[] }
    const generated = design.previews?.[0]?.generated_voice_id
    if (!generated) throw new Error('ElevenLabs designed no voice preview')
    voice = ((await (await elevenPost('/v1/text-to-voice', opts.elevenKey, { voice_name: name, voice_description: desc, generated_voice_id: generated }, signal)).json()) as { voice_id?: string }).voice_id
  }
  if (!voice) throw new Error('ElevenLabs returned no voice id')
  opts.onProgress?.(`speaking on ${model.label}…`)
  const seed = num(opts.options.seed)
  const res = await elevenPost(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, opts.elevenKey, { text: opts.text, model_id: model.endpoint, ...(seed != null ? { seed } : {}) }, signal)
  return { file: await landAudio(opts, Buffer.from(await res.arrayBuffer()), '.mp3'), voiceId: voice, seed }
}
// the ready voices of his ElevenLabs account — the card's voice pick (GET /v2/voices, spends nothing)
export async function elevenVoices(key: string): Promise<{ ok: boolean; voices?: { id: string; label: string }[]; error?: string }> {
  try {
    const r = await fetch(`${ELEVEN_API}/v2/voices?page_size=100&sort=name`, { headers: { 'xi-api-key': key } })
    if (!r.ok) return { ok: false, error: r.status === 401 || r.status === 403 ? 'key rejected — check the ElevenLabs key in Settings' : `ElevenLabs error ${r.status}` }
    const j = (await r.json()) as { voices?: { voice_id?: string; name?: string; category?: string }[] }
    return { ok: true, voices: (j.voices ?? []).filter((v) => v.voice_id).map((v) => ({ id: v.voice_id as string, label: `${v.name ?? v.voice_id}${v.category ? ` · ${v.category}` : ''}` })) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function runVoiceRender(opts: VoiceRenderOpts): Promise<VoiceOutput> {
  const model = audioModelFor(opts.engine)
  if (model.provider === 'google') return direct(opts, 'Google', renderGoogle)
  if (model.provider === 'elevenlabs') return direct(opts, 'ElevenLabs', renderEleven)
  if (!opts.falKey) throw new Error('No fal key saved — paste it in Settings first.')
  acquireFalKey(opts.falKey)
  try {
    let refUrl: string | undefined
    if (opts.refAudioPath) {
      opts.onProgress?.('uploading the reference…')
      try { refUrl = await uploadAudioCached(opts.refAudioPath, opts.onProgress) }
      catch (e) { throw new Error(falErrorText(e, 'fal storage — voice sample upload')) }
    }
    let imageUrl: string | undefined
    if (opts.imagePath && !refUrl) {
      opts.onProgress?.('uploading the character image…')
      try { imageUrl = await uploadImageCached(opts.imagePath, opts.onProgress) }
      catch (e) { throw new Error(falErrorText(e, 'fal storage — character image upload')) }
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
