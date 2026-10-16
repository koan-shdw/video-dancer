// list 56 (vi-dancer docs/SPEED-RAMPS-SPEC-2026-10-01.md): Premiere's Time Remapping on a timeline
// block. Keyframes sit on the take's own clock (source seconds), each segment between them has a
// speed, and a key pulled apart into two halves is a ramp: one speed eases into the next across it.
// Everything that reads a remapped block's time walks the same pieces of constant speed: its
// length, the source second at a moment, the playback rate, trims, slices, nests and the export.

export interface RemapKey {
  at: number // source seconds
  ramp?: number // the transition's width in source seconds, centred on `at` (absent = a step)
}
export interface SpeedRemap {
  keys: RemapKey[] // sorted by `at`
  speeds: number[] // speeds[i] = before keys[i]; the last = after the last key (keys.length + 1 of them)
}
export const REMAP_MIN = 0.1 // 10 %
export const REMAP_MAX = 10 // 1000 %
export const RAMP_STEPS = 12 // a ramp plays as this many eased steps (the export cuts at each)
export interface RemapPiece {
  s0: number // source seconds
  s1: number
  v: number // speed
}

export const clampSpeed = (v: number): number => Math.min(REMAP_MAX, Math.max(REMAP_MIN, Number.isFinite(v) && v > 0 ? v : 1))
const LOW = -1e6 // "before everything" on the source clock

// the source seconds [a, b] cut into pieces of one speed each; a ramp = RAMP_STEPS eased steps
export function remapPieces(r: SpeedRemap, a: number, b: number): RemapPiece[] {
  const out: RemapPiece[] = []
  const push = (s0: number, s1: number, v: number): void => {
    const x0 = Math.max(a, s0)
    const x1 = Math.min(b, s1)
    if (x1 - x0 > 1e-9) out.push({ s0: x0, s1: x1, v: v > 0 ? v : 1 })
  }
  let cur = LOW
  const n = r.keys.length
  for (let i = 0; i < n; i++) {
    const k = r.keys[i]
    const vL = r.speeds[i] ?? 1
    const vR = r.speeds[i + 1] ?? vL
    const half = Math.max(0, (k.ramp ?? 0) / 2)
    const r0 = Math.max(cur, k.at - half)
    const r1 = Math.max(r0, k.at + half)
    push(cur, r0, vL)
    if (r1 - r0 > 1e-9)
      for (let j = 0; j < RAMP_STEPS; j++) {
        const u = (j + 0.5) / RAMP_STEPS
        push(r0 + ((r1 - r0) * j) / RAMP_STEPS, r0 + ((r1 - r0) * (j + 1)) / RAMP_STEPS, vL + (vR - vL) * u * u * (3 - 2 * u))
      }
    cur = r1
  }
  push(cur, Infinity, r.speeds[n] ?? 1)
  return out
}

// timeline seconds from source second `a` to source second `s` (negative when s < a)
export function remapRelAt(r: SpeedRemap, a: number, s: number): number {
  if (s >= a) return remapPieces(r, a, s).reduce((t, p) => t + (p.s1 - p.s0) / p.v, 0)
  return -remapPieces(r, s, a).reduce((t, p) => t + (p.s1 - p.s0) / p.v, 0)
}
export const remapLen = (r: SpeedRemap, a: number, b: number): number => Math.max(0, remapRelAt(r, a, b))

// the source second `rel` timeline seconds after source second `a` (rel < 0 walks back)
export function remapSrcAt(r: SpeedRemap, a: number, rel: number): number {
  if (rel >= 0) {
    let t = 0
    for (const p of remapPieces(r, a, Infinity)) {
      const d = (p.s1 - p.s0) / p.v
      if (rel <= t + d) return p.s0 + (rel - t) * p.v
      t += d
    }
    return a + rel
  }
  let t = 0
  for (const p of remapPieces(r, LOW, a).reverse()) {
    const d = (p.s1 - p.s0) / p.v
    if (-rel <= t + d) return p.s1 - (-rel - t) * p.v
    t += d
  }
  return a + rel
}

