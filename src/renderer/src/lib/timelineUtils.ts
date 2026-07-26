// Effective-duration + cumulative-segment math for the timeline — shared by the Timeline panel,
// the monitors and the live timecode. ONE resolution rule for what a timeline item shows:
//
//   item.useRecipe ("C")  → the clip's LIVE recipe: duration setting, current beats, keyframe still
//   item.takeId / keeper  → that take's FROZEN view: its actual rendered length + snapshot beats
//   no takes at all       → the live recipe (storyboard clip)
//
// Takes are immutable records; the recipe is a live draft. Pre-v2 takes have no snapshot →
// they fall back to the recipe for beats/metadata (their real video length still wins once measured).

export interface ResolvedView {
  take?: Take // undefined = recipe view (C, storyboard, or missing take)
  recipe: PromptData // drives refs/details/meta for this view (take.snapshot ?? clip recipe)
  beats: BeatField[] // take views show ONLY beats frozen at render time (pre-snapshot takes → NONE — never the live recipe's)
  beatFreeform: string // the freeform matching the beats' source (resolves beat @refs)
  durationSec: number // source length: take's actual rendered length, or the recipe's duration setting
}

const recipeDur = (pd: PromptData): number => {
  const d = parseFloat(pd.duration)
  return Number.isNaN(d) || d <= 0 ? 5 : d // 'auto' → 5 (same assumption as the cost estimate)
}

// resolve which take a timeline item points at (undefined = recipe view). EXPLICIT choices
// (slot takeId / keeper) are honored even when disabled; the last-resort fallback skips duds.
export function resolveTake(clip: Clip, item?: TimelineItem): Take | undefined {
  if (item?.useRecipe) return undefined
  if (clip.takes.length === 0) return undefined
  const explicit = item?.takeId ?? clip.keeperTakeId
  if (explicit) {
    const t = clip.takes.find((x) => x.id === explicit)
    if (t) return t
  }
  const pool = clip.takes.filter((t) => !t.disabled)
  const src = pool.length ? pool : clip.takes
  return src[src.length - 1]
}

export function resolveView(clip: Clip, item?: TimelineItem): ResolvedView {
  const take = resolveTake(clip, item)
  if (!take) {
    const pd = clip.promptData
    return { recipe: pd, beats: pd.beats, beatFreeform: pd.freeform, durationSec: recipeDur(pd) }
  }
  const recipe = take.snapshot ?? clip.promptData
  return {
    take,
    recipe,
    beats: take.snapshot?.beats ?? [], // frozen beats only — a take never borrows the live recipe's beats
    beatFreeform: take.snapshot?.freeform ?? '',
    durationSec: take.durationSec ?? recipeDur(recipe)
  }
}

// the timeline currently shown in the Timeline panel / monitors (a project always has ≥1)
export function activeTimeline(p: Project | null | undefined): Timeline | undefined {
  return p?.timelines.find((t) => t.id === p.activeTimelineId) ?? p?.timelines[0]
}

export function activeItems(p: Project | null | undefined): TimelineItem[] {
  return activeTimeline(p)?.items ?? []
}

export function durOfClip(clips: Clip[], clipId: string): number {
  const c = clips.find((x) => x.id === clipId)
  return c ? resolveView(c).durationSec : 5
}

// the source length behind a timeline item (its active view)
export function sourceDurOf(it: TimelineItem, clips: Clip[]): number {
  const c = clips.find((x) => x.id === it.clipId)
  return c ? resolveView(c, it).durationSec : 5
}

// effective (trimmed, speed-adjusted) length of a timeline item — in/out are CLAMPED to the
// active view's source length, so switching to a shorter take shrinks the block instead of
// showing dead air. "S-B" (useRecipe) instances IGNORE trims: they track the LIVE recipe duration.
export function effDur(it: TimelineItem, clips: Clip[]): number {
  const dur = sourceDurOf(it, clips)
  const sp = it.speed && it.speed > 0 ? it.speed : 1
  if (it.useRecipe) return dur / sp
  const out = Math.min(it.outSec ?? dur, dur)
  const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
  return Math.max(0.25, (out - inn) / sp)
}

