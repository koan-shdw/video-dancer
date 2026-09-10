# AUDIO PARITY — audio blocks get every video tool, like Premiere — spec 2026-09-09 (for his read; no code before GO)

## 0. His brief (his words)

"the slice tool doesnt work for audio fix it" · "neither does copy and past for audio" · "a lot of
abilities for the audio channels are missing they should have the same as the video channels like
premiere" · "audio without a video acts weird it no longer displaces other tracks — it can be
dragged over another track and sits over it on the same track, it doesnt move other tracks around
or overwrite them"

Parked by him (not in this spec): linked audio can't change lane while linked. "we'll fix it later".

## 1. What exists (read 2026-09-09, koan-shared `481b7f7`, vi-dancer `c052881`)

Three audio block kinds on the lanes, all in `vidancer-ui/src/panels/Timeline.tsx`:
- **green / teal** = `TimelineAudioItem` (free clip audio · ♫ Library file). Component `AudioItem`,
  gestures in `AudioItemLanes.onGesture` (move · in · out), menu in `AudioItemLanes`.
- **purple ♪** = `TimelineScoreItem`. Component + gestures `ScoreBlocks.startDrag` (move · in · span).
- **blue 🔗** = the video block's own audio (a projection, no item). Click = selects the video
  block (linked selection). Tools on blue = tools on its video block. Already true, stays.

The video block (`TlBlock` + `TimelinePanel`) has these. Audio blocks do not:

| # | tool | video today | audio today |
|---|------|-------------|-------------|
| 1 | slice tool `C` + click | cuts at the click, snaps to playhead / beat | click ignored |
| 2 | `Ctrl+K` razor at playhead | selected block first, else topmost visible | video only |
| 3 | `Ctrl+C` / `Ctrl+V` | copies the selected block, ripple-pastes at the playhead | video only |
| 4 | `Q` / `W` ripple to playhead | trims head / tail to the playhead, all after pulls left | video only |
| 5 | `,` / `.` nudge (Shift = 5) | selection or marquee group, carves on landing | video only |
| 6 | marquee box select + group move + group Delete | drag empty track space | video rows only |
| 7 | `A` select forward | click a block = it + everything after, every channel | video only |
| 8 | gap select (click empty space), Delete closes it, right-click = paste here / close gap | video tracks | lanes: right-click = add lane only |
| 9 | `Ctrl+Alt` drag body = slip | shifts the source window, block stays | video only |
| 10 | `Ctrl` drag a flush edge = rolling trim | both neighbours adjust | video only |
| 11 | ripple delete in the menu | remove + close up | audio menu: plain delete only |
| 12 | end trim ripples (`Alt` = leave gap) | everything after follows the edge | audio end trim never ripples |
| 13 | `Alt` drag = duplicate | drags out a copy | no |
| 14 | `Ctrl` drop = insert (shove right) | everything after the drop shoves right | no |
| 15 | `Shift` drag = hold time (lane change only) | yes | Shift = skip snap instead |
| 16 | ⊘ disable (silent, keeps its slot) | menu row | no |
| 17 | ⚡ speed | menu row, `(out−in)/speed`, Monitor playbackRate, export atempo | no |
| 18 | drop overwrites what it lands on | `carve()` | audio: `carveAudio()` exists but he sees blocks stacking (§3) |

Audio already has: move with lane change, edge trims with neighbour walls, snap, mute, gain,
fades, volume line + keyframes, `Ctrl+Shift+D`, Delete, link / unlink, beat grid. Stays as is.

## 2. The law

Every tool in §1 works on green, teal and purple blocks exactly as it works on a video block.
Same key, same gesture, same menu row, same ripple rules, same undo (one action = one `Ctrl+Z`).
Blue blocks keep forwarding to their video block. Where audio has no analogue the row is
absent, never greyed: stills, effects, dissolve (audio has fades), v2v, loop tail.

## 3. The stacking bug (his report, §0)

`AudioItemLanes.onGesture.up` already calls `carveAudio()` on a move that lands on other audio
items and hops to a free lane when it lands on a blue block or a score. I read it three times
and cannot see the hole from the code. Not reproduced on my side: OPEN. The fix below does not
depend on finding it: every audio placement (move, drop from Library, paste, nudge, duplicate,
Q/W, slip) goes through ONE placement function, `landAudio()`, the audio twin of the video
`carve()`. The old per-gesture code paths go away, so whatever path is skipping the carve dies
with them. Step 1 of the build is still to reproduce it in his app with a console line on the
`stale audio-lane write rejected` warning, so the cause is on record.

