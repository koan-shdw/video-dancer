import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const api = {
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  getRecoveryStatus: () => ipcRenderer.invoke('recovery:status'),
  appName: 'Video Dancer',
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  falCredit: () => ipcRenderer.invoke('fal:credit'),
  arkSpend: () => ipcRenderer.invoke('ark:spend'),
  arkSpendCheck: (ak: string, sk: string) => ipcRenderer.invoke('ark:spendCheck', ak, sk),
  hfValidate: (key: string) => ipcRenderer.invoke('hf:validate', key),
  arkValidate: (key: string) => ipcRenderer.invoke('ark:validate', key),
  astriaValidate: (key: string) => ipcRenderer.invoke('astria:validate', key),
  veniceValidate: (key: string) => ipcRenderer.invoke('venice:validate', key),
  voiceVoices: (engine: string, search?: string) => ipcRenderer.invoke('voice:voices', engine, search),
  googleValidate: (key: string) => ipcRenderer.invoke('google:validate', key),
  elevenValidate: (key: string) => ipcRenderer.invoke('eleven:validate', key),
  blockBuild: (clipId: string) => ipcRenderer.invoke('block:build', clipId), // story-blocking sheet from the clip's beats
  // ----- ASSEMBLY -----
  assemblyConcept: (correction?: string) => ipcRenderer.invoke('assembly:concept', correction),
  assemblyLock: (locked: boolean) => ipcRenderer.invoke('assembly:lock', locked),
  assemblyAssemble: () => ipcRenderer.invoke('assembly:assemble'),
  // ----- MOODS (.vmd library) -----
  moodList: () => ipcRenderer.invoke('mood:list'),
  moodRead: (slug: string) => ipcRenderer.invoke('mood:read', slug),
  moodSave: (input: unknown) => ipcRenderer.invoke('mood:save', input),
  moodDelete: (slug: string) => ipcRenderer.invoke('mood:delete', slug),
  moodReveal: (slug: string) => ipcRenderer.invoke('mood:reveal', slug),
  moodImport: () => ipcRenderer.invoke('mood:import'),
  moodImportPaths: (paths: string[]) => ipcRenderer.invoke('mood:importPaths', paths),
  moodExport: (slug: string) => ipcRenderer.invoke('mood:export', slug),
  moodCommunity: () => ipcRenderer.invoke('mood:community'),
  moodCommunityInstall: (slug: string, replace?: boolean) => ipcRenderer.invoke('mood:communityInstall', slug, replace),
  moodCommunityShare: (slug: string) => ipcRenderer.invoke('mood:communityShare', slug),
  codirSetMoodsPinned: (slugs: string[]) => ipcRenderer.invoke('codir:setMoodsPinned', slugs),
  pickImages: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickImages'),
  render: (opts: unknown) => ipcRenderer.invoke('render:run', opts),
  // payload: { msg, pct? } — pct 0-1 is REAL engine progress (local renders only, bible 12.6)
  onRenderProgress: (cb: (p: { msg: string; pct?: number; jobId?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { msg: string; pct?: number; jobId?: string }): void => cb(p)
    ipcRenderer.on('render:progress', fn)
    return () => ipcRenderer.removeListener('render:progress', fn)
  },
  editRun: (req: unknown) => ipcRenderer.invoke('edit:run', req),
  editCreateClip: (req: unknown) => ipcRenderer.invoke('edit:createClip', req),
  renderCancel: (jobId: string) => ipcRenderer.invoke('render:cancel', jobId),
  onEditProgress: (cb: (msg: string) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('edit:progress', fn)
    return () => ipcRenderer.removeListener('edit:progress', fn)
  },
  projectCreateAt: (baseDir: string, name: string) => ipcRenderer.invoke('project:createAt', baseDir, name),
  projectDefaultBaseDir: () => ipcRenderer.invoke('project:defaultBaseDir'),
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
  projectOpen: () => ipcRenderer.invoke('project:open'),
  projectGet: () => ipcRenderer.invoke('project:get'),
  projectOpenLast: () => ipcRenderer.invoke('project:openLast'),
  projectOpenPath: (dir: string) => ipcRenderer.invoke('project:openPath', dir),
  projectRecents: () => ipcRenderer.invoke('project:recents'),
  projectPeekRecents: () => ipcRenderer.invoke('project:peekRecents'),
  projectFindIn: () => ipcRenderer.invoke('project:findIn'),
  playgroundList: () => ipcRenderer.invoke('playground:list'),
  playgroundStamp: (id: string) => ipcRenderer.invoke('playground:stamp', id),
  playgroundClear: (id: string) => ipcRenderer.invoke('playground:clear', id),
  onPlaygroundProgress: (cb: (p: { id: string; pct: number; msg?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { id: string; pct: number; msg?: string }): void => cb(p)
    ipcRenderer.on('playground:progress', fn)
    return () => ipcRenderer.removeListener('playground:progress', fn)
  },
  projectRenameAt: (dir: string, name: string) => ipcRenderer.invoke('project:renameAt', dir, name),
  projectDuplicateAt: (dir: string) => ipcRenderer.invoke('project:duplicateAt', dir),
  projectRemoveRecent: (dir: string) => ipcRenderer.invoke('project:removeRecent', dir),
  projectDeleteAt: (dir: string) => ipcRenderer.invoke('project:deleteAt', dir),
  projectStateSave: (name: string) => ipcRenderer.invoke('project:stateSave', name),
  projectStateList: () => ipcRenderer.invoke('project:stateList'),
  projectStateRestore: (file: string) => ipcRenderer.invoke('project:stateRestore', file),
  projectStateDelete: (file: string) => ipcRenderer.invoke('project:stateDelete', file),
  spendAdd: (entry: { label: string; kind: 'gen' | 'edit' | 'image'; cost: number }) => ipcRenderer.invoke('spend:add', entry),
  spendList: () => ipcRenderer.invoke('spend:list'),
  projectUndo: () => ipcRenderer.invoke('project:undo'),
  queueSave: (rows: unknown[]) => ipcRenderer.invoke('queue:save', rows),
  queueLoad: () => ipcRenderer.invoke('queue:load'),
  failureAdd: (f: unknown) => ipcRenderer.invoke('failure:add', f),
  onSaveError: (cb: (msg: string | null) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string | null): void => cb(msg)
    ipcRenderer.on('project:saveError', fn)
    return () => ipcRenderer.removeListener('project:saveError', fn)
  },
  projectRedo: () => ipcRenderer.invoke('project:redo'),
  projectCleanup: (apply: boolean) => ipcRenderer.invoke('project:cleanup', apply),
  revealFile: (p: string) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openLogs: () => ipcRenderer.invoke('log:open'),
  logRenderer: (msg: string) => ipcRenderer.invoke('log:renderer', msg),
  updateRestart: () => ipcRenderer.invoke('update:restart'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: (cb: (s: { status: string; info?: unknown }) => void) => {
    const fn = (_e: IpcRendererEvent, s: { status: string; info?: unknown }): void => cb(s)
    ipcRenderer.on('update:status', fn)
    return () => ipcRenderer.removeListener('update:status', fn)
  },
  libraryImport: () => ipcRenderer.invoke('library:import'),
  libraryImportAny: () => ipcRenderer.invoke('library:importAny'),
  watchPick: () => ipcRenderer.invoke('watch:pick'),
  watchClear: () => ipcRenderer.invoke('watch:clear'),
  watchList: () => ipcRenderer.invoke('watch:list'),
  watchAdd: (file: string) => ipcRenderer.invoke('watch:add', file),
  librarySaveFrame: (bytes: Uint8Array, note: string) => ipcRenderer.invoke('library:saveFrame', bytes, note),
  libraryImportBytes: (name: string, bytes: Uint8Array) => ipcRenderer.invoke('library:importBytes', name, bytes),
  libraryImportUrl: (url: string) => ipcRenderer.invoke('library:importUrl', url),
  libraryClipboardHasImage: () => ipcRenderer.invoke('library:clipboardHasImage'),
  libraryClipboardImage: () => ipcRenderer.invoke('library:clipboardImage'),
  libraryImportPaths: (paths: string[]) => ipcRenderer.invoke('library:importPaths', paths),
  audioImport: () => ipcRenderer.invoke('audio:import'),
  audioImportPaths: (paths: string[]) => ipcRenderer.invoke('audio:importPaths', paths),
  audioRename: (id: string, title: string) => ipcRenderer.invoke('audio:rename', id, title),
  audioSetDuration: (id: string, dur: number) => ipcRenderer.invoke('audio:setDuration', id, dur),
  audioDelete: (id: string) => ipcRenderer.invoke('audio:delete', id),
  videoImport: () => ipcRenderer.invoke('video:import'),
  videoImportPaths: (paths: string[]) => ipcRenderer.invoke('video:importPaths', paths),
  videoRename: (id: string, title: string) => ipcRenderer.invoke('video:rename', id, title),
  videoDelete: (id: string) => ipcRenderer.invoke('video:delete', id),
  videoMakeClip: (videoId: string) => ipcRenderer.invoke('video:makeClip', videoId),
  videoAddTakeToClip: (videoId: string, clipId: string) => ipcRenderer.invoke('video:addTakeToClip', videoId, clipId),
  veditRun: (req: unknown) => ipcRenderer.invoke('vedit:run', req),
  veditBakeLibrary: (sessionId: string, nodeId: string) => ipcRenderer.invoke('vedit:bakeLibrary', sessionId, nodeId),
  veditBakeClip: (sessionId: string, nodeId: string, target: unknown) => ipcRenderer.invoke('vedit:bakeClip', sessionId, nodeId, target),
  veditSetPrimary: (sessionId: string, nodeId: string | null) => ipcRenderer.invoke('vedit:setPrimary', sessionId, nodeId),
  veditDeleteBranch: (sessionId: string, nodeId: string) => ipcRenderer.invoke('vedit:deleteBranch', sessionId, nodeId),
  timelineSetMusic: (timelineId: string, music: unknown) => ipcRenderer.invoke('timeline:setMusic', timelineId, music),
  timelineSetMutes: (timelineId: string, mutes: unknown) => ipcRenderer.invoke('timeline:setMutes', timelineId, mutes),
  timelineSetExportPrefs: (timelineId: string, prefs: unknown) => ipcRenderer.invoke('timeline:setExportPrefs', timelineId, prefs),
  exportRun: (timelineId: string, bakes?: unknown, opts?: { batch?: boolean }) => ipcRenderer.invoke('export:run', timelineId, bakes, opts),
  exportPickDir: () => ipcRenderer.invoke('export:pickDir'),
  settingsPickExportDir: () => ipcRenderer.invoke('settings:pickExportDir'),
  watchTimeline: (args: import('@koan/vidancer-ui/shared/watch').WatchTimelineRequest) => ipcRenderer.invoke('watch:timeline', args),
  watchCancel: () => ipcRenderer.invoke('watch:cancel'),
  onWatchProgress: (cb: (msg: string) => void) => { const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg); ipcRenderer.on('watch:progress', fn); return () => { ipcRenderer.removeListener('watch:progress', fn) } },
  onWatchBake: (cb: (request: import('@koan/vidancer-ui/shared/watch').WatchBakeRequest) => void) => { const fn = (_e: IpcRendererEvent, request: import('@koan/vidancer-ui/shared/watch').WatchBakeRequest): void => cb(request); ipcRenderer.on('watch:bake', fn); return () => { ipcRenderer.removeListener('watch:bake', fn) } },
  watchBakeReply: (reply: import('@koan/vidancer-ui/shared/watch').WatchBakeReply) => ipcRenderer.send('watch:bakeReply', reply),
  onWatchBakeCancel: (cb: (id: string) => void) => { const fn = (_e: IpcRendererEvent, id: string): void => cb(id); ipcRenderer.on('watch:bakeCancel', fn); return () => { ipcRenderer.removeListener('watch:bakeCancel', fn) } },
  onWatchFinished: (cb: () => void) => { const fn = (): void => cb(); ipcRenderer.on('watch:finished', fn); return () => { ipcRenderer.removeListener('watch:finished', fn) } },
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  assetsDelete: (selection: import('@koan/vidancer-ui/shared/types').SendSelection) => ipcRenderer.invoke('assets:delete', selection),
  itemsSetDisabled: (selection: import('@koan/vidancer-ui/shared/types').SendSelection, disabled: boolean) => ipcRenderer.invoke('items:setDisabled', selection, disabled),
  appProgress: (v: number) => ipcRenderer.invoke('app:progress', v),
  onExportProgress: (cb: (msg: string) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('export:progress', fn)
    return () => ipcRenderer.removeListener('export:progress', fn)
  },
  // ----- EFFECTS v2 (fx stacks persist via timeline:set; the v16 setItemFx IPC is deleted) -----
  fxSidecars: (takeFile: string) => ipcRenderer.invoke('fx:sidecars', takeFile),
  fxProbe: (file: string) => ipcRenderer.invoke('fx:probe', file),
  fxEnsureModel: (kind: 'matte' | 'depth') => ipcRenderer.invoke('fx:ensureModel', kind),
  fxDeleteModel: (kind: 'matte' | 'depth') => ipcRenderer.invoke('fx:deleteModel', kind),
  fxReadModel: (kind: 'matte' | 'depth') => ipcRenderer.invoke('fx:readModel', kind),
  onFxModelProgress: (cb: (p: { kind: string; pct: number; got: number; total: number }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { kind: string; pct: number; got: number; total: number }): void => cb(p)
    ipcRenderer.on('fx:modelProgress', fn)
    return () => ipcRenderer.removeListener('fx:modelProgress', fn)
  },
  // ----- BRIDGE — MCP provider logins (BRIDGE-SPEC-2026-09-01) -----
  appBoot: () => ipcRenderer.invoke('app:boot'),
  bridgeList: () => ipcRenderer.invoke('bridge:list'),
  bridgeLogin: (id: string, slot?: number) => ipcRenderer.invoke('bridge:login', id, slot),
  bridgeLogout: (id: string, slot?: number) => ipcRenderer.invoke('bridge:logout', id, slot),
  bridgeAdd: (id: string, copy?: boolean) => ipcRenderer.invoke('bridge:add', id, copy),
  bridgeRename: (id: string, slot: number, name: string) => ipcRenderer.invoke('bridge:rename', id, slot, name),
  bridgeRefresh: () => ipcRenderer.invoke('bridge:refresh'),
  onBridgeChanged: (cb: () => void) => {
    const fn = (): void => cb()
    ipcRenderer.on('bridge:changed', fn)
    return () => ipcRenderer.removeListener('bridge:changed', fn)
  },
  editorsList: () => ipcRenderer.invoke('editors:list'),
  editorsPick: () => ipcRenderer.invoke('editors:pick'),
  editorsOpen: (file: string, editorId: string, sourceTitle: string, editedFrom?: string) => ipcRenderer.invoke('editors:open', file, editorId, sourceTitle, editedFrom),
  editorsImport: (watchId: string) => ipcRenderer.invoke('editors:import', watchId),
  editorsDismiss: (watchId: string) => ipcRenderer.invoke('editors:dismiss', watchId),
  onEditorsPending: (cb: (list: { watchId: string; file: string; name: string; editor: string; mtime: number }[]) => void) => {
    const fn = (_e: IpcRendererEvent, list: { watchId: string; file: string; name: string; editor: string; mtime: number }[]): void => cb(list)
    ipcRenderer.on('editors:pending', fn)
    return () => ipcRenderer.removeListener('editors:pending', fn)
  },
  onMoodsChanged: (cb: () => void) => {
    const fn = (): void => cb()
    ipcRenderer.on('moods:changed', fn)
    return () => ipcRenderer.removeListener('moods:changed', fn)
  },
  onBridgeDialog: (cb: (line: { who: string; service: string; text: string }) => void) => {
    const fn = (_e: IpcRendererEvent, line: { who: string; service: string; text: string }): void => cb(line)
    ipcRenderer.on('bridge:dialog', fn)
    return () => ipcRenderer.removeListener('bridge:dialog', fn)
  },
  // ----- Models card (LOCAL-MODELS-PLAN phase 2) — the one download surface -----
  modelsList: () => ipcRenderer.invoke('models:list'),
  modelsDownload: (id: string) => ipcRenderer.invoke('models:download', id),
  modelsUpdate: (id: string) => ipcRenderer.invoke('models:update', id),
  modelsCancel: (id: string) => ipcRenderer.invoke('models:cancel', id),
  modelsDelete: (id: string) => ipcRenderer.invoke('models:delete', id),
  modelsRuntimeTest: () => ipcRenderer.invoke('models:runtimeTest'),
  // ----- LoRA shelf (LTX-SPEC §7) -----
  lorasList: () => ipcRenderer.invoke('loras:list'),
  lorasCivitai: (query: string, sort: 'downloads' | 'newest', baseModels?: string[]) => ipcRenderer.invoke('loras:civitai', query, sort, baseModels),
  lorasOfficial: (family?: string) => ipcRenderer.invoke('loras:official', family),
  lorasInstall: (item: unknown) => ipcRenderer.invoke('loras:install', item),
  lorasCancel: (file: string) => ipcRenderer.invoke('loras:cancel', file),
  lorasDelete: (file: string) => ipcRenderer.invoke('loras:delete', file),
  lorasTag: (file: string, baseModel: string) => ipcRenderer.invoke('loras:tag', file, baseModel),
  lorasThumb: (url: string) => ipcRenderer.invoke('loras:thumb', url),
  lorasImport: (path: string) => ipcRenderer.invoke('loras:import', path),
  onLorasProgress: (cb: (p: { file: string; pct: number; note?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { file: string; pct: number; note?: string }): void => cb(p)
    ipcRenderer.on('loras:progress', fn)
    return () => ipcRenderer.removeListener('loras:progress', fn)
  },
  onLorasDone: (cb: (p: { file: string; ok: boolean; error?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { file: string; ok: boolean; error?: string }): void => cb(p)
    ipcRenderer.on('loras:done', fn)
    return () => ipcRenderer.removeListener('loras:done', fn)
  },
  modelsDiskFree: () => ipcRenderer.invoke('models:diskFree'),
  modelsFreeGpu: () => ipcRenderer.invoke('models:freeGpu'),
  wavePeaks: (file: string) => ipcRenderer.invoke('wave:peaks', file),
  onModelsProgress: (cb: (p: { id: string; pct: number; got: number; total: number; note?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { id: string; pct: number; got: number; total: number; note?: string }): void => cb(p)
    ipcRenderer.on('models:progress', fn)
    return () => ipcRenderer.removeListener('models:progress', fn)
  },
  onModelsStarted: (cb: (p: { id: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { id: string }): void => cb(p)
    ipcRenderer.on('models:started', fn)
    return () => ipcRenderer.removeListener('models:started', fn)
  },
  onModelsDone: (cb: (p: { id: string; ok: boolean; error?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { id: string; ok: boolean; error?: string }): void => cb(p)
    ipcRenderer.on('models:done', fn)
    return () => ipcRenderer.removeListener('models:done', fn)
  },
  fxPassStart: (takeFile: string, kind: 'matte' | 'depth', w: number, h: number, fps: number) => ipcRenderer.invoke('fx:passStart', takeFile, kind, w, h, fps),
  fxEncodeFrame: (id: string, frame: Uint8Array) => ipcRenderer.invoke('fx:encodeFrame', id, frame),
  fxEncodeEnd: (id: string, keep: boolean) => ipcRenderer.invoke('fx:encodeEnd', id, keep),
  exportPlan: (timelineId: string) => ipcRenderer.invoke('export:plan', timelineId),
  fxBakeStart: (w: number, h: number, fps: number, projectDir?: string) => ipcRenderer.invoke('fx:bakeStart', w, h, fps, projectDir),
  clipRename: (clipId: string, name: string) => ipcRenderer.invoke('clip:rename', clipId, name),
  mediaExportAs: (file: string, kind: 'image' | 'video' | 'audio', title: string) => ipcRenderer.invoke('media:exportAs', file, kind, title),
  startFileDrag: (file: string) => ipcRenderer.send('drag:file', file),
  clipNew: (name?: string) => ipcRenderer.invoke('clip:new', name),
  clipSetPromptData: (clipId: string, pd: unknown) => ipcRenderer.invoke('clip:setPromptData', clipId, pd),
  scoreRender: (req: unknown) => ipcRenderer.invoke('score:render', req),
  scoreCompose: (args: unknown) => ipcRenderer.invoke('score:compose', args),
  scoreNew: (name?: string, kind?: 'sfx') => ipcRenderer.invoke('score:new', name, kind),
  scoreSet: (id: string, patch: unknown) => ipcRenderer.invoke('score:set', id, patch),
  scoreSetKeeper: (id: string, takeId: string) => ipcRenderer.invoke('score:setKeeper', id, takeId),
  scoreTakeMeta: (id: string, takeId: string, patch: unknown) => ipcRenderer.invoke('score:takeMeta', id, takeId, patch),
  scoreFromTake: (id: string, takeId: string) => ipcRenderer.invoke('score:fromTake', id, takeId),
  scoreDelete: (id: string) => ipcRenderer.invoke('score:delete', id),
  scoreDuplicate: (id: string) => ipcRenderer.invoke('score:duplicate', id),
  charSheetNew: (name?: string) => ipcRenderer.invoke('charsheet:new', name),
  charSheetSet: (id: string, patch: unknown) => ipcRenderer.invoke('charsheet:set', id, patch),
  charSheetDelete: (id: string) => ipcRenderer.invoke('charsheet:delete', id),
  voiceNew: (name?: string) => ipcRenderer.invoke('voice:new', name),
  // ----- Image Gen (KREA2-LOCAL-SPEC-2026-09-08) -----
  imageGenNew: (name?: string, recipe?: unknown) => ipcRenderer.invoke('imagegen:new', name, recipe),
  imageGenSet: (id: string, patch: unknown) => ipcRenderer.invoke('imagegen:set', id, patch),
  imageGenKeeper: (id: string, takeId: string) => ipcRenderer.invoke('imagegen:keeper', id, takeId),
  imageGenTakeMeta: (id: string, takeId: string, patch: unknown) => ipcRenderer.invoke('imagegen:takeMeta', id, takeId, patch),
  imageGenTakeDelete: (id: string, takeId: string) => ipcRenderer.invoke('imagegen:takeDelete', id, takeId),
  imageGenDelete: (id: string) => ipcRenderer.invoke('imagegen:delete', id),
  imageGenDuplicate: (id: string) => ipcRenderer.invoke('imagegen:duplicate', id),
  imageGenToLibrary: (id: string, takeId: string) => ipcRenderer.invoke('imagegen:toLibrary', id, takeId),
  imageGenStatus: () => ipcRenderer.invoke('imagegen:status'),
  imageGenRender: (req: unknown) => ipcRenderer.invoke('imagegen:render', req),
  imageGenCancel: (jobId?: string) => ipcRenderer.invoke('imagegen:cancel', jobId),
  onImageGenProgress: (cb: (p: { id: string; msg: string; pct?: number }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { id: string; msg: string; pct?: number }): void => cb(p)
    ipcRenderer.on('imagegen:progress', fn)
    return () => ipcRenderer.removeListener('imagegen:progress', fn)
  },
  imageGenReadPng: (path: string) => ipcRenderer.invoke('imagegen:readPng', path),
  imageGenPickPng: () => ipcRenderer.invoke('imagegen:pickPng'),
  imageGenFolders: () => ipcRenderer.invoke('imagegen:folders'),
  imageGenPickFolder: (family: string) => ipcRenderer.invoke('imagegen:pickFolder', family),
  imageGenForgetFolder: (dir: string) => ipcRenderer.invoke('imagegen:forgetFolder', dir),
  onImageGenFolders: (cb: (folders: { path: string; family: string }[]) => void) => {
    const fn = (_e: IpcRendererEvent, f: { path: string; family: string }[]): void => cb(f)
    ipcRenderer.on('imagegen:folders', fn)
    return () => ipcRenderer.removeListener('imagegen:folders', fn)
  },
  imageGenLoras: () => ipcRenderer.invoke('imagegen:loras'),
  imageGenLoraTag: (root: string, rel: string, family: string) => ipcRenderer.invoke('imagegen:loraTag', root, rel, family),
  onImageGenLoraScan: (cb: (p: { done: number; total: number; finished?: boolean }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { done: number; total: number; finished?: boolean }): void => cb(p)
    ipcRenderer.on('imagegen:loraScan', fn)
    return () => ipcRenderer.removeListener('imagegen:loraScan', fn)
  },
  imageGenCivit: (args: unknown) => ipcRenderer.invoke('imagegen:civit', args),
  // CIVIT LIKES (CIVIT-LIKES-SPEC): his likes on civitai.com, their generation data, the file for imports
  civitLiked: (cursor?: string | number) => ipcRenderer.invoke('civit:liked', cursor),
  civitGeneration: (id: number) => ipcRenderer.invoke('civit:generation', id),
  civitVersionImages: (versionId: number, cursor?: string) => ipcRenderer.invoke('civit:versionImages', versionId, cursor),
  civitImageFile: (id: number, url: string) => ipcRenderer.invoke('civit:imageFile', id, url),
  civitMe: (key: string) => ipcRenderer.invoke('civit:me', key),
  imageGenCivitDownload: (row: unknown, family?: string) => ipcRenderer.invoke('imagegen:civitDownload', row, family),
  imageGenCivitGetVersion: (versionId: number) => ipcRenderer.invoke('imagegen:civitGetVersion', versionId),
  imageGenCivitCancel: (key: string) => ipcRenderer.invoke('imagegen:civitCancel', key),
  imageGenCivitDelete: (id: string) => ipcRenderer.invoke('imagegen:civitDelete', id),
  onImageGenDlProgress: (cb: (p: { key: string; pct: number; note?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { key: string; pct: number; note?: string }): void => cb(p)
    ipcRenderer.on('imagegen:dlProgress', fn)
    return () => ipcRenderer.removeListener('imagegen:dlProgress', fn)
  },
  onImageGenDlDone: (cb: (p: { key: string; ok: boolean; error?: string }) => void) => {
    const fn = (_e: IpcRendererEvent, p: { key: string; ok: boolean; error?: string }): void => cb(p)
    ipcRenderer.on('imagegen:dlDone', fn)
    return () => ipcRenderer.removeListener('imagegen:dlDone', fn)
  },
  imageGenThumb: (url: string) => ipcRenderer.invoke('imagegen:thumb', url),
  voiceSet: (id: string, patch: unknown) => ipcRenderer.invoke('voice:set', id, patch),
  voiceSetKeeper: (id: string, takeId: string) => ipcRenderer.invoke('voice:setKeeper', id, takeId),
  voiceTakeDuration: (id: string, takeId: string, sec: number) => ipcRenderer.invoke('voice:takeDuration', id, takeId, sec),
  voiceTakeMeta: (id: string, takeId: string, patch: unknown) => ipcRenderer.invoke('voice:takeMeta', id, takeId, patch),
  voiceFromTake: (id: string, takeId: string) => ipcRenderer.invoke('voice:fromTake', id, takeId),
  voiceTakeDelete: (id: string, takeId: string) => ipcRenderer.invoke('voice:takeDelete', id, takeId),
  voiceDelete: (id: string) => ipcRenderer.invoke('voice:delete', id),
  voiceRender: (req: unknown) => ipcRenderer.invoke('voice:render', req),
  voiceDescribe: (sheetId: string) => ipcRenderer.invoke('voice:describe', sheetId),
  itemsReorder: (kind: 'bin' | 'lib', movedIds: string[], targetId: string) => ipcRenderer.invoke('items:reorder', kind, movedIds, targetId),
  styleNew: (name?: string) => ipcRenderer.invoke('style:new', name),
  styleSet: (id: string, patch: unknown) => ipcRenderer.invoke('style:set', id, patch),
  styleDelete: (id: string) => ipcRenderer.invoke('style:delete', id),
  timelineSet: (timelineId: string, items: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:set', timelineId, items, baseRev),
  timelineSetBoth: (timelineId: string, items: unknown, audioItems: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:setBoth', timelineId, items, audioItems, baseRev),
  timelineSlice: (timelineId: string, itemId: string, cutSec: number) => ipcRenderer.invoke('timeline:slice', timelineId, itemId, cutSec),
  timelineSliceAudio: (timelineId: string, audioId: string, cutSec: number) => ipcRenderer.invoke('timeline:sliceAudio', timelineId, audioId, cutSec),
  timelineSliceScore: (timelineId: string, scoreId: string, cutSec: number) => ipcRenderer.invoke('timeline:sliceScore', timelineId, scoreId, cutSec),
  timelineSetAll: (timelineId: string, items: unknown, audioItems: unknown, scoreItems: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:setAll', timelineId, items, audioItems, scoreItems, baseRev),
  nestCreate: (parentId: string, inner: unknown, items: unknown, audioItems: unknown, baseRev?: number) => ipcRenderer.invoke('nest:create', parentId, inner, items, audioItems, baseRev),
  mediaReverse: (file: string) => ipcRenderer.invoke('media:reverse', file),
  keepersSet: (kind: string, ownerId: string, takeIds: string[], on: boolean | null) => ipcRenderer.invoke('keepers:set', kind, ownerId, takeIds, on),
  timelineSetAudioItems: (timelineId: string, audioItems: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:setAudioItems', timelineId, audioItems, baseRev),
  timelineSetScoreItems: (timelineId: string, scoreItems: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:setScoreItems', timelineId, scoreItems, baseRev),
  timelineUnlinkAudio: (timelineId: string, itemId: string) => ipcRenderer.invoke('timeline:unlinkAudio', timelineId, itemId),
  timelineSetMeta: (timelineId: string, patch: unknown) => ipcRenderer.invoke('timeline:setMeta', timelineId, patch),
  timelineAdd: (name?: string) => ipcRenderer.invoke('timeline:add', name),
  timelineRename: (id: string, name: string) => ipcRenderer.invoke('timeline:rename', id, name),
  timelineSetAspect: (id: string, ar: string) => ipcRenderer.invoke('timeline:setAspect', id, ar),
  timelineDuplicate: (id: string) => ipcRenderer.invoke('timeline:duplicate', id),
  timelineDelete: (id: string) => ipcRenderer.invoke('timeline:delete', id),
  timelineSetActive: (id: string) => ipcRenderer.invoke('timeline:setActive', id),
  clipFromTake: (clipId: string, takeId: string) => ipcRenderer.invoke('clip:fromTake', clipId, takeId),
  clipSetKeeper: (clipId: string, takeId: string) => ipcRenderer.invoke('clip:setKeeper', clipId, takeId),
  clipAddTakeFile: (clipId: string) => ipcRenderer.invoke('clip:addTakeFile', clipId),
  clipSetStoryboard: (clipId: string, imageId: string | null) => ipcRenderer.invoke('clip:setStoryboard', clipId, imageId),
  takeSetMeta: (clipId: string, takeId: string, patch: unknown) => ipcRenderer.invoke('take:setMeta', clipId, takeId, patch),
  takeDelete: (clipId: string, takeId: string) => ipcRenderer.invoke('take:delete', clipId, takeId),
  takeSetDuration: (clipId: string, takeId: string, durationSec: number) =>
    ipcRenderer.invoke('take:setDuration', clipId, takeId, durationSec),
  importPickProject: (title?: string) => ipcRenderer.invoke('import:pickProject', title),
  importClips: (dir: string, clipIds: string[]) => ipcRenderer.invoke('import:clips', dir, clipIds),
  sendAssets: (destDir: string, sel: unknown) => ipcRenderer.invoke('send:assets', destDir, sel),
  imageGenerate: (req: unknown) => ipcRenderer.invoke('image:generate', req),
  imageTagNode: (sessionId: string, nodeId: string) => ipcRenderer.invoke('image:tagNode', sessionId, nodeId),
  imageDeleteBranch: (sessionId: string, nodeId: string) => ipcRenderer.invoke('image:deleteBranch', sessionId, nodeId),
  onImageProgress: (cb: (msg: string) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('image:progress', fn)
    return () => ipcRenderer.removeListener('image:progress', fn)
  },
  clipDelete: (id: string) => ipcRenderer.invoke('clip:delete', id),
  clipsDelete: (ids: string[]) => ipcRenderer.invoke('clips:delete', ids),
  clipDuplicate: (id: string) => ipcRenderer.invoke('clip:duplicate', id),
  clipsFromImages: (imageIds: string[], place?: { timelineId: string; index: number }) => ipcRenderer.invoke('clips:fromImages', imageIds, place),
  sheetClipNew: (imageId: string, mode: string) => ipcRenderer.invoke('sheet:clipNew', imageId, mode),
  sheetBuild: (clipId: string, takeId: string, pick?: number[]) => ipcRenderer.invoke('sheet:build', clipId, takeId, pick),
  imageSetSheet: (imageId: string, mode: string | null) => ipcRenderer.invoke('image:setSheet', imageId, mode),
  clipFromImagesAsBeats: (imageIds: string[]) => ipcRenderer.invoke('clip:fromImagesAsBeats', imageIds),
  imageDelete: (id: string) => ipcRenderer.invoke('image:delete', id),
  imagesDelete: (ids: string[]) => ipcRenderer.invoke('images:delete', ids),
  imageCropSave: (req: unknown) => ipcRenderer.invoke('image:cropSave', req),
  imageDuplicate: (id: string) => ipcRenderer.invoke('image:duplicate', id),
  imageRename: (id: string, title: string) => ipcRenderer.invoke('image:rename', id, title),
  imageAddDynamicStill: (itemId: string, edge: 'first' | 'last') => ipcRenderer.invoke('image:addDynamicStill', itemId, edge),
  imageSetPrimary: (sessionId: string, nodeId: string | null) => ipcRenderer.invoke('image:setPrimary', sessionId, nodeId),
  onProjectDelta: (cb: (d: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, d: unknown): void => cb(d)
    ipcRenderer.on('project:delta', fn)
    return () => ipcRenderer.removeListener('project:delta', fn)
  },
  folderAdd: (kind: 'bin' | 'lib' | 'sheet' | 'score' | 'voice' | 'style' | 'imagegen', name: string, parent: string | null) => ipcRenderer.invoke('folder:add', kind, name, parent),
  folderRename: (id: string, name: string) => ipcRenderer.invoke('folder:rename', id, name),
  folderDelete: (id: string) => ipcRenderer.invoke('folder:delete', id),
  folderMove: (id: string, parent: string | null) => ipcRenderer.invoke('folder:move', id, parent),
  itemMove: (kind: 'bin' | 'lib' | 'sheet' | 'score' | 'voice' | 'style' | 'imagegen', itemId: string | string[], folderId: string | null) => ipcRenderer.invoke('item:move', kind, itemId, folderId),
  layoutSave: (json: unknown) => ipcRenderer.invoke('layout:save', json),
  layoutLoad: () => ipcRenderer.invoke('layout:load'),
  codirSend: (req: unknown) => ipcRenderer.invoke('codir:send', req),
  codirCancel: () => ipcRenderer.invoke('codir:cancel'),
  codirBridgeStatus: (refresh?: boolean) => ipcRenderer.invoke('codir:bridgeStatus', refresh),
  codirBridgeUpdate: () => ipcRenderer.invoke('codir:bridgeUpdate'),
  codirBridgeLogin: () => ipcRenderer.invoke('codir:bridgeLogin'),
  codirBridgeModels: () => ipcRenderer.invoke('codir:bridgeModels'),
  // list 52: ENHANCE
  enhanceRun: (args: unknown) => ipcRenderer.invoke('enhance:run', args),
  enhancePreview: (args: unknown) => ipcRenderer.invoke('enhance:preview', args),
  enhanceTools: (refresh?: boolean) => ipcRenderer.invoke('enhance:tools', refresh),
  enhanceFacts: (src: unknown) => ipcRenderer.invoke('enhance:facts', src),
  onEnhanceProgress: (cb: (p: { msg: string; pct?: number }) => void) => {
    const fn = (_e: unknown, p: { msg: string; pct?: number }): void => cb(p)
    ipcRenderer.on('enhance:progress', fn)
    return () => ipcRenderer.removeListener('enhance:progress', fn)
  },
  codirCliStatus: (cli: string, refresh?: boolean) => ipcRenderer.invoke('codir:cliStatus', cli, refresh),
  codirCliLogin: (cli: string) => ipcRenderer.invoke('codir:cliLogin', cli),
  codirCliModels: (cli: string) => ipcRenderer.invoke('codir:cliModels', cli),
  codirDeepseekModels: () => ipcRenderer.invoke('codir:deepseekModels'),
  deepseekValidate: (key: string) => ipcRenderer.invoke('deepseek:validate', key),
  codirClearLog: () => ipcRenderer.invoke('codir:clearLog'),
  codirCompact: () => ipcRenderer.invoke('codir:compact'),
  codirSetBrief: (brief: string) => ipcRenderer.invoke('codir:setBrief', brief),
  codirModels: () => ipcRenderer.invoke('codir:models'),
  codirVeniceModels: () => ipcRenderer.invoke('codir:veniceModels'),
  codirGuides: () => ipcRenderer.invoke('codir:guides'),
  codirGuideOpen: (id: string) => ipcRenderer.invoke('codir:guideOpen', id),
  codirGuideRevert: (id: string) => ipcRenderer.invoke('codir:guideRevert', id),
  codirGuidePurgeLearned: () => ipcRenderer.invoke('codir:guidePurgeLearned'),
  onCodirProgress: (cb: (e: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, ev: unknown): void => cb(ev)
    ipcRenderer.on('codir:progress', fn)
    return () => ipcRenderer.removeListener('codir:progress', fn)
  },
  // list 27: main asks the window to press a render button; the panel's status line goes back
  onCodirFire: (cb: (req: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, req: unknown): void => cb(req)
    ipcRenderer.on('codir:fire', fn)
    return () => ipcRenderer.removeListener('codir:fire', fn)
  },
  codirFireDone: (reqId: string, r: unknown) => ipcRenderer.invoke('codir:fireDone', reqId, r),
  screenList: () => ipcRenderer.invoke('screen:list'),
  mirrorOpen: (displayId: number) => ipcRenderer.invoke('mirror:open', displayId),
  mirrorClose: () => ipcRenderer.invoke('mirror:close'),
  mirrorState: (s: unknown) => ipcRenderer.send('mirror:state', s),
  onMirrorState: (cb: (s: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on('mirror:state', fn)
    return () => ipcRenderer.removeListener('mirror:state', fn)
  },
  onMirrorClosed: (cb: () => void) => {
    const fn = (): void => cb()
    ipcRenderer.on('mirror:closed', fn)
    return () => ipcRenderer.removeListener('mirror:closed', fn)
  }
}

contextBridge.exposeInMainWorld('vidancer', api)
