// list 51 (Premiere's Reverse Speed): a reversed block plays its take's REVERSED copy, made once
// next to the take (<take>.rev.mp4, shared/reverse revFileOf). The whole take reverses in one pass
// when its frames fit in memory; a big one goes in frame-exact chunks joined last chunk first,
// its sound reversed whole. Asks for the same take share one run.
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { revFileOf } from '@koan/vidancer-ui/shared/reverse'
import { FFMPEG, probeFile, probeVideo } from './export'

export interface ReverseResult {
  ok: boolean
  made?: boolean // a copy was made just now (players rebind onto it)
  error?: string
}

const RAM_BUDGET = 2e9 // decoded frame bytes the one-pass reverse may hold
const CHUNK = 48 // frames per chunk on the big-take path
const ENCODE = ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']

function ff(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args])
    let err = ''
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().slice(-300) || `ffmpeg exited ${c}`))))
  })
}

async function build(file: string, out: string, budget: number): Promise<ReverseResult> {
  const v = await probeVideo(file)
  if (!v.codec || v.duration <= 0) return { ok: false, error: 'the take has no video' }
  const fps = v.fps || 24
  const frames = Math.max(1, Math.round(v.duration * fps))
  const part = `${out}.part.mp4`
  const dir = await mkdtemp(join(tmpdir(), 'vd-rev-'))
  try {
    if (frames * v.width * v.height * 1.5 <= budget) {
      await ff(['-i', file, '-vf', 'reverse', '-af', 'areverse', ...ENCODE, '-y', part])
    } else {
      // frame-exact chunks: seek half a frame early — the accurate seek keeps frames from there on,
      // so a chunk starts on exactly its first frame; trim hands the reverse exactly its share (the
      // reverse holds everything it's given until the end, so it must never see more)
      const parts: string[] = []
      for (let a = 0; a < frames; a += CHUNK) {
        const p = join(dir, `v${a}.mkv`)
        const n = Math.min(CHUNK, frames - a)
        await ff(['-ss', Math.max(0, (a - 0.5) / fps).toFixed(6), '-i', file, '-an', '-vf', `trim=end_frame=${n},reverse`, '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-y', p])
        parts.push(p)
      }
      const list = join(dir, 'list.txt')
      await writeFile(list, parts.reverse().map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'))
      const sound = (await probeFile(file)).hasAudio
      const wav = join(dir, 'a.wav')
      if (sound) await ff(['-i', file, '-vn', '-af', 'areverse', '-c:a', 'pcm_s16le', '-y', wav])
      // the joins leave millisecond timestamp gaps a constant-rate encode would fill with a
      // doubled frame — renumber every frame from its index instead
      await ff(['-f', 'concat', '-safe', '0', '-i', list, ...(sound ? ['-i', wav, '-map', '0:v', '-map', '1:a'] : []), '-vf', `setpts=N/(${fps}*TB)`, '-fps_mode', 'passthrough', ...ENCODE, '-y', part])
    }
    await rename(part, out)
    return { ok: true, made: true }
  } catch (e) {
    await rm(part, { force: true })
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const running = new Map<string, Promise<ReverseResult>>()

// the reversed copy of a take, made if missing or older than the take. `budget` is the one-pass
// memory ceiling (tests force the chunked path with a tiny one)
export function ensureReversed(file: string, budget = RAM_BUDGET): Promise<ReverseResult> {
  const out = revFileOf(file)
  try {
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) return Promise.resolve({ ok: true })
    if (!existsSync(file)) return Promise.resolve({ ok: false, error: 'the take file is missing' })
  } catch (e) {
    return Promise.resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
  let job = running.get(file)
  if (!job) {
    job = build(file, out, budget).finally(() => running.delete(file))
    running.set(file, job)
  }
  return job
}
