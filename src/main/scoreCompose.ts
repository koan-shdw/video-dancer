// SCORE COMPOSE (SCORE-PLAN phase 5) — reads everything under a stretched score span and writes
// suggested beats. First consumer of the phase-0 sub-call plumbing: one digest per clip runs in
// PARALLEL on the cheap tier, then one synthesis pass on the stronger model returns strict-JSON
// beats. The overwrite rule (empty = in place, has beats = duplicate) lives in the IPC handler.
import { randomUUID } from 'crypto'
import { getProject, mainEffDur } from './project'
import { runSubCalls, type SubCallOpts, type SubCallTask } from './subcall'
import { watchVideo, type WatchOpts } from './watch'
import type { ScoreBeat, PromptData, Project } from '@koan/vidancer-ui/shared/types'
import { scoreSpan } from '@koan/vidancer-ui/shared/scoreRequest'

export interface ComposeArgs {
  scoreClipId: string
  timelineId?: string // absent = the active timeline
  scoreItemId?: string // absent = the first span of this score on that timeline
}

const COMPOSE_CLIP_CAP = 20 // digests per compose — beyond this the extra shots ride as a count line

// what one shot contributes to the digest prompt — take-snapshot recipe wins (what actually
// rendered), live recipe covers storyboard clips
function shotText(pd: PromptData): string {
  const bits: string[] = []
  if (pd.freeform?.trim()) bits.push(pd.freeform.trim().slice(0, 300))
  if (pd.scene?.title?.trim()) bits.push(`scene: ${pd.scene.title.trim().slice(0, 100)}`)
  if (pd.scene?.style?.trim()) bits.push(`style: ${pd.scene.style.trim().slice(0, 100)}`)
  if (pd.scene?.visualFeel?.trim()) bits.push(`feel: ${pd.scene.visualFeel.trim().slice(0, 100)}`)
  const actions = (pd.beats ?? [])
    .map((b) => b.action)
    .filter(Boolean)
    .join(' · ')
  if (actions) bits.push(`action: ${actions.slice(0, 240)}`)
  if (pd.production?.subtext?.trim()) bits.push(`mood: ${pd.production.subtext.trim().slice(0, 100)}`)
  return bits.join('\n') || '(no prompt text — judge by the name alone)'
}

