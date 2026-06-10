// Filmstrip cache: each video file is sampled ONCE; display is resampled from the cache.
// The cache is LRU-capped (frames are ~25-30KB jpegs × 20 per video — unbounded growth was a
// 100-300MB/session leak) and cleared on project switch.
import { useEffect, useState } from 'react'
import { mediaUrl } from '../media'

export const STRIP_H = 90 // capture height; width derived from source aspect so frames are never stretched
const STRIP_SAMPLES = 20 // frames sampled across the full clip, once per file
const STRIP_MAX = 50 // LRU cap (~50 videos ≈ 25-30MB of jpeg frames)

export type Strip = { dur: number; ts: number[]; frames: string[]; aspect: number }
const STRIP_CACHE = new Map<string, Strip>()
const STRIP_INFLIGHT = new Map<string, Promise<Strip | null>>()

// call when the project changes — strips belong to the old project's files
export function clearStrips(): void {
  STRIP_CACHE.clear()
}

function cacheGet(file: string): Strip | undefined {
  const s = STRIP_CACHE.get(file)
  if (s) {
    // refresh recency (Map preserves insertion order → first key is the LRU victim)
    STRIP_CACHE.delete(file)
    STRIP_CACHE.set(file, s)
  }
  return s
}

function cacheSet(file: string, s: Strip): void {
  STRIP_CACHE.delete(file)
  STRIP_CACHE.set(file, s)
  while (STRIP_CACHE.size > STRIP_MAX) {
    const oldest = STRIP_CACHE.keys().next().value
    if (oldest === undefined) break
    STRIP_CACHE.delete(oldest)
  }
}

async function extractStrip(file: string): Promise<Strip | null> {
  // stream via media:// (Range-capable) — no whole-file IPC copy. crossOrigin keeps the canvas
  // untainted (the media handler sends CORS headers and only serves the open project's files).
  const video = document.createElement('video')
  video.muted = true
  video.crossOrigin = 'anonymous'
  video.preload = 'auto'
  video.src = mediaUrl(file)
  await new Promise<void>((res) => {
    video.onloadedmetadata = () => res()
    video.onerror = () => res()
  })
  const dur = video.duration || 0
  if (!dur) return null
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
  const W = Math.max(1, Math.round(STRIP_H * aspect))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = STRIP_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const ts: number[] = []
  const frames: string[] = []
  for (let i = 0; i < STRIP_SAMPLES; i++) {
    const t = Math.min(dur - 0.01, Math.max(0, ((i + 0.5) / STRIP_SAMPLES) * dur))
    await new Promise<void>((res) => {
      const onSeeked = (): void => {
        video.removeEventListener('seeked', onSeeked)
        res()
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = t
    })
    try {
      ctx.drawImage(video, 0, 0, W, STRIP_H)
      frames.push(canvas.toDataURL('image/jpeg', 0.6))
      ts.push(t)
    } catch {
      /* skip frame */
    }
  }
  video.removeAttribute('src') // release the decoder/stream promptly
  video.load()
  return frames.length ? { dur, ts, frames, aspect } : null
}

function ensureStrip(file: string): Promise<Strip | null> {
  const cached = cacheGet(file)
  if (cached) return Promise.resolve(cached)
  let p = STRIP_INFLIGHT.get(file)
  if (!p) {
    p = extractStrip(file)
      .then((s) => {
        if (s) cacheSet(file, s)
        return s
      })
      .catch(() => null)
      .finally(() => STRIP_INFLIGHT.delete(file))
    STRIP_INFLIGHT.set(file, p)
  }
  return p
}

// load (once) the cached strip for a file; `enabled` gates extraction (thumbnails-off → skip)
export function useStrip(file: string | undefined, enabled: boolean): Strip | null {
  const [strip, setStrip] = useState<Strip | null>(() => (file ? cacheGet(file) ?? null : null))
  useEffect(() => {
    if (!file || !enabled) {
      setStrip(null)
      return
    }
    const cached = cacheGet(file)
    if (cached) {
      setStrip(cached)
      return
    }
    let alive = true
    void ensureStrip(file).then((s) => {
      if (alive) setStrip(s)
    })
    return () => {
      alive = false
    }
  }, [file, enabled])
  return strip
}

// pick `count` frames windowed to [inSec,outSec] from the cached strip (nearest by timestamp).
// Resizing/trimming only recomputes this cheap selection — never re-reads the video.
export function sampleStrip(strip: Strip | null, count: number, inSec?: number, outSec?: number): string[] {
  if (!strip || count < 1) return []
  const lo = Math.max(0, inSec ?? 0)
  const hi = Math.min(strip.dur, outSec ?? strip.dur)
  const span = Math.max(0.01, hi - lo)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const t = lo + ((i + 0.5) / count) * span
    let best = 0
    let bd = Infinity
    for (let j = 0; j < strip.ts.length; j++) {
      const d = Math.abs(strip.ts[j] - t)
      if (d < bd) {
        bd = d
        best = j
      }
    }
    out.push(strip.frames[best])
  }
  return out
}
