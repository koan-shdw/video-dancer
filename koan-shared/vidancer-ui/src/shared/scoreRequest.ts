import { AUDIO_MODELS, type AudioModelDescriptor } from './audioModels'
import type { Project, ScoreClip, ScoreRenderArgs, Timeline, TimelineScoreItem } from './types'

// A misspelled/stale engine must never silently submit to the default paid model.
export function scoreModel(engine: string): AudioModelDescriptor {
  const model = AUDIO_MODELS[engine]
  if (!model || model.kind !== 'music') throw new Error(`Score model “${engine}” is unavailable — choose a music model.`)
  return model
}

export function scoreVia(model: AudioModelDescriptor): { label: string; hint: string } {
  return model.provider === 'fal'
    ? { label: 'fal', hint: 'Uses your fal API key and fal credits.' }
    : model.provider === 'elevenlabs'
      ? { label: 'ElevenLabs', hint: 'Uses your ElevenLabs API key and ElevenLabs music credits.' }
      : model.provider === 'google'
        ? { label: 'Google', hint: 'Uses your Google AI key (the one Watch uses), billed by Google.' }
      : { label: 'Local', hint: 'Runs on this computer. No API key or generation credits; the model must be installed.' }
}

export function scoreSpan(p: Project, args: { scoreClipId: string; timelineId?: string; scoreItemId?: string }): { timeline: Timeline; span: TimelineScoreItem } {
  const timeline = p.timelines.find(t => t.id === (args.timelineId ?? p.activeTimelineId))
  if (!timeline) throw new Error('Open the timeline containing this score first.')
  const matches = (timeline.scoreItems ?? []).filter(s => s.scoreClipId === args.scoreClipId)
  const span = args.scoreItemId ? matches.find(s => s.id === args.scoreItemId) : matches.length === 1 ? matches[0] : undefined
  if (!span) throw new Error(matches.length > 1 && !args.scoreItemId
    ? 'This score has several spans — select the score block on the timeline first.'
    : 'Select a span belonging to this score, or stretch the score over the timeline first.')
  if (!Number.isFinite(span.startSec) || span.startSec < 0 || !Number.isFinite(span.spanSec) || span.spanSec <= 0)
    throw new Error('The score span must have a positive length and a valid start time.')
  return { timeline, span }
}

export function scoreRenderRequest(score: ScoreClip, p: Project, selectedScoreItemId?: string | null): ScoreRenderArgs {
  const timeline = p.timelines.find(t => t.id === p.activeTimelineId)
  const selected = timeline?.scoreItems?.find(s => s.id === selectedScoreItemId && s.scoreClipId === score.id)
  return {
    scoreClipId: score.id, engine: score.recipe.engine,
    durationSec: Number(score.recipe.options?.durationSec ?? 60),
    snapshot: structuredClone({ beats: score.beats, recipe: score.recipe }),
    timelineId: timeline?.id, scoreItemId: selected?.id
  }
}

export function scoreRenderSnapshot(sc: ScoreClip, req: ScoreRenderArgs): NonNullable<ScoreRenderArgs['snapshot']> {
  const snapshot = structuredClone(req.snapshot ?? { beats: sc.beats, recipe: sc.recipe })
  snapshot.recipe.engine = req.engine || snapshot.recipe.engine
  scoreModel(snapshot.recipe.engine)
  return snapshot
}
