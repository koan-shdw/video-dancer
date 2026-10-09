# C. Back end core: findings

Auditor C. Working tree as of 2026-10-09 (includes uncommitted src/main/settingsFile.ts).

### C1. A running fal Enhance is "recovered" by the 30 s recovery loop while it is still live: an extra half-done copy lands
- Severity: MED
- Status: PROVEN (code path; timing is the recovery loop's own 30 s cadence)
- Trigger: project open; Enhance window, INTERPOLATE on a fal engine + UPSCALE on a fal engine (two stages), press run. Also single-stage fal (or depth) when the result download is slow.
- What goes wrong: `enhance:run` never calls `beginMediaWrite()`, so the recovery loop (which re-runs every 30 s while a project is open and skips only when `hasMediaWrites()`) treats the live job's pending-enhance entry as a crash orphan. After stage 1 finishes on fal, the live run moves on to stage 2 (upload + fal wait, minutes) and the stage-1 entry stays recorded until the very end. The recovery tick asks fal, gets COMPLETED, downloads the stage-1 result again into renders/, calls `addEnhancedCopy` with the stage-1-only "did" mark, removes the entry, and shows "recovered a finished enhance job". Then the live run lands its real copy. He gets two new copies (one interpolate-only he never asked for). Same race for a single-stage job if the tick hits between fal COMPLETED and the live download/land. Second effect of the same gap: Cleanup (apply) during an enhance is not refused (`mediaWrites` is 0), so the in-flight `enhance_*.mp4` in renders/ is unreferenced and can be swept.
- Path: renderer enhance:run -> index.ts:3079 `registerJobIpc('enhance:run'` (no begin/endMediaWrite anywhere in 3079-3111) -> enhance.ts:418 stage -> runFal onEnqueue -> index.ts:3096 onRequestId -> addPendingEnhance; meanwhile index.ts:467-475 schedulePendingResume reschedules itself every <=30 s while `getProject()` -> index.ts:271 `if (resumeRunning || hasMediaWrites()) return` (false) -> index.ts:436-457 pendEnhances loop -> fal.ts:329 fetchRenderResult (downloads) -> project.ts:2208 addEnhancedCopy -> index.ts:453 removePendingEnhance. Live run then index.ts:3104 addEnhancedCopy again.
- Code: index.ts:271 `if (resumeRunning || hasMediaWrites()) return // live submissions own their pending entries`; index.ts:472 `if (generation === recoverySchedule && getProject()) schedulePendingResume(Math.min(30000, delay * 2))`; index.ts:3102 `const r = enhanceLocal(args) ? await runtime.withGpu(go) : await go()` (no beginMediaWrite around it); enhance.ts:428-429 `if (args.interp) await stage('interp') ... if (args.upscale) await stage('upscale')`.
- Fix idea: bracket enhance:run with beginMediaWrite/endMediaWrite like render:run and voice:render.

### C2. ✕ on a local LTX / H3 render does nothing until the sampler has started; a local score (ACE / MiniMax) can never be cancelled
- Severity: MED
- Status: PROVEN
- Trigger: (a) press Render now on two or three LTX (or H3) clips; ✕ the second row while the first renders (it waits in the GPU line). Or ✕ any LTX row during "starting the LTX engine… cold start" (up to 3 min). (b) render a score on ACE-Step or MiniMax Music local, press ✕ on its row.
- What goes wrong: the renderer flips the row to "cancelling…" and calls render:cancel. Main's `cancelRenderJob` asks `ltxLocal.cancelLtxRender`, which only knows the job whose graph is already in ComfyUI (`activeJob` is set inside `runGraph`). A job waiting in `runtime.withGpu`, or still in `ensureLtxWorker`/file copy, returns false; every other canceller returns false too. Nothing remembers the ask, so when the GPU frees the job runs in full (minutes of GPU), lands a take, and the row reads "finished before the cancel landed". Local scores have no cancel hook at all (`cancelScoreJob` only knows ElevenLabs jobs; the local path is not passed a jobId). Krea 2 already fixed exactly this with a remembered cancel (`cancelAsked`, krea2Local.ts:282-292); LTX/H3/ACE/MiniMax did not get it.
- Path: store.ts:2272 cancelJob -> preload renderCancel -> 'render:cancel' index.ts:3639 -> cancelRenderJob index.ts:992 -> ltxLocal.ts:722 cancelLtxRender `if (!activeJob || activeJob.jobId !== jobId) return false` -> scoreRender.ts:109 cancelScoreJob (elevenJobs only) -> voice/enhance/fal/hf/ark/astria/venice all false -> returns false. Meanwhile index.ts:3472 `runtime.withGpu(() => ... ltxLocal.renderLtxClip(...))` keeps waiting, then runs; ltxLocal.ts:586 `activeJob = { jobId: o.jobId, ... }` is only set once runGraph starts. Scores: index.ts:2203-2206 renderAceScore/renderMinimaxScore get no jobId.
- Code: ltxLocal.ts:723 `if (!activeJob || activeJob.jobId !== jobId) return false`; store.ts:2437 `msg: wasCancelled ? 'finished before the cancel landed' : 'done ✓'`
- Fix idea: give LTX/H3 (and the local score renders) the Krea 2 remembered-cancel set, checked before withGpu entry, after worker start, and in the poll loop.

### C3. MiniMax Music local worker: its stdout/stderr pipes are never read, so a chatty run can block the worker forever
- Severity: MED
- Status: SUSPECT (missing: a measured byte count of what the worker prints on a first run; the code path itself is certain)
- Trigger: first MiniMax Music 3 (local) score render (downloads ~20 GB through huggingface_hub with tqdm bars on stderr), or many back-to-back renders on one warm worker.
- What goes wrong: `spawnWorker` spawns the python worker with default pipes and never attaches a reader to `ps.stdout`/`ps.stderr` (contrast `spawnServer`, which drains both). Node buffers ~64 KB and the Windows pipe ~64 KB; after that every print/tqdm update in the worker blocks the writing thread. The render thread stalls; the poll loop in `renderMinimaxScore` keeps saying "still composing…" forever, inside `runtime.withGpu`, so every later local job (LTX, Krea 2, ACE, local enhance) waits behind it until he presses PURGE or restarts.
- Path: score:render index.ts:2206 -> audioLocal.ts:369 withGpu -> audioLocal.ts:396 runtime.ensureScriptWorker -> runtime.ts:331 `spawn(py, [scriptPath], { env: ..., windowsHide: true })` (no stdio option, no listeners) -> audioLocal.ts:407-424 poll loop with no timeout.
- Code: runtime.ts:331 `const ps = spawn(py, [scriptPath], { env: { ...process.env, ...extraEnv, VD_PORT: String(port), VD_TOKEN: token, VD_PARENT_PID: String(process.pid) }, windowsHide: true })`
- Fix idea: spawn script workers with stdio ignore (or drain both streams into the log like spawnServer does).

### C4. A second launch (double-click while the app runs) can still run the whole boot block, and its first act is to kill the running app's local engines
- Severity: LOW
- Status: SUSPECT (missing: (1) proof that Electron 44 still emits `ready` / resolves `whenReady()` in a process that called `app.quit()` before ready; main.log has lone "started" lines seconds apart, e.g. 2026-10-05T16:40:17 then 16:40:23, 16:57:22 then 16:57:38, consistent with second launches but not proof; (2) timing: the reaper PowerShell is a direct child, so libuv's kill-on-close job object kills it when the second process exits; it only does damage if Get-CimInstance + Stop-Process finish before that)
- Trigger: a local LTX/H3/ACE render is running; he launches Video Dancer again (taskbar, desktop icon, an update relaunch).
- What goes wrong: the single-instance guard calls `app.quit()` but does not stop the rest of the module: `app.whenReady().then(...)` is registered unconditionally right after. If ready fires before the quit lands (Electron's own sample puts all boot work in the `else` branch for this reason), the second process runs `runtime.reapOrphans()`, which spawns a PowerShell that force-stops EVERY process whose command line contains `<userData>\runtime`, i.e. the first instance's live ComfyUI / ACE server / MiniMax worker and any uv install in progress. The running render dies ("the local engine died mid-render"). The same block also runs `patchSettings({})` and the watch-model migration against the settings.json the first instance is writing (read-modify-write from two processes; one can drop the other's change), and `createWindow()`.
- Path: second process index.ts:3943 `if (!app.requestSingleInstanceLock()) { app.quit() }` (no return / else) -> index.ts:3994 `app.whenReady().then(() => {` -> index.ts:3997 `void runtime.reapOrphans()` -> runtime.ts:500-510 `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force ... }`; also index.ts:4003-4005 and 4111 settings writes.
- Fix idea: put every whenReady/boot registration inside the branch that holds the lock (or `app.exit(0)` / return immediately when the lock is lost).

### C5. Window cuts and audio conversions are written straight to their shared temp name, and "file exists" is taken as "cut finished": a second job uploads a half-written file
- Severity: MED
- Status: PROVEN (code path; needs two jobs on the same source window within the few seconds a cut takes, or a crash mid-cut)
- Trigger: Video Editor, a windowed source: press "Generate now", wait more than the 2 s double-click guard, press it again (two variants) while the first job is still cutting. Same for two Render-now presses (two takes) of a clip whose @video ref has an in/out window, or whose @audio ref needs converting. Or: the app/PC dies while a cut is running; every later run with that window uses the stub.
- What goes wrong: the cut name is a deterministic md5 of source+window. Job 1 sees no file and starts ffmpeg with `-y outPath` (ffmpeg creates the file at once and moves the moov atom at the end because of +faststart). Job 2 sees `existsSync(cut)` true and immediately sends the half-written mp4 as the source/reference. For the Video Editor the upload is cached under the cut path (`cacheKey: sendFile`), so when job 1 finishes its cut it hits that cache entry and sends the same broken upload URL; every re-roll of that window this session does too. Result: failed (possibly billed) renders on a truncated video. A crash mid-cut leaves the stub on disk; it is reused for up to 7 days (until the boot prune).
- Path: VideoEditor.tsx run('now') -> store renderNow -> 'vedit:run' index.ts:1655-1659 `if (!existsSync(cut)) await cutSegment(srcFile, req.inSec, req.outSec, cut)` -> index.ts:1679 `cacheKey: sendFile` -> fal.ts:379-381 cache hit returns the stored URL. Render path: 'render:run' index.ts:3435 resolveRefMedia -> index.ts:766 `if (!existsSync(cut)) await cutSegment(...)`, index.ts:787 `if (!existsSync(mp3)) await toMp3(...)`. Also index.ts:2193 (ACE music ref) and index.ts:2735 (Google voice WAV). Writer: export.ts:42-56 cutSegment writes `'-y', outPath` directly.
- Code: export.ts:50 `'-movflags', '+faststart', '-y', outPath`; index.ts:766 `if (!existsSync(cut)) await cutSegment(srcFile, r.inSec, r.outSec, cut)`
- Fix idea: cut into a unique `.part` name and rename into place when ffmpeg exits 0 (and share one in-flight promise per cut name).

### C6. Exporting an in/out range drops the music lane whenever the music starts later than the range is long
- Severity: MED
- Status: PROVEN
- Trigger: timeline with the music lane starting at, say, 30 s; set an in/out range 60-80 s (I / O keys); Export. (Same code serves Watch cut on a selection and the score/compose span proxies.)
- What goes wrong: the export decides whether to include the music by comparing the music's ABSOLUTE start (30) with the range's LENGTH (20), not with the range's end. 30 < 19.95 is false, so the music is left out entirely and the exported 20 s have no music, although the Monitor plays it there (Monitor.tsx:811 `if (T >= music.startSec ...)`). The inner check two lines later already uses the correct window-relative start; the outer gate is the bug.
- Path: Timeline Export button -> store.startExport -> exportOne -> 'export:run' index.ts:1771 -> export.ts:296 exportTimeline -> export.ts:540 `const totalDur = R1 - R0` -> export.ts:553 gate -> export.ts:624 `if (useMusic && music && musicFile)` skipped.
- Code: export.ts:553 `const useMusic = !!(music && musicFile && music.startSec < totalDur - 0.05)` vs export.ts:627-633 `let startEff = music.startSec - R0 ... if (startEff < totalDur - 0.05 ...)`
- Fix idea: gate on `music.startSec - R0 < totalDur` (or drop the outer gate and keep the inner one).

### C7. With an unreadable settings.json (the case the new fix guards), no project can be opened or created: main switches project, then the IPC throws and the window never shows it
- Severity: MED
- Status: PROVEN (code path; trigger is a damaged or long-locked settings.json, which the uncommitted fix now turns into a throw)
- Trigger: settings.json exists but is damaged (or held locked past the ~2.5 s retry). App starts, shows "Your settings could not be read" once (non-modal), opens no last project (settings read as {}). He opens a project from the Open window, File > Open, or creates a new one.
- What goes wrong: `openProject` / `newProject` succeed in main, so main's open project is now the new one; then `noteRecent` calls `patchSettings`, which now THROWS (settingsFile.ts), so the handler rejects. The renderer's `await vd().projectOpenPath(dir)` throws before `set({ project: p })`, nothing is shown, no toast (the rejection is only logged). Every open attempt repeats this; New Project additionally creates a folder on disk each time. Main and window now disagree about the open project: window-side writes that carry no ids land in main's project (queue.json via persistQueueSoon, layout.json, spend ledger), and pending-render recovery is never scheduled. The fix's own comment promises "keeps the app running on empty settings IN MEMORY"; opening work is exactly what stops.
- Path: store.openPath (store.ts:1461-1469) -> 'project:openPath' index.ts:1212 -> openProject (main switches) -> index.ts:1216 `await noteRecent(p.dir)` -> index.ts:1116-1120 patchSettings -> index.ts:550 `await loadRawSettings()` -> settingsFile.ts:23 `throw new SettingsUnreadable(...)`. Same for 'project:open' index.ts:1195-1197 and 'project:createAt' index.ts:1167-1168.
- Code: index.ts:1214-1219 `const p = await openProject(dir); if (p) { await noteRecent(p.dir); schedulePendingResume() } return p`
- Fix idea: make the recents bookkeeping best-effort (catch it) so an open that succeeded in main always returns the project.

### C8. Every job he starts carries a hidden 2-hour deadline; at 2 h the app declares it lost and cancels it mid-run (local renders waiting in the GPU line count from the click)
- Severity: MED
- Status: PROVEN (code path; needs a job whose IPC call is still running 2 h after it was invoked)
- Trigger: press Render now on several local LTX / H3 clips (or local Enhance, Topaz) so they wait for the GPU one after another; any of them still running 2 h after its click. Same for a very long Topaz/RIFE enhance, a long AI matte/depth pass, an Effects export bake, or a fal job stuck that long in fal's queue.
- What goes wrong: `registerJobIpc` wraps every result-producing channel (render:run, enhance:run, imagegen:render, score:render, fx passes and bakes via observeEncode, ...) in an app-job record with `deadlineMs: 2 * 60 * 60_000`, `startedAt` = the moment the IPC arrived (not when the GPU freed). The job pump runs `settleInterrupted` every second for every user (not only Co-Director plans); once a live job passes 2 h it is marked `lost` ("No result before the job deadline.") and `io.cancel(j)` fires: for a clip/enhance job that is `cancelRenderJob(jobId)` -> LTX `/interrupt` (if it is the one sampling) or `cancelEnhance` (taskkill of Topaz/RIFE); for an fx pass or bake it is `fx.encodeEnd(id, false)`, which kills the encoder and deletes the .part. He sees a render/enhance/export fail after hours of GPU time, with no setting or message explaining a time limit.
- Path: index.ts:2985 `setInterval(() => { void pollJobs()... }, 1000)` -> appJobs.ts:120 `await appJobs().settleInterrupted(dir)` (before any Co-Director route check) -> jobNotifications.ts:212-223 `if (live && this.now() - (j.startedAt ?? j.createdAt) < j.deadlineMs) continue ... j.status = 'lost' ... if (live) void this.io.cancel(j)` -> index.ts:1020-1025 cancel -> index.ts:992 cancelRenderJob -> ltxLocal.ts:722 interrupt / enhance.ts:43 cancelEnhance; fx: index.ts:1023 `fx.encodeEnd(j.targetId, false)`. Deadline set at appJobs.ts:74 and appJobs.ts:146.
- Code: appJobs.ts:74 `const j = await appJobs().add({ ...meta, id, projectDir: p.dir, deadlineMs: 2 * 60 * 60_000, cancelId: req?.jobId })`
- Fix idea: do not auto-cancel user-started jobs on a clock (deadline only for Co-Director plan jobs), or start the clock when the job actually gets the GPU and only mark, never cancel.

### C9. Not only reverse.ts: the export, every probe/cut, every AI pass and bake, Sheet Gen and the LoRA weight scan spawn console programs without `windowsHide`
- Severity: LOW
- Status: PROVEN (Node: windowsHide defaults to false, "hide the subprocess console window that would normally be created"; the packaged app has no console of its own)
- Trigger: packaged app: Export a timeline; run an AI matte/depth pass or an Effects export; any render/edit that probes or cuts a video; build a sheet; install a LoRA when the engine is installed.
- What goes wrong: a console window opens for each ffmpeg/python child. For the main export and for fx passes/bakes the window stays up for the whole job; closing it (an obvious reflex for a stray black window) kills ffmpeg and the export/pass fails. The 10-08 audit (D10) listed reverse.ts only.
- Path / sites: export.ts:45 cutSegment, :71 probeVideo, :90 toMp3, :102 toWav24k, :113 normalizeVideo, :134 extractFrame, :177 probeFile, :821 the export itself; fx.ts:61 startEncode (passes + bakes); reverse.ts:25; sheet.ts:148; koan-shared src/main/loraShelf.ts:215 scanWeights (`spawn(py, ['-c', SCAN_PY, file])`). Example route: Export -> 'export:run' index.ts:1815 -> export.ts:821 `const ps = spawn(FFMPEG, args)`.
- Code: export.ts:821 `const ps = spawn(FFMPEG, args)` (no options object)
- Fix idea: pass `{ windowsHide: true }` at every one of these spawns.

### C10. Cleanup deletes the reversed copies of live takes; reversed blocks then play black and silent in the Monitor
- Severity: LOW
- Status: PROVEN
- Trigger: a timeline with a reversed block (Speed/Duration > Reverse); run Cleanup and confirm.
- What goes wrong: reverse.ts keeps each reversed copy next to its take as `<take>.rev.mp4` in renders/. Cleanup's sweep keeps only files in the live set plus `.matte.mp4` / `.depth.mp4` sidecars of live takes; `.rev.mp4` is not exempt, so it is unlinked (hard delete). The Monitor's self-heal only re-runs when the set of reversed files changes, so the block stays black and silent until the timeline is edited or the project reopened; export re-makes the copy (minutes of re-encode for a big take).
- Path: 'project:cleanup' index.ts:1365 -> project.ts:797 cleanupProject -> project.ts:838-846 sweepDirs (renders/ included) -> project.ts:851-854 `const m = f.match(/^(.*)\.(matte|depth)\.mp4$/i)` -> project.ts:872 `if (apply) await unlink(f)`. Copy made at reverse.ts:78 `const out = revFileOf(file)` (= `${file}.rev.mp4`, shared/reverse.ts:4).
- Code: project.ts:852 `const m = f.match(/^(.*)\.(matte|depth)\.mp4$/i)`
- Fix idea: add `rev` to the live-sidecar pattern (send-to-project at project.ts:3851 already treats `.rev.mp4` as a sidecar).

### C11. Export and a Co-Director timeline watch can run at the same time; then the export's Cancel stops the watch instead of the export, and the export's end deletes the watch's effect bakes
- Severity: LOW
- Status: PROVEN (needs the Co-Director's watch_timeline tool running while he exports)
- Trigger: ask the Co-Director to watch the cut (or an approved plan does), and while it prepares the cut press Export; then press the export's ✕, or let the export finish while the watch is still baking/encoding.
- What goes wrong: the UI gates Watch cut behind the export, but the Co-Director tool calls `watchTimeline` directly, which only checks for another watch, never for a running export. With both running: (a) the export ✕ sends 'export:cancel', and main cancels the WATCH whenever one is busy, so the hour-long export he wanted to stop keeps going; (b) when the export ends, `fx.cleanBakes` deletes `exports/.fxbake` wholesale, including the watch's finished bakes, and if a watch bake is still encoding the rm fails, `abortAllJobs()` kills every encoder (also any AI matte/depth pass he has running). The watch fails or reads a broken cut.
- Path: codir.ts:1735 `await watchTimeline(...)` (no export check) -> watchTimeline.ts:19-20 (checks `running` only). Cancel: store.ts:1589-1591 cancelExport -> 'export:cancel' index.ts:1844 `async () => timelineWatchBusy() ? cancelTimelineWatch() : cancelExport()`. End of export: index.ts:1832 `void fx.cleanBakes(proj.dir)` -> fx.ts:145-152 rm, on failure `await abortAllJobs()`.
- Code: index.ts:1844 `ipcMain.handle('export:cancel', async () => timelineWatchBusy() ? cancelTimelineWatch() : cancelExport())`
- Fix idea: one busy flag shared by export:run and watchTimeline (the tool refuses while exporting), and export:cancel cancels the export when one is running.

### C12. Duplicating a project copies its approved Co-Director plan; opening the copy makes the Co-Director carry on in the copy and spend the plan's remaining render allowance a second time
- Severity: HIGH (spends money without a GO in that project)
- Status: PROVEN (code path; needs the renders switch on and a plan that is active or waiting when he duplicates)
- Trigger: Co-Director has an approved, running plan (codirFire on). In the Open window he right-clicks the project > Duplicate, then opens the copy.
- What goes wrong: `project:duplicateAt` copies the whole folder, including `codir-jobs.json` (plan, allowances used so far, awaited jobs). The job pump runs every second for whatever project is open: in the copy, `settleInterrupted` turns the copied in-flight jobs into settled "lost" results, `nextPing` sees an active plan with unseen results (or a saved `next` task) and starts a Co-Director exchange with no GO in that project. `checkAllowance` counts only the copied records, so the copy may submit renders up to the plan's remaining allowance, and the original project still holds the same allowance for when he goes back. Money approved once can be spent twice. (The copy also inherits queue.json, so it offers "N queued renders from last session".)
- Path: Open window Duplicate -> 'project:duplicateAt' index.ts:1285-1295 `await cp(dir, dest, { recursive: true })` -> open copy -> index.ts:2985 job pump -> appJobs.ts:116-137 (settleInterrupted, route, nextPing, exchanges.enqueue('job', ...continue)) -> jobNotifications.ts:275-286 nextPing returns the copied plan -> index.ts:2972-2983 continue -> sendCoDirector(..., 'job', plan.id).
- Code: index.ts:1295 `await cp(dir, dest, { recursive: true }) // media included — a duplicate is a duplicate`
- Fix idea: leave codir-jobs.json (and queue.json, pending-renders.json) out of the duplicate, or mark the copied plan stopped.

### C13. Adding or forgetting a LoRA folder, a first Civitai LoRA download, deleting a Civitai checkpoint, or deleting ACE / MiniMax / H3 kernels kills the local engine even while it is rendering
- Severity: MED
- Status: PROVEN
- Trigger: an LTX, H3 or Krea 2 render is running (minutes). Meanwhile, in the Image Gen sidebar he picks a LoRA folder, forgets one, or downloads a Civitai LoRA whose family has no folder yet (the folder picker opens, then the folder is added); or he deletes a Civitai checkpoint; or in the Models card he deletes ACE-Step, MiniMax Music or the H3 speed kernels.
- What goes wrong: these handlers call `runtime.killEngine(LTX_ENGINE_ID)` (or `killAllWorkers()`) immediately, outside the GPU lock, to make the engine re-read its paths / release files. That taskkills the ComfyUI process in the middle of the running render; the render fails with "the local engine died mid-render (exit 1) — usually a GPU driver reset or out-of-memory", which also points him at the wrong cause. `models:update` already shows the safe pattern (it does its kill inside `runtime.withGpu`).
- Path: 'imagegen:pickFolder' index.ts:2435 -> addLoraFolder index.ts:2425-2433 -> index.ts:2431 `runtime.killEngine(ltxLocal.LTX_ENGINE_ID)` -> runtime.ts:405-418 taskkill /T /F -> ltxLocal.ts:639-640 `if (o.w.ps.exitCode !== null) throw new Error('the local engine died mid-render ...')`. Also 'imagegen:forgetFolder' index.ts:2450, 'imagegen:civitDownload' index.ts:2538 (via addLoraFolder), 'imagegen:civitDelete' index.ts:2621, 'models:delete' index.ts:1982-1985 -> audioLocal.ts:178 / :253, h3Local.ts:162 `runtime.killAllWorkers()`.
- Code: index.ts:2431 `runtime.killEngine(ltxLocal.LTX_ENGINE_ID) // the paths yaml is re-written at the next spawn`
- Fix idea: do the kill inside `runtime.withGpu` (wait for the running job), or just mark the engine stale so `ensureLtxWorker` restarts it before the next job; delete only the worker of the engine being deleted.

### C14. With export fps on "auto", effect spans can be baked at one frame rate and exported at another
- Severity: LOW
- Status: PROVEN (code path; visible only on mixed-fps timelines)
- Trigger: timeline mixing 24 fps renders and a 30 fps (or 60) Library video, export fps left on auto, effects or dissolves on the timeline; especially an in/out range export, or a hidden V track, where the earliest block differs from the first block actually exported.
- What goes wrong: the renderer bakes effect/dissolve spans at the fps `planExport` picks (the first enabled block by start time, any track, ignoring range and hidden tracks), while `exportTimeline` picks the fps of the first video segment it actually exports (in range, visible, topmost). When they differ, every baked span is resampled by `fps=` in the export filter: 24->30 duplicates frames (judder), 30->24 drops them, only inside the effect spans, so the export stutters where the Monitor did not.
- Path: store.startExport -> exportOne -> baker.ts:62 `vd().exportPlan(tl.id)` -> 'export:plan' index.ts:2064 -> export.ts:237-249 planExport fps (first of `[...tl.items].filter(!disabled).sort(startSec)`) -> baker.ts:125-127 frames at that fps -> 'export:run' -> export.ts:543-548 fps from `segs.find(s => s.kind === 'video')` -> export.ts:570 `[bake]setpts=PTS-STARTPTS,fps=${fps}`.
- Code: export.ts:239-246 vs export.ts:545-547
- Fix idea: have exportTimeline use the plan's fps (or compute both from one shared function over the same visible, in-range segments).

### C15. Gemini watch retries a request that timed out on our side, so one slow watch can be billed up to three times
- Severity: LOW
- Status: SUSPECT (missing: whether Gemini bills a generateContent call whose client disconnected at 120 s; amounts are cents per attempt)
- Trigger: Watch cut on a long timeline, or a watch_take/watch_timeline by the Co-Director, where Gemini takes longer than 120 s to answer.
- What goes wrong: `post` aborts the request at 120 s and, because the fetch threw, re-sends the full request (inline video or file reference) up to twice more; each server-side run consumes tokens, none is recorded in the GEM ledger, and after the third timeout the watch falls back to still frames anyway.
- Path: 'watch:timeline' watchIpc.ts:39 -> watchTimeline.ts:46 watchVideo -> watch.ts:171/175 generate -> watch.ts:52-71 post: `catch (e) { if (signal?.aborted) throw e; if (attempt < 2) { await delay(...); continue } ... }`
- Code: watch.ts:54 `const watchdog = AbortSignal.timeout(120_000)`; watch.ts:60-62 retry on any fetch error including the watchdog
- Fix idea: retry only on connection errors before a response, never after the watchdog fired (or raise the watchdog for video calls).

### C16. Re-picking a display for the output mirror orphans the new mirror window: Esc and "off" stop working, playback freezes on it, and the app no longer quits when the main window closes
- Severity: MED
- Status: PROVEN
- Trigger: a second display; Timeline monitor menu > pick the display (mirror opens). Open the menu again and click the same display (it shows ✓) or another display.
- What goes wrong: `openMirror` calls `closeMirror()` (which starts closing the old window and nulls `mirrorWindow`) and immediately assigns the new window to `mirrorWindow`. The OLD window's `'closed'` handler fires afterwards and runs `mirrorWindow = null` plus sends 'mirror:closed', so main forgets the NEW window and the toolbar flips to "off". The new fullscreen frameless window stays on the display: the mirror:state relay skips it (frozen picture), its Esc handler calls `closeMirror()` on null, the menu's "off" calls `closeMirror()` on null, and when he closes the main window `closeMirror()` again does nothing; on Windows `window-all-closed` never fires because the mirror still exists, so the app keeps running (no quit, no save flush) until he Alt+F4s the black window or kills it in Task Manager.
- Path: Timeline.tsx:3676 `vd().mirrorOpen(d.id)` -> 'mirror:open' index.ts:1382 -> openMirror index.ts:710-743: index.ts:713 `closeMirror()` -> index.ts:706-707 `mirrorWindow.close(); mirrorWindow = null` -> index.ts:714 `mirrorWindow = new BrowserWindow(...)`; later the old window's handler index.ts:731-734 `mirrorWindow.on('closed', () => { mirrorWindow = null; mainWindow?.webContents.send('mirror:closed') })` -> App.tsx:394 setMirrorDisplay(null). Quit: index.ts:666-669 main 'closed' -> closeMirror() no-op; index.ts:4118-4120 window-all-closed not reached.
- Code: index.ts:731-734 (the 'closed' handler clears the shared variable instead of checking it is still this window)
- Fix idea: in the 'closed' handler only clear `mirrorWindow` (and send mirror:closed) when `mirrorWindow === thisWindow`.

### C17. Krea 2 image gens never tell the shared engine which model they load, so LTX and Krea 2 models pile up in one warm engine
- Severity: MED
- Status: SUSPECT (missing: a measured run showing ComfyUI keeps both models resident in host RAM on his PC; the code's own comment says a different model on a live worker must restart it, and krea2Local already carries the "Windows ran out of memory loading the model" message from a 2026-09-19 field failure)
- Trigger: render an LTX clip, then a Krea 2 image in Image Gen within 2 minutes (worker still warm), then another LTX clip of the same size (or the reverse order).
- What goes wrong: `ensureLtxWorker` restarts the engine only when the caller's `loadKey` differs from the live one, or the extra args differ. LTX passes `loadKey: ltx:<size>`, H3 passes `h3:<tier>:<enc>` plus its own args, but Krea 2 passes neither, and does not clear `liveLoadKey`. So LTX -> Krea keeps the LTX model loaded while the Krea checkpoint loads on top, and Krea -> LTX (same size) also sees "same key, no restart". The engine accumulates both families' weights, which is the host-RAM stacking the comment at ltxLocal.ts:337-340 describes as a field failure; the job then dies on a model read or OOM with a misleading message.
- Path: 'imagegen:render' index.ts:2379 -> krea2Local.ts:313 `const w = await ltxLocal.ensureLtxWorker((line) => console.log(...))` (no options) -> ltxLocal.ts:343-351 `if (!runtime.hasLiveWorker(...)) liveLoadKey = null; else if ((o.loadKey && liveLoadKey && liveLoadKey !== o.loadKey) || argsKey !== liveArgsKey) { ... killEngine ... }`; LTX side ltxLocal.ts:673 `loadKey: \`ltx:${variant.row}\``.
- Code: ltxLocal.ts:347 `else if ((o.loadKey && liveLoadKey && liveLoadKey !== o.loadKey) || argsKey !== liveArgsKey) {`
- Fix idea: give Krea 2 a load key (`krea:<model>`) like LTX and H3, so switching families restarts the engine.

### C18. Every local render copies its reference files into the engine's scratch folder and nothing ever deletes them (2.4 GB on his PC today)
- Severity: LOW
- Status: PROVEN (measured: I:\APPS\Video Dancer\Data\runtime\envs\ltx-comfy-engine\in holds 869 files, 2.4 GB)
- Trigger: any LTX i2v/ref render, H3 render with refs, or Krea 2 render with ref A/B.
- What goes wrong: each render copies its start image / refs (H3: images, ref videos, ref audio; Krea: ref A/B or a 4 MP working copy) into ComfyUI's input dir under a unique timestamped name. The Krea `finally` says "the worker's in/ dir is scratch — refs are copied fresh every render" but its cleanup line is `void ltxLocal.ltxWorkerScratch()`, which only returns the two paths; LTX and H3 have no cleanup at all. The folder grows forever inside the hidden runtime tree (it does count toward the engine row's size on the Models card).
- Path: ltxLocal.ts:683-692 copyFile into inDir; h3Local.ts:377-389 land(); krea2Local.ts:155-171 stageRef; krea2Local.ts:443-444 `// the worker's in/ dir is scratch ...` + `void ltxLocal.ltxWorkerScratch()`; ltxLocal.ts:383 ltxWorkerScratch returns `{ outDir, inDir }` only.
- Code: krea2Local.ts:444 `void ltxLocal.ltxWorkerScratch()`
- Fix idea: delete the staged names in each render's finally (or empty in/ when the engine spawns).

---

## Earlier audit check (AUDIT-2026-10-08.md Part 1, items in area C, re-traced after my own hunt)

| # | Lead | Verdict | Evidence |
|---|---|---|---|
| 1 | C3 settings wipe (startup caller) | CHANGED | Working tree: `loadRawSettings` now goes through `readSettingsFile` (settingsFile.ts:17-23 throws on anything but ENOENT), `patchSettings` merges onto that read so it refuses instead of writing `{}`; boot call is `void patchSettings({}).catch(() => undefined)` (index.ts:4111), watch-model migration likewise (index.ts:4004). New side effect: C7 (with an unreadable file no project can be opened). |
| 3 | B3 installer ships private source | CONFIRMED | Installed `I:\APPS\Video Dancer\App\resources\app.asar`: 343 .ts/.tsx under node_modules/@koan (179 @koan/shared, 164 @koan/vidancer-ui); `out/main/index.js` contains the draft MOOD texts ("Retro OVA", "90s-dark-fantasy-cgi"). package.json `build.files` has no exclusion for the @koan sources (they ride in as production dependencies). |
| 5 | A7 crash recovery gaps | CONFIRMED | `vedit:run` -> `runV2vEngine` passes no `onRequestId` to runEdit/runRender/runHfRender/runVeniceRender/runGoogleOmniExtend (index.ts:870-925; `EditOpts` has no such field, fal.ts:354-366); `image:generate` (index.ts:3236-3241) and `sheet:build` record nothing. Only render:run, score, voice, enhance call addPending* (index.ts:2222, 2792, 3098, 3458). |
| 7 | D2 Get + Use same filename | CONFIRMED | index.ts:2540-2542: LoRA dest = `join(folder, stem, row.file)`, then `if (existsSync(dest)) return { ok: true, file: dest }`; a different version with the same file name returns the old file. Checkpoints are safe (versionId in the path, index.ts:2526). |
| 9 | E1 LoRA switch vs unleashed | CONFIRMED | index.ts:2365-2366 `const unleashed = r.unleashedOn && unleashedRow ? ... : undefined` is not gated by `r.loraOn` (the user picks are, index.ts:2358). Line moved from 2353 to 2366. |
| 10 | D10 reverse console flash | CONFIRMED, wider | reverse.ts:25 `spawn(FFMPEG, [...])` has no windowsHide; the same gap is in export.ts (8 spawns, including the export itself), fx.ts:61, sheet.ts:148, koan-shared loraShelf.ts:215. See C9. |
| Low C4 | wrong project after a switch | CONFIRMED | main refuses to land results after a switch: render index.ts:3550, vedit 1696, edit 3816, score 2225, voice 2795, imagegen 2395, enhance via assertProjectSession 3103. |
| Low C1 | cleanup blocked by running jobs | CHANGED (partly wrong) | `cleanupProject` refuses while `mediaWrites > 0` (project.ts:799), but `enhance:run` never calls beginMediaWrite (index.ts:3079-3111), so a running Enhance does not block Cleanup. See C1. |
| Low C11 | partial Export As file | CONFIRMED | exportAs.ts:66-69: `copyFile(src, dest)` or ffmpeg writing straight to `dest`; a failure leaves a partial file at the chosen path. |
| Low D4 | mov/mp4 remux | CONFIRMED (edge) | exportAs.ts:47-49 `-c copy` for .mp4/.mov whatever the source codecs (a .webm Library video exported as .mov can fail). |
| Low D11 | waveform cache | CONFIRMED (edge) | wave.ts:19-33 cache keyed by path only, for the session. |
| Low C7 | save error banner | CONFIRMED | index.ts:692 `onSaveFailure((msg) => mainWindow?.webContents.send('project:saveError', msg))`. |
| Low D5 | missing editor exe | CONFIRMED at the index.ts boundary | 'editors:open' catches `editors.startEdit` errors and returns them (index.ts:1435-1441); editors.ts itself is outside my file list. |
| D3 | export vs preview parity | moved to Part 3 in the doc; two concrete parity bugs found here: C6 (range export drops music), C14 (bake fps). |

Not in area C (left to A/B/renderer agents): #2 A1 bridge retry, #4 A2 cancelled parked row, #6 A6 Image Edit variant loss (falImage.ts), #8 A4 spend in the wrong project, Open B2, A3, A5, A8, A9, B1, B4, B5, C2, C5, C6, C8, C9, C10, D1.

## Coverage

Read in full: `src/main/index.ts` (all 4,120 lines, plus the uncommitted diff), `src/preload/index.ts` (every channel cross-checked against main handlers both ways: all 300+ match; every `vd().x` call in vidancer-ui exists in the preload), `runtime.ts`, `ltxLocal.ts`, `krea2Local.ts`, `h3Local.ts`, `audioLocal.ts`, `export.ts`, `exportAs.ts`, `reverse.ts`, `fx.ts`, `wave.ts`, `watch.ts`, `watchIpc.ts`, `watchTimeline.ts`, `settingsFile.ts`, `storageLocation.ts`, `updater.ts`, `appJobs.ts`, `src/renderer/src/bridge.ts`, `src/renderer/src/main.tsx`, koan-shared `src/index.ts`, `src/types.ts`, `src/main/index.ts`, `src/main/lorasIpc.ts`, `src/main/loraShelf.ts`, `src/renderer/bridge.ts`.

Read in part (to trace a caller across a boundary): `enhance.ts` (cancel, runFal, runEnhance, runDepth, preview), `jobNotifications.ts` (read/save/add/execute/finish/settleInterrupted/nextPing), `project.ts` (media-write guard, cleanupProject, addEnhancedCopy, importClipsFrom), `fal.ts` (fetchRenderResult, upload cache, runEdit head), `scoreRender.ts` / `voiceRender.ts` cancel, `providers/astria.ts` + `venice.ts` cancel, `moods.ts` SHIPPED list, `log.ts`, `codir.ts` watch tools; vidancer-ui `store.ts` (queue runner, cancel, renderNow, exports, project open), `fx/baker.ts`, `panels/VideoEditor.tsx` run, `panels/Monitor.tsx` reverse + music, `panels/SpeedModal.tsx`, `panels/WatchTimelineModal.tsx`, `panels/Timeline.tsx` mirror menu, `shared/providerLimits.ts`, `shared/reverse.ts`, `lib/timelineUtils.ts` srcAtRel.

Skimmed only: koan-shared `src/renderer/*.tsx` (LoraShelf, LoraPicker, Dropdown, ContextMenu, FloatPick, Section, AspectGlyph, icons, tokens): UI components, only their bridge calls checked.

Checked on his install (read only): `I:\APPS\Video Dancer\Data\logs\main.log` (start lines), `...\Data\runtime\envs\ltx-comfy-engine\in` (C18 size), `...\App\resources\app.asar` listing (item 3).
