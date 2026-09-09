// The 9 loras:* IPC handlers — one copy (SPEC.md). Each app registers with its own
// key reader; the shelf engine must already be configured (configureLoraShelf).
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import * as loraShelf from './loraShelf'
import type { LoraCatalogItem } from '../types'

export function registerLorasIpc(ipcMain: IpcMain, opts: { getCivitaiKey: () => Promise<string> }): void {
  ipcMain.handle('loras:list', async () => ({
    installed: await loraShelf.listInstalled(),
    jobs: loraShelf.activeJobs(),
    errors: Object.fromEntries(loraShelf.lastErrors)
  }))
  ipcMain.handle('loras:civitai', async (_e, query: string, sort: 'downloads' | 'newest', baseModels?: string[]) => {
    try {
      return { ok: true, items: await loraShelf.civitaiSearch(query ?? '', sort ?? 'downloads', baseModels?.length ? baseModels : undefined) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('loras:official', async () => {
    try {
      return { ok: true, items: await loraShelf.officialList() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('loras:install', async (e: IpcMainInvokeEvent, item: LoraCatalogItem) => {
    try {
      await loraShelf.install(item, await opts.getCivitaiKey(), e.sender)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('loras:cancel', (_e, file: string) => {
    loraShelf.cancel(file)
    return true
  })
  ipcMain.handle('loras:delete', async (_e, file: string) => {
    await loraShelf.deleteLora(file)
    return true
  })
  ipcMain.handle('loras:tag', async (_e, file: string, baseModel: string) => {
    await loraShelf.tagLora(file, baseModel)
    return true
  })
  ipcMain.handle('loras:thumb', async (_e, url: string) => loraShelf.thumb(url))
  ipcMain.handle('loras:import', async (_e, path: string) => loraShelf.importFile(path))
}
