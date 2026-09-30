import { app, BrowserWindow, ipcMain, dialog, protocol, shell, safeStorage, nativeImage, Menu, screen, clipboard, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { join, dirname, basename, extname, resolve, relative, isAbsolute } from 'path'
import { readFile, writeFile, stat, statfs, rename, unlink, copyFile, mkdir, cp, readdir, rm } from 'fs/promises'
import { existsSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import { randomUUID, createHash } from 'crypto'
import { primaryImageFile, resolveRenderImages, imageEditSource } from '@koan/vidancer-ui/shared/imageSources'
import type { CharacterLink, Settings, TimelineMusic, SheetMode } from '@koan/vidancer-ui/shared/types'

// custom scheme so the renderer can STREAM local video/images straight to <video>/<img>
// (instead of reading whole files over IPC into Blobs). Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  // no bypassCSP: the renderer's CSP explicitly allows media: where it belongs (img/media/
  // connect) — a blanket bypass would let ANY injected content use the scheme unchecked
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
import { pathToFileURL } from 'url'
import { runRender, runEdit, hasUploadCached, cancelFalJob, fetchRenderResult, type RenderRequest } from './fal'
import { runHfRender, cancelHfJob, fetchHfResult, validateHfKey } from './providers/higgsfield'
import * as bridge from './bridge'
import { runHfMcpRender, fetchHfMcpResult } from './providers/mcp/higgsfieldMcp'
import { runRunwayMcpRender, fetchRunwayMcpResult } from './providers/mcp/runwayMcp'
import { runMagnificMcpRender, fetchMagnificMcpResult } from './providers/mcp/magnificMcp'
import { runPikaMcpRender, fetchPikaMcpResult } from './providers/mcp/pikaMcp'
import { runBridgeAutoRender } from './providers/mcp/bridgeAuto'
import { setInterpreterLane } from './bridge/interpreter'
import { runArkRender, cancelArkJob, fetchArkResult, validateArkKey } from './providers/modelark'
import { runAstriaRender, cancelAstriaJob, fetchAstriaResult, validateAstriaKey } from './providers/astria'
import { runVeniceRender, runVeniceImage, cancelVeniceJob, fetchVeniceResult, validateVeniceKey, veniceLane } from './providers/venice'
import { playgroundList, playgroundStamp, playgroundClear } from './playground'
import { modelFor, unknownEngineError, effortFor } from '@koan/vidancer-ui/shared/models'
import { addPendingRender, removePendingRender, listPendingRenders, addPendingScore, removePendingScore, listPendingScores, addPendingVoice, removePendingVoice, listPendingVoices, type PendingReq } from './pending'
import { runScoreRender, fetchScoreResult, validateElevenKey, cancelScoreJob } from './scoreRender'
import { runVoiceRender, fetchVoiceResult, cancelVoiceJob, elevenVoices } from './voiceRender'
import { emitScoreInput } from '@koan/vidancer-ui/shared/emitScore'
import { composeScoreBeats } from './scoreCompose'
import { runSubCalls } from './subcall'
import { audioModelFor } from '@koan/vidancer-ui/shared/audioModels'
import { scoreModel, scoreSpan, scoreRenderSnapshot } from '@koan/vidancer-ui/shared/scoreRequest'
import { exportTimeline, cancelExport, cutSegment, toMp3, probeVideo, planExport, type ExportBake } from './export'
import { registerWatchIpc } from './watchIpc'
import { deleteAssetSelection, setKeeperFlags } from './project'
import { ensureReversed } from './reverse'
import { timelineWatchBusy, cancelTimelineWatch } from './watchTimeline'
import { onSaveFailure, pendingSaves, saveProject, captureProjectSession, assertProjectSession, hasMediaWrites } from './project'
import * as fx from './fx'
import * as modelStore from './modelStore'
import * as runtime from './runtime'
import * as audioLocal from './audioLocal'
import * as h3Local from './h3Local'
import * as ltxLocal from './ltxLocal'
import * as krea2Local from './krea2Local'
import * as civitai from './civitai'
import { foldersOf, listFolderLoras, scanFolderLoras, tagFolderLora, type LoraFamilyKey } from './loraFolders'
import { setExtraLoraDirs, civitCheckpointsDir } from './imagePaths'
import { readPngSettings } from './pngMeta'
// the LoRA shelf engine is ONE COPY in @koan/shared (SPEC there); this app injects its
// transport + paths below and registers the shared IPC surface
import { configureLoraShelf, registerLorasIpc, loraShelf } from '@koan/shared/main'
import { wavePeaks } from './wave'
import { runImageGen } from './falImage'
import { runArkImage } from './providers/modelark'
import { runGoogleImage } from './providers/google'
import { pasteBack } from './pasteBack'
import { exportAs, EXPORT_FILTERS, type ExportKind } from './exportAs'
import { imageModelFor } from '@koan/vidancer-ui/shared/imageModels'
import { buildBlockingPrompt } from '@koan/vidancer-ui/shared/blocking'
import { assemblyConcept, assemblyAssemble } from './assembly'
import { initLogging, logDir, logRenderer } from './log'
import { initUpdater } from './updater'
import { codirSend, codirCompact, cancelCoDir, setExchangeDir, setExchangeKeys, CODIR_MODELS, CODIR_VENICE_MODELS, resolveCodirModel, resolveVeniceModel, setOpenImageGen, asksForWeb } from './codir'
import { VENICE_TAG } from './claudeWire'
import { validateGoogleKey } from './watch'
import { listMoods, readMood, saveMood, deleteMood, revealMood, importMoodPaths, exportMood, moodsMentioned, onMoodsChanged } from './moods'
import * as editors from './editors'
import { codirBridgeSend, cancelCoDirBridge, detectClaudeCli, updateClaudeCli, CODIR_BRIDGE_MODELS, resolveBridgeModel, resetBridgeSession, bridgeOneShot } from './codirBridge'
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
  importImageBytes,
  sniffImageExt,
  IMPORT_BYTES_CAP,
  newImageGen,
  setImageGenData,
  setImageGenKeeper,
  addImageGenTakes,
  setImageGenTakeMeta,
  deleteImageGenTake,
  deleteImageGen,
  duplicateImageGen,
  imageGenTakeToLibrary,
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
  newScoreClip,
  setScoreClipData,
  setScoreKeeper,
  setScoreTakeMeta,
  scoreClipFromTake,
  deleteScoreClip,
  duplicateScoreClip,
  addScoreTake,
  setCharSheet,
  deleteCharSheet,
  newVoiceClip,
  setVoiceClipData,
  setVoiceKeeper,
  addVoiceTake,
  setVoiceTakeDuration,
  setVoiceTakeMeta,
  voiceClipFromTake,
  deleteVoiceTake,
  deleteVoiceClip,
  reorderItems,
  codirClearLog,
  codirSetBrief,
  codirSetMoodsPinned,
  setAssembly,
  setTimelineItems,
  setTimelineBoth,
  setTimelineAll,
  createNest,
  setTimelineAudioItems,
  setTimelineScoreItems,
  setTimelineMeta,
  unlinkAudioFromItem,
  sliceTimelineItem,
  sliceTimelineAudio,
  sliceTimelineScore,
  addTimeline,
  renameTimeline,
  setTimelineAspect,
  duplicateTimeline,
  deleteTimeline,
  setActiveTimeline,
  cloneClipFromTake,
  setKeeperTake,
  setTakeMeta,
  deleteTake,
  setClipStoryboard,
  addTakeFromFile,
  setTakeDuration,
  peekProject,
  importClipsFrom,
  sendAssetsTo,
  appendEditNodes,
  tagEditNode,
  attachBlocking,
  deleteEditBranch,
  deleteClip,
  deleteClips,
  duplicateClip,
  deleteImage,
  deleteImages,
  newClipsFromImages,
  newClipFromImagesAsBeats,
  newSheetClip,
  buildSheetFromTake,
  setImageSheet,
  peekRecentCards,
  findProjectsIn,
  importExternalEdit,
  setItemsDisabled,
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
  moveFolder,
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
const pushProjectDelta = (d: import('@koan/vidancer-ui/shared/types').ProjectDelta): void => {
  mainWindow?.webContents.send('project:delta', d)
}

// progress sends from long handlers outlive windows (macOS keeps the app alive after close) —
// a send to a destroyed WebContents THROWS, failing a render AFTER the paid work completed
const safeSend = (wc: Electron.WebContents, channel: string, ...args: unknown[]): void => {
  if (!wc.isDestroyed()) wc.send(channel, ...args)
}

// ---- crash recovery: collect finished renders the app wasn't alive to catch ----
// pending-renders.json entries survive restarts; on every project open we ask fal about each.
let resumeRunning = false
let recoveryState = { dir: '', count: 0, checking: false, error: '' }
function recoveryError(error: unknown): void {
  recoveryState.error = error instanceof Error ? error.message : String(error)
  console.error('[recovery]', recoveryState.error)
}
function observePendingWrite(dir: string, write: Promise<void>): void {
  void write.catch((error) => {
    if (getProject()?.dir === dir) {
      recoveryState.dir = dir
      recoveryError(error)
    } else console.error('[recovery]', error)
  })
}
async function resumePendingRenders(): Promise<void> {
  if (resumeRunning || hasMediaWrites()) return // live submissions own their pending entries
  const p = getProject()
  if (!p) return
  const owner = captureProjectSession()
  resumeRunning = true // acquire BEFORE the first await
  recoveryState = { dir: p.dir, count: 0, checking: true, error: '' }
  beginMediaWrite()
  try {
  const pend = await listPendingRenders(p.dir)
  const pendScores = await listPendingScores(p.dir)
  const pendVoices = await listPendingVoices(p.dir)
  assertProjectSession(owner)
  recoveryState.count = pend.length + pendScores.length + pendVoices.length
  if (pend.length === 0 && pendScores.length === 0 && pendVoices.length === 0) return
  const s = await loadSettings()
  // ANY supplier key makes recovery worth running — gating on fal/HF alone left ModelArk- and
  // Astria-only users never recovering crash-orphaned paid renders (per-entry checks handle absence)
  if (!s.falKey && !s.hfKey && !s.arkKey && !s.astriaKey && !s.veniceKey && !s.bridgeAuth) return
    for (const entry of pend) {
      assertProjectSession(owner)
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
        } else if (entry.provider === 'venice') {
          if (!s.veniceKey) continue
          r = await fetchVeniceResult(entry.requestId, entry.endpoint, s.veniceKey, join(p.dir, 'renders')) // the endpoint string is the Venice model id
        } else if (entry.provider === 'mcp') {
          // the endpoint string carries the service ('runway-mcp/…' vs 'higgsfield-mcp/…');
          // logged out → keep the entry for when the login returns
          if (entry.endpoint.startsWith('runway-mcp')) {
            if (!bridge.bridgeReady('runway')) continue
            r = await fetchRunwayMcpResult(entry.requestId, join(p.dir, 'renders'))
          } else if (entry.endpoint.startsWith('magnific-mcp')) {
            if (!bridge.bridgeReady('magnific')) continue
            r = await fetchMagnificMcpResult(entry.requestId, join(p.dir, 'renders'))
          } else if (entry.endpoint.startsWith('pika-mcp')) {
            if (!bridge.bridgeReady('pika')) continue
            r = await fetchPikaMcpResult(entry.requestId, join(p.dir, 'renders'))
          } else {
            if (!bridge.bridgeReady('higgsfield')) continue
            r = await fetchHfMcpResult(entry.requestId, join(p.dir, 'renders'))
          }
        } else {
          if (!s.falKey) continue // no fal key anymore — keep the entry for when one returns
          r = await fetchRenderResult(entry.endpoint, entry.requestId, s.falKey, join(p.dir, 'renders'))
        }
        assertProjectSession(owner)
        if (r.state === 'running') {
          // Astria has no terminal failure status — a moderation-killed prompt reports 'running'
          // forever. Age those entries out instead of re-checking them on every open for eternity.
          // (Venice: a recorded failure can answer 5xx, which recovery reads as "try again".)
          if ((entry.provider === 'astria' || entry.provider === 'venice') && Date.now() - entry.createdAt > 3 * 24 * 3600 * 1000) {
            await removePendingRender(p.dir, { requestId: entry.requestId })
          }
          continue // still cooking upstream — retry on the scheduled pass
        }
        if (r.state === 'gone') {
          await removePendingRender(p.dir, { requestId: entry.requestId })
          continue
        }
        // land it exactly like a live completion: import ref images → freeze the recipe → addTake
        const req = entry.req
        const importedImages: import('@koan/vidancer-ui/shared/types').ProjImage[] = []
        const imageIds: string[] = []
        for (const ip of req.images) {
          if (!existsSync(ip)) continue
          const img = await importImage(ip, owner)
          imageIds.push(img.id)
          importedImages.push(img)
        }
        let endImageId: string | undefined
        if (req.mode === 'i2v' && req.endImage && existsSync(req.endImage)) {
          const img = await importImage(req.endImage, owner)
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
          loras: req.loras, // frozen into the recovered take's snapshot too
          promptLink: req.promptLink,
          fieldLinks: req.fieldLinks,
          fieldOverrides: req.fieldOverrides,
          characterLinks: req.characterLinks
        }
        assertProjectSession(owner)
        const { delta } = await addTake({ requestId: entry.requestId, clipId: req.clipId, name: req.name || 'recovered render', promptData, takeFile: r.file, durationSec: r.durationSec })
        assertProjectSession(owner)
        pushProjectDelta({ ...delta, ...(importedImages.length ? { images: importedImages } : {}) })
        await removePendingRender(p.dir, { requestId: entry.requestId })
        mainWindow?.webContents.send('render:progress', { msg: `recovered a finished render → "${req.name || 'clip'}" ✓` })
      } catch (e) {
        recoveryError(e) // entry kept for the next scheduled pass
      }
    }
    // ---- score renders (v18): same contract, audio shape — the take re-lands from the id ----
    for (const entry of pendScores) {
      assertProjectSession(owner)
      if (!s.falKey) continue // scores are fal jobs — keep the entry for when a key returns
      try {
        const r = await fetchScoreResult(entry.endpoint, entry.requestId, s.falKey, join(p.dir, 'scores'))
        assertProjectSession(owner)
        if (r.state === 'running') continue
        if (r.state === 'gone') {
          await removePendingScore(p.dir, { requestId: entry.requestId })
          continue
        }
        const sc = getProject()?.scoreClips.find((x) => x.id === entry.scoreClipId)
        if (sc) {
          const landed = await addScoreTake(sc.id, { requestId: entry.requestId, file: r.file, engine: entry.engine, durationSec: r.durationSec, seed: r.seed, snapshot: entry.snapshot })
          assertProjectSession(owner)
          if (landed) pushProjectDelta(landed.delta)
          mainWindow?.webContents.send('render:progress', { msg: `recovered a finished score → "${sc.name}" ✓` })
        }
        // score clip deleted while it cooked: the paid WAV stays in scores/ (cleanup can offer it)
        await removePendingScore(p.dir, { requestId: entry.requestId })
      } catch (e) {
        recoveryError(e)
      }
    }
    for (const entry of pendVoices) {
      assertProjectSession(owner)
      if (!s.falKey) continue // voices are fal jobs — keep the entry for when a key returns
      try {
        const r = await fetchVoiceResult(entry.endpoint, entry.requestId, s.falKey, join(p.dir, 'voices'))
        assertProjectSession(owner)
        if (r.state === 'running') continue
        if (r.state === 'gone') {
          await removePendingVoice(p.dir, { requestId: entry.requestId })
          continue
        }
        const vc = getProject()?.voiceClips.find((x) => x.id === entry.voiceClipId)
        if (vc) {
          const landed = await addVoiceTake(vc.id, { requestId: entry.requestId, file: r.file, engine: entry.engine, durationSec: r.durationSec, seed: r.seed })
          assertProjectSession(owner)
          if (landed) pushProjectDelta(landed.delta)
          mainWindow?.webContents.send('render:progress', { msg: `recovered a finished voice take → "${vc.name}" ✓` })
        }
        // voice deleted while it cooked: the paid audio stays in voices/ (cleanup can offer it)
        await removePendingVoice(p.dir, { requestId: entry.requestId })
      } catch (e) {
        recoveryError(e)
      }
    }
  } finally {
    endMediaWrite()
    resumeRunning = false
    recoveryState.checking = false
  }
}
// give the renderer a beat to apply the opened project before recovered-take deltas arrive
let recoveryTimer: ReturnType<typeof setTimeout> | undefined
let recoverySchedule = 0
function schedulePendingResume(delay = 1500): void {
  if (recoveryTimer) clearTimeout(recoveryTimer)
  const generation = ++recoverySchedule
  recoveryTimer = setTimeout(() => {
    void resumePendingRenders().catch(recoveryError).finally(() => {
      if (generation === recoverySchedule && getProject()) schedulePendingResume(Math.min(30000, delay * 2))
    })
  }, delay)
  recoveryTimer.unref()
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

// API keys are encrypted AT REST with the OS keychain (Electron safeStorage) — settings.json used
// to hold them in plaintext. Encrypted values carry an 'enc:' prefix; anything without it is a
// legacy plaintext key and keeps working (and gets encrypted on the next settings write). If the
// OS offers no encryption, keys stay plaintext — same as before, never data loss.
const SECRET_KEYS = ['falKey', 'falAdminKey', 'anthropicKey', 'hfKey', 'arkKey', 'astriaKey', 'veniceKey', 'civitaiKey', 'googleKey', 'elevenKey', 'bridgeAuth'] as const
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
      submenu: [{ role: 'reload', accelerator: 'F5' }, { role: 'forceReload', accelerator: 'Shift+F5' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }]
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
      sandbox: true, // preload only needs contextBridge/ipcRenderer — the renderer decodes untrusted downloaded media, it gets the OS sandbox
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
  // back from Photoshop (or any external editor): did a watched copy get saved? — asks in the app
  mainWindow.on('focus', () => void checkExternalEdits())
  mainWindow.on('closed', () => {
    mainWindow = null
    closeMirror() // the mirror must never outlive the app window
  })
  initUpdater(mainWindow) // silent auto-update (Windows packaged builds only — see updater.ts)
  // a renderer crash is the worst silent failure — log it loudly so a tester's log shows it,
  // and reap fx encode jobs whose feeder just died (ffmpeg would block on stdin forever)
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details.reason, details.exitCode)
    void fx.abortAllJobs()
  })
  mainWindow.on('closed', () => void fx.abortAllJobs())
  // a page RELOAD (dev HMR full-reload, Ctrl+R) is not a process-gone — but it kills the bake
  // loop just the same, and the orphaned encoder kept its .part locked (the EBUSY export bug)
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) void fx.abortAllJobs()
  })
  // renderer console warnings/errors mirror into the main log. WebGL failures (texImage2D etc)
  // never throw — they only warn on the devtools console, which nobody watches. Level 2=warn 3=error.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logRenderer(`[console:${level === 3 ? 'error' : 'warn'}] ${message} (${sourceId}:${line})`)
  })
  // main-initiated project changes (re-extracted dynamic stills) push straight to the renderer store
  setDeltaPush(pushProjectDelta)
  // save failures must reach the user — the renderer shows a persistent SAVES FAILING banner
  // until the next successful save reports recovery (null)
  onSaveFailure((msg) => mainWindow?.webContents.send('project:saveError', msg))

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
      sandbox: true, // preload only needs contextBridge/ipcRenderer — the renderer decodes untrusted downloaded media, it gets the OS sandbox
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
  videoRefs: import('@koan/vidancer-ui/shared/types').VideoRef[] | undefined,
  audioRefs: import('@koan/vidancer-ui/shared/types').AudioRef[] | undefined,
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
    // a slot's source is Library music OR a Bin voice (its ★ keeper take) — same window/mp3 path
    const vcHit = r.voiceId ? proj.voiceClips.find((x) => x.id === r.voiceId) : undefined
    const keeper = vcHit
      ? vcHit.takes.find((t) => t.id === vcHit.keeperTakeId && !t.disabled) ?? [...vcHit.takes].reverse().find((t) => !t.disabled)
      : undefined
    const a = r.voiceId ? (keeper ? { file: keeper.file } : undefined) : proj.audio.find((x) => x.id === r.audioId)
    if (!a || !existsSync(a.file))
      return { error: `@audio${i + 1}'s ${r.voiceId ? 'voice has no take yet — render one in the Voices card' : 'track is gone from the Library'} — remove that slot or fix it.` }
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

