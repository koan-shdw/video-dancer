# D. Editing screens audit (timeline, monitors, editors, bins, library, takes, drag and drop)

Audit of working tree 2026-10-09. koan-shared vidancer-ui + vi-dancer main.

### D1. Ctrl+Z after a background render lands deletes the new take record (and redo is lost on the next edit)
- Severity: HIGH
- Status: PROVEN
- Trigger: 1) queue a render (or Optical Flow / enhance) and keep editing the timeline while it runs. 2) The render lands. 3) Press Ctrl+Z to undo your last trim. 4) Make any other edit.
- What goes wrong: undo is one whole-project snapshot per save, and a landing render is a save. Ctrl+Z restores the snapshot taken just before the take was added, so the paid take vanishes from its clip while his trim stays. (When the render was started from a timeline slot, the adoption is one more step: the first Ctrl+Z puts the slot back on its old take, the second removes the take.) The same happens to Enhance / Optical Flow copies, and a take-duration measurement (SourceMonitor.tsx:542 reportTakeDuration -> project.ts:958-964) is also a silent undo step. Any edit after that clears the redo stack, so the take record is gone for good; its file sits orphaned in renders/, where Project Controls' "Delete unused media files" (ProjectControls.tsx:19, "Nothing in the project or its undo history uses them") will then delete it permanently.
- Path: App.tsx:540-543 (Ctrl+Z -> s.undo) -> store.ts:1080-1086 undo -> vd().projectUndo -> main project.ts:507-518 undo() pops undoStack. The take landing pushed that step: project.ts:950-952 `clip.takes.push(take) ... await saveProject()` -> project.ts:429-435 `if (!restoring) { ... undoStack.push(lastSnapshot); redoStack = [] }`.
- Code: project.ts:431-434 `if (lastSnapshot !== null && lastSnapshot !== cur) { undoStack.push(lastSnapshot) ... redoStack = [] }` (no exemption for render landings; only undo/redo and the dynamic-still reconcile set `restoring`).
- Fix idea: record background landings (addTake / enhanced copy / take durations) as non-undoable "derived" writes (like the dynamic reconcile does) and re-apply them onto restored snapshots, or skip them in the undo stack.

### D2. Razor (slice) keeps the whole volume envelope and both fades on both halves
- Severity: MED
- Status: PROVEN
- Trigger: on a clip with sound, ctrl-click volume keyframes on its blue companion (say a dip at 3-4 s) or give it a fade-in/out, then press C and cut the block at 2 s (or Ctrl+K at the playhead).
- What goes wrong: VolumePoint.at is block-local timeline seconds (audioEnv.ts:133 "block-local seconds"; VolumeBand maps at over lenSec). Main's slice copies `volume`, `fadeInSec` and `fadeOutSec` unchanged to both halves. The right half (startSec = 2) now plays the dip at timeline 5-6 s instead of 3-4 s, and it fades in again at the cut; the left half fades out at the cut. The cut point gets an audible dip in playback and export.
- Path: Timeline.tsx:2746-2753 sliceAtTime -> store.ts:1974-1978 sliceItem -> main index.ts:3141 'timeline:slice' -> project.ts:1880-1903 sliceTimelineItem.
- Code: project.ts:1895 `const left: TimelineItem = { ...it, outSec: cutSec, transitionOutSec: undefined }` and 1896-1902 `const right: TimelineItem = { ...it, id: randomUUID(), inSec: cutSec, startSec: ... }` (volume/fades untouched). Same class: sliceTimelineAudio (project.ts:1955-1965) keeps `volume` on the right piece unshifted; carveVideo/overwriteLanes remnants (timelineUtils.ts:368-369, 474-477) and every head trim (Timeline.tsx:2693, 1580-1585, 930-935) move startSec without shifting `volume[].at`.
- Fix idea: one helper that, for a piece starting d seconds later in the same block, shifts volume points by -d (and drops fadeIn on the right piece / fadeOut on the left), used by slice, carve, and head trims.

### D3. Pressing I or O in Clip Gen also sets the timeline's in/out range (timeline keys fire from every panel)
- Severity: MED
- Status: PROVEN
- Trigger: click a block in the Timeline once (tlFocus becomes 'main' and never resets), then work in Clip Gen and press I or O to mark the take preview's in/out.
- What goes wrong: the Timeline's window-capture key handler only checks `tlFocus`, which is set on a timeline press and never cleared when another panel is used. So I/O also writes rangeInSec/rangeOutSec on the timeline (a saved, undoable edit he didn't ask for), and App then marks the Clip Gen in/out too. The same handler runs Q/W (ripple trims), C (razor), 1-9 (hide tracks), M (marker), A/V/P (tools) while he is in the Bin, Library or Clip Gen.
- Path: Timeline.tsx:3007-3013 onKey (capture) `if (useStore.getState().tlFocus !== panelKey) return` -> 3090-3093 `e.key === 'i' ... setTimelineMeta({ rangeInSec: st.tlTime }, K.tlObj.id)`; then App.tsx:593-595 `(e.key === 'i' || e.key === 'o') ... activePanel?.id === 'render'` -> markClipGenInOut. tlFocus is only set at Timeline.tsx:3527 and reset at App.tsx:790 (window close).
- Code: Timeline.tsx:3010 `if (useStore.getState().tlFocus !== panelKey) return // list 49: one timeline panel has the keys`
- Fix idea: also require the dock's active panel to be a timeline panel (or clear tlFocus when another panel is pressed) before the timeline handler acts.

