// Model-capability registry — the single place that knows what each generation engine can do.
// The Clip Editor renders its fields FROM these descriptors (greying out what a model can't use,
// while the stored PromptData keeps everything so switching engines never loses data), and the
// main-process render pipeline routes endpoints/params from the same source.
//
// Sora 2 facts verified against fal's OpenAPI specs 2026-06-09 (see docs/audit + research notes):
// no end frame, no image-reference array (identity = Characters api, max 2 ids), no seed,
// audio native + always-on, duration enum, aspect 16:9|9:16(+auto on i2v), 720p (pro: 1080p+).
import type { EngineId } from './types'

// vid2vid capability block — a model that can edit video declares one of these. The Clip Edit
// panel renders FROM it (window caps, price) so a second v2v engine is a registry entry, not a
// panel rewrite. Values marked provisional await the live probe (docs/v2v-workflow-plan).
export interface V2vCaps {
  endpoint: string // fal slug
  maxInSec: number // longest source segment the model accepts
  minInSec: number // shortest sensible segment (provisional until probed)
  pricePerSecOut: number // $/second of output video (token billing approximated)
  pricePerSecIn: number // $/second of INPUT video (edits bill the source's tokens too)
  promptHint: string // model-specific guidance shown under the edit prompt
}

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
  endpoints: Partial<Record<'ref2v' | 'i2v' | 't2v', string>> // fal slugs per mode ('t2v' = ref2v with zero refs routes here)
  pricePerSec: Record<string, number> // $/second by resolution, for the cost estimate
  refTagPrompt?: boolean // prompt binds refs via <IMAGE_REF_n> tags (Gemini) — @mentions are rewritten at emit
  promptStyle?: 'yaml' | 'natural' // how structured fields are emitted (default 'yaml' — Seedance MD)
  v2v?: V2vCaps // present = this engine can edit video (Clip Edit panel)
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
  },
  // Gemini Omni Flash (google/ namespace on fal, preview upstream) — schemas verified against
  // fal's OpenAPI 2026-07-02. All modes: 720p only, aspect 16:9|9:16, INT duration 3-10s
  // (default 8), audio native + always on (steered by prompt text), NO seed. Zero refs routes to
  // the base t2v endpoint; 1-10 refs to reference-to-video with <IMAGE_REF_n> prompt tags.
  // v2v = the /edit endpoint: prompt + video_url ONLY (no refs/masks/knobs; works off the source).
  omniflash: {
    id: 'omniflash',
    label: 'Gemini Omni Flash',
    modes: ['ref2v', 'i2v'],
    endFrame: false,
    maxRefImages: 10,
    characterRefs: 0,
    durations: ['3', '4', '5', '6', '7', '8', '9', '10'],
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
    audioToggle: false, // native audio, always on — say "no dialogue" / "calm music" in the prompt
    seed: false,
    endpoints: {
      t2v: 'google/gemini-omni-flash',
      ref2v: 'google/gemini-omni-flash/reference-to-video',
      i2v: 'google/gemini-omni-flash/image-to-video'
    },
    // token billing (~$0.125-0.13/s of 720p per fal's own pages) approximated per second
    pricePerSec: { '720p': 0.13 },
    refTagPrompt: true,
    promptStyle: 'natural', // Gemini reads prose direction, not Seedance-tuned YAML
    v2v: {
      endpoint: 'google/gemini-omni-flash/edit',
      maxInSec: 10, // Google's native docs; fal doesn't document it — provisional until probed
      minInSec: 1, // provisional until probed
      pricePerSecOut: 0.13,
      pricePerSecIn: 0.011, // input video tokens ($1.875/1M) — edits bill the source too
      promptHint: 'Simple instructions work best. End with "Keep everything else the same." Voice editing is not supported.'
    },
    notes: 'Omni Flash: 720p only, 3-10s, audio always on (steer it in the prompt), no seed, no end frame.'
  }
}

export const DEFAULT_ENGINE: EngineId = 'seedance2'

export function modelFor(engine: EngineId | undefined): ModelDescriptor {
  return MODELS[engine ?? DEFAULT_ENGINE] ?? MODELS[DEFAULT_ENGINE]
}
