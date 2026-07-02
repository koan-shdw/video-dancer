import { create } from 'zustand'
import { clearStrips } from './lib/filmstrip'
import { activeItems } from './lib/timelineUtils'
import { toast } from './ui/Toast'
import { normalizeImageTitle } from '../../shared/types'

// Merge a mutation delta into our project copy. Only the touched slices get new object
// identities — untouched slices keep theirs, so subscribers selecting e.g. `project.timeline`
// don't re-render when a clip edit lands. (This replaced the old whole-project-replace pattern.)
function mergeDelta(p: Project, d: ProjectDelta): Project {
  const next = { ...p }
  if (d.clips?.length) {
    const byId = new Map(d.clips.map((c) => [c.id, c]))
    next.clips = next.clips.map((c) => byId.get(c.id) ?? c)
    const fresh = d.clips.filter((c) => !p.clips.some((x) => x.id === c.id))
    if (fresh.length) next.clips = [...next.clips, ...fresh]
  }
  if (d.removedClipIds?.length) next.clips = next.clips.filter((c) => !d.removedClipIds!.includes(c.id))
  if (d.images?.length) {
    const byId = new Map(d.images.map((i) => [i.id, i]))
    next.images = next.images.map((i) => byId.get(i.id) ?? i)
    const fresh = d.images.filter((i) => !p.images.some((x) => x.id === i.id))
    if (fresh.length) next.images = [...next.images, ...fresh]
  }
  if (d.removedImageIds?.length) next.images = next.images.filter((i) => !d.removedImageIds!.includes(i.id))
  if (d.audio?.length) {
    const byId = new Map(d.audio.map((a) => [a.id, a]))
    next.audio = next.audio.map((a) => byId.get(a.id) ?? a)
    const fresh = d.audio.filter((a) => !p.audio.some((x) => x.id === a.id))
    if (fresh.length) next.audio = [...next.audio, ...fresh]
  }
  if (d.removedAudioIds?.length) next.audio = next.audio.filter((a) => !d.removedAudioIds!.includes(a.id))
  if (d.timelines?.length) {
    const byId = new Map(d.timelines.map((t) => [t.id, t]))
    next.timelines = next.timelines.map((t) => byId.get(t.id) ?? t)
    const fresh = d.timelines.filter((t) => !p.timelines.some((x) => x.id === t.id))
    if (fresh.length) next.timelines = [...next.timelines, ...fresh]
  }
  if (d.removedTimelineIds?.length) next.timelines = next.timelines.filter((t) => !d.removedTimelineIds!.includes(t.id))
  if (d.activeTimelineId) next.activeTimelineId = d.activeTimelineId
  if (d.folders) next.folders = d.folders
  if (d.editSessions?.length) {
    const byId = new Map(d.editSessions.map((s) => [s.id, s]))
    next.editSessions = next.editSessions.map((s) => byId.get(s.id) ?? s)
    const fresh = d.editSessions.filter((s) => !p.editSessions.some((x) => x.id === s.id))
    if (fresh.length) next.editSessions = [...next.editSessions, ...fresh]
  }
  return next
}

