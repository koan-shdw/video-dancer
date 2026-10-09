# E. Generator screens and settings UI — findings

### E1. Clip Gen: a "Render now (new clip)" landing wipes everything typed in the form while it rendered
- Severity: HIGH
- Status: PROVEN
- Trigger: Clip Gen with no clip selected (fresh form, "not in the Bin yet"). Press ▶ Render now (new clip) or ＋ Queue. While it renders (minutes), keep editing the prompt/beats/fields for the next try. The render lands.
- What goes wrong: the completion watcher selects the brand-new clip, the load effect fills the form from that clip's promptData (the render-time payload). Every edit made during the render is replaced; nothing saved it because the autosave only runs when a clip is selected.
- Path: RenderPanel.tsx:1202 (payload `clipId: selectedClipId ?? undefined`) -> main index.ts:3607 addTake (new clip gets `promptData: opts.promptData`, project.ts:928) -> RenderPanel.tsx:650 completion watcher -> store.ts:1171 selectClip -> RenderPanel.tsx:729-791 load effect (adoptRef false) overwrites form; autosave RenderPanel.tsx:1124 `if (!selectedClipId) return` never saved the in-flight edits.
- Code: `if (!(job.payload as RenderArgs).clipId && job.resultClipId) selectClip(job.resultClipId) // brand-new clip → select it` and in the load effect `setFreeform(pd.freeform ?? pd.prompt ?? '')`, `setBeats(pd.beats ?? [])`, `setScene(...)`...
- Fix idea: when a new-clip render is dispatched, commit the form to a real clip first (the '+ new' adopt path) and send that clipId, or skip the reload when the form changed since dispatch.

### E2. Clip Gen seed is not part of the clip recipe: not saved per clip, not loaded, not restored by "load recipe"
- Severity: MED
- Status: PROVEN
- Trigger: (a) LTX/H3 local, type seed 1234 on clip A, select clip B: the dial still says 1234 and B renders with it; switch project, still 1234. (b) Right-click a local take he liked -> "↩ load Tn's recipe" -> render again: the seed dial is not set to the take's seed, so the re-render uses whatever the dial holds (often 0 = random) and the look is not reproduced, although the menu says it fills "prompt, fields, beats, refs, dials".
- What goes wrong: `seed` lives only in component state. buildPromptData has no seed, the load effect never calls setSeed, the project-switch reset never resets it, restoreRecipe never reads snap.seed (main records it: index.ts:3588 `seed: (rendered as { seed?: number }).seed ?? req.seed`).
- Path: RenderPanel.tsx:210 `const [seed, setSeed] = useState('0')` -> buildPromptData 1084-1118 (no seed) -> load effect 741-804 (no setSeed) -> restoreRecipe 1401-1443 (no setSeed) -> submitRender 1194 `seed: isLocal && Number(seed) > 0 ? Number(seed) : undefined`.
- Fix idea: store seed in PromptData via buildPromptData, load it in the load effect, and set it from snap.seed in restoreRecipe.

### E3. Clip Gen "↩ load Tn's recipe" keeps the CURRENT prompt link, field links, overrides and linked characters instead of the take's
- Severity: MED
- Status: PROVEN
- Trigger: render T1 while the clip links another clip's prompt / a style on a field / a linked character. Later change or remove those links. Right-click T1 -> "↩ load T1's recipe" -> render.
- What goes wrong: the take's snapshot holds promptLink/fieldLinks/fieldOverrides/characterLinks (main index.ts:3599-3602), but restoreRecipe never sets them, so the form mixes T1's own text with today's links. The re-render sends a different prompt than T1's. With a field override the field text already contains the pushed source text, so if the override is gone now the source is spliced in twice.
- Path: RenderPanel.tsx:2335-2338 menu -> restoreRecipe 1401-1443 (sets engine, sizes, mode, freeform, negative, loras, scene, characters, production, beats, refs, dials; no setPromptLink / setFieldLinks / setFieldOverrides / setCharLinks) -> resolveEffective 301-314 uses the live links.
- Code: restoreRecipe sets `setFreeform(snap.freeform)` ... `setAudio(snap.generateAudio)` and nothing for `snap.promptLink`, `snap.fieldLinks`, `snap.fieldOverrides`, `snap.characterLinks`.
- Fix idea: restore the four link fields from the snapshot in restoreRecipe (empty when absent).

