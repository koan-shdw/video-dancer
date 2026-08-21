# LTX-SPEC — LTX 2.5 as a local engine in vi-dancer

STATUS: APPROVED 2026-08-21 (point-by-point review with the user complete; this is the build plan of record. No code exists against it yet.)

Every fact below marked [V] was independently verified 2026-08-21 (primary source or live API/HEAD test).
Marked [P] = provisional, pinned by a numbered probe before the dependent code ships.
Nothing in this spec is inherited from docs/LOCAL-MODELS-PLAN.md or any earlier doc; where the shipped
placeholder code disagrees with verified reality, this spec wins and lists the correction.

---

## 0. Laws for this build

1. **Additive only.** Existing engines' fields, emitters, wire formats and behavior stay byte-identical.
   New LTX-only controls render greyed for engines that lack the capability. Any diff that changes
   another model's path is a bug.
2. **Refs are core.** LTX without reference images is not useful in this app. Refs ship installed with
   every LTX download, the refs box never greys for LTX, and the build's acceptance test is a
   ref-driven render working end to end. Probes decide HOW refs work, never WHETHER they ship.
3. **Highest quality default.** The best installed variant is the default for every render; speed tiers
   are visible user dials, never a silent downgrade.
4. **Honesty carries through.** Cost shows "local render". Download sizes are real. No fake progress.
   The enhancer rewrites the prompt in the open. The take snapshot stores exactly what was sent.
5. **Best graph wins.** We ship the workflow that delivers every wanted feature (refs, audio, end
   frame, fps, LoRAs) at the best quality and speed. All candidate graphs enter equal — official,
   community, MSR sample, our own wiring. Probes score them on evidence; the winner ships as the
   default. The official template serves as build material and the quality yardstick, nothing more.
6. **Any GPU.** The target is the user population, not one machine. Every tier from 8 GB up gets an
   honest recommendation; the dev 5080 (16 GB) is one test bench, nothing more.

---

## 1. Verified model facts

- [V] LTX 2.5: released 2026-08-11 by Lightricks. 22B dual-stream DiT, video + synchronized audio in
  one pass. t2v, i2v, v2v (IC-LoRA), audio-to-video, first-last-frame, keyframe interpolation,
  native multishot, auto duration predictor. Up to 4K HDR, up to 50 fps.
  Constraints: `num_frames % 8 == 1`, width/height divisible by 32.
- [V] License: LTX-2.x Community License, free commercial use under $10M ARR (registry chip correct).
- [V] Split checkpoint pack (per-component files):
  | component | file | size |
  |---|---|---|
  | transformer dev bf16 | ltx-2.5-22b-dev-transformer-bf16.safetensors | 39 GB |
  | transformer distilled bf16 | ltx-2.5-22b-distilled-transformer-bf16.safetensors | ~39 GB |
  | transformer distilled int8 (comfy) | ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors | ~22 GB [P-size] |
  | transformer distilled nvfp4 | ltx-2.5-22b-distilled-transformer-nvfp4.safetensors | [P-size] |
  | text encoder bf16 | gemma4-12b-with-proj-ltx-2.5-bf16.safetensors | 26.3 GB |
  | text encoder int8 (comfy) | gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors | 15.4 GB |
  | video VAE | ltx-2.5-video-vae-bf16.safetensors | 1.47 GB |
  | video VAE conv (faster decode) | ltx-2.5-video-vae-conv-bf16.safetensors | ~1.5 GB |
  | audio VAE | ltx-2.5-audio-vae-bf16.safetensors | 365 MB |
  | spatial upscaler x2 | ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors | [P-size] |
  | duration head | ltx-2.5-duration-head-bf16.safetensors | [P-size] |
  | distilled lora 450 | ltx-2.5-22b-distilled-lora-450-bf16.safetensors | [P-size] |
- [V] Distilled = 8 steps, CFG 1.0 (guidance baked in; negative prompt inert). Dev = full steps, real
  CFG, trainable, primary LoRA target. Most LTX 2.3 adapters run on 2.5 unchanged (Lightricks claim).
- [V] Official Lightricks/LTX-2.5 HF repo is GATED: direct download returns 401 without an accepted
  license + token (live HEAD test).
- [V] Complete UNGATED mirror exists: `comfyicu/LTX-2.5` — every transformer variant, both encoders,
  all three VAEs, both upscalers, duration head, distilled lora. Live HEAD test: public CDN 200,
  X-Linked-Size matches (video VAE 1,472,223,346 bytes).
