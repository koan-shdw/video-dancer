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

// resolve which take a timeline item points at (undefined = recipe view)
export function resolveTake(clip: Clip, item?: TimelineItem): Take | undefined {
  if (item?.useRecipe) return undefined
  if (clip.takes.length === 0) return undefined
  const id = item?.takeId ?? clip.keeperTakeId ?? clip.takes[clip.takes.length - 1].id
  return clip.takes.find((t) => t.id === id) ?? clip.takes[clip.takes.length - 1]
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

export function durOfClip(clips: Clip[], clipId: string): number {
  const c = clips.find((x) => x.id === clipId)
  return c ? resolveView(c).durationSec : 5
}

// the source length behind a timeline item (its active view)
export function sourceDurOf(it: TimelineItem, clips: Clip[]): number {
  const c = clips.find((x) => x.id === it.clipId)
  return c ? resolveView(c, it).durationSec : 5
}

// effective (trimmed) length of a timeline item — in/out are CLAMPED to the active view's source
// length, so switching to a shorter take shrinks the block instead of showing dead air.
// "C" (useRecipe) instances IGNORE trims entirely: they always track the LIVE recipe duration
// (a stored trim used to pin the block forever, so duration edits looked like they did nothing).
export function effDur(it: TimelineItem, clips: Clip[]): number {
  const dur = sourceDurOf(it, clips)
  if (it.useRecipe) return dur
  const out = Math.min(it.outSec ?? dur, dur)
  const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
  return Math.max(0.25, out - inn)
}

export interface Seg {
  start: number
  dur: number
}

// cumulative [start,dur] per timeline item + the sequence total (≥1 so divisions stay safe)
export function buildSegs(timeline: TimelineItem[], clips: Clip[]): { segs: Seg[]; total: number } {
  let acc = 0
  const segs = timeline.map((it) => {
    const d = effDur(it, clips)
    const seg = { start: acc, dur: d }
    acc += d
    return seg
  })
  return { segs, total: acc || 1 }
}
