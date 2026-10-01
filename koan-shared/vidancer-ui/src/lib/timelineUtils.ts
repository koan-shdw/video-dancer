import { audioKeyMuted, scoreKeyOf, levelCurve, foldEnvelope, type EnvPiece } from '../shared/audioEnv'
import type { VolumePoint, FadeShape } from '../shared/types'
import { remapLen, remapRateAt, remapRelAt, remapScale, remapSrcAt } from '../shared/remap'

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

// the source length behind a timeline item (its active view). A NEST block's own window is its
// length: it keeps its duration when the timeline inside changes (Premiere) — only the trim-out
// gesture reaches for the inside's real length (nestLenOf)
export function sourceDurOf(it: TimelineItem, clips: Clip[]): number {
  if (it.nestId) return it.outSec ?? 5
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
  if (remapped(it)) return Math.max(0.01, remapLen(it.remap!, inn, out)) // list 56: the speed line decides
  // floor in SOURCE seconds (0.25/sp), never timeline seconds: a flat 0.25 floor after the
  // speed division made a speed>1 slice remnant play trimmed-away source past outSec — the
  // exact "frames from before the slice" class the Monitor fights everywhere else.
  // (main-side mirrors: export.ts effOf + project.ts mainEffDur — keep all three in step)
  return Math.max(0.25 / sp, (out - inn) / sp)
}

// ---- list 56 (SPEED-RAMPS-SPEC-2026-10-01): a block whose speed changes along it (Time Remapping).
// These are the one reading of a block's clock: rel = timeline seconds into the block, may run past
// either end (trims and a dissolve's handles reach there; the end speeds carry on). ----
export const remapped = (it: TimelineItem): boolean => !!it.remap && !it.useRecipe && !it.nestId
export function srcAtRel(it: TimelineItem, rel: number): number {
  const base = it.useRecipe ? 0 : (it.inSec ?? 0)
  if (remapped(it)) return remapSrcAt(it.remap!, base, rel)
  return base + rel * (it.speed && it.speed > 0 ? it.speed : 1)
}
export function relAtSrc(it: TimelineItem, s: number): number {
  const base = it.useRecipe ? 0 : (it.inSec ?? 0)
  if (remapped(it)) return remapRelAt(it.remap!, base, s)
  return (s - base) / (it.speed && it.speed > 0 ? it.speed : 1)
}
// the length a window would give this block (a trim's preview)
export function lenOfWindow(it: TimelineItem, inSec: number, outSec: number): number {
  if (remapped(it)) return Math.max(0.01, remapLen(it.remap!, inSec, outSec))
  return Math.max(0.25, (outSec - inSec) / (it.speed && it.speed > 0 ? it.speed : 1))
}
// the playback rate at timeline time T (a constant speed, or where the speed line is at T)
export function rateAt(it: TimelineItem, clips: Clip[], T: number): number {
  if (!remapped(it)) return it.speed && it.speed > 0 ? it.speed : 1
  let rel = Math.max(0, T - startOf(it))
  if (it.loop) {
    const cyc = effDur(it, clips)
    if (cyc > 0.05 && rel >= cyc) rel = rel % cyc
  }
  return remapRateAt(it.remap!, it.inSec ?? 0, rel)
}
// a remapped block's own sound plays at normal speed (Premiere: time remapping is the video's only —
// `speed` on it is its sound's, set only by a sped-up nest): from its in-point, for its window or the
// block, whichever ends first
export function remapAudioOut(it: TimelineItem, clips: Clip[]): number {
  const dur = sourceDurOf(it, clips)
  const inn = it.inSec ?? 0
  return Math.min(Math.min(it.outSec ?? dur, dur), inn + effDur(it, clips) * (it.speed && it.speed > 0 ? it.speed : 1))
}

// ---- v14 absolute-time track geometry ----
export const startOf = (it: TimelineItem): number => it.startSec ?? 0
export const trackOf = (it: TimelineItem): number => it.track ?? 0
export const physEnd = (it: TimelineItem, clips: Clip[]): number => startOf(it) + effDur(it, clips)

// ---- v17 ⟲ LOOP TAIL — a looped item PROJECTS faded repeats after itself. No copies: the one
// item resolves over and over, so its RESOLUTION span runs to the tail end and sourceTimeAt
// wraps inside it. The tail is NOT occupancy — edit ops (carve/ripple/clamp/insert) stay on
// physical geometry and tails re-flow around whatever they produce. Mirrored by the export
// planner in src/main/export.ts (which re-derives eff math the same way — keep them in step).

// earliest same-track block start after this one — the tail's hard wall (null = open track).
// Disabled blocks still wall (they occupy their slot everywhere else too).
export function nextOnTrackStart(it: TimelineItem, items: TimelineItem[]): number | null {
  let best: number | null = null
  for (const x of items) {
    if (x.id === it.id || trackOf(x) !== trackOf(it)) continue
    const s = startOf(x)
    if (s > startOf(it) + 1e-3 && (best == null || s < best)) best = s
  }
  return best
}

