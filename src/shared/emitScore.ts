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
  if (!model.endpoint) throw new Error(`${model.label} has no wire endpoint yet — it lands with its build phase`)
  const style = String(options.styleText ?? '').trim()
  const instrumental = options.isInstrumental !== false
  const durationSec = Math.min(model.maxDurationSec, Math.max(5, Number(options.durationSec) || 60))
  const arcBits = beats.map((b) => b.text.trim()).filter(Boolean)

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
    return { endpoint: model.endpoint, input }
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
    return { endpoint: model.endpoint, input }
  }
  if (model.id === 'sonilo') {
    // V11VideoToMusicInput: video_url (the rendered span proxy — uploaded at render time, the
    // placeholder below is what the card preview shows) + prompt + prompt_influence 0-1.
    // The span video IS the timing authority — no duration/offset fields needed.
    const input: Record<string, unknown> = { video_url: '(the rendered span video uploads here)' }
    if (style) input.prompt = style
    const infl = Number(options.promptInfluence)
    if (style && Number.isFinite(infl)) input.prompt_influence = Math.max(0, Math.min(1, infl))
    return { endpoint: model.endpoint, input }
  }
  throw new Error(`${model.label}: no emit path yet (${model.provider === 'local' ? 'local engines land with the Models card build' : 'lands with its build phase'})`)
}
