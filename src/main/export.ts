// Timeline → mp4 via bundled ffmpeg (ffmpeg-static), spawned as a child process.
// One re-encode pass: every timeline item becomes a normalized segment (video trimmed via input
// seek, storyboard/C items rendered as their beat reference images — exactly what the Monitor
// shows), all scaled/cropped to the timeline canvas (FILL centered, same as playback), concatenated,
// then the music lane is mixed under the clip audio. H.264 + AAC + faststart.
import { spawn, type ChildProcess } from 'child_process'
import { mkdir, stat, rename, rm } from 'fs/promises'
import { dirname } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import type { Project, Timeline, TimelineItem, Clip, Take, PromptData, BeatField } from '../shared/types'

export const FFMPEG = ((ffmpegStatic as unknown as string | null) ?? 'ffmpeg').replace('app.asar', 'app.asar.unpacked')

// ---- main-side copies of the renderer's resolution rules (timelineUtils/emitYaml) ----
const recipeDur = (pd: PromptData): number => {
  const d = parseFloat(pd.duration)
  return Number.isNaN(d) || d <= 0 ? 5 : d
}
export function resolveTake(clip: Clip, item: TimelineItem): Take | undefined {
  if (item.useRecipe) return undefined
  if (clip.takes.length === 0) return undefined
  const explicit = item.takeId ?? clip.keeperTakeId
  if (explicit) {
    const t = clip.takes.find((x) => x.id === explicit)
    if (t) return t // explicit choices honored even when disabled
  }
  const pool = clip.takes.filter((t) => !t.disabled)
  const src = pool.length ? pool : clip.takes
  return src[src.length - 1]
}

// cut [inSec, outSec) of a video into its own file — the v2v upload sends ONLY the chosen window.
// Re-encode, not stream copy: copy snaps cuts to keyframes and the window must be frame-accurate.
export function cutSegment(src: string, inSec: number, outSec: number, outPath: string): Promise<void> {
  const dur = Math.max(0.1, outSec - inSec)
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', Math.max(0, inSec).toFixed(3), '-t', dur.toFixed(3), '-i', src,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-y', outPath
    ])
    let err = ''
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${c}`))))
  })
}

// ---- Library video import: probe codec/size, normalize when the source isn't friendly ----
// "Friendly" = H.264 in an .mp4 with the SHORT side ≤720 — plays in Electron and fits fal's
// Seedance ref limits (~480-720p, small files). Anything else re-encodes once at import.
export interface VideoProbe {
  duration: number
  codec: string // 'h264', 'hevc', …  ('' = no video stream found)
  width: number
  height: number
  fps: number // 0 when ffmpeg doesn't report a rate (stills, odd containers)
}
export function probeVideo(file: string): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const ps = spawn(FFMPEG, ['-hide_banner', '-i', file])
    let err = ''
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    const done = (): void => {
      const dm = err.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0
      const vm = err.match(/Stream #\d+:\d+.*?: Video: (\w+)[^\n]*?(\d{2,5})x(\d{2,5})/)
      const fm = err.match(/(\d+(?:\.\d+)?)\s*fps/)
      resolve({ duration, codec: vm?.[1] ?? '', width: vm ? Number(vm[2]) : 0, height: vm ? Number(vm[3]) : 0, fps: fm ? parseFloat(fm[1]) : 0 })
    }
    ps.on('close', done)
    ps.on('error', done)
  })
}

// fal's Seedance audio refs take MP3/WAV only (≤15s combined) — convert/cut Library music on demand
export function toMp3(src: string, outPath: string, inSec?: number, outSec?: number): Promise<void> {
  const windowArgs = inSec != null && outSec != null && outSec > inSec ? ['-ss', Math.max(0, inSec).toFixed(3), '-t', (outSec - inSec).toFixed(3)] : []
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...windowArgs, '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', outPath])
    let err = ''
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${c}`))))
  })
}

