// Image-generation capability registry — same pattern as models.ts (video). One engine for now
// (Nano Banana); Nano Banana Pro slots in later without reworking the editor.
// Schemas verified against fal OpenAPI pages 2026-06-11.

export interface ImageModelDescriptor {
  id: 'nano-banana'
  label: string
  editEndpoint: string // image(s) + prompt → image
  generateEndpoint: string // prompt → image (no base)
  maxImages: number // base + refs sent to the edit endpoint
  refWarnAt: number // identity fidelity drops past this many images
  aspectRatiosEdit: string[] // edit endpoint accepts 'auto'
  aspectRatiosGenerate: string[] // t2i has NO 'auto' (defaults 1:1)
  maxVariants: number // num_images per generate
  seed: boolean
  pricePerImage: number // flat $/image
}

export const NANO_BANANA: ImageModelDescriptor = {
  id: 'nano-banana',
  label: 'Nano Banana',
  editEndpoint: 'fal-ai/gemini-25-flash-image/edit',
  generateEndpoint: 'fal-ai/gemini-25-flash-image',
  maxImages: 6,
  refWarnAt: 3,
  aspectRatiosEdit: ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
  aspectRatiosGenerate: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
  maxVariants: 4,
  seed: true,
  pricePerImage: 0.039
}
