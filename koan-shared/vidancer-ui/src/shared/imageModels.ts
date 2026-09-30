// Image-edit capability registry — same pattern as models.ts (video). Image Edit's MODEL · VIA row
// reads this table; main's falImage.ts builds each model's wire input from it.
// (UI-ROUND-SPEC-2026-09-19 §6.) Schemas read from the fal API pages 2026-09-19 (Nano Banana:
// 2026-06-11). Prices are the published per-image figures — ESTIMATES, fal's billing is the truth.

export type ImageModelId = 'nano-banana' | 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2' | 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst' | 'seedream-5-pro' | 'seedream-5-flash'

type PriceFn = (o: { resolution?: string; quality?: string; refs: number }) => number

// who serves a model. `ready: false` rows show greyed with their reason (stable board — nothing vanishes)
export interface ImageVia {
  id: string
  label: string
  ready: boolean
  reason?: string
  // list 10: a supplier with its own id, size dial and price for the model (absent = the model's own)
  slug?: string
  resolutions?: string[]
  price?: PriceFn
}

export interface ImageModelDescriptor {
  id: ImageModelId
  label: string
  vias: ImageVia[]
  editEndpoint: string // image(s) + prompt → image
  generateEndpoint: string // prompt → image (no base)
  maxImages: number // base + refs sent to the edit endpoint
  refWarnAt: number // identity fidelity drops past this many images
  // how the wire takes the frame shape: Nano family = `aspect_ratio`; GPT / Seedream = `image_size` presets
  sizing: 'aspect' | 'image_size'
  aspectRatiosEdit: string[] // edit endpoint accepts 'auto'
  aspectRatiosGenerate: string[] // t2i has NO 'auto' on the Nano family
  resolutions?: string[] // the output-size dial, when the model has one (first = the default)
  qualities?: string[] // GPT's quality dial (first = the default = HIGH — highest quality is the default, law)
  maxVariants: number // num_images per generate
  seed: boolean
  // HOW a selected region reaches the model: a real mask input, or the outline drawn on the image
  // (+ the app's paste-back guarantee). Nothing on fal's Nano / Seedream schemas takes a mask.
  region: 'mask' | 'drawn'
  price: PriceFn // est. $ per image (fal's; a VIA with its own price overrides it)
  retired?: string // list 11: out of the picker (the reason); old edits still wear its name
}

const NANO_ASPECTS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
// image_size models take presets — the ratios their presets cover (+ auto on edit)
const PRESET_ASPECTS = ['16:9', '4:3', '1:1', '3:4', '9:16']
const FAL = { id: 'fal', label: 'fal', ready: true }
// list 10: BytePlus ModelArk's image API (read 09-30, docs.byteplus.com ModelArk "Image generation
// API" + "Model pricing"): one image per call, sizes 1K / 1.5K / 2K (1.5K = 1K's price, better)
const ARK = (slug: string, price: PriceFn): ImageVia => ({ id: 'ark', label: 'ModelArk', ready: true, slug, resolutions: ['2K', '1.5K', '1K'], price })
// list 9: Google's own Gemini API on his Google key (read 09-30, ai.google.dev "Image generation" +
// "Pricing"): one image per call, the model's own sizes, Google's per-image prices
const GOOGLE = (slug: string, price: PriceFn): ImageVia => ({ id: 'google', label: 'Google', ready: true, slug, price })

export const NANO_BANANA: ImageModelDescriptor = {
  id: 'nano-banana',
  label: 'Nano Banana',
  vias: [FAL],
  editEndpoint: 'fal-ai/gemini-25-flash-image/edit',
  generateEndpoint: 'fal-ai/gemini-25-flash-image',
  maxImages: 6,
  refWarnAt: 3,
  sizing: 'aspect',
  aspectRatiosEdit: ['auto', ...NANO_ASPECTS],
  aspectRatiosGenerate: NANO_ASPECTS,
  maxVariants: 4,
  seed: true,
  region: 'drawn',
  price: () => 0.039,
  // list 11 (09-29: "remove old nano"): Google retired gemini-2.5-flash-image; fal still serves it,
  // so old edits keep their name — the picker offers the newer Nanos
  retired: 'retired by Google — Nano Banana 2 and Pro replace it'
}

