# VOICES — production spec (2026-08-20)

Supersedes the build order in `VOICES-PLAN.md` (which stays as the research base — engines,
tutorial workflow, fal constraints all verified there and re-confirmed against the tutorial
transcript re-dumped 2026-08-20). This spec folds in the user's 2026-08-20 decisions:

- **API Chatterbox + API F5-TTS are the MAIN speak engines** (fal-hosted); the local rows in
  the Models card (already present: `localModels.ts` 'chatterbox' / 'f5-tts') are the visible
  local dial for later — highest-quality-default law: hosted by default, local by choice.
- Char sheets carry the voice **file + desc**; Clip Gen imports both; the YAML emit grows a
  voice lane; the Co-Director learns the system.

## What already exists (read 2026-08-20, code is truth)

- **Schema v18 SHIPPED**: `ProjVoice` (types.ts:604), `VoiceNode`/`VoiceSession` (:614/:626),
  `CharSheet.voiceId` (:212), `Project.voices`/`voiceSessions` (:527), delta upserts (:550).
- **@audio pipeline LIVE for music**: `AudioRef {audioId,inSec,outSec}` (types.ts:237),
  RefSuite AUDIO slots UI, `resolveRefMedia` (main/index.ts:536) cuts windows → mp3, fal
  `audio_urls` (fal.ts:174). Constraints pinned in models.ts:31-33: ≤3 audios, **≤15s
  combined**, audio ref **requires ≥1 image/video ref**, Seedance 2/2.5/3 all maxRefAudios=3.
- **Audio registry**: `audioModels.ts` has `kind: 'voice'` defined, **zero voice engines yet**.
- **Models card**: chatterbox + f5-tts install rows exist (`needsRuntime: true`, no runtime yet).
- **No Voices card panel. No voice engines. No emit/codir integration.** Phases 2-7 of the
  plan are all unbuilt; phase 1 (schema) is done.

## The doctrine (from the tutorial, transcript-verified twice)

1. A voice = a **description prompt** (LLM writes it from the character's image; iterated in
   words) + a **kept reference sample** ≤30s.
2. Scene dialogue renders in an AUDIO engine first (cheap, controllable, foley included), then
   rides into Seedance as the audio ref. Never fish for voices by re-rolling video.
3. **Lip-sync law**: dialogue-mode video duration = audio duration, rounded UP to the engine's
   duration enum. The app enforces what the tutorial does by hand.
4. Timbre mode exists but drifts ("studio feel") — offered, hinted, never the default.
5. Never overprompt.

## Engine roster (`audioModels.ts`, kind 'voice')

Two stages, capability-flagged so both cards render from descriptors:

| stage | engine | provider | role |
|---|---|---|---|
| DESIGN (desc → voice sample) | Seed Audio 1.0 | fal | primary design + scene dialogue/foley; EN+ZH only (flagged in notes) |
| DESIGN | ElevenLabs Voice Design | elevenlabs | secondary, key-gated with reason |
| SPEAK (ref + text → dialogue) | **Chatterbox (API)** | fal | **MAIN** — zero-shot clone from ~10s |
| SPEAK | **F5-TTS (API)** | fal | secondary — best long-read prosody |
| SPEAK | Seed Audio 1.0 | fal | the SCENE-TRACK engine: dialogue + ambience/foley in one pass |
| SPEAK (later) | Chatterbox / F5-TTS local | local | the Models-card rows, land with LOCAL-MODELS runtime |

New descriptor flags: `voiceDesign?: boolean` (text→voice) · `voiceClone?: boolean` (ref
audio→speech) · `foley?: boolean` (scene ambience in the same pass). fal slugs and pricing get
the **OpenAPI read at build time** (house discipline) — entries carry `endpoint: ''` + an
honest note until then. `DEFAULT_VOICE_ENGINE = chatterbox-api`.

## Schema additions (additive, no bump needed — migrate fills nothing)

