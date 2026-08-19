# Co-Director rework — hierarchy of order + RLM context (build plan)

Restore point: git `6c4d1bc`. Planning session 2026-08-19 (remote), specced against the live code.
Work phase-by-phase; typecheck + build gate after each phase. Mark phases done here as they land.

BUILD ORDER (2026-08-19): sub-call plumbing (phase 0 below) ships FIRST, before everything.
Then score → voices → local models. THEN the rest of this plan (slot 4), then the timeline fix.
The rework beyond phase 0 is essentially UI/UX adjustment; the cards come first.

## The problem (diagnosed 2026-08-19, verified in code)
Clip fields (scene, production, characters) are the SAME slots that Project Styles and char
sheets inject at emit via fieldLinks/characterLinks (resolved in `RenderPanel.tsx`, which
splices linked sources before the clip's own text and feeds the result to `emitYaml.ts` —
audit-corrected 2026-08-19: the splice lives in RenderPanel, not emitYaml). The Co-Director
sees the links in its snapshot (`snapshotClip` prints
`links:` and `linked char:` lines) but still re-describes the style and the character inside the
clip's own fields — the emitted prompt carries the content twice. It must still be ALLOWED to
write those fields; what it writes there must be only the scene-specific delta.

## Locked scope
1. Hierarchy of order baked into behavior: (1) understand what the user wants → (2) understand
   what styles/sheets already fill for this clip → (3) write only the add/remove delta on top.
   Never double up.
2. Write shorter and more focused throughout (all fields, all replies).
3. Per-engine prompting practice in the guide system (Seedance 2/2.5 now; LTX 2.5 slot ready).
4. RLM-shaped context: project state leaves the prompt; typed read tools pull detail on demand;
   history folds into digests; stable root prompt for cache hits.

## Model decisions
- RLM implemented NATIVELY in `codir.ts` with the existing typed tool layer. NOT a Python REPL.
  Reference studied: PrimeIntellect-ai/prime-agent (MIT) — steal the architecture (root model +
  `rlm(...)` child calls + bounded self-refine), never its trusted-repo code execution. All writes
  stay on the existing guard-railed undoable mutators; no model-written code ever runs.