interface StoreState {
  project: Project | null
  selectedClipId: string | null
  selectedTlItemId: string | null // the timeline block selected by click (Del removes it)
  editTimelineIndex: number | null // when set, the editor is editing this timeline slot (take = per-slot)
  // timeline playback
  tlPlaying: boolean
  tlIndex: number
  tlProgress: number // 0..1 within the current clip
  tlLoop: boolean
  seekOffset: number // seconds to start the current item at (0 normally; >0 after a scrub)
  seekTick: number // bump to make the Monitor (re)apply seekOffset
  falCredit: { balance?: number; currency?: string; error?: string; loading: boolean }
  showFilmstrips: boolean // timeline filmstrip thumbnails on/off (perf toggle)
  snapPlayhead: boolean // slice/trim snap to the scrubber (persisted)
  snapBeats: boolean // slice/out-trim snap to music beat ticks (persisted)
  autoTime: boolean // beats auto-fit to clip duration (keeps each beat's % share)
  editorImageId: string | null // Library image open in the Image Editor ('' = from-scratch session)
  // what the Clip Edit (v2v) panel is working on: a bound edit clip, or a DRAFT (source take +
  // optional window) that only becomes a clip when its first generation succeeds
  editTarget: { clipId?: string; source?: { clipId: string; takeId: string; inSec?: number; outSec?: number } } | null
  // C picked in the Clip Editor for a BIN-selected clip (no timeline slot): the Clip Monitor shows
  // the live recipe view (thumb + beats) instead of the keeper take. Cleared on any target change.
  previewRecipe: boolean
  setPreviewRecipe: (b: boolean) => void
  // bumped on every successful image rename so open editors can rewrite @mentions in their LIVE form
  // text (the stored copy is already rewritten by main; this catches the editor's stale local copy)
  renameSignal: { from: string; to: string; n: number }
  // bumped when an image's FILE swaps under the same id (primary version change) — open editors
  // holding the old file path in live form state (refs/start/end) swap it so autosave can't drop the ref
  fileSwap: { from: string; to: string; n: number }
  setPrimaryNode: (sessionId: string, nodeId: string | null) => Promise<void>
  // bumped on undo/redo so the Clip Editor reloads its LIVE form from the restored project
  undoTick: number
  exportState: { busy: boolean; msg: string; file?: string } // timeline → mp4 progress (shown by Timeline + Timeline Editor)
  renderBusy: boolean // a fal render is in flight (Clip Editor tab badge)
  setRenderBusy: (b: boolean) => void

