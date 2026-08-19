# Score card — soundtrack production (build plan)

Restore point: git `6c4d1bc`. Planning session 2026-08-19. Work phase-by-phase; typecheck +
build gate after each phase. Schema fields land in the coordinated v18 bump (LOCAL-MODELS-PLAN).

BUILD ORDER (2026-08-19): codir sub-call plumbing (pre-step) → SCORE (this, first card) →
voices → local models → co-director fix → timeline fix.

## Core principle (decided 2026-08-19)
The clip grammar — plan → render → takes → keeper — applies to ALL generative cards. A Score
clip acts like a video clip but for music: lives in the Bin, drags onto the timeline, renders
land as takes, keeper star, take snapshots freeze the recipe, restore works.

## Locked scope
- Score clip in the Bin (new tile kind, folderable like clips/sheets).
- Score BEATS (same word as the rest of the app): timestamped musical directions —
  "00:00 start soft and spooky, 00:10 things get intense, 00:35 reach a crescendo."
- Beat editor card (the Score card) with render panel: engine picker, per-engine options from a
  registry, takes strip with keeper/color/disabled (same grammar as Clip Gen takes).
- Timeline: a score block stretches across a span; plays + exports mixed like music.
- Compose (stretched mode): a trigger — "compose" button in the beat editor AND right-click on
  the stretched block — reads everything under the span (the clips' beats, takes, references,
  cut rhythm, language/mood of the prompts; 10-20 clips, fast edits included), infers the
  emotional shape, writes suggested score beats for the span INTO THE BEAT EDITOR, editable
  before rendering. Runs on the Co-Director's parallel sub-call plumbing (CODIRECTOR-RLM-PLAN
  phase 0, the pre-step — built before this plan): per-clip digests concurrently, one
  synthesis pass writes the beats.
- Overwrite rule (app grammar): empty score = compose fills its beats in place, undoable. Score
  with existing beats = compose writes into a DUPLICATE score clip, original untouched.

## Engines (5 locked: 3 API on the fal key, 2 local)
API (all three re-verified first-hand on fal, 2026-08-19 audit):
1. MiniMax Music 3 (fal `minimax/music-3`) — PRIMARY. Complete pieces up to 5 min. OpenAPI read
   2026-08-19 (phase 3 build): prompt (music description) + lyrics (structure tags, one per
   line — THE BEATS EMIT THERE) + duration 1-300 + seed; 44.1kHz WAV out. There is NO
   is_instrumental wire field (the handoff had that wrong) — instrumental is said in the
   prompt + tag-only lyrics; the card's toggle shapes the emit.
2. Sonilo (fal) — video-to-music: analyzes pacing/motion/emotional arc of uploaded footage
   (up to 600s), licensed output (trained on rights-cleared catalogs incl. Shutterstock),
   delivered as a separate track. BONUS (confirmed 2026-08-19): stretched mode can upload the
   RENDERED timeline span to Sonilo instead of text-describing it — the export machinery
   (`export.ts`) already produces span renders, so compose gains a "render span + send to
   Sonilo" path next to the text path. Audit note: Sonilo also ships text-to-music on fal with
   SEGMENT-LEVEL style/mood controls — reads like a natural fit for score beats; check its
   schema at phase 6 before writing the emit layer.
3. Beatoven (fal `beatoven/music-generation`) — fallback. Text-to-music, background/cinematic
   focus, 44.1kHz WAV, negative prompting + seed.
Local (ride the LOCAL-MODELS-PLAN runtime; rows in the Models card):
4. ACE-Step 1.5 — PRIMARY. MIT license, beats Suno v5 on SongEval, <4GB VRAM standard tier
   (XL 4B: ≥12GB offloaded), ~10s/song on a 3090, ships its own REST API server (`acestep-api`)
   our runtime wraps. Its built-in LM planner stage maps ~1:1 onto score beats.
   (Verified 2026-08-19: github.com/ace-step/ACE-Step-1.5.)
5. MiniMax Music 3.0 — open weights, same family local and API. HF `MiniMaxAI/MiniMax-Music3`;
   8B global + 0.6B local LLM + Flow-VAE; 8GB VRAM min with layer streaming, 20-24GB
   comfortable; license: commercial with attribution, separate agreement past $20M revenue.
   (Verified 2026-08-19: minimax.io blog + HF.)

## Model decisions
- Audio-model capability registry `shared/audioModels.ts` mirrors `shared/models.ts`: per-engine
  descriptor (max duration, instrumental flag, dual-prompt, ref-video support, price, local
  runtime id) — the Score card renders its options FROM descriptors exactly like Clip Gen does.
- Beat directions EMIT as a structured section prompt per engine (the emit layer is the score
  sibling of `emitYaml.ts`). Caveat carried into the design: no model obeys exact timestamps
  reliably — beats are structure guidance, not sample-accurate cues; long scores may need
  stitched segments (flagged in UI, stitching is a later phase, not v1).
- Score renders land in `<project>/scores/` as audio files; takes carry durationSec + frozen
  recipe snapshot. Renders ride the existing queue/pending machinery (fal jobs recover after a
  crash exactly like video renders; local jobs ride the runtime queue).
