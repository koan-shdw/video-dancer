# B. Money audit findings

Audit of the working tree, 2026-10-09. Read-only.

### B1. Render-now "rate limited, moved to queue" re-submits a job the provider already accepted (double charge)
- Severity: HIGH
- Status: PROVEN (code path); the trigger needs 6 failed status polls in a row with 429/503, or a "busy/throttl" word in a post-submit error
- Trigger: Clip Gen (or Video Editor / Image Edit / Score) "render now". The provider accepts the job (request id recorded), then the status polls fail 6 times in a row with HTTP 429 or 503 (ModelArk QPS 2 is easy to trip with 3 now-lane jobs polling every 3 s; any 5xx burst on fal / Higgsfield / Astria / Venice does it too).
- What goes wrong: the adapter gives up polling and throws the last poll error ("error (503) @ modelark/tasks/<id>…"). render:run returns it as `{ok:false, error}` with no `billed` flag. The store's busy check matches the 503/429 and treats it as a submit-phase refusal: the row goes back to the queue as pending and is SUBMITTED AGAIN. The first job is still running upstream and its pending entry is kept, so recovery lands it later too. He pays twice and gets two takes. Queue-lane rows are not re-submitted, but their plain error says "had a problem on its side (503). Run it again." which invites the same double spend by hand.
- Path: RenderPanel.tsx:2859 submitRender('now') -> store.ts:2211 renderNow -> store.ts:2381 vd().render -> IPC 'render:run' index.ts:3390 -> providers/modelark.ts:152-157 submit + onRequestId (index.ts:3455 addPendingRender) -> modelark.ts:118-127 poll catch, 6th failure rethrows -> index.ts:3631-3632 `{ ok: false, error }` -> store.ts:2454-2466 busy -> pending in queue lane -> store.ts:2350 startJob -> render:run again (new submit). Same shape: higgsfield.ts:113-117, astria.ts:96-99, venice.ts:166-172 (429 counted as transient, rethrown after 5), fal.ts:283-284 (falErrorText keeps the status; @fal-ai/client 1.10.1 queue.js status polling retries 429/500/502/503/504 five times, then rejects), Bridge polls higgsfieldMcp.ts:301-306 / runwayMcp.ts:175-180 / pikaMcp.ts:185-191 / magnificMcp.ts:186-192 (mcpClient.ts:71 `error (${res.status}) @ bridge-mcp/…`). The Video Editor and score/voice now rows go through the same store branch.
- Code:
  - store.ts:2453-2456 `// these are submit-phase rejections (nothing billed)` / `const busy = /error \((429|503)\)/.test(baseErr) || /rate.?limit|too many|concurren|busy|throttl/i.test(baseErr)` / `if (busy && !wasCancelled && cur?.lane === 'now' && !cur.autoQueued && !(r as { billed?: boolean }).billed) {`
  - modelark.ts:120-125 `if (!r.ok) throw new Error(arkErrorText(r.status, \`tasks/${taskId}\`, …))` … `if (++failures > 5) throw e`
  - renderErrors.ts:70-71 `if (n === 429) return \`${who} is busy right now. Run it again in a moment.\`` / `if (n >= 500) return \`${who} had a problem on its side (${status}). Run it again.\``
- Fix idea: render:run (and the other job handlers) should return `billed: true` / `accepted: true` once onRequestId fired, and the store must never auto-requeue or say "run it again" for an accepted job.

### B2. Runway THROTTLED (a queued, accepted task) is treated as a failure: the result is lost and now-lane rows re-submit
- Severity: HIGH
- Status: PROVEN in code; depends on the Runway fact that THROTTLED is a waiting state, not an end state (Runway's task API lists PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED, CANCELLED; THROTTLED = waiting for the account's concurrency slot)
- Trigger: fire two or more Runway Bridge renders (or Runway Bridge image edits) close together, so Runway parks the extra task as THROTTLED.
- What goes wrong: the poll reads THROTTLED, the adapter throws "error @ runway/task: THROTTLED: …". The task still runs later and is billed. (a) Now-lane rows: the store's busy regex matches "throttl" and re-submits the job (B1), so he pays twice. (b) Recovery: the kept pending entry is checked by fetchRunwayMcpResult, which also counts THROTTLED as dead and deletes the entry, so if recovery looks while the task is still parked the paid video is never collected. (c) Image edits (bridgeImage runway lane) have no recovery at all: the picture is paid and lost; Image Edit fires on the now lane by default (ImageEditor.tsx:720 `lane = 'now'`), so it is also re-submitted.
- Path: RenderPanel.tsx:2859 -> store.ts:2211 renderNow -> 'render:run' index.ts:3517-3518 runRunwayMcpRender -> runwayMcp.ts:166 onRequestId (pending written) -> runwayMcp.ts:182-189 readTask, TERMINAL_BAD -> throw -> index.ts:3632 -> store.ts:2454 busy (/throttl/i) -> requeue -> second generate_video. Recovery: index.ts:307-315 -> runwayMcp.ts:209 `return { state: 'gone' }` -> index.ts:330-331 removePendingRender. Image: ImageEditor.tsx:720 -> store.ts:2389 imageGenerate -> 'image:generate' index.ts:3237 runBridgeImage -> bridgeImage.ts:140 `bad: ['failed', 'canceled', 'cancelled', 'throttled']` -> bridgeImage.ts:224 throw.
- Code: runwayMcp.ts:97 `const TERMINAL_BAD = ['FAILED', 'CANCELED', 'CANCELLED', 'THROTTLED']`; runwayMcp.ts:209 `if (TERMINAL_BAD.includes(st.status)) return { state: 'gone' }`
- Fix idea: drop THROTTLED from the terminal lists (live, recovery and image lanes) and keep polling it like PENDING.

