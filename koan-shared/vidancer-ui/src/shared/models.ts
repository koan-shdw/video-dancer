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
  resolutions?: string[] // the edit door's own output-size dial (Omni 1.1); priced by the model's pricePerSec
  promptHint: string // model-specific guidance shown under the edit prompt
  // list 13: this door EXTENDS the video (adds to its end) instead of changing it. `addsSec` = the
  // longest stretch one call adds, `maxTotalSec` = how long a video can grow
  extend?: { addsSec: number; maxTotalSec: number }
}

export interface ModelDescriptor {
  id: EngineId
  label: string
  provider?: 'fal' | 'higgsfield' | 'modelark' | 'astria' | 'venice' | 'google' | 'local' | 'mcp' // which platform runs this engine (absent = fal, the original; 'local' = the in-app runtime; 'mcp' = a Bridge login)
  mcpService?: 'higgsfield' | 'magnific' | 'artlist' | 'runway' | 'pika' | 'elevenlabs' | 'bridge' // provider 'mcp' only — which Bridge account runs it ('bridge' = the auto router picks)
  hidden?: boolean // true = not offered in pickers (kept in the registry so old takes still resolve)
  modes: Array<'ref2v' | 'i2v'>
  endFrame: boolean // supports a separate end/last keyframe (i2v)
  maxRefImages: number // reference-to-video image refs (0 = mode unsupported)
  // Seedance multimodal refs (fal: video_urls/audio_urls, bound in-prompt as @video1/@audio1 by
  // POSITION). fal constraints (2.0 AND 2.5 schemas): ≤3 videos 2-15s combined <50MB total;
  // ≤3 audios ≤15s combined (audio requires ≥1 image/video ref); ≤12 ref files across modalities.
  maxRefVideos: number // 0 = no video references
  // list 13: a model whose video refs are capped EACH (Omni 1.1: 3 s a clip) instead of Seedance's
  // 2-15 s combined, and how @videoN is written on its wire (Gemini: <VIDEO_REF_n>, 0-based)
  refVideoEachMaxSec?: number
  refVideoTagPrompt?: 'VIDEO_REF'
  maxRefAudios: number // 0 = no audio references
  characterRefs: number // Sora-style character identities (0 = none)
  durations: string[] // allowed values for the duration select
  resolutions: string[]
  aspectRatios: string[]
  audioToggle: boolean // false = audio is fixed (Sora: always on)
  seed: boolean
  endpoints: Partial<Record<'ref2v' | 'i2v' | 't2v', string>> // fal slugs per mode ('t2v' = ref2v with zero refs routes here)
  pricePerSec: Record<string, number> // $/second by resolution, for the cost estimate
  refTagPrompt?: 'IMAGE_REF' | 'ImageN' | '[ImageN]' | 'imageN' | 'PictureN' // prompt binds refs positionally — @mentions rewritten at render: Gemini's <IMAGE_REF_n>, LTX MSR's "Image N", fal 2.5's [Image1], every other 2.5 door's @image1, MiniMax H3's <Picture n>
  promptStyle?: 'yaml' | 'natural' | 'prose' | 'seedance25' // how structured fields are emitted (default 'yaml' — Seedance 2 MD; 'prose' = LTX one paragraph; 'seedance25' = the bracketed-section skeleton, SEEDANCE25-PROSE-SPEC-2026-09-08)
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
      // t2v verified live on fal 2026-09-01 (480p|720p only) — zero-ref ref2v routes here,
      // his no-ref ruling; nothing else about this engine changed
      t2v: 'bytedance/seedance-2.0/text-to-video',
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
    promptStyle: 'seedance25', // bracketed-section prose (spec 2026-09-08)
    refTagPrompt: '[ImageN]', // fal's documented 2.5 token: @title → [Image1] at render
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
    // Per-second figures below are fal's OWN page approximations (read 2026-08-31) — the older
    // 0.208/0.462 pins were computed at a narrower 480p frame and ran stale-low.
    pricePerSec: { '480p': 0.2205, '720p': 0.473 },
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
  // Seedance 2.0 via the HIGGSFIELD MCP (Bridge login, BRIDGE-SPEC-2026-09-01) — the consumer
  // platform their key-API never served (see the hidden seedance2hf corpse above). Bills the
  // user's Higgsfield plan credits through their OAuth login; no key. Caps from their MCP page
  // (videos ≤15s) + the live tool capture; UNPROVEN until the first render probe: exact model id,
  // resolution clamping, audio behavior. use_unlim pinned false in the adapter.
  seedance2hfmcp: {
    id: 'seedance2hfmcp',
    label: 'Seedance 2 (Higgsfield Bridge)', // "Bridge" in the label — plain "(Higgsfield)" reads as the key API lane (user catch 2026-09-01)
    provider: 'mcp',
    mcpService: 'higgsfield',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: false, // no proven audio switch in their generate_video schema — fixed until probed
    seed: false,
    endpoints: {
      ref2v: 'seedance_2_0', // Higgsfield MCP model id — probe-confirm on first render
      i2v: 'seedance_2_0'
    },
    pricePerSec: {}, // credits-billed — no honest $/s exists; the queue row shows no estimate
    notes: 'Seedance 2 via your Higgsfield login (Bridge) — bills Higgsfield plan credits, no $ estimate. First render is the probe.'
  },
  // Seedance 2.5 via the HIGGSFIELD MCP — same lane as above; 2.5 is their default t2v model
  // (named in the generate_video tool description, live capture 2026-09-01).
  seedance25hfmcp: {
    id: 'seedance25hfmcp',
    label: 'Seedance 2.5 (Higgsfield Bridge)',
    promptStyle: 'seedance25',
    refTagPrompt: 'imageN', // @title → @image1 (the official 2.5 deck's token)
    provider: 'mcp',
    mcpService: 'higgsfield',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: false, // no proven audio switch in their generate_video schema — fixed until probed
    seed: false,
    endpoints: {
      ref2v: 'seedance_2_5', // named verbatim in their tool description — probe-confirm anyway
      i2v: 'seedance_2_5'
    },
    pricePerSec: {},
    notes: 'Seedance 2.5 via your Higgsfield login (Bridge) — bills Higgsfield plan credits, no $ estimate. First render is the probe.'
  },
  // Seedance 2.0 via the RUNWAY MCP (Bridge login) — schemas read off the LIVE tool capture
  // 2026-09-01 (the one provider that publishes full schemas): promptText/duration/ratio/
  // resolution/generateAudio, refs = startFrame/endFrame (i2v) + referenceImages (ref2v).
  // Their referenceVideo is an EDIT source (v2v restyle), NOT a Seedance @video ref — video/audio
  // refs stay 0. Prompts TRUNCATE at 3500 chars on this model (the queue row warns; 2.5 takes
  // 15000). Seedance = paid-tier there: a free workspace fails with a plain paid-plan error.
  seedance2runway: {
    id: 'seedance2runway',
    label: 'Seedance 2 (Runway Bridge)',
    provider: 'mcp',
    mcpService: 'runway',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 0, // their video lane is v2v editing, not references
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p'], // 4k exists at ~4x cost — his call to add later
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      ref2v: 'seedance-2',
      i2v: 'seedance-2'
    },
    pricePerSec: {}, // credits-billed — no honest $/s
    notes: 'Seedance 2 via your Runway login (Bridge) — bills Runway credits, needs a paid Runway plan. Long prompts truncate at 3500 chars (2.5 takes 15000).'
  },
  // Seedance 2.5 via the RUNWAY MCP — same lane; 4-30s, 1080p max, 15000-char prompts.
  seedance25runway: {
    id: 'seedance25runway',
    label: 'Seedance 2.5 (Runway Bridge)',
    promptStyle: 'seedance25',
    refTagPrompt: 'imageN',
    provider: 'mcp',
    mcpService: 'runway',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      ref2v: 'seedance-2.5',
      i2v: 'seedance-2.5'
    },
    pricePerSec: {},
    notes: 'Seedance 2.5 via your Runway login (Bridge) — bills Runway credits, needs a paid Runway plan. Their docs note 2.5 is account-gated: if it refuses, use Seedance 2.'
  },
  // Seedance via the MAGNIFIC MCP (Bridge login) — schemas from the live capture 2026-09-01:
  // slug resolved LIVE from their catalog per session (endpoints hold the version key), duration
  // required, refs via references[] (image/video/audio — start frames are exclusive with refs so
  // i2v uses keyframes instead). PAID Magnific plan required (field-proven gate). Audio behavior
  // unprobed — toggle stays off until the account-holder's first render says otherwise.
  seedance2mag: {
    id: 'seedance2mag',
    label: 'Seedance 2 (Magnific Bridge)',
    provider: 'mcp',
    mcpService: 'magnific',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: false,
    seed: false,
    endpoints: { ref2v: '2.0', i2v: '2.0' }, // version keys — the adapter resolves the live slug
    pricePerSec: {},
    notes: 'Seedance 2 via your Magnific login (Bridge) — bills Magnific credits, needs a paid Magnific plan.'
  },
  seedance25mag: {
    id: 'seedance25mag',
    label: 'Seedance 2.5 (Magnific Bridge)',
    promptStyle: 'seedance25',
    refTagPrompt: 'imageN',
    provider: 'mcp',
    mcpService: 'magnific',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: false,
    seed: false,
    endpoints: { ref2v: '2.5', i2v: '2.5' },
    pricePerSec: {},
    notes: 'Seedance 2.5 via your Magnific login (Bridge) — bills Magnific credits, needs a paid Magnific plan.'
  },
  // Seedance via the PIKA MCP (Bridge login) — full schemas in the live capture 2026-09-01:
  // provider 'seedance', t2v + i2v (start/end), seed SUPPORTED, sound toggle real, 4-15s,
  // 480p/720p/1080p. Multi-ref generation is their separate generate_reference_video tool —
  // a later lane, so ref slots stay 0 here (zero-ref ref2v = plain t2v, the house grammar).
  seedance2pika: {
    id: 'seedance2pika',
    label: 'Seedance 2 (Pika Bridge)',
    provider: 'mcp',
    mcpService: 'pika',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    // refs ride their generate_reference_video sibling (schema captured 2026-09-01):
    // ≤9 images / ≤3 videos / ≤3 audio, combined ≤12 — the fal Seedance trio shape
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: true,
    endpoints: { ref2v: 'seedance', i2v: 'seedance' },
    pricePerSec: {},
    notes: 'Seedance 2 via your Pika login (Bridge) — bills Pika credits. Refs bind by position (@Image1/@Video1/@Audio1 in their grammar).'
  },
  // Bridge AUTO rows (spec §3.3) — you pick the model, the router picks the ACCOUNT among your
  // logged-in services (most credits first, unknown last; money refusals fall through once per
  // account, named in the queue). Caps are the common denominator of the lanes it can pick.
  seedance2bridge: {
    id: 'seedance2bridge',
    label: 'Seedance 2 (Bridge)',
    provider: 'mcp',
    mcpService: 'bridge',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9, // ref renders only route to lanes that carry refs (router filters)
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: { ref2v: 'auto', i2v: 'auto' },
    pricePerSec: {},
    notes: 'Seedance 2 on whichever of your logged-in Bridge accounts has the most credit — the queue names the one it picked.'
  },
  seedance25bridge: {
    id: 'seedance25bridge',
    label: 'Seedance 2.5 (Bridge)',
    promptStyle: 'seedance25',
    refTagPrompt: 'imageN',
    provider: 'mcp',
    mcpService: 'bridge',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: { ref2v: 'auto', i2v: 'auto' },
    pricePerSec: {},
    notes: 'Seedance 2.5 on whichever of your logged-in Bridge accounts has the most credit — the queue names the one it picked.'
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
    // official 2.0 token rate as relayed on OpenRouter ($7.00/M tokens, read 2026-08-31; BytePlus's
    // own USD sheet not directly read — user-approved fill). tokens/s = h·w·24/1024, 16:9 assumed.
    pricePerSec: { '480p': 0.068, '720p': 0.151, '1080p': 0.34, '4k': 1.36 },
    notes: 'Seedance 2 direct from ByteDance: needs a ModelArk key (Settings) · refs must NOT contain real human faces (their policy) · token-billed — the $/s estimate assumes 16:9.'
  },
  // Seedance 2.5 served DIRECT by ByteDance (ModelArk) — model id + caps read off the live model
  // list 2026-08-08 (docs.byteplus.com/en/docs/ModelArk/1330310): dreamina-seedance-2-5-260628,
  // 480p/720p @24fps, duration 4-30s, mp4/mov out, full multimodal-reference suite. Same
  // content[] API as 2.0, so the adapter needs nothing new — video refs stay PARKED at 0 for the
  // same public-URL reason, and the no-real-faces policy still applies.
  seedance25ark: {
    id: 'seedance25ark',
    label: 'Seedance 2.5 (ModelArk)',
    promptStyle: 'seedance25',
    refTagPrompt: 'imageN',
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
    // official 2.5 rate: $10.70/M tokens (BytePlus's published rate, cross-checked on OpenRouter, read 2026-08-31).
    // tokens/s = h·w·24/1024, 16:9 assumed → 480p ≈ $0.104, 720p ≈ $0.231 — HALF fal's price.
    pricePerSec: { '480p': 0.104, '720p': 0.231 },
    notes: 'Seedance 2.5 direct from ByteDance: native 30s · needs a ModelArk key (Settings) · refs must NOT contain real human faces (their policy) · token-billed — the $/s estimate assumes 16:9.'
  },
  // Seedance served by VENICE (api.venice.ai) — list 14, docs/VENICE-SPEC-2026-09-08.md, his four
  // answers in (2 + 2.5 only · bitrate high · the fast twin stays a visible row). Facts re-read
  // 2026-09-30 (docs.venice.ai Seedance guide): model ids below, 2.0 = 4-15s up to 4k (fast: 480p /
  // 720p), 2.5 = 4-30s up to 1080p; refs 9 img / 3 vid / 3 aud (2.5 takes more — the app's slots are
  // the same trio everywhere); media rides inline as data URLs (35 MB a request); NO seed; the i2v
  // models take no aspect (the frame decides); prices are variable — the adapter asks Venice for a
  // quote before every submit and that number is what the ledger records. Person-bearing media is
  // refused on their public API. @title → @imageN here, → <Image N> on the wire (the adapter).
  // NOT PROBED: built from the docs; his first render on a Venice key is the probe.
  seedance2venice: {
    id: 'seedance2venice',
    label: 'Seedance 2 (Venice)',
    provider: 'venice',
    refTagPrompt: 'imageN',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'], // no 'auto' — on Venice that is an edit's "match the source"
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      t2v: 'seedance-2-0-text-to-video-basic', // zero-ref ref2v routes here (their R2V model needs a ref)
      ref2v: 'seedance-2-0-reference-to-video-basic',
      i2v: 'seedance-2-0-image-to-video-basic'
    },
    pricePerSec: {}, // variable — Venice's own quote, asked before every submit, is the number
    notes: 'Seedance 2 via Venice: needs a Venice key (Settings) · refs must NOT contain people (their public-API policy) · no seed · the cost is Venice’s own quote, shown on the queue row before it submits.'
  },
  seedance2venicefast: {
    id: 'seedance2venicefast',
    label: 'Seedance 2 (Venice fast)',
    provider: 'venice',
    refTagPrompt: 'imageN',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    resolutions: ['480p', '720p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      t2v: 'seedance-2-0-fast-text-to-video-basic',
      ref2v: 'seedance-2-0-fast-reference-to-video-basic',
      i2v: 'seedance-2-0-fast-image-to-video-basic'
    },
    pricePerSec: {},
    notes: 'Seedance 2 via Venice, the fast tier: quicker and lower-fidelity, 480p / 720p only — the plain Venice row is the quality pick. Same key, same no-people rule, no seed.'
  },
  seedance25venice: {
    id: 'seedance25venice',
    label: 'Seedance 2.5 (Venice)',
    promptStyle: 'seedance25',
    refTagPrompt: 'imageN',
    provider: 'venice',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    durations: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    audioToggle: true,
    seed: false,
    endpoints: {
      t2v: 'seedance-2-5-text-to-video-basic',
      ref2v: 'seedance-2-5-reference-to-video-basic',
      i2v: 'seedance-2-5-image-to-video-basic'
    },
    pricePerSec: {},
    notes: 'Seedance 2.5 via Venice: native 30s, up to 1080p · needs a Venice key (Settings) · refs must NOT contain people (their public-API policy) · no seed · the cost is Venice’s own quote, shown on the queue row before it submits.'
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
    // list 12: OpenAI shut Sora 2 down on 2026-09-24 — out of the pickers; kept so old takes and
    // clips that still pin it resolve
    hidden: true,
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
    notes: 'Sora 2 was shut down by OpenAI on 2026-09-24 — a render fails now. Pick another model; the takes you have still play.'
  },
  // list 13: Gemini Omni Flash 1.1 — the newest Omni, listed first (newest = the default). Read
  // 2026-09-30 from fal's four v1.1 pages: the 1.0 inputs plus a resolution dial (360p / 720p /
  // 1080p / 4k) on every mode, an END frame on image-to-video, and a resolution on /edit. INT
  // duration 3-10s, 16:9 | 9:16, audio native + always on, no seed. Billed per output second by
  // resolution ($0.03 / $0.10 / $0.15 / $0.30), edits too. Its reference-to-video also takes up to
  // three ≤3s reference videos — NOT wired (an engine that takes video refs is a re-gen engine to
  // the Video Editor, and 1.1 is a true edit there). Extending a clip to 40s is Google's own API;
  // fal has no extend door. The /edit page states no input cap: 1.0's probed 10s holds until a
  // live edit says otherwise.
  omniflash11: {
    id: 'omniflash11',
    label: 'Gemini Omni Flash 1.1',
    modes: ['ref2v', 'i2v'],
    endFrame: true,
    maxRefImages: 10,
    // list 13: up to three video refs of 3 s each (fal's v1.1 reference-to-video schema, read 09-30:
    // reference_video_urls maxItems 3, "Each video must be at most three seconds long")
    maxRefVideos: 3,
    refVideoEachMaxSec: 3,
    refVideoTagPrompt: 'VIDEO_REF',
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['3', '4', '5', '6', '7', '8', '9', '10'],
    resolutions: ['360p', '720p', '1080p', '4k'],
    aspectRatios: ['16:9', '9:16'],
    audioToggle: false, // native audio, always on — say "no dialogue" / "calm music" in the prompt
    seed: false,
    endpoints: {
      t2v: 'google/gemini-omni-flash/v1.1/text-to-video',
      ref2v: 'google/gemini-omni-flash/v1.1/reference-to-video',
      i2v: 'google/gemini-omni-flash/v1.1/image-to-video'
    },
    pricePerSec: { '360p': 0.03, '720p': 0.1, '1080p': 0.15, '4k': 0.3 },
    refTagPrompt: 'IMAGE_REF',
    promptStyle: 'natural',
    v2v: {
      endpoint: 'google/gemini-omni-flash/v1.1/edit',
      maxInSec: 10,
      minInSec: 1,
      pricePerSecOut: 0.1,
      pricePerSecIn: 0,
      resolutions: ['360p', '720p', '1080p', '4k'],
      promptHint: 'Simple instructions work best. End with "Keep everything else the same." Pick the output size above.'
    },
    notes: 'Omni Flash 1.1: 360p to 4K, 3-10s, an end frame on image-to-video, up to 3 video refs of 3s each, audio always on (steer it in the prompt), no seed.'
  },
  // list 13: EXTENDING a video is Google's own door — fal has none. Gemini API, model
  // gemini-omni-1.1-flash on the Google key (ai.google.dev/gemini-api/docs/omni, read 2026-09-30):
  // "The model analyzes the input video to generate a 3–10 second continuation"; "you can extend
  // videos by 10s, up to a total length of 40s"; an uploaded input is 10 s at most, a video that
  // came from an earlier extend continues from its session instead. No length dial: the prompt
  // steers it. Price: $17.50 per 1M output tokens at 5,792 tokens a second of 720p ≈ $0.10/s, input
  // $1.50 per 1M (their pricing page, same day; no free tier). The Video Editor only.
  omniextend: {
    id: 'omniextend',
    label: 'Gemini Omni Flash 1.1 (Google)',
    provider: 'google',
    modes: [],
    endFrame: false,
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: [],
    resolutions: [],
    aspectRatios: [],
    audioToggle: false,
    seed: false,
    endpoints: {},
    pricePerSec: {},
    v2v: {
      endpoint: 'gemini-omni-1.1-flash',
      maxInSec: 10,
      minInSec: 1,
      pricePerSecOut: 0.1,
      pricePerSecIn: 0.0087,
      extend: { addsSec: 10, maxTotalSec: 40 },
      promptHint: 'Say what happens next. It adds 3 to 10 seconds to the end (the prompt steers how long); the last frames may shift to join smoothly. Runs on your Google key.'
    },
    notes: 'Omni Flash 1.1 extend: adds 3-10s to the end of a video, up to 40s in all. A video of 10s or less, or one this made.'
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
    refTagPrompt: 'IMAGE_REF',
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
  },
  // Kling O3 Edit (fal) — the second v2v engine, a registry entry as line 12 promised (todo 45,
  // 2026-09-23). Schema read from fal's OpenAPI that day: prompt (≤2500 chars, the source is
  // @Video1) + video_url (.mp4/.mov, 3-15s, 720-3840px, ≤200MB); keep_audio defaults true;
  // image_urls (≤4, @Image1…) and elements exist on the door, but the app's edit lane sends
  // prompt + video only (same as Omni). Pro = the highest-quality tier = the default (law);
  // standard is fal-ai/kling-video/o3/standard/video-to-video/edit at $0.126/s if a dial is
  // ever asked for. Edit-only: no ref2v / i2v modes, so it stays out of the Clip Gen picker.
  klingo3: {
    id: 'klingo3',
    label: 'Kling O3 Edit',
    modes: [],
    endFrame: false,
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: [],
    resolutions: [],
    aspectRatios: [],
    audioToggle: false,
    seed: false,
    endpoints: {},
    pricePerSec: {},
    v2v: {
      endpoint: 'fal-ai/kling-video/o3/pro/video-to-video/edit',
      maxInSec: 15,
      minInSec: 3,
      pricePerSecOut: 0.168,
      pricePerSecIn: 0,
      promptHint: 'Say what changes and call the source @Video1 ("@Video1, but it is snowing"). Keeps the original audio. Source 3-15s, mp4 or mov.'
    },
    notes: 'Kling O3 Edit: prompt + the source video, 3-15s, audio kept, no seed, no refs on this lane.'
  },
  // LTX 2.5 — LOCAL engine (Lightricks open weights, docs/LOCAL-MODELS-PLAN.md). HIDDEN v18
  // placeholder: the EngineId exists so the schema bump and take records can reference it, but
  // the entry stays out of every picker until the local runtime + worker land (plan phase 5).
  // EVERY cap below is PROVISIONAL — pinned against the shipped ltx-pipelines package at phase 5.
  ltx25: {
    id: 'ltx25',
    label: 'LTX 2.5 (local)',
    provider: 'local',
    // visible since phase 3 (2026-08-25): the render path exists; the RENDER button gates
    // with the reason until a distilled size is installed (gating law: reason, never hide)
    modes: ['ref2v', 'i2v'], // zero-ref ref2v = t2v grammar (same convention as fal engines)
    endFrame: false, // FLF2V is real (spec §1) but its graph is unprobed — flips on when tested
    maxRefImages: 5, // MSR: 4 subject slots + 1 background — trained into the LoRA, hard ceiling (§9.2)
    refTagPrompt: 'ImageN', // @shotgun_cop → "Image 1" at render — the MSR LoRA's trained label grammar
    maxRefVideos: 0,
    maxRefAudios: 0,
    characterRefs: 0,
    durations: ['4', '6', '8', '10'],
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'], // spec §4 — every label maps to a /32 ladder size
    audioToggle: true, // LTX 2.5 generates audio+video in one pass
    seed: true,
    promptStyle: 'prose', // official guide: ONE flowing paragraph (docs.ltx.io)
    endpoints: {}, // local engine — no fal slugs; the local adapter routes by provider
    pricePerSec: {}, // local render — no honest $/s exists; the estimate shows "local render" instead (cost-honesty law)
    notes: 'LTX 2.5 renders locally on your GPU with sound — download a size in the Models card. Refs and LoRAs work; loras install in the Models card shelf.'
  },
  // MiniMax H3 (local) — MINIMAX-H3-LOCAL-SPEC-2026-09-22 §3: the same headless engine as LTX,
  // his dual-sampling workflow as the graph. Refs 9 pictures + 3 videos + 3 voices, sound in the
  // same pass, 24 fps, 4–15 s, 768p class (HF card). Its dials (encoder, upscale, kernels, the
  // lora set) live on the card and ride PromptData.
  h3local: {
    id: 'h3local',
    label: 'MiniMax H3 (local)',
    provider: 'local',
    modes: ['ref2v'], // i2v has a core node (MiniMaxH3ImageToVideo) — its graph lands after his ref2v test
    endFrame: false,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    characterRefs: 0,
    refTagPrompt: 'PictureN', // @title → <Picture n> — the model's own reference grammar
    durations: ['4', '6', '8', '10', '12', '15'],
    resolutions: ['480p', '720p'], // 480p = 0.5 MP (his file), 720p = 1.0 MP (the 1344×768 class)
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9'],
    audioToggle: true,
    seed: true,
    promptStyle: 'prose',
    endpoints: {},
    pricePerSec: {},
    notes: 'MiniMax H3 on your GPU, sound in the same pass — download a size and an encoder in the Models card. Refs: pictures, videos, voices. Loras from the side panel.'
  }
}

