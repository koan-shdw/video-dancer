# IMAGE GEN — Krea 2 on his GPU, LoRA sidebar, PNG settings import

Date: 2026-09-08 · Status: SPEC FOR REVIEW (rev 5 — his layout, chat 2026-09-08) — no code until GO.
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
  **Image Edit (Nano, as is) and Image Gen (Krea 2, new panel on Image Edit's frame — §4).**
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
  drop down i guess: image" · "model card can contain the krea checkpoint download wizard" · "official
  download with wizard, because im not the only one using this app" · "a search civita for checkpoints for
  krea2 … a field under the official which shows civitai checkpoints with download option" · "i want the
  model i have installed" (= unStable Dissolution KREA2 Turbo, §2) · "also want official as option".
- PNG: "we drag it into the [reader], so like a 'drop png here to read' space and it brings up what it's
  read from the prompt under it with an insert button … the prompt also shows which lora was used we can
  manually do the lora".
- Negative: turbo runs at cfg 1 → inert; his model is a Turbo finetune → **no negative field** (closed).

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
  CFG 1 = the negative is ignored (raw Krea 2 would take cfg 3 / ~20 steps — not shipped; he chose turbo only).
- [V] **His checkpoint** (file sha256 → Civitai by-hash, 2026-09-08): **unStable Dissolution KREA2 Turbo**,
  version "🟣 bf16" id 3081800, model 2740384, type Checkpoint, base "Krea 2", published 2026-06-29;
  `unstableDissolution_Bf16.safetensors` 25,039,262 KB sha256
  `be2cb608739acadfaa8f3abe3de82b25876111ca7ec6005f4c6116c77a32e7aa`,
  `https://civitai.com/api/download/models/3081800?fileId=2961300` (key-gated like every Civitai
  download). Sidecars beside it (`.civit.info`, `.preview.png`, 18 preview jpegs) = his downloader's
  layout, which §5.3 reads.
- [V] Civitai checkpoints for Krea 2 = `GET /api/v1/models?types=Checkpoint&baseModels=Krea 2` (same
  endpoint, same key gate, same `images[]` previews; versions carry files with sha256).
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

1. **New panel: Image Gen.** Image Edit's frame, his order (§4): image big · refs · prompt · settings + lora stack · takes; LoRA sidebar where the tree was. Image Edit itself untouched.
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
8. **No negative field.** Turbo (official and his finetune) runs at cfg 1 → negative inert. Closed by him.
   The graph's negative = `ConditioningZeroOut(pos)`, his graph's shape.
9. **Model = official OR civit.** Official Krea 2 turbo rows (wizard-gated, sha-pinned) AND a civit
   checkpoints row under them (§7) — both appear in the card's MODEL dropdown. His daily driver is a civit
   checkpoint; other users get the official download. Both are his words.

---

## 4. The Image Gen panel (Image Edit's shape, his order — chat 2026-09-08)

His words: "we use this [Image Edit] as basis · image big · under it refs · prompt · aspect ratio, amount
of renders, seed · then what's new is the lora stack to the right of seed with its weight sliders with
numbers · replace the sidebar, the current tree for outputs, with the lora sidebar · new addition to the
far right of the blank space to the right of where refs is: the drop area for PNGs, it brings up a
contextual menu once the prompt is loaded asking if you want to send to prompt" · "model yes left of
aspect" · "outputs as takes, they appear under the settings at bottom of the area, new row, same grammar
as takes".

Panel `panels/ImageGen.tsx` (tab **Image Gen**, beside Image Editor). Copy of `ImageEditor.tsx`'s frame:
left column = image + controls, right column = sidebar, same `ResizeHandle`, same black image ground,
same title line top-left (`@title (take n)`). A gen job (`ImageGenJob`, `project.imageGens[]`) is what the
panel edits; empty panel = `EmptyState` + `FloatPick` of existing jobs ("no image gen open — double-click
one"), none yet = "＋ new starts one".

Top to bottom, left column:

1. **image** — big, the selected take (last rendered by default), Image Edit's canvas. Top-right corner
   buttons: `★ → Library` (copies the PNG into images/, the Image Edit ★ path) · `open in Image Edit`.
   Nothing rendered yet = the canvas line "write a prompt and generate".
2. **refs row** — Image Edit's refs row verbatim (label `refs`, square chips / dashed drop box, drop from
   the Library or `@`), capped at **2**: chip A = scene, chip B = subject (the pack's order, said in the
   chip tooltip). Under each chip its **boost** number (FloatPick 0–5: A → `ref_boost`, default **2.1**;
   B → `ref_boost_a`, default **1.0** — his graph). **REF switch** at the row start (his "ref off
   switch"): off = the ref path leaves the graph (plain t2i), chips stay, greyed. Third drop refused:
   "Krea 2 takes two refs (scene, subject)".
   **PNG drop box** — far right of the same row, in the blank space: a dashed 148-grammar box reading
   `drop png here to read`. Drop / click-pick a PNG → it reads (§8) → a **context menu** pops at the box
   (the app's `ContextMenu`): `send to prompt` · `loras used: <name × w>, …` (rows, each `use` when in the
   folder, `search civit` when not) · `close`. Nothing is applied until `send to prompt`.
3. **prompt** — Image Edit's textarea + `@` mentions + the resize handle above it. Trigger-word chips of
   the picked LoRAs sit over it (Clip Gen's picker grammar: tap inserts, ✓ when present). No negative.
4. **settings row** — left to right: **MODEL** Dropdown (groups *official* = installed Krea 2 variant
   rows, *civit* = installed civit checkpoints by their Civitai name; default = last used, first time =
   best installed; nothing installed = greyed "download Krea 2 in the Models card") · **aspect**
   Dropdown with glyphs `1:1 · 3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · 21:9` + **size** `1 · 1.5 · 2 MP`
   (turbo ceiling 2 MP; sides to a multiple of 16 [P2]) · **renders** Dropdown 1–4 (= `batch_size`) ·
   **seed** — Clip Gen's dial (`random` | number) · then, **to the right of seed, the lora stack**:
   - **LORA switch** (his "lora off switch") at its head; off = no user LoRA in the chain, picks kept.
   - **slot 1, slot 2** — each: name · weight slider 0–2 with the number beside it · ✕. Filled by the
     sidebar's `use`. Empty slot reads "← use one from the sidebar".
   - **unleashed** — fixed third row, `krea2filterbypass3` toggle + slider (default on, 1.0 — his
     graph); greyed "not in your folder" until the file exists there. Never bundled. His name stays.
   - `generate · local render` at the row's right end (Image Edit's button position), busy = Image
     Edit's "generating…"; the status line under the row (Image Edit's `vd-hint`) carries progress /
     red error / "waiting for the engine" when LTX holds it.
5. **takes row** — bottom of the left column, the `panels/shared/takeRows` grammar (the Clip Gen / Voice
   Gen rows, image faces): thumbnail · seed · time · loras in the tooltip (`c23b995` grammar). Click =
   the big image shows it. Right-click: ★ keeper · `→ Library` · `open in Image Edit` · reveal · delete.
   Every render of a batch = its own take. Snapshot stores model · size · seed · loras · refs (ids +
   boosts) · prompt — exactly what ran.

Right column = the **LoRA sidebar** (§5) — it REPLACES Image Edit's results tree in this panel. Its
head keeps Image Edit's `image (@title)` name field + ⧉ / 🗑 buttons (rename · duplicate · delete the
job) so the frame reads the same; under that, the browser.