- Timeline: new `Timeline.scoreItems` (v18): { id, scoreClipId, takeId?, startSec, spanSec,
  inSec?, outSec?, gain?, fadeInSec?, fadeOutSec?, muted? }. Span is the stretch; playback +
  export mix it like music (same amix path as export.ts's music mix, fades/gain honored). The
  single `music` item stays untouched — scores are additive. Span semantics (audit-pinned):
  audio never time-stretches — a take shorter than the span ends early (silence after), a
  longer take truncates at the span end; span is also the compose read-region.
- Schema v18 (coordinated in LOCAL-MODELS-PLAN): `Project.scoreClips`, `Timeline.scoreItems`.
  ScoreClip = { id, name, folder?, beats: ScoreBeat[], recipe (engine + per-engine options),
  takes: ScoreTake[], keeperTakeId? }; ScoreBeat = { id, at (sec), text }; ScoreTake mirrors
  Take with a frozen score recipe snapshot. Migration = stamp + defaults.

## Phases
- [~] 1. v18 score slices + mutators (create/rename/delete/duplicate score clip, set beats, set
        keeper) + Bin tile + folders. Gate: typecheck + build + migration test on a copy.
        CODE LANDED 2026-08-19: mutators in project.ts (delete strips timeline spans; duplicate
        copies beats+takes with fresh ids; beats sort by timestamp on write), score:* IPC +
        preload + store actions + delta merge (score/voice slices), ♪ Bin tiles with folders +
        multi-select + context menu (Foldered kind 'score'). Typecheck + build green. STILL
        OPEN: the migration open-test (app launch — batched with the other app-gated tests).
- [~] 2. Score card UI: beat editor (timestamp rows, add/drag/delete), engine picker + options
        from `audioModels.ts`, takes strip. Gate: recipe round-trips, takes grammar works.
        CODE LANDED 2026-08-19: `shared/audioModels.ts` (registry: 5 music engines, capability-
        driven options, local rows gated with reason) + `panels/ScoreCard.tsx` (docked editor,
        CharSheet debounce-save grammar: name, engine picker, per-descriptor options
        (duration/instrumental/style/negative), beat rows with mm:ss echo, takes strip with
        keeper star + audio playback, render button disabled-with-reason until phase 3) +
        panel wiring (dockview 'scorecard', opener, ♪ double-click + create-then-open).
        Typecheck + build green. STILL OPEN: live round-trip check at the batched app launch.
- [~] 3. Render path: fal engines (MiniMax Music 3, Beatoven) through the queue + pending
        recovery — audit note: `pending.ts` PendingReq is video-shaped; it grows a score
        variant so crashed score renders recover too. Emit layer per engine. Gate: real render
        lands as a take with snapshot; kill-app-mid-render recovers it.
        CODE LANDED 2026-08-19: `main/scoreRender.ts` (emit per verified wire schema, fal
        submit/track/download, fetchScoreResult recovery), `pending.ts` scores array,
        `addScoreTake` (snapshot frozen at submit), `score:render` IPC (media-write bracket,
        project-switch guard keeps the pending entry), resume loop lands recovered scores,
        queue integration (kind 'score': dispatch, provider, ETA key, cancel via the shared
        fal job map; SPEND SKIPPED on purpose — no honest rate yet, a $0 entry lies), Score
        card render button live (flushes edits first). Both wire schemas read off fal's
        OpenAPI 2026-08-19. Typecheck + build green. STILL OPEN: the LIVE render gate (money
        + app launch — batched) and the kill-mid-render recovery drill.
- [~] 4. Timeline score blocks: drag from Bin, stretch handles, playback mix, export mix
        (amix with gain/fades). Gate: export carries the score exactly as previewed.
        CODE LANDED 2026-08-19: score lane under the music lane (drop from Bin ♪ drag, block =
        move / right-edge span stretch / 🔊 mute / ✕ remove; renderless spans draw dashed +
        stay silent), `setTimelineScoreItems` CAS mutator + IPC + store, Monitor
        ScoreItemPlayer (global-clock sync, span-capped, gain/fades per tick), export amix
        entry (span-capped window, gain/fades, silent-skip for renderless spans). Score card
        render buttons rebuilt to the canon two-lane grammar (▶ now + ＋ queue) after the
        design-break catch. Typecheck + build green. STILL OPEN: live listen + export gate at
        the batched app test. Gain/fade EDITING has no UI yet (fields honored when set) —
        flagged honest.
- [~] 5. Compose: span read via Co-Director sub-calls, beat suggestions into the editor,
        overwrite rule (in-place when empty / duplicate when not), right-click trigger on the
        block. Gate: 15-clip span composes coherent beats; duplicate rule verified.
        CODE LANDED 2026-08-19: `main/scoreCompose.ts` (clips under the span chronological, one
        digest per shot in parallel on the cheap tier — a failed digest degrades to the clip
        name, never kills the compose — then one strict-JSON synthesis on the codir model;
        20-shot cap with an honest "+N more" line), `score:compose` IPC with the overwrite
        rule (duplicate gets "·composed" name + opens in the card), ✨ compose button in the
        card + "✨ compose from this span" in the block's right-click. ALSO LANDED: the score
        block's fades/gain via the same right-click cycling menu the audio-lane blocks use.
        Both engines (API key / bridge) resolve like Co-Director exchanges. Typecheck + build
        green. STILL OPEN: the live 15-clip gate at the batched app test.
- [ ] 6. Sonilo path: render span (export baker) → upload → video-to-music take. Gate: live
        Sonilo render from a real span.
- [ ] 7. Local engines through the runtime (after LOCAL-MODELS-PLAN phases land): ACE-Step 1.5
        row + MiniMax Music 3 row, render path via local queue. Gate: local take renders.
- [ ] 8. Full pass: typecheck, build, migration test, update this file, hand over.

## UX pass (2026-08-19, after the "poor quality UI" call — all landed, typecheck+build green)
Ten fixes from reviewing the built score UI against docs/WORKFLOW.md laws + Premiere mechanics:
beat BANDS on blocks (colored regions, the video-block system — replaced my off-canon ticks);
"what the engine gets" readout in the card (inspectability law — shared/emitScore.ts renders
byte-identical content for preview AND wire); restore-recipe from a take's right-click (plan-
reachable law); cheat-sheet entries (part of done); overlay ✕/🔊 buttons removed (one grammar —
selection+Del+menu; muted/gain show as quiet badges); snap on drag (playhead + block edges,
Shift off); left-edge head trim (music-lane grammar); fade wedges visible on the block; take
color/disable via the take card's right-click (v14 curation grammar, setScoreTakeMeta);
player drag-scrub. STANDING RULE going forward: every new surface is checked against the
WORKFLOW laws + Premiere mechanics BEFORE it's called done.