### B3. Bridge login / supplier fall-through re-renders a job another account already took
- Severity: HIGH
- Status: SUSPECT (the code path is proven; a double charge needs a post-acceptance error whose words match CREDIT_SMELL while the first job still bills, e.g. a poll that dies on "quota exceeded" or a failure text that mentions credits)
- Trigger: a Bridge render (any Higgsfield / Runway / Magnific / Pika Bridge engine with 2+ logins, or a "Seedance (Bridge)" auto engine with 2+ suppliers logged in). The first account accepts the job (onRequestId fires, pending entry written), then the poll or the job fails with text containing credit / balance / insufficient / payment / quota / top up / plan_required.
- What goes wrong: onBestLogin computes `took` but only uses it for the logged-out case; any CREDIT_SMELL error moves on and runs the whole render again on the next login. bridgeAuto does not look at acceptance at all and runs it again on the next supplier. If the first job was still running (poll gave up) he pays twice; both pending entries are kept so both results can land.
- Path: RenderPanel.tsx submitRender -> store.ts startJob -> 'render:run' index.ts:3514-3525 -> runHfMcpRender higgsfieldMcp.ts:180 onBestLogin -> bridge/index.ts:475-483 run (took = true at :479) -> higgsfieldMcp.ts:297-305 poll throws after 5 bridgeToolCall errors -> bridge/index.ts:484-489 -> next login, higgsfieldMcp.ts:248 generate_video again. Auto: index.ts:3524 runBridgeAutoRender -> bridgeAuto.ts:55-68 -> next supplier.
- Code:
  - bridge/index.ts:486-488 `const over = !st.auth && !took` / `if (i >= order.length - 1 || !(over || CREDIT_SMELL.test(msg))) throw e`
  - bridge/index.ts:461 `export const CREDIT_SMELL = /credit|balance|insufficient|paid.plan|plan_required|payment|quota|top.up/i`
  - bridgeAuto.ts:65 `if (i < candidates.length - 1 && CREDIT_SMELL.test(msg)) {`
- Fix idea: once a job id was recorded, never fall through (onBestLogin: `if (took) throw e`; bridgeAuto: pass an onRequestId wrapper and stop after acceptance).

### B4. Video Editor offers Bridge and local engines for "re-gen with refs", then sends them to fal
- Severity: MED
- Status: PROVEN
- Trigger: Video Editor, pick "Seedance 2 (Higgsfield Bridge) — re-gen with refs" (or Seedance 2.5 Higgsfield Bridge, Magnific Bridge 2/2.5, Pika Bridge, or "MiniMax H3 (local)"), press Generate.
- What goes wrong: the dropdown lists every visible engine with maxRefVideos > 0, which includes the provider 'mcp' and 'local' engines. runV2vEngine's re-gen branch only knows higgsfield-key / venice / fal, so everything else goes to fal's runRender with the Bridge model id as a fal endpoint ('seedance_2_0', '2.0', 'seedance'). His source video and refs are uploaded to fal storage on his fal key (or a 401 with no fal key), then fal refuses the unknown endpoint. His Bridge login never sees the job; the row shows a fal error. This is the same "a Bridge pick goes to fal" lane mix the trust guard was written for; today it fails instead of billing only because those ids are not fal apps.
- Path: VideoEditor.tsx:32 `VEDIT_ENGINES = Object.values(MODELS).filter((m) => !m.hidden && (m.v2v || m.maxRefVideos > 0))` -> VideoEditor.tsx:362 dropdown -> :258 run -> store.ts:2392 vd().veditRun -> 'vedit:run' index.ts:1628 -> index.ts:1669 runV2vEngine -> index.ts:900-904 key checks (no mcp/local branch) -> index.ts:920-925 `provider === 'higgsfield' ? … : provider === 'venice' ? … : await runRender({ ...common, endUserId: …, falKey: s.falKey as string })` -> fal.ts:231 endpoint = 'seedance_2_0' -> fal.ts:240 uploads -> fal.ts:274 subscribe fails.
- Code: models.ts:173 (seedance2hfmcp) `maxRefVideos: 3`, :182 `ref2v: 'seedance_2_0'`; models.ts:283/305/331 mag/pika `maxRefVideos: 3`; models.ts:870 h3local `maxRefVideos: 3`
- Fix idea: either filter VEDIT_ENGINES to the providers runV2vEngine can run (fal, venice, v2v doors), or route 'mcp' re-gens through the same Bridge adapters render:run uses; refuse anything else before any upload.

### B5. Video Editor jobs write no recovery entry: quit, crash or ✕ on a running re-gen loses the paid video (Venice's cancel message promises a recovery that cannot happen)
- Severity: HIGH
- Status: PROVEN
- Trigger: Video Editor re-gen / edit / lip-sync running (fal, Venice or Higgsfield key), then (a) he quits or the app crashes, or (b) he presses ✕ on a Venice row.
- What goes wrong: vedit:run (and edit:run) call runEdit / runRender / runVeniceRender / runHfRender with no onRequestId, so no pending entry is ever written; nothing can collect the finished job later. (b) Venice has no remote cancel: cancelVeniceJob only stops our wait, the job keeps running and is billed, and the thrown text says "if it finishes it is collected on the next project open", which is false here. Any poll failure after submit (Venice 4xx, Higgsfield poll burst, the 45-minute deadline) ends the same way: paid, failed row, nothing left to collect it. (The Video Editor also offers the Bridge engines, see B4; and B6 re-pays these failures in a Co-Director plan.)
- Path: VideoEditor.tsx:258 run -> store.ts:2392 veditRun -> 'vedit:run' index.ts:1669 runV2vEngine -> index.ts:870-882 runEdit (no onRequestId), index.ts:920-925 runHfRender / runVeniceRender / runRender with `common` (index.ts:905-919, no onRequestId). Cancel: Queue ✕ -> store.ts:2278 renderCancel -> 'render:cancel' index.ts:3639 -> index.ts:1004 cancelVeniceJob -> venice.ts:161 throw.
- Code: venice.ts:161 `throw new Error('cancelled (the Venice job itself cannot be stopped — if it finishes it is collected on the next project open)')`; index.ts:905-919 `const common = { jobId: req.jobId, engine: req.engine, mode: 'ref2v' as const, … outDir: req.outDir, onProgress }` (no onRequestId)
- Fix idea: give runV2vEngine an onRequestId that writes a pending entry (with the vedit root/parent so recovery can append the node), and give runEdit fal's onRequestId the same way runRender has it.

