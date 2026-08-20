# Local models — LTX 2.5 + the in-app runtime (build plan)

Restore point: git `6c4d1bc`. Planning session 2026-08-19. Work phase-by-phase; typecheck +
build gate after each phase. THIS DOC also carries the coordinated SCHEMA v18 for all four
2026-08 features (co-director RLM, score, voices, local models) — one bump, one migration.

CONSTRAINT (2026-08-19): no ComfyUI, no external tools — everything happens within the app.
The app owns download, install, inference, progress, and errors end to end.

BUILD ORDER (updated 2026-08-20): score, voices and the timeline rounds SHIPPED. Audio
locals wired (gates open: ACE first good take · MiniMax local install + first take) →
LTX phases 5-6 → co-director rejig from a fresh user brief. STANDING ORDER: this doc gets
a point-by-point review + redundancy cut WITH the user before local-models work resumes.

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

## Models card — SETTLED SPEC (user session 2026-08-19; supersedes earlier sketches where they differ)

Audience truth: a user who knows nothing about models sees a logo, one plain sentence, and one
button. That is the card's entire vocabulary. Conventions below are cited from shipping code —
nothing on this card is invented.

### Surface
- A docked CARD in the panel registry (Window ▾ menu + workspaces), same docked-editor grammar
  as the Score card (`vd-panel vd-scroll`, 9.5px uppercase amber header + dim explainer).
  Openable on its own at any time.
- RUNTIME ROW (user addition 2026-08-19): the private Python runtime is itself a row on the
  card, in a RUNTIME section at the top — "everything the app downloads lives here" includes
  the biggest hidden download of all. Same row grammar: download with size, progress, ✓ ready
  with real size on disk, delete with confirm (next local render re-installs it). Per-engine
  envs appear under it as indented rows with their own disk sizes once provisioned. The
  section also carries the GPU probe's one-line verdict ("GPU: <name> · <VRAM>" or the
  graceful no-NVIDIA note). Model rows that need the missing runtime say so and point up.
- AUTO-RAISE: any surface that triggers a model download (Score, Voices, Clip Gen engine
  pickers, fx effects) raises this card scrolled to that model's row. The row IS the download
  UI — wizard, progress, errors all live here. Other cards never grow their own download
  chrome; they stay gated with reason ("model downloading, 42%") and point here (law 11: one
  of everything). Engine pickers keep the selection when they fire the raise (models always
  listed, ⬇ mark when absent; gating law: disable with reason, never hide).
- DOWNLOAD HONESTY (user law 2026-08-19, bible law 8 amendment): any button whose click must
  download a model first carries it ON THE FACE — "generate · downloads model first
  (~100 MB)" — suffix dropped once the model is on disk. Shipped on Effects generate; LTX and
  audio render buttons MUST ship with it at phases 5-7.
- Sections per folder — video / audio / fx / loras — on the Section recipe (ui/Section.tsx:
  uppercase legend + bordered body); each legend's right chip reads "N installed · X.X GB".

### The row (one grammar for every model; fixed height, states swap IN PLACE)
- Left: model LOGO in a fixed 22px slot (bundled asset per model; fallback = category icon
  from the house icon library) · name (12px) · one-line what-it-does (11px, --dim) ·
  homepage ↗ (opens in the OS browser) · size + license chip (mono 10px).
- Right: ONE fixed-width state slot — the button morphs on the thing itself (law 6):
  - not downloaded → `⬇ download · 6.2 GB` (.btn)
  - confirm step → the WIZARD in the app's ONE prompt/confirm shell (law 11; prompt.tsx is
    the canon confirm): disk-free check, GPU check, variant recommendation by GPU (recommends,
    never restricts), the real download size, confirm / cancel. Fires on download click AND on
    the auto-raise path; on confirm the card owns it. Rows never expand — furniture never moves.
  - downloading → thin progress bar (DownloadMonitor recipe: 4px track --field + 1px --line,
    --amber fill, width .3s) + mono % + ✕ cancel. Honest progress (law 16).
  - ready → ✓ ready (--ok) + delete (dim, --bad on hover)
  - update available → `⟳ update` beside the ✓ (manifest version vs registry)
- DELETE = the house danger confirm (prompt.tsx grammar, --bad button) with real sizes
  (law 15): "delete <name> — frees 12.4 GB, re-downloadable any time" · delete / keep. Row
  flips back to not-downloaded; nothing else in the app breaks.
