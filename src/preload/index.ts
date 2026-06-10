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
  libraryImport: () => ipcRenderer.invoke('library:import'),
  libraryImportPaths: (paths: string[]) => ipcRenderer.invoke('library:importPaths', paths),
  clipRename: (clipId: string, name: string) => ipcRenderer.invoke('clip:rename', clipId, name),
  clipNew: (name?: string) => ipcRenderer.invoke('clip:new', name),
  clipSetPromptData: (clipId: string, pd: unknown) => ipcRenderer.invoke('clip:setPromptData', clipId, pd),
  timelineSet: (items: unknown) => ipcRenderer.invoke('timeline:set', items),
  clipFromTake: (clipId: string, takeId: string) => ipcRenderer.invoke('clip:fromTake', clipId, takeId),
  clipSetKeeper: (clipId: string, takeId: string) => ipcRenderer.invoke('clip:setKeeper', clipId, takeId),
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
