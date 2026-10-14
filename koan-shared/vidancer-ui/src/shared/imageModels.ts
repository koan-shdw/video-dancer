// Image-edit capability registry — same pattern as models.ts (video). Image Edit's MODEL · VIA row
// reads this table; main's falImage.ts builds each model's wire input from it.
// (UI-ROUND-SPEC-2026-09-19 §6.) Schemas read from the fal API pages 2026-09-19 (Nano Banana:
// 2026-06-11). Prices are the published per-image figures — ESTIMATES, fal's billing is the truth.

export type ImageModelId = 'nano-banana' | 'nano-banana-2' | 'nano-banana-2.1' | 'nano-banana-pro' | 'gpt-image-2' | 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst' | 'seedream-5-pro' | 'seedream-5-flash'

type PriceFn = (o: { resolution?: string; quality?: string; thinking?: string; refs: number }) => number

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
  // list 9 / 50: a BRIDGE supplier — a login on the Bridge panel. It spends that plan's credits, never
  // dollars (price is 0); `credits` is what one image costs there, where the supplier says
  bridge?: BridgeImageService
  credits?: (o: { resolution?: string }) => number | undefined
  // the ratios this supplier takes for the model, when not the model's own list. No 'auto' in it =
  // the supplier can't match the base image by itself, so the app sends the nearest ratio it takes
  aspects?: string[]
  // the model has a thinking dial but this supplier takes none (the reason, on hover)
  noThinking?: string
}
export type BridgeImageService = 'higgsfield' | 'runway' | 'pika'

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
  backgrounds?: string[] // list 8: the background dial, where the model has one (first = the default). 'transparent' = a see-through PNG
  maxVariants: number // num_images per generate
  seed: boolean
  // HOW a selected region reaches the model: a real mask input, or the outline drawn on the image
  // (+ the app's paste-back guarantee). Nothing on fal's Nano / Seedream schemas takes a mask.
  region: 'mask' | 'drawn'
  price: PriceFn // est. $ per image (fal's; a VIA with its own price overrides it)
  retired?: string // list 11: out of the picker (the reason); old edits still wear its name
  // Nano Banana 2.1's thinking dial (first = the default = high: highest quality is the default, law)
  thinking?: string[]
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
// list 9 / 14 / 50: Venice's image API on the Venice key (read 09-30, docs.venice.ai Image Multi-Edit,
// Image Generate and the image model list): one image per call; slug = the generation id, its edit
// door is `<slug>-edit`. Prices are Venice's per-tier figures (an edit at 1K = a generation at 1K on
// these models; the higher tiers are their generation prices). Only models that take the selection
// as a drawn outline ride here: Venice's edit door has no mask input. NOT PROBED (no key here).
const VENICE = (slug: string, resolutions: string[], price: PriceFn): ImageVia => ({ id: 'venice', label: 'Venice', ready: true, slug, resolutions, price })

