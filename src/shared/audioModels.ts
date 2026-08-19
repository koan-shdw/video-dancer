// Audio-model capability registry — the audio sibling of models.ts: the single place that knows
// what each AUDIO generation engine can do. The Score card (and later the Voices card) renders
// its options FROM these descriptors, exactly like Clip Gen renders from ModelDescriptor.
// Engines verified first-hand 2026-08-19 (SCORE-PLAN / VOICES-PLAN carry the sources); exact
// wire params (field names, pricing) get the OpenAPI read when each engine's render path lands —
// entries whose wire schema is still unread say so in `notes`.

export type AudioEngineKind = 'music' | 'voice'

export interface AudioModelDescriptor {
  id: string
  label: string
  kind: AudioEngineKind
  provider: 'fal' | 'elevenlabs' | 'local'
  hidden?: boolean // true = not offered in pickers (kept so old recipes still resolve)
  maxDurationSec: number // longest single render the engine produces
  instrumentalToggle?: boolean // an is_instrumental-style switch exists
  dualPrompt?: boolean // style prompt + structure/lyrics are separate inputs (MiniMax Music 3)
  videoToMusic?: boolean // scores FROM footage (Sonilo) — the span upload path, no text prompt needed
  negativePrompt?: boolean
  seed?: boolean
  localRuntime?: string // local engines: the runtime env id (LOCAL-MODELS-PLAN) — absent = API
  endpoint?: string // fal slug (verified ids only; '' = pinned at the OpenAPI read)
  priceNote?: string // honest cost line for the queue row (exact $ pinned at the OpenAPI read)
  notes?: string // shown in the card when this engine is selected
}

export const AUDIO_MODELS: Record<string, AudioModelDescriptor> = {
  'minimax-music-3': {
    id: 'minimax-music-3',
    label: 'MiniMax Music 3',
    kind: 'music',
    provider: 'fal',
    // wire schema read off fal's OpenAPI 2026-08-19: prompt (music description) + lyrics
    // (structure tags on separate lines — the beats emit THERE) + duration 1-300 + seed.
    // There is NO is_instrumental field — instrumental is said in the prompt + tag-only lyrics.
    maxDurationSec: 300,
    instrumentalToggle: true, // shapes the EMIT (prompt wording + tag-only lyrics), not a wire field
    dualPrompt: true,
    seed: true,
    endpoint: 'minimax/music-3',
    priceNote: 'fal — per-gen rate not on the schema; the first live render is the price check',
    notes: 'Primary score engine: full pieces to 5 min, 44.1kHz WAV out. Style prompt here; the beats emit as structure tags.'
  },
  sonilo: {
    id: 'sonilo',
    label: 'Sonilo (video-to-music)',
    kind: 'music',
    provider: 'fal',
    maxDurationSec: 600, // scores videos up to 600s (verified 2026-08-19)
    videoToMusic: true,
    seed: false,
    endpoint: 'sonilo/v1.1/video-to-music', // OpenAPI verified 2026-08-19: video_url (required) + prompt + prompt_influence 0-1 + num_samples + start_offset/duration; output audio.url (AAC m4a)
    priceNote: 'fal — per-render rate not on the schema; the first live render is the price check',
    notes: 'Scores the actual FOOTAGE: the stretched span renders as a draft proxy, uploads, and Sonilo writes frame-synced licensed music to its pacing. Style prompt steers it; beats are notes to you, not the engine.'
  },
  beatoven: {
    id: 'beatoven',
    label: 'Beatoven',
    kind: 'music',
    provider: 'fal',
    // wire schema read off fal's OpenAPI 2026-08-19: prompt + duration 5-150 (default 90) +
    // negative_prompt + creativity 1-20 + refinement 10-200 + seed (defaults left alone)
    maxDurationSec: 150,
    negativePrompt: true,
    seed: true,
    endpoint: 'beatoven/music-generation',
    priceNote: 'fal — per-gen rate not on the schema; the first live render is the price check',
    notes: 'Fallback: background/cinematic instrumentals, 44.1kHz WAV, negative prompting + seed.'
  },
  // facts re-verified against the PRIMARY sources 2026-08-19 (the poisoned-chat numbers died):
  // ACE README: 10s-600s, <4GB VRAM DiT-only, REST server `acestep-api` on :8001, task API.
  'ace-step-1.5': {
    id: 'ace-step-1.5',
    label: 'ACE-Step 1.5 (local)',
    kind: 'music',
    provider: 'local',
    maxDurationSec: 600,
    instrumentalToggle: true,
    dualPrompt: true, // prompt + lyrics are separate wire fields (API.md: prompt / lyrics)
    seed: true,
    localRuntime: 'ace-step-1.5',
    priceNote: 'local render — free, your GPU pays in time',
    notes: 'Local music engine: MIT, runs from ~4GB VRAM, seconds per song. Install from the Models card; the first render fetches its core models (~10 GB).'
  },
  // HF card verified: SINGLE GPU — full bf16 <24GB, auto-offload ~22GB, LM layer-streaming
  // fits 8GB (slower). The two-GPU line in their GitHub README is only the sglang server recipe.
  'minimax-music-3-local': {
    id: 'minimax-music-3-local',
    label: 'MiniMax Music 3 (local)',
    kind: 'music',
    provider: 'local',
    maxDurationSec: 300,
    instrumentalToggle: true,
    dualPrompt: true,
    seed: true, // the diffusers pipeline takes a seeded generator
    localRuntime: 'minimax-music-3',
    priceNote: 'local render — free, your GPU pays in time',
    notes: 'Same family as the API engine, open weights, one GPU: 24GB runs it whole, 16GB and below run with offload (slower). Installs from the Models card.'
  }
}

export const DEFAULT_SCORE_ENGINE = 'minimax-music-3'

export function audioModelFor(engine: string | undefined): AudioModelDescriptor {
  return AUDIO_MODELS[engine ?? DEFAULT_SCORE_ENGINE] ?? AUDIO_MODELS[DEFAULT_SCORE_ENGINE]
}

export function audioModelsOf(kind: AudioEngineKind): AudioModelDescriptor[] {
  return Object.values(AUDIO_MODELS).filter((m) => m.kind === kind && !m.hidden)
}
