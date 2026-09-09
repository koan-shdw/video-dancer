# AUDIO KEYFRAMES, PREMIERE GRAMMAR — spec 2026-09-09 (for his read; no code before GO)

## 0. His brief (his words)

"add ability to add noted to the audio and then fade them out with curves" · "no way to add poins
to the bands now?" · "make it work exact like premier in every way"

## 1. What exists (read 2026-09-09)

The v19 rubber band (docs/AUDIO-RUBBER-BAND-SPEC.md, built 2026-08-19) on every audio-bearing
block: free audio, music, ♪ scores, and a video block's linked companion.
- **Model**: `VolumePoint { id, at (block-local s), gain 0..2 (1 = unity), curve?: 'linear' |
  'smooth' }`; `smooth` = cosine ease into the next point. Level = `gain × env(t) × fades ×
  mute`. ONE sampler for playback and export: `shared/audioEnv.ts` (`envGainAt`,
  `envToFfmpegExpr`).
- **Band** (`ui/VolumeBand.tsx`, 205 lines): percent scale — bottom 0 %, middle 100 %, top
  200 %. Line always drawn; points edit only in the tall lane (double-click the block expands
  the lane to 64 px). Gestures: **Ctrl-click the line = add a point** (double-click the line
  too), drag a point (Shift = level only), drag the line with no points = whole-block level,
  right-click a point = `curve → smooth / linear · delete point · reset band`. Tooltip `87% ·
  3.2s`. No selection, no Delete key, no handles, no dB, no add-remove button.
- **Fades**: `fadeInSec / fadeOutSec` on audio + score items, LINEAR (`vol *= tIn / fadeIn`),
  set by a right-click row that cycles 0 → 0.5 → 1 → 1.5 → 2 s. Video blocks have no audio fade.
- Why he could not find it: nothing at rest says "add a point" (law 1), and the gesture needs
  the lane expanded first.

## 2. Premiere's grammar — the target (Adobe's timeline, clip keyframes, Volume › Level)

Everything below is Premiere's behaviour, item by item; where Adobe publishes no number I say
so in §7 and give the default I would use.

**2.1 The line** — clip volume in **dB**: 0 dB = unity, **+6 dB at the top**, −∞ at the
bottom. Dragging the line (no keyframe under the cursor) changes the whole clip's level; the
tooltip reads `+0.00 dB` / `-3.20 dB` / `-oo dB` (two decimals, signed). The 0 dB line is
marked faintly across the block.

**2.2 Add / remove** — **Ctrl-click** (⌘ on Mac) the line adds a keyframe at that time and
level. **Ctrl-click a keyframe removes it.** The lane header has the keyframe navigator
**`◁ ◇ ▷`**: ◇ adds a keyframe at the playhead (or removes the one under it), ◁ ▷ jump the
playhead to the previous / next keyframe on that lane. Selected keyframes go with **Delete**.

**2.3 Select** — click a keyframe selects it (lit); **Shift-click** adds to the selection;
drag on empty band space marquees. Click elsewhere clears.

**2.4 Move** — drag a keyframe in time and level. **Shift-drag locks one axis** (the one the
drag starts along). Drag the **segment between two keyframes** to move both keyframes' levels
together. Keyframes cannot pass each other in time (they stop at the neighbour).

**2.5 Interpolation** (right-click a keyframe): **Linear · Bezier · Auto Bezier · Continuous
Bezier · Hold · Ease In · Ease Out**, a check on the current one.
- Linear: straight in dB. Hold: the level stays until the next keyframe (a step).
- Ease In: the curve arrives flat INTO this keyframe. Ease Out: leaves it flat.
- Auto Bezier: smooth tangents computed from the neighbours (the curve passes through with no
  corner); handles show but move with the keyframe.
- Continuous Bezier: handles you drag, the two sides stay in one line.
- Bezier: handles you drag, the two sides independent (a corner is allowed).
- Handles show on the band for the selected keyframe when its type has them; dragging an Auto
  handle turns the keyframe Continuous; Alt-drag a Continuous handle breaks it into Bezier.
- Interpolation runs in **dB** (a straight line on the band is a straight line in dB).

**2.6 Fades = audio transitions** on the clip's edges: **Constant Power** (the default),
**Constant Gain**, **Exponential Fade**. **Ctrl+Shift+D** applies the default transition to the
selected block's free edges (both, unless one already has one). The transition draws as a
block on the edge; **drag its inner edge** to change its length; **double-click** it to type a
length; **right-click** it to pick the shape or remove it. Default length **1.00 s**.

