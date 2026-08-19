# Local models — LTX 2.5 + the in-app runtime (build plan)

Restore point: git `6c4d1bc`. Planning session 2026-08-19. Work phase-by-phase; typecheck +
build gate after each phase. THIS DOC also carries the coordinated SCHEMA v18 for all four
2026-08 features (co-director RLM, score, voices, local models) — one bump, one migration.

CONSTRAINT (2026-08-19): no ComfyUI, no external tools — everything happens within the app.
The app owns download, install, inference, progress, and errors end to end.

BUILD ORDER (2026-08-19): codir sub-call plumbing (pre-step) → score → voices → LOCAL MODELS
(this) → co-director fix → timeline fix. Score/voices ship API-first; their local engines
switch on when this plan's runtime lands.

## The runtime (model decision)
A private, app-managed Python runtime the user never sees:
- The app downloads `uv` (single static binary) once into `userData/runtime/`, then uses it to
  provision a pinned Python + per-engine virtualenvs under `userData/runtime/envs/<engine>/`.
  Env provisioning is part of a model's install step in the Models card (progress: "preparing
  runtime… / downloading model…"). Wheels are pinned per engine; no global Python is touched
  or required.
- Each local engine runs as a WORKER: a child process serving localhost HTTP with a
  per-session token (same trust shape as `codirMcp.ts`). Workers are spawned on demand, one
  render at a time (VRAM is exclusive), idle-killed after a timeout, and hard-killed on app
  quit (the `abortAllJobs` discipline from fx.ts applies).
  - LTX 2.5: worker wraps the official `ltx-pipelines` package (uv-managed monorepo;
    `--quantization fp8-cast --offload cpu|disk` for smaller GPUs).
  - ACE-Step 1.5: ships its own REST API server (`acestep-api`) — run under our env, same
    token+port discipline, no wrapper needed beyond lifecycle.
  - Chatterbox / F5-TTS: thin worker over their Python APIs.
- Local renders ride the SAME queue/takes flow as fal renders: submitted → progress events →
  take file + snapshot. A `provider: 'local'` on the descriptor routes `index.ts` to the local
  adapter exactly like higgsfield/modelark/astria route today. No pending-renders entry (a dead
  app killed the worker — nothing to recover, nothing was billed); the queue row says so.
