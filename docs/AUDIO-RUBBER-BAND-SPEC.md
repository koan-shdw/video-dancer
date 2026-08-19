# AUDIO RUBBER BANDS — volume envelopes on timeline audio (2026-08-19)

> **STATUS: BUILT same day** (B1-B5 green; live shakedown pending). Build deltas from the
> approved text: (1) the video block's band lives on its BLUE LINKED COMPANION in the audio
> lanes, not over the thumbnails — that's where Premiere keeps a linked clip's audio keyframes,
> and it kept the video row clean (answers open Q3). (2) Expanded = the ONE editable mode;
> collapsed shows the read-only line (Q1: always visible = yes). (3) Top = 200% (Q2 = my pick).
> (4) FOLD RULE added: the first point folds the flat gain into itself (gain→1) so the display
> never jumps and points own the level from then on. (5) Score block double-click now toggles
> the volume view (user call) — the Score card moved to right-click + the Bin.

Premiere's clip volume line, in vi-dancer: every audio-bearing block gets a horizontal gain
line you can grab, with keyframe points and curves between them. Approved in principle
2026-08-19 ("bar that shows its volume … notes that let us change the volume … curve function");
THIS DOC is the build contract — no code before the user approves it.

## Scope: which blocks

| block | type | today | gets the band |
|---|---|---|---|
| free audio / music lanes | `TimelineAudioItem` (types.ts:337) | gain + fades | YES |
| ♪ score spans | `TimelineScoreItem` (types.ts:397) | gain + fades | YES |
| video blocks (linked audio) | `TimelineItem` (types.ts:311) | muted only — NO gain today | YES — band + it finally gains `gain` |

Track-level automation, dB scales, bezier handles, write/latch modes: OUT (v2 candidates).

## Data model (shared/types.ts — additive, no migration stamp needed)

```ts
export interface VolumePoint {
  id: string
  at: number        // seconds from the BLOCK'S TIMELINE START (post-trim placement time).
                    // Trims/moves don't rewrite points: the envelope rides the block as placed.
                    // Points past the block's current length are kept but inert (clamped on draw).
  gain: number      // 0..2 (1 = unity), the level AT this point
  curve?: 'linear' | 'smooth'  // shape INTO THE NEXT point. default 'linear'.
                    // 'smooth' = cosine ease: g(x) = a + (b-a)·(1−cos(πx))/2
}
```

