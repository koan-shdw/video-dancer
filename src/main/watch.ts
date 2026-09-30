// Shared video reader for takes, assembled timelines and Score compose. Files ≤ 14 MB
// ride inline (base64); bigger ones go through the Files API (upload → ACTIVE → use → delete).
// Unavailable Gemini degrades to explicitly labelled still frames through Claude.
import { readFile, stat, mkdtemp, rm } from 'fs/promises'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { setTimeout as delay } from 'timers/promises'
import { extractFrame, probeFile } from './export'
import { addSpend, captureProjectSession, assertProjectSession } from './project'
import { DEFAULT_WATCH_MODEL } from '@koan/vidancer-ui/shared/watch'
import { postMessages } from './claudeWire'

const API = 'https://generativelanguage.googleapis.com'
export const WATCH_MODEL = DEFAULT_WATCH_MODEL
const INLINE_MAX = 14 * 1024 * 1024 // base64 + JSON must fit the 20 MB inline request budget

export const WATCH_DEFAULT_QUESTION =
  'Describe exactly what happens, second by second: subjects, motion, camera, cuts, lighting, and the sound. Then name anything that looks wrong — jitter, warped limbs, identity drift, a frozen frame, a bad cut. Be concrete and brief.'

export interface WatchResult {
  ok: boolean
  text?: string
  error?: string
  tokens?: number
  via?: 'gemini' | 'frames' // frames contain no motion or sound
  model?: string
  warning?: string
  costUsd?: number
}

// what a watch may use: Gemini when the Google key is set; otherwise FRAMES → Claude (director
// 2026-09-08: "if no gemini then we'll use claude") through the API key or the bridge callback
export interface WatchOpts {
  googleKey?: string
  googleModel?: string
  anthropicKey?: string
  model?: string // Claude model for the frames fallback (the Co-Director's)
  bridge?: (prompt: string, signal?: AbortSignal) => Promise<{ ok: boolean; text?: string; error?: string }> // bridge-engine one-shot
  signal?: AbortSignal
  label?: string // ledger line for the GEM chip ("watch · KATA T2"); absent = not ledgered
}
// Standard 3.6 pricing: https://ai.google.dev/gemini-api/docs/pricing (2026-09-10).
// Other configured models have no invented estimate; their token count is still returned.
const FALLBACK_MODEL = 'claude-sonnet-5-5'

const mimeOf = (file: string): string => {
  const e = extname(file).toLowerCase()
  return e === '.webm' ? 'video/webm' : e === '.mov' ? 'video/quicktime' : e === '.mkv' ? 'video/x-matroska' : 'video/mp4'
}

async function post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const watchdog = AbortSignal.timeout(120_000)
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, watchdog]) : watchdog })
    } catch (e) {
      if (signal?.aborted) throw e
      if (attempt < 2) {
        await delay(1500 * (attempt + 1), undefined, { signal })
        continue
      }
      throw watchdog.aborted ? new Error('Gemini request timed out (120s)') : e
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await delay(2000 * (attempt + 1), undefined, { signal })
      continue
    }
    return res
  }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } } | { file_data: { mime_type: string; file_uri: string } }