**2.7 Everything traces the same curve** in playback and export.

## 3. From his seat

1. Double-click an audio block: the lane grows tall, the band shows the dB line with a faint
   0 dB mark. Hover the line: the cursor becomes the pen-plus, the tooltip says `ctrl-click =
   add keyframe · drag = clip level`.
2. Ctrl-click: a keyframe. Drag it; the tooltip reads `-3.20 dB · 2.4s`. Ctrl-click it again:
   gone. Click, Shift-click three more, press Delete: gone.
3. Right-click a keyframe → Ease Out. The line leaves it flat and dives. Right-click the next →
   Bezier: two handles appear; drag one, the curve bends. The Monitor plays exactly that.
4. Select the block, Ctrl+Shift+D: a 1 s Constant Power fade lands on each free edge. Drag the
   fade's inner edge to 2.5 s. Right-click it → Exponential Fade. Export carries the same fade.
5. The lane header shows `◁ ◇ ▷` while the lane is tall; ◇ drops a keyframe at the playhead on
   the block under it.

## 4. Model (shared/types.ts — additive; old points migrate on read)

```ts
export type KeyInterp = 'linear' | 'bezier' | 'auto' | 'continuous' | 'hold' | 'easeIn' | 'easeOut'
export interface VolumePoint {
  id: string
  at: number            // block-local seconds (unchanged)
  gain: number          // amplitude 0..2, unchanged on disk — dB is the DISPLAY (20·log10)
  interp?: KeyInterp    // default 'linear'; the old `curve: 'smooth'` reads as 'auto'
  // handles in SEGMENT space: x = fraction of the segment (0..1), y = dB offset from the
  // keyframe's level. `out` shapes the segment leaving this keyframe, `in` the one arriving.
  out?: { x: number; y: number }
  in?: { x: number; y: number }
}
export type FadeShape = 'power' | 'gain' | 'exp'   // Constant Power · Constant Gain · Exponential
// on TimelineAudioItem, TimelineScoreItem AND TimelineItem (video blocks gain audio fades):
fadeInSec?: number; fadeInShape?: FadeShape      // default 'power'
fadeOutSec?: number; fadeOutShape?: FadeShape
```

`curve` stays readable for one release (migration: `smooth` → `interp: 'auto'`, then dropped).

## 5. Math (shared/audioEnv.ts — the ONE truth, rewritten)

- dB lane: `db(g) = 20·log10(max(g, 1e-5))` (floor −100 dB = silence), `gain(db) = 10^(db/20)`.
- Between keyframes a → b, x ∈ [0,1], values in dB:
  - linear `v = va + (vb−va)·x` · hold `v = va`
  - cubic Bezier `P0 = (0, va)`, `P1 = a.out ?? (⅓, va + (vb−va)/3)`, `P2 = b.in ?? (⅔, va +
    2(vb−va)/3)`, `P3 = (1, vb)`; solve the x-cubic for t (monotonic, handles clamped to
    0..1 in x), take y.
  - easeOut at a = `P1 = (⅓, va)` (flat leaving); easeIn at b = `P2 = (⅔, vb)` (flat
    arriving); auto at a keyframe = tangent from its neighbours (Catmull-Rom, ⅓ reach,
    flat at the ends); continuous = the user's `out` mirrored into `in`; bezier = both as set.
- Before the first / after the last keyframe: hold (as today).
- **Flatten**: `flattenEnvelope(points, len, step = 0.02 s) → { at, db }[]` = the curve as
  straight dB segments every 20 ms (a straight segment stays one piece). **Playback samples
  the flattened list; export bakes the flattened list** as the volume expression (`gain(db)`
  per piece, `if(gte·lt)` terms as today). Identical by construction — no solver in ffmpeg.
- Fades (`fadeGain(shape, x)`, x = 0..1 into the fade; the same formulas ffmpeg's afade uses,
  so export can call afade by name): gain `x` (tri) · power `sin(x·π/2)` (qsin) · exp
  `10^(−2·(1−x))` (exp). Level = `gain × env(t) × fadeIn × fadeOut × mute` (unchanged chain).

## 6. Build

- **`ui/VolumeBand.tsx`** rewritten to §2: dB scale with the taper in §7.1, 0 dB mark,
  selection + Shift-click + marquee + Delete, Ctrl-click add/remove, axis-locked Shift-drag,
  segment drag, keyframe right-click menu with the seven types, handles for the selected
  keyframe, pen-plus cursor on the line, dB tooltips. Props gain `selected/onSelect` and a
  `playheadSec` for the navigator. One component, every lane (as today).