const NO_VENICE_KEY = 'No Venice key saved — paste your Venice API key in Settings first (venice.ai → Settings → API).' // list 14

// ---- ONE v2v engine branch for BOTH edit surfaces (Clip Edit card + Video Editor tree) ----
// a true-edit engine (v2v caps, no video refs: Omni Flash, Kling O3 Edit) = the edit door on
// fal; anything else = seedance ref2v re-gen with the (already window-cut) source riding as
// @video1 and the ref suite joining it. Key checks are per-provider HERE — callers do zero
// engine reasoning.
async function runV2vEngine(
  proj: import('./project').Project,
  s: Settings,
  req: {
    jobId?: string
    engine: import('@koan/vidancer-ui/shared/types').EngineId
    prompt: string
    sendFile: string // the source video, already cut to the send window
    cacheKey: string // stable upload-cache key for the source
    imageRefIds?: string[]
    videoRefs?: import('@koan/vidancer-ui/shared/types').VideoRef[]
    audioRefs?: import('@koan/vidancer-ui/shared/types').AudioRef[]
    duration?: string
    resolution?: string
    aspectRatio?: string
    generateAudio?: boolean
    outDir: string
  },
  onProgress: (m: string) => void
): Promise<{ file: string; durationSec?: number; refSummary?: string; costUsd?: number } | { error: string }> {
  const editModel = modelFor(req.engine) // an unknown engine falls back to seedance2 (no v2v) and lands on the stale-engine guard below
  if (editModel.v2v && editModel.maxRefVideos === 0) {
    if (!s.falKey) return { error: `No fal key saved — paste it in Settings first (${editModel.label} edits run on fal).` }
    const r = await runEdit({
      jobId: req.jobId,
      engine: req.engine,
      prompt: req.prompt,
      video: req.sendFile,
      cacheKey: req.cacheKey,
      resolution: req.resolution,
      falKey: s.falKey,
      outDir: req.outDir,
      onProgress
    })
    return { file: r.file, durationSec: r.durationSec }
  }
  // Seedance re-gen: the source rides as @video1; extra refs join it
  const imageFiles: string[] = []
  for (const id of req.imageRefIds ?? []) {
    const file = primaryImageFile(proj, id)
    if (!existsSync(file)) return { error: 'an image ref is gone from the Library — re-pick it.' }
    imageFiles.push(file)
  }
  const rr = await resolveRefMedia(proj, req.videoRefs, req.audioRefs, 2) // extras start at @video2
  if ('error' in rr) return rr
  const refBits: string[] = []
  if (imageFiles.length) refBits.push(`${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''}`)
  if (rr.videos.length) refBits.push(`${rr.videos.length} extra video${rr.videos.length > 1 ? 's' : ''}`)
  if (rr.audios.length) refBits.push(`${rr.audios.length} audio`)
  const staleEngine = unknownEngineError(req.engine)
  if (staleEngine) return { error: staleEngine }
  const provider = modelFor(req.engine).provider ?? 'fal'
  if (provider === 'higgsfield' && !s.hfKey)
    return { error: 'No Higgsfield key saved — paste api-key:api-secret in Settings first.' }
  if (provider === 'fal' && !s.falKey) return { error: 'No fal key saved — paste it in Settings first.' }
  if (provider === 'venice' && !s.veniceKey) return { error: NO_VENICE_KEY }
  const common = {
    jobId: req.jobId,
    engine: req.engine,
    mode: 'ref2v' as const,
    prompt: req.prompt,
    images: imageFiles,
    videos: [req.sendFile, ...rr.videos],
    audios: rr.audios,
    duration: req.duration ?? 'auto',
    resolution: req.resolution ?? '720p',
    aspectRatio: req.aspectRatio ?? 'auto',
    generateAudio: req.generateAudio ?? true,
    outDir: req.outDir,
    onProgress
  }
  const r =
    provider === 'higgsfield'
      ? await runHfRender({ ...common, hfKey: s.hfKey as string })
      : provider === 'venice'
        ? await runVeniceRender({ ...common, ...veniceLane(req.engine, 'ref2v', true), veniceKey: s.veniceKey as string })
        : await runRender({ ...common, endUserId: await ensureInstallId(), falKey: s.falKey as string })
  return { file: r.file, durationSec: r.durationSec, refSummary: refBits.length ? refBits.join(' · ') : undefined, costUsd: r.costUsd }
}

type RenderIpcRequest = RenderRequest & {
  clipId?: string
  name?: string
  ltxSize?: string // the size pick from the engine dropdown (bible 12.9) — local engine only
  negative?: string // the USER negative (real on LTX dev CFG 4 only)
  loras?: { name: string; weight: number }[] // shelf picks (spec §7) — local engine only
  // MiniMax H3 dials (MINIMAX-H3-LOCAL-SPEC §3) — ride the request like ltxSize
  h3Encoder?: string
  h3Upscale?: boolean
  h3UpscaleBy?: number
  h3Kernels?: 'off' | 'sage' | 'sol'
  h3Set?: import('@koan/vidancer-ui/shared/types').H3LoraSet
  loraOn?: boolean // the loras switch — frozen into the take like the picks
  freeform: string
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
  videoRefs?: import('@koan/vidancer-ui/shared/types').VideoRef[] // Seedance @video refs by id — resolved to files here in main
  audioRefs?: import('@koan/vidancer-ui/shared/types').AudioRef[]
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  fieldLinks?: Record<string, string[]>
  fieldOverrides?: Record<string, string[]>
  characterLinks?: CharacterLink[]
}

// the renderer never needs a full key back — it needs "is one saved" plus enough to recognize
// it. Handing every decrypted key to the renderer in one call made any renderer compromise a
// total key exfiltration; masked values keep every existing truthiness check working.
const MASK_PREFIX = '••••'
function maskSecrets(s: Settings): Settings {
  const out = { ...s }
  for (const k of SECRET_KEYS) {
    const v = out[k]
    if (typeof v === 'string' && v) out[k] = MASK_PREFIX + v.slice(-4)
  }
  return out
}
// a masked value echoed back through settings:set must never overwrite the real stored key
function stripMaskEchoes(patch: Partial<Settings>): Partial<Settings> {
  const out = { ...patch }
  for (const k of SECRET_KEYS) {
    const v = out[k]
    if (typeof v === 'string' && v.startsWith(MASK_PREFIX)) delete out[k]
  }
  return out
}
// "save & test" fields hold the mask for an already-saved key — substitute the stored value
async function realKeyFor(k: (typeof SECRET_KEYS)[number], candidate: string): Promise<string> {
  if (!candidate.startsWith(MASK_PREFIX)) return candidate
  const s = await loadSettings()
  return (s[k] as string | undefined) ?? ''
}

// the Co-Director's lane (list 14 made it three-way): the Claude Code bridge, or a KEY lane —
// Anthropic's API, or Venice's proxy of the same Claude models. Venice rides the existing 'api'
// engine with its key tagged; claudeWire.ts reads the tag, so nothing downstream needs to know.
function claudeLane(s: Settings): { engine: 'api' | 'bridge'; apiKey?: string; model: string; noKey: string } {
  if (s.codirEngine === 'bridge') return { engine: 'bridge', model: resolveBridgeModel(s.codirBridgeModel as string | undefined), noKey: '' }
  if (s.codirEngine === 'venice')
    return { engine: 'api', apiKey: s.veniceKey ? VENICE_TAG + s.veniceKey : undefined, model: resolveVeniceModel(s.codirVeniceModel as string | undefined), noKey: 'No Venice key saved — the Co-Director is set to Venice: paste the key in Settings (or pick another engine).' }
  return { engine: 'api', apiKey: s.anthropicKey, model: resolveCodirModel(s.codirModel as string | undefined), noKey: 'No Anthropic key saved — paste one in Settings (or switch the Co-Director to bridge).' }
}

// when THIS engine core booted — the renderer shows it so "did the restart actually happen" is
// never a guess again (single-instance lock makes half-restarts look like restarts; a stale core
// once routed a Runway pick to fal and spent real money, 2026-09-01)
const BOOT_AT = Date.now()