- [V] Ungated GGUF quants: `vantagewithai/LTX-2.5-GGUF` (dev + distilled, Q2_K..Q8_0, + ready
  workflow JSON). Transformer sizes: Q2_K 8.83 / Q3_K_M 11.5 / Q4_K_S 13.9 / Q4_K_M 15.1 /
  Q5_K_M 16.8 / Q6_K 18.7 / Q8_0 23.6 GB. GGUF text encoder: `elix3r/gemma4-12b-with-proj-ltx-2.5-GGUF`
  (Q5_K_M 9.51 GB). Loader: ComfyUI-GGUF Unet Loader; config embedded as GGUF KV metadata.
- [V] VRAM reality: bf16 pack ≈ 66 GB VRAM (datacenter). Official int8 recipe: 24 GB comfortable,
  16 GB stated floor. GGUF Q4_K_M = community pick for 8-16 GB cards. NVFP4 = RTX 50-series.
  Reported: 4090 + distilled NVFP4, 8 s of 720p in ~25 s (single secondary source).
- [V] Resolution ladder (16:9 examples, all /32): 608x352, 736x416, 864x480, 960x544, 1056x608,
  1152x640, 1280x736, 1376x768, 1504x832, 1664x928, 1920x1088; 4K via two-stage upscale.
- [V] Prompting (docs.ltx.io, official): ONE flowing paragraph, present tense, six ordered elements
  (shot, scene, action, character, camera, audio), dialogue in quotation marks, cinematic camera
  verbs. Single shot: 4-8 sentences. Multishot: 2-4 shots, explicit prose cuts ("A hard cut
  transitions to…"), re-established framing per cut, stated audio continuity, reused visual
  identifiers for recurring subjects. AVOID: shot lists, numbered beats, sluglines, on-screen text.
- [V] Prompt enhancer: small Gemma-based side model, ungated (`gemma4_e2b` family, Comfy-Org mirror),
  supported by official Comfy nodes.
- [V] Civitai base-model enum is exactly `LTXV 2.5` (2 LoRAs today) and `LTXV 2.3` (real catalog);
  live API test. API: `/api/v1/models?types=LORA&baseModels=...`.
- [V] Multiple Subject Reference (MSR): `LiconStudio/LTX-2.5-Multiple-Subject-Reference`, ungated,
  one safetensors + sample Comfy workflow + validation sets (2-3 ref images each). [P] type
  (LoRA vs full finetune), max refs, distilled/GGUF compatibility, quality.
- [V] Official ungated extra: `Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler` (parked: the
  later upscale feature).

---

## 2. Architecture — headless ComfyUI as the LTX engine ("engine B")

Decision (session 2026-08-21): the worker is a headless ComfyUI server owned by our runtime, NOT the
ltx-pipelines package. Reasons: GGUF + int8 loaders serve the low-VRAM half of users (ltx-pipelines
cannot), the shipped standard workflow IS the Comfy template, LoRA/MSR/community speedups land as
graph edits not model code, and ComfyUI is proven on Windows.

**PINNED IDEA (user, 2026-08-21): this engine-in-runtime shape can host other local models later,
one workflow JSON each. Design note only, zero scope now.**

### 2.1 Install (the ACE pattern, `src/main/runtime.ts` + a new `src/main/ltxLocal.ts`)

- `ensureRuntime()` (exists) → uv + pinned Python 3.11.
- Engine env `envs/ltx-comfy/`: ComfyUI checkout at a PINNED commit + `ComfyUI-GGUF` custom node at a
  PINNED commit, deps via uv pip (torch CUDA wheel per platform, pinned). Stamped like every env;
  half-installs re-provision.
- The engine is a Models-card row (registry `category: 'runtime'`-adjacent; see §4) with real size,
  cancel, delete. Deleting re-installs on next use.
- Worker: ComfyUI spawned `--listen 127.0.0.1 --port <free>` under the existing engine-shipped-server
  lifecycle (worker map, health poll, idle-kill, parent-watch via wrapper, app-quit kill). Localhost
  binding is the trust boundary (token channel '' — the ACE shape).
- Model paths: an `extra_model_paths.yaml` written at spawn pointing ComfyUI at
  `userData/models/video/ltx-2.5/` (+ `models/loras/`) so weights live in OUR tree, visible and
  deletable on the card. Nothing lands in the user's home.

### 2.2 Render protocol

- Graph templates live in-repo as JSON (`src/main/guides/ltx/` or similar): `t2v`, `i2v`, `flf2v`,
  `refs` (MSR), `v2v-restyle` [probe-gated]. Each template has named placeholder nodes; main fills
  prompt, media paths, dims, frames, fps, seed, audio flag, LoRA chain, variant file names.
- Submit: POST `/prompt`; progress via websocket or `/history` poll → `render:progress` messages
  (real node-level progress; honest-progress law).
- Output: file collected from Comfy output dir into the project `renders/` dir; take lands via the
  existing `addTake` path.
- `render:run` gains a `provider === 'local'` branch (the score:render local shape): no fal key, no
  pending-render entry (nothing billed; a dead app killed the worker), model routed by engine id.
- One render at a time (VRAM exclusivity — existing worker law). Queue lane behavior unchanged.
- Cancel: POST `/interrupt` + queue delete; worker survives for the next job; idle-kill reclaims VRAM.

### 2.3 Pinning + integrity

- ComfyUI commit, ComfyUI-GGUF commit, torch wheel, and every model file (repo + revision SHA +
  byte size, plus sha256 where the mirror publishes one) are pinned in the registry. A mirror
  changing bytes fails the size/hash check loudly. Version bumps arrive only via app updates we test.

---

## 3. Downloads — the variant ladder (no account, ever)

All from ungated mirrors ([V] above). The Models card LTX group becomes:

| row | files | download | VRAM home | note |
|---|---|---|---|---|
| **quality (int8)** — DEFAULT for 24 GB+ | int8 distilled transformer + int8 encoder + VAEs | ~40 GB | 24 GB+ | the official Comfy recipe |
| **standard (GGUF Q5)** | Q5_K_M distilled + GGUF encoder + VAEs | ~29 GB | 16 GB | recommended on 16 GB |
| **compact (GGUF Q4_K_M)** | Q4_K_M distilled + GGUF encoder + VAEs | ~27 GB | 12-16 GB | community sweet spot |
| **small (GGUF Q3_K_M)** | Q3_K_M distilled + GGUF encoder + VAEs | ~23 GB | 12 GB | softer detail |
| **minimum (GGUF Q2_K)** | Q2_K distilled + GGUF encoder + VAEs | ~20 GB | 8 GB | experimental; visible quality loss |
| **full (dev bf16)** | dev transformer + bf16 encoder + VAEs | ~67 GB | 32 GB+ | real CFG + negative prompt; LoRA-native |

- Wizard recommendation by `gpuProbe()` VRAM: ≥24 → quality; ≥16 → standard; ≥12 → compact;
  ≥8 → minimum; no NVIDIA GPU → honest "local renders unavailable/slow" line. Recommends, never
  restricts (existing wizard law). Exact tier boundaries re-checked by probe P1. [P]
- Every LTX row bundles: MSR refs file (law 2), both VAEs it needs, audio VAE, duration head, and
  the prompt enhancer model (small). The spatial upscaler is NOT bundled (upscale = later feature).
- NVFP4 variant: shown for RTX 50-series GPUs only, else hidden inside the parent row's variant list. [P]
- Existing placeholder corrections: the `ltx-2.5-fp8` registry row dies (no such shipped file);
  variant rows above replace it. modelWizard's LTX tiers (24/12) are replaced by the table's.
- First-select trigger (exists as pattern): choosing LTX in Clip Gen / Video Edit with nothing
  installed funnels through `modelWizard()` → confirm (size, disk, GPU, recommendation) → card row
  owns the download. The ScoreCard sibling (`ScoreCard.tsx:191`) is the copy-exactly reference.

---

## 4. Registry changes (`shared/localModels.ts`, `shared/models.ts`)

### 4.1 localModels.ts
- LTX parent row + the 6 variant rows of §3 (each with real `files[]` — mirror URLs + sizes + SHAs).
- New rows: `ltx-comfy-engine` (the headless engine checkout; category `runtime`, indents under
  Python runtime), `ltx-msr-refs` (bundled inside every variant's files, still visible), 
  `ltx-prompt-enhancer` (small, bundled).
- `category: 'loras'` becomes real: rows are dynamic from disk (`models/loras/*.safetensors`) +
  Civitai metadata sidecars (§7) — not hardcoded registry entries.

### 4.2 models.ts — the `ltx25` descriptor (corrected, still flipped hidden until phase gate)
```
modes: ['ref2v', 'i2v']          // zero-ref ref2v = t2v (existing convention)
endFrame: true                    // FLF2V verified — placeholder said false, wrong
maxRefImages: [P] (2-3, MSR probe P2)
maxRefVideos: 0, maxRefAudios: 0, characterRefs: 0
durations: ['auto', '2', '4', '6', '8', '10']   // auto = duration head [P: max length probe P1]
resolutions: ['480p', '720p', '1080p']          // labels map to nearest /32 ladder size per aspect
aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9']
audioToggle: true                 // audio genuinely optional
seed: true                        // local, reproducible
fps: ['24', '25', '30', '50']    // NEW generic field [P: verify ladder P1]
qualityTiers: from installed variants (distilled fast / dev full)   // NEW generic field
promptStyle: 'prose'              // NEW third style
endpoints: {}                     // provider 'local' routes by id
pricePerSec: {}                   // estimate renders "local render"
v2v: probe-gated (P4)             // restyle; enters VideoEditor list only on pass
```
- **NEW generic descriptor fields** `fps?: string[]` and `qualityTiers?: boolean` (tiers read from
  disk state): any future engine declares them and the Clip Gen boxes wake up. Absent = greyed.

---

## 5. Prompt — the `prose` emitter + enhancer

### 5.1 `buildProse(d: StructuredFields)` (new, `emitYaml.ts` beside buildYaml/buildNatural)
Pure function, deterministic, no AI. Freeform stays on top verbatim (existing contract).
- **Opening**: shot + scene sentence from scene.title/style/visualFeel (+ reference_handling folded
  as a plain sentence when refs are attached).
- **Characters**: woven into their FIRST mention: physical identifiers inline (MSR/multishot
  consistency wants concrete markers), voice noted where dialogue exists. No separate block.
- **Beats → shots**: each beat = a sentence run, present tense: camera verb sentence, action,
  lighting; dialogue in quotes; sfx as audio sentences. Beats joined by prose cuts:
  "A hard cut transitions to…" with framing re-established and an audio-continuity phrase
  (continues / changes) per the official guide. 1 beat = single continuous take (no cut language).
  >4 beats: emit all, lint warns (guide prefers 2-4 shots). Beat timings drive frame counts, not
  numbered labels in the text (sluglines are on the avoid list).
- **Production notes**: audioDesign → closing audio sentence; lighting → folded into scene/shot
  sentences; subtext → mood sentence; criticalConstraint → plain imperative sentence; avoid →
  "No X." sentences on dev (real CFG); on distilled (CFG 1.0) folded the same way but the lint
  notes negatives are weak there. animationStyle → cadence sentence.
- **Lint** additions for LTX: warn on list-like freeform (numbered lines), >4 beats, on-screen-text
  requests, per-beat camera >20 words (existing rule stays).

### 5.2 Enhancer button (Clip Gen, LTX only)
- Visible only for LTX; enabled when the enhancer model is installed (bundled by §3).
- Press → worker runs the enhancer over the CURRENT combined prompt → the rewritten prose REPLACES
  the visible preview (marked as enhanced, one-tap revert to the deterministic emit). Render sends
  what the user sees. The take snapshot stores the sent text (existing `prompt` field) + an
  `enhanced` flag (schema slot exists).
- Never automatic, never silent, never for other engines.

---

## 6. Refs (CORE) + v2v

### 6.1 Refs
- MSR file ships in every variant download (law 2). The Clip Gen refs box never greys for LTX;
  cap = descriptor `maxRefImages` from probe P2.
- Graph: MSR node/LoRA applied ONLY when refs are attached; ref-less renders run the pure standard
  graph. Invisible to users.
- Emitter: when refs attach, subjects are named with concrete identifiers in the prose (MSR sample
  prompts are the reference; exact binding grammar pinned by P2).
- If MSR v1 fails a tier (e.g. GGUF quants), we hunt alternatives until refs work everywhere LTX
  runs; a tier without working refs does not ship its LTX row as "ready". (User decision 2026-08-21.)

### 6.2 v2v — restyle only
- Focus = prompt-guided restyle of a source window (the Omni Flash surface). Upscale (official
  IC-LoRA upscaler) and DubIt are PARKED as later features by user decision.
- Probe P4 builds the community IC-LoRA restyle graph; on pass, `ltx25.v2v` fills (maxInSec,
  minInSec from probe; prices 0 → panel shows "local render"; promptHint written from probe
  findings) and LTX joins VEDIT_ENGINES. On fail, LTX stays out of Video Edit at launch and lands
  in the first passing update. VideoEditor code paths for other engines untouched either way.

---

## 7. LoRA shelf

- **Browse**: Models card loras section becomes a live Civitai browser: search box, filters
  (base model, sort by downloads/newest, type), thumbnail + name + author + download count + base
  tag per card, FAVORITES (pinned to top, persisted in settings). Query:
  `baseModels=LTXV 2.5` + `LTXV 2.3` (2.3 rows tagged "2.3 · compatible").
- **Install**: one click → file into `userData/models/loras/` + a JSON sidecar (civitai id, name,
  thumb URL, trigger words, base model, hash). Local files dropped in the folder appear too
  (refresh; delete per row — the card's existing row grammar).
- **Civitai auth**: [P5] if downloads need a key, ONE optional paste-once Settings field, shelf-only.
- **Use**: Clip Gen gains a LoRA picker (LTX only, greyed otherwise): pick installed LoRAs, weight
  slider 0-2 each (PromptData.loras — schema slot EXISTS already, verified). Graph chains loader
  nodes in pick order. Trigger words render as chips when a LoRA is active; tap inserts into the
  freeform prompt. No silent injection.
- Take snapshots freeze the LoRA mix (name + weight) — existing store-everything law.
- Card-wide UI polish beyond this section: parked to a later pass (user decision).

---

## 8. Probes (all run before their dependent code ships; results update this spec in place)

| # | question | pass gate |
|---|---|---|
| P1 | Graph shootout on the 16 GB bench: candidate workflows (official template, community graphs, our wiring) scored on features + quality + speed; tier table speeds/VRAM per variant; fps ladder; auto-duration; max duration; audio-off; seed repro; resolution label mapping | a winning graph chosen on evidence; t2v + i2v land takes at standard tier; table filled with measured numbers |
| P2 | MSR: file type (LoRA?), max refs, quality, distilled + GGUF compat, prompt binding grammar | ref2v with 2 refs, subjects recognizable, on standard tier |
| P3 | Enhancer: model runs in-worker, output quality, latency | button round-trip < ~15 s, output is guide-shaped prose |
| P4 | v2v restyle: community IC-LoRA graph, window caps, quality | restyled window is recognizably source-derived + prompt-obedient |
| P5 | Civitai: download auth requirements, API stability, trigger-word metadata shape | one-click install lands a working LoRA with sidecar |
| P6 | LoRA stacking: 1-2 Civitai LoRAs (incl. a 2.3 one) on distilled + on GGUF | visible LoRA effect, no crash, weights behave |

Probe scripts live in `scripts/` beside the existing probe corpus; probe outputs are disposable.

---

## 9. Build phases (each lands separately, app stays shippable between)

1. **Engine**: ltxLocal.ts install (Comfy checkout + pins) + worker spawn + card rows + delete/cancel.
2. **Downloads**: variant ladder rows + wizard table + integrity checks. (P1 runs here.)
3. **Render path**: local branch in render:run, graph templates t2v/i2v/flf2v, progress, cancel,
   takes land. `prose` emitter + lint. Descriptor un-hidden BEHIND a ready-check (LTX appears in
   pickers only when an LTX variant is installed or downloadable — gating law: visible, disabled
   with reason, never hidden... final picker behavior copied from the Score sibling).
4. **Refs**: MSR in every bundle, conditional graph, emitter binding. (P2 gates.)
5. **New dials**: fps + quality tier generic fields, wired for LTX, greyed elsewhere. Enhancer
   button. (P3 gates the button.)
6. **LoRA shelf**: browser + favorites + picker + trigger chips. (P5/P6 gate.)
7. **v2v restyle**: Video Edit entry. (P4 gates; ships only on pass.)

Acceptance (the session goal, user's words): select LTX in the Clip Gen dropdown, use refs and the
normal workflow, generate locally, take lands like any other engine, on any local GPU tier.

---

## 10. Open items

- [P-size] fields in §1's table: read at download time from mirror content-length; registry sizeNotes
  updated when P1 pins the bundles.
- VAE choice: quality VAE default; conv VAE as a speed dial only if P1 shows a real win.
- NVFP4 tier: needs a 50-series probe machine (the dev bench is one). Ships hidden-behind-GPU-check.
- Audio refs / audio-to-video, Retake, DubIt, official pixel upscaler: parked, named, not scoped.
- Multishot beyond 4 beats, long-video chaining: post-launch exploration.
