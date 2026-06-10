// Model-capability registry — the single place that knows what each generation engine can do.
// The Clip Editor renders its fields FROM these descriptors (greying out what a model can't use,
// while the stored PromptData keeps everything so switching engines never loses data), and the
// main-process render pipeline routes endpoints/params from the same source.
//
// Sora 2 facts verified against fal's OpenAPI specs 2026-06-09 (see docs/audit + research notes):
// no end frame, no image-reference array (identity = Characters api, max 2 ids), no seed,
// audio native + always-on, duration enum, aspect 16:9|9:16(+auto on i2v), 720p (pro: 1080p+).
import type { EngineId } from './types'

export interface ModelDescriptor {
  id: EngineId
  label: string
  modes: Array<'ref2v' | 'i2v'>
  endFrame: boolean // supports a separate end/last keyframe (i2v)
  maxRefImages: number // reference-to-video image refs (0 = mode unsupported)
  characterRefs: number // Sora-style character identities (0 = none)
  durations: string[] // allowed values for the duration select
  resolutions: string[]
  aspectRatios: string[]
  audioToggle: boolean // false = audio is fixed (Sora: always on)
  seed: boolean
  endpoints: Partial<Record<'ref2v' | 'i2v', string>> // fal slugs per mode
  pricePerSec: Record<string, number> // $/second by resolution, for the cost estimate
  notes?: string // shown in the editor when this engine is selected
}

export const MODELS: Record<EngineId, ModelDescriptor> = {
  seedance2: {
    id: 'seedance2',
    label: 'Seedance 2',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '10', '12', '15'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: true,
    endpoints: {
      ref2v: 'bytedance/seedance-2.0/reference-to-video',
      i2v: 'bytedance/seedance-2.0/image-to-video'
    },
    pricePerSec: { '480p': 0.135, '720p': 0.3034, '1080p': 0.682 }
  },
  sora2: {
    id: 'sora2',
    label: 'Sora 2',
    modes: ['i2v'], // single start frame only — no reference-to-video
    endFrame: false,
    maxRefImages: 0,
    characterRefs: 2, // via the Characters api — not wired into the editor yet
    durations: ['4', '8', '12', '16', '20'],
    resolutions: ['auto', '720p'],
    aspectRatios: ['auto', '16:9', '9:16'],
    audioToggle: false, // native audio, always on — no parameter exists
    seed: false,
    endpoints: {
      i2v: 'fal-ai/sora-2/image-to-video'
    },
    // standard-tier 720p rate; fal hasn't published the standard rate as clearly as pro — verify on first live render
    pricePerSec: { auto: 0.1, '720p': 0.1 },
    notes: 'Sora 2: start frame only (no end frame, no @refs), no seed, audio always on.'
  }
}

export const DEFAULT_ENGINE: EngineId = 'seedance2'

export function modelFor(engine: EngineId | undefined): ModelDescriptor {
  return MODELS[engine ?? DEFAULT_ENGINE] ?? MODELS[DEFAULT_ENGINE]
}