// the H3 lora set defaults — his workflow's weights (turbo ×1 · lms ×0.5 · realism ×1), all on
export const H3_SET_DEFAULT: import('./types').H3LoraSet = { turbo: { on: true, w: 1 }, lms: { on: true, w: 0.5 }, realism: { on: true, w: 1 } }

export const DEFAULT_ENGINE: EngineId = 'seedance2'

export function modelFor(engine: EngineId | undefined): ModelDescriptor {
  return MODELS[engine ?? DEFAULT_ENGINE] ?? MODELS[DEFAULT_ENGINE]
}

// TRUST GUARD (his law 2026-09-01, after a "Runway" pick silently rendered + billed on fal):
// an engine id this build doesn't know means the app halves are OUT OF SYNC (the picker
// hot-reloads, the engine core only loads on restart). The render REFUSES — it never falls
// back to another lane, because a fallback spends someone's money on the wrong platform.
export function unknownEngineError(engine: string | undefined): string | null {
  if (!engine || engine in MODELS) return null
  return `this build doesn't know the engine "${engine}" yet — restart Video Dancer and render again. Nothing was rendered, nothing was spent.`
}

// keep a stored option selectable even when the active engine doesn't list it (store-everything
// law: switching engines must never lose or hide what the user picked)
export function withCurrent(options: string[], current: string): string[] {
  return options.includes(current) ? options : [current, ...options]
}

