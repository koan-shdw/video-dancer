import { app, BrowserWindow, ipcMain, dialog, protocol, type IpcMainInvokeEvent } from 'electron'
import { join, dirname, basename, extname, resolve, relative, isAbsolute } from 'path'
import { readFile, writeFile, stat, rename } from 'fs/promises'
import { existsSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import type { Settings } from '../shared/types'

// custom scheme so the renderer can STREAM local video/images straight to <video>/<img>
// (instead of reading whole files over IPC into Blobs). Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])
import { runRender, type RenderRequest } from './fal'
import { runImageGen } from './falImage'
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
  setTimelineItems,
  addTimeline,
  renameTimeline,
  setTimelineAspect,
  duplicateTimeline,
  deleteTimeline,
  setActiveTimeline,
  cloneClipFromTake,
  setKeeperTake,
  setTakeDuration,
  peekProject,
  importClipsFrom,
  appendEditNodes,
  tagEditNode,
  deleteEditBranch,
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

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

async function loadSettings(): Promise<Settings> {
  const file = settingsFile()
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as Settings
  } catch (e) {
    // a MISSING file is normal (first run); a CORRUPT one would silently wipe the user's keys —
    // shout about it so the loss is at least diagnosable
    if (existsSync(file)) console.error('[settings] corrupt settings.json — starting with empty settings:', e instanceof Error ? e.message : e)
    return {}
  }
}
// settings writes are atomic (tmp + rename) and SERIALIZED: read-modify-write happens under a
// single lock chain so two quick patches can never drop each other's changes
let settingsChain: Promise<unknown> = Promise.resolve()
function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const out = settingsChain.then(async () => {
    const s = { ...(await loadSettings()), ...patch }
    const file = settingsFile()
    await writeFile(file + '.tmp', JSON.stringify(s, null, 2), 'utf-8')
    await rename(file + '.tmp', file)
    return s
  })
  settingsChain = out.catch((e) => {
    console.error('[settings] save failed:', e instanceof Error ? e.message : e)
    return {}
  })
  return out
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
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => patchSettings(patch))

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
    await patchSettings({ lastProjectDir: p.dir })
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
    if (p) await patchSettings({ lastProjectDir: p.dir })
    return p
  })

  ipcMain.handle('project:openLast', async () => {
    const s = await loadSettings()
    if (!s.lastProjectDir) return null
    return openProject(s.lastProjectDir) // returns null if it was moved/deleted
  })

  ipcMain.handle('project:get', async () => getProject())

  // (media:read removed — filmstrips and players all stream via the media:// protocol now)

  ipcMain.handle('library:import', async () => {
    if (!mainWindow || !getProject()) return { delta: undefined, importedIds: [] }
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return { delta: undefined, importedIds: [] }
    return importImages(r.filePaths)
  })

  // import images dragged in from the OS (desktop/Explorer) — paths come from the renderer
  ipcMain.handle('library:importPaths', async (_e, paths: string[]) => {
    if (!getProject() || !Array.isArray(paths) || paths.length === 0) return { delta: undefined, importedIds: [] }
    return importImages(paths)
  })

  ipcMain.handle('clip:rename', async (_e, clipId: string, name: string) => renameClip(clipId, name))

  ipcMain.handle('clip:new', async (_e, name?: string) => newEmptyClip(name))

  ipcMain.handle('clip:setPromptData', async (_e, clipId: string, pd: Partial<PromptData>) => setClipPromptData(clipId, pd))

  ipcMain.handle('timeline:set', async (_e, timelineId: string, items: TimelineItem[]) => setTimelineItems(timelineId, items))
  ipcMain.handle('timeline:add', async (_e, name?: string) => addTimeline(name))
  ipcMain.handle('timeline:rename', async (_e, id: string, name: string) => renameTimeline(id, name))
  ipcMain.handle('timeline:setAspect', async (_e, id: string, ar: string) => setTimelineAspect(id, ar))
  ipcMain.handle('timeline:duplicate', async (_e, id: string) => duplicateTimeline(id))
  ipcMain.handle('timeline:delete', async (_e, id: string) => deleteTimeline(id))
  ipcMain.handle('timeline:setActive', async (_e, id: string) => setActiveTimeline(id))

  ipcMain.handle('clip:fromTake', async (_e, clipId: string, takeId: string) => cloneClipFromTake(clipId, takeId))

  ipcMain.handle('clip:setKeeper', async (_e, clipId: string, takeId: string) => setKeeperTake(clipId, takeId))

  // renderer measured a take's real video length on first load — persist it (drives timeline block length)
  ipcMain.handle('take:setDuration', async (_e, clipId: string, takeId: string, durationSec: number) =>
    setTakeDuration(clipId, takeId, durationSec)
  )

  // ----- image editor: Nano Banana generate/edit with a persisted results tree -----
  ipcMain.handle(
    'image:generate',
    async (
      e: IpcMainInvokeEvent,
      req: {
        rootImageId: string // '' = generate-from-scratch session
        parentNodeId: string | null
        prompt: string
        refIds: string[]
        numImages: number
        seed?: number
        aspectRatio: string
      }
    ) => {
      try {
        const s = await loadSettings()
        if (!s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }
        const proj = getProject()
        if (!proj) return { ok: false, error: 'No project open.' }

        // base = the selected node's image, else the root Library image (absent for from-scratch)
        const session = proj.editSessions.find((x) => x.rootImageId === req.rootImageId)
        const parentNode = req.parentNodeId ? session?.nodes.find((n) => n.id === req.parentNodeId) : undefined
        const rootImage = req.rootImageId ? proj.images.find((i) => i.id === req.rootImageId) : undefined
        const baseImage = parentNode?.file ?? rootImage?.file
        if (req.rootImageId && !baseImage) return { ok: false, error: 'Source image not found.' }
        const refFiles = req.refIds
          .map((id) => proj.images.find((i) => i.id === id)?.file)
          .filter((f): f is string => !!f)

        const r = await runImageGen({
          prompt: req.prompt,
          baseImage,
          refImages: refFiles,
          numImages: req.numImages,
          seed: req.seed,
          aspectRatio: req.aspectRatio,
          falKey: s.falKey,
          outDir: join(proj.dir, 'images', 'edits'),
          onProgress: (m) => e.sender.send('image:progress', m)
        })
        const appended = await appendEditNodes({
          rootImageId: req.rootImageId,
          parentId: req.parentNodeId,
          files: r.files,
          prompt: req.prompt,
          seed: r.seed ?? req.seed,
          refIds: req.refIds
        })
        if (!appended) return { ok: false, error: 'project closed during generation' }
        return { ok: true, delta: appended.delta, nodeIds: appended.nodeIds }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
  ipcMain.handle('image:tagNode', async (_e, sessionId: string, nodeId: string) => tagEditNode(sessionId, nodeId))
  ipcMain.handle('image:deleteBranch', async (_e, sessionId: string, nodeId: string) => deleteEditBranch(sessionId, nodeId))

  // ----- cross-project clip import: pick an old project folder, list its clips, copy some in -----
  ipcMain.handle('import:pickProject', async () => {
    if (!mainWindow || !getProject()) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Import clips — pick a Video Dancer project folder',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return peekProject(r.filePaths[0]) // null = no readable project.json in that folder
  })
  ipcMain.handle('import:clips', async (_e, dir: string, clipIds: string[]) => {
    if (!getProject() || !Array.isArray(clipIds) || clipIds.length === 0) return null
    return importClipsFrom(dir, clipIds)
  })

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

      const rendered = await runRender({
        ...req,
        falKey: s.falKey,
        outDir: join(proj.dir, 'renders'),
        onProgress: (m) => e.sender.send('render:progress', m)
      })
      const takePath = rendered.file

      // copy source images into the project library, collect ids (+ the imported entries for the delta)
      const importedImages: import('../shared/types').ProjImage[] = []
      const imageIds: string[] = []
      for (const p of req.images) {
        const img = await importImage(p)
        imageIds.push(img.id)
        importedImages.push(img)
      }
      let endImageId: string | undefined
      if (req.mode === 'i2v' && req.endImage) {
        const img = await importImage(req.endImage)
        endImageId = img.id
        importedImages.push(img)
      }

      const promptData: PromptData = {
        engine: req.engine ?? 'seedance2',
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

      const { delta, clipId, takeId } = await addTake({
        clipId: req.clipId,
        name: req.name || `clip ${proj.clips.length + 1}`,
        promptData,
        takeFile: takePath,
        durationSec: rendered.durationSec
      })
      if (importedImages.length) delta.images = importedImages

      const bytes = new Uint8Array(await readFile(takePath))
      return { ok: true, delta, clipId, takeId, bytes }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// the media surface may ONLY serve files belonging to the open project — anything else on disk
// is off-limits (was: any absolute path streamed, a data-exfiltration channel).
// Windows paths are case-insensitive — normalize casing before comparing so 'c:\proj' can't be
// judged outside 'C:\proj' (or vice versa).
function insideProject(p: string): boolean {
  const proj = getProject()
  if (!proj) return false
  const norm = (x: string): string => (process.platform === 'win32' ? resolve(x).toLowerCase() : resolve(x))
  const rel = relative(norm(proj.dir), norm(p))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

app.whenReady().then(() => {
  // media://x/<encodeURIComponent(absPath)> → streams the file WITH HTTP Range support, so <video>
  // is seekable (scrub frame-by-frame) and canvas use stays untainted (CORS header — acceptable
  // because the handler refuses every path outside the open project's folder).
  protocol.handle('media', async (request) => {
    try {
      const p = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
      if (!insideProject(p)) return new Response('forbidden', { status: 403 })
      const st = await stat(p)
      const ext = extname(p).toLowerCase()
      const type =
        ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
      const range = request.headers.get('Range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        const start = m && m[1] ? parseInt(m[1], 10) : 0
        const end = m && m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1
        if (start >= st.size || end < start)
          return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
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
