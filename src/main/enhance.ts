// ENHANCE (list 52, 2026-10-01): runs one job of the ENHANCE window. Interpolate first, then
// upscale; each on its own engine: a program on this PC (RIFE, Real-ESRGAN — the Models card lands
// them), a fal model (RIFE, Topaz, SeedVR2 — the fal key) or Topaz Video on this PC (its own
// ffmpeg, his license). Topaz picked in both sections runs once. The result lands as a COPY
// (project.ts addEnhancedCopy). Spec: docs/ENHANCE-SPEC-2026-10-01.md.
//
// Built from each supplier's own docs read 10-01 (fal model pages, the two READMEs, the help of his
// Topaz Video 1.7.0's ffmpeg, its model files) and proven there where it was free: both Topaz filters
// ran headless on his license on a test pattern. Nothing else here has run against a real engine.
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { mkdtemp, mkdir, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { fal } from '@fal-ai/client'
import { FFMPEG, probeVideo, probeFile, cutSegment } from './export'
import { acquireFalKey, releaseFalKey, uploadVideoCached, downloadTo, falErrorText, trackJob, untrackJob } from './fal'
import { modelDir } from './modelStore'
import { localModelFor } from '@koan/vidancer-ui/shared/localModels'
import { enhanceEngine, interpPlan, upscalePlan, enhanceCost, interpStep, upscaleStep, type EnhanceArgs, type InterpAsk, type UpscaleAsk, type EnhanceStep } from '@koan/vidancer-ui/shared/enhance'

type Progress = (msg: string, pct?: number) => void
export interface EnhanceRun {
  file: string
  did: { interp?: EnhanceStep; upscale?: EnhanceStep }
  durationSec?: number
  costUsd?: number
}
interface Src {
  file: string
  w: number
  h: number
  fps: number
  sec: number
  frames: number
  audio: boolean
}

// ---- the kill switch: a queue ✕ stops the programs of its job ----
const running = new Map<string, Set<ChildProcess>>()
export function cancelEnhance(jobId: string): boolean {
  const set = running.get(jobId)
  if (!set?.size) return false
  for (const c of set) killTree(c)
  return true
}
function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill('SIGTERM')
}
function track(jobId: string | undefined, child: ChildProcess): ChildProcess {
  if (!jobId) return child
  const set = running.get(jobId) ?? new Set()
  set.add(child)
  running.set(jobId, set)
  child.on('close', () => set.delete(child))
  return child
}

// Topaz prints his license token to stderr (TopazAuthManager lines): never kept, logged or shown
const clean = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((l) => !/auth|token|relogin|license/i.test(l))
    .join('\n')

function run(file: string, args: string[], o: { jobId?: string; env?: NodeJS.ProcessEnv; onErr?: (line: string) => void } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = track(o.jobId, spawn(file, args, { windowsHide: true, ...(o.env ? { env: o.env } : {}) }))
    let err = ''
    ps.stderr?.on('data', (d: Buffer) => {
      const t = d.toString()
      err = (err + t).slice(-6000)
      o.onErr?.(t)
    })
    ps.stdout?.on('data', () => {})
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(clean(err).trim().slice(-400) || `${file} exited ${c}`))))
  })
}

const ENCODE = ['-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
const AUDIO = ['-c:a', 'aac', '-b:a', '192k']

async function probeSrc(file: string): Promise<Src> {
  const v = await probeVideo(file)
  if (!v.codec || v.duration <= 0) throw new Error('the source has no video')
  const fps = v.fps || 24
  return { file, w: v.width, h: v.height, fps, sec: v.duration, frames: Math.max(1, Math.round(v.duration * fps)), audio: (await probeFile(file)).hasAudio }
}

// ---- the programs the Models card lands (a zip unpacked in its row's folder) ----
function findExe(dir: string, name: string, depth = 3): string | null {
  if (!existsSync(dir)) return null
  const want = process.platform === 'win32' ? `${name}.exe` : name
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.toLowerCase() === want.toLowerCase()) return join(dir, e.name)
  }
  if (depth > 0) for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) {
    const hit = findExe(join(dir, e.name), name, depth - 1)
    if (hit) return hit
  }
  return null
}
export function localProgram(row: 'rife-ncnn' | 'realesrgan-ncnn'): string | null {
  const m = localModelFor(row)
  return m ? findExe(modelDir(m), row === 'rife-ncnn' ? 'rife-ncnn-vulkan' : 'realesrgan-ncnn-vulkan') : null
}

