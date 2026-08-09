# VI-DANCER FULL AUDIT — 2026-08-09

*Eight parallel specialist audits over the entire app at v0.8.0 + uncommitted EFFECTS v2 / LOOP TAIL v17 work.
Read-only. ~142 findings: 2 CRIT, 16 HIGH. Companion: `FIX-PLAN-2026-08-09.md` (the approved
35-item fix spec). Prior audits: 2026-06-13 full, 2026-06-12 UX, 2026-07-18 workflow.*

**Format per finding:** `[SEVERITY] [EFFORT S/M/L] file:line — issue — fix.`

---

## EXECUTIVE VERDICT

The fear this audit was commissioned under — per-feature AI sessions degrading the whole — is
mostly NOT what the evidence shows. All eight auditors independently found the same signature:
one provider contract, one theme contract, one delta-merge protocol, one shared ripple clamp,
atomic serialized saves, spec-before-code discipline, and a storyboard-first law that even the
uncommitted work obeys. Typecheck: **0 errors under strict mode including all uncommitted work.**

The real debt clusters in four places: the **money edges** (paid renders straddling project
switches and fragile recovery), **silence on failure** (saves, exports, polls fail invisibly),
**packaging** (installer ships source + 250MB dead weight), and the **paper** (README, tour,
canon docs teach a previous app).

## LAYER SCOREBOARD

| Layer | Health | Worst finding |
|---|---|---|
| Persistence/saves | Strong | Save failures invisible to user |
| Electron/security | Good design, unfinished checklist | Renderer reads all decrypted keys |
| State/async | Disciplined | Paid renders can fire into wrong project |
| Timeline/monitors | Core math sound | Stale keyboard closure; dissolve glitch |
| Providers/Co-Director | Best layer | Recovery ledger self-destructs on transient errors |
| Effects v2 | Monitor path proven live; export path unbuilt | Export silently drops all effects (CRIT) |
| Build/deps | Clean types, packaging crisis | Installer ships src/ + 250MB junk (CRIT) |
| UX/docs | App honest, paper lying | README + tour teach dead keybindings |

## MACRO THEMES

1. **Money boundary weakest seam** — queue unstamped across project switch; recovery ledger
   deleted on transient errors; resume gated on wrong keys; double-click double-render; queue
   lost on quit; spend under-reported on refused takes.
2. **Failure is silent where it must be loud** — saves, truncated exports, one-bad-poll render
   loss, CAS-rejected fx edits.
3. **fx v2 remaining shakedown risks: 5 known** (see SHAKEDOWN below); three are tiny fixes.
   Monitor basics were already user-proven live at dawn; the untested parts are loop tail v17,
   the rebuilt soft mask, and export (docs/TEST-SHEET-2026-08-09.md).
4. **Packaging broken now, platform aging** — no files filter; Electron 31 ~18mo past EOL;
   unsandboxed renderer, no CSP, no popup handler, keys cross IPC wholesale.
5. **Paper lies, app doesn't** — README/tour/cheat-sheet/WORKFLOW.md/manuals/TODO.md all lag.
6. **Prior-audit debt shrinking, one regression** — 8 of the 2026-07-18 items open; context-menu
   convergence went backwards (4 bespoke copies). Cloud-synced project dirs (OneDrive Desktop is
   the Windows 11 DEFAULT) amplify theme 2 for many users, not just this machine.

## FIX ROADMAP (tiers)

- **T0 before shakedown:** mask premultiply; isContextLost check; packaged wasmPaths; export
  baker (or hard-block fx export); builder files filter + prune public/.
- **T1 money:** project-stamp queue + codir guard; keep recovery entries on transient errors;
  fix resume key gate; poll deadlines; double-fire guard; save-failure toast.
- **T2 platform:** popup/navigation handlers; masked settings:get; sandbox+CSP; single-instance
  lock; staged Electron upgrade.
- **T3 correctness:** stale keyboard closure; dissolve handover; one-undo ripples; lock holes;
  snap-fracs rewire; closeGap clamp; id-addressed trims.
- **T4 teaching:** README keys; tour; cheat sheet loop; WORKFLOW v16/17; 4-supplier onboarding;
  retire TODO.md; v0.7–0.8 manual addendum.
- **T5 debt:** context-menu convergence; videos/ sweep; temp pruning; dead spike deletion;
  dockview/vite upgrades; tsconfig split; noUncheckedIndexedAccess.

## SHAKEDOWN — remaining first-run risks (fx v2; monitor basics already user-proven live)

1. First AI pass looks hung: ~1min engine boot + single-thread fp32 inference, minutes per take.
2. Soft-mask halo risk persists at the premult seam (combine vs mask alpha) — dawn's 17-tap
   AUX-space rebuild fixed the value-domain jank; this is the remaining math seam. Judge
   visually per TEST-SHEET.
3. Export of an fx timeline comes out clean with zero effects (baker never built).
4. Mask/depth effects no-op for the first seconds until sidecar videos decode ("pops in late").
5. One GL hiccup freezes fx silently or burns the 3-strike latch in one incident.

---

# LAYER 1 — PERSISTENCE + EXPORT (project.ts, export.ts, pending.ts)

**VERDICT:** Genuinely well-engineered core. Atomic saves (tmp→rename) strictly serialized with
enqueue-time snapshots; save-on-every-mutation ≈ continuous autosave; real schema versioning
(v17, per-version migration ledger, defensive defaults); paranoid cleanup sweep (dry-run,
in-flight guard, history+checkpoint protection, never-widen-on-error). Corrupting project.json
in normal operation is close to impossible. Weaknesses are at the edges, not the design.

**GOOD:** atomic serialized saves (project.ts:219-248) reused for spend/pending/rename ·
80-snapshot undo + named checkpoints, restore routes through normal save · portable projects
(relative paths, media copied in, ids re-minted on cross-project import) · fail-safe cleanup
sweep (project.ts:528-594) · pending-renders.json crash recovery for paid renders · ffmpeg
always spawn+argv (no shell, no injection), out_time_ms µs correct, stderr tails surfaced.