// re-encode to H.264 mp4 with the short side capped at 720 (aspect kept, works for portrait too)
export function normalizeVideo(src: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-i', src,
      '-vf', "scale='trunc(iw*min(1,720/min(iw,ih))/2)*2':'trunc(ih*min(1,720/min(iw,ih))/2)*2'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-y', outPath
    ])
    let err = ''
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${c}`))))
  })
}

// grab ONE frame from a video at `atSec` → png (used by the dynamic first/last-frame stills).
// A seek at/past the file's final video frame (stale durationSec, audio tails running longer
// than the picture) makes ffmpeg emit an empty/blank png — so verify the output, and on failure
// fall back to an EOF-relative decode that keeps updating one png until the TRUE last frame wins.
export async function extractFrame(video: string, atSec: number, outPng: string): Promise<boolean> {
  const run = (args: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      const ps = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args, '-y', outPng])
      ps.on('close', (c) => resolve(c === 0))
      ps.on('error', () => resolve(false))
    })
  const wrotePng = async (): Promise<boolean> => {
    try {
      return (await stat(outPng)).size > 100
    } catch {
      return false
    }
  }
  if ((await run(['-ss', Math.max(0, atSec).toFixed(3), '-i', video, '-frames:v', '1'])) && (await wrotePng())) return true
  if ((await run(['-sseof', '-1.0', '-i', video, '-update', '1', '-q:v', '2'])) && (await wrotePng())) return true
  // pathological metadata: decode the final 3s the same way before giving up
  return (await run(['-sseof', '-3.0', '-i', video, '-update', '1', '-q:v', '2'])) && (await wrotePng())
}
function beatRanges(beats: BeatField[]): { start: number; end: number }[] {
  let cur = 0
  return beats.map((b) => {
    const start = cur
    const end = cur + (b.length || 0)
    cur = end
    return { start, end }
  })
}
// a beat's reference image file = first @mention in the beat's own text, else in the prompt
function beatRefFile(beat: BeatField, freeform: string, p: Project): string | undefined {
  const beatText = [beat.camera, beat.action, beat.lighting, beat.dialogue, beat.vfx, beat.reaction, beat.sfx]
    .filter(Boolean)
    .join(' ')
  const m = beatText.match(/@\w+/) ?? (freeform || '').match(/@\w+/)
  if (!m) return undefined
  return p.images.find((i) => i.title === m[0])?.file
}

// ---- probe a media file by parsing `ffmpeg -i` stderr (no ffprobe binary needed) ----
interface Probe {
  duration: number
  fps: number
  hasAudio: boolean
}
function probeFile(file: string): Promise<Probe> {
  return new Promise((resolve) => {
    const ps = spawn(FFMPEG, ['-hide_banner', '-i', file])
    let err = ''
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    const done = (): void => {
      const dm = err.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0
      const fm = err.match(/(\d+(?:\.\d+)?)\s*fps/)
      resolve({ duration, fps: fm ? parseFloat(fm[1]) : 0, hasAudio: /:\s*Audio:/.test(err) })
    }
    ps.on('close', done)
    ps.on('error', done)
  })
}

// what one INTERVAL of the composed timeline contributes to the output (v14: intervals come from
// slicing absolute time at every block edge / beat edge; the topmost visible track wins)
type Seg = (
  | { kind: 'video'; file: string; inSec: number; dur: number; muted?: boolean; speed?: number; fadeOut?: number }
  | { kind: 'image'; file: string; dur: number; fadeOut?: never }
  | { kind: 'black'; dur: number; fadeOut?: never }
) & { bake?: { file: string; inSec: number } } // v16 — composited FX segment replaces the VIDEO (audio stays original)

// v16 — a baked FX span: [start,end) in timeline seconds, video pre-composited by the renderer
export interface ExportBake {
  start: number
  end: number
  file: string
}

// geometry + fps the renderer needs BEFORE baking FX spans (mirrors exportTimeline's own math)
export async function planExport(project: Project, tl: Timeline): Promise<{ W: number; H: number; fps: number }> {
  const [aw, ah] = tl.aspectRatio.split(':').map(Number)
  const ar = aw > 0 && ah > 0 ? aw / ah : 16 / 9
  const tier = parseInt(tl.exportRes ?? '1080', 10) || 1080
  const even = (x: number): number => Math.max(2, Math.round(x / 2) * 2)
  const W = ar >= 1 ? even(tier * ar) : tier
  const H = ar >= 1 ? tier : even(tier / ar)
  let fps = tl.exportFps && tl.exportFps !== 'auto' ? parseInt(tl.exportFps, 10) : 0
  if (!fps) {
    const first = [...tl.items]
      .filter((it) => !it.disabled)
      .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
      .map((it) => {
        const clip = project.clips.find((c) => c.id === it.clipId)
        return clip ? resolveTake(clip, it)?.file : undefined
      })
      .find((f) => !!f)
    const p = first ? await probeVideo(first) : undefined
    fps = p?.fps ? Math.max(12, Math.min(60, Math.round(p.fps))) : 24
  }
  return { W, H, fps }
}

// chain atempo stages into the 0.25–4 range ffmpeg can't do in one filter
function atempoChain(speed: number): string {
  let s = speed
  const parts: string[] = []
  while (s > 2) {
    parts.push('atempo=2.0')
    s /= 2
  }
  while (s < 0.5) {
    parts.push('atempo=0.5')
    s *= 2
  }
  parts.push(`atempo=${s.toFixed(4)}`)
  return parts.join(',')
}

export interface ExportResult {
  ok: boolean
  file?: string
  error?: string
}

// the running export's ffmpeg — a wrong hour-long export must be stoppable without killing the
// app (which used to orphan the process, still writing). index.ts wires export:cancel + quit.
let currentExport: ChildProcess | null = null
let exportCancelled = false
export function cancelExport(): boolean {
  if (!currentExport) return false
  exportCancelled = true
  try {
    currentExport.kill()
  } catch {
    /* already exited */
  }
  return true
}

export async function exportTimeline(
  project: Project,
  tl: Timeline,
  outPath: string,
  onProgress: (msg: string) => void,
  bakes?: ExportBake[]
): Promise<ExportResult> {
  try {
    if (tl.items.length === 0) return { ok: false, error: 'timeline is empty' }
    await mkdir(dirname(outPath), { recursive: true })

    // ---- output geometry: aspect → W×H at the export tier (tier = the SHORTER side) ----
    const [aw, ah] = tl.aspectRatio.split(':').map(Number)
    const ar = aw > 0 && ah > 0 ? aw / ah : 16 / 9
    const tier = parseInt(tl.exportRes ?? '1080', 10) || 1080
    const even = (x: number): number => Math.max(2, Math.round(x / 2) * 2)
    const W = ar >= 1 ? even(tier * ar) : tier
    const H = ar >= 1 ? tier : even(tier / ar)

    // ---- flatten the timeline into segments (same rules the Monitor plays by) ----
    onProgress('probing sources…')
    const probes = new Map<string, Probe>()
    const probeOf = async (file: string): Promise<Probe> => {
      let p = probes.get(file)
      if (!p) {
        p = await probeFile(file)
        probes.set(file, p)
      }
      return p
    }
    // ---- v14: slice ABSOLUTE time into intervals; the topmost visible track wins each one ----
    const spOf = (it: TimelineItem): number => (it.speed && it.speed > 0 ? it.speed : 1)
    const srcDurOfItem = async (it: TimelineItem): Promise<number> => {
      const clip = project.clips.find((c) => c.id === it.clipId)
      if (!clip) return 5
      const take = resolveTake(clip, it)
      if (!take) return recipeDur(clip.promptData)
      const pr = await probeOf(take.file)
      return take.durationSec ?? (pr.duration || recipeDur(take.snapshot ?? clip.promptData))
    }
    const effOf = new Map<string, number>() // item id → effective (timeline) length
    for (const it of tl.items) {
      const src = await srcDurOfItem(it)
      if (it.useRecipe) effOf.set(it.id, src / spOf(it))
      else {
        const out = Math.min(it.outSec ?? src, src)
        const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
        effOf.set(it.id, Math.max(0.25 / spOf(it), (out - inn) / spOf(it))) // source-second floor — keep in step with renderer effDur
      }
    }
    const itStart = (it: TimelineItem): number => it.startSec ?? 0
    const itemStarts = new Map<string, number>(tl.items.map((it) => [it.id, itStart(it)])) // anchors linked audio lanes
    // ---- v17 ⟲ LOOP TAILS — mirror of renderer lib/timelineUtils tailEndOf/extentOf (this
    // planner re-derives eff math the same way; keep the two in step) ----
    const musicAsset = tl.music ? project.audio.find((a) => a.id === tl.music!.audioId) : undefined
    let musicDurKnown = musicAsset?.durationSec
    if (tl.music && musicDurKnown == null && musicAsset?.file) {
      try {
        musicDurKnown = (await probeOf(musicAsset.file)).duration || undefined
      } catch {
        /* unknowable — elastic tails just can't reach the song end */
      }
    }
    const musicEndSec = ((): number => {
      const m = tl.music
      if (!m) return 0
      const out = m.outSec ?? musicDurKnown
      if (out == null) return 0
      return m.startSec + Math.max(0, Math.min(out, musicDurKnown ?? out) - (m.inSec ?? 0))
    })()
    const nextOnTrack = (it: TimelineItem): number | null => {
      let best: number | null = null
      for (const x of tl.items) {
        if (x.id === it.id || (x.track ?? 0) !== (it.track ?? 0)) continue
        const s = itStart(x)
        if (s > itStart(it) + 1e-3 && (best == null || s < best)) best = s
      }
      return best
    }
    const physEndOf = (it: TimelineItem): number => itStart(it) + (effOf.get(it.id) ?? 0)
    const extOf = (it: TimelineItem): number => {
      const base = physEndOf(it)
      if (!it.loop) return base
      const next = nextOnTrack(it)
      if (it.loopTailSec != null) return Math.max(base, Math.min(base + it.loopTailSec, next ?? Infinity))
      if (next != null) return Math.max(base, next)
      let hard = musicEndSec
      for (const x of tl.items) {
        if (x.id === it.id) continue
        const xb = physEndOf(x)
        const xe = x.loop && x.loopTailSec != null ? Math.max(xb, Math.min(xb + x.loopTailSec, nextOnTrack(x) ?? Infinity)) : xb
        if (xe > hard) hard = xe
      }
      return Math.max(base, hard)
    }
    // per-track visibility (mute/solo on video tracks)
    const solosV = (tl.soloTracks ?? []).filter((t) => t.startsWith('v'))
    const hiddenTrack = (tr: number): boolean => {
      const key = `v${tr}`
      return solosV.length ? !solosV.includes(key) : (tl.mutedTracks ?? []).includes(key)
    }
    // ⊘ disabled items export as if absent (invisible + silent) — but keep occupying their span
    const visItems = tl.items.filter((it) => !it.disabled && !hiddenTrack(it.track ?? 0) && project.clips.some((c) => c.id === it.clipId))
    const fullEnd = visItems.reduce((m, it) => Math.max(m, extOf(it)), 0)
    // export window = the in/out range when set, else the whole sequence
    const R0 = tl.rangeInSec != null && tl.rangeOutSec != null && tl.rangeOutSec > tl.rangeInSec ? Math.max(0, tl.rangeInSec) : 0
    const R1 = tl.rangeInSec != null && tl.rangeOutSec != null && tl.rangeOutSec > tl.rangeInSec ? Math.min(fullEnd, tl.rangeOutSec) : fullEnd
    if (R1 - R0 < 0.05) return { ok: false, error: 'nothing to export (empty timeline / range)' }
    // boundaries: block edges + storyboard beat edges + the window bounds (+ FX bake edges)
    const bounds = new Set<number>([R0, R1])
    for (const b of bakes ?? []) {
      if (b.start > R0 && b.start < R1) bounds.add(b.start)
      if (b.end > R0 && b.end < R1) bounds.add(b.end)
    }
    for (const it of visItems) {
      const s = itStart(it)
      const ext = extOf(it)
      const cyc = effOf.get(it.id) ?? 0
      if (ext > R0 && s < R1) {
        bounds.add(Math.max(R0, s))
        bounds.add(Math.min(R1, ext))
        // ⟲ seams — every repeat becomes its own interval, so srcIn stays linear inside any one
        if (it.loop && cyc > 0.05) {
          for (let seam = s + cyc; seam < Math.min(R1, ext) - 0.01; seam += cyc) if (seam > R0) bounds.add(seam)
        }
        const clip = project.clips.find((c) => c.id === it.clipId)
        if (clip && !resolveTake(clip, it) && clip.promptData.beats.length) {
          // storyboard beat edges repeat per cycle inside a tail
          const reps = it.loop && cyc > 0.05 ? Math.ceil((Math.min(R1, ext) - s) / cyc) : 1
          for (let k = 0; k < reps; k++)
            for (const r of beatRanges(clip.promptData.beats)) {
              const abs = s + k * cyc + r.end / spOf(it)
              if (abs > R0 && abs < Math.min(R1, ext)) bounds.add(abs)
            }
        }
      }
    }
    const cuts = [...bounds].sort((a, b) => a - b)
    const topAt = (T: number): TimelineItem | undefined => {
      let best: TimelineItem | undefined
      for (const it of visItems) {
        const s = itStart(it)
        if (T < s - 1e-6 || T >= extOf(it) - 1e-6) continue
        if (!best || (it.track ?? 0) > (best.track ?? 0)) best = it
      }
      return best
    }
    // a bake owning an interval supplies that interval's VIDEO (audio stays with the original take)
    const bakeFor = (a: number): { file: string; inSec: number } | undefined => {
      const mid = a + 0.005
      const bk = (bakes ?? []).find((x) => mid >= x.start - 1e-6 && mid < x.end - 1e-6)
      return bk ? { file: bk.file, inSec: Math.max(0, a - bk.start) } : undefined
    }
    const segs: Seg[] = []
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i]
      const b = cuts[i + 1]
      const dur = b - a
      if (dur < 0.01) continue
      const top = topAt((a + b) / 2)
      const bake = bakeFor(a)
      const clip = top ? project.clips.find((c) => c.id === top.clipId) : undefined
      if (!top || !clip) {
        segs.push({ kind: 'black', dur, ...(bake ? { bake } : {}) })
        continue
      }
      const take = resolveTake(clip, top)
      // ⟲ inside a tail the source WRAPS per cycle (each cycle is its own interval — seams are cuts)
      const cycT = effOf.get(top.id) ?? 0
      const wrapRel = (rel: number): number => (top.loop && cycT > 0.05 && rel >= cycT ? rel % cycT : rel)
      if (take) {
        const sp = spOf(top)
        const base = top.useRecipe ? 0 : (top.inSec ?? 0)
        const srcIn = base + wrapRel(a - itStart(top)) * sp
        // dissolve (export = fade-out into the next interval; the monitor previews a true cross)
        const topEnd = extOf(top) // fires at the TAIL end, never a seam
        const tr = top.transitionOutSec ?? 0
        const fadeOut = tr > 0 && Math.abs(b - topEnd) < 0.02 ? Math.min(tr, dur) : undefined
        segs.push({ kind: 'video', file: take.file, inSec: srcIn, dur, muted: top.muted || !!top.audioDetachedId, speed: sp !== 1 ? sp : undefined, fadeOut, ...(bake ? { bake } : {}) })
      } else {
        const recipe = clip.promptData
        const still = recipe.imageIds?.[0] ? project.images.find((im) => im.id === recipe.imageIds[0])?.file : undefined
        let img = still
        if (recipe.beats.length) {
          const srcT = wrapRel((a + b) / 2 - itStart(top))
          const ranges = beatRanges(recipe.beats)
          const bi = Math.max(0, ranges.findIndex((r) => srcT >= r.start && srcT < r.end))
          img = beatRefFile(recipe.beats[bi === -1 ? recipe.beats.length - 1 : bi], recipe.freeform, project) ?? still
        }
        segs.push(img ? { kind: 'image', file: img, dur, ...(bake ? { bake } : {}) } : { kind: 'black', dur, ...(bake ? { bake } : {}) })
      }
    }
    if (segs.length === 0) return { ok: false, error: 'nothing to export (no resolvable clips)' }
    const totalDur = R1 - R0

    // ---- fps: explicit, or the first video segment's native rate ----
    let fps = tl.exportFps && tl.exportFps !== 'auto' ? parseInt(tl.exportFps, 10) : 0
    if (!fps) {
      const firstVid = segs.find((s) => s.kind === 'video') as Extract<Seg, { kind: 'video' }> | undefined
      const p = firstVid ? await probeOf(firstVid.file) : undefined
      fps = p?.fps ? Math.max(12, Math.min(60, Math.round(p.fps))) : 24
    }

    // ---- music lane ----
    const music = !tl.musicMuted && tl.music ? tl.music : undefined
    const musicFile = music ? project.audio.find((a) => a.id === music.audioId)?.file : undefined
    const useMusic = !!(music && musicFile && music.startSec < totalDur - 0.05)

    // ---- assemble the ffmpeg command: inputs + one filter_complex + single encode ----
    const args: string[] = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1']
    const filters: string[] = []
    const pairs: string[] = [] // [vK][aK] labels in timeline order
    let inIdx = 0
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k]
      const D = s.dur.toFixed(3)
      // v16 — baked FX interval: the composited segment IS the picture (already W×H @ fps).
      // Audio still comes from the original inputs below, so the two paths never drift.
      let bakeIdx = -1
      if (s.bake) {
        args.push('-ss', s.bake.inSec.toFixed(3), '-t', D, '-i', s.bake.file)
        bakeIdx = inIdx++
        const fade = s.kind === 'video' && s.fadeOut ? `,fade=t=out:st=${Math.max(0, s.dur - s.fadeOut).toFixed(3)}:d=${s.fadeOut.toFixed(3)}` : ''
        filters.push(`[${bakeIdx}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H},setsar=1,format=yuv420p${fade}[v${k}]`)
      }
      if (s.kind === 'video') {
        const sp = s.speed ?? 1
        args.push('-ss', s.inSec.toFixed(3), '-t', (s.dur * sp).toFixed(3), '-i', s.file)
        // FILL centered (cover) — exactly how the Monitor renders mismatched aspects; speed via
        // setpts; a dissolve tail fades to black (the next interval fades in from its own content)
        const fade = s.fadeOut ? `,fade=t=out:st=${Math.max(0, s.dur - s.fadeOut).toFixed(3)}:d=${s.fadeOut.toFixed(3)}` : ''
        if (bakeIdx < 0)
          filters.push(
            `[${inIdx}:v]setpts=(PTS-STARTPTS)/${sp.toFixed(4)},fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p${fade}[v${k}]`
          )
        const hasAudio = probes.get(s.file)?.hasAudio && !tl.videoMuted && !s.muted
        const afade = s.fadeOut ? `,afade=t=out:st=${Math.max(0, s.dur - s.fadeOut).toFixed(3)}:d=${s.fadeOut.toFixed(3)}` : ''
        filters.push(
          hasAudio
            ? `[${inIdx}:a]${sp !== 1 ? atempoChain(sp) + ',' : ''}aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=duration=${D},apad=whole_dur=${D}${afade}[a${k}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${k}]`
        )
        inIdx++
      } else if (s.kind === 'image') {
        if (bakeIdx < 0) {
          args.push('-loop', '1', '-t', D, '-i', s.file)
          filters.push(
            `[${inIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${k}]`
          )
          inIdx++
        }
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${k}]`)
      } else {
        if (bakeIdx < 0) filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${D},format=yuv420p,setpts=PTS-STARTPTS[v${k}]`)
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${k}]`)
      }
      pairs.push(`[v${k}][a${k}]`)
    }
    filters.push(`${pairs.join('')}concat=n=${segs.length}:v=1:a=1[outv][seqa]`)
    // extra audio layers mixed UNDER the sequence: the music lane + every audible detached
    // clip-audio block (positions computed exactly like the Monitor plays them)
    const mixLabels: string[] = ['seqa']
    if (useMusic && music && musicFile) {
      // shift the music into the export window (range exports advance the in-point)
      let mIn = music.inSec ?? 0
      let startEff = music.startSec - R0
      if (startEff < 0) {
        mIn += -startEff
        startEff = 0
      }
      const mOutCap = music.outSec
      if (startEff < totalDur - 0.05 && (mOutCap == null || mOutCap > mIn)) {
        args.push('-i', musicFile)
        const trim = mOutCap != null ? `atrim=start=${mIn.toFixed(3)}:end=${mOutCap.toFixed(3)}` : `atrim=start=${mIn.toFixed(3)}`
        filters.push(
          `[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim},asetpts=PTS-STARTPTS,adelay=${Math.round(startEff * 1000)}:all=1[mus]`
        )
        mixLabels.push('mus')
        inIdx++
      }
    }
    // detached clip audio: absolute-time lanes with gain/fades + per-lane mute/solo, shifted into the window
    if (!tl.videoMuted && tl.audioItems?.length) {
      const solosA = (tl.soloTracks ?? []).filter((t) => t.startsWith('a'))
      const laneMuted = (lane: number): boolean => {
        const key = `a${lane}`
        return solosA.length ? !solosA.includes(key) : (tl.mutedTracks ?? []).includes(key)
      }
      let ai = 0
      for (const a of tl.audioItems) {
        if (a.muted || laneMuted(a.lane)) continue
        const srcClip = project.clips.find((c) => c.id === a.source.clipId)
        const take = srcClip?.takes.find((t) => t.id === a.source.takeId)
        if (!take) continue
        const pr = await probeOf(take.file) // cached — cheap when the video segs probed it already
        if (!pr.hasAudio) continue
        const absStart = a.link && itemStarts.has(a.link.itemId) ? Math.max(0, (itemStarts.get(a.link.itemId) ?? 0) + a.link.offset) : a.startSec
        let aIn = a.inSec
        let startEff = absStart - R0
        if (startEff < 0) {
          aIn += -startEff
          startEff = 0
        }
        if (startEff >= totalDur - 0.05 || aIn >= a.outSec - 0.05) continue
        const label = `lane${ai++}`
        args.push('-i', take.file)
        const span = a.outSec - aIn
        const g = a.gain ?? 1
        const fIn = a.fadeInSec ? `,afade=t=in:st=0:d=${Math.min(a.fadeInSec, span).toFixed(3)}` : ''
        const fOut = a.fadeOutSec ? `,afade=t=out:st=${Math.max(0, span - a.fadeOutSec).toFixed(3)}:d=${Math.min(a.fadeOutSec, span).toFixed(3)}` : ''
        const vol = g !== 1 ? `,volume=${g.toFixed(3)}` : ''
        filters.push(
          `[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${aIn.toFixed(3)}:end=${a.outSec.toFixed(3)},asetpts=PTS-STARTPTS${fIn}${fOut}${vol},adelay=${Math.round(startEff * 1000)}:all=1[${label}]`
        )
        mixLabels.push(label)
        inIdx++
      }
    }
    let aLabel = 'seqa'
    if (mixLabels.length > 1) {
      filters.push(`${mixLabels.map((l) => `[${l}]`).join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[outa]`)
      aLabel = 'outa'
    }
    // encode to a .part and rename on success — a failed/killed export must never leave a
    // truncated mp4 at the destination that LOOKS complete
    const partPath = `${outPath}.part.mp4`
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[outv]', '-map', `[${aLabel}]`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      '-f', 'mp4', '-y', partPath
    )

    // ---- run, streaming progress (out_time_ms is MICROseconds in ffmpeg's -progress output) ----
    onProgress(`exporting ${W}×${H} @ ${fps}fps…`)
    exportCancelled = false
    try {
      await new Promise<number>((resolve, reject) => {
        const ps = spawn(FFMPEG, args)
        currentExport = ps
        let err = ''
        ps.stdout.on('data', (d: Buffer) => {
          const m = d.toString().match(/out_time_ms=(\d+)/)
          if (m && totalDur > 0) {
            const pct = Math.min(99, Math.round((Number(m[1]) / 1e6 / totalDur) * 100))
            onProgress(`exporting… ${pct}%`)
          }
        })
        ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
        ps.on('error', (e) => reject(e))
        ps.on('close', (c) => {
          if (exportCancelled) reject(new Error('cancelled'))
          else if (c !== 0) reject(new Error(err.trim().slice(-400) || `ffmpeg exited ${c}`))
          else resolve(c ?? 0)
        })
      })
    } catch (e) {
      await rm(partPath, { force: true }).catch(() => undefined)
      throw e
    } finally {
      currentExport = null
    }
    await rename(partPath, outPath)
    onProgress('export done ✓')
    return { ok: true, file: outPath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
