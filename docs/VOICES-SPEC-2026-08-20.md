# VOICES — spec of record (rebuilt 2026-08-20 to the user's brief)

THE BRIEF (the user's words, the only answer key): *"the whole point of this section is we
generate sound files based on the desc and image provided and then link those voice files to
characters and to prompts so we can get consistent voices."* It starts like Clip Gen — voice
name + new — and a new voice lands in the BIN.

The first build followed the old planning doc (results trees, "sessions") instead of this
brief and was ripped out the same day. VOICES-PLAN.md is deleted. **The user's brief outranks
every doc in this repo, always.**

## The model (shipped)

- **VoiceClip** — a Bin citizen, the ScoreClip pattern exactly (types.ts): `name`, `recipe
  { engine, desc, testLine, imageId, refAudioId, options }`, `takes: VoiceTake[]`,
  `keeperTakeId`, `folder`. `Project.voiceClips`; delta `voiceClips`/`removedVoiceClipIds`;
  Folder kind `'voice'`; takes live under `<project>/voices/`.
- **The ★ keeper take IS the character's voice.** `CharSheet.voiceId` binds the VoiceClip;
  `AudioRef.voiceId` in @audio slots resolves the keeper's file at send time (main
  resolveRefMedia). Swap the keeper, every clip and prompt follows.
- First take auto-becomes keeper; ★ on any take re-crowns it.

## The card (shipped — Clip Gen's grammar)

1. **voice name + ＋ new** (new lands in the Bin's 🎤 voices section).
2. **MODEL** — registry select (`audioModels.ts` kind 'voice'): Chatterbox HD (MAIN, fal),
   Chatterbox Multilingual (23 langs incl JA, ≤300 chars), F5-TTS, Seed Audio 1.0 (designs
   from words + image, foley), ElevenLabs + local twins gated with reason. Language input on
   multilingual.
3. **VOICE DESCRIPTION** — the desc; also rides into the YAML of every linking clip.
4. **REFERENCES** — the character's image (picker/drag; Seed Audio hears it on design
   renders) + optional clone sample (a ♪ Library track).
5. **TEST LINE** — the words every take reads; char-cap lint per engine.
6. **TAKES** — ▶ play (one audio-bus owner) · ★ keeper · ✕ delete · engine + length chips.
7. **▶ Generate · price + ＋ Queue** — two-lane hero, char-rate cost on the face; renders ride
   the queue (kind 'voice'), land as takes via `voice:render` (recipe resolved main-side,
   snapshot frozen; scoreRender's transport: upload/track/cancel/download; 48kHz defaults).

## Bin + sheet (shipped)

- **Bin 🎤 voices section**: tiles (image face + take count + ★/⛉ badges), ＋ voice, double-
  click = the card, drag = MIME_VOICE onto a sheet, right-click rename/delete (delete clears
  slot refs, bindings resolve-to-nothing, undoable).
- **Sheet VOICE group**: 🎤 design (creates "«name» voice", inherits the sheet image, binds,
  opens the card) · ✎ describe (ONE sub-call, api/bridge per codir setting, writes the desc
  onto the voice — the USER presses Generate) · bind existing / drag / unbind · ▶ plays the
  keeper.

## PARKED (blocks 4-5) — no build without the user's GO + a fresh brief check

- **Clip Gen**: a linked sheet with a voice auto-fills a visible tagged @audio slot
  (`fromSheetId`, removable); emit lane — `character_modeling.<char>.voice: "<desc>"` + a
  role-bind line per slot (`role: 'dialogue' | 'timbre'` on AudioRef, timbre default);
  dialogue mode locks duration to the audio rounded UP to the engine enum (lip-sync law),
  override = lint; timbre carries the drift hint.
- **Scene-track flow**: 🎤 render dialogue from the beats' lines through the bound voice
  (Seed Audio for ambience/foley) → Library audio → the slot flips to dialogue mode.
- **Co-Director**: deferred whole to its ground-up rejig.

## Wire schemas (verbatim, read 2026-08-20 — pinned in audioModels.ts + voiceRender.ts)

- `resemble-ai/chatterboxhd/text-to-speech`: text · audio_url · exaggeration .25-2 (.5) ·
  cfg 0-1 (.5) · temperature .05-5 (.8) · seed · high_quality_audio → audio.url. $0.04/1k chars.
- `fal-ai/chatterbox/text-to-speech/multilingual`: text ≤300 · voice (language) ·
  custom_audio_language · exaggeration · temperature · cfg_scale · seed. $0.025/1k. JA yes.
- `fal-ai/f5-tts`: gen_text ≤5000 · ref_audio_url (required) · ref_text ('' = auto ASR) ·
  model_type F5-TTS|E2-TTS · remove_silence → audio_url.url. $0.05/1k. No seed.
- `bytedance/seed-audio-1.0`: prompt (@Audio1-3 tags) · audio_urls ≤3×30s/10MB · voice ·
  image_url (EXCLUDES audio refs) · output_format · sample_rate ≤48000 · speed/volume/pitch ·
  multilingual → audio.url. $0.1875/min. EN/ZH first-class.