## 5. The LoRA sidebar (his design)

The right column of the Image Gen panel — Image Edit's tree column, same width, same `ResizeHandle`,
**collapsible sideways** (collapsed = a 22 px rail with a `‹ loras` tab). Width persists in the layout
store. His words: "replace the sidebar, the current tree for outputs, with the lora sidebar".

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
unet   UNETLoader(<official variant | civit checkpoint file>)   weight_dtype default
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
neg    ConditioningZeroOut(pos)          (cfg 1 — his graph's shape)
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
- **civit checkpoints** row, directly under the official rows (his words: "a field under the official
  which shows civitai checkpoints with download option"): a search field (`types=Checkpoint ·
  baseModels=Krea 2`, sort downloads/newest, favorites toggle when signed in) → result rows on the
  sidebar's row grammar (hover-scrolling preview thumbnail · name · version · size · **download** /
  **installed**). Download = the wizard's gates (disk + VRAM check on the file's size, single-stream +
  sha256 from the version's file hash, Bearer key), lands in `userData/models/image/civit/<versionId>/`
  with our sidecar (name · version · base · sha · previews), and joins the card's MODEL dropdown under
  **civit**. The essentials row is shared by both (encoder · VAE · identity LoRA come from the official
  pins). Worked example = his unStable Dissolution bf16 (§2): 25 GB on a 16 GB card — the wizard WARNS
  ("bigger than your card — runs with RAM offload, slower") and lets him pass; it never blocks (his order
  2026-09-08: "warn"). It runs on his 5080 today — [P3] measures it.

---

## 8. PNG settings import — "drop png here to read"

**Entry (his flow):** the **drop png here to read** box at the far right of the refs row (§4.2). Drop or
click-pick any PNG (made in another Comfy, not imported into the Library). Library image right-click
`⎘ use its settings` = the same reader fed with that file (glyph enters the bible table first).

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

**Read result** = a **context menu** at the box (his words: "it brings up a contextual menu once the
prompt is loaded asking if you want to send to prompt"), the app's `ContextMenu`: first entry `send to
prompt` (the read prompt's first line as its hint), then a divider, then one row per LoRA used — `name ×
weight` with `use` (in the folder → slot 1/2) or `search civit` (not in the folder → the sidebar's civit
list with the name as the query) — then `close`. Model · size · seed · steps are NOT shown and NOT
applied (his order: it fills the prompt and tells the loras, nothing else).

**send to prompt** fills the **prompt field** with the read prompt. Nothing else is touched — no seed,
no size, no model, no slots (his words 2026-09-08: "doesn't replace anything, it just fills in the prompt
and lets you know what loras were used"). LoRAs go in by hand through the menu rows.

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

1. **Ref weights** = the node's two dials (A `ref_boost` 2.1, B `ref_boost_a` 1.0). Right reading of
   "weights visible"?
2. **License chip** wording — LICENSE.pdf not read yet.
3. **Sprite-dancer**: only the two shelf-engine changes (§5.6) land there this session. OK?

CLOSED by him 2026-09-08: negative field (none — turbo cfg 1) · model = official rows + civit checkpoints
row, both in the dropdown · refine prompt gone · PNG insert fills the prompt only, LoRAs shown and added by
hand · wizard warns on over-VRAM files, never blocks.

## 12. Probe results (overnight 2026-09-09 — the GO build)

- **P1 PROVEN** (read from `KREA 2 REF.json`, links into the subgraph instance node 99): the live
  sampler chain in ref mode = UNET → [style LoRA when "Enable LoRA"] → Power Lora (krea2filterbypass3)
  → Identity Edit v1.2 → Krea2EditModelPatch → KSampler. Trigger word concatenated onto the prompt
  when the LoRA is on. `buildGraph` follows this order. Ref A also feeds `source_latent` via VAEEncode.
- **P2 PROVEN** — the app's engine (bundled ComfyUI v0.33.3 + krea2edit @223a938 landed) rendered
  the app's graph: t2i fp8 · 3:2 · 1 MP (1216×816, multiples of 16 accepted) · 8 steps · 18 s
  cold; ref mode (style LoRA 0.5 + unleashed 1.0 + identity + patch, two refs, boost 2.1/1.0,
  grounded encode 768) · 43 s — the goblin + horned woman from ref A restaged on the prompt's
  cliff at dusk (identity held). `CLIPLoader type krea2`, `Krea2EditModelPatch`,
  `Krea2EditGroundedEncode` all present on 0.33.3. Loader names must use the OS separator
  (Comfy validates against its own listing — `KREA 2\x\x.safetensors`); `comfyName()` does it.
- **P3 measured** on his 5080: device VRAM at peak 16.5–16.6 GB of 17.1 (Comfy fills the card;
  fp8 + encoder + identity + 2 refs fits at batch 1). Batch 4 t2i fp8 · 1 MP: 60 s, peak 16.1 GB, four files — batch fits on 16 GB.
- **P4 PROVEN** — HF mirror `conradlocke/krea2-identity-edit` v1_2 sha == Civitai sha
  (`6adf9a69…`), 302 to the CDN keyless → HF is the essentials pin. All six staged files sha-verified.
- **P5 PROVEN** — by-hash from the app's transport (node fetch): Purple Grainy → "Krea 2", 10
  previews; krea2filterbypass3 → "Krea2FilterBypass" · Krea 2; Frazetta_E14 → tagged
  **ZImageTurbo** by Civitai although it lives in his KREA 2 folder → the LOCAL tab shows every
  folder file (his folder outranks the tag; the base chip says the family). Checkpoint browse
  `types=Checkpoint&baseModels=Krea 2` answers (Moody Krea 2 Mix, Muse By Stable Yogi …).
  Python urllib is 403'd by Civitai (UA); node fetch is not. Favorites with his key: UNTESTED
  (key is encrypted in his settings — his click in the sidebar is the test).
- **P6 PROVEN** — 120 of his outputs: 116 ComfyUI `prompt` graphs + 4 A1111 `parameters` read;
  a `KREA 2 REF` output gives prompt · loras (Solar Eclipse ×0.6, krea2filterbypass3 ×1,
  identity ×0) · model unstableDissolution_Bf16 · seed · 840×1256 · 8/1/euler/simple; an A1111
  file gives prompt · DETAILCORE lora ×0.8 · Krea2Turbo · 1344×1776. Our own probe PNG reads back.
- UNTESTED (needs his hands): the panel in the running app (typecheck + build clean, no GUI run
  tonight), the sidebar folder pick + scan, civit download with his key, the wizard dialogs,
  drag take → Library, the Library right-click reader entry.


---

## 13. Build plan — the overnight GO (his GO 2026-09-08, evening)

Add to §4.5 (his words "can drag from results into library"): **takes drag into the Library** — the
Voice Gen take → Bin drag grammar; drop = the PNG copies into `images/` as a Library image with lineage.

Order, unattended, every step reports PROVEN / UNTESTED / STOPPED in the morning note:
0. Downloads in the background first: target = the app's models folder, `image/krea-2/` (+ `image/civit/
   3081800/` for his checkpoint). Files already on `I:\models` are sha256-checked against the pins and
   COPIED; mismatch/missing = downloaded single-stream with the sha gate. krea2edit zip @ `223a9383` into
   the engine's custom_nodes. C: free space checked first — short = copy stops, nothing else stops.
1. Probes P1–P6 (§10). A failed probe blocks only its dependents.
2. Engine: krea2edit pack + stamp bump + update path. Models card: category image, Krea 2 parent +
   variants + essentials, civit checkpoints row with his unStable Dissolution bf16 listed as installed.
3. `krea2Local.ts`: the built graph (§6), takes into the project.
4. Image Gen panel (§4) + LoRA sidebar (§5) + drag takes → Library.
5. PNG reader (§8).
6. Settings Civitai sign-in line; Bearer header; koan-shared `civitaiSearch(baseModels)` (drift.mjs first,
   sprite-dancer builds clean).
7. Typecheck + build clean; one headless render through the app with refs + a LoRA lands as a take.
   Nothing committed. Report in his format.
Rules: his app closed before core edits; nothing touched outside vi-dancer, koan-shared, the models
folder; no Civitai key needed (every Civitai file is on I:); spec gaps stay OPEN in the report.

---

## 14. Co-Director reach into Image Gen (his order 2026-09-09: "can codirector edit the image gen field?
yes — and make sure codirector knows about it; also add codirector's ability to add and remove references")

Status: SPEC FOR REVIEW — no code until GO.

**What exists (read 2026-09-09):** Co-Director's tools live in ONE registry (`src/main/codir.ts` `TOOLS`
+ `runTool` + `liveDetail`), served to both lanes (API engine and the Claude-Code bridge via
`codirMcp.ts`). Writes go through project.ts mutators (undoable, delta-merged), behind the go gate.
`buildCoreContext` is the INDEX the model reads: brief · Library @titles · styles · char sheets ·
folders · clips (one line each) · "Where the user is" (selected clip + the tether focus line).
`set_clip_refs` is ADD-ONLY by guard rail (the guide says: "only the user can remove refs").
The guide `src/main/guides/codirector.md` "Your reach" lists every write it may do.

**14.1 Two tools (the clip pair's shape, nouns changed):**
- `set_image_gen_prompt` — `{ image_gen_id, prompt }`: replaces the Image Gen job's prompt (the
  one field; no negative exists). Live line: `image gen "<name>" · prompt · <snippet>`.
- `set_image_gen_refs` — `{ image_gen_id, a?: "@title" | null, b?: "@title" | null }`: sets ref A
  (scene) and/or ref B (subject) by @title; `null` REMOVES that slot; a key not given is untouched.
  Titles must exist in the Library (the set_clip_refs check). Live line: `image gen "<name>" ·
  refs · A @x · B —`. The REF switch itself stays the user's (it is a render dial).
- Both return the standard confirmation text; both are undoable by the user (project.ts
  `setImageGenData` — already built, the panel uses it).

**14.2 The model can SEE image gens:** `buildCoreContext` gains
`## Image gens (Krea 2, local)` — one line each: `- image gen "<name>" id=… · prompt "<first 80
chars>" · refs A @x / B @y · <n> takes`. `read_object` gains kind `imagegen` → the full recipe
(prompt, refs, model, aspect, size, loras by name, seed) and the takes list (seed · size · ★).
"Where the user is" gains `Open image gen: "<name>" id=…` when the panel has one open (the
renderer sends `editorImageGenId` beside `selectedClipId`).

**14.3 Tether:** `TetherKind` gains `imagegen` (path `prompt`); the Image Gen prompt box carries
the tether attribute so ⌖ proposals land there like a clip's freeform. `focusLine` names it:
`image gen "<name>" (image_gen_id=…) — its prompt`.

**14.4 The guide knows (his words: "make sure codirector knows about it"):** `codirector.md` gains,
under "How the app maps to prompts": *IMAGE GEN = Krea 2 on the user's GPU: ONE prompt field
(plain text-to-image prose — no YAML, no beats, no negative), up to two reference images (A =
the scene, B = the subject; the identity-edit path keeps the people in A/B and restages them on
the prompt), loras and sizes are the user's dials.* Under "Your reach": *image gens
(set_image_gen_prompt / set_image_gen_refs — add AND remove A/B; the REF switch, loras, model,
render stay with the user — generation SPENDS GPU time, propose it, the user fires it).* The
Statutes apply as written (the reference speaks first; lineage in chat, craft in fields).

**14.5 Clip refs — OPEN (his call):** his order says "add and remove references". Today clip refs
are add-only by design (a partial list must never strip refs the storyboard depends on). Two
readings: (a) Image Gen A/B only (this section) — clips stay add-only; (b) clips too: a new
`remove_clip_refs { clip_id, image_titles }` (explicit removal by name, never by omission — the
guard rail holds). CLOSED 2026-09-09: **both** — Image Gen A/B set/remove + `remove_clip_refs` on clips.

**Build:** codir.ts (2 tools + index + read_object + focusLine) · codirector.md (2 paragraphs) ·
tether.ts + ImageGen.tsx (tether attr) · codir send args (open image gen id). Probe: one exchange
in the app — "put the goblin on ref A and rewrite the prompt for dusk" lands both writes.

---

## 15. 2026-09-09 morning — his side-by-side + the monitor law

**Re-cut (his order: "clip gen is better, point out your errors"):** the Image Gen panel now wears
Clip Gen's grammar one for one — bordered section cards (PROMPT · MODEL · TAKES) with uppercase
legends, `.field` label wrappers, IMG drag boxes A/B in the "＋ drag" square with the boost under
each (A default 2.1), the PNG reader box beside them, the lora stack as the shelf picker's chips
(no bare sliders), Clip Gen's take card (thumb · bold T1 · size right · "model · date" under · ★
keeper · amber selected · OFF badge · wrapping grid · "⑂ edit · image editor" cell last), the
sticky footer hero "▶ Generate (adds a take) · <model> · local render" + "＋ Queue" (an in-panel
line, one render at a time, "now" jumps it) + the status line, the ✕ reason line. Model names
come from the civit sidecar (his staged checkpoint got its `civit.json`). Sidebar rows lighter
(hairline separators, 44 px thumbs, one meta line); the "loras ›" button left the stack — the
sidebar folds from its own head.

**Co-Director (§14) BUILT:** `set_image_gen_prompt`, `set_image_gen_refs` (null removes),
`remove_clip_refs` (explicit names, never omission — 14.5 closed as BOTH); the index lists image
gens (RLM core: one line each; full context: the whole recipe), `read_object` dumps one, "Open
image gen" line rides the send (`openImageGenId` beside `selectedClipId`), tether kind `imagegen`
on the prompt box with commit, guide paragraphs (what Image Gen is · what it may write).

**Monitor law (his order 2026-09-09): "all monitor windows should have the same resize, and
timeline player and timecoding as clip gen app wide — image monitors only need the resize."**
Built: `previewH` persists per monitor (`render · clipEdit · sheet · imageEdit · imageGen`,
settings keys `previewH*`); Clip Gen's `ResizeHandle` under the Video Editor preview, the Image
Editor canvas and the Image Gen image; Sheet Gen's take preview gets the shared `JogBar` (Clip
Monitor canon: scrub · in/out · timecode · play · mute — the same widget the Video Editor runs)
in place of its two buttons. Clip Monitor and Timeline Monitor fill their panels and already
carry the player — no handle added there (he did not ask).