function registerIpc(): void {
  registerWatchIpc(() => mainWindow, async () => {
    const s = await loadSettings()
    const lane = claudeLane(s)
    return { googleKey: s.googleKey, googleModel: s.googleWatchModel,
      anthropicKey: lane.engine === 'api' ? lane.apiKey : undefined,
      model: lane.engine === 'api' ? lane.model : resolveCodirModel(s.codirModel as string | undefined),
      bridge: lane.engine === 'bridge' ? (prompt: string, signal?: AbortSignal) => bridgeOneShot({ prompt, signal, model: lane.model }) : undefined }
  })
  ipcMain.handle('recovery:status', () => recoveryState)
  ipcMain.handle('app:boot', () => BOOT_AT)
  ipcMain.handle('settings:get', async () => maskSecrets(await loadSettings()))
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const clean = stripMaskEchoes(patch)
    const saved = await patchSettings(clean)
    if ('veniceKey' in clean) void bridge.refreshKeyService('venice') // the Bridge row flips the moment the key is saved or cleared
    return maskSecrets(saved)
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

  // ----- BRIDGE — MCP provider logins (BRIDGE-SPEC-2026-09-01; stage 1: login/status only) -----
  ipcMain.handle('bridge:list', () => bridge.bridgeRows())
  ipcMain.handle('bridge:login', async (_e, id: string) => {
    await bridge.loginService(id as import('./bridge/services').BridgeServiceId)
    return bridge.bridgeRows()
  })
  ipcMain.handle('bridge:logout', async (_e, id: string) => {
    await bridge.logoutService(id as import('./bridge/services').BridgeServiceId)
    return bridge.bridgeRows()
  })
  ipcMain.handle('bridge:refresh', async () => {
    await bridge.refreshAll()
    return bridge.bridgeRows()
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
  // remember the project in last + most-recent-first recents (deduped, NEVER capped — the Open
  // window lists every project he has opened, OPEN-WINDOW-SPEC-2026-09-18)
  const noteRecent = async (dir: string): Promise<void> => {
    const s = await loadSettings()
    const list = [dir, ...((s.recentProjects ?? []).filter((d) => d !== dir))]
    await patchSettings({ lastProjectDir: dir, recentProjects: list })
  }
  // BRING BACK (spec §7.1): found projects join the END of the list (newest project.json first),
  // known ones keep their place. Returns how many were new.
  const adoptProjects = async (bases: string[], depth: number): Promise<number> => {
    const found: { dir: string; mtime: number }[] = []
    for (const b of [...new Set(bases)]) if (b && existsSync(b)) found.push(...(await findProjectsIn(b, depth)))
    found.sort((a, b) => b.mtime - a.mtime)
    const s = await loadSettings()
    const known = new Set((s.recentProjects ?? []).map((d) => resolve(d).toLowerCase()))
    const fresh: string[] = []
    for (const f of found) {
      const k = resolve(f.dir).toLowerCase()
      if (known.has(k)) continue
      known.add(k)
      fresh.push(f.dir)
    }
    if (fresh.length) await patchSettings({ recentProjects: [...(s.recentProjects ?? []), ...fresh] })
    return fresh.length
  }
  // door 1: once, a few seconds after boot (never in the boot path) — the folders every known
  // project lives in + Documents (where New starts)
  setTimeout(async () => {
    const s = await loadSettings()
    if (s.projectsRecovered) return
    const known = [...(s.recentProjects ?? []), s.lastProjectDir ?? '', ...Object.keys(s.lastExportDirs ?? {})].filter((d): d is string => typeof d === 'string' && !!d)
    try {
      const n = await adoptProjects([...known.map((d) => dirname(d)), app.getPath('documents')], 1)
      console.log(`[projects] bring-back scan: ${n} project(s) rejoined the Open window`)
      await patchSettings({ projectsRecovered: true })
    } catch (err) {
      console.error('[projects] bring-back scan failed:', err instanceof Error ? err.message : err)
    }
  }, 6000)
  // door 2: his hand — pick a folder, everything inside (two levels) joins the list
  ipcMain.handle('project:findIn', async () => {
    if (!mainWindow) return { ok: false as const, added: 0 }
    const s = await loadSettings()
    const start = s.lastProjectDir && existsSync(dirname(s.lastProjectDir)) ? dirname(s.lastProjectDir) : app.getPath('documents')
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Find projects — pick the folder your projects live in', defaultPath: start, properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false as const, added: 0 }
    return { ok: true as const, added: await adoptProjects([r.filePaths[0]], 2) }
  })

  // the in-app New Project window drives this: it picks a base folder + name, we create
  // <baseDir>\<name> and put everything (project.json, images/, renders/, …) inside it
  ipcMain.handle('project:createAt', async (_e, baseDir: string, name: string) => {
    if (typeof baseDir !== 'string' || !baseDir || !existsSync(baseDir)) return null
    const p = await newProject(baseDir, typeof name === 'string' ? name : '')
    await noteRecent(p.dir)
    schedulePendingResume()
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
  // the header ▾ quick list: the 8 newest that still exist (his call — the Open window is the full list)
  ipcMain.handle('project:recents', async () => {
    const s = await loadSettings()
    return (s.recentProjects ?? []).filter((d) => typeof d === 'string' && existsSync(join(d, 'project.json'))).slice(0, 8)
  })
  // the Open picker's cards: EVERY listed project with its real name + thumbnail (unreadable dirs
  // drop out). Thumbs shrink to card size here — nativeImage reads png/jpg; anything else returns
  // undefined and peekRecentCards falls back to the raw file.
  const cardThumb = (file: string): string | undefined => {
    if (!/\.(png|jpe?g)$/i.test(file)) return undefined
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return undefined
    return `data:image/jpeg;base64,${img.resize({ width: 336, quality: 'good' }).toJPEG(82).toString('base64')}`
  }
  ipcMain.handle('project:peekRecents', async () => {
    const s = await loadSettings()
    const dirs = (s.recentProjects ?? []).filter((d): d is string => typeof d === 'string')
    const t0 = Date.now()
    const cards = await peekRecentCards(dirs, cardThumb)
    console.log(`[projects] Open window: ${cards.length}/${dirs.length} cards in ${Date.now() - t0} ms`)
    return cards
  })

  // ----- playground shelf: sample projects — downloaded once, stamped fresh on every open -----
  ipcMain.handle('playground:list', () => playgroundList())
  ipcMain.handle('playground:stamp', async (e: IpcMainInvokeEvent, id: string) => {
    try {
      // stamped copies land where new projects do: next to the last project, else Documents
      const s = await loadSettings()
      const base = s.lastProjectDir && existsSync(dirname(s.lastProjectDir)) ? dirname(s.lastProjectDir) : app.getPath('documents')
      const dir = await playgroundStamp(String(id), base, (pct, msg) => safeSend(e.sender, 'playground:progress', { id, pct, msg }))
      return { ok: true as const, dir }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('playground:clear', async (_e, id: string) => playgroundClear(String(id)))

  // ----- Open-picker card actions (right-click: rename / duplicate / remove / delete) -----
  // card actions accept renderer-supplied paths — confine them to paths the picker can
  // legitimately show (recents + last + open), so a compromised renderer can't trash or clone
  // arbitrary folders on disk
  const isPickerPath = async (dir: string): Promise<boolean> => {
    const s = await loadSettings()
    return dir === s.lastProjectDir || (s.recentProjects ?? []).includes(dir) || getProject()?.dir === dir
  }
  ipcMain.handle('project:renameAt', async (_e, dir: string, name: string) => {
    if (typeof dir !== 'string' || !name?.trim()) return { ok: false, error: 'empty name' }
    if (!(await isPickerPath(dir))) return { ok: false, error: 'not a listed project' }
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
    if (!(await isPickerPath(dir))) return { ok: false, error: 'not a listed project' }
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
      const srcFolder = s.projectFolderOf?.[dir] // the copy lands in its source's Open-window folder
      await patchSettings({
        recentProjects: [dest, ...(s.recentProjects ?? []).filter((d) => d !== dest)],
        ...(srcFolder ? { projectFolderOf: { ...(s.projectFolderOf ?? {}), [dest]: srcFolder } } : {})
      })
      return { ok: true, dir: dest }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // a project that leaves the list leaves its Open-window folder too
  const withoutFolderOf = (s: Settings, dir: string): Record<string, string> => {
    const m = { ...(s.projectFolderOf ?? {}) }
    delete m[dir]
    return m
  }
  ipcMain.handle('project:removeRecent', async (_e, dir: string) => {
    const s = await loadSettings()
    await patchSettings({ recentProjects: (s.recentProjects ?? []).filter((d) => d !== dir), projectFolderOf: withoutFolderOf(s, dir) })
    return true
  })
  ipcMain.handle('project:deleteAt', async (_e, dir: string) => {
    if (typeof dir !== 'string') return { ok: false, error: 'bad path' }
    if (getProject()?.dir === dir) return { ok: false, error: 'this project is open — open another project first' }
    if (!(await isPickerPath(dir))) return { ok: false, error: 'not a listed project' }
    try {
      await shell.trashItem(dir) // Recycle Bin, never a hard delete — recoverable (law 15)
      const s = await loadSettings()
      await patchSettings({
        recentProjects: (s.recentProjects ?? []).filter((d) => d !== dir),
        projectFolderOf: withoutFolderOf(s, dir),
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
  ipcMain.handle('spend:add', async (_e, entry: { label: string; kind: 'gen' | 'edit' | 'image' | 'watch'; cost: number }) => addSpend(entry))
  ipcMain.handle('spend:list', async () => listSpend())

  ipcMain.handle('project:get', async () => getProject())
  ipcMain.handle('project:undo', async () => undo())
  ipcMain.handle('assets:delete', async (_e, selection: import('@koan/vidancer-ui/shared/types').SendSelection) => deleteAssetSelection(selection))
  // bench / un-bench Library + Bin items — one save, one undo (DISABLE-ITEMS-SPEC-2026-09-19)
  ipcMain.handle('items:setDisabled', async (_e, selection: import('@koan/vidancer-ui/shared/types').SendSelection, disabled: boolean) =>
    selection && typeof selection === 'object' ? setItemsDisabled(selection, !!disabled) : null
  )
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

  // ONE import for everything (LIBRARY-IMPORT-FOLDER-SPEC-2026-09-08): one dialog, paths routed
  // by extension into the existing image / audio / video importers — same split as a drop
  // ----- open in an external editor (UI-ROUND-SPEC-2026-09-19 §2; pure half = editors.ts) -----
  const editorList = async (): Promise<editors.ExternalEditor[]> => {
    const s = await loadSettings()
    return editors.listEditors(s.externalEditors ?? [], s.lastExternalEditor)
  }
  ipcMain.handle('editors:list', () => editorList())
  ipcMain.handle('editors:pick', async () => {
    if (!mainWindow) return { editors: await editorList() }
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an image editor',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Apps', extensions: ['exe'] }] : [{ name: 'Apps', extensions: ['app'] }]
    })
    const exe = r.canceled ? undefined : r.filePaths[0]
    if (exe) {
      const s = await loadSettings()
      const own = (s.externalEditors ?? []).filter((e) => e.exe.toLowerCase() !== exe.toLowerCase())
      await patchSettings({ externalEditors: [...own, { name: basename(exe).replace(/\.(exe|app)$/i, ''), exe }], lastExternalEditor: exe.toLowerCase() })
    }
    return { editors: await editorList(), ...(exe ? { picked: exe.toLowerCase() } : {}) }
  })
  // the renderer names a FILE inside the open project and an editor ID from the list — never an exe path
  ipcMain.handle('editors:open', async (_e, file: string, editorId: string, sourceTitle: string, editedFrom?: string) => {
    const p = getProject()
    if (!p) return { ok: false as const, error: 'no project open' }
    if (typeof file !== 'string' || !existsSync(file) || !insideProject(file)) return { ok: false as const, error: 'that image is not in the open project' }
    const ed = (await editorList()).find((x) => x.id === editorId)
    if (!ed) return { ok: false as const, error: 'that editor is no longer installed' }
    try {
      await editors.startEdit(p.dir, file, { sourceTitle: String(sourceTitle || 'image'), editedFrom: typeof editedFrom === 'string' ? editedFrom : undefined }, ed)
      await patchSettings({ lastExternalEditor: ed.id })
      return { ok: true as const, editor: ed.name }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('editors:import', async (_e, watchId: string) => {
    const p = getProject()
    if (!p) return { ok: false as const, error: 'no project open' }
    try {
      const w = await editors.watchById(p.dir, String(watchId))
      const pending = (await editors.pendingEdits(p.dir)).find((x) => x.watchId === watchId)
      if (!w || !pending) return { ok: false as const, error: 'that edit is no longer on disk' }
      const r = await importExternalEdit(await editors.toImportable(pending.file), { sourceTitle: w.sourceTitle, editedFrom: w.editedFrom })
      await editors.markAnswered(p.dir, w.id)
      askingEdits.delete(`${pending.file}|${pending.mtime}`)
      return r ? { ok: true as const, delta: r.delta, imageId: r.imageId } : { ok: false as const, error: 'no project open' }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('editors:dismiss', async (_e, watchId: string) => {
    const p = getProject()
    if (p) await editors.markAnswered(p.dir, String(watchId))
    return true
  })

  ipcMain.handle('library:importAny', async () => {
    if (!mainWindow || !getProject()) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
        { name: 'Video', extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'] }
      ]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const imgs = r.filePaths.filter((p) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(p))
    const tracks = r.filePaths.filter((p) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(p))
    const vids = r.filePaths.filter((p) => /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(p))
    return {
      images: imgs.length ? await importImages(imgs) : null,
      audio: tracks.length ? await importAudioFiles(tracks) : null,
      video: vids.length ? await importVideoFiles(vids) : null
    }
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

  // PASTE / BROWSER DRAG (UI-ROUND-SPEC-2026-09-19 §3, built 09-22). Three doors into
  // importImageBytes: a browser's pathless File (bytes from the renderer), an image LINK dragged out
  // of a browser (fetched here: https only, image bytes only, the 64 MB cap), and the clipboard
  // (read HERE — the renderer's paste event only fires on a keypress, the "paste image" row needs
  // the clipboard on a click). Every refusal returns its reason; the renderer toasts it.
  const none = (error: string): { delta: undefined; importedIds: string[]; error: string } => ({ delta: undefined, importedIds: [], error })
  ipcMain.handle('library:importBytes', async (_e, name: string, bytes: Uint8Array) => {
    if (!getProject()) return none('open or create a project first — imports live inside the project folder')
    if (!(bytes instanceof Uint8Array)) return none('no image bytes arrived')
    try {
      return await importImageBytes(String(name || 'image'), bytes)
    } catch (e) {
      return none((e as Error).message)
    }
  })
  ipcMain.handle('library:importUrl', async (_e, url: string) => {
    if (!getProject()) return none('open or create a project first — imports live inside the project folder')
    let u: URL
    try {
      u = new URL(String(url))
    } catch {
      return none('that is not a link')
    }
    if (u.protocol !== 'https:') return none('only https image links can be fetched — save the image first, then drag the file')
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(30_000), headers: { accept: 'image/*' } })
      if (!res.ok) return none(`that site blocked the download (${res.status}) — save the image first, then drag the file`)
      if (Number(res.headers.get('content-length') || 0) > IMPORT_BYTES_CAP) return none('that image is over 64 MB — save it to disk and import the file')
      const buf = new Uint8Array(await res.arrayBuffer())
      if (!sniffImageExt(buf)) {
        const ct = (res.headers.get('content-type') ?? '').split(';')[0] || 'unknown type'
        return none(`that link is not an image (${ct}) — save the image first, then drag the file`)
      }
      return await importImageBytes(decodeURIComponent(basename(u.pathname)) || 'image', buf)
    } catch (e) {
      return none(`couldn't fetch that link — ${(e as Error).message}`)
    }
  })
  ipcMain.handle('library:clipboardHasImage', async () => !clipboard.readImage().isEmpty())
  ipcMain.handle('library:clipboardImage', async () => {
    if (!getProject()) return none('open or create a project first — imports live inside the project folder')
    const img = clipboard.readImage()
    if (img.isEmpty()) return none('clipboard holds no image')
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
    try {
      return await importImageBytes(`screen grab ${stamp}`, new Uint8Array(img.toPNG()))
    } catch (e) {
      return none((e as Error).message)
    }
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
  // item 8 (THE LIST 2026-09-22): a tile dropped on Watched → a copy of its file in the watched folder
  ipcMain.handle('watch:add', async (_e, file: string) => {
    const dir = getProject()?.watchFolder
    if (!dir) return { ok: false, error: 'pick a watched folder first' }
    try {
      const src = String(file)
      let dest = join(dir, basename(src))
      if (existsSync(dest) && dirname(src) !== dir) dest = join(dir, `${basename(src, extname(src))}-${Date.now()}${extname(src)}`)
      if (dest !== src) await copyFile(src, dest)
      return { ok: true, file: dest }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
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
  ipcMain.handle('vedit:run', async (e: IpcMainInvokeEvent, req: import('@koan/vidancer-ui/shared/types').VeditArgs) => {
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
      const onProgress = (m: string): void => safeSend(e.sender, 'edit:progress', m)

      const r = await runV2vEngine(
        proj,
        s,
        {
          jobId: req.jobId,
          engine: req.engine,
          prompt: req.prompt,
          sendFile,
          cacheKey: sendFile, // deterministic path IS the stable key
          imageRefIds: req.imageRefIds,
          videoRefs: req.videoRefs,
          audioRefs: req.audioRefs,
          duration: req.duration,
          resolution: req.resolution,
          aspectRatio: req.aspectRatio,
          generateAudio: req.generateAudio,
          outDir
        },
        onProgress
      )
      if ('error' in r) return { ok: false, error: r.error }
      const outFile = r.file
      let durationSec = r.durationSec
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
        refSummary: r.refSummary,
        durationSec,
        // the node freezes its full recipe — ↻ re-runs and bakes carry it forward
        imageRefIds: req.imageRefIds,
        videoRefs: req.videoRefs,
        audioRefs: req.audioRefs,
        duration: req.duration,
        resolution: req.resolution,
        aspectRatio: req.aspectRatio,
        generateAudio: req.generateAudio
      })
      if (!appended) return { ok: false, error: 'could not record the result node' }
      return { ok: true, delta: appended.delta, nodeId: appended.nodeId, file: outFile, costUsd: r.costUsd }
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
  // list 5: where a run of several exports lands — the default export folder, else a folder picked once
  // (kept here, never taken from the renderer: export:run only writes into a folder main chose)
  let batchDir: string | null = null
  const exportFolderOk = (d: string | undefined): d is string => !!d && existsSync(d)
  ipcMain.handle('export:pickDir', async () => {
    const proj = getProject()
    if (!proj || !mainWindow) return null
    const s0 = await loadSettings()
    if (exportFolderOk(s0.exportDir)) return (batchDir = s0.exportDir)
    const last = s0.lastExportDirs?.[proj.dir]
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Export the timelines into…', defaultPath: last && existsSync(last) ? last : join(proj.dir, 'exports'), properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    void patchSettings({ lastExportDirs: { ...(s0.lastExportDirs ?? {}), [proj.dir]: r.filePaths[0] } })
    return (batchDir = r.filePaths[0])
  })
  // list 5: Settings' default export folder, picked with the OS folder box
  ipcMain.handle('settings:pickExportDir', async () => {
    if (!mainWindow) return null
    const s0 = await loadSettings()
    const proj = getProject()
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Default export folder', defaultPath: exportFolderOk(s0.exportDir) ? s0.exportDir : proj ? join(proj.dir, 'exports') : undefined, properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    await patchSettings({ exportDir: r.filePaths[0] })
    return r.filePaths[0]
  })
  ipcMain.handle('export:run', async (e: IpcMainInvokeEvent, timelineId: string, bakes?: ExportBake[], opts?: { batch?: boolean }) => {
    const proj = getProject()
    if (!proj || !mainWindow) return { ok: false, error: 'no project open' }
    if (exporting || timelineWatchBusy()) return { ok: false, error: 'an export or timeline watch is already running' }
    const tl = proj.timelines.find((t) => t.id === timelineId)
    if (!tl) return { ok: false, error: 'timeline not found' }
    if (tl.items.length === 0) return { ok: false, error: 'timeline is empty' }
    const safe = tl.name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'timeline'
    // dialog reopens in this PROJECT's last export folder; the timestamped name means repeat
    // exports never hit the overwrite prompt and sort chronologically on disk
    const sExp = await loadSettings()
    const lastDir = sExp.lastExportDirs?.[proj.dir]
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`
    // list 5: a run of several → its folder; a default export folder → straight in; else the save box
    const auto = opts?.batch ? batchDir : exportFolderOk(sExp.exportDir) ? sExp.exportDir : null
    let r: { canceled: boolean; filePath?: string }
    if (auto) {
      let n = 1
      let f = join(auto, `${safe} ${stamp}.mp4`)
      while (existsSync(f)) f = join(auto, `${safe} ${stamp} (${++n}).mp4`) // never over an earlier file
      r = { canceled: false, filePath: f }
    } else
      r = await dialog.showSaveDialog(mainWindow, {
        title: 'Export timeline as mp4',
        defaultPath: join(lastDir && existsSync(lastDir) ? lastDir : join(proj.dir, 'exports'), `${safe} ${stamp}.mp4`),
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
      })
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
    // remember where this project exports (capped map — settings stay small)
    const dirs = { ...(sExp.lastExportDirs ?? {}), [proj.dir]: dirname(r.filePath) }
    const keys = Object.keys(dirs)
    if (keys.length > 12) delete dirs[keys[0]]
    void patchSettings({ lastExportDirs: dirs })
    exporting = true
    try {
      // freeze the state at run entry — the UI stays interactive during a long export, and
      // edits landing between the per-file probes would otherwise mix pre- and post-edit
      // timeline state into one file. (The renderer baked fx against the same state moments
      // earlier; bake→run is the one remaining tiny window.)
      const projSnap = structuredClone(proj)
      const tlSnap = projSnap.timelines.find((t) => t.id === timelineId)
      if (!tlSnap) return { ok: false, error: 'timeline not found' }
      return await exportTimeline(
        projSnap,
        tlSnap,
        r.filePath,
        (msg) => {
          safeSend(e.sender, 'export:progress', msg)
          // taskbar icon fills with export progress (Windows) — visible from any window
          const m = msg.match(/(\d+)%/)
          if (m) mainWindow?.setProgressBar(Math.min(0.99, Number(m[1]) / 100))
        },
        bakes
      )
    } finally {
      exporting = false
      mainWindow?.setProgressBar(-1)
      // baked fx segments are consumed — a session's LAST export must not leave GBs of full-res
      // temp video sitting until the next export:plan happens to run
      void fx.cleanBakes(proj.dir)
    }
  })
  // renderer-driven taskbar progress (the fx bake phase runs renderer-side): 2 = indeterminate
  // pulse, 0..1 = fill, -1 = clear
  ipcMain.handle('app:progress', (_e, v: number) => {
    if (!mainWindow) return
    if (v === 2) mainWindow.setProgressBar(2, { mode: 'indeterminate' })
    else if (v < 0) mainWindow.setProgressBar(-1)
    else mainWindow.setProgressBar(Math.min(0.99, v), { mode: 'normal' })
  })
  // a wrong hour-long export must be stoppable — kills ffmpeg, discards the .part
  ipcMain.handle('export:cancel', async () => timelineWatchBusy() ? cancelTimelineWatch() : cancelExport())

  // ----- EFFECTS v2: AI-pass sidecars, model downloads, export bakes -----
  // same confinement as fx:passStart — these were an any-path existence oracle + metadata probe
  ipcMain.handle('fx:sidecars', async (_e, takeFile: string) => (insideProject(takeFile) ? fx.fxSidecars(takeFile) : {}))
  ipcMain.handle('fx:probe', async (_e, file: string) => {
    if (!insideProject(file)) return { duration: 0, codec: '', width: 0, height: 0, fps: 0 }
    return probeVideo(file)
  })
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
  // ---- Models card (LOCAL-MODELS-PLAN phases 2+3): registry × disk state, the one download
  // surface. The runtime row (id 'python-runtime') routes to runtime.ts, everything else to
  // the shared downloader; the list merges both plus the provisioned envs and the GPU probe.
  ipcMain.handle('models:list', async () => {
    const [rows, rt, envs, gpu, aceB, aceW, mmB, mmW, ltxB, h3kB] = await Promise.all([
      modelStore.list(),
      runtime.runtimeRow(),
      runtime.listEnvs(),
      runtime.gpuProbe(),
      audioLocal.aceBytes(),
      audioLocal.aceWeightsBytes(),
      audioLocal.mmBytes(),
      audioLocal.mmWeightsBytes(),
      ltxLocal.ltxEngineBytes(),
      h3Local.kernelsBytes()
    ])
    const ace = audioLocal.aceStatus()
    const mm = audioLocal.mmStatus()
    const ltxE = ltxLocal.ltxEngineStatus()
    const h3k = h3Local.kernelsStatus()
    // errors are remembered in MAIN (bible 12.1) — installer rows carry theirs too
    const err = (id: string): { error?: string } => (modelStore.lastErrors.has(id) ? { error: modelStore.lastErrors.get(id) } : {})
    return {
      rows: [
        { id: runtime.RUNTIME_ID, status: rt.status, bytes: rt.bytes, pct: 0, ...err(runtime.RUNTIME_ID) },
        { id: ltxLocal.LTX_ENGINE_ID, status: ltxE.status, bytes: ltxE.status === 'ready' ? ltxB : 0, pct: 0, ...err(ltxLocal.LTX_ENGINE_ID) },
        // weightsBytes: consumers gate the "first render downloads its models" face on it
        { id: audioLocal.ACE_ID, status: ace.status, bytes: ace.status === 'ready' ? aceB : 0, pct: 0, weightsBytes: aceW },
        { id: audioLocal.MM_ID, status: mm.status, bytes: mm.status === 'ready' ? mmB : 0, pct: 0, weightsBytes: mmW },
        // H3's speed kernels (MINIMAX-H3-LOCAL-SPEC §2b): an installer row, not a file row
        { id: h3Local.H3_KERNELS_ID, status: h3k.status, bytes: h3k.status === 'ready' ? h3kB : 0, pct: 0, ...err(h3Local.H3_KERNELS_ID) },
        ...rows
      ],
      envs,
      gpu
    }
  })
  // list 15: swap in the files a row no longer pins (the LTX encoders Lightricks re-issued). The old
  // file keeps rendering until the new one is verified; the replace itself takes the GPU lane so it
  // waits for a running local render, then stops the idle engine that still holds the old file.
  ipcMain.handle('models:update', async (e: IpcMainInvokeEvent, id: string) => {
    try {
      await modelStore.download(id, e.sender, {
        update: true,
        swap: (replace) =>
          runtime.withGpu(async () => {
            runtime.killAllWorkers()
            await new Promise((r) => setTimeout(r, 1500))
            await replace()
          })
      })
      modelStore.lastErrors.delete(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== 'canceled') modelStore.lastErrors.set(id, msg)
      return { ok: false, error: msg }
    }
  })
  ipcMain.handle('models:download', async (e: IpcMainInvokeEvent, id: string) => {
    try {
      if (id === runtime.RUNTIME_ID) await runtime.ensureRuntime(e.sender)
      else if (id === audioLocal.ACE_ID) await audioLocal.installAce(e.sender)
      else if (id === audioLocal.MM_ID) await audioLocal.installMinimax(e.sender)
      else if (id === ltxLocal.LTX_ENGINE_ID) await ltxLocal.installLtxEngine(e.sender)
      else if (id === h3Local.H3_KERNELS_ID) await h3Local.installKernels(e.sender)
      else if (id.startsWith('minimax-h3-')) {
        // an H3 tier / encoder pulls its whole story (MINIMAX-H3-LOCAL-SPEC §2): the shared engine
        // → the two H3 node packs → essentials → the row. Each step is a no-op when already there.
        await h3Local.ensureH3Packs(e.sender)
        if (id !== 'minimax-h3-core') await modelStore.download('minimax-h3-core', e.sender)
        await modelStore.download(id, e.sender)
      } else if (id.startsWith('ltx-2.5-')) {
        // an LTX size pulls its whole story (spec §3): engine → shared essentials → the size.
        // Each step is a no-op when already there; each row animates its own progress.
        await ltxLocal.installLtxEngine(e.sender)
        if (id !== 'ltx-2.5-core') await modelStore.download('ltx-2.5-core', e.sender)
        await modelStore.download(id, e.sender)
      } else if (id.startsWith('krea-2-')) {
        // a Krea 2 build pulls ITS story (KREA2-LOCAL-SPEC §7): engine → the krea2edit nodes →
        // essentials (encoder, VAE, identity adapter) → the build
        await ltxLocal.installLtxEngine(e.sender)
        await krea2Local.ensureKrea2EditPack(e.sender)
        if (id !== 'krea-2-core') await modelStore.download('krea-2-core', e.sender)
        await modelStore.download(id, e.sender)
      } else if (id === 'krea2edit-pack') {
        await krea2Local.ensureKrea2EditPack(e.sender)
      } else await modelStore.download(id, e.sender)
      modelStore.lastErrors.delete(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // the CLICKED row carries the chain's story (bible 12.1): a size click that died in a
      // chained step (engine/essentials) must not leave the size row silently reverted
      if (msg !== 'canceled') {
        modelStore.lastErrors.set(id, msg)
        if (!e.sender.isDestroyed()) e.sender.send('models:done', { id, ok: false, error: msg })
      }
      return { ok: false, error: msg }
    }
  })
  ipcMain.handle('models:cancel', (_e, id: string) => {
    if (id === audioLocal.ACE_ID || id === audioLocal.MM_ID) audioLocal.cancelInstall(id)
    else if (id === ltxLocal.LTX_ENGINE_ID) ltxLocal.cancelInstall(id)
    else if (id === h3Local.H3_KERNELS_ID) h3Local.cancelKernels()
    else modelStore.cancel(id) // the runtime install is not cancelable mid-flight (uv owns it)
    return true
  })
  ipcMain.handle('models:delete', async (_e, id: string) => {
    if (id === runtime.RUNTIME_ID) await runtime.removeRuntime()
    else if (id === audioLocal.ACE_ID) await audioLocal.deleteAce()
    else if (id === audioLocal.MM_ID) await audioLocal.deleteMinimax()
    else if (id === ltxLocal.LTX_ENGINE_ID) await ltxLocal.deleteLtxEngine()
    else if (id === h3Local.H3_KERNELS_ID) await h3Local.deleteKernels()
    else await modelStore.deleteModel(id)
    return true
  })
  // ----- LoRA shelf (bible 12.10) — ONE COPY in @koan/shared; this app injects its transport -----
  configureLoraShelf({ downloadFile: modelStore.downloadFile, sha256Of: modelStore.sha256Of, lorasDir: ltxLocal.lorasDir, engineDirs: ltxLocal.ltxEngineDirs })
  registerLorasIpc(ipcMain, { getCivitaiKey: async () => ((await loadSettings()).civitaiKey as string) ?? '' })
  ipcMain.handle('models:runtimeTest', async (e: IpcMainInvokeEvent) => runtime.runtimeTest(e.sender))
  // the PURGE button (user call 2026-08-19): kill every local worker + reap strays, report
  // what's free — the manual escape hatch when anything squats on the GPU
  ipcMain.handle('models:freeGpu', async () => {
    runtime.killAllWorkers()
    await runtime.reapOrphans()
    return runtime.gpuFreeMB()
  })
  // waveform analysis via ffmpeg (renderer decodeAudioData truncates mp4 audio) — same media
  // confinement as the media:// protocol
  ipcMain.handle('wave:peaks', async (_e, file: string) => {
    if (!mediaAllowed(file)) return null
    const w = await wavePeaks(file)
    return w ? { dur: w.dur, pps: w.pps, peaks: w.peaks, beats: w.beats } : null
  })
  ipcMain.handle('models:diskFree', async () => {
    try {
      const s = await statfs(app.getPath('userData'))
      return s.bavail * s.bsize
    } catch {
      return null // wizard says "free space unknown" — never a fake number
    }
  })
  ipcMain.handle('fx:passStart', async (_e, takeFile: string, kind: 'matte' | 'depth', w: number, h: number, fps: number) => {
    if (!insideProject(takeFile)) return { ok: false, error: 'take is outside the open project' }
    const { id } = await fx.passStart(takeFile, kind, w, h, fps)
    return { ok: true, id }
  })
  ipcMain.handle('fx:encodeFrame', async (_e, id: string, frame: Uint8Array) => fx.encodeFrame(id, frame))
  ipcMain.handle('fx:encodeEnd', async (_e, id: string, keep: boolean) => fx.encodeEnd(id, keep))
  // pending-queue persistence — <project>/queue.json (pending payloads only; the renderer
  // offers a re-queue on the next open, so quit/crash never silently discards queued paid work)
  let queueChain: Promise<unknown> = Promise.resolve()
  ipcMain.handle('queue:save', async (_e, rows: unknown[]) => {
    const p = getProject()
    if (!p) return false
    const dir = p.dir
    const run = async (): Promise<boolean> => {
      const f = join(dir, 'queue.json')
      await writeFile(f + '.tmp', JSON.stringify({ rows: Array.isArray(rows) ? rows : [] }, null, 2), 'utf-8')
      await rename(f + '.tmp', f)
      return true
    }
    const pr = queueChain.then(run, run)
    queueChain = pr.catch(() => undefined)
    return pr
  })
  ipcMain.handle('queue:load', async () => {
    const p = getProject()
    if (!p) return null
    try {
      const raw = JSON.parse(await readFile(join(p.dir, 'queue.json'), 'utf-8')) as { rows?: unknown[] }
      return Array.isArray(raw.rows) && raw.rows.length ? raw.rows : null
    } catch {
      return null
    }
  })
  ipcMain.handle('export:plan', async (_e, timelineId: string) => {
    const proj = getProject()
    const tl = proj?.timelines.find((t) => t.id === timelineId)
    if (!proj || !tl) return null
    await fx.cleanBakes(proj.dir) // stale bake temps from a cancelled run
    return planExport(proj, tl)
  })
  ipcMain.handle('fx:bakeStart', async (_e, w: number, h: number, fps: number, projectDir?: string) => {
    const proj = getProject()
    if (!proj) return { ok: false, error: 'no project open' }
    if (projectDir && projectDir !== proj.dir) return { ok: false, error: 'The open project changed.' }
    const { id, file } = await fx.bakeStart(proj.dir, w, h, fps)
    return { ok: true, id, file }
  })

  // EXPORT AS (TODO-2026-09-22 §21): any Library media or clip take → one save box whose format
  // list decides the file (copy when it is the source's own format, ffmpeg otherwise). Replaces
  // the mp4-only clip:export. The original in the project is never moved or touched. Same
  // confinement as media:// — only files inside the open project may leave this way.
  ipcMain.handle('media:exportAs', async (_e, file: string, kind: ExportKind, title: string) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    if (typeof file !== 'string' || !existsSync(file) || !insideProject(file)) return { ok: false, error: 'file is not in this project' }
    const filters = EXPORT_FILTERS[kind]
    if (!filters) return { ok: false, error: `unknown kind ${String(kind)}` }
    const safe = String(title || basename(file, extname(file))).replace(/[<>:"/\\|?*]+/g, '').trim() || 'export'
    const own = extname(file).toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg')
    // the source's own format first, so the default pick is a lossless copy
    const ordered = [...filters].sort((a, b) => Number(b.extensions.includes(own)) - Number(a.extensions.includes(own)))
    const r = await dialog.showSaveDialog(mainWindow, {
      title: `Export ${kind} as`,
      defaultPath: join(app.getPath('desktop'), `${safe}.${ordered[0].extensions[0]}`),
      filters: ordered
    })
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
    try {
      await exportAs(file, r.filePath)
      return { ok: true, file: r.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
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
  // score render (SCORE-PLAN phase 3): resolve the clip's CURRENT beats+recipe, freeze the
  // snapshot at submit, render on fal, land the take. Crash bookkeeping mirrors video renders.
  ipcMain.handle('score:render', async (e, req: import('@koan/vidancer-ui/shared/types').ScoreRenderArgs): Promise<import('@koan/vidancer-ui/shared/types').ScoreRenderResult> => {
    const p = getProject()
    if (!p) return { ok: false, error: 'no project open' }
    const sc = p.scoreClips.find((x) => x.id === req.scoreClipId)
    if (!sc) return { ok: false, error: 'score clip not found' }
    let snapshot: NonNullable<import('@koan/vidancer-ui/shared/types').ScoreRenderArgs['snapshot']>
    try { snapshot = scoreRenderSnapshot(sc, req); emitScoreInput(snapshot.recipe.engine, snapshot.beats, snapshot.recipe.options ?? {}) }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) } }
    const model = scoreModel(snapshot.recipe.engine)
    const scoreOwner = captureProjectSession()
    const isLocal = model.provider === 'local'
    if (isLocal && model.id !== audioLocal.ACE_ID && model.id !== 'minimax-music-3-local') return { ok: false, error: `${model.label} local rendering arrives with its build` }
    if (!isLocal && model.provider !== 'fal' && model.provider !== 'elevenlabs' && model.provider !== 'google') return { ok: false, error: `${model.label}: no render path yet` }
    const s = await loadSettings()
    if (!isLocal && model.provider === 'fal' && !s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }
    if (model.provider === 'elevenlabs' && !s.elevenKey) return { ok: false, error: 'No ElevenLabs key saved — paste it in Settings → API → ElevenLabs.' }
    if (model.provider === 'google' && !s.googleKey) return { ok: false, error: 'No Google key saved — paste it in Settings → API → Google AI.' }
    const dirAtStart = p.dir
    beginMediaWrite() // the WAV lands before its take entry does
    let reqId: string | undefined
    let proxyPath: string | undefined
    try {
      assertProjectSession(scoreOwner)
      // video-to-music (Sonilo): render the covered span as a DRAFT PROXY first — 480p, fx
      // un-baked (the music needs pacing, not the final look), other scores stripped so the
      // model never scores on top of old music. The proxy uploads inside runScoreRender.
      if (model.videoToMusic) {
        const { timeline: tl, span } = scoreSpan(p, req)
        if (span.spanSec > model.maxDurationSec) throw new Error(`${model.label} supports spans up to ${model.maxDurationSec} seconds.`)
        if (tl.items.length === 0) return { ok: false, error: 'the timeline has no video to score' }
        const shadow: Timeline = { ...tl, rangeInSec: span.startSec, rangeOutSec: span.startSec + span.spanSec, scoreItems: [], exportRes: '480', exportQuality: 'draft' }
        proxyPath = join(p.dir, '.tmp', `score-proxy-${Date.now()}.mp4`)
        const ex = await exportTimeline(structuredClone(p), structuredClone(shadow), proxyPath, (m) => safeSend(e.sender, 'render:progress', { msg: `span proxy: ${m}` }), undefined, { isolated: true, padToRange: true })
        if (!ex.ok) return { ok: false, error: `span proxy render failed: ${ex.error}` }
        snapshot.recipe.options = { ...snapshot.recipe.options, durationSec: span.spanSec }
      }
      assertProjectSession(scoreOwner)
      // local = the ACE task API through the runtime worker; NO pending entry on purpose
      // (a dead app killed the worker — nothing to recover, nothing was billed)
      const localArgs = isLocal
        ? {
            input: emitScoreInput(model.id, snapshot.beats, snapshot.recipe.options ?? {}).input,
            outDir: join(p.dir, 'scores'),
            onProgress: (m: string) => safeSend(e.sender, 'render:progress', { msg: m })
          }
        : null
      const out = localArgs
        ? model.id === audioLocal.ACE_ID
          ? await audioLocal.renderAceScore(localArgs)
          : await audioLocal.renderMinimaxScore(localArgs)
        : await runScoreRender({
            jobId: req.jobId,
            engine: model.id,
            beats: snapshot.beats,
            options: snapshot.recipe.options ?? {},
            falKey: s.falKey as string, // guarded above for the fal branch
            elevenKey: s.elevenKey, // the ElevenLabs Music door (SCORE-WATCH-SPEC §4)
            googleKey: s.googleKey, // list 20: Lyria 3.5
            outDir: join(p.dir, 'scores'),
            videoPath: proxyPath,
            onProgress: (m) => safeSend(e.sender, 'render:progress', { msg: m }),
            onRequestId: (requestId, endpoint) => {
              reqId = requestId
              observePendingWrite(dirAtStart, addPendingScore(dirAtStart, { requestId, endpoint, jobId: req.jobId, createdAt: Date.now(), scoreClipId: sc.id, engine: model.id, snapshot }))
            }
          })
      if (getProject()?.dir !== dirAtStart)
        return { ok: false, error: model.provider === 'fal'
          ? 'the open project changed mid-render — the finished score will be collected on that project’s next open'
          : `The open project changed mid-render. The finished audio is saved at ${out.file}; import it into the original project.` } // fal recovery entry survives on purpose
      assertProjectSession(scoreOwner)
      const landed = await addScoreTake(sc.id, { requestId: reqId, file: out.file, engine: model.id, durationSec: out.durationSec, seed: out.seed, snapshot })
      assertProjectSession(scoreOwner)
      await removePendingScore(dirAtStart, { requestId: reqId, jobId: req.jobId })
      if (!landed) return { ok: false, error: 'the score clip vanished mid-render — the WAV is saved in scores/' }
      return { ok: true, delta: landed.delta, scoreClipId: sc.id, takeId: landed.takeId, file: out.file }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
      if (proxyPath) void unlink(proxyPath).catch(() => undefined) // the proxy is scratch — the take is the deliverable
    }
  })
  // score compose (SCORE-PLAN phase 5): read the clips under the span → suggested beats.
  // Overwrite rule (app grammar): empty score = beats fill IN PLACE (undoable); a score with
  // beats = the suggestions land in a DUPLICATE, the original untouched.
  ipcMain.handle('score:compose', async (_e, args: { scoreClipId: string; timelineId?: string; scoreItemId?: string }) => {
    const current = getProject()
    if (!current) return { ok: false, error: 'no project open' }
    const owner = captureProjectSession()
    const p = structuredClone(current)
    const sc = p.scoreClips.find((x) => x.id === args.scoreClipId)
    if (!sc) return { ok: false, error: 'score clip not found' }
    let proxyFile: string | undefined
    beginMediaWrite()
    try {
      const { timeline: tl, span } = scoreSpan(p, args)
      const model = scoreModel(sc.recipe.engine)
      if (span.spanSec > model.maxDurationSec) throw new Error(`${model.label} supports up to ${model.maxDurationSec} seconds — shorten the score span or choose a longer model.`)
      const s = await loadSettings()
      assertProjectSession(owner)
      const lane = claudeLane(s)
      const engine = lane.engine
      if (engine === 'api' && !lane.apiKey) return { ok: false, error: lane.noKey }
      const synthModel = lane.model
      // compose WATCHES THE CUT (SCORE-WATCH-SPEC §3): the score bar's own span, rendered as the
      // same 480p draft proxy the Sonilo door uses, handed to the watch lane; deleted after
      {
        if (tl.items.length > 0) {
          const shadow: Timeline = { ...tl, rangeInSec: span.startSec, rangeOutSec: span.startSec + span.spanSec, scoreItems: [], exportRes: '480', exportQuality: 'draft' }
          const out = join(p.dir, '.tmp', `compose-proxy-${Date.now()}.mp4`)
          proxyFile = out
          const ex = await exportTimeline(p, shadow, out, (m) => safeSend(_e.sender, 'render:progress', { msg: `compose · span proxy: ${m}` }), undefined, { isolated: true, padToRange: true })
          if (!ex.ok) throw new Error(`Could not prepare the score span: ${ex.error}`)
        }
      }
      assertProjectSession(owner)
      safeSend(_e.sender, 'render:progress', { msg: proxyFile ? 'compose · watching the cut…' : 'compose · reading the shots…' })
      const r = await composeScoreBeats(args, { engine, apiKey: lane.apiKey, bridgeModel: synthModel, synthModel, googleKey: s.googleKey, googleModel: s.googleWatchModel, bridge: engine === 'bridge' ? (prompt) => bridgeOneShot({ prompt, model: synthModel }) : undefined, proxyFile, projectSnapshot: p })
      assertProjectSession(owner)
      if (!r.ok) return r
      const live = getProject()?.scoreClips.find(x => x.id === sc.id)
      if (!live) throw new Error('The score was deleted while composing.')
      if (JSON.stringify({ beats: live.beats, recipe: live.recipe }) !== JSON.stringify({ beats: sc.beats, recipe: sc.recipe }))
        throw new Error('The score changed while composing. Your edits were kept — compose again when ready.')
      const recipe = { ...sc.recipe, options: { ...sc.recipe.options, durationSec: r.spanSec, composedWith: r.composedWith } }
      if (sc.beats.length === 0) {
        const d = await setScoreClipData(sc.id, { beats: r.beats, recipe })
        assertProjectSession(owner)
        return { ok: true, delta: d ?? undefined, scoreClipId: sc.id, created: false, beatCount: r.beats.length }
      }
      const dup = await duplicateScoreClip(sc.id)
      assertProjectSession(owner)
      if (!dup) return { ok: false, error: 'could not duplicate the score' }
      const d2 = await setScoreClipData(dup.newScoreClipId, { name: `${sc.name} ·composed`, beats: r.beats, recipe })
      assertProjectSession(owner)
      return { ok: true, delta: d2 ?? dup.delta, scoreClipId: dup.newScoreClipId, created: true, beatCount: r.beats.length }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (proxyFile) await unlink(proxyFile).catch(() => undefined)
      endMediaWrite()
    }
  })
  // ---- score clips (v18): the Bin's music citizens — SCORE-PLAN phase 1 ----
  ipcMain.handle('score:new', async (_e, name?: string) => newScoreClip(name))
  ipcMain.handle('score:set', async (_e, id: string, patch: { name?: string; beats?: import('@koan/vidancer-ui/shared/types').ScoreBeat[]; recipe?: import('@koan/vidancer-ui/shared/types').ScoreRecipe }) => setScoreClipData(id, patch))
  ipcMain.handle('score:setKeeper', async (_e, id: string, takeId: string) => setScoreKeeper(id, takeId))
  ipcMain.handle('score:takeMeta', async (_e, id: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => setScoreTakeMeta(id, takeId, patch))
  ipcMain.handle('score:fromTake', async (_e, id: string, takeId: string) => scoreClipFromTake(id, takeId))
  ipcMain.handle('score:delete', async (_e, id: string) => deleteScoreClip(id))
  ipcMain.handle('score:duplicate', async (_e, id: string) => duplicateScoreClip(id))
  ipcMain.handle('charsheet:new', async (_e, name?: string) => newCharSheet(name))
  ipcMain.handle('charsheet:set', async (_e, id: string, patch: { name?: string; imageId?: string | null; character?: import('@koan/vidancer-ui/shared/types').CharacterField; voiceId?: string | null }) => setCharSheet(id, patch))
  // ---- voices (rebuilt 2026-08-20 to the user's brief — Bin citizens, the score pattern) ----
  ipcMain.handle('voice:new', async (_e, name?: string) => newVoiceClip(name))
  ipcMain.handle('voice:set', async (_e, id: string, patch: { name?: string; recipe?: import('@koan/vidancer-ui/shared/types').VoiceRecipe }) => setVoiceClipData(id, patch))
  ipcMain.handle('voice:setKeeper', async (_e, id: string, takeId: string) => setVoiceKeeper(id, takeId))
  ipcMain.handle('voice:takeDuration', async (_e, id: string, takeId: string, sec: number) => setVoiceTakeDuration(id, takeId, sec))
  ipcMain.handle('voice:takeMeta', async (_e, id: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => setVoiceTakeMeta(id, takeId, patch))
  ipcMain.handle('voice:fromTake', async (_e, id: string, takeId: string) => voiceClipFromTake(id, takeId))
  ipcMain.handle('voice:takeDelete', async (_e, id: string, takeId: string) => deleteVoiceTake(id, takeId))
  ipcMain.handle('voice:delete', async (_e, id: string) => deleteVoiceClip(id))

  // ----- Image Gen (docs/KREA2-LOCAL-SPEC-2026-09-08.md): Krea 2 on the local engine -----
  ipcMain.handle('imagegen:new', async (_e, name?: string, recipe?: Partial<import('@koan/vidancer-ui/shared/types').ImageGenRecipe>) => newImageGen(name, recipe))
  ipcMain.handle('imagegen:set', async (_e, id: string, patch: { name?: string; recipe?: Partial<import('@koan/vidancer-ui/shared/types').ImageGenRecipe> }) => setImageGenData(id, patch))
  ipcMain.handle('imagegen:keeper', async (_e, id: string, takeId: string) => setImageGenKeeper(id, takeId))
  ipcMain.handle('imagegen:takeMeta', async (_e, id: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => setImageGenTakeMeta(id, takeId, patch))
  ipcMain.handle('imagegen:takeDelete', async (_e, id: string, takeId: string) => deleteImageGenTake(id, takeId))
  ipcMain.handle('imagegen:delete', async (_e, id: string) => deleteImageGen(id))
  ipcMain.handle('imagegen:duplicate', async (_e, id: string) => duplicateImageGen(id))
  ipcMain.handle('imagegen:toLibrary', async (_e, id: string, takeId: string) => imageGenTakeToLibrary(id, takeId))
  // what is installed: the panel's MODEL groups + the Models card's civit checkpoints row
  ipcMain.handle('imagegen:status', async () => ({
    engine: ltxLocal.ltxEngineInstalled(),
    pack: krea2Local.krea2EditInstalled(),
    essentials: krea2Local.essentialsInstalled(),
    official: krea2Local.officialInstalled(),
    civit: await krea2Local.listCivitCheckpoints()
  }))
  ipcMain.handle('imagegen:render', async (e: IpcMainInvokeEvent, req: { jobId?: string; imageGenId: string }) => {
    const p = getProject()
    if (!p) return { ok: false, error: 'no project open' }
    const g = (p.imageGens ?? []).find((x) => x.id === req.imageGenId)
    if (!g) return { ok: false, error: 'image gen not found' }
    const r = g.recipe
    if (!r.prompt.trim()) return { ok: false, error: 'write a prompt first' }
    if (!r.model) return { ok: false, error: 'pick a model — download Krea 2 in the Models card' }
    const imgFile = (id?: string): string | undefined => (id ? primaryImageFile(p, id) : undefined)
    const refA = r.refOn ? imgFile(r.refA) : undefined
    const refB = r.refOn ? imgFile(r.refB) : undefined
    if (r.refOn && r.refB && !r.refA) return { ok: false, error: 'ref A (scene) is empty — B rides with A' }
    // folder loras: every pick must still be on disk, and the unleashed row is his folder file
    const folderRows = await listFolderLoras()
    const loras = r.loraOn
      ? r.loras.filter((l) => {
          const ok = folderRows.some((x) => x.rel === l.name)
          if (!ok) safeSend(e.sender, 'imagegen:progress', { id: g.id, msg: `lora ${l.name} is not in your folders — rendering without it` })
          return ok
        })
      : []
    const unleashedRow = folderRows.find((x) => x.file.toLowerCase() === `${krea2Local.unleashedStem}.safetensors`)
    const unleashed = r.unleashedOn && unleashedRow ? { name: unleashedRow.rel, weight: r.unleashedWeight } : undefined
    // trigger words of the active loras join the prompt as his workflow concatenates them —
    // the take stores what ran (snapshot honesty)
    let promptSent = r.prompt.trim()
    for (const l of loras) {
      const row = folderRows.find((x) => x.rel === l.name)
      for (const w of row?.triggerWords ?? []) if (!promptSent.toLowerCase().includes(w.toLowerCase())) promptSent = `${promptSent}, ${w}`
    }
    const snapshot = JSON.parse(JSON.stringify(r)) as import('@koan/vidancer-ui/shared/types').ImageGenRecipe
    const dirAtStart = p.dir
    beginMediaWrite()
    try {
      safeSend(e.sender, 'imagegen:progress', { id: g.id, msg: 'waiting for the local engine…' })
      const out = await runtime.withGpu(() =>
        krea2Local.renderKrea2({
          jobId: req.jobId,
          model: r.model,
          prompt: promptSent,
          aspect: r.aspect,
          megapixels: r.megapixels,
          batch: r.batch,
          seed: r.seed,
          loras,
          unleashed,
          refs: refA ? { a: refA, b: refB, boost: r.refBoost, boostB: r.refBoostB } : undefined,
          outDir: join(p.dir, 'images', 'gen', g.id),
          onProgress: (msg, pct) => safeSend(e.sender, 'imagegen:progress', { id: g.id, msg, pct })
        })
      )
      if (getProject()?.dir !== dirAtStart) return { ok: false, error: 'the open project changed mid-render — the files are under images/gen/' }
      const res = await addImageGenTakes(
        g.id,
        out.files.map((file) => ({ file, seed: out.seed, width: out.width, height: out.height, modelFile: out.modelFile, promptSent, snapshot }))
      )
      if (!res) return { ok: false, error: 'the image gen vanished mid-render — the files are under images/gen/' }
      return { ok: true, delta: res.delta, takeIds: res.takeIds }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })
  ipcMain.handle('imagegen:cancel', async (_e, jobId?: string) => krea2Local.cancelKrea2(jobId))
  // the PNG reader (§8)
  ipcMain.handle('imagegen:readPng', async (_e, path: string) => {
    try {
      return { ok: true, settings: await readPngSettings(String(path)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('imagegen:pickPng', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Read a PNG made in another Comfy', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  // the sidebar's LOCAL source (§5.2): picked folders, read in place
  // folder = family (MINIMAX-H3-LOCAL-SPEC §4.2): picked from a family's side panel, it holds that
  // family's loras whatever Civitai tags them
  const addLoraFolder = async (path: string, family: LoraFamilyKey): Promise<ReturnType<typeof foldersOf>> => {
    const s = await loadSettings()
    const loraFolders = [...new Set([...((s.loraFolders as string[] | undefined) ?? []), path])]
    const loraFolderFamily = { ...((s.loraFolderFamily as Record<string, LoraFamilyKey> | undefined) ?? {}), [path]: family }
    await patchSettings({ loraFolders, loraFolderFamily })
    setExtraLoraDirs(loraFolders)
    runtime.killEngine(ltxLocal.LTX_ENGINE_ID) // the paths yaml is re-written at the next spawn
    return foldersOf({ loraFolders, loraFolderFamily })
  }
  ipcMain.handle('imagegen:folders', async () => foldersOf(await loadSettings()))
  ipcMain.handle('imagegen:pickFolder', async (e: IpcMainInvokeEvent, family: LoraFamilyKey) => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Pick a LoRA folder — read in place, never copied', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const next = await addLoraFolder(r.filePaths[0], family)
    scanFolderLoras(e.sender)
    return next
  })
  ipcMain.handle('imagegen:forgetFolder', async (_e, dir: string) => {
    const s = await loadSettings()
    const loraFolders = ((s.loraFolders as string[] | undefined) ?? []).filter((d) => d !== dir)
    const loraFolderFamily = { ...((s.loraFolderFamily as Record<string, LoraFamilyKey> | undefined) ?? {}) }
    delete loraFolderFamily[dir]
    await patchSettings({ loraFolders, loraFolderFamily })
    setExtraLoraDirs(loraFolders)
    runtime.killEngine(ltxLocal.LTX_ENGINE_ID)
    return foldersOf({ loraFolders, loraFolderFamily })
  })
  ipcMain.handle('imagegen:loras', async (e: IpcMainInvokeEvent) => {
    const rows = await listFolderLoras()
    if (rows.some((r) => !r.looked)) scanFolderLoras(e.sender) // words + previews arrive in the background
    return rows
  })
  ipcMain.handle('imagegen:loraTag', async (_e, root: string, rel: string, family: LoraFamilyKey) => {
    await tagFolderLora(root, rel, family)
    return true
  })
  // the sidebar's CIVIT source (§5.4) + the Models card's civit checkpoints row (§7)
  ipcMain.handle('imagegen:civit', async (_e, args: civitai.BrowseArgs) => {
    try {
      const key = ((await loadSettings()).civitaiKey as string) || undefined
      return { ok: true, ...(await civitai.browse(args, key)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // CIVIT LIKES (CIVIT-LIKES-SPEC-2026-09-09): the images he liked on civitai.com (site lane, same key),
  // their generation data in the PNG reader's shape, and the file for imports / slot drops
  const civitKey = async (): Promise<string> => {
    const k = ((await loadSettings()).civitaiKey as string) || ''
    if (!k) throw new Error('paste your Civitai key in Settings to see your likes')
    return k
  }
  ipcMain.handle('civit:liked', async (_e, cursor?: string | number) => {
    try {
      return { ok: true, ...(await civitai.liked(await civitKey(), cursor ?? undefined)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // item 8 (THE LIST 2026-09-22): a lora's posted examples — public, the key only rides along
  ipcMain.handle('civit:versionImages', async (_e, versionId: number, cursor?: string) => {
    try {
      const key = ((await loadSettings()).civitaiKey as string) || undefined
      return { ok: true, ...(await civitai.versionImages(Number(versionId), cursor ?? undefined, key)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('civit:generation', async (_e, id: number) => {
    try {
      return { ok: true, settings: await civitai.generationData(await civitKey(), Number(id)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('civit:imageFile', async (_e, id: number, url: string) => {
    try {
      return { ok: true, file: await civitai.imageFile(Number(id), String(url)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('civit:me', async (_e, key: string) => {
    try {
      return { ok: true, ...(await civitai.me(await realKeyFor('civitaiKey', String(key ?? '')))) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // civit downloads: a LoRA lands in the FIRST picked folder OF ITS FAMILY, a checkpoint under
  // image/civit/<versionId>/. Single-stream + sha256 gate (the 12-corrupt-files law), Bearer key in the header.
  const civitJobs = new Map<string, AbortController>()
  ipcMain.handle('imagegen:civitDownload', async (e: IpcMainInvokeEvent, row: civitai.CivitVersionRow, family: LoraFamilyKey = 'krea2') => {
    const s = await loadSettings()
    const key = s.civitaiKey as string
    if (!key) return { ok: false, error: 'Civitai downloads need your key — paste it in Settings' }
    if (civitJobs.has(row.key)) return { ok: false, error: 'already downloading' }
    let dest: string
    const stem = row.file.replace(/\.safetensors$/i, '')
    if (row.type === 'Checkpoint') {
      dest = join(civitCheckpointsDir(), String(row.versionId), row.file)
    } else {
      // a LoRA lands in ITS OWN folder inside the download folder, with its support files (his
      // layout: <stem>/<stem>.safetensors + .civit.info + preview jpegs). No folder yet = the
      // picker opens now (his order 2026-09-09: the first download prompts for the folder)
      let folder = foldersOf(s).find((f) => f.family === family)?.path
      if (!folder) {
        if (!mainWindow) return { ok: false, error: 'no window' }
        const label = family === 'ltx' ? 'LTX' : family === 'h3' ? 'MiniMax H3' : 'Krea 2'
        const r = await dialog.showOpenDialog(mainWindow, { title: `Pick your ${label} LoRA folder — downloads land here, each in its own folder`, properties: ['openDirectory', 'createDirectory'] })
        if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'canceled — pick a LoRA folder to download into' }
        folder = r.filePaths[0]
        safeSend(e.sender, 'imagegen:folders', await addLoraFolder(folder, family))
      }
      dest = join(folder, stem, row.file)
    }
    if (existsSync(dest)) return { ok: true, file: dest }
    const abort = new AbortController()
    civitJobs.set(row.key, abort)
    const send = (pct: number, note?: string): void => safeSend(e.sender, 'imagegen:dlProgress', { key: row.key, pct, note })
    try {
      await mkdir(dirname(dest), { recursive: true })
      const part = `${dest}.part`
      let lastSend = 0
      let lastGot = 0
      await modelStore.downloadFile(row.url, part, abort.signal, (got, total) => {
        const pct = total ? Math.floor((got / total) * 100) : 0
        const now = Date.now()
        if (now - lastSend >= 1000) {
          const mbps = lastSend ? (got - lastGot) / ((now - lastSend) / 1000) / 1e6 : 0
          send(pct, mbps > 0 ? `${pct}% · ${mbps.toFixed(1)} MB/s` : undefined)
          lastSend = now
          lastGot = got
        }
      }, { authorization: `Bearer ${key}` })
      if (row.sha256) {
        send(-1, `verifying ${row.file}…`)
        const digest = await modelStore.sha256Of(part)
        if (digest !== row.sha256) throw new Error(`${row.file} failed its integrity check (sha256 mismatch) — re-download; if it repeats, report this`)
      }
      await rename(part, dest)
      if (row.type === 'Checkpoint') {
        await krea2Local.writeCivitSidecar(row.versionId, { versionId: row.versionId, modelId: row.modelId, name: row.modelName, versionName: row.versionName, baseModel: row.baseModel, sha256: row.sha256, homepage: row.homepage, images: row.images.slice(0, 6), file: row.file })
      } else {
        // the support files, his layout: the raw version object as <stem>.civit.info (words ·
        // family · images), the previews as <stem>.preview.jpg + <stem>_n.jpeg — best effort
        send(-1, 'fetching the support files…')
        const base = join(dirname(dest), stem)
        try {
          await writeFile(`${base}.civit.info`, JSON.stringify(await civitai.versionRaw(row.versionId, key), null, 2))
        } catch (err) {
          // no info file = the sidebar's hash lookup fills the words later; say so in the log
          console.warn(`[civit] no .civit.info for ${row.file}: ${err instanceof Error ? err.message : err}`)
          await writeFile(`${base}.vd.json`, JSON.stringify({ name: row.name, baseModel: row.baseModel, triggerWords: row.triggerWords, thumb: row.images[0], sha256: row.sha256, civitKey: row.key, homepage: row.homepage, looked: true }, null, 2))
        }
        for (const [i, url] of row.images.slice(0, 8).entries()) {
          const buf = await civitai.fetchPreview(url)
          if (!buf) continue
          const ext = /\.png(\?|$)/i.test(url) ? 'png' : 'jpeg'
          await writeFile(`${base}_${i}.${ext}`, buf)
          if (i === 0) await writeFile(`${base}.preview.${ext === 'png' ? 'png' : 'jpg'}`, buf)
        }
      }
      safeSend(e.sender, 'imagegen:dlDone', { key: row.key, ok: true })
      return { ok: true, file: dest }
    } catch (err) {
      const msg = abort.signal.aborted ? 'canceled' : err instanceof Error ? err.message : String(err)
      await unlink(`${dest}.part`).catch(() => undefined)
      safeSend(e.sender, 'imagegen:dlDone', { key: row.key, ok: false, error: msg })
      return { ok: false, error: msg }
    } finally {
      civitJobs.delete(row.key)
    }
  })
  // a liked image names its loras by VERSION ID — this turns one into the row the downloader above
  // takes (CIVIT-DRAG-SPEC-2026-09-19 §4: `get + use` rides the one download path)
  ipcMain.handle('imagegen:civitGetVersion', async (_e, versionId: number) => {
    const s = await loadSettings()
    const key = s.civitaiKey as string
    if (!key) return { ok: false as const, error: 'paste your Civitai key in Settings to download' }
    try {
      const row = await civitai.rowForVersion(Number(versionId), key)
      return row ? { ok: true as const, row } : { ok: false as const, error: 'Civitai lists no downloadable .safetensors for that lora' }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('imagegen:civitCancel', (_e, key: string) => {
    civitJobs.get(key)?.abort()
    return true
  })
  ipcMain.handle('imagegen:civitDelete', async (_e, id: string) => {
    // an installed civit checkpoint: its whole version folder goes (file + sidecar)
    const vid = id.replace(/^civit:/, '')
    if (!/^\d+$/.test(vid)) return false
    runtime.killEngine(ltxLocal.LTX_ENGINE_ID)
    await rm(join(civitCheckpointsDir(), vid), { recursive: true, force: true })
    return true
  })
  // thumbs reach the renderer as data URLs (CSP: no file:// and media:// is project-confined);
  // remote ones ride the shelf's proxy, local previews are read straight from disk (≤4 MB)
  const localThumbs = new Map<string, string | null>()
  ipcMain.handle('imagegen:thumb', async (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return loraShelf.thumb(url)
    if (localThumbs.has(url)) return localThumbs.get(url) ?? null
    try {
      const buf = await readFile(url)
      const ext = extname(url).toLowerCase()
      const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const data = buf.byteLength <= 4 * 1024 * 1024 ? `data:${type};base64,${buf.toString('base64')}` : null
      if (localThumbs.size > 400) localThumbs.clear()
      localThumbs.set(url, data)
      return data
    } catch {
      localThumbs.set(url, null)
      return null
    }
  })
  // describe-voice (VOICES-SPEC): ONE sub-call turns the sheet's character fields into a voice
  // description — text-only today (sub-calls carry prompt strings; the image joins with the
  // co-director rejig). The card seeds its design box with the reply; the USER presses Generate.
  ipcMain.handle('voice:describe', async (_e, sheetId: string): Promise<{ ok: boolean; desc?: string; error?: string }> => {
    const p = getProject()
    if (!p) return { ok: false, error: 'no project open' }
    const sheet = p.charSheets.find((x) => x.id === sheetId)
    if (!sheet) return { ok: false, error: 'char sheet not found' }
    const s = await loadSettings()
    const lane = claudeLane(s)
    const engine = lane.engine
    if (engine === 'api' && !lane.apiKey) return { ok: false, error: lane.noKey }
    const ch = sheet.character
    const bits = [
      `Name: ${ch.name || sheet.name}`,
      ch.base && `Base: ${ch.base}`,
      ch.features && `Features: ${ch.features}`,
      ch.physics && `Physics/presence: ${ch.physics}`,
      ch.emotionalState && `Emotional state: ${ch.emotionalState}`,
      ch.power && `Power: ${ch.power}`
    ]
      .filter(Boolean)
      .join('\n')
    // the description is creative writing — it rides the CODIR model, not the cheap digest tier
    // (highest quality is the default; score:compose's synthesis pass sets the precedent)
    const descModel = lane.model
    const r = await runSubCalls(
      [
        {
          id: 'desc',
          system: 'You write voice-design prompts for AI voice engines. Reply with the description alone — no preamble, no options, no markdown.',
          prompt: `Write one voice description (2-4 sentences) for this character — timbre, age, pace, texture, attitude; concrete adjectives an audio model can act on:\n\n${bits}`,
          model: descModel,
          maxTokens: 400
        }
      ],
      { engine, apiKey: lane.apiKey, ...(engine === 'bridge' ? { bridgeModel: descModel } : {}) }
    )
    const first = r.results[0]
    if (!first?.ok || !first.text) return { ok: false, error: first?.error ?? 'no description came back' }
    return { ok: true, desc: first.text }
  })
  // voice render (the score pattern): resolve the voice clip's CURRENT recipe — description,
  // test line, character image, clone sample, dials — render on fal, land the take. Snapshot
  // frozen at submit; the first take becomes the ★ keeper automatically.
  ipcMain.handle('voice:render', async (e, req: import('@koan/vidancer-ui/shared/types').VoiceRenderArgs): Promise<import('@koan/vidancer-ui/shared/types').VoiceRenderResult> => {
    const p = getProject()
    if (!p) return { ok: false, error: 'no project open' }
    const vc = p.voiceClips.find((x) => x.id === req.voiceClipId)
    if (!vc) return { ok: false, error: 'voice not found' }
    const model = audioModelFor(req.engine || vc.recipe.engine)
    if (model.provider === 'local') return { ok: false, error: `${model.label} renders locally once its runtime lands — use the API twin meanwhile` }
    const s = await loadSettings()
    // whose key speaks: fal, or (list 18 / 19) Google and ElevenLabs direct
    const supplierKey = { fal: s.falKey, google: s.googleKey, elevenlabs: s.elevenKey }[model.provider]
    if (!supplierKey) return { ok: false, error: `No ${{ fal: 'fal', google: 'Google', elevenlabs: 'ElevenLabs' }[model.provider]} key saved — paste it in Settings first.` }
    const r = vc.recipe
    const text = (r.testLine ?? '').trim()
    if (!text) return { ok: false, error: 'write a test line — every take needs words to speak' }
    let refPath = r.refAudioId ? p.audio.find((a) => a.id === r.refAudioId)?.file : undefined
    if (r.refAudioId && (!refPath || !existsSync(refPath))) return { ok: false, error: 'the clone sample is gone from the Library — re-pick it' }
    // no sample picked but the voice HAS a ★ keeper → clone engines copy the keeper (the
    // tutorial loop: design once in Seed Audio, then Chatterbox speaks new lines in that voice)
    if (!refPath && model.voiceClone) {
      const keeper = vc.takes.find((t) => t.id === vc.keeperTakeId && !t.disabled) ?? [...vc.takes].reverse().find((t) => !t.disabled)
      if (keeper && existsSync(keeper.file)) refPath = keeper.file
    }
    // a supplier voice (list 18 / 19): the card's pick, else the voice the PLAYING take was designed or
    // cloned into on this same supplier — new lines speak in the kept voice, nothing is made again
    const picked = typeof r.options?.voice === 'string' && r.options.voice ? r.options.voice : undefined
    const playing = vc.takes.find((t) => t.id === vc.keeperTakeId && !t.disabled) ?? [...vc.takes].reverse().find((t) => !t.disabled)
    const kept = !picked && model.provider !== 'fal' && playing?.voiceId && audioModelFor(playing.engine).provider === model.provider ? playing.voiceId : undefined
    const supplierVoice = model.provider === 'fal' ? undefined : (picked ?? kept)
    if (!supplierVoice && !refPath && !model.voiceDesign) return { ok: false, error: `${model.label} clones a sample — add one (or generate take 1 with Seed Audio; after that the ★ keeper is the sample)` }
    if (!supplierVoice && !refPath && model.voiceDesign && !(r.desc ?? '').trim())
      return { ok: false, error: model.voices || model.voiceLibrary ? 'describe the voice first, or pick a ready voice' : 'describe the voice first — the description is what the engine designs from' }
    const mode: 'design' | 'clone' = refPath && model.voiceClone ? 'clone' : 'design'
    // the character image rides Seed Audio design renders (its schema: an image ref EXCLUDES audio refs)
    const imagePath = mode === 'design' && model.id === 'seed-audio-1' && r.imageId ? primaryImageFile(p, r.imageId) : undefined
    if (imagePath && !existsSync(imagePath)) return { ok: false, error: 'The primary character image file is missing. Select an available image before generating.' }
    const snapshot = JSON.parse(JSON.stringify({ recipe: vc.recipe })) as { recipe: import('@koan/vidancer-ui/shared/types').VoiceRecipe }
    const dirAtStart = p.dir
    const voiceOwner = captureProjectSession()
    let reqId: string | undefined
    beginMediaWrite() // the audio lands before its take entry does
    try {
      const out = await runVoiceRender({
        jobId: req.jobId,
        engine: model.id,
        mode,
        text,
        desc: r.desc,
        refAudioPath: mode === 'clone' ? refPath : undefined,
        imagePath,
        options: r.options ?? {},
        falKey: s.falKey,
        googleKey: s.googleKey,
        elevenKey: s.elevenKey,
        voice: supplierVoice,
        name: vc.name,
        outDir: join(p.dir, 'voices'),
        onProgress: (m) => safeSend(e.sender, 'render:progress', { msg: m }),
        onRequestId: (requestId, endpoint) => {
          // crash bookkeeping, the score contract: money spent must never be lost to a restart
          reqId = requestId
          observePendingWrite(dirAtStart, addPendingVoice(dirAtStart, { requestId, endpoint, jobId: req.jobId, createdAt: Date.now(), voiceClipId: vc.id, engine: model.id }))
        }
      })
      if (getProject()?.dir !== dirAtStart)
        return { ok: false, error: 'the open project changed mid-render — the finished take will be collected on that project’s next open' } // pending entry survives on purpose
      assertProjectSession(voiceOwner)
      // a voice MADE for this voice clip (designed / cloned, or the kept one re-used) rides the take; a ready pick does not
      const res = await addVoiceTake(req.voiceClipId, { requestId: reqId, file: out.file, engine: model.id, durationSec: out.durationSec, seed: out.seed, voiceId: picked ? undefined : out.voiceId, snapshot })
      assertProjectSession(voiceOwner)
      await removePendingVoice(dirAtStart, { requestId: reqId, jobId: req.jobId })
      if (!res) return { ok: false, error: 'the voice vanished mid-render — the audio is on disk under voices/' }
      return { ok: true, delta: res.delta, voiceClipId: req.voiceClipId, takeId: res.takeId, file: out.file }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })
  // list 19: the voices of his ElevenLabs account, for the Voice card's pick (spends nothing)
  ipcMain.handle('voice:voices', async (_e, engine: string) => {
    const m = audioModelFor(String(engine ?? ''))
    if (!m.voiceLibrary) return { ok: true, voices: m.voices ?? [] }
    const key = (await loadSettings()).elevenKey
    return key ? elevenVoices(key) : { ok: false, error: 'No ElevenLabs key saved — paste it in Settings first.' }
  })
  ipcMain.handle('charsheet:delete', async (_e, id: string) => deleteCharSheet(id))
  ipcMain.handle('items:reorder', async (_e, kind: 'bin' | 'lib', movedIds: string[], targetId: string) => reorderItems(kind, movedIds, targetId))
  ipcMain.handle('style:new', async (_e, name?: string) => newStyle(name))
  ipcMain.handle('style:set', async (_e, id: string, patch: { name?: string; scene?: SceneFields; production?: ProductionFields; enhanced?: string[] }) => setStyle(id, patch))
  ipcMain.handle('style:delete', async (_e, id: string) => deleteStyle(id))

  // ----- Co-Director (the conversational copilot) -----
  ipcMain.handle(
    'codir:send',
    async (e: IpcMainInvokeEvent, req: { text: string; imageIds: string[]; selectedClipId: string | null; focus: { kind: string; ownerId: string; path?: string } | null; moods?: string[]; openImageGenId?: string | null }) => {
      setOpenImageGen(req.openImageGenId) // KREA2-LOCAL-SPEC §14 — before either lane builds its context
      const s = await loadSettings()
      const heat = typeof s.codirHeat === 'number' ? s.codirHeat : undefined // HEAT dial (tether spec §6)
      // MOODS riding this exchange: the session's ON set (renderer) + this project's pins + #one-shots in the text
      const moods = Array.from(new Set([...(req.moods ?? []), ...(getProject()?.codir.moodsPinned ?? []), ...(await moodsMentioned(req.text))]))
      // stamp the exchange's project — every runTool write (API and bridge share runTool via
      // codirMcp) checks against it, so an exchange outliving a project switch REFUSES to write
      setExchangeDir(getProject()?.dir ?? null)
      // the WATCH lane for watch_take: Gemini when the Google key is set, else spaced frames read by
      // Claude through whichever engine the Co-Director runs on
      const lane = claudeLane(s)
      const effort = effortFor(lane.model, s.codirEffort) // list 26: how hard it thinks, on whichever engine
      // list 29: web research when he asks. Venice's wire has no such tools: there it stays shut
      const web = s.codirEngine !== 'venice' && asksForWeb(req.text, getProject()?.codir.log)
      setExchangeKeys({
        googleKey: s.googleKey,
        googleModel: s.googleWatchModel,
        anthropicKey: lane.engine === 'api' ? lane.apiKey : undefined,
        model: lane.engine === 'api' ? lane.model : resolveCodirModel(s.codirModel as string | undefined),
        bridge: lane.engine === 'bridge' ? (prompt, signal) => bridgeOneShot({ prompt, signal, model: lane.model }) : undefined,
        moodAuthor: s.moodAuthor,
        userText: req.text,
        loraFolders: foldersOf(s)
      })
      try {
        // EXPERIMENTAL bridge engine: same request, same progress/delta channels, no API key —
        // exchanges run through the user's local Claude Code (their subscription) instead
        if (lane.engine === 'bridge') {
          return await codirBridgeSend(
            {
              text: req.text,
              imageIds: Array.isArray(req.imageIds) ? req.imageIds : [],
              selectedClipId: req.selectedClipId ?? null,
              focus: req.focus ?? null,
              guideLoad: s.codirGuideLoad,
              model: lane.model,
              rlm: s.codirRlm !== false, // default ON (spec 2026-08-27; director 2026-08-30)
              heat,
              moods,
              effort,
              web
            },
            (ev) => safeSend(e.sender, 'codir:progress', ev),
            (d) => safeSend(e.sender, 'project:delta', d)
          )
        }
        if (!lane.apiKey) return { ok: false, error: lane.noKey }
        return await codirSend(
          {
            text: req.text,
            imageIds: Array.isArray(req.imageIds) ? req.imageIds : [],
            selectedClipId: req.selectedClipId ?? null,
            focus: req.focus ?? null,
            apiKey: lane.apiKey,
            model: lane.model,
            guideLoad: s.codirGuideLoad,
            rlm: s.codirRlm !== false, // default ON (spec 2026-08-27; director 2026-08-30)
            heat,
            moods,
            effort,
            web
          },
          (ev) => safeSend(e.sender, 'codir:progress', ev),
          (d) => safeSend(e.sender, 'project:delta', d) // live UI updates while the AI writes
        )
      } finally {
        setExchangeDir(null)
      }
    }
  )
  ipcMain.handle('codir:cancel', async () => {
    cancelCoDir()
    cancelCoDirBridge()
  })
  // COMPACT — fold the older conversation into a digest + brief additions (one press, undoable)
  ipcMain.handle('codir:compact', async (e: IpcMainInvokeEvent) => {
    const lane = claudeLane(await loadSettings())
    if (lane.engine === 'api' && !lane.apiKey) return { ok: false, error: lane.noKey }
    return await codirCompact(
      // the Co-Director's own model — digesting the director's words never runs on a cheap tier
      { engine: lane.engine, apiKey: lane.apiKey, model: lane.model },
      (d) => safeSend(e.sender, 'project:delta', d)
    )
  })
  ipcMain.handle('codir:bridgeStatus', async (_e, refresh?: boolean) => detectClaudeCli(!!refresh))
  ipcMain.handle('codir:bridgeUpdate', async () => updateClaudeCli()) // the "update claude code" button
  ipcMain.handle('codir:bridgeModels', async () => CODIR_BRIDGE_MODELS)
  ipcMain.handle('codir:clearLog', async () => {
    resetBridgeSession() // a cleared panel must not resume the old CLI conversation
    return codirClearLog()
  })
  ipcMain.handle('codir:setBrief', async (_e, brief: string) => codirSetBrief(String(brief ?? '')))
  ipcMain.handle('codir:models', async () => CODIR_MODELS)
  ipcMain.handle('codir:veniceModels', async () => CODIR_VENICE_MODELS) // list 14
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
  ipcMain.handle('timeline:setBoth', async (_e, timelineId: string, items: TimelineItem[], audioItems: import('@koan/vidancer-ui/shared/types').TimelineAudioItem[] | null, baseRev?: number) =>
    setTimelineBoth(timelineId, items, audioItems, baseRev)
  )
  ipcMain.handle('timeline:setScoreItems', async (_e, timelineId: string, scoreItems: import('@koan/vidancer-ui/shared/types').TimelineScoreItem[], baseRev?: number) =>
    setTimelineScoreItems(timelineId, scoreItems, baseRev)
  )
  ipcMain.handle('timeline:setAll', async (_e, timelineId: string, items: TimelineItem[], audioItems: import('@koan/vidancer-ui/shared/types').TimelineAudioItem[] | null, scoreItems: import('@koan/vidancer-ui/shared/types').TimelineScoreItem[] | null, baseRev?: number) =>
    setTimelineAll(timelineId, items, audioItems, scoreItems, baseRev)
  )
  // list 6: keeper flags on one take set (clip / score / voice / image gen)
  ipcMain.handle('keepers:set', async (_e, kind: 'clip' | 'score' | 'voice' | 'imagegen', ownerId: string, takeIds: string[], on: boolean | null) =>
    Array.isArray(takeIds) && ['clip', 'score', 'voice', 'imagegen'].includes(kind) ? setKeeperFlags(kind, ownerId, takeIds, on === true ? true : on === false ? false : null) : null
  )
  // list 51: a take's reversed copy, made once next to it — only for a take of the open project
  ipcMain.handle('media:reverse', async (_e, file: string) => {
    const p = getProject()
    if (typeof file !== 'string' || !p?.clips.some((c) => c.takes.some((t) => t.file === file))) return { ok: false, error: 'not a take of this project' }
    return ensureReversed(file)
  })
  ipcMain.handle('nest:create', async (_e, parentId: string, inner: import('@koan/vidancer-ui/shared/types').Timeline, items: TimelineItem[], audioItems: import('@koan/vidancer-ui/shared/types').TimelineAudioItem[], baseRev?: number) =>
    createNest(parentId, inner, items, audioItems, baseRev)
  )
  ipcMain.handle('timeline:setAudioItems', async (_e, timelineId: string, audioItems: import('@koan/vidancer-ui/shared/types').TimelineAudioItem[], baseRev?: number) =>
    setTimelineAudioItems(timelineId, audioItems, baseRev)
  )
  ipcMain.handle('timeline:unlinkAudio', async (_e, timelineId: string, itemId: string) => unlinkAudioFromItem(timelineId, itemId))
  ipcMain.handle('timeline:setMeta', async (_e, timelineId: string, patch: Record<string, unknown>) => setTimelineMeta(timelineId, patch))
  ipcMain.handle('timeline:slice', async (_e, timelineId: string, itemId: string, cutSec: number) =>
    sliceTimelineItem(timelineId, itemId, cutSec)
  )
  // 41: the razor on the lanes
  ipcMain.handle('timeline:sliceAudio', async (_e, timelineId: string, audioId: string, cutSec: number) => sliceTimelineAudio(timelineId, audioId, cutSec))
  ipcMain.handle('timeline:sliceScore', async (_e, timelineId: string, scoreId: string, cutSec: number) => sliceTimelineScore(timelineId, scoreId, cutSec))
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
  ipcMain.handle('take:delete', async (_e, clipId: string, takeId: string) => deleteTake(clipId, takeId))

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
        // MODEL · VIA row + the SELECT tool (UI-ROUND-SPEC-2026-09-19 §6)
        model?: string
        via?: string
        resolution?: string
        quality?: string
        maskPng?: Uint8Array // white inside the selection, black outside, at the base's exact pixel size
        jobId?: string // 58: the queue row this render belongs to — its progress lands on that row
      }
    ) => {
      // the panel's status line AND the queue row both follow the render
      const progress = (m: string): void => {
        safeSend(e.sender, 'image:progress', m)
        if (req.jobId) safeSend(e.sender, 'render:progress', { msg: m, jobId: req.jobId })
      }
      beginMediaWrite() // edit variants land in images/edits/ one download at a time before appendEditNodes
      try {
        const s = await loadSettings()
        const proj = getProject()
        if (!proj) return { ok: false, error: 'No project open.' }

        // Match the viewed tree node, including the explicit original row.
        let baseImage = imageEditSource(proj, req.rootImageId, req.parentNodeId)
        if (req.rootImageId && !baseImage) return { ok: false, error: 'Source image not found.' }
        const cleanBase = baseImage // paste-back restores THESE pixels — never the marked-up copy
        const imgModel = imageModelFor(req.model)
        const viaRow = imgModel.vias.find((v) => v.id === (req.via ?? 'fal'))
        if (viaRow && !viaRow.ready) return { ok: false, error: `${imgModel.label} via ${viaRow.label}: ${viaRow.reason ?? 'not available'} — nothing was spent` }
        // who runs it: a VIA row with its own model id is that supplier's API (list 10 ModelArk, list 9
        // Google, on the keys he already saved); everything else is fal
        const supplier = viaRow?.slug && (viaRow.id === 'ark' || viaRow.id === 'google' || viaRow.id === 'venice') ? viaRow.id : 'fal'
        const key = { fal: s.falKey, ark: s.arkKey, google: s.googleKey, venice: s.veniceKey }[supplier]
        if (!key) return { ok: false, error: `No ${{ fal: 'fal', ark: 'ModelArk', google: 'Google', venice: 'Venice' }[supplier]} key saved — paste it in Settings first.` }
        let maskImage: string | undefined
        if (req.maskPng && baseImage) {
          maskImage = join(proj.dir, 'images', 'edits', `mask_${randomUUID()}.png`)
          await mkdir(join(proj.dir, 'images', 'edits'), { recursive: true })
          await writeFile(maskImage, Buffer.from(req.maskPng))
        }
        if (req.basePng && baseImage) {
          // write the composite next to the edit results; it's the file fal receives
          const drawPath = join(proj.dir, 'images', 'edits', `draw_${randomUUID()}.png`)
          await mkdir(join(proj.dir, 'images', 'edits'), { recursive: true })
          await writeFile(drawPath, Buffer.from(req.basePng))
          baseImage = drawPath
        }
        const refFiles = req.refIds
          .map((id) => primaryImageFile(proj, id))
          .filter((f): f is string => !!f)

        const gen = { prompt: req.prompt, baseImage, refImages: refFiles, numImages: req.numImages, aspectRatio: req.aspectRatio, resolution: req.resolution, maskImage, outDir: join(proj.dir, 'images', 'edits'), onProgress: progress }
        const r =
          supplier === 'ark' ? await runArkImage({ ...gen, arkKey: key, arkModel: viaRow!.slug! })
          : supplier === 'google' ? await runGoogleImage({ ...gen, seed: req.seed, googleKey: key, googleModel: viaRow!.slug! })
          : supplier === 'venice' ? await runVeniceImage({ ...gen, seed: req.seed, veniceKey: key, veniceModel: viaRow!.slug! })
          : await runImageGen({ ...gen, seed: req.seed, model: imgModel.id, quality: req.quality, falKey: key })
        // SELECT on a model with no mask input: keep ONLY the selected area from each result, his
        // original pixels everywhere else. The raw output stays on disk beside the composite.
        let files = r.files
        let regions: (string | undefined)[] | undefined
        if (maskImage && cleanBase) {
          if (imgModel.region === 'mask') regions = files.map(() => 'mask')
          else {
            progress('keeping only the selected area…')
            regions = []
            const kept: string[] = []
            for (const raw of files) {
              const out = raw.replace(/\.[a-z0-9]+$/i, '_sel.png')
              const pb = await pasteBack(cleanBase, raw, maskImage, out)
              kept.push(pb.ok ? out : raw)
              regions.push(pb.ok ? 'pasted' : (pb.reason ?? 'paste-back skipped'))
            }
            files = kept
          }
        }
        const appended = await appendEditNodes({
          rootImageId: req.rootImageId,
          parentId: req.parentNodeId,
          files,
          prompt: req.prompt,
          seed: r.seed ?? req.seed,
          refIds: req.refIds,
          model: imgModel.id,
          via: req.via ?? 'fal',
          regions
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
  // ---- BLOCKING SHEET (shared/blocking.ts): beats → one B&W blocking-sheet prompt → Nano draws it
  // (the from-scratch image session) → tagged into the Library, folder "blocking", attached to the
  // clip LAST. The renderer warned about fights before calling. ----
  ipcMain.handle('block:build', async (e: IpcMainInvokeEvent, clipId: string) => {
    const s = await loadSettings()
    if (!s.falKey) return { ok: false, error: 'No fal key saved — paste it in Settings first.' }
    const proj = getProject()
    const clip = proj?.clips.find((c) => c.id === clipId)
    if (!proj || !clip) return { ok: false, error: 'clip not found' }
    const plan = buildBlockingPrompt({ clipName: clip.name, beats: clip.promptData.beats ?? [], durationSec: Number(clip.promptData.duration) || 0, aspect: clip.promptData.aspectRatio })
    if (!plan.panels.length) return { ok: false, error: 'write the beats first — the sheet is drawn from them' }
    beginMediaWrite()
    try {
      safeSend(e.sender, 'image:progress', `blocking: drawing ${plan.panels.length} panels…`)
      const r = await runImageGen({ model: 'nano-banana-pro', prompt: plan.prompt, baseImage: undefined, refImages: [], numImages: 1, aspectRatio: plan.sheetAspect, falKey: s.falKey, outDir: join(proj.dir, 'images', 'edits'), onProgress: (m) => safeSend(e.sender, 'image:progress', m) })
      const appended = await appendEditNodes({ rootImageId: '', parentId: null, files: r.files, prompt: plan.prompt, seed: r.seed, refIds: [] })
      if (!appended || !appended.nodeIds.length) return { ok: false, error: 'project closed during the draw' }
      const session = getProject()?.editSessions.find((x) => x.rootImageId === '')
      if (!session) return { ok: false, error: 'the from-scratch image session vanished' }
      const tagged = await tagEditNode(session.id, appended.nodeIds[0])
      if (!tagged) return { ok: false, error: 'could not file the sheet in the Library' }
      const delta = await attachBlocking(clip.id, tagged.imageId)
      if (!delta) return { ok: false, error: 'the clip vanished while the sheet was drawn — it is in the Library' }
      return { ok: true, delta, imageId: tagged.imageId, panels: plan.panels.length }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })
  ipcMain.handle('image:deleteBranch', async (_e, sessionId: string, nodeId: string) => deleteEditBranch(sessionId, nodeId))

  // ----- cross-project clip import: pick an old project folder, list its clips, copy some in -----
  ipcMain.handle('import:pickProject', async (_e, title?: unknown) => {
    if (!mainWindow || !getProject()) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      // the send flow borrows this picker with its own title (same peek validation either way)
      title: typeof title === 'string' && title ? title : 'Import clips — pick a Video Dancer project folder',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return peekProject(r.filePaths[0]) // null = no readable project.json in that folder
  })
  ipcMain.handle('import:clips', async (_e, dir: string, clipIds: string[]) => {
    if (!getProject() || !Array.isArray(clipIds) || clipIds.length === 0) return null
    return importClipsFrom(dir, clipIds)
  })

  // ----- send to project: push selected assets into another project on disk (reverse of import) -----
  ipcMain.handle('send:assets', async (_e, destDir: string, sel: import('@koan/vidancer-ui/shared/types').SendSelection) => {
    if (!getProject()) return { ok: false, error: 'no project open' }
    if (typeof destDir !== 'string' || !destDir || !sel || typeof sel !== 'object') return { ok: false, error: 'bad request' }
    return sendAssetsTo(destDir, sel)
  })

  // ----- organize: delete / duplicate / folders -----
  ipcMain.handle('clip:delete', async (_e, id: string) => deleteClip(id))
  ipcMain.handle('clips:delete', async (_e, ids: string[]) => deleteClips(ids))
  ipcMain.handle('clip:duplicate', async (_e, id: string) => duplicateClip(id))
  ipcMain.handle('clips:fromImages', async (_e, imageIds: string[], place?: { timelineId: string; index: number }) =>
    newClipsFromImages(imageIds, place)
  )
  ipcMain.handle('clip:fromImagesAsBeats', async (_e, imageIds: string[]) => newClipFromImagesAsBeats(imageIds))
  // ----- Sheet Gen (docs/SHEET-GEN-SPEC-2026-09-08.md) -----
  ipcMain.handle('sheet:clipNew', async (_e, imageId: string, mode: SheetMode) => newSheetClip(imageId, mode))
  ipcMain.handle('sheet:build', async (_e, clipId: string, takeId: string, pick?: number[]) => {
    beginMediaWrite() // pulled views + the sheet land in images/ like any import
    try {
      return await buildSheetFromTake(clipId, takeId, pick)
    } finally {
      endMediaWrite()
    }
  })
  ipcMain.handle('image:setSheet', async (_e, imageId: string, mode: SheetMode | null) => setImageSheet(imageId, mode))
  ipcMain.handle('image:delete', async (_e, id: string) => deleteImage(id))
  ipcMain.handle('images:delete', async (_e, ids: string[]) => deleteImages(ids))
  ipcMain.handle('image:cropSave', async (_e, req: { rootImageId: string; parentId: string | null; bytes: Uint8Array; label: string }) =>
    saveLocalEditNode(req)
  )
  ipcMain.handle('image:duplicate', async (_e, id: string) => duplicateImage(id))
  ipcMain.handle('image:rename', async (_e, id: string, title: string) => renameImage(id, title))
  ipcMain.handle('folder:add', async (_e, kind: import('@koan/vidancer-ui/shared/types').Folder['kind'], name: string, parent: string | null) => addFolder(kind, name, parent))
  ipcMain.handle('folder:rename', async (_e, id: string, name: string) => renameFolder(id, name))
  ipcMain.handle('folder:delete', async (_e, id: string) => deleteFolder(id))
  ipcMain.handle('folder:move', async (_e, id: string, parent: string | null) => moveFolder(id, parent))
  ipcMain.handle('item:move', async (_e, kind: import('@koan/vidancer-ui/shared/types').Folder['kind'], itemId: string | string[], folderId: string | null) => moveToFolder(kind, itemId, folderId))

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
      // TRUST GUARD before anything else: an unknown engine id must never fall back to fal
      const stale = unknownEngineError(req.engine)
      if (stale) return { ok: false, error: stale }
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
      if (provider === 'venice' && !s.veniceKey) return { ok: false, error: NO_VENICE_KEY }
      if (provider === 'mcp') {
        const svc = modelFor(req.engine).mcpService ?? 'higgsfield'
        const ready =
          svc === 'bridge'
            ? (['higgsfield', 'runway', 'magnific', 'pika', 'venice'] as const).some((s) => bridge.bridgeReady(s))
            : bridge.bridgeReady(svc)
        if (!ready)
          return { ok: false, error: svc === 'bridge' ? 'No Bridge account is logged in — log in on the Bridge panel first.' : `Not logged in to ${svc} — log in on the Bridge panel first.` }
      }

      let proj = getProject()
      if (!proj) proj = await newProject(app.getPath('documents'), 'Untitled') // auto-create so a first render still works
      const renderOwner = captureProjectSession()

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
      assertProjectSession(renderOwner)
      // Resolve the current primary once, before any supplier sees the request.
      req = { ...req, ...resolveRenderImages(proj, req) }

      // crash-recovery bookkeeping: the entry lands the moment the provider accepts, and is
      // retired ONLY on a clean landing (see below). Anything left = money possibly in flight.
      const projDirAtStart = proj.dir
      let pendingReqId: string | null = null
        const common = {
          ...req,
          videos: videoFiles,
          audios: audioFiles,
          outDir: join(proj.dir, 'renders'),
          onProgress: (m: string) => safeSend(e.sender, 'render:progress', { msg: m }),
          onRequestId: (requestId: string, endpoint: string) => {
            pendingReqId = requestId
            const { jobId: _jobId, ...rest } = req
            observePendingWrite(projDirAtStart, addPendingRender(projDirAtStart, { requestId, endpoint, provider, jobId: req.jobId, createdAt: Date.now(), req: rest as PendingReq }))
          }
        }
        const rendered =
          provider === 'local'
            ? // the score:render local shape: no key, NO pending entry (nothing billed — a dead
              // app killed the worker; nothing to recover), engine routed by provider.
              // withGpu (bible 12.4): queued local jobs WAIT for the engine in line — the
              // "one local render at a time" throw was reaching queued jobs (his catch 2026-09-01)
              await (async () => {
                safeSend(e.sender, 'render:progress', { jobId: req.jobId, msg: 'waiting for the local engine…' })
                // pct = REAL engine progress (the sampler's own step counter, bible 12.5/12.6);
                // jobId = THIS row's note (2026-09-23: three Render-now rows all wore one clock)
                const onProgress = (m: string, pct?: number): void => safeSend(e.sender, 'render:progress', { jobId: req.jobId, msg: m, pct })
                return runtime.withGpu(() =>
                  req.engine === 'h3local'
                    ? // MiniMax H3 (MINIMAX-H3-LOCAL-SPEC §6) — the same engine, its own graph; refs
                      // (pictures + videos + voices) already resolved to files above
                      h3Local.renderH3Clip({
                        jobId: req.jobId,
                        prompt: req.prompt,
                        images: req.images,
                        videos: videoFiles,
                        audios: audioFiles,
                        duration: req.duration,
                        resolution: req.resolution,
                        aspectRatio: req.aspectRatio,
                        seed: req.seed,
                        loras: req.loras,
                        sizeId: req.ltxSize,
                        encoderId: req.h3Encoder,
                        upscale: req.h3Upscale,
                        upscaleBy: req.h3UpscaleBy,
                        kernels: req.h3Kernels,
                        set: req.h3Set,
                        outDir: join(proj.dir, 'renders'),
                        onProgress
                      })
                    : ltxLocal.renderLtxClip({
                        jobId: req.jobId,
                        mode: req.mode,
                        prompt: req.prompt,
                        images: req.images,
                        duration: req.duration,
                        resolution: req.resolution,
                        aspectRatio: req.aspectRatio,
                        generateAudio: req.generateAudio,
                        seed: req.seed,
                        negative: req.negative,
                        loras: req.loras,
                        sizeId: req.ltxSize,
                        outDir: join(proj.dir, 'renders'),
                        onProgress
                      })
                )
              })()
            : provider === 'mcp'
            ? // Bridge lane (BRIDGE-SPEC-2026-09-01) — OAuth login pays, no key anywhere;
              // the engine's mcpService picks the adapter ('bridge' = the auto router)
              modelFor(req.engine).mcpService === 'runway'
              ? await runRunwayMcpRender({ ...common })
              : modelFor(req.engine).mcpService === 'magnific'
              ? await runMagnificMcpRender({ ...common })
              : modelFor(req.engine).mcpService === 'pika'
              ? await runPikaMcpRender({ ...common })
              : modelFor(req.engine).mcpService === 'bridge'
              ? await runBridgeAutoRender({ ...common })
              : await runHfMcpRender({ ...common })
            : provider === 'higgsfield'
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
                : provider === 'venice'
                  ? await runVeniceRender({ ...common, ...veniceLane(req.engine, req.mode, req.images.length + videoFiles.length + audioFiles.length > 0), veniceKey: s.veniceKey as string })
                  : await runRender({ ...common, endUserId: installId, falKey: falKey as string })
      const takePath = rendered.file

      // the render takes minutes — if the user opened a DIFFERENT project meanwhile, registering
      // the take would write project A's file path into project B (and media:// would 403 it).
      // The pending entry STAYS: the next open of the original project recovers this as a take
      // automatically. `billed: true` tells the renderer to record the spend it paid for.
      if (getProject()?.dir !== proj.dir) {
        return { ok: false, billed: true, error: `project changed during render — the video is saved and will be added automatically next time you open "${proj.name}".` }
      }

      // copy source images into the project library, collect ids (+ the imported entries for the delta)
      const importedImages: import('@koan/vidancer-ui/shared/types').ProjImage[] = []
      const imageIds: string[] = []
      for (const p of req.images) {
        const img = await importImage(p, renderOwner)
        imageIds.push(img.id)
        importedImages.push(img)
      }
      let endImageId: string | undefined
      if (req.mode === 'i2v' && req.endImage) {
        const img = await importImage(req.endImage, renderOwner)
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
        // snapshot honesty (bible 12.9): the take records the seed the engine picked and
        // the size that ACTUALLY ran — never just the request
        seed: (rendered as { seed?: number }).seed ?? req.seed,
        ltxSize: req.ltxSize,
        negative: req.negative,
        loras: req.loras, // frozen into the snapshot — the take tooltip's lora line reads THIS
        loraOn: req.loraOn,
        h3Encoder: req.h3Encoder,
        h3Upscale: req.h3Upscale,
        h3UpscaleBy: req.h3UpscaleBy,
        h3Kernels: req.h3Kernels,
        h3Set: req.h3Set,

        promptLink: req.promptLink,
        fieldLinks: req.fieldLinks,
        fieldOverrides: req.fieldOverrides,
        characterLinks: req.characterLinks
      }

      const localR = rendered as { sizeId?: string; engineFile?: string }
      assertProjectSession(renderOwner)
      const { delta, clipId, takeId } = await addTake({
        requestId: pendingReqId ?? undefined,
        clipId: req.clipId,
        name: req.name || `clip ${proj.clips.length + 1}`,
        promptData,
        takeFile: takePath,
        durationSec: rendered.durationSec,
        localVariant: localR.sizeId,
        ltxFile: localR.engineFile // engine-confirmed transformer file
      })
      if (importedImages.length) delta.images = importedImages
      assertProjectSession(renderOwner)

      // LANDED — only now is the recovery entry retired. On ANY error path the entry is KEPT:
      // a transient local failure (network blip mid-poll, download hiccup, addTake throw) does
      // not un-spend the money, the job may still be completing upstream, and the next open's
      // resume pass settles it definitively (fetch*Result returns 'gone' for truly dead jobs,
      // which removes the entry then). Removing here on every exit was the double-spend bug:
      // the user re-rendered what recovery would have delivered for free.
      if (pendingReqId) await removePendingRender(projDirAtStart, { requestId: pendingReqId })
      // the renderer plays the fresh take by streaming media://<takePath> — shipping the whole
      // mp4 over IPC (structured-cloning 50-200MB) is exactly what the media protocol exists to avoid
      return { ok: true, delta, clipId, takeId, file: takePath, costUsd: (rendered as { costUsd?: number }).costUsd }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      endMediaWrite()
    }
  })

  // best-effort remote cancel of an in-flight queue job (platforms bill completed work regardless)
  ipcMain.handle('render:cancel', async (_e, jobId: string) => {
    // local render first — /interrupt on the LTX worker; the poll loop surfaces the stop
    if (await ltxLocal.cancelLtxRender(jobId)) return true
    if (cancelScoreJob(jobId)) return true
    if (cancelVoiceJob(jobId)) return true
    let ok = await cancelFalJob(jobId)
    if (!ok) {
      const s = await loadSettings()
      if (s.hfKey) ok = await cancelHfJob(jobId, s.hfKey)
      if (!ok && s.arkKey) ok = await cancelArkJob(jobId, s.arkKey)
      if (!ok && s.astriaKey) ok = await cancelAstriaJob(jobId) // stops OUR wait — Astria has no remote cancel
      if (!ok && s.veniceKey) ok = await cancelVeniceJob(jobId) // the same: Venice has no cancel door
    }
    // retire the recovery entry ONLY when the remote cancel actually landed — a job that
    // refused the cancel is still running and still billing; its entry must survive so the
    // finished render is recovered next open instead of silently lost
    const p = getProject()
    if (ok && p) {
      void removePendingRender(p.dir, { jobId })
      void removePendingScore(p.dir, { jobId })
    }
    return ok
  })
  // Settings: cheap key validations (authenticated no-ops — never spend credits/tokens).
  // A masked field value means "test the SAVED key" — substitute it main-side.
  ipcMain.handle('hf:validate', async (_e, key: string) => validateHfKey(await realKeyFor('hfKey', String(key ?? ''))))
  ipcMain.handle('google:validate', async (_e, key: string) => validateGoogleKey(await realKeyFor('googleKey', String(key ?? ''))))
  ipcMain.handle('eleven:validate', async (_e, key: string) => validateElevenKey(await realKeyFor('elevenKey', String(key ?? ''))))
  // ---- MOODS (MOODS-VMD-SPEC-2026-09-08): the .vmd library in userData/moods ----
  ipcMain.handle('mood:list', () => listMoods())
  ipcMain.handle('mood:read', (_e, slug: string) => readMood(String(slug)))
  ipcMain.handle('mood:save', (_e, input: Parameters<typeof saveMood>[0]) => saveMood(input))
  ipcMain.handle('mood:delete', (_e, slug: string) => deleteMood(String(slug)))
  ipcMain.handle('mood:reveal', (_e, slug: string) => revealMood(String(slug)))
  ipcMain.handle('mood:importPaths', (_e, paths: string[]) => importMoodPaths((paths ?? []).map(String)))
  ipcMain.handle('mood:import', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? mainWindow!, {
      title: 'Add a MOOD',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'MOOD / skill', extensions: ['vmd', 'md', 'zip', 'skill'] }]
    })
    if (r.canceled || !r.filePaths.length) return { slugs: [], errors: [], skills: [] }
    return importMoodPaths(r.filePaths)
  })
  ipcMain.handle('mood:export', async (e, slug: string) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) ?? mainWindow!, { title: 'Export MOOD', defaultPath: `${String(slug)}.vmd`, filters: [{ name: 'MOOD', extensions: ['vmd'] }] })
    if (r.canceled || !r.filePath) return false
    return exportMood(String(slug), r.filePath)
  })
  ipcMain.handle('codir:setMoodsPinned', (_e, slugs: string[]) => codirSetMoodsPinned((slugs ?? []).map(String)))
  // ---- ASSEMBLY (ASSEMBLY-SPEC-2026-09-09): concept → correct → lock → assemble (a NEW timeline) ----
  const assemblyOpts = async (e: IpcMainInvokeEvent): Promise<import('./assembly').AssemblyOpts | { error: string }> => {
    const s = await loadSettings()
    const lane = claudeLane(s)
    const engine = lane.engine
    if (engine === 'api' && !lane.apiKey) return { error: lane.noKey }
    const synthModel = lane.model
    const bridge = engine === 'bridge' ? (prompt: string) => bridgeOneShot({ prompt, model: synthModel }) : undefined
    return {
      engine,
      apiKey: lane.apiKey,
      bridgeModel: synthModel,
      synthModel,
      watch: { googleKey: s.googleKey, googleModel: s.googleWatchModel, anthropicKey: engine === 'api' ? lane.apiKey : undefined, model: synthModel, bridge },
      onProgress: (m: string) => safeSend(e.sender, 'render:progress', { msg: m })
    }
  }
  ipcMain.handle('assembly:concept', async (e: IpcMainInvokeEvent, correction?: string) => {
    const o = await assemblyOpts(e)
    if ('error' in o) return { ok: false, error: o.error }
    return assemblyConcept(typeof correction === 'string' ? correction : undefined, o)
  })
  ipcMain.handle('assembly:lock', async (_e, locked: boolean) => setAssembly({ locked: !!locked }))
  ipcMain.handle('assembly:assemble', async (e: IpcMainInvokeEvent) => {
    const o = await assemblyOpts(e)
    if ('error' in o) return { ok: false, error: o.error }
    return assemblyAssemble(o)
  })
  ipcMain.handle('ark:validate', async (_e, key: string) => validateArkKey(await realKeyFor('arkKey', String(key ?? ''))))
  ipcMain.handle('astria:validate', async (_e, key: string) => validateAstriaKey(await realKeyFor('astriaKey', String(key ?? ''))))
  ipcMain.handle('venice:validate', async (_e, key: string) => validateVeniceKey(await realKeyFor('veniceKey', String(key ?? ''))))

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
  ipcMain.handle('edit:createClip', async (_e, req: Omit<import('@koan/vidancer-ui/shared/types').EditArgs, 'jobId' | 'clipId'>) => {
    const proj = getProject()
    if (!proj) return null
    const srcClip = proj.clips.find((c) => c.id === req.source.clipId)
    const srcTake = srcClip?.takes.find((t) => t.id === req.source.takeId)
    if (!srcClip || !srcTake) return null
    const inS = req.source.inSec
    const outS = req.source.outSec
    // the clip is born with the COMPLETE recipe (engine, options, refs) — a crash between the
    // fork and the first render loses nothing re-runnable
    const promptData: import('./project').PromptData = {
      ...emptyPromptData(),
      engine: req.engine ?? 'omniflash',
      mode: 'v2v',
      freeform: req.prompt,
      resolution: req.resolution ?? '720p',
      aspectRatio: req.aspectRatio ?? 'auto',
      duration: req.duration ?? String(Math.max(1, Math.round(inS != null && outS != null ? outS - inS : srcTake.durationSec ?? 8))),
      ...(req.generateAudio != null ? { generateAudio: req.generateAudio } : {}),
      ...(req.imageRefIds?.length ? { imageIds: req.imageRefIds } : {}),
      ...(req.videoRefs?.length ? { videoRefs: req.videoRefs } : {}),
      ...(req.audioRefs?.length ? { audioRefs: req.audioRefs } : {}),
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
  ipcMain.handle('edit:run', async (e: IpcMainInvokeEvent, req: import('@koan/vidancer-ui/shared/types').EditArgs) => {
    beginMediaWrite() // the edited mp4 hits renders/ before addTake references it
    let tmp: string | null = null
    try {
      const s = await loadSettings() // key checks are per-provider inside runV2vEngine
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
        safeSend(e.sender, 'edit:progress', 'cutting source window…')
        tmp = join(app.getPath('temp'), `vd_edit_src_${Date.now()}.mp4`)
        await cutSegment(srcAbs, inS, outS, tmp)
        videoPath = tmp
      }

      const rendered = await runV2vEngine(
        proj,
        s,
        {
          jobId: req.jobId,
          engine: req.engine ?? 'omniflash',
          prompt: req.prompt,
          sendFile: videoPath,
          cacheKey,
          imageRefIds: req.imageRefIds,
          videoRefs: req.videoRefs,
          audioRefs: req.audioRefs,
          duration: req.duration,
          resolution: req.resolution,
          aspectRatio: req.aspectRatio,
          generateAudio: req.generateAudio,
          outDir: join(proj.dir, 'renders')
        },
        (m) => safeSend(e.sender, 'edit:progress', m)
      )
      if ('error' in rendered) return { ok: false, error: rendered.error }

      // edits take a while — same project-switch guard as render:run
      if (getProject()?.dir !== proj.dir) {
        return { ok: false, error: `project changed during edit — the video was saved to ${rendered.file} but not added.` }
      }

      const promptData: import('./project').PromptData = {
        ...emptyPromptData(),
        engine: req.engine ?? 'omniflash',
        mode: 'v2v',
        freeform: req.prompt,
        resolution: req.resolution ?? '720p',
        aspectRatio: req.aspectRatio ?? 'auto',
        duration: String(Math.max(1, Math.round(rendered.durationSec ?? (windowed ? outS! - inS! : srcTake?.durationSec ?? 8)))),
        ...(req.generateAudio != null ? { generateAudio: req.generateAudio } : {}),
        ...(req.imageRefIds?.length ? { imageIds: req.imageRefIds } : {}),
        ...(req.videoRefs?.length ? { videoRefs: req.videoRefs } : {}),
        ...(req.audioRefs?.length ? { audioRefs: req.audioRefs } : {}),
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
// EXTERNAL EDITS (UI-ROUND-SPEC-2026-09-19 §2.1): on window focus (and once after a project opens)
// ask the ledger what was saved outside; the renderer owns the question "a new edit was made, want
// to import it?". `asking` keeps one save from being asked twice while its dialog is still up.
const askingEdits = new Set<string>()
async function checkExternalEdits(): Promise<void> {
  const p = getProject()
  if (!p || !mainWindow || mainWindow.isDestroyed()) return
  try {
    const fresh = (await editors.pendingEdits(p.dir)).filter((e) => !askingEdits.has(`${e.file}|${e.mtime}`))
    if (!fresh.length) return
    for (const e of fresh) askingEdits.add(`${e.file}|${e.mtime}`)
    safeSend(mainWindow.webContents, 'editors:pending', fresh)
  } catch (err) {
    console.error('[editors] check failed:', err instanceof Error ? err.message : err)
  }
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

// ---- THUMB CACHE: tiles ask media://…?t=1 for a small copy of an image instead of decoding
// the original per tile (a many-megapixel PNG in a 72px box = the image-heavy-project lag).
// One 320px PNG per image CONTENT — the path+mtime+size key auto-invalidates re-extracted
// stills — cached in userData so project cleanup/duplicate flows never see it. Small images
// and any failure return null → the original streams, tiles never break. The in-flight map
// de-dupes a grid of tiles requesting the same image at once (and dodges rename races).
const THUMB_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const thumbInFlight = new Map<string, Promise<string | null>>()
async function ensureThumb(p: string): Promise<string | null> {
  const inflight = thumbInFlight.get(p)
  if (inflight) return inflight
  const job = (async (): Promise<string | null> => {
    try {
      const st = await stat(p)
      const key = createHash('md5').update(`${p}|${st.mtimeMs}|${st.size}`).digest('hex').slice(0, 16)
      const out = join(app.getPath('userData'), 'thumbs', `${key}.png`)
      if (existsSync(out)) return out
      const img = nativeImage.createFromPath(p)
      if (img.isEmpty() || img.getSize().width <= 320) return null // tiny already — just stream it
      const png = img.resize({ width: 320 }).toPNG()
      await mkdir(dirname(out), { recursive: true })
      const tmp = `${out}.part-${randomUUID().slice(0, 8)}`
      await writeFile(tmp, png)
      try {
        await rename(tmp, out)
      } catch {
        await unlink(tmp).catch(() => undefined) // raced: another writer landed first — use theirs
      }
      return existsSync(out) ? out : null
    } catch {
      return null
    }
  })().finally(() => thumbInFlight.delete(p))
  thumbInFlight.set(p, job)
  return job
}

initLogging() // before anything else so early failures are captured

// SharedArrayBuffer for the ONNX worker threads: the renderer is not cross-origin isolated
// (media:// + file:// loads make full COI impractical), and single-thread fp32 inference was
// seconds-per-frame — the "first AI pass looks hung" experience. Electron lets a trusted app
// opt in via the feature switch; the worker gates on SAB availability, not the COI flag.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

// two app instances holding one project = each save silently overwrites the other's whole
// project.json (last-writer-wins data loss) — the second instance defers to the first
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// quit must not cut an in-flight project write — the atomic rename means a cut write only loses
// the LAST action, but losing even that is a lie to the user who saw their edit land
let quitSavesFlushed = false
let quitSavePending = false
app.on('before-quit', (e) => {
  if (quitSavesFlushed) return
  e.preventDefault()
  if (quitSavePending) return
  quitSavePending = true
  cancelExport() // never leave a headless ffmpeg writing after the app is gone
  cancelTimelineWatch()
  void fx.abortAllJobs()
  void modelStore.abortAll() // kill download streams, sweep .part files
  runtime.killAllWorkers() // no orphaned python holding VRAM after the app is gone
  void pendingSaves().catch(() => saveProject()).then(() => {
    quitSavesFlushed = true
    app.quit()
  }).catch(() => {
    quitSavePending = false
    mainWindow?.show()
  })
})

// PLATFORM HARDENING, app-wide (covers the main window, the mirror, and any future window):
// popups get denied (window.open would otherwise spawn a preload-armed window free to load
// remote content with the full vidancer API) and navigation away from the app is blocked
// (Chromium's default for a stray file drop is to NAVIGATE to the file)
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return // dev-server reloads stay allowed
    if (url.startsWith('file://')) {
      // packaged loads land here once via loadFile — allow our own bundle, block everything else
      const own = pathToFileURL(join(__dirname, '../renderer')).href
      if (url.startsWith(own)) return
    }
    e.preventDefault()
  })
})

app.whenReady().then(() => {
  // GPU discipline rule 2: reap anything a hard-killed previous session left running from our
  // runtime — an orphaned worker once squatted on 13GB of VRAM and OOM'd every render after
  void runtime.reapOrphans()
  // the picked LoRA folders become engine lora roots (KREA2-LOCAL-SPEC §5.2) — set before any worker spawns
  void loadSettings().then((s) => setExtraLoraDirs((s.loraFolders as string[] | undefined) ?? []))
  // the Bridge interpreter answers provider questions on the Co-Director's Claude lanes (spec §3.5)
  setInterpreterLane(async () => claudeLane(await loadSettings()))
  // the Bridge dialog streams to the Queue's watermark layer (main.log carries the full lines)
  bridge.setBridgeDialog((line) => BrowserWindow.getAllWindows().forEach((w) => safeSend(w.webContents, 'bridge:dialog', line)))
  // BRIDGE logins reconnect lazily; tokens ride the settings secret lane (encrypted at rest)
  void bridge.initBridge(
    {
      load: async () => (await loadSettings()).bridgeAuth as string | undefined,
      save: async (json) => {
        await patchSettings({ bridgeAuth: json })
      },
      key: async (id) => (id === 'venice' ? (await loadSettings()).veniceKey : undefined)
    },
    () => BrowserWindow.getAllWindows().forEach((w) => safeSend(w.webContents, 'bridge:changed'))
  )
  onMoodsChanged(() => BrowserWindow.getAllWindows().forEach((w) => safeSend(w.webContents, 'moods:changed')))
  // warm the size cache off the first paint — the walks live here, never behind a card click
  // (the 10-second download/✕ lag, measured + fixed 2026-08-25)
  void Promise.all([runtime.runtimeRow(), runtime.listEnvs(), audioLocal.aceBytes(), audioLocal.mmBytes(), ltxLocal.ltxEngineBytes()]).catch(() => undefined)
  // media://x/<encodeURIComponent(absPath)> → streams the file WITH HTTP Range support, so <video>
  // is seekable (scrub frame-by-frame) and canvas use stays untainted (CORS header — acceptable
  // because the handler refuses every path outside the open project's folder).
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const p0 = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!mediaAllowed(p0)) return new Response('forbidden', { status: 403 })
      // ?t=1 — a tile wants the small cached copy, not a full-size decode per 72px box
      const p = url.searchParams.get('t') === '1' && THUMB_EXT.has(extname(p0).toLowerCase()) ? ((await ensureThumb(p0)) ?? p0) : p0
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
  // prune stale v2v cache cuts from the OS temp dir — Windows never cleans %TEMP%, and the
  // deterministic vd-* names accumulate re-encoded video windows forever
  void (async () => {
    try {
      const tmp = app.getPath('temp')
      const now = Date.now()
      for (const nm of await readdir(tmp)) {
        if (!/^vd[-_]/.test(nm)) continue
        try {
          const f = join(tmp, nm)
          const st = await stat(f)
          if (st.isFile() && now - st.mtimeMs > 7 * 24 * 3600 * 1000) await unlink(f)
        } catch {
          /* locked or raced — next boot gets it */
        }
      }
    } catch {
      /* temp unreadable — nothing to prune */
    }
  })()
  // thumb cache: stale-key versions (re-extracted stills) accumulate — prune 60+ day old files
  void (async () => {
    try {
      const tdir = join(app.getPath('userData'), 'thumbs')
      const now = Date.now()
      for (const nm of await readdir(tdir)) {
        try {
          const f = join(tdir, nm)
          const st = await stat(f)
          if (st.isFile() && now - st.mtimeMs > 60 * 24 * 3600 * 1000) await unlink(f)
        } catch {
          /* locked or raced — next boot gets it */
        }
      }
    } catch {
      /* no thumbs yet */
    }
  })()
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
