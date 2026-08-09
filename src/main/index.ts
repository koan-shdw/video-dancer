import { app, BrowserWindow, ipcMain, dialog, protocol, shell, safeStorage, nativeImage, Menu, screen, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { join, dirname, basename, extname, resolve, relative, isAbsolute } from 'path'
import { readFile, writeFile, stat, rename, unlink, copyFile, mkdir, cp } from 'fs/promises'
import { existsSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import { randomUUID, createHash } from 'crypto'
import type { CharacterLink, Settings, TimelineMusic } from '../shared/types'

// custom scheme so the renderer can STREAM local video/images straight to <video>/<img>
// (instead of reading whole files over IPC into Blobs). Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])
import { runRender, runEdit, hasUploadCached, cancelFalJob, fetchRenderResult, type RenderRequest } from './fal'
import { runHfRender, cancelHfJob, fetchHfResult, validateHfKey } from './providers/higgsfield'
import { runArkRender, cancelArkJob, fetchArkResult, validateArkKey } from './providers/modelark'
import { runAstriaRender, cancelAstriaJob, fetchAstriaResult, validateAstriaKey } from './providers/astria'
import { playgroundList, playgroundStamp, playgroundClear } from './playground'
import { modelFor } from '../shared/models'
import { addPendingRender, removePendingRender, listPendingRenders, type PendingReq } from './pending'
import { exportTimeline, cutSegment, toMp3, probeVideo, planExport, type ExportBake } from './export'
import * as fx from './fx'
import { runImageGen } from './falImage'
import { initLogging, logDir, logRenderer } from './log'
import { initUpdater } from './updater'
import { codirSend, cancelCoDir, CODIR_MODELS, resolveCodirModel } from './codir'
import { codirBridgeSend, cancelCoDirBridge, detectClaudeCli, CODIR_BRIDGE_MODELS, resolveBridgeModel, resetBridgeSession } from './codirBridge'
import { guideStatus, openGuide, revertGuide, purgeLearned, isGuideId, resolveLoad } from './guides'
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
  newClipWithRecipe,
  importImage,
  importImages,
  importAudioFiles,
  renameAudio,
  setAudioDuration,
  deleteAudio,
  importVideoFiles,
  renameVideo,
  deleteVideo,
  renameCurrentProject,
  appendVideoEditNode,
  bakeVideoNodeToLibrary,
  bakeVideoNodeToClip,
  setVideoPrimaryNode,
  deleteVideoEditBranch,
  makeClipFromVideo,
  setTimelineMusic,
  setTimelineMutes,
  setTimelineExportPrefs,
  addDynamicStill,
  setPrimaryNode,
  setDeltaPush,
  setWatchFolder,
  listWatchFolder,
  saveFrameToLibrary,
  addTake,
  renameClip,
  newEmptyClip,
  setClipPromptData,
  newStyle,
  setStyle,
  deleteStyle,
  newCharSheet,
  setCharSheet,
  deleteCharSheet,
  reorderItems,
  codirClearLog,
  codirSetBrief,
  setTimelineItems,
  setTimelineAudioItems,
  setTimelineMeta,
  unlinkAudioFromItem,
  sliceTimelineItem,
  addTimeline,
  renameTimeline,
  setTimelineAspect,
  duplicateTimeline,
  deleteTimeline,
  setActiveTimeline,
  cloneClipFromTake,
  setKeeperTake,
  setTakeMeta,
  setClipStoryboard,
  addTakeFromFile,
  setTakeDuration,
  peekProject,
  importClipsFrom,
  appendEditNodes,
  tagEditNode,
  deleteEditBranch,
  deleteClip,
  deleteClips,
  duplicateClip,
  deleteImage,
  deleteImages,
  newClipsFromImages,
  newClipFromImagesAsBeats,
  peekRecentCards,
  saveProjectState,
  listProjectStates,
  restoreProjectState,
  deleteProjectState,
  addSpend,
  listSpend,
  saveLocalEditNode,
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
const pushProjectDelta = (d: import('../shared/types').ProjectDelta): void => {
  mainWindow?.webContents.send('project:delta', d)
}

// ---- crash recovery: collect finished renders the app wasn't alive to catch ----
// pending-renders.json entries survive restarts; on every project open we ask fal about each.
let resumeRunning = false
async function resumePendingRenders(): Promise<void> {
  if (resumeRunning) return
  const p = getProject()
  if (!p) return
  const pend = await listPendingRenders(p.dir)
  if (pend.length === 0) return
  const s = await loadSettings()
  if (!s.falKey && !s.hfKey) return // no platform key at all — nothing recoverable yet
  resumeRunning = true
  beginMediaWrite() // downloaded mp4s + re-imported ref images land before their entries do
  try {
    for (const entry of pend) {
      if (getProject()?.dir !== p.dir) break // project switched mid-resume — the rest waits for its next open
      try {
        // dispatch by the provider recorded with the entry (absent = fal, pre-provider entries)
        let r: Awaited<ReturnType<typeof fetchRenderResult>>
        if (entry.provider === 'higgsfield') {
          if (!s.hfKey) continue // no key anymore — keep the entry for when one returns
          r = await fetchHfResult(entry.requestId, s.hfKey, join(p.dir, 'renders'))
        } else if (entry.provider === 'modelark') {
          if (!s.arkKey) continue
          r = await fetchArkResult(entry.requestId, s.arkKey, join(p.dir, 'renders'))
        } else if (entry.provider === 'astria') {
          if (!s.astriaKey) continue
          r = await fetchAstriaResult(entry.requestId, s.astriaKey, join(p.dir, 'renders'))
        } else {
          if (!s.falKey) continue // no fal key anymore — keep the entry for when one returns
          r = await fetchRenderResult(entry.endpoint, entry.requestId, s.falKey, join(p.dir, 'renders'))
        }
        if (r.state === 'running') continue // still cooking upstream — retry on the next open
        if (r.state === 'gone') {
          await removePendingRender(p.dir, { requestId: entry.requestId })
          continue
        }
        // land it exactly like a live completion: import ref images → freeze the recipe → addTake
        const req = entry.req
        const importedImages: import('../shared/types').ProjImage[] = []
        const imageIds: string[] = []
        for (const ip of req.images) {
          if (!existsSync(ip)) continue
          const img = await importImage(ip)
          imageIds.push(img.id)
          importedImages.push(img)
        }
        let endImageId: string | undefined
        if (req.mode === 'i2v' && req.endImage && existsSync(req.endImage)) {
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
          videoRefs: req.videoRefs,
          audioRefs: req.audioRefs,
          duration: req.duration,
          resolution: req.resolution,
          aspectRatio: req.aspectRatio,
          generateAudio: req.generateAudio,
          seed: req.seed,
          promptLink: req.promptLink,
          fieldLinks: req.fieldLinks,
          characterLinks: req.characterLinks
        }
        const { delta } = await addTake({ clipId: req.clipId, name: req.name || 'recovered render', promptData, takeFile: r.file, durationSec: r.durationSec })
        pushProjectDelta({ ...delta, ...(importedImages.length ? { images: importedImages } : {}) })
        await removePendingRender(p.dir, { requestId: entry.requestId })
        mainWindow?.webContents.send('render:progress', `recovered a finished render → "${req.name || 'clip'}" ✓`)
      } catch (e) {
        console.error('[resume] pending render check failed:', e instanceof Error ? e.message : e) // entry kept — retried next open
      }
    }
  } finally {
    endMediaWrite()
    resumeRunning = false
  }
}
// give the renderer a beat to apply the opened project before recovered-take deltas arrive
function schedulePendingResume(): void {
  setTimeout(() => void resumePendingRenders(), 1500)
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

// API keys are encrypted AT REST with the OS keychain (Electron safeStorage) — settings.json used
// to hold them in plaintext. Encrypted values carry an 'enc:' prefix; anything without it is a
// legacy plaintext key and keeps working (and gets encrypted on the next settings write). If the
// OS offers no encryption, keys stay plaintext — same as before, never data loss.
const SECRET_KEYS = ['falKey', 'falAdminKey', 'anthropicKey', 'hfKey', 'arkKey', 'astriaKey'] as const
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

// A chromeless app (autoHideMenuBar, no visible menu) still NEEDS an application menu, because the
// standard clipboard accelerators — Ctrl/Cmd+V paste, +C copy, +X cut, +A select-all, +Z/+Y undo —
// are wired through the Edit-menu ROLES. Without a menu they silently don't fire, so paste dies in
// every text field (a tester couldn't paste their API key — only drag-drop worked). This restores
// them; autoHideMenuBar keeps the bar invisible (Alt reveals it).
function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// right-click on an editable field → cut / copy / paste / select all (discoverability: the tester
// tried right-click and found nothing). Shown only over inputs and text, so it never covers video.
function installContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return
    // right-clicked a red-squiggled word → spelling suggestions first (click one = replace in place)
    const spelling: MenuItemConstructorOptions[] = params.misspelledWord
      ? [
          ...(params.dictionarySuggestions.length
            ? params.dictionarySuggestions.slice(0, 6).map((s): MenuItemConstructorOptions => ({ label: s, click: () => win.webContents.replaceMisspelling(s) }))
            : [{ label: 'no suggestions', enabled: false } as MenuItemConstructorOptions]),
          { label: `add “${params.misspelledWord}” to dictionary`, click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
          { type: 'separator' }
        ]
      : []
    const items: MenuItemConstructorOptions[] = params.isEditable
      ? [
          ...spelling,
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll' }
        ]
      : [{ role: 'copy', enabled: params.editFlags.canCopy }, { role: 'selectAll' }]
    Menu.buildFromTemplate(items).popup({ window: win })
  })
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

  installContextMenu(mainWindow) // right-click paste/copy/cut on text fields
  // a file dropped OUTSIDE a drop zone must never hijack the window — Chromium's default is to
  // NAVIGATE to the dropped file (app replaced by a PNG until restart). Belt: block navigation
  // here; braces: the renderer also preventDefaults stray drops at the window level.
  const devUrl0 = process.env['ELECTRON_RENDERER_URL']
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (devUrl0 && url.startsWith(devUrl0)) return // dev-server reloads stay allowed
    e.preventDefault()
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    closeMirror() // the mirror must never outlive the app window
  })
  initUpdater(mainWindow) // silent auto-update (Windows packaged builds only — see updater.ts)
  // a renderer crash is the worst silent failure — log it loudly so a tester's log shows it
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('[renderer] process gone:', details.reason, details.exitCode)
  )
  // renderer console warnings/errors mirror into the main log. WebGL failures (texImage2D etc)
  // never throw — they only warn on the devtools console, which nobody watches. Level 2=warn 3=error.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logRenderer(`[console:${level === 3 ? 'error' : 'warn'}] ${message} (${sourceId}:${line})`)
  })
  // main-initiated project changes (re-extracted dynamic stills) push straight to the renderer store
  setDeltaPush(pushProjectDelta)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---- output mirror: a frameless fullscreen playback window pushed to another display.
