// ENHANCE (list 52): the two processes, their engines and their settings, as data. His design
// 10-01: a window with two sections, INTERPOLATE and UPSCALE, each with its own pills (engines),
// model choice and settings; settings change with the engine. Interpolate makes frames between the
// frames; upscale makes more pixels in every frame. Both on = interpolate first, then upscale.
// Every result is a COPY (a new take, and a Library video beside a Library source): blue outline =
// interpolated, green = upscaled, purple = both. Suppliers' own docs, read 2026-10-01, are cited
// on each engine; spec: vi-dancer docs/ENHANCE-SPEC-2026-10-01.md.

export type EnhanceSection = 'interp' | 'upscale'
export type EnhanceWhere = 'local' | 'fal' | 'topaz'

export type EnhanceField =
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; def: number; title?: string }
  | { key: string; label: string; kind: 'bool'; def: boolean; title?: string }
  | { key: string; label: string; kind: 'pick'; options: { value: string; label: string }[]; def: string; title?: string }

export interface EnhanceEngine {
  id: string
  section: EnhanceSection
  label: string // the pill
  where: EnhanceWhere // 'local' = a program the Models card downloads · 'fal' = the fal key · 'topaz' = Topaz Video on this PC
  modelRow?: string // local: the Models card row that carries its program
  models?: { value: string; label: string }[] // fixed model lists (Topaz on this PC reads its own)
  modelDef?: string
  fields: EnhanceField[] // its own settings (the section's shared ones sit above them)
  slowmo?: boolean // interpolate: it can make a longer (slow-motion) copy
  maxTimes?: number // interpolate: the most frames it makes per source frame
  fpsRange?: [number, number] // interpolate: the output frame rates it takes
  scales?: number[] // upscale: the factors it takes directly
  heights?: number[] // upscale: the output heights it takes directly
  endpoint?: string // fal
  priceNote: string // honest cost line (the supplier's own words)
  about: string
}

const fx = (n: number): string => `×${n}`

// ---- INTERPOLATE ----
export const INTERP_ENGINES: EnhanceEngine[] = [
  {
    id: 'rife-local',
    section: 'interp',
    label: 'RIFE · this PC',
    where: 'local',
    modelRow: 'rife-ncnn',
    // rife-ncnn-vulkan README: -n (a frame count) works on the v4 models
    models: [
      { value: 'rife-v4.6', label: 'RIFE 4.6' },
      { value: 'rife-v4', label: 'RIFE 4.0' }
    ],
    modelDef: 'rife-v4.6',
    fields: [
      { key: 'tta', label: 'spatial TTA', kind: 'bool', def: false, title: 'runs each frame twice, flipped — steadier, twice as slow (their -x)' },
      { key: 'ttaTime', label: 'temporal TTA', kind: 'bool', def: false, title: 'looks both ways in time — steadier motion, slower (their -z)' },
      { key: 'uhd', label: 'UHD mode', kind: 'bool', def: false, title: 'for 2K and 4K sources — handles large motion at high resolution (their -u)' }
    ],
    slowmo: true,
    maxTimes: 16,
    priceNote: 'free — runs on your GPU',
    about: 'RIFE, the open interpolation model, as a small program on your PC (the Models card downloads it once).'
  },
  {
    id: 'rife-fal',
    section: 'interp',
    label: 'RIFE · fal',
    where: 'fal',
    endpoint: 'fal-ai/rife/video',
    fields: [
      { key: 'scenes', label: 'scene detection', kind: 'bool', def: false, title: 'splits the video at its cuts first, so no frames are made across a cut (their use_scene_detection)' },
      { key: 'loop', label: 'loop', kind: 'bool', def: false, title: 'makes frames from the last frame back to the first, for a seamless loop' }
    ],
    slowmo: true,
    maxTimes: 5, // num_frames 1 to 4 between each pair
    fpsRange: [1, 60],
    priceNote: '$0.0013 per compute second on fal',
    about: 'RIFE on fal, on your fal key.'
  },
  {
    id: 'topaz-fal',
    section: 'interp',
    label: 'Topaz · fal',
    where: 'fal',
    endpoint: 'fal-ai/topaz/upscale/video',
    fields: [],
    fpsRange: [16, 60], // their target_fps
    priceNote: '$0.01 a second up to 720p, $0.02 to 1080p, $0.08 above — twice at 60 fps',
    about: 'Topaz on fal, on your fal key. Picked in both sections, it does both in one pass.'
  },
  {
    id: 'topaz-local',
    section: 'interp',
    label: 'Topaz · this PC',
    where: 'topaz',
    fields: [
      { key: 'rdt', label: 'replace duplicate frames', kind: 'number', min: -0.01, max: 0.2, step: 0.01, def: 0.01, title: '0 or below keeps them · higher finds more duplicates to replace (their rdt)' },
      { key: 'vram', label: 'max GPU memory', kind: 'number', min: 0.1, max: 1, step: 0.05, def: 1, title: 'the share of your GPU memory it may use' }
    ],
    slowmo: true,
    maxTimes: 16,
    priceNote: 'free — Topaz Video on your PC, your license',
    about: 'Topaz Video on your PC, run in the background: every frame model your install has. Picked in both sections, it does both in one pass.'
  }
]

