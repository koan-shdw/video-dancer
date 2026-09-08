// SCORE COMPOSE (SCORE-PLAN phase 5) — reads everything under a stretched score span and writes
// suggested beats. First consumer of the phase-0 sub-call plumbing: one digest per clip runs in
// PARALLEL on the cheap tier, then one synthesis pass on the stronger model returns strict-JSON
// beats. The overwrite rule (empty = in place, has beats = duplicate) lives in the IPC handler.
import { randomUUID } from 'crypto'
import { getProject, mainEffDur } from './project'
import { runSubCalls, type SubCallOpts, type SubCallTask } from './subcall'
import type { ScoreBeat, PromptData } from '@koan/vidancer-ui/shared/types'

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
  subOpts: SubCallOpts & { synthModel: string }
): Promise<{ ok: true; beats: ScoreBeat[]; spanSec: number; clipCount: number } | { ok: false; error: string }> {
  const p = getProject()
  if (!p) return { ok: false, error: 'no project open' }
  const sc = p.scoreClips.find((x) => x.id === args.scoreClipId)
  if (!sc) return { ok: false, error: 'score clip not found' }
  const tl = p.timelines.find((t) => t.id === (args.timelineId ?? p.activeTimelineId))
  if (!tl) return { ok: false, error: 'timeline not found' }
  const span = args.scoreItemId
    ? (tl.scoreItems ?? []).find((s) => s.id === args.scoreItemId)
    : (tl.scoreItems ?? []).find((s) => s.scoreClipId === sc.id)
  if (!span) return { ok: false, error: 'stretch this score over the timeline first — compose reads the clips under the span' }
  const S = span.startSec
  const E = span.startSec + span.spanSec

  // every video block overlapping the span, chronological — cut rhythm comes from the times
  const under = tl.items
    .map((it) => {
      const start = it.startSec ?? 0
      const eff = mainEffDur(it, p.clips)
      return { it, start, end: start + eff }
    })
    .filter((x) => !x.it.disabled && x.start < E && x.end > S)
    .sort((a, b) => a.start - b.start)
  if (under.length === 0) return { ok: false, error: 'no clips under the span — compose needs footage to read' }
  const kept = under.slice(0, COMPOSE_CLIP_CAP)

  // one digest per shot, all in parallel on the cheap tier (a failed digest degrades to the
  // clip's name — one flaky sub-call must not kill the whole compose)
  const shots = kept.map((x, i) => {
    const clip = p.clips.find((c) => c.id === x.it.clipId)
    const takeId = x.it.takeId ?? clip?.keeperTakeId
    const pd = (clip?.takes.find((t) => t.id === takeId) ?? clip?.takes[clip.takes.length - 1])?.snapshot ?? clip?.promptData
    const t0 = Math.max(0, Math.round(x.start - S))
    const t1 = Math.min(Math.round(span.spanSec), Math.round(x.end - S))
    return { id: `shot${i}`, name: clip?.name ?? '?', t0, t1, pd }
  })
  const digestTasks: SubCallTask[] = shots
    .filter((s) => s.pd)
    .map((s) => ({
      id: s.id,
      prompt: `One line, at most 22 words, for a film composer: the mood, energy and motion of this shot. No preamble, no quotes.\n\nSHOT "${s.name}" (${s.t1 - s.t0}s on screen):\n${shotText(s.pd!)}`
    }))
  const digests = await runSubCalls(digestTasks, subOpts)
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
          `You are scoring a film edit. One musical piece must cover a ${Math.round(span.spanSec)}-second span.`,
          // the style prompt GOVERNS (user call 2026-08-19: compose felt random, ignoring it) —
          // footage shapes structure and timing; the style owns the palette
          styleHint
            ? `THE STYLE PROMPT governs everything: "${styleHint}". Every beat must serve this style — take the genre, instrumentation and mood vocabulary FROM it. The footage below only shapes structure and timing.`
            : '',
          sc.recipe.options?.isInstrumental !== false ? 'Instrumental piece — no vocal or lyric directions.' : '',
          `The shots under the span, in order, with their times:`,
          shotLines.join('\n'),
          ``,
          `Write the score beats: timestamped musical directions shaping ONE continuous piece to this cut.`,
          `Rules: 3 to 8 beats; the first at 0; "at" in seconds from the span start, inside 0-${Math.round(span.spanSec)};`,
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
