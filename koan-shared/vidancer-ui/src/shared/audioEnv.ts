// AUDIO ENVELOPE + FADE math (docs/AUDIO-KEYFRAMES-PREMIERE-SPEC-2026-09-09.md, on the v19 rubber band
// of docs/archive/AUDIO-RUBBER-BAND-SPEC.md) — the ONE truth for volume envelopes and fade shapes. Monitor playback
// samples envGainAt per tick; export bakes envToFfmpegExpr into the volume filter and names fade curves for
// afade. Both MUST agree, so both live here and nowhere else. Interpolation runs in dB (Premiere): a straight
// line on the band is a straight line in dB. Curves are FLATTENED to 20 ms straight dB pieces once, and BOTH
// preview and export read the flattened list — identical by construction, no solver inside ffmpeg.
import type { VolumePoint, KeyInterp, FadeShape } from './types'

export const clampG = (g: number): number => Math.max(0, Math.min(2, g))
export const DB_FLOOR = -100 // silence on the dB lane
export const dbOf = (g: number): number => (g <= 1e-5 ? DB_FLOOR : Math.max(DB_FLOOR, 20 * Math.log10(g)))
export const gainOfDb = (db: number): number => (db <= DB_FLOOR + 1e-6 ? 0 : Math.pow(10, db / 20))
export const fmtDb = (g: number): string => {
  const d = dbOf(clampG(g))
  return d <= DB_FLOOR + 1e-6 ? '-oo dB' : `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(2)} dB`
}

// the keyframe's type; the v19 `curve: 'smooth'` reads as Auto Bezier until migrate() rewrites it
export const interpOf = (p: VolumePoint): KeyInterp => p.interp ?? (p.curve === 'smooth' ? 'auto' : 'linear')

// ---- segment math (dB) ----
type Pt = { x: number; y: number } // x = fraction of the segment's time, y = dB
const third = (va: number, vb: number, k: 1 | 2): Pt => ({ x: k / 3, y: va + ((vb - va) * k) / 3 })

// auto-bezier tangent at point i (dB per second): the neighbours' slope, flat at the ends (Catmull-Rom)
function autoSlope(ps: VolumePoint[], i: number): number {
  const prev = ps[i - 1]
  const next = ps[i + 1]
  if (!prev || !next) return 0
  const span = next.at - prev.at
  return span > 1e-6 ? (dbOf(clampG(next.gain)) - dbOf(clampG(prev.gain))) / span : 0
}

// the two control points of the segment ps[i] → ps[i+1] (undefined for a straight segment)
export function segmentHandles(ps: VolumePoint[], i: number): { p1: Pt; p2: Pt } | undefined {
  const a = ps[i]
  const b = ps[i + 1]
  if (!a || !b) return undefined
  const ia = interpOf(a)
  const ib = interpOf(b)
  if (ia === 'hold') return undefined
  if (ia === 'linear' && (ib === 'linear' || ib === 'hold')) return undefined
  const va = dbOf(clampG(a.gain))
  const vb = dbOf(clampG(b.gain))
  const dur = Math.max(1e-6, b.at - a.at)
  let p1: Pt
  if (ia === 'easeOut') p1 = { x: 1 / 3, y: va }
  else if (ia === 'auto') p1 = { x: 1 / 3, y: va + (autoSlope(ps, i) * dur) / 3 }
  else if ((ia === 'bezier' || ia === 'continuous') && a.out) p1 = { x: a.out.x, y: va + a.out.y }
  else p1 = third(va, vb, 1)
  let p2: Pt
  if (ib === 'easeIn') p2 = { x: 2 / 3, y: vb }
  else if (ib === 'auto') p2 = { x: 2 / 3, y: vb - (autoSlope(ps, i + 1) * dur) / 3 }
  else if ((ib === 'bezier' || ib === 'continuous') && b.in) p2 = { x: b.in.x, y: vb + b.in.y }
  else p2 = third(va, vb, 2)
  return { p1, p2 }
}

// y(x) on the cubic P0=(0,va) P1 P2 P3=(1,vb): solve the (monotone) x-cubic for t, take y
function cubicY(va: number, vb: number, p1: Pt, p2: Pt, x: number): number {
  const x1 = Math.max(0, Math.min(1, p1.x))
  const x2 = Math.max(0, Math.min(1, p2.x))
  const bx = (t: number): number => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const by = (t: number): number => (1 - t) ** 3 * va + 3 * (1 - t) * (1 - t) * t * p1.y + 3 * (1 - t) * t * t * p2.y + t ** 3 * vb
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 26; i++) {
    const v = bx(t)
    if (Math.abs(v - x) < 1e-5) break
    if (v < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return by(t)
}

// exact dB at block-local t (used by the band's own drawing and by the flattener)
export function envDbAt(ps: VolumePoint[], t: number): number {
  if (!ps.length) return 0
  if (t <= ps[0].at) return dbOf(clampG(ps[0].gain))
  const last = ps[ps.length - 1]
  if (t >= last.at) return dbOf(clampG(last.gain))
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i]
    const b = ps[i + 1]
    if (t < a.at || t > b.at) continue
    const va = dbOf(clampG(a.gain))
    const vb = dbOf(clampG(b.gain))
    const span = b.at - a.at
    const x = span > 0 ? (t - a.at) / span : 1
    if (interpOf(a) === 'hold') return va
    const h = segmentHandles(ps, i)
    return h ? cubicY(va, vb, h.p1, h.p2, x) : va + (vb - va) * x
  }
  return dbOf(clampG(last.gain))
}

