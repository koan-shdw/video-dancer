# Timeline round — handoff 2026-08-19 (chat died mid-round)

User's ordered list, verbatim intent. Work tree is CLEAN at `c9752eb`. Premiere is the answer
key for all of it (user law). One-line-always rail + waveforms(ffmpeg+canvas fix) are DONE.

## THE LIST (user's asks, in his words distilled)

1. SNAPPING — "audio doesn't snap; ALL things should snap to either a marker in the timeline
   or a clip when snapping is enabled." STATE: video drag uses applySnap (Timeline.tsx:1836,
   1950 — 12px tol, snapTargets = edges/playhead-gated/beats-gated/markers/range). Audio
   (AudioItemLanes onGesture 'move') + score (ScoreBlocks startDrag 'move') got snap code
   2026-08-19 (`b1446fc`, snapPts prop plumbed from TimelinePanel) BUT the user reports NO
   snapping on his drags, and two console probes in those handlers NEVER FIRED while video
   applySnap paths exist untested. UNRESOLVED: which component actually handles his drags.
   Next session: reproduce first (probe or read), then ONE shared magnet for every move/trim
   site, 12px, full target set. DO NOT re-theorize — the probes' silence says the dragged
   path is a different handler than assumed.
2. MARKERS, the Premiere set: M at playhead ALREADY WORKS (Timeline.tsx:2426). ADD: drag a
   marker (live exact timecode floating above while dragging), right-click menu = change
   color (marker color set), delete, delete all (rename exists at :3376). TimelineMarker type
   (shared/types.ts:458) needs `color?`.
3. RULER — "timecode too vague, should be exact like Premiere, not just every 10s": adaptive
   tick ladder by zoom (major labeled ticks every ~100px + minors between; exact mm:ss(:ff?)
   labels). Current: step ladder 0.5/1/5/10/30 at Timeline.tsx:2633 — too sparse when zoomed.
4. TIMELINE MONITOR gets the Clip Monitor's transport (same buttons, same grammar) — panels/
   Monitor.tsx vs SourceMonitor.tsx (the canon transport + jogger lives there; bible ch.03).
5. BOTH monitors: transport CENTERED (currently left).
6. BOTH monitors: LOOP button (clip loops clip; timeline loops timeline / in-out range —
   tlLoop + toggleLoop already exist for the timeline toolbar).
7. TIMELINE MONITOR shows the timecode readout like the Clip Monitor (mono current / total).

## Round context (already shipped this round, `b1446fc`..`c9752eb`)
- Waveforms: ffmpeg decode main-side (main/wave.ts; browser decodeAudioData truncates mp4);
  dB display (peakAmp in lib/waveform.ts); THE canvas bug — positioned <canvas> ignores inset
  and stays intrinsic 300×150 → every painter now has explicit CSS width/height. Hatch uses
  the same take resolve as export (pin ?? keeper ?? last).
- Rail: one-line rows always (V and A identical), uniform 18×14 chips, master mute in the
  toolbar, add via rail right-click, ✕ deletes last empty track/lane, audio locks enforced.
- Compose reads the style prompt as the governing brief.

## Standing user laws for this work (memory has the full set)
Premiere is the mechanics answer key · full-frame pass on every screenshot · user-reported
symptoms are ground truth, verify before theorizing · highest quality default · terse replies.
