// AUDIO RUBBER BAND math (docs/AUDIO-RUBBER-BAND-SPEC.md) — the ONE truth for volume
// envelopes. Monitor playback samples envGainAt per tick; export bakes envToFfmpegExpr into
// the volume filter. Both MUST agree, so both live here and nowhere else.
import type { VolumePoint } from './types'

const clampG = (g: number): number => Math.max(0, Math.min(2, g))

// piecewise envelope sample at t (block-local seconds). No points → 1 (flat unity, so the
// multiply chain leaves untouched blocks exactly as before). Outside the points: HOLD the
// nearest end (Premiere behavior). 'smooth' = cosine ease into the next point.
export function envGainAt(points: VolumePoint[] | undefined, t: number): number {
  if (!points?.length) return 1
  const ps = points // invariant: sorted by `at` (mutation sites keep it so)
  if (t <= ps[0].at) return clampG(ps[0].gain)
  const last = ps[ps.length - 1]
  if (t >= last.at) return clampG(last.gain)
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i]
    const b = ps[i + 1]
    if (t < a.at || t > b.at) continue
    const span = b.at - a.at
    const x = span > 0 ? (t - a.at) / span : 1
    const e = a.curve === 'smooth' ? (1 - Math.cos(Math.PI * x)) / 2 : x
    // clamp ENDPOINTS before interpolating (not just the result) — the ffmpeg expr can only
    // clamp endpoints, and preview/export must trace the identical curve
    const ga = clampG(a.gain)
    return ga + (clampG(b.gain) - ga) * e
  }
  return clampG(last.gain)
}

// the SAME curve as an ffmpeg volume-filter expression over chain-local `t` (the export chains
// asetpts to 0 at block start, so band time = filter time). Composed with between() terms;
// baseGain multiplies once outside. Used as: volume='<expr>':eval=frame
export function envToFfmpegExpr(points: VolumePoint[], baseGain: number, len: number): string {
  const f = (n: number): string => n.toFixed(4)
  const ps = points.filter((p) => p.at <= len + 1e-6)
  if (!ps.length) return f(clampG(baseGain))
  const terms: string[] = []
  // half-open segments [a,b) — gte*lt, never between(): between is closed on BOTH ends, and a
  // frame landing exactly on a shared boundary would sum two segments (double volume blip)
  terms.push(`if(lt(t,${f(ps[0].at)}),${f(clampG(ps[0].gain))},0)`)
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i]
    const b = ps[i + 1]
    const span = b.at - a.at
    if (span <= 1e-6) continue
    const x = `((t-${f(a.at)})/${f(span)})`
    const ease = a.curve === 'smooth' ? `(1-cos(PI*${x}))/2` : x
    terms.push(`if(gte(t,${f(a.at)})*lt(t,${f(b.at)}),${f(clampG(a.gain))}+(${f(clampG(b.gain))}-${f(clampG(a.gain))})*${ease},0)`)
  }
  const last = ps[ps.length - 1]
  terms.push(`if(gte(t,${f(last.at)}),${f(clampG(last.gain))},0)`)
  return `${f(clampG(baseGain))}*(${terms.join('+')})`
}
