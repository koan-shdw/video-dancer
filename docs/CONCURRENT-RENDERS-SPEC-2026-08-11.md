# Concurrent Renders — Queue lane + Now lane · SPEC v2

Date: 2026-08-11 · v2, rewritten against the post-ONE-EDITOR tree (ClipEdit dead,
JogBar/RefSuite extracted, store queue block verified verbatim-unchanged).
Status: SHIPPED — built same day, user-tested live, released in v0.9.0 (2026-08-11,
tag `efea65c`). Post-spec addition: promoteJob — per-row ▶ on a pending queue row jumps
it to the now lane, same caps.

## 0. One breath

Both render buttons split in two: **＋ Queue** (today's serial lane) and **▶ Render
now** (starts immediately, runs alongside everything, capped per provider). A now-job
refused for rate/busy at submit falls back into the queue ONCE, with a toast. Main
process: zero changes (saveChain + pending-renders + ledger are already
concurrency-safe; the ONLY serializer in the app is pumpQueue's inFlight gate).

## 1. Vocabulary

- **Queue lane** — ＋ Queue rows. Serial, ordered, pausable, reorderable. Today.
- **Now lane** — ▶ Render now rows. Started on creation (subject to §2 caps).
  Never pending except a sub-second submit-gap wait; not pausable, not reorderable.
- One shared `queue: RenderJob[]` array. Persistence, crash recovery, cancel, ETA,
  ledger, toasts: row-level machinery untouched. Stale persisted `kind:'edit'` rows
  (pre-one-editor) still run through the same runner — lanes are kind-agnostic.

## 2. Provider limits — NEW FILE `src/shared/providerLimits.ts`

Per-PROVIDER truth (budgets are per account, not per engine — both ark engines share
one budget). New file: zero collision with the uncommitted one-editor work in
models.ts. Renderer resolves a job's provider via `modelFor(engine).provider ?? 'fal'`.

```ts
// Render-now throttles per provider (docs/CONCURRENT-RENDERS-SPEC-2026-08-11.md §2).
// Researched 2026-08-11. Absent provider = uncapped on OUR side:
//  - fal: concurrency is per fal ACCOUNT (2 new → 40 with credits), excess requests
//    sit IN_QUEUE on fal's servers and are never rejected — a client cap would only
//    duplicate that badly. Pool is shared across ALL fal engines + Nano Banana.
//  - astria: "all jobs are handled in parallel and there is no wait time or queuing".
export interface ProviderLimits {
  maxConcurrent?: number // simultaneous in-flight jobs for this provider
  submitGapMs?: number // minimum gap between submits (QPS guard)
}
export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  // Seedance 2.0 public beta quotas: 3 concurrent tasks/account, submit QPS 2 → 429.
  // 2.5 unpublished — assumed same until BytePlus documents otherwise.
  modelark: { maxConcurrent: 3, submitGapMs: 1000 },
  // hidden engine; conservative placeholder — re-research before ever enabling
  // (2026-08-11 recon: platform API serves NO seedance; MCP OAuth = the future path)
  higgsfield: { maxConcurrent: 1, submitGapMs: 1000 }
}
```

## 3. Data model (store.ts)

`RenderJob` gains:

```ts
lane?: 'queue' | 'now' // absent = 'queue' (old persisted rows load unchanged)
autoQueued?: boolean   // now-job already fell back once — no second fallback
```

## 4. Store (store.ts) — the whole feature

### 4.1 `startJob(id)` — factor the runner out of pumpQueue

The async body (lines ~1368-1465: kind-dispatched IPC → inFlight clear → ETA stats →
applyDelta → slot adopt → done row + spend + credit refresh / error row + billed
ledger + 401/402/403 balance probe → persist → pumpQueue) moves VERBATIM into a new
store action `startJob(id)`, plus the marking prologue:

- guard: row exists && status 'pending' (a gap-timer row may have been cancelled)
- project guard (gap-timer arrivals bypass pumpQueue's parked filter): projectDir
  mismatch → `lane:'queue'` + parked msg, return
- stamp `lastSubmitAt[provider]` (queue-lane submits keep gap math honest)
- ETA from renderStats + set running/inFlight/startedAt + `renderBusy: true`

Only new logic inside the body: the §4.3 fallback branch in the error path.

### 4.2 Lanes

- `pumpQueue` gate → `s.queue.some((j) => j.inFlight && j.lane !== 'now')`.
  Next-pick adds `j.lane !== 'now'` (now-pending rows are gap-timer scheduled).
  Idle-truth both exits: clear `renderBusy` only when NOTHING is inFlight in any
  lane. Tail of pumpQueue = `get().startJob(next.id)`.
- New action `renderNow(job)` (same input as enqueueRender):
  1. Double-fire guard, SHARED `lastEnqueue` sig space (2s) — queue-then-now of an
     identical payload is blocked on purpose (money law).
  2. Budget: provider of `job.payload.engine`; in-flight same-provider count ≥
     `maxConcurrent` → row joins the QUEUE lane + toast
     `«{provider} cap ({n}) — added to queue»` + pumpQueue. Not an error.
  3. Else insert `lane:'now'` pending row; `submitGapMs` not yet elapsed since the
     provider's last submit → msg `waiting for a {provider} submit slot…` +
     `setTimeout(startJob, remainder)`; else `startJob(id)` straight away.
  4. `openQueue()` + `persistQueueSoon` in every path.
- `enqueueRender` force-clears `lane`/`autoQueued` on its rows (restored/re-queued
  rows must never arrive as pending 'now' — they'd wait forever).
- Module state: `const lastSubmitAt: Record<string, number> = {}` +
  `providerOf(job)` helper. Imports: `modelFor` (shared/models), `PROVIDER_LIMITS`
  (shared/providerLimits), `EngineId` type.

### 4.3 Rate-limit fallback (user rule)

In startJob's error path, before writing the error row:

- **Busy** = `/error \((429|503)\)/.test(baseErr)` or
  `/rate.?limit|too many|concurren|busy|throttl/i.test(baseErr)`.
  If `lane==='now'` && !wasCancelled && !autoQueued && !billed: flip the row to
  `{lane:'queue', autoQueued:true, status:'pending'}` (clear msg/error/startedAt/
  etaSec), toast `«{label}: rate limited — moved to queue»` (info), persist,
  pumpQueue, return. ONCE per row.
- **Hard** (400/401/402/403/422, key, validation) and queue-lane busy errors:
  error row exactly as today (billed-anyway ledger + fal balance probe intact).

### 4.4 renderBusy

= any row inFlight, either lane (Clip Editor tab badge stays honest).

## 5. Buttons — the two live dispatch sites

- **RenderPanel.tsx** (`render()` ~893, footer ~1959): `render()` →
  `submitRender(lane: 'queue' | 'now')`; single dispatch line becomes
  `lane === 'now' ? renderNow(job) : enqueueRender(job)`; status
  `rendering now — watch the Queue panel` / today's text. Footer single `.btn`
  becomes a flex row: `▶ Render now (adds a take|new clip) · {model} · {est}`
  (flex 1) + compact `＋ Queue` (title: add to the render queue — runs in order).
  Same `check.errors` gating + cost tooltip semantics on both.
- **VideoEditor.tsx** (`run()` ~211, button ~419): `run(lane: 'queue'|'now' =
  'queue')`, same dispatch + status split. Button row 419 becomes:
  `▶ Generate now {edit|re-gen} {from …}` + `＋ Queue`. Same guards.
- ClipEdit is dead — no third site. (Stale 'edit' rows only REPLAY from
  persistence; they never get buttons.)

## 6. Queue panel (Queue.tsx)

- `running` becomes a LIST (`.filter`), not `.find` — every running row shows its
  own live msg + ETA bar (already per-row). Now-lane rows get a small `now` chip
  (mono, amber border) after the engine label.
- Header: `{n} running · {m} waiting` (hide zeros; replaces the pending-only count).
- Pause tooltip + toast add the lane truth: pausing holds the QUEUE lane; running
  now-jobs always finish (they're already billing).
- Ticker effect keys on "any running" (`running.length`), not `running?.id`.
- Reorder ↑↓ pending-only: unchanged. Cancel per-row: unchanged, works both lanes.
- Empty-state copy: "▶ Render now runs immediately — ＋ Queue lines them up to run
  one at a time. Both land here."

## 7. Unchanged, verified against the post-v2v tree

Main process (render:run / vedit:run / edit:run relic, providers, pending.ts,
saveChain, ledger, credit probe) · queue persistence shape (`lane` rides the
existing keep-spread; loader path force-clears it via enqueueRender) · crash
recovery (per-render, N-safe) · ETA stats (statsKeyFor untouched, 'edit' branch
kept for stale rows) · double-fire guard · project parking · offerQueueRestore.

## 8. Build order (single approved run, app closed)

- **A** shared/providerLimits.ts (new file)
- **B** store.ts: RenderJob fields → helpers/imports → startJob factor →
  pumpQueue gates → renderNow → fallback → enqueue lane-clear
- **C** RenderPanel + VideoEditor button splits
- **D** Queue.tsx multi-running UI
- **E** `npm run typecheck` + report; live checks (§9) with the user's eyes

## 9. Verify checklist

1. Two fal now-jobs + one queued: three IPCs live at once; queue lane still strictly
   serial within itself.
2. Pause mid-now-render: now job finishes; queue lane holds; badges clear honestly.
3. ModelArk ×4 now: 3 run, 4th toasts + joins queue pending.
4. Kill app with 2 in flight → reopen → both takes recover (pending.ts).
5. Simulated 429 on a now-job: one fallback + toast, runs later from the queue;
   second busy on the same row = plain error.
6. Double-click ▶ Render now = one job; queue-then-now within 2s = one job.
7. Old persisted queue file (incl. a stale 'edit' row) loads and runs as queue lane.
8. Ledger: every completion exactly once, including two finishing together.
9. Nano Banana image edit during 3 fal now-renders: all proceed (shared account pool).