// ---- UPSCALE ----
export const UPSCALE_ENGINES: EnhanceEngine[] = [
  {
    id: 'realesrgan-local',
    section: 'upscale',
    label: 'Real-ESRGAN · this PC',
    where: 'local',
    modelRow: 'realesrgan-ncnn',
    // realesrgan-ncnn-vulkan's own model list (Real-ESRGAN README, portable section)
    models: [
      { value: 'realesrgan-x4plus', label: 'x4plus — general footage' },
      { value: 'realesr-animevideov3', label: 'anime video v3 — drawn, fast' },
      { value: 'realesrgan-x4plus-anime', label: 'x4plus anime' },
      { value: 'realesrnet-x4plus', label: 'net x4plus — softer, no GAN' }
    ],
    modelDef: 'realesrgan-x4plus',
    fields: [
      { key: 'tile', label: 'tile size', kind: 'number', min: 0, max: 1024, step: 32, def: 0, title: '0 = auto · smaller tiles use less GPU memory (their -t)' },
      { key: 'tta', label: 'TTA', kind: 'bool', def: false, title: 'eight passes a frame, averaged — cleaner, much slower (their -x)' }
    ],
    scales: [2, 4],
    priceNote: 'free — runs on your GPU',
    about: 'Real-ESRGAN, the open upscaler, as a small program on your PC (the Models card downloads it once).'
  },
  {
    id: 'seedvr-fal',
    section: 'upscale',
    label: 'SeedVR2 · fal',
    where: 'fal',
    endpoint: 'fal-ai/seedvr/upscale/video',
    fields: [
      { key: 'noise', label: 'noise scale', kind: 'number', min: 0, max: 1, step: 0.01, def: 0.1, title: 'how much new detail it invents (their noise_scale)' },
      { key: 'seed', label: 'seed', kind: 'number', min: 0, max: 2147483647, step: 1, def: 0, title: '0 = a new one each time' }
    ],
    scales: [2, 4],
    heights: [720, 1080, 1440, 2160],
    priceNote: '$0.001 per megapixel of video (width × height × frames)',
    about: 'ByteDance’s SeedVR2 on fal, on your fal key.'
  },
  {
    id: 'topaz-fal',
    section: 'upscale',
    label: 'Topaz · fal',
    where: 'fal',
    endpoint: 'fal-ai/topaz/upscale/video',
    // their ModelEnum, read 10-01
    models: ['Proteus', 'Artemis HQ', 'Artemis MQ', 'Artemis LQ', 'Gaia HQ', 'Gaia CG', 'Gaia 2', 'Nyx', 'Nyx Fast', 'Nyx XL', 'Nyx HF', 'Starlight Precise 2.5', 'Starlight HQ', 'Starlight Mini', 'Starlight Sharp', 'Starlight Fast 2', 'Starlight Precise 1', 'Starlight Precise 2', 'Starlight Fast 1'].map((m) => ({ value: m, label: m })),
    modelDef: 'Proteus',
    fields: [
      { key: 'compression', label: 'fix compression', kind: 'number', min: 0, max: 1, step: 0.05, def: 0, title: 'removes blocks and mosquito noise from low bitrates' },
      { key: 'noise', label: 'reduce noise', kind: 'number', min: 0, max: 1, step: 0.05, def: 0 },
      { key: 'halo', label: 'dehalo', kind: 'number', min: 0, max: 1, step: 0.05, def: 0 },
      { key: 'recover', label: 'recover detail', kind: 'number', min: 0, max: 1, step: 0.05, def: 0 },
      { key: 'grain', label: 'grain', kind: 'number', min: 0, max: 0.1, step: 0.01, def: 0 }
    ],
    scales: [1, 2, 3, 4],
    priceNote: '$0.01 a second up to 720p, $0.02 to 1080p, $0.08 above — twice at 60 fps; Gaia 2 half',
    about: 'Topaz on fal, on your fal key. Picked in both sections, it does both in one pass.'
  },
  {
    id: 'topaz-local',
    section: 'upscale',
    label: 'Topaz · this PC',
    where: 'topaz',
    fields: [
      { key: 'auto', label: 'auto settings', kind: 'bool', def: false, title: 'Topaz reads the footage and sets the sliders itself (their estimate)' },
      { key: 'prenoise', label: 'add noise', kind: 'number', min: 0, max: 0.1, step: 0.005, def: 0, title: 'noise added before it works — can help very clean CG' },
      { key: 'blend', label: 'recover original detail', kind: 'number', min: 0, max: 1, step: 0.05, def: 0, title: 'blends the original back in' },
      { key: 'grain', label: 'grain', kind: 'number', min: 0, max: 1, step: 0.05, def: 0 },
      { key: 'gsize', label: 'grain size', kind: 'number', min: 0, max: 5, step: 0.5, def: 0 },
      { key: 'vram', label: 'max GPU memory', kind: 'number', min: 0.1, max: 1, step: 0.05, def: 1 }
    ],
    scales: [1, 2, 3, 4],
    priceNote: 'free — Topaz Video on your PC, your license',
    about: 'Topaz Video on your PC, run in the background: every enhance model your install has, with each model’s own sliders.'
  }
]