// ---- flatten: the curve as straight dB pieces (20 ms on curved segments, one piece when straight) ----
export interface EnvPiece {
  at: number
  db: number
}
const flatCache = new WeakMap<VolumePoint[], EnvPiece[]>()
export function flattenEnvelope(points: VolumePoint[], step = 0.02): EnvPiece[] {
  const hit = flatCache.get(points)
  if (hit) return hit
  const ps = points
  const out: EnvPiece[] = []
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i]
    const b = ps[i + 1]
    const va = dbOf(clampG(a.gain))
    out.push({ at: a.at, db: va })
    if (!b) break
    const curved = !!segmentHandles(ps, i)
    if (interpOf(a) === 'hold') {
      out.push({ at: b.at - 1e-4, db: va }) // the step: hold to just before b
      continue
    }
    if (!curved) continue
    const n = Math.max(2, Math.ceil((b.at - a.at) / step))
    for (let k = 1; k < n; k++) {
      const t = a.at + ((b.at - a.at) * k) / n
      out.push({ at: t, db: envDbAt(ps, t) })
    }
  }
  flatCache.set(points, out)
  return out
}

// ---- the two consumers ----
// envelope sample at t (block-local seconds). No points → 1 (flat unity). Outside the points: HOLD the
// nearest end (Premiere behaviour). Reads the flattened list so export and preview trace one curve.
export function envGainAt(points: VolumePoint[] | undefined, t: number): number {
  if (!points?.length) return 1
  const fl = flattenEnvelope(points)
  if (t <= fl[0].at) return clampG(gainOfDb(fl[0].db))
  const last = fl[fl.length - 1]
  if (t >= last.at) return clampG(gainOfDb(last.db))
  for (let i = 0; i < fl.length - 1; i++) {
    const a = fl[i]
    const b = fl[i + 1]
    if (t < a.at || t > b.at) continue
    const span = b.at - a.at
    const x = span > 0 ? (t - a.at) / span : 1
    return clampG(gainOfDb(a.db + (b.db - a.db) * x))
  }
  return clampG(gainOfDb(last.db))
}

// the SAME flattened curve as an ffmpeg volume-filter expression over chain-local `t` (the export chains
// asetpts to 0 at block start, so band time = filter time). Half-open pieces [a,b) — gte*lt, never
// between() (closed on both ends: a frame on a shared boundary would sum two pieces). baseGain multiplies
// once outside. Used as: volume='<expr>':eval=frame
export function envToFfmpegExpr(points: VolumePoint[], baseGain: number, len: number): string {
  const f = (n: number): string => n.toFixed(4)
  const g = (db: number): string => f(clampG(gainOfDb(db)))
  const fl = flattenEnvelope(points).filter((p) => p.at <= len + 1e-6)
  if (!fl.length) return f(clampG(baseGain))
  const terms: string[] = []
  terms.push(`if(lt(t,${f(fl[0].at)}),${g(fl[0].db)},0)`)
  for (let i = 0; i < fl.length - 1; i++) {
    const a = fl[i]
    const b = fl[i + 1]
    const span = b.at - a.at
    if (span <= 1e-6) continue
    // straight in dB: 10^((da+(db-da)*x)/20), floor = silence
    const x = `((t-${f(a.at)})/${f(span)})`
    const da = a.db <= DB_FLOOR + 1e-6 ? DB_FLOOR : a.db
    const dbb = b.db <= DB_FLOOR + 1e-6 ? DB_FLOOR : b.db
    terms.push(`if(gte(t,${f(a.at)})*lt(t,${f(b.at)}),min(2,pow(10,(${f(da)}+(${f(dbb - da)})*${x})/20)),0)`)
  }
  const last = fl[fl.length - 1]
  terms.push(`if(gte(t,${f(last.at)}),${g(last.db)},0)`)
  return `${f(clampG(baseGain))}*(${terms.join('+')})`
}

