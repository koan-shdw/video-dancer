# Compiled Prompt Read — full spec (2026-08-27)

Rejig Bucket 1, item 1 (CODIRECTOR-REJIG-BRIEF-2026-08-27.md; evidence FINDINGS §1).
Status: DRAFT for the director's approval. No code until approved AND restarts are cleared
(main-process changes restart the dev app).

## The problem

The Co-Director never sees the prompt that actually goes to the model. The compile lives
inside the RenderPanel component and the final wire prompt exists only for a moment at
submit. He works from raw fields and guesses at the assembled result.

## Current wiring (verified in code today)

- Emitters are pure, renderer-side: `buildYaml` / `buildNatural` / `buildProse` /
  `buildCombinedFor` / `applyRefTags` (src/renderer/src/emitYaml.ts).
- The cascade resolution lives as closures INSIDE RenderPanel (RenderPanel.tsx:242-330):
  promptLink freeform splice; per-field link stacks minus overrides (`liveStack`,
  `readSource`, `splice`); `resolveScene` / `resolveProduction`; character links
  (`resolveCharLink` — char sheets first, @ref resolved live from `imageId`, rename-proof;
  `spliceChar` with `replaced` keys).
- The wire prompt is built at submit (RenderPanel.tsx:1078-1099): `combined` in the active
  engine's flavor (`modelFor(engine).promptStyle`), then the outgoing-only ref-tag rewrite
  (`applyRefTags`) when the engine wants positional tags. Sent to main inside the render
  payload. Main cannot produce it.
- Everything the compile needs is in SAVED per-clip `PromptData` (src/shared/types.ts:266):
  engine, freeform, scene, characters, beats, production, duration, promptLink, fieldLinks,
  fieldOverrides, characterLinks. Auto-saved from the form with a 600ms debounce
  (RenderPanel.tsx:1057-1076).
- `src/shared/` already exists (types.ts, models.ts) and is imported by both processes.
- Both Co-Director engines (API loop codir.ts, bridge codirBridge.ts) run the same
  `runTool`; tool schemas live in `TOOLS` (codir.ts:128); tools read `getProject()` fresh
  at every call (codir.ts:730-737).

## Design

### 1. `src/shared/compile.ts` — the compile moves to shared code

- MOVE the pure emitters from emitYaml.ts: `q`/`snake`/`fmt`, `buildYaml`,
  `buildCombined`, `buildNatural`, `buildProse`, `buildCombinedFor`, `applyRefTags`,
  `lintFields`, `EMPTY_SCENE`, `EMPTY_PRODUCTION`. emitYaml.ts RE-EXPORTS them so every
  existing renderer import keeps working untouched. UI-only exports (BEAT_COLORS,
  beatRefFile, newBeat, newCharacter, beatRanges, MIN_BEAT) stay in emitYaml.ts.
- NEW pure resolver, ported line-for-line from the RenderPanel closures:
  `resolveEffective(project: Project, clip: Clip)` →
  `{ effectiveFreeform, effectiveStructured, linkedSources }`.
  Same semantics exactly: styles resolve before clip text, overridden sources skipped,
  dangling ids drop silently, char sheets before clips, `replaced` keys ignore the source.
  `linkedSources` = per-source attribution `{ id, name, kind: 'style'|'clip'|'sheet',
  chars }` for the size report.
- NEW `compileClip(project: Project, clip: Clip)` →
  ```
  {
    engine, promptStyle,            // modelFor(clip.promptData.engine)
    text,                           // buildCombinedFor(style, effFreeform, effStructured)
    parts: { freeform, scene, characters, beats, production, total },  // char counts
    linkedSources,                  // what the links contributed, per source
    refTagNote                      // set when the engine rewrites @titles on the wire
  }
  ```

### 2. RenderPanel rewires to the shared resolver

The duplicated closures (lines 242-330) are deleted; the panel calls `resolveEffective`
on its LIVE form state (it passes the form's promptData, not the saved clip — unsaved
edits keep previewing exactly as today). Output must be byte-identical; verified against
a real project before landing.

### 3. New read tool: `read_compiled_prompt`

- Schema in `TOOLS` (codir.ts): input `{ clip: string }` — clip name or id, fuzzy the
  same way other clip tools resolve names.
- `runTool` case: resolve project fresh, find clip, `compileClip`, return:
  header (clip name · engine label · flavor · duration), the size report (chars per part,
  per linked source, total), then the FULL text. Never truncated. Read-only: no delta, no
  live-write card, no go-gate (statute 1 gates writes; reads are statute 2's duty).
- Both engines get it for free: the API loop uses `TOOLS`+`runTool`; the bridge MCP
  (codirMcp.ts) serves the same tool list — verify it picks the new tool up, add if listed
  explicitly.
- Wire honesty: when `modelFor(engine).refTagPrompt` is set, the report's last line says
  "@titles are rewritten to positional tags on the wire; text order unchanged."

### 4. What this does NOT do

- No snapshot growth — the snapshot stays as is; the tool is on-demand (anti-rot).
- No UI change — the user already has the YAML preview panel.
- No preflight, no lint verdicts — that is item 3 and builds on this.
- No guide edit yet — the guide's reach list gains one line when Bucket 2 lands.

## Known limits (accepted, documented)

- The tool reads the SAVED clip; text typed in the last ~600ms of debounce may lag one
  beat behind the form. Fresh-state law reads disk; this IS disk.
- Take-frozen snapshots are not compiled by this tool — it compiles the LIVE recipe.

## Acceptance

1. For the same saved clip, `read_compiled_prompt` text === the RenderPanel preview
   (`combined`) on a YAML engine, a prose engine (LTX), and a natural engine (omniflash).
2. Link cases prove out: style stack order, overridden chip, dangling id, char sheet link
   with `replaced` override, promptLink before/after.
3. Part counts sum to total; linked-source chars match what the splice added.
4. Renderer behavior unchanged (preview, lint, wire prompt byte-identical).
5. Both Co-Director engines can call the tool and read the same result.

## Restart impact

One dev-app restart when the main-side tool lands. Renderer-only steps HMR. Nothing
lands until the director clears restarts.