- `ProjVoice.desc?: string` — THE voice description prompt. The desc lives on the voice (the
  voice owns its words); the sheet shows and edits it through the binding.
- `AudioRef.voiceId?: string` — a slot's source is a Library music track OR a project voice
  (exactly one set, the VideoRef two-source precedent). `resolveRefMedia` resolves voices from
  `proj.voices` the same way (window → mp3).
- `PromptData.voiceMode?: 'dialogue' | 'timbre'` — absent = timbre (safe default for existing
  recipes); the UI defaults NEW sheet-linked fills to dialogue-first guidance (law 8 honesty:
  the mode is drawn, never assumed silently).

## 1 · Voices card (panel id `voices`, title "Voices")

The audio sibling of the Image Editor tree — SAME grammar (results tree, branch anywhere,
nothing real until KEPT), panel-registered with guard() + PANEL_DEFS (prefer: within render /
scorecard), Window ▾ listed.

- **Header row**: session picker (per-sheet sessions pinned first: "⛉ Kael's voice"), engine
  select from `audioModelsOf('voice')` filtered by stage, + new session.
- **Design box**: the desc prompt textarea ("e.g. a low, gravelled elder's voice, slow cadence,
  dry humor under it") + ▶ Generate (cost on the face when known). Lands as a root node.
- **Clone source**: picker = Library audio ∪ project voices ∪ file drop (MIME_AUDIO + OS drop).
- **Node tiles**: play button (audioBus-owned), engine chip, prompt/refinement line, ⑂ branch
  = refine box on top of that node ("deeper, less rasp"), ★ keep.
- **Test line row**: one input; "read on this node" re-speaks the line through the node's
  engine+ref → a child node. Compare by ear across nodes, the tutorial loop.
- **KEEP** = mint `ProjVoice { title, file → <project>/voices/, desc: the node's assembled
  prompt chain, durationSec }` + `keptVoiceId` on the node. Toast with the voice's name.
- Library grows a **voices shelf** (♀♂ 🎤 tiles) next to audio; drag = MIME_VOICE (new dragDrop
  channel); voice tiles never appear in music pickers and vice versa (types already split).

## 2 · Char sheet — the voice lives with the character

Under the image block, a **VOICE group** (bordered group, ch.04 grammar):

- Empty: "no voice yet — 🎤 design one (opens the Voices card on this sheet) · or drag a voice
  here". The 🎤 button opens/creates the sheet-bound VoiceSession and raises the card.
- **"describe voice" button**: codir sub-call (the compose/subcall.ts precedent) — sends the
  sheet image + the seven character fields, returns a voice description that lands in the
  sheet-bound session's design box (never auto-generates; the user presses Generate).
- Bound: voice chip (title · durationSec · ▶ play) + ✕ unbind + the **desc textarea** editing
  `ProjVoice.desc` (debounced through the sheet's existing push/flush machinery, saved via a
  voice mutator — the desc is the voice's, so every sheet sharing it sees the same words).

## 3 · Clip Gen — the voice rides the sheet link

- **Auto-fill, visible (law 1)**: when characterLinks resolve to a sheet with a voiceId and the
  engine has maxRefAudios > 0, RenderPanel ensures an AUDIO slot `{ voiceId }` tagged
  "⛉ <sheet name>'s voice" in RefSuite — a REAL slot the user sees and can remove/window, not
  send-time magic. Default window = first 15s when the sample runs long (lint says so).
  Slot cap + the ≥1-image/video constraint guard: sheet image satisfies it normally; when the
  clip has zero image/video refs the slot is held back with the reason as a lint line.
- **Emit (emitYaml.ts)**:
  - `character_modeling.<char>.voice: "<ProjVoice.desc>"` — the desc rides the YAML so the
    model hears the intent in BOTH modes (and in buildNatural as `voice: …`).
  - a `reference_handling`-adjacent role-bind line per bound voice, mode-dependent:
    - timbre: `@audioN is <CHAR>'s voice — match its timbre, age and grain; do not use its words.`
    - dialogue: `@audioN is the complete dialogue and audio track — exact lip sync to it.`
  - Emitted by the same layer that assembles StructuredFields (RenderPanel passes a
    `voiceBinds: { tag, charName, mode, desc }[]` into buildYaml/buildNatural).
- **Modes UI** (render panel, near the AUDIO slots): a two-cell segmented `dialogue | timbre`
  per audio slot that carries a voice/scene track.
  - **dialogue**: the duration select LOCKS to the audio's length rounded UP to the engine's
    enum, face reads `matched to @audio1 · 8s`; manual override allowed, mismatch = lint
    ("lip sync will drift: 7.3s audio in a 12s shot").
  - **timbre**: hint under the slot: "less reliable — tone can drift toward studio feel".
- **Scene-track flow (dialogue-first)**: a `🎤 render dialogue` action on the slot row: takes
  the beats' `dialogue:` lines (joined, in order) + the bound voice → SPEAK engine render
  (Chatterbox-API main; Seed Audio when ambience/foley is wanted — engine pick in the dialog)
  → lands as **Library audio** (scene tracks are music-kind, per the plan) → the slot repoints
  at it in dialogue mode with the duration auto-matched. One queue job, cost-honest face.

## 4 · Co-Director — DEFERRED (user call 2026-08-20)

The Co-Director gets a clean ground-up rejig later, with every new feature (voices, scores,
local models) folded in at once — no piecemeal patches now. The ONLY codir touch this round is
the sheet's "describe voice" button, and that is a SUB-CALL through the existing subcall
plumbing (the compose precedent), not a change to the codir itself. Snapshot lines, teaching,
and any voice tools land in the rejig.

## Build order (one commit per block, typecheck + build gate each)

1. Registry + schema: voice engines in audioModels.ts (OpenAPI pass for chatterbox/f5/seed-audio
   fal slugs FIRST), ProjVoice.desc, AudioRef.voiceId + resolveRefMedia voice resolution,
   MIME_VOICE, voice mutators (store + main: sessions, nodes, keep, desc, sheet bind).
2. Voices card panel + Library voices shelf + Bin? (no — voices live in the Library only).
3. Char sheet VOICE group + describe-voice sub-call.
4. Clip Gen: auto-slot, emit lane, modes UI, duration auto-match, lints.
5. Scene-track render action (dialogue-first flow end to end).
6. Full pass: typecheck, build, migration test on a project copy, VOICES-PLAN.md marked
   superseded, memory updated. (Co-Director: deferred to its ground-up rejig.)

## Verification (live app)

- design a voice from a desc → tree grows → refine → keep → shelf shows it.
- bind to a sheet → desc edits stick → link the sheet into a clip → the voice slot appears
  tagged, YAML shows `voice:` + the role-bind line.
- dialogue-first: beats carry dialogue → 🎤 render dialogue → scene track lands, slot flips to
  dialogue mode, duration select reads "matched"; render the clip; lips sync.
- timbre mode renders with the hint; removing the sheet link removes the auto slot.
- JA dialogue: API path blocked with the honest flag (Seed Audio EN/ZH; chatterbox-api
  multilingual per its fal schema — confirmed at the OpenAPI read).
- sheet "describe voice" → a usable desc lands in the sheet-bound session's design box.

## Honest flags (carried + new)

- fal wire schemas for chatterbox/f5/seed-audio unread until build block 1 — slugs, pricing,
  ref-length limits pinned there; nothing ships on guessed fields.
- 15s combined audio cap: a 30s voice sample sends windowed; flagged in the slot UI.
- Seed Audio EN+ZH only; JA rides chatterbox-api if its schema confirms multilingual, else
  waits for the local runtime.
- ElevenLabs = separate paid key; gated-with-reason in the card.
- Local chatterbox/f5 render paths stay stubbed until LOCAL-MODELS runtime lands (rows exist).