- `volume?: VolumePoint[]` added to all three item types. Always kept sorted by `at`.
- `TimelineItem` additionally gains `gain?: number // 0..2, linked-audio level (1 = unity)`.
- Semantics — ONE multiply chain, all layers compose:
  `vol(t) = gain × env(t) × fadeIn(t) × fadeOut(t) × (muted ? 0 : 1)`
  - no points → `env(t) = 1` (today's behavior, untouched projects identical).
  - one point → flat `env = p.gain`.
  - before first / after last point → hold that point's gain (Premiere behavior).
- Laws check: envelope lives on timeline INSTANCES only — clips, takes, files untouched ✓.
  Edits go through the existing `setTimelineItems` / `timelineSetAudio` / `timelineSetScoreItems`
  rev-checked mutators — no new IPC ✓. Absent field = flat ✓.

## Shared sampler (new: shared/audioEnv.ts — ONE truth for preview and export)

```ts
export function envGainAt(points: VolumePoint[] | undefined, t: number): number
export function envToFfmpegExpr(points: VolumePoint[], baseGain: number, len: number): string
```

`envGainAt`: piecewise sample per the semantics above. Pure, unit-testable.
`envToFfmpegExpr`: the SAME curve as an ffmpeg `volume` expression over `t` (chain-local time —
the export chains asetpts to 0 at block start, so band time = filter time):
segment terms composed with `between(t,a,b)`, linear = `lerp`, smooth = the cosine formula,
edges = clamp/hold. Numbers fixed to 4 decimals. Multiplied by baseGain once, outside the sum.

## Band UI (new shared component: renderer/ui/VolumeBand.tsx, used by all three lanes)

Geometry: full-width overlay inside the block. Gain maps linearly to height:
bottom = 0 (silence), mid = 1.0 (unity), top = 2.0 (+6 dB). Line = 1.5px `var(--amber)`,
points = 7px dots (amber, white ring when grabbed).

Grammar (Premiere's, adapted to ours — one grammar app-wide):
- **hover** the block → the line brightens (it's always drawn, low-opacity, so mixes read at a
  glance; the score block's beat bands sit UNDER it at their current opacity).
- **drag the line** (no point under cursor): whole-block level — writes the item's `gain`,
  live tooltip `87%`. No points are created.
- **Ctrl+click the line**: add a point at that time/level.
- **drag a point**: move it in time and level (clamped to the block and 0..2), tooltip
  `120% · 3.2s`. Vertical-only with Shift held (Premiere's constrain).
- **right-click a point**: `delete point · linear ↔ smooth · reset band (clear all points)`.
- **double-click the line**: also adds a point (discoverable path; Ctrl+click is the canon one).
- Click-select / Del / block drag are UNCHANGED: the band only captures events on the line
  (±4px) and points; everywhere else the block behaves as today. Band edits stopPropagation.
- Blocks under ~14px tall (collapsed lanes) hide points but still draw the line, read-only.
- **Expanded lanes** (user call 2026-08-19: "double clicking on an audio track should expand it
  to show the ability to change volume"): double-click a free-audio block TOGGLES its lane
  expanded/collapsed (~72px expanded) — same toggle the music block already uses for its
  waveform view — and the band becomes fully point-editable while expanded. Music's existing expand keeps cycling wave/beats/both and
  ALSO shows the editable band in every expanded mode. Score blocks keep double-click = Score
  card (editor law); their lane gets the same expand affordance on the lane rail instead.
  Collapsed = line visible, whole-block drag works, points need the expanded view.
- Cheat sheet gains the four gestures + the expand gesture (part of done).

## Playback wiring (Monitor.tsx — the per-tick volume sites)

The three tick loops already computing `vol` each frame multiply in the envelope:
- `AudioItemPlayer` tick (Monitor.tsx:48-51): `vol = (a.gain ?? 1) * envGainAt(a.volume, tIn)`.
- `ScoreItemPlayer` tick (Monitor.tsx:107-110): same with `s.volume`, t = T − s.startSec.
- Video blocks: their `<video>` element today only gets `muted`. It ALSO gets per-tick
  `el.volume = clamp((it.gain ?? 1) * envGainAt(it.volume, T − startOf(it)))` — new, same loop
  that already tracks playback. (HTMLMediaElement.volume caps at 1.0; gains above unity are
  honest only in export — the tooltip shows the true value, the preview clamps. Known,
  documented, same as today's gain>1 behavior on audio items.)

## Export baking (main/export.ts — the three audio chain builders)

Each site currently emits `,volume=N` static (export.ts:562, :597) or nothing (video path
:488-491, which gains a volume stage):
- points present → `,volume='<envToFfmpegExpr(...)>':eval=frame` replaces the static term.
- no points → exactly today's output (static or omitted). Byte-identical filtergraphs for
  untouched projects = the no-regression proof.
- Fades stay as separate afade stages (they compose by multiplication, same as preview).

## Build plan (each stage typechecks + builds green before the next)

- **B1** types + `shared/audioEnv.ts` + sampler/expr unit coverage (pure fns, no harness).
- **B2** `VolumeBand.tsx` + mounting in the free-audio/music lane blocks, score blocks, video
  blocks; cheat sheet lines.
- **B3** Monitor per-tick envelope (3 sites).
- **B4** export expression baking (3 chain sites).
- **B5** WORKFLOW.md audio section note + SCORE-PLAN cross-reference; live shakedown with a
  real project (band on all four block kinds, preview vs export parity by ear).

## Open questions for approval

1. Line always visible at low opacity (my pick) vs only on hover?
2. Top of block = 200% (+6 dB, my pick) vs 100% (no boost, Premiere defaults to +6-range)?
3. Video-block band drawn over the thumbnail strip (my pick: yes, that's Premiere) vs only on
   an expanded audio sub-row (bigger build, v2)?
