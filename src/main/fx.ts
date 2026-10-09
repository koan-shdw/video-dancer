// EFFECTS (v16) — main-side machinery for the FX system. Three jobs, all ffmpeg-pipe based:
//   1. SIDECARS — AI pass videos living NEXT TO the take file (never in the schema):
//        <take>.matte.mp4  grayscale subject matte (white = subject)
//        <take>.depth.mp4  grayscale depth (white = near)
//      The renderer runs the models (onnxruntime-web) and streams gray frames here; ffmpeg
//      encodes the sidecar. Existence = cached; delete the file to re-run a pass.
//   2. MODELS — ONNX weights downloaded once to userData/models (streaming, resumable-by-redo,
//      progress events to the renderer). The installer ships no weights.
//   3. BAKES — export parity: the renderer steps the compositor frame by frame and streams RGBA
//      frames; ffmpeg encodes a temp segment that export.ts splices in place of the raw takes.
import { WebContents } from 'electron'
import { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, rename, rm } from 'fs/promises'
import { join, dirname } from 'path'
import { FFMPEG, runFfmpeg } from './export'
import * as modelStore from './modelStore'

// ---- sidecars ----
export const mattePathOf = (takeFile: string): string => `${takeFile}.matte.mp4`
export const depthPathOf = (takeFile: string): string => `${takeFile}.depth.mp4`

export function fxSidecars(takeFile: string): { matte?: string; depth?: string } {
  const m = mattePathOf(takeFile)
  const d = depthPathOf(takeFile)
  return { ...(existsSync(m) ? { matte: m } : {}), ...(existsSync(d) ? { depth: d } : {}) }
}

// ---- models ----
// The weights themselves live in the local-model registry (shared/localModels.ts, ids 'matte'
// and 'depth') and download through the shared downloader (main/modelStore.ts) — the Models
// card is the only download surface (LOCAL-MODELS-PLAN phase 2). These delegates keep the fx
// call sites and the legacy 'fx:modelProgress' channel (forwarded by modelStore) unchanged.
export type FxModelKind = 'matte' | 'depth'

export const modelPath = (kind: FxModelKind): string | null => modelStore.primaryPath(kind)

export async function ensureModel(kind: FxModelKind, wc: WebContents): Promise<string> {
  return modelStore.download(kind, wc)
}

// a model that downloaded complete but fails to PARSE (bad bytes, wrong file behind a moved
// URL) would otherwise be cached forever — the renderer calls this after a session-init failure
// so the next attempt re-downloads instead of failing identically
export async function deleteModel(kind: FxModelKind): Promise<void> {
  await modelStore.deleteModel(kind)
}

// ---- streaming frame encoders (passes = gray sidecars · bakes = RGBA export segments) ----
interface EncodeJob {
  ps: ChildProcess
  dest: string // final path (encoder writes dest + '.part')
  err: string
  done: Promise<number> // ffmpeg exit code
}
const jobs = new Map<string, EncodeJob>()
let jobId = 0

function startEncode(args: string[], dest: string): string {
  const id = `enc${++jobId}`
  const ps = runFfmpeg(args)
  const job: EncodeJob = {
    ps,
    dest,
    err: '',
    done: new Promise<number>((resolve) => {
      ps.on('close', (c) => resolve(c ?? -1))
      ps.on('error', () => resolve(-1))
    })
  }
  ps.stderr?.on('data', (d: Buffer) => (job.err = (job.err + d.toString()).slice(-2000)))
  jobs.set(id, job)
  return id
}

// gray pass sidecar: rawvideo gray frames in → x264 next to the take
export async function passStart(takeFile: string, kind: 'matte' | 'depth', w: number, h: number, fps: number): Promise<{ id: string }> {
  const dest = kind === 'matte' ? mattePathOf(takeFile) : depthPathOf(takeFile)
  await mkdir(dirname(dest), { recursive: true })
  const id = startEncode(
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      // '-f mp4' is REQUIRED: ffmpeg cannot infer a container from the '.part' temp extension
      // and dies before writing a byte ("Unable to choose an output format") — the v16 encoder
      // never worked without this. (2026-08-09, app closed for this edit)
      '-movflags', '+faststart', '-f', 'mp4', '-y', `${dest}.part`
    ],
    dest
  )
  return { id }
}

// RGBA bake segment: compositor frames in → x264 temp file for the export splice
export async function bakeStart(projectDir: string, w: number, h: number, fps: number): Promise<{ id: string; file: string }> {
  const dir = join(projectDir, 'exports', '.fxbake')
  await mkdir(dir, { recursive: true })
  const dest = join(dir, `bake-${Date.now()}-${++jobId}.mp4`)
  const id = startEncode(
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', 'pipe:0',
      '-an',
      // RGB→YUV via bt709 and TAG it: swscale defaults to bt601, which color-shifts baked spans
      // against the surrounding untouched take segments (bt709) at every splice boundary
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p',
      // same '.part' container fix as passStart — this path had the identical latent bug
      '-movflags', '+faststart', '-f', 'mp4', '-y', `${dest}.part`
    ],
    dest
  )
  return { id, file: dest }
}

// one frame in — honors stdin backpressure so 100MB of frames never sits in memory
export async function encodeFrame(id: string, frame: Uint8Array): Promise<boolean> {
  const job = jobs.get(id)
  if (!job || !job.ps.stdin || job.ps.stdin.destroyed) return false
  const ok = job.ps.stdin.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength))
  if (!ok) await new Promise<void>((resolve) => job.ps.stdin!.once('drain', resolve))
  return true
}

export async function encodeEnd(id: string, keep: boolean): Promise<{ ok: boolean; file?: string; error?: string }> {
  const job = jobs.get(id)
  if (!job) return { ok: false, error: 'no such encode' }
  jobs.delete(id)
  job.ps.stdin?.end()
  const code = await job.done
  const part = `${job.dest}.part`
  if (!keep || code !== 0) {
    await rm(part, { force: true })
    return keep ? { ok: false, error: job.err.trim().slice(-300) || `ffmpeg exited ${code}` } : { ok: true }
  }
  await rename(part, job.dest)
  return { ok: true, file: job.dest }
}

// wipe stale bake temp dirs (called when an export starts). NEVER throws: a locked .part (an
// orphaned encoder from a reloaded renderer held one — the EBUSY that killed export:plan) is
// only disk waste, and disk waste must never refuse an export. Orphans are reaped first.
export async function cleanBakes(projectDir: string): Promise<void> {
  const dir = join(projectDir, 'exports', '.fxbake')
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    await abortAllJobs() // whoever held the lock dies now
    await rm(dir, { recursive: true, force: true }).catch((e) => console.error('[fx] stale bake dir still locked — skipping cleanup:', e instanceof Error ? e.message : e))
  }
}

// a renderer crash / window close mid-pass otherwise leaves ffmpeg children alive forever,
// blocked on stdin with an orphaned .part — index.ts calls this on render-process-gone/close
export async function abortAllJobs(): Promise<void> {
  const dead = [...jobs.entries()]
  jobs.clear()
  for (const [, job] of dead) {
    try {
      job.ps.stdin?.destroy()
      job.ps.kill()
    } catch {
      /* already gone */
    }
    await rm(`${job.dest}.part`, { force: true }).catch(() => undefined)
  }
}
