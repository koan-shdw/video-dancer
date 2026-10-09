# A. Saving and files: audit findings

Working tree audited as-is (includes uncommitted settingsFile.ts fix). Read and search only.

### A1. One failed read of spend.json wipes the whole money ledger on the next paid job
- Severity: HIGH (the per-project money record is overwritten)
- Status: PROVEN (the code path; the read failure itself needs a lock or damaged file, same trigger class as the settings bug)
- Trigger: a paid render / edit / image / watch finishes while spend.json is briefly locked (scanner, cloud sync) or damaged (e.g. a crash during swapIn's in-place fallback write).
- What goes wrong: readSpend returns [] on ANY error, addSpend pushes the new entry onto that [] and atomically writes it over spend.json. Every earlier entry is gone; the Spend panel total restarts from this one job. Same shape as the settings wipe.
- Path: renderer store.ts:2448 `void get().addSpend(...)` (also store.ts:2485, watch.ts:103, watch.ts:162) -> store.ts:1479 `vd().spendAdd(entry)` -> preload index.ts:79 `ipcRenderer.invoke('spend:add', entry)` -> index.ts:1353 `ipcMain.handle('spend:add', ... addSpend(entry))` -> project.ts:729 `const entries = await readSpend(dir)` -> project.ts:713-719 -> project.ts:733-734 write.
- Code:
  - project.ts:715-718 `const raw = JSON.parse(await readFile(spendPath(dir), 'utf-8')) ...` / `} catch { return [] // no ledger yet (or unreadable) — start empty }`
  - project.ts:730-734 `entries.push({...}); ... await writeFile(tmp, spendJson); await swapIn(tmp, spendPath(dir), spendJson)`
- Fix idea: use the settingsFile.ts rule here too: ENOENT reads as [], anything else retries then throws, and addSpend refuses to write.

### A2. Four deletes erase the files at once while the dialog promises "undoable — Ctrl+Z"; undo brings back entries with no files
- Severity: HIGH (paid v2v edits, paid image edits and generated images permanently deleted; undo gives back empty shells)
- Status: PROVEN
- Trigger (any of):
  1. Bin right-click on an Image Gen > delete > dialog "Delete "X" and its N takes? Library copies survive. (undoable — Ctrl+Z)" > Delete > Ctrl+Z.
  2. Image Gen panel: trash on a job, or right-click a take > delete take (no undo note, but Ctrl+Z is offered app-wide).
  3. Video Editor: delete a node > dialog "Renders are removed from disk (baked copies survive). (undoable — Ctrl+Z)" > Ctrl+Z.
  4. Image Editor: delete a branch (no confirm at all) > Ctrl+Z.
- What goes wrong: each main function unlinks the media files right away, against the project's own rule ("media files are never deleted by mutations, so restoring a snapshot is always valid", project.ts:91-92). Undo restores the metadata from the snapshot, so the job / takes / tree nodes come back pointing at files that no longer exist (not in the Recycle Bin either: fs.unlink). Saved states (checkpoints) that hold those takes break the same way, even though cleanupProject goes out of its way to protect checkpoint and undo-history media. Worse case for the trees: node A was the image's / video's primary face, he picks node B as primary, then deletes A's branch (allowed, A is no longer primary); Ctrl+Z twice puts img.file / vid.file back on A's deleted file, so a Library image or video that clips use as a ref goes missing.
- Path:
  1. Bin.tsx:572-574 `confirmDialog(... (undoable — Ctrl+Z) ...)` -> store.ts:2129-2130 `vd().imageGenDelete(id)` -> preload `'imagegen:delete'` -> index.ts:2329 -> project.ts:4388 `for (const t of g.takes) if (!t.keptImageId) await unlink(t.file)`
  2. ImageGen.tsx:907 / 991 -> store.ts:2126-2127 `vd().imageGenTakeDelete` -> `'imagegen:takeDelete'` -> index.ts:2328 -> project.ts:4378 `if (!t.keptImageId) await unlink(t.file)`
  3. VideoEditor.tsx:320-322 `confirmDialog(... Renders are removed from disk ... (undoable — Ctrl+Z))` -> `vd().veditDeleteBranch` -> `'vedit:deleteBranch'` -> index.ts:1733 -> project.ts:3396-3398 `await unlink(n.file)`
  4. ImageEditor.tsx:646-652 -> store.ts:2515-2516 `vd().imageDeleteBranch` -> `'image:deleteBranch'` -> index.ts:3312 -> project.ts:3444-3446 `await unlink(n.file)`
  Undo: Ctrl+Z -> preload projectUndo `'project:undo'` -> index.ts:1357 -> project.ts:507-517 `current = JSON.parse(prev)` (metadata only).
- Code: project.ts:91-92 `media files are never deleted by mutations, so restoring a snapshot is always valid`; project.ts:3163-3164 / 3365-3366 (primary face = node.file).
- Fix idea: keep the files on delete like every other delete (cleanupProject already reclaims unreferenced media, and it protects undo history and checkpoints).

### A3. Deleting a Library music track leaves its blocks on every timeline, and the "it's on N timelines" warning never shows
- Severity: MED
- Status: PROVEN for the mechanics; what a dangling A block then does in playback/export is SUSPECT (not traced, other area)
- Trigger: Library > right-click a music track that sits on a timeline's A lane > delete.
- What goes wrong: since the v20 migration a timeline's music is an A-lane block `{ source: { audioId } }`; `tl.music` no longer exists. The Library counts uses with `t.music?.audioId`, so usedBy is always 0 and the confirm ("delete it and clear it there?") is skipped. Main's deleteAudio also only clears `tl.music`, so the track leaves the Library but its A blocks stay on the timelines pointing at an id that is gone. The multi-select delete (deleteSelection.ts:25) handles this correctly; the single-track menu path does not.
- Path: Library.tsx:40 `const usedBy = useMemo(() => (tlsForUse ?? []).filter((t) => t.music?.audioId === a.id).length` -> Library.tsx:101-102 `if (usedBy === 0 || ...) void deleteAudio(a.id)` -> store.ts:1552-1553 `vd().audioDelete(id)` -> preload `'audio:delete'` -> index.ts:1602 -> project.ts:2626-2635
- Code: project.ts:2631-2633 `for (const tl of current.timelines) { if (tl.music?.audioId !== audioId) continue; tl.music = undefined`; migration that removed tl.music: project.ts:273-293.
- Fix idea: route the single delete through removeSelectedAssets (deleteSelection.ts) and count uses from audioItems.

### A4. Clip editor, Style editor and Image Gen prompt drop the last edit when you switch item or project within 0.4-0.6 s (no flush, unlike their siblings)
- Severity: MED (his last edit to a recipe silently never saves)
- Status: PROVEN
- Trigger: in the Clip editor, change something (pick an engine, drop a ref image, type) and click another clip in the Bin within 600 ms. Same for the Style editor (double-click another style, 600 ms) and the Image Gen prompt box (open another gen, 400 ms). Switching project in that window, or closing the app, loses it too.
- What goes wrong: the autosave is a debounced effect whose cleanup CLEARS the pending timer. Selecting another clip/style changes the effect's deps, so React runs the cleanup first and the save for the item he just edited is cancelled; the load effect then fills the form with the new item. The edit exists nowhere. CharSheet, ScoreCard, VoicesCard, SfxCard and EffectsPanel already flush on switch/unmount for exactly this reason (CharSheet.tsx:196 "edits debounce-save and flush on switch/close"); these three were left out. Nothing anywhere flushes on window close (no beforeunload/pagehide handler in the renderer; main's before-quit only waits for saves already sent).
- Path:
  - RenderPanel.tsx:1123-1141: `const t = window.setTimeout(() => { ... void saveClipPromptData(id, payload) ... }, 600); return () => window.clearTimeout(t)` with `selectedClipId` in the deps; RenderPanel.tsx:740 `loadingRef.current = true` then the next run returns early.
  - StyleSheet.tsx:90-101 same shape, deps include `editorStyleId`; resetPlayback (store.ts:677 `editorStyleId: null`) on every project switch.
  - ImageGen.tsx:176-184: switching gens changes `r?.prompt`, which runs `window.clearTimeout(promptTimer.current)` and drops the pending `patch({ prompt: v })` from ImageGen.tsx:217-223.
  - Quit: index.ts:3957-3974 waits only for `pendingSaves()` (main's queue); renderer timers die with the window.
- Fix idea: flush instead of clear (the CharSheet/ScoreCard pattern), and flush all pending drafts on window close before main's before-quit save wait.

### A5. A Co-Director brief typed just before a project switch is written into the NEW project's brief
- Severity: LOW (overwrites the other project's brief; undoable there, but silent; needs a switch inside 600 ms)
- Status: PROVEN (code path); timing-dependent trigger
- Trigger: type in the Co-Director brief box, then within 600 ms open another project (header recents ▾ > a project).
- What goes wrong: the Co-Director panel stays mounted across a project switch and its brief timer is only reset by brief keystrokes, so it still fires after the switch. briefDirty is true, so the new project's brief never replaces the draft in the box, and the timer sends the OLD project's text. Main's codirSetBrief writes into whatever project is open (no expectedDir check, unlike codirAppend at project.ts:1054-1055), saving A's brief over B's. A also loses that last edit.
- Path: CoDirector.tsx:87-98 `if (!briefDirty.current) setBriefDraft(brief)` / `const t = window.setTimeout(() => { briefDirty.current = false; void vd().codirSetBrief(briefDraft)... }, 600)` (deps `[briefDraft]` only) -> preload index.ts:441 `codir:setBrief` -> index.ts:3033 -> project.ts:1062-1066 `current.codir.brief = brief; await saveProject()`.
- Fix idea: send the brief with its project dir and refuse a mismatch (as codirAppend does), and flush the draft when the project changes.

### A6. A local (LTX / H3) render that finishes after a project switch is never added, though the message says it will be
- Severity: MED (minutes of GPU work become an orphan file; the app tells him it will come back)
- Status: PROVEN
- Trigger: start a local LTX or H3 render in project A, open project B while it runs (nothing blocks a switch; guardCodirSwitch only checks the Co-Director).
- What goes wrong: when the render finishes, main sees the project changed and returns "the video is saved and will be added automatically next time you open A". That promise rests on the pending-renders.json entry, but the local branch never writes one (no onRequestId, by design: "NO pending entry"). Reopening A adds nothing. The mp4 sits unreferenced in A/renders/, so Project > Clean up will delete it. The renderer also writes a "(finished after project switch)" spend row into B's ledger (and for paid engines the real cost lands in B's ledger, never A's; recovery in A adds no spend).
- Path: store.ts:2381 `vd().render(...)` -> preload `render:run` -> index.ts:3390 -> local branch index.ts:3462-3513 (`ltxLocal.renderLtxClip({...})` / `h3Local.renderH3Clip({...})`, no `onRequestId`) -> index.ts:3550-3551 `if (getProject()?.dir !== proj.dir) return { ok: false, billed: true, error: \`project changed during render — the video is saved and will be added automatically next time you open "${proj.name}".\` }` -> store.ts:2484-2485 `addSpend({ label: \`${job.label} (finished after project switch)\` ...})` into the now-open project (project.ts:726-727 uses `current.dir`).
- Code: index.ts:3463-3464 `// the score:render local shape: no key, NO pending entry (nothing billed ...`
- Fix idea: for provider 'local', land the take into A's project.json the way sendAssetsTo writes a closed project (or block the switch / say plainly where the file is, as edit:run and score:render do).

### A7. Sheet build and cross-project clip import write into whatever project is open (or into a discarded copy) when they finish
- Severity: MED (results land in the wrong project, or are shown but never saved)
- Status: PROVEN for both paths; the trigger is a project switch or Ctrl+Z during the seconds they run
- Trigger:
  1. Sheet Gen > build sheet on a take (ffmpeg pulls five views, several seconds) > meanwhile open another project.
  2. Bin > import clips from another project (copies every take, seconds to minutes; the button shows "importing…") > meanwhile press Ctrl+Z on an earlier edit, or open another project.
- What goes wrong:
  1. buildSheetFromTake reads `current` again after the long `await harvestTake(...)` with no session check, so the folder and six images (files inside A/images/) are pushed into project B and saved there; A never gets its sheet. In B the tiles point outside B's folder, which media:// refuses. The appJobs wrapper only checks the project BEFORE the run (jobNotifications.ts:119).
  2. importClipsFrom builds the copier with `dest = current` before the copies. Undo/redo replaces `current` with a new parsed object (project.ts:511 / 523), and a project switch replaces it too, so `cp.commit()` pushes the clips into the abandoned object, and `saveProject()` saves the live project without them. The delta still goes back to the renderer, which shows the clips (Bin.tsx:1034 `applyDelta(res.delta)`, no project check in applyDelta store.ts:1096-1101). They exist only on screen: edits to them return null, and after a restart they are gone. The copied media sits orphaned (and Clean up deletes it).
- Path:
  1. SheetGen.tsx:220 `vd().sheetBuild(...)` -> preload index.ts:380 `sheet:build` -> index.ts:3347-3352 -> project.ts:2134-2136 `await mkdir(...); const r = await harvestTake(take.file, mode, join(current.dir, 'images'), stem, pick)` -> project.ts:2149 `current.folders = [...]` / 2157 `current.images.push(...added)` / 2158 `await saveProject()`.
  2. Bin.tsx:1032 `vd().importClips(...)` -> preload index.ts:365 `import:clips` -> index.ts:3325-3327 -> project.ts:4086 `const cp = makeAssetCopier(src, current)` -> 4087 `for (const c of cp.mintClips(clipIds)) await cp.copyClip(c)` -> 4088 `cp.commit()` (pushes into the captured `dest`, project.ts:4059-4063) -> 4089 `await saveProject()` (saves `current`).
- Fix idea: capture the session (captureProjectSession) before the long await and assertProjectSession after it, and have commit target the live `current` after that check, the way importImage / importVideoFiles / addEnhancedCopy already do.

### A8. Assembly Concept / Assemble that finish after a project switch write into the other project
- Severity: MED (the other project's outline is overwritten, or it gets a new active timeline full of clip ids it does not have)
- Status: PROVEN
- Trigger: Assembly panel > Assemble (watches every take with Gemini, minutes) or Concept (one LLM call) > open another project while it runs. The panel's busy flag is local; guardCodirSwitch only looks at codirRun.busy, so nothing stops the switch.
- What goes wrong: both functions read `p = getProject()` once, await the long work, then write through project.ts functions that act on whatever `current` is now. Concept: `setAssembly({ outline, locked: false, log })` replaces project B's outline and unlocks it. Assemble: `addTimeline(...)` creates a timeline in B, `setTimelineItems` fills it with A's clip/take ids (dangling in B), `setActiveTimeline` makes it B's active timeline, `setAssembly({ timelineId })` points B's assembly at it. A gets nothing; the Gemini watches were paid (watch.ts:103/162 then skip the spend row because the session changed).
- Path: Assembly.tsx:76 `vd().assemblyAssemble()` -> `assembly:assemble` -> index.ts:3695-3698 (registerJobIpc: project checked only before the run, jobNotifications.ts:119) -> assembly.ts:69 `const p = getProject()` -> 95 `await watchVideo(...)` per take -> 107 `await runSubCalls(...)` -> 122 `await addTimeline(...)` -> 138-140 `setTimelineItems` / `setActiveTimeline` / `setAssembly` (project.ts:1992-2003, 1786-1810, 2077-2083, 1070-1076, all on `current`). Concept: Assembly.tsx:58 -> index.ts:3689-3693 -> assembly.ts:29 / 49 `await runSubCalls` / 54 `await setAssembly(...)`.
- Fix idea: capture the project session at the start and assert it before the writes (the render:run pattern), or pass the expected dir into setAssembly/addTimeline.

### A9. save_mood and dropping a .vmd overwrite an installed MOOD of the same name without asking (no undo, the library is outside the project)
- Severity: MED (his hand-edited MOOD text is replaced for good)
- Status: PROVEN
- Trigger: (a) the Co-Director's save_mood with a name whose slug matches an installed MOOD (e.g. "KOAN", "SHDW", his own drafts); (b) dropping or ⇪-adding a .vmd / vmd-.md whose slug matches an installed MOOD.
- What goes wrong: both paths `writeFile` straight over `<slug>.vmd`. The other two install paths refuse a same-slug file unless told (installVmd: "replaced only when told"; importSkill: "an edited .vmd is never lost to an import"). The MOODS library lives in userData/moods, not in project.json, so Ctrl+Z cannot bring the old text back.
- Path: (a) codir.ts:1739-1750 `case 'save_mood': ... await saveMood({...})` -> moods.ts:400-404 `const slug = slugOf(input.name) ... await writeFile(join(d, \`${slug}.vmd\`), text, 'utf-8')`. (b) preload `mood:importPaths` / `mood:import` -> index.ts:3652-3660 -> moods.ts:449-451 `await writeFile(join(d, \`${slug}.vmd\`), text, 'utf-8')`.
- Code (the guard the others have): moods.ts:430-431 `const replaced = existsSync(file); if (replaced && !replace) throw new Error(...)`; moods.ts:470-471 same.
- Fix idea: give saveMood and importMoodPaths the same existsSync + replace guard (or write a .bak first).

### A10. One failed read wipes his Co-Director learned rules (save_rule) or his personal guide edits (update_guide)
- Severity: HIGH (his saved rules / hand-edited guide text overwritten; same shape as the settings wipe)
- Status: PROVEN (code path); trigger needs a read failure on an existing file (scanner / sync lock, or a file damaged by a cut non-atomic write)
- Trigger: he tells the Co-Director "remember this" (save_rule), or it edits a prompting guide (update_guide), while learned.md / the personal guide copy cannot be read for a moment.
- What goes wrong:
  1. readLearned returns [] on any read error; appendLearned then writes `[...[], newRule]`, so learned.md is replaced by a single rule. Every earlier rule is gone.
  2. readGuideText falls back to the BUNDLED DEFAULT when his personal copy exists but can't be read; updateGuideText edits that default (append mode, or an old_text that is also in the default) and writeGuideText writes it over his personal copy. His own guide edits are gone.
  Both writes are plain writeFile (not tmp+rename), so a crash mid-write also leaves a truncated file that the next save then makes permanent.
- Path:
  1. Co-Director tool `save_rule` -> codir.ts:2237-2239 `await appendLearned(rule)` -> guides.ts:175 `const rules = await readLearned()` -> guides.ts:90-97 `try { return (await readFile(f, 'utf-8'))... } catch { return [] }` -> guides.ts:177 `await writeLearned([...rules, clean])` -> guides.ts:101-103 `await writeFile(LEARNED_FILE(), ...)`.
  2. Co-Director tool `update_guide` -> codir.ts:2232-2235 -> guides.ts:207 `const cur = await readGuideText(id)` -> guides.ts:67-74 `if (existsSync(f)) { try { return lf(await readFile(f, 'utf-8')) } catch { /* unreadable → default */ } } return entry(id).def` -> guides.ts:213/215 `next = cur.trimEnd() + ...; await writeGuideText(id, next)` -> guides.ts:79 `await writeFile(customGuideFile(id), text, 'utf-8')`.
- Fix idea: the settingsFile.ts rule (ENOENT = empty/default, anything else retries then throws and the tool reports an error), plus tmp+rename writes.

### A11. The settings fix still leaves a read-as-{} path: lists rebuilt from loadSettings() can be written over the real ones once the file reads again
- Severity: LOW (needs a settings read that fails all 8 retries, ~3.8 s, then succeeds a moment later; damaged JSON is safe because the patch throws too)
- Status: PROVEN (code path); the trigger is a long transient lock
- Trigger: settings.json is held by a scanner/sync client for longer than the retry window while (a) the window boots (renderer loads settings once), or (b) he opens / removes / duplicates a project.
- What goes wrong: loadSettings() still returns {} on failure (index.ts:528-541, with a one-time dialog). Callers that build a WHOLE list from that {} and send it through patchSettings replace the saved list as soon as patchSettings' own raw read succeeds:
  - main noteRecent: `recentProjects: [dir, ...[]]` (index.ts:1116-1119) wipes the Open window's full project list; project:removeRecent writes `projectFolderOf: withoutFolderOf({}, dir)` = {} (index.ts:1323-1325), wiping every Open-window folder assignment.
  - renderer, loaded once at boot from `settings:get` (index.ts:1042 -> loadSettings): workspaces (App.tsx:687-700, then addWorkspace/rename/delete write `workspaces: next` App.tsx:643-684), Open-window folders (App.tsx:313-346 `projectFolders: next` / `projectFolderOf: nextOf`), render ETA stats (store.ts:2405-2408 `renderStats: get().renderStats`).
- Path (main example): Open picker > open project -> preload projectOpenPath `project:openPath` -> index.ts:1212-1216 -> 1117 `const s = await loadSettings()` ({} after the retries fail) -> 1119 `await patchSettings({ lastProjectDir: dir, recentProjects: list })` -> index.ts:550 merges onto the now-readable raw file and writes.
- Fix idea: let these read-modify-write callers use loadRawSettings (which throws) inside the settings lock, i.e. a patchSettings variant that takes an updater `(raw) => patch`, and have the renderer not persist list settings it never loaded.

### A12. When a settings save is refused, project Open/New has already switched the project in main but the window keeps the old one
- Severity: LOW (rare: needs settings.json unreadable at that moment; with a damaged file from launch it means every Open/New silently does nothing, no toast)
- Status: PROVEN (code path); trigger = settings unreadable at that moment (the new fix makes patchSettings throw on purpose; mid-session it needs a lock outlasting both retry rounds, ~7.6 s)
- Trigger: settings.json unreadable (damaged, or locked past the retries) while he opens or creates a project with another project already on screen.
- What goes wrong: the handlers switch `current` first (openProject / newProject), then `await noteRecent(...)`, whose patchSettings now throws SettingsUnreadable. The IPC rejects, so the renderer's openPath/openProject/createProject never runs `set({ project: p })` (store.ts:1437-1470 has no try/catch; the rejection is unhandled and no toast shows). The window still shows project A while main's `current` is B: every id-based edit he makes on A (recipes, takes, timeline writes) finds nothing in B and returns null, so it is silently not saved; writes keyed on "the open project" (brief, assembly, new clips, renames) land in B.
- Path: store.ts:1461-1463 `const p = await vd().projectOpenPath(dir)` -> preload `project:openPath` -> index.ts:1212-1216 `const p = await openProject(dir); if (p) { await noteRecent(p.dir) ...` -> project.ts:562-571 (`current = p; projectSession++`) -> index.ts:1116-1119 noteRecent -> index.ts:546-550 `encryptSecrets({ ...(await loadRawSettings()), ...patch })` -> settingsFile.ts:23 `throw new SettingsUnreadable(...)`. Same for `project:open` (index.ts:1195-1197) and `project:createAt` (index.ts:1167-1168).
- Same shape, smaller: the action is done, then a settings patch throws and the UI reports failure: `project:deleteAt` (index.ts:1333 trashes the folder, then 1334-1339 patchSettings throws -> "delete failed" while the project is in the Recycle Bin and still listed), `project:duplicateAt` (index.ts:1295 copies, 1308 throws), `editors:open` (index.ts:1436 launches the editor and records the watch, 1437 throws -> error shown while Photoshop opens).
- Fix idea: treat the recents/last-used notes as best-effort (`.catch` and log) so the action completes, or write them before the irreversible step.

### A13. A timeline edit made while the previous one is still saving is thrown away without a word (rapid , / . nudges, quick successive gestures, a slow or locked disk)
- Severity: MED (his edit visibly snaps back or never happens; only main.log says why)
- Status: PROVEN (code path); how often depends on save time (ms on a fast disk, up to ~5.7 s while swapIn waits out a sync lock)
- Trigger: press "." five times quickly to nudge a block five frames (or hold it), or make a second timeline gesture right after the first, or edit while project.json is held by a sync client.
- What goes wrong: every timeline write sends the renderer's current `rev` as baseRev. Main bumps `rev` but returns the delta only AFTER `await saveProject()` finishes the disk write, so until then the renderer still holds the old rev and the old items. The next gesture is computed from that old state with the old rev; main rejects it as stale ("stale ... write rejected", console only) and returns the authoritative timeline, which the renderer applies. Five quick nudges move the block one frame; a second drag inside the window snaps back. No toast, no error.
- Path: Timeline.tsx:2976-2989 nudgeSel -> `const cur = freshItems()` (store state, Timeline.tsx:2177) -> landVideo Timeline.tsx:2428 `await useStore.getState().setTimelineAll(...)` -> store.ts:1917-1922 `const baseRev = p.timelines.find(...)?.rev ?? 0; get().applyDelta(await vd().timelineSetAll(targetId, items, audioItems, scoreItems, baseRev))` -> preload `timeline:setAll` -> project.ts:1837-1840 `if (baseRev != null && baseRev !== (tl.rev ?? 0)) { console.warn(...stale combined write rejected...); return { timelines: [tl] } }`; the accepted write's delta waits on project.ts:1852 `await saveProject()` (-> project.ts:443-446 writeFile + swapIn, fileSave.ts:44-55 retries up to ~5.7 s).
- Fix idea: return the delta (new rev) as soon as the in-memory mutation is done and let the save complete in the chain, or have the renderer queue timeline writes and rebase each on the last result.

### A14. Once project saves are failing, closing the window leaves an invisible Video Dancer process that blocks every relaunch (and Open/New silently do nothing)
- Severity: MED (the app will not start again until the process is killed in Task Manager; the unsaved edits die with it)
- Status: PROVEN (code path)
- Trigger: the open project's folder stops being writable while the app runs: he renames, moves or deletes the project folder in Explorer (the app holds no handle between saves, so Windows allows it), the drive goes away, or the disk fills. Any edit after that fails to save (the SAVES FAILING banner shows). Then he closes the window with X.
- What goes wrong:
  1. Quit: the window is already destroyed (`mainWindow = null` on 'closed'), 'window-all-closed' calls app.quit(), before-quit cancels the quit and retries the save; the retry fails, so the handler resets and calls `mainWindow?.show()` on null. No window, no quit: the process stays alive holding the single-instance lock. Every later launch hits `requestSingleInstanceLock()` false and quits, and the running instance's 'second-instance' handler does nothing because mainWindow is null. To him: Video Dancer no longer opens.
  2. Open / New while saves fail: openProject / newProject first `await saveProject()`, which rejects again, so the IPC rejects; store.ts openPath/openProject/createProject have no catch, so nothing happens and no reason is shown (New Project stays on "Creating…").
- Path:
  1. index.ts:666-669 `mainWindow.on('closed', () => { mainWindow = null ...` -> index.ts:4118-4119 `app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })` -> index.ts:3957-3973 `e.preventDefault() ... void pendingSaves().catch(() => saveProject()).then(() => { quitSavesFlushed = true; app.quit() }).catch(() => { quitSavePending = false; mainWindow?.show() })` -> relaunch: index.ts:3943-3951 `if (!app.requestSingleInstanceLock()) { app.quit() }` / `app.on('second-instance', () => { if (mainWindow) {...} })`.
  2. store.ts:1461-1463 -> `project:openPath` -> index.ts:1214 -> project.ts:563 `if (saveFailing) await saveProject()` (rejects, project.ts:452-457 rethrows).
- Fix idea: when no window is left, ask once (save elsewhere / quit without saving) or recreate the window before showing; let 'second-instance' create a window when none exists; give Open/New a catch that says saves are failing.

### A15. Undo/redo leave the history switched off if their save fails, and drop any edit that lands during their save from the history
- Severity: LOW
- Status: PROVEN (code path); needs a failing save during Ctrl+Z, or an IPC edit landing during undo's disk write
- Trigger: Ctrl+Z / Ctrl+Y while saves are failing (see A14's triggers), or an edit/backfill arriving in the few ms undo's save is on disk.
- What goes wrong: undo/redo set the global `restoring = true`, then `await saveProject()`, then `restoring = false` with no try/finally. If the save rejects, `restoring` stays true for the rest of the session: every later saveProject skips history (no undo steps recorded, lastSnapshot frozen, redo never cleared) and dynamic stills stop reconciling. Even when the save succeeds, any other saveProject that runs during that await (a take-duration backfill, a debounced form save) also sees `restoring` and is not recorded, so the next Ctrl+Z jumps over it.
- Path: preload projectUndo `project:undo` -> index.ts:1357 -> project.ts:507-517 `restoring = true; await saveProject(); restoring = false` (same project.ts:519-529 for redo) -> project.ts:429 `if (!restoring) { ...undoStack.push... lastSnapshot = cur; scheduleDynamicReconcile() }`.
- Fix idea: try/finally around the save, and pass "don't record" as an argument to saveProject instead of a module-wide flag.

### A16. Project > Clean up deletes the reversed copies (.rev.mp4) of live takes
- Severity: LOW (re-made on export; the Monitor shows the reversed blocks black until the timeline changes)
- Status: PROVEN
- Trigger: a timeline has a reversed block (list 51), then Project controls > Review unused files > Delete.
- What goes wrong: cleanup protects a live take's derived sidecars only by the regex `.(matte|depth).mp4`; `<take>.rev.mp4` sits in renders/ next to the take, is referenced by nothing in project.json, and is counted and unlinked as "unused" (the dialog says "Nothing in the project ... uses them"). The Monitor makes reversed copies only when its `revNeed` string changes, so after the sweep the reversed blocks load a missing file until something on the timeline changes; export re-makes them (minutes at crf 16).
- Path: ProjectControls.tsx:113-118 -> `project:cleanup` -> index.ts:1365 -> project.ts:851-854 `const m = f.match(/^(.*)\.(matte|depth)\.mp4$/i)` -> project.ts:868-874 `if (!st.isFile() || live.has(norm(f)) || liveSidecar(f)) continue ... if (apply) await unlink(f)`. The copy engine already treats `.rev.mp4` as a take sidecar (project.ts:3851).
- Fix idea: add `rev` to the sidecar regex.

### A17. Small per-project ledgers are rebuilt from empty when their read fails, then saved over the file
- Severity: LOW (each is a convenience record, not the work itself)
- Status: PROVEN (code paths); trigger = a read failure (lock or damage) on an existing file
- What goes wrong (same shape as the settings wipe, lower stakes):
  - external-edits/watch.json: editors.ts:135-141 `readLedger ... catch { return [] }` -> startEdit editors.ts:159-161 pushes onto [] and `writeLedger` (plain writeFile, editors.ts:143-146). Every open "edit in Photoshop" watch is forgotten, so edits he already saved there never trigger "a new edit was made, import it?".
  - render-failures.json: codir.ts:1387-1393 `catch { return [] }` -> recordRenderFailure codir.ts:1398-1402 writes `[...[], newRow]`; the failure history the Co-Director reads is gone.
  - queue.json: index.ts:2054-2062 `queue:load ... catch { return null }`, so last session's queued jobs are never offered; the next persistQueueSoon (store.ts:622-633) writes the current queue over them.
- Fix idea: ENOENT = empty, anything else = skip the write (the pending.ts readAll rule, pending.ts:113-117).

### A18. A damaged codir-jobs.json blocks every render, export, crop save and frame save in that project, with no way out in the app
- Severity: LOW (rare trigger; total block of the main workflows when it happens)
- Status: PROVEN (code path); trigger = codir-jobs.json damaged (e.g. swapIn's in-place fallback write cut by a crash, fileSave.ts:56)
- What goes wrong: registerJobIpc registers an app job before running the handler; `appJobs().add` -> `read(dir)` throws "Cannot read job results: ..." on anything but ENOENT and never caches the failure, so every job-registered IPC (render:run, export:run, sheet:build, image:cropSave, library:saveFrame, image:addDynamicStill, assembly...) rejects up front for as long as that project is open. The error names no file and nothing offers to reset it.
- Path: appJobs.ts:66-75 `const j = await appJobs().add({...})` -> jobNotifications.ts:142-145 `state = await this.read(dir)` -> jobNotifications.ts:47-50 `} catch (e) { if (code !== 'ENOENT') throw Error(\`Cannot read job results: ...\`) }`.
- Fix idea: on a damaged record, set it aside (rename to .bad) and start a fresh one, and say so once.

### A19. A settings read that fails at launch moves the models folder to the default for the whole session
- Severity: LOW
- Status: SUSPECT (only matters if he has set a custom models folder in Settings; on his PC Data/models is a junction under the data dir, which IS the default, so likely no effect)
- What goes wrong: modelsRoot reads settings.json once with readFileSync and no retry; any error (a scanner lock at boot, the exact case of the original bug) caches '' and falls back to userData/models for the whole run. With a custom folder set, the Models card then shows installed models as missing, and downloads land in the default folder.
- Path: imagePaths.ts:71-80 `try { root = (JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8'))...).modelsFolder?.trim() || '' } catch { root = '' } root ||= defaultModelsRoot()`; first called at boot: index.ts:4024 `audioLocal.aceBytes()` -> audioLocal.ts:24 `join(modelsRoot(), 'audio', ACE_ID)`.
- Fix idea: read it through readSettingsFile (retries; throws instead of silently defaulting) or after loadSettings.

---

## Earlier audit check (AUDIT-2026-10-08.md Part 1, items in area A), re-traced after the hunt

| # | Lead | Verdict | Evidence |
|---|---|---|---|
| 1 | C3 settings wipe | CHANGED (fixed for the base patchSettings merges onto) | index.ts:519-521 loadRawSettings -> settingsFile.ts:9-25 throws on anything but ENOENT, so patchSettings (index.ts:550) refuses; boot `patchSettings({})` now `.catch`es (index.ts:4111). Residue: loadSettings still returns {} (index.ts:540) and read-modify-write callers can rebuild lists from it (A11); the new throw leaves Open/New half-done (A12). |
| 4 | A2 cancelled parked job returns | CONFIRMED | store.ts:2279-2284 cancel only marks the row and calls persistQueueSoon, which writes only rows of the OPEN project (store.ts:630 `j.projectDir === dir`) to the open project's queue.json (index.ts:2035-2042); the parked row's own project's queue.json keeps it. |
| 5 | A7 crash recovery gaps | CONFIRMED | addPending* is called only by score (index.ts:2222), voice (2792), enhance (3098) and render:run (3458); vedit:run / edit:run / Image Edit / Image Gen online / sheet:build write no recovery entry. |
| 6 | A6 Image Edit variant loss | CONFIRMED | falImage.ts:126-130: results download in a loop and the first failed fetch throws after earlier files were written; nothing adds those to the tree. |
| 7 | D2 Get + Use same filename | CONFIRMED | index.ts:2541 `if (existsSync(dest)) return { ok: true, file: dest }` before any version check. |
| 8 | A4 spend in the wrong project | CONFIRMED, and wider | store.ts:2484-2485 books it into the open project (project.ts:726-727 `current.dir`); also for LOCAL renders whose take is then never recovered (A6). |
| low | C4 wrong project after a switch ("main refuses results once the project changed") | WRONG in part | True for render/score/voice/Image Gen/edits, but sheet:build, import:clips (A7) and assembly concept/assemble (A8) write into whatever project is open; local render:run refuses but promises a recovery that does not exist (A6). |
| low | C1 cleanup | CONFIRMED | project.ts:799 refuses while mediaWrites > 0; project.ts:871 re-checks the live set before each unlink. (New: it deletes .rev.mp4 twins, A16.) |
| low | C2 delete removes an outside file | CONFIRMED (low) | node/take files are app-made under the project (project.ts:3190, 3964) and stored relative (project.ts:151-181). Separate issue: those deletes defeat undo (A2). |
| low | C5 external editor ledger | CONFIRMED (low) | editors.ts:135-146 read-as-[] then plain writeFile (A17). |
| low | C7 save error ("banner shows; next save rewrites") | CHANGED | Worse than an edge case when the failure persists: Open/New silently refuse and closing the window leaves a hidden process that blocks relaunch (A14). |
| low | C10 send to project overwrite | CONFIRMED (not real) | makeAssetCopier names every copy with a fresh UUID (project.ts:3646-3647, 3672-3673, 3691-3692, 3847, 3963-3964). |
| low | C6 failed engine re-download | NOT RE-TRACED | the one-line lead does not say which path; modelStore.ts download/cleanup read in full and nothing found there (it deletes .part on failure, keeps .prev on update). |

## Coverage

Read in full: src/main/project.ts (all 4426 lines), settingsFile.ts, storageLocation.ts, fileSave.ts, deleteSelection.ts, pending.ts, draft.ts, imagePaths.ts, pasteBack.ts, editors.ts, assembly.ts, log.ts, updater.ts, playground.ts, moods.ts, moodsCommunity.ts, guides.ts, loraFolders.ts, modelStore.ts, appJobs.ts, jobNotifications.ts. Renderer: lib/sendToProject.tsx, shared/keepers.ts, lib/keeperUi.tsx, panels/NewProjectModal.tsx, panels/WorkspacesModal.tsx, panels/ProjectControls.tsx, lib/disabledItems.ts, lib/disableEntry.tsx.

index.ts (not in full): settings block 478-570, startup/quit 3930-4120, recovery 252-476, ensureInstallId/key masking 794-1048, projects + recents + picker actions + states + spend + undo 1113-1366, editors 1407-1461, watch/audio 1560-1600, export dirs + export:run head 1744-1830, queue/failures/layout 2032-2077 and 3369-3387, civit download 2530-2570, import/send/organize 3318-3368, render:run 3389-3560, assembly 3689-3699, external-edit check + thumbs 3871-3925; plus a grep of every readFile/writeFile/rename/unlink/rm/cp/trashItem and every loadSettings/patchSettings caller (all 70+ sites listed and the writers checked).

store.ts (not in full): queue persist + switch guards + resetPlayback + restorePatch 600-730, applyDelta 1096-1115, open/create/spend/states 1415-1500, deleteAudio 1552, timeline writes 1888-1925, image gen deletes 2120-2135, cancel/pump 2272-2345, job completion 2380-2541; greps for every setSettings and timer.

Skimmed only: civitai.ts (file I/O lines), pngMeta.ts (read-only parser), preload/index.ts (channel names only), codir.ts (save_mood / guide tools / render-failures only), and the slices of RenderPanel, StyleSheet, CoDirector, ImageGen, VoicesCard, SfxCard, CharSheet, ScoreCard, Bin, Library, VideoEditor, ImageEditor, SheetGen, Assembly, App (workspaces/folders), Timeline (nudge/landVideo), reverse.ts, watch.ts quoted above.