// ---- v14 absolute-time track geometry ----
export const startOf = (it: TimelineItem): number => it.startSec ?? 0
export const trackOf = (it: TimelineItem): number => it.track ?? 0

// the sequence's end = the rightmost block edge (gaps legal; ≥0)
export function timelineEnd(items: TimelineItem[], clips: Clip[]): number {
  return items.reduce((m, it) => Math.max(m, startOf(it) + effDur(it, clips)), 0)
}

// what's VISIBLE at time T: the topmost occupied video track (undefined = gap → black).
// hiddenTracks = per-track mute/solo resolution done by the caller.
export function itemAt(items: TimelineItem[], clips: Clip[], T: number, hiddenTracks?: Set<number>): TimelineItem | undefined {
  let best: TimelineItem | undefined
  for (const it of items) {
    const tr = trackOf(it)
    if (hiddenTracks?.has(tr)) continue
    const s = startOf(it)
    if (T < s - 1e-6 || T >= s + effDur(it, clips) - 1e-6) continue
    if (!best || tr > trackOf(best)) best = it
  }
  return best
}

// the SECOND-topmost visible item at T — the dissolve partner during a transition window
export function itemUnderAt(items: TimelineItem[], clips: Clip[], T: number, top: TimelineItem | undefined, hiddenTracks?: Set<number>): TimelineItem | undefined {
  let best: TimelineItem | undefined
  for (const it of items) {
    if (it === top) continue
    const tr = trackOf(it)
    if (hiddenTracks?.has(tr)) continue
    const s = startOf(it)
    if (T < s - 1e-6 || T >= s + effDur(it, clips) - 1e-6) continue
    if (!best || tr > trackOf(best)) best = it
  }
  return best
}

// source seconds inside an item's take for timeline time T (speed-aware)
export function sourceTimeAt(it: TimelineItem, clips: Clip[], T: number): number {
  const sp = it.speed && it.speed > 0 ? it.speed : 1
  const base = it.useRecipe ? 0 : (it.inSec ?? 0)
  return base + Math.max(0, T - startOf(it)) * sp
}

// the next moment (> T) at which the visible composition can change — block starts and ends
// across every track. Drives the A/B player's preload target. null = nothing ahead.
export function nextBoundary(items: TimelineItem[], clips: Clip[], T: number): number | null {
  let best: number | null = null
  for (const it of items) {
    const s = startOf(it)
    const e = s + effDur(it, clips)
    for (const b of [s, e]) if (b > T + 1e-4 && (best == null || b < best)) best = b
  }
  return best
}

// time-sorted block starts (for Alt+←/→ transport jumps between cuts)
export function blockStarts(items: TimelineItem[]): number[] {
  return Array.from(new Set(items.map((it) => Math.round(startOf(it) * 1000) / 1000))).sort((a, b) => a - b)
}

export interface Seg {
  start: number
  dur: number
}

// where an audio-lane item starts RIGHT NOW: linked → its video block's start + offset (follows
// re-flows live); unlinked or dangling link → the stored absolute startSec
export function audioStartOf(a: TimelineAudioItem, segs: Seg[], items: TimelineItem[]): number {
  if (a.link) {
    const i = items.findIndex((it) => it.id === a.link!.itemId)
    if (i >= 0 && segs[i]) return Math.max(0, segs[i].start + a.link.offset)
  }
  return a.startSec
}

// per-item [start,dur] (v14: ABSOLUTE positions, index-aligned with `timeline`) + the sequence
// total = the rightmost edge (≥1 so divisions stay safe)
export function buildSegs(timeline: TimelineItem[], clips: Clip[]): { segs: Seg[]; total: number } {
  const segs = timeline.map((it) => ({ start: startOf(it), dur: effDur(it, clips) }))
  return { segs, total: Math.max(timelineEnd(timeline, clips), 1) }
}
