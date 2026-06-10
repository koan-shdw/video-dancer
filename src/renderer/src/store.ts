import { create } from 'zustand'

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
    if (p) set({ project: p, selectedClipId: null, ...resetPlayback })
  },
  openProject: async () => {
    const p = await window.vidancer.projectOpen()
    if (p) set({ project: p, selectedClipId: null, ...resetPlayback })
  },
  refresh: async () => {
    const p = await window.vidancer.projectGet()
    set({ project: p })
  },
  openLast: async () => {
    const p = await window.vidancer.projectOpenLast()
    if (p) set({ project: p, selectedClipId: null, ...resetPlayback })
  },
  importToLibrary: async () => {
    const r = await window.vidancer.libraryImport()
    if (r?.project) set({ project: r.project })
    return r?.importedIds ?? []
  },
  importPaths: async (paths) => {
    const r = await window.vidancer.libraryImportPaths(paths)
    if (r?.project) set({ project: r.project })
    return r?.importedIds ?? []
  },
  renameClip: async (id, name) => {
    const p = await window.vidancer.clipRename(id, name)
    if (p) set({ project: p })
  },
  createClip: async () => {
    const r = await window.vidancer.clipNew()
    if (r?.project) {
      set({ project: r.project, selectedClipId: r.clipId, editTimelineIndex: null })
      return r.clipId
    }
    return null
  },
  saveClipPromptData: async (clipId, pd) => {
    const p = await window.vidancer.clipSetPromptData(clipId, pd)
    if (p) set({ project: p })
  },
  deleteClip: async (id) => {
    const p = await window.vidancer.clipDelete(id)
    if (p) set({ project: p, selectedClipId: get().selectedClipId === id ? null : get().selectedClipId })
  },
  duplicateClip: async (id) => {
    const r = await window.vidancer.clipDuplicate(id)
    if (r?.project) set({ project: r.project, selectedClipId: r.newClipId })
  },
  deleteImage: async (id) => {
    const p = await window.vidancer.imageDelete(id)
    if (p) set({ project: p })
  },
  duplicateImage: async (id) => {
    const r = await window.vidancer.imageDuplicate(id)
    if (r?.project) set({ project: r.project })
  },
  renameImage: async (id, title) => {
    const p = await window.vidancer.imageRename(id, title)
    if (p) set({ project: p })
  },
  addFolder: async (kind, name, parent) => {
    const r = await window.vidancer.folderAdd(kind, name, parent)
    if (r?.project) set({ project: r.project })
  },
  renameFolder: async (id, name) => {
    const p = await window.vidancer.folderRename(id, name)
    if (p) set({ project: p })
  },
  deleteFolder: async (id) => {
    const p = await window.vidancer.folderDelete(id)
    if (p) set({ project: p })
  },
  moveItem: async (kind, itemId, folderId) => {
    const p = await window.vidancer.itemMove(kind, itemId, folderId)
    if (p) set({ project: p })
  },

  addToTimeline: async (clipId, takeId) => {
    const p = get().project
    if (!p) return
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const items = [...(p.timeline ?? []), { id, clipId, ...(takeId ? { takeId } : {}) }]
    const np = await window.vidancer.timelineSet(items)
    if (np) set({ project: np })
  },
  removeFromTimeline: async (itemId) => {
    const p = get().project
    if (!p) return
    const items = (p.timeline ?? []).filter((it) => it.id !== itemId)
    const np = await window.vidancer.timelineSet(items)
    if (np) set({ project: np, tlIndex: Math.min(get().tlIndex, Math.max(0, items.length - 1)) })
  },
  cloneTakeToClip: async (clipId, takeId) => {
    try {
      const r = await window.vidancer.clipFromTake(clipId, takeId)
      if (r?.project) set({ project: r.project, selectedClipId: r.newClipId })
    } catch (e) {
      console.error('clipFromTake failed — restart `npm run dev` (main changed):', e)
    }
  },
  setKeeper: async (clipId, takeId) => {
    const p = await window.vidancer.clipSetKeeper(clipId, takeId)
    if (p) set({ project: p })
  },
  setTimelineItems: async (items) => {
    const np = await window.vidancer.timelineSet(items)
    if (np) set({ project: np })
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
