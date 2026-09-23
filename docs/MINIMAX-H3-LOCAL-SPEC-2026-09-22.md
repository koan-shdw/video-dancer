# MiniMax H3 local. Spec 2026-09-22 (THE LIST item 32)

Status: SPEC. Nothing built. His picks are in section 0; open questions in section 8.

## 0. His words and picks

Item 32: MiniMax H3 local, from his workflow
`Desktop\MiniMax_H3_Singularity_DualSampling_The_AI_Brief_EN.json` (The AI Brief, 87 nodes,
two identical copies, modified 2026-09-22 10:36).

Picks 09-22, his words:
- "same as LTX with headless": the app's own headless ComfyUI, no UI, no Manager. One Comfy,
  one venv, one server, one downloader. No doubled plumbing.
- "you're making an app which others can use my card is not the only one": the hardware
  story is a ladder on the Models card, never a gate. "we're creating the wizard the installer
  and running it".
- Encoder: "ability to select either" (int8 or nvfp4).
- Upscale pass: "yes a switch".
- LoRAs: "yes lora stack and just like LTX i want to be able to select from official, local
  and comfy for h3".
- Clip Gen's LoRA section: "redo this local section so it resembles the image gen one with
  weight slider, make them consistent for ltx and h3".
- The side panel: "IF a clip gen selects either local LTX or H3 then make the same lora
  windows as image gen appear on the side, only if the local LORA supported model is
  selected and it will show the loras local, CIVIT, favourited, etc like in image gen but for
  the selected model".
- Models card: "it'll appear in the model window as well right? with its own area?" Yes.

## 1. Facts read 2026-09-22

### 1.1 MiniMax H3 (HF card MiniMaxAI/MiniMax-H3)
33B dense transformer. 24 fps. 4 to 15 s. 768p default (2K is API only). 32 kHz stereo
audio in the same pass. 11 languages. Reference grammar in the prompt: `<Picture n>`,
`<Video n>`, `<Audio n>`, `<Subject n>`, dialogue `<d>[English] ...</d>`, `<pause>`.
License: MiniMax H3 Community License (commercial use needs their approval). Weights are the
user's download, never shipped.

### 1.2 His workflow, decoded (Get/Set nodes resolved)
Model chain: UNETLoader `Minimax-h3_Singularity_ref2va_v1.3_int8` (the FULL build) →
MiniMaxH3MemoryEfficientSageAttentionPatch → ModelAttentionBackend "comfy kitchen attention"
→ BlockSparseAttention (sol-attn, tau 1.3, 0.2 to 0.9, min tokens 12288) →
MiniMaxLowVRAMAttention head_chunks 4 (BYPASSED in his file) → MiniMaxChunkFeedForward
(chunks 2, threshold 4096) → turbo LoRA `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16` ×1
= M1. M1 → `minimax_h3_lms_v1.0_r64` ×0.5 → `h3-realism-people-t2v-i2v-r2v` ×1 = M3.
Encoder: CLIPLoader `qwen3vl_32b_minimax_h3_int8_convrot` type minimax. VAEs: video fp16,
audio fp32.

Conditioning: MiniMaxH3ReferenceToVideo(clip, vae, audio_vae, prompt, width, height, length,
ref_image_size "max", ref_images 0..8, ref_videos 0..2, ref_audios 0..2; ref_video_audios
left empty). Outputs: positive conditioning, the empty AV latent.

