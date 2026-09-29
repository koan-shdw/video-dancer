// v20 ONE LANE SYSTEM (docs/TIMELINE-AUDIO-SPEC.md): resolve a TimelineAudioItem's sound to a
// playable file, whichever kind it is — a clip take's audio window (green) or a Library file
// (teal ♫). ONE resolver for renderer players/blocks AND main's export chains.
import type { TimelineAudioItem, Clip, ProjAudio } from './types'
import { playFileOf } from './reverse'

export interface ResolvedAudioSource {
  kind: 'clip' | 'file' | 'nest'
  file?: string // absent = source missing (deleted clip/take/track) — the item renders dead + silent
  durationSec?: number
  name: string
}

export function resolveAudioSource(a: TimelineAudioItem, clips: Clip[], audio: ProjAudio[]): ResolvedAudioSource {
  const src = a.source
  if ('audioId' in src) {
    const tr = audio.find((x) => x.id === src.audioId)
    return { kind: 'file', file: tr?.file, durationSec: tr?.durationSec, name: tr?.title ?? '?' }
  }
  // a nest's lane block (list 3, part 2) never reaches a player — flattenNests swaps it for what
  // sounds inside; the Timeline panel names and sizes it from the project's timelines
  if ('nestId' in src) return { kind: 'nest', name: '⧉ nest' }
  const clip = clips.find((c) => c.id === src.clipId)
  const take = clip?.takes.find((x) => x.id === src.takeId)
  return { kind: 'clip', file: take?.file ? playFileOf(take.file, a) : undefined, durationSec: take?.durationSec, name: clip?.name ?? '?' } // list 51: reversed = the reversed copy
}