// where the music lane ends (0 = no music, or its length is unknowable — no wave probed yet)
export function musicEndOf(tl: Timeline | undefined, audio: { id: string; durationSec?: number }[]): number {
  const m = tl?.music
  if (!m) return 0
  const dur = audio.find((a) => a.id === m.audioId)?.durationSec
  const out = m.outSec ?? dur
  if (out == null) return 0
  return m.startSec + Math.max(0, Math.min(out, dur ?? out) - (m.inSec ?? 0))
}

// where ALL absolute-time audio ends — the music lane + detached audio blocks + ♪ score spans.
// The sequence end can never cut this floor (2026-08-19 fix: a long score hung off the ruler,
// playback stopped early; detached audio shared the same hole).
export function audioEndOf(tl: Timeline | undefined, audio: { id: string; durationSec?: number }[]): number {
  let end = musicEndOf(tl, audio)
  for (const a of tl?.audioItems ?? []) end = Math.max(end, a.startSec + Math.max(0, a.outSec - a.inSec))
  for (const s of tl?.scoreItems ?? []) end = Math.max(end, s.startSec + Math.max(0, s.spanSec))
  return end
}

// the tail's effective end. SET (loopTailSec): base + that length, compressed by a later
// neighbor (springs back when the neighbor leaves). ELASTIC (absent): fill to the next block
// on the track, else the sequence hard end = other blocks' physical/SET-tail ends + the music
// end — other ELASTIC tails never count, so two elastic tails can't inflate each other.
export function tailEndOf(it: TimelineItem, items: TimelineItem[], clips: Clip[], musicEnd = 0): number {
  const base = physEnd(it, clips)
  if (!it.loop) return base
  const next = nextOnTrackStart(it, items)
  if (it.loopTailSec != null) return Math.max(base, Math.min(base + it.loopTailSec, next ?? Infinity))
  if (next != null) return Math.max(base, next)
  let hard = musicEnd
  for (const x of items) {
    if (x.id === it.id) continue
    const xb = physEnd(x, clips)
    const xe = x.loop && x.loopTailSec != null ? Math.max(xb, Math.min(xb + x.loopTailSec, nextOnTrackStart(x, items) ?? Infinity)) : xb
    if (xe > hard) hard = xe
  }
  return Math.max(base, hard)
}

// full resolution span end of an item — physical end, or the tail end when looping
export function extentOf(it: TimelineItem, items: TimelineItem[], clips: Clip[], musicEnd = 0): number {
  return it.loop ? tailEndOf(it, items, clips, musicEnd) : physEnd(it, clips)
}

// the sequence's end = the rightmost block edge INCLUDING loop tails (gaps legal; ≥0).
// No recursion: tail math references only physical/set extents + music, never this.
export function timelineEnd(items: TimelineItem[], clips: Clip[], musicEnd = 0): number {
  return items.reduce((m, it) => Math.max(m, extentOf(it, items, clips, musicEnd)), 0)
}

// what's VISIBLE at time T: the topmost occupied video track (undefined = gap → black).
// hiddenTracks = per-track mute/solo resolution done by the caller. DISABLED (⊘) items are
// invisible + silent everywhere but still occupy their slot — resolution skips them.
export function itemAt(items: TimelineItem[], clips: Clip[], T: number, hiddenTracks?: Set<number>, musicEnd = 0): TimelineItem | undefined {
  let best: TimelineItem | undefined
  for (const it of items) {
    if (it.disabled) continue
    const tr = trackOf(it)
    if (hiddenTracks?.has(trackKey(tr))) continue
    const s = startOf(it)
    if (T < s - 1e-6 || T >= extentOf(it, items, clips, musicEnd) - 1e-6) continue
    if (!best || tr > trackOf(best)) best = it
  }
  return best
}

// the SECOND-topmost visible item at T — the dissolve partner during a transition window
export function itemUnderAt(items: TimelineItem[], clips: Clip[], T: number, top: TimelineItem | undefined, hiddenTracks?: Set<number>, musicEnd = 0): TimelineItem | undefined {
  let best: TimelineItem | undefined
  for (const it of items) {
    if (it === top || it.disabled) continue
    const tr = trackOf(it)
    if (hiddenTracks?.has(trackKey(tr))) continue
    const s = startOf(it)
    if (T < s - 1e-6 || T >= extentOf(it, items, clips, musicEnd) - 1e-6) continue
    if (!best || tr > trackOf(best)) best = it
  }
  return best
}

// source seconds inside an item's take for timeline time T (speed-aware).
// ⟲ loop items WRAP inside the tail: the clip cycles.
export function sourceTimeAt(it: TimelineItem, clips: Clip[], T: number): number {
  let rel = Math.max(0, T - startOf(it))
  if (it.loop) {
    const cyc = effDur(it, clips)
    if (cyc > 0.05 && rel >= cyc) rel = rel % cyc
  }
  return srcAtRel(it, rel) // list 56: a remapped block walks its speed line
}