Sizes: ResolutionSelector 9:16 at 0.5 MP, multiple 32 → width/height. Frames:
`max(5, round(sec*24)) + (5 - (max(5, round(sec*24)) % 17)) % 17` (15 s → 362).
Upscale factor: the "Resolution Multiplier" float 1.25 is LINKED into the upscaler's scale
(the node's own 1.5 widget is overridden by the link). So: first pass 0.5 MP, upscale ×1.25.

Sigmas: BasicScheduler(M1, simple, 6 steps, denoise 1) → ExtendIntermediateSigmas(steps 2,
start 1, end 0, linear) → SplitSigmas(step 2): HIGH = first 2 steps, LOW = the rest.
SplitSigmas(step 0) on LOW → SPLIT = [sigma at the split] (one value).

Passes (all euler, RandomNoise one seed):
1. Primary: noise, guider(M1), sigmas HIGH, latent = the ref2v AV latent → OUT1 (noisy at the
   split), DEN1 (denoised).
2. Second: noise, guider(M1), sigmas SPLIT (one value = re-noise only, zero steps), latent =
   LatentUpscaler3D(video part of DEN1, ×1.25, align 32, temporal chunking on, bf16, cuda) →
   the upscaled video latent at the split noise level.
3. Final AV: DisableNoise, guider(M3, lms + realism), sigmas LOW, latent = Concat(video from
   pass 2, audio from OUT1) → DENF. VAEDecode(DENF) + VAEDecodeAudio(DENF) → mp4 h264 crf 19,
   24 fps. (A preview branch decodes pass 1; not built.)

So: turbo on every pass; lms + realism on the final pass only. Steps: 6 + 2 intermediate,
split 2 high / rest low.

### 1.2b The workflow's sources (read 09-22)
Video: "This is how Minimax H3 on Steroids Looks like", The AI Brief, 2026-09-22,
https://www.youtube.com/watch?v=HJteqahyEKM. Page:
https://shahzaib632.gumroad.com/l/minimax-h3-plastic-skin-dual-sampling ("MiniMax H3 Plastic
Skin Fix, Dual Sampling Workflow", pay what you want, ships the JSON only).
What they add to the file:
- The realism LoRA's trigger word is `r34l1sm` (his file's prompt starts with it). The engine
  prepends it to every H3 prompt automatically: the LoRA is baked in, its word rides with it.
- Their description says the upscaler is "wired at 1.5×"; the file's live wiring feeds 1.25
  (the Resolution Multiplier float). Section 8 asks which.
- Their requirement line: "16GB+ recommended; lower VRAM may need turbo / lower megapixels".
- Dual sampling is their fix for waxy / plastic H3 skin: the second pass + the realism and
  LMS LoRAs recover pore-level detail. Turbo is "optional".
- File sources match section 1.5 exactly (Singularity, Comfy-Org, fal, Alissonerdx, LBH).

### 1.3 The app's engine (ltxLocal.ts, ComfyUI pinned v0.33.3)
In core at v0.33.3: MiniMaxH3ReferenceToVideo, MiniMaxH3ImageToVideo, EmptyMiniMaxH3LatentAV,
MiniMaxH3SigmaShift (comfy_extras/nodes_minimax_h3.py); ExtendIntermediateSigmas, SplitSigmas,
DisableNoise, RandomNoise, BasicGuider, BasicScheduler, KSamplerSelect, SamplerCustomAdvanced
(nodes_custom_sampler.py); LoadVideo, GetVideoComponents, CreateVideo, SaveVideo
(nodes_video.py); LoadImage, LoadAudio, VAEDecode, VAEDecodeAudio, LTXVSeparateAVLatent,
LTXVConcatAVLatent, LoraLoaderModelOnly, UNETLoader, CLIPLoader, VAELoader.
Autogrow inputs go in the API prompt as dotted keys: `ref_images.ref_image_0`.