1. [HIGH] [S] project.ts:245 — saveProject failures swallowed (catch→console.error, promise
   resolves ok); disk-full/permissions/cloud-lock = hours of silent data loss — surface
   persistent save failure to renderer (event + toast).
2. [MED] [M] project.ts:187-204 — migrate() rebuilds from known-key whitelist + restamps
   schemaVersion; opening a NEWER-version file drops unknown fields, first save destroys them;
   upgrades rewrite in place with no backup — spread ...raw; write project.json.bak when
   fileVersion ≠ SCHEMA_VERSION.
3. [MED] [S] project.ts:567 — cleanup sweep never visits videos/ or videos/edits/; deleteVideo
   keeps the file — deleted Library videos accumulate forever — add both dirs to sweepDirs.
4. [MED] [M] project.ts:2113,2161 — deleteVideoEditBranch/deleteEditBranch unlink node files,
   violating the history invariant (undo resurrects nodes pointing at dead files; unlink
   precedes save = crash window) — save first; defer file removal to the sweep or purge nodes
   from history snapshots.
5. [MED] [S] pending.ts:67-77 + project.ts:468-475 — pending/spend ledgers are unserialized
   read-modify-write; concurrent completions can drop a PAID render's recovery record —
   serialize through a promise chain like saveChain.
6. [MED] [S] index.ts:983-1003 + export.ts:566-582 — no export cancellation (no cancel IPC, no
   kill on quit) — retain ChildProcess, add export:cancel → kill, kill on before-quit.
7. [MED] [M] export.ts:232-423 — export flattens live `current` across many awaits while UI
   stays interactive; mid-plan edits produce a mixed-state export — deep-clone project+timeline
   at export:run entry.
8. [MED] [S] index.ts — no app.requestSingleInstanceLock(), no project lockfile; second
   instance = silent last-writer-wins on project.json — request single-instance lock.
9. [MED] [S] project.ts:385,404-406,558-563 — checkpoints written non-atomically; a corrupted
   checkpoint is hidden from the list UI yet makes cleanupProject return null forever — write
   atomically; surface/quarantine unreadable checkpoints.
10. [LOW] [S] project.ts:581 + fx.ts:20-27 — cleanup deletes .matte/.depth sidecars of LIVE
    takes (minutes of GPU work) — treat live-take sidecars as live.
11. [LOW] [S] fx.ts:132-147,174-176 — exports/.fxbake wiped only at NEXT export:plan; GBs can
    persist; dir not in sweep — also clean after exportTimeline settles.
12. [LOW] [S] index.ts:481,497 — vd-vref-*/vd-aref-* cache cuts in OS temp never pruned — prune
    vd-* older than N days at startup.
13. [LOW] [S] project.ts:417-418 — isStateFile startsWith(base) without separator; sibling dir
    passes; stateDelete can reach outside — compare base+sep (reuse insideDir).
14. [LOW] [S] index.ts:1670-1672 — quit doesn't await saveChain; close-after-action can cut the
    in-flight write — before-quit: preventDefault, await chain, quit.
15. [LOW] [S] export.ts:561 — ffmpeg writes directly to outPath; killed export leaves a
    truncated mp4 that looks complete — write outPath+'.part', rename on success.
16. [LOW] [S] project.ts:252 — folder sanitizer misses Windows reserved names (CON, NUL, COM1…)
    and trailing dots/spaces — extend sanitizer.
17. [LOW] [S] project.ts:882 — importImages mid-batch copy failure leaves ghost entries with no
    save — per-file try/catch like importAudioFiles.
18. [LOW] [S] fal.ts:236,271,384 — render_${Date.now()}.mp4 collides on same-ms completion —
    append a UUID.
19. [LOW] [M] project.ts:56,227-238 — two full JSON.stringify passes per save + 80 full
    snapshots in RAM — O(project) per debounced edit — consider byte-capped history.
20. [LOW] [S] project.ts:153 — migrate assumes clip.promptData exists; one malformed clip stops
    the whole project opening — default missing promptData.

# LAYER 2 — ELECTRON CORE + SECURITY (index.ts, preload, config)

**VERDICT:** Unusually thoughtful main layer. contextIsolation + narrow typed bridge (no raw
ipcRenderer passthrough), safeStorage keys with merge-onto-ciphertext semantics, path-confined
streaming media:// protocol, shell-free child processes, locked-down Claude CLI bridge. The
gaps are checklist-class, but cluster into one theme: renderer-compromise blast radius is larger
than needed. ~140-channel IPC surface is huge but consistently thin, project-scoped, null-safe.

**GOOD:** key storage (index.ts:230-299: enc: prefix, merge onto RAW file, atomic serialized
settings writes) · media:// Range streaming confined to project+watch folder with Windows case
normalization; drag:file reuses it · bridge hardening (no shell, env scrubbed, Bash/Write/Edit
disallowed, --strict-mcp-config, tokened 127.0.0.1 MCP, kill-tree timeout) · openExternal gated
^https:// · project delete = trashItem · ffmpeg argv spawn; fx encoder honors stdin
backpressure · falErrorText sends field NAMES only · main.log tees console + crash handlers
with rotation · updater double-init guard.

1. [HIGH] [M] index.ts:531 — settings:get returns the full decrypted key set to the renderer;
   any renderer compromise reads every key in one call — return masked presence (last-4), make
   keys write-only from renderer.
2. [HIGH] [S] index.ts:363-413,426-459 — no setWindowOpenHandler on either window; will-navigate
   blocker only on main window — popups get a preload-armed window; file drop navigates the
   mirror — deny window-open + add will-navigate guard app-wide (web-contents-created).
3. [MED] [S] index.ts:378,442 — sandbox:false though preload only needs
   contextBridge/ipcRenderer — set sandbox:true, verify preload bundle.