### B6. Co-Director plan auto-retries a paid image edit or video edit that failed AFTER the supplier charged for it
- Severity: HIGH
- Status: PROVEN (code path); needs a failure after the charge, e.g. a result download that fails, or a project switch while the plan's job runs
- Trigger: an approved Co-Director plan with an image_edit or video_edit allowance fires a job (fire_render -> image:generate / vedit:run). The supplier finishes and charges, then the app side fails: a result download error ("download failed: HTTP 502", "download incomplete"), "could not record the result node", or he opens another project while it runs ("project changed during the edit — the video was saved … but not added" / "The project changed before the result was saved").
- What goes wrong: these handlers never write a pending entry, so `providerAccepted` is never set, and they return `{ok:false}` without `billed`. finish() therefore marks the job 'failed' (not 'lost'), and dispatchCodirJobs immediately calls retryFailed, which re-queues it; the next dispatch runs the handler again = a second paid generation. The first result is orphaned on disk. The plan text even says counts include "one permitted retry per job", but that retry was meant for jobs that were never charged.
- Path: codir.ts:2560 fire_render -> codirContinuation.ts:125-131 submitAppJob('image:generate' | 'vedit:run') -> appJobs.ts:125 dispatchCodirJobs -> appJobs.ts:102 execute -> index.ts:3236-3241 (image) or index.ts:1669 (vedit) -> falImage.ts:126-129 download throws / index.ts:1696-1697 project changed -> index.ts:3274-3275 or 1722-1723 `{ ok: false, error }` -> jobNotifications.ts:186 finish -> :168 status 'failed' -> appJobs.ts:105 `finally { try { await appJobs().retryFailed(j) } …` -> jobNotifications.ts:193-204 status 'queued', retryQueued -> next pump -> handler again.
- Code:
  - jobNotifications.ts:168 `j.status = result.ok === false ? /cancel+ed|aborted/i.test(…) ? 'cancelled' : j.providerAccepted || result.billed || /timeout|timed out|ECONN|fetch failed|network|interrupted/i.test(String(result.error)) ? 'lost' : 'failed' : 'done'`
  - index.ts:262 `if (job) { job.providerAccepted = true; …` (only reached from observePendingWrite: render, score, voice, enhance)
- Fix idea: mark the job accepted the moment any supplier call returns a job id or a paid result (image and v2v paths included), or have these handlers return `billed: true` once the supplier answered; only retry jobs that provably never reached the supplier.