UNTESTED in the running app: every item above. Typecheck + build clean.

## 16. 2026-09-09 midday — his live orders, all BUILT (typecheck + build clean, uncommitted, his eyes = the gate)

- Refs row (his design): "scene"/"subject" INSIDE the boxes, boost field beside each with the label
  ABOVE, REFS checkbox level with the box top, boost field narrow (fits "2.1"). PNG box unchanged.
- Score Gen: compose + ＋ beat moved INSIDE the beats card on Clip Gen's toolbar row.
- Sidebar: trigger-word chips wrap, no sideways scroll.
- LoRA downloads (his order): each in ITS OWN folder inside the download folder — the .safetensors,
  `<stem>.civit.info` (the raw version object), `<stem>.preview.jpg` + `<stem>_n.jpeg` previews.
  No folder set = the first download opens the picker, then runs. Main `civitai.versionRaw`/`fetchPreview`.
- Image gens = Bin citizens: `Folder.kind 'imagegen'`, `ImageGenJob.folder`, Foldered kind, tiles
  (keeper take face, double-click → Image Gen, drag → Library as the keeper), right-click rename ·
  duplicate · delete.
- THE BIN (his order): every citizen type in its own bordered, collapsible, DRAGGABLE card —
  clips · timelines · char sheets · style sheets · scores · voices · image gens; collapsed = title ·
  count · the ＋ button (one width, 108 px); order + folds persist (`binOrder`/`binCollapsed`).
  Clips first by default.