// the next moment (> T) at which the visible composition can change — block starts and tail-
// aware ends across every track. Drives the A/B player's preload target. Loop SEAMS are NOT
// boundaries here on purpose: nothing to preload at a seam (same file, already live) — the
// Monitor handles seams with its own precise seek-back timer. null = nothing ahead.
export function nextBoundary(items: TimelineItem[], clips: Clip[], T: number, musicEnd = 0): number | null {
  let best: number | null = null
  for (const it of items) {
    if (it.disabled) continue
    const s = startOf(it)
    const e = extentOf(it, items, clips, musicEnd)
    for (const b of [s, e]) if (b > T + 1e-4 && (best == null || b < best)) best = b
  }
  return best
}

// time-sorted block starts (for Alt+←/→ transport jumps between cuts)
export function blockStarts(items: TimelineItem[]): number[] {
  return Array.from(new Set(items.map((it) => Math.round(startOf(it) * 1000) / 1000))).sort((a, b) => a - b)
}

// every edit point — block starts AND ends, deduped and sorted (↑/↓ playhead jumps)
export function editPoints(items: TimelineItem[], clips: Clip[]): number[] {
  const pts = new Set<number>()
  for (const it of items) {
    const s = startOf(it)
    pts.add(Math.round(s * 1000) / 1000)
    pts.add(Math.round((s + effDur(it, clips)) * 1000) / 1000)
  }
  return Array.from(pts).sort((a, b) => a - b)
}