### E4. LoRA side panel (civit tab): a download that main refuses up front sticks at "0%" forever and its error is never shown
- Severity: LOW
- Status: PROVEN
- Trigger: Image Gen or Clip Gen (LTX/H3) side panel -> civit tab -> "download" on a lora when no lora folder is set for that family -> the folder picker opens -> he cancels it. (Same for a file already on disk, or a second click while main thinks it is already downloading.)
- What goes wrong: the row flips to "0%" with a ✕ and stays there. main returned `{ ok:false, error:'canceled — pick a LoRA folder…' }` (or `{ ok:true }` for an existing file) without sending `imagegen:dlDone`, and the sidebar ignores the invoke's return value. ✕ calls imageGenCivitCancel, which has no job to abort and sends nothing. The download button only comes back after the panel remounts.
- Path: ImageGenSidebar.tsx:447-451 `setDl((d) => ({ ...d, [it.key]: { pct: 0 } })); void vd().imageGenCivitDownload(it, fam.key)` -> main index.ts:2521/2522/2536/2542 early `return` (no dlDone) -> ImageGenSidebar.tsx:176-183 only clears `dl` on onImageGenDlDone -> 433-437 row renders `job.pct` 0% + ✕; index.ts:2613-2616 cancel only aborts a live job.
- Code: `if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'canceled — pick a LoRA folder to download into' }` and `if (existsSync(dest)) return { ok: true, file: dest }`
- Fix idea: in the sidebar, read the invoke result and clear `dl[key]` (and set dlErr on failure) when it returns without a done event.

### E5. Co-Director "fire" that times out (8 s) stays armed in the panel and can render later, after the Co-Director was told it failed
- Severity: MED
- Status: SUSPECT (needs a case where the panel takes > 8 s to hold the target; traced for Image Gen while he is typing in its prompt box, or while imageGenStatus has not answered; for Clip Gen when the clip's delta lands after the select, since the load effect does not re-run on project changes)
- Trigger: Co-Director fire_render for an image gen while its prompt box is mid-edit (box differs from the saved prompt for 400 ms after every keystroke) for more than 8 s, or before `status` arrives. The Co-Director gets "its panel did not load it in time".
- What goes wrong: `fire()` answers the timeout but never withdraws the press. `firePending.current` keeps the request; the no-deps effect re-checks on every render and submits the moment the condition holds (the next pause in typing, or whenever he later opens that image gen / that clip loads). It submits with whatever the box holds then. For Clip Gen this is a paid `submitRender('queue')` nobody asked for at that moment.
- Path: codirFire.ts:44 `Promise.race([press(id, prompts), wait(8000).then(() => ({ ok: false, line: 'its panel did not load it in time' }))])` -> ImageGen.tsx:360-373 / RenderPanel.tsx:1255-1268 (`firePending.current` only cleared when it fires) -> submit('queue') / submitRender('queue').
- Code: RenderPanel.tsx:1261-1267 `const f = firePending.current; if (!f || selectedClipId !== f.clipId || loadedClipId !== f.clipId) return; firePending.current = null; ... submitRender('queue')`
- Fix idea: on timeout, clear the panel's pending press (registerFire's press gets an abort/cancel), so a late load never fires.

### E6. Sheet Gen name box cannot take a space (or be cleared), and fast typing drops letters
- Severity: LOW
- Status: PROVEN
- Trigger: Sheet Gen -> type a two-word name in the name row ("front plate"), or select all and retype it.
- What goes wrong: every keystroke renames the clip through IPC and the box shows the store's name. main trims the name and refuses an empty one, so the space typed after "front" comes back trimmed and vanishes ("frontplate"), and backspacing to empty snaps back to the old name. Keys typed before the IPC answer are overwritten by the older reply. Each keystroke is also a project save.
- Path: SheetGen.tsx:262 -> store.ts:1646-1648 `renameClip: async (id, name) => { get().applyDelta(await vd().clipRename(id, name)) }` -> main project.ts:1496 `c.name = name.trim() || c.name`.
- Code: `<input value={clip.name} onChange={(e) => void renameClip(clip.id, e.target.value)} placeholder="sheet name" … />`
- Fix idea: keep a local draft and rename on blur/Enter, the way Clip Gen's name box does (RenderPanel.tsx:2032-2036).

