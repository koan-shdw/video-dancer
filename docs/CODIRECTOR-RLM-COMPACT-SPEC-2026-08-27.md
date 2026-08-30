# Co-Director RLM mode + COMPACT — full spec (2026-08-27)

Rejig Bucket 1, items 11 + 12 (CODIRECTOR-REJIG-BRIEF-2026-08-27.md; origin FINDINGS §14, §19).
Director's dictated shape, 2026-08-27: an RLM switch in the Co-Director settings — on = RLM,
off = normal; a COMPACT button in the Co-Director header, next to DELETE, between the bin
and the brief. PURGE dropped (the bin covers it). Build verdict: in-app, no third-party repo.

Status: DRAFT for the director's approval. No code until approved. Main-process changes —
lands only when restarts are cleared.

## What exists already (verified in code)

- `CoDirState { log, brief, openQuestions, digests? }` persisted in the project
  (src/shared/types.ts:513-521). `digests` was reserved by the earlier RLM plan; nothing
  writes it yet. Its comment names `read_transcript_range` as the escape hatch — also
  unbuilt.
- Sub-call plumbing (RLM plan phase 0) is BUILT: `bridgeOneShot` (codirBridge.ts:162-166)
  + `subcall.ts` batch runner.
- API engine (codir.ts `codirSend`): every exchange sends the FULL `buildContext` snapshot
  + up to 40 log messages (LOG_HISTORY_CAP).
- Bridge engine (codirBridge.ts `codirBridgeSend`): same full snapshot pasted per message;
  already has Read/Glob/Grep over the project folder + the mcp__vidancer tools.
- `read_compiled_prompt` SHIPPED today — the pattern for read-only tools.
- Settings: `codirEngine`/`codirModel` in SettingsModal's CO-DIRECTOR section, stored via
  `window.vidancer.setSettings`.
- CoDirector.tsx header row: type-size buttons, bin/brief toggles, DELETE (clear-log) at
  CoDirector.tsx:184.

## Design — RLM mode

### The switch

New setting `codirRlm: boolean`, rendered in SettingsModal's CO-DIRECTOR section as the
app's standard toggle. OFF = today's full-pipe, untouched. Applies per exchange (flipping
mid-session just changes what the next message carries). Default ON (director,
2026-08-30).

### What a turn carries when ON

The giant snapshot paste is REPLACED by a small fixed core:

1. **The brief** (with its BUILD STATE line) + open questions — verbatim, they are small
   by law.
2. **The Bin index** — one line per object: kind, id, name, and for clips: engine,
   duration, take count, linked sheet/style ids. NO field text, NO beats. This is the map;
   the territory is fetched.
3. **The conversation tail** — every digest (see COMPACT) + the raw messages after the
   last digest, still capped at 40.
4. **One standing instruction block** (system side): "state lives on disk — read before
   you assert; the index is names, not content" + the tool habits.

Guides stay in the system prompt exactly as today (cached, unchanged).

### The read tools (both engines, read-only, no go-gate)

1. `read_object { id }` — any Bin citizen by id or exact name (clip / char sheet / style /
   timeline). Returns its FULL untruncated block: every field verbatim, beats with ids,
   refs, takes+trims, links. In RLM mode this replaces the snapshot's truncated views
   (fixes the 300/200-char cap for him — Bucket 1 item 8 — wherever he reads on demand).
2. `read_transcript_range { from_at, to_at }` — raw log slice by timestamp, the escape
   hatch the types comment promises. Digests name their range so he can drill in.
3. `read_compiled_prompt` — already shipped.

Tools resolve `getProject()` fresh at call (existing behavior) — RLM reads are always
current-disk. The rejig's item 9 (visible write log) stays its own item; it is UX for the
user, not a blocker here.

### Engines

- **Bridge**: core replaces the snapshot paste in both first-message and resumed-session
  variants. Read/Glob/Grep stay. mcp__vidancer serves the new tools automatically.
- **API**: same core; the new tools ride the existing TOOLS/runTool path.

Cost shape: turn cost = core + what he chooses to read. Turn 100 costs what turn 5 costs.
Per-lookup latency accepted (director, FINDINGS §14).

## Design — COMPACT

### The button

In the CoDirector.tsx header, between the bin toggle and the brief toggle, next to DELETE.
Label: `▣ compact` (hover: "fold the older conversation into the brief and a digest —
the raw log stays, undo reverts it"). One press, no confirm — it is an undoable project
write. Disabled while an exchange runs or when there is nothing to fold.

### What a press does

1. Folds every raw log message older than the last ~10 exchanges (the keep-tail) that is
   not already inside a digest range.
2. One sub-call on the CO-DIRECTOR'S OWN model — never the cheap tier; digesting the
   director's words is meaning-bearing work (highest-quality law) — with the folded span +
   the current brief. It returns:
   - **brief additions**: durable decisions found in the span that the brief lacks
     (appended via the normal brief write — undoable, and visible in the brief panel);
   - **one digest**: a short factual summary of the span — decisions, writes made, open
     threads — max ~150 words.
3. Writes `digests[] += { fromAt, toAt, text }`. The RAW LOG IS NEVER TOUCHED (types.ts
   contract; `read_transcript_range` reaches it forever).
4. The log view shows a fold line — "▣ folded to digest · n messages · [range]" — tail
   still readable as before.

After a compact, BOTH pipe modes send digests + tail instead of raw history (full-pipe
benefits too: the 40-message cap stops eating old decisions).

The Co-Director may SUGGEST a compact when the session runs long (one line, statute 15);
the press is the user's, always.

## What this does NOT do

- No stage-line field (item 10 — separate; BUILD STATE line in the brief serves it today).
- No write log UI (item 9 — separate item).
- No preflight (item 3).
- No purge button — dropped, the bin covers it.
- Full-pipe mode is byte-identical to today except digest-aware history.

## Acceptance

1. RLM ON: a turn's outgoing context contains core only (no clip field text); the model
   answers a clip question by calling read_object; token count per turn measured and
   reported for the same conversation in both modes.
2. RLM OFF: outgoing context identical to today (snapshot + history) until a digest
   exists.
3. read_object returns verbatim field text (no truncation) for a clip, a sheet, a style,
   a timeline; unknown id errors cleanly.
4. read_transcript_range returns the exact raw messages of a digest's range.
5. COMPACT: press folds, brief gains only durable facts, digest lands in project state,
   raw log unchanged on disk, undo reverts brief + digest together.
6. Long-session proof in the director's environment: token difference shown (step 7 of
   the agreed plan).

## Restart impact

Main + renderer changes: one dev-app restart when it lands.

## Settled

- RLM default for new installs: ON (director, 2026-08-30). Spec approved same day.