### D4. Dropping a clip on the main Timeline panel lands it in a different timeline when a timeline window was last clicked
- Severity: MED
- Status: PROVEN
- Trigger: drag a timeline tab out into its own window (B) and click in it; the main panel still shows A. Drag a clip (or Library video / take / images) from the Bin onto a track of the main panel.
- What goes wrong: the main panel draws A (tabCurrent), but drops never make it active (only onMouseDownCapture does, and a drag has no mousedown in the target). dropOnTrack/addAt/landVideo read and write the ACTIVE timeline, so the clip lands in B at the drop time and track, out of sight. Score/SFX drops on the same row use the displayed timeline (dropScore(e, tlObj, ...)), so the two drop kinds disagree.
- Path: Timeline.tsx:3424-3435 (tabCurrent does not follow an active timeline that has its own window) -> row onDrop 3919-3921 -> dropOnTrack 2830 -> addAt 2909-2927 `const cur = activeItems(...)` -> landVideo 2399-2428 `let tlNow = activeTimeline(...)` ... `setTimelineAll(..., tlNow.id)`.
- Code: Timeline.tsx:2925 `const cur = activeItems(useStore.getState().project)`; 3523-3528 activation only in onMouseDownCapture.
- Fix idea: in the row's onDrop (and dragover), call selectTimeline(tlObj.id) first, or pass tlObj.id through addAt/landVideo.

### D5. "♪ insert audio → A n" never mutes the block, so the sound plays twice
- Severity: MED
- Status: PROVEN
- Trigger: right-click a block with a rendered take -> "♪ insert audio → A1 (copy, same timecode + trims)".
- What goes wrong: the verb fires two whole-array writes in the same tick, both carrying the same base rev. Main applies the audio-lane write first (rev +1), then rejects the items write as stale ("stale timeline write rejected") and returns the old items. The copy lands on the lane but the block's own sound is never muted, so playback and export play the clip's audio twice on top of itself (the comment promises "The block's own sound mutes so nothing doubles").
- Path: Timeline.tsx:4060-4064 -> store.ts:1903-1908 setTimelineAudioItems (baseRev = R) and store.ts:1894-1901 setTimelineItems (baseRev = R) -> main project.ts:1756-1767 (rev R -> R+1) then project.ts:1793-1795 `if (baseRev != null && baseRev !== (tl.rev ?? 0)) { console.warn('stale timeline write rejected'); return { timelines: [tl] } }`.
- Code: Timeline.tsx:4060 `void st.setTimelineAudioItems([...], tlNow.id)` / 4064 `void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, muted: true } : x)))`
- Fix idea: land both in one setTimelineBoth(items-with-muted, audioItems) call.

### D6. ✕ / "remove (leave gap)" / "ripple delete" leave the block's linked lane audio behind
- Severity: LOW
- Status: PROVEN
- Trigger: link a lane audio block to a video block (right-click it -> "🔗 link — lock to the video block under it"), then remove the video block with its ✕, the "remove (leave gap)" entry, or "ripple delete (close up)".
- What goes wrong: Del (deleteSelectedTlItem) and marquee Del take linked riders with the block ("a linked clip goes as one"), but these three paths filter only the video item. The rider keeps a dangling link and keeps playing at its last synced spot; after a ripple delete everything later slides left under it (freeAudioShifted skips linked items), so it now plays over the wrong clip.
- Path: Timeline.tsx:3978 `const removeBlock = (): void => void setTimelineItems(freshItems().filter((x) => x.id !== it.id))` (used by TlBlock ✕ 4289 and menu 4177); rippleDelete 2794-2806 (`freeAudioShifted` 2577 `!a.link && ...`). Compare store.ts:1423 `const next = half ? aud : aud.filter((a) => a.link?.itemId !== id)`.
- Fix idea: route all three through the same rider-aware removal deleteSelectedTlItem uses.

