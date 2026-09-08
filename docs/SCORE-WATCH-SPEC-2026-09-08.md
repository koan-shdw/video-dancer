# Score Gen — compose watches the cut · ElevenLabs Music door (spec, 2026-09-08)

Director's brief, his words: put the score bar in the audio, stretch it to where the score
should be, hit compose — it reads the videos in the timeline and comes up with the composition.
Needs Gemini reading the full timeline, and new music-gen doors: Suno and ElevenLabs.

Status: APPROVED + BUILT 2026-09-08 ("add it all"; Suno out until a wrapper is named; per-shot
digests kept beside the cut watch; music_v2 always). PROVEN in node: the composition-plan
emitter (5 beats → 4 chunks summing to the span, tiny beats merged, styles/negatives, prompt
mode without beats). UNTESTED in the app: the proxy render + cut watch on compose, the
ElevenLabs POST, the Settings row.

## 1. What exists (verified 2026-09-08)

- Score compose (`scoreCompose.ts`): per-shot digests (now fed by the watch lane per take) +
  one synthesis pass → beats. It never sees the cut as one piece.
- **The span already renders to one video**: the Sonilo door (video-to-music) renders the
  covered span "as a DRAFT PROXY first — 480p" and uploads it (`index.ts` score:render). That
  proxy is exactly the file Gemini should watch.
- Watch lane (`watch.ts`): Gemini Flash on a file, or frames → Claude without a Google key.
- Music doors today: MiniMax Music 3 (fal), Sonilo video-to-music (fal), Beatoven (fal),
  ACE-Step 1.5 (local), MiniMax Music 3 (local). Voice doors include an `elevenlabs` bridge
  service id and a Voice Design stub that says "ElevenLabs lands with its key pass" — no
  ElevenLabs API key exists yet.
- The ScoreClip recipe = beats (`at`, `text`) + options (style text, isInstrumental).

## 2. Read on the APIs (2026-09-08)

- **ElevenLabs Music v2** — official: `POST https://api.elevenlabs.io/v1/music/detailed`,
  header `xi-api-key`; body = `prompt` (+ `music_length_ms` 3 000–600 000, `force_instrumental`)
  OR a `composition_plan`: `chunks[]` of `{ text (section label + lyrics + {directions}),
  duration_ms 3 000–120 000, positive_styles[], negative_styles[], context_adherence }`, ≤ 30
  chunks, total 3 s–10 min; `model_id: "music_v2"`; `output_format` e.g. `mp3_48000_192`;
  response = multipart audio + JSON metadata. A plan can also be drafted from a prompt via
  `music.composition_plan.create`. This is a clean fit: our beats ARE a composition plan.
- **Suno** — no official public API in 2026 ("exploring a developer API … partner-powered
  model", no console, no docs, no timeline). Only third-party wrappers. **Not added.**

## 3. Compose watches the cut

- Press compose with the score bar stretched over a span → the app renders that span to the
  480p proxy (the Sonilo helper, reused) → ONE Gemini watch with the composer's question:
  *"You are scoring this cut. Describe, with timestamps: every cut point; the pacing and where
  it changes; the motion energy per stretch; the mood and its turns; the moments of silence or
  held breath; any sound already in the picture. Then say where the music should enter, lift,
  drop, and end."* → the synthesis prompt gets a new block **WHAT THE CUT DOES (watched whole)**
  above the per-shot lines (the shots stay: the cut gives rhythm, the shots give content).
- No Google key → the frames fallback (stills, no motion or sound — the synthesis is told so).
- Cost: one watch per compose (a minute of 480p ≈ 20–30k Gemini tokens ≈ a cent); the compose
  button's tooltip says "watches the cut · ~$0.0x" and the GEM chip ticks.
- The proxy is deleted after the watch unless a Sonilo render wants it too.

## 4. The ElevenLabs Music door

- `audioModels.ts`: `eleven-music-v2` — label "ElevenLabs Music v2", provider `elevenlabs`
  (direct API, not fal), key `Settings.elevenKey`, durations 3 s–10 min, instrumental switch,
  output mp3. Sits in the Score card's MODEL picker like the others.
- `emitScore.ts`: beats → a composition plan. One chunk per beat: `text` = `[<beat text as the
  section label>]` (+ lyrics lines when the score isn't instrumental and the user wrote any),
  `duration_ms` = next beat's `at` − this `at` (the last ends at the span end), clamped 3–120 s
  (beats shorter than 3 s merge into their neighbour; longer than 120 s split), `positive_styles`
  = the style prompt's words + the beat's musical words, `negative_styles` = "vocals" when
  instrumental, `context_adherence: "high"`. Total = the span. `model_id: music_v2`.
- `scoreRender.ts`: a second transport beside fal — POST with `xi-api-key`, parse the multipart
  (audio part → file, JSON part → `song_metadata` kept on the take), same job tracking, cancel,
  crash recovery (no queue: a failed POST is a failed take, no orphan).
- Settings → API: supplier row **ElevenLabs** (key + test key = `GET /v1/user`), the ● / ○ chip;
  the Voice Design stub starts working the day the key exists (separate, later).
- Spend: ElevenLabs bills credits, not dollars — the take carries its credit cost from the
  response headers when present; no $ estimate invented (law: no fake numbers).

## 5. Files

- main: `index.ts` score:compose — render proxy + watch before `composeScoreBeats`;
  `scoreCompose.ts` — the cut block; `scoreRender.ts` — the ElevenLabs transport;
  `index.ts` — `eleven:validate`, key in SECRET_KEYS.
- package: `audioModels.ts` (door), `emitScore.ts` (plan), `SettingsModal.tsx` (row),
  `ScoreCard.tsx` (tooltip). Types: `Settings.elevenKey`.

## 6. Acceptance

1. Stretch a score over three clips, compose → the bridge log / status shows "watching the
   cut"; the beats land on the actual cut points (compare to the timeline's blocks).
2. Same span, no Google key → compose still lands, status says stills-only.
3. Pick ElevenLabs Music v2, render → an mp3 take of the span's length; its metadata shows the
   plan sections; the GEM chip is untouched (ElevenLabs is not Gemini).
4. Instrumental on → no vocals; off + lyrics lines in beats → sung.
5. Settings: the ElevenLabs test-key passes with a real key, fails honestly without.

## 7. Open (director)

1. Suno: leave it out (no official API), or wire a third-party wrapper you pick?
2. Keep the per-shot digests alongside the whole-cut watch (proposed), or cut-only?
3. ElevenLabs default: `music_v2` always (proposed) — v1 offered nowhere.