- THE LIBRARY: the same cards — images · videos · music (`libOrder`/`libCollapsed`).
- Drawn icons (bible ch. 03 table first): **folder** (Foldered rows, was the 📁 emoji) and **score**
  (Bin tile · Score card button + float faces · Timeline audio lane label · Clip Gen audio chip;
  was the ♪ text glyph). CheatSheet prose keeps ♪ as words.
- Preload changed (`onImageGenFolders`) → his running dev app needed a restart ("onImageGenFolders
  is not a function" = the old bridge).
- §14 add (his order 2026-09-09 "yeah"): the OPEN image gen's refs A/B and its ★ take ride every
  Co-Director exchange as images — API lane base64 under the same 10-image cap, bridge lane as
  paths — labelled "ref A of image gen …" / "the ★ take (Tn, seed) of image gen … — what its prompt
  rendered". `openImageGenPics()` in codir.ts. Library ＋ buttons dropped (double-click imports).

## 17 Field fix 2026-09-19: the 40-minute "loading the model…" (built, typecheck clean, UNTESTED in-app)

His report: Image Gen sat on `loading the model… 2371s`. Cause, from main.log + the engine's `in/` dir:
ref A and ref B were one 4412×6937 JPG (30 MP). The graph VAE-encoded the FULL ref for the patch's
`source_latent` socket → OOM at 12:18:19 → the tiled retry hit a CUDA error → Comfy's own OOM
cleanup raised inside `prompt_worker` and the THREAD died. Process + HTTP server stayed alive, the
job never reached `/history`, the wait loop (exits only on process exit · history error · completed)
counted forever under its fallback label.

- WAIT LOOP: `stepProgress` also scans the engine's log feed (`/internal/logs/raw`, since the job
  began) for `Exception in thread … prompt_worker`. Seen → the job fails at once with a plain line
  (out of GPU memory when the feed says so, refs named when refs rode), and the engine is killed so
  the next render starts clean. A caught OOM (history `error`) already failed correctly; untouched.