// list 9 / 50 (his ask 09-26: "see if ant of our bidges allow for it and add them as postenital
// supppmiers"): the Bridge logins that carry an image tool, read 09-30 from each one's live tool
// list, Higgsfield's live model catalog and its own cost check (credits per image, nothing made).
// Only models that take a selection as a drawn outline ride here, like Venice: none of the three
// takes a mask for them. Magnific is not here: its list carries no Nano Banana for his account.
const AUTO = 'auto'
const HIGGS = (slug: string, resolutions: string[], credits: ImageVia['credits'], aspects?: string[]): ImageVia => ({ id: 'higgsfield', label: 'Higgsfield Bridge', ready: true, slug, resolutions, price: () => 0, bridge: 'higgsfield', credits, aspects })
const RUNWAY = (slug: string, resolutions: string[], aspects: string[], credits?: ImageVia['credits']): ImageVia => ({ id: 'runway', label: 'Runway Bridge', ready: true, slug, resolutions, price: () => 0, bridge: 'runway', credits, aspects })
const PIKA = (slug: string, resolutions: string[], credits: ImageVia['credits'], aspects?: string[]): ImageVia => ({ id: 'pika', label: 'Pika Bridge', ready: true, slug, resolutions, price: () => 0, bridge: 'pika', credits, aspects })

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
    vias: [
      FAL,
      GOOGLE('gemini-3.1-flash-image', ({ resolution }) => (resolution === '0.5K' ? 0.045 : resolution === '2K' ? 0.101 : resolution === '4K' ? 0.151 : 0.067)),
      VENICE('nano-banana-2', ['1K', '2K', '4K'], ({ resolution }) => (resolution === '2K' ? 0.14 : resolution === '4K' ? 0.19 : 0.1)),
      HIGGS('nano_banana_2', ['1K', '2K', '4K'], ({ resolution }) => (resolution === '2K' ? 2 : resolution === '4K' ? 3 : 1.5)),
      RUNWAY('nano-banana-2', ['1K', '2K', '4K'], [AUTO, ...NANO_ASPECTS], ({ resolution }) => (resolution === '1K' ? 7 : undefined)), // what the 09-30 test picture took (223 → 216)
      PIKA('nano-banana-2', ['1K', '2K', '4K'], ({ resolution }) => (resolution === '1K' ? 4 : undefined)) // Pika's own estimate, given at 1K only
    ],
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
    // Google 2026-10-06 (his ask 10-14). Read that day: fal's API page (google/nano-banana-2.1[/edit]:
    // aspect_ratio incl. 4:1 1:4 8:1 1:8, resolution 1K/2K/4K, num_images 1-4, seed, thinking_level
    // minimal/medium/high, no mask input: "the marked image is the input" = our drawn outline),
    // Google's image docs + pricing (gemini-nano-banana-2.1: generation_config.thinking_level, no
    // 0.5K, $0.0336 / $0.0504 / $0.113), Venice's model list + multi-edit schema (nano-banana-2-1,
    // no thinking field, its own ratio list, unknown fields refused), Runway's own tool text in the
    // app's cached Bridge tool list (nano-banana-2.1: 4 / 6 / 12 credits, its ratio list). Pika's
    // list has no 2.1; Higgsfield's live catalog not read yet (its stored login had run out).
    id: 'nano-banana-2.1',
    label: 'Nano Banana 2.1',
    vias: [
      FAL,
      // Google bills input images too: ~1,120 tokens each at $1.50 / 1M (the base + every ref)
      GOOGLE('gemini-nano-banana-2.1', ({ resolution, refs }) => (resolution === '2K' ? 0.0504 : resolution === '4K' ? 0.113 : 0.0336) + (Math.max(0, refs) + 1) * 0.0017),
      { ...VENICE('nano-banana-2-1', ['1K', '2K', '4K'], ({ resolution }) => (resolution === '2K' ? 0.14 : resolution === '4K' ? 0.19 : 0.1)), aspects: [AUTO, '21:9', '16:9', '3:2', '4:3', '1:1', '4:5', '3:4', '2:3', '9:16'], noThinking: 'Venice takes no thinking setting for this model' },
      { ...RUNWAY('nano-banana-2.1', ['1K', '2K', '4K'], [AUTO, ...NANO_ASPECTS, '9:21', '4:1', '1:4', '8:1', '1:8'], ({ resolution }) => (resolution === '2K' ? 6 : resolution === '4K' ? 12 : 4)), noThinking: 'the Runway Bridge picks its own thinking' }
    ],
    editEndpoint: 'google/nano-banana-2.1/edit',
    generateEndpoint: 'google/nano-banana-2.1',
    maxImages: 14,
    refWarnAt: 6,
    sizing: 'aspect',
    aspectRatiosEdit: ['auto', ...NANO_ASPECTS, '4:1', '1:4', '8:1', '1:8'],
    aspectRatiosGenerate: [...NANO_ASPECTS, '4:1', '1:4', '8:1', '1:8'],
    resolutions: ['1K', '2K', '4K'],
    thinking: ['high', 'medium', 'minimal'],
    maxVariants: 4,
    seed: true,
    region: 'drawn',
    // fal's own test 10-07 (16:9, one input image): edit at medium/minimal vs high, + ~$0.002 per extra ref
    price: ({ resolution, thinking, refs }) => {
      const hi = thinking === 'high'
      const base = resolution === '2K' ? (hi ? 0.0743 : 0.0613) : resolution === '4K' ? (hi ? 0.1468 : 0.1354) : hi ? 0.0493 : 0.0415
      return base + Math.max(0, refs) * 0.002
    }
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    // Google bills each input image too ($0.0011): the base + every ref
    vias: [
      FAL,
      GOOGLE('gemini-3-pro-image', ({ resolution, refs }) => (resolution === '4K' ? 0.24 : 0.134) + (Math.max(0, refs) + 1) * 0.0011),
      VENICE('nano-banana-pro', ['1K', '2K', '4K'], ({ resolution }) => (resolution === '2K' ? 0.23 : resolution === '4K' ? 0.35 : 0.18)),
      // Higgsfield's Pro has no 'auto' ratio and defaults to 2K (the same credits as 1K there)
      HIGGS('nano_banana_pro', ['2K', '1K', '4K'], ({ resolution }) => (resolution === '4K' ? 4 : 2), NANO_ASPECTS),
      RUNWAY('nano-banana-pro', ['1K', '2K', '4K'], [AUTO, '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
      PIKA('nano-banana-pro', ['1K', '2K', '4K'], ({ resolution }) => (resolution === '1K' ? 2 : undefined))
    ],
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
      backgrounds: ['auto', 'transparent', 'opaque'], // fal's `background` (read 09-30 on both doors); auto is their default
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
    vias: [
      FAL,
      ARK('dola-seedream-5-0-pro-260628', ({ resolution, refs }) => (resolution === '2K' ? 0.09 : 0.045) + Math.max(0, refs) * 0.003),
      VENICE('seedream-v5-pro', ['2K', '1K'], ({ resolution, refs }) => (resolution === '1K' ? 0.06 : 0.11) + Math.max(0, refs) * 0.0035),
      HIGGS('seedream_v5_pro', ['2K', '1K'], ({ resolution }) => (resolution === '1K' ? 1.25 : 2.5), PRESET_ASPECTS),
      RUNWAY('seedream-5-pro', ['2K', '1K'], [AUTO, ...PRESET_ASPECTS]),
      PIKA('seedream-pro', ['1K', '2K'], () => undefined, [AUTO, ...PRESET_ASPECTS])
    ],
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
    vias: [FAL, ARK('dola-seedream-5-0-flash-260915', () => 0.018), HIGGS('seedream_5_0_flash', ['2K', '1K'], () => 0.5)],
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
