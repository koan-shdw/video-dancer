// Local-model registry — the ONE list in code naming every downloadable model the app uses
// (LOCAL-MODELS-PLAN "Models card" settled spec 2026-08-19). The Models card renders straight
// from these entries × the disk state; main/modelStore.ts downloads/deletes by them. URLs and
// file names live HERE and nowhere else (fx.ts reads them through this registry too).
//
// Entries without `files` are known models whose weights can't install yet (they need the
// local runtime, plan phase 3+): the card lists them anyway — gating law: visible, disabled
// with the reason, never hidden.

export type LocalModelCategory = 'video' | 'image' | 'audio' | 'fx' | 'loras' | 'runtime'

export interface LocalModelFile {
  file: string // file name inside the model's folder
  url: string // direct download URL (streams the file) — LTX urls pin a REVISION sha, never main
  bytes?: number // pinned exact size (integrity: a mirror swapping bytes fails the download loud)
  sha256?: string // pinned content hash (the mirror's LFS oid); verified as the stream lands
}

export interface LocalModelDef {
  id: string // stable id; also the folder name (except fx — fx files sit flat in models/fx/)
  category: LocalModelCategory
  label: string
  blurb: string // one plain sentence: what this model does for the user
  usedBy: string // which surface uses it ("Effects", "Clip Gen", "Score", "Voices")
  homepage: string // ↗ opens externally (variants show just this)
  links?: { label: string; url: string }[] // name-line link chips: site / github / huggingface (verified URLs only)
  license: string // shown as a chip; link lives on the homepage
  sizeNote: string // human size shown before download ("~100 MB", "~66 GB", "size TBC")
  files?: LocalModelFile[] // downloadable today; absent = install path not built yet
  needsRuntime?: boolean // true = weights wait for the in-app runtime (plan phase 3+)
  variantOf?: string // this row indents under that parent row (LTX variants)
  folder?: string // shared on-disk home under models/ (LTX sizes share video/ltx-2.5 so common
  // files download once); rows with a folder delete PER FILE, never the folder
}

// list 15 (his "swap it", 09-29): Lightricks re-issued both LTX text encoders on 2026-08-17; the
// comfyicu mirror still carries the 08-13 files and Lightricks' own repo is gated. Found 09-30 by
// hash: open mirrors whose files are byte-identical to Lightricks' current blobs (the sha256 below
// IS the official one, read off the gated repo's public file list). The int8 encoder serves five
// size rows, so its pin lives once here. An install that still holds the old file keeps rendering
// on it; the Models card offers the swap (a present file whose size differs from its pin = update).
const LTX_ENCODER_INT8 = {
  url: 'https://huggingface.co/PulpCut/LTX-2.5-INT8-ConvRot-safetensors/resolve/7597fb305b4cab9e7ff2c1d1e9551279c2932f0f/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
  bytes: 15372969374,
  sha256: '6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f'
}

