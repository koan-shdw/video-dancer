// Timeline → mp4 via bundled ffmpeg (ffmpeg-static), spawned as a child process.
// One re-encode pass: every timeline item becomes a normalized segment (video trimmed via input
// seek, storyboard/C items rendered as their beat reference images — exactly what the Monitor
// shows), all scaled/cropped to the timeline canvas (FILL centered, same as playback), concatenated,
// then the music lane is mixed under the clip audio. H.264 + AAC + faststart.
import { spawn } from 'child_process'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import type { Project, Timeline, TimelineItem, Clip, Take, PromptData, BeatField } from '../shared/types'

const FFMPEG = ((ffmpegStatic as unknown as string | null) ?? 'ffmpeg').replace('app.asar', 'app.asar.unpacked')

// ---- main-side copies of the renderer's resolution rules (timelineUtils/emitYaml) ----
const recipeDur = (pd: PromptData): number => {
  const d = parseFloat(pd.duration)
  return Number.isNaN(d) || d <= 0 ? 5 : d
}
function resolveTake(clip: Clip, item: TimelineItem): Take | undefined {
  if (item.useRecipe) return undefined
  if (clip.takes.length === 0) return undefined
  const id = item.takeId ?? clip.keeperTakeId ?? clip.takes[clip.takes.length - 1].id
  return clip.takes.find((t) => t.id === id) ?? clip.takes[clip.takes.length - 1]
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

// what one timeline item contributes to the output
type Seg =
  | { kind: 'video'; file: string; inSec: number; dur: number }
  | { kind: 'image'; file: string; dur: number }
  | { kind: 'black'; dur: number }

export interface ExportResult {
  ok: boolean
  file?: string
  error?: string
}

export async function exportTimeline(
  project: Project,
  tl: Timeline,
  outPath: string,
  onProgress: (msg: string) => void
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
    const segs: Seg[] = []
    for (const it of tl.items) {
      const clip = project.clips.find((c) => c.id === it.clipId)
      if (!clip) continue
      const take = resolveTake(clip, it)
      if (take) {
        const pr = await probeOf(take.file)
        const srcDur = take.durationSec ?? (pr.duration || recipeDur(take.snapshot ?? clip.promptData))
        const out = Math.min(it.outSec ?? srcDur, srcDur)
        const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
        segs.push({ kind: 'video', file: take.file, inSec: inn, dur: Math.max(0.25, out - inn) })
      } else {
        // storyboard / C: the beat reference images, held for their windows (what the Monitor shows)
        const recipe = clip.promptData
        const D = recipeDur(recipe)
        const still = recipe.imageIds?.[0] ? project.images.find((i) => i.id === recipe.imageIds[0])?.file : undefined
        const beats = recipe.beats
        if (beats.length === 0) {
          segs.push(still ? { kind: 'image', file: still, dur: D } : { kind: 'black', dur: D })
        } else {
          const ranges = beatRanges(beats)
          let placed = 0
          for (let i = 0; i < beats.length && placed < D; i++) {
            const isLast = i === beats.length - 1
            // the last beat extends to the item's end (the Monitor clamps beatAtTime to the last beat)
            const end = isLast ? D : Math.min(ranges[i].end, D)
            const dur = end - placed
            if (dur <= 0.01) continue
            const img = beatRefFile(beats[i], recipe.freeform, project) ?? still
            segs.push(img ? { kind: 'image', file: img, dur } : { kind: 'black', dur })
            placed = end
          }
          if (placed < D - 0.01) segs.push({ kind: 'black', dur: D - placed })
        }
      }
    }
    if (segs.length === 0) return { ok: false, error: 'nothing to export (no resolvable clips)' }
    const totalDur = segs.reduce((a, s) => a + s.dur, 0)

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
      if (s.kind === 'video') {
        args.push('-ss', s.inSec.toFixed(3), '-t', D, '-i', s.file)
        // FILL centered (cover) — exactly how the Monitor renders mismatched aspects
        filters.push(
          `[${inIdx}:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${k}]`
        )
        const hasAudio = probes.get(s.file)?.hasAudio && !tl.videoMuted
        filters.push(
          hasAudio
            ? `[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=duration=${D},apad=whole_dur=${D}[a${k}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${k}]`
        )
        inIdx++
      } else if (s.kind === 'image') {
        args.push('-loop', '1', '-t', D, '-i', s.file)
        filters.push(
          `[${inIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${k}]`
        )
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${k}]`)
        inIdx++
      } else {
        filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${D},format=yuv420p,setpts=PTS-STARTPTS[v${k}]`)
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${k}]`)
      }
      pairs.push(`[v${k}][a${k}]`)
    }
    filters.push(`${pairs.join('')}concat=n=${segs.length}:v=1:a=1[outv][seqa]`)
    let aLabel = 'seqa'
    if (useMusic && music && musicFile) {
      args.push('-i', musicFile)
      const mIn = music.inSec ?? 0
      const trim = music.outSec != null ? `atrim=start=${mIn.toFixed(3)}:end=${music.outSec.toFixed(3)}` : `atrim=start=${mIn.toFixed(3)}`
      const delayMs = Math.max(0, Math.round(music.startSec * 1000))
      filters.push(
        `[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[mus]`
      )
      filters.push(`[seqa][mus]amix=inputs=2:duration=first:normalize=0[outa]`)
      aLabel = 'outa'
      inIdx++
    }
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[outv]', '-map', `[${aLabel}]`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      '-y', outPath
    )

    // ---- run, streaming progress (out_time_ms is MICROseconds in ffmpeg's -progress output) ----
    onProgress(`exporting ${W}×${H} @ ${fps}fps…`)
    const code = await new Promise<number>((resolve, reject) => {
      const ps = spawn(FFMPEG, args)
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
        if (c !== 0) reject(new Error(err.trim().slice(-400) || `ffmpeg exited ${c}`))
        else resolve(c)
      })
    })
    void code
    onProgress('export done ✓')
    return { ok: true, file: outPath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
