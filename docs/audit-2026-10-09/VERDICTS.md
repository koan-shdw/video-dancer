# My verdicts (checked in code, 10-09)

## From his reports
- F1 Queue shows nothing while Image Gen renders. PROVEN. ImageGen.tsx:77 module-level `line` + drain() (ImageGen.tsx:302-330) calls vd().imageGenRender directly (imagegen:render, index.ts:2340); never enqueueRender. Queue.tsx:119 reads only store.queue. Image Gen has never been in the Queue (git -S: never used enqueueRender). MED.

## A
- A1 PROVEN (project.ts:713-734 readSpend catch -> [], addSpend writes it). HIGH.
- A2 PROVEN (project.ts:4378/4388/3396/3446 unlink; undo project.ts:507 metadata only; project.ts:91 own rule; dialogs Bin.tsx:573, VideoEditor.tsx:321 say undoable). HIGH. Same as D12, E21.
- A3 PROVEN (Library.tsx:40 counts t.music; migration project.ts:273 deletes tl.music; deleteAudio project.ts:2626 clears only tl.music). MED. Same as D11.
- A4 PROVEN (RenderPanel.tsx:1123-1141 cleanup clears timer, deps incl selectedClipId; StyleSheet.tsx:90-101; ImageGen.tsx:176-184 clearTimeout on job switch). MED.
- A5 PROVEN (CoDirector.tsx:91-98; project.ts:1062 codirSetBrief no dir check, codirAppend has one). LOW.
- A6 PROVEN (index.ts:3463 local NO pending entry; 3550 message promises auto-add). MED.
- A7 PROVEN (project.ts:2136 await harvestTake then writes current; 4086 copier captures current before awaits). MED.
- A8 PROVEN (assembly.ts:69 getProject once, later addTimeline/setTimelineItems/setAssembly on current). MED.
- A9 PROVEN (moods.ts:403 saveMood + 451 importMoodPaths writeFile with no exists check; 430 guard elsewhere). MED.
- A10 PROVEN (guides.ts:90-97 readLearned catch [] then writeLearned; 67-74 unreadable -> default then writeGuideText). HIGH (his rules + guide edits; same class as settings).
- A11 PROVEN code path (index.ts:526-541 loadSettings still {} on failure; noteRecent 1116-1119, removeRecent 1323-1325 rebuild lists from it). LOW (needs >3.8 s lock).
- A12 PROVEN (index.ts:1212-1216 openProject switches then noteRecent -> patchSettings throws via my uncommitted fix). LOW. Same as C7. Blocks committing the settings fix as-is.
- A13 PROVEN (project.ts:1837 stale-rev reject; rev bumped then await saveProject before delta returns). MED.
- A14 PROVEN (index.ts:3957-3973 catch -> mainWindow?.show() when mainWindow null after 'closed' 666; single-instance 3943). MED.
- A15 PROVEN (project.ts:513-515/525-527 restoring flag, no try/finally). LOW.
- A16 PROVEN (project.ts:852 sidecar regex matte|depth only). LOW.
- A17 PROVEN (editors.ts:135-146, codir.ts:1387-1402, index.ts:2054-2062). LOW.
- A18 PROVEN (jobNotifications.ts:47-50 throws on damaged codir-jobs.json). LOW.
- A19 SUSPECT, likely no effect on his PC (imagePaths.ts:14-18 readFileSync once, catch -> default). LOW.

