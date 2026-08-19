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
  url: string // direct download URL (streams the file)
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
  // ---- video (LTX 2.5 — parent row + variant rows; weights install at plan phase 5) ----
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
    sizeNote: '',
    needsRuntime: true
  },
  {
    id: 'ltx-2.5-bf16',
    category: 'video',
    variantOf: 'ltx-2.5',
    label: 'full quality (bf16)',
    blurb: 'the full model — best output, needs a big GPU or offload',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/Lightricks/LTX-2',
    license: 'free under $10M ARR',
    sizeNote: '~66 GB',
    needsRuntime: true
  },
  {
    id: 'ltx-2.5-fp8',
    category: 'video',
    variantOf: 'ltx-2.5',
    label: 'compact (fp8)',
    blurb: 'smaller and faster — fits 16GB-class GPUs',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/Lightricks/LTX-2',
    license: 'free under $10M ARR',
    sizeNote: 'size TBC',
    needsRuntime: true
  },
  {
    id: 'ltx-2.5-distilled',
    category: 'video',
    variantOf: 'ltx-2.5',
    label: 'fast (distilled)',
    blurb: 'the speed tier — quick drafts, lighter quality',
    usedBy: 'Clip Gen',
    homepage: 'https://github.com/Lightricks/LTX-2',
    license: 'free under $10M ARR',
    sizeNote: 'size TBC',
    needsRuntime: true
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
    sizeNote: 'size TBC',
    needsRuntime: true
  },
  {
    id: 'minimax-music-3',
    category: 'audio',
    label: 'MiniMax Music 3',
    blurb: 'the API music engine, open weights on your GPU',
    usedBy: 'Score',
    homepage: 'https://huggingface.co/MiniMaxAI/MiniMax-Music3',
    links: [
      { label: 'github', url: 'https://github.com/MiniMax-AI/MiniMax-Music3' },
      { label: 'huggingface', url: 'https://huggingface.co/MiniMaxAI/MiniMax-Music3' }
    ],
    license: 'open weights',
    sizeNote: 'size TBC',
    needsRuntime: true
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
