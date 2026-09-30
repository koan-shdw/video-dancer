# vi-dancer — what this app IS (read before touching UX)

*Written 2026-07-26 after a timeline session where "Premiere thinking" nearly deleted the beat
colors. Companion law doc: `workflow-audit-2026-07-18.md` (placement principles).*

## The one-liner

vi-dancer is **storyboard-first filmmaking**. The user WRITES the movie as structured plans
(beats, characters, refs), GENERATES video on top of those plans, and edits the results in
place. It is not a footage editor with AI bolted on: the source of truth is the **plan**, and
footage is a regenerable projection of it. Premiere conventions apply to mechanics (tracks,
trims, snapping) — never to meaning.

## The objects

- **Clip** = a planned scene. Prompt fields (scene/style), characters, **beats**, refs, and its
  rendered **takes**. A clip with zero takes is still a full citizen — it plays as its
  storyboard.
- **Beat** = one storyboard shot inside a clip: name/camera/action/lighting + length + optional
  ref image (placeholder graphic, sent as a general ref, NOT prompt text). Beats become the
  `cinematic_storyboard:` YAML block the model receives. **Beats ARE the movie.**
- **Take** = one immutable render + its FROZEN recipe (`snapshot`). Takes never overwrite the
  live plan; dragging a take onto fields restores its recipe. Keeper ★ = current best;
  color/disabled are curation marks (disabled = skipped by auto-keeper fallback).
- **S-B** = the live storyboard/recipe view. Always one click away from any take view — the
  user must always be able to get back to the plan.
- **Char sheet** = a universal character (image + description) referenced across clips, so
  identity doesn't live trapped inside one clip.
- **Timeline item** = an INSTANCE of a clip at an absolute time/track: picks a take (or S-B),
  carries trims/speed/dissolve/mute. Deleting instances never deletes clips or takes.
- **Timeline audio** lives on the shared A-lanes, absolute-time: **linked companions** (blue)
  ride their video block, **clip audio** (green), **Library file audio** (teal ♫, absorbed the
  old music lane), **score spans** (purple ♪). One lane, one occupant. Mutations never delete
  media files.

## The loop

storyboard (beats + refs, Co-Director helps write) → render (queue, fal) → review takes
(cards: keeper/color/disable, v2v edit forks) → place on timeline → watch in context → refine
(swap take, trim/slice, re-render, edit with AI) → export. Every stage can bounce back to the
storyboard; nothing is one-way.

## Laws the timeline (and every panel) must obey

1. **Beats stay visible wherever a clip is shown** — colored bands on blocks, strips in
   monitors. They are the cut-structure indicator, not decoration. Never hide or "clean up".
2. **The plan is always reachable**: S-B in every take picker; storyboard blocks play beat
   images; a clip with no takes previews its plan.
3. **Renders are immutable, recipes are live.** Nothing a panel does may mutate a take's file
   or snapshot; nothing may silently overwrite the live recipe with a frozen one.
4. Placement law (from workflow-audit): every action on an object is on its right-click; every
   panel reachable from Window; gated controls disable with a reason, never vanish; one
   grammar app-wide (click = select · double-click = open editor · right-click = actions ·
   drag = move); the cheat sheet is part of done.
5. **What the model sees is inspectable** — freeform on top, YAML underneath, refs listed.
   Never send hidden context.

## Timeline mechanics — live in the system specs

The v14 section that lived here predated schema v20 and taught a dead audio model (the
music lane is gone). Mechanics stay true in the specs that own them:

- ALL timeline audio: `docs/TIMELINE-AUDIO-SPEC.md` (one lane system — blue companions /
  green clip audio / teal file items / purple score spans, collision law, beat grid) +
  `docs/archive/AUDIO-RUBBER-BAND-SPEC.md` (volume envelopes).
- Loop tails: `docs/archive/LOOP_TAIL_SPEC.md` (as amended by TIMELINE-AUDIO).
- Transport, ruler, markers, ONE MAGNET snap: `docs/archive/TIMELINE-ROUND-2-SPEC-2026-08-19.md`.

The laws above this line are the constant; the specs carry the moving parts.
