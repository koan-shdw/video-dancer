// Effective-duration + cumulative-segment math for the timeline — shared by the Timeline panel,
// the Timeline Monitor's live timecode, and anything else walking the sequence.
// (Previously duplicated with subtle differences — e.g. an Infinity outSec leak in the Monitor.)

export function durOfClip(clips: Clip[], clipId: string): number {
  const c = clips.find((x) => x.id === clipId)
  const d = parseFloat(c?.promptData.duration ?? '5')
  return Number.isNaN(d) || d <= 0 ? 5 : d
}

export function effDur(it: TimelineItem, clips: Clip[]): number {
  const o = it.outSec
  const out = typeof o === 'number' && Number.isFinite(o) ? o : durOfClip(clips, it.clipId)
  return Math.max(0.25, out - (it.inSec ?? 0))
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
