// Silent auto-update via electron-updater. The installed app polls the PUBLIC update feed
// (the video-dancer-releases repo, configured in package.json build.publish), downloads a newer
// version in the background, and applies it on restart. The feed is public, so NO token ships in
// the app. The renderer gets status events so it can show "update ready — restart."
//
// WINDOWS ONLY for now: macOS auto-update requires an Apple-signed + notarized build (Squirrel.Mac
// hard requirement). Until an Apple Developer account is added, mac testers download each build
// manually — so we don't even start the updater on darwin (it would only error). Flip the guard
// when signing lands.
import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

let started = false

export function initUpdater(win: BrowserWindow): void {
  if (started) return
  started = true

  if (!app.isPackaged) return // dev build — nothing to replace
  if (process.platform !== 'win32') return // mac/linux: no signed auto-update yet

  autoUpdater.autoDownload = true // pull the update quietly in the background (public feed — no token)
  autoUpdater.autoInstallOnAppQuit = true // also apply on a normal quit if the user didn't restart

  const send = (status: string, info?: unknown): void => {
    win.webContents.send('update:status', { status, info })
  }

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking'))
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version)
    send('downloading', { version: info.version })
  })
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'))
  autoUpdater.on('download-progress', (p) => send('progress', { percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded:', info.version)
    send('ready', { version: info.version }) // renderer shows "restart to update"
  })
  autoUpdater.on('error', (err) => console.error('[updater] error:', err instanceof Error ? err.message : err))

  ipcMain.handle('update:restart', () => autoUpdater.quitAndInstall())
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => null))

  // check on launch (give the window a beat to mount), then every 3 hours while running
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => null), 4000)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => null), 3 * 60 * 60 * 1000)
}
