import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {
  appName: 'Video Dancer',
  version: '0.0.1',
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
  projectNew: () => ipcRenderer.invoke('project:new'),
  projectOpen: () => ipcRenderer.invoke('project:open'),
  projectGet: () => ipcRenderer.invoke('project:get'),
  projectOpenLast: () => ipcRenderer.invoke('project:openLast'),
  projectUndo: () => ipcRenderer.invoke('project:undo'),
  projectRedo: () => ipcRenderer.invoke('project:redo'),
  libraryImport: () => ipcRenderer.invoke('library:import'),
  librarySaveFrame: (bytes: Uint8Array, note: string) => ipcRenderer.invoke('library:saveFrame', bytes, note),
  libraryImportPaths: (paths: string[]) => ipcRenderer.invoke('library:importPaths', paths),
  audioImport: () => ipcRenderer.invoke('audio:import'),
  audioImportPaths: (paths: string[]) => ipcRenderer.invoke('audio:importPaths', paths),
  audioRename: (id: string, title: string) => ipcRenderer.invoke('audio:rename', id, title),
  audioSetDuration: (id: string, dur: number) => ipcRenderer.invoke('audio:setDuration', id, dur),
  audioDelete: (id: string) => ipcRenderer.invoke('audio:delete', id),
  timelineSetMusic: (timelineId: string, music: unknown) => ipcRenderer.invoke('timeline:setMusic', timelineId, music),
  timelineSetMutes: (timelineId: string, mutes: unknown) => ipcRenderer.invoke('timeline:setMutes', timelineId, mutes),
  clipRename: (clipId: string, name: string) => ipcRenderer.invoke('clip:rename', clipId, name),
  clipNew: (name?: string) => ipcRenderer.invoke('clip:new', name),
  clipSetPromptData: (clipId: string, pd: unknown) => ipcRenderer.invoke('clip:setPromptData', clipId, pd),
  timelineSet: (timelineId: string, items: unknown) => ipcRenderer.invoke('timeline:set', timelineId, items),
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
  folderAdd: (kind: 'bin' | 'lib', name: string, parent: string | null) => ipcRenderer.invoke('folder:add', kind, name, parent),
  folderRename: (id: string, name: string) => ipcRenderer.invoke('folder:rename', id, name),
  folderDelete: (id: string) => ipcRenderer.invoke('folder:delete', id),
  itemMove: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => ipcRenderer.invoke('item:move', kind, itemId, folderId),
  layoutSave: (json: unknown) => ipcRenderer.invoke('layout:save', json),
  layoutLoad: () => ipcRenderer.invoke('layout:load')
}

contextBridge.exposeInMainWorld('vidancer', api)
