import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type { WatchBakeReply, WatchTimelineRequest } from '@koan/vidancer-ui/shared/watch'
import { setWatchBaker, setWatchFinished, watchTimeline, cancelTimelineWatch, timelineWatchBusy } from './watchTimeline'
import { planExport, type ExportBake } from './export'
import type { WatchOpts } from './watch'

export function registerWatchIpc(window: () => BrowserWindow | null, options: () => Promise<WatchOpts>): void {
  const send = (channel: string, data?: unknown): void => { const win = window(); if (win && !win.isDestroyed()) win.webContents.send(channel, data) }
  setWatchFinished(() => send('watch:finished'))
  const pending = new Map<string, { sender: number; done: (reply: WatchBakeReply) => void }>()
  ipcMain.on('watch:bakeReply', (event, reply: WatchBakeReply) => {
    const job = pending.get(reply?.id)
    if (job?.sender === event.sender.id) job.done(reply)
  })
  setWatchBaker(async (project, timeline, signal) => {
    const plan = await planExport(project, timeline)
    signal.throwIfAborted()
    return new Promise<ExportBake[]>((resolve, reject) => {
    const win = window()
    if (!win || win.isDestroyed()) return reject(new Error('The app window is not available.'))
    const id = randomUUID()
    const abort = (): void => { if (!win.isDestroyed()) win.webContents.send('watch:bakeCancel', id) }
    const timer = setTimeout(() => { abort(); finish({ id, error: 'Timeline preparation timed out.' }) }, 10 * 60_000)
    const finish = (reply: WatchBakeReply): void => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); win.removeListener('closed', closed); pending.delete(id)
      if (reply.error) reject(Object.assign(new Error(reply.error), { bakes: reply.bakes ?? [] })); else resolve(reply.bakes ?? [])
    }
    const closed = (): void => finish({ id, error: 'The app window closed.' })
    win.once('closed', closed)
    pending.set(id, { sender: win.webContents.id, done: finish })
    signal.addEventListener('abort', abort, { once: true })
    win.webContents.send('watch:bake', { id, project, timeline, plan })
    if (signal.aborted) abort()
    })
  })
  ipcMain.handle('watch:timeline', async (_event, args: WatchTimelineRequest) => {
    if (timelineWatchBusy()) return { ok: false, error: 'A timeline watch is already running.' }
    if (!args || typeof args.timelineId !== 'string' || (args.range != null && args.range !== 'full' && args.range !== 'selection')) return { ok: false, error: 'Invalid timeline watch request.' }
    return await watchTimeline(args, await options(), msg => send('watch:progress', msg))
  })
  ipcMain.handle('watch:cancel', () => cancelTimelineWatch())
}
