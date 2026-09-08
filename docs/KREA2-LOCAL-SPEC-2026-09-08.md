# IMAGE GEN — Krea 2 on his GPU, LoRA sidebar, PNG settings import

Date: 2026-09-08 · Status: SPEC FOR REVIEW (rev 2 — his design, chat 2026-09-08) — no code until GO.
Build homes: renderer = `C:\Claude\koan-shared\vidancer-ui\src` (moved renderer, R0 package spec 2026-09-06);
main process + engine = `C:\Claude\vi-dancer\src\main`; `@koan/shared` only where §6 says (drift.mjs first).

## 0. His brief (his words, in order)

- "run krea2 and loras for image gen, and access loras on [civitai] … we have a good krea 2 image gen with
  ref in [comfy] … run that headless in vdancer"
- "lora from either a local folder we can select and then it shows all lora in there, and also from civit
  using the API to login and see and aso option fto show favorited lora in vcivit, filtered of course for krea2"
- "select a PNG which was made in another comfy and then choose to extract its prompt settings and lora …
  insert them into our prompt"
- "the non destructive image edit of nano works fine … but this is a different beast its generation" →
  **Image Edit (Nano, as is) and Image Gen (Krea 2, new card on Clip Gen's grammar).**
- The card: "prompt, pos and neg · lora stack up to two plus the krea unleashed one · seed select random or
  input · image ref, up to two with the weights visible · lora off switch · ref off switch" + from his
  workflow: aspect and size YES · ref boost dial YES · refine prompt NO ("remove that from workflow
  entirely we have codirector") · trigger words YES, automatic from the LoRA / Civitai · model pick YES ·
  batch count YES.
- LoRAs: "have the civit lora browser as a section in the image gen, its collapsible sideways so it shows
  them all like a side bar, it has two filters one for the loras in the local folder and one for civit, the
  civit ones appear with thumbnails that scroll when mouse over through the lora's previews, it has a
  button under it that says if its downloaded or not, if downloaded it says use if not it says download."
  "two button at top one says local one says civit they toggle" · "the local model location is set either
  first time when nothing is set by clicking on the empty field which has a prompt to say set model, look
  elsewhere in app for grammar on this like empty clip gen before a clip is selected."
- Model: "Krea model can be in the model window like the other big models but give it its own category and
  drop down i guess: image" · "model card can contain the krea checkpoint download wizard".

[V] = verified today (file, live API, his machine). [P] = pinned by a numbered probe (§10) before the
dependent code ships. OPEN = his call (§11).

---

## 1. What exists (verified at HEAD 2026-09-08)

**Clip Gen** (`panels/RenderPanel.tsx`) = the card grammar every gen surface copies (Voice Gen, Sheet Gen):
bordered `Section` cards via `sec(key, title, body)` · name + `＋ new` · MODEL house Dropdown · prompt
textarea · refs strip above the prompt · 148×148 drag boxes for media refs (app law 2026-08-20) ·
`LoraPicker` under the model card (weight 0–2, trigger chips push words into the prompt) · takes via
`panels/shared/takeRows` · red ✕ reason line · hero button with the price · empty state = `EmptyState` +
`FloatPick` ("no clip open — double-click one", items float).

**Image Edit** (`panels/ImageEditor.tsx`): Nano Banana only. UNTOUCHED by this spec.

**Local engine** (`src/main/ltxLocal.ts`): bundled headless ComfyUI **v0.33.3** + GGUF + MSR packs (zip
sha pins) under userData; `ensureLtxWorker` spawns `main.py --listen 127.0.0.1 --port {PORT}
--extra-model-paths-config <yaml> --output-directory out --input-directory in`; `writeModelPaths` writes the
`vidancer:` path block; render = POST `/prompt` → poll `/history/<id>` → copy out; shelf LoRAs chained with
`LoraLoaderModelOnly` in pick order (P6-proven). Registry `shared/localModels.ts` (`LocalModelDef`: id ·
category runtime|video|audio|fx · files[{file,url,bytes,sha256}] · variantOf · links · license); Models
card folds one section per category (`CATS` in `panels/ModelsCard.tsx`) + the wizard (`lib/modelWizard.tsx`
— disk/GPU/variant-recommend, live % gates); `modelStore.download` = single-stream + sha256 gate.

**LoRA shelf** (`@koan/shared`, bible 12.10): `userData/models/loras/` flat, sidecar `<file>.json`
(`LoraSidecar`: source · name · thumb · triggerWords · baseModel · sha256); `civitaiSearch` hard-pins
`baseModels` LTXV 2.5/2.3; `familyOf` LTXV→`LTX`; `LoraPicker` prop `isLtx`; 9 `loras:*` IPC; Civitai key in
Settings; key appended as `?token=` at install. Models card mounts `LoraShelf` (LTX).

**His ComfyUI** [V live]: `I:\Comfy-Desktop\ComfyUI-Installs\KOAN\ComfyUI`, ComfyUI 0.33.2, RTX 5080 16 GB,
models root `I:\models` (`loras\KREA 2\` = 130 files in subfolders; `diffusion_models\KREA2\` = turbo fp8 ·
turbo nvfp4 · unstableDissolution bf16 · kreamania · sinoxedit). Custom node `comfyui-krea2edit` v1.2.2 @
`223a9383` (github lbouaraba/comfyui-krea2edit, Apache-2.0, no pip deps). Workflows: `KREA 2.json`,
`KREA 2 REF.json`, `KREA EDIT.json`.

**His KREA 2 REF graph** [V from the file]: `UNETLoader unstableDissolution_Bf16` · `CLIPLoader
qwen3vl_4b_fp8_scaled type=krea2` · `VAELoader qwen_image_vae` · `ResolutionSelector 3:2 · 1 MP · multiple 8`
→ `EmptyLatentImage batch 1` · style LoRA `Purple_Grainy_Kr2_AM @0.5` behind "Enable LoRA?" + trigger
`zy cinema style` concatenated · ref path `Power Lora krea2filterbypass3 @1` ("unleashed", confirmed) →
`LoraLoaderModelOnly krea2_identity_edit_v1_2 @1` → `Krea2EditModelPatch(vae, source_image=ref A,
source_image_b=ref B, source_latent=VAEEncode(ref A), ref_boost 2.1, ref_boost_a 1, fit)` · cond
`Krea2EditGroundedEncode(clip, prompt, image=ref A, grounding_px 768)` → positive, `ConditioningZeroOut` →
negative · "Use Reference?" switch · "Refine Prompt?" switch (DROPPED per his order) · `KSampler seed · 8
steps · cfg 1 · euler · simple`. The sampler chain order sits in a subgraph the converter could not expand
= [P1].

---

## 2. Verified Krea 2 + Civitai facts

- [V] Open weights `huggingface.co/Comfy-Org/Krea-2`. 12B DiT trained from scratch by Krea; text encoder
  Qwen3-VL 4B (`CLIPLoader type: krea2`); VAE = Qwen Image VAE. License: **Krea AI Community License**
  (LICENSE.pdf in the repo — OPEN §11.5: read before the chip ships).
- [V] Files (bytes · sha256 = HF LFS oids read today):

  | file | bytes | sha256 |
  |---|---|---|
  | diffusion_models/krea2_turbo_fp8_scaled.safetensors | 13,141,730,784 | eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1 |
  | diffusion_models/krea2_turbo_int8_convrot.safetensors | 13,492,686,496 | 8e4eeda70dd5037ab1ba2bef6b417f9f901e26093117cf397f741fc1fdaaf3f1 |
  | diffusion_models/krea2_turbo_nvfp4.safetensors | 7,673,668,448 | 61527003b2d537055494d01bc8efe51d6e86e64192ba23e3721a5647231fe394 |
  | diffusion_models/krea2_turbo_bf16.safetensors | 26,283,332,608 | 78bbf8f4165eda19cea3cb06c78089221932a39e2eed8af9da741f942c47ffb3 |
  | text_encoders/qwen3vl_4b_fp8_scaled.safetensors | 5,242,467,968 | 54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094 |
  | vae/qwen_image_vae.safetensors | 253,806,246 | a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f |
  | loras/krea2_style_reference.safetensors (official) | 457,111,760 | f50df5a9e62e4be8aa926a63dd5bb1a64770c4004f763c1208007ae13daa82b8 |
  | loras/krea2_<darkbrush · dotmatrix · kidsdrawing · neondrip · rainywindow · retroanime · softwatercolor · sunsetblur · vintagetarot> | 469,291,992 each | in the repo tree |
  | (raw model rows: krea2_raw_bf16 / fp8_scaled / int8_convrot — not shipped in v1) | | |

- [V] Turbo recipe (his graph, docs.comfy.org, krea2edit README agree): **8 steps · CFG 1 · euler · simple**.
- [V] `Krea2EditModelPatch`: required `model, source_latent`; optional `source_latent_b, ref_boost (1.0),
  ref_boost_a (1.0), fit_mode fit|crop, ref_boost_mask, vae, source_image, source_image_b`.
  `Krea2EditGroundedEncode`: `clip, prompt, image?, image_b?, grounding_px 768, system_prompt`. Two refs =
  the node ceiling — matches his "up to two".
- [V] Identity Edit LoRA (Civitai model 2761113, conrad_locke, base "Krea 2"): v1.2 version 3139172,
  `krea2_identity_edit_v1_2.safetensors` 1,785,406 KB, sha256
  `6adf9a69cc9502d286db7b69964d37da7e9cfe4b05b4d004bc275f087d3fd3cf`; download needs a Civitai key (401
  keyless). HF mirror `conradlocke/krea2-identity-edit` named in the pack README — [P4] sha check.
- [P3] VRAM: turbo fp8 ≈ 12.5 GB loaded (docs) + encoder 5.2 GB (Comfy offloads after encode). His 5080
  runs this graph today. Ladder for other cards = measured.
- [V] Civitai: base model string is exactly **`Krea 2`** (live query answered with items). `GET
  /api/v1/models`: `types=LORA · baseModels=Krea 2 · query · sort · favorites=true (auth: the caller's
  bookmarks) · limit ≤ 100 · cursor` (full-text `query` needs cursor paging). `GET /api/v1/me` (auth) →
  `username · tier · status`. `GET /api/v1/model-versions/by-hash/<sha256>` (public) → `trainedWords ·
  baseModel · images[] · files[] · model.name · downloadUrl` = the automatic trigger words for folder files.
  Auth = `Authorization: Bearer <key>` (docs: prefer the header; `?token=` is for download tools). Every
  version carries `images[]` = the previews the sidebar thumbnail scrolls through.
- [V] ComfyUI PNG metadata (400 of his outputs scanned): keys `prompt` (API graph, 342) · `workflow`
  (UI graph, 162) · `parameters` (A1111 string, 131) · `generation_data` (178) + per-pack extras.

---

## 3. Decisions

1. **New card: Image Gen.** Copy of Clip Gen's grammar, nouns changed (§4). Image Edit untouched.
2. **One local engine.** Krea 2 runs on the SAME bundled ComfyUI worker as LTX. Comfy queues; a Krea gen
   queued behind an LTX render says "waiting for the engine" (the `bb0689d` grammar). Engine id
   `ltx-comfy-engine` stays; label reads "local engine · ComfyUI".
3. **Engine gains the krea2edit pack**, pinned like MSR: `KREA2EDIT_SHA = 223a9383eabf991cb2120663162441383da50f27`
   (codeload zip → `custom_nodes/comfyui-krea2edit`, no pip step). Stamp gains `krea2edit`; an older
   stamp = the engine row offers "update", the add step runs alone.
4. **Model rows in the Models card**, category **image**, own Dropdown of variants (§7). The shared
   wizard recommends by disk + VRAM + arch, as for LTX.
5. **LoRAs for Krea 2 live in the Image Gen sidebar** (§5), not the Models card shelf (LTX keeps the shelf).
   Files are read IN PLACE from his folder; Civitai downloads land in that same folder.
6. **Cost line** = `local render`. No cloud call on this path.
7. **Refine prompt: removed.** Co-Director owns prompt writing. The `TextGenerate` branch is not built.
8. **Negative prompt** — OPEN §11.1 (he asked for pos + neg; at CFG 1 the negative is inert; default in
   this spec = field present, wired to a real `CLIPTextEncode` negative, note under it "does nothing at
   cfg 1"; a cfg dial is NOT added unless he says so).

---

## 4. The Image Gen card (Clip Gen's shape, his list)

Panel `panels/ImageGen.tsx` (tab name **Image Gen**, beside Image Edit). Empty state = `EmptyState` +
`FloatPick` of existing image-gen jobs ("no image gen open — double-click one"), none yet = "＋ new starts
one". A gen job (`ImageGenJob` in the project, `project.imageGens[]`) = the thing the card edits, as a clip
is for Clip Gen.

Row 1 — **name** + `＋ new` (Clip Gen's row verbatim).

Card **model** (`sec('model')`):
- MODEL — house Dropdown = the installed Krea 2 variant rows (`quality (fp8)` · `standard (int8)` ·
  `compact (nvfp4)` · `full (bf16)`) + his own checkpoints (§7 "own" folder, OPEN §11.2). Best installed
  = default (highest-quality law). Nothing installed = greyed "download Krea 2 in the Models card".
- ASPECT — house Dropdown with ratio glyphs: `1:1 · 3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · 21:9`.
  SIZE — Dropdown `1 MP · 1.5 MP · 2 MP` (turbo ceiling 2 MP per the pack README). Sides rounded to a
  multiple of 16 [P2: his graph used 8].
- BATCH — Dropdown 1–4 (= `batch_size`; every image lands as its own take).
- SEED — Clip Gen's seed dial (`bb0689d`): `random` | typed number; the number that ran is on the take.

Card **prompt**:
- refs strip above the prompt (Clip Gen's), then **prompt** textarea, then **negative** textarea directly
  under it (the KOAN.img "neg under pos" law), note "does nothing at cfg 1" (OPEN §11.1).
- Trigger words: the picked LoRAs' words appear as chips over the prompt (Clip Gen's `LoraPicker`
  grammar — tap inserts, ✓ when present). Source = §5.3.

Card **refs** (`sec('refs')`):
- **REF switch** at the card head (his "ref off switch") — off = the whole ref path is left out of the
  graph (plain t2i), boxes stay visible greyed.
- two 148×148 drag boxes side by side, labels `A · scene` and `B · subject` (the pack's training order),
  drop from the Library or a file; each box has its weight visible under it: A = `ref boost` FloatPick
  0–5 default **2.1** (his graph; maps to `ref_boost`), B = `ref_boost_a` 0–5 default **1.0** (his graph).
  ("with the weights visible" — his words; these are the two dials the node exposes.)
- Identity Edit LoRA v1.2 is the ref path's own adapter — it rides inside the ref switch, never a slot.

Card **loras** (`sec('loras')`):
- **LORA switch** at the card head (his "lora off switch") — off = no user LoRA in the chain, picks kept.
- **two slots** (his "up to two"): each = name · weight slider 0–2 · ✕. Filled from the sidebar's `use`
  button (§5). Empty slot reads "← use one from the sidebar".
- **unleashed** — a third fixed row: `krea2filterbypass3` toggle + weight (default on, 1.0 — his graph),
  greyed "not in your folder" until the file exists there (it is a folder LoRA like any other, we never
  bundle it). His name for it stays: **unleashed**.
- `▸ loras` collapses the sidebar (§5) open/closed from here too.

Hero — `generate · local render` (busy = Clip Gen's spinner text) + red ✕ reason line.

Card **takes** — `panels/shared/takeRows` image rows: thumbnail · seed · loras (name × weight) in the
tooltip (the `c23b995` grammar) · right-click: ★ keeper · `→ Library` (copies the PNG into images/, the
Image Edit ★ path) · `open in Image Edit` · reveal · delete. Take snapshot stores model · size · seed ·
loras · refs (ids + boosts) · prompt · negative — exactly what ran.

**PNG import** — the prompt card head gets `from png` (§8).

---

## 5. The LoRA sidebar (his design)

A right-hand column inside the Image Gen panel, **collapsible sideways** (`ResizeHandle` grammar from the
Image Edit tree; collapsed = a 22 px rail with a `‹ loras` tab). Width persists in the layout store.

**5.1 Head:** two buttons, `local` · `civit`, one lit (the Clip Gen `t2v | ref2v` toggle pair). Under
them one search field (filters the lit list).

**5.2 local** — the LoRA folder(s) he picked, read in place, recursive (his `I:\models\loras\KREA 2\`).
- Nothing set = the empty-state grammar (`EmptyState bare`): "no lora folder — click to set one" — click =
  directory picker. Set folders show as a header row each (`KREA 2 · 130`) with `✕` (forget, never
  unlink) and `＋ folder` at the bottom (the "＋ LORA" button family).
- Rows: thumbnail (from the Civitai lookup §5.3 or a same-name `.png/.jpg/.preview.png` beside the
  file, else the drawn LoRA glyph) · name · base chip · trigger chips (small) · button **use** (→ the
  first empty slot; both full = replaces slot 2 with the reason in the status line). Rows already in a
  slot show **in use** (click = remove).
- Filter: only Krea 2 family rows show (family from the sidecar / lookup; untagged rows show with an
  "untagged" chip and a right-click `family: Krea 2 | LTX` tag — the shelf's rule).

**5.3 automatic words + thumbs for folder files:** on first sight of a file: (1) read a sidecar beside it
(`<file>.json` ours, `<file>.civitai.info` / `<file>.civitai.json` his downloaders') → trigger words,
base, thumb; (2) none → sha256 the file (once, cached in our sidecar) and `GET
/api/v1/model-versions/by-hash/<sha>` (public) → `trainedWords · baseModel · images[] · model.name`;
(3) no hit = untagged, no words, he types them. Hashing 130 files happens in the background with a
"reading 34/130" line, never blocking the card.

**5.4 civit** — the Civitai browser for Krea 2 only: `types=LORA · baseModels=Krea 2`, search box →
`query`, sort chips `downloads · newest`, **favorites** toggle (`favorites=true`, needs the key; without it
the toggle greys "paste your Civitai key in Settings"). Cursor paging = "more" at the bottom.
- Rows: **thumbnail that scrolls through the version's preview images on mouse-over** (his words:
  `images[]` from the API, one frame per ~0.6 s while hovered, first frame at rest; images fetched through
  the CSP-safe main proxy the shelf already has) · name · author · downloads · trigger chips · button
  **download** (not on disk) / **use** (on disk = a file with that sha in any local folder).
- Download lands in the FIRST local folder (or asks to set one — same empty grammar), single-stream +
  sha256 gate (`modelStore.downloadFile`), Bearer header, progress on the button (`42 %`), our sidecar
  written beside it; the row flips to **use** when done.

**5.5 sign-in:** Settings Civitai row gains the supplier `test` line: `GET /api/v1/me` → "signed in as
<username> · <tier>" / the 401 text. The sidebar's civit head shows the username when signed in.

**5.6 what moves to `@koan/shared`:** nothing new this round. The sidebar is a vi-dancer surface. The
shelf engine's `civitaiSearch` gains `baseModels` as an argument (LTX callers pass what they pass today —
sprite-dancer untouched in behavior, drift.mjs before the move), and the install path sends the key as
`Authorization: Bearer` instead of `?token=`. Both land in sprite-dancer the same session (law).

---

## 6. The headless graph (`src/main/krea2Local.ts`, new)

Mirrors `ltxLocal.ts`: `krea2Installed()`, `pickInstalledVariant()`, `buildGraph()`,
`renderKrea2(args) → {files, seed}`; shares `ensureLtxWorker`, `ltxWorkerScratch`, the `/prompt` +
`/history` loop and cancel. `writeModelPaths` grows `image/krea-2` under `diffusion_models · text_encoders ·
vae` and every picked LoRA folder under `loras` (Comfy resolves subfolder paths natively — his own graphs
use `KREA 2\x\x.safetensors`).

```
unet   UNETLoader(<variant or own checkpoint>)   weight_dtype default
clip   CLIPLoader(qwen3vl_4b_fp8_scaled, type krea2)
vae    VAELoader(qwen_image_vae)
[lora switch on]  slot1, slot2  LoraLoaderModelOnly chain, strength clamped 0–2
[unleashed on]    LoraLoaderModelOnly(krea2filterbypass3, w)
[ref switch on]   idlora  LoraLoaderModelOnly(krea2_identity_edit_v1_2, 1.0)           [P1 order]
                  refA/refB LoadImage (copied to the worker's in/ dir)
                  srcLat  VAEEncode(refA, vae)
                  patch   Krea2EditModelPatch(model, source_latent=srcLat, vae, source_image=refA,
                                              source_image_b=refB?, ref_boost=A dial, ref_boost_a=B dial, fit)
                  pos     Krea2EditGroundedEncode(clip, prompt, image=refA, image_b=refB?, grounding_px 768)
[ref switch off]  pos     CLIPTextEncode(prompt, clip)
neg    CLIPTextEncode(negative, clip)  (empty negative → ConditioningZeroOut(pos), his graph's shape)
lat    EmptyLatentImage(w, h, batch)
samp   KSampler(model, seed, steps 8, cfg 1, euler, simple, denoise 1)
dec    VAEDecode → save SaveImage(filename_prefix imagegen_s<seed>)
```

Outputs → `<project>/images/gen/<jobId>/take_<n>.png`, appended as takes on the job.

---

## 7. Models card — category **image**

`CATS` gains `{ key: 'image', title: 'image' }` between video and audio (drawn Image glyph enters the
bible table first). Rows (`shared/localModels.ts`, `category: 'image'`):
- parent **Krea 2** (logo = Krea's mark, links site · huggingface Comfy-Org/Krea-2 · github; license
  chip after §11.5) — folds like LTX; its **own Dropdown** of variants = the same `variantOf` rows the
  wizard already renders as a dropdown for LTX.
- variants: `quality (fp8)` 13.1 GB · `standard (int8)` 13.5 GB · `compact (nvfp4 · Blackwell only)`
  7.7 GB · `full (bf16)` 26.3 GB — sha-pinned from §2. Wizard: fits-VRAM + arch (nvfp4 needs sm_100+; the
  runtime's GPU probe reports it).
- **essentials**: qwen3vl fp8 encoder 5.2 GB · qwen_image_vae 254 MB · identity-edit LoRA v1.2 1.8 GB
  (source per P4) · official `krea2_style_reference` 457 MB. Every Krea 2 install pulls essentials —
  the ref path ships with the model (refs-are-core law).
- engine row: stamp gains `krea2edit` (§3.3).
- OPEN §11.2: an **own** row = a picked checkpoints folder (same folder grammar as §5.2) whose
  `.safetensors` join the card's MODEL dropdown as `own · <name>`.

---

## 8. PNG settings import — "from png"

**Entry:** Image Gen prompt card head → `from png` (file picker, any PNG); Library image right-click →
`⎘ use its settings` (opens Image Gen with the sheet; glyph enters the bible table first).

**Read** (`src/main/pngMeta.ts`, no dependency): tEXt / zTXt (inflate) / iTXt chunks. `prompt` (API
graph) is the truth; `workflow` only when `prompt` is absent; `parameters` = the A1111 line.
- prompt: `text` of every `CLIPTextEncode` / `Krea2EditGroundedEncode.prompt` / `TextEncodeKrea2OstrisEdit`
  on the sampler's positive side, `PrimitiveStringMultiline` values feeding them, `StringConcatenate`
  resolved (trigger words come out exactly as they ran). Negative = the negative side when it is not
  `ConditioningZeroOut`.
- sampler: `KSampler` / `SamplerCustomAdvanced` seed · steps · cfg · sampler · scheduler.
- loras: every `LoraLoaderModelOnly` / `LoraLoader` (`lora_name`, `strength_model`) + each `on: true`
  entry of `Power Lora Loader (rgthree)`.
- model: `UNETLoader.unet_name` / `CheckpointLoaderSimple.ckpt_name`; size from `EmptyLatentImage` or the
  PNG's IHDR.
- A1111 fallback: text before `Negative prompt:`; `Steps: · Sampler: · CFG scale: · Seed: · Size: · Model:`;
  `<lora:name:weight>` tags + `Lora hashes:`.

**Sheet** (the app's confirm kit): rows prompt · negative · model · size · seed · loras, each ✓ (all on);
loras marked `in folder` (basename or sha match) or `missing → search civit` (opens the sidebar's civit
list with the name as the query). Steps/cfg/sampler shown, not applied (turbo is fixed 8/1 — said on the
row). Button `insert`.

**Insert:** prompt REPLACES the field (undo = the status line's "replaced · undo", one click) — OPEN §11.3
append; negative → its field; seed → the seed dial (typed); aspect + size → nearest listed; in-folder loras →
the two slots (first two; more = the status line says which were left out); `krea2filterbypass3` →
unleashed on with its weight; model → MODEL if the name matches an installed row, else a note.

---

## 9. Honesty rules carried over

"local render" cost line · take stores exactly what ran · progress = Comfy's own `/history` messages ·
queue-wait line when LTX holds the engine · no bundled LoRAs but the identity adapter (it is the ref
path's own part) — unleashed is his file from his folder.

---

## 10. Probes (each pins a [P]; results → §12)

- **P1** — one live run of his `KREA 2 REF` read from his Comfy's `/history` (or an output PNG): the real
  model chain order (style → unleashed → identity → patch, or otherwise). Our chain = what ran.
- **P2** — first headless render on the bundled v0.33.3: `CLIPLoader krea2` + krea2edit nodes present;
  size multiple 8 vs 16 by a 1 MP 3:2 render; batch 4.
- **P3** — VRAM on his 5080: fp8 + encoder + identity + 2 refs, batch 1 and 4 → the ladder numbers.
- **P4** — identity-edit LoRA: HF mirror sha == Civitai sha → HF pin (ungated law); else Civitai + key
  gate with the note on the essentials row.
- **P5** — by-hash lookup on 10 of his folder files (hit rate, words, previews); `favorites=true` with his
  key returns his bookmarks filtered to `Krea 2`; a subfolder LoRA resolves through the paths yaml on the
  bundled engine.
- **P6** — PNG import on three of his files: a `KREA 2 REF` output, a `parameters` file
  (SaveImageWithMetaDataUniversal), a `workflow`-only file.

---

## 11. OPEN — his calls

1. **Negative prompt.** Keep the field (inert at cfg 1, note under it) or drop it? A cfg dial only if he
   asks.
2. **Own checkpoints.** His graph runs `unstableDissolution_Bf16` from `I:\models`. Add an **own** row
   (picked checkpoints folder → MODEL dropdown) or official rows only? One word: own · official.
3. **PNG insert** = replace or append?
4. **Ref weights** = the node's two dials (A `ref_boost` 2.1, B `ref_boost_a` 1.0). Right reading of
   "weights visible"?
5. **License chip** wording — LICENSE.pdf not read yet.
6. **Sprite-dancer**: only the two shelf-engine changes (§5.6) land there this session. OK?

## 12. Probe results — (empty until P1 runs)
