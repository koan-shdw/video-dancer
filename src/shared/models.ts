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
  provider?: 'fal' | 'higgsfield' | 'modelark' | 'astria' // which platform runs this engine (absent = fal, the original)
  hidden?: boolean // true = not offered in pickers (kept in the registry so old takes still resolve)
  modes: Array<'ref2v' | 'i2v'>
  endFrame: boolean // supports a separate end/last keyframe (i2v)
  maxRefImages: number // reference-to-video image refs (0 = mode unsupported)
  // Seedance multimodal refs (fal: video_urls/audio_urls, bound in-prompt as @video1/@audio1 by
  // POSITION). fal constraints (2.0 AND 2.5 schemas): ≤3 videos 2-15s combined <50MB total;
  // ≤3 audios ≤15s combined (audio requires ≥1 image/video ref); ≤12 ref files across modalities.
  maxRefVideos: number // 0 = no video references
  maxRefAudios: number // 0 = no audio references
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
    maxRefVideos: 3, // fal schema verified 2026-07-31: 2.0 ref2v takes video_urls + audio_urls too
    maxRefAudios: 3,
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
  // Seedance 2.5 — fal, now GA. Schemas re-verified against fal's live pages 2026-08-08 and the
  // ladder CHANGED since the 2026-07-31 early-access audit: duration is now every integer 4-30
  // (+auto) for native single-shot 30s takes, resolutions are 480p|720p ONLY (1080p/4k left the
  // schema), still NO seed input (output-only), refs same trio bound as @video1/@audio1/@image1
  // tags. end_user_id is REQUIRED by fal's 2.5 terms (sent by main).
  seedance25: {
    id: 'seedance25',
    label: 'Seedance 2.5',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    resolutions: ['480p', '720p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false, // 2.5 dropped the seed INPUT — fal returns one in the output only
    endpoints: {
      t2v: 'bytedance/seedance-2.5/text-to-video', // zero-ref ref2v routes here
      ref2v: 'bytedance/seedance-2.5/reference-to-video',
      i2v: 'bytedance/seedance-2.5/image-to-video'
    },
    // fal publishes token billing for 2.5: $0.0214 per 1000 tokens, tokens = h·w·dur·24/1024.
    // Per-second at 16:9 → 480p (864×480) ≈ $0.208/s, 720p (1280×720) ≈ $0.462/s.
    pricePerSec: { '480p': 0.208, '720p': 0.462 },
    notes: 'Seedance 2.5: native 30s single-shot · no seed · token-billed — the $/s estimate assumes 16:9.'
  },
  // Seedance 2.0 served by HIGGSFIELD (platform.higgsfield.ai) — same model family as `seedance2`,
  // billed against the user's Higgsfield subscription credits instead of fal pay-per-use.
  // Catalog verified against higgsfield-ai/cli MODELS.md 2026-07-31: refs trio (9 images counting
  // start+end / 3 videos / 3 audio), 4k in std mode, integer durations, NO seed. Price per second
  // is unknowable (credits) — the cost estimate stays blank on purpose (law: cost honesty).
  seedance2hf: {
    id: 'seedance2hf',
    label: 'Seedance 2 (Higgsfield)',
    provider: 'higgsfield',
    // HIDDEN 2026-07-31: live probe proved Higgsfield's platform API serves NO Seedance (their
    // consumer app does, but on session auth an app can't ship). The adapter + this entry stay —
    // flip `hidden` off the day their API lists a seedance slug.
    hidden: true,
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9, // Higgsfield counts start+end images INSIDE the 9 — validated at render
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['4', '5', '6', '7', '8', '10', '12', '15'],
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      ref2v: 'seedance_2_0', // Higgsfield application id (POST /{id}) — probe-confirm on first render
      i2v: 'seedance_2_0'
    },
    pricePerSec: {}, // credits-billed — no honest $/s exists; the queue row shows no estimate
    notes: 'Seedance 2 via Higgsfield: needs a Higgsfield key (Settings), bills your Higgsfield credits — no $ estimate shown.'
  },
  // Seedance 2.0 served DIRECT by ByteDance (BytePlus ModelArk) — the official API. Docs verified
  // in-browser 2026-07-31: content[] with typed entries + role tags, base64 legal for images/audio
  // (videos need PUBLIC urls — so video refs are PARKED here at 0 until a hosting story exists),
  // 4K is 10-bit, duration 4-15 or -1 auto, no seed on 2.0, watermark defaults off.
  // TWO caveats the UI must carry: dated model ids rotate (endpoint string below), and Seedance 2.0
  // on ModelArk REFUSES reference images/videos containing real human faces (their trust policy) —
  // real-people refs stay a fal job.
  seedance2ark: {
    id: 'seedance2ark',
    label: 'Seedance 2 (ModelArk)',
    provider: 'modelark',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 0, // parked: ModelArk video refs need public URLs — slots show "kept, not sent"
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      ref2v: 'dreamina-seedance-2-0-260128', // ModelArk model id — DATED, rotates; update here
      i2v: 'dreamina-seedance-2-0-260128'
    },
    pricePerSec: {}, // token-billed on BytePlus — no honest $/s; estimate stays blank (law 8)
    notes: 'Seedance 2 direct from ByteDance: needs a ModelArk key (Settings) · refs must NOT contain real human faces (their policy) · bills BytePlus tokens — no $ estimate shown.'
  },
  // Seedance 2.5 served DIRECT by ByteDance (ModelArk) — model id + caps read off the live model
  // list 2026-08-08 (docs.byteplus.com/en/docs/ModelArk/1330310): dreamina-seedance-2-5-260628,
  // 480p/720p @24fps, duration 4-30s, mp4/mov out, full multimodal-reference suite. Same
  // content[] API as 2.0, so the adapter needs nothing new — video refs stay PARKED at 0 for the
  // same public-URL reason, and the no-real-faces policy still applies.
  seedance25ark: {
    id: 'seedance25ark',
    label: 'Seedance 2.5 (ModelArk)',
    provider: 'modelark',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 0, // parked: ModelArk video refs need public URLs — slots show "kept, not sent"
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    resolutions: ['480p', '720p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      ref2v: 'dreamina-seedance-2-5-260628', // ModelArk model id — DATED, rotates; update here
      i2v: 'dreamina-seedance-2-5-260628'
    },
    pricePerSec: {}, // token-billed on BytePlus — no honest $/s; estimate stays blank (law 8)
    notes: 'Seedance 2.5 direct from ByteDance: native 30s · needs a ModelArk key (Settings) · refs must NOT contain real human faces (their policy) · bills BytePlus tokens — no $ estimate shown.'
  },
  // Seedance 2 served by ASTRIA (api.astria.ai) — their prompts API carries video params
  // (docs.astria.ai/docs/features/video/, read 2026-08-08). Resolution lives IN the model id
  // (seedance2_480p/720p/1080p — the adapter composes it), duration 4-15s, t2v + first/last-frame
  // i2v only: their API exposes NO reference arrays, no audio switch, no seed. Their docs list no
  // seedance 2.5 id yet — the day one appears it's a second registry entry, nothing else.
  seedance2astria: {
    id: 'seedance2astria',
    label: 'Seedance 2 (Astria)',
    provider: 'astria',
    modes: ['ref2v', 'i2v'], // ref2v with zero ref slots = plain t2v (same zero-ref grammar as fal)
    endFrame: true,
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1'],
    audioToggle: false, // Astria's video params carry no audio switch — the model decides
    seed: false,
    endpoints: {
      t2v: 'seedance2', // base id — the adapter appends the resolution (seedance2_720p)
      ref2v: 'seedance2',
      i2v: 'seedance2'
    },
    pricePerSec: {}, // billed in Astria plan credits — no honest $/s; estimate stays blank (law 8)
    notes: 'Seedance 2 via Astria: needs an Astria key (Settings) · t2v + first/last-frame i2v (their API takes no @refs) · no audio switch, no seed · bills your Astria credits — no $ estimate shown.'
  },
  sora2: {
    id: 'sora2',
    label: 'Sora 2',
    modes: ['i2v'], // single start frame only — no reference-to-video
    endFrame: false,
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
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
    maxRefVideos: 0,
    maxRefAudios: 0,
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
    // probe-verified 2026-07-02 (scripts/probe-omni-edit.mjs): output is ALWAYS 1280x720 16:9
    // h264 @24fps + AAC 48kHz stereo regardless of source resolution OR aspect (a 1:1 source comes
    // back 16:9); length is preserved up to 10s and inputs beyond that are SILENTLY TRUNCATED to
    // 10s (why the window UI enforces the cap explicitly); 1.5s inputs edit fine; a fal-hosted
    // output URL can feed straight back in as the next edit's source.
    v2v: {
      endpoint: 'google/gemini-omni-flash/edit',
      maxInSec: 10, // verified: longer inputs are truncated to 10s, not rejected
      minInSec: 1, // 1.5s verified working; below that untested
      pricePerSecOut: 0.13,
      pricePerSecIn: 0.011, // input video tokens ($1.875/1M) — edits bill the source too
      promptHint: 'Simple instructions work best. End with "Keep everything else the same." No voice editing. Output is always 720p 16:9 @ 24fps.'
    },
    notes: 'Omni Flash: 720p only, 3-10s, audio always on (steer it in the prompt), no seed, no end frame.'
  }
}

export const DEFAULT_ENGINE: EngineId = 'seedance2'

export function modelFor(engine: EngineId | undefined): ModelDescriptor {
  return MODELS[engine ?? DEFAULT_ENGINE] ?? MODELS[DEFAULT_ENGINE]
}