async function generate(key: string, model: string, parts: Part[], signal?: AbortSignal): Promise<WatchResult> {
  const res = await post(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { contents: [{ role: 'user', parts }] }, signal)
  const j = (await res.json().catch(() => null)) as {
    error?: { message?: string }
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { totalTokenCount?: number; promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  } | null
  if (!res.ok) return { ok: false, error: j?.error?.message ?? `Gemini error ${res.status}` }
  const text = (j?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  if (!text) return { ok: false, error: 'Gemini returned no text (blocked or empty)' }
  const usage = j?.usageMetadata
  const discount = Date.now() < Date.UTC(2027, 0, 1) ? 0.5 : 1
  const costUsd = model === WATCH_MODEL && usage?.promptTokenCount != null
    ? (usage.promptTokenCount * 1.5 + ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * 7.5) * discount / 1_000_000 : undefined
  return { ok: true, text, tokens: usage?.totalTokenCount, model, costUsd }
}

// a text-only ask on the watch key: compose's beats when Gemini watched the cut (his call
// 2026-09-23: one step, the model that saw the cut writes the beats). Spend lands like a watch.
export async function geminiAsk(key: string, model: string | undefined, prompt: string, label: string, signal?: AbortSignal): Promise<WatchResult> {
  const m = model?.trim().replace(/^models\//, '') || WATCH_MODEL
  const owner = (() => { try { return captureProjectSession() } catch { return undefined } })()
  const r = await generate(key, m, [{ text: prompt }], signal)
  if (r.ok && r.costUsd != null && owner) {
    try { assertProjectSession(owner); await addSpend({ label, kind: 'watch', cost: r.costUsd }) } catch { /* never charge a different open project */ }
  }
  return r
}

// Files API for big takes: resumable upload → poll ACTIVE → the caller uses the uri → delete
async function uploadFile(key: string, file: string, mime: string, signal?: AbortSignal): Promise<{ name: string; uri: string }> {
  const bounded = (): AbortSignal => signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
  const bytes = await readFile(file)
  const start = await fetch(`${API}/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mime,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: basename(file) } }),
    signal: bounded()
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start failed (${start.status})`)
  const fin = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'content-length': String(bytes.length) },
    body: bytes,
    signal: bounded()
  })
  const fj = (await fin.json().catch(() => null)) as { file?: { name: string; uri: string; state?: string } } | null
  if (!fin.ok || !fj?.file) throw new Error(`Gemini upload failed (${fin.status})`)
  try {
    let state = fj.file.state ?? 'PROCESSING'
    for (let i = 0; state === 'PROCESSING' && i < 60; i++) {
      await delay(2000, undefined, { signal })
      const s = await fetch(`${API}/v1beta/${fj.file.name}?key=${encodeURIComponent(key)}`, { signal: bounded() })
      const sj = (await s.json().catch(() => null)) as { state?: string } | null
      state = s.ok ? sj?.state ?? 'FAILED' : 'FAILED'
    }
    if (state !== 'ACTIVE') throw new Error(`Gemini could not process the video (state ${state})`)
    signal?.throwIfAborted()
    return { name: fj.file.name, uri: fj.file.uri }
  } catch (e) {
    await fetch(`${API}/v1beta/${fj.file.name}?key=${encodeURIComponent(key)}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) }).catch(() => undefined)
    throw e
  }
}

export async function watchVideo(file: string, question: string | undefined, opts: WatchOpts): Promise<WatchResult> {
  const q = (question ?? '').trim() || WATCH_DEFAULT_QUESTION
  if (opts.signal?.aborted) return { ok: false, error: 'Watch cancelled' }
  if (!opts.googleKey) return watchFrames(file, q, opts)
  const model = opts.googleModel?.trim().replace(/^models\//, '') || WATCH_MODEL
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) return { ok: false, error: 'Invalid Watch model ID — check Settings → API.' }
  const mime = mimeOf(file)
  const owner = (() => { try { return captureProjectSession() } catch { return undefined } })()
  // every Gemini watch lands in the project's spend ledger as an estimate (the GEM chip)
  const ledger = async (r: WatchResult): Promise<WatchResult> => {
    if (r.ok && r.costUsd != null && opts.label && owner) {
      try { assertProjectSession(owner); await addSpend({ label: opts.label, kind: 'watch', cost: r.costUsd }) } catch { /* never charge a different open project */ }
    }
    return { ...r, via: 'gemini' }
  }
  let result: WatchResult
  try {
    const size = (await stat(file)).size
    if (size <= INLINE_MAX) {
      const data = (await readFile(file)).toString('base64')
      result = await ledger(await generate(opts.googleKey, model, [{ inline_data: { mime_type: mime, data } }, { text: q }], opts.signal))
    } else {
      const up = await uploadFile(opts.googleKey, file, mime, opts.signal)
      try {
        result = await ledger(await generate(opts.googleKey, model, [{ file_data: { mime_type: mime, file_uri: up.uri } }, { text: q }], opts.signal))
      } finally {
        await fetch(`${API}/v1beta/${up.name}?key=${encodeURIComponent(opts.googleKey)}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) }).catch(() => undefined)
      }
    }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (result.ok) return result
  if (opts.signal?.aborted) return { ok: false, error: 'Watch cancelled' }
  if (!opts.anthropicKey && !opts.bridge) return { ...result, error: `${result.error}. No still-frame reader is configured; set up the Co-Director's Claude connection in Settings.` }
  const fallback = await watchFrames(file, q, opts)
  const reason = `Gemini (${model}) failed: ${result.error}`
  return fallback.ok ? { ...fallback, warning: `${reason}. Reviewed still frames only; no motion or sound.` }
    : { ...fallback, error: `${reason}. Still-frame fallback also failed: ${fallback.error}` }
}