## 4. The system (design before code)

**4.1 One selection set.** Today: three exclusive single selections (`selectedTlItemId`,
`selectedAudioItemId`, `selectedScoreItemId`) plus `marqueeSel` (video ids only). New: `marqueeSel`
holds ids of any kind (all ids are UUIDs, no clash). Every tool asks one helper
`selection()` → `{ video: TimelineItem[], audio: TimelineAudioItem[], score: TimelineScoreItem[] }`
built from the single selection or the marquee set. The three single ids stay (panels read them).

**4.2 One placement.** `landAudio(items, moved: Map<id, {startSec, lane}>)` for
`TimelineAudioItem[]`: trims / splits / removes the audio items under each moved span on its
lane (the current `carveAudio` logic, made multi-item), leaves blue blocks and scores as walls
(a landing that overlaps one hops to the first free lane, growing the rail, as today). Scores
keep their own law: one lane, one occupant, hop (SCORE-PLAN). Locked lanes (`a#`) are untouchable,
same as locked video tracks.

**4.3 One commit.** Anything that moves video AND audio in one gesture goes through
`setTimelineBoth` (exists) so it is one undo step. Scores need to join: a three-way
`setTimelineAll(items, audioItems | null, scoreItems | null)` in main (one IPC + one project.ts
function, one rev bump). I add it; `setTimelineBoth` stays as its two-way alias.

**4.4 Blue forwards.** Any tool applied to a blue block = the same tool on its video block.
Already the case for click / Delete / menu; slice, nudge, copy, Q/W follow.

## 5. Each tool, audio version