### D7. Lane audio blocks with a speed are drawn, snapped, keyframed and trimmed as if they played at 1×
- Severity: MED
- Status: PROVEN
- Trigger: set a block to 200 % (Ctrl+R) and right-click -> "♪ unlink audio" (main copies the block's speed onto the new lane item), or unlink a sped-up nest's sound. Then look at / trim / keyframe that lane block.
- What goes wrong: playback and export play the lane item for (outSec-inSec)/speed seconds, but the Timeline draws it (outSec-inSec) wide: a 4 s sound shows 8 s long, running 4 s past its video block. The phantom tail is a collision wall and a snap target for neighbours; the volume band spreads keyframes over the wrong length (a keyframe drawn at the block's middle is heard at its end); a head trim moves startSec by the drag but the in-point by the same number of SOURCE seconds, so the sound slips out of sync by half the trim at 2×; an end trim adds timeline seconds to the source out-point.
- Path: main project.ts:1711 `...(it.speed && it.speed > 0 && it.speed !== 1 ? { speed: it.speed } : {})` -> Monitor.tsx:943 `rate={a.speed ...}` and Monitor.tsx:56 `const len = Math.max(0, a.outSec - a.inSec) / rate` (what he hears) vs Timeline.tsx:1328 `const len = Math.max(0.25, a.outSec - a.inSec)` (block width 1364, VolumeBand 1403, FadeHandles 1409), occ 1488, snap targets 2269, laneBlocks 2060, trims 1574-1589.
- Code: Timeline.tsx:1578-1583 `const nIn = ... base.inSec + d ...; const shift = nIn - base.inSec; final = { ...base, inSec: nIn, startSec: Math.max(0, baseStart + shift) ...}`
- Fix idea: use audioLenOf(a) for every lane-item length and convert drag seconds to source seconds (× speed) in the in/out trims.

### D8. Switching timelines is saved as an undo step, wipes the redo stack, and skips the switch reset
- Severity: MED
- Status: PROVEN
- Trigger: A) make edits, press Ctrl+Z a few times, then click another timeline's tab, its Bin tile, or into a timeline window that isn't active; press Ctrl+Y. B) Double-click block #3 in timeline A (Clip Monitor shows it), then click the tab of timeline B.
- What goes wrong: A) every switch saves the project (activeTimelineId changed), so it becomes an undo step and `redoStack = []`: the redo steps are gone, and later Ctrl+Z presses flip the Program Monitor between timelines instead of undoing edits. After an undo restores a different activeTimelineId, the very next press in a timeline panel re-activates the displayed one and wipes redo again. B) selectTimeline sets activeTimelineId in the renderer BEFORE main replies, so applyDelta never sees the switch and its reset (playhead, playing, selectedTlItemId, editTimelineIndex) never runs. editTimelineIndex is an index: the Clip Monitor now shows and edits B's block #3 (a different clip) in slot mode, its trim bar and take picker write to that block, while Clip Gen still shows clip X.
- Path: Timeline.tsx:3528 / 3453, Bin.tsx:634 -> store.ts:2007-2016 selectTimeline `set(... activeTimelineId: id ...)` then `applyDelta(await vd().timelineSetActive(id))` -> main project.ts:2077-2082 setActiveTimeline `current.activeTimelineId = id; await saveProject()` -> project.ts:429-435 (undo push + redo wipe). store.ts:1103 `if (project.activeTimelineId !== oldActiveId)` is false because the renderer already switched. SourceMonitor.tsx:47 `const slot = editTimelineIndex != null ? activeItems(project)[editTimelineIndex] : undefined` (no clipId check).
- Code: store.ts:2014 `set((s2) => (s2.project ? { project: { ...s2.project, activeTimelineId: id } } : {}))`
- Fix idea: persist activeTimelineId outside the undo history (restoring-style derived write), and do the switch reset (or at least editTimelineIndex/selection) inside selectTimeline itself.

### D9. Clip Monitor in/out handles extend a slot over the next block on its track (no ripple, no clamp)
- Severity: LOW
- Status: PROVEN
- Trigger: double-click a block that was trimmed shorter and sits flush against the next block; in the Clip Monitor drag its out handle to the right.
- What goes wrong: the commit writes inSec/outSec only. The block grows past its neighbour's start on the same track, so the two overlap; itemAt/export keep the first one in array order, so the head of the next clip silently disappears from playback and export. The timeline's own out-trim ripples (Timeline.tsx:2722-2739) and every other edit carves; this path does neither. Moving the in handle keeps startSec, so the block's content shifts under a fixed start instead of trimming its head.
- Path: SourceMonitor.tsx:303-325 onHandleDown -> 295-301 commit `setTimelineItems(fresh.map((x) => (x.id === slotId ? { ...x, inSec: inS, outSec: outS } : x)))`; resolution timelineUtils.ts:224 `if (!best || tr > trackOf(best)) best = it` (same track: first wins), export.ts:474 same rule.
- Fix idea: route the Clip Monitor commit through the timeline's trim rule (end trim ripples / clamps at the next block, head trim moves startSec).

