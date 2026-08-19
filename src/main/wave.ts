// Waveform analysis, MAIN-side through ffmpeg (2026-08-19): the renderer's decodeAudioData
// truncated mp4-container audio (blue companion blocks drew the whole clip's shape squashed
// into the block's start — user catch). ffmpeg decodes EVERY format the app touches, so the
// analyzer gets clean mono PCM: peaks + onsets computed here, tiny arrays cross the bridge.
// Same math as the old renderer analyzer (peak envelope ~50/s, energy-flux onsets).
import { spawn } from 'child_process'
import { FFMPEG } from './export'

const SR = 22050
const PPS = 50

export interface WaveData {
  dur: number
  pps: number
  peaks: Float32Array
  beats: number[]
}

const CACHE = new Map<string, WaveData>()
const INFLIGHT = new Map<string, Promise<WaveData | null>>()
const CACHE_MAX = 24

export function wavePeaks(file: string): Promise<WaveData | null> {
  const hit = CACHE.get(file)
  if (hit) return Promise.resolve(hit)
  let p = INFLIGHT.get(file)
  if (!p) {
    p = analyze(file)
      .then((w) => {
        if (w) {
          CACHE.delete(file)
          CACHE.set(file, w)
          while (CACHE.size > CACHE_MAX) {
            const oldest = CACHE.keys().next().value
            if (oldest === undefined) break
            CACHE.delete(oldest)
          }
        }
        return w
      })
      .catch(() => null)
      .finally(() => INFLIGHT.delete(file))
    INFLIGHT.set(file, p)
  }
  return p
}

function analyze(file: string): Promise<WaveData | null> {
  return new Promise((resolve) => {
    const ps = spawn(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { windowsHide: true })
    const chunks: Buffer[] = []
    ps.stdout.on('data', (d: Buffer) => chunks.push(d))
    ps.on('error', () => resolve(null))
    ps.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) return resolve(null)
      const raw = Buffer.concat(chunks)
      const n = Math.floor(raw.length / 4)
      if (n < SR / 10) return resolve(null) // under 100ms of audio = nothing to draw
      const mono = new Float32Array(raw.buffer, raw.byteOffset, n)
      const dur = n / SR
      // peak envelope
      const win = Math.max(1, Math.floor(SR / PPS))
      const peaks = new Float32Array(Math.ceil(n / win))
      for (let p2 = 0; p2 < peaks.length; p2++) {
        let m = 0
        const end = Math.min(n, (p2 + 1) * win)
        for (let i = p2 * win; i < end; i++) {
          const a = Math.abs(mono[i])
          if (a > m) m = a
        }
        peaks[p2] = m
      }
      // onset detection — same heuristic as the old renderer analyzer
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
      const AVG_W = 20
      const MIN_GAP = 0.22
      let lastT = -1
      for (let f = 2; f < nf - 1; f++) {
        const a0 = Math.max(0, f - AVG_W)
        let avg = 0
        for (let i = a0; i < f; i++) avg += flux[i]
        avg /= Math.max(1, f - a0)
        const isPeak = flux[f] > flux[f - 1] && flux[f] >= flux[f + 1]
        if (isPeak && flux[f] > avg * 2.2 && flux[f] > 1e-6) {
          const t = (f * frame) / SR
          if (t - lastT >= MIN_GAP) {
            beats.push(t)
            lastT = t
          }
        }
      }
      resolve({ dur, pps: SR / win, peaks, beats })
    })
  })
}
