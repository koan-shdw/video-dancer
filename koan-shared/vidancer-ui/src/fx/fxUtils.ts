import { vd } from '../api'
// EFFECTS v2 — shared renderer-side fx math: which blocks carry fx, which time spans the
// compositor owns, and where a take's AI sidecars live. Pure functions, no DOM.
// (The v16 fixed-field reader that used to live here read a shape nothing writes — it made
// every span empty and would have made the export baker bake NOTHING. hasFx now delegates to
// the one true v2 reader in fxData.)
import { effDur, extentOf, startOf, trackOf, trackKey, resolveView } from '../lib/timelineUtils'
import { hasFx2 } from './fxData'
import { playFileOf } from '../shared/reverse'

// a block "has fx" when any field would change a pixel — the compositor and the export baker
// both key off this, so an empty {} written by a cancelled panel never forces the slow path
export function hasFx(it: TimelineItem): boolean {
  return hasFx2(it)
}

// every VISIBLE block overlapping T, bottom track first (the compositor draws in this order).
// Disabled blocks and hidden tracks are out, same rules as itemAt().
export function itemsAtAll(items: TimelineItem[], clips: Clip[], T: number, hiddenTracks?: Set<number>, musicEnd = 0): TimelineItem[] {
  const out: TimelineItem[] = []
  for (const it of items) {
    if (it.disabled) continue
    if (hiddenTracks?.has(trackKey(trackOf(it)))) continue // a nest's inner blocks sit between whole tracks (list 3)
    const s = startOf(it)
    if (T < s - 1e-6 || T >= extentOf(it, items, clips, musicEnd) - 1e-6) continue
    out.push(it)
  }
  return out.sort((a, b) => trackOf(a) - trackOf(b))
}

export interface FxSpan {
  start: number
  end: number
}

// the time spans where the compositor takes over: any block with fx, grown to cover a dissolve
// window that touches it, overlapping spans merged. Everything outside plays the classic path.
export function fxSpans(items: TimelineItem[], clips: Clip[], hiddenTracks?: Set<number>, musicEnd = 0): FxSpan[] {
  const raw: FxSpan[] = []
  for (const it of items) {
    if (it.disabled || !hasFx(it)) continue
    if (hiddenTracks?.has(trackKey(trackOf(it)))) continue // a nest's inner blocks sit between whole tracks (list 3)
    const s = startOf(it)
    const e = extentOf(it, items, clips, musicEnd) // ⟲ fx ride the whole tail — same item, same stack
    raw.push({ start: s, end: e })
  }
  if (!raw.length) return []
  // dissolve growth: a transition INTO or OUT OF a span keeps the compositor active through it
  for (const it of items) {
    if (it.disabled || !it.transitionOutSec) continue
    const e = extentOf(it, items, clips, musicEnd) // dissolves fire at the TAIL end, never a seam
    const w = { start: e - it.transitionOutSec, end: e + 0.05 }
    if (raw.some((sp) => w.end > sp.start && w.start < sp.end)) raw.push(w)
  }
  raw.sort((a, b) => a.start - b.start)
  const merged: FxSpan[] = [raw[0]]
  for (const sp of raw.slice(1)) {
    const last = merged[merged.length - 1]
    if (sp.start <= last.end + 0.02) last.end = Math.max(last.end, sp.end)
    else merged.push({ ...sp })
  }
  return merged.map((sp) => ({ start: Math.max(0, sp.start), end: sp.end }))
}

export const spanAt = (spans: FxSpan[], T: number): FxSpan | undefined => spans.find((s) => T >= s.start - 1e-6 && T < s.end - 1e-6)

// per-track hide resolution (mute/solo on video tracks) — same rules the Monitor plays by
export function hiddenVideoTracks(tl: Timeline): Set<number> {
  const h = new Set<number>()
  const vCount = Math.max(1, tl.videoTracks ?? 1)
  const solos = (tl.soloTracks ?? []).filter((t) => t.startsWith('v'))
  for (let t = 0; t < vCount; t++) {
    const key = `v${t}`
    if (solos.length ? !solos.includes(key) : (tl.mutedTracks ?? []).includes(key)) h.add(t)
  }
  return h
}

// sidecar files live NEXT TO the take video (encoded by main/fx.ts) — derive, never store
export const mattePathOf = (takeFile: string): string => `${takeFile}.matte.mp4`
export const depthPathOf = (takeFile: string): string => `${takeFile}.depth.mp4`

// per-take sidecar existence, cached; invalidate(file) after a pass lands
const sidecarCache = new Map<string, { matte?: string; depth?: string }>()
export async function sidecarsOf(takeFile: string): Promise<{ matte?: string; depth?: string }> {
  const hit = sidecarCache.get(takeFile)
  if (hit) return hit
  const r = await vd().fxSidecars(takeFile)
  sidecarCache.set(takeFile, r)
  return r
}
export function invalidateSidecars(takeFile: string): void {
  sidecarCache.delete(takeFile)
  sidecarsRev++
}
// bumped on every invalidation — per-tick consumers (the Monitor) keep their own sync map and
// re-ask whenever this moves, so a freshly generated sidecar shows up without a restart
export let sidecarsRev = 0

// the take file behind a timeline item (undefined = storyboard block, compositor draws nothing
// for it — the classic path's still/black is fine underneath)
export function takeFileOf(it: TimelineItem, clips: Clip[]): string | undefined {
  const c = clips.find((x) => x.id === it.clipId)
  const f = c ? resolveView(c, it).take?.file : undefined
  return f ? playFileOf(f, it) : undefined // list 51: a reversed block plays its reversed copy
}
