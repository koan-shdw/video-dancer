import { create } from 'zustand'
import { clearStrips } from './lib/filmstrip'

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
  if (d.timeline) next.timeline = d.timeline
  if (d.folders) next.folders = d.folders
  return next
}

interface StoreState {
  project: Project | null
  selectedClipId: string | null
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
  autoTime: boolean // beats auto-fit to clip duration (keeps each beat's % share)

  setProject: (p: Project | null) => void
  applyDelta: (d: ProjectDelta | null | undefined) => void
  refreshCredit: () => Promise<void>
  toggleFilmstrips: () => void
  setShowFilmstrips: (b: boolean) => void
  toggleAutoTime: () => void
  selectClip: (id: string | null) => void
  editTimelineSlot: (index: number, clipId: string) => void
  newProject: () => Promise<void>
  openProject: () => Promise<void>
  refresh: () => Promise<void>
  openLast: () => Promise<void>
  importToLibrary: () => Promise<string[]>
  importPaths: (paths: string[]) => Promise<string[]>
  renameClip: (id: string, name: string) => Promise<void>
  createClip: () => Promise<string | null>
  saveClipPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<void>
  deleteClip: (id: string) => Promise<void>
  duplicateClip: (id: string) => Promise<void>
  deleteImage: (id: string) => Promise<void>
  duplicateImage: (id: string) => Promise<void>
  renameImage: (id: string, title: string) => Promise<void>
  addFolder: (kind: 'bin' | 'lib', name: string, parent: string | null) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  moveItem: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => Promise<void>

  addToTimeline: (clipId: string, takeId?: string) => Promise<void>
  removeFromTimeline: (itemId: string) => Promise<void>
  cloneTakeToClip: (clipId: string, takeId: string) => Promise<void>
  setKeeper: (clipId: string, takeId: string) => Promise<void>
  reportTakeDuration: (clipId: string, takeId: string, durationSec: number) => void
  setTimelineItems: (items: TimelineItem[]) => Promise<void>
  tlPlay: () => void
  tlPause: () => void
  tlSetIndex: (i: number) => void
  tlSetProgress: (p: number) => void
  toggleLoop: () => void
  tlNext: () => void
  seek: (index: number, offset: number, progress: number) => void
}

const resetPlayback = { tlPlaying: false, tlIndex: 0, tlProgress: 0, seekOffset: 0, seekTick: 0, editTimelineIndex: null }

export const useStore = create<StoreState>((set, get) => ({
  project: null,
  selectedClipId: null,
  editTimelineIndex: null,
  tlPlaying: false,
  tlIndex: 0,
  tlProgress: 0,
  tlLoop: true,
  seekOffset: 0,
  seekTick: 0,
  falCredit: { loading: false },
  showFilmstrips: true,
  autoTime: true,

  setProject: (p) => set({ project: p }),
  // merge an IPC mutation result + keep the selection/playback indices honest when the timeline changed
  applyDelta: (d) =>
    set((s) => {
      if (!s.project || !d) return {}
      const oldTimeline = s.project.timeline
      const patch: Partial<StoreState> = { project: mergeDelta(s.project, d) }
      if (d.timeline) {
        // the edited slot must keep pointing at the SAME item (matched by id) — or null out if it's gone.
        // (was a real bug: delete a timeline item while editing it → edits landed on the wrong slot)
        if (s.editTimelineIndex != null) {
          const editedId = oldTimeline[s.editTimelineIndex]?.id
          const ni = editedId ? d.timeline.findIndex((it) => it.id === editedId) : -1
          patch.editTimelineIndex = ni >= 0 ? ni : null
        }
        // playback index can't point past the end of a shrunken timeline
        if (s.tlIndex >= d.timeline.length) patch.tlIndex = Math.max(0, d.timeline.length - 1)
      }
      if (s.selectedClipId && d.removedClipIds?.includes(s.selectedClipId)) patch.selectedClipId = null
      return patch
    }),
  toggleFilmstrips: () =>
    set((s) => {
      const v = !s.showFilmstrips
      void window.vidancer.setSettings({ showFilmstrips: v })
      return { showFilmstrips: v }
    }),
  setShowFilmstrips: (b) => set({ showFilmstrips: b }),
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
  selectClip: (id) => set({ selectedClipId: id, editTimelineIndex: null }),
  editTimelineSlot: (index, clipId) => set({ editTimelineIndex: index, selectedClipId: clipId }),
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
  importToLibrary: async () => {
    const r = await window.vidancer.libraryImport()
    if (r?.delta) get().applyDelta(r.delta)
    return r?.importedIds ?? []
  },
  importPaths: async (paths) => {
    const r = await window.vidancer.libraryImportPaths(paths)
    if (r?.delta) get().applyDelta(r.delta)
    return r?.importedIds ?? []
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
    get().applyDelta(await window.vidancer.imageRename(id, title))
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
    const items = [...(p.timeline ?? []), { id, clipId, ...(takeId ? { takeId } : {}) }]
    get().applyDelta(await window.vidancer.timelineSet(items))
  },
  removeFromTimeline: async (itemId) => {
    const p = get().project
    if (!p) return
    const items = (p.timeline ?? []).filter((it) => it.id !== itemId)
    get().applyDelta(await window.vidancer.timelineSet(items))
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
  setTimelineItems: async (items) => {
    get().applyDelta(await window.vidancer.timelineSet(items))
  },
  tlPlay: () => set({ tlPlaying: true }),
  tlPause: () => set({ tlPlaying: false }),
  tlSetIndex: (i) => set((s) => ({ tlIndex: i, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1 })),
  tlSetProgress: (p) => set({ tlProgress: p }),
  toggleLoop: () => set((s) => ({ tlLoop: !s.tlLoop })),
  tlNext: () => {
    const s = get()
    const n = s.project?.timeline?.length ?? 0
    if (s.tlIndex + 1 < n) set({ tlIndex: s.tlIndex + 1, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1 })
    else if (s.tlLoop && n > 0) set({ tlIndex: 0, tlProgress: 0, seekOffset: 0, seekTick: s.seekTick + 1 })
    else set({ tlPlaying: false, tlProgress: 1 })
  },
  seek: (index, offset, progress) =>
    set((s) => ({ tlIndex: index, tlProgress: progress, seekOffset: offset, seekTick: s.seekTick + 1, tlPlaying: false }))
}))