export const enhanceEngine = (section: EnhanceSection, id?: string): EnhanceEngine => {
  const list = section === 'interp' ? INTERP_ENGINES : UPSCALE_ENGINES
  return list.find((e) => e.id === id) ?? list[0]
}

// ---- what a job asks for (the queue payload) ----
export interface InterpAsk {
  engine: string
  model?: string
  times: number // frames per source frame on the output clock (×2, ×4, ×8)
  fps?: number // a target frame rate instead of `times`
  slowmo: number // 1 = same length · 2/4/8 = the copy runs that much longer (slow motion)
  settings?: Record<string, number | boolean | string>
}
export interface UpscaleAsk {
  engine: string
  model?: string
  scale?: number // ×2 / ×4
  height?: number // a target height instead
  settings?: Record<string, number | boolean | string>
}
export type EnhanceSourceRef = { kind: 'take'; clipId: string; takeId: string } | { kind: 'video'; videoId: string }
export interface EnhanceArgs {
  jobId?: string
  source: EnhanceSourceRef
  interp?: InterpAsk
  upscale?: UpscaleAsk
  adoptItemIds?: string[] // Optical Flow (list 51): timeline blocks that play the copy when it lands
  preview?: { atSec: number; sec: number } // engines on this PC: a few seconds at the playhead, nothing saved
}
export interface EnhanceResult {
  ok: boolean
  error?: string
  delta?: import('./types').ProjectDelta
  file?: string
  clipId?: string
  takeId?: string
  videoIds?: string[]
  costUsd?: number
  billed?: boolean
}

// what was done to a copy (on Take.enhanced / ProjVideo.enhanced) — decides its outline
export interface EnhanceStep {
  engine: string
  model?: string
  times?: number
  fps?: number
  slowmo?: number
  scale?: number
  height?: number
}
export interface EnhanceMark {
  of: string // the take (or Library video) it was made from
  interp?: EnhanceStep
  upscale?: EnhanceStep
}
export const interpStep = (a: InterpAsk): EnhanceStep => ({ engine: a.engine, ...(a.model ? { model: a.model } : {}), times: a.times, ...(a.fps ? { fps: a.fps } : {}), slowmo: a.slowmo || 1 })
export const upscaleStep = (a: UpscaleAsk): EnhanceStep => ({ engine: a.engine, ...(a.model ? { model: a.model } : {}), ...(a.scale ? { scale: a.scale } : {}), ...(a.height ? { height: a.height } : {}) })
// what one request's result carries: a two-stage job's first request only its own section; the
// upscale request works on frames already interpolated (interpolate runs first), so it carries both
export const stageDid = (args: EnhanceArgs, stage: 'interp' | 'upscale' | 'both'): { interp?: EnhanceStep; upscale?: EnhanceStep } => ({
  ...(args.interp ? { interp: interpStep(args.interp) } : {}),
  ...(stage !== 'interp' && args.upscale ? { upscale: upscaleStep(args.upscale) } : {})
})

