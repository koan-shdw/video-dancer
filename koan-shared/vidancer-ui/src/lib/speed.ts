import type { Project, Timeline, TimelineItem, TimelineAudioItem } from '../shared/types'
import { mirrorWindow } from '../shared/reverse'
import { clampShiftLeft, effDur, nestLenOf, nextOnTrackStart, resolveTake, sourceDurOf, startOf, trackOf } from './timelineUtils'

// list 51 — Premiere's Clip Speed / Duration. The players' proven range (the old prompt's too).
export const SPEED_MIN = 0.25
export const SPEED_MAX = 4

export interface SpeedOpts {
  speed: number // 1 = 100 %
  duration?: number // the chain OFF: every block runs this long (its out-point moves); absent = the chain ON (the window stays, the length follows the speed)
  reverse: boolean
  keepPitch: boolean
  blend: boolean
  ripple: boolean
}

// a block can play reversed when it has a rendered take (a nest or a storyboard block can't yet)
export function canReverse(it: TimelineItem, clips: Clip[]): boolean {
  if (it.nestId || it.useRecipe) return false
  const c = clips.find((x) => x.id === it.clipId)
  return !!(c && resolveTake(c, it))
}

// the source seconds a block can reach: its take, or (a nest) its timeline
export function reachOf(p: Pick<Project, 'clips' | 'timelines' | 'audio'>, it: TimelineItem): number {
  return it.nestId ? Math.max(nestLenOf(p, it.nestId), it.outSec ?? 0) : sourceDurOf(it, p.clips)
}

// the chosen blocks, left to right: speed, reverse (the window mirrors into the reversed copy's
// seconds, the same frames), pitch, blending. The length change RIPPLES everything after the
// block's old end (the end-trim ripple: every unlocked track + free lane audio, clamped so nothing
// collides); ripple off, a block only grows into free room on its track (its out-point stops at
// the next block) and a shorter one leaves a gap — Premiere's rules. One result = one write.
export function applySpeed(
  p: Pick<Project, 'clips' | 'timelines' | 'audio'>,
  tl: Timeline,
  ids: string[],
  o: SpeedOpts
): { items: TimelineItem[]; audioItems: TimelineAudioItem[] | null; changed: number } {
  const clips = p.clips
  const locked = new Set(tl.lockedTracks ?? [])
  const sp = Math.min(SPEED_MAX, Math.max(SPEED_MIN, o.speed))
  let items = tl.items.slice()
  let audio: TimelineAudioItem[] | null = null
  let changed = 0
  const order = ids
    .map((id) => tl.items.find((x) => x.id === id))
    .filter((x): x is TimelineItem => !!x && !locked.has(`v${trackOf(x)}`))
    .sort((a, b) => startOf(a) - startOf(b))
  for (const was of order) {
    const t = items.find((x) => x.id === was.id)! // an earlier ripple may have moved it
    const src = reachOf(p, t)
    let inS = t.inSec ?? 0
    let outS = Math.min(t.outSec ?? src, src)
    const rev = o.reverse && canReverse(t, clips)
    if (rev !== !!t.reverse) ({ inSec: inS, outSec: outS } = mirrorWindow(inS, outS, src))
    if (o.duration != null && !t.useRecipe) outS = Math.min(src, inS + Math.max(0.25, o.duration) * sp)
    const start = startOf(t)
    const oldLen = effDur(t, clips)
    let next: TimelineItem = { ...t, inSec: inS, outSec: outS, speed: sp === 1 ? undefined : sp, reverse: rev || undefined, pitchShift: o.keepPitch ? undefined : true, interp: o.blend ? 'blend' : undefined }
    let newLen = effDur(next, clips)
    if (!o.ripple && newLen > oldLen + 1e-6 && !t.useRecipe) {
      const wall = nextOnTrackStart(t, items)
      if (wall != null && start + newLen > wall + 1e-6) {
        next = { ...next, outSec: Math.min(outS, inS + Math.max(0.25 / sp, wall - start) * sp) }
        newLen = effDur(next, clips)
      }
    }
    items = items.map((x) => (x.id === t.id ? next : x))
    changed++
    if (!o.ripple) continue
    const oldEnd = start + oldLen
    const shift = clampShiftLeft(items, clips, oldEnd, newLen - oldLen, { id: t.id, newEnd: start + newLen })
    if (Math.abs(shift) < 1e-3) continue
    const after = (s: number): boolean => s >= oldEnd - 1e-3
    items = items.map((x) => (x.id !== t.id && !locked.has(`v${trackOf(x)}`) && after(startOf(x)) ? { ...x, startSec: Math.max(0, startOf(x) + shift) } : x))
    const aud: TimelineAudioItem[] = audio ?? tl.audioItems ?? []
    const moves = (a: TimelineAudioItem): boolean => !a.link && !locked.has(`a${a.lane}`) && after(a.startSec)
    if (aud.some(moves)) audio = aud.map((a) => (moves(a) ? { ...a, startSec: Math.max(0, a.startSec + shift) } : a))
  }
  return { items, audioItems: audio, changed }
}
