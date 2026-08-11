# EDIT CARD (v2v) — FULL BUILD SPEC · 2026-08-11

> **SUPERSEDED same day by ONE-EDITOR-SPEC-2026-08-11.md** (user call: one editor, the tree;
> the Clip Edit panel dies, keeping = drag out of the tree). B1–B4 below were BUILT green —
> the shared widgets (JogBar/RefSuite), runV2vEngine, and recipe plumbing carry forward; the
> ClipEdit panel work is discarded by the merge. B5 folds into the new spec's C4.

The Clip Edit card gets the complete model fitout: the custom engine list, every option each
engine really supports, the full ref suite, the canon jog bar, recipe persistence, takes
polish, and regenerate-from-take. Nothing else changes. Lumetri is PARKED (see
EDIT-CARD-AND-LUMETRI-SPEC-2026-08-09.md).

Laws in force: store-everything (switching engines never loses inputs), parked-not-hidden
(grey with a reason, never vanish), cost honesty, one-widget-one-job, byte-safe recipes
(untouched fields stay absent). GO gates every build phase. B1 requires the dev app CLOSED
(shared/main/preload edit rule).

---

## 1 · CURRENT STATE (verified in code, 2026-08-11)

- `panels/ClipEdit.tsx` (407 lines) — Omni-only. Has: draft→fork on first Generate
  (`edit:createClip` at run(), `justBoundRef` rebind guard), takes stacking via queue watcher
  (`kind === 'edit'`), autosave (600ms, prompt + window only), plain window bar (`onBarDrag`),
  ResizeHandle preview, ⑂ edit-this-take chain, keeper dbl-click. Engine select renders only
  when `V2V_ENGINES.length > 1` — today it's 1, so no picker shows.
- `panels/VideoEditor.tsx` (907 lines) — the donor. Has everything the fitout needs, ALL
  INLINE: engine list `VEDIT_ENGINES` (line 27), `withCurrent` helper (30), output row
  (430–455), canon jog bar (178–260 + strip JSX 480–526), ref suite (541–807), validations
  `problems[]` (281–312), cost (277–279), re-gen payload branch (314–346).
- `main/index.ts` — `edit:createClip` (1639) hardcodes 720p/auto, ignores options.
  `edit:run` (1667) is Omni-only (`runEdit`). `vedit:run` (915) has the full engine branch:
  window cut → omni `runEdit` | seedance `resolveRefMedia` (1486) + `runRender`/`runHfRender`
  with source as `@video1`. Source-gone fallback to the recipe's pinned file: 1681–1691.
- `shared/types.ts` — `EditArgs` (596) thin. `VeditArgs` (517) full. `PromptData` (230)
  ALREADY has every field needed (engine, mode 'v2v', sourceVideo, imageIds, videoRefs,
  audioRefs, duration, resolution, aspectRatio, generateAudio). `Take.snapshot` (114) freezes
  the recipe per take. NO schema migration needed anywhere.

## 2 · ENGINE LIST

Rule (same as VideoEditor line 27): `!m.hidden && (m.v2v || m.maxRefVideos > 0)`.
ClipEdit's current `V2V_ENGINES` (v2v only) is REPLACED by this rule — rename to
`EDIT_ENGINES`, label options exactly like VideoEditor line 421:
`— true edit` when `m.v2v && m.maxRefVideos === 0`, else `— re-gen with refs`.

Today's list: Omni Flash (true edit) · Seedance 2 (re-gen) · Seedance 2.5 (re-gen).
Excluded automatically: ark pair (maxRefVideos 0), astria (no refs), sora2 (no video in),
hf (hidden). Registry unlocks appear with zero card edits.

`isEditMode = !!model.v2v && model.maxRefVideos === 0` — the mode flag every parked/grey
decision keys on (VideoEditor line 91 pattern). No seed control (no engine here takes one;
gen card has none either — parity).

## 3 · SHARED WIDGET EXTRACTION (B2 — the one refactor)

The jog bar and ref suite are inline in VideoEditor. ClipEdit needs both. Duplication is how
drift starts — extract ONCE, behavior-identical, then both panels consume:

