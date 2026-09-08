# ASSEMBLY — the Co-Director's first cut (spec, 2026-09-09; built overnight under the mega GO)

Director's brief, his words (2026-09-08): turn the timeline editor into something more useful —
"1. add a monitor in there which lets us view the timeline · 2. add a button that says Assembly
Concept, this will review the codirector to get an idea of what the assembled shots should be;
it will then present what it understands the assembled shot should be in a text outline in the
assembly editor; under it there's a prompt field where the user can correct it, back and forth
until assemble is locked · 3. under assembly outline is assemble button: this then reads all the
clips and takes and finds the best takes from each clip, looks at the videos and then watches them
and makes the edit in the timeline; all the clips are cut into the timeline, maybe a tooltip over
the clip explains what part of the assembly they're reflecting · 4. then the user can take that
assembly and refine the edit." Then: "new one [timeline] — maybe we need an assembly window
instead of timeline one." The creator shelved his Cutroom ("hasn't made me anything that enhances the
workflow"); ours differs: we HAVE a timeline, so he proposes a rough cut you refine, never the edit.

## 1. Decisions taken alone overnight (correct in the morning)

- Its own panel, **Assembly** (Window menu, beside Clip Gen like Sheet Gen).
- The monitor on top is the program Monitor (the same component the Monitor panel runs, playing
  the ACTIVE timeline). Assemble makes the new timeline active, so the monitor shows the cut.
- The outline lives on the project: `Project.assembly { outline, locked, timelineId, log,
  updatedAt }` — additive, survives via the raw spread.
- Concept + assemble are main-process jobs (no chat needed): one strong-model call each (the
  Co-Director's model), progress on the render status line.
- Watch budget: the keeper + up to two other takes per shot (three watches per clip), so a
  ten-shot storyboard is ≤ 30 watches. Reports carry timestamps; the in/out come from them.
- A shot the outline needs but no clip has → the outline lists it under HOLES; assemble never
  fakes a cut around it.
- Tooltip = `TimelineItem.note` ("shot 3 · 'the strike' — take 2: the swing holds, 0.4–3.1s").

## 2. Flow

1. **Assembly Concept** — context = the storyboard (active timeline's clips in order with beats,
   takes, durations) + the brief + the last 40 Co-Director messages (compact) + the existing
   outline + the correction. Output = a markdown outline: numbered shots in story order (title,
   clip, what must be seen, target seconds, notes), then HOLES. Saved; the correction and the
   outline append to `assembly.log`.
2. **Correct** — the prompt box under the outline; each send re-runs concept with the correction.
3. **Lock** — a toggle; assemble is grey until locked (gated-controls law: grey WITH the reason).
4. **Assemble** — watch the takes (WATCH-LANE: Gemini, or stills without a key), one synthesis
   call → strict JSON placements `[{ shot, clipId, takeId, inSec, outSec, note }]` → a NEW
   timeline `assembly · <storyboard name> · <time>` with the items laid sequentially on track 0 →
   made active → `assembly.timelineId`. Re-assemble makes another timeline; nothing is overwritten.
5. **Refine** — the Timeline panel, as always. The Assembly panel's `open timeline` raises it.

## 3. Files

- types: `Project.assembly`, `ProjectDelta.assembly`, `TimelineItem.note`.
- main: `assembly.ts` (concept, assemble), `project.ts` `setAssembly`, IPC
  `assembly:concept · assembly:lock · assembly:assemble`; preload/env.d.ts.
- package: `panels/Assembly.tsx` (monitor · concept fold · correction · lock · assemble ·
  status), registered in `panels/index.ts` + App.tsx PANELS/PANEL_DEFS; Timeline block tooltip
  shows `note`.

## 4. Acceptance

1. Concept on a three-clip storyboard → an outline with three shots in story order and their
   clips named; a correction ("swap 2 and 3") → the outline changes.
2. Lock → assemble enabled; assemble → status shows "watching KATA T1…"; a new timeline
   appears with three blocks in outline order, trimmed; each block's tooltip names its shot.
3. No Google key → assemble still lands (stills), status says so.
4. A storyboard clip with no takes → listed under HOLES, no block placed for it.

Status: BUILT 2026-09-09, typecheck clean, UNTESTED in the app.