4. [MED] [M] package.json:59 — Electron ^31 (Chromium 126, EOL; well past by 2026) decoding
   untrusted downloaded media — staged major upgrade.
5. [MED] [L] package.json build + updater.ts:24-25 — unsigned Windows build with autoDownload +
   autoInstallOnAppQuit; a compromised GH account silently RCEs installs — code-sign + set
   verifyUpdateCodeSignature/publisherName before wide distribution.
6. [MED] [S] index.ts:703-717,654-697 — project:deleteAt/renameAt/duplicateAt accept ANY
   renderer-supplied dir — confine to settings.recentProjects.
7. [MED] [S] renderer/index.html — no CSP at all; media scheme carries bypassCSP — add strict
   CSP meta; drop bypassCSP.
8. [MED] [S] fx.ts:91-171 + index.ts:399-401 — fx encode jobs only reaped by encodeEnd;
   renderer crash mid-pass leaves ffmpeg children alive + orphaned .part files — on
   render-process-gone/close, end jobs and kill processes.
9. [LOW] [S] index.ts:1350,1432-1435 (+884,999,1233) — progress sends without isDestroyed()
   guards; on macOS a closed window makes the send throw and the finally deletes the pending
   entry (losing a paid render) — guard sends.
10. [LOW] [S] fx.ts:32-41 + playground.ts:67-91 — model/zip downloads have no checksum/size
    verification — pin SHA-256 (or at least byte count) before rename.