- ROOT INDEX replaces the full `buildContext` push. Today: selected clip at 4k-char caps + every
  clip at 140 chars + all styles/sheets/timelines/folders, re-sent every exchange. After: a small
  stable index (names, ids, counts, one-line summaries) + the brief + open questions. Detail is
  pulled via new READ tools:
    `read_clip(clip_id)` — the full snapshot (today's `snapshotClip(c, true)`)
    `read_style(style_id)` / `read_char_sheet(sheet_id)`
    `read_link_coverage(clip_id)` — THE HIERARCHY TOOL: resolves fieldLinks + characterLinks and
      returns exactly what text each linked source already supplies, field by field
    `read_timeline(timeline_id)` — items with takes/trims
    `read_transcript_range(from, to)` — older history beyond the live tail
    `read_render_settings(clip_id)` — engine caps from the registry for that clip's engine
- HISTORY: the 40-message raw cap is replaced by recursive digests — the brief mechanism
  generalized. Live tail stays raw (recent N messages); older spans fold into stored digest
  blocks (new `codir.digests` slice, schema v18, coordinated in LOCAL-MODELS-PLAN). Digesting
  runs as a sub-call on a cheap model at exchange end when the tail overflows.
- SUB-CALLS: each self-contained question (link coverage summary, digest folding, per-clip reads
  for compose-scale jobs) runs as its own request with a clean context window. API engine: nested
  Messages calls inside the loop, cheaper model (Haiku 4.5) where the task is mechanical,
  parallel where independent. Bridge engine: the CLI's own subagents/reads give this nearly free —
  the MCP server just exposes the same read tools. Parallel sub-reads also power the Score card's
  stretched-compose (SCORE-PLAN: 10-20 clips digested concurrently).
- CACHING: system block = guides only (already stable); the root index rides the user message
  tail exactly like today's context block. Read-tool results enter the loop as tool results, so
  the prefix stays byte-stable and cache-reads across rounds AND exchanges.
- Both engines keep parity: `runTool` gains the read tools; `TOOLS` (API) and `codirMcp.ts`
  (bridge) expose them identically.

## Behavior changes (codirector.md instructions)
- The hierarchy of order, verbatim, as the top working rule: goal → link coverage → delta only.
  Before writing scene/production/characters on a linked clip, call `read_link_coverage`; text a
  link already supplies is BANNED from the clip's own fields (say "covered by <style>" instead).
- Write short. Seedance 2 practice verified 2026-08-19 (fal.ai/learn + invideo + seedance.tv
  guides): best prompts average 50-70 words, 120-280 max; the first 20-30 words carry the most
  weight (subject + core action first); one clear motion beats stacked instructions; split
  control across modalities (text = world, images = identity, video refs = movement, audio =
  rhythm) instead of cramming prose. Supporting evidence from the studied voice-workflow video:
  its author repeatedly cut LLM prompt suggestions down ("not a fan of overprompting").
- Per-engine practice: guides get an engine-keyed section (Seedance YAML vs Gemini prose exists
  in code as `promptStyle` — the GUIDES now mirror it). LTX 2.5 arrives as an engine
  (LOCAL-MODELS-PLAN); it gets its own prompting block here when it lands. Fork-on-edit
  (`guides.ts`) untouched.

## Phases
- [~] 0. PRE-STEP — ships FIRST, before the Score build: sub-call plumbing. API-engine nested
        calls (model pick per task, parallel batches) + bridge parity, exposed as a callable
        service the cards can use (score compose is the first consumer). Gate: typecheck +
        build + a stretched-compose dry run. Revisited and tuned in phase 4.
        CODE LANDED 2026-08-19: `src/main/subcall.ts` (runSubCalls — parallel pool, per-task
        model pick, codir-grade retries/watchdog/abort) + `bridgeOneShot` in codirBridge.ts
        (clean-context one-shot CLI exchange, no tools, userData cwd). Typecheck + build green.
        STILL OPEN: the live dry run (needs the app + a key or the CLI).
- [ ] 1. Read tools: implement in `runTool` + `TOOLS` + `codirMcp.ts`; root index builder
        (`buildIndex` beside `buildContext`; old path stays behind a flag for A/B). Gate:
        typecheck + build; both engines answer a link-coverage question correctly.
- [ ] 2. Hierarchy + brevity rewrite of `codirector.md` (+ master guide trim); engine-keyed
        prompting sections; `read_link_coverage` wired into the instructions. Gate: double-describe
        repro case (style-linked clip) now writes only the delta.
- [ ] 3. History digests: v18 `codir.digests`, fold-at-overflow sub-call, `read_transcript_range`.
        Gate: 60+ message conversation keeps context; digest text visible in Director's Room.
- [ ] 4. Sub-call revisit: fold the phase-0 plumbing into the RLM loop proper (sub-reads and
        digest folding ride it), tune model picks + parallelism against real usage. Gate:
        typecheck + build.
- [ ] 5. Full pass: token-per-exchange measurement before/after on a real project, update this
        file, hand over.

## Honest flags
- Cache economics shift, not vanish: read-tool results are new input tokens each exchange. The
  win is paying for what the exchange actually touches instead of everything every time; the
  measurement in phase 5 is the acceptance test.
- Digests are lossy by design; `read_transcript_range` is the escape hatch (full log persists).
- Old projects keep working: no digests = plain tail, same as today, digests grow forward.
- prime-agent's `/refine` harness (evidence-backed supplemental prompts, immutable base,
  rollback) is a better version of learned-instructions — ours stays bounded (append + purge);
  an optional experimental engine borrowing more of prime-agent is a LATER, separate decision.
