# Voices card — consistent character voices (build plan)

Restore point: git `6c4d1bc`. Planning session 2026-08-19. Work phase-by-phase; typecheck +
build gate after each phase. Schema fields land in the coordinated v18 bump (LOCAL-MODELS-PLAN).

BUILD ORDER (2026-08-19): codir sub-call plumbing (pre-step) → score → VOICES (this) →
local models → co-director fix → timeline fix.

## The goal
Seedance 2/2.5 accept audio refs (@audio slots exist in the registry: maxRefAudios=3). One
voice per character across generations: design or clone a voice once, bind it to the char
sheet, and every clip that links the sheet carries the voice automatically.

## Locked scope
- Voices card with the RESULTS-TREE grammar, same as the Image Editor (`EditSession` pattern):
  every generation is a node, branch from any node, refine via chat ("deeper, less rasp"),
  nothing is real until KEPT. Drag the keeper into the Library as a voice asset.
- Both creation modes: describe a voice in text (voice-design engines) or clone from sample
  audio (Library audio or file drop).
- Test-line reads per node: type a line, every node can re-read it for comparison.
- Char sheet gains a voice ref (`voiceId`). Linking a sheet into a clip auto-fills an @audio
  slot with the voice sample and role-binds it in the prompt: "@audio1 is CHARACTER's voice."
  (Same UI-parity move as the sheet image joining refs in `set_clip_fields`.)

## Engines
API:
1. Seed Audio 1.0 (fal `bytedance/seed-audio-1.0`) — PRIMARY, re-verified first-hand
   2026-08-19: dialogue + music + foley/ambience in one pass, multi-character dialogue with
   distinct voices in a single generation, zero-shot cloning, up to THREE 30s reference clips
   bound as @Audio1-3 and reusable across a production. Sounds natural where ElevenLabs has
   the "AI studio" tone. LANGUAGE LIMIT: English + Chinese only today (flag below).
2. ElevenLabs Voice Design — secondary, describe-a-voice, separate key (Settings), premium.
Local (ride the LOCAL-MODELS-PLAN runtime; rows in the Models card):
3. Chatterbox (Resemble, MIT) — PRIMARY. Zero-shot cloning from ~10s, 23 languages
   (Multilingual variant), production-grade (preferred over ElevenLabs 63.75% in blind tests);
   variants: 0.5B original / Multilingual / Turbo 350M; ~8GB VRAM for comfortable speed.
   (Verified 2026-08-19: github.com/resemble-ai/chatterbox.)
4. F5-TTS — secondary. Best prosody on long reads, clones from 5-15s, ~3GB VRAM.

## Workflow baked into the card (from the studied tutorial video, transcript-verified)
1. Image → voice prompt: the char sheet image goes to the Co-Director, which writes the voice
   description. ONE BUTTON on the sheet: "describe voice" (a codir sub-call, lands in the
   Voices card prompt box).
2. Voice tree: generate candidates, branch, refine, keep. The keeper's ~30s sample becomes the
   sheet's voice ref.
3. Per-scene dialogue is generated in Seed Audio FIRST (cheap, controllable, foley included),
   then fed to Seedance as the audio ref. Not re-rolling video generations to fish for audio.

## Two Seedance methods, both in the render panel
1. DIALOGUE MODE (preferred): the audio ref IS the exact dialogue track. THE APP AUTO-MATCHES
   CLIP DURATION TO AUDIO DURATION — the lip-sync rule; the tutorial does it by hand, we
   enforce it. Audit precision: durations are per-engine enums, so the match rounds UP to the
   engine's nearest allowed value (7.3s of audio on Seedance 2 → duration "8"). The select
   shows "matched to @audio1: 8s"; manual override allowed with a warning, mismatch = lint.
2. TIMBRE MODE: the audio ref is voice character only, dialogue prompted in text. UI hint flags
   it as less reliable (tone drift, "studio feel" observed in testing).

## Model decisions
- Voice assets: new Library kind `Project.voices: ProjVoice[]` (v18) — { id, title, file,
  srcPath?, durationSec? }, files under `<project>/voices/`. Not ProjAudio: audio refs and
  music pickers must not fill with voice samples (and voice pickers not with music). Library
  panel shows a voices shelf next to audio.
- Voice tree: `Project.voiceSessions: VoiceSession[]` (v18), the audio sibling of EditSession:
  VoiceNode = { id, parentId, file, engine, prompt (description or refinement), refAudioId?
  (clone source), testLine?, createdAt, keptVoiceId? }. Keep = mint a ProjVoice.
- CharSheet gains `voiceId?` (v18). Render-time: a clip whose characterLinks resolve to a sheet
  with a voice auto-appends an AudioRef pointing at the voice file (respecting the 3-slot cap +
  15s combined fal limit — the sent slice windows to ≤15s; lint says when trimmed), and the
  emit layer appends the role-bind line. Dialogue mode replaces this ref with the scene track.
  Audit-pinned fal constraint (`models.ts` notes): an audio ref requires ≥1 image or video ref
  in the same request — sheet-linked clips carry the sheet image so this normally holds; when
  it doesn't, the voice ref is held back and a lint line says why.
- Engine registry: voice engines join `shared/audioModels.ts` (SCORE-PLAN) with a `voice` kind —
  one registry file for all audio engines, capability-driven UI both cards.
- Seed Audio dialogue renders land as Library audio (they're scene tracks, not voices) ready to
  window into @audio slots.

## Phases
- [ ] 1. v18 voices slices + mutators (sessions, nodes, keep-to-Library, sheet voiceId) +
        `<project>/voices/` plumbing. Gate: typecheck + build + migration test on a copy.
- [ ] 2. Voices card UI: tree canvas (Image Editor grammar), prompt box + refine chat, clone
        source picker, test-line row, keeper drag to Library. Gate: tree round-trips, keep works.
- [ ] 3. API engines: Seed Audio 1.0 (schema read off fal's OpenAPI first, like every engine) +
        ElevenLabs Voice Design (key in Settings). Gate: live design + clone renders as nodes.
- [ ] 4. Sheet integration: voiceId binding, "describe voice" button (codir sub-call), clip
        render auto-@audio + role-bind emit, dialogue-first flow (Seed Audio scene track →
        Seedance ref). Gate: end-to-end — sheet-linked clip renders with the bound voice.
- [ ] 5. Dialogue/timbre modes in the render panel: duration auto-match rule + override warning
        + lint; timbre hint. Gate: mismatched durations impossible without explicit override.
- [ ] 6. Local engines through the runtime (after LOCAL-MODELS-PLAN lands): Chatterbox +
        F5-TTS rows, local render path. Gate: local clone renders a node.
- [ ] 7. Full pass: typecheck, build, migration test, update this file, hand over.

## Honest flags
- Seed Audio 1.0 speaks ENGLISH + CHINESE only today — no Japanese. For JA dialogue the local
  engines carry it (Chatterbox Multilingual: 23 languages, F5-TTS: cloning), which lands only
  after LOCAL-MODELS. Until then JA voice work has no API path in this card.
- Seed Audio 1.0 existence + capabilities now verified first-hand (2026-08-19 audit); the wire
  schema (field names, image-ref shape, pricing) still gets the OpenAPI pass at phase 3.
- The 15s combined audio-ref cap (fal, verified in `models.ts` notes) means a 30s voice sample
  sends windowed; the role-bind still works (timbre carries), flagged in UI so it never
  surprises.
- ElevenLabs is a separate paid key; the card shows it gated-with-reason when the key is absent
  (gating law: disable with reason, never hide).