// ---- fades = audio transitions (Constant Power · Constant Gain · Exponential), x = 0..1 into the fade ----
// the same three formulas ffmpeg's afade calls qsin · tri · exp, so export names the curve and preview
// multiplies the identical number
export function fadeGain(shape: FadeShape | undefined, x: number): number {
  const c = Math.max(0, Math.min(1, x))
  if (shape === 'gain') return c
  if (shape === 'exp') return Math.pow(10, -2 * (1 - c))
  return Math.sin((c * Math.PI) / 2) // 'power' — the default (Premiere's)
}
export const fadeCurve = (shape: FadeShape | undefined): 'tri' | 'qsin' | 'exp' => (shape === 'gain' ? 'tri' : shape === 'exp' ? 'exp' : 'qsin')
// the fade as an ffmpeg expression of an x-expression (0..1), for chains that cannot use afade (a slice of a block)
export const fadeExpr = (shape: FadeShape | undefined, x: string): string =>
  shape === 'gain' ? `(${x})` : shape === 'exp' ? `pow(10,-2*(1-(${x})))` : `sin((${x})*PI/2)`
// the block's two fades at block-local tIn over a block of `len` seconds — the multiply every player uses
export function fadesAt(it: { fadeInSec?: number; fadeOutSec?: number; fadeInShape?: FadeShape; fadeOutShape?: FadeShape }, tIn: number, len: number): number {
  let m = 1
  if (it.fadeInSec && tIn < it.fadeInSec) m *= fadeGain(it.fadeInShape, tIn / it.fadeInSec)
  const tOut = len - tIn
  if (it.fadeOutSec && tOut < it.fadeOutSec) m *= fadeGain(it.fadeOutShape, tOut / it.fadeOutSec)
  return m
}

// ---- NEST (list 3, part 2): a nest's own level reaching the blocks inside it ----
// dB on a flattened list at t, holding the ends — the same straight pieces envGainAt reads
function flatDbAt(fl: EnvPiece[], t: number): number {
  if (!fl.length) return 0
  if (t <= fl[0].at) return fl[0].db
  const last = fl[fl.length - 1]
  if (t >= last.at) return last.db
  for (let i = 0; i < fl.length - 1; i++) {
    const a = fl[i]
    const b = fl[i + 1]
    if (t < a.at || t > b.at) continue
    const span = b.at - a.at
    return span > 0 ? a.db + (b.db - a.db) * ((t - a.at) / span) : b.db
  }
  return last.db
}

// a block's band × fades as ONE dB curve over its local time (fades sampled every 20 ms, the
// band's own flattening) — null when it has neither
export function levelCurve(h: { volume?: VolumePoint[]; fadeInSec?: number; fadeOutSec?: number; fadeInShape?: FadeShape; fadeOutShape?: FadeShape }, len: number, step = 0.02): EnvPiece[] | null {
  if (!h.volume?.length && !h.fadeInSec && !h.fadeOutSec) return null
  const fl = h.volume?.length ? flattenEnvelope(h.volume) : []
  const ts = new Set<number>([0, len, ...fl.map((p) => p.at)])
  const sample = (a: number, b: number): void => {
    const n = Math.max(1, Math.ceil((b - a) / step))
    for (let k = 0; k <= n; k++) ts.add(a + ((b - a) * k) / n)
  }
  if (h.fadeInSec) sample(0, Math.min(len, h.fadeInSec))
  if (h.fadeOutSec) sample(Math.max(0, len - h.fadeOutSec), len)
  return [...ts]
    .filter((t) => t >= 0 && t <= len)
    .sort((a, b) => a - b)
    .map((t) => ({ at: t, db: flatDbAt(fl, t) + dbOf(fadesAt(h, t, len)) }))
}

// outer curves (already in this block's local time) folded into its own band: dB add at every
// break of all of them, so every player and the export keep reading ONE ordinary band per block.
// Ceiling: the sum clamps at +6 dB like any band (a nest's boost over a boosted clip tops out there).
export function foldEnvelope(own: VolumePoint[] | undefined, len: number, outer: EnvPiece[][]): VolumePoint[] {
  const fl = own?.length ? flattenEnvelope(own) : []
  const ts = [...new Set([0, len, ...fl.map((p) => p.at), ...outer.flatMap((c) => c.map((p) => p.at))])].filter((t) => t >= 0 && t <= len).sort((a, b) => a - b)
  return ts.map((t, i) => ({ id: `n${i}`, at: t, gain: clampG(gainOfDb(outer.reduce((db, c) => db + flatDbAt(c, t), flatDbAt(fl, t)))) }))
}

// list 2 (2026-09-29): ONE solo group across the A lanes and the S (score) tracks, like Premiere:
// any 'a'/'s' solo silences every other A and S track, else the track's own M decides. Monitor
// and export both read this, so the two never drift.
export function audioKeyMuted(tl: { mutedTracks?: string[]; soloTracks?: string[] }, key: string): boolean {
  const solos = (tl.soloTracks ?? []).filter((t) => t[0] === 'a' || t[0] === 's')
  return solos.length ? !solos.includes(key) : (tl.mutedTracks ?? []).includes(key)
}

// the track key a score answers to: its own S track, or (a score from inside a nest, list 3) the
// nest's A lane — the nest's sound is one clip on that lane, the Premiere way
export const scoreKeyOf = (s: { lane?: number; nestLane?: number }): string => (s.nestLane != null ? `a${s.nestLane}` : `s${s.lane ?? 0}`)