## LANE MERGE (2026-08-19, user call — "that is how Premiere handles it")
The dedicated score lane is GONE. Score blocks live ON the shared audio lanes with the green
(free) and blue (linked) blocks: `TimelineScoreItem.lane` (absent = 0), drop lands on the lane
under the cursor, vertical drag changes lane, lane mute/solo applies in playback AND export.
All score grammar survived the move (span stretch = render target, compose reads the span,
dashed no-take, hatched unrendered tail, beat bands, volume band). The separate lane had been
a build convenience dressed as design — the user called it, twice. Music lane merge = next
candidate once this proves out.

COLLISION LAW (same day, after the merge shipped WITHOUT it and a score sat on top of the
edit's audio in A1): one lane, one occupant. A shared registry (companions + detached audio +
scores) checks every placement — drops and moves hop to the first clear lane, a new lane grows
when all are full, trims/stretches stop at neighbors, and a one-shot nudge moves legacy
overlapping scores to clear ground. Muted blocks hide their blue companion (silent audio holds
no ground). Plus ♪ INSERT AUDIO (user feature): right-click a video block → a free COPY of its
audio window lands on the matching A-lane at the exact timecode, block mutes itself; the copy
is independent — J/L cuts, fades, bands.

## SONILO BUILT (2026-08-19, same session — restart to get it; first live render = the proof)
`sonilo/v1.1/video-to-music` (OpenAPI verified: video_url + prompt + prompt_influence 0-1;
output = AAC m4a). Flow: score:render sees videoToMusic → finds this score's span on the
active timeline → renders a 480p DRAFT proxy of that stretch (other scores stripped, fx
un-baked — pacing not look) via exportTimeline into <project>/.tmp → uploads through the
cached fal storage path → Sonilo returns music synced to the footage → lands as a take
(.m4a — score take files are no longer always wav; audioExtOf keeps the wire format's real
extension). Proxy deleted after. Card: prompt-influence slider replaces the target-length
field (the SPAN is the length), honest note updated. Compose gating fixed same hour: the
✨ chip greys WITH the reason when keyless+bridgeless (gated-controls law), and compose rides
the Co-Director's engine setting — bridge = subscription, api = key. QUEUED NEXT: Beatoven
first live proof (user fires it); stable-board card refactor (fields disable-with-reason
instead of vanishing on engine switch — the law, user-called); Models card for the two locals.

## Honest flags
- LIVE LESSON (first render, 2026-08-19): anything descriptive in MiniMax's `lyrics` field GETS
  SUNG — the first emit put beat directions there and the model performed them as vocals. Fixed
  same day: instrumental = lyrics is the supported `[instrumental]` tag alone; ALL direction
  (style + timed arrangement arc from the beats) lives in the prompt, brief-style. Emits into
  generative text fields get a live-render check before trusting the schema's one-line description.
- Timestamp obedience is approximate on every engine tested; the beat editor sells structure,
  not sync points. Hit-sync, if ever wanted, is the stitched-segments upgrade.
- Engine existence, caps and licensing verified first-hand 2026-08-19; exact wire params
  (slugs beyond those noted, field names, pricing) still need the OpenAPI read at build, like
  every fal engine.
- Local MiniMax Music 3 at full precision wants 20-24GB — the Models card's GPU recommendation
  handles it honestly (recommends, never restricts).