### 3a · `ui/JogBar.tsx`
Props contract:
```ts
{
  videoRef: RefObject<HTMLVideoElement | null>  // the preview element (owner renders it)
  srcDur: number            // learned duration (0 = unknown)
  inS: number; outS: number
  setInS(v: number): void; setOutS(v: number): void
  minSpan: number; maxSpan: number
  label?: string            // center caption of the under-row ("node · name" / "source")
  windowNote?: string       // transport-row window suffix (" — sent as @video1")
  playing: boolean; muted: boolean
  onTogglePlay(): void; onToggleMute(): void
}
```
Renders: transport row (play/mute btns + window facts + `max Ns` warn + hint text),
imperative timecode line (`tcRef`), the strip (scrub-anywhere `onBarDown`, pointerEvents:none
window region, edge hot-zones `onEdgeDrag`, ↔ slide pill `onWindowDown`, imperative playhead
`phRef`), in/out under-row. Exposes `paintTime(t)` via `useImperativeHandle` — the owner's
`onTimeUpdate` calls it (loop-inside-window stays owner-side, it needs inS/outS anyway).
Lifted verbatim from VideoEditor 178–260 + 480–526. All clamp math unchanged.

### 3b · `ui/RefSuite.tsx`
Props contract:
```ts
{
  model: EngineModel        // caps: maxRefImages / maxRefVideos / maxRefAudios
  parked: boolean           // isEditMode → opacity .55 + title reason, nothing sent
  parkedReason: string
  sourceIsVideo1: boolean   // extra videos label from @video2, count vs maxRefVideos-1
  prompt: string            // for the @mention warn set
  imageRefIds: string[]; setImageRefIds(fn): void
  videoRefs: VideoRef[]; setVideoRefs(fn): void
  audioRefs: AudioRef[]; setAudioRefs(fn): void
}
```
Renders the three slot strips exactly as VideoEditor 541–807: drag-in (MIME_IMAGE /
MIME_VIDEO / MIME_TAKE / MIME_AUDIO), + add pickers, ✂ video window popover (15s clamp),
audio in/out fields (15s clamp), yellow not-@mentioned warns, deleted-ref reds. Internal
state (pickers, dragOver, trimSlot) moves inside the component. `vrefNameOf`/`vrefSecOf`
move here too and are EXPORTED — the validation block in each panel needs them.

**B2 acceptance: VideoEditor rewired to both widgets with zero behavior change** — same
DOM, same clamps, same titles. This is the regression-sensitive step; diff the JSX carefully.

## 4 · CARD LAYOUT (final, top → bottom)

1. name input / draft banner — unchanged.
2. source line — unchanged.
3. **setup row** (new): engine select (EDIT_ENGINES, mode labels) + mode note line
   (VideoEditor 426–428 text).
4. **output row** (new): duration · resolution · aspect selects via `withCurrent(model.*)`
   + generate-audio checkbox. `disabled={isEditMode}` + opacity .55 + title:
   "Omni controls its own output (720p 16:9, length = the window) — these apply to re-gen
   engines". Move `withCurrent` to `shared/models.ts` (both panels import it).
5. preview + ResizeHandle — unchanged (keep ClipEdit's resizable box; add mute btn state
   `pvMuted` + `focusAudio` claim like VideoEditor 147–176).
6. **JogBar** (replaces the plain window bar): minSpan/maxSpan per mode —
   `isEditMode ? caps.maxInSec ?? 10 : 15`, min `isEditMode ? max(0.25, caps.minInSec) : 2`.
   Engine-switch snap effect (VideoEditor 140–144): window shrinks to the new cap.
7. prompt — label/placeholder switch by mode (VideoEditor 530–538), promptHint when Omni.
8. **RefSuite** (new): parked while Omni, `sourceIsVideo1` always true here.
9. generate bar — ▶ Generate edit + cost + status + `problems[]` list under it.
10. takes row — chips + polish + ↻ regenerate (§8).

## 5 · STATE MODEL (ClipEdit additions)

Existing kept: engine, prompt, inS, outS, srcDur, status, viewTakeId, playing, previewH.
Added: `imageRefIds: string[]`, `extraVideoRefs: VideoRef[]`, `audioRefs: AudioRef[]`,
`duration = 'auto'`, `resolution = '720p'`, `aspect = 'auto'`, `genAudio = true`,
`pvMuted = true`. (Picker/drag/trim state lives inside RefSuite.)

## 6 · RECIPE PERSISTENCE (store-everything, restart-proof)