  setProject: (p: Project | null) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  applyDelta: (d: ProjectDelta | null | undefined) => void
  refreshCredit: () => Promise<void>
  toggleFilmstrips: () => void
  setShowFilmstrips: (b: boolean) => void
  toggleSnapPlayhead: () => void
  toggleSnapBeats: () => void
  setSnapPrefs: (p: { snapPlayhead?: boolean; snapBeats?: boolean }) => void
  toggleAutoTime: () => void
  selectClip: (id: string | null) => void
  selectTlItem: (id: string | null) => void
  deleteSelectedTlItem: () => Promise<void>
  editTimelineSlot: (index: number, clipId: string) => void
  newProject: () => Promise<void>
  openProject: () => Promise<void>
  refresh: () => Promise<void>
  openLast: () => Promise<void>
  openPath: (dir: string) => Promise<void>
  importToLibrary: () => Promise<string[]>
  importPaths: (paths: string[]) => Promise<string[]>
  importAudio: () => Promise<void>
  importAudioPaths: (paths: string[]) => Promise<void>
  renameAudio: (id: string, title: string) => Promise<void>
  reportAudioDuration: (id: string, dur: number) => void
  deleteAudio: (id: string) => Promise<void>
  setTimelineMusic: (timelineId: string, music: TimelineMusic | null) => Promise<void>
  setTimelineMutes: (timelineId: string, mutes: { videoMuted?: boolean; musicMuted?: boolean }) => Promise<void>
  setTimelineExportPrefs: (timelineId: string, prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30' }) => Promise<void>
  setExportMsg: (msg: string) => void
  startExport: (timelineId: string) => Promise<void>
  saveFrame: (bytes: Uint8Array, note: string) => Promise<string | null> // → new Library image id
  renameClip: (id: string, name: string) => Promise<void>
  createClip: () => Promise<string | null>
  saveClipPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<void>
  deleteClip: (id: string) => Promise<void>
  duplicateClip: (id: string) => Promise<void>
  deleteImage: (id: string) => Promise<void>
  duplicateImage: (id: string) => Promise<void>
  renameImage: (id: string, title: string) => Promise<boolean> // false = @title already taken (rename refused)
  addFolder: (kind: 'bin' | 'lib', name: string, parent: string | null) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  moveItem: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => Promise<void>

  addToTimeline: (clipId: string, takeId?: string) => Promise<void>
  removeFromTimeline: (itemId: string) => Promise<void>
  cloneTakeToClip: (clipId: string, takeId: string) => Promise<void>
  setKeeper: (clipId: string, takeId: string) => Promise<void>
  reportTakeDuration: (clipId: string, takeId: string, durationSec: number) => void
  setTimelineItems: (items: TimelineItem[], tlId?: string) => Promise<void> // tlId = target captured at op start (default: active)
  sliceItem: (itemId: string, cutSec: number) => Promise<void>
  addTimeline: () => Promise<void>
  renameTimeline: (id: string, name: string) => Promise<void>
  setTimelineAspect: (id: string, ar: string) => Promise<void>
  duplicateTimeline: (id: string) => Promise<void>
  deleteTimeline: (id: string) => Promise<void>
  selectTimeline: (id: string) => Promise<void>
  setEditorImage: (id: string | null) => void
  setEditTarget: (t: { clipId?: string; source?: { clipId: string; takeId: string; inSec?: number; outSec?: number } } | null) => void
  tagEditNode: (sessionId: string, nodeId: string) => Promise<string | null>
  deleteEditBranch: (sessionId: string, nodeId: string) => Promise<void>
  tlPlay: () => void
  tlPause: () => void
  tlSetIndex: (i: number) => void
  tlSetProgress: (p: number) => void
  toggleLoop: () => void
  tlNext: (from?: number) => void // from = the slot the caller was playing; a stale advance no-ops
  seek: (index: number, offset: number, progress: number) => void
}

const resetPlayback = { tlPlaying: false, tlIndex: 0, tlProgress: 0, seekOffset: 0, seekTick: 0, editTimelineIndex: null }

// undo/redo replace the WHOLE project — keep selection/playback indices valid and nudge the Clip
// Editor (via undoTick) to reload its live form from the restored state
function restorePatch(s: StoreState, p: Project): Partial<StoreState> {
  const patch: Partial<StoreState> = { project: p, undoTick: s.undoTick + 1 }
  if (s.selectedClipId && !p.clips.some((c) => c.id === s.selectedClipId)) patch.selectedClipId = null
  if (s.editorImageId && !p.images.some((i) => i.id === s.editorImageId)) patch.editorImageId = null
  const items = activeItems(p)
  if (s.tlIndex >= items.length) patch.tlIndex = Math.max(0, items.length - 1)
  if (s.editTimelineIndex != null && s.editTimelineIndex >= items.length) patch.editTimelineIndex = null
  if (s.selectedTlItemId && !items.some((it) => it.id === s.selectedTlItemId)) patch.selectedTlItemId = null
  return patch
}

export const useStore = create<StoreState>((set, get) => ({
  project: null,
  selectedClipId: null,
  selectedTlItemId: null,
  editTimelineIndex: null,
  tlPlaying: false,
  tlIndex: 0,
  tlProgress: 0,
  tlLoop: true,
  seekOffset: 0,
  seekTick: 0,
  falCredit: { loading: false },
  showFilmstrips: true,
  snapPlayhead: true,
  snapBeats: true,
  autoTime: true,
  editorImageId: null,
  editTarget: null,
  previewRecipe: false,
  setPreviewRecipe: (b) => set({ previewRecipe: b }),
  renameSignal: { from: '', to: '', n: 0 },
  fileSwap: { from: '', to: '', n: 0 },
  setPrimaryNode: async (sessionId, nodeId) => {
    const s = get().project?.editSessions.find((x) => x.id === sessionId)
    const img = s?.rootImageId ? get().project?.images.find((i) => i.id === s.rootImageId) : undefined
    const from = img?.file
    const d = await window.vidancer.imageSetPrimary(sessionId, nodeId)
    if (!d) return
    get().applyDelta(d)
    const to = d.images?.[0]?.file
    if (from && to && from !== to) set((st) => ({ fileSwap: { from, to, n: st.fileSwap.n + 1 } }))
  },
  undoTick: 0,
  exportState: { busy: false, msg: '' },
  renderBusy: false,
  setRenderBusy: (b) => set({ renderBusy: b }),

  setProject: (p) => set({ project: p }),
  undo: async () => {
    const p = await window.vidancer.projectUndo()
    if (p) {
      set((s) => restorePatch(s, p))
      toast('undone')
    } else toast('nothing to undo')
  },
  redo: async () => {
    const p = await window.vidancer.projectRedo()
    if (p) {
      set((s) => restorePatch(s, p))
      toast('redone')
    } else toast('nothing to redo')
  },
  // merge an IPC mutation result + keep the selection/playback indices honest when the active
  // timeline's items changed (or the active timeline itself switched)
  applyDelta: (d) =>
    set((s) => {
      if (!s.project || !d) return {}
      const oldActiveId = s.project.activeTimelineId
      const oldItems = activeItems(s.project)
      const project = mergeDelta(s.project, d)
      const patch: Partial<StoreState> = { project }
      if (project.activeTimelineId !== oldActiveId) {
        // switched to a different timeline → playback/selection restart from the top
        Object.assign(patch, { tlPlaying: false, tlIndex: 0, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1, editTimelineIndex: null, selectedTlItemId: null })
      } else {
        const newItems = activeItems(project)
        if (newItems !== oldItems) {
          // a selected block that no longer exists can't stay selected (Del would hit the wrong thing)
          if (s.selectedTlItemId && !newItems.some((it) => it.id === s.selectedTlItemId)) patch.selectedTlItemId = null
          // the edited slot must keep pointing at the SAME item (matched by id) — or null out if it's gone.
          // (was a real bug: delete a timeline item while editing it → edits landed on the wrong slot)
          if (s.editTimelineIndex != null) {
            const editedId = oldItems[s.editTimelineIndex]?.id
            const ni = editedId ? newItems.findIndex((it) => it.id === editedId) : -1
            patch.editTimelineIndex = ni >= 0 ? ni : null
          }
          // playback index can't point past the end of a shrunken timeline
          if (s.tlIndex >= newItems.length) patch.tlIndex = Math.max(0, newItems.length - 1)
        }
      }
      if (s.selectedClipId && d.removedClipIds?.includes(s.selectedClipId)) patch.selectedClipId = null
      if (s.editorImageId && d.removedImageIds?.includes(s.editorImageId)) patch.editorImageId = null
      return patch
    }),
  toggleFilmstrips: () =>
    set((s) => {
      const v = !s.showFilmstrips
      void window.vidancer.setSettings({ showFilmstrips: v })
      return { showFilmstrips: v }
    }),
  setShowFilmstrips: (b) => set({ showFilmstrips: b }),
  toggleSnapPlayhead: () =>
    set((s) => {
      const v = !s.snapPlayhead
      void window.vidancer.setSettings({ snapPlayhead: v })
      return { snapPlayhead: v }
    }),
  toggleSnapBeats: () =>
    set((s) => {
      const v = !s.snapBeats
      void window.vidancer.setSettings({ snapBeats: v })
      return { snapBeats: v }
    }),
  setSnapPrefs: (p) => set(p),
  toggleAutoTime: () => set((s) => ({ autoTime: !s.autoTime })),
  refreshCredit: async () => {
    set((s) => ({ falCredit: { ...s.falCredit, loading: true } }))
    try {
      const r = await window.vidancer.falCredit()
      set({
        falCredit: {
          loading: false,
          balance: r.ok ? r.balance : undefined,
          currency: r.ok ? r.currency : undefined,
          error: r.ok ? undefined : r.error
        }
      })
    } catch (e) {
      set({ falCredit: { loading: false, error: e instanceof Error ? e.message : String(e) } })
    }
  },
  selectClip: (id) => set({ selectedClipId: id, editTimelineIndex: null, previewRecipe: false }),
  selectTlItem: (id) => set({ selectedTlItemId: id }),
  // Del/Backspace: remove the selected block from the active timeline (undoable like any edit)
  deleteSelectedTlItem: async () => {
    const s = get()
    const id = s.selectedTlItemId
    if (!id) return
    const items = activeItems(s.project)
    if (!items.some((it) => it.id === id)) {
      set({ selectedTlItemId: null })
      return
    }
    set({ selectedTlItemId: null })
    await s.setTimelineItems(items.filter((it) => it.id !== id))
  },
  editTimelineSlot: (index, clipId) => set({ editTimelineIndex: index, selectedClipId: clipId, previewRecipe: false }),
  newProject: async () => {
    const p = await window.vidancer.projectNew()
    if (p) {
      clearStrips() // filmstrip cache belongs to the previous project's files
      set({ project: p, selectedClipId: null, ...resetPlayback })
    }
  },
  openProject: async () => {
    const p = await window.vidancer.projectOpen()
    if (p) {
      clearStrips()
      set({ project: p, selectedClipId: null, ...resetPlayback })
    }
  },
  refresh: async () => {
    const p = await window.vidancer.projectGet()
    set({ project: p })
  },
  openLast: async () => {
    const p = await window.vidancer.projectOpenLast()
    if (p) {
      clearStrips()
      set({ project: p, selectedClipId: null, ...resetPlayback })
    }
  },
  openPath: async (dir) => {
    const p = await window.vidancer.projectOpenPath(dir)
    if (p) {
      clearStrips()
      set({ project: p, selectedClipId: null, ...resetPlayback })
    } else toast('couldn’t open that project (moved or deleted?)', { kind: 'error' })
  },
  importToLibrary: async () => {
    const r = await window.vidancer.libraryImport()
    if (r?.delta) get().applyDelta(r.delta)
    const n = r?.importedIds.length ?? 0
    if (n > 0) toast(`${n} image${n === 1 ? '' : 's'} imported`, { kind: 'ok' })
    return r?.importedIds ?? []
  },
  importPaths: async (paths) => {
    const r = await window.vidancer.libraryImportPaths(paths)
    if (r?.delta) get().applyDelta(r.delta)
    const n = r?.importedIds.length ?? 0
    if (n > 0) toast(`${n} image${n === 1 ? '' : 's'} imported`, { kind: 'ok' })
    return r?.importedIds ?? []
  },
  saveFrame: async (bytes, note) => {
    const r = await window.vidancer.librarySaveFrame(bytes, note)
    if (!r) return null
    get().applyDelta(r.delta)
    return r.imageId
  },
  importAudio: async () => {
    const r = await window.vidancer.audioImport()
    if (r?.delta) get().applyDelta(r.delta)
    const n = r?.importedIds.length ?? 0
    if (n > 0) toast(`${n} track${n === 1 ? '' : 's'} imported`, { kind: 'ok' })
  },
  importAudioPaths: async (paths) => {
    const r = await window.vidancer.audioImportPaths(paths)
    if (r?.delta) get().applyDelta(r.delta)
    const n = r?.importedIds.length ?? 0
    if (n > 0) toast(`${n} track${n === 1 ? '' : 's'} imported`, { kind: 'ok' })
  },
  renameAudio: async (id, title) => {
    get().applyDelta(await window.vidancer.audioRename(id, title))
  },
  // fire-and-forget: the lane/library learned a track's real length from <audio> metadata
  reportAudioDuration: (id, dur) => {
    const a = get().project?.audio.find((x) => x.id === id)
    if (!a || !(dur > 0) || Math.abs((a.durationSec ?? 0) - dur) < 0.05) return
    void window.vidancer.audioSetDuration(id, dur).then((d) => get().applyDelta(d))
  },
  deleteAudio: async (id) => {
    get().applyDelta(await window.vidancer.audioDelete(id))
  },
  setTimelineMusic: async (timelineId, music) => {
    get().applyDelta(await window.vidancer.timelineSetMusic(timelineId, music))
  },
  setTimelineMutes: async (timelineId, mutes) => {
    get().applyDelta(await window.vidancer.timelineSetMutes(timelineId, mutes))
  },
  setTimelineExportPrefs: async (timelineId, prefs) => {
    get().applyDelta(await window.vidancer.timelineSetExportPrefs(timelineId, prefs))
  },
  setExportMsg: (msg) => set((s) => ({ exportState: { ...s.exportState, msg } })),
  startExport: async (timelineId) => {
    if (get().exportState.busy) return
    set({ exportState: { busy: true, msg: 'export starting…' } })
    const r = await window.vidancer.exportRun(timelineId)
    if (r.ok) {
      set({ exportState: { busy: false, msg: 'export done ✓', file: r.file } })
      const f = r.file
      toast('export done ✓', { kind: 'ok', hint: 'click to show the file', onClick: f ? () => void window.vidancer.revealFile(f) : undefined })
    } else if (r.error === 'cancelled') {
      set({ exportState: { busy: false, msg: '' } })
    } else {
      set({ exportState: { busy: false, msg: `export error: ${r.error ?? 'unknown'}` } })
      toast(`export failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
    }
  },
  renameClip: async (id, name) => {
    get().applyDelta(await window.vidancer.clipRename(id, name))
  },
  createClip: async () => {
    const r = await window.vidancer.clipNew()
    if (!r) return null
    get().applyDelta(r.delta)
    set({ selectedClipId: r.clipId, editTimelineIndex: null })
    return r.clipId
  },
  saveClipPromptData: async (clipId, pd) => {
    get().applyDelta(await window.vidancer.clipSetPromptData(clipId, pd))
  },
  deleteClip: async (id) => {
    get().applyDelta(await window.vidancer.clipDelete(id))
  },
  duplicateClip: async (id) => {
    const r = await window.vidancer.clipDuplicate(id)
    if (!r) return
    get().applyDelta(r.delta)
    set({ selectedClipId: r.newClipId })
  },
  deleteImage: async (id) => {
    get().applyDelta(await window.vidancer.imageDelete(id))
  },
  duplicateImage: async (id) => {
    const r = await window.vidancer.imageDuplicate(id)
    if (r) get().applyDelta(r.delta)
  },
  renameImage: async (id, title) => {
    const img = get().project?.images.find((x) => x.id === id)
    if (!img) return false
    const to = normalizeImageTitle(title)
    if (!to) return false
    if (to === img.title) return true // no-op rename
    if (get().project?.images.some((x) => x.id !== id && x.title === to)) return false // taken
    const from = img.title
    const d = await window.vidancer.imageRename(id, title)
    if (!d) return false
    get().applyDelta(d) // stored promptData/snapshots already rewritten by main
    set((s) => ({ renameSignal: { from, to, n: s.renameSignal.n + 1 } })) // → open editors rewrite their live text
    return true
  },
  addFolder: async (kind, name, parent) => {
    const r = await window.vidancer.folderAdd(kind, name, parent)
    if (r) get().applyDelta(r.delta)
  },
  renameFolder: async (id, name) => {
    get().applyDelta(await window.vidancer.folderRename(id, name))
  },
  deleteFolder: async (id) => {
    get().applyDelta(await window.vidancer.folderDelete(id))
  },
  moveItem: async (kind, itemId, folderId) => {
    get().applyDelta(await window.vidancer.itemMove(kind, itemId, folderId))
  },

  addToTimeline: async (clipId, takeId) => {
    const p = get().project
    if (!p) return
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const items = [...activeItems(p), { id, clipId, ...(takeId ? { takeId } : {}) }]
    await get().setTimelineItems(items)
  },
  removeFromTimeline: async (itemId) => {
    const p = get().project
    if (!p) return
    await get().setTimelineItems(activeItems(p).filter((it) => it.id !== itemId))
  },
  cloneTakeToClip: async (clipId, takeId) => {
    try {
      const r = await window.vidancer.clipFromTake(clipId, takeId)
      if (!r) return
      get().applyDelta(r.delta)
      set({ selectedClipId: r.newClipId })
    } catch (e) {
      console.error('clipFromTake failed — restart `npm run dev` (main changed):', e)
    }
  },
  setKeeper: async (clipId, takeId) => {
    get().applyDelta(await window.vidancer.clipSetKeeper(clipId, takeId))
  },
  // fire-and-forget: a player measured a take's real video length — persist once (main no-ops if unchanged)
  reportTakeDuration: (clipId, takeId, durationSec) => {
    const t = get().project?.clips.find((c) => c.id === clipId)?.takes.find((x) => x.id === takeId)
    if (!t || t.durationSec) return // already known
    void window.vidancer.takeSetDuration(clipId, takeId, durationSec).then((d) => get().applyDelta(d))
  },
  setTimelineItems: async (items, tlId) => {
    const p = get().project
    if (!p) return
    // send the base rev so main can reject a stale whole-array write instead of clobbering a
    // concurrent one (the returned delta then carries the authoritative timeline — we re-sync)
    const targetId = tlId ?? p.activeTimelineId
    const baseRev = p.timelines.find((t) => t.id === targetId)?.rev ?? 0
    get().applyDelta(await window.vidancer.timelineSet(targetId, items, baseRev))
  },
  // atomic in main: splits the instance AND remaps its 'last'-edge dynamic stills in one save
  sliceItem: async (itemId, cutSec) => {
    const p = get().project
    if (!p) return
    get().applyDelta(await window.vidancer.timelineSlice(p.activeTimelineId, itemId, cutSec))
  },
  // ----- timeline entities (Bin citizens) -----
  addTimeline: async () => {
    const r = await window.vidancer.timelineAdd()
    if (r) get().applyDelta(r.delta)
  },
  renameTimeline: async (id, name) => {
    get().applyDelta(await window.vidancer.timelineRename(id, name))
  },
  setTimelineAspect: async (id, ar) => {
    get().applyDelta(await window.vidancer.timelineSetAspect(id, ar))
  },
  duplicateTimeline: async (id) => {
    const r = await window.vidancer.timelineDuplicate(id)
    if (r) get().applyDelta(r.delta)
  },
  deleteTimeline: async (id) => {
    get().applyDelta(await window.vidancer.timelineDelete(id))
  },
  selectTimeline: async (id) => {
    if (get().project?.activeTimelineId === id) return
    get().applyDelta(await window.vidancer.timelineSetActive(id))
  },
  setEditorImage: (id) => set({ editorImageId: id }),
  setEditTarget: (t) => set({ editTarget: t }),
  tagEditNode: async (sessionId, nodeId) => {
    const r = await window.vidancer.imageTagNode(sessionId, nodeId)
    if (!r) return null
    get().applyDelta(r.delta)
    return r.imageId
  },
  deleteEditBranch: async (sessionId, nodeId) => {
    get().applyDelta(await window.vidancer.imageDeleteBranch(sessionId, nodeId))
  },
  tlPlay: () => set({ tlPlaying: true }),
  tlPause: () => set({ tlPlaying: false }),
  tlSetIndex: (i) => set((s) => ({ tlIndex: i, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1 })),
  tlSetProgress: (p) => set({ tlProgress: p }),
  toggleLoop: () => set((s) => ({ tlLoop: !s.tlLoop })),
  tlNext: (from) => {
    const s = get()
    // two end-detectors can fire for one slot (trim out-point + native ended, or a queued `ended`
    // on a same-src adjacent item) — an advance for a slot we already left must no-op, not skip two
    if (from != null && s.tlIndex !== from) return
    const n = activeItems(s.project).length
    if (s.tlIndex + 1 < n) set({ tlIndex: s.tlIndex + 1, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1 })
    else if (s.tlLoop && n > 0) set({ tlIndex: 0, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1 })
    else set({ tlPlaying: false, tlProgress: 1 })
  },
  seek: (index, offset, progress) =>
    set((s) => ({ tlIndex: index, tlProgress: progress, seekOffset: offset, seekTick: s.seekTick + 1, tlPlaying: false }))
}))