### D10. Any plain-text drag dropped on a video track becomes a phantom 5 s block that overwrites what is under it
- Severity: MED
- Status: PROVEN
- Trigger: drag an effect's ⠿ reorder handle in the Effects panel and let go over the Timeline (they often sit side by side), or drag selected prompt text / a link from a browser onto a video track.
- What goes wrong: the Bin's single-clip MIME is the generic 'text/plain'. The track accepts any drag carrying text/plain, and dropOnTrack treats the text as a clip id with no check that the clip exists. A block for a non-existent clip ("?", 5 s fallback length) lands at the drop time and landVideo carves the real clips under it (overwrite = their footage is cut out). Undo restores it, but the drop looks like it "ate" part of the edit.
- Path: dragDrop.ts:3 `export const MIME_CLIP = 'text/plain'`; EffectsPanel.tsx:467 `e.dataTransfer.setData('text/plain', entry.id)`; Timeline.tsx:3917 `if (t.includes(MIME_CLIP) || ...) e.preventDefault()` -> 3921 dropOnTrack -> 2906-2907 `const clipId = e.dataTransfer.getData(MIME_CLIP); if (clipId) void addAt(clipId, T, track)` -> addAt 2909-2927 (no clip lookup; effDur falls back to 5 via sourceDurOf timelineUtils.ts:78-79) -> landVideo 2407 `carveVideo(...)`.
- Fix idea: give Bin clips their own MIME (application/x-vd-clip) and have addAt refuse ids that are not in project.clips.

### D11. Deleting a music track from the Library gives no warning and leaves its timeline blocks dead and silent
- Severity: MED
- Status: PROVEN
- Trigger: drag a Library ♫ track onto an A lane (the v20 lane system), then right-click the track in the Library -> delete.
- What goes wrong: the "used by" count only looks at the legacy tl.music slot, which v20 migrated away, so it is 0 and no confirm appears. Main's single delete removes the track and the legacy slot but leaves every lane item with `source.audioId` pointing at it. Those blocks stay on the timeline named "?", resolveAudioSource returns no file, and the Monitor simply skips them: the music silently drops out of the edit. (The multi-select "delete N selected" path does remove the lane blocks, so the two deletes disagree.) Undo brings it back if he notices.
- Path: Library.tsx:39-40 `const usedBy = useMemo(() => (tlsForUse ?? []).filter((t) => t.music?.audioId === a.id).length, ...)` -> 101 `if (usedBy === 0 || await confirmDialog(...)) void deleteAudio(a.id)` -> store.ts:1552-1554 -> main project.ts:2626-2650 deleteAudio (only `tl.music` and clip audioRefs are touched) -> shared/audioSource.ts:33-35 `file: tr?.file` (undefined) -> Monitor.tsx:931-932 `if (!f || !tlObj) return null`. Compare deleteSelection.ts lane filter `'audioId' in x.source ? !audio.has(x.source.audioId)`.
- Fix idea: count lane items (`audioItems[].source.audioId`) in usedBy and have deleteAudio remove them, like removeSelectedAssets does.

### D12. Editor tree deletes erase the render files from disk, yet the app promises Ctrl+Z (Image Editor ✕ has no confirm at all)
- Severity: HIGH
- Status: PROVEN
- Trigger: A) Image Editor results tree: click the red ✕ on a node row ("delete branch"). B) Video Editor tree: delete a node, answer the dialog that says "(undoable — Ctrl+Z)". C) Bin image gen: delete a take or the whole image gen ("Library copies survive. (undoable — Ctrl+Z)").
- What goes wrong: main unlinks every file in the branch (the node and all its descendants: paid Nano Banana / Omni / Seedance results) with fs.unlink, not the Recycle Bin. Ctrl+Z only restores the project.json records, which now point at missing files (blank thumbnails, unplayable nodes). In A a single click deletes a whole branch with no question. This breaks the history contract written at project.ts:91-92 ("media files are never deleted by mutations, so restoring a snapshot is always valid").
- Path: A) ImageEditor.tsx:1335-1337 `onClick={(e) => { e.stopPropagation(); void tryDeleteBranch(node.id) }}` -> 646-652 (only a primary check, no confirm) -> store.ts:2515-2517 deleteEditBranch -> main project.ts:3425-3452 `for (const n of goners) { try { await unlink(n.file) } ... }`. B) VideoEditor.tsx:318-325 (dialog text "(undoable — Ctrl+Z)") -> vd().veditDeleteBranch -> project.ts:3378-3405 same unlink loop. C) Bin.tsx:573 dialog "(undoable — Ctrl+Z)" -> deleteImageGen -> project.ts:4388 `for (const t of g.takes) if (!t.keptImageId) await unlink(t.file)`; deleteImageGenTake project.ts:4378.
- Code: project.ts:3396-3402 `for (const n of goners) { try { await unlink(n.file) } catch { /* file already gone — fine */ } }`
- Fix idea: keep the files (let "Delete unused media" collect them later, it already respects undo history) or move them to the Recycle Bin; add a confirm to the Image Editor ✕.