- **Load** (targetKey effect): from `bound.promptData` restore engine (`?? 'omniflash'`),
  imageRefIds (`imageIds`), extraVideoRefs (`videoRefs`), audioRefs, duration, resolution,
  aspect, genAudio — plus today's prompt/window/viewTake. Draft (no bound): defaults.
- **Autosave** (600ms debounce, extend the existing patch): engine, freeform, sourceVideo
  window, imageIds, videoRefs, audioRefs, duration, resolution, aspectRatio, generateAudio.
  Empty arrays save as `undefined` (byte-safe). skipSaveRef swallow unchanged; deps array
  grows to all saved fields.
- **Fork** (`edit:createClip`): request carries the full recipe so the clip is born complete
  — a crash between fork and render loses nothing re-runnable.

## 7 · IPC + MAIN (B1 — app closed)

### 7a · `shared/types.ts` — EditArgs grows the optional re-gen block (mirror VeditArgs):
```ts
export interface EditArgs {
  jobId?: string
  engine?: EngineId
  prompt: string
  clipId?: string
  name?: string
  source: { clipId: string; takeId: string; inSec?: number; outSec?: number }
  // re-gen engines only — the source rides as @video1, these join it:
  imageRefIds?: string[]
  videoRefs?: VideoRef[]
  audioRefs?: AudioRef[]
  duration?: string
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
}
```
`edit:createClip` request widens the same way (typed inline in index.ts + preload signature).

### 7b · `main/index.ts` — extract `runV2vEngine`, one engine branch for BOTH handlers:
```ts
async function runV2vEngine(e, req: {
  jobId?: string; engine: EngineId; prompt: string
  sendFile: string          // already window-cut
  cacheKey: string
  imageRefIds?, videoRefs?, audioRefs?, duration?, resolution?, aspectRatio?, generateAudio?
  outDir: string
}): Promise<{ file: string; durationSec?: number; refSummary?: string } | { error: string }>
```
Body = vedit:run lines 953–1008 lifted verbatim (omni → `runEdit` with cacheKey; seedance →
image resolve + `resolveRefMedia(proj, videoRefs, audioRefs, 2)` + provider key checks +
`runRender`/`runHfRender`, source first in `videos`). `vedit:run` rewires to call it
(refSummary keeps feeding the node). NO behavior change to vedit:run.

### 7c · `edit:run` rewrite:
keep: source resolution + pinned-file fallback (1675–1692), window cut + cache key
(1697–1707), project-switch guard, addTake tail. Replace the `runEdit` call with
`runV2vEngine` fed from the widened req. The addTake `promptData` now writes the FULL recipe:
engine, freeform, imageIds: req.imageRefIds, videoRefs, audioRefs, duration (actual rendered
`String(Math.round(durationSec))` stays), resolution: req.resolution ?? '720p', aspectRatio:
req.aspectRatio ?? 'auto', generateAudio: req.generateAudio ?? true, sourceVideo (unchanged).
→ every take's frozen `snapshot` is complete from day one.
Note: re-gen source window cap is 15s — validation is card-side; main trusts the card
(same trust model as vedit:run).

### 7d · `edit:createClip` rewrite: seed promptData from the widened request instead of the
hardcoded 720p/auto block. Preload: update the two signatures (pass-through, no logic).

## 8 · TAKES POLISH + ↻ REGENERATE

