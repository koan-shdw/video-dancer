# SPEED RAMPS (list 56), spec of 2026-10-01

His words (10-01), said of interpolation: "It also allows for slowmotion and slowmo ramping." The
list item: a block whose speed changes along its length, drawn on the timeline the Premiere way
(time remapping: the speed line on the block, with keyframes). His pick 10-01: "finish the
remaining todo".

## Premiere's mechanics (Adobe's own page, "Change clip speed and duration using Time Remapping",
updated 2026-01-21, read 10-01)

- Right-click the clip → Show Clip Keyframes → Time Remapping → Speed: a horizontal rubber band
  appears across the clip, and a speed-control track along its top.
- Drag the band up or down: the clip plays faster or slower; a tooltip shows the speed as a
  percentage of the original.
- Ctrl-click the band: a speed keyframe. Several keyframes make segments; drag the band between
  two keyframes to set that segment's speed.
- Smooth transitions: select a keyframe, drag the handles that appear: the speed changes
  gradually across them instead of at once.
- Move a keyframe: drag it left or right along the speed-control track. Delete: select it, Delete.
- Time remapping changes the clip's length ("ensure you have enough space in your sequence"): the
  clip grows into free room and stops at the next clip; it does not push the clips after it.
- It works on the video only: the clip's audio plays as it always did (Adobe: "vary the speed of
  the video portion of a clip").
- Speed / Duration and Time Remapping don't mix: a time-remapped clip's speed lives on its band.
- Remove: Remove Attributes → Time Remapping.

## In the app

The data: `TimelineItem.remap = { keys: [{ at, ramp? }], speeds: [] }`. Keys sit on the take's own
clock (source seconds), so trims, slices and moves keep them in place. `speeds[i]` is the speed
before key i; the last one after the last key. `ramp` = the width of the transition around a key
(the keyframe's two halves pulled apart), in source seconds. One math module
(`shared/remap.ts`) turns it into pieces of constant speed (a ramp = 12 small steps, eased) and
every reader walks those pieces: the block's length, the source second under the playhead, the
Monitor's playback rate, slices and carves, nests, and the export.

From his seat:
- Right-click a block → **time remapping ▸ speed**: the speed line appears on the block at its
  speed (100 % in the middle, up = faster, to 1000 %; down = slower, to 10 %), keyframe ticks on
  a strip along the block's top. Not on a nest, a storyboard block or a reversed block (greyed
  with the reason).
- **Drag the line** up or down: that segment's speed, a tooltip with the percentage; the block
  grows or shrinks as you drag. On release it stops at the next block on its track (the end is
  trimmed there, Premiere's rule); nothing after it moves.
- **Ctrl-click the line** (or click it with the Pen, P): a keyframe there; both sides keep the
  segment's speed until one is dragged.
- **Click a keyframe** on the strip: it is selected (amber) and shows its two handles; **drag a
  handle** outward = a ramp (the speed eases from one segment into the next across it); **drag
  the keyframe** = move it along the clip; **Delete** (or its right-click) = remove it, the two
  segments become one at the left one's speed.
- Right-click → **time remapping ▸ remove**: the block plays at one speed again (100 %).
- The block's label reads "remap" with its slowest and fastest speeds.
- The sound: unchanged, Premiere's way. The block's own audio plays at normal speed from its
  in-point and stops at the block's end or its out-point, whichever comes first. The Monitor
  and the export do the same.
- The Clip Speed / Duration dialog greys Speed, Duration and Reverse on a remapped block and says
  why; Time Interpolation still works there, and Optical Flow reads the slowest speed of the
  ramp (the slow part is what needs the frames ENHANCE makes).

## Proven how

`scripts/test-remap.cjs`: the math (lengths, source seconds, rates, ramps, edits, extrapolation
past the ends), slices and carves, the nest pieces; the export run on a real 1 s clip with
ffmpeg (the remapped block comes out the length the timeline says). A browser test drives the
real Timeline: the menu, the line, a keyframe, a drag, a ramp, delete, remove.
