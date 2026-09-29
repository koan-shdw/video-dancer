# Audio = video on the timeline: link, cut, copy, paste, paired tracks — spec 2026-09-23

Item 41 on `TODO-2026-09-22.md`. Status: BUILT 09-24 (build A-G below), typecheck clean, the shared carve proven by `scripts/test-lane-overwrite.cjs`; untested by him. Main side changed: restart the dev app.

## 1. His words

09-09: "the slice tool doesn't work for audio" · "neither does copy and paste for audio" · "if
it's still linked to video you can't drag the audio" · "a lot of abilities for the audio
channels are missing they should have the same as the video channels like premiere".

09-23 test: "dragging to tracks works · cut doesn't work · copy doesn't work · copy pasting a
video only pastes its video not its audio".

09-23, later: "if we drag a video into the timeline the audios will overlap, we can fix this by
having the audio cut each other out like video does, and also making sure that video and audio
share tracks, track 1 v and a, and if drag a new one in track 2 v it also appears in track 2a,
like premiere" · "unlinking audio only works if you move the audio, if you move the previously
linked video it also moves the audio" · "copy pasting the audio will paste the previous video"
· "copy pasting the video will not paste previous linked audio" · "score doesn't copy paste" ·
"cut doesn't work".

## 2. What the code does today (read 09-23)

Three kinds of sound on the lanes (`AudioItemLanes`, `Timeline.tsx` 1173):

- COMPANION: a video block's own embedded audio, drawn on lane = its video track (1221,
  clamped to the last lane). Not an item. Moves, trims and slices with the video by nature.
- LANE ITEM `TimelineAudioItem`: a detached take window or a ♫ Library file. `link` = it rides
  a video block (start = block start + offset); no `link` = free, absolute time.
- SCORE `TimelineScoreItem`: a ♪ span on the same lanes.

Cause of each finding:

- "unlink only works one way": `unlinkAudioFromItem` (`project.ts` 1606) makes the lane item
  WITH `link: {itemId, offset: 0}`, so the video still drags it. The lane item's own menu has
  a second "unlink — free the audio" step (1576). Two steps where Premiere has one.
- "copy doesn't work" on audio / score: Ctrl+C copies `selectedTlItemId` only (`App.tsx`
  527). Selecting a lane block clears that id, so nothing is copied and the clipboard keeps
  the last video. Ctrl+V then pastes that video = "copy pasting the audio pastes the
  previous video".
- "copy pasting the video will not paste its audio": `pasteTlClipboard` (`store.ts` 1043)
  copies the block with `muted: true` (set by unlink) and drops `audioDetachedId`; the lane
  item is never copied. Result: a silent block, no audio.
- "cut doesn't work": there is no Ctrl+X at all, and the razor (C / Ctrl+K) reaches video
  blocks only (`sliceAtTime` 2456, `sliceTimelineItem` `project.ts` 1768). Lane items and
  scores have no slice.
- "the audios overlap when a video is dragged in": a landed video carves the video track
  (`carve` 2112) but its companion carves nothing on the lane. Free audio and scores under it
  stay, so two sounds sit on one lane. Also: with more video tracks than lanes the companion
  clamps to the last lane and two companions share it.
- "V2 should give A2": companions already sit on lane = track; the lane count does not grow
  with the video tracks, so V4 lands on A3 (the clamp above).
- Score / audio drops and moves HOP to a free lane on collision (`freeLaneFor` 1238, 741)
  instead of overwriting. Audio ITEM moves already carve other audio items (1253) but hop off
  companions and scores.

## 3. The rule (his, 09-23)

Linked = one clip in two halves: it moves, copies, cuts, pastes, slices and deletes as one.
Unlinked = two clips, each alone, both ways. Score blocks copy, cut, paste and slice like any
audio. Every lane overwrites like a video track: a landing carves what is under it, never
stacks, never hops. Track n of video pairs with lane n of audio.

## 4. Build

### A. Paired tracks (V-n ↔ A-n)
- The companion lane is the video track, never clamped. One helper `ensureLanes(track)`: the
  lane count grows to track + 1 wherever a video lands on a track (bin drop `addAt`, a move or
  Alt-dup drop, a paste, "add video track"). Same 8 cap as today.
- Lane delete: a lane holding a companion counts as used (3217 today counts items and scores
  only).
- A linked lane item follows its video's TRACK STEP on a video move (V1→V2 takes A1→A2), same
  as the companion does by nature. Time already follows through `link`.

