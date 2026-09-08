// THE WATCH LANE (docs/WATCH-LANE-SPEC-2026-09-08.md): Gemini Flash sees a take. One copy, two
// readers — the Co-Director's watch_take tool and Score compose's per-shot digests. Files ≤ 20 MB
// ride inline (base64); bigger ones go through the Files API (upload → ACTIVE → use → delete).
// Nothing runs without the Google key. Transport hardening = the sub-call shape.
import { readFile, stat, mkdtemp, rm } from 'fs/promises'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { extractFrame, probeFile } from './export'
import { addSpend } from './project'

const API = 'https://generativelanguage.googleapis.com'
export const WATCH_MODEL = 'gemini-2.5-flash' // director 2026-09-08: Flash, on ask
const INLINE_MAX = 20 * 1024 * 1024

export const WATCH_DEFAULT_QUESTION =
  'Describe exactly what happens, second by second: subjects, motion, camera, cuts, lighting, and the sound. Then name anything that looks wrong — jitter, warped limbs, identity drift, a frozen frame, a bad cut. Be concrete and brief.'

export interface WatchResult {
  ok: boolean
  text?: string
  error?: string
  tokens?: number
  via?: 'gemini' | 'frames' // frames = the no-Google-key fallback (stills, no motion or sound)
}

// what a watch may use: Gemini when the Google key is set; otherwise FRAMES → Claude (director
// 2026-09-08: "if no gemini then we'll use claude") through the API key or the bridge callback
export interface WatchOpts {
  googleKey?: string
  anthropicKey?: string
  model?: string // Claude model for the frames fallback (the Co-Director's)
  bridge?: (prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }> // bridge-engine one-shot
  signal?: AbortSignal
  label?: string // ledger line for the GEM chip ("watch · KATA T2"); absent = not ledgered
}
// Gemini 2.5 Flash list price, per million tokens (an ESTIMATE — Google shows no balance for AI
// Studio keys; the GEM chip is his "$1.75" counter, tokens × list price). Update when Google does.
const GEMINI_USD_PER_M_TOKENS = 0.3
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const FALLBACK_MODEL = 'claude-sonnet-5'

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
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      throw watchdog.aborted ? new Error('Gemini request timed out (120s)') : e
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    return res
  }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } } | { file_data: { mime_type: string; file_uri: string } }