NOT in v0.33.3: BlockSparseAttention (comfy_extras/nodes_sparse_attention.py, merged
2026-09-05/06, PRs #15861 #16072, needs comfy-kitchen 0.2.33), ModelAttentionBackend.
The Sage patch node needs the `sageattention` package (2.x from source on Blackwell Windows).
A Comfy issue (#16382) reports sol-attn + the turbo LoRA = artifacts.

### 1.4 Packs (pins)
- KJNodes `kijai/ComfyUI-KJNodes` @ `d3cfe21625e5170126ce06fbfcfe1d88108688c3` (2026-09-13).
  `nodes/minimax_nodes.py`: MiniMaxLowVRAMAttention (model, head_chunks 1..56 default 4;
  "Output is identical to the unpatched model"), MiniMaxChunkFeedForward (model, chunks
  default 2, seq_threshold default 4096; exact), MiniMaxH3TokenCounter. No sageattention import
  at module top. requirements.txt: pillow, color-matcher, matplotlib, mss,
  opencv-python-headless.
- KJNodes also holds his file's Sage node: `MiniMaxH3MemoryEfficientSageAttentionPatch`
  (nodes/ltxv_nodes.py, model → model, no dials). It imports `sageattention.core`
  (per_thread_int8_triton, per_warp_int8_cuda, per_block_int8_triton, per_channel_fp8) and
  `sageattention.<arch>_compile`: sageattention 2.2.0 + triton. Refuses with a clear error when
  sageattention is missing or too old.
- sol-attn pack `Saganaki22/ComfyUI-sol-attn` @ `930a4d6e432ff8b8ed5e30ff2f72519b92d69bdf`
  (2026-08-13, Apache-2.0). NVIDIA Sol-Attn sparse attention as a Triton kernel, written for
  native Windows Blackwell (SM120), pointer kernels on SM86/89/120, TMA on SM90/100/121.
  Needs only torch + triton (`triton.tools.tensor_descriptor`, verified on 3.6.0). Nodes:
  `MiniMaxH3MemoryEfficientSolAttentionPatch`, `MiniMaxH3ScheduledSolAttentionPatch`,
  `MiniMaxH3ChunkFeedForward`, `MiniMaxH3FusedModulation`, `SolAttentionPatch`. Developed on
  ComfyUI 0.30.0, tested 0.30.1; on the app's 0.33.3 = proof at the first render. Measured by
  its author 1.38 to 1.65× faster than Sage on H3.
- Why not the core sparse node from his file: `BlockSparseAttention` landed on ComfyUI master
  2026-09-06 (PR #16072, sha e308cc73…, needs comfy-kitchen 0.2.35) and is in NO tag yet
  (v0.37.0 lacks it). Pinning master would bump the LTX engine too. The Saganaki pack gives
  the same Sol-Attn kernel on the pinned Comfy.
- Windows kernels: `triton-windows` (PyPI, cp311 win_amd64; bundles a minimal CUDA toolchain
  and TinyCC; torch 2.10 pairs with 3.6, so torch 2.11 = `3.7.0.post28`, proof at install).
  SageAttention Windows wheel (woct0rdho/SageAttention v2.2.0-windows.post6, 2026-07-17):
  `sageattention-2.2.0+cu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl` = CUDA 13,
  any torch ≥ 2.10, any Python ≥ 3.10; RTX 50xx kernels bundled (sm100 / sm121 are not).
- Upscaler `LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler` @
  `40316cf008b2fd8663263270669eb4da23f89d2c` (2026-09-17, MIT). Node
  `MinimaxH3LatentUpscaler3D`: latent, model_name (folder `latent_upscale_models`), mode
  "scale by multiplier" → `scale` 1.0..4.0, align 32, enable_temporal_chunking true,
  force_unload true, device cuda, precision bf16. No pip deps.

### 1.5 Files (name · bytes · sha256 · url)
Base tiers (WarmBloodAban/Minimax-h3_Singularity, Apache-2.0 on top of the H3 community
license):
- `Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` · 34,004,507,622 ·
  `551915097b8727537a82f3a2c5acec965165ec84e780b3e9a5f28ce867fddf08` (the workflow's file)
- `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors` · 20,967,647,456 ·
  `412a7b126595a958964193f3b42513d7cf2df4196ef04223a0f05e3622949cce`
- `Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8.safetensors` · 11,767,930,768 ·
  `2a319b6fafbd646c123ac12a28b1908c7468b148a8c03164172b2f72370264ec`
Encoders (Comfy-Org/MiniMax-H3, text_encoders/):
- `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` · 27,141,342,152 ·
  `bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923`
- `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` · 15,687,142,551 ·
  `35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6`
Essentials:
- `minimax_h3_video_vae_fp16.safetensors` · 5,207,808,496 ·
  `7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522` (Comfy-Org vae/)
- `minimax_h3_audio_vae_fp32.safetensors` · 605,254,808 ·
  `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` (Comfy-Org vae/)
- `minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors` · 690,592,992 ·
  `4f57821f5837f32f7142b67d815606dbd7550f194e5c769f7d6c3f83b146a5e6`
  (LBH-123-AI/Minimax_h3_latent_Upscaler, folder minimax_h3_latent_upscaler_3d_conv_v1/)
- `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` · 1,956,193,000 ·
  `5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c` (Comfy-Org loras/)
- `minimax_h3_lms_v1.0_r64.safetensors` · 1,239,664,536 ·
  `16f3195bc6bffa431c0598dc2031e520ba058b4fcbc9f104db9e3fdfdeacf60c`
  (Alissonerdx/Minimax-H3-ComfyUI loras/)
- `h3-realism-people-t2v-i2v-r2v.safetensors` · 131,229,656 ·
  `acc529601d2da117fb81179e76c56e488a3beab1171659d305f04fa3655b787e`
  (fal/MiniMax-H3-Realism-People-LoRA)
URLs = `https://huggingface.co/<repo>/resolve/main/<path>`; pinned to a revision sha at
build time (the LTX rule: never `main` in the registry).

### 1.6 Published runs on 16 GB cards (the ladder's face, not a gate)
- RTX 5080 16 GB (Comfy-Org discussion #18): 10 s at 1344×768, 20 steps, pruned int8 +
  nvfp4 encoder: about 14 min. The transformer streams over PCIe each step.
- RTX 5070 Ti 16 GB (Tomiigo/minimax-h3-16gb): pruned int8 + nvfp4, Comfy 0.30.1,
  `--disable-pinned-memory --reserve-vram 1.5`, 640×384 × 226 frames, 20 steps: 190 s, peak
  7.4 GB under an 8 GB cap.
- RAM: 64 GB comfortable; 32 GB needs `--disable-pinned-memory`.
- Windows: `--disable-async-offload` (VAE decode crash on CUDA 13 without it).
- Blackwell (sm_120): above ~150k tokens the output is noise; under ~90k safe.
  tokens = ceil(frames/4) × (w/32) × (h/32).
- Turbo LoRA: 6 steps minimum (4 = soft + audio corruption). His file: 6.
- 24 GB+: the transformer partly resident, faster. 32 GB+: whole.
- Civitai's base model label for H3 LoRAs: `MiniMax H3`.
- His machine: RTX 5080 16 GB, 62 GB RAM.

## 2. Models card: the MiniMax H3 area

Registry rows (`vidancer-ui/src/shared/localModels.ts`, category `video`, folder
`video/minimax-h3`, the ltx-2.5 shape):
- `minimax-h3` parent. label "MiniMax H3". blurb "video with sound on your own GPU, refs up to
  9 pictures + 3 videos + 3 voices". links: site, huggingface (Comfy-Org), the Singularity
  page. license "MiniMax H3 Community License". LOGOS entry: his pick 09-22 "pink" = MiniMax's
  Hugging Face avatar (the wave mark on the pink-orange gradient, 200 px square), saved as
  `vidancer-ui/src/assets/models/minimax-h3.png`.
- base tiers (variantOf minimax-h3), best first:
  - `minimax-h3-full` "full (int8)" ~34 GB. "the workflow's file. 16 GB cards stream it from
    RAM; 32 GB+ holds it whole"
  - `minimax-h3-pruned` "pruned (int8)" ~21 GB. "smaller, faster to load. the turbo LoRA's
    notes say it wants the full build; proof at the first render"
  - `minimax-h3-w4a8` "small (w4a8)" ~12 GB. "the smallest door; visible quality loss"
- encoder rows (variantOf minimax-h3):
  - `minimax-h3-enc-int8` "encoder int8" ~27 GB. "best; the workflow's file"
  - `minimax-h3-enc-nvfp4` "encoder nvfp4" ~16 GB. "smaller; offloads less on 16 GB cards"
- `minimax-h3-core` "essentials" ~10 GB: both VAEs, the upscaler, the three LoRAs (turbo,
  lms, realism). Chained on any tier or encoder click (the ltx-2.5-core rule), never a chore.
Delete per file (folder rows). Sizes from the pinned bytes.

`models:download` chain (index.ts): `id.startsWith('minimax-h3-')` → `installLtxEngine` →
`landH3Packs` (KJNodes + the upscaler pack into custom_nodes, KJNodes requirements pip'd into
the engine env, idempotent) → `minimax-h3-core` → the row. `models:list` needs nothing new
(registry rows carry their own disk state).

### 2b. The speed kernels row (his order 09-22: "add them now, downloadable and installable")
Row `minimax-h3-kernels` "speed kernels", variantOf minimax-h3, no `files` (install routed by
id like the engine rows). blurb: "SageAttention + Sol-Attn for H3: faster, lighter, a small
quality cost; the card's speed kernels pick turns them on per clip". sizeNote "~300 MB".
Install (`h3Local.installKernels`, the ltxLocal uv shape, Windows only like the engine):
1. `uv pip install --python <engine env> triton-windows==3.7.0.post28`
2. `uv pip install --python <engine env> <the sageattention wheel url above>` (sha pinned at
   the build read, the LTX rule)
3. `landPack` Saganaki22/ComfyUI-sol-attn @ 930a4d6… into custom_nodes
4. stamp `vd-kernels.json`; the row reads ready from the stamp + the pack dir + an import
   probe (`python -c "import sageattention.core, triton"`) so a broken wheel never shows ✓.
Delete = uninstall both packages + remove the pack + drop the stamp. Cancel mid-install =
the ltxLocal cancel shape.
Graph, by the card's pick (section 3): `off` = section 5 as written (LowVRAM on) · `sage` =
`MiniMaxH3MemoryEfficientSageAttentionPatch { model: unet }` first in the chain, LowVRAM off
(his file's arrangement; the Sage path carries the VRAM relief) · `sol` =
`MiniMaxH3MemoryEfficientSolAttentionPatch { model: unet, enabled: true, tau: 1.3,
min_tokens: 12288, sink_conditioning: 'exact_kv_and_rows', strict: false, thresh_type: 'diag',
int8_qk: false, int8_pv: false, dense_blocks: '' }` (his file's sparse numbers: tau 1.3,
12288, exact_kv_and_rows; the rest the pack's defaults) first in the chain, LowVRAM off. Tooltip on the pick: "sage = int8 attention, near-exact;
sol-attn = sparse attention, fastest, a Comfy issue reports artifacts with the turbo LoRA;
off = exact". The Blackwell noise line (section 1.6) applies the same.

Readiness (`lib/h3Ready.ts`, the ltxReady shape): installed bases best-first, installed
encoders best-first, core present. `renderReady` = one base + one encoder + core.

`extra_model_paths.yaml` (ltxLocal.writeModelPaths): the H3 folder joins diffusion_models,
text_encoders, vae, loras, latent_upscale_models.

## 3. The engine in Clip Gen

`EngineId` gains `h3local`. `MODELS.h3local`:
label "MiniMax H3 (local)" · provider local · modes ref2v, i2v (core has both nodes; i2v =
MiniMaxH3ImageToVideo, second round if his test wants it; v1 = ref2v, i2v greyed with the
reason) · endFrame false · maxRefImages 9 · maxRefVideos 3 · maxRefAudios 3 · characterRefs 0
· durations 4 6 8 10 12 15 · resolutions 480p 720p · aspectRatios 16:9 9:16 1:1 4:3 21:9 ·
audioToggle true · seed true · refTagPrompt `PictureN` (new format in compile.applyRefTags:
`<Picture n>`) · promptStyle prose · endpoints {} · pricePerSec {} · notes.

Model dropdown (lib/engineOptions.ts): the ltx25-only helpers (modelOptions, encodeEngine,
decodeEngine, engineLabelFor, missingPinOption) generalise to a LOCAL map
`{ ltx25: ltxReady sizes, h3local: h3Ready bases }`. One entry per installed base tier
"MiniMax H3 (full int8)", value `h3local|minimax-h3-full`; nothing installed = one
"MiniMax H3 (local)" entry whose pick opens the Models card (the modelWizard). The stored
unit stays (engine + `ltxSize`; H3 reuses the same field as its base-tier pin).

Card dials, H3 only, greyed with the reason elsewhere (stable board):
- `encoder`: Dropdown, installed encoders only (int8 first); absent = best installed.
  PromptData `h3Encoder?: string` (row id).
- `upscale`: checkbox, default on, plus a pick beside it: 1.25 (his file's live value) or 1.5
  (the video's text). PromptData `h3Upscale?: boolean` (absent = on), `h3UpscaleBy?: 1.25 | 1.5`
  (absent = 1.25). His pick 09-22: "option on upscale of course".
- `speed kernels`: Dropdown off / sage / sol-attn, default off (quality law: both trade
  quality for speed; his file ran both on, his call per clip). Greyed with the reason until
  the `minimax-h3-kernels` row is installed. PromptData `h3Kernels?: 'off' | 'sage' | 'sol'`.
  Section 2b.
Duration, resolution, aspect, seed, audio, refs: the existing dials from the descriptor.

## 4. LoRAs: the redo, one grammar for LTX and H3

### 4.1 The card block (replaces LoraPicker in Clip Gen's model card)
One component `vidancer-ui/src/ui/LoraChips.tsx`, lifted from Image Gen's `loraChip` block:
`loras` checkbox (on = the picks chain into the model; off = none, picks kept) · one chip per
pick: name · range slider 0 to 2 step 0.05 (amber) · weight · ✕ · `＋ lora` opens the side
panel. Image Gen switches to the same component (its two-slot rule + unleashed row stay as
Image Gen props). Trigger chips (the load-bearing words) keep working: `＋ word` under the
block, tap inserts into the prompt.
PromptData: `loraOn?: boolean` (absent = on). `loras[].name` = a path relative to ANY lora
root (a shelf basename, or `folder/sub/x.safetensors` from a picked folder), exactly what
Comfy resolves. Take snapshots and restore unchanged.

### 4.2 The side panel
`ImageGenSidebar` becomes `LoraSidebar` with a `family` prop:
`{ key: 'krea2' | 'ltx' | 'h3', label, civitBases: string[], tagChoices: string[] }`.
Families: krea2 → ['Krea 2'] · ltx → ['LTXV 2.5', 'LTXV 2.3'] · h3 → ['MiniMax H3'].
Tabs:
- `local`: THIS model's loras only (his call 2026-09-23: one side panel, takes the model;
  whatever model is showing, its loras show). Sources: his picked folders (read in place) PLUS
  the app's shelf folder (`userData/models/loras`, where the Models card shelf installs official
  and Civitai rows). A row's family, first hit wins:
  1. his right-click tag (sidecar `tag`, beside Civitai's `baseModel`)
  2. his folder — FOLDER = FAMILY. `＋ folder` from a family's panel files that folder under it
     (Settings `loraFolderFamily`, path → family; a folder from before = krea2). His 09-09 rule
     stands: a file in his Krea 2 folder that Civitai tags ZImageTurbo still shows under Krea 2,
     its base chip amber.
  3. a shelf row's `baseModel` against the family's `baseRe`
  4. unknown → shows under every model until he tags it
  A civit download lands in the first folder OF THAT FAMILY; none yet = the picker, filed under it.
  Rows: thumb, name, base chip, size, trigger words, `use` / `in use`; right-click: open on
  civitai, examples, reveal, family (Krea 2 · LTX 2.5 · MiniMax H3).
- `civit`: the browser filtered to `civitBases`, sort, ★ favourites (key), download into a
  folder, `use`. Unchanged code, the family comes from the prop.
- `official`: new tab, the shelf's HF scan per family: ltx = Lightricks LoRA repos (the
  existing `officialList`); h3 = the Comfy-Org/MiniMax-H3 `loras/` tree (the turbo variants).
  Hidden when the family has no official source (krea2).
Image Gen passes krea2; Clip Gen passes ltx or h3 from the engine. Clip Gen mounts it as its
right column with Image Gen's `sideW` / `sideOpen` grammar and the `‹ loras` handle, ONLY when
the engine is `ltx25` or `h3local`; any other engine = no column.

### 4.3 The shelf (Models card, @koan/shared LoraShelf)
`MODEL_TABS` gains 'MiniMax H3'; `familyOf('MiniMax H3')` = 'MiniMax H3'; `TAG_CHOICES` gains
it; the official scan takes the family (H3 = the Comfy-Org loras tree). Its render-time weight
scan runs through the shared engine python as today.

### 4.4 The engine's own set (his pick 09-22: "all three as rows default on")
Turbo, lms, realism are installed by `minimax-h3-core` and show on the H3 card as three fixed
rows, Image Gen's "unleashed" row one for one: checkbox + name + weight slider. Defaults from
his file: turbo ×1 on, lms ×0.5 on, realism ×1 on. Off = not chained, weight kept. Placement
in the graph stays his: turbo on every pass (M1), lms + realism on the final pass (M3). The
`r34l1sm` trigger word is prepended only while realism is on. PromptData:
`h3Set?: { turbo: { on, w }, lms: { on, w }, realism: { on, w } }` (absent = the defaults).
User picks from the side panel chain AFTER the set on the final-pass model, in order, at their
weights. LTX unchanged (picks chain after the unet).
Render-time existence check (LTX + H3): a pick's file is looked up across every lora root
(shelf, the family weights folder, every picked folder); a missing file skips OUT LOUD.

## 5. The graph (`src/main/h3Local.ts` · `buildH3Graph`), his workflow one for one

Keys are node ids; inputs verbatim from the core / pack schemas (section 1.3, 1.4).
```
unet   UNETLoader          { unet_name: <base tier file>, weight_dtype: 'default' }
lowv   MiniMaxLowVRAMAttention { model: unet, head_chunks: 4 }
ffn    MiniMaxChunkFeedForward { model: lowv, chunks: 2, seq_threshold: 4096 }
turbo  LoraLoaderModelOnly { model: ffn, lora_name: turbo, strength_model: 1 }        = M1
lms    LoraLoaderModelOnly { model: turbo, lora_name: lms, strength_model: 0.5 }
real   LoraLoaderModelOnly { model: lms, lora_name: realism, strength_model: 1 }
pick_i LoraLoaderModelOnly { model: <prev>, lora_name: <pick>, strength_model: w }   = M3
clip   CLIPLoader          { clip_name: <encoder file>, type: 'minimax', device: 'default' }
vvae   VAELoader           { vae_name: video vae fp16 }
avae   VAELoader           { vae_name: audio vae fp32 }
img_n  LoadImage           { image: ref n }                 (n < 9)
vid_n  LoadVideo           { file: ref video n }            (n < 3)
vidc_n GetVideoComponents  { video: vid_n }                  → images [0]
aud_n  LoadAudio           { audio: ref audio n }           (n < 3)
r2v    MiniMaxH3ReferenceToVideo { clip, vae: vvae, audio_vae: avae, prompt, width, height,
         length: frames, ref_image_size: 'max',
         'ref_images.ref_image_n': [img_n, 0], 'ref_videos.ref_video_n': [vidc_n, 0],
         'ref_audios.ref_audio_n': [aud_n, 0] }             → [0] positive, [1] latent
sched  BasicScheduler      { model: M1, scheduler: 'simple', steps: 6, denoise: 1 }
ext    ExtendIntermediateSigmas { sigmas: sched, steps: 2, start_at_sigma: 1, end_at_sigma: 0, spacing: 'linear' }
split  SplitSigmas         { sigmas: ext, step: 2 }         → [0] HIGH, [1] LOW
split0 SplitSigmas         { sigmas: [split,1], step: 0 }   → [0] SPLIT
samp   KSamplerSelect      { sampler_name: 'euler' }
noise  RandomNoise         { noise_seed: seed }
nonoise DisableNoise       {}
g1     BasicGuider         { model: M1, conditioning: [r2v,0] }
g3     BasicGuider         { model: M3, conditioning: [r2v,0] }
p1     SamplerCustomAdvanced { noise, guider: g1, sampler: samp, sigmas: [split,0], latent_image: [r2v,1] }
sep1   LTXVSeparateAVLatent { av_latent: [p1,0] }           → [1] audio at the split
sepd   LTXVSeparateAVLatent { av_latent: [p1,1] }           → [0] denoised video
up     MinimaxH3LatentUpscaler3D { latent: [sepd,0], model_name: upscaler, mode: 'scale by multiplier',
         'mode.scale': 1.25, align: 32, enable_temporal_chunking: true, force_unload: true,
         device: 'cuda', precision: 'bf16' }                (upscale switch ON)
p2     SamplerCustomAdvanced { noise, guider: g1, sampler: samp, sigmas: [split0,0], latent_image: up }
cat    LTXVConcatAVLatent  { video_latent: [p2,0], audio_latent: [sep1,1] }
pf     SamplerCustomAdvanced { noise: nonoise, guider: g3, sampler: samp, sigmas: [split,1], latent_image: cat }
dec    VAEDecode           { samples: [pf,1], vae: vvae }
adec   VAEDecodeAudio      { samples: [pf,1], vae: avae }
vid    CreateVideo         { images: dec, fps: 24, audio: adec, bit_depth: 8 }
save   SaveVideo           { video: vid, filename_prefix: 'h3_s<seed>', format: 'auto', codec: 'auto' }
```
Upscale switch OFF = his graph minus the upscaler: no `up`; `p2` takes `[sepd,0]` directly
(re-noise at the split, same size), then `cat` and `pf` as above. Same passes, same LoRA
placement, no size change.

Sizes: 480p → 0.5 MP, 720p → 1.0 MP (H3's 1344×768 class); aspect from the pick; both sides
multiples of 32 (the ResolutionSelector rule). frames = his formula from the duration.
Prompt: `r34l1sm` prepended (the baked realism LoRA's trigger), then the compiled prompt with
`<Picture n>` ref tags.
Differences from his file, all named: Sage patch, ModelAttentionBackend and BlockSparseAttention
dropped (section 1.3); LowVRAMAttention ON (his was bypassed because Sage carried the load);
VHS nodes → core video nodes; rgthree stack → LoraLoaderModelOnly chain; ResolutionSelector,
easy float, ComfyMathExpression → computed in code; ref video audio not sent (his file leaves
it empty too).

## 6. Render path

- `ltxLocal.ts`: the submit / poll / progress / error / output block of `renderLtxClip` is
  extracted ONCE into `runGraph(w, graph, opts)` (POST /prompt, /history poll, the step-line
  parser, dead-worker throw, output file pick, executed-graph echo). LTX and H3 both call it.
  Cancel = the same /interrupt.
- `h3Local.ts` (new, small): tier + encoder pick (pinned row or best installed, "not
  installed, rendering with X instead" out loud), packs + core check, refs copied into `in/`,
  `buildH3Graph`, `runGraph`, output copied as `renders/h3_<seed>_<ts>.mp4`. Returns
  `{ file, durationSec, seed, sizeId: <base row>, encoderRow, engineFile }`.
- Worker flags: the spawn gets a PROFILE. H3 profile adds `--disable-async-offload`
  (Windows) and `--disable-pinned-memory` when RAM < 48 GB. LTX keeps its proven set. A live
  worker with a different profile restarts first (the loadedVariantRow rule, one more key).
- Routing (index.ts, the provider local branch): `modelFor(req.engine).id === 'h3local'` →
  `h3Local.renderH3Clip(...)`, else LTX. Refs already resolved by `resolveRefMedia` (videos +
  audios for ref2v). `req.h3Encoder`, `req.h3Upscale` ride the request like `ltxSize`.
- Progress: the sampler step line, per pass (three passes = the counter restarts; the row
  says which pass).
- Token line: for the final pass size, `tokens = ceil(frames/4)·(w/32)·(h/32)`; the queue row
  carries "N tokens" and, above 150k, "above the line where Blackwell cards reported noise".
  A note, never a block.
- Take: engine `h3local`, `sizeId` (base row), `encoderRow`, `loras` snapshot, seed.
- Bible 12.x: the Models card / downloader / runtime / render loop stay the named reference
  copies; the change log line goes in the bible's registry.

## 7. The wizard face (modelWizard, unchanged mechanism)
Picking H3 with nothing installed keeps the pick and opens the Models card on the H3 area.
Every row carries its size and a one-line fit note (section 2). The card's GPU probe line
(VRAM, RAM) already sits there. Nothing blocks on the numbers.

## 8. Settled 09-22 (his words)
1. Logo: "pink" (the Hugging Face avatar). Section 2.
2. LoRA sources = the side panel (local · civit · official). The official tab for H3 lists
   the Hugging Face repos that carry H3 LoRAs, most downloaded first (read 09-22:
   larryvrh/MiniMax-H3-Turbo-Lora, drbaph/MiniMax-H3-Turbo-Lora-ComfyUI,
   lightx2v/Minimax-h3-Turbo (the v1.0 8-step 768p turbos, most downloaded of all),
   Comfy-Org/MiniMax-H3 loras/, fal/MiniMax-H3-Realism-People-LoRA, Alissonerdx/Minimax-H3-ComfyUI,
   Hearmeman/minimax-h3-loras, Jojocodex, rzgar, prithivMLmods, and the rest of the HF search
   "MiniMax-H3"). MiniMaxAI publishes no LoRAs. One row per .safetensors file, sizes + sha
   from the HF tree, exactly the shelf's official-row shape. Civitai's H3 base label is
   `MiniMax H3`.
3. Upscale: switch + a pick, 1.25 or 1.5. Section 3.
4. Speed kernels: "add them now and make them downloadable and installable by users".
   Section 2b.

## 9. Proof plan
- `npm run typecheck` (both repos).
- His test on the 5080: install full int8 + encoder int8 (his file's pair) + essentials;
  render 4 s, 480p, 9:16, one picture ref; then 15 s 9:16 (his numbers); then nvfp4 encoder;
  then an LTX render with a sidebar pick (regression). Each = PROVEN or UNTESTED in the
  ledger.