// ---- Topaz Video on this PC: the install, and every model it carries ----
export interface TopazSlider {
  key: string // the tvai_up option it sets
  label: string
  min: number
  max: number
  def: number
}
export interface TopazModel {
  id: string // short name + version, what the filter takes ("prob-4")
  name: string
  desc?: string
  sliders: TopazSlider[]
}
export interface TopazInstall {
  found: boolean
  ffmpeg?: string
  models?: string
  version?: string
  interp: TopazModel[]
  upscale: TopazModel[]
  detail: string
}
// the manifest's slider names → the filter's options (tvai_up help, his 1.7.0)
const SLIDER_OPT: Record<string, string> = { preBlur: 'preblur', noise: 'noise', details: 'details', halo: 'halo', blur: 'blur', compression: 'compression' }
export function readTopazModels(dir: string): { interp: TopazModel[]; upscale: TopazModel[] } {
  const newest = new Map<string, { kind: 'interp' | 'upscale'; version: number; m: TopazModel }>()
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
    let j: { shortName?: string; displayName?: string; modelType?: number; version?: number; enabled?: number; gui?: { name?: string; desc?: string }; parameters?: unknown }
    try {
      j = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
    } catch {
      continue
    }
    const kind = j.modelType === 1 ? 'upscale' : j.modelType === 2 ? 'interp' : null
    const name = j.gui?.name || j.displayName
    if (!kind || !j.shortName || j.version == null || !j.enabled || !name) continue // estimators, decoders and unnamed parts are not choices
    const sliders = (Array.isArray(j.parameters) ? (j.parameters as { name?: string; guiName?: string; min?: number; max?: number; default?: number }[]) : [])
      .filter((p) => p.name && SLIDER_OPT[p.name])
      .map((p) => ({ key: SLIDER_OPT[p.name!], label: (p.guiName ?? p.name!).toLowerCase(), min: p.min ?? 0, max: p.max ?? 1, def: p.default ?? 0 }))
    const prev = newest.get(j.shortName)
    if (!prev || j.version > prev.version) newest.set(j.shortName, { kind, version: j.version, m: { id: `${j.shortName}-${j.version}`, name, desc: j.gui?.desc, sliders } })
  }
  const pick = (k: 'interp' | 'upscale'): TopazModel[] => [...newest.values()].filter((x) => x.kind === k).map((x) => x.m).sort((a, b) => a.name.localeCompare(b.name))
  return { interp: pick('interp'), upscale: pick('upscale') }
}
let topazCache: TopazInstall | null = null
export function findTopaz(refresh = false): TopazInstall {
  if (topazCache && !refresh) return topazCache
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pd = process.env.ProgramData ?? 'C:\\ProgramData'
  for (const name of ['Topaz Video', 'Topaz Video AI']) {
    const ffmpeg = join(pf, 'Topaz Labs LLC', name, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const models = process.env.TVAI_MODEL_DIR || join(pd, 'Topaz Labs LLC', name, 'models')
    if (!existsSync(ffmpeg) || !existsSync(models)) continue
    const list = readTopazModels(models)
    topazCache = { found: true, ffmpeg, models, ...list, detail: `${name} — ${list.interp.length} frame models, ${list.upscale.length} enhance models` }
    return topazCache
  }
  topazCache = { found: false, interp: [], upscale: [], detail: 'Topaz Video is not installed on this PC' }
  return topazCache
}
const topazEnv = (t: TopazInstall): NodeJS.ProcessEnv => ({ ...process.env, TVAI_MODEL_DATA_DIR: t.models, TVAI_MODEL_DIR: t.models }) // both required (proven 10-01: without them the filter fails)

// ---- the filter strings Topaz's ffmpeg takes (option names from its own help) ----
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export function topazFilters(src: Pick<Src, 'fps' | 'w' | 'h'>, interp?: InterpAsk, upscale?: UpscaleAsk): string {
  const parts: string[] = []
  if (interp) {
    const { outFps, slowmo } = interpPlan(interp, src.fps)
    const s = interp.settings ?? {}
    parts.push(`tvai_fi=model=${interp.model || 'apo-8'}:slowmo=${slowmo}:rdt=${num(s.rdt, 0.01)}:fps=${Math.round(outFps * 1000) / 1000}:device=-2:vram=${num(s.vram, 1)}:instances=0`)
  }
  if (upscale) {
    const plan = upscalePlan(upscale, src.w, src.h)
    const s = upscale.settings ?? {}
    const sliders = Object.values(SLIDER_OPT)
      .filter((k) => typeof s[k] === 'number')
      .map((k) => `:${k}=${s[k]}`)
      .join('')
    const scale = Math.min(4, Math.max(1, Math.ceil(plan.factor - 1e-9)))
    parts.push(
      `tvai_up=model=${upscale.model || 'prob-4'}:scale=${scale}${sliders}:estimate=${s.auto ? 8 : 0}:prenoise=${num(s.prenoise, 0)}:blend=${num(s.blend, 0)}:grain=${num(s.grain, 0)}:gsize=${num(s.gsize, 0)}:kcolor=1:device=-2:vram=${num(s.vram, 1)}:instances=0`
    )
    // the model upscales by whole steps: the exact size he asked for is one plain scale away
    if (Math.abs(scale - plan.factor) > 1e-6) parts.push(`scale=${plan.w}:${plan.h}:flags=lanczos`)
  }
  return parts.join(',')
}

// Topaz's ffmpeg has no software H.264 decoder: the app's ffmpeg decodes, hands it raw frames
// through a pipe, and encodes what comes back (raw frames again), with the source's sound
async function runTopaz(src: Src, out: string, interp: InterpAsk | undefined, upscale: UpscaleAsk | undefined, jobId: string | undefined, onProgress: Progress): Promise<void> {
  const t = findTopaz()
  if (!t.found || !t.ffmpeg) throw new Error('Topaz Video is not installed on this PC')
  const plan = interp ? interpPlan(interp, src.fps) : undefined
  const expect = Math.round(src.frames * (plan?.perFrame ?? 1))
  const keepSound = src.audio && (plan?.slowmo ?? 1) === 1 // a slow-motion copy has no sound that fits it
  const dec = track(jobId, spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', src.file, '-map', '0:v:0', '-c:v', 'rawvideo', '-pix_fmt', 'rgb48le', '-f', 'nut', '-'], { windowsHide: true }))
  const tz = track(jobId, spawn(t.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-f', 'nut', '-i', '-', '-vf', topazFilters(src, interp, upscale), '-c:v', 'rawvideo', '-pix_fmt', 'rgb48le', '-f', 'nut', '-'], { windowsHide: true, env: topazEnv(t) }))
  const enc = track(jobId, spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'nut', '-i', '-', ...(keepSound ? ['-i', src.file, '-map', '0:v:0', '-map', '1:a:0?'] : []), ...ENCODE, ...(keepSound ? [...AUDIO, '-shortest'] : ['-an']), '-y', out], { windowsHide: true }))
  dec.stdout!.pipe(tz.stdin!)
  tz.stdout!.pipe(enc.stdin!)
  for (const s of [dec.stdin, tz.stdin, enc.stdin, dec.stdout, tz.stdout]) s?.on('error', () => {}) // a stopped link surfaces through its process's exit
  let tzErr = ''
  tz.stderr!.on('data', (d: Buffer) => {
    const text = d.toString()
    tzErr = (tzErr + text).slice(-6000)
    const m = /frame=\s*(\d+)/.exec(text)
    if (m) onProgress(`Topaz: frame ${m[1]} of ~${expect}`, Math.min(0.99, Number(m[1]) / expect))
  })
  let encErr = ''
  enc.stderr!.on('data', (d: Buffer) => (encErr = (encErr + d.toString()).slice(-2000)))
  // one link failing stops the other two (a broken pipe unhooks its reader, and the process feeding
  // it would wait on a full pipe forever). After a beat: a link that fails on its own, the root
  // cause (Topaz refusing), is told apart from the ones that only lost their partner
  const killed = new Set<ChildProcess>()
  const links = [dec, tz, enc]
  for (const p of links)
    p.on('close', (code) => {
      if (code === 0) return
      setTimeout(() => {
        for (const o of links)
          if (o !== p && o.exitCode === null && o.signalCode === null) {
            killed.add(o)
            o.kill()
          }
      }, 400)
    })
  const exit = (c: ChildProcess): Promise<number | null> => new Promise((r) => (c.exitCode !== null ? r(c.exitCode) : c.on('close', r)))
  const [a, b, c] = await Promise.all([exit(dec), exit(tz), exit(enc)])
  if (b !== 0 && !killed.has(tz)) throw new Error(`Topaz Video stopped (${b}): ${clean(tzErr).trim().slice(-400)}`)
  if (a !== 0 || b !== 0 || c !== 0) throw new Error(`the frames could not pass through (${a}/${c}): ${encErr.trim().slice(-300)}`)
}

// ---- frames in a folder: the two portable programs work on image folders ----
async function extractFrames(src: Src, dir: string, jobId?: string): Promise<number> {
  await mkdir(dir, { recursive: true })
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', src.file, '-map', '0:v:0', '-fps_mode', 'passthrough', join(dir, '%08d.png')], { jobId })
  return (await readdir(dir)).filter((f) => f.endsWith('.png')).length
}
function watchFolder(dir: string, total: number, say: (done: number) => void): () => void {
  const t = setInterval(() => {
    try {
      say(readdirSync(dir).filter((f) => f.endsWith('.png')).length)
    } catch {
      /* not there yet */
    }
  }, 1000)
  void total
  return () => clearInterval(t)
}
async function encodeFrames(dir: string, fps: number, out: string, sound: string | null, vf: string | null, jobId?: string): Promise<void> {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-framerate', String(Math.round(fps * 1000) / 1000), '-i', join(dir, '%08d.png'), ...(sound ? ['-i', sound, '-map', '0:v:0', '-map', '1:a:0?'] : []), ...(vf ? ['-vf', vf] : []), ...ENCODE, ...(sound ? [...AUDIO, '-shortest'] : ['-an']), '-y', out], { jobId })
}

// RIFE on this PC (rife-ncnn-vulkan README: -i frames in, -o frames out, -n the frame count the v4 models take)
export function rifeArgs(inDir: string, outDir: string, target: number, modelPath: string, s: Record<string, unknown> = {}): string[] {
  return ['-i', inDir, '-o', outDir, '-n', String(target), '-m', modelPath, '-f', '%08d.png', ...(s.tta ? ['-x'] : []), ...(s.ttaTime ? ['-z'] : []), ...(s.uhd ? ['-u'] : [])]
}
async function runRife(src: Src, out: string, ask: InterpAsk, work: string, jobId: string | undefined, onProgress: Progress): Promise<void> {
  const exe = localProgram('rife-ncnn')
  if (!exe) throw new Error('RIFE is not on this PC yet — download it in the Models card (enhance)')
  const { outFps, perFrame, slowmo } = interpPlan(ask, src.fps)
  onProgress('taking the frames out…', -1)
  const n = await extractFrames(src, join(work, 'in'), jobId)
  const target = Math.max(n + 1, Math.round(n * perFrame))
  await mkdir(join(work, 'out'), { recursive: true })
  const stop = watchFolder(join(work, 'out'), target, (d) => onProgress(`RIFE: frame ${d} of ${target}`, Math.min(0.97, d / target)))
  try {
    await run(exe, rifeArgs(join(work, 'in'), join(work, 'out'), target, join(dirname(exe), ask.model || 'rife-v4.6'), ask.settings), { jobId })
  } finally {
    stop()
  }
  onProgress('making the video…', -1)
  await encodeFrames(join(work, 'out'), outFps, out, slowmo === 1 && src.audio ? src.file : null, null, jobId)
}

// Real-ESRGAN on this PC (its README: -n model, -s 2/3/4 on the video model, the x4 models are 4×)
export function esrganArgs(inDir: string, outDir: string, model: string, scale: number, s: Record<string, unknown> = {}): string[] {
  const own = model === 'realesr-animevideov3' ? Math.min(4, Math.max(2, Math.ceil(scale))) : 4
  return ['-i', inDir, '-o', outDir, '-n', model, '-s', String(own), '-f', 'png', ...(num(s.tile, 0) > 0 ? ['-t', String(num(s.tile, 0))] : []), ...(s.tta ? ['-x'] : [])]
}
async function runEsrgan(src: Src, out: string, ask: UpscaleAsk, work: string, jobId: string | undefined, onProgress: Progress): Promise<void> {
  const exe = localProgram('realesrgan-ncnn')
  if (!exe) throw new Error('Real-ESRGAN is not on this PC yet — download it in the Models card (enhance)')
  const plan = upscalePlan(ask, src.w, src.h)
  onProgress('taking the frames out…', -1)
  const n = await extractFrames(src, join(work, 'in'), jobId)
  await mkdir(join(work, 'out'), { recursive: true })
  const stop = watchFolder(join(work, 'out'), n, (d) => onProgress(`Real-ESRGAN: frame ${d} of ${n}`, Math.min(0.97, d / n)))
  try {
    await run(exe, [...esrganArgs(join(work, 'in'), join(work, 'out'), ask.model || 'realesrgan-x4plus', plan.factor, ask.settings), '-m', join(dirname(exe), 'models')], { jobId })
  } finally {
    stop()
  }
  onProgress('making the video…', -1)
  // the model's own factor → the size he asked for
  await encodeFrames(join(work, 'out'), src.fps, out, src.audio ? src.file : null, `scale=${plan.w}:${plan.h}:flags=lanczos`, jobId)
}

// ---- the fal models (their input schemas, read 10-01) ----
export function falInput(engine: 'rife-fal' | 'topaz-fal' | 'seedvr-fal', src: Pick<Src, 'fps' | 'w' | 'h'>, videoUrl: string, interp?: InterpAsk, upscale?: UpscaleAsk): Record<string, unknown> {
  if (engine === 'rife-fal') {
    const { outFps, perFrame, slowmo } = interpPlan(interp!, src.fps)
    const between = Math.min(4, Math.max(1, Math.round(perFrame) - 1))
    const s = interp!.settings ?? {}
    return { video_url: videoUrl, num_frames: between, use_scene_detection: !!s.scenes, loop: !!s.loop, ...(slowmo === 1 ? { use_calculated_fps: true } : { use_calculated_fps: false, fps: Math.min(60, Math.max(1, Math.round(outFps))) }) }
  }
  if (engine === 'seedvr-fal') {
    const s = upscale!.settings ?? {}
    return {
      video_url: videoUrl,
      ...(upscale!.height ? { upscale_mode: 'target', target_resolution: `${upscale!.height}p` } : { upscale_mode: 'factor', upscale_factor: upscale!.scale ?? 2 }),
      noise_scale: num(s.noise, 0.1),
      ...(num(s.seed, 0) > 0 ? { seed: num(s.seed, 0) } : {}),
      output_format: 'X264 (.mp4)',
      output_quality: 'high'
    }
  }
  // Topaz on fal: one request does both — the upscale settings, and a frame rate when interpolating
  const s = upscale?.settings ?? {}
  const factor = upscale ? upscalePlan(upscale, src.w, src.h).factor : 1
  return {
    video_url: videoUrl,
    model: upscale?.model || 'Proteus',
    upscale_factor: Math.min(4, Math.max(1, Math.round(factor * 100) / 100)),
    ...(interp ? { target_fps: Math.min(60, Math.max(16, Math.round(interpPlan(interp, src.fps).outFps))) } : {}),
    ...(typeof s.compression === 'number' ? { compression: s.compression } : {}),
    ...(typeof s.noise === 'number' ? { noise: s.noise } : {}),
    ...(typeof s.halo === 'number' ? { halo: s.halo } : {}),
    ...(typeof s.grain === 'number' ? { grain: s.grain } : {}),
    ...(typeof s.recover === 'number' ? { recover_detail: s.recover } : {}),
    H264_output: true // plays wherever the app plays video
  }
}

// submit → wait → download; `onRequestId` records the job for crash recovery the moment fal takes it
async function runFal(endpoint: string, input: Record<string, unknown>, out: string, falKey: string, jobId: string | undefined, onProgress: Progress, onRequestId?: (id: string) => void): Promise<void> {
  const tracked = trackJob(jobId, endpoint)
  let result: unknown
  try {
    result = await fal.subscribe(endpoint, {
      input,
      logs: false,
      onEnqueue: (id: string) => {
        tracked?.(id)
        onRequestId?.(id)
      },
      onQueueUpdate: (u: { status?: string }) => onProgress(u.status === 'IN_PROGRESS' ? 'working on fal…' : (u.status ?? '').toLowerCase().replace(/_/g, ' ') || 'queued on fal…', -1)
    })
  } catch (e) {
    throw new Error(falErrorText(e, endpoint, Object.keys(input)))
  } finally {
    untrackJob(jobId)
  }
  void falKey
  const data = (((result as { data?: unknown }).data ?? result) || {}) as Record<string, any>
  const url: string | undefined = data?.video?.url ?? data?.video_url ?? data?.url
  if (!url) throw new Error(`No video in the fal result: ${JSON.stringify(data).slice(0, 300)}`)
  onProgress('downloading the result…', -1)
  await downloadTo(url, out)
}

// ---- one job ----
export async function runEnhance(
  srcFile: string,
  args: EnhanceArgs,
  o: { outDir: string; falKey?: string; onProgress: Progress; onRequestId?: (requestId: string, endpoint: string, stage: 'interp' | 'upscale' | 'both') => void }
): Promise<EnhanceRun> {
  if (!args.interp && !args.upscale) throw new Error('switch on INTERPOLATE, UPSCALE or both')
  const work = await mkdtemp(join(tmpdir(), 'vd-enhance-'))
  await mkdir(o.outDir, { recursive: true })
  const outName = (): string => join(o.outDir, `enhance_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`)
  const did: EnhanceRun['did'] = {}
  let src = await probeSrc(srcFile)
  const cost = enhanceCost({ interp: args.interp, upscale: args.upscale, src: { w: src.w, h: src.h, fps: src.fps, sec: src.sec } })
  const ie = args.interp ? enhanceEngine('interp', args.interp.engine) : undefined
  const ue = args.upscale ? enhanceEngine('upscale', args.upscale.engine) : undefined
  const needFal = ie?.where === 'fal' || ue?.where === 'fal'
  if (needFal && !o.falKey) throw new Error('No fal key saved — paste it in Settings first.')
  if (needFal) acquireFalKey(o.falKey!)
  try {
    // one pass where one engine does both (Topaz on fal, Topaz on this PC)
    const together = !!(args.interp && args.upscale && ie?.id === ue?.id && (ie?.id === 'topaz-fal' || ie?.id === 'topaz-local'))
    let file = srcFile
    const stage = async (which: 'interp' | 'upscale' | 'both'): Promise<void> => {
      const out = outName()
      const interp = which !== 'upscale' ? args.interp : undefined
      const upscale = which !== 'interp' ? args.upscale : undefined
      const engine = (interp ? ie : ue)!
      if (engine.where === 'topaz') await runTopaz(src, out, interp, upscale, args.jobId, o.onProgress)
      else if (engine.where === 'local') {
        const w = join(work, which)
        if (interp) await runRife(src, out, interp, w, args.jobId, o.onProgress)
        else await runEsrgan(src, out, upscale!, w, args.jobId, o.onProgress)
      } else {
        o.onProgress(`sending the video to ${engine.label.replace(' · fal', '')} on fal…`, -1)
        const url = await uploadVideoCached(src.file, undefined, (m) => o.onProgress(m, -1))
        await runFal(engine.endpoint!, falInput(engine.id as 'rife-fal' | 'topaz-fal' | 'seedvr-fal', src, url, interp, upscale), out, o.falKey!, args.jobId, o.onProgress, (id) => o.onRequestId?.(id, engine.endpoint!, which))
      }
      if (interp) did.interp = interpStep(interp)
      if (upscale) did.upscale = upscaleStep(upscale)
      if (file !== srcFile) await rm(file, { force: true }) // a middle copy is not kept
      file = out
      src = await probeSrc(out)
    }
    if (together) await stage('both')
    else {
      if (args.interp) await stage('interp') // interpolate first (his order), on the small frames
      if (args.upscale) await stage('upscale')
    }
    return { file, did, durationSec: src.sec || undefined, costUsd: cost.usd }
  } finally {
    if (needFal) releaseFalKey()
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

// a few seconds at the playhead, on the engines of this PC only (online ones cost money: they
// compare after the run). Nothing is saved: the file sits in the app's own preview folder.
export async function previewEnhance(srcFile: string, args: EnhanceArgs, dir: string, onProgress: Progress): Promise<string> {
  for (const e of [args.interp && enhanceEngine('interp', args.interp.engine), args.upscale && enhanceEngine('upscale', args.upscale.engine)]) if (e && e.where === 'fal') throw new Error(`${e.label} costs money — a preview runs only on the engines of this PC`)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true })
  const at = Math.max(0, args.preview?.atSec ?? 0)
  const cut = join(dir, `cut_${Date.now()}.mp4`)
  const probe = await probeVideo(srcFile)
  await cutSegment(srcFile, at, Math.min(probe.duration || at + 2, at + Math.max(0.5, args.preview?.sec ?? 2)), cut)
  const r = await runEnhance(cut, { ...args, preview: undefined }, { outDir: dir, onProgress })
  await rm(cut, { force: true })
  return r.file
}

// the size a copy would come out at, for the window's cost line and labels
export async function sourceFacts(file: string): Promise<{ w: number; h: number; fps: number; sec: number } | null> {
  try {
    const s = await probeSrc(file)
    return { w: s.w, h: s.h, fps: s.fps, sec: s.sec }
  } catch {
    return null
  }
}
export const fileBytes = (f: string): number => (existsSync(f) ? statSync(f).size : 0)