## B
- B1 PROVEN (modelark.ts:120-125 rethrows "error (503) @ modelark/tasks" after 6 poll failures; index.ts:3631 returns {ok:false} no billed; store.ts:2453-2466 busy regex requeues now-lane row = resubmit). HIGH.
- B2 PROVEN in code (runwayMcp.ts:97 THROTTLED in TERMINAL_BAD, :188 throw, :209 recovery 'gone'; bridgeImage.ts:140). Runway docs: THROTTLED = waiting for a concurrency slot. HIGH.
- B3 PROVEN path, money SUSPECT (bridge/index.ts:486-488 took unused for CREDIT_SMELL; bridgeAuto.ts:65 no acceptance check). HIGH. = earlier #2.
- B4 PROVEN (VideoEditor.tsx:32 lists every engine with maxRefVideos; index.ts:900-925 only higgsfield/venice/fal branches, rest to fal runRender). MED.
- B5 PROVEN (index.ts:905-919 common has no onRequestId; venice.ts:161 cancel text promises recovery). HIGH. = earlier #5 (Video Editor recovery).
- B6 PROVEN (jobNotifications.ts:168 failed unless providerAccepted/billed; providerAccepted only index.ts:262 via pending writes; appJobs.ts:105 retryFailed; jobNotifications.ts:193-200 requeues). HIGH.
- B7 PROVEN (spend booked only from renderer store + watch.ts; plan jobs and recovery never book; switch books to open project). MED. = earlier #8 widened.
- B8 PROVEN (store.ts:635-647 offerQueueRestore never checks live queue, resets lastEnqueue guard; persistQueueSoon writes only open project's rows). HIGH. = earlier #4 widened.
- B9 PROVEN (codir.ts:2869-2884 tool loop has no abort check; cancelCoDir 2595 aborts only inflight HTTP). HIGH.
- B10 PROVEN (falImage.ts download loop). LOW. = earlier #6.
- B11 SUSPECT (upload caches keyed by path; depends on per-account media ids). MED.
- B12 SUSPECT timing (queue:save writes getProject().dir). MED.
- B13 SUSPECT (higgsfieldMcp.ts:309 url checked before TERMINAL_BAD at :315; depends on supplier echoing media links). MED.
- B14 PROVEN (index.ts:1010-1013 removePendingEnhance by jobId removes the finished stage too). LOW.
- B15 SUSPECT (bridge adapters resubmit generate after unparsed reply). HIGH if real.
- B16 SUSPECT (ElevenLabs/Google abort; supplier billing unknown). LOW.
- B17 SUSPECT (firePending never cleared on 8 s timeout). LOW.
- B18 SUSPECT (fal client submit retries on 5xx). LOW.
- B19 PROVEN for fal (fal.ts:101-103 cancel false without requestId; nothing stops the upload+submit; store marks cancelled). HIGH.
- B20 SUSPECT timing (index.ts:766 existsSync reuse of fixed temp cut path). MED. Same as C5.
- B21 PROVEN (venice.ts:153 onRequestId(queue_id, veniceModel); index.ts:3458 provider 'mcp'; recovery index.ts:311 routes non-prefixed endpoint to higgsfield). HIGH.

## C
- C1 PROVEN (enhance:run index.ts:3079-3111 no beginMediaWrite; recovery index.ts:271 skips only when hasMediaWrites). MED.
- C2 PROVEN (ltxLocal.ts:723 cancel only knows the sampling job; no remembered cancel like krea2). MED.
- C3 SUSPECT (runtime.ts script worker pipes never drained). MED if real.
- C4 SUSPECT (second launch runs whenReady boot; Electron behaviour unproven). LOW.
- C5 PROVEN code path, timing (index.ts:1655-1659/766 existsSync on fixed cut name; export.ts:50 writes in place). MED. Same as B20.
- C6 WRONG / not reachable. export.ts:551-553 gates on tl.music, but the v20 migration (project.ts:273-293) deletes tl.music on every load and AudioLane only renders when tl.music exists (Timeline.tsx:4459). Music is an A-lane block now. Dead code, not a bug (old music lane code = cleanup item).
- C7 PROVEN = A12 (my uncommitted settings fix makes open/new fail half-way when settings unreadable). MED.
- C8 PROVEN (appJobs.ts:74 deadline 2 h from IPC; jobNotifications.ts:213-223 marks lost + io.cancel for live jobs, every user). MED.
- C9 PROVEN in code (export.ts 8 spawns, fx.ts:61, reverse.ts:25, sheet.ts:148 no windowsHide). OPEN: does he see black windows on export? LOW.
- C10 = A16. LOW.
- C11 PROVEN (index.ts:1844 export:cancel cancels the watch when both run). LOW.
- C12 PROVEN (index.ts:1295 cp whole folder incl codir-jobs.json, queue.json, pending-renders.json; no reset after). HIGH.
- C13 PROVEN (index.ts:2431 killEngine outside withGpu; also forgetFolder, civitDownload, civitDelete, models:delete). MED.
- C14 PROVEN code path, mixed-fps only (planExport vs exportTimeline fps choice). LOW.
- C15 SUSPECT (Gemini watch retries after 120 s timeout; billing unknown). LOW.
- C16 PROVEN (index.ts:731-734 old mirror's 'closed' handler nulls the new mirrorWindow). MED.
- C17 SUSPECT (krea2Local.ts:313 no loadKey; RAM stacking unmeasured). MED if real.
- C18 PROVEN (869 files in engine in/ today; krea2Local.ts:444 cleanup is a no-op). LOW.

## D
- D1 PROVEN (project.ts:946-951 addTake -> saveProject -> undo step 429-435; Ctrl+Z removes the paid take; next edit clears redo; cleanup then deletes the orphan). HIGH.
- D2 PROVEN (project.ts:1895-1902 slice copies volume + fades to both halves unshifted). MED.
- D3 PROVEN (Timeline.tsx:3010 only checks tlFocus; default 'main', reset only on window close App.tsx:790). MED.
- D4 PROVEN per agent trace (drop uses active timeline, not the shown one). MED.
- D5 PROVEN (Timeline.tsx:4060-4064 two writes same baseRev; second rejected stale). MED.
- D6 PROVEN (Timeline.tsx:3978 removeBlock filters video item only). LOW.
- D7 PROVEN (Timeline.tsx:1328 len ignores speed; Monitor.tsx:56 divides by rate). MED.
- D8 PROVEN (store.ts:2014 switch set before main; project.ts:2077-2082 setActiveTimeline saves = undo step + redo wipe). MED.
- D9 PROVEN (SourceMonitor.tsx:295-301 writes in/out only, no clamp/ripple). LOW.
- D10 PROVEN (dragDrop.ts:3 MIME_CLIP = text/plain; Timeline.tsx:2906 any text = clip id). MED.
- D11 = A3. MED.
- D12 = A2. HIGH.
- D13 PROVEN (VideoEditor.tsx selNodeId never reset on root change; 275 sends it). MED.
- D14 PROVEN structure (Assembly.tsx:92 mounts a second MonitorPanel). MED.
- D15 PROVEN (VolumeBand.tsx:385-392 window capture Delete while its selection holds). LOW.
- D16 PROVEN (baker.ts:174/180 ensureVideo by file, transitions key by item id). LOW.
- D17 PROVEN (App.tsx:546 + tlClipboardKeys.ts:18-21 preventDefault on Ctrl+V whenever tlClipboard set). MED.
- D18 PROVEN (store.ts deleteSelectedTlItem no lock check; move path checks). LOW.
- D19 PROVEN (store.ts:2414-2417 adopt only in active timeline). LOW.
- D20 PROVEN (project.ts:1673-1681 syncLinkedAudio re-derives startSec only). MED.
- D21 PROVEN (ImageEditor.tsx:1030-1044 reads MIME_IMAGE only). LOW.
- D22 PROVEN (SourceMonitor no reverse; Timeline.tsx:3966-3975 passes raw reversed in/out to Video Editor = paid v2v on wrong section). MED.
- D23 PROVEN (Bin.tsx:960 skips confirm when no video items). LOW.
- D24 PROVEN (Timeline.tsx:1623-1625 release write uses tl.items from mousedown closure). LOW.

## E
- E1 PROVEN (RenderPanel.tsx:650 selects the new clip; load effect refills form; autosave needs a selected clip). HIGH.
- E2 PROVEN (seed only in component state; setSeed only at 2550 input). MED.
- E3 PROVEN (restoreRecipe ~1401 sets no promptLink/fieldLinks/overrides/charLinks). MED.
- E4 PROVEN (ImageGenSidebar.tsx:447-451 ignores invoke result; early returns send no dlDone). LOW.
- E5 = B17 SUSPECT. MED.
- E6 PROVEN (SheetGen.tsx:262 rename per keystroke, main trims). LOW.
- E7 PROVEN (RenderPanel.tsx:820 / StyleSheet.tsx:87 reload on undoTick; Co-Director writes bump it). MED. Overlaps A4.
- E8 PROVEN (ScoreCard.tsx:283 clamp per keystroke). MED.
- E9 PROVEN (VoicesCard.tsx:229 payload has no recipe; main reads live recipe). MED.
- E10 PROVEN (store.ts:972 queue keeps text only). MED.
- E11 PROVEN (RenderPanel.tsx:1094 filters non-Library files out of saved refs). MED.
- E12 PROVEN (compile.ts:318-329 sequential global replace; traced '@image2 walks toward @image1' + [@image2,@image1] -> '@image2 walks toward @image2'). HIGH.
- E13 PROVEN (RenderPanel.tsx:1154 no !isT2v). LOW.
- E14 PROVEN (SheetGen job has no estCost; nano lane calls imageGenerate directly, no queue/spend). MED.
- E15 PROVEN per agent trace (adopt path strips beats; logic complex, verify when fixing). MED.
- E16 PROVEN (reset list RenderPanel.tsx:1024-1047 has no setVideoRefs/AudioRefs/PromptLink/FieldLinks/Loras/Negative...). LOW.
- E17 PROVEN (store.ts:2092 single slot; weight dropped). MED.
- E18 PROVEN (VoicesCard.tsx:270 engine switch keeps voice id). LOW.
- E19 PROVEN (EnhancePanel.tsx:110 flow forces values; 120 persists enhanceLast). LOW.
- E20 PROVEN (ImageGenSidebar.tsx key read once in [] effect). LOW.
- E21 = A2. HIGH.
- E22 PROVEN code path (h3Local.ts:397 filters by disk only, not family). LOW.

## Merged duplicates
A2 = D12 = E21 (deletes). A3 = D11. A4 + E7 (form autosave). A12 = C7. A16 = C10. B5 = earlier #5. B3 = earlier #2. B8 = earlier #4. B10 = earlier #6. B7 = earlier #8 (+A6 spend part). B17 = E5. B20 = C5.
## Not real
C6 (dead music-lane code).
