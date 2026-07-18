import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {
  appName: 'Video Dancer',
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  falCredit: () => ipcRenderer.invoke('fal:credit'),
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
  projectUndo: () => ipcRenderer.invoke('project:undo'),
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
  timelineSetMusic: (timelineId: string, music: unknown) => ipcRenderer.invoke('timeline:setMusic', timelineId, music),
  timelineSetMutes: (timelineId: string, mutes: unknown) => ipcRenderer.invoke('timeline:setMutes', timelineId, mutes),
  timelineSetExportPrefs: (timelineId: string, prefs: unknown) => ipcRenderer.invoke('timeline:setExportPrefs', timelineId, prefs),
  exportRun: (timelineId: string) => ipcRenderer.invoke('export:run', timelineId),
  onExportProgress: (cb: (msg: string) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('export:progress', fn)
    return () => ipcRenderer.removeListener('export:progress', fn)
  },
  clipRename: (clipId: string, name: string) => ipcRenderer.invoke('clip:rename', clipId, name),
  clipExport: (clipId: string, takeId?: string) => ipcRenderer.invoke('clip:export', clipId, takeId),
  startFileDrag: (file: string) => ipcRenderer.send('drag:file', file),
  clipNew: (name?: string) => ipcRenderer.invoke('clip:new', name),
  clipSetPromptData: (clipId: string, pd: unknown) => ipcRenderer.invoke('clip:setPromptData', clipId, pd),
  styleNew: (name?: string) => ipcRenderer.invoke('style:new', name),
  styleSet: (id: string, patch: unknown) => ipcRenderer.invoke('style:set', id, patch),
  styleDelete: (id: string) => ipcRenderer.invoke('style:delete', id),
  timelineSet: (timelineId: string, items: unknown, baseRev?: number) => ipcRenderer.invoke('timeline:set', timelineId, items, baseRev),
  timelineSlice: (timelineId: string, itemId: string, cutSec: number) => ipcRenderer.invoke('timeline:slice', timelineId, itemId, cutSec),
  timelineAdd: (name?: string) => ipcRenderer.invoke('timeline:add', name),
  timelineRename: (id: string, name: string) => ipcRenderer.invoke('timeline:rename', id, name),
  timelineSetAspect: (id: string, ar: string) => ipcRenderer.invoke('timeline:setAspect', id, ar),
  timelineDuplicate: (id: string) => ipcRenderer.invoke('timeline:duplicate', id),
  timelineDelete: (id: string) => ipcRenderer.invoke('timeline:delete', id),
  timelineSetActive: (id: string) => ipcRenderer.invoke('timeline:setActive', id),
  clipFromTake: (clipId: string, takeId: string) => ipcRenderer.invoke('clip:fromTake', clipId, takeId),
  clipSetKeeper: (clipId: string, takeId: string) => ipcRenderer.invoke('clip:setKeeper', clipId, takeId),
  takeSetDuration: (clipId: string, takeId: string, durationSec: number) =>
    ipcRenderer.invoke('take:setDuration', clipId, takeId, durationSec),
  importPickProject: () => ipcRenderer.invoke('import:pickProject'),
  importClips: (dir: string, clipIds: string[]) => ipcRenderer.invoke('import:clips', dir, clipIds),
  imageGenerate: (req: unknown) => ipcRenderer.invoke('image:generate', req),
  imageTagNode: (sessionId: string, nodeId: string) => ipcRenderer.invoke('image:tagNode', sessionId, nodeId),
  imageDeleteBranch: (sessionId: string, nodeId: string) => ipcRenderer.invoke('image:deleteBranch', sessionId, nodeId),
  onImageProgress: (cb: (msg: string) => void) => {
    const fn = (_e: IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('image:progress', fn)
    return () => ipcRenderer.removeListener('image:progress', fn)
  },
  clipDelete: (id: string) => ipcRenderer.invoke('clip:delete', id),
  clipDuplicate: (id: string) => ipcRenderer.invoke('clip:duplicate', id),
  imageDelete: (id: string) => ipcRenderer.invoke('image:delete', id),
  imageDuplicate: (id: string) => ipcRenderer.invoke('image:duplicate', id),
  imageRename: (id: string, title: string) => ipcRenderer.invoke('image:rename', id, title),
  imageAddDynamicStill: (itemId: string, edge: 'first' | 'last') => ipcRenderer.invoke('image:addDynamicStill', itemId, edge),
  imageSetPrimary: (sessionId: string, nodeId: string | null) => ipcRenderer.invoke('image:setPrimary', sessionId, nodeId),
  onProjectDelta: (cb: (d: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, d: unknown): void => cb(d)
    ipcRenderer.on('project:delta', fn)
    return () => ipcRenderer.removeListener('project:delta', fn)
  },
  folderAdd: (kind: 'bin' | 'lib', name: string, parent: string | null) => ipcRenderer.invoke('folder:add', kind, name, parent),
  folderRename: (id: string, name: string) => ipcRenderer.invoke('folder:rename', id, name),
  folderDelete: (id: string) => ipcRenderer.invoke('folder:delete', id),
  itemMove: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => ipcRenderer.invoke('item:move', kind, itemId, folderId),
  layoutSave: (json: unknown) => ipcRenderer.invoke('layout:save', json),
  layoutLoad: () => ipcRenderer.invoke('layout:load'),
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