### B7. The spend ledger books money to the wrong project, and never books Co-Director plan jobs or recovered renders
- Severity: MED
- Status: PROVEN
- Trigger: (a) a render runs, he opens another project before it finishes; (b) any job run by an approved Co-Director plan; (c) a render collected by crash recovery.
- What goes wrong: (a) render:run answers `billed: true` and the store books the spend with addSpend, which writes to whatever project is open NOW (project B), labelled "(finished after project switch)"; project A, which paid, never gets it (recovery lands the take in A later and books nothing). (b) Plan jobs are dispatched in main (dispatchCodirJobs) and never pass through the renderer's startJob, the only place that books spend, so a whole plan of renders is missing from the ledger. (c) recovery lands takes without booking. The project spend total under-reports and mis-attributes.
- Path: (a) index.ts:3550-3551 `return { ok: false, billed: true, … }` -> store.ts:2484-2485 addSpend -> 'spend:add' index.ts:1353 -> project.ts:725-727 `if (!current) return null; const dir = current.dir`. (b) appJobs.ts:94-105 dispatchCodirJobs -> execute (no addSpend anywhere in main except watch.ts). (c) index.ts:377-381 addTake, no spend.
- Code: store.ts:2485 `void get().addSpend({ label: \`${job.label} (finished after project switch)\`, kind: …, cost: job.estCost ?? 0 })`; project.ts:727 `const dir = current.dir`
- Fix idea: book spend in main at the moment a supplier accepts (one place, keyed to the job's own project dir), instead of in the renderer after the result.

### B8. "Queued renders from last session — click to re-queue" offers rows that are still live (or that he cancelled), so one click pays for them twice
- Severity: HIGH
- Status: PROVEN
- Trigger: in project A, queue several renders (or have some parked). Open project B, then come back to A in the same session. Variant: while in B, cancel A's parked rows with ✕, then open A.
- What goes wrong: switching projects keeps the in-memory queue; A's rows park and resume when A is open again. queue.json is only ever written for the project that is open now, so A's file still lists those rows as pending (and, in the variant, still lists the rows he cancelled). On opening A, offerQueueRestore reads A's file and shows the toast without looking at the live queue. Clicking it re-enqueues every row, and sets `lastEnqueue.at = 0` so even the double-click guard is skipped: each live row now exists twice and both copies render and bill; cancelled rows render after all.
- Path: store.ts:1461-1468 openPath -> :1468 offerQueueRestore -> store.ts:636 vd().queueLoad -> 'queue:load' index.ts:2054-2063 (A/queue.json) -> store.ts:639-646 toast onClick -> :644-645 `lastEnqueue.at = 0` / `get().enqueueRender(r)` -> store.ts:2205 new pending row -> pumpQueue -> render:run. Stale file: store.ts:622-632 persistQueueSoon writes only rows of the CURRENT project (`j.projectDir === dir`) via 'queue:save' index.ts:2035-2043 to getProject().dir; cancelJob store.ts:2279-2284 runs that same save while B is open.
- Code: store.ts:630 `.filter((j) => j.status === 'pending' && j.kind !== 'image' && (!j.projectDir || j.projectDir === dir))`; store.ts:643-646 `for (const r of rows) { lastEnqueue.at = 0 … get().enqueueRender(r) }`
- Fix idea: only offer rows on a cold start (or drop any row whose payload jobId is already in the live queue), and write queue.json per row's own projectDir, including cancels.

### B9. Stopping the Co-Director does not stop the renders already asked for in that reply: the rest of the turn's fire_render calls still run
- Severity: HIGH
- Status: PROVEN
- Trigger: renders switched on, he says "go", the Co-Director (Anthropic / Venice / DeepSeek / OpenAI API lane) answers with several fire_render tool calls in one reply (its tool text tells it to "call once per requested clip in order"). After the first one queues he sees it is wrong and presses stop / cancel.
- What goes wrong: cancel only aborts `inflight`, which is checked by the HTTP request to the model. The loop that executes the reply's tool_use blocks never looks at it, so every remaining fire_render in that reply still presses its panel's button and queues a paid render. Only the next model request is aborted. (Plan-driven fires are safe: codir:cancel blocks the plan first and continuationGuard refuses.)
- Path: Co-Director panel stop -> 'codir:cancel' index.ts:2986-2988 -> codir.ts:2595-2597 cancelCoDir `inflight?.abort()` ; meanwhile codir.ts:2869-2884 `for (const block of msg.content) { … const tool = await runToolContent(block.name, …) }` -> codir.ts:1646-1658 runTool (no abort check) -> codir.ts:2559-2581 fire_render -> fireDoor -> index.ts:2836-2846 fireInWindow -> codirFire.ts:46-48 / RenderPanel.tsx:1261-1267 submitRender('queue') -> store enqueueRender.
- Code: codir.ts:2875 `const tool = await runToolContent(block.name, block.input ?? {}, pushDelta)` (inside the per-block loop, no `inflight.signal.aborted` check); codir.ts:2784 the only abort check is around postMessages.
- Fix idea: check `inflight?.signal.aborted` before each tool block (and in fire_render itself) and answer "cancelled, nothing fired".

### B10. Image Edit on fal: one failed download throws away every paid variant
- Severity: LOW (cents per image, needs a download failure)
- Status: PROVEN
- Trigger: Image Edit (fal VIA, any model) with 2-4 variants, or a blocking sheet; one result download fails (network blip, CDN 5xx).
- What goes wrong: fal made and billed all variants. runInner downloads them one by one and throws on the first failure: the variants already written sit in images/edits/ but never reach the edit tree, the rest are never fetched, and the row says failed. There is no recovery for image jobs, and in a Co-Director plan the failure is retried and paid again (B6). The other image suppliers (ModelArk, Google, Venice, Bridge) keep what landed through landVariants; fal does not.
- Path: ImageEditor.tsx:720 generate -> store.ts:2389 imageGenerate -> 'image:generate' index.ts:3241 runImageGen -> falImage.ts:106 subscribe (billed) -> falImage.ts:126-134 download loop -> throw -> index.ts:3274-3275 `{ ok: false, error }`.
- Code: falImage.ts:127-128 `const res = await fetch(url)` / `if (!res.ok) throw new Error(\`download failed: HTTP ${res.status}\`)`
- Fix idea: download each URL independently (allSettled), keep and append what landed, name the ones that failed.

### B11. Bridge upload caches are keyed by file path only, so a ref uploaded on one login is reused on another login of the same supplier
- Severity: MED
- Status: SUSPECT (depends on Higgsfield media_ids / Magnific creation ids / Runway asset URLs being private to the account that uploaded them, which is the normal case)
- Trigger: two logins of Higgsfield (or Magnific / Runway), list 33. Render a clip with a ref image on login 1; later the other login has more credit, so the next render with the same ref runs on login 2.
- What goes wrong: uploadLocal returns the cached media id / identifier / asset URL from login 1 (same path, same size+mtime) and sends it in login 2's generate call. Login 2 cannot see that media: the job is refused (or, if their check is lax, renders without the ref). The bridge image lane shares the same caches.
- Path: RenderPanel submitRender -> 'render:run' index.ts:3525 runHfMcpRender -> bridge/index.ts:467-475 onBestLogin picks login 2 -> higgsfieldMcp.ts:198/206 uploadLocal -> higgsfieldMcp.ts:76-77 cache hit -> higgsfieldMcp.ts:248 generate_video with login 1's media id. Same: magnificMcp.ts:69-70, runwayMcp.ts:55-56, pikaMcp.ts:54-55 (Pika returns public URLs, likely fine), bridgeImage.ts:247.
- Code: higgsfieldMcp.ts:76 `const hit = uploadCache.get(path)` / :77 `if (hit && hit.sig === sig) return hit.id`
- Fix idea: key the caches by `${service}#${login n}|${path}` (the pinned login is known inside onLogin).

### B12. queue:save writes into whatever project main has open, so a save that fires during a project switch puts project A's queued renders into project B's queue.json
- Severity: MED
- Status: SUSPECT (timing: a debounced queue save must fire while the open-project call is in flight; opening a big project makes the window wider)
- Trigger: in A, a queue change (a job finishes, a row is added or cancelled) and within half a second he opens project B.
- What goes wrong: main switches to B first; the renderer still holds A, so persistQueueSoon filters A's pending rows and sends them; 'queue:save' writes them to getProject().dir = B/queue.json. Right after, offerQueueRestore for B reads that file and offers "N queued renders from last session"; one click enqueues A's payloads stamped as B's (paid renders of A's recipes landing in B, and A's live rows still run when A opens).
- Path: store.ts:1461-1466 openPath (awaits vd().projectOpenPath, then sets project) | store.ts:622-632 persistQueueSoon timer (s.project still A) -> 'queue:save' index.ts:2035-2043 `const p = getProject() … join(dir, 'queue.json')` (B) -> store.ts:1468 offerQueueRestore -> 'queue:load' index.ts:2054-2059 -> toast click -> store.ts:645 enqueueRender.
- Code: index.ts:2036-2040 `const p = getProject() … const f = join(dir, 'queue.json')` (the rows' own projectDir is ignored)
- Fix idea: send the project dir with the rows and have main write to that dir (refuse if it is not the open one).

### B13. Bridge adapters take any video/image link found anywhere in a reply as the result, sometimes before checking the job failed
- Severity: MED
- Status: SUSPECT (depends on the supplier echoing input media URLs in its submit or status replies)
- Trigger: a Bridge render or Bridge image edit whose reply carries a media link that is not the result (an echoed input ref, a preview, a sample).
- What goes wrong: Higgsfield video: readJobState falls back to the first `.mp4` link anywhere in the payload, and `if (st.url)` is tested BEFORE the failure statuses, so a failed or still-running job that echoes an .mp4 input lands that file as the take and the pending entry is retired. Magnific accepts a link when the status is empty. Image lane: when the submit reply has no recognised job id, imageUrlIn(sub) takes any .png/.jpg/.webp link (for example the uploaded base image) as the finished edit, while the paid job runs on and is never collected. Pika's video submit does the same with any .mp4.
- Path: higgsfieldMcp.ts:301 job_status -> :165-176 readJobState (`payloadText(r).match(/https?:\/\/…\.mp4…/)`) -> :309-313 `if (st.url) { … downloadTo … return { file: out } }` (before :315 TERMINAL_BAD) -> index.ts:3607 addTake, :3627 removePendingRender. Image: bridgeImage.ts:188-191 `id = lane.jobId(sub); if (id) break; url = imageUrlIn(sub)` -> :229-232 download. Pika: pikaMcp.ts:156-160.
- Code: higgsfieldMcp.ts:309 `if (st.url) {` ; bridgeImage.ts:190 `url = imageUrlIn(sub) // an answer that already carries the picture`
- Fix idea: only accept a result URL from the named result fields and only with a success status; check failure statuses first.

### B14. Cancelling a two-stage fal Enhance in its second stage deletes the recovery entry of the first stage, which already finished and was paid
- Severity: LOW
- Status: PROVEN
- Trigger: Enhance with interpolate on fal and upscale on fal (two requests), press ✕ while the upscale stage runs.
- What goes wrong: both stage requests are recorded with the same queue jobId. The cancel lands (fal accepts it for the queued upscale), and cancelRenderJob removes pending enhance entries by jobId, so the finished, paid interpolate request is dropped too. Stage 1's file stays orphaned in renders/ and recovery never lands the interpolated copy the design promises ("a two-stage job's first request lands what it did").
- Path: Queue ✕ -> store.ts:2278 renderCancel -> 'render:cancel' index.ts:3639 -> index.ts:998 cancelFalJob (enhance.ts:357 trackJob) -> index.ts:1010-1013 `removePendingEnhance(p.dir, { jobId })` -> pending.ts:203-207 removes every entry with that jobId (enhance.ts:418 + index.ts:3096-3098 wrote both with `jobId: args.jobId`).
- Code: index.ts:1013 `void removePendingEnhance(p.dir, { jobId })`
- Fix idea: on cancel remove only the entry of the request that was actually cancelled (by requestId).

### B15. A Bridge generate reply the adapter cannot parse is answered by sending the SAME paid generate call again (up to 3-5 times)
- Severity: HIGH
- Status: SUSPECT (code path proven; a double charge needs the supplier to have accepted the job in a reply shape the id hunters miss, which already happened once: higgsfieldMcp.ts:35-37 records "a real paid job got reported as failed" when the id moved to results[].id)
- Trigger: any Bridge render or Bridge image edit (Higgsfield / Runway / Magnific / Pika) where the supplier's accept reply carries the job id under a key or shape the hunter does not know.
- What goes wrong: no job id found -> the interpreter (a Claude sub-call) is asked what to do; whatever it answers short of "fail", the loop then calls generate_video / video_generate / generate_image again with the same params. Runway, Magnific, Pika and the image lane resubmit even when Claude chose a different side call (e.g. a status call, which is what an accepted job would need). Each resubmit is a new paid job; the earlier ones were never given to onRequestId, so nothing records or recovers them.
- Path: RenderPanel submitRender -> 'render:run' index.ts:3518 -> runwayMcp.ts:143-164 `for (let attempt = 0; attempt < 4; attempt++) { sub = await bridgeToolCall(SERVICE, 'generate_video', params) … taskId = huntTaskId(sub); if (taskId) break … const v = await interpretBridgeReply(…) … if (v.tool !== 'generate_video') await bridgeToolCall(SERVICE, v.tool, v.args ?? {}) … }` -> next iteration submits again. Same: magnificMcp.ts:157-176, pikaMcp.ts:139-175, higgsfieldMcp.ts:247-290, bridgeImage.ts:173-206 (`args = original` then loop).
- Code: runwayMcp.ts:162 `if (v.tool !== 'generate_video') await bridgeToolCall(SERVICE, v.tool, v.args ?? {}) // then the loop resubmits`; bridgeImage.ts:203-204 `if (v.tool !== tool) await bridgeToolCall(…)` / `args = original`
- Fix idea: if the reply has any sign of an accepted job (a status word, an id-like field), stop and fail with the raw reply instead of resubmitting; let only a recognised question (preset offer, cost confirm) trigger a resubmit.

### B16. Direct-supplier score and voice jobs (ElevenLabs, Google Lyria / TTS): ✕ or the 5-minute timeout drops the request while the supplier keeps working, and the row says "cancelled"
- Severity: LOW
- Status: SUSPECT (depends on ElevenLabs / Google billing a request whose connection was closed; their APIs are synchronous, so generation usually completes server-side)
- Trigger: an ElevenLabs music / sound-fx / voice render or a Lyria / Gemini TTS render; press ✕, or the call runs past 300 s (ElevenLabs music, TTS) / 600 s (Lyria).
- What goes wrong: cancelScoreJob / cancelVoiceJob abort our fetch and report success, so cancelRenderJob answers ok and the Queue shows it cancelled; there is no job id and no recovery, so a song or voice the supplier finished and billed is never saved. On the timeout path the row fails and the natural next step is to run it again.
- Path: Queue ✕ -> store.ts:2278 renderCancel -> 'render:cancel' index.ts:995-996 -> scoreRender.ts:109-114 / voiceRender.ts:136-141 `controller.abort(); return true`; timeouts scoreRender.ts:132 `AbortSignal.timeout(300_000)`, voiceRender.ts:146.
- Fix idea: say plainly on the row that the supplier may still bill, and for long music raise the timeout or use the supplier's async endpoint where one exists.

### B17. A Co-Director clip fire that times out in the window still fires later, after the Co-Director was told "NOT fired"
- Severity: LOW
- Status: SUSPECT (needs the Clip Gen form to take more than 8 s to load the clip after the fire request)
- Trigger: renders on, "go", the Co-Director fires a clip whose Clip Gen form is slow to load (panel mounting, heavy project).
- What goes wrong: fire() races the press against 8 s and reports `{ ok: false, line: 'its panel did not load it in time' }`; the Co-Director tells him nothing was fired and may fire again in the same exchange. But the press left `firePending` set and is never withdrawn: whenever the form finally holds that clip (even minutes later when he clicks it), the effect runs submitRender('queue') and a paid render is queued nobody asked for at that moment.
- Path: codir.ts:2581 fireDoor -> index.ts:2836-2846 fireInWindow -> codirFire.ts:36-42 `Promise.race([press(id, prompts), wait(8000).then(() => ({ ok: false, … }))])` -> RenderPanel.tsx:1255-1257 `firePending.current = { clipId, done }` -> RenderPanel.tsx:1261-1267 effect (no deps) `submitRender('queue')` when the clip loads.
- Code: RenderPanel.tsx:1263-1266 `if (!f || selectedClipId !== f.clipId || loadedClipId !== f.clipId) return` / `firePending.current = null` / `const line = submitRender('queue')`
- Fix idea: on the race timeout, clear firePending (unregister the pending press) so a late load can never fire.

### B18. fal submit is retried by the fal client on 502/503/504 with no idempotency key, so a submit that fal accepted but answered with a gateway error is sent again
- Severity: LOW
- Status: SUSPECT (library behaviour; depends on fal ever accepting a request and still answering the POST with 502/503/504)
- Trigger: any fal render, edit, score, voice or enhance submit during a fal gateway hiccup.
- What goes wrong: @fal-ai/client 1.10.1 retries `queue.submit` up to 3 times on 429/502/503/504 (QUEUE_RETRY_CONFIG). If the first POST created a request before the gateway failed, the retry creates a second one; only the last request id reaches onEnqueue, so the first is billed, untracked and never recovered.
- Path: fal.ts:274 `fal.subscribe(endpoint, { input, logs: true, onEnqueue, … })` -> node_modules/@fal-ai/client/src/queue.js:33-38 QUEUE_RETRY_CONFIG `maxRetries: 3 … retryableStatusCodes: [429, 502, 503, 504]` used by submit (queue.js:66).
- Fix idea: submit with retries off (or one retry only on 429) and handle the error in the app, where a 5xx can be reported as "may have been accepted — check recovery".

### B19. ✕ pressed while a running job is still uploading or encoding its refs does not stop the submit: the job is sent and billed after he cancelled it
- Severity: HIGH
- Status: PROVEN
- Trigger: a running render / video edit with refs (video refs up to 50 MB, Venice base64 encoding of refs, Higgsfield/Bridge uploads); while the row says "uploading…" / "encoding media…" he presses ✕.
- What goes wrong: no supplier job exists yet, so every cancel returns false (fal: no requestId yet; ModelArk/Higgsfield: no task id; Venice/Astria only set a flag that is first read inside the poll loop, AFTER the submit; Bridge has no cancel). Nothing tells render:run / runV2vEngine to stop, so when the upload finishes the job is submitted and charged. The row already shows "cancelled"; a fal job then lands as "finished before the cancel landed", a Venice/Astria job throws "cancelled" right after submitting and is collected by recovery later. The one moment a cancel could have been free is the moment it is ignored.
- Path: Queue ✕ -> store.ts:2275-2278 `status: 'cancelled', msg: 'cancelling…'` + renderCancel -> 'render:cancel' index.ts:3639 -> index.ts:992-1005 (fal.ts:101-103 `if (!a?.requestId) return false`; modelark.ts:95-96 `if (!a?.taskId) return false`; venice.ts:112-115 / astria.ts:73-77 flag only) -> meanwhile fal.ts:238-261 uploads continue -> fal.ts:274 subscribe (billed); venice.ts:134-153 encode + POST /video/queue, flag first checked at venice.ts:161; astria.ts:140-148 submit, flag first checked at astria.ts:87.
- Code: venice.ts:160-161 `for (;;) { if (opts.jobId && activeJobs.get(opts.jobId)?.cancelled) throw …` (the only read of the flag, after the submit at :149)
- Fix idea: one cancelled-set per jobId checked right before every submit call (all providers, render and v2v); a hit throws "cancelled before submit — nothing spent".

### B20. Ref windows are cut to a fixed temp path and reused just because the file exists, so a second render started during the cut (or after a failed cut) sends a half-written video or audio ref
- Severity: MED
- Status: SUSPECT (timing; whether a truncated ref is refused before billing or rendered depends on the supplier: a half mp4 usually has no index and is refused, a half mp3 plays fine and is used)
- Trigger: two renders with the same windowed @video / @audio ref started a second or two apart (two "render now" re-rolls, or two Video Editor "Generate now" on the same window); or one earlier cut that ffmpeg aborted.
- What goes wrong: the cut's name is a hash of source + window, ffmpeg writes straight to that name, and the next caller only checks existsSync. Render 2 finds render 1's file while ffmpeg is still writing it and uploads it as is (and caches that upload by path + size). A failed cut leaves its partial file for 7 days and every later render with that window reuses it. A paid render then runs on a truncated reference (audio cut short), or fails after the uploads.
- Path: store.ts:2211 renderNow (twice) -> 'render:run' index.ts:3435 resolveRefMedia -> index.ts:764-767 `const cut = join(app.getPath('temp'), \`vd-vref-${key}.mp4\`)` / `if (!existsSync(cut)) await cutSegment(srcFile, r.inSec, r.outSec, cut)`; audio index.ts:785-787 `vd-aref-${key}.mp3` + toMp3; Video Editor index.ts:1656-1658; export.ts:42-56 cutSegment and :87-95 toMp3 write `-y outPath` directly.
- Code: index.ts:766 `if (!existsSync(cut)) await cutSegment(srcFile, r.inSec, r.outSec, cut)`
- Fix idea: cut to `${cut}.part` and rename on success, and share one in-flight promise per cut key so a second caller waits for the first.

### B21. A "Seedance (Bridge)" auto render that the router sends to Venice is recorded for recovery as a Higgsfield job, so it is never collected
- Severity: HIGH
- Status: PROVEN
- Trigger: Clip Gen engine "Seedance 2 (Bridge)" or "Seedance 2.5 (Bridge)" with a Venice key saved; the router picks Venice (most credit). Then the app quits or crashes mid-render, the 45-minute poll deadline passes, a retrieve fails, or he presses ✕ (Venice cannot be stopped; the message promises it "is collected on the next project open").
- What goes wrong: render:run writes the pending entry with `provider` = the engine's provider ('mcp') and `endpoint` = the Venice model id (runVeniceRender reports `onRequestId(queue_id, veniceModel)`). Recovery reads provider 'mcp', looks for 'runway-mcp' / 'magnific-mcp' / 'pika-mcp' prefixes, finds none, and asks Higgsfield's job_status about a Venice queue id: skipped forever when Higgsfield is not logged in, or answered with a schema/unknown error that maps to 'running' forever. The finished, paid Venice video is never downloaded; the Queue's "awaiting recovery" line never clears.
- Path: RenderPanel submitRender -> 'render:run' index.ts:3405 `const provider = modelFor(req.engine).provider ?? 'fal'` ('mcp') -> index.ts:3524 runBridgeAutoRender -> bridgeAuto.ts:59 runVeniceRender -> venice.ts:153 `opts.onRequestId?.(sub.queue_id, opts.veniceModel)` -> index.ts:3455-3458 addPendingRender({ requestId, endpoint, provider, … }) -> later resumePendingRenders index.ts:307-315 `const svc = entry.endpoint.startsWith('runway-mcp') ? … : 'higgsfield'` -> `if (!bridge.bridgeReady(svc, slot)) continue` / fetchHfMcpResult(queueId) -> higgsfieldMcp.ts:323-339.
- Code: index.ts:311 `const svc = entry.endpoint.startsWith('runway-mcp') ? 'runway' : entry.endpoint.startsWith('magnific-mcp') ? 'magnific' : entry.endpoint.startsWith('pika-mcp') ? 'pika' : 'higgsfield'`
- Fix idea: let the lane say which supplier took the job (bridgeAuto wraps onRequestId and records provider 'venice' for its Venice lane, or prefixes the endpoint 'venice:'), and route recovery on that.

---

## 1. Earlier audit check (AUDIT-2026-10-08.md Part 1, items in area B, re-traced after the hunt)

- #2 A1 retry after the job was taken: CONFIRMED. bridge/index.ts:486-488 still computes `took` and only uses it for the logged-out case; bridgeAuto.ts:65 has no acceptance check at all. Written up as B3 (still SUSPECT on the refund / error-wording question). B15 is a second, separate re-submit path in the same adapters.
- #4 A2 cancelled parked job returns: CONFIRMED, and wider. store.ts:630 saves only the open project's rows and store.ts:643-646 re-enqueues every saved row with the guard reset; not only cancelled rows come back, live parked rows are offered again and duplicated. Written up as B8; the cross-project race is B12.
- #5 A7 crash recovery gaps: CONFIRMED for video edits (vedit:run never passes onRequestId: index.ts:870-925, B5) and Image Edit (image:generate writes no pending entry: index.ts:3236-3241). CHANGED for "Image Gen online models": imagegen:render now runs only local Krea 2 (index.ts:2379-2393), nothing paid to recover. CHANGED for "sheets": Sheet Gen capture renders are kind 'gen' through render:run and ARE recovered; only the blocking sheet (block:build on fal, index.ts:3296) is not. New gap found: the Bridge-auto Venice lane is recorded under the wrong supplier (B21).
- #6 A6 Image Edit variant loss: CONFIRMED. falImage.ts:126-134 still downloads in a loop that throws on the first failure. B10.
- #8 A4 spend in the wrong project: CONFIRMED. store.ts:2484-2485 books via addSpend, which writes to `current.dir` (project.ts:727). Also found: Co-Director plan jobs and recovered renders are never booked. B7.
- A3 fal two accounts: CONFIRMED as written. fal.ts:84-92 still only logs "key changed while a job is in flight"; recovery entries carry no key/account, so a request made on the old account is asked with the new key.
- A5 plan resumes on reopen: CONFIRMED, by design. jobNotifications.ts:54-58 cancels only non-plan queued records on load; plan jobs keep their request and dispatch again (appJobs.ts:94-105) within checkAllowance (jobNotifications.ts:128-141).
- A8 draft finished on a new key: CONFIRMED. draft.ts:31 checks the supplier (`take.draft.via`), not the key/account; the supplier refuses an unknown draft id before charging.
- A9 upload caches per path, not per account: CHANGED. With several logins per supplier (list 33) this is reachable without any key change: the Bridge caches (higgsfieldMcp.ts:70-94, magnificMcp.ts:63-88, runwayMcp.ts:49-81) reuse login 1's media ids on login 2. B11.
- B1 keys in logs (Part 1 lows): CONFIRMED for my files. Logged lines carry tool names, args without credentials (bridge/index.ts:596), supplier error bodies (no auth headers echoed), and fal field names only (fal.ts:205-215). The Bridge log does keep presigned upload URLs (short-lived).
- C4 wrong project after a switch: CONFIRMED that main refuses to land results after a switch (index.ts:3550, 1696, 2225, 2795, project.ts:3074 assertJobProject). Money side not covered by the old note: refused image-edit and video-edit results are paid and not recoverable, and in a plan they are re-run (B5, B6).
- #1 settings wipe, #3 installer sources, #7 Civitai same filename: outside area B (settings / build / downloads); not re-traced here.

## 2. Coverage

Read in full:
- main: fal.ts, falImage.ts, byteplus.ts, providers/astria.ts, providers/google.ts, providers/higgsfield.ts, providers/modelark.ts, providers/venice.ts, providers/mcp/bridgeAuto.ts, bridgeImage.ts, higgsfieldMcp.ts, hunt.ts, magnificMcp.ts, pikaMcp.ts, runwayMcp.ts, bridge/index.ts, bridge/interpreter.ts, bridge/mcpClient.ts, bridge/oauth.ts, bridge/services.ts, codirAuth.ts, codirFailure.ts, codirLane.ts, codirMcp.ts, claudeWire.ts, openaiWire.ts, subcall.ts, scoreRender.ts, voiceRender.ts, enhance.ts; plus (followed callers) appJobs.ts, jobNotifications.ts, codirContinuation.ts, pending.ts, draft.ts, storageLocation.ts.
- index.ts: lines 1-1360 (startup, recovery pass, settings, cancelRenderJob, appJobs wiring, credit/spend/bridge/project handlers), 1620-1730 (vedit:run), 2033-2067 (queue:save/load, failure:add), 2121-2305 (score:render, score:compose), 2333-2410 (imagegen:render), 2636-3002 (voice:describe, voice:render, Co-Director send/fire/cancel/job pump), 3064-3125 (enhance), 3160-3320 (image:generate, block:build), 3346-3356 (sheet:build), 3383-4120 (render:run, render:cancel, validators, edit:createClip, edit:run, quit and startup paths).
- renderer: panels/Queue.tsx, lib/codirFire.ts, shared/providerLimits.ts, shared/renderErrors.ts, lib/engineOptions.ts, shared/blocking.ts, lib/keySuppliers.ts, ui/ArkChip.tsx, ui/KeyWizard.tsx; store.ts lines 1-140, 600-670, 1405-1495, 2180-2541 (all queue / job / spend code).
- also: shared/models.ts 1-970 (engine registry), export.ts 30-120 (cut helpers), preload channel map (grep), @fal-ai/client 1.10.1 src/queue.js (submit/status retry), the live Bridge tool captures in I:\APPS\Video Dancer\Data\bridge-tools (tool names; Runway get_task / generate_video and Higgsfield generate_video / job_status schemas).

Read in part / skimmed:
- codir.ts: read 1-540, 860-890 (fire_render schema), 1640-1840, 2530-2916 (fire_render handler, tool loop, cancel, compact); the rest (tool schemas 540-860, context builders 890-1640, other tool cases 1840-2530) skimmed by grep: project writes, no paid calls besides watch.
- codirReach.ts: read 880-1058 (buildFireJob); the reach tools (1-880) skimmed: project writes.
- codirBridge.ts: read 350-655 (exchange, cancel); 1-350 skimmed (CLI detection, login, one-shot spawn/kill).
- codirCli.ts: skimmed by grep (spawn, kill, env scrubbing, MCP token file) — no paid render path.
- sheet.ts: skimmed (local ffmpeg only). scoreCompose.ts: skimmed (sub-calls + watch only).
- index.ts not read line by line: 1360-1620, 1730-2033, 2067-2121, 2410-2636 (Civitai / model downloads), 3002-3064, 3125-3160, 3320-3383 (library, export, fx, models, civit, misc).
- RenderPanel.tsx: fire / draft finish / dialogue enqueue (1060-1270, 1540-1560), result landing (640-655), seed and estimate lines; not the rest of the panel. VideoEditor.tsx 1-300 (engine list, run). ImageEditor.tsx only its lane/dispatch lines.