- LTX variant rows (full bf16 / fp8 / distilled) indent under one LTX parent header row.
- Errors contained in the row (law 17): red status line + retry, never a popup.
- CANON OVER DRIFT (user law 2026-08-19: the newest card is not the convention — the bible +
  gaps-09 override any single card): this card ships bible values day one. Mono chrome text
  (decision #2), type ladder 9/10/11/12 (no 9.5s), radius 4 controls / 6 containers, the
  tokens.ts spacing scale (its first importer), the Section.tsx legend recipe, the quiet --dim
  ✕, canon button variants (download = secondary, delete = danger). New glyphs entered the
  bible table (ch. 03) before this card uses them: ⬇ download · ⟳ update · ↗ opens externally.
- Download plumbing: `fx.ts ensureModel` generalized into a shared streaming downloader
  (.part + rename, completeness check, progress events, multi-file manifests with per-file
  sha/size where published). The transient DownloadMonitor retires; the card is the only
  download surface (fx model downloads surface here too).

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
- CONFIRMED by user 2026-08-19: `fx/` stays ONE folder — masking + utility models together.

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
  detailed in SCORE-PLAN / VOICES-SPEC-2026-08-20; they ride this card and runtime as rows.

## Extend — settled, out of scope
Asked and answered 2026-08-19: extend on local LTX is a non-feature. The app already kind of
does it (live last-frame stills → next clip's i2v start frame). Real LTX extend exists only on
their paid API (ltx-2-3-pro), which isn't plugged in — could be, but why bother. The open
local package has no extend pipeline (verified: RetakePipeline is interior-region only). Do
not build this.

## LoRAs (app-wide)
- Shelf = CivitAI AUTO-FILTERED (decided 2026-08-19; replaces the koan-maintained manifest):
  the card's loras section queries CivitAI's API for base model LTX 2.5, NSFW off, sorted by
  most-downloaded; rows show the CivitAI preview image, name, creator, and the SAME state slot
  as model rows (download / progress bar / ready + delete). Zero list maintenance. The former
  "browse tab" collapses into this shelf — a search field over the same filter when wanted.
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
- VOICES: shipped as `Project.voiceClips` (VoiceClip Bin citizens) + `CharSheet.voiceId` —
  shapes in VOICES-SPEC-2026-08-20. (The voices/voiceSessions design first coordinated here
  was ripped out 2026-08-20; VOICES-PLAN is deleted.)
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
- [~] 2. CODE LANDED 2026-08-19 (second session): shared downloader (main/modelStore.ts —
        multi-file, .part+rename, completeness check, cancel, aggregate progress, quit sweep),
        registry (shared/localModels.ts), Models card panel (sections video/audio/fx/loras,
        one row grammar, runtime rows gated with reason, delete via house danger confirm with
        real bytes), auto-raise on 'models:started', DownloadMonitor RETIRED, fx.ts delegates
        to the shared store + flat→models/fx/ layout migration (mobilenet cleaned). Typecheck +
        build green. GATE STILL OPEN: live download of an fx ONNX through the card (needs the
        app launched — single-instance: the user's running app must close first).
- [~] 3. CODE LANDED 2026-08-19 (second session): main/runtime.ts — uv bootstrap (zip →
        Expand-Archive → `uv python install 3.11 --no-bin --no-registry`; the flags are LOAD-
        BEARING, default touches ~/.local/bin + the Windows registry), ensureEnv per engine,
        worker lifecycle (freeport + per-session token + health poll + idle-kill 120s +
        quit-kill), app-wide GPU lock (withGpu), workerCall, GPU probe (nvidia-smi, cached,
        graceful null), runtimeTest. Card: RUNTIME section first — runtime row (download /
        stage notes / ready+size / delete), env sub-rows with sizes, GPU verdict line, ▶ test
        chip. Whole chain PROVEN outside Electron 2026-08-19 (uv 20MB → python 3.11.16 →
        venv → stub worker: health 200 tokened / 401 bare, POST echo ok, 401 bare). Render
        adapter + queue routing deferred to phase 5 with the engines. GATE: press ▶ test on
        the card in the running app.
- [~] 4. CODE LANDED 2026-08-19 (second session): lib/modelWizard.tsx — the ONE wizard in the
        house confirm shell (widened to ReactNode): size, disk-free (statfs, 10% headroom
        warning), GPU line, LTX variant recommendation (recommendLtxVariant: ≥24GB bf16 /
        ≥12GB fp8 / else distilled — recommends, never restricts). Confirm → card raised
        scrolled to the row (store.modelsFocusId), download fires, row owns progress. Both
        entries funnel here: card download buttons + Score's engine picker (locals now
        SELECTABLE, selection kept, wizard fires; models with no files yet just raise the
        card). Render gate carries the LIVE % via store.modelJobs (App's one listener).
        GATE STILL OPEN: full wizard path on a cold profile (delete runtime + models, walk it).
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
- [ ] 8. LoRA shelf feed: CivitAI auto-filter (base model LTX 2.5 + NSFW filter + search +
        install-to-folder). Gate: a shelf LoRA installs and appears in the picker.
- [ ] 9. Full pass: typecheck, build, migration test, cold-install rehearsal (delete
        userData/models + runtime, rebuild through the card), update this file, hand over.

## GPU DISCIPLINE — four rules, enforced in runtime.ts (2026-08-19, after an orphaned worker
## squatted on 13GB of VRAM and OOM'd every render; the framework for video+music+masking
## sharing one GPU in one session)
1. Workers SELF-TERMINATE when the app dies (PY_PARENT_WATCH in every script worker) —
   lifetime is never by politeness. Engine-shipped servers can't self-watch → rule 2.
2. Startup REAPING (reapOrphans): kill anything still running from the runtime dir before
   spawning a thing.
3. VRAM PREFLIGHT (gpuFreeMB): a render states its need and fails in English ("X free, Y
   needed") before loading, never a CUDA riddle after minutes.
4. ONE GPU, ONE RESIDENT ENGINE (evictOtherEngines): starting any job evicts other engines'
   idle workers immediately; the 120s idle timer is a fallback, not the mechanism.
LTX (phase 5) and every future local engine MUST ride these — no engine manages its own GPU.

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
