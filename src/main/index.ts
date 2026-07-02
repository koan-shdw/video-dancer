import { app, BrowserWindow, ipcMain, dialog, protocol, shell, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { join, dirname, basename, extname, resolve, relative, isAbsolute } from 'path'
import { readFile, writeFile, stat, rename, unlink } from 'fs/promises'
import { existsSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import type { Settings, TimelineMusic } from '../shared/types'

// custom scheme so the renderer can STREAM local video/images straight to <video>/<img>
// (instead of reading whole files over IPC into Blobs). Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])
import { runRender, runEdit, hasUploadCached, type RenderRequest } from './fal'
import { exportTimeline, cutSegment } from './export'
import { runImageGen } from './falImage'
import { initLogging, logDir, logRenderer } from './log'
import { initUpdater } from './updater'
import {
  getProject,
  newProject,
  openProject,
  undo,
  redo,
  cleanupProject,
  beginMediaWrite,
  endMediaWrite,
  emptyPromptData,
  importImage,
  importImages,
  importAudioFiles,
  renameAudio,
  setAudioDuration,
  deleteAudio,
  setTimelineMusic,
  setTimelineMutes,
  setTimelineExportPrefs,
  addDynamicStill,
  setPrimaryNode,
  setDeltaPush,
  saveFrameToLibrary,
  addTake,
  renameClip,
  newEmptyClip,
  setClipPromptData,
  setTimelineItems,
  sliceTimelineItem,
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

// API keys are encrypted AT REST with the OS keychain (Electron safeStorage) — settings.json used
// to hold them in plaintext. Encrypted values carry an 'enc:' prefix; anything without it is a
// legacy plaintext key and keeps working (and gets encrypted on the next settings write). If the
// OS offers no encryption, keys stay plaintext — same as before, never data loss.
const SECRET_KEYS = ['falKey', 'falAdminKey', 'astriaKey', 'anthropicKey'] as const
const ENC_PREFIX = 'enc:'

function encryptSecrets(s: Settings): Settings {
  if (!safeStorage.isEncryptionAvailable()) return s
  const out = { ...s }
  for (const k of SECRET_KEYS) {
    const v = out[k]
    if (typeof v === 'string' && v && !v.startsWith(ENC_PREFIX)) out[k] = ENC_PREFIX + safeStorage.encryptString(v).toString('base64')
  }
  return out
}
function decryptSecrets(s: Settings): Settings {
  const out = { ...s }
  for (const k of SECRET_KEYS) {
    const v = out[k]
    if (typeof v === 'string' && v.startsWith(ENC_PREFIX)) {
      try {
        out[k] = safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'))
      } catch (e) {
        // undecryptable right now (locked keychain, different user profile) — blank it IN MEMORY so
        // the UI asks again; the stored blob survives because saves merge onto the raw file
        console.error(`[settings] cannot decrypt ${k} — blanking for this session:`, e instanceof Error ? e.message : e)
        out[k] = ''
      }
    }
  }
  return out
}

// the file exactly as stored (ciphertext untouched) — the ONLY base patchSettings may merge onto.
// Merging onto DECRYPTED values would turn one transient keychain hiccup (decrypt throws, value
// cleared in memory) into a permanent on-disk wipe of every key the moment anything saves.
async function loadRawSettings(): Promise<Settings> {
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
async function loadSettings(): Promise<Settings> {
  return decryptSecrets(await loadRawSettings())
}
// settings writes are atomic (tmp + rename) and SERIALIZED: read-modify-write happens under a
// single lock chain so two quick patches can never drop each other's changes
let settingsChain: Promise<unknown> = Promise.resolve()
function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const out = settingsChain.then(async () => {
    // merge onto the RAW file: unpatched secrets keep their stored blob verbatim; only values the
    // caller provides (plaintext from the UI) and legacy plaintext keys get (re-)encrypted
    const s = encryptSecrets({ ...(await loadRawSettings()), ...patch })
    const file = settingsFile()
    await writeFile(file + '.tmp', JSON.stringify(s, null, 2), 'utf-8')
    await rename(file + '.tmp', file)
    return decryptSecrets(s)
  })
  settingsChain = out.catch((e) => {
    console.error('[settings] save failed:', e instanceof Error ? e.message : e)
    return {}
  })
  return out
}

function createWindow(): void {
  // window/taskbar icon in dev (packaged builds get it from the exe via electron-builder)
  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0e0e11',
    title: 'Video Dancer',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
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
  initUpdater(mainWindow) // silent auto-update (Windows packaged builds only — see updater.ts)
  // a renderer crash is the worst silent failure — log it loudly so a tester's log shows it
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('[renderer] process gone:', details.reason, details.exitCode)
  )
  // main-initiated project changes (re-extracted dynamic stills) push straight to the renderer store
  setDeltaPush((d) => mainWindow?.webContents.send('project:delta', d))

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
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  fieldLinks?: Record<string, string>
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
  // remember the project in last + most-recent-first recents (deduped, capped)
  const noteRecent = async (dir: string): Promise<void> => {
    const s = await loadSettings()
    const list = [dir, ...((s.recentProjects ?? []).filter((d) => d !== dir))].slice(0, 8)
    await patchSettings({ lastProjectDir: dir, recentProjects: list })
  }

  ipcMain.handle('project:new', async () => {
    if (!mainWindow) return null
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'New Video Dancer Project',
      defaultPath: join(app.getPath('documents'), 'Untitled'),
      buttonLabel: 'Create Project'
    })
    if (r.canceled || !r.filePath) return null
    const p = await newProject(dirname(r.filePath), basename(r.filePath))
    await noteRecent(p.dir)
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
    if (p) await noteRecent(p.dir)
    return p
  })

  ipcMain.handle('project:openLast', async () => {
    const s = await loadSettings()
    if (!s.lastProjectDir) return null
    return openProject(s.lastProjectDir) // returns null if it was moved/deleted
  })

  // open a KNOWN project dir (the header's recents list); validates + notes recency
  ipcMain.handle('project:openPath', async (_e, dir: string) => {
    if (typeof dir !== 'string' || !dir) return null
    const p = await openProject(dir)
    if (p) await noteRecent(p.dir)
    return p
  })
  ipcMain.handle('project:recents', async () => {
    const s = await loadSettings()
    return (s.recentProjects ?? []).filter((d) => typeof d === 'string' && existsSync(join(d, 'project.json')))
  })

  ipcMain.handle('project:get', async () => getProject())
  ipcMain.handle('project:undo', async () => undo())
  ipcMain.handle('project:redo', async () => redo())
  // sweep unreferenced media files (apply=false → dry-run count only; the UI confirms before applying)
  ipcMain.handle('project:cleanup', async (_e, apply: boolean) => cleanupProject(apply === true))

  // show an exported/created file in Explorer; open a vetted external link in the browser
  ipcMain.handle('shell:reveal', async (_e, p: string) => {
    if (typeof p === 'string' && existsSync(p)) shell.showItemInFolder(p)
  })
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url)
  })
  ipcMain.handle('app:version', async () => app.getVersion())
  ipcMain.handle('log:open', async () => shell.openPath(logDir())) // reveal the crash-log folder
  ipcMain.handle('log:renderer', async (_e, msg: string) => logRenderer(typeof msg === 'string' ? msg : String(msg)))

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

  // capture a frame from a monitor → new Library image
  ipcMain.handle('library:saveFrame', async (_e, bytes: Uint8Array, note: string) => {
    if (!getProject()) return null
    return saveFrameToLibrary(bytes, note)
  })

  // dynamic first/last-frame stills (live-bound to a timeline instance)
  ipcMain.handle('image:addDynamicStill', async (_e, itemId: string, edge: 'first' | 'last') => {
    if (!getProject()) return null
    return addDynamicStill(itemId, edge)
  })
  // (image:remapDynamic removed — the slice remap happens atomically inside timeline:slice now)
  ipcMain.handle('image:setPrimary', async (_e, sessionId: string, nodeId: string | null) => setPrimaryNode(sessionId, nodeId))

  // import images dragged in from the OS (desktop/Explorer) — paths come from the renderer
  ipcMain.handle('library:importPaths', async (_e, paths: string[]) => {
    if (!getProject() || !Array.isArray(paths) || paths.length === 0) return { delta: undefined, importedIds: [] }
    return importImages(paths)
  })

  // ----- music: import audio files + per-timeline placement/mutes -----
  ipcMain.handle('audio:import', async () => {
    if (!mainWindow || !getProject()) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return importAudioFiles(r.filePaths)
  })
  ipcMain.handle('audio:importPaths', async (_e, paths: string[]) => {
    if (!getProject() || !Array.isArray(paths) || paths.length === 0) return null
    return importAudioFiles(paths)
  })
  ipcMain.handle('audio:rename', async (_e, id: string, title: string) => renameAudio(id, title))
  ipcMain.handle('audio:setDuration', async (_e, id: string, dur: number) => setAudioDuration(id, dur))
  ipcMain.handle('audio:delete', async (_e, id: string) => deleteAudio(id))
  ipcMain.handle('timeline:setMusic', async (_e, timelineId: string, music: TimelineMusic | null) =>
    setTimelineMusic(timelineId, music)
  )
  ipcMain.handle('timeline:setMutes', async (_e, timelineId: string, mutes: { videoMuted?: boolean; musicMuted?: boolean }) =>
    setTimelineMutes(timelineId, mutes)
  )
  ipcMain.handle('timeline:setExportPrefs', async (_e, timelineId: string, prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30' }) =>
    setTimelineExportPrefs(timelineId, prefs)
  )

  // ----- export the timeline to an mp4 (bundled ffmpeg; one at a time) -----
  let exporting = false
  ipcMain.handle('export:run', async (e: IpcMainInvokeEvent, timelineId: string) => {
    const proj = getProject()
    if (!proj || !mainWindow) return { ok: false, error: 'no project open' }
    if (exporting) return { ok: false, error: 'an export is already running' }
    const tl = proj.timelines.find((t) => t.id === timelineId)
    if (!tl) return { ok: false, error: 'timeline not found' }
    if (tl.items.length === 0) return { ok: false, error: 'timeline is empty' }
    const safe = tl.name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'timeline'
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Export timeline as mp4',
      defaultPath: join(proj.dir, 'exports', `${safe}.mp4`),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
    exporting = true
    try {
      return await exportTimeline(proj, tl, r.filePath, (msg) => e.sender.send('export:progress', msg))
    } finally {
      exporting = false
    }
  })

  ipcMain.handle('clip:rename', async (_e, clipId: string, name: string) => renameClip(clipId, name))

  ipcMain.handle('clip:new', async (_e, name?: string) => newEmptyClip(name))

  ipcMain.handle('clip:setPromptData', async (_e, clipId: string, pd: Partial<PromptData>) => setClipPromptData(clipId, pd))

  ipcMain.handle('timeline:set', async (_e, timelineId: string, items: TimelineItem[], baseRev?: number) =>
    setTimelineItems(timelineId, items, baseRev)
  )
  ipcMain.handle('timeline:slice', async (_e, timelineId: string, itemId: string, cutSec: number) =>
    sliceTimelineItem(timelineId, itemId, cutSec)
  )
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
      beginMediaWrite() // edit variants land in images/edits/ one download at a time before appendEditNodes
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
      } finally {
        endMediaWrite()
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
    beginMediaWrite() // the take mp4 + imported ref images hit disk well before addTake references them
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

      // the render takes minutes — if the user opened a DIFFERENT project meanwhile, registering
      // the take would write project A's file path into project B (and media:// would 403 it).
      // The mp4 stays on disk in the original project's renders/ folder.
      if (getProject()?.dir !== proj.dir) {
        return { ok: false, error: `project changed during render — the video was saved to ${takePath} but not added. Reopen "${proj.name}" and import it.` }
      }

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
        seed: req.seed,
        promptLink: req.promptLink,
        fieldLinks: req.fieldLinks
      }

      const { delta, clipId, takeId } = await addTake({
        clipId: req.clipId,
        name: req.name || `clip ${proj.clips.length + 1}`,
        promptData,
        takeFile: takePath,
        durationSec: rendered.durationSec
      })
      if (importedImages.length) delta.images = importedImages

      // the renderer plays the fresh take by streaming media://<takePath> — shipping the whole
      // mp4 over IPC (structured-cloning 50-200MB) is exactly what the media protocol exists to avoid
      return { ok: true, delta, clipId, takeId, file: takePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })

  // ----- vid2vid: edit a take's video (or a window of it) into a take on an edit clip -----
  ipcMain.handle('edit:run', async (e: IpcMainInvokeEvent, req: import('../shared/types').EditArgs) => {
    beginMediaWrite() // the edited mp4 hits renders/ before addTake references it
    let tmp: string | null = null
    try {
      const s = await loadSettings()
      if (!s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }
      const proj = getProject()
      if (!proj) return { ok: false, error: 'No project open.' }
      const srcClip = proj.clips.find((c) => c.id === req.source.clipId)
      const srcTake = srcClip?.takes.find((t) => t.id === req.source.takeId)
      // resolve the source video: the live take, else (re-rolling a bound edit clip) the recipe's
      // PINNED file — that pin is exactly why liveFilesOf protects it after the source clip dies
      let srcAbs = srcTake?.file ?? null
      let svFile = srcTake ? relative(proj.dir, srcTake.file) : null
      if (!srcAbs && req.clipId) {
        const editClip = proj.clips.find((c) => c.id === req.clipId)
        const sv = editClip?.promptData.sourceVideo
        if (sv?.file && sv.clipId === req.source.clipId && sv.takeId === req.source.takeId) {
          const abs = join(proj.dir, sv.file)
          if (existsSync(abs)) {
            srcAbs = abs
            svFile = sv.file
          }
        }
      }
      if (!srcAbs || !svFile) return { ok: false, error: 'Source take not found.' }

      // sub-range window → cut a temp segment locally and upload only that piece. Take files are
      // immutable, so source path + window is a stable upload-cache key — a re-roll of the same
      // window skips both the cut and the upload.
      let videoPath = srcAbs
      const inS = req.source.inSec
      const outS = req.source.outSec
      const windowed = inS != null && outS != null && outS > inS
      const cacheKey = `${srcAbs}|${inS ?? ''}|${outS ?? ''}`
      if (windowed && !hasUploadCached(cacheKey)) {
        e.sender.send('edit:progress', 'cutting source window…')
        tmp = join(app.getPath('temp'), `vd_edit_src_${Date.now()}.mp4`)
        await cutSegment(srcAbs, inS, outS, tmp)
        videoPath = tmp
      }

      const rendered = await runEdit({
        engine: req.engine ?? 'omniflash',
        prompt: req.prompt,
        video: videoPath,
        cacheKey,
        falKey: s.falKey,
        outDir: join(proj.dir, 'renders'),
        onProgress: (m) => e.sender.send('edit:progress', m)
      })

      // edits take a while — same project-switch guard as render:run
      if (getProject()?.dir !== proj.dir) {
        return { ok: false, error: `project changed during edit — the video was saved to ${rendered.file} but not added.` }
      }

      const promptData: import('./project').PromptData = {
        ...emptyPromptData(),
        engine: req.engine ?? 'omniflash',
        mode: 'v2v',
        freeform: req.prompt,
        resolution: '720p',
        aspectRatio: 'auto',
        duration: String(Math.max(1, Math.round(rendered.durationSec ?? (windowed ? outS! - inS! : srcTake?.durationSec ?? 8)))),
        // sourceVideo.file is PROJECT-RELATIVE by design (see shared/types.ts)
        sourceVideo: {
          clipId: req.source.clipId,
          takeId: req.source.takeId,
          file: svFile,
          ...(inS != null ? { inSec: inS } : {}),
          ...(outS != null ? { outSec: outS } : {})
        }
      }
      const { delta, clipId, takeId } = await addTake({
        clipId: req.clipId,
        name: req.name || `${srcClip?.name ?? 'source'} · edit`,
        promptData,
        takeFile: rendered.file,
        durationSec: rendered.durationSec
      })
      return { ok: true, delta, clipId, takeId, file: rendered.file }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (tmp) void unlink(tmp).catch(() => undefined) // temp window cut must not become disk bloat
      endMediaWrite()
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

initLogging() // before anything else so early failures are captured

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
        ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif'
        : ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : ext === '.m4a' ? 'audio/mp4' : ext === '.aac' ? 'audio/aac' : ext === '.ogg' ? 'audio/ogg' : ext === '.flac' ? 'audio/flac'
        : 'image/jpeg'
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
  // one-time migration: rewrite settings so legacy plaintext keys land encrypted on disk
  void patchSettings({})
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
