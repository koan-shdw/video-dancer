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
- **Linked audio** (blue) rides its video block; **free audio** (green) and **music** lanes are
  absolute-time. Mutations never delete media files.

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

## Timeline v2 specifics (v14)

*(v16/v17 NOTE, 2026-08-09: EFFECTS v2 adds per-block blend/opacity — real compositing on
overlap, which amends "topmost track wins / dissolve = only legal overlap" below — and ⟲ LOOP
TAIL adds projected repeats after a block. This section gets its full rewrite AFTER the live
shakedown proves the built behavior; until then `docs/LOOP_TAIL_SPEC.md` + the audit docs are
the reference for the new mechanics.)*

Absolute `startSec` + `track`, gaps allowed, topmost track wins, dissolve = only legal overlap.
Rows render top-down highest-track-first (drag UP = higher track). Linked audio tints
`--alink` (blue), free `--ok` (green), music `--music` (themeable). Beat bands window to the
trim [inSec, outSec] in SOURCE time (speed-safe). Export composites the same model
(fade-out-dip stands in for true xfade — monitor previews the real cross).