export const IMAGE_MODELS: ImageModelDescriptor[] = [
  NANO_BANANA,
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    vias: [FAL, GOOGLE('gemini-3.1-flash-image', ({ resolution }) => (resolution === '0.5K' ? 0.045 : resolution === '2K' ? 0.101 : resolution === '4K' ? 0.151 : 0.067))],
    editEndpoint: 'fal-ai/nano-banana-2/edit',
    generateEndpoint: 'fal-ai/nano-banana-2',
    maxImages: 14,
    refWarnAt: 6,
    sizing: 'aspect',
    aspectRatiosEdit: ['auto', ...NANO_ASPECTS],
    aspectRatiosGenerate: NANO_ASPECTS,
    resolutions: ['1K', '2K', '4K', '0.5K'],
    maxVariants: 4,
    seed: true,
    region: 'drawn',
    price: ({ resolution }) => (resolution === '0.5K' ? 0.06 : resolution === '2K' ? 0.12 : resolution === '4K' ? 0.16 : 0.08)
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    // Google bills each input image too ($0.0011): the base + every ref
    vias: [FAL, GOOGLE('gemini-3-pro-image', ({ resolution, refs }) => (resolution === '4K' ? 0.24 : 0.134) + (Math.max(0, refs) + 1) * 0.0011)],
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    generateEndpoint: 'fal-ai/nano-banana-pro',
    maxImages: 14,
    refWarnAt: 6,
    sizing: 'aspect',
    aspectRatiosEdit: ['auto', ...NANO_ASPECTS],
    aspectRatiosGenerate: NANO_ASPECTS,
    resolutions: ['1K', '2K', '4K'],
    maxVariants: 4,
    seed: true,
    region: 'drawn',
    price: ({ resolution }) => (resolution === '4K' ? 0.3 : 0.15)
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    vias: [FAL],
    editEndpoint: 'openai/gpt-image-2/edit',
    generateEndpoint: 'openai/gpt-image-2',
    maxImages: 16,
    refWarnAt: 6,
    sizing: 'image_size',
    aspectRatiosEdit: ['auto', ...PRESET_ASPECTS],
    aspectRatiosGenerate: PRESET_ASPECTS,
    qualities: ['high', 'medium', 'low'],
    maxVariants: 4,
    seed: false,
    region: 'mask',
    price: ({ quality }) => (quality === 'low' ? 0.02 : quality === 'medium' ? 0.07 : 0.22)
  },
  // list 8 (his pick 09-29): GPT Image 2.5 on fal, both variants (read 09-30 from fal's API pages):
  // Flare = precise edits that change only what's asked · Sunburst = the tightest control across
  // many rounds of revision. 16 images, a real mask, quality up to max (the default: highest-quality
  // law). Per image at 1024² on fal: low $0.006 · medium $0.013 · high $0.053 · xhigh $0.094 · max $0.211
  ...(['flare', 'sunburst'] as const).map(
    (v): ImageModelDescriptor => ({
      id: `gpt-image-2.5-${v}`,
      label: `GPT Image 2.5 ${v === 'flare' ? 'Flare' : 'Sunburst'}`,
      vias: [FAL],
      editEndpoint: `openai/gpt-image-2.5/${v}/edit`,
      generateEndpoint: `openai/gpt-image-2.5/${v}/text-to-image`,
      maxImages: 16,
      refWarnAt: 6,
      sizing: 'image_size',
      aspectRatiosEdit: ['auto', ...PRESET_ASPECTS],
      aspectRatiosGenerate: PRESET_ASPECTS,
      qualities: ['max', 'xhigh', 'high', 'medium', 'low'],
      maxVariants: 4,
      seed: false,
      region: 'mask',
      price: ({ quality }) => ({ low: 0.0059, medium: 0.0132, high: 0.0527, xhigh: 0.0937 } as Record<string, number>)[quality ?? ''] ?? 0.2107
    })
  ),
  {
    id: 'seedream-5-pro',
    label: 'Seedream 5.0 Pro',
    // ModelArk = his cheap lane for ByteDance models: $0.045 up to 1.5K, $0.09 at 2K, every input
    // image after the first $0.003
    vias: [FAL, ARK('dola-seedream-5-0-pro-260628', ({ resolution, refs }) => (resolution === '2K' ? 0.09 : 0.045) + Math.max(0, refs) * 0.003)],
    editEndpoint: 'bytedance/seedream/v5/pro/edit',
    generateEndpoint: 'bytedance/seedream/v5/pro/text-to-image',
    maxImages: 10,
    refWarnAt: 6,
    sizing: 'image_size',
    aspectRatiosEdit: ['auto', ...PRESET_ASPECTS],
    aspectRatiosGenerate: PRESET_ASPECTS,
    resolutions: ['2K', '1K'], // auto_2K is the endpoint's own default
    maxVariants: 4,
    seed: false,
    region: 'drawn',
    price: ({ resolution, refs }) => (resolution === '1K' ? 0.0675 : 0.135) + Math.max(0, refs) * 0.0045
  },
  {
    // list 10: Pro's fast sibling (09-23) — same inputs; $0.027 on fal, $0.018 on ModelArk
    id: 'seedream-5-flash',
    label: 'Seedream 5.0 Flash',
    vias: [FAL, ARK('dola-seedream-5-0-flash-260915', () => 0.018)],
    editEndpoint: 'bytedance/seedream/v5/flash/edit',
    generateEndpoint: 'bytedance/seedream/v5/flash/text-to-image',
    maxImages: 10,
    refWarnAt: 6,
    sizing: 'image_size',
    aspectRatiosEdit: ['auto', ...PRESET_ASPECTS],
    aspectRatiosGenerate: PRESET_ASPECTS,
    resolutions: ['2K', '1K'],
    maxVariants: 4,
    seed: false,
    region: 'drawn',
    price: () => 0.027
  }
]