export async function composeScoreBeats(
  args: ComposeArgs,
  subOpts: SubCallOpts & { synthModel: string; googleKey?: string; googleModel?: string; bridge?: WatchOpts['bridge']; proxyFile?: string; projectSnapshot?: Project }
): Promise<{ ok: true; beats: ScoreBeat[]; spanSec: number; clipCount: number } | { ok: false; error: string }> {
  const p = subOpts.projectSnapshot ?? getProject()
  if (!p) return { ok: false, error: 'no project open' }
  const sc = p.scoreClips.find((x) => x.id === args.scoreClipId)
  if (!sc) return { ok: false, error: 'score clip not found' }
  let target: ReturnType<typeof scoreSpan>
  try { target = scoreSpan(p, args) } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  const { timeline: tl, span } = target
  const S = span.startSec
  const E = span.startSec + span.spanSec

  // every video block overlapping the span, chronological — cut rhythm comes from the times
  const solos = (tl.soloTracks ?? []).filter(t => t.startsWith('v'))
  const under = tl.items
    .map((it) => {
      const start = it.startSec ?? 0
      const eff = mainEffDur(it, p.clips)
      return { it, start, end: start + eff }
    })
    .filter((x) => !x.it.disabled && (solos.length ? solos.includes(`v${x.it.track ?? 0}`) : !(tl.mutedTracks ?? []).includes(`v${x.it.track ?? 0}`)) && x.start < E && x.end > S)
    .sort((a, b) => a.start - b.start)
  if (under.length === 0 && !subOpts.proxyFile) return { ok: false, error: 'no clips under the span — compose needs footage to read' }
  const kept = under.slice(0, COMPOSE_CLIP_CAP)

  // one digest per shot, all in parallel on the cheap tier (a failed digest degrades to the
  // clip's name — one flaky sub-call must not kill the whole compose)
  const shots = kept.map((x, i) => {
    const clip = p.clips.find((c) => c.id === x.it.clipId)
    const takeId = x.it.takeId ?? clip?.keeperTakeId
    const take = x.it.useRecipe ? undefined : takeId ? clip?.takes.find(t => t.id === takeId) : clip?.takes[clip.takes.length - 1]
    const pd = take?.snapshot ?? clip?.promptData
    const t0 = Math.max(0, x.start - S)
    const t1 = Math.min(span.spanSec, x.end - S)
    return { id: `shot${i}`, name: clip?.name ?? '?', t0, t1, pd }
  })
  // Watch only the assembled span. Whole takes contain trimmed-out action and repeat
  // billed analysis for footage the composer never sees in this cut.
  const digestTasks: SubCallTask[] = shots
    .filter((s) => s.pd)
    .map((s) => ({
      id: s.id,
      prompt: `Summarize the intended mood in this recipe in at most 22 words. This is prompt metadata, NOT an observation of the actual cut.\nSHOT "${s.name}" (${s.t1 - s.t0}s):\n${shotText(s.pd!)}`
    }))
  // THE CUT, watched whole (SCORE-WATCH-SPEC §3): the span proxy → one watch with the composer's
  // question. The shots give content; the cut gives rhythm — both ride into the synthesis.
  let cutBlock = ''
  if (subOpts.proxyFile && (subOpts.googleKey || subOpts.apiKey || subOpts.bridge)) {
    const w = await watchVideo(
      subOpts.proxyFile,
      'You are scoring this cut. Describe, with timestamps from 0: every cut point; the pacing and where it changes; the motion energy per stretch; the mood and its turns; the moments of silence or held breath; any sound already in the picture. Then say where the music should enter, lift, drop, and end. Be concrete and brief.',
      { googleKey: subOpts.googleKey, googleModel: subOpts.googleModel, anthropicKey: subOpts.apiKey, model: subOpts.synthModel, bridge: subOpts.bridge, signal: subOpts.signal, label: 'watch · the cut (compose)' }
    )
    if (w.ok && w.text) cutBlock = `WHAT THE CUT DOES (watched whole${w.via === 'frames' ? ' — as still frames only, no motion or sound' : ''}):\n${w.text}`
  }
  // When the cut can be watched it is sufficient; text digests are only a fallback.
  const digests = await runSubCalls(cutBlock ? [] : digestTasks, subOpts)
  const lineOf = new Map(digests.results.filter((r) => r.ok && r.text).map((r) => [r.id, r.text!.split('\n')[0].slice(0, 200)]))

  const styleHint = String(sc.recipe.options?.styleText ?? '').trim()
  const shotLines = shots.map((s) => `[${s.t0}–${s.t1}s] ${lineOf.get(s.id) ?? s.name}`)
  if (under.length > kept.length) shotLines.push(`(+${under.length - kept.length} more shots after these)`)
  const synth = await runSubCalls(
    [
      {
        id: 'synth',
        model: subOpts.synthModel,
        maxTokens: 1200,
        prompt: [
          `You are scoring a film edit. One musical piece must cover a ${span.spanSec}-second span.`,
          // the style prompt GOVERNS (user call 2026-08-19: compose felt random, ignoring it) —
          // footage shapes structure and timing; the style owns the palette
          styleHint
            ? `THE STYLE PROMPT governs everything: "${styleHint}". Every beat must serve this style — take the genre, instrumentation and mood vocabulary FROM it. The footage below only shapes structure and timing.`
            : '',
          sc.recipe.options?.isInstrumental !== false ? 'Instrumental piece — no vocal or lyric directions.' : '',
          cutBlock ? `${cutBlock}\n\nThe beats must follow the CUT above: land on its cut points and turns; enter, lift, drop and end where it says.` : '',
          `Clip labels / recipe context under the span (not observations; the watched cut takes precedence, including overlapping layers):`,
          shotLines.join('\n'),
          ``,
          `Write the score beats: timestamped musical directions shaping ONE continuous piece to this cut.`,
          `Rules: 3 to 8 beats; the first at 0; "at" in seconds from the span start, inside 0-${span.spanSec};`,
          `each direction is MUSICAL (dynamics, instrumentation, tension, tempo feel — never visuals), at most 12 words.`,
          `Answer with a STRICT JSON array only, nothing else: [{"at": 0, "text": "..."}]`
        ]
          .filter(Boolean)
          .join('\n')
      }
    ],
    subOpts
  )
  const sr = synth.results[0]
  if (!sr?.ok || !sr.text) return { ok: false, error: `compose synthesis failed: ${sr?.error ?? 'no reply'}` }
  const a = sr.text.indexOf('[')
  const b = sr.text.lastIndexOf(']')
  if (a < 0 || b <= a) return { ok: false, error: 'compose reply carried no JSON beats — try again' }
  let parsed: unknown
  try {
    parsed = JSON.parse(sr.text.slice(a, b + 1))
  } catch {
    return { ok: false, error: 'compose reply was not valid JSON — try again' }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { ok: false, error: 'compose returned no beats — try again' }
  const beats: ScoreBeat[] = parsed
    .filter((x): x is { at?: unknown; text?: unknown } => !!x && typeof x === 'object')
    .map((x) => ({
      id: randomUUID(),
      at: Math.max(0, Math.min(span.spanSec, Number((x as { at?: unknown }).at) || 0)),
      text: String((x as { text?: unknown }).text ?? '').slice(0, 200)
    }))
    .filter((b2) => b2.text.trim())
    .sort((x, y) => x.at - y.at)
  if (beats.length === 0) return { ok: false, error: 'compose returned empty beats — try again' }
  return { ok: true, beats, spanSec: span.spanSec, clipCount: kept.length }
}