### D13. Video Editor keeps the previous source's selected node, so Generate on the next source fails ("the source video is gone")
- Severity: MED
- Status: PROVEN
- Trigger: in the Video Editor click a result node of take A (selects it), then open "⑂ edit this take v2v" on another block / take B (or a Library video). The panel shows "original", the button says "Generate … from the original". Press Generate.
- What goes wrong: selNodeId is never reset when editorVideoRoot changes (the Image Editor resets it, ImageEditor.tsx:664-673; the Video Editor has no such effect). The payload carries `parentId: selNodeId` from session A, main looks for that node inside session B, finds nothing and refuses with "the source video is gone — re-pick it in the tree." The workflow fails until he happens to click the "original" row.
- Path: VideoEditor.tsx:63 `const [selNodeId, setSelNodeId] = useState<string | null>(null)` (only reset at 225, 325, 551) -> 105 `selNode = selNodeId ? nodes.find(...) : undefined` (undefined in B, so the UI says original) -> 275 `parentId: selNodeId` -> main index.ts:1638-1651 `if (req.parentId) { srcFile = <session B>.nodes.find((n) => n.id === req.parentId)?.file } ... if (!srcFile ...) return { ok: false, error: 'the source video is gone — re-pick it in the tree.' }`.
- Fix idea: reset selNodeId when the root changes and drop it when it is not in the current session's nodes (the Image Editor's two effects).