- Chip title gains provenance:
  `view take N · <engine label> · window a–bs (keeper/disabled…)` from `t.snapshot`
  (absent → today's text; pre-registry takes have no snapshot).
- **↻ regenerate** button beside the chips, enabled when a take is viewed and it has a
  snapshot: enqueue `kind: 'edit'` with payload built FROM `viewTake.snapshot` — engine,
  freeform, clipId: bound.id, source: {snapshot.sourceVideo.clipId/takeId/inSec/outSec},
  imageRefIds: snapshot.imageIds, videoRefs/audioRefs/duration/resolution/aspectRatio/
  generateAudio from snapshot. Title: "re-run this take's exact frozen recipe as a new take".
  Card state untouched (▶ Generate = current state; ↻ = frozen state). Source take gone →
  main's pinned-file fallback covers it.
- estCost for ↻ computed from snapshot fields with the §9 math.

## 9 · COST + VALIDATIONS (card-side, mirror VideoEditor exactly)

Cost (277–279): omni `span × (pricePerSecIn + pricePerSecOut)`; re-gen
`pricePerSec[resolution] × (duration === 'auto' ? max(4, round(span || 5)) : parseFloat)` —
`*` suffix on auto.

`problems[]` (281–312), source counts as @video1:
- `1 + extraVideoRefs.length > model.maxRefVideos`
- `imageRefIds.length > model.maxRefImages` · `audioRefs.length > model.maxRefAudios`
- span + extra-video seconds > 15.05 combined (skip while any natSec unknown)
- audio seconds > 15.05 combined (same skip)
- `1 + videos + images + audios > 12` files
- omni: `overMax` window only.
Generate blocks on problems[0] via toast; list renders under the bar. Missing-key errors
stay main-side (they return clean messages already).

## 10 · EDGE CASES (decided)

1. Engine switch mid-draft: inputs kept, window snaps to new cap, refs park (grey) on Omni.
2. Old edit clips (no refs in recipe): load as defaults — indistinguishable from untouched.
3. Source clip deleted: pinned-file re-roll works for BOTH modes (runV2vEngine gets the cut
   of the pinned file); "go to source" already hides.
4. Deleted ref mid-recipe (image/video/audio gone from Library): RefSuite shows red slot;
   main returns "an image ref is gone — re-pick it" (existing string).
5. Draft + re-gen engine + refs, first Generate: fork carries full recipe (§7d) BEFORE the
   queue job runs — crash-safe.
6. Two panels open on the same clip: last autosave wins (existing model, unchanged).
7. Queue watcher: unchanged — fresh take auto-views on the bound clip.
8. `duration 'auto'` sent to runRender: existing vedit semantics (engine picks; cost shows *).
9. Take with no snapshot (pre-v2): ↻ disabled with title "no frozen recipe on this take".
10. Window unknown (srcDur 0): sendWindow logic unchanged (line 198).
11. maxInSec truncation honesty (Omni >10s silently truncates): overMax already blocks.
12. Audio refs need ≥1 visual ref (fal rule): label text carries it (RefSuite, donor text).

## 11 · BUILD ORDER (each phase lands + typechecks + lints before the next; GO per phase)

| # | scope | files | gate | size |
|---|---|---|---|---|
| B1 | EditArgs + createClip req widen · runV2vEngine extraction · edit:run/createClip rewrite · preload sigs | shared/types.ts · main/index.ts · preload | **APP CLOSED** | ~180 moved/new |
| B2 | JogBar + RefSuite extraction · VideoEditor rewired, zero behavior change | ui/JogBar.tsx · ui/RefSuite.tsx · panels/VideoEditor.tsx · shared/models.ts (withCurrent) | renderer | ~420 moved |
| B3 | ClipEdit fitout: setup+output rows, JogBar, RefSuite, state, load/autosave, cost, problems, payload | panels/ClipEdit.tsx | renderer | ~260 |
| B4 | takes provenance tooltips + ↻ regenerate | panels/ClipEdit.tsx | renderer | ~60 |
| B5 | test sheet run + fixes | — | — | — |

## 12 · TEST SHEET (B5, live app)

1. Omni edit renders a take (regression).
2. Seedance 2 re-gen: source-as-@video1 + 1 image + 1 audio ref → take lands, refs audible/
   visible in result, snapshot holds the full recipe (inspect project JSON).
3. Seedance 2.5: duration auto + 480p → take; cost * shown.
4. Engine round-trip: type prompt + refs on Seedance → switch Omni (refs grey, output greys,
   window snaps 15→10) → back (everything returns).
5. Validations: each of the 6 rules triggerable → Generate blocked with the right message.
6. Restart mid-draft-bound: reopen → engine/options/refs restored.
7. ↻ regenerate on T1 after changing the card → result matches T1's recipe, card unchanged.
8. Delete source clip → re-roll from pinned file works (both modes).
9. ⑂ edit-this-take on an edit take → chain draft opens, window prefilled.
10. VideoEditor after B2: scrub/trim/slide/pickers/✂/audio windows — identical to before.
11. Take chip tooltips show engine + window on new takes; old takes unchanged.
12. Queue: two edits queued back-to-back on different engines both land + auto-view.

## OUT OF SCOPE (explicit)

Lumetri (parked doc) · seed control (no engine takes it here) · timeline auto-splice ·
VideoEditor tree features (bake/primary untouched beyond B2 rewiring) · cross-open buttons
between the two edit surfaces · Clip Gen panel handling of mode-v2v clips.