- **Timeline.tsx**: lane header `◁ ◇ ▷` on expanded lanes; Delete removes selected keyframes
  when any are selected, else the block (today's rule); fades become transition blocks on
  the edges (drag the inner edge, double-click = length prompt, right-click = shape / remove);
  Ctrl+Shift+D on a selected block; video blocks' companions carry the fade too. The old
  0.5 s-cycling rows go.
- **Monitor.tsx**: the three tick sites call `fadeGain(shape, x)` instead of the linear ramp;
  the envelope already multiplies in.
- **export.ts**: `afade` gains `:curve=tri|qsin|exp` per shape; the volume expression bakes
  the flattened envelope.
- **Cheat sheet + manual §9**: the keyframe grammar and the transitions.
- Migration in `migrate()`: `curve: 'smooth'` → `interp: 'auto'`; missing `fade*Shape` reads
  as `'power'` for NEW fades only — an existing fade keeps `'gain'` (linear) so old projects
  sound the same.

## 7. OPEN — what Adobe does not publish, with the default I would build

1. **The dB taper of the band**: Premiere's line is not linear in dB top to bottom. Default:
   +6 dB at the top, linear in dB down to −48 dB at 12 % height, then to −∞ at the floor.
2. **Exponential Fade's exact curve**: Adobe says "logarithmic"; default = ffmpeg `exp`
   (`10^(−2(1−x))`), the closest named curve, so preview and export share a name.
3. **Handle reach**: Auto Bezier handle length = ⅓ of the segment (After Effects' rule).
4. **Ctrl+Shift+D on a block whose edges touch other blocks**: Premiere makes a crossfade
   between the two clips. Here: a fade on each side, no crossfade (lanes stay one occupant per
   spot — his collision law). Fine?
5. **Marquee** over keyframes is Premiere's Pen tool; here the Selection gesture does it on
   the band (there is no tool switch). Fine?

## 8. Proof (untested until his ear and eye)

- Old project: bands look the same, sound the same, export byte-identical filtergraphs when
  no keyframe type or fade shape was touched.
- A keyframe of each type on one block: the band's curve, the Monitor's level per tick and
  the exported waveform match within 0.1 dB at 20 ms steps.
- Ctrl-click add, Ctrl-click remove, Shift-click + Delete, Shift-drag axis lock, segment drag,
  handle drag (auto → continuous, Alt → bezier), `◁ ◇ ▷` at the playhead.
- Fades: Ctrl+Shift+D lands 1 s Constant Power both sides; drag to 2.5 s; right-click →
  Exponential; export carries `afade … curve=exp`.

## 9. Built 2026-09-09 (his GO, §7 defaults)

Built as §2–§6 with every §7 default: taper +6 → −48 dB at 88 % → −∞; Exponential = ffmpeg `exp`; auto reach ⅓;
Ctrl+Shift+D = a fade per free edge, no crossfade; marquee = Shift-drag on empty band space (a plain drag still
moves the block). Math checked by script: dB midpoint, hold, eases, auto symmetry, bezier monotony, v19 smooth →
auto, flatten counts, the three fade values. Typecheck clean. UNTESTED in-app (his ear + eye). Public manual §9
+ cheat sheet: cheat sheet done, manual at the next PUSH IT.

## 10. His corrections after the build (2026-09-09, untested build — "nothign works")

1. "0 need to be center like premier": 0 dB sits in the MIDDLE of the block height. My §7.1 taper put it ~10 %
   from the top — a substitution, not Premiere. New taper: +6 dB top · 0 dB at 50 % · silence at the floor.
2. "double click shoudl snap it": double-clicking the line snaps the level to 0 dB (today it adds a keyframe).
3. Tools: Selection **V** and Pen **P** on the timeline (toolbar chip + keys). Pen: click the line adds a
   keyframe, drags keyframes; Selection keeps today's gestures. Ctrl-click a keyframe with the Pen = Linear ↔
   Auto Bezier (UNVERIFIED — check Adobe's docs first). No separate bezier tool exists in Premiere.
4. First step of the next chat: restart his dev app and walk the numbered steps; find which one fails BEFORE
   any code. Handoff in memory: vi-dancer-2026-09-09-audio-keyframes-handoff.