// It loads the same renderer bundle with #mirror (main.tsx branches to a bare video view) and is
// driven one-way by the main window's Monitor via the mirror:state relay. media:// works in it
// for free (the protocol is registered on the default session, which this window shares).
let mirrorWindow: BrowserWindow | null = null

function closeMirror(): void {
  if (mirrorWindow && !mirrorWindow.isDestroyed()) mirrorWindow.close()
  mirrorWindow = null
}

function openMirror(displayId: number): boolean {
  const d = screen.getAllDisplays().find((x) => x.id === displayId)
  if (!d) return false
  closeMirror()
  mirrorWindow = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    frame: false,
    fullscreen: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  mirrorWindow.on('ready-to-show', () => mirrorWindow?.show())
  mirrorWindow.on('closed', () => {
    mirrorWindow = null
    mainWindow?.webContents.send('mirror:closed') // closed on the other screen → the toolbar resets
  })
  // Esc on the mirror closes it — a fullscreen window on a second display needs an exit
  mirrorWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'Escape') closeMirror()
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mirrorWindow.loadURL(devUrl + '#mirror')
  else void mirrorWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mirror' })
  return true
}

// resolve Seedance @video/@audio ref ids into uploadable local files. Windows are cut/converted
// to DETERMINISTIC temp paths (md5 of source+window) so re-rolls skip the cut AND hit fal's
// upload cache. Errors name the POSITIONAL slot the user sees (@video2), never internal ids.
// firstVideoTag: the Video Editor's source occupies @video1, so its extras start at 2.
async function resolveRefMedia(
  proj: import('./project').Project,
  videoRefs: import('../shared/types').VideoRef[] | undefined,
  audioRefs: import('../shared/types').AudioRef[] | undefined,
  firstVideoTag = 1
): Promise<{ videos: string[]; audios: string[] } | { error: string }> {
  const videos: string[] = []
  for (const [i, r] of (videoRefs ?? []).entries()) {
    const label = `@video${i + firstVideoTag}`
    const srcFile = r.videoId
      ? proj.videos.find((v) => v.id === r.videoId)?.file
      : proj.clips.find((c) => c.id === r.takeRef?.clipId)?.takes.find((t) => t.id === r.takeRef?.takeId)?.file
    if (!srcFile || !existsSync(srcFile))
      return { error: `${label}'s source video is gone (deleted from the project?) — remove that slot or re-pick it.` }
    if (r.inSec != null && r.outSec != null && r.outSec > r.inSec) {
      const key = createHash('md5').update(`${srcFile}|${r.inSec.toFixed(3)}|${r.outSec.toFixed(3)}`).digest('hex').slice(0, 16)
      const cut = join(app.getPath('temp'), `vd-vref-${key}.mp4`)
      if (!existsSync(cut)) await cutSegment(srcFile, r.inSec, r.outSec, cut)
      videos.push(cut)
    } else videos.push(srcFile)
  }
  const audios: string[] = []
  for (const [i, r] of (audioRefs ?? []).entries()) {
    const a = proj.audio.find((x) => x.id === r.audioId)
    if (!a || !existsSync(a.file))
      return { error: `@audio${i + 1}'s track is gone from the Library — remove that slot or re-pick it.` }
    const ext = extname(a.file).toLowerCase()
    const windowed = r.inSec != null && r.outSec != null && r.outSec > r.inSec
    if (!windowed && (ext === '.mp3' || ext === '.wav')) audios.push(a.file)
    else {
      // fal takes MP3/WAV only, ≤15s combined — cut the window / convert to a deterministic temp mp3
      const key = createHash('md5').update(`${a.file}|${r.inSec ?? ''}|${r.outSec ?? ''}`).digest('hex').slice(0, 16)
      const mp3 = join(app.getPath('temp'), `vd-aref-${key}.mp3`)
      if (!existsSync(mp3)) await toMp3(a.file, mp3, windowed ? r.inSec : undefined, windowed ? r.outSec : undefined)
      audios.push(mp3)
    }
  }
  return { videos, audios }
}