### B. Overwrite on the lanes
- One lane carve for everything on a lane: `carveLane(audioItems, scoreItems, landed)` = the
  existing `carveAudio` grammar (edge hit trims, middle hit splits, covered vanishes) applied
  to free audio items, linked audio items AND score spans. Scores trim by `spanSec` / `inSec`
  and split into two score items.
- Callers, all overwrite, none hop: a video landing (its companion is the landed span, on
  lane = track), an audio item drop from the Library, a score drop from the Bin, an audio
  item move, a score move, a paste (section E), an unlink (section C, the item lands where
  the companion was, so it carves nothing).
- One user action = one write: video + lanes go through `setTimelineAll` (exists,
  `store.ts` 1564) so Ctrl+Z is one step.
- The legacy score nudge (749) goes; it was the hop rule's helper.

### C. Unlink = free, one step
- `unlinkAudioFromItem`: the lane item is born FREE (no `link`), lane = the video's track,
  start = the video's start, same window. The video mutes as today. Because the companion sat
  exactly there, nothing overlaps and nothing hops.
- Companion menu: "unlink audio" (one entry). Toast: "audio unlinked · right-click it to link
  again".
- Lane item menu keeps "link — lock to the video block under it" (Premiere's Link) and
  "unlink" on a linked item (already there).

### D. Linked pair moves as one (lane items with `link`)
- Dragging the audio half drags the video block by the same time and the same track step;
  both carve where they land (video carve + lane carve, one write). Shift = keep time, change
  track (as the video drag has).
- Dragging the video half: time follows already; the track step follows (A above).
- Nudge (, .) and ripple moves already carry linked items through `link`.

### E. Clipboard: copy, cut, paste for every block
- `tlClipboard` becomes one of: `{kind:'video', item, audio?}` (audio = its linked lane
  item), `{kind:'audio', item}`, `{kind:'score', item}`.
- Ctrl+C: the selected block, whichever kind. A linked pair copies as a pair from either
  half (companion click already selects the video).
- Ctrl+X: Ctrl+C + delete, one write. A linked pair goes together.
- Ctrl+V:
  - every block: lands at the playhead on its own track / lane, OVERWRITE (carve). Ctrl+Shift+V
    = insert: everything after the playhead ripples right by the pasted length (Premiere).
  - video: plus its linked lane item pasted with the block, linked to the NEW block (same
    offset, lane = new track). A block whose audio was unlinked pastes alone and silent
    (Premiere: the audio was unlinked).
- Right-click a track gap "paste here": audio or score lands on the lane that pairs with the
  track, at that time, overwrite.
- Delete: a linked pair deletes together from either half (Premiere). Alt+Delete deletes the
  clicked half only.
- Score: `setTimelineScoreItems` for score pastes and cuts; `setTimelineAll` when a pair is
  involved.

### F. Razor on the lanes
- C-mode click and Ctrl+K reach lane blocks: a free audio item splits into two items at the
  cut (`inSec`/`outSec`, the right half starts at the cut), a score splits into two spans
  (`spanSec` and `inSec` carry the cut), both through main (`sliceTimelineAudio`,
  `sliceTimelineScore`, siblings of `sliceTimelineItem`).
- Slicing a video with a linked lane item slices the item at the same time; the right half
  links to the right video half. Companions cut with their video already.
- Ctrl+K on the lanes: the selected lane block wins when the playhead is inside it, else the
  lane block under the playhead on the selected block's paired lane.

### G. Selection
- Clicking either half of a linked pair selects the pair for copy, cut, delete and the
  razor. The companion does this today (1462); a linked lane item joins (its click selects
  the audio item AND marks its video as the pair).

## 5. Where it lands
- Renderer: `Timeline.tsx` (lanes, drops, carve, razor, menus), `App.tsx` (Ctrl+C/X/V,
  Delete), `store.ts` (clipboard, paste, cut).
- Main (dev app restart): `project.ts` unlink, two new slices, `index.ts` + preload +
  `env.d.ts` for the two slice wires.
- No format change: `link`, `audioDetachedId`, lanes and items keep their shapes. Old
  projects load as they are; a linked-by-old-unlink item stays linked until he unlinks it.

## 6. Picks (his, 09-23): all Premiere, never ask again
1. Delete on a linked pair removes both halves. YES.
2. Score blocks act exactly like audio. YES.
3. Paste = overwrite at the playhead; Ctrl+Shift+V = insert with ripple. Every block, video
   too (video's Ctrl+V used to ripple; Premiere's grammar wins).
4. Dragging a linked audio drags its video along. YES.
His rule for me: when Premiere already answers a mechanic, do it the Premiere way. Not a question.