// blue = interpolated, green = upscaled, purple = both (his colours, as theme vars)
export const enhanceTone = (e?: EnhanceMark | null): string | undefined => (!e ? undefined : e.interp && e.upscale ? 'var(--enh-both)' : e.interp ? 'var(--enh-interp)' : 'var(--enh-up)')
export const enhanceWords = (e?: EnhanceMark | null): string =>
  !e ? '' : [e.interp ? `interpolated ${e.interp.slowmo && e.interp.slowmo > 1 ? `slow motion ${fx(e.interp.slowmo)}` : e.interp.fps ? `to ${e.interp.fps} fps` : fx(e.interp.times ?? 2)}` : '', e.upscale ? `upscaled ${e.upscale.height ? `to ${e.upscale.height}p` : fx(e.upscale.scale ?? 2)}` : ''].filter(Boolean).join(' · ')

// ---- Optical Flow (list 51 + 52): the frames a slowed block needs, as a multiple of its take's ----
export const flowTimes = (speed: number): number => (speed >= 0.5 ? 2 : speed >= 0.25 ? 4 : 8)
// a copy made for Optical Flow keeps the take's length and multiplies its frames
export const denseEnough = (mark: EnhanceMark | undefined, speed: number): boolean => !!mark?.interp && (mark.interp.slowmo ?? 1) === 1 && (mark.interp.times ?? 1) >= flowTimes(speed)

// ---- the numbers a job ends up with ----
export function interpPlan(ask: InterpAsk, srcFps: number): { outFps: number; perFrame: number; slowmo: number } {
  const fps = srcFps > 0 ? srcFps : 24
  const slowmo = Math.max(1, ask.slowmo || 1)
  const outFps = ask.fps && ask.fps > 0 ? ask.fps : fps * Math.max(1, ask.times || 2)
  return { outFps, perFrame: (outFps / fps) * slowmo, slowmo } // frames made per source frame
}
export function upscalePlan(ask: UpscaleAsk, srcW: number, srcH: number): { w: number; h: number; factor: number } {
  const factor = ask.height && srcH > 0 ? ask.height / srcH : Math.max(1, ask.scale || 2)
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(srcW * factor), h: even(srcH * factor), factor }
}

// ---- cost honesty: the dollar number where the supplier's price can be worked out ahead ----
export function enhanceCost(o: { interp?: InterpAsk; upscale?: UpscaleAsk; src: { w: number; h: number; fps: number; sec: number } }): { usd?: number; note: string } {
  const notes: string[] = []
  let usd: number | undefined = 0
  const ip = o.interp ? interpPlan(o.interp, o.src.fps) : undefined
  const outSec = o.src.sec * (ip?.slowmo ?? 1)
  const outFps = ip?.outFps ?? o.src.fps
  const up = o.upscale ? upscalePlan(o.upscale, o.src.w, o.src.h) : undefined
  const outW = up?.w ?? o.src.w
  const outH = up?.h ?? o.src.h
  const topazFal = (o.interp?.engine === 'topaz-fal') || (o.upscale?.engine === 'topaz-fal')
  if (topazFal) {
    // one pass: $/s by output height, twice at 60 fps (their pricing line, 10-01); Gaia 2 half.
    // Topaz only interpolating (another engine upscales after it) works at the source height
    const h = o.upscale?.engine === 'topaz-fal' ? outH : o.src.h
    const rate = (h <= 720 ? 0.01 : h <= 1080 ? 0.02 : 0.08) * (outFps >= 60 ? 2 : 1) * (o.upscale?.engine === 'topaz-fal' && o.upscale.model === 'Gaia 2' ? 0.5 : 1)
    usd += rate * outSec
  }
  if (o.upscale?.engine === 'seedvr-fal') usd += (outW * outH * Math.round(outSec * outFps)) / 1e6 * 0.001
  if (o.interp?.engine === 'rife-fal') {
    usd = undefined // billed by their compute seconds: no honest number ahead
    notes.push('RIFE on fal: $0.0013 per compute second')
  }
  return { usd, note: notes.join(' · ') }
}