// SHARED RIPPLE CLAMP: a leftward pull of `shift` (<0) starting at `fromT` must not make any
// shifting block collide with a static block on its own track. `edited` = an item whose length
// just changed — its NEW end is used for the static-side extent. Returns the safe (clamped) shift.
export function clampShiftLeft(items: TimelineItem[], clips: Clip[], fromT: number, shift: number, edited?: { id: string; newEnd: number }): number {
  if (shift >= -0.001) return shift
  const tracks = new Set(items.map(trackOf))
  for (const tr of tracks) {
    const sh = items.filter((x) => (!edited || x.id !== edited.id) && trackOf(x) === tr && startOf(x) >= fromT - 0.001)
    if (!sh.length) continue
    const firstS = Math.min(...sh.map((x) => startOf(x)))
    const staticEnd = Math.max(
      0,
      ...items.filter((x) => trackOf(x) === tr && startOf(x) < fromT - 0.001).map((x) => (x.id === edited?.id ? edited.newEnd : startOf(x) + effDur(x, clips)))
    )
    shift = Math.max(shift, -Math.max(0, firstS - staticEnd))
  }
  return shift
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

// ---- 41 · AUDIO-LINK-CUT-PASTE-SPEC-2026-09-23: the overwrite grammar, shared by the panel and
// the store so a drop, a move, a paste and an unlink all land the same way ----

export const newId = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

// a lane item's length on the timeline (speed-aware, never thinner than a quarter second)
export const audioLenOf = (a: TimelineAudioItem): number => Math.max(0.25, (a.outSec - a.inSec) / (a.speed && a.speed > 0 ? a.speed : 1))

// PREMIERE OVERWRITE on the video tracks: moved blocks carve their spans out of whatever sits
// under them on the target track — middle hits split into remnants, edge hits trim, covered
// blocks vanish. Storyboard (S-B) blocks can't be trimmed, so they get pushed right. A locked
// track's blocks are untouchable (the mover simply overlaps; topmost-track-wins keeps playback
// deterministic).
export function carveVideo(items: TimelineItem[], moving: Map<string, { startSec: number; track: number }>, clips: Clip[], locked: Set<string>): TimelineItem[] {
  const spans: { track: number; t0: number; t1: number }[] = []
  for (const [id, pos] of moving) {
    const src = items.find((x) => x.id === id)
    if (src) spans.push({ track: pos.track, t0: pos.startSec, t1: pos.startSec + effDur(src, clips) })
  }
  const out: TimelineItem[] = []
  for (const x of items) {
    if (moving.has(x.id) || locked.has(`v${trackOf(x)}`)) {
      out.push(x)
      continue
    }
    let pieces: TimelineItem[] = [x]
    for (const s of spans) {
      const next: TimelineItem[] = []
      for (const p of pieces) {
        const p0 = startOf(p)
        const p1 = p0 + effDur(p, clips)
        if (trackOf(p) !== s.track || p1 <= s.t0 + 0.001 || p0 >= s.t1 - 0.001) {
          next.push(p)
          continue
        }
        if (p.useRecipe) {
          next.push({ ...p, startSec: s.t1 }) // untrimmable — slide past instead
          continue
        }
        const srcD = sourceDurOf(p, clips)
        const outS = Math.min(p.outSec ?? srcD, srcD)
        const left = s.t0 - p0 > 0.15
        if (left) next.push({ ...p, outSec: srcAtRel(p, s.t0 - p0), transitionOutSec: undefined })
        if (p1 - s.t1 > 0.15) next.push({ ...p, id: left ? newId() : p.id, inSec: srcAtRel(p, s.t1 - p0), outSec: outS, startSec: s.t1 })
      }
      pieces = next
    }
    out.push(...pieces)
  }
  return out
}

// does this video block carry its own sound on the lanes (a COMPANION: embedded, not an item)?
export function hasCompanion(it: TimelineItem, clips: Clip[]): boolean {
  if (it.audioDetachedId || it.useRecipe || it.disabled || it.muted) return false
  if (it.nestId) return true // NEST (list 3, part 2): a nest's sound rides its lane like a clip's
  const c = clips.find((x) => x.id === it.clipId)
  return !!(c && resolveTake(c, it))
}

export interface LaneSpan {
  lane: number
  start: number
  end: number
}

// the companion's span on the lanes: lane = the video track (A-n pairs with V-n, his law 09-23)
export function companionSpan(it: TimelineItem, clips: Clip[]): LaneSpan | null {
  if (!hasCompanion(it, clips)) return null
  const s = startOf(it)
  return { lane: trackOf(it), start: s, end: s + effDur(it, clips) }
}

// a block's embedded sound becomes a FREE lane item at the very spot the companion sat (lane =
// track, same window, same level, fades and speed); the block mutes. Main's unlink does the
// same for the menu; this copy serves overwrites and pastes in the renderer.
export function detachCompanion(it: TimelineItem, clips: Clip[]): { audio: TimelineAudioItem; item: TimelineItem } | null {
  let source: TimelineAudioItem['source']
  const src = sourceDurOf(it, clips)
  if (it.nestId) source = { nestId: it.nestId } // NEST (list 3, part 2): the nest's sound unlinks as a lane nest
  else {
    const c = clips.find((x) => x.id === it.clipId)
    const take = c ? resolveTake(c, it) : undefined
    if (!take) return null
    source = { clipId: it.clipId, takeId: take.id }
  }
  const audio: TimelineAudioItem = {
    id: newId(),
    lane: trackOf(it),
    source,
    startSec: startOf(it),
    inSec: it.inSec ?? 0,
    outSec: remapped(it) ? remapAudioOut(it, clips) : Math.min(it.outSec ?? src, src), // list 56: normal speed
    ...(it.speed && it.speed > 0 && it.speed !== 1 ? { speed: it.speed } : {}), // on a remapped block: its sound's (a nest's)
    ...(it.reverse ? { reverse: true } : {}), // list 51: its sound plays the reversed copy too
    ...(it.pitchShift ? { pitchShift: true } : {}),
    ...(it.gain != null ? { gain: it.gain } : {}),
    ...(it.volume?.length ? { volume: it.volume } : {}),
    ...(it.fadeInSec ? { fadeInSec: it.fadeInSec, fadeInShape: it.fadeInShape } : {}),
    ...(it.fadeOutSec ? { fadeOutSec: it.fadeOutSec, fadeOutShape: it.fadeOutShape } : {})
  }
  return { audio, item: { ...it, muted: true, audioDetachedId: audio.id, gain: undefined, volume: undefined, fadeInSec: undefined, fadeOutSec: undefined, fadeInShape: undefined, fadeOutShape: undefined } }
}

export interface LaneState {
  items: TimelineItem[]
  audioItems: TimelineAudioItem[]
  scoreItems: TimelineScoreItem[]
}

// PREMIERE OVERWRITE on the lanes (his law 09-23: "the audio cut each other out like video
// does"): every landed span carves what sits under it on its A lane — free and linked audio
// items and companions (a block's embedded sound is detached first, then carved like any
// item). ♪ scores live on their own S tracks (list 2) and pass through untouched: an edit on
// the A lanes can never cut into one. `keep` = the landed things' ids, never carved. A locked
// lane is untouchable.
export function overwriteLanes(state: LaneState, clips: Clip[], spans: LaneSpan[], keep: Set<string>, locked: Set<string>): LaneState {
  let items = state.items
  let audio = state.audioItems.slice()
  for (const sp of spans) {
    if (locked.has(`a${sp.lane}`)) continue
    // companions under the span → detached (the block mutes, its sound becomes an item)
    items = items.map((it) => {
      if (keep.has(it.id) || trackOf(it) !== sp.lane || !hasCompanion(it, clips)) return it
      const s = startOf(it)
      const e = s + effDur(it, clips)
      if (e <= sp.start + 0.001 || s >= sp.end - 0.001) return it
      const d = detachCompanion(it, clips)
      if (!d) return it
      audio.push(d.audio)
      return d.item
    })
    const segs = buildSegs(items, clips).segs
    const nextAudio: TimelineAudioItem[] = []
    for (const x of audio) {
      if (keep.has(x.id) || x.lane !== sp.lane) {
        nextAudio.push(x)
        continue
      }
      const xs = audioStartOf(x, segs, items)
      const xe = xs + audioLenOf(x)
      if (xe <= sp.start + 0.001 || xs >= sp.end - 0.001) {
        nextAudio.push(x)
        continue
      }
      const spd = x.speed && x.speed > 0 ? x.speed : 1
      const left = sp.start - xs > 0.15
      const right = xe - sp.end > 0.15
      if (left) nextAudio.push({ ...x, outSec: x.inSec + (sp.start - xs) * spd, fadeOutSec: undefined, fadeOutShape: undefined })
      if (right) {
        const dIn = (sp.end - xs) * spd
        nextAudio.push({ ...x, id: left ? newId() : x.id, inSec: x.inSec + dIn, startSec: sp.end, fadeInSec: undefined, fadeInShape: undefined, beatGrid: left ? undefined : x.beatGrid, ...(x.link ? { link: { ...x.link, offset: x.link.offset + (sp.end - xs) } } : {}) })
      }
      // neither remnant survives → fully covered → gone
    }
    audio = nextAudio
  }
  return { items, audioItems: audio, scoreItems: state.scoreItems }
}

// list 1 (2026-09-29): key n hides / shows track n. V-n's 👁 and A-n's M flip together (the 41
// pair), whichever of the two exists; the lead (V-n, else A-n) decides the direction.
// null = the timeline has no track n at all.
export function toggleTrackPair(tl: Pick<Timeline, 'videoTracks' | 'audioTracks' | 'mutedTracks'>, n: number): string[] | null {
  const vCount = Math.max(1, tl.videoTracks ?? 1)
  const laneCount = Math.max(1, tl.audioTracks ?? 3, vCount) // the lane rail's own rule (41)
  const keys = [n < vCount ? `v${n}` : '', n < laneCount ? `a${n}` : ''].filter(Boolean)
  if (!keys.length) return null
  const muted = new Set(tl.mutedTracks ?? [])
  const hide = !muted.has(keys[0])
  for (const k of keys) {
    if (hide) muted.add(k)
    else muted.delete(k)
  }
  return [...muted]
}

// list 2 (2026-09-29): the S (score) tracks' own overwrite — a ♪ span landing on another carves
// it the Premiere way (trim / split with its in-point carried / swallow). Only scores live on S
// tracks, so nothing else is ever touched. A locked S track ('s<n>') is untouchable.
export function carveScores(state: TimelineScoreItem[], spans: LaneSpan[], keep: Set<string>, locked: Set<string>): TimelineScoreItem[] {
  let scores = state.slice()
  for (const sp of spans) {
    if (locked.has(`s${sp.lane}`)) continue
    const nextScores: TimelineScoreItem[] = []
    for (const x of scores) {
      if (keep.has(x.id) || (x.lane ?? 0) !== sp.lane) {
        nextScores.push(x)
        continue
      }
      const xs = x.startSec
      const xe = xs + x.spanSec
      if (xe <= sp.start + 0.001 || xs >= sp.end - 0.001) {
        nextScores.push(x)
        continue
      }
      const left = sp.start - xs > 0.15
      const right = xe - sp.end > 0.15
      if (left) nextScores.push({ ...x, spanSec: sp.start - xs, fadeOutSec: undefined, fadeOutShape: undefined })
      if (right) nextScores.push({ ...x, id: left ? newId() : x.id, startSec: sp.end, spanSec: xe - sp.end, inSec: (x.inSec ?? 0) + (sp.end - xs), fadeInSec: undefined, fadeInShape: undefined })
    }
    scores = nextScores
  }
  return scores
}

// list 2: how many S tracks the timeline shows — the stored count (default 3), never fewer than
// the highest score needs
export function scoreTrackCount(tl: Pick<Timeline, 'scoreTracks' | 'scoreItems'> | undefined): number {
  return Math.max(1, tl?.scoreTracks ?? 3, ...(tl?.scoreItems ?? []).map((x) => (x.lane ?? 0) + 1))
}

// ---- NEST (list 3, 2026-09-29) — Premiere's nested sequence, played LIVE ----
// A nest block (item.nestId) stands for another timeline, windowed by its own inSec/outSec (the
// seconds of the timeline inside). The Timeline panel edits it as one block; playback and export
// never see it: flattenNests swaps each nest block for what plays inside its window — the inner
// timeline's own blocks, their tracks kept in order as fractions ABOVE the nest's track (inner V1
// of a nest on V2 = 1.01, inner V2 = 1.02 …), its lane audio on the nest's paired A lane, its
// scores keyed to that lane too — so every resolver (itemAt, the export's top-track pick,
// dissolves, effects, covered sound) runs on ordinary blocks. Track KEYS (hide / mute / solo /
// lock) floor back to whole tracks (trackKey). A disabled copy of the nest keeps its ground as a
// wall for loop tails. A nest inside a nest flattens first; a timeline never plays inside itself
// (the chain is cut there and that nest plays black).
// Part 2: the nest block's own speed, effects, dissolve and level (gain, band, fades) ride every
// piece; its sound unlinks into a lane block ({ nestId } source) that flattens the same way, as
// sound only.
export const trackKey = (track: number | undefined): number => Math.floor(track ?? 0)

// how long a timeline runs as a nest source: its last block edge or its last sound
export function nestLenOf(p: Pick<Project, 'timelines' | 'clips' | 'audio'>, timelineId: string): number {
  const tl = p.timelines.find((t) => t.id === timelineId)
  if (!tl) return 0
  const audioEnd = audioEndOf(tl, p.audio ?? [])
  return Math.max(timelineEnd(tl.items, p.clips, audioEnd), audioEnd)
}

// the timeline a lane block's sound comes from, when it is a nest's (part 2: an unlinked nest)
export const nestOfAudio = (a: TimelineAudioItem): string | undefined => ('nestId' in a.source ? a.source.nestId : undefined)

// does timeline `fromId` play `toId` anywhere inside it (itself included)? The no-cycles gate for
// every way a nest lands (drop, paste): a timeline can never end up inside itself
export function nestReaches(timelines: Timeline[], fromId: string, toId: string, seen = new Set<string>()): boolean {
  if (fromId === toId) return true
  if (seen.has(fromId)) return false
  seen.add(fromId)
  const tl = timelines.find((t) => t.id === fromId)
  if (!tl) return false
  const kids = [...tl.items.map((it) => it.nestId), ...(tl.audioItems ?? []).map(nestOfAudio)]
  return kids.some((k) => !!k && nestReaches(timelines, k, toId, seen))
}

// the whole video tracks a timeline hides (its 👁 / solo), the same rule the Monitor applies
function hiddenVideoKeys(tl: Timeline): Set<number> {
  const out = new Set<number>()
  const solos = (tl.soloTracks ?? []).filter((t) => t[0] === 'v')
  const vCount = Math.max(1, tl.videoTracks ?? 1, ...tl.items.map((it) => trackKey(it.track) + 1))
  for (let t = 0; t < vCount; t++) if (solos.length ? !solos.includes(`v${t}`) : (tl.mutedTracks ?? []).includes(`v${t}`)) out.add(t)
  return out
}

// a nest's effects run AFTER the stack of each block inside it (the inner comp, then the nest's —
// Premiere's nested sequence); every entry keeps the arc of the block it belongs to (span), and the
// nest's blend meets the tracks below. Ceiling: inner layers that blend with EACH OTHER get the
// nest's blend one by one, not as one group (a group pass in the chain would lift it).
export function joinNestFx(base: ItemFx | undefined, nest: ItemFx | null | undefined, nestId: string, span: [number, number]): ItemFx | undefined {
  if (!nest || (!nest.stack?.length && !nest.blend)) return base
  const stack = [...(base?.stack ?? []), ...(nest.stack ?? []).map((e) => ({ ...e, id: `${nestId}:${e.id}`, span }))]
  const x = base?.blend
  const y = nest.blend
  const blend = x && y ? { mode: x.mode !== 'normal' ? x.mode : y.mode, opacity: (x.opacity ?? 1) * (y.opacity ?? 1) } : (x ?? y)
  return { v: 2, stack, ...(blend ? { blend } : {}) }
}

type Level = { gain?: number; volume?: VolumePoint[]; fadeInSec?: number; fadeOutSec?: number; fadeInShape?: FadeShape; fadeOutShape?: FadeShape }
// one nest instance: a nest BLOCK (track set: picture + sound) or a nest LANE block (sound only)
interface NestHost {
  id: string
  nestId: string
  start: number // parent seconds where the window's in-point plays
  a: number // the window, in the inner timeline's seconds
  b: number
  sp: number // its playback rate
  len: number // its own length on the parent timeline
  lane: number // where its sound rides
  track?: number
  muted: boolean
  pitchShift?: boolean // list 51: Maintain Audio Pitch off on the nest reaches everything inside
  interp?: 'blend'
  level: Level
  fx?: ItemFx
  transitionOutSec?: number
  transitionAlignment?: number
}

// what plays inside one host's window, in parent time
function nestPieces(h: NestHost, p: Pick<Project, 'timelines' | 'clips' | 'audio'>, chain: Set<string>): { items: TimelineItem[]; audio: TimelineAudioItem[]; scores: TimelineScoreItem[] } | null {
  const eps = 1e-3
  const raw = p.timelines.find((t) => t.id === h.nestId)
  if (!raw || chain.has(raw.id) || h.b - h.a < eps) return null // gone · a cycle · empty → black + silent
  const inner = flattenNests(raw, p, new Set([...chain, raw.id]))
  const clips = p.clips
  const { a, b, sp } = h
  const T = (t: number): number => h.start + (t - a) / sp // inner seconds → parent seconds
  const pid = (id: string): string => `${h.id}>${id}`
  const hostCurve = levelCurve(h.level, h.len)
  // a piece's sound level, parent seconds: its block's own band (and a fade the window cuts
  // through, folded so it carries on where it was), then the host's band + fades on top
  const levelOf = (x: Level, xs: number, xLen: number, s0: number, e0: number): Level => {
    const keepIn = s0 <= xs + eps
    const keepOut = e0 >= xs + xLen - eps
    const band = x.volume?.length && (s0 > xs + eps || sp !== 1) ? x.volume.map((pt) => ({ ...pt, at: (pt.at - (s0 - xs)) / sp })) : x.volume
    const curves: EnvPiece[][] = []
    const cut = levelCurve({ fadeInSec: keepIn || !x.fadeInSec ? undefined : x.fadeInSec / sp, fadeOutSec: keepOut || !x.fadeOutSec ? undefined : x.fadeOutSec / sp, fadeInShape: x.fadeInShape, fadeOutShape: x.fadeOutShape }, xLen / sp)
    if (cut) curves.push(cut.map((pt) => ({ at: pt.at - (s0 - xs) / sp, db: pt.db })))
    if (hostCurve) curves.push(hostCurve.map((pt) => ({ at: pt.at - (s0 - a) / sp, db: pt.db })))
    const g = (x.gain ?? 1) * (h.level.gain ?? 1)
    return {
      gain: g === 1 ? undefined : g,
      volume: curves.length ? foldEnvelope(band, (e0 - s0) / sp, curves) : band,
      fadeInSec: keepIn && x.fadeInSec ? x.fadeInSec / sp : undefined,
      fadeOutSec: keepOut && x.fadeOutSec ? x.fadeOutSec / sp : undefined,
      fadeInShape: x.fadeInShape,
      fadeOutShape: x.fadeOutShape
    }
  }
  const items: TimelineItem[] = []
  const audio: TimelineAudioItem[] = []
  const scores: TimelineScoreItem[] = []
  const hidden = hiddenVideoKeys(inner)
  const innerMusicEnd = audioEndOf(inner, p.audio ?? [])
  const nSpan: [number, number] = [h.start, h.len]
  // VIDEO: every visible inner block, clipped to the window; a loop tail bakes cycle by cycle. A
  // lane host keeps only their sound (a companion's rule: a take, not muted, not unlinked)
  for (const x of inner.items) {
    if (x.disabled || hidden.has(trackKey(x.track))) continue
    const xs = startOf(x)
    const xe = extentOf(x, inner.items, clips, innerMusicEnd)
    if (xe <= a + eps || xs >= b - eps) continue
    const spx = x.speed && x.speed > 0 ? x.speed : 1
    const cyc = effDur(x, clips)
    const cycles = x.loop && cyc > 0.05 ? Math.max(1, Math.ceil((xe - xs) / cyc - 1e-6)) : 1
    const innerMuted = !!inner.videoMuted || audioKeyMuted(inner, `a${trackKey(x.track)}`)
    const xClip = h.track == null ? clips.find((cl) => cl.id === x.clipId) : undefined
    const take = xClip ? resolveTake(xClip, x) : undefined
    for (let c = 0; c < cycles; c++) {
      const cs = xs + c * cyc
      const ce = cycles > 1 ? Math.min(cs + cyc, xe) : xe
      const s0 = Math.max(cs, a)
      const e0 = Math.min(ce, b)
      if (e0 - s0 < eps) continue
      if (x.useRecipe && (s0 > cs + eps || e0 < ce - eps)) continue // a storyboard block can't be cut into — it shows whole or not at all
      const rm = remapped(x) // list 56: its window walks its speed line; its sound plays at normal speed
      const sp2 = (rm ? 1 : spx) * sp
      const muted = x.muted || h.muted || innerMuted || undefined
      const window = x.useRecipe ? {} : { inSec: srcAtRel(x, s0 - cs), outSec: srcAtRel(x, e0 - cs) }
      if (h.track == null) {
        if (muted || x.audioDetachedId || x.useRecipe || !take) continue
        const aw = rm ? { inSec: (x.inSec ?? 0) + (s0 - cs), outSec: Math.min(remapAudioOut(x, clips), (x.inSec ?? 0) + (e0 - cs)) } : window
        if (rm && (aw.outSec ?? 0) - (aw.inSec ?? 0) < 0.02) continue
        audio.push({ id: cycles > 1 ? pid(`${x.id}~${c}`) : pid(x.id), lane: h.lane, source: { clipId: x.clipId, takeId: take.id }, startSec: T(s0), inSec: aw.inSec ?? 0, outSec: aw.outSec ?? 0, ...(sp2 !== 1 ? { speed: sp2 } : {}), ...(x.reverse ? { reverse: true } : {}), ...(x.pitchShift || h.pitchShift ? { pitchShift: true } : {}), ...levelOf(x, xs, cyc, s0, e0) })
        continue
      }
      const atEnd = e0 >= b - eps // this piece reaches the nest's own end → it carries the nest's dissolve
      const own: [number, number] = [T(cs), cyc / sp]
      const baseFx: ItemFx | undefined = x.fx ? { ...x.fx, stack: x.fx.stack.map((e) => ({ ...e, span: e.span ? ([T(e.span[0]), e.span[1] / sp] as [number, number]) : own })) } : undefined
      items.push({
        ...x,
        id: cycles > 1 ? pid(`${x.id}~${c}`) : pid(x.id),
        startSec: T(s0),
        track: h.track + (trackOf(x) + 1) / 100,
        ...window,
        speed: rm ? (sp !== 1 ? sp : undefined) : sp2 !== 1 ? sp2 : undefined, // a remapped piece: its sound plays at the nest's speed
        ...(rm ? { remap: sp !== 1 ? remapScale(x.remap!, sp) : x.remap } : {}),
        pitchShift: x.pitchShift || h.pitchShift || undefined,
        interp: x.interp ?? h.interp,
        loop: undefined,
        loopTailSec: undefined,
        muted,
        transitionOutSec: atEnd ? h.transitionOutSec : e0 >= xe - eps && x.transitionOutSec ? x.transitionOutSec / sp : undefined,
        transitionAlignment: atEnd ? h.transitionAlignment : x.transitionAlignment,
        ...levelOf(x, xs, cyc, s0, e0),
        fx: joinNestFx(baseFx, h.fx, h.id, nSpan),
        nestFx: { of: h.id, base: baseFx, span: nSpan }
      })
    }
  }
  // LANE AUDIO: free blocks on the host's lane, clipped to the window (links resolve inside first)
  const segs = buildSegs(inner.items, clips).segs
  for (const x of inner.audioItems ?? []) {
    if (x.disabled || audioKeyMuted(inner, `a${x.lane}`)) continue
    const xs = audioStartOf(x, segs, inner.items)
    const xLen = audioLenOf(x)
    const s0 = Math.max(xs, a)
    const e0 = Math.min(xs + xLen, b)
    if (e0 - s0 < eps) continue
    const spd = x.speed && x.speed > 0 ? x.speed : 1
    audio.push({
      ...x,
      id: pid(x.id),
      lane: h.lane,
      link: undefined,
      beatGrid: undefined,
      startSec: T(s0),
      inSec: x.inSec + (s0 - xs) * spd,
      outSec: x.inSec + (e0 - xs) * spd,
      speed: spd * sp !== 1 ? spd * sp : undefined,
      pitchShift: x.pitchShift || h.pitchShift || undefined,
      muted: x.muted || h.muted || undefined,
      ...levelOf(x, xs, xLen, s0, e0)
    })
  }
  // SCORES: keyed to the host's lane (scoreKeyOf), clipped to the window
  for (const x of inner.scoreItems ?? []) {
    if (x.disabled || audioKeyMuted(inner, scoreKeyOf(x))) continue
    const xs = x.startSec
    const s0 = Math.max(xs, a)
    const e0 = Math.min(xs + x.spanSec, b)
    if (e0 - s0 < eps) continue
    const spx = x.speed && x.speed > 0 ? x.speed : 1
    scores.push({
      ...x,
      id: pid(x.id),
      nestLane: h.lane,
      startSec: T(s0),
      spanSec: (e0 - s0) / sp,
      inSec: (x.inSec ?? 0) + (s0 - xs) * spx,
      speed: spx * sp !== 1 ? spx * sp : undefined,
      muted: x.muted || h.muted || undefined,
      ...levelOf(x, xs, x.spanSec, s0, e0)
    })
  }
  return { items, audio, scores }
}

export function flattenNests(tl: Timeline, p: Pick<Project, 'timelines' | 'clips' | 'audio'>, chain: Set<string> = new Set([tl.id])): Timeline {
  if (!tl.items.some((it) => it.nestId) && !(tl.audioItems ?? []).some((x) => nestOfAudio(x))) return tl
  const clips = p.clips
  const items: TimelineItem[] = []
  const audioItems: TimelineAudioItem[] = []
  const scoreItems: TimelineScoreItem[] = [...(tl.scoreItems ?? [])]
  for (const n of tl.items) {
    if (!n.nestId) {
      items.push(n)
      continue
    }
    // the nest's own ground stays a wall (disabled = invisible + silent, but it occupies)
    items.push({ ...n, disabled: true, transitionOutSec: undefined })
    if (n.disabled) continue // off → black + silent
    const a = n.inSec ?? 0
    const out = nestPieces(
      { id: n.id, nestId: n.nestId, start: startOf(n), a, b: n.outSec ?? a, sp: n.speed && n.speed > 0 ? n.speed : 1, len: effDur(n, clips), lane: trackKey(n.track), track: trackOf(n), muted: !!n.muted, pitchShift: n.pitchShift, interp: n.interp, level: n, fx: n.fx, transitionOutSec: n.transitionOutSec, transitionAlignment: n.transitionAlignment },
      p,
      chain
    )
    if (!out) continue
    items.push(...out.items)
    if (n.audioDetachedId) continue // unlinked: its sound plays from its lane block now
    audioItems.push(...out.audio)
    scoreItems.push(...out.scores)
  }
  // a nest's LANE block (its unlinked sound): what sounds inside its window, on its lane
  const segs = buildSegs(tl.items, clips).segs
  for (const x of tl.audioItems ?? []) {
    const nestId = nestOfAudio(x)
    if (!nestId) {
      audioItems.push(x)
      continue
    }
    if (x.disabled) continue
    const out = nestPieces({ id: x.id, nestId, start: audioStartOf(x, segs, tl.items), a: x.inSec, b: x.outSec, sp: x.speed && x.speed > 0 ? x.speed : 1, len: audioLenOf(x), lane: x.lane, muted: !!x.muted, pitchShift: x.pitchShift, level: x }, p, chain)
    if (!out) continue
    audioItems.push(...out.audio)
    scoreItems.push(...out.scores)
  }
  return { ...tl, items, audioItems, scoreItems }
}
