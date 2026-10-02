// v20 ONE LANE SYSTEM (docs/TIMELINE-AUDIO-SPEC.md): resolve a TimelineAudioItem's sound to a
// playable file, whichever kind it is — a clip take's audio window (green) or a Library file
// (teal ♫). ONE resolver for renderer players/blocks AND main's export chains.
import type { TimelineAudioItem, Clip, ProjAudio, ScoreClip } from './types'
import { playFileOf } from './reverse'

export interface ResolvedAudioSource {
  kind: 'clip' | 'file' | 'nest' | 'sfx'
  file?: string // absent = source missing (deleted clip/take/track) — the item renders dead + silent
  durationSec?: number
  name: string
}

// a sound fx block's take: the one it names, else its keeper, else its newest (a score's rule)
export const sfxTakeOf = (sc: ScoreClip | undefined, takeId?: string): ScoreClip['takes'][number] | undefined =>
  (takeId ? sc?.takes.find((t) => t.id === takeId) : undefined) ?? sc?.takes.find((t) => t.id === sc.keeperTakeId) ?? sc?.takes[sc.takes.length - 1]

// the file a take-based block plays before any reversing (a clip take or a sound fx take) — what a
// reversed block needs a reversed copy of
export function sourceTakeFile(a: TimelineAudioItem, clips: Clip[], scoreClips: ScoreClip[]): string | undefined {
  const src = a.source
  if ('clipId' in src) return clips.find((x) => x.id === src.clipId)?.takes.find((t) => t.id === src.takeId)?.file
  if ('sfxId' in src) return sfxTakeOf(scoreClips.find((x) => x.id === src.sfxId), src.takeId)?.file
  return undefined
}

export function resolveAudioSource(a: TimelineAudioItem, clips: Clip[], audio: ProjAudio[], scoreClips: ScoreClip[]): ResolvedAudioSource {
  const src = a.source
  if ('audioId' in src) {
    const tr = audio.find((x) => x.id === src.audioId)
    return { kind: 'file', file: tr?.file, durationSec: tr?.durationSec, name: tr?.title ?? '?' }
  }
  // a nest's lane block (list 3, part 2) never reaches a player — flattenNests swaps it for what
  // sounds inside; the Timeline panel names and sizes it from the project's timelines
  if ('nestId' in src) return { kind: 'nest', name: '⧉ nest' }
  // v24: a sound fx (his 10-02 "clip effect not score") — no take yet = silent, its stretch waits for a render
  if ('sfxId' in src) {
    const sc = scoreClips.find((x) => x.id === src.sfxId)
    const take = sfxTakeOf(sc, src.takeId)
    return { kind: 'sfx', file: take?.file ? playFileOf(take.file, a) : undefined, durationSec: take?.durationSec, name: sc?.name ?? '?' }
  }
  const clip = clips.find((c) => c.id === src.clipId)
  const take = clip?.takes.find((x) => x.id === src.takeId)
  return { kind: 'clip', file: take?.file ? playFileOf(take.file, a) : undefined, durationSec: take?.durationSec, name: clip?.name ?? '?' } // list 51: reversed = the reversed copy
}
