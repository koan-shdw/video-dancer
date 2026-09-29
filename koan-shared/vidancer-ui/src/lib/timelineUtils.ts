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
  // floor in SOURCE seconds (0.25/sp), never timeline seconds: a flat 0.25 floor after the
  // speed division made a speed>1 slice remnant play trimmed-away source past outSec — the
  // exact "frames from before the slice" class the Monitor fights everywhere else.
  // (main-side mirrors: export.ts effOf + project.ts mainEffDur — keep all three in step)
  return Math.max(0.25 / sp, (out - inn) / sp)
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
    if (hiddenTracks?.has(tr)) continue
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
    if (hiddenTracks?.has(tr)) continue
    const s = startOf(it)
    if (T < s - 1e-6 || T >= extentOf(it, items, clips, musicEnd) - 1e-6) continue
    if (!best || tr > trackOf(best)) best = it
  }
  return best
}

// source seconds inside an item's take for timeline time T (speed-aware).
// ⟲ loop items WRAP inside the tail: the clip cycles.
export function sourceTimeAt(it: TimelineItem, clips: Clip[], T: number): number {
  const sp = it.speed && it.speed > 0 ? it.speed : 1
  const base = it.useRecipe ? 0 : (it.inSec ?? 0)
  let rel = Math.max(0, T - startOf(it))
  if (it.loop) {
    const cyc = effDur(it, clips)
    if (cyc > 0.05 && rel >= cyc) rel = rel % cyc
  }
  return base + rel * sp
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
        const sp = p.speed && p.speed > 0 ? p.speed : 1
        const srcD = sourceDurOf(p, clips)
        const inS = p.inSec ?? 0
        const outS = Math.min(p.outSec ?? srcD, srcD)
        const left = s.t0 - p0 > 0.15
        if (left) next.push({ ...p, outSec: inS + (s.t0 - p0) * sp, transitionOutSec: undefined })
        if (p1 - s.t1 > 0.15) next.push({ ...p, id: left ? newId() : p.id, inSec: inS + (s.t1 - p0) * sp, outSec: outS, startSec: s.t1 })
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
  const c = clips.find((x) => x.id === it.clipId)
  const take = c ? resolveTake(c, it) : undefined
  if (!take) return null
  const src = sourceDurOf(it, clips)
  const audio: TimelineAudioItem = {
    id: newId(),
    lane: trackOf(it),
    source: { clipId: it.clipId, takeId: take.id },
    startSec: startOf(it),
    inSec: it.inSec ?? 0,
    outSec: Math.min(it.outSec ?? src, src),
    ...(it.speed && it.speed > 0 && it.speed !== 1 ? { speed: it.speed } : {}),
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
