import { vd } from '../api'
// Waveform + beat analysis for the timeline's audio lane. Each track is fetched (media://) and
// decoded ONCE; what's cached is tiny (peak envelope ~50/s + detected beat times), never the
// decoded buffer. Same cache discipline as the filmstrips.
import { useEffect, useState } from 'react'

export interface Wave {
  dur: number // decoded duration (seconds)
  pps: number // peaks per second
  peaks: Float32Array // max |sample| per window, 0..1
  beats: number[] // detected onset times (seconds) — energy-flux heuristic, not a perfect BPM grid
}

// display mapping: dB, not linear (Premiere-default law, 2026-08-19) — a fade-out tail at
// peak 0.16 is a 4px hair linearly but stays readable in dB. Floor −48dB, 0dB = full height.
export const peakAmp = (p: number): number => (p <= 0.004 ? 0 : Math.min(1, Math.max(0, 1 + Math.log10(Math.min(1, p)) / 2.4)))
const CACHE = new Map<string, Wave>()
const INFLIGHT = new Map<string, Promise<Wave | null>>()
const CACHE_MAX = 20

function cacheSet(file: string, w: Wave): void {
  CACHE.delete(file)
  CACHE.set(file, w)
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest === undefined) break
    CACHE.delete(oldest)
  }
}

async function analyze(file: string): Promise<Wave | null> {
  // MAIN-side ffmpeg decode (2026-08-19): the browser's decodeAudioData truncated
  // mp4-container audio — every companion block drew a squashed whole-clip shape at its
  // start. ffmpeg decodes every format the app touches; only the tiny arrays cross the bridge.
  const w = await vd().wavePeaks(file)
  if (!w) return null
  // structured clone can deliver the peaks as a plain object/typed view — normalize once
  const peaks = w.peaks instanceof Float32Array ? w.peaks : new Float32Array(Object.values(w.peaks as unknown as Record<string, number>))
  return { dur: w.dur, pps: w.pps, peaks, beats: w.beats }
}

function ensure(file: string): Promise<Wave | null> {
  const hit = CACHE.get(file)
  if (hit) return Promise.resolve(hit)
  let p = INFLIGHT.get(file)
  if (!p) {
    p = analyze(file)
      .then((w) => {
        if (w) cacheSet(file, w)
        return w
      })
      .catch(() => null)
      .finally(() => INFLIGHT.delete(file))
    INFLIGHT.set(file, p)
  }
  return p
}

// load (once) the analysis for a track; `enabled` gates the decode (collapsed lane → skip)
export function useWave(file: string | undefined, enabled: boolean): Wave | null {
  const [wave, setWave] = useState<Wave | null>(() => (file ? CACHE.get(file) ?? null : null))
  useEffect(() => {
    if (!file || !enabled) {
      setWave(file ? CACHE.get(file) ?? null : null)
      return
    }
    const hit = CACHE.get(file)
    if (hit) {
      setWave(hit)
      return
    }
    let alive = true
    void ensure(file).then((w) => {
      if (alive) setWave(w)
    })
    return () => {
      alive = false
    }
  }, [file, enabled])
  return wave
}
