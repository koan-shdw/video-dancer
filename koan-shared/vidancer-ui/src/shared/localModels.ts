// Local-model registry — the ONE list in code naming every downloadable model the app uses
// (LOCAL-MODELS-PLAN "Models card" settled spec 2026-08-19). The Models card renders straight
// from these entries × the disk state; main/modelStore.ts downloads/deletes by them. URLs and
// file names live HERE and nowhere else (fx.ts reads them through this registry too).
//
// Entries without `files` are known models whose weights can't install yet (they need the
// local runtime, plan phase 3+): the card lists them anyway — gating law: visible, disabled
// with the reason, never hidden.

export type LocalModelCategory = 'video' | 'audio' | 'fx' | 'loras' | 'runtime'

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
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        bytes: 15372971786,
        sha256: '09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de'
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
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        bytes: 15372971786,
        sha256: '09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de'
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
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        bytes: 15372971786,
        sha256: '09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de'
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
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        bytes: 15372971786,
        sha256: '09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de'
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
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
        bytes: 15372971786,
        sha256: '09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de'
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
        url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/1026e00f808dbd9601911479b22d65b760737dc8/text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors',
        bytes: 26263860594,
        sha256: '1c647a94c0e902fb87f9a403cbca36a8b6d8e5867094442df1b41ae557cfd1c6'
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
// dropdown's size entries both walk this list (bible 12.9). Full (dev bf16) is NOT here:
// its sampling recipe is unproven, it never renders via the ladder.
export const LTX_DISTILLED_IDS = ['ltx-2.5-quality', 'ltx-2.5-standard', 'ltx-2.5-compact', 'ltx-2.5-small', 'ltx-2.5-minimum']
