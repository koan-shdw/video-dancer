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
- **Sheet VOICE group** (as shipped): a 148×148 DRAG-ONLY file slot — drag a 🎤 voice from
  the Bin binds it (NO pick list, user law 2026-08-20), ✕ unlinks, ▶ plays the keeper; the
  box wears the voice's image face; the keeper's waveform fills the gap to its right. The
  first draft's 🎤 design / ✎ describe buttons never shipped — describe exists as a backend
  sub-call only, and the Co-Director rejig owns that surface.

## Sheet voice wave + voice face (2026-08-20 brief — BUILT same day)

THE BRIEF: a voice bound to a sheet fills the blank area right of the voice box with a
waveform of the voice's sample, in the border color, fading out toward the card's right
edge; pure visual, never interactive, re-fits when the card resizes; a voice with no
sample draws nothing. The voice box shows the voice's image thumbnail.

### What you SEE
- Sheet with a bound voice that has a rendered take: the 148 voice box wears the voice's
  IMAGE face (🎤 + name only when the voice has no image; play chip row under it is
  unchanged), and to its right a quiet waveform of the ★ keeper take stretches across the
  remaining card width at box height, drawn in the border grey (--line2), dissolving to
  nothing over the right third. Resize the panel: the wave re-fits live.
- Voice with no takes, or no voice bound: exactly today's look. Blank gap stays blank.
- The wave ignores the mouse (pointer-events none); clicks land on the card as before.
- While the ▶ chip plays the keeper, a light playhead bar sweeps the wave (thin --txt-hi
  edge with a 38px trail fading out behind it), rAF-driven off the audio element's
  currentTime — imperative transform, no re-renders, rough sync by design (visual only).

### Build (CharSheet.tsx only)
- New local `VoiceWaveGap({ file })`: `useWave(file, true)` (lib/waveform — cached,
  ffmpeg main-side decode) + a canvas in a `flex: 1, minWidth: 0, height: 148` cell.
  Draw = the timeline block-wave sibling (Timeline.tsx ~1019) verbatim: bitmap sized from
  clientRect, ResizeObserver redraw, center-mirrored 1px bars, peakAmp dB mapping, the
  whole take (0 → wave.dur). Color read from computed style at draw time (canvas can't
  resolve vars); per-bar globalAlpha 1 until 55% of width then smoothstep to 0 at 100%.
- SheetVoiceField: label stays; under it a flex row `gap 10` = the drag wrapper (box +
  chip; the pick POPOVER DIED — user law same day: the slot is drag-only, voices come
  from the Bin) + the wave cell, rendered only when `keeper` exists (the SAME keeper the
  play chip resolves: ★ else newest non-disabled).
- Voice box face: `voice.recipe.imageId` → project images lookup → cover `<img>` fills
  the box (image-slot grammar); fallback = today's 🎤 + name.
- Not touched: VoicesCard, Bin tiles (already image-faced), main/preload/shared, export.

### Edge cases
- Keeper file missing on disk → wavePeaks null → blank gap, no error surface.
- Keeper re-crowned / new first take → file key changes → cached decode + redraw.
- Theme switch: color re-reads on the next redraw (same behavior as timeline waves).
- Narrow panel: the cell thins gracefully; under ~4px the draw guard skips.

## PARKED (blocks 4-5) — no build without the user's GO + a fresh brief check

Picked 10-01 (list 44) and built from `VOICE-EXTRAS-SPEC-2026-10-01.md`, which replaces this
section.

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
