import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {
  appName: 'Video Dancer',
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  falCredit: () => ipcRenderer.invoke('fal:credit'),
  hfValidate: (key: string) => ipcRenderer.invoke('hf:validate', key),
  arkValidate: (key: string) => ipcRenderer.invoke('ark:validate', key),
  astriaValidate: (key: string) => ipcRenderer.invoke('astria:validate', key),
  pickImages: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickImages'),
  render: (opts: unknown) => ipcRenderer.invoke('render:run', opts),
  onRenderProgress: (cb: (msg: string) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg)
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
  watchPick: () => ipcRenderer.invoke('watch:pick'),
  watchClear: () => ipcRenderer.invoke('watch:clear'),
  watchList: () => ipcRenderer.invoke('watch:list'),
  librarySaveFrame: (bytes: Uint8Array, note: string) => ipcRenderer.invoke('library:saveFrame', bytes, note),
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
  exportRun: (timelineId: string, bakes?: unknown) => ipcRenderer.invoke('export:run', timelineId, bakes),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
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
  // ----- Models card (LOCAL-MODELS-PLAN phase 2) — the one download surface -----
  modelsList: () => ipcRenderer.invoke('models:list'),
  modelsDownload: (id: string) => ipcRenderer.invoke('models:download', id),
  modelsCancel: (id: string) => ipcRenderer.invoke('models:cancel', id),
  modelsDelete: (id: string) => ipcRenderer.invoke('models:delete', id),
  modelsRuntimeTest: () => ipcRenderer.invoke('models:runtimeTest'),
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
  fxBakeStart: (w: number, h: number, fps: number) => ipcRenderer.invoke('fx:bakeStart', w, h, fps),
  clipRename: (clipId: string, name: string) => ipcRenderer.invoke('clip:rename', clipId, name),
  clipExport: (clipId: string, takeId?: string) => ipcRenderer.invoke('clip:export', clipId, takeId),
  startFileDrag: (file: string) => ipcRenderer.send('drag:file', file),
  clipNew: (name?: string) => ipcRenderer.invoke('clip:new', name),
  clipSetPromptData: (clipId: string, pd: unknown) => ipcRenderer.invoke('clip:setPromptData', clipId, pd),
  scoreRender: (req: unknown) => ipcRenderer.invoke('score:render', req),
  scoreCompose: (args: unknown) => ipcRenderer.invoke('score:compose', args),
  scoreNew: (name?: string) => ipcRenderer.invoke('score:new', name),
  scoreSet: (id: string, patch: unknown) => ipcRenderer.invoke('score:set', id, patch),
  scoreSetKeeper: (id: string, takeId: string) => ipcRenderer.invoke('score:setKeeper', id, takeId),
  scoreTakeMeta: (id: string, takeId: string, patch: unknown) => ipcRenderer.invoke('score:takeMeta', id, takeId, patch),
  scoreFromTake: (id: string, takeId: string) => ipcRenderer.invoke('score:fromTake', id, takeId),
  scoreDelete: (id: string) => ipcRenderer.invoke('score:delete', id),
  scoreDuplicate: (id: string) => ipcRenderer.invoke('score:duplicate', id),
  charSheetNew: (name?: string) => ipcRenderer.invoke('charsheet:new', name),
  charSheetSet: (id: string, patch: unknown) => ipcRenderer.invoke('charsheet:set', id, patch),
  charSheetDelete: (id: string) => ipcRenderer.invoke('charsheet:delete', id),
  voiceSessionNew: (sheetId?: string) => ipcRenderer.invoke('voice:sessionNew', sheetId),
  voiceSessionDelete: (id: string) => ipcRenderer.invoke('voice:sessionDelete', id),
  voiceDeleteBranch: (sessionId: string, nodeId: string) => ipcRenderer.invoke('voice:deleteBranch', sessionId, nodeId),
  voiceKeep: (sessionId: string, nodeId: string, title?: string) => ipcRenderer.invoke('voice:keep', sessionId, nodeId, title),
  voiceSet: (id: string, patch: unknown) => ipcRenderer.invoke('voice:set', id, patch),
  voiceDelete: (id: string) => ipcRenderer.invoke('voice:delete', id),
  voiceImport: (paths: string[]) => ipcRenderer.invoke('voice:import', paths),
  voiceRender: (req: unknown) => ipcRenderer.invoke('voice:render', req),
  itemsReorder: (kind: 'bin' | 'lib', movedIds: string[], targetId: string) => ipcRenderer.invoke('items:reorder', kind, movedIds, targetId),
  styleNew: (name?: string) => ipcRenderer.invoke('style:new', name),
  styleSet: (id: string, patch: unknown) => ipcRenderer.invoke('style:set', id, patch),
  styleDelete: (id: string) => ipcRenderer.invoke('style:delete', id),
  timelineSet: (timelineId: string, items: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:set', timelineId, items, baseRev),
  timelineSetBoth: (timelineId: string, items: unknown, audioItems: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:setBoth', timelineId, items, audioItems, baseRev),
  timelineSlice: (timelineId: string, itemId: string, cutSec: number) => ipcRenderer.invoke('timeline:slice', timelineId, itemId, cutSec),
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
  folderAdd: (kind: 'bin' | 'lib' | 'sheet' | 'score', name: string, parent: string | null) => ipcRenderer.invoke('folder:add', kind, name, parent),
  folderRename: (id: string, name: string) => ipcRenderer.invoke('folder:rename', id, name),
  folderDelete: (id: string) => ipcRenderer.invoke('folder:delete', id),
  itemMove: (kind: 'bin' | 'lib' | 'sheet' | 'score', itemId: string | string[], folderId: string | null) => ipcRenderer.invoke('item:move', kind, itemId, folderId),
  layoutSave: (json: unknown) => ipcRenderer.invoke('layout:save', json),
  layoutLoad: () => ipcRenderer.invoke('layout:load'),
  codirSend: (req: unknown) => ipcRenderer.invoke('codir:send', req),
  codirCancel: () => ipcRenderer.invoke('codir:cancel'),
  codirBridgeStatus: (refresh?: boolean) => ipcRenderer.invoke('codir:bridgeStatus', refresh),
  codirBridgeModels: () => ipcRenderer.invoke('codir:bridgeModels'),
  codirClearLog: () => ipcRenderer.invoke('codir:clearLog'),
  codirSetBrief: (brief: string) => ipcRenderer.invoke('codir:setBrief', brief),
  codirModels: () => ipcRenderer.invoke('codir:models'),
  codirGuides: () => ipcRenderer.invoke('codir:guides'),
  codirGuideOpen: (id: string) => ipcRenderer.invoke('codir:guideOpen', id),
  codirGuideRevert: (id: string) => ipcRenderer.invoke('codir:guideRevert', id),
  codirGuidePurgeLearned: () => ipcRenderer.invoke('codir:guidePurgeLearned'),
  onCodirProgress: (cb: (e: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, ev: unknown): void => cb(ev)
    ipcRenderer.on('codir:progress', fn)
    return () => ipcRenderer.removeListener('codir:progress', fn)
  },
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