// mint-once anonymous per-install id (fal's Seedance 2.5 terms want an end_user_id per request)
async function ensureInstallId(): Promise<string> {
  let s = await loadSettings()
  if (!s.installId || typeof s.installId !== 'string') {
    await patchSettings({ installId: randomUUID() })
    s = await loadSettings()
  }
  return s.installId as string
}

type RenderIpcRequest = RenderRequest & {
  clipId?: string
  name?: string
  freeform: string
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
  videoRefs?: import('../shared/types').VideoRef[] // Seedance @video refs by id — resolved to files here in main
  audioRefs?: import('../shared/types').AudioRef[]
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  fieldLinks?: Record<string, string[]>
  characterLinks?: CharacterLink[]
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

  // the in-app New Project window drives this: it picks a base folder + name, we create
  // <baseDir>\<name> and put everything (project.json, images/, renders/, …) inside it
  ipcMain.handle('project:createAt', async (_e, baseDir: string, name: string) => {
    if (typeof baseDir !== 'string' || !baseDir || !existsSync(baseDir)) return null
    const p = await newProject(baseDir, typeof name === 'string' ? name : '')
    await noteRecent(p.dir)
    return p
  })
  // where the New Project window's location field starts: next to the last project, else Documents
  ipcMain.handle('project:defaultBaseDir', async () => {
    const s = await loadSettings()
    if (s.lastProjectDir && existsSync(dirname(s.lastProjectDir))) return dirname(s.lastProjectDir)
    return app.getPath('documents')
  })
  ipcMain.handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where the project folder will be created',
      properties: ['openDirectory', 'createDirectory'],
      ...(typeof defaultPath === 'string' && defaultPath && existsSync(defaultPath) ? { defaultPath } : {})
    })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })

  ipcMain.handle('project:open', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Video Dancer Project (pick the project folder)',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = await openProject(r.filePaths[0])
    if (p) {
      await noteRecent(p.dir)
      schedulePendingResume() // collect any renders that finished while the app was closed
    }
    return p
  })

  ipcMain.handle('project:openLast', async () => {
    const s = await loadSettings()
    if (!s.lastProjectDir) return null
    const p = await openProject(s.lastProjectDir) // returns null if it was moved/deleted
    if (p) schedulePendingResume()
    return p
  })

  // open a KNOWN project dir (the header's recents list); validates + notes recency
  ipcMain.handle('project:openPath', async (_e, dir: string) => {
    if (typeof dir !== 'string' || !dir) return null
    const p = await openProject(dir)
    if (p) {
      await noteRecent(p.dir)
      schedulePendingResume()
    }
    return p
  })
  ipcMain.handle('project:recents', async () => {
    const s = await loadSettings()
    return (s.recentProjects ?? []).filter((d) => typeof d === 'string' && existsSync(join(d, 'project.json')))
  })
  // the Open picker's cards: recents with their real names + thumbnails (unreadable dirs drop out)
  ipcMain.handle('project:peekRecents', async () => {
    const s = await loadSettings()
    const dirs = (s.recentProjects ?? []).filter((d): d is string => typeof d === 'string')
    return peekRecentCards(dirs)
  })

  // ----- playground shelf: sample projects — downloaded once, stamped fresh on every open -----
  ipcMain.handle('playground:list', () => playgroundList())
  ipcMain.handle('playground:stamp', async (e: IpcMainInvokeEvent, id: string) => {
    try {
      // stamped copies land where new projects do: next to the last project, else Documents
      const s = await loadSettings()
      const base = s.lastProjectDir && existsSync(dirname(s.lastProjectDir)) ? dirname(s.lastProjectDir) : app.getPath('documents')
      const dir = await playgroundStamp(String(id), base, (pct, msg) => e.sender.send('playground:progress', { id, pct, msg }))
      return { ok: true as const, dir }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('playground:clear', async (_e, id: string) => playgroundClear(String(id)))

  // ----- Open-picker card actions (right-click: rename / duplicate / remove / delete) -----
  ipcMain.handle('project:renameAt', async (_e, dir: string, name: string) => {
    if (typeof dir !== 'string' || !name?.trim()) return { ok: false, error: 'empty name' }
    try {
      // the OPEN project renames through its live state (undo + autosave apply)
      if (getProject()?.dir === dir) return { ok: await renameCurrentProject(name) }
      // closed projects: rewrite project.json's name field atomically, everything else untouched
      const jp = join(dir, 'project.json')
      const raw = JSON.parse(await readFile(jp, 'utf-8')) as { name?: string }
      raw.name = name.trim()
      const tmp = jp + '.tmp'
      await writeFile(tmp, JSON.stringify(raw, null, 2), 'utf-8')
      await rename(tmp, jp)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('project:duplicateAt', async (_e, dir: string) => {
    if (typeof dir !== 'string' || !existsSync(join(dir, 'project.json'))) return { ok: false, error: 'not a project folder' }
    try {
      const base = dirname(dir)
      const origFolder = basename(dir)
      let destFolder = `${origFolder} copy`
      let n = 2
      while (existsSync(join(base, destFolder))) destFolder = `${origFolder} copy ${n++}`
      const dest = join(base, destFolder)
      await cp(dir, dest, { recursive: true }) // media included — a duplicate is a duplicate
      try {
        const jp = join(dest, 'project.json')
        const raw = JSON.parse(await readFile(jp, 'utf-8')) as { name?: string }
        raw.name = `${raw.name ?? origFolder} copy`
        const tmp = jp + '.tmp'
        await writeFile(tmp, JSON.stringify(raw, null, 2), 'utf-8')
        await rename(tmp, jp)
      } catch {
        /* name rewrite failed — the copy still opens under its folder name */
      }
      const s = await loadSettings()
      await patchSettings({ recentProjects: [dest, ...(s.recentProjects ?? []).filter((d) => d !== dest)].slice(0, 8) })
      return { ok: true, dir: dest }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('project:removeRecent', async (_e, dir: string) => {
    const s = await loadSettings()
    await patchSettings({ recentProjects: (s.recentProjects ?? []).filter((d) => d !== dir) })
    return true
  })
  ipcMain.handle('project:deleteAt', async (_e, dir: string) => {
    if (typeof dir !== 'string') return { ok: false, error: 'bad path' }
    if (getProject()?.dir === dir) return { ok: false, error: 'this project is open — open another project first' }
    try {
      await shell.trashItem(dir) // Recycle Bin, never a hard delete — recoverable (law 15)
      const s = await loadSettings()
      await patchSettings({
        recentProjects: (s.recentProjects ?? []).filter((d) => d !== dir),
        ...(s.lastProjectDir === dir ? { lastProjectDir: '' } : {})
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // named save states: metadata checkpoints in <project>/checkpoints/ (media stays shared)
  ipcMain.handle('project:stateSave', async (_e, name: string) => saveProjectState(String(name ?? '')))
  ipcMain.handle('project:stateList', async () => listProjectStates())
  ipcMain.handle('project:stateRestore', async (_e, file: string) => (typeof file === 'string' ? restoreProjectState(file) : null))
  ipcMain.handle('project:stateDelete', async (_e, file: string) => (typeof file === 'string' ? deleteProjectState(file) : false))

  // per-project spend ledger (append-only, outside undo)
  ipcMain.handle('spend:add', async (_e, entry: { label: string; kind: 'gen' | 'edit' | 'image'; cost: number }) => addSpend(entry))
  ipcMain.handle('spend:list', async () => listSpend())

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
  // ---- output mirror (timeline playback on another physical display) ----
  ipcMain.handle('screen:list', async () => {
    const cur = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()).id : null
    return screen
      .getAllDisplays()
      .filter((d) => d.id !== cur) // the display the app occupies isn't offerable
      .map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 2}`, width: d.size.width, height: d.size.height }))
  })
  ipcMain.handle('mirror:open', async (_e, displayId: number) => openMirror(Number(displayId)))
  ipcMain.handle('mirror:close', async () => closeMirror())
  // fire-and-forget relay (sent per drift-correction tick, not per frame) — main window → mirror
  ipcMain.on('mirror:state', (_e, s: unknown) => {
    if (mirrorWindow && !mirrorWindow.isDestroyed()) mirrorWindow.webContents.send('mirror:state', s)
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

  // ----- watch folder: live staging strip over an external folder (drag in = real import) -----
  ipcMain.handle('watch:pick', async () => {
    if (!mainWindow || !getProject()) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Watch a folder — its images appear in the Library as a staging strip',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return setWatchFolder(r.filePaths[0])
  })
  ipcMain.handle('watch:clear', async () => setWatchFolder(null))
  ipcMain.handle('watch:list', async () => listWatchFolder())

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
  // ----- Library reference videos (Seedance @video refs) -----
  ipcMain.handle('video:import', async () => {
    if (!mainWindow || !getProject()) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return importVideoFiles(r.filePaths)
  })
  ipcMain.handle('video:importPaths', async (_e, paths: string[]) => {
    if (!getProject() || !Array.isArray(paths) || paths.length === 0) return null
    return importVideoFiles(paths)
  })
  ipcMain.handle('video:rename', async (_e, id: string, title: string) => renameVideo(id, title))
  ipcMain.handle('video:delete', async (_e, id: string) => deleteVideo(id))
  ipcMain.handle('video:makeClip', async (_e, videoId: string) => makeClipFromVideo(videoId))
  ipcMain.handle('video:addTakeToClip', async (_e, videoId: string, clipId: string) => {
    const proj = getProject()
    const v = proj?.videos.find((x) => x.id === videoId)
    if (!v) return null
    return addTakeFromFile(clipId, v.file)
  })

  // ----- Video Editor: one v2v tree generation (edit OR reference-guided re-gen) -----
  ipcMain.handle('vedit:run', async (e: IpcMainInvokeEvent, req: import('../shared/types').VeditArgs) => {
    beginMediaWrite()
    try {
      const s = await loadSettings() // per-branch key checks below — engines belong to different providers
      const proj = getProject()
      if (!proj) return { ok: false, error: 'no project open' }
      const projDirAtStart = proj.dir

      // the SOURCE being edited: the parent node's output, else the session root (video or take)
      let srcFile: string | undefined
      if (req.parentId) {
        srcFile = proj.videoEditSessions
          .find((x) =>
            req.root.videoId ? x.rootVideoId === req.root.videoId : x.rootTake?.clipId === req.root.takeRef?.clipId && x.rootTake?.takeId === req.root.takeRef?.takeId
          )
          ?.nodes.find((n) => n.id === req.parentId)?.file
      } else if (req.root.videoId) {
        // generating "from the root" means the TRUE original, even while a primary re-faces the entry
        const sess = proj.videoEditSessions.find((x) => x.rootVideoId === req.root.videoId)
        srcFile = (sess?.originalFile && existsSync(sess.originalFile) ? sess.originalFile : undefined) ?? proj.videos.find((v) => v.id === req.root.videoId)?.file
      } else if (req.root.takeRef) {
        srcFile = proj.clips.find((c) => c.id === req.root.takeRef?.clipId)?.takes.find((t) => t.id === req.root.takeRef?.takeId)?.file
      }
      if (!srcFile || !existsSync(srcFile)) return { ok: false, error: 'the source video is gone — re-pick it in the tree.' }

      // window-cut the source to a deterministic temp file (re-rolls reuse cut + upload cache)
      let sendFile = srcFile
      if (req.inSec != null && req.outSec != null && req.outSec > req.inSec) {
        const key = createHash('md5').update(`${srcFile}|${req.inSec.toFixed(3)}|${req.outSec.toFixed(3)}`).digest('hex').slice(0, 16)
        const cut = join(app.getPath('temp'), `vd-vref-${key}.mp4`)
        if (!existsSync(cut)) await cutSegment(srcFile, req.inSec, req.outSec, cut)
        sendFile = cut
      }

      const outDir = join(proj.dir, 'videos', 'edits')
      await mkdir(outDir, { recursive: true })
      const onProgress = (m: string): void => e.sender.send('edit:progress', m)

      let outFile: string
      let durationSec: number | undefined
      const refBits: string[] = []
      if (req.engine === 'omniflash') {
        if (!s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first (Omni edits run on fal).' }
        const r = await runEdit({
          jobId: req.jobId,
          engine: 'omniflash',
          prompt: req.prompt,
          video: sendFile,
          cacheKey: sendFile, // deterministic path IS the stable key
          falKey: s.falKey,
          outDir,
          onProgress
        })
        outFile = r.file
        durationSec = r.durationSec
      } else {
        // Seedance re-gen: the source rides as @video1; extra refs join it
        const imageFiles: string[] = []
        for (const id of req.imageRefIds ?? []) {
          const img = proj.images.find((i) => i.id === id)
          if (!img || !existsSync(img.file)) return { ok: false, error: 'an image ref is gone from the Library — re-pick it.' }
          imageFiles.push(img.file)
        }
        const rr = await resolveRefMedia(proj, req.videoRefs, req.audioRefs, 2) // extras start at @video2
        if ('error' in rr) return { ok: false, error: rr.error }
        if (imageFiles.length) refBits.push(`${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''}`)
        if (rr.videos.length) refBits.push(`${rr.videos.length} extra video${rr.videos.length > 1 ? 's' : ''}`)
        if (rr.audios.length) refBits.push(`${rr.audios.length} audio`)
        const provider = modelFor(req.engine).provider ?? 'fal'
        if (provider === 'higgsfield' && !s.hfKey)
          return { ok: false, error: 'No Higgsfield key saved — paste api-key:api-secret in Settings first.' }
        if (provider === 'fal' && !s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }
        const common = {
          jobId: req.jobId,
          engine: req.engine,
          mode: 'ref2v' as const,
          prompt: req.prompt,
          images: imageFiles,
          videos: [sendFile, ...rr.videos],
          audios: rr.audios,
          duration: req.duration ?? 'auto',
          resolution: req.resolution ?? '720p',
          aspectRatio: req.aspectRatio ?? 'auto',
          generateAudio: req.generateAudio ?? true,
          outDir,
          onProgress
        }
        const r =
          provider === 'higgsfield'
            ? await runHfRender({ ...common, hfKey: s.hfKey as string })
            : await runRender({ ...common, endUserId: await ensureInstallId(), falKey: s.falKey as string })
        outFile = r.file
        durationSec = r.durationSec
      }
      if (getProject()?.dir !== projDirAtStart)
        return { ok: false, error: `project changed during the edit — the video was saved to ${outFile} but not added.` }
      if (durationSec == null) durationSec = (await probeVideo(outFile)).duration || undefined

      const appended = await appendVideoEditNode({
        root: req.root,
        parentId: req.parentId,
        file: outFile,
        prompt: req.prompt,
        engine: req.engine,
        inSec: req.inSec,
        outSec: req.outSec,
        refSummary: refBits.length ? refBits.join(' · ') : undefined,
        durationSec
      })
      if (!appended) return { ok: false, error: 'could not record the result node' }
      return { ok: true, delta: appended.delta, nodeId: appended.nodeId, file: outFile }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })
  ipcMain.handle('vedit:bakeLibrary', async (_e, sessionId: string, nodeId: string) => bakeVideoNodeToLibrary(sessionId, nodeId))
  ipcMain.handle('vedit:bakeClip', async (_e, sessionId: string, nodeId: string, target: { clipId?: string; newClipName?: string }) =>
    bakeVideoNodeToClip(sessionId, nodeId, target)
  )
  ipcMain.handle('vedit:setPrimary', async (_e, sessionId: string, nodeId: string | null) => setVideoPrimaryNode(sessionId, nodeId))
  ipcMain.handle('vedit:deleteBranch', async (_e, sessionId: string, nodeId: string) => deleteVideoEditBranch(sessionId, nodeId))
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
  ipcMain.handle('export:run', async (e: IpcMainInvokeEvent, timelineId: string, bakes?: ExportBake[]) => {
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
      return await exportTimeline(proj, tl, r.filePath, (msg) => e.sender.send('export:progress', msg), bakes)
    } finally {
      exporting = false
    }
  })

  // ----- EFFECTS v2: AI-pass sidecars, model downloads, export bakes -----
  ipcMain.handle('fx:sidecars', async (_e, takeFile: string) => fx.fxSidecars(takeFile))
  ipcMain.handle('fx:probe', async (_e, file: string) => probeVideo(file))
  ipcMain.handle('fx:ensureModel', async (e: IpcMainInvokeEvent, kind: fx.FxModelKind) => {
    try {
      const p = await fx.ensureModel(kind, e.sender)
      return { ok: true, path: p }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // a downloaded-but-unparseable model must not stay cached forever — the pass runner calls
  // this after a session-init failure so the next attempt re-downloads
  ipcMain.handle('fx:deleteModel', async (_e, kind: fx.FxModelKind) => {
    await fx.deleteModel(kind)
    return true
  })
  ipcMain.handle('fx:readModel', async (_e, kind: fx.FxModelKind) => {
    const p = fx.modelPath(kind)
    if (!p) return null
    return readFile(p)
  })
  ipcMain.handle('fx:passStart', async (_e, takeFile: string, kind: 'matte' | 'depth', w: number, h: number, fps: number) => {
    if (!insideProject(takeFile)) return { ok: false, error: 'take is outside the open project' }
    const { id } = await fx.passStart(takeFile, kind, w, h, fps)
    return { ok: true, id }
  })
  ipcMain.handle('fx:encodeFrame', async (_e, id: string, frame: Uint8Array) => fx.encodeFrame(id, frame))
  ipcMain.handle('fx:encodeEnd', async (_e, id: string, keep: boolean) => fx.encodeEnd(id, keep))
  ipcMain.handle('export:plan', async (_e, timelineId: string) => {
    const proj = getProject()
    const tl = proj?.timelines.find((t) => t.id === timelineId)
    if (!proj || !tl) return null
    await fx.cleanBakes(proj.dir) // stale bake temps from a cancelled run
    return planExport(proj, tl)
  })
  ipcMain.handle('fx:bakeStart', async (_e, w: number, h: number, fps: number) => {
    const proj = getProject()
    if (!proj) return { ok: false, error: 'no project open' }
    const { id, file } = await fx.bakeStart(proj.dir, w, h, fps)
    return { ok: true, id, file }
  })

  // export ONE clip's video (keeper take, or a named take) — a plain file copy to wherever the
  // user points the save dialog. The original in renders/ is never moved or touched.
  ipcMain.handle('clip:export', async (_e, clipId: string, takeId?: string) => {
    const proj = getProject()
    if (!proj || !mainWindow) return { ok: false, error: 'no project open' }
    const clip = proj.clips.find((c) => c.id === clipId)
    const take = takeId
      ? clip?.takes.find((t) => t.id === takeId)
      : clip?.takes.find((t) => t.id === clip.keeperTakeId) ?? clip?.takes[clip.takes.length - 1]
    if (!clip || !take || !existsSync(take.file)) return { ok: false, error: 'no rendered take to export' }
    const safe = clip.name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'clip'
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Export clip video',
      defaultPath: join(app.getPath('desktop'), `${safe}.mp4`),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
    await copyFile(take.file, r.filePath)
    return { ok: true, file: r.filePath }
  })

  // native drag-out: a Bin clip alt-dragged to the desktop/Explorer copies its video there.
  // Same confinement as media:// — only files inside the open project may leave this way.
  ipcMain.on('drag:file', (e, filePath: string) => {
    if (typeof filePath !== 'string' || !existsSync(filePath) || !insideProject(filePath)) return
    const iconPath = join(app.getAppPath(), 'build', 'icon.png')
    const icon = existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 24 })
      : nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
    e.sender.startDrag({ file: filePath, icon })
  })

  ipcMain.handle('clip:rename', async (_e, clipId: string, name: string) => renameClip(clipId, name))

  ipcMain.handle('clip:new', async (_e, name?: string) => newEmptyClip(name))

  ipcMain.handle('clip:setPromptData', async (_e, clipId: string, pd: Partial<PromptData>) => setClipPromptData(clipId, pd))

  // ----- project styles (universal field bundles) -----
  ipcMain.handle('charsheet:new', async (_e, name?: string) => newCharSheet(name))
  ipcMain.handle('charsheet:set', async (_e, id: string, patch: { name?: string; imageId?: string | null; character?: import('../shared/types').CharacterField }) => setCharSheet(id, patch))
  ipcMain.handle('charsheet:delete', async (_e, id: string) => deleteCharSheet(id))
  ipcMain.handle('items:reorder', async (_e, kind: 'bin' | 'lib', movedIds: string[], targetId: string) => reorderItems(kind, movedIds, targetId))
  ipcMain.handle('style:new', async (_e, name?: string) => newStyle(name))
  ipcMain.handle('style:set', async (_e, id: string, patch: { name?: string; scene?: SceneFields; production?: ProductionFields; enhanced?: string[] }) => setStyle(id, patch))
  ipcMain.handle('style:delete', async (_e, id: string) => deleteStyle(id))

  // ----- Co-Director (the conversational copilot) -----
  ipcMain.handle(
    'codir:send',
    async (e: IpcMainInvokeEvent, req: { text: string; imageIds: string[]; selectedClipId: string | null; focus: { kind: string; ownerId: string; path: string } | null }) => {
      const s = await loadSettings()
      // EXPERIMENTAL bridge engine: same request, same progress/delta channels, no API key —
      // exchanges run through the user's local Claude Code (their subscription) instead
      if (s.codirEngine === 'bridge') {
        return codirBridgeSend(
          {
            text: req.text,
            imageIds: Array.isArray(req.imageIds) ? req.imageIds : [],
            selectedClipId: req.selectedClipId ?? null,
            focus: req.focus ?? null,
            guideLoad: s.codirGuideLoad,
            model: resolveBridgeModel(s.codirBridgeModel as string | undefined)
          },
          (ev) => e.sender.send('codir:progress', ev),
          (d) => e.sender.send('project:delta', d)
        )
      }
      if (!s.anthropicKey) return { ok: false, error: 'No Anthropic key saved — paste one in Settings.' }
      return codirSend(
        {
          text: req.text,
          imageIds: Array.isArray(req.imageIds) ? req.imageIds : [],
          selectedClipId: req.selectedClipId ?? null,
          focus: req.focus ?? null,
          apiKey: s.anthropicKey,
          model: resolveCodirModel(s.codirModel as string | undefined),
          guideLoad: s.codirGuideLoad
        },
        (ev) => e.sender.send('codir:progress', ev),
        (d) => e.sender.send('project:delta', d) // live UI updates while the AI writes
      )
    }
  )
  ipcMain.handle('codir:cancel', async () => {
    cancelCoDir()
    cancelCoDirBridge()
  })
  ipcMain.handle('codir:bridgeStatus', async (_e, refresh?: boolean) => detectClaudeCli(!!refresh))
  ipcMain.handle('codir:bridgeModels', async () => CODIR_BRIDGE_MODELS)
  ipcMain.handle('codir:clearLog', async () => {
    resetBridgeSession() // a cleared panel must not resume the old CLI conversation
    return codirClearLog()
  })
  ipcMain.handle('codir:setBrief', async (_e, brief: string) => codirSetBrief(String(brief ?? '')))
  ipcMain.handle('codir:models', async () => CODIR_MODELS)
  // the 4 guide files: status list (+ per-file load state), edit (forks a personal copy + opens
  // it), revert, purge learned
  ipcMain.handle('codir:guides', async () => {
    const s = await loadSettings()
    const load = resolveLoad(s.codirGuideLoad)
    return (await guideStatus()).map((g) => ({ ...g, loaded: load[g.id] }))
  })
  ipcMain.handle('codir:guideOpen', async (_e, id: string) => (isGuideId(id) ? openGuide(id) : null))
  ipcMain.handle('codir:guideRevert', async (_e, id: string) => {
    if (isGuideId(id)) await revertGuide(id)
  })
  ipcMain.handle('codir:guidePurgeLearned', async () => purgeLearned())

  ipcMain.handle('timeline:set', async (_e, timelineId: string, items: TimelineItem[], baseRev?: number) =>
    setTimelineItems(timelineId, items, baseRev)
  )
  ipcMain.handle('timeline:setAudioItems', async (_e, timelineId: string, audioItems: import('../shared/types').TimelineAudioItem[], baseRev?: number) =>
    setTimelineAudioItems(timelineId, audioItems, baseRev)
  )
  ipcMain.handle('timeline:unlinkAudio', async (_e, timelineId: string, itemId: string) => unlinkAudioFromItem(timelineId, itemId))
  ipcMain.handle('timeline:setMeta', async (_e, timelineId: string, patch: Record<string, unknown>) => setTimelineMeta(timelineId, patch))
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
  ipcMain.handle('clip:setStoryboard', async (_e, clipId: string, imageId: string | null) => setClipStoryboard(clipId, imageId))
  ipcMain.handle('take:setMeta', async (_e, clipId: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => setTakeMeta(clipId, takeId, patch))

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
        // draw layer: the base image ALREADY COMPOSITED with the user's visible pen strokes
        // (renderer-side canvas render). When present it replaces the resolved base for the
        // upload only — tree lineage still hangs off parentNodeId, nothing on disk is mutated.
        basePng?: Uint8Array
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
        let baseImage = parentNode?.file ?? rootImage?.file
        if (req.rootImageId && !baseImage) return { ok: false, error: 'Source image not found.' }
        if (req.basePng && baseImage) {
          // write the composite next to the edit results; it's the file fal receives
          const drawPath = join(proj.dir, 'images', 'edits', `draw_${randomUUID()}.png`)
          await mkdir(join(proj.dir, 'images', 'edits'), { recursive: true })
          await writeFile(drawPath, Buffer.from(req.basePng))
          baseImage = drawPath
        }
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
  ipcMain.handle('clips:delete', async (_e, ids: string[]) => deleteClips(ids))
  ipcMain.handle('clip:duplicate', async (_e, id: string) => duplicateClip(id))
  ipcMain.handle('clips:fromImages', async (_e, imageIds: string[], place?: { timelineId: string; index: number }) =>
    newClipsFromImages(imageIds, place)
  )
  ipcMain.handle('clip:fromImagesAsBeats', async (_e, imageIds: string[]) => newClipFromImagesAsBeats(imageIds))
  ipcMain.handle('image:delete', async (_e, id: string) => deleteImage(id))
  ipcMain.handle('images:delete', async (_e, ids: string[]) => deleteImages(ids))
  ipcMain.handle('image:cropSave', async (_e, req: { rootImageId: string; parentId: string | null; bytes: Uint8Array; label: string }) =>
    saveLocalEditNode(req)
  )
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
      // key per PROVIDER — the engine's descriptor says whose platform runs this render
      const provider = modelFor(req.engine).provider ?? 'fal'
      const falKey = s.falKey
      if (provider === 'fal' && !falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }
      if (provider === 'higgsfield' && !s.hfKey)
        return { ok: false, error: 'No Higgsfield key saved — paste api-key:api-secret in Settings first (from cloud.higgsfield.ai).' }
      if (provider === 'modelark' && !s.arkKey)
        return { ok: false, error: 'No ModelArk key saved — paste your BytePlus ModelArk API key in Settings first.' }
      if (provider === 'astria' && !s.astriaKey)
        return { ok: false, error: 'No Astria key saved — paste your Astria API key in Settings first (astria.ai → Account → API).' }

      let proj = getProject()
      if (!proj) proj = await newProject(app.getPath('documents'), 'Untitled') // auto-create so a first render still works

      // resolve Seedance @video/@audio ref ids into uploadable local files (shared with vedit:run)
      let videoFiles: string[] = []
      let audioFiles: string[] = []
      if (req.mode === 'ref2v' && (req.videoRefs?.length || req.audioRefs?.length)) {
        const rr = await resolveRefMedia(proj, req.videoRefs, req.audioRefs)
        if ('error' in rr) return { ok: false, error: rr.error }
        videoFiles = rr.videos
        audioFiles = rr.audios
      }
      const installId = await ensureInstallId()

      // crash-recovery bookkeeping: the entry lands the moment fal accepts, and is removed in the
      // finally below (success, failure or cancel). Anything left = the app died mid-render.
      const projDirAtStart = proj.dir
      let pendingReqId: string | null = null
      try {
        const common = {
          ...req,
          videos: videoFiles,
          audios: audioFiles,
          outDir: join(proj.dir, 'renders'),
          onProgress: (m: string) => e.sender.send('render:progress', m),
          onRequestId: (requestId: string, endpoint: string) => {
            pendingReqId = requestId
            const { jobId: _jobId, ...rest } = req
            void addPendingRender(projDirAtStart, { requestId, endpoint, provider, jobId: req.jobId, createdAt: Date.now(), req: rest as PendingReq })
          }
        }
        const rendered =
          provider === 'higgsfield'
            ? await runHfRender({ ...common, hfKey: s.hfKey as string })
            : provider === 'modelark'
              ? await runArkRender({
                  ...common,
                  arkKey: s.arkKey as string,
                  arkModel: modelFor(req.engine).endpoints[req.mode] ?? 'dreamina-seedance-2-0-260128',
                  endUserId: installId
                })
              : provider === 'astria'
                ? await runAstriaRender({
                    ...common,
                    astriaKey: s.astriaKey as string,
                    astriaModelBase: modelFor(req.engine).endpoints[req.mode] ?? 'seedance2'
                  })
                : await runRender({ ...common, endUserId: installId, falKey: falKey as string })
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
        videoRefs: req.videoRefs,
        audioRefs: req.audioRefs,
        duration: req.duration,
        resolution: req.resolution,
        aspectRatio: req.aspectRatio,
        generateAudio: req.generateAudio,
        seed: req.seed,
        promptLink: req.promptLink,
        fieldLinks: req.fieldLinks,
        characterLinks: req.characterLinks
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
      } finally {
        // landed, failed or cancelled → nothing pending anymore (a crash skips this — the point)
        if (pendingReqId) void removePendingRender(projDirAtStart, { requestId: pendingReqId })
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })

  // best-effort remote cancel of an in-flight queue job (platforms bill completed work regardless)
  ipcMain.handle('render:cancel', async (_e, jobId: string) => {
    let ok = await cancelFalJob(jobId)
    if (!ok) {
      const s = await loadSettings()
      if (s.hfKey) ok = await cancelHfJob(jobId, s.hfKey)
      if (!ok && s.arkKey) ok = await cancelArkJob(jobId, s.arkKey)
      if (!ok && s.astriaKey) ok = await cancelAstriaJob(jobId) // stops OUR wait — Astria has no remote cancel
    }
    const p = getProject()
    if (p) void removePendingRender(p.dir, { jobId }) // a cancelled job must not "recover" next open
    return ok
  })
  // Settings: cheap key validations (authenticated no-ops — never spend credits/tokens)
  ipcMain.handle('hf:validate', async (_e, key: string) => validateHfKey(String(key ?? '')))
  ipcMain.handle('ark:validate', async (_e, key: string) => validateArkKey(String(key ?? '')))
  ipcMain.handle('astria:validate', async (_e, key: string) => validateAstriaKey(String(key ?? '')))

  // rescue path: attach an external mp4 (e.g. downloaded from the fal dashboard after a restart
  // ate the in-flight render) to a clip as a real take
  ipcMain.handle('clip:addTakeFile', async (_e, clipId: string) => {
    const r = await dialog.showOpenDialog({
      title: 'Add take from video file',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return addTakeFromFile(clipId, r.filePaths[0])
  })

  // v2v: commit the edit clip the moment Generate is pressed (recipe on disk, Bin shows the fork
  // immediately, nothing lost to a shutdown) — the render then lands on it as take 1
  ipcMain.handle('edit:createClip', async (_e, req: { engine?: import('../shared/types').EngineId; prompt: string; name?: string; source: import('../shared/types').EditArgs['source'] }) => {
    const proj = getProject()
    if (!proj) return null
    const srcClip = proj.clips.find((c) => c.id === req.source.clipId)
    const srcTake = srcClip?.takes.find((t) => t.id === req.source.takeId)
    if (!srcClip || !srcTake) return null
    const inS = req.source.inSec
    const outS = req.source.outSec
    const promptData: import('./project').PromptData = {
      ...emptyPromptData(),
      engine: req.engine ?? 'omniflash',
      mode: 'v2v',
      freeform: req.prompt,
      resolution: '720p',
      aspectRatio: 'auto',
      duration: String(Math.max(1, Math.round(inS != null && outS != null ? outS - inS : srcTake.durationSec ?? 8))),
      sourceVideo: {
        clipId: req.source.clipId,
        takeId: req.source.takeId,
        file: relative(proj.dir, srcTake.file),
        ...(inS != null ? { inSec: inS } : {}),
        ...(outS != null ? { outSec: outS } : {})
      }
    }
    return newClipWithRecipe(req.name ?? `${srcClip.name} · edit`, promptData)
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
        jobId: req.jobId,
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
function insideDir(root: string, p: string): boolean {
  const norm = (x: string): string => (process.platform === 'win32' ? resolve(x).toLowerCase() : resolve(x))
  const rel = relative(norm(root), norm(p))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
function insideProject(p: string): boolean {
  const proj = getProject()
  return !!proj && insideDir(proj.dir, p)
}
// media:// additionally serves the project's watch folder — a single folder the user explicitly
// designated (staging thumbnails). Everything else on disk stays off-limits.
function mediaAllowed(p: string): boolean {
  if (insideProject(p)) return true
  const wf = getProject()?.watchFolder
  return !!wf && insideDir(wf, p)
}

initLogging() // before anything else so early failures are captured

app.whenReady().then(() => {
  // media://x/<encodeURIComponent(absPath)> → streams the file WITH HTTP Range support, so <video>
  // is seekable (scrub frame-by-frame) and canvas use stays untainted (CORS header — acceptable
  // because the handler refuses every path outside the open project's folder).
  protocol.handle('media', async (request) => {
    try {
      const p = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
      if (!mediaAllowed(p)) return new Response('forbidden', { status: 403 })
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
  installAppMenu() // MUST run so clipboard accelerators (Ctrl+V/C/X/A/Z) work in every text field
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