// the speed playing `rel` timeline seconds after source second `a`
export function remapRateAt(r: SpeedRemap, a: number, rel: number): number {
  const s = remapSrcAt(r, a, Math.max(0, rel))
  for (const p of remapPieces(r, LOW, Infinity)) if (s < p.s1 - 1e-9) return p.v
  return r.speeds[r.speeds.length - 1] ?? 1
}

// the slowest and fastest speeds inside [a, b] (the label; Optical Flow reads the slowest)
export function remapRange(r: SpeedRemap, a: number, b: number): [number, number] {
  const vs = remapPieces(r, a, b).map((p) => p.v)
  return vs.length ? [Math.min(...vs), Math.max(...vs)] : [1, 1]
}

// ---- edits (each returns a new remap) ----
export const remapNew = (speed = 1): SpeedRemap => ({ keys: [], speeds: [clampSpeed(speed)] })
// the segment (an index into speeds) that holds source second s
export function remapSegmentAt(r: SpeedRemap, s: number): number {
  let i = 0
  while (i < r.keys.length && s >= r.keys[i].at) i++
  return i
}
// a key at source second `at`: both sides keep the segment's speed until one is dragged. On a key or
// inside its ramp = nothing new.
export function remapAddKey(r: SpeedRemap, at: number): SpeedRemap {
  if (r.keys.some((k) => Math.abs(k.at - at) < Math.max(0.02, (k.ramp ?? 0) / 2))) return r
  const i = remapSegmentAt(r, at)
  return { keys: [...r.keys.slice(0, i), { at }, ...r.keys.slice(i)], speeds: [...r.speeds.slice(0, i + 1), r.speeds[i] ?? 1, ...r.speeds.slice(i + 1)] }
}
export const remapSetSpeed = (r: SpeedRemap, seg: number, v: number): SpeedRemap => ({ ...r, speeds: r.speeds.map((x, i) => (i === seg ? clampSpeed(v) : x)) })
// a key moves between its neighbours, its ramp and theirs kept clear of each other
export function remapMoveKey(r: SpeedRemap, i: number, at: number): SpeedRemap {
  const k = r.keys[i]
  if (!k) return r
  const half = (k.ramp ?? 0) / 2
  const lo = i > 0 ? r.keys[i - 1].at + (r.keys[i - 1].ramp ?? 0) / 2 + half + 0.02 : 0
  const hi = i < r.keys.length - 1 ? r.keys[i + 1].at - (r.keys[i + 1].ramp ?? 0) / 2 - half - 0.02 : Infinity
  return { ...r, keys: r.keys.map((x, j) => (j === i ? { ...x, at: Math.max(lo, Math.min(hi, at)) } : x)) }
}
// a key's ramp widens (both halves apart) until it meets a neighbour's
export function remapSetRamp(r: SpeedRemap, i: number, width: number): SpeedRemap {
  const k = r.keys[i]
  if (!k) return r
  const left = i > 0 ? k.at - r.keys[i - 1].at - (r.keys[i - 1].ramp ?? 0) / 2 : k.at
  const right = i < r.keys.length - 1 ? r.keys[i + 1].at - (r.keys[i + 1].ramp ?? 0) / 2 - k.at : Infinity
  const ramp = Math.max(0, Math.min(width, 2 * Math.max(0, Math.min(left, right) - 0.01)))
  return { ...r, keys: r.keys.map((x, j) => (j === i ? (ramp > 0.005 ? { at: x.at, ramp } : { at: x.at }) : x)) }
}
// a key goes: its two segments become one, at the left one's speed
export function remapDeleteKey(r: SpeedRemap, i: number): SpeedRemap {
  if (!r.keys[i]) return r
  return { keys: r.keys.filter((_, j) => j !== i), speeds: r.speeds.filter((_, j) => j !== i + 1) }
}
// every speed times k, unclamped (a remapped block inside a sped-up nest plays at both)
export const remapScale = (r: SpeedRemap, k: number): SpeedRemap => ({ ...r, speeds: r.speeds.map((v) => v * k) })