### E7. Clip Gen and Style Sheet drop the unsaved edit window: a clip switch cancels the pending save, and every Co-Director write (any undoTick bump) reloads the form over his typing
- Severity: MED
- Status: PROVEN
- Trigger: (a) type in Clip Gen's prompt/fields, then within 600 ms select another clip (Bin, Co-Director fire, a new-clip render landing, E1) or close the panel. (b) keep typing in Clip Gen while something bumps undoTick: EVERY Co-Director tool write (store.ts:902-909 `e.kind === 'wrote'` -> `undoTick: s.undoTick + 1`, whatever it wrote, any clip) and the end of every exchange (store.ts:1032), a "🎤 dialogue" voice render landing (store.ts:2430), the ▤ block sheet finishing (RenderPanel.tsx:330), an undo in another panel. Same in the Style Sheet panel. Typical: he sends the Co-Director a batch job, then keeps writing a prompt in Clip Gen while it works.
- What goes wrong: (a) the autosave effect's cleanup clears the 600 ms timer and nothing flushes it, so the last edit never reaches the clip (Char Sheet has a flush for exactly this: CharSheet.tsx:207-232; Clip Gen and Style Sheet have none). (b) the load effect re-runs on undoTick and refills the whole form from the store, wiping whatever was typed since the last 600 ms pause (each keystroke restarts the 600 ms timer, so steady typing during a multi-write Co-Director run keeps getting reverted).
- Path: RenderPanel.tsx:1135-1140 `const t = window.setTimeout(() => {… saveClipPromptData(id, payload) …}, 600); return () => window.clearTimeout(t)` (deps include selectedClipId) and RenderPanel.tsx:729-820 load effect deps `[selectedClipId, editTimelineIndex, undoTick]`; StyleSheet.tsx:78-102 same pair. The Effects panel does worse on the same signal: EffectsPanel.tsx:129-131 treats every undoTick as an undo and CANCELS (not flushes) its pending 400 ms fx commit, then reseeds from the stored block, so a slider moved while the Co-Director is writing snaps back and the edit is dropped.
- Code: store.ts:2430 `if (job.kind === 'voice' && (job.payload as VoiceRenderArgs).dialogueFor) set((s2) => ({ undoTick: s2.undoTick + 1 }))`
- Fix idea: flush the pending payload in the cleanup when the clip id changes or the panel unmounts (Char Sheet's flush), and skip/merge the undoTick reload while a save is pending.

### E8. Score card "length" (and Beatoven "refinement") clamp on every keystroke, so typing 30 gives 50 (ACE: 30 gives 100)
- Severity: MED
- Status: PROVEN
- Trigger: Score card -> select the length box -> type `30` (any length whose first digit is under the minimum: 10-49 on most engines, anything under 100 on ACE-Step whose minimum is 10). Same for Beatoven refinement (min 10): type `50`.
- What goes wrong: the first keystroke `3` is clamped to the minimum 5 (ACE: 10) and written straight into the recipe; the box re-renders as `5`, and the next keystroke `0` appends to it -> `50` (ACE -> `100`). Clearing the box snaps to 60. The music renders at the wrong length (the length is the wire `duration` / `audio_duration` / the ElevenLabs plan length), on his fal / ElevenLabs credits for paid engines.
- Path: ScoreCard.tsx:277-285 -> setOpt -> push (recipe.options.durationSec) -> scoreRenderRequest (scoreRequest.ts:55 `durationSec: Number(score.recipe.options?.durationSec ?? 60)`) -> emitScore.ts:28-31 scoreSeconds -> wire `duration`.
- Code: `onChange={(e) => setOpt('durationSec', Math.max(model.id === 'ace-step-1.5' ? 10 : 5, Math.min(model.maxDurationSec, Number(e.target.value) || 60)))}`; ScoreCard.tsx:310 `setOpt('refinement', Math.max(10, Math.min(200, Number(e.target.value) || 100)))`
- Fix idea: keep the typed text as a draft and clamp on blur/Enter (ImageGen's NumBox does this).

### E9. Voice card: a queued render speaks whatever the card holds when it STARTS, not what was there when he pressed ＋ Queue
- Severity: MED
- Status: PROVEN
- Trigger: Voice card -> "＋ Queue" while the queue lane is busy (or "▶ Render now" when the provider cap pushes it into the queue) -> change the test line, description, picked voice or engine for the next variant -> "＋ Queue" again.
- What goes wrong: both takes render the second recipe; the first variant is never made (and is billed as the second). The job payload is only `{ voiceClipId, engine }`, and main reads `vc.recipe` at start. Score (payload snapshot) and Image Gen (recipe frozen per press) do freeze; Voice does not. main already accepts a frozen `recipe` on the request, the card just never sends it. Side effect of the same thin payload: the store's double-fire guard compares payloads, so a second Generate within 2 s with a DIFFERENT test line is refused as "already queued (double-click guard)" (store.ts:2193-2197).
- Path: VoicesCard.tsx:223-235 voiceJob/dispatch -> store.ts:2190 enqueueRender -> 2387 `vd().voiceRender(job.payload)` -> main index.ts:2702 `const r = (req as typeof req & { recipe?: typeof vc.recipe }).recipe ?? vc.recipe` (falls back to the live recipe) -> 2706 `const text = ((req.dialogueFor ? req.text : r.testLine) ?? '').trim()`.
- Code: `payload: { voiceClipId: draft.id, engine: model.id }`
- Fix idea: put a structuredClone of draft.recipe (and name) into the voice payload so main renders the pressed recipe.

### E10. A Co-Director message typed mid-run is sent with the clip / tether target of the moment the run ENDS, not the one he was on when he typed it
- Severity: MED
- Status: PROVEN
- Trigger: the Co-Director is busy. On clip A he types "make this clip darker" (or uses the tether parked on A's prompt) -> it shows QUEUED. Before the run finishes he clicks clip B in the Bin (or the run's own fire_render selects another clip, codirFire.ts:24-27, or he drags the tether elsewhere).
- What goes wrong: the queue keeps only the text. When the run ends, the drain sends it through codirSendText, which reads `selectedClipId` and `focusField` NOW. main builds "the clip I'm on" / "This one" from those, so the edit lands on clip B. For the tether the text still says "⌖ <A>" while `focus` says B, a contradictory prompt.
- Path: CoDirector.tsx:129-136 / DirectorsRoom.tsx:294-300 / CoDirectorTether.tsx:216-223 -> store.ts:970-973 (busy: queue `{ id, text }` only) -> store.ts:1035-1038 drain `get().codirSendText(queued.map((q) => q.text).join('\n\n'))` -> store.ts:985 `vd().codirSend({ …, selectedClipId: get().selectedClipId, focus: get().focusField, … })` -> main codir.ts:1095-1097 / 1286-1290 build the "on" clip and focus line from them.
- Code: `set((s) => ({ codirQueue: [...s.codirQueue, { id: ++queueId, text: t }] }))`
- Fix idea: capture selectedClipId / focusField (and image ids) with each queued message and send those with the batch.

### E11. A Watched image dropped straight onto a Clip Gen ref / start / end slot is never saved to the clip, and has no @name
- Severity: MED
- Status: PROVEN
- Trigger: Watched panel (local tab, or a civit tile already cached) -> drag a tile onto Clip Gen's image-ref box or the i2v start/end slot, as the Watched help text invites ("drag one into the Library (or straight onto a clip slot)").
- What goes wrong: the slot holds the EXTERNAL file path. The autosave maps every slot file to a Library image id and silently filters out the ones with none, so the clip's saved recipe never gets this ref/frame; select another clip and come back and it is gone (a later render then runs without it, paid). It also has no title, so no @name joins the prompt, the chip says "(untitled)" with the "not @mentioned" warning, and engines that bind refs by @name (refTagPrompt) get it unanchored. Only a render made before leaving the clip imports it (main copies the file at render time).
- Path: Watch.tsx:205-211 `e.dataTransfer.setData(MIME_WATCH, wi.file); e.dataTransfer.setData(MIME_IMAGE, wi.file)` -> RenderPanel.tsx:953-961 onDropImage -> 891-895 addRef (`titleOf(file)` undefined, no @name) -> buildPromptData 1094 `imageIds: refs.map((f) => idOfFile(f)).filter((x): x is string => !!x)` / 1095 `endImageId: isI2v ? idOfFile(endFile) : undefined` -> imageSources.ts:16-21 imageAssetIdForFile returns undefined for a non-Library path -> autosave 1137 saves without it -> load effect 782-791 rebuilds slots only from imageIds.
- Code: `imageIds: refs.map((f) => idOfFile(f)).filter((x): x is string => !!x),`
- Fix idea: import a non-Library file into the Library on drop (Watch's own double-click path, importPaths) and put the Library file in the slot.

### E12. Seedance on ModelArk 2.5 / Venice / the Bridge lanes: refs titled @imageN (the app's default title) get re-bound to the wrong picture on the wire
- Severity: HIGH
- Status: PROVEN (logic run on a verbatim copy of applyRefTags: `'@image2 walks toward @image1'` with refs `[@image2, @image1]` -> `'@image2 walks toward @image2'`; three refs `[@image3, @image1, @image2]` -> every mention becomes `@image3`)
- Trigger: a clip whose attached refs carry the default Library titles (main names imports and frame grabs `@image{n}`, project.ts:895/901-905/1511) in any order other than 1,2,3…, e.g. refs [@image2, @image1]. Engine = any lane with `refTagPrompt: 'imageN'`: Seedance 2.5 ModelArk, Seedance 2 / 2 fast / 2.5 Venice, Seedance 2.5 Higgsfield / Runway / Magnific / Bridge (models.ts). Press Render (paid).
- What goes wrong: applyRefTags rewrites each attached title to its position, one after another, with a global replace. The positional tag for this format is itself `@image{k}`, so a later ref whose title is `@image{k}` also rewrites the tags already produced for earlier refs. Several (or all) mentions end up pointing at one reference; the supplier renders the wrong characters/places for the money. The visible prompt and the preview show the right @titles, so nothing warns. (fal 2.5 `[ImageN]`, Gemini, LTX and H3 tags carry no `@`, so they are not hit.)
- Path: RenderPanel.tsx:1154 `outPrompt = applyRefTags(outPrompt, refImages.map((f) => titleOf(f) ?? ''), m.refTagPrompt)` (also SheetGen.tsx:162) -> compile.ts:318-329 -> main venice.ts:79 veniceTags turns `@imageN` into `<Image N>`; ModelArk / Bridge adapters send the `@imageN` text as is.
- Code: compile.ts:325-326 ``const tag = … format === 'imageN' ? `@image${n + 1}` : …`` then `out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\]/g, '\$&') + '(?!\w)', 'g'), tag)`
- Fix idea: replace all titles in one pass (a single regex over every title, mapped through a lookup), or go through placeholder tokens first, so a produced tag is never matched again.

### E13. Clip Gen t2v: parked refs still rewrite the prompt's @names into positional ref tags, though no ref is sent
- Severity: LOW
- Status: PROVEN
- Trigger: Clip Gen, a clip with image refs attached and @names in the prompt -> switch mode to t2v (refs "kept but will NOT be sent") on an engine with refTagPrompt (Gemini Omni, Seedance 2.5, LTX, H3) -> render.
- What goes wrong: the wire prompt says `<IMAGE_REF_0> runs…` / `[Image1] …` / `Image 1 …` with zero images attached, instead of the words he wrote. The preflight does say the ref is not sent, but the name itself is replaced on the wire.
- Path: RenderPanel.tsx:1154 `if (m.refTagPrompt && !isI2v && refImages.length) outPrompt = applyRefTags(…)` (no `!isT2v`, unlike the video line 1155) -> 1176 `images: isI2v ? [startFile] : isT2v ? [] : refImages`.
- Code: `if (m.refTagPrompt && !isI2v && refImages.length) outPrompt = applyRefTags(outPrompt, refImages.map((f) => titleOf(f) ?? ''), m.refTagPrompt)`
- Fix idea: skip the ref-tag rewrite when isT2v (as the @video line already does).

### E14. Sheet Gen's paid renders are booked at $0: its video job carries no estimate, and its Nano Banana lane skips the Queue and the spend ledger
- Severity: MED
- Status: PROVEN
- Trigger: Sheet Gen -> ▶ Generate / ＋ Queue on a fal Seedance engine (a 15 s capture), or pick "Nano Banana (image)" and Generate.
- What goes wrong: (a) the queue row shows no "~$" and, when it lands, the ledger books `costUsd ?? estCost ?? 0` = $0 (fal returns no costUsd), so the SPND chip under-counts every sheet render. Clip Gen sends `estCost` for the same engine. (b) the Nano lane calls `vd().imageGenerate` directly: a paid fal image with no Queue row, no ledger entry, no recovery entry; and its only guard is `nanoBusy`.
- Path: SheetGen.tsx:159-187 videoJob (no `estCost`) -> store.ts:2448 `void get().addSpend({ …, cost: (r as RenderResult).costUsd ?? job.estCost ?? 0 })`; SheetGen.tsx:196-213 runNano -> `vd().imageGenerate(...)` (main has no addSpend of its own: only watch.ts calls it).
- Code: SheetGen.tsx:163-167 `return { kind: 'gen', label: clip.name, thumb: source?.file, engineLabel: m.label, payload: {…} }`
- Fix idea: compute estCost the way RenderPanel does (pricePerSec × duration) and send the Nano lane through enqueueRender as an 'image' job.

### E15. Clip Gen "+ new" (save the form as a clip) keeps everything but the beats
- Severity: MED
- Status: PROVEN
- Trigger: the selected clip goes away while its recipe is on screen (he deletes it in the Bin, the Co-Director removes it, an undo removes it, or the Director's Room picker is set to "— pick a clip —"). Clip Gen now says "⚠ not in the Bin yet — “+ new” saves it as a clip". He clicks "+ new".
- What goes wrong: the new clip gets the prompt, fields, refs and dials but NOT the beats, and the beats then vanish from the form. The beats were loaded, not edited, so `beatsDirtyRef` is false and the autosave strips them from the payload; then the new (empty) clip's `[]` beats differ from `lastSavedBeatsRef` (the old clip's beats), so the "external writer" branch adopts `[]` over the form.
- Path: RenderPanel.tsx:1049-1058 newClip (adopt) -> store.ts:1649-1654 createClip (selects the new empty clip) -> RenderPanel.tsx:734-740 load effect keeps the form -> 826-838 storeBeats effect: `if (incoming !== lastSavedBeatsRef.current) { …; beatsDirtyRef.current = false; setBeats((curr) => (JSON.stringify(curr) === incoming ? curr : storeBeats)) }` -> 1132-1134 autosave `const sentBeats = beatsDirtyRef.current … if (!sentBeats) delete payload.beats`.
- Code: RenderPanel.tsx:742 (load) `beatsDirtyRef.current = false // freshly loaded → beats not locally edited yet` is the state the adopt path inherits.
- Fix idea: in the adopt path set beatsDirtyRef = true and lastSavedBeatsRef to the new clip's beats before the first save, so the typed beats are sent and not treated as an external write.

### E16. Clip Gen project switch clears only part of the form: refs, links and engine dials of the old project carry into the new one
- Severity: LOW
- Status: PROVEN
- Trigger: Clip Gen showing a clip with @video/@audio refs, a prompt link or field links, LoRAs, a negative, an LTX/H3 size pin or H3 dials. Open another project.
- What goes wrong: the reset meant to stop "+ new adopting leftovers into the wrong project" clears name/prompt/fields/beats/image refs/dials, but not videoRefs, audioRefs, promptLink, fieldLinks, fieldOverrides, loras, loraOn, negative, ltxSize, the H3 dials, enhancedPaths or seed. Leftover video/audio refs keep `hasContent` true, so the form shows "not in the Bin yet" with "(deleted video)"/"(deleted track)" slots, and "+ new" adopts the old project's ids and settings into a clip of the new project.
- Path: RenderPanel.tsx:1024-1047 (reset list) vs 519-530 hasContent (includes videoRefs/audioRefs) -> 1049-1058 newClip adopt.
- Code: the reset sets `setClipName('') … setRefImages([]) … setAudio(true); setVideoUrl(null)` and stops there.
- Fix idea: reset every form field the load effect sets (one shared "empty form" setter used by both).

### E17. Watched → civit like → "→ send both" puts only the LAST lora into Image Gen, at weight 1
- Severity: MED
- Status: PROVEN
- Trigger: Watched panel, civit tab, an Image Gen open -> right-click a liked image whose two loras are in his folders -> "→ send both — the prompt + the first 2 loras".
- What goes wrong: the menu calls useLora for both loras in the same click. Watched's useLora just writes one store slot (`imageGenUseSeed = rel`) each time, so the second write replaces the first before Image Gen's effect reads it: one lora lands, the other is silently dropped. The image's weight is dropped too (the slot holds only the rel), so the lora goes in at 1, not the weight the image used. (The same menu inside Image Gen's own PNG box works: there useLora stacks through lorasIntent and takes the weight.)
- Path: settingsMenu.tsx:67-74 `for (const { l, st } of usable.slice(0, 2)) { if (st.kind === 'use') a.useLora(st.rel, l.weight) … }` -> Watch.tsx:359-364 `useLora: (rel) => { … useStore.getState().setImageGenUseSeed(rel); openImageGen() }` -> store.ts:2092 `setImageGenUseSeed: (rel) => set({ imageGenUseSeed: rel })` -> ImageGen.tsx:186-193 effect reads one value, calls `useLora(useSeed)` with the default weight 1.
- Code: ImageGen.tsx:188-191 `if (!useSeed) return; useStore.getState().setImageGenUseSeed(null); if (job) useLora(useSeed)`
- Fix idea: make the hand-off a list of {rel, weight} that Image Gen drains in order.

### E18. Voice card: switching the engine keeps the other supplier's picked voice id, which then passes the gate and fails at the supplier
- Severity: LOW
- Status: PROVEN
- Trigger: Voice card on Eleven v4 with a voice picked from his ElevenLabs account -> switch the model to Gemini 3.8 TTS (trying the same line on another engine) -> Generate.
- What goes wrong: `options.voice` still holds the ElevenLabs voice id. The voice dropdown shows that raw id as the pick, `canRender` passes because a voice is "picked", and main hands the Eleven id to Google as the voice name, so the take fails at Google (no audio). The same happens Gemini -> Eleven.
- Path: VoicesCard.tsx:270 `onChange={(v) => updR({ engine: v })}` (options untouched) -> 189 `pickedVoice` -> 212 canRender `(!!pickedVoice || …)` -> main index.ts:2718-2721 `const picked = … r.options.voice …; const supplierVoice = model.provider === 'fal' ? undefined : (picked ?? kept)`.
- Code: VoicesCard.tsx:292 `...(pickedVoice && !readyVoices.some((v) => v.id === pickedVoice) ? [{ value: pickedVoice, label: pickedVoice }] : [])`
- Fix idea: clear options.voice / voice2 when the engine's provider changes (keep it per provider if he wants it back).

### E19. Opening ENHANCE from Optical Flow overwrites his remembered Enhance settings
- Severity: LOW
- Status: PROVEN
- Trigger: his remembered Enhance setup is e.g. upscale ON (Real-ESRGAN ×2) + interpolate slow-motion ×4. He uses the speed dialog's Optical Flow, which opens ENHANCE with a flow source. Later he opens ENHANCE normally.
- What goes wrong: the flow forces interpOn = true, upscaleOn = false, times = flow.times, slowmo = 1, and the 500 ms save effect writes that into `enhanceLast`. The next normal Enhance opens with upscale off and his interpolation choice gone.
- Path: EnhancePanel.tsx:99-117 (load; flow wins) and 124-129 (flow effect) -> 118-122 `vd().setSettings({ enhanceLast: { interpOn, upscaleOn, ia, ua } })`.
- Code: `if (flow) { setInterpOn(true); setUpscaleOn(false); setIa((a) => ({ ...a, times: flow.times, fps: undefined, slowmo: 1 })) }`
- Fix idea: don't persist enhanceLast while the source is a flow source.

### E20. LoRA side panel and Models card read "has a Civitai key" once at mount; a key saved afterwards still blocks downloads
- Severity: LOW
- Status: PROVEN
- Trigger: open Image Gen (or the Models card) with no Civitai key, see "downloads need your Civitai key", paste the key in Settings (or the key wizard), come back and press download.
- What goes wrong: the button stays dimmed; the sidebar toasts "paste your Civitai key in Settings first" although it is saved; favorites stays disabled. Only a remount (close/reopen the panel) re-reads it.
- Path: ImageGenSidebar.tsx:168-172 (`useEffect(…, [])` reads getSettings once) -> 446-448; ModelsCard.tsx:66-68 same, -> 555-558. Neither listens to settingsRev (Score/Voice/SFX cards do).
- Code: `void vd().getSettings().then((s) => setHasKey(!!(s?.civitaiKey as string | undefined)?.trim()))` inside a `[]` effect.
- Fix idea: re-read on settingsRev, as the other cards do.

### E21. Image Gen: "delete take" on one take asks nothing and erases the PNG from disk
- Severity: MED
- Status: PROVEN for the delete; SUSPECT for the undo half (not traced through main's undo history)
- Trigger: Image Gen -> right-click a take (one take selected) -> "delete take" (a mis-aimed click in a long menu, right under the color rows).
- What goes wrong: no confirmation (only a multi-take delete confirms), and main unlinks the take's file unless it was saved to the Library. Clip Gen's take delete always warns and keeps the video on disk; this one is gone for good. If Ctrl+Z restores the project row, it brings back a take whose file no longer exists.
- Path: ImageGen.tsx:985-993 `if (batch && !(await confirmDialog(…))) return; for (const id of ids) await deleteTake(job.id, id)` -> store.ts:2126-2128 -> main project.ts:4370-4380 `if (!t.keptImageId) await unlink(t.file).catch(() => undefined)`.
- Code: `if (batch && !(await confirmDialog(`Delete ${ids.length} selected image takes? Their Library copies stay.`, …))) return`
- Fix idea: confirm single deletes too, and keep the file (as Clip Gen does) so undo can bring the take back.

### E22. Clip Gen: LoRAs picked for LTX ride into a MiniMax H3 render (and back) after a model switch
- Severity: LOW
- Status: PROVEN (code path); the render-side effect of a wrong-family LoRA in ComfyUI not run
- Trigger: Clip Gen on LTX 2.5 with LTX loras picked -> switch the model to MiniMax H3 (local) -> render.
- What goes wrong: `loras` is one list for both local engines. The chips stay lit (LoraChips is enabled for any local engine), the H3 side panel lists only H3 loras so the LTX picks look like H3 picks, and the request sends them: main only checks the file is on disk, not its family, and chains them into the H3 graph. The take's tooltip then lists LoRAs that never fit that model.
- Path: RenderPanel.tsx:194 one `loras` state -> 2631-2645 LoraChips `disabled={!isLocal}` -> 1196 `loras: isLocal && loraOn && loras.length ? loras : undefined` -> main index.ts:3486 `loras: req.loras` -> h3Local.ts:397-401 filter is `ltxLocal.loraOnDisk(l.name)` only.
- Code: h3Local.ts:397 `const picks = (a.loras ?? []).filter((l) => { const ok = ltxLocal.loraOnDisk(l.name); … })`
- Fix idea: send (and show as live) only the picks whose family matches the engine (loraFamilyOf), keep the others parked.

---

## Earlier audit check (AUDIT-2026-10-08.md Part 1, the items in this area; re-traced after the hunt)

- #9 E1 LoRA switch tooltip: CONFIRMED. ImageGen.tsx:678 still says `loras on = the two slots (and unleashed) chain into the model · off = none, picks kept`; main index.ts:2366 (was 2353) `const unleashed = r.unleashedOn && unleashedRow ? { … } : undefined` never reads `r.loraOn`, so unleashed runs with the switch off. The footer status line and the take's lora line also show unleashed regardless of the switch, so only the tooltip disagrees. Still his call.
- #6 A6 Image Edit variant loss: CONFIRMED. falImage.ts:122-131 downloads the result urls one by one inside `runInner`; a non-OK or empty download throws after earlier files were written, and the written ones are never returned (no try per file, no partial return).
- #7 D2 Get + Use same filename: CONFIRMED. index.ts:2540-2542 `dest = join(folder, stem, row.file)` then `if (existsSync(dest)) return { ok: true, file: dest }`, no version/sha check. Same early return also leaves the sidebar row stuck at 0 % (E4).
- #4 A2 cancelled parked job returns: CONFIRMED. store.ts:2279-2284 cancelJob only flips the row in memory; persistQueueSoon (store.ts:622-633) writes only rows whose projectDir is the open project, so the parked project's saved queue still lists it and the reopen toast re-queues it.
- #8 A4 spend in the wrong project: CONFIRMED. store.ts:2484-2486 `addSpend({ label: `${job.label} (finished after project switch)`, … })` books into whatever project is open.

## Coverage

Read in full: panels/RenderPanel.tsx (all 2,948 lines), ImageGen.tsx, ImageGenSidebar.tsx, SheetGen.tsx, CharSheet.tsx, StyleSheet.tsx, ScoreCard.tsx, VoicesCard.tsx, SfxCard.tsx, EnhancePanel.tsx, DirectorsRoom.tsx, CoDirector.tsx, CoDirectorTether.tsx, ModelsCard.tsx, ClipFields.tsx, EffectsPanel.tsx, Watch.tsx, WatchTimelineModal.tsx, BridgePanel.tsx, SetupWizard.tsx, SettingsModal.tsx, CheatSheet.tsx, AboutModal.tsx, Queue.tsx, panels/shared/takeRows.tsx (extra: the audio take row); components/Connections.tsx, components/CodirPlanStatus.tsx; ui/KeyWizard, LoraChips, ArkChip, Toast, Modal, dialogFocus, PanelErrorBoundary, FloatPick, EmptyState, caret, RenderSwitch, HeatMeter, RanTools; lib/tether, modelWizard, settingsMenu, setupServices, externalEditor, connections, h3Ready, ltxReady, civitActions, depthJob, imageGenReferenceDrop, exportEntry, validation, engineOptions, keySuppliers, codirFire; shared/models, audioModels, compile, enhance, emitScore, scoreRequest, blocking, watch, providerLimits, renderErrors, jobNotifications, loraFamilies, communityMoods, imageSources; prompt.tsx, emitYaml.ts, api.ts, watchBridge.ts, index.ts.

Skimmed only: shared/types.ts (PromptData, VoiceRenderArgs), shared/imageModels.ts (header + exports), shared/localModels.ts (id lists), lib/themes.ts (resolve/apply), ui/MoodFold.tsx (first 200 lines + delete/pin paths), ui/RefSuite.tsx (first 200 lines; it is the Video Editor's), ui/TourOverlay.tsx (settings write), ui/WhatsNew.tsx (grep for settings writes only), ui/icons.tsx and ui/controls.tsx (not opened: icon/style exports).

Followed into store.ts: render queue (enqueueRender, renderNow, startJob, pumpQueue, cancelJob, persistQueueSoon, sigOf), every setSettings caller, codirSendText / codirProgress / queue drain, createClip, selectClip, restorePatch, setEditorScore, imageGen seeds. Followed into main: render:run, draft.ts, fal.ts buildInput, falImage.ts, imagegen:render, imagegen:civitDownload / civitCancel, voice:render head, score:render span handling, krea2Local cancel, h3Local lora filter, ltxLocal/h3Local size fallback, watchIpc, settings mask/realKeyFor, addTake, renameClip, deleteImageGenTake, nextImageTitle/importImage, venice veniceTags.