// no model written = made before the picker existed = Nano Banana 1 (the truth for old tree nodes).
// The picker's first pick and the blocking sheet name Pro themselves (his call 2026-09-22, todo 11).
export const imageModelFor = (id?: string | null): ImageModelDescriptor => IMAGE_MODELS.find((m) => m.id === id) ?? NANO_BANANA

// the models the picker offers (list 11: a retired one stays only as a label)
export const PICKABLE_IMAGE_MODELS = IMAGE_MODELS.filter((m) => !m.retired)

// the VIA row a pick runs on (absent / unknown = fal, the original) — its size dial and price win
export const imageViaFor = (model: ImageModelDescriptor, via?: string | null): ImageVia | undefined => model.vias.find((v) => v.id === (via ?? 'fal'))

// the ONE line a `drawn` model gets after his prompt when a selection exists — shown under the
// prompt box while it applies (WORKFLOW law 5: what the model sees is inspectable)
export const REGION_LINE = 'Edit only inside the red outline. Keep everything outside it exactly as it is, and do not draw the outline in the result.'

// aspect → the fal `image_size` preset (GPT Image 2 · Seedream 5.0)
export function imageSizePreset(model: ImageModelDescriptor, aspect: string, resolution?: string): string {
  const preset: Record<string, string> = { '1:1': 'square_hd', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9' }
  if (preset[aspect]) return preset[aspect]
  if (model.id.startsWith('seedream-5')) return resolution === '1K' ? 'auto_1K' : 'auto_2K'
  return 'auto'
}