- GPU check: `nvidia-smi --query-gpu=name,memory.total` spawn at wizard time (graceful "no
  NVIDIA GPU found" path; CPU offload is a recommendation knob, not a blocker).

## Models card (new)
- One card lists every optional local model across video and audio, per-VARIANT rows.
- Status per row: not downloaded / downloading + % / ready / update available (manifest
  version vs registry).
- Users download from the card directly, OR: picking an undownloaded local engine in any
  engine dropdown (models always listed, ⬇ mark when absent; gating law: disable with reason,
  never hide) keeps the selection and fires the WIZARD: disk space, download size, GPU check,
  variant recommendation by GPU (recommends, never restricts), confirm. Confirm opens the card
  scrolled to the row; the card owns progress from there. Render stays disabled with reason
  ("model downloading, 42%") until ready.
- Download plumbing: `fx.ts ensureModel` generalized into a shared streaming downloader
  (.part + rename, completeness check, progress events, multi-file manifests with per-file
  sha/size where published). The transient DownloadMonitor retires; the card is the only
  download surface (fx model downloads surface here too).
- ADDENDUM 2026-08-19 (user session, plan-of-record): the card handles BOTH directions —
  per-row DELETE with one confirm; delete removes the model folder's files and the row flips
  back to not-downloaded (re-downloadable any time, nothing else breaks). Big weights must be
  reclaimable from the card itself, never by hand in the file system.
- ADDENDUM 2026-08-19: every row carries a small designed graphic telling the user what the
  model does at a glance (video gen / music / voice / masking / utility). The card is a
  designed surface per the app's design language, not a settings list. Fixed-height rows,
  furniture never moves (music-day law).

## Folder layout (app-wide models AND LoRAs)
```
userData/models/
  fx/       existing matte+depth ONNX migrate here (one rename pass in fx.ts path helpers;
            files move on first run, old flat paths cleaned)
  video/    per-model subfolders: ltx-2.5/<variant>/  (multi-file checkpoints)
  audio/    ace-step-1.5/, minimax-music-3/, chatterbox/, f5-tts/
  loras/
    ltx/    scanned on card open + fs watcher: manual drops/deletes appear live
```
- Per-model-folder `manifest.json`: version, size, source URLs, variant id. Drives card status
  + update detection. Card renders straight from directory tree + registry. No database.

## The models (verified 2026-08-19)
- LTX 2.5 (Lightricks, open weights 2026-08-11) — THE local video engine (decided
  2026-08-19: H3 dropped, LTX all the way): 22B audio+video-in-one diffusion model, HF
  `Lightricks/LTX-2.5`, official Python inference + LoRA trainer (github Lightricks/LTX-2:
  ltx-core / ltx-pipelines / ltx-trainer, uv-based). BF16 full ~66GB incl the bundled Gemma 4
  12B text encoder; fp8-cast + cpu/disk offload bring it to 16GB-class GPUs (Lightricks' own
  minimum claim); distilled checkpoint + conv decoder = the fast tier. Variant rows: full bf16 /
  fp8 / distilled. LoRA REQUIRED and official. License: free under $10M ARR — fine for this
  app's users, licence text linked from the card row.
- Audio locals (ACE-Step 1.5, MiniMax Music 3, Chatterbox, F5-TTS): specs + licenses verified,
  detailed in SCORE-PLAN / VOICES-PLAN; they ride this card and runtime as rows.

## Extend — settled, out of scope
Asked and answered 2026-08-19: extend on local LTX is a non-feature. The app already kind of
does it (live last-frame stills → next clip's i2v start frame). Real LTX extend exists only on
their paid API (ltx-2-3-pro), which isn't plugged in — could be, but why bother. The open
local package has no extend pipeline (verified: RetakePipeline is interior-region only). Do
not build this.

## LoRAs (app-wide)
- Curated shelf as the default: a koan-maintained manifest the app fetches (the
  `playground.ts` release-shelf pattern is the precedent — non-latest GitHub release asset).
  Optional CivitAI browse tab BEHIND it (their API filters by base model; NSFW filtering
  required; quality/rot caveats in the tab copy).
- Per clip: multiple LoRAs stacked, each with a weight slider (0-1, allow to 2), stored on the
  recipe as `PromptData.loras: [{name, weight}]` — frozen into take snapshots automatically
  (snapshot IS PromptData), restored by take-restore.
- Trigger words from the LoRA manifest shown as a hint chip, never auto-inserted.
- Missing LoRA (deleted from folder): row red with reason, render gated.
- Clip Gen shows the LoRA picker row only for engines whose descriptor declares the `loras`
  capability, fed from the card's inventory (folder scan + watcher).

## Registry entries
`shared/models.ts` gains `provider: 'local'` entries with REAL caps read at build time from the
official docs (durations, ratios, resolutions, ref slots, audio, seed):
- `ltx25` — LTX 2.5 (t2v/i2v(+v2v later if the pipeline supports it), native audio, `loras`
  capability, pricePerSec {} — local is free, estimate stays blank by the cost-honesty law with
  a "local render" note instead). The variant is picked in the engine picker from installed rows.
New descriptor fields: `loras?: boolean`, `localRuntime?: { envId: string; variants: [...] }`.
Score + voice engines get the same registry treatment in `shared/audioModels.ts`.

## SCHEMA v18 — the coordinated bump (all four features, one migration)
`SCHEMA_VERSION = 18`. Migration = stamp + defaults, per house rule; all additive:
- CO-DIRECTOR: `CoDirState.digests?: { fromAt: number; toAt: number; text: string }[]` —
  folded history spans (raw log untouched).
- SCORE: `Project.scoreClips?: ScoreClip[]`; `Timeline.scoreItems?: TimelineScoreItem[]`
  (shapes in SCORE-PLAN).
- VOICES: `Project.voices?: ProjVoice[]`; `Project.voiceSessions?: VoiceSession[]`;
  `CharSheet.voiceId?: string` (shapes in VOICES-PLAN).
- LOCAL MODELS: `PromptData.loras?: { name: string; weight: number }[]` (rides snapshots);
  `Take.localVariant?: string` (which installed variant rendered it); EngineId union grows
  `'ltx25'`.
- Settings (no schema bump needed): `localVariants?: Record<string, string>` (engine → chosen
  installed variant), runtime prefs.
Migration test on a project copy is the phase-1 gate, same drill as v14.

## Phases
- [~] 1. v18 bump + migration — CODE LANDED 2026-08-19 (types + hidden ltx25 registry entry +
        migrate defaults + toAbsolute/toRelative/liveFilesOf coverage; typecheck + build green).
        STILL OPEN in this phase: migration open-test on a project copy (needs the app
        launched), `userData/models/` layout + fx ONNX path migration (with phase 2's
        downloader — pointless to move files before the card reads them).
- [ ] 2. Shared downloader (ensureModel generalized: multi-file manifests, progress bus,
        cancel/resume-by-redo) + Models card UI (rows from directory+registry, statuses) +
        DownloadMonitor retirement. Gate: a small model (fx ONNX) downloads through the card.
- [ ] 3. Runtime: uv bootstrap, env provisioning, worker lifecycle (spawn/token/idle-kill/
        quit-kill), local render adapter + queue integration, GPU probe. Gate: a stub worker
        round-trips a job.
- [ ] 4. Wizard: undownloaded-engine flow from the pickers (keep selection, disk/size/GPU/
        recommendation/confirm), card handoff, render gating with reason. Gate: full wizard
        path on a cold machine profile.
- [ ] 5. LTX 2.5: env + worker + registry entry + variant rows + first real render to a take.
        Gate: i2v and t2v takes land with snapshots; the fp8 path renders (this machine is the
        test bench — no pretend hardware profiles).
- [ ] 6. LoRAs: loras/ltx folder + watcher, curated-shelf manifest fetch, per-clip stack UI +
        weights + trigger chips, recipe/snapshot/restore, missing-LoRA gating, emit into the
        LTX worker. Gate: two stacked LoRAs at set weights visibly shape a render; restore
        reproduces.
- [ ] 7. Audio locals for SCORE/VOICES (ACE-Step, MiniMax Music 3, Chatterbox, F5-TTS) as
        runtime rows — consumed by those plans' local phases. Gate: one audio engine renders
        via the shared runtime.
- [ ] 8. CivitAI browse tab (base-model filter + NSFW filter + install-to-folder). Gate: a
        browsed LoRA installs and appears in the picker.
- [ ] 9. Full pass: typecheck, build, migration test, cold-install rehearsal (delete
        userData/models + runtime, rebuild through the card), update this file, hand over.

## Honest flags
- LTX 2.5 full BF16 is a ~66GB download; the card's size + disk-space wizard step exists for
  exactly this. The fp8/distilled variants are the realistic default rows for most GPUs —
  variant sizes get pinned into the registry when the manifests are read at phase 5.
- MiniMax H3 was DROPPED 2026-08-19 ("ltx all the way for local gen") — its verified facts
  live in the planning-session handoff if it ever returns; nothing in this plan reserves
  space for it.
- One render at a time per GPU is a v1 simplification; the queue serializes local jobs and
  says why ("GPU busy: rendering <clip>").
- Sub-24GB GPUs on LTX full BF16 and Music 3 full precision rely on offload — slower, honest
  ETA from renderStats once real numbers exist.
- Windows-first: the runtime targets win32+NVIDIA now; mac/AMD paths exist upstream (ACE-Step
  supports them) but are unverified here and out of scope for v1.