- GRAPH: `source_latent` is a required socket the patch never reads when `vae` + `source_image` are
  wired (always): the pinned pack fits ref A in pixel space to the render grid itself and overrides
  it (`comfyui-krea2edit/__init__.py`, `_fit_encode_image`). So the socket now gets a render-size
  copy (`refAFit` = ImageScale area → w×h) instead of the full ref. `source_image` / `image` keep the
  FULL-resolution ref: what the model sees is unchanged, no double resample, no quality cut.
- OPEN: the LTX video wait loop shares the engine and the same blind spot; not touched (not named).
  A 30 MP ref rendering clean end to end is unproven until his press.
- MEGA REFS (his call 2026-09-19: "if mega big then we should make it safer size"): `stageRef` in
  krea2Local.ts. A ref over 4 MP rides to the engine as a ≤4 MP working copy (same aspect, lossless
  PNG, nativeImage `best`); 4 MP = twice the largest render, so the pack's fit-to-render resample
  never gets less than it needs. ≤4 MP, non png/jpg, and EXIF-rotated JPGs (nativeImage ignores the
  rotation Comfy's LoadImage applies) are copied as is. The Library file is never touched.
  PROVEN outside the app on the real crash file: 4412×6937 → 1595×2508, 3.6 MB, 0.5 s, aspect
  0.6360 both sides. UNTESTED in-app.