export const LOCAL_MODELS: LocalModelDef[] = [
  // ---- runtime (user addition 2026-08-19: the biggest hidden download is a visible row) ----
  // No `files`: install is uv bootstrap + managed python (main/runtime.ts), routed by id.
  {
    id: 'python-runtime',
    category: 'runtime',
    label: 'Python runtime',
    blurb: 'the private Python that runs local models — lives inside the app, touches nothing on your system',
    usedBy: 'every local model',
    homepage: 'https://github.com/astral-sh/uv',
    links: [{ label: 'github', url: 'https://github.com/astral-sh/uv' }],
    license: 'MIT / Apache-2.0',
    sizeNote: '~150 MB'
  },
  // No `files`: install is pinned checkouts + uv-built env (main/ltxLocal.ts), routed by id.
  {
    id: 'ltx-comfy-engine',
    category: 'runtime',
    label: 'LTX engine',
    blurb: 'the invisible engine that runs LTX on your GPU — no UI, lives inside the app, versions pinned',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/Comfy-Org/ComfyUI',
    links: [{ label: 'github', url: 'https://github.com/Comfy-Org/ComfyUI' }],
    license: 'GPL-3.0',
    sizeNote: '~7 GB'
  },
  // ---- fx (masking + utility ONNX — the phase-2 proof models, downloadable today) ----
  {
    id: 'matte',
    category: 'fx',
    label: 'Robust Video Matting',
    blurb: 'cuts the subject out of footage — powers matte effects',
    usedBy: 'Effects',
    homepage: 'https://github.com/PeterL1n/RobustVideoMatting',
    links: [{ label: 'github', url: 'https://github.com/PeterL1n/RobustVideoMatting' }],
    license: 'GPL-3.0',
    sizeNote: '~100 MB',
    files: [
      {
        file: 'rvm_resnet50_fp32.onnx',
        url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.onnx'
      }
    ]
  },
  {
    id: 'depth',
    category: 'fx',
    label: 'Depth Anything V2',
    blurb: 'estimates how far everything in the frame is — powers depth effects',
    usedBy: 'Effects',
    homepage: 'https://github.com/DepthAnything/Depth-Anything-V2',
    links: [
      { label: 'github', url: 'https://github.com/DepthAnything/Depth-Anything-V2' },
      { label: 'weights', url: 'https://huggingface.co/onnx-community/depth-anything-v2-small' }
    ],
    license: 'Apache-2.0',
    sizeNote: '~100 MB',
    files: [
      {
        file: 'depth_anything_v2_small_fp32.onnx',
        url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx'
      }
    ]
  },
  // ---- video (LTX 2.5 — docs/LTX-SPEC.md §3: parent row + size ladder, all files from
  // UNGATED mirrors pinned by revision sha + exact bytes, verified live 2026-08-21. Sizes
  // share ONE folder (video/ltx-2.5) so the encoder/VAEs download once across sizes. The
  // `essentials` row carries what every size needs (VAEs, duration head, MSR refs, prompt
  // enhancer) — chained automatically by the download handler, never a separate user chore.
  {
    id: 'ltx-2.5',
    category: 'video',
    label: 'LTX 2.5',
    blurb: 'generates video with sound on your own GPU — free renders',
    usedBy: 'Clip Gen',
    homepage: 'https://ltx.io',
    links: [
      { label: 'site', url: 'https://ltx.io' },
      { label: 'github', url: 'https://github.com/Lightricks/LTX-2' },
      { label: 'huggingface', url: 'https://huggingface.co/Lightricks/LTX-2.5' }
    ],
    license: 'free under $10M ARR',
    sizeNote: ''
  },
  {
    id: 'ltx-2.5-quality',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'quality (int8)',
    blurb: 'the official recipe — best local quality, wants 24 GB',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/Lightricks/LTX-2',
    license: 'free under $10M ARR',
    sizeNote: '~37 GB',
    files: [
      {
        file: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
        bytes: 21504034224,
        sha256: 'c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334'
      },
      {
        file: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        url: LTX_ENCODER_INT8.url,
        bytes: LTX_ENCODER_INT8.bytes,
        sha256: LTX_ENCODER_INT8.sha256
      }
    ]
  },
  {
    id: 'ltx-2.5-standard',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'standard (Q5)',
    blurb: 'the 16 GB card pick — near-full quality, smaller',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF',
    license: 'free under $10M ARR',
    sizeNote: '~31 GB',
    files: [
      {
        file: 'ltx-2.5-22b-distilled-transformer-Q5_K_M.gguf',
        url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/9a5c1bed3ff27b5e5d055fc04e3ae884381c2343/distilled/ltx-2.5-22b-distilled-transformer-Q5_K_M.gguf',
        bytes: 18116119936,
        sha256: '156b941d4dd3cabc3a904bf618fc363fc4405ee80a71c199bfa82daf7595cadb'
      },
      {
        // elix3r's GGUF encoder went GATED (401, 2026-08-21) — the open comfyicu int8
        // encoder serves the GGUF tiers too, and dedups with the quality tier on disk
        file: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        url: LTX_ENCODER_INT8.url,
        bytes: LTX_ENCODER_INT8.bytes,
        sha256: LTX_ENCODER_INT8.sha256
      }
    ]
  },
  {
    id: 'ltx-2.5-compact',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'compact (Q4)',
    blurb: 'the community sweet spot for 12-16 GB cards',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF',
    license: 'free under $10M ARR',
    sizeNote: '~29 GB',
    files: [
      {
        file: 'ltx-2.5-22b-distilled-transformer-Q4_K_M.gguf',
        url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/9a5c1bed3ff27b5e5d055fc04e3ae884381c2343/distilled/ltx-2.5-22b-distilled-transformer-Q4_K_M.gguf',
        bytes: 15687639424,
        sha256: '8954332873a705cf1a980a188ace1e0fa015fc84422d2a4a4948df6a629977a7'
      },
      {
        // elix3r's GGUF encoder went GATED (401, 2026-08-21) — the open comfyicu int8
        // encoder serves the GGUF tiers too, and dedups with the quality tier on disk
        file: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        url: LTX_ENCODER_INT8.url,
        bytes: LTX_ENCODER_INT8.bytes,
        sha256: LTX_ENCODER_INT8.sha256
      }
    ]
  },
  {
    id: 'ltx-2.5-small',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'small (Q3)',
    blurb: 'fits 12 GB and below — softer detail',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF',
    license: 'free under $10M ARR',
    sizeNote: '~26 GB',
    files: [
      {
        file: 'ltx-2.5-22b-distilled-transformer-Q3_K_M.gguf',
        url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/9a5c1bed3ff27b5e5d055fc04e3ae884381c2343/distilled/ltx-2.5-22b-distilled-transformer-Q3_K_M.gguf',
        bytes: 12923897216,
        sha256: '7015dc7dd64d7938531b044a8577c88a8e6ccd0b8047cac94123c06bdc863d0d'
      },
      {
        // elix3r's GGUF encoder went GATED (401, 2026-08-21) — the open comfyicu int8
        // encoder serves the GGUF tiers too, and dedups with the quality tier on disk
        file: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        url: LTX_ENCODER_INT8.url,
        bytes: LTX_ENCODER_INT8.bytes,
        sha256: LTX_ENCODER_INT8.sha256
      }
    ]
  },
  {
    id: 'ltx-2.5-minimum',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'minimum (Q2)',
    blurb: 'the 8 GB door — experimental, visible quality loss',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF',
    license: 'free under $10M ARR',
    sizeNote: '~26 GB',
    files: [
      {
        // spec §1 listed 8.83 GB; the pinned file is 12.1 GB (HEAD 2026-08-21) — bytes win
        file: 'ltx-2.5-22b-distilled-transformer-Q2_K.gguf',
        url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/9a5c1bed3ff27b5e5d055fc04e3ae884381c2343/distilled/ltx-2.5-22b-distilled-transformer-Q2_K.gguf',
        bytes: 12125172096,
        sha256: 'a91e2a1f527a8791668de0fcc00178a0eb7bb2b47439810845fadbc72efa148d'
      },
      {
        // elix3r's GGUF encoder went GATED (401, 2026-08-21) — the open comfyicu int8
        // encoder serves the GGUF tiers too, and dedups with the quality tier on disk
        file: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        url: LTX_ENCODER_INT8.url,
        bytes: LTX_ENCODER_INT8.bytes,
        sha256: LTX_ENCODER_INT8.sha256
      }
    ]
  },
  {
    id: 'ltx-2.5-full',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'full (dev bf16)',
    blurb: 'the trainable original — negative prompts work, 32 GB+ or slow offload',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/Lightricks/LTX-2',
    license: 'free under $10M ARR',
    sizeNote: '~68 GB',
    files: [
      {
        file: 'ltx-2.5-22b-dev-transformer-bf16.safetensors',
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/diffusion_models/ltx-2.5-22b-dev-transformer-bf16.safetensors',
        bytes: 42018190584,
        sha256: '792a2bad501ca03262c0bc2ce7a2949e85b142ce18e30894aad5bc849c8e7584'
      },
      {
        file: 'gemma4-12b-with-proj-ltx-2.5-bf16.safetensors',
        // list 15: the 08-17 bf16 encoder (sha256 = Lightricks' own blob), from an open mirror
        url: 'https://huggingface.co/yuvraj108c/LTX-2.5/resolve/9a165b41a60dd72000d756c71c32ff30a52e6ffa/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors',
        bytes: 26263858182,
        sha256: 'ef7243612fdae7a75cb4d5cee9433e81380675fb6c213bd98ae74a9cd16561d1'
      }
    ]
  },
  {
    id: 'ltx-2.5-core',
    category: 'video',
    variantOf: 'ltx-2.5',
    folder: 'video/ltx-2.5',
    label: 'essentials',
    blurb: 'the shared pieces every size needs — decoders, refs, prompt enhancer (fetched automatically)',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/Lightricks/LTX-2.5',
    license: 'free under $10M ARR',
    sizeNote: '~8 GB',
    files: [
      {
        // conv VAE, NOT video-vae-bf16: the official day-one video-vae-bf16 ships NaN decoder
        // weights (black frames, weight-scan + render proven 2026-08-25); conv scans clean and
        // rendered real footage. Same official release, faster decode.
        file: 'ltx-2.5-video-vae-conv-bf16.safetensors',
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/vae/ltx-2.5-video-vae-conv-bf16.safetensors',
        bytes: 1452269922,
        sha256: '685b06ee3d9b2039647698fc4ea33175112462fc374e2777312c907897dfce8d'
      },
      {
        // Kijai's repack, NOT the official ltx-2.5-audio-vae-bf16: the official file ships 25
        // NaN vocoder weights (100% silent audio, bisect-proven 2026-08-25). This one scans
        // clean and rendered coherent scene audio (user-verified by ear). LTX-2-era arch —
        // revisit if Lightricks ships a fixed 2.5 audio VAE.
        file: 'kijai-ltx2-audio-vae-bf16.safetensors',
        url: 'https://huggingface.co/Kijai/LTXV2_comfy/resolve/main/VAE/LTX2_audio_vae_bf16.safetensors',
        bytes: 217740136,
        sha256: 'f00fcace3ef1ebfa6dca9fcb4b925df47d57f826ae7df3bc8fb98f577f213204'
      },
      {
        file: 'ltx-2.5-duration-head-bf16.safetensors',
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/model_patches/ltx-2.5-duration-head-bf16.safetensors',
        bytes: 3843690,
        sha256: '2ec71e4206ed365d015f00c05a48caccfb0ee862986809d06ae376c09f5d9190'
      },
      {
        file: 'LTX-2.5-Licon-MSR-V1.safetensors',
        url: 'https://huggingface.co/LiconStudio/LTX-2.5-Multiple-Subject-Reference/resolve/9a053e6d63e54cd6970b1cda9419f1339457bd8c/LTX-2.5-Licon-MSR-V1.safetensors',
        bytes: 1308840536,
        sha256: 'd45cedd720e5819ccbe200a4b0ae01f7ae0e0d2966d700a24ebd4c7739515d4f'
      },
      {
        file: 'gemma4_e2b_it_int8_convrot.safetensors',
        url: 'https://huggingface.co/Comfy-Org/gemma-4/resolve/63d0f7c476756b88910170c1df75e2384ea1af31/text_encoders/gemma4_e2b_it_int8_convrot.safetensors',
        bytes: 5199997904,
        sha256: 'efeca0fcad2f863e5ed0a75e3af952b72bc963604c1dda6d20aee87a32b17566'
      }
    ]
  },
  // ---- video (MiniMax H3 — docs/MINIMAX-H3-LOCAL-SPEC-2026-09-22.md §2): the same headless
  // engine as LTX. Parent + base tiers + encoders + essentials + speed kernels; every file pinned
  // by revision sha + bytes + LFS sha256 (read live 2026-09-22). One folder (video/minimax-h3) so
  // the shared files download once. Hardware notes are a ladder for every card, never a gate.
  {
    id: 'minimax-h3',
    category: 'video',
    label: 'MiniMax H3',
    blurb: 'video with sound on your own GPU — refs up to 9 pictures + 3 videos + 3 voices, free renders',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/MiniMaxAI/MiniMax-H3',
    links: [
      { label: 'minimax', url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3' },
      { label: 'huggingface', url: 'https://huggingface.co/Comfy-Org/MiniMax-H3' },
      { label: 'singularity', url: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity' }
    ],
    license: 'MiniMax H3 Community License',
    sizeNote: ''
  },
  {
    id: 'minimax-h3-full',
    category: 'video',
    variantOf: 'minimax-h3',
    folder: 'video/minimax-h3',
    label: 'full (int8)',
    blurb: 'the workflow’s file — 16 GB cards stream it from RAM, 32 GB+ holds it whole',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity',
    license: 'Apache-2.0 on the H3 community license',
    sizeNote: '~34 GB',
    files: [
      {
        file: 'Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors',
        url: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/af671d9214a6e41ab8c2f43e9f871ea56246115f/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors',
        bytes: 34004507622,
        sha256: '551915097b8727537a82f3a2c5acec965165ec84e780b3e9a5f28ce867fddf08'
      }
    ]
  },
  {
    id: 'minimax-h3-pruned',
    category: 'video',
    variantOf: 'minimax-h3',
    folder: 'video/minimax-h3',
    label: 'pruned (int8)',
    blurb: 'smaller, loads faster — the turbo lora’s notes say it wants the full build; proof at the first render',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity',
    license: 'Apache-2.0 on the H3 community license',
    sizeNote: '~21 GB',
    files: [
      {
        file: 'Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors',
        url: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/af671d9214a6e41ab8c2f43e9f871ea56246115f/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors',
        bytes: 20967647456,
        sha256: '412a7b126595a958964193f3b42513d7cf2df4196ef04223a0f05e3622949cce'
      }
    ]
  },
  {
    id: 'minimax-h3-w4a8',
    category: 'video',
    variantOf: 'minimax-h3',
    folder: 'video/minimax-h3',
    label: 'small (w4a8)',
    blurb: 'the smallest door — visible quality loss',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity',
    license: 'Apache-2.0 on the H3 community license',
    sizeNote: '~12 GB',
    files: [
      {
        file: 'Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8.safetensors',
        url: 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/af671d9214a6e41ab8c2f43e9f871ea56246115f/Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8.safetensors',
        bytes: 11767930768,
        sha256: '2a319b6fafbd646c123ac12a28b1908c7468b148a8c03164172b2f72370264ec'
      }
    ]
  },
  {
    id: 'minimax-h3-enc-int8',
    category: 'video',
    variantOf: 'minimax-h3',
    folder: 'video/minimax-h3',
    label: 'encoder int8',
    blurb: 'the prompt + picture reader (Qwen3-VL 32B) — best, the workflow’s file',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/Comfy-Org/MiniMax-H3',
    license: 'MiniMax H3 Community License',
    sizeNote: '~27 GB',
    files: [
      {
        file: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
        url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
        bytes: 27141342152,
        sha256: 'bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923'
      }
    ]
  },
  {
    id: 'minimax-h3-enc-nvfp4',
    category: 'video',
    variantOf: 'minimax-h3',
    folder: 'video/minimax-h3',
    label: 'encoder nvfp4',
    blurb: 'the same reader, smaller — offloads less on 16 GB cards',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/Comfy-Org/MiniMax-H3',
    license: 'MiniMax H3 Community License',
    sizeNote: '~16 GB',
    files: [
      {
        file: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
        url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
        bytes: 15687142551,
        sha256: '35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6'
      }
    ]
  },
  {
    id: 'minimax-h3-core',
    category: 'video',
    variantOf: 'minimax-h3',
    folder: 'video/minimax-h3',
    label: 'essentials',
    blurb: 'what every tier needs — both VAEs, the latent upscaler, the three loras (turbo · lms · realism), fetched automatically',
    usedBy: 'Clip Gen',
    homepage: 'https://huggingface.co/Comfy-Org/MiniMax-H3',
    license: 'MiniMax H3 Community License',
    sizeNote: '~10 GB',
    files: [
      {
        file: 'minimax_h3_video_vae_fp16.safetensors',
        url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/vae/minimax_h3_video_vae_fp16.safetensors',
        bytes: 5207808496,
        sha256: '7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522'
      },
      {
        file: 'minimax_h3_audio_vae_fp32.safetensors',
        url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/vae/minimax_h3_audio_vae_fp32.safetensors',
        bytes: 605254808,
        sha256: '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48'
      },
      {
        // LBH-123-AI's 3D latent upscaler (MIT) — the workflow's optional 1.25× / 1.5× pass
        file: 'minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors',
        url: 'https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler/resolve/3f941d5d182014dd5c0a5e16330420ee2d4aa0c6/minimax_h3_latent_upscaler_3d_conv_v1/minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors',
        bytes: 690592992,
        sha256: '4f57821f5837f32f7142b67d815606dbd7550f194e5c769f7d6c3f83b146a5e6'
      },
      {
        // the engine's own lora set (spec §4.4): turbo on every pass …
        file: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
        url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
        bytes: 1956193000,
        sha256: '5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c'
      },
      {
        // … lms (sharpens, keeps it photoreal) and realism-people on the final pass
        file: 'minimax_h3_lms_v1.0_r64.safetensors',
        url: 'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/0ff489e781c274d17b2e3a30cd6f9a8d40ca49ff/loras/minimax_h3_lms_v1.0_r64.safetensors',
        bytes: 1239664536,
        sha256: '16f3195bc6bffa431c0598dc2031e520ba058b4fcbc9f104db9e3fdfdeacf60c'
      },
      {
        file: 'h3-realism-people-t2v-i2v-r2v.safetensors',
        url: 'https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA/resolve/039cc8579d7aa357a882d7f4111b25da4f72dccc/h3-realism-people-t2v-i2v-r2v.safetensors',
        bytes: 131229656,
        sha256: 'acc529601d2da117fb81179e76c56e488a3beab1171659d305f04fa3655b787e'
      }
    ]
  },
  // No `files`: install = pip (triton + the SageAttention wheel) + one node pack into the engine
  // (main/h3Local.ts, spec §2b), routed by id. Off by default on the card — a speed pick.
  {
    id: 'minimax-h3-kernels',
    category: 'video',
    variantOf: 'minimax-h3',
    label: 'speed kernels',
    blurb: 'SageAttention + Sol-Attn for H3 — faster and lighter, a small quality cost; the card’s speed-kernels pick turns them on per clip',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/woct0rdho/SageAttention',
    license: 'Apache-2.0',
    sizeNote: '~300 MB'
  },
  // ---- image (KREA2-LOCAL-SPEC-2026-09-08): Krea 2 on the same local engine as LTX. Official
  // repack Comfy-Org/Krea-2 — every file sha-pinned from the repo's LFS oids (read 2026-09-08).
  // Turbo only (8 steps · cfg 1); the civit checkpoints row (dynamic, main-side) sits under these.
  {
    id: 'krea-2',
    category: 'image',
    label: 'Krea 2',
    blurb: 'generates images on your own GPU — free renders, refs + loras',
    usedBy: 'Image Gen',
    homepage: 'https://www.krea.ai',
    links: [
      { label: 'site', url: 'https://www.krea.ai' },
      { label: 'huggingface', url: 'https://huggingface.co/Comfy-Org/Krea-2' },
      { label: 'docs', url: 'https://docs.comfy.org/tutorials/image/krea/krea-2' }
    ],
    license: 'Krea AI Community License',
    sizeNote: ''
  },
  {
    id: 'krea-2-quality',
    category: 'image',
    variantOf: 'krea-2',
    folder: 'image/krea-2',
    label: 'quality (fp8)',
    blurb: 'the recommended turbo build — best quality that fits a 16 GB card',
    usedBy: 'Image Gen',
    homepage: 'https://huggingface.co/Comfy-Org/Krea-2',
    license: 'Krea AI Community License',
    sizeNote: '~13 GB',
    files: [
      {
        file: 'krea2_turbo_fp8_scaled.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors',
        bytes: 13141730784,
        sha256: 'eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1'
      }
    ]
  },
  {
    id: 'krea-2-standard',
    category: 'image',
    variantOf: 'krea-2',
    folder: 'image/krea-2',
    label: 'standard (int8)',
    blurb: 'int8 turbo — the fallback for cards without fp8 support',
    usedBy: 'Image Gen',
    homepage: 'https://huggingface.co/Comfy-Org/Krea-2',
    license: 'Krea AI Community License',
    sizeNote: '~13.5 GB',
    files: [
      {
        file: 'krea2_turbo_int8_convrot.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_int8_convrot.safetensors',
        bytes: 13492686496,
        sha256: '8e4eeda70dd5037ab1ba2bef6b417f9f901e26093117cf397f741fc1fdaaf3f1'
      }
    ]
  },
  {
    id: 'krea-2-compact',
    category: 'image',
    variantOf: 'krea-2',
    folder: 'image/krea-2',
    label: 'compact (nvfp4 · Blackwell)',
    blurb: 'half the size — needs an RTX 50-series (Blackwell) card',
    usedBy: 'Image Gen',
    homepage: 'https://huggingface.co/Comfy-Org/Krea-2',
    license: 'Krea AI Community License',
    sizeNote: '~7.7 GB',
    files: [
      {
        file: 'krea2_turbo_nvfp4.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_nvfp4.safetensors',
        bytes: 7673668448,
        sha256: '61527003b2d537055494d01bc8efe51d6e86e64192ba23e3721a5647231fe394'
      }
    ]
  },
  {
    id: 'krea-2-full',
    category: 'image',
    variantOf: 'krea-2',
    folder: 'image/krea-2',
    label: 'full (bf16)',
    blurb: 'the unquantized turbo weights — 26 GB, spills into system RAM on consumer cards',
    usedBy: 'Image Gen',
    homepage: 'https://huggingface.co/Comfy-Org/Krea-2',
    license: 'Krea AI Community License',
    sizeNote: '~26 GB',
    files: [
      {
        file: 'krea2_turbo_bf16.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_bf16.safetensors',
        bytes: 26283332608,
        sha256: '78bbf8f4165eda19cea3cb06c78089221932a39e2eed8af9da741f942c47ffb3'
      }
    ]
  },
  {
    id: 'krea-2-core',
    category: 'image',
    variantOf: 'krea-2',
    folder: 'image/krea-2',
    label: 'essentials',
    blurb: 'the shared pieces every Krea 2 build needs — text encoder, VAE, the identity-edit refs adapter (fetched automatically)',
    usedBy: 'Image Gen',
    homepage: 'https://huggingface.co/Comfy-Org/Krea-2',
    license: 'Krea AI Community License',
    sizeNote: '~7.8 GB',
    files: [
      {
        file: 'qwen3vl_4b_fp8_scaled.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
        bytes: 5242467968,
        sha256: '54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094'
      },
      {
        file: 'qwen_image_vae.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors',
        bytes: 253806246,
        sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f'
      },
      {
        // Identity Edit v1.2 (conrad_locke) — the ref path's own adapter. HF mirror sha ==
        // Civitai sha (P4, 2026-09-08), so the ungated HF copy is the pin.
        file: 'krea2_identity_edit_v1_2.safetensors',
        url: 'https://huggingface.co/conradlocke/krea2-identity-edit/resolve/main/krea2_identity_edit_v1_2.safetensors',
        bytes: 1828256432,
        sha256: '6adf9a69cc9502d286db7b69964d37da7e9cfe4b05b4d004bc275f087d3fd3cf'
      },
      {
        file: 'krea2_style_reference.safetensors',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_style_reference.safetensors',
        bytes: 457111760,
        sha256: 'f50df5a9e62e4be8aa926a63dd5bb1a64770c4004f763c1208007ae13daa82b8'
      }
    ]
  },
  // ---- audio (music + voice locals; weights install at plan phase 7) ----
  {
    id: 'ace-step-1.5',
    category: 'audio',
    label: 'ACE-Step 1.5',
    blurb: 'writes full songs locally — under 4GB VRAM',
    usedBy: 'Score',
    homepage: 'https://acestep.org',
    links: [
      { label: 'site', url: 'https://acestep.org' },
      { label: 'github', url: 'https://github.com/ace-step/ACE-Step-1.5' }
    ],
    license: 'MIT',
    // installable TODAY (installer in main/audioLocal.ts): repo + uv sync ≈ 2 GB; the core
    // models (~10 GB) arrive on the first render into models/audio/ace-step-1.5
    sizeNote: '~12 GB'
  },
  {
    id: 'minimax-music-3',
    category: 'audio',
    label: 'MiniMax Music 3',
    blurb: 'the API music engine on your own GPU — one card, offload fits 16GB and below',
    usedBy: 'Score',
    homepage: 'https://huggingface.co/MiniMaxAI/MiniMax-Music3',
    links: [
      { label: 'github', url: 'https://github.com/MiniMax-AI/MiniMax-Music3' },
      { label: 'huggingface', url: 'https://huggingface.co/MiniMaxAI/MiniMax-Music3' }
    ],
    license: 'open weights',
    // installable TODAY (installer in main/audioLocal.ts): env ~5 GB; weights (~20 GB) arrive
    // on the first render into models/audio/minimax-music-3
    sizeNote: '~25 GB'
  },
  {
    id: 'chatterbox',
    category: 'audio',
    label: 'Chatterbox',
    blurb: 'clones and speaks voices locally',
    usedBy: 'Voices',
    homepage: 'https://github.com/resemble-ai/chatterbox',
    links: [
      { label: 'github', url: 'https://github.com/resemble-ai/chatterbox' },
      { label: 'huggingface', url: 'https://huggingface.co/ResembleAI/chatterbox' }
    ],
    license: 'MIT',
    sizeNote: 'size TBC',
    needsRuntime: true
  },
  {
    id: 'f5-tts',
    category: 'audio',
    label: 'F5-TTS',
    blurb: 'fast local text-to-speech with voice reference',
    usedBy: 'Voices',
    homepage: 'https://github.com/SWivid/F5-TTS',
    links: [
      { label: 'github', url: 'https://github.com/SWivid/F5-TTS' },
      { label: 'huggingface', url: 'https://huggingface.co/SWivid/F5-TTS' }
    ],
    license: 'CC-BY-NC weights',
    sizeNote: 'size TBC',
    needsRuntime: true
  }
]

export function localModelFor(id: string): LocalModelDef | undefined {
  return LOCAL_MODELS.find((m) => m.id === id)
}

// the distilled LTX sizes, ladder (best-first) order — the render ladder and the engine
// dropdown's size entries both walk this list (bible 12.9). Full (dev bf16) is NOT here: it
// renders by explicit pick, or as the last rung when it is the only size installed (list 16).
export const LTX_DISTILLED_IDS = ['ltx-2.5-quality', 'ltx-2.5-standard', 'ltx-2.5-compact', 'ltx-2.5-small', 'ltx-2.5-minimum']

// MiniMax H3 (MINIMAX-H3-LOCAL-SPEC §2): base tiers best-first, encoders best-first, the
// essentials row every tier chains, the optional speed-kernels row
export const H3_BASE_IDS = ['minimax-h3-full', 'minimax-h3-pruned', 'minimax-h3-w4a8']
export const H3_ENCODER_IDS = ['minimax-h3-enc-int8', 'minimax-h3-enc-nvfp4']
export const H3_CORE_ID = 'minimax-h3-core'
export const H3_KERNELS_ID = 'minimax-h3-kernels'

// the Krea 2 builds, best-first (KREA2-LOCAL-SPEC §7): the Image Gen MODEL dropdown's official
// group and the "best installed" default walk this list. bf16 is last on purpose: it only
// beats fp8 on a card that holds 26 GB.
export const KREA2_VARIANT_IDS = ['krea-2-quality', 'krea-2-standard', 'krea-2-compact', 'krea-2-full']
export const KREA2_FILE_OF: Record<string, string> = {
  'krea-2-quality': 'krea2_turbo_fp8_scaled.safetensors',
  'krea-2-standard': 'krea2_turbo_int8_convrot.safetensors',
  'krea-2-compact': 'krea2_turbo_nvfp4.safetensors',
  'krea-2-full': 'krea2_turbo_bf16.safetensors'
}
