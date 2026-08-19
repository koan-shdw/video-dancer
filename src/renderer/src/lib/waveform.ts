// Waveform + beat analysis for the timeline's audio lane. Each track is fetched (media://) and
// decoded ONCE; what's cached is tiny (peak envelope ~50/s + detected beat times), never the
// decoded buffer. Same cache discipline as the filmstrips.
import { useEffect, useState } from 'react'
import { mediaUrl } from '../media'

export interface Wave {
  dur: number // decoded duration (seconds)
  pps: number // peaks per second
  peaks: Float32Array // max |sample| per window, 0..1
  beats: number[] // detected onset times (seconds) — energy-flux heuristic, not a perfect BPM grid
}

const PPS = 50

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
  const res = await fetch(mediaUrl(file))
  if (!res.ok) return null
  const bytes = await res.arrayBuffer()
  // decode at a reduced rate — plenty for an envelope + onsets, and half the memory
  const ctx = new OfflineAudioContext(1, 1, 22050)
  const buf = await ctx.decodeAudioData(bytes)
  const sr = buf.sampleRate
  const dur = buf.duration
  // mono mix
  const n = buf.length
  const mono = new Float32Array(n)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels
  }
  // peak envelope
  const win = Math.max(1, Math.floor(sr / PPS))
  const peaks = new Float32Array(Math.ceil(n / win))
  for (let p = 0; p < peaks.length; p++) {
    let m = 0
    const end = Math.min(n, (p + 1) * win)
    for (let i = p * win; i < end; i++) {
      const a = Math.abs(mono[i])
      if (a > m) m = a
    }
    peaks[p] = m
  }
  // onset detection: positive energy flux vs a local moving average, peak-picked with min spacing
  const frame = 512
  const nf = Math.floor(n / frame)
  const energy = new Float32Array(nf)
  for (let f = 0; f < nf; f++) {
    let e = 0
    for (let i = f * frame; i < (f + 1) * frame; i++) e += mono[i] * mono[i]
    energy[f] = e / frame
  }
  const flux = new Float32Array(nf)
  for (let f = 1; f < nf; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1])
  const beats: number[] = []
  const AVG_W = 20 // ~0.46s of context at 22050/512
  const MIN_GAP = 0.22 // refuse onsets closer than this (sec)
  let lastT = -1
  for (let f = 2; f < nf - 1; f++) {
    const a0 = Math.max(0, f - AVG_W)
    let avg = 0
    for (let i = a0; i < f; i++) avg += flux[i]
    avg /= Math.max(1, f - a0)
    const isPeak = flux[f] > flux[f - 1] && flux[f] >= flux[f + 1]
    if (isPeak && flux[f] > avg * 2.2 && flux[f] > 1e-6) {
      const t = (f * frame) / sr
      if (t - lastT >= MIN_GAP) {
        beats.push(t)
        lastT = t
      }
    }
  }
  return { dur, pps: sr / win, peaks, beats }
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
