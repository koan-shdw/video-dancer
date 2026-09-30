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
  provider: 'fal' | 'elevenlabs' | 'google' | 'local'
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
  // VOICE-kind capabilities (VOICES-SPEC-2026-08-20):
  voiceDesign?: boolean // designs a voice FROM a text description (no reference needed)
  voiceClone?: boolean // speaks text IN a reference audio's voice (zero-shot clone)
  foley?: boolean // renders ambience/effects/music in the same pass (scene-track engine)
  maxTextChars?: number // hard cap on the spoken text per render (engine wire limit)
  // list 18 / 19 — suppliers whose takes speak in one of THEIR voices (Gemini, ElevenLabs):
  voices?: { id: string; label: string }[] // the engine's own ready voices (Gemini's 30) — a pick beside "designed from the description"
  voiceLibrary?: boolean // its ready voices are the ones in HIS account (ElevenLabs) — the card fetches the list
  styleLine?: boolean // takes a delivery line that is steered, never read aloud (Gemini's speech_metadata.style)
}

// Gemini 3.8 TTS's 30 prebuilt studio voices with Google's own one-word character (read 2026-09-30,
// ai.google.dev/gemini-api/docs/speech-generation)
const GEMINI_VOICES = 'Zephyr:Bright Puck:Upbeat Charon:Informative Kore:Firm Fenrir:Excitable Leda:Youthful Orus:Firm Aoede:Breezy Callirrhoe:Easy-going Autonoe:Bright Enceladus:Breathy Iapetus:Clear Umbriel:Easy-going Algieba:Smooth Despina:Smooth Erinome:Clear Algenib:Gravelly Rasalgethi:Informative Laomedeia:Upbeat Achernar:Soft Alnilam:Firm Schedar:Even Gacrux:Mature Pulcherrima:Forward Achird:Friendly Zubenelgenubi:Casual Vindemiatrix:Gentle Sadachbia:Lively Sadaltager:Knowledgeable Sulafat:Warm'
  .split(' ')
  .map((v) => ({ id: v.split(':')[0], label: `${v.split(':')[0]} — ${v.split(':')[1].toLowerCase()}` }))

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
  // list 21 — ElevenLabs Music v2.5, the newer model (Sep 21), listed above v2 (newest first). The
  // compose API is the same door and the same plan of chunks; only model_id differs (docs read
  // 2026-09-30: model_id music_v1 | music_v2 | music_v2_5).
  'eleven-music-v25': {
    id: 'eleven-music-v25',
    label: 'ElevenLabs Music v2.5',
    kind: 'music',
    provider: 'elevenlabs',
    dualPrompt: true,
    maxDurationSec: 600,
    instrumentalToggle: true,
    endpoint: 'elevenlabs:/v1/music',
    priceNote: 'ElevenLabs credits (your plan) — no $ estimate here',
    notes: 'ElevenLabs’ newest music model. Beats become the composition plan: one section per beat, timed to the span. Style prompt = the global styles; lyrics lines sing when instrumental is off.'
  },
  // list 20 — Lyria 3.5 on his Google key (read 2026-09-30, ai.google.dev music-generation +
  // pricing): POST /v1beta/interactions, ONE text prompt → a full song, 44.1 kHz stereo, $0.08 a
  // song (paid tier only). Length is ASKED in the prompt ("a couple of minutes"), never a wire
  // field; "[m:ss - m:ss] …" lines time the structure; lyrics ride under section tags; it sings
  // unless told "Instrumental only, no vocals." No seed. Its up-to-10 image inputs are not wired
  // (Score has no image slots).
  'lyria-35': {
    id: 'lyria-35',
    label: 'Lyria 3.5',
    kind: 'music',
    provider: 'google',
    maxDurationSec: 180,
    instrumentalToggle: true,
    dualPrompt: true,
    seed: false,
    endpoint: 'google:lyria-3.5',
    priceNote: '$0.08 a song (Google — needs the paid tier on the key)',
    notes: 'Google’s full-song model on your Google key: it sings your lyrics or plays instrumental. Beats become its timeline lines. The length is asked for, not guaranteed — a take can run a little short or long of the span.'
  },
  // ElevenLabs Music v2 — direct API (SCORE-WATCH-SPEC §4, docs read 2026-09-08): POST /v1/music,
  // a composition_plan of chunks (our beats: section label + duration 3–120s + styles) or a
  // prompt; 3s–10min; mp3 out. Bills ElevenLabs credits, not dollars.
  'eleven-music-v2': {
    id: 'eleven-music-v2',
    label: 'ElevenLabs Music v2',
    kind: 'music',
    provider: 'elevenlabs',
    dualPrompt: true,
    maxDurationSec: 600,
    instrumentalToggle: true, // shapes the plan (negative style "vocals") — v2 has no flag in plan mode
    endpoint: 'elevenlabs:/v1/music', // not a fal slug — the transport branches on provider
    priceNote: 'ElevenLabs credits (your plan) — no $ estimate here',
    notes: 'Beats become the composition plan: one section per beat, timed to the span. Style prompt = the global styles; lyrics lines sing when instrumental is off.'
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

// ---- VOICE engines (VOICES-SPEC-2026-08-20) — wire schemas read off fal's pages 2026-08-20;
// field names in voiceRender.ts are verbatim from those schemas. ----
export const VOICE_MODELS: Record<string, AudioModelDescriptor> = {
  // fal schema 2026-08-20: text + audio_url (clone ref) OR voice (preset enum) + exaggeration
  // 0.25-2 (0.5) + cfg 0-1 (0.5) + temperature 0.05-5 (0.8) + seed + high_quality_audio (48kHz)
  'chatterbox-api': {
    id: 'chatterbox-api',
    label: 'Chatterbox HD',
    kind: 'voice',
    provider: 'fal',
    maxDurationSec: 300, // no wire duration — length rides the text
    voiceClone: true,
    seed: true,
    endpoint: 'resemble-ai/chatterboxhd/text-to-speech',
    priceNote: '$0.04 / 1000 characters (fal)',
    notes: 'THE main speak engine: zero-shot clone from ~10s of reference, HD 48kHz out, emotion dials (exaggeration · cfg · temperature).'
  },
  // fal schema 2026-08-20: text ≤300 chars + voice (language) + custom_audio_language +
  // exaggeration + temperature + cfg_scale + seed. 23 languages INCLUDING JAPANESE — the JA
  // path. Clone-ref field presence (audio_url) confirmed at the first live render.
  'chatterbox-multilingual': {
    id: 'chatterbox-multilingual',
    label: 'Chatterbox Multilingual',
    kind: 'voice',
    provider: 'fal',
    maxDurationSec: 60,
    voiceClone: true,
    seed: true,
    maxTextChars: 300,
    endpoint: 'fal-ai/chatterbox/text-to-speech/multilingual',
    priceNote: '$0.025 / 1000 characters (fal)',
    notes: '23 languages including Japanese · 300 characters per render — long reads render in pieces.'
  },
  // fal schema 2026-08-20: gen_text ≤5000 + ref_audio_url (required) + ref_text ('' = auto ASR)
  // + model_type 'F5-TTS'|'E2-TTS' + remove_silence (true). No seed on the wire.
  'f5-tts-api': {
    id: 'f5-tts-api',
    label: 'F5-TTS',
    kind: 'voice',
    provider: 'fal',
    maxDurationSec: 300,
    voiceClone: true,
    seed: false,
    maxTextChars: 5000,
    endpoint: 'fal-ai/f5-tts',
    priceNote: '$0.05 / 1000 characters (fal)',
    notes: 'Best long-read prosody · clones from 5-15s of reference · reference transcript optional (auto ASR).'
  },
  // fal schema 2026-08-20: prompt (with @Audio1-3 tags) + audio_urls (≤3 × 30s/10MB) + voice
  // (preset) + image_url (EXCLUDES audio refs) + output_format/sample_rate/speed/volume/pitch +
  // multilingual. $0.1875/min. Dialogue + foley + music in ONE pass — the scene-track engine.
  'seed-audio-1': {
    id: 'seed-audio-1',
    label: 'Seed Audio 1.0',
    kind: 'voice',
    provider: 'fal',
    maxDurationSec: 120,
    voiceDesign: true,
    voiceClone: true,
    foley: true,
    seed: false,
    endpoint: 'bytedance/seed-audio-1.0',
    priceNote: '$0.1875 / minute (fal)',
    notes: 'Designs a voice from words AND renders whole scene tracks — dialogue + ambience + foley in one pass. EN/ZH first-class; refs bind as @Audio1-3 in the prompt (an image ref excludes audio refs).'
  },
  // list 18 — Gemini 3.8 TTS on his Google key (the one Watch uses). Read 2026-09-30 off
  // ai.google.dev (speech-generation, voice-design, voice-replication, pricing): POST
  // /v1beta/interactions with response_format audio → a 24 kHz WAV; 30 prebuilt voices, or a voice
  // DESIGNED from words (POST /v1beta/voices, type prompted → a persistent voice_… id, 200 a
  // project); a style line steers delivery without being read; tags like <sigh> ride in the text.
  // Copying a sample is OUT: Google wants a spoken consent clip from the real speaker.
  'gemini-38-tts': {
    id: 'gemini-38-tts',
    label: 'Gemini 3.8 Flash TTS',
    kind: 'voice',
    provider: 'google',
    maxDurationSec: 600,
    voiceDesign: true,
    styleLine: true,
    voices: GEMINI_VOICES,
    seed: false,
    endpoint: 'gemini-3.8-flash-tts',
    priceNote: 'about $0.00225 per 10 s of speech (Google, until Dec 31 2026, then double)',
    notes: 'Google’s studio-grade speech on your Google key: a voice designed from your description, or one of its 30 voices. 130+ languages. A style line steers the delivery; tags like <sigh> or <short pause> in the text are acted, not read.'
  },
  'gemini-38-lite-tts': {
    id: 'gemini-38-lite-tts',
    label: 'Gemini 3.8 Flash-Lite TTS',
    kind: 'voice',
    provider: 'google',
    maxDurationSec: 600,
    voiceDesign: true,
    styleLine: true,
    voices: GEMINI_VOICES,
    seed: false,
    endpoint: 'gemini-3.8-flash-lite-tts',
    priceNote: 'about $0.0015 per 10 s of speech (Google, until Dec 31 2026, then double)',
    notes: 'The faster, cheaper Gemini 3.8 voice — the same voices and style line, 100+ languages. Flash is the quality pick.'
  },
  // list 19 — Eleven v4 on his ElevenLabs key. Read 2026-09-30 off elevenlabs.io/docs: POST
  // /v1/text-to-speech/{voice_id} (model_id eleven_v4, ≤10,000 characters) → the audio bytes. It
  // speaks in a voice of HIS account: one he picks, one designed from the description
  // (/v1/text-to-voice/design → /v1/text-to-voice), or an instant clone of the sample
  // (/v1/voices/add). A designed or cloned voice is saved in his ElevenLabs account under the
  // voice's name and re-used by later takes.
  'eleven-v4': {
    id: 'eleven-v4',
    label: 'Eleven v4',
    kind: 'voice',
    provider: 'elevenlabs',
    maxDurationSec: 600,
    voiceDesign: true,
    voiceClone: true,
    voiceLibrary: true,
    seed: true,
    maxTextChars: 10000,
    endpoint: 'eleven_v4',
    priceNote: 'ElevenLabs credits (your plan) — no $ estimate here',
    notes: 'ElevenLabs’ newest, most expressive speech on your ElevenLabs key: a voice from your account, one designed from the description, or a clone of the sample. 90+ languages. A designed or cloned voice is saved in your ElevenLabs account.'
  },
  'eleven-v4-turbo': {
    id: 'eleven-v4-turbo',
    label: 'Eleven v4 Turbo',
    kind: 'voice',
    provider: 'elevenlabs',
    maxDurationSec: 600,
    voiceDesign: true,
    voiceClone: true,
    voiceLibrary: true,
    seed: true,
    maxTextChars: 10000,
    endpoint: 'eleven_v4_turbo',
    priceNote: 'ElevenLabs credits (your plan) — no $ estimate here',
    notes: 'The fast Eleven v4 — the same voices, half the credits. v4 is the quality pick.'
  },
  // local rows — the Models card installs them (localModels.ts); render paths land with the
  // LOCAL-MODELS runtime. Present so recipes can already name them; pickers gate with reason.
  'chatterbox-local': {
    id: 'chatterbox-local',
    label: 'Chatterbox (local)',
    kind: 'voice',
    provider: 'local',
    maxDurationSec: 300,
    voiceClone: true,
    seed: true,
    localRuntime: 'chatterbox',
    priceNote: 'local render — free, your GPU pays in time',
    notes: 'The API engine’s local twin (MIT, ~8GB VRAM comfortable). Installs from the Models card; renders land with the local runtime.'
  },
  'f5-tts-local': {
    id: 'f5-tts-local',
    label: 'F5-TTS (local)',
    kind: 'voice',
    provider: 'local',
    maxDurationSec: 300,
    voiceClone: true,
    seed: false,
    localRuntime: 'f5-tts',
    priceNote: 'local render — free, your GPU pays in time',
    notes: 'Local long-read prosody (~3GB VRAM). Installs from the Models card; renders land with the local runtime.'
  }
}
Object.assign(AUDIO_MODELS, VOICE_MODELS)

export const DEFAULT_VOICE_ENGINE = 'chatterbox-api'
export const DEFAULT_SCORE_ENGINE = 'minimax-music-3'

export function audioModelFor(engine: string | undefined): AudioModelDescriptor {
  return AUDIO_MODELS[engine ?? DEFAULT_SCORE_ENGINE] ?? AUDIO_MODELS[DEFAULT_SCORE_ENGINE]
}

export function audioModelsOf(kind: AudioEngineKind): AudioModelDescriptor[] {
  return Object.values(AUDIO_MODELS).filter((m) => m.kind === kind && !m.hidden)
}
