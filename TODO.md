# Video Dancer — functionality roadmap / TODO

Status as of 2026-06-08. This is everything we designed vs. what's actually built.
We've built the **spine** (render → clip → bin → project). Most of the app is still ahead.

**Build order (chosen 2026-06-08):** 1) structured prompt + beats (#3, #2) → 2) timeline (#1) → 3) export (#9) → 4) image gen/edit Nano (#6) + thumbnails → 5) forks/lineage (#8), frame-grab (#7), polish → 6) **Claude brain (#4) + bible (#5) LAST** (manual authoring first; lint is rule-based so it works without Claude; zero Anthropic spend during the heavy build).

---

## ✅ Done
- [x] Electron + React + TS + Dockview scaffold; dark theme; native window
- [x] WebGPU device + render loop + WebCodecs spike (verified on hardware)
- [x] fal Seedance 2 render — **ref2v** (live-verified), **i2v** (coded, not yet tested)
- [x] BYO fal key (saved to local app-data)
- [x] Project folders: New / Open / save `project.json` (+ `images/`, `renders/`), relative paths
- [x] Render → clip in the Bin → persisted; reload via Open
- [x] Clip rename · library import · `@`-mention autocomplete · click-library-to-add (auto `@ref`) · takes row (re-roll) · media playback

---

## 1. Timeline — the heart (SLICE 1 DONE — single track + playback)
- [x] Single track of clip **instances** (multi-track later)
- [x] Drag clips from the Bin onto the timeline
- [x] Transport: play / ⏮ / ⏭ / **loop**
- [x] **Playhead** that moves during playback (smooth drag-scrub later)
- [x] Sequence playback across clips in the Monitor (program player)
- [ ] Trim clips (drag in/out points, non-destructive)
- [ ] Slice / razor a clip
- [ ] Copy clip; same clip placed multiple times (instances)
- [ ] Reorder / move clips (drag within track)
- [ ] Ruler + time readout
- [ ] **Hybrid timeline**: storyboard stills (unrendered) + video (rendered) side by side
- [ ] Clip states with badges: storyboard / fresh / **stale ⚠** (edited since render)
- [ ] **Colored beat bands** on each timeline clip (persist after render)

## 2. Beats — per-clip prompt-timer (NOT BUILT)
- [ ] Beats strip in the clip editor (add / delete / reorder)
- [ ] Per-beat fields: camera, action, lighting (+ optional dialogue / vfx / reaction / sfx)
- [ ] Beat edit dialog
- [ ] Beat durations → computed `start_end` timestamps
- [ ] Beat colors (match the timeline bands)

## 3. Structured prompt — the seedancer engine (NOT BUILT)
*(today we send a single plain prompt box; the real Seedance MD is missing)*
- [ ] Scene layer: title, **reference_handling**, style, visual_feel, duration
- [ ] characters[]: name, base, features, physics + reference_label (`@img`)
- [ ] production_notes: audio_design, lighting, subtext, critical_constraint, **avoid**
- [ ] cinematic_storyboard assembled from the beats
- [ ] Assemble all layers → the YAML/MD sent to fal (`emit_yaml`)
- [ ] Lint (free, always-on): camera ≤20w · reference_handling present · banned words · lengths = duration · **every attached image is also `@referenced`**

## 4. Claude prompt brain (NOT BUILT)
- [ ] BYO Anthropic key + model picker
- [ ] Master-fill: rough intent → full structured prompt
- [ ] Per-field enhance (✨)
- [ ] craft MD rules as a cached system prompt
- [ ] Claude assigns `@labels` + writes anti-drift reference_handling
- [ ] 3 heights: field / clip / project

## 5. Project bible + knowledge tiers (NOT BUILT)
- [ ] App MD (global craft rules, seeded from the craft notes; **restore last-known-good**; **disable for sanity test**)
- [ ] Project bible (characters / world / style / continuity; grows as you work)
- [ ] Feed only the relevant slice into each clip's prompt
- [ ] Human-review of bible changes

## 6. Image generation + editing — Nano Banana / Astria (NOT BUILT)
- [ ] BYO Astria key
- [ ] Generate images from a prompt (Nano Banana)
- [ ] Edit an image with Nano (prompt + multi-reference)
- [ ] Image editor window
- [ ] **Thumbnails everywhere** (library, bin, slots) — show real images, not just `@title` text
- [ ] User-renameable `@titles` (e.g. `@kali`)
- [ ] Image lineage (generated / edited / plucked tree + provenance)

## 7. Frame-grab + continuity (NOT BUILT)
- [ ] Scrub a render + **pluck a frame** → into the library (auto `@title`)
- [ ] **Continue-clip**: last frame of clip N → start frame of clip N+1
- [ ] Continuity links across clips

## 8. Versioning — forks / lineage (PARTIAL)
- [x] Takes (re-roll, stacked, click to play)
- [ ] **Fork on edit** → new clip (variant) + parent pointer *(today: editing just adds a take + overwrites prompt data)*
- [ ] "Go to parent" lineage navigation
- [ ] Set-keeper ★ UI (today keeper = latest take)
- [ ] Bin **sub-bins** (Premiere-style folders)
- [ ] Bin details panel (prompt / model on mouse-select)
- [ ] Delete / duplicate clip · delete take · delete image

## 9. Export (NOT BUILT)
- [ ] ffmpeg stitch timeline → one mp4
- [ ] Per-clip export
- [ ] WebGPU compositor → offscreen frames → ffmpeg (so shaders/transitions survive)
- [ ] **Transitions** between clips

## 10. Monitor / preview (PARTIAL)
- [x] WebGPU canvas + WebCodecs spike
- [ ] Wire the Monitor to play the **selected clip / timeline** (today playback is in the Render panel)
- [ ] Real WebCodecs frame-accurate scrub
- [ ] Overlay toggle (prompt / refs / keyframes over the rendered video)

## 11. Window system / shell (PARTIAL)
- [x] Dockable panels (Dockview)
- [ ] Verify float / pop-out + re-dock
- [ ] Saveable workspaces
- [ ] Dedicated **clip editor** surface (beats + structured fields) — distinct from the current Render panel
- [ ] Real **Settings** panel (3 keys, model, default project folder, MD doc paths)

## 12. i2v + keyframes (PARTIAL)
- [ ] Live-test the i2v (start / end frame) render path
- [ ] Explicit **start / end keyframe slots** (vs today's images[0]/[1] convention)
- [ ] Keyframe-vs-reference role UI

## 13. Misc / polish
- [ ] Cost estimate per render (~$0.30/sec)
- [ ] Render queue (multiple / concurrent)
- [ ] Better error surfacing / retry
- [ ] Project rename
- [ ] (web-later, parked) export XML / AAF / EDL → finish in Premiere