11. [LOW] [S] project.ts:414-419 — isStateFile boundary/case bug (same as L1#13) — reuse
    insideDir.
12. [LOW] [S] index.ts:1007-1008 — fx:sidecars/fx:probe accept arbitrary absolute paths
    (existence oracle + ffprobe) unlike fx:passStart — apply insideProject.
13. [LOW] [S] index.ts:1610-1614 + project.ts:333-339 — watchFolder read from project.json; a
    shared/downloaded project can point media:// at any folder — re-prompt/drop watchFolder when
    project folder differs from stored value.
14. [LOW] [S] fal.ts:234-237,269-271,382-385 — 50–200MB results buffered wholly in memory via
    arrayBuffer() — stream to file (pipeline) like playground/fx already do.
15. [LOW] [S] index.ts:1017-1021 — fx:readModel returns ~100MB model as one structured-clone
    Buffer per call — stream/serve via confined protocol, cache renderer-side.
16. [LOW] [S] updater.ts:17-22,54-55 vs preload:61-62 — update handlers only registered when
    packaged win32 but exposed unconditionally — register no-op handlers unconditionally.

# LAYER 3 — STATE + ASYNC (store.ts, panelBus, App, Queue)

**VERDICT:** Unusually disciplined renderer: one zustand store, fine-grained selectors (zero
whole-store subscriptions), delta-merge preserving slice identity, rev-CAS on timeline writes,
main-side snapshot undo covering essentially every mutation with undoTick/restorePatch
protocol. The weak seam is the project-switch boundary: queue, Co-Director, in-flight deltas
and UI ids straddle it unstamped. Fixes are stamps, guards, and folding two writes into one.

**GOOD:** ProjectDelta upsert-merge (store.ts:61) preserves identity per slice · per-frame
playback isolated to tiny Playhead/TimeReadout subscribers (shared/playback.tsx) · undo real
and broad, restorePatch revalidates selections, undoTick reloads open forms · timeline writes
carry baseRev, main rejects stale (CAS, store.ts:1035-1049) · IPC wiring clean (every preload
on* returns unsubscriber; no duplicate-handler patterns) · panelBus is a minimal raise-panel
registry with HMR guard, not a competing state bus; fxDraft lifecycle is model async hygiene.

1. [HIGH] [M] store.ts:379,1172,1225 — render queue survives project switch with no project
   stamp; pumpQueue starts pending jobs against whatever project is open; main addTake
   (project.ts:627) silently creates a NEW clip when clipId unknown — paid render lands in the
   wrong project with A's recipe — stamp jobs with project.dir at enqueue; park/skip
   mismatches; clear-or-restore queue on switch.
2. [HIGH] [S] store.ts:731-758,482-525 — nothing stops opening another project while a
   Co-Director exchange is in flight; codir tools resolve getProject() fresh per call — AI
   writes land in the newly opened project — guard open/create on codirRun.busy
   (confirm + cancel); stamp the exchange's project dir like the render path.
3. [MED] [M] store.ts:698-705,1072-1084 + Timeline.tsx:1373/1418,1974/1978 — ripple ops issue
   TWO sequential IPC writes (video, then free-audio shift) = two undo steps; first Ctrl+Z
   desyncs audio/video — add combined main mutations (pattern exists: clipsFromImages).
4. [MED] [S] store.ts:567 — applyDelta trusts any delta; late fire-and-forget callbacks
   (reportTakeDuration:1033, reportAudioDuration:822, codir logDelta:499) merge previous-project
   slices into the new project in memory — carry dir on ProjectDelta; drop mismatches.
5. [MED] [S] store.ts:1210-1216 — pumpQueue returns early when paused BEFORE clearing
   renderBusy — busy badges lie indefinitely — reset renderBusy above the paused check.
6. [MED] [M] store.ts:1178-1190,1213 — cancelling a RUNNING job flips status while IPC still in
   flight; next enqueue starts a second concurrent paid job and progress misattributes — track
   an inFlight flag separate from display status; gate pumpQueue on it.
7. [MED] [S] RenderPanel.tsx:890-932 — Render button has no double-fire guard — two identical
   paid renders on double-click — disable briefly or dedupe identical payload within ~1s.
8. [MED] [M] store.ts:171 — pending queue exists only in renderer memory; quit/crash discards
   every not-yet-started job despite "walk away" copy — persist pending payloads per project;
   offer re-queue on open (or warn on close).
9. [LOW] [M] project.ts:56,223-233 + RenderPanel.tsx:881 — undo granularity = one step per
   600ms autosave; typing burns the 80-slot history — coalesce consecutive same-field saves.
10. [LOW] [S] store.ts:379-390,591-593 — project switch leaves selectedTlItemId, multiSel,
    editor ids, editTarget, tlClipboard, focusField, exportState pointing at old-project ids;
    safety is per-call-site luck — extend resetPlayback + applyDelta removal handling.
11. [LOW] [S] SourceMonitor.tsx:272 — trims written by POSITIONAL index into freshly-read
    items — the one spot not keyed by stable id — address by id captured at edit start.
12. [LOW] [S] Library.tsx:24 — usedBy selector filters timelines on every store write incl.
    60fps ticks — derive in parent or memo by identity.
13. [LOW] [S] store.ts:1269 + index.ts:1380 — completed-but-refused takes (post-switch) record
    no spend though billed — record spend for refused completions (estCost known).
14. [LOW] [S] store.ts:1191-1201 — moveJob only swaps adjacent rows; a done row between pending
    rows blocks reordering — swap within the pending subsequence.

# LAYER 4 — TIMELINE + MONITORS (Timeline.tsx, timelineUtils, Monitor, SourceMonitor, filmstrip, waveform)

**VERDICT:** Better shape than 2676 lines suggests. One resolution rule (resolveView/effDur)
shared by panel/monitors/export; one collision clamp (clampShiftLeft) reused by Q/W, end-trim,
take-switch; loop-tail matches spec substance. The A/B monitor engine is the strongest code in
the app. Debt at the seams: stale-closure keyboard handler, two ripple paths skipping the
clamp, lock holes, dissolve handover glitch, per-mousemove full-panel re-renders. Right split
if ever done: the gesture controllers (~700 lines of window-listener state machines), not math.

**GOOD:** Playhead/TimeReadout as isolated per-frame subscribers · Monitor A/B engine (src/seek
pending gates, boundary pauses surviving rAF throttle, video-as-clock with loop wall-clock
rationale, vernier rate-nudge) · clampShiftLeft one rule three verbs · filmstrip/waveform
sample-once + LRU + inflight dedupe + hard window fixing frame-leak past cuts · loop tail
spec-faithful (tailEndOf excludes other elastic tails; timelineEnd non-recursive; wall-clocked
seams) · fx canvas self-heal design (fresh canvas per lost context, 3-strike latch).

1. [HIGH] [S] Timeline.tsx:1738-1804 — keyboard handler deps [marqueeSel,gapSel,tlObj?.id,
   vTracks] but closures capture render-time clips/locked/mute — no-marquee users keep
   mount-time closures all session; Q/W computes from stale take durations (silent geometry
   corruption), edits freshly-locked tracks — read via useStore.getState() inside handler.
2. [HIGH] [M] Monitor.tsx:590-599+514-517 — dissolve handover: standby plays from in-point;
   >0.3s drift seek rewinds ~tr (default 0.5s → visible jump, head plays twice); tr≤0.3 jumps
   forward — drive standby toward max(inSec, sourceTimeAt(nxt,T)) during the window.
3. [MED] [S] Timeline.tsx:1599-1623 — rippleDelete/closeGap shift all tracks with no collision
   clamp (unlike deleteGapSel) — persistent same-track overlaps — route through clampShiftLeft.
4. [MED] [S] Timeline.tsx:1267-1309,1321-1322,1346 — lock holes: carve trims/splits locked
   tracks; startMove group includes locked members; destination clamp ignores locks — filter
   locked from group base; skip carving locked-track pieces.
5. [MED] [S] Timeline.tsx:1341-1352 — group drag past left wall clamps each member
   individually, collapsing offsets; carve never carves movers against each other → permanent
   overlaps — clamp anchor delta once by group minimum (block whole group at wall).
6. [MED] [S] timelineUtils.ts:78-85 — effDur 0.25 floor applied in TIMELINE seconds post-speed
   while trim minimums are source seconds — speed>1 slice remnants play up to ~1s of
   trimmed-away source — floor the source window (max(0.25/sp,…)) or clamp eff to true window.
7. [MED] [S] Timeline.tsx:2446-2447 — playheadFrac/snapFracs hardwired undefined — TlBlock's
   entire slice-snap machinery unreachable; cut-to-playhead/beat snapping silently lost in v14
   rewrite — pass real fractions.
8. [MED] [M] SourceMonitor.tsx:42,270-273 — slot addressed by array index; commit maps
   render-captured items; concurrent change retargets the trim write (baseRev read fresh, so
   main accepts) — address by item id; rebuild from fresh state at commit.
9. [MED] [M] store.ts:1030-1034 + timelineUtils.ts:40-52 — duration-less takes resolve to 5s
   guess; when real length learned the block silently grows/shrinks with no re-ripple — apply
   the footprint-delta ripple setSlotView already implements.
10. [MED] [S] Timeline.tsx:1134,2007,2081 — padded view length leaks into transport: "to end"
    seeks 8s+ past last frame; readout shows padded duration — use contentEnd for both.
11. [MED] [M] Timeline.tsx:1035-1037,1094-1127,1135 — dragView/dragTrim are panel state; every
    drag mousemove re-renders every TlBlock and re-runs O(clips) lookups per item — memoize
    per-item derived data; move drag preview to a transform overlay ghost.
12. [MED] [S] filmstrip.ts:64-81,87-102 — no concurrency cap: first open starts N hidden videos
    × 40 seeks × main-thread toDataURL — 2-3 wide semaphore (consider convertToBlob).
13. [LOW] [S] Monitor.tsx:59-65,661 — detached/music audio tolerates 0.35s drift before hard
    seek though vernier exists — reuse vernier() for audio elements.
14. [LOW] [S] LOOP_TAIL_SPEC.md:26-29,54,62 vs timelineUtils.ts:195-207 — spec says seams
    included in nextBoundary; implementation excludes (sound rationale); loopEndSec naming
    stale — update spec to as-built.
15. [LOW] [S] Timeline.tsx:2471-2476 — dissolve wedge drawn at block right edge; looped items
    fire it at tail end E — when it.loop, draw wedge at tailEndView(it).
16. [LOW] [S] Timeline.tsx:1403-1410 — dragViewRef/dragTailRef synced via passive useEffect;
    micro-drag mouseup can beat it → drop aborts — write refs directly in move handlers.
17. [LOW] [S] Timeline.tsx:1833-1848,2120 — wheel pan without non-passive preventDefault; when
    tracks overflow, one gesture pans time AND scrolls tracks — native non-passive listener.
18. [LOW] [M] Timeline.tsx:994 — no frame quantization on commit; FPS_NUDGE=1/24 accumulates
    float error; epsilons vary (1e-6…0.15) — quantize to 1ms on commit; standardize tolerance.
19. [LOW] [S] timelineUtils.ts:147-149 + Monitor.tsx:651-652 — music past last video block
    silently cut — include musicEnd in timelineEnd or surface truncation in lane UI.
20. [LOW] [S] filmstrip.ts:2-3 — header says ×20, STRIP_SAMPLES is 40 — doc fix.

# LAYER 5 — PROVIDERS + CO-DIRECTOR (fal, falImage, higgsfield, modelark, astria, codir*, models)

**VERDICT:** Well-above-average integration layer. Four providers genuinely share one contract
(RenderRequest→RenderOutput, cancel/fetch/validate, uniform done/running/gone); key hygiene
exemplary end-to-end; Claude usage current, cache-smart, denied any money verb ("spends stay
user-side" VERIFIED: renders only submitted from the user queue, which never auto-retries).
Weaknesses are robustness plumbing: the recovery ledger undercut by two gaps, poll loops with
no deadline, raw Claude fetch without retry/timeout. Nothing auto-double-submits; the risks
are "false failure makes the human resubmit".

**GOOD:** one provider contract honestly kept; adding a provider = registry entry + adapter;
models.ts documents caps/prices/verification dates, hides unlaunchable engines · cost safety by
construction (serial queue, no auto-retry, blank estimate over guess, Co-Director has no render
verb, bridge CLI Bash/Write/Edit disallowed) · keys: safeStorage at rest, merge-onto-ciphertext,
hardcoded hosts only, error text = field names, bridge env scrubbed, tokened localhost MCP dies
in finally · codir.ts: live model IDs (sonnet-5 default/opus-5/haiku-4.5/fable-5 bridge) with
accurate intro-pricing labels, retired-id fallbacks, no sampling params, refusal handled,
thinking blocks survive the tool loop, tool results in ONE user message · textbook prompt cache
(byte-stable system, volatile tail, breakpoints on history+fresh; reasoning documented) ·
bridge growth control (fresh-state resume, 12-exchange re-seed, 10-min wall, session dropped on
cancel/fail) · codirMcp = minimal correct JSON-RPC reusing TOOLS/runTool (shared guard rails).

1. [HIGH] [M] index.ts:1432-1435 — finally removes the pending-render entry on ANY exit incl.
   transient local failures while the job still completes upstream — paid render unrecoverable;
   natural re-render = double spend — classify: remove only on definitive upstream fail/cancel;
   keep on local/ambiguous.
2. [HIGH] [S] index.ts:146 — resume pass gated on `!falKey && !hfKey`; Ark/Astria-only users
   never recover orphans — add arkKey/astriaKey to the gate.
3. [MED] [M] higgsfield.ts:101-115, modelark.ts:99-116, astria.ts:81-95 — for(;;) polls, no
   deadline, one bad response fatal — tolerate N consecutive failures with backoff + generous
   overall deadline.
4. [MED] [S] codir.ts:1260-1275 — raw Anthropic fetch, no retry on 429/529/5xx (SDK retries
   twice) — retry 1-2× with backoff honoring retry-after.
5. [MED] [S] codir.ts:1260 — no request timeout (only user-cancel aborts); stall wedges the
   panel — race with a timeout signal.
6. [MED] [S] codir.ts:148 — set_clip_fields.engine enum drifted from MODELS (missing
   seedance25ark, seedance2astria) — derive from Object.keys(MODELS) minus hidden.
7. [MED] [S] codirBridge.ts:304,310 — --setting-sources project with cwd=project loads
   <project>/.claude/settings.json if present; a downloaded project could smuggle hooks — empty
   settings source, or refuse/warn when <project>/.claude exists.
8. [LOW] [S] index.ts:1444-1453 — render:cancel removes pending entry even when remote cancel
   returned false (job will complete + bill); also uses CURRENT project dir — keep entry on
   ok===false; use the job's stamped dir.
9. [LOW] [S] index.ts:1351-1354 vs 1434 — void addPendingRender racing awaited remove —
   await/serialize pending mutations.
10. [LOW] [S] codir.ts:1293-1297 — stop_reason max_tokens unhandled; truncated reply looks
    complete — append visible truncation note.
11. [LOW] [S] codir.ts:43,1257-1316 — MAX_ROUNDS right after tools ends with no closing turn
    (reply may be "(done)"); bridge does it right — add the same notice.
12. [LOW] [S] modelark.ts:176 — recovery drops durationSec that live path preserves — return it.
13. [LOW] [M] astria.ts:87-95,164-167 — no documented terminal state: moderation-style failures
    poll forever live, stay 'running' in recovery — age-out recovery entries; deadline from #3.
14. [LOW] [M] falImage.ts:40-47 — image gens: no cancel handle, no pending entry — the one paid
    path outside the ledger — add both (minor cost).
15. [LOW] [S] fal.ts:50-61 — refcounted client singleton silently rebinds job A's polling when
    key changes mid-flight — compare-and-warn when acquire sees a different key while uses>0.
16. [LOW] [M] fal.ts:230-240 + ~8 copies — download-verify-write block duplicated across
    providers/recovery — extract one downloadTo(url,outDir,prefix) helper.
17. [LOW] [S] playground.ts:67-91 — zip download verifies neither size nor hash — compare to
    bytes (or sha256) before rename.

# LAYER 6 — EFFECTS v2 (fx/*, EffectsPanel, FxDownloadModal, main/fx.ts) — UNCOMMITTED

**VERDICT:** Architecturally right: MRT aux channels keep AI sidecars pixel-aligned through
geometric passes; one-table registry drives panel/chain/sanitize; ONNX off-thread with clean
transferable protocol; fxlab shows real pre-flight discipline. Two seams break the headline
promises before first run: EXPORT PARITY DOES NOT EXIST (main has the whole bake-splice
pipeline; no renderer code ever calls it — fx timelines export with effects silently dropped)
and the combine pass unpremultiplies while masks emit straight alpha (feather cancels, halo).
Plus a production-only wasmPaths bug and a self-heal that can never trigger. The monitor path
was user-proven live at dawn 2026-08-09 (matte, depth-cut, grid, blends); export and loop-tail
v17 are the unproven remainder. ("v16" below names the dead earlier attempt whose remnants
findings 4/6 remove.)

**GOOD:** fail-loud GL (compile/link checked, info log + source thrown; renderer console mirrors
into main.log) · MRT aux design correct architecture; unknown stack entries pass through so old
projects can't crash it · worker protocol strictly sequential with transferables both ways —
backpressure by construction; ffmpeg stdin drain honored; cancel checked per frame with .part
cleanup · packFx2 collapses neutral fx to undefined (byte-identical untouched blocks); readFx2
validates on read · fxlab.html = standalone 26-scenario auto-proof harness with ground-truth
canvas · Monitor integration thoughtful (draft-wins preview, input-keyed redraw skip,
budget-capped resolution, file-keyed player pool, sidecarsRev invalidation).

1. [CRIT] [L] store.ts:861 — startExport passes no bakes; nothing calls exportPlan/fxBakeStart;
   the renderer-side baker (step compositor per frame, readPixels, stream to fx:encodeFrame,
   ExportBake[] list) is unwritten — preview shows effects, export drops them all — build the
   baker (see FIX-PLAN design) or hard-block export when any block hasFx2 until it lands.
2. [HIGH] [S] chain.ts:95-100 + effects/mask.ts — combine unpremultiplies; masks emit straight
   alpha → feather cancels, full-brightness rim up to 24px at soft=0.25 — masks must
   premultiply (vec4(c.rgb*m, c.a*m)); keep chain premult-consistent.
3. [HIGH] [S] gl.ts:82-90,187-191 + Monitor drawFx catch — lost context = silent no-op draws;
   only NEW program compiles throw (all cached) — self-heal never fires; fx frozen forever
   after GPU reset — check gl.isContextLost() at render start and throw.
4. [HIGH] [S] fxUtils.ts:7-24 — hasFx() reads the abandoned v16 fixed-field shape (always false
   for the v2 stack shape the panel writes); fxSpans/itemsAtAll build on it — the intended
   baker foundation would bake NOTHING — rewrite over readFx2/hasFx2 or delete now.
5. [MED] [S] passWorker.ts:52 — new URL('/ort/', self.location.origin): packaged app loads via
   file:// where worker origin is "null" → URL throws → every AI pass fails in production —
   resolve wasmPaths from import.meta.url or serve via media protocol.
6. [MED] [M] shared/types.ts (ItemFx v16) + project.ts:1686 + index.ts:1006 — dead v16 shape +
   setItemFx sanitizer nothing uses (panel persists v2 stack via `as unknown as ItemFx`); the
   "v17 adopts stack" slot was consumed by LOOP TAIL; any future timelineSetItemFx caller
   (Co-Director) would strip v2 fx to {} — remove/repoint dead IPC; land stack shape under next
   schema bump.
7. [MED] [S] fx.ts:52-82 — ensureModel: existsSync caches forever, no byte/hash check, no
   re-download path — truncated 100MB model = permanent cryptic failure — verify byte count vs
   content-length; delete dest on session-init failure.
8. [MED] [S] fx.ts:131-147 — RGBA→yuv420p bake with no color matrix (ffmpeg defaults bt601 vs
   take segments bt709) — visible color shift at splice boundaries — scale=out_color_matrix=
   bt709 + -colorspace/-color_primaries/-color_trc bt709.
9. [MED] [M] passWorker.ts:53,57 — no COOP/COEP → crossOriginIsolated false → numThreads=1 on
   fp32 models — seconds per frame, reads as a hang — set isolation headers via
   session.webRequest (dev+prod); fetch fp16/quantized variants.
10. [MED] [S] chain.ts:172-177 — params fed to uniform4f unclamped (promised sanitizer doesn't
    exist on v2 path); missing params object throws in hot loop and burns the latch — clamp
    against spec.min/max in v(); default entry.params ?? {}.
11. [LOW] [S] passWorker.ts:43-44,70 — depth stretched to fixed 518×518 ignoring aspect —
    resize long side ~518, dims to multiples of 14.
12. [LOW] [S] passWorker.ts:150-156 — new OffscreenCanvas + ImageData per depth frame — hoist
    to init.
13. [LOW] [S] passRunner.ts:100 — waitFor adds a once-'error' listener only removed if it
    fires — 720 dead listeners per pass — one error listener per pass lifetime.
14. [LOW] [S] Monitor.tsx drawFx catch — next rAF can reuse the dead canvas before React
    commits the replacement — one incident burns 2-3 strikes — skip ticks until new canvas
    generation mounts; reset strikes on success.
15. [LOW] [S] electron.vite.config.ts ortAssets + public/ — stale asyncify/jspi wasm (~40MB) +
    fxlab (15MB test mp4s + dev harness) ship into out/renderer — prune; exclude fxlab from
    production.
16. [LOW] [M] fx.ts:91-109 — encode job whose renderer dies stays in jobs map, ffmpeg blocked
    on stdin forever — abort on render-process-gone or idle timeout.
17. [LOW] [S] store.ts commitItemFx — rev-CAS rejection silently discards the user's last fx
    edit — surface or retry once on fresh rev.

# LAYER 7 — BUILD + DEPS + TYPES

**VERDICT:** Type health excellent — strict mode, zero errors across the 1,200-line uncommitted
push. Auto-update, secrets hygiene, lazy-ONNX genuinely good. The crisis is packaging: no
files filter (asar verified to contain src/** and duplicate renderer node_modules); the v16
work drops ~92MB of wasm + personal footage into public/; unchanged, the next installer grows
~250MB of dead weight (onnxruntime packed 3×). Separately Electron 31 is ~12 majors / 18+
months past EOL.

**GOOD:** strict typecheck clean incl. v16 · lazy ONNX (dynamic import in module worker, models
on demand, wasm staged for dev AND packaged) · updater correctly wired (3h poll, error
surfacing, quitAndInstall IPC) · scripts/ secrets env-only + DPAPI, probe-out gitignored ·
lockfile committed and updated in the same diff; npm ls clean; @types/node 20 matches Electron
31 Node; ffmpeg-static asarUnpack'd · .gitignore updated alongside the staged wasm.

**TYPECHECK: 0 errors** (`npx tsc --noEmit`, run twice).

1. [CRIT] [S] package.json build — no `files` filter; electron-builder packs src/, docs/ (8MB),
   scripts/, duplicate renderer node_modules (verified in v0.2.2 asar); next build adds
   public/ort twice (154MB) + node_modules/onnxruntime-web (133MB) — add files filter
   (["out/**","package.json", exclusions]) before next dist.
2. [HIGH] [S] package.json:41-51 — react/react-dom/dockview/lucide-react/zustand/
   onnxruntime-web/@fal-ai/client are Vite-bundled yet sit in dependencies → node_modules
   copies ship in asar — move renderer-bundled deps to devDependencies; keep only
   electron-updater, extract-zip, ffmpeg-static runtime.
3. [HIGH] [S] public/ort/ — 39.3MB stale wasm (asyncify 24.2 + jspi 15) not staged by current
   ortAssets regex — delete; have ortAssets clear dst before copy.
4. [HIGH] [S] public/fxlab/ — 15MB personal test takes + dev harness ship verbatim to end
   users — move out of public/ or exclude via files filter.
5. [HIGH] [L] package.json:59 — electron ^31 (installed 31.7.7) vs current 43.x; EOL ~Jan
   2025 — staged upgrade 31→35→39→43, budget for deprecations.
6. [MED] [M] tsconfig.json:19 — one tsconfig with DOM lib + node types for main AND renderer —
   wrong-process imports invisible to tsc — split tsconfig.node/web per electron-vite
   convention.
7. [MED] [M] tsconfig.json:8 — noUncheckedIndexedAccess off; timeline/beat code indexes
   constantly — the single flag most likely to catch shakedown bugs — enable and triage.
8. [MED] [M] package.json:60-63 — electron-builder 24→26, electron-vite 2→5, vite 5→8 (v5
   unmaintained), plugin-react 4→6 — upgrade the trio together.
9. [MED] [L] dockview 1.17.2 vs 7.0.4 — six majors on the core shell — review changelogs,
   schedule one deliberate migration (not shakedown-urgent).
10. [MED] [S] identity:null — mac build unsigned/unnotarized — wire before any Mac handoff.
11. [LOW] [S] preview/WebGpuVideoSpike.tsx — confirmed orphan (zero imports; superseded) —
    delete; likely drop @webgpu/types with it (verify).
12. [LOW] [S] tsconfig — noUnusedLocals/Parameters off (how the spike hid since June) — enable.
13. [LOW] [S] in-range drift: lucide 1.18→1.30, @webgpu/types, @types/node — one npm update.
14. [LOW] [S] dist/ — 617MB stale local installers (v0.2.x, July) — housekeeping delete; note
    GH latest.yml flow is manual by design (--publish never).
15. [LOW] [S] electron.vite.config.ts:14 — ortAssets stages INTO the source tree (allowed #3 to
    accumulate) — dst-clean step or out-of-tree staging.

Unverified (tool gate cut final cross-checks): AboutModal import path; extract-zip import site;
passWorker instantiation line. NOT dead: emitYaml.ts, prompt.tsx (8+ importers each).

# LAYER 8 — UX + DOCS DRIFT

**VERDICT:** The storyboard-first spine is intact and honestly enforced in code: beats band
every block, the take jogger wears frozen snapshot beat colors, S-B is first in every take
row, take-less clips open at the plan, and the uncommitted Effects/loop work follows the
placement laws from day one. The drift is in paper and periphery: tour/README teach a dead
slice key, WORKFLOW.md canon contradicts v16 compositing, the context-menu convergence
regressed to four copies. v0.8's results-first Clip Gen is the one deliberate gravity shift
toward renders; legal under the laws (plan always reachable) but the thing to watch.

**GOOD:** one real theme contract (styles.css 217-line single source, tokens.ts var()-only,
themes.ts overrides-and-clears with rename forwarding) · WhatsNew.tsx exemplary release
hygiene · cheat sheet genuinely tracks the Premiere round · EffectsPanel born law-compliant
(gated states with reasons) · spec-first visible in tree (LOOP_TAIL_SPEC + TEST-SHEET same-day)
· onboarding layered and honest ("their prices, your money", no fake numbers).

1. [HIGH] [S] README.md:159-165 — "S slice / Ctrl+K razor": S is now snap toggle, C slices —
   README users disarm snapping thinking they armed the razor — rewrite from cheat sheet.
2. [HIGH] [S] ui/TourOverlay.tsx:29 — tour teaches "slice with S, drag to reorder" (both
   stale) — new users learn wrong on minute one — reword the Timeline step.
3. [HIGH] [M] docs/WORKFLOW.md:57-63 — canon says "v14 topmost track wins, dissolve only legal
   overlap" while v16 adds per-block blend/opacity — update canon after shakedown (v16/v17
   section).
4. [HIGH] [S] CheatSheet.tsx:47 — no "⟲ loop" right-click row, no tail-drag row — by law 5 the
   newest feature "doesn't exist" — add rows.
5. [MED] [S] README.md:50-51 — "three suppliers" vs four (Astria live in Settings/models) —
   update.
6. [MED] [S] WelcomeModal.tsx:14-16 — welcome cards cover 3 suppliers; Astria-only user never
   told — add card or "more in Settings".
7. [MED] [M] Library.tsx:62-89,128-131 + Bin.tsx:371-401,402-445 — FOUR hand-rolled portal
   context menus (no viewport clamp, no hover styling); count rose since convergence was
   ordered — port all to ui/ContextMenu.
8. [MED] [S] README.md:159-160 — "Shift bypasses snapping" stale (Shift now locks time/changes
   track; S toggles snap) — correct.
9. [MED] [S] Watch.tsx:84 — empty state names "Forge" (owner's personal tool) — neutral copy.
10. [MED] [S] styles.css:41-42 vs themes.ts:6-36 — --alink/--alink-txt absent from THEME_VARS —
    presets can't restyle linked-audio blue; applyTheme never clears an override — add to
    THEME_VARS + presets.
11. [MED] [S] ClipEdit.tsx:382-383 vs RenderPanel.tsx:1235 — take-card click grammar split
    (click=keeper vs click=view) — the exact 07-18 #5 trap — unify.
12. [MED] [S] TourOverlay.tsx:38-39 — Settings step says "paste your fal key" in a 4-supplier
    app; Co-Director absent from all 7 steps — supplier-neutral wording + consider a step.
13. [LOW] [S] README.md:89 — "+ New clip" vs actual "+ clip" — match.
14. [LOW] [S] ImageEditor.tsx — no tree-node right-click (07-18 #2 unbuilt) — add node menu.
15. [LOW] [S] Watch.tsx:87-104 — watched tiles still no right-click menu (07-18 #7) — add.
16. [LOW] [S] Timeline.tsx — no route to Timeline Editor from the Timeline panel (07-18 #1
    "worst survivor"; Bin-only) — gear on timeline toolbar.
17. [LOW] [S] Timeline.tsx:2324-2375 — block menu lacks per-instance mute + take-pick (chips
    only, 9-11px; 07-18 #3 half-open) — add menu-row twins.
18. [LOW] [S] Beats.tsx:253,257,265 — raw 'application/x-vd-beat' literal though MIME_BEAT
    exists (06-13 LOW) — import the constant.
19. [LOW] [S] WebGpuVideoSpike.tsx + styles.css:190-195 — dead spike + .spike CSS still shipped
    (07-18 #12) — delete both.
20. [LOW] [S] ClipEdit:189 / VideoEditor:316 / ImageEditor:520 — same gate, three dialects —
    one phrase.
21. [LOW] [M] docs/feature-manual-v0.6-addendum — manuals stop at v0.6; v0.7/0.8 exist only as
    WhatsNew bullets — write v0.7-0.8 addendum or stamp manuals archived.
22. [LOW] [S] App.tsx:54-71 — Director's Room absent from Window menu (only via Co-Director
    header) — add entry setting roomOpen.
23. [LOW] [S] App.tsx:586-593 — playback force-fronts the Timeline Monitor (07-18 #6 calm-mode
    consideration) — optional calm toggle.

**PRIOR-AUDIT DEBT (still open):** 07-18 #1 Timeline-Editor entry (L8#16) · #2 ImageEditor node
menu (#14) · #3 block-menu mute/take-pick (#17) · #4 menu convergence REGRESSED (#7) · #5 click
grammar (#11) · #6 calm mode partial (#23) · #7 watched-tile menu (#15) · #12 dead spike (#19)
· 06-13 MIME literal (#18) · 06-12 doc-staleness pattern recurred (#1,2,5,6,12).
**Closed since (credit):** Space/transport keys, key banner, toasts, Bin double-click, cheat
sheet, confirmDialog labels, lucide icons, audio-row right-click, zoom, nudge keys, per-block
gain/fades, recents picker.

# DISK-REALITY ADDENDA (live machine inspection)

- Keys at rest are safeStorage-ENCRYPTED (enc: blobs in settings.json) — good. The exposure is
  the IPC boundary (L2#1), not the disk.
- %APPDATA%/vi-dancer = 571MB: Cache 342MB + Code Cache 113MB never cleaned; models/ 109MB
  (correct placement); logs/main.log active.
- Real project inspected: 174MB (renders 21 files/25MB, images 20/149MB); pending-renders.json
  + spend.json present; no project.json backup file.
- Projects live under OneDrive-synced Desktop. This is the Windows 11 DEFAULT (Desktop/
  Documents redirect), so cloud-sync contention is a mainstream user condition, not an edge
  case — it amplifies L1#1 (silent save failure). App-side answer: save-failure surfacing + a
  one-time cloud-synced-folder notice. No user-blame framing.
- TODO.md frozen at 2026-06-08 (claims beats/timeline/export "NOT BUILT" at v0.8.0) — retire.

# COUNTS

Persistence 20 (1H/8M/11L) · Electron 16 (2H/6M/8L) · State 14 (2H/6M/6L) · Timeline 20
(2H/10M/8L) · Providers 17 (2H/5M/10L) · FX 17 (1C/3H/6M/7L) · Build 15 (1C/4H/5M/5L) · UX 23
(4H/8M/11L). **Total 142 — 2 CRIT, 16 HIGH, 54 MED, 66 LOW, +4 addenda.**