Units: audio item `at` in volume points is block-local seconds (from the item's in-point).
Score `spanSec` is timeline length; `inSec` the window start.

1. **Slice** (`C` click, `Ctrl+K`). Audio item at cut `T` (timeline) → source cut `c = inSec + (T − start)`.
   Left `{…a, outSec: c, fadeOutSec/Shape: undefined, volume: points with at < (c−inSec)}`. Right
   `{…a, id new, inSec: c, startSec: T, fadeInSec/Shape: undefined, volume: points with at ≥ (c−inSec),
   at −= (c−inSec), beatGrid: undefined, link: link ? {…link, offset: offset + (T−start)} : undefined}`.
   Fades: the head keeps its fade-in, the tail its fade-out (Premiere). Min piece 0.15 s.
   Score: left `spanSec = T − startSec`; right `{id new, startSec: T, inSec: (inSec??0) + (T−startSec),
   spanSec: span − (T−startSec)}`, same fade / volume split. Snap to playhead and beat ticks like video.
   Blue: slices the video block (both halves, linked). `Ctrl+K`: selected block of any kind first, else
   the topmost visible video block (his existing rule). Runs in the renderer via `setTimelineAudioItems`
   / `setTimelineScoreItems` (no main change; the video slice stays in main for the stills remap).
2. **Copy / paste.** `tlClipboard` becomes `{ kind: 'video' | 'audio' | 'score', item }`. `Ctrl+C` copies
   the selected block of any kind; a blue block copies its video block. `Ctrl+V` = ripple insert at the
   playhead on the copied block's lane: everything at/after the paste point shifts right by its
   length, all unlocked video tracks + free audio + scores (video paste today shifts video + free
   audio; scores join). Landing inside a block on that lane snaps to its end (video rule). Right-click
   empty lane ground → `▣ paste here (this lane, no ripple)`, overlap-clamped like the video row.
3. **Q / W.** The block under the playhead: the selected block of any kind first, else the topmost
   visible video block. Audio item head: `inSec += (T − start)`, `startSec = T`; tail: `outSec −= (end − T)`.
   Score: `inSec` / `spanSec` the same way. Then everything at/after pulls left by the removed length
   (video via `clampShiftLeft`, free audio, scores), one commit.
4. **Nudge** `,` `.` (Shift ×5): the whole selection (§4.1), video via `carve`, audio via `landAudio`,
   scores hop if blocked. One commit.
5. **Marquee.** The box drawn on the video area today (`tracksRef`) grows to cover the lanes: one
   container spans rows + lanes for the mousedown/box, hit-testing adds audio items and scores by
   lane top/height. Dragging any selected block moves the group (video + audio + score keep their
   relative time; lane/track delta applied per kind, clamped to each rail). `Alt` = duplicate the
   group. Delete removes the group. `Esc` clears.
6. **A select forward.** Click any block: it + everything starting at/after it on every channel,
   video + audio + score. `V` / `Esc` cancels.
7. **Gap.** Click empty lane ground → the bounded gap on that lane (between neighbours, any kind).
   Delete closes it: everything after pulls left by the gap, all channels, clamped (`clampShiftLeft`
   for video, the lane walls for audio). Right-click empty lane ground: `paste here` · `close gap` ·
   `marker here` · `add lane / track` (the video gap menu, nouns swapped).
8. **Slip** (`Ctrl+Alt` drag body): audio item with a window smaller than its source: `inSec`/`outSec`
   move together, block stays. Score with `inSec` room: same. Drag right = later source (video rule).
9. **Rolling trim** (`Ctrl` on a flush edge): the neighbour on the same lane whose edge touches
   adjusts by the same delta, neither ripples. Audio + score.
10. **Ripple delete** menu row on audio + score: remove, then pull everything after left by its
    length, all channels, clamped. Plain `delete` stays.
11. **End trim ripples**: dragging an audio / score right edge shifts everything after the old end
    by the delta (all channels), `Alt` = leave the gap, rolling trims never ripple. Same as video.
12. **Alt drag** = duplicate (new id, `beatGrid` off on the copy, link dropped). Lands via `landAudio`.
13. **Ctrl drop** = insert: everything at/after the drop point shoves right by the block's length,
    all channels. No carve.
14. **Shift drag** = hold time: lane changes, start locked. (Snap bypass on moves goes away for audio,
    matching video; trims keep `Shift` = no snap, as video trims do.)
15. **⊘ disable** on audio + score: `disabled?: boolean` on both types. Silent in playback + export,
    ghosted at 35 % like a disabled video block, keeps its lane ground. Menu row, same wording.
16. **⚡ speed** on audio items: `speed?: number` (0.25–4), effective length `(out−in)/speed`,
    Monitor `AudioItemPlayer.playbackRate = speed`, export `atempoChain(speed)` (exists for video
    audio), all length math (`audioStartOf` callers, occ, export end) reads the effective length
    through one helper `audioEff(a)`. Scores: NO speed — SCORE-PLAN law "audio never time-stretches".
17. **Drop overwrite** (§3): move, Library drop, paste-here, duplicate, nudge all land through
    `landAudio`. Blue + scores = walls (hop). Free audio under the landing = carved.

Cheat sheet (`panels/CheatSheet.tsx`) rows updated to say "block" where they say "clip" and the
lanes row "audio lanes collide" rewritten: free audio overwrites free audio; blue + scores hop.

## 6. Types (shared/types.ts)

```
TimelineAudioItem  + disabled?: boolean  + speed?: number
TimelineScoreItem  + disabled?: boolean
store: tlClipboard: { kind: 'video' | 'audio' | 'score'; item } | null
store: marqueeSel ids of any kind (no type change, a Set<string>)
main: setTimelineAll(timelineId, items, audioItems | null, scoreItems | null, baseRev)  (one rev bump)
```

Export (`src/main/export.ts`): audio items honour `disabled` (skip) and `speed` (atempo, effective
length). Scores honour `disabled`. Monitor: same two reads.

## 7. Questions for him (one word each) — ANSWERED 2026-09-09: Q1 `tempo` · Q2 `hold` · Q3 `yes`

- **Q1 speed on audio**: `tempo` (ffmpeg atempo, pitch kept — what sped-up video audio already does
  in export) or `pitch` (chipmunk, playbackRate raw). Premiere default = pitch shifts, "Maintain
  Audio Pitch" off. Default if silent: `tempo`.
- **Q2 Shift on audio move**: `hold` (video rule, this spec) or `nosnap` (today). Default: `hold`.
- **Q3 marquee from lane ground**: today a drag on empty lane ground does nothing. This spec makes
  it start the box. `yes` / `no`. Default: yes.

## 8. Build order + proof

1. Reproduce §3 in his app (console line), record the cause. No code before this is seen.
2. Types + `setTimelineAll` (main + preload + env.d.ts + store). typecheck.
3. `selection()` + `landAudio()` + `audioEff()` helpers; old paths rerouted (move, drop, insert audio).
4. Tools 1–17, each one commit, each one walked in his app by him before the next lands
   ("scope small = do small", PROVEN / UNTESTED per item, no src/main edits mid-render).
5. Cheat sheet + What's New line. PUSH IT when he says so.

Untested until he walks it. Everything in §5 is the video behaviour read from the code today,
nouns swapped; nothing here is my design except `landAudio` as the single door (§4.2).