### D14. With the Assembly panel open, timeline playback runs two engines: every sound plays twice and gaps/storyboard blocks play at double speed
- Severity: MED
- Status: PROVEN (for Assembly visible next to the Timeline Monitor; SUSPECT for Assembly as a hidden tab, which depends on dockview keeping hidden tab components mounted)
- Trigger: open the Assembly panel (Window menu, or the Co-Director's assemble flow) while the Timeline Monitor is open, press Space.
- What goes wrong: Assembly embeds a full second `<MonitorPanel />`. Each copy mounts its own AudioItemPlayer for every lane block, every covered block, every score and the music, and each one calls play() on its own element (no audio-owner check), so all timeline sound is doubled (with drift, an echo). Each copy's engine also advances the global clock every animation frame: where the wall clock drives time (gaps, S-B storyboard blocks, ⟲ loop blocks, J backward) both add dt to the same tlTime, so those stretches play at 2×; the video elements' own audio is unmuted by both engines every tick.
- Path: Assembly.tsx:91-93 `<MonitorPanel />`; Monitor.tsx:559-631 tick `let T = st.tlTime ... T += dt * rate ... st.tlSetTime(T)`; Monitor.tsx:921-989 the per-item AudioItemPlayer / ScoreItemPlayer mounts; AudioItemPlayer 65-71 `m.play()`; Monitor.tsx:677 `ap.muted = audioMutedFor(visT) || ...` (re-unmutes each tick, so focusAudio cannot keep one owner).
- Also: both copies register the one program-frame grab (Monitor.tsx:904-911 `setProgramFrameGrab(...)`, cleanup `setProgramFrameGrab(null)`), so closing Assembly unregisters the main Monitor's grab and the block menu's "current frame → Library" then fails with "no frame to grab".
- Fix idea: give Assembly a view-only mirror of the one Monitor (or make the embedded copy a passive viewer that never writes tlTime and mounts no audio players).

### D15. A keyframe selection left in any open volume band takes over Delete: the selected block is not deleted, the forgotten keyframes are
- Severity: LOW
- Status: PROVEN
- Trigger: double-click an audio lane to expand it, click a volume keyframe (selected), then click a video block elsewhere on the timeline and press Delete.
- What goes wrong: the band's keyframe selection is local state that only clears when its own empty space is clicked; while it holds anything, the band registers a window capture keydown handler that deletes those keyframes and calls stopPropagation, so App's block delete never runs. Del removes automation he is not looking at and leaves the block he selected.
- Path: VolumeBand.tsx:385-399 `useEffect(() => { if (!props.editable || !sel.size) return; const onKey = ... removePoints(sel) ...; window.addEventListener('keydown', onKey, true) }, [props.editable, sel, props.points])`; sel only cleared at 451 (a press on this band's empty space) or 382; App.tsx:554-569 never sees the key.
- Fix idea: clear the band's selection when another block/keyframe is selected (or only act when the band was the last thing pressed).

### D16. Effects export: two layers that use the same take file share one decoder, so an offset copy bakes the wrong frame
- Severity: LOW
- Status: PROVEN (code path); triggers only with fx on a block whose take is also playing, time-offset, on a lower track at that moment
- Trigger: put the same take on V1 and V2 offset in time (a trail / echo / masked-over-itself look) with an effect or blend on V2, export.
- What goes wrong: outside dissolves the baker pools videos by FILE (`ensureVideo(file)` with owner = file), so the under layer and the top layer get the same <video>; both seekTo() calls race on it and both layers render whichever seek landed last. The Monitor uses separate elements (the A/B player for the top, the under pool for V1), so the preview shows two different frames and the export shows one.
- Path: fx/baker.ts:225-228 `const hit = pool.get(owner+url)` with owner defaulting to file; 331 `ensureVideo(takeFileOfItem(u)!)` and 337 `ensureVideo(topFile)` (no item id), 382 `await Promise.all(seeks)`. The transition branch already keys by item.id (301, 307).
- Fix idea: key the non-transition pool by item id like the transition branch does.

### D17. Ctrl+V in the Library pastes the last copied timeline block onto the timeline (overwriting footage) instead of importing the image
- Severity: MED
- Status: PROVEN
- Trigger: at any point in the session press Ctrl+C on a timeline block (the clipboard keeps it). Later copy a screenshot or files in Explorer, click empty Library space and press Ctrl+V (the Library's documented paste).
- What goes wrong: App's global keydown sees Ctrl+V outside a text field and, because tlClipboard is set, calls preventDefault and pastes the block at the playhead in OVERWRITE mode on its own track. preventDefault on the keydown cancels the browser paste event, so the Library's onPaste never runs: no image is imported, and the timeline (which he is not looking at) has a block dropped in that carves away whatever was under the playhead.
- Path: App.tsx:538-547 `if (e.ctrlKey || e.metaKey) { ... else if (k === 'c' || k === 'x' || k === 'v') tlClipboardKey(e) }` -> tlClipboardKeys.ts:18-21 `if (k === 'v' && s.tlClipboard) { e.preventDefault(); void s.pasteTlClipboard({ insert: e.shiftKey }) }` -> store.ts:1371-1375/1406 carveVideo + overwriteLanes. Library.tsx:432-439 onPaste (never fires).
- Fix idea: only take Ctrl+C/X/V for the timeline when a timeline panel has focus (tlFocus + the dock's active panel), and let the paste event through elsewhere.

### D18. A locked track does not stop deletes (✕, Del, marquee Del, remove / ripple delete)
- Severity: LOW
- Status: PROVEN
- Trigger: lock V1 (🔒 "lock this track (rejects edits)"), then click a V1 block's ✕, or select it and press Del, or sweep a marquee over V1 and V2 and press Del, or right-click → remove / ripple delete.
- What goes wrong: moves, trims, nudges, speed and dissolves check the lock, but every delete path removes the block anyway; a marquee that crosses a locked row deletes its blocks too, and ripple delete of a block elsewhere is the only path that respects the lock (it skips shifting locked tracks but still removes a locked block when it is the target).
- Path: store.ts:1415-1425 deleteSelectedTlItem (no lock check); Timeline.tsx:3105-3113 marquee Del `K.freshItems().filter((x) => !doomed.has(x.id))`; 3978 removeBlock; 2794-2806 rippleDelete. Compare startMove 2444 `if (locked.has(\`v${trackOf(it)}\`)) return`.
- Fix idea: skip blocks on locked tracks in the four delete paths (and hide ✕ there), as the move/trim paths already do.

### D19. A render started from a timeline slot is not adopted into that slot if another timeline is active when it lands
- Severity: LOW
- Status: PROVEN
- Trigger: double-click a block in timeline A, render a new take from Clip Gen (the job carries adoptSlotItemId), switch to timeline B (tab, Bin tile or timeline window) while it renders.
- What goes wrong: on landing, the adopt only looks in the ACTIVE timeline's items and setSlotView only edits the active timeline; A's block is not found, so the slot keeps its old take silently (the take does land in the clip). Same for Optical Flow / enhance copies that were meant to replace specific blocks (adoptItemIds).
- Path: store.ts:2414-2417 `const items = activeItems(get().project); if (items.some((x) => x.id === job.adoptSlotItemId)) void get().setSlotView(...)`; 2419-2427 same for enhance; setSlotView 1928-1934 reads activeTimeline only.
- Fix idea: store the slot's timeline id on the job and pass it to setSlotView instead of reading the active timeline.

### D20. Linked lane audio slides out of sync when its video block is head-trimmed (in-edge drag, Q, or an overwrite over its head)
- Severity: MED
- Status: PROVEN
- Trigger: drop a recorded line (Library ♫) under a block, right-click it → "🔗 link — lock to the video block under it". Then drag the block's left edge in by 1 s (or press Q with the playhead 1 s in, or drop another clip over the block's first second).
- What goes wrong: a linked rider is positioned as block start + offset with its own inSec. A head trim moves the block's startSec and inSec together (or, for Q, keeps start and advances inSec), but nothing touches the rider: its sound keeps its own in-point, so the line now plays 1 s late against the picture (lips drift) and runs 1 s past the block's end. The block is labelled "🔗 LINKED — moves/trims/cuts with its video block" and the razor does split riders (main sliceTimelineItem), so trims are the odd one out.
- Path: Timeline.tsx:2691-2693 head trim `final = { inSec: nIn, outSec: b.outSec, startSec: ... }` -> 2731-2739 setTimelineBoth(items, doShift ? freeAudioShifted(...) : null) (freeAudioShifted skips `a.link`); rippleToPlayhead 2631-2635 `patch = { inSec: nIn }`; carveVideo timelineUtils.ts:369 right remnant keeps the id with a later startSec/inSec. Rider position: timelineUtils.ts:311-316 audioStartOf = host start + link.offset; main project.ts:1673-1681 syncLinkedAudio only re-derives startSec.
- Fix idea: when a block's in-point moves by d source seconds, move each linked rider's inSec by the same d (or its offset by -d/speed), the way sliceTimelineItem already handles riders.

### D21. Dragging several Library images onto the Image Editor's refs strip adds only the one grabbed
- Severity: LOW
- Status: PROVEN
- Trigger: ctrl-click three Library images, drag them onto the Image Editor's "refs" strip.
- What goes wrong: the Library drag carries the whole selection (MIME_IMAGES) plus the grabbed tile's file (MIME_IMAGE); the refs strip only reads MIME_IMAGE, so one ref lands and the other two are silently dropped (the Beats bar on the same drag takes all of them).
- Path: Library.tsx:345-356 dragStart sets MIME_IMAGE (one file) + MIME_IMAGES (all ids) -> ImageEditor.tsx:1030-1044 `const f = e.dataTransfer.getData(MIME_IMAGE) ... if (im) addRef(im.id)`.
- Fix idea: read MIME_IMAGES first and addRef each (addRef already caps at the model's maximum).

### D22. Reversed blocks: the Clip Monitor and "⑂ edit this take v2v" / lip-sync use the forward take with the block's reversed-copy window, so they show and SEND the wrong section
- Severity: MED
- Status: PROVEN
- Trigger: Ctrl+R on a block, tick Reverse Speed (its in/out are mirrored into the reversed copy's seconds). Then A) double-click it: the Clip Monitor shows the forward take with the in/out band over the mirror part of the clip, and dragging the handles trims the frames he is NOT looking at; or B) right-click → "⑂ edit this take v2v" (or the lip-sync entry) and Generate.
- What goes wrong: a reversed block's inSec/outSec count the reversed copy (lib/speed.ts:64 mirrorWindow). The Clip Monitor plays `take.file` (forward) and never applies playFileOf/reverse, so its band, "in→out" playback and trims are on the mirror section. The Video Editor gets takeRef + the block's raw in/out and cuts that window out of the forward take file, so the paid v2v edit / lip-sync is run on the wrong seconds of the shot.
- Path: speed.ts:63-64 `if (rev !== !!t.reverse) ({ inSec: inS, outSec: outS } = mirrorWindow(inS, outS, src))`; SourceMonitor.tsx:73-79 `take ... const url = useMediaUrl(take?.file)` (no reverse anywhere in the file); Timeline.tsx:3967-3974 editVideo `setEditorVideo({ takeRef, inSec: it.inSec, outSec: it.outSec })`; Timeline.tsx:4023-4028 lip-sync `plain = ... && !it.reverse ...; vin = (win.inSec ?? 0) + ...` (raw reversed seconds); VideoEditor.tsx:111/135-139 window applied to rootTake.file; main index.ts:1649-1659 cuts that window from the forward file.
- Fix idea: for a reversed block convert the window with mirrorWindow (or play the .rev copy) before handing it to the Clip Monitor and the Video Editor.

### D23. Deleting a timeline that holds only sound (lane audio, scores, sound fx) skips the confirm
- Severity: LOW
- Status: PROVEN
- Trigger: build a music/score bed on a timeline with no video blocks, then right-click its Bin tile → delete.
- What goes wrong: the confirm is skipped whenever `t.items.length === 0`, which only counts VIDEO blocks; all its lane audio, ♪ scores, sound fx and markers go with one click (undo brings them back).
- Path: Bin.tsx:958-961 `if ((t.items.length === 0 && !uses) || (await confirmDialog(...))) void deleteTimeline(t.id)`.
- Fix idea: count audioItems and scoreItems (and markers) before skipping the confirm.

### D24. Moving a free lane audio block writes back the video items from when the drag began, undoing anything that landed meanwhile
- Severity: LOW
- Status: PROVEN (needs a timeline write to land during the drag, e.g. a slot render's take adoption or an Optical Flow switch)
- Trigger: start dragging a free (green/teal) lane audio block; while the mouse is held, a queued render started from a timeline slot finishes and adopts its take into that slot (setSlotView ripples the blocks); release.
- What goes wrong: the release handler is the closure from mousedown, so overwriteLanes is fed the old `tl.items` / `tl.scoreItems`; setTimelineAll reads the base rev fresh at send time, so the CAS passes and the stale arrays replace the adopted/rippled items: the slot silently goes back to the old take and the ripple is undone.
- Path: Timeline.tsx:1506-1632 onGesture (closure over the `tl` prop at mousedown) -> 1623-1625 `overwriteLanes({ items: tl.items, audioItems: next, scoreItems: tl.scoreItems ?? [] }, ...)` -> `setTimelineAll(st.items, st.audioItems, st.scoreItems, tl.id)` -> store.ts:1917-1922 `const baseRev = p.timelines.find(...)?.rev` (read at send time, so a stale array is never refused).
- Fix idea: build the release write from fresh state (activeTimeline(useStore.getState().project)), or capture the rev at gesture start and pass it as baseRev.

---

## Earlier audit check (AUDIT-2026-10-08 Part 1, items in this area, re-traced after the hunt)

- C2 "deleting an imported take or edit node deletes the original file outside the project": CONFIRMED as low, as written. deleteTake (project.ts:2359-2382) never unlinks; edit-tree deletes unlink node files, and those are written inside the project (vedit outDir `videos/edits`, index.ts:1662; image edits `images/edits`) and stored relative (project.ts toRelative covers editSessions/videoEditSessions nodes). The real problem in that code is a different one: the files go for good while the UI promises undo (D12).
- A6 "Image Edit variant loss": CONFIRMED. falImage.ts:126-134 writes each variant then `throw new Error('download failed: HTTP …')` on the next one; the files already written are never returned, so they never reach the tree.
- D3 "export vs preview parity" (moved to Part 3): re-checked in part, CHANGED (new breaks found): the shared resolvers agree (same-track first-wins rule: timelineUtils.ts:224 = export.ts:474), but the effects baker shares one decoder per file (D16), a reversed block's Clip Monitor shows the forward take (D22), lane audio with speed is drawn at the wrong length (D7), and an open Assembly panel doubles playback (D14).
- D11 "waveform stays stale after a file is overwritten": CONFIRMED as low. waveform.ts:196-236 caches by path with no invalidation; I found no in-app path that rewrites an audio file in place, so it stays an edge case.
- Not in this area (left to the other agents): #1-#3, #4 and #8 (queue/spend in store.ts), #5, #7, #9, #10, C4.

## Coverage

Read in full (koan-shared/vidancer-ui/src): store.ts; panels/Timeline.tsx (all 4,591 lines); panels/Monitor.tsx; panels/SourceMonitor.tsx; panels/VideoEditor.tsx; panels/TimelineEditor.tsx; panels/TimelineTransitions.tsx; panels/Bin.tsx; panels/Library.tsx; panels/Foldered.tsx; panels/Beats.tsx; panels/SpeedModal.tsx; panels/DissolveModal.tsx; panels/Assembly.tsx; panels/shared/playback.tsx, takeRows.tsx, MentionInput.tsx; ui/VolumeBand.tsx, SpeedBand.tsx, JogBar.tsx, FadeHandles.tsx, ResizeHandle.tsx; lib/timelineUtils.ts, time.ts, speed.ts, filmstrip.ts, waveform.ts, arrowNav.ts, multiSelect.ts, takeSelection.ts, dragDrop.ts, tlClipboardKeys.ts, frameGrab.ts, imageCrop.ts, prepareVideoFrame.ts, dissolves.ts, beatUtils.ts, tileZoom.tsx, clipMeta.ts, dynamicStill.ts, selectionMenu.tsx; fx/fxData.ts, fx/fxUtils.ts, fx/baker.ts, fx/transitionPreview.ts; preview/MirrorView.tsx; Thumbnail.tsx; media.ts; audioBus.ts; shared/transitions.ts, remap.ts, reverse.ts, nest.ts, audioEnv.ts, audioSource.ts.
Read almost in full: App.tsx (1-960 line by line; 960-1623 header/modals skimmed for editing calls); panels/ImageEditor.tsx (all but the crop-canvas JSX 860-1027, skimmed).
Skimmed: panelBus.ts (all openers; frame-grab and timeline-window parts read); fx/passRunner.ts (seekTo only); fx/core/chain.ts (first 120 lines); fx/core/gl.ts, registry.ts, types.ts, fx/effects/*, fx/passWorker.ts not read (GPU internals, no editing state).
Main process followed for the calls above: project.ts (undo/redo + saveProject history, setTakeDuration, addTake, timeline set/setBoth/setAll/setAudioItems/setScoreItems/setMeta, slice/sliceAudio/sliceScore, nest, duplicate/delete/setActive timeline, unlinkAudio, deleteTake/deleteClips, deleteAudio, deleteVideoEditBranch, deleteEditBranch, deleteImageGen/Take), deleteSelection.ts, index.ts (timeline IPC block 3049-3152, vedit:run 1628-1719), falImage.ts (runInner), export.ts (top-track rule only).
Not covered here: RenderPanel.tsx (Clip Gen) and the gen/score/voice/image-gen cards beyond the take paths noted above.
