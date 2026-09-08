// Score emit — beats + options → the engine's exact wire input. Lives in shared/ so the Score
// card can SHOW the outgoing text (WORKFLOW law: what the model sees is inspectable) and main's
// scoreRender sends byte-identical content. Wire field names verbatim from fal's OpenAPI
// (2026-08-19 read); the singing-bug lesson lives here: descriptive text in `lyrics` GETS SUNG.
import { audioModelFor } from './audioModels'
import type { ScoreBeat } from './types'

export const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function emitScoreInput(
  engine: string,
  beats: ScoreBeat[],
  options: Record<string, string | number | boolean>
): { endpoint: string; input: Record<string, unknown> } {
  const model = audioModelFor(engine)
  if (!model.endpoint && model.provider !== 'local') throw new Error(`${model.label} has no wire endpoint yet — it lands with its build phase`)
  const endpoint = model.endpoint ?? `local:${model.id}` // local engines route by id, not fal slug
  const style = String(options.styleText ?? '').trim()
  const instrumental = options.isInstrumental !== false
  const durationSec = Math.min(model.maxDurationSec, Math.max(5, Number(options.durationSec) || 60))
  const arcBits = beats.map((b) => b.text.trim()).filter(Boolean)

  if (model.id === 'ace-step-1.5') {
    // ACE API.md (verified 2026-08-19): POST /release_task — prompt (music description) +
    // lyrics + audio_duration + seed + thinking. Instrumental = EMPTY lyrics (their default);
    // beats fold into the prompt as timed arrangement events (descriptive text in a lyrics
    // field GETS SUNG — the founding lesson holds here too).
    const arc = beats.length ? ` Arrangement: ${beats.map((b) => `at ${mmss(b.at)} ${b.text.trim() || 'continue'}`).join('; ')}.` : ''
    const userLyrics = String(options.lyricsText ?? '').trim()
    // HIGHEST QUALITY DEFAULT (user law 2026-08-19: best always; faster = HIS dial, never
    // my call): XL sft + the LM planner. The quality dial on the card maps here.
    const q = String(options.aceQuality ?? 'best')
    const input: Record<string, unknown> = {
      prompt: (style || 'cinematic underscore') + arc,
      lyrics: instrumental ? '' : userLyrics || '[verse]\n[chorus]\n[outro]',
      audio_duration: durationSec,
      model: q === 'fast' ? 'acestep-v15-turbo' : q === 'balanced' ? 'acestep-v15-xl-turbo' : 'acestep-v15-xl-sft',
      thinking: true // the LM planner is what makes the prompt + arrangement actually followed
    }
    if (typeof options.seed === 'number' && options.seed >= 0) input.seed = options.seed
    return { endpoint, input }
  }
  if (model.id === 'minimax-music-3-local') {
    // same creative wire as the API engine (below) — the local worker maps prompt/lyrics/
    // duration/seed onto the diffusers pipeline arguments 1:1
    const arc = beats.length ? `Arrangement: ${beats.map((b) => `at ${mmss(b.at)} ${b.text.trim() || 'continue'}`).join('; ')}.` : ''
    const prompt = [style || 'cinematic underscore', instrumental ? 'Instrumental only, no vocals.' : '', arc, `A continuous ${durationSec}-second piece scored to a film edit — clear motion, no drifting.`]
      .filter(Boolean)
      .join(' ')
    const userLyrics = String(options.lyricsText ?? '').trim()
    const lyrics = instrumental ? '[instrumental]' : userLyrics || ['[intro]', '[verse]', '[chorus]', '[outro]'].join('\n')
    const input: Record<string, unknown> = { prompt, lyrics, duration: durationSec }
    if (typeof options.seed === 'number' && options.seed >= 0) input.seed = options.seed
    // precision is the USER'S dial (quality law): full bf16 default; 4-bit only when picked
    if (options.mmQuality === 'fast') input.quant4bit = true
    return { endpoint, input }
  }
  if (model.id === 'minimax-music-3') {
    // Music3Input: prompt (the music brief — ALL creative direction, arrangement-notes style) +
    // lyrics (structure tags / sung words) + duration + seed. Instrumental = the supported
    // `[instrumental]` tag alone; the beats emit into the brief as timed arrangement events.
    const arc = beats.length ? `Arrangement: ${beats.map((b) => `at ${mmss(b.at)} ${b.text.trim() || 'continue'}`).join('; ')}.` : ''
    const prompt = [
      style || 'cinematic underscore',
      instrumental ? 'Instrumental only, no vocals.' : '',
      arc,
      `A continuous ${durationSec}-second piece scored to a film edit — clear motion, no drifting.`
    ]
      .filter(Boolean)
      .join(' ')
    // vocal mode: the user's lyrics go to the wire WORD FOR WORD (section tags and all); an
    // empty lyrics box falls back to a bare tag skeleton so the model still gets a song shape
    const userLyrics = String(options.lyricsText ?? '').trim()
    const lyrics = instrumental ? '[instrumental]' : userLyrics || ['[intro]', '[verse]', '[chorus]', '[outro]'].join('\n')
    const input: Record<string, unknown> = { prompt, lyrics, duration: durationSec }
    if (typeof options.seed === 'number' && options.seed >= 0) input.seed = options.seed
    return { endpoint, input }
  }
  if (model.id === 'beatoven') {
    // MusicGenerationInput: prompt + duration 5-150 + negative_prompt + creativity + refinement + seed
    const prompt = [style || 'cinematic underscore, background music', arcBits.length ? `The piece evolves: ${arcBits.join(', then ')}.` : '']
      .filter(Boolean)
      .join(' ')
    const input: Record<string, unknown> = { prompt, duration: Math.min(150, durationSec) }
    const neg = String(options.negativeText ?? '').trim()
    if (neg) input.negative_prompt = neg
    if (typeof options.creativity === 'number') input.creativity = Math.max(1, Math.min(20, options.creativity))
    if (typeof options.refinement === 'number') input.refinement = Math.max(10, Math.min(200, options.refinement))
    if (typeof options.seed === 'number' && options.seed >= 0) input.seed = options.seed
    return { endpoint, input }
  }
  if (model.id === 'eleven-music-v2') {
    // ElevenLabs Music v2 (docs 2026-09-08): composition_plan.chunks[] = { text (section label +
    // lyrics + {directions}), duration_ms 3 000–120 000, positive_styles[], negative_styles[],
    // context_adherence }, ≤30 chunks, total 3s–10min. Our beats ARE the plan: one chunk per beat,
    // timed by the gaps to the span end; tiny beats merge into their neighbour, long ones split.
    const styles = style
      .split(/[,;]+|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50)
    const negative = instrumental ? ['vocals', 'singing', 'lyrics'] : []
    const lyrics = String(options.lyricsText ?? '').trim()
    const total = Math.max(3, durationSec)
    const sorted = beats.filter((b) => b.text.trim()).sort((a, b) => a.at - b.at)
    if (!sorted.length) {
      return {
        endpoint,
        input: { model_id: 'music_v2', output_format: 'mp3_44100_128', prompt: style || 'cinematic underscore', music_length_ms: Math.round(total * 1000), force_instrumental: instrumental }
      }
    }
    // spans: beat i runs from its `at` to the next beat (or the end); a lead-in before the first beat is its own chunk
    const raw: { text: string; dur: number }[] = []
    if (sorted[0].at > 3) raw.push({ text: '[intro]', dur: sorted[0].at })
    sorted.forEach((b, i) => {
      const end = i + 1 < sorted.length ? sorted[i + 1].at : total
      raw.push({ text: `[${b.text.trim().replace(/[\[\]]/g, '')}]`, dur: Math.max(0, end - Math.max(b.at, 0)) })
    })
    // merge < 3s into the previous (or next) chunk, split > 120s
    const merged: { text: string; dur: number }[] = []
    for (const r of raw) {
      if (r.dur < 3 && merged.length) {
        merged[merged.length - 1].dur += r.dur
        merged[merged.length - 1].text += ` ${r.text}`
      } else merged.push({ ...r })
    }
    if (merged.length && merged[0].dur < 3 && merged.length > 1) {
      merged[1].dur += merged[0].dur
      merged[1].text = `${merged[0].text} ${merged[1].text}`
      merged.shift()
    }
    const chunks: { text: string; duration_ms: number; positive_styles: string[]; negative_styles: string[]; context_adherence: 'high' }[] = []
    for (const m of merged) {
      let left = m.dur
      let first = true
      while (left > 0 && chunks.length < 30) {
        const d = Math.min(120, Math.max(3, left))
        chunks.push({ text: first ? m.text : `${m.text} (continued)`, duration_ms: Math.round(d * 1000), positive_styles: styles, negative_styles: negative, context_adherence: 'high' })
        left -= d
        first = false
      }
    }
    // lyrics (when the score sings) ride in the longest section
    if (!instrumental && lyrics && chunks.length) {
      const longest = chunks.reduce((a, b) => (b.duration_ms > a.duration_ms ? b : a))
      longest.text = `${longest.text}\n${lyrics}`
    }
    return { endpoint, input: { model_id: 'music_v2', output_format: 'mp3_44100_128', composition_plan: { chunks } } }
  }
  if (model.id === 'sonilo') {
    // V11VideoToMusicInput: video_url (the rendered span proxy — uploaded at render time, the
    // placeholder below is what the card preview shows) + prompt + prompt_influence 0-1.
    // The span video IS the timing authority — no duration/offset fields needed.
    const input: Record<string, unknown> = { video_url: '(the rendered span video uploads here)' }
    if (style) input.prompt = style
    const infl = Number(options.promptInfluence)
    if (style && Number.isFinite(infl)) input.prompt_influence = Math.max(0, Math.min(1, infl))
    return { endpoint, input }
  }
  throw new Error(`${model.label}: no emit path yet (${model.provider === 'local' ? 'local engines land with the Models card build' : 'lands with its build phase'})`)
}