// ---- the FRAMES fallback: spaced stills off the take → Claude reads them. Motion and sound are
// lost, but he is never blind. 4–12 frames, one per second-ish, centred in their slots. ----
async function watchFrames(file: string, q: string, opts: WatchOpts): Promise<WatchResult> {
  if (opts.signal?.aborted) return { ok: false, error: 'Watch cancelled' }
  if (!opts.anthropicKey && !opts.bridge) return { ok: false, error: 'No Google AI key (Gemini) and no Claude route — paste a Google AI key or an Anthropic key in Settings → API.' }
  const dir = await mkdtemp(join(tmpdir(), 'vd-watch-'))
  try {
    const dur = Math.max(0.5, (await probeFile(file)).duration || 0)
    // The watch skill budget: ≤30s → up to 2 fps, 30 frames max (post 7); ours followed it 2026-09-09
    const n = Math.max(4, Math.min(30, Math.round(dur * 2)))
    const frames: { at: number; png: string }[] = []
    for (let i = 0; i < n; i++) {
      opts.signal?.throwIfAborted()
      const at = ((i + 0.5) * dur) / n
      const png = join(dir, `f${i}.png`)
      if (await extractFrame(file, at, png)) frames.push({ at: Math.round(at * 10) / 10, png })
    }
    if (!frames.length) return { ok: false, error: 'could not pull frames off the take (ffmpeg)' }
    console.log(`[watch] frames road: ${opts.bridge ? 'bridge' : opts.anthropicKey ? 'api key' : 'none'} · ${frames.length} frames`)
    const intro = `These are ${frames.length} still frames pulled from a ${Math.round(dur * 10) / 10}s video take, in order, at ${frames.map((f) => `${f.at}s`).join(', ')}. You are seeing stills only — no motion between them and no sound; say so where it matters and do not invent either.\n\n${q}`
    // his engine first (2026-09-23: the bridge was his engine, a dead API key was still tried first
    // and the stills read died on "credit balance is too low")
    if (opts.anthropicKey && !opts.bridge) {
      opts.signal?.throwIfAborted()
      const content: unknown[] = []
      for (const f of frames) content.push({ type: 'text', text: `frame at ${f.at}s:` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: (await readFile(f.png)).toString('base64') } })
      content.push({ type: 'text', text: intro })
      const res = await postMessages(opts.anthropicKey, { model: opts.model ?? FALLBACK_MODEL, max_tokens: 1500, messages: [{ role: 'user', content }] }, opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000))
      const j = (await res.json().catch(() => null)) as { error?: { message?: string }; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null
      if (!res.ok) return { ok: false, error: j?.error?.message ?? `Claude API error ${res.status}` }
      const text = (j?.content ?? []).map((c) => c.text ?? '').join('').trim()
      if (!text) return { ok: false, error: 'Claude returned no text for the frames' }
      return { ok: true, text, tokens: (j?.usage?.input_tokens ?? 0) + (j?.usage?.output_tokens ?? 0), via: 'frames' }
    }
    // bridge engine: the CLI Reads the frame files itself
    opts.signal?.throwIfAborted()
    const r = await opts.bridge!(`Read these image files first, in order:\n${frames.map((f) => `- ${f.png}  (frame at ${f.at}s)`).join('\n')}\n\n${intro}`, opts.signal)
    opts.signal?.throwIfAborted()
    if (!r.ok || !r.text) return { ok: false, error: r.error ?? 'bridge returned nothing for the frames' }
    return { ok: true, text: r.text, via: 'frames' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function describeWatch(result: WatchResult): string {
  return result.via === 'frames' ? 'still frames read by Claude — no motion or sound' : result.model ?? WATCH_MODEL
}

// "test key": one cheap models.list call — checks the key, spends nothing
export async function validateGoogleKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`)
    if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, error: 'key rejected — create one at aistudio.google.com → Get API key' }
    if (!r.ok) return { ok: false, error: `Google API error ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