async function generate(key: string, parts: Part[], signal?: AbortSignal): Promise<WatchResult> {
  const res = await post(`${API}/v1beta/models/${WATCH_MODEL}:generateContent?key=${encodeURIComponent(key)}`, { contents: [{ role: 'user', parts }] }, signal)
  const j = (await res.json().catch(() => null)) as {
    error?: { message?: string }
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { totalTokenCount?: number }
  } | null
  if (!res.ok) return { ok: false, error: j?.error?.message ?? `Gemini error ${res.status}` }
  const text = (j?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  if (!text) return { ok: false, error: 'Gemini returned no text (blocked or empty)' }
  return { ok: true, text, tokens: j?.usageMetadata?.totalTokenCount }
}

// Files API for big takes: resumable upload → poll ACTIVE → the caller uses the uri → delete
async function uploadFile(key: string, file: string, mime: string, signal?: AbortSignal): Promise<{ name: string; uri: string }> {
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
    signal
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start failed (${start.status})`)
  const fin = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'content-length': String(bytes.length) },
    body: bytes,
    signal
  })
  const fj = (await fin.json().catch(() => null)) as { file?: { name: string; uri: string; state?: string } } | null
  if (!fin.ok || !fj?.file) throw new Error(`Gemini upload failed (${fin.status})`)
  let state = fj.file.state ?? 'PROCESSING'
  for (let i = 0; state === 'PROCESSING' && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const s = await fetch(`${API}/v1beta/${fj.file.name}?key=${encodeURIComponent(key)}`, { signal })
    const sj = (await s.json().catch(() => null)) as { state?: string } | null
    state = sj?.state ?? 'FAILED'
  }
  if (state !== 'ACTIVE') throw new Error(`Gemini could not process the video (state ${state})`)
  return { name: fj.file.name, uri: fj.file.uri }
}

export async function watchVideo(file: string, question: string | undefined, opts: WatchOpts): Promise<WatchResult> {
  const q = (question ?? '').trim() || WATCH_DEFAULT_QUESTION
  if (!opts.googleKey) return watchFrames(file, q, opts)
  const mime = mimeOf(file)
  // every Gemini watch lands in the project's spend ledger as an estimate (the GEM chip)
  const ledger = async (r: WatchResult): Promise<WatchResult> => {
    if (r.ok && r.tokens && opts.label) await addSpend({ label: opts.label, kind: 'watch', cost: (r.tokens / 1_000_000) * GEMINI_USD_PER_M_TOKENS }).catch(() => null)
    return { ...r, via: 'gemini' }
  }
  try {
    const size = (await stat(file)).size
    if (size <= INLINE_MAX) {
      const data = (await readFile(file)).toString('base64')
      return await ledger(await generate(opts.googleKey, [{ inline_data: { mime_type: mime, data } }, { text: q }], opts.signal))
    }
    const up = await uploadFile(opts.googleKey, file, mime, opts.signal)
    try {
      return await ledger(await generate(opts.googleKey, [{ file_data: { mime_type: mime, file_uri: up.uri } }, { text: q }], opts.signal))
    } finally {
      void fetch(`${API}/v1beta/${up.name}?key=${encodeURIComponent(opts.googleKey)}`, { method: 'DELETE' }).catch(() => undefined)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- the FRAMES fallback: spaced stills off the take → Claude reads them. Motion and sound are
// lost, but he is never blind. 4–12 frames, one per second-ish, centred in their slots. ----
async function watchFrames(file: string, q: string, opts: WatchOpts): Promise<WatchResult> {
  if (!opts.anthropicKey && !opts.bridge) return { ok: false, error: 'No Google AI key (Gemini) and no Claude route — paste a Google AI key or an Anthropic key in Settings → API.' }
  const dir = await mkdtemp(join(tmpdir(), 'vd-watch-'))
  try {
    const dur = Math.max(0.5, (await probeFile(file)).duration || 0)
    // The watch skill budget: ≤30s → up to 2 fps, 30 frames max (post 7); ours followed it 2026-09-09
    const n = Math.max(4, Math.min(30, Math.round(dur * 2)))
    const frames: { at: number; png: string }[] = []
    for (let i = 0; i < n; i++) {
      const at = ((i + 0.5) * dur) / n
      const png = join(dir, `f${i}.png`)
      if (await extractFrame(file, at, png)) frames.push({ at: Math.round(at * 10) / 10, png })
    }
    if (!frames.length) return { ok: false, error: 'could not pull frames off the take (ffmpeg)' }
    const intro = `These are ${frames.length} still frames pulled from a ${Math.round(dur * 10) / 10}s video take, in order, at ${frames.map((f) => `${f.at}s`).join(', ')}. You are seeing stills only — no motion between them and no sound; say so where it matters and do not invent either.\n\n${q}`
    if (opts.anthropicKey) {
      const content: unknown[] = []
      for (const f of frames) content.push({ type: 'text', text: `frame at ${f.at}s:` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: (await readFile(f.png)).toString('base64') } })
      content.push({ type: 'text', text: intro })
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': opts.anthropicKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({ model: opts.model ?? FALLBACK_MODEL, max_tokens: 1500, messages: [{ role: 'user', content }] }),
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
      })
      const j = (await res.json().catch(() => null)) as { error?: { message?: string }; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null
      if (!res.ok) return { ok: false, error: j?.error?.message ?? `Anthropic error ${res.status}` }
      const text = (j?.content ?? []).map((c) => c.text ?? '').join('').trim()
      if (!text) return { ok: false, error: 'Claude returned no text for the frames' }
      return { ok: true, text, tokens: (j?.usage?.input_tokens ?? 0) + (j?.usage?.output_tokens ?? 0), via: 'frames' }
    }
    // bridge engine: the CLI Reads the frame files itself
    const r = await opts.bridge!(`Read these image files first, in order:\n${frames.map((f) => `- ${f.png}  (frame at ${f.at}s)`).join('\n')}\n\n${intro}`)
    if (!r.ok || !r.text) return { ok: false, error: r.error ?? 'bridge returned nothing for the frames' }
    return { ok: true, text: r.text, via: 'frames' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
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
