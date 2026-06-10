import { app, BrowserWindow, ipcMain, dialog, protocol, type IpcMainInvokeEvent } from 'electron'
import { join, dirname, basename, extname } from 'path'
import { readFile, writeFile, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { Readable } from 'stream'

// custom scheme so the renderer can STREAM local video/images straight to <video>/<img>
// (instead of reading whole files over IPC into Blobs). Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])
import { runSeedance, type RenderRequest } from './fal'
import {
  getProject,
  newProject,
  openProject,
  importImage,
  importImages,
  addTake,
  renameClip,
  newEmptyClip,
  setClipPromptData,
  setTimeline,
  cloneClipFromTake,
  setKeeperTake,
  deleteClip,
  duplicateClip,
  deleteImage,
  duplicateImage,
  renameImage,
  addFolder,
  renameFolder,
  deleteFolder,
  moveToFolder,
  type PromptData,
  type TimelineItem,
  type SceneFields,
  type CharacterField,
  type BeatField,
  type ProductionFields
} from './project'

let mainWindow: BrowserWindow | null = null

interface Settings {
  falKey?: string
  falAdminKey?: string
  astriaKey?: string
  anthropicKey?: string
  lastProjectDir?: string
  [k: string]: unknown
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf-8')) as Settings
  } catch {
    return {}
  }
}
async function saveSettings(s: Settings): Promise<void> {
  await writeFile(settingsFile(), JSON.stringify(s, null, 2), 'utf-8')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0e0e11',
    title: 'Video Dancer',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

type RenderIpcRequest = RenderRequest & {
  clipId?: string
  name?: string
  freeform: string
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
}

function registerIpc(): void {
  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const s = { ...(await loadSettings()), ...patch }
    await saveSettings(s)
    return s
  })

  // current fal credit balance — needs a fal ADMIN key (account/billing scope)
  ipcMain.handle('fal:credit', async () => {
    const s = await loadSettings()
    if (!s.falAdminKey) return { ok: false, error: 'No fal admin key saved.' }
    try {
      const res = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', {
        headers: { Authorization: `Key ${s.falAdminKey}` }
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: `fal billing ${res.status}${body ? ': ' + body.slice(0, 200) : ''}` }
      }
      const data = (await res.json()) as { credits?: { current_balance?: number; currency?: string } }
      return { ok: true, balance: data.credits?.current_balance, currency: data.credits?.currency }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('dialog:pickImages', async () => {
    if (!mainWindow) return []
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    return r.canceled ? [] : r.filePaths
  })

  // ----- projects -----
  ipcMain.handle('project:new', async () => {
    if (!mainWindow) return null
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'New Video Dancer Project',
      defaultPath: join(app.getPath('documents'), 'Untitled'),
      buttonLabel: 'Create Project'
    })
    if (r.canceled || !r.filePath) return null
    const p = await newProject(dirname(r.filePath), basename(r.filePath))
    await saveSettings({ ...(await loadSettings()), lastProjectDir: p.dir })
    return p
  })

  ipcMain.handle('project:open', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Video Dancer Project (pick the project folder)',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = await openProject(r.filePaths[0])
    if (p) await saveSettings({ ...(await loadSettings()), lastProjectDir: p.dir })
    return p
  })

  ipcMain.handle('project:openLast', async () => {
    const s = await loadSettings()
    if (!s.lastProjectDir) return null
    return openProject(s.lastProjectDir) // returns null if it was moved/deleted
  })

  ipcMain.handle('project:get', async () => getProject())

  ipcMain.handle('media:read', async (_e, file: string) => {
    try {
      return new Uint8Array(await readFile(file))
    } catch {
      return null
    }
  })

  ipcMain.handle('library:import', async () => {
    if (!mainWindow || !getProject()) return { project: getProject(), importedIds: [] }
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return { project: getProject(), importedIds: [] }
    return importImages(r.filePaths)
  })

  // import images dragged in from the OS (desktop/Explorer) — paths come from the renderer
  ipcMain.handle('library:importPaths', async (_e, paths: string[]) => {
    if (!getProject() || !Array.isArray(paths) || paths.length === 0) return { project: getProject(), importedIds: [] }
    return importImages(paths)
  })

  ipcMain.handle('clip:rename', async (_e, clipId: string, name: string) => renameClip(clipId, name))

  ipcMain.handle('clip:new', async (_e, name?: string) => newEmptyClip(name))

  ipcMain.handle('clip:setPromptData', async (_e, clipId: string, pd: Partial<PromptData>) => setClipPromptData(clipId, pd))

  ipcMain.handle('timeline:set', async (_e, items: TimelineItem[]) => setTimeline(items))

  ipcMain.handle('clip:fromTake', async (_e, clipId: string, takeId: string) => cloneClipFromTake(clipId, takeId))

  ipcMain.handle('clip:setKeeper', async (_e, clipId: string, takeId: string) => setKeeperTake(clipId, takeId))

  // ----- organize: delete / duplicate / folders -----
  ipcMain.handle('clip:delete', async (_e, id: string) => deleteClip(id))
  ipcMain.handle('clip:duplicate', async (_e, id: string) => duplicateClip(id))
  ipcMain.handle('image:delete', async (_e, id: string) => deleteImage(id))
  ipcMain.handle('image:duplicate', async (_e, id: string) => duplicateImage(id))
  ipcMain.handle('image:rename', async (_e, id: string, title: string) => renameImage(id, title))
  ipcMain.handle('folder:add', async (_e, kind: 'bin' | 'lib', name: string, parent: string | null) => addFolder(kind, name, parent))
  ipcMain.handle('folder:rename', async (_e, id: string, name: string) => renameFolder(id, name))
  ipcMain.handle('folder:delete', async (_e, id: string) => deleteFolder(id))
  ipcMain.handle('item:move', async (_e, kind: 'bin' | 'lib', itemId: string, folderId: string | null) => moveToFolder(kind, itemId, folderId))

  ipcMain.handle('layout:save', async (_e, json: unknown) => {
    const p = getProject()
    if (!p) return false
    try {
      await writeFile(join(p.dir, 'layout.json'), JSON.stringify(json), 'utf-8')
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('layout:load', async () => {
    const p = getProject()
    if (!p) return null
    try {
      return JSON.parse(await readFile(join(p.dir, 'layout.json'), 'utf-8'))
    } catch {
      return null
    }
  })

  // ----- render -----
  ipcMain.handle('render:run', async (e: IpcMainInvokeEvent, req: RenderIpcRequest) => {
    try {
      const s = await loadSettings()
      if (!s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }

      let proj = getProject()
      if (!proj) proj = await newProject(app.getPath('documents'), 'Untitled') // auto-create so a first render still works

      const takePath = await runSeedance({
        ...req,
        falKey: s.falKey,
        outDir: join(proj.dir, 'renders'),
        onProgress: (m) => e.sender.send('render:progress', m)
      })

      // copy source images into the project library, collect ids
      const imageIds: string[] = []
      for (const p of req.images) imageIds.push((await importImage(p)).id)
      let endImageId: string | undefined
      if (req.mode === 'i2v' && req.endImage) endImageId = (await importImage(req.endImage)).id

      const promptData: PromptData = {
        mode: req.mode,
        freeform: req.freeform,
        scene: req.scene,
        characters: req.characters,
        beats: req.beats,
        production: req.production,
        imageIds,
        endImageId,
        duration: req.duration,
        resolution: req.resolution,
        aspectRatio: req.aspectRatio,
        generateAudio: req.generateAudio,
        seed: req.seed
      }

      const { project, clipId, takeId } = await addTake({
        clipId: req.clipId,
        name: req.name || `clip ${proj.clips.length + 1}`,
        promptData,
        takeFile: takePath
      })

      const bytes = new Uint8Array(await readFile(takePath))
      return { ok: true, project, clipId, takeId, bytes }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

app.whenReady().then(() => {
  // media://x/<encodeURIComponent(absPath)> → streams the file WITH HTTP Range support, so <video>
  // is seekable (scrub frame-by-frame) and canvas use stays untainted (CORS header).
  protocol.handle('media', async (request) => {
    try {
      const p = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
      const st = await stat(p)
      const ext = extname(p).toLowerCase()
      const type =
        ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
      const range = request.headers.get('Range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        const start = m && m[1] ? parseInt(m[1], 10) : 0
        const end = m && m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1
        const body = Readable.toWeb(createReadStream(p, { start, end })) as unknown as ReadableStream
        return new Response(body, {
          status: 206,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Accept-Ranges': 'bytes',
            'Content-Type': type,
            'Content-Range': `bytes ${start}-${end}/${st.size}`,
            'Content-Length': String(end - start + 1)
          }
        })
      }
      const body = Readable.toWeb(createReadStream(p)) as unknown as ReadableStream
      return new Response(body, {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': type, 'Content-Length': String(st.size) }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