// ---- Claude Code version gate (2026-09-29, his screenshot): a model newer than the installed
// CLI comes back as the CLI's reply "API Error: 400 Claude Code 2.1.220 does not support this
// model; version 2.1.280 or newer is required". Main turns it into OUR line; the renderer reads
// OUR line back to show the "update claude code" button. One place for both sides. ----
export const CLI_TOO_OLD_RE = /(\d+\.\d+\.\d+)\S* does not support this model[;,.]?\s*version (\d+\.\d+\.\d+)\S* or newer is required/i
export const cliTooOldText = (have: string, need: string): string => `Claude Code ${have} is too old for this model. It needs ${need} or newer.`
export const CLI_TOO_OLD_OURS = /^Claude Code (\d+\.\d+\.\d+) is too old for this model\. It needs (\d+\.\d+\.\d+) or newer\./
// true when version a is older than b ("2.1.220 (Claude Code)" and "2.1.280" both parse)
export function cliVersionLess(a: string, b: string): boolean {
  const pa = a.match(/(\d+)\.(\d+)\.(\d+)/)
  const pb = b.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!pa || !pb) return false
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i])
  return false
}

// ---- an expired Claude login (list 38): main answers with this line; the renderer reads it back
// to offer "sign in to claude". One place for both sides, like the version gate above. ----
export const CLAUDE_LOGIN_EXPIRED = 'Your Claude login has expired — sign in to Claude Code again, then retry.'

// ---- the Co-Director's model lists live in main, newest of each line first (list 25). The
// renderer reads them: a label up to " — " is the model's name, and the Director's Room chip
// flips between the newest Opus and the newest Sonnet. ----
type ModelRow = { id: string; label: string }

// ---- how hard the Co-Director thinks (list 26): Anthropic's effort levels. The same five on
// every Claude in the lists but Haiku, which takes none (their effort page, read 2026-09-30).
// No level picked = the model's own (high; medium on Opus 5.5). ----
export const CODIR_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type CodirEffort = (typeof CODIR_EFFORTS)[number]
export const effortFor = (model: string, effort?: string): CodirEffort | undefined =>
  !model.includes('haiku') && (CODIR_EFFORTS as readonly string[]).includes(effort ?? '') ? (effort as CodirEffort) : undefined
export const modelShortName = (list: ModelRow[], id: string): string => (list.find((m) => m.id === id)?.label.split(' — ')[0] ?? id).toUpperCase()
export const flipOpusSonnet = (list: ModelRow[], current: string | null): string | undefined => list.find((m) => m.id.includes(current?.includes('sonnet') ? 'opus' : 'sonnet'))?.id
