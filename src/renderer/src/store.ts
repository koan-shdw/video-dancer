import { create } from 'zustand'
import { clearStrips } from './lib/filmstrip'
import { activeItems, activeTimeline, clampShiftLeft, effDur, startOf, timelineEnd, trackOf } from './lib/timelineUtils'
import { toast } from './ui/Toast'
import { openQueue } from './panelBus'
import { normalizeImageTitle } from '../../shared/types'
import { packFx2, type FxV2 } from './fx/fxData'
import { bakeFxSpans, cancelBake } from './fx/baker'
import { confirmDialog } from './prompt'

// tile-zoom persistence — debounced so a ctrl-wheel burst writes settings once, not per notch
let zoomPersistTimer: ReturnType<typeof setTimeout> | undefined
let previewHPersistTimer: ReturnType<typeof setTimeout> | undefined // preview drag-resize, same rhythm
let tlHeightsPersistTimer: ReturnType<typeof setTimeout> | undefined // timeline row-height drags, same rhythm

// ---- queue ETA: this machine remembers how long similar jobs really took ----
// fal reports phases, not percent — so the bar is an honest estimate from history, keyed by what
// actually drives render time (engine, kind, resolution, requested duration).
const STATS_KEEP = 5
let statsPersistTimer: ReturnType<typeof setTimeout> | undefined
function statsKeyFor(job: Pick<RenderJob, 'kind' | 'payload'>): string {
  if (job.kind === 'edit') {
    const p = job.payload as EditArgs
    const span = p.source.inSec != null && p.source.outSec != null ? Math.round(p.source.outSec - p.source.inSec) : 'full'
    return `${p.engine ?? 'omniflash'}|edit|${span}`
  }
  if (job.kind === 'vedit') {
    const p = job.payload as VeditArgs
    const span = p.inSec != null && p.outSec != null ? Math.round(p.outSec - p.inSec) : 'full'
    return `${p.engine}|vedit|${span}`
  }
  const p = job.payload as RenderArgs
  return `${p.engine ?? 'seedance2'}|gen|${p.resolution}|${p.duration}`
}

// ---- render queue: paid fal jobs (generations + edits) run ONE at a time, in order ----
export interface RenderJob {
  id: string
  kind: 'gen' | 'edit' | 'vedit'
  projectDir?: string // stamped at enqueue — a job NEVER starts against a different project (money law)
  inFlight?: boolean // the IPC is genuinely outstanding — distinct from display status (cancel flips status while the call is still live)
  label: string // clip name shown in the Queue panel
  thumb?: string // image file for the row thumbnail
  thumbVideo?: string // …or a video whose frame IS the thumbnail (edit jobs: the source window)
  thumbSeek?: number
  engineLabel: string
  estCost?: number
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  msg?: string // latest progress / fal api message
  error?: string
  startedAt?: number // when it went running — drives the ETA bar
  etaSec?: number // estimate from this machine's history of similar jobs (absent = no history yet)
  payload: RenderArgs | EditArgs | VeditArgs
  adoptSlotItemId?: string // gen from an edited timeline slot: point that slot at the new take
  resultClipId?: string
  resultTakeId?: string
  resultNodeId?: string // vedit jobs: the fresh tree node
  resultFile?: string
  consumed?: boolean // a panel already reacted to this completion
}

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
  if (d.styles?.length) {
    const byId = new Map(d.styles.map((s) => [s.id, s]))
    next.styles = next.styles.map((s) => byId.get(s.id) ?? s)
    const fresh = d.styles.filter((s) => !p.styles.some((x) => x.id === s.id))
    if (fresh.length) next.styles = [...next.styles, ...fresh]
  }
  if (d.removedStyleIds?.length) next.styles = next.styles.filter((s) => !d.removedStyleIds!.includes(s.id))
  if (d.charSheets?.length) {
    const byId = new Map(d.charSheets.map((s) => [s.id, s]))
    next.charSheets = (next.charSheets ?? []).map((s) => byId.get(s.id) ?? s)
    const fresh = d.charSheets.filter((s) => !(p.charSheets ?? []).some((x) => x.id === s.id))
    if (fresh.length) next.charSheets = [...next.charSheets, ...fresh]
  }
  if (d.removedCharSheetIds?.length) next.charSheets = (next.charSheets ?? []).filter((s) => !d.removedCharSheetIds!.includes(s.id))
  // manual re-ordering: rebuild the array in the given id order (unlisted items keep their spot at the end)
  const orderBy = <T extends { id: string }>(arr: T[], order: string[]): T[] => {
    const byId = new Map(arr.map((x) => [x.id, x]))
    const out = order.map((id) => byId.get(id)).filter((x): x is T => !!x)
    const listed = new Set(order)
    return [...out, ...arr.filter((x) => !listed.has(x.id))]
  }
  if (d.clipsOrder) next.clips = orderBy(next.clips, d.clipsOrder)
  if (d.imagesOrder) next.images = orderBy(next.images, d.imagesOrder)
  if (d.images?.length) {
    const byId = new Map(d.images.map((i) => [i.id, i]))
    next.images = next.images.map((i) => byId.get(i.id) ?? i)
    const fresh = d.images.filter((i) => !p.images.some((x) => x.id === i.id))
    if (fresh.length) next.images = [...next.images, ...fresh]
  }
  if (d.removedImageIds?.length) next.images = next.images.filter((i) => !d.removedImageIds!.includes(i.id))
  if (d.watchFolder !== undefined) {
    if (d.watchFolder) next.watchFolder = d.watchFolder
    else delete next.watchFolder
  }
  if (d.audio?.length) {
    const byId = new Map(d.audio.map((a) => [a.id, a]))
    next.audio = next.audio.map((a) => byId.get(a.id) ?? a)
    const fresh = d.audio.filter((a) => !p.audio.some((x) => x.id === a.id))
    if (fresh.length) next.audio = [...next.audio, ...fresh]
  }
  if (d.removedAudioIds?.length) next.audio = next.audio.filter((a) => !d.removedAudioIds!.includes(a.id))
  if (d.videos?.length) {
    const byId = new Map(d.videos.map((v) => [v.id, v]))
    next.videos = (next.videos ?? []).map((v) => byId.get(v.id) ?? v)
    const fresh = d.videos.filter((v) => !(p.videos ?? []).some((x) => x.id === v.id))
    if (fresh.length) next.videos = [...(next.videos ?? []), ...fresh]
  }
  if (d.removedVideoIds?.length) next.videos = (next.videos ?? []).filter((v) => !d.removedVideoIds!.includes(v.id))
  if (d.timelines?.length) {
    const byId = new Map(d.timelines.map((t) => [t.id, t]))
    next.timelines = next.timelines.map((t) => byId.get(t.id) ?? t)
    const fresh = d.timelines.filter((t) => !p.timelines.some((x) => x.id === t.id))
    if (fresh.length) next.timelines = [...next.timelines, ...fresh]
  }
  if (d.removedTimelineIds?.length) next.timelines = next.timelines.filter((t) => !d.removedTimelineIds!.includes(t.id))
  if (d.activeTimelineId) next.activeTimelineId = d.activeTimelineId
  if (d.folders) next.folders = d.folders
  if (d.codir) next.codir = d.codir
  if (d.editSessions?.length) {
    const byId = new Map(d.editSessions.map((s) => [s.id, s]))
    next.editSessions = next.editSessions.map((s) => byId.get(s.id) ?? s)
    const fresh = d.editSessions.filter((s) => !p.editSessions.some((x) => x.id === s.id))
    if (fresh.length) next.editSessions = [...next.editSessions, ...fresh]
  }
  if (d.videoEditSessions?.length) {
    const byId = new Map(d.videoEditSessions.map((s) => [s.id, s]))
    next.videoEditSessions = (next.videoEditSessions ?? []).map((s) => byId.get(s.id) ?? s)
    const fresh = d.videoEditSessions.filter((s) => !(p.videoEditSessions ?? []).some((x) => x.id === s.id))
    if (fresh.length) next.videoEditSessions = [...(next.videoEditSessions ?? []), ...fresh]
  }
  if (d.removedVideoEditSessionIds?.length)
    next.videoEditSessions = (next.videoEditSessions ?? []).filter((s) => !d.removedVideoEditSessionIds!.includes(s.id))
  return next
}

interface StoreState {
  project: Project | null
  selectedClipId: string | null
  selectedTlItemId: string | null // the timeline block selected by click (Del removes it)
  // EFFECTS v2 — live-preview override while the Effects panel drags a control: the Monitor
  // prefers this over the item's persisted fx for the SAME item. Panel clears it after commit.
  fxDraft: { itemId: string; fx: FxV2 | null } | null
  editTimelineIndex: number | null // when set, the editor is editing this timeline slot (take = per-slot)
  // timeline playback — v14 GLOBAL CLOCK: tlTime (seconds) is the playhead's single truth;
  // the Monitor's engine advances it while playing and hard-seeks its media on seekTick bumps
  tlPlaying: boolean
  tlTime: number
  tlLoop: boolean
  seekTick: number // bump = the Monitor must hard-seek its media to tlTime
  falCredit: { balance?: number; currency?: string; error?: string; loading: boolean }
  showFilmstrips: boolean // timeline filmstrip thumbnails on/off (perf toggle)
  snapPlayhead: boolean // slice/trim snap to the scrubber (persisted)
  snapBeats: boolean // slice/out-trim snap to music beat ticks (persisted)
  autoTime: boolean // beats auto-fit to clip duration (keeps each beat's % share)
  editorImageId: string | null // Library image open in the Image Editor ('' = from-scratch session)
  editorVideoRoot: { videoId?: string; takeRef?: { clipId: string; takeId: string } } | null // source open in the Video Editor
  editorSheetId: string | null // char sheet open in the Char Sheet panel
  // what the Clip Edit (v2v) panel is working on: a bound edit clip, or a DRAFT (source take +
  // optional window) that only becomes a clip when its first generation succeeds
  editTarget: { clipId?: string; source?: { clipId: string; takeId: string; inSec?: number; outSec?: number } } | null
  // the render queue (see RenderJob) — sequential, pausable, reorderable
  queue: RenderJob[]
  queuePaused: boolean
  // thumbnail tile width (px) for the Bin and Library — slider + ctrl-wheel, persisted in settings
  tileZoom: { bin: number; lib: number }
  // preview <video> height (px) in Clip Gen / Clip Edit — drag the handle under the preview; persisted
  previewH: { render: number; clipEdit: number }
  // timeline row heights (px) — video track rows + audio lanes, drag-resized in the rail; persisted
  tlRowH: number
  tlLaneH: number
  setTlHeights: (p: { rowH?: number; laneH?: number }) => void
  // Clip Gen take double-click → the Clip Monitor previews exactly that take (n = nonce so the
  // same take re-fires; consumed + cleared by SourceMonitor)
  monitorTakeReq: { takeId: string; n: number } | null
  requestMonitorTake: (takeId: string) => void
  // real durations of past jobs (per stats key) — persisted, feeds each new job's etaSec
  renderStats: Record<string, number[]>
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
  // bumped when Settings changes something other panels display live (Co-Director engine/model)
  settingsRev: number
  exportState: { busy: boolean; msg: string; file?: string } // timeline → mp4 progress (shown by Timeline + Timeline Editor)
  renderBusy: boolean // a fal render is in flight (Clip Editor tab badge)
  setRenderBusy: (b: boolean) => void
  // output mirror: timeline playback pushed fullscreen to another display (null = off).
  // The Monitor relays its transport to the mirror window while this is set.
  mirrorDisplayId: number | null
  setMirrorDisplay: (id: number | null) => void
  // the app-wide "last clicked field" — what the Co-Director means by "this one"; also drawn
  // as a subtle ring on the field itself
  focusField: { kind: 'clip' | 'style'; ownerId: string; path: string } | null
  setFocusField: (f: { kind: 'clip' | 'style'; ownerId: string; path: string } | null) => void
  // ---- Co-Director exchange state, SHARED by the side panel and the Director's Room: one run,
  // two views. The single onCodirProgress subscription (App.tsx) dispatches into codirProgress. ----
  codirRun: { busy: boolean; status: string; liveTexts: string[]; pendingUser: string | null; lastUsage: string }
  codirLiveStage: { at: number; live: CoDirLiveWrite } | null // the write landing RIGHT NOW (live stage)
  codirQueue: { id: number; text: string }[] // sends that arrived mid-run — they fire FIFO when the run frees up
  codirQueueRemove: (id: number) => void
  roomOpen: boolean // the Director's Room overlay
  setRoomOpen: (b: boolean) => void
  // the Screen — the room's big floating player behind the chat. Set by the co-director's
  // show_on_screen, a "latest take" ask, or a pop click; null = dark. Survives past the run.
  codirScreen: { at: number; clipId: string; clipName: string; take: number; file: string } | null
  setCodirScreen: (s: { clipId: string; clipName: string; take: number; file: string } | null) => void
  codirProgress: (e: { kind: 'status' | 'text' | 'wrote' | 'live' | 'screen'; text?: string; live?: CoDirLiveWrite; screen?: CoDirScreenEvent }) => void
  codirSendText: (text: string) => Promise<void> // THE send path — both views call this
  // ---- EFFECTS: v16 attempt stripped 2026-08-08; rebuild = ordered stack architecture.
  // fxJob survives (pass runner progress — matte/depth sidecars are groundwork, currently unwired)
  fxJob: { label: string; pct: number } | null // running AI pass / model download (one at a time)
  setFxJob: (j: { label: string; pct: number } | null) => void
  // Project Styles panel: which style a link-chip double-click wants selected (consumed once)
  stylesFocusId: string | null
  setStylesFocus: (id: string | null) => void
  // multi-select in the Bin/Library grids — ONE active selection app-wide, scoped to a kind.
  // `ids` keeps SELECTION ORDER (that's the drop order on the timeline); `anchor` is the last
  // plain/ctrl-clicked id — the fixed end of a shift-click range
  multiSel: { kind: 'bin' | 'lib'; ids: string[]; anchor: string } | null
  setMultiSel: (kind: 'bin' | 'lib', ids: string[], anchor?: string) => void
  clearMultiSel: () => void

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
  setFxDraft: (d: { itemId: string; fx: FxV2 | null } | null) => void
  commitItemFx: (itemId: string, fx: FxV2 | null) => Promise<void> // persists via timeline:set (NEVER timelineSetItemFx)
  tlClipboard: TimelineItem | null // Ctrl+C'd timeline block (clip + take/trims/mute)
  setTlClipboard: (it: TimelineItem | null) => void
  // Ctrl+V (no opts) = RIPPLE INSERT at the playhead on the copied block's track: everything
  // at/after the paste point shifts right by the pasted length — all tracks + free audio
  // (linked audio rides its video; the music bed stays). {at, track, ripple: false} =
  // "paste here" from a track's right-click: drop at that spot, no ripple, overlap-clamped.
  pasteTlClipboard: (opts?: { at?: number; track?: number; ripple?: boolean }) => Promise<void>
  deleteSelectedTlItem: () => Promise<void>
  editTimelineSlot: (index: number, clipId: string) => void
  createProject: (baseDir: string, name: string) => Promise<boolean> // false = main refused (bad dir)
  openProject: () => Promise<void>
  refresh: () => Promise<void>
  openLast: () => Promise<void>
  openPath: (dir: string) => Promise<void>
  // named save states — instant metadata checkpoints; restore goes through undo history (Ctrl+Z reverts)
  saveState: (name: string) => Promise<boolean>
  restoreState: (file: string) => Promise<void>
  // per-project spend ledger (append-only, outside undo) — total drives the header SPND chip
  spendTotal: number
  refreshSpend: () => Promise<void>
  addSpend: (entry: { label: string; kind: 'gen' | 'edit' | 'image'; cost: number }) => Promise<void>
  importToLibrary: () => Promise<string[]>
  importPaths: (paths: string[]) => Promise<string[]>
  importAudio: () => Promise<void>
  importAudioPaths: (paths: string[]) => Promise<void>
  renameAudio: (id: string, title: string) => Promise<void>
  reportAudioDuration: (id: string, dur: number) => void
  deleteAudio: (id: string) => Promise<void>
  importVideo: () => Promise<void>
  importVideoPaths: (paths: string[]) => Promise<string[]> // resolves to the imported video ids
  renameVideo: (id: string, title: string) => Promise<void>
  deleteVideo: (id: string) => Promise<void>
  setTimelineMusic: (timelineId: string, music: TimelineMusic | null) => Promise<void>
  setTimelineMutes: (timelineId: string, mutes: { videoMuted?: boolean; musicMuted?: boolean }) => Promise<void>
  setTimelineExportPrefs: (timelineId: string, prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30' }) => Promise<void>
  setExportMsg: (msg: string) => void
  startExport: (timelineId: string) => Promise<void>
  cancelExport: () => void // stops the fx bake AND the ffmpeg encode; .part files are discarded
  saveFrame: (bytes: Uint8Array, note: string) => Promise<string | null> // → new Library image id
  renameClip: (id: string, name: string) => Promise<void>
  createClip: () => Promise<string | null>
  saveClipPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<void>
  createStyle: (name?: string) => Promise<string | null> // → new style id
  createCharSheet: (name?: string) => Promise<string | null> // → new sheet id
  saveCharSheet: (id: string, patch: { name?: string; imageId?: string | null; character?: CharacterField }) => Promise<void>
  deleteCharSheet: (id: string) => Promise<void>
  // drop tile on tile: moved items (selection order) insert BEFORE the target, adopting its folder
  reorderItems: (kind: 'bin' | 'lib', movedIds: string[], targetId: string) => Promise<void>
  saveStyle: (id: string, patch: { name?: string; scene?: SceneFields; production?: ProductionFields; enhanced?: string[] }) => Promise<void>
  deleteStyle: (id: string) => Promise<void>
  deleteClip: (id: string) => Promise<void>
  deleteClips: (ids: string[]) => Promise<void>
  duplicateClip: (id: string) => Promise<void>
  deleteImage: (id: string) => Promise<void>
  deleteImages: (ids: string[]) => Promise<void>
  duplicateImage: (id: string) => Promise<void>
  // images → ready-made clips (one per image, named after its @title, image as first ref).
  // insertIndex != null also places them side by side on the ACTIVE timeline at that index —
  // both writes happen in one main mutation (one undo step)
  makeClipsFromImages: (imageIds: string[], insertIndex?: number | null) => Promise<void>
  // ONE clip from several images — each image becomes a beat (its @title in the beat text → the
  // beat thumb shows it) and all images become the clip's refs
  makeBeatsClipFromImages: (imageIds: string[]) => Promise<void>
  // crop tool: save baked PNG bytes as an edit-tree node; main also makes it the image's primary
  // face (clips follow). Returns the new node id (null = failed)
  cropImage: (rootImageId: string, parentNodeId: string | null, bytes: Uint8Array, label: string) => Promise<string | null>
  renameImage: (id: string, title: string) => Promise<boolean> // false = @title already taken (rename refused)
  addFolder: (kind: 'bin' | 'lib', name: string, parent: string | null) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  moveItem: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => Promise<void>
  moveItems: (kind: 'bin' | 'lib', itemIds: string[], folderId: string | null) => Promise<void>

  addToTimeline: (clipId: string, takeId?: string) => Promise<void>
  removeFromTimeline: (itemId: string) => Promise<void>
  cloneTakeToClip: (clipId: string, takeId: string) => Promise<void>
  setKeeper: (clipId: string, takeId: string) => Promise<void>
  // storyboard face — which ref image visually represents a take-less clip (null = auto). Display-only.
  setClipStoryboard: (clipId: string, imageId: string | null) => Promise<void>
  setTakeMeta: (clipId: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => Promise<void>
  reportTakeDuration: (clipId: string, takeId: string, durationSec: number) => void
  setTimelineItems: (items: TimelineItem[], tlId?: string) => Promise<void> // tlId = target captured at op start (default: active)
  // one ripple = one undo step: video items + free-audio lanes land in a SINGLE main mutation
  setTimelineBoth: (items: TimelineItem[], audioItems: TimelineAudioItem[] | null, tlId?: string) => Promise<void>
  // switch a slot's view (take or S-B) and RIPPLE the length delta through everything after it —
  // the ONE path every take-switch UI goes through (block picker, Clip Gen cards, Clip Monitor, adopt)
  setSlotView: (itemId: string, view: { takeId?: string; useRecipe?: boolean }) => Promise<void>
  // audio lanes: whole-array write (drag/trim/lane/mute/delete/link edits) + the block-detach action
  setTimelineAudioItems: (audioItems: TimelineAudioItem[], tlId?: string) => Promise<void>
  unlinkAudio: (itemId: string) => Promise<void>
  // track chrome + markers + in/out range (videoTracks/audioTracks/lock/mute/solo/markers/range)
  setTimelineMeta: (patch: Parameters<VidancerApi['timelineSetMeta']>[1], tlId?: string) => Promise<void>
  sliceItem: (itemId: string, cutSec: number) => Promise<void>
  addTimeline: () => Promise<void>
  renameTimeline: (id: string, name: string) => Promise<void>
  setTimelineAspect: (id: string, ar: string) => Promise<void>
  duplicateTimeline: (id: string) => Promise<void>
  deleteTimeline: (id: string) => Promise<void>
  selectTimeline: (id: string) => Promise<void>
  setEditorImage: (id: string | null) => void
  setEditorVideo: (root: { videoId?: string; takeRef?: { clipId: string; takeId: string } } | null) => void
  makeClipFromVideo: (videoId: string) => Promise<string | null>
  addVideoTakeToClip: (videoId: string, clipId: string) => Promise<void>
  setEditorSheet: (id: string | null) => void
  setEditTarget: (t: { clipId?: string; source?: { clipId: string; takeId: string; inSec?: number; outSec?: number } } | null) => void
  enqueueRender: (job: Omit<RenderJob, 'id' | 'status'>) => void
  cancelJob: (id: string) => void
  moveJob: (id: string, dir: -1 | 1) => void
  setQueuePaused: (paused: boolean) => void
  setRunningJobMsg: (msg: string) => void
  consumeJob: (id: string) => void
  clearFinishedJobs: () => void
  pumpQueue: () => void
  setTileZoom: (kind: 'bin' | 'lib', w: number) => void
  setPreviewH: (kind: 'render' | 'clipEdit', h: number) => void
  tagEditNode: (sessionId: string, nodeId: string) => Promise<string | null>
  deleteEditBranch: (sessionId: string, nodeId: string) => Promise<void>
  tlPlay: () => void
  tlPause: () => void
  toggleLoop: () => void
  tlSeek: (t: number) => void // user seek/scrub: sets the clock + tells the Monitor to hard-seek
  tlSetTime: (t: number) => void // the playback engine's per-frame clock write (no seek signal)
}

let queueId = 0 // session-monotonic queued-send ids

// ---- queue money-safety helpers ----
const lastEnqueue = { sig: '', at: 0 } // double-fire guard state
let queuePersistTimer: ReturnType<typeof setTimeout> | undefined
// pending jobs survive quit/crash: persisted per project (debounced), offered back on open
function persistQueueSoon(get: () => StoreState): void {
  clearTimeout(queuePersistTimer)
  queuePersistTimer = setTimeout(() => {
    const s = get()
    if (!s.project) return
    const dir = s.project.dir
    const rows = s.queue
      .filter((j) => j.status === 'pending' && (!j.projectDir || j.projectDir === dir))
      .map(({ id: _id, status: _st, inFlight: _if, msg: _m, ...keep }) => keep)
    void window.vidancer.queueSave(rows)
  }, 500)
}
async function offerQueueRestore(get: () => StoreState): Promise<void> {
  const rows = (await window.vidancer.queueLoad()) as Omit<RenderJob, 'id' | 'status'>[] | null
  if (!rows?.length || !get().project) return
  const n = rows.length
  toast(`${n} queued render${n === 1 ? '' : 's'} from last session`, {
    kind: 'ok',
    hint: 'click to re-queue',
    onClick: () => {
      for (const r of rows) {
        lastEnqueue.at = 0 // deliberate restore — never eaten by the double-fire guard
        get().enqueueRender(r)
      }
    }
  })
}
// switching projects while the Co-Director is mid-exchange lands its writes in the WRONG
// project (main resolves the project fresh at every tool call) — confirm + cancel first
async function guardCodirSwitch(get: () => StoreState): Promise<boolean> {
  if (!get().codirRun.busy) return true
  const ok = await confirmDialog(
    'The Co-Director is mid-exchange — switching projects now would land its writes in the wrong project. Cancel the exchange and switch?',
    { confirmLabel: 'Cancel + switch', danger: true }
  )
  if (!ok) return false
  await window.vidancer.codirCancel()
  return true
}

const resetPlayback = {
  tlPlaying: false,
  tlTime: 0,
  seekTick: 0,
  editTimelineIndex: null,
  fxDraft: null, // a live fx preview must never outlive the project it belongs to
  // EVERY cross-project id resets here — consumers guarding by lookup was per-call-site luck,
  // and one unguarded consumer would act on the previous project's objects
  selectedTlItemId: null,
  multiSel: null,
  editorImageId: null,
  editorVideoRoot: null,
  editorSheetId: null,
  editTarget: null,
  tlClipboard: null,
  focusField: null,
  monitorTakeReq: null,
  exportState: { busy: false, msg: '' },
  // Co-Director session artifacts belong to the project we're leaving
  codirLiveStage: null,
  codirScreen: null,
  codirQueue: [] as { id: number; text: string }[],
  roomOpen: false
}

// undo/redo replace the WHOLE project — keep selection/playback indices valid and nudge the Clip
// Editor (via undoTick) to reload its live form from the restored state
function restorePatch(s: StoreState, p: Project): Partial<StoreState> {
  // fxDraft: the restored state must win — a surviving draft would override the restored fx in
  // the Monitor (the Effects panel also cancels its pending commit on undoTick)
  const patch: Partial<StoreState> = { project: p, undoTick: s.undoTick + 1, fxDraft: null }
  if (s.selectedClipId && !p.clips.some((c) => c.id === s.selectedClipId)) patch.selectedClipId = null
  if (s.editorImageId && !p.images.some((i) => i.id === s.editorImageId)) patch.editorImageId = null
  if (s.editorSheetId && !(p.charSheets ?? []).some((x) => x.id === s.editorSheetId)) patch.editorSheetId = null
  if (s.multiSel) {
    const pool: { id: string }[] = s.multiSel.kind === 'bin' ? p.clips : p.images
    const ids = s.multiSel.ids.filter((id) => pool.some((x) => x.id === id))
    if (ids.length !== s.multiSel.ids.length) patch.multiSel = ids.length ? { ...s.multiSel, ids } : null
  }
  const items = activeItems(p)
  if (s.editTimelineIndex != null && s.editTimelineIndex >= items.length) patch.editTimelineIndex = null
  if (s.selectedTlItemId && !items.some((it) => it.id === s.selectedTlItemId)) patch.selectedTlItemId = null
  patch.seekTick = s.seekTick + 1 // restored state may reposition everything — the Monitor re-seeks
  return patch
}

export const useStore = create<StoreState>((set, get) => ({
  project: null,
  selectedClipId: null,
  selectedTlItemId: null,
  fxDraft: null,
  tlClipboard: null,
  editTimelineIndex: null,
  tlPlaying: false,
  tlTime: 0,
  tlLoop: true,
  seekTick: 0,
  falCredit: { loading: false },
  showFilmstrips: true,
  snapPlayhead: true,
  snapBeats: true,
  autoTime: true,
  editorImageId: null,
  editorVideoRoot: null,
  editorSheetId: null,
  editTarget: null,
  queue: [],
  queuePaused: false,
  tileZoom: { bin: 96, lib: 84 },
  previewH: { render: 200, clipEdit: 260 },
  tlRowH: 56,
  tlLaneH: 22,
  setTlHeights: (p) => {
    set((s) => ({ tlRowH: p.rowH ?? s.tlRowH, tlLaneH: p.laneH ?? s.tlLaneH }))
    clearTimeout(tlHeightsPersistTimer)
    tlHeightsPersistTimer = setTimeout(() => {
      void window.vidancer.setSettings({ tlRowH: get().tlRowH, tlLaneH: get().tlLaneH })
    }, 400)
  },
  monitorTakeReq: null,
  requestMonitorTake: (takeId) => set((s) => ({ monitorTakeReq: { takeId, n: (s.monitorTakeReq?.n ?? 0) + 1 } })),
  renderStats: {},
  previewRecipe: false,
  setPreviewRecipe: (b) => set({ previewRecipe: b }),
  mirrorDisplayId: null,
  setMirrorDisplay: (id) => set({ mirrorDisplayId: id }),
  focusField: null,
  setFocusField: (f) => set({ focusField: f }),
  codirRun: { busy: false, status: '', liveTexts: [], pendingUser: null, lastUsage: '' },
  codirLiveStage: null,
  codirScreen: null,
  setCodirScreen: (scr) => set({ codirScreen: scr ? { at: Date.now(), ...scr } : null }),
  codirQueue: [],
  codirQueueRemove: (id) => set((s) => ({ codirQueue: s.codirQueue.filter((q) => q.id !== id) })),
  roomOpen: false,
  setRoomOpen: (b) => set({ roomOpen: b }),
  fxJob: null,
  setFxJob: (j) => set({ fxJob: j }),
  codirProgress: (e) => {
    if (e.kind === 'status') set((s) => ({ codirRun: { ...s.codirRun, status: e.text ?? '' } }))
    else if (e.kind === 'text' && e.text) set((s) => ({ codirRun: { ...s.codirRun, liveTexts: [...s.codirRun.liveTexts, e.text!] } }))
    else if (e.kind === 'live' && e.live) {
      set({ codirLiveStage: { at: Date.now(), live: e.live } })
    } else if (e.kind === 'screen' && e.screen) {
      const scr = e.screen
      set({ codirScreen: scr.off ? null : { at: Date.now(), clipId: scr.clipId, clipName: scr.clipName, take: scr.take, file: scr.file } })
    } else if (e.kind === 'wrote') {
      set((s) => ({
        codirRun: { ...s.codirRun, status: e.text ?? 'wrote' },
        // AI wrote into the project — open forms reload from the store instead of clobbering
        // the write with their debounced autosave (same signal undo/redo uses)
        undoTick: s.undoTick + 1
      }))
    }
  },
  codirSendText: async (text) => {
    const t = text.trim()
    if (!t) return
    if (get().codirRun.busy) {
      // mid-run send → queue it; the finally below fires the next one when the run frees up
      set((s) => ({ codirQueue: [...s.codirQueue, { id: ++queueId, text: t }] }))
      return
    }
    const p = get().project
    if (!p) return
    // any @title in the text ships its image so the model can SEE it
    const imageIds = (t.match(/@\w+/g) ?? [])
      .map((tag) => p.images.find((i) => i.title === tag)?.id)
      .filter((x): x is string => !!x)
    set((s) => ({ codirRun: { ...s.codirRun, busy: true, status: 'thinking…', liveTexts: [], pendingUser: t } }))
    try {
      const r = await window.vidancer.codirSend({ text: t, imageIds, selectedClipId: get().selectedClipId, focus: get().focusField })
      if (r.logDelta) get().applyDelta(r.logDelta)
      if (!r.ok && r.error && r.error !== 'cancelled') toast(`Co-Director: ${r.error}`, { kind: 'error' })
      if (r.usage) {
        const u = r.usage
        set((s) => ({
          codirRun: {
            ...s.codirRun,
            lastUsage: `last: ${u.rounds} round${u.rounds > 1 ? 's' : ''} · in ${(u.inputTokens / 1000).toFixed(1)}k (${(u.cacheReadTokens / 1000).toFixed(1)}k cached) · out ${(u.outputTokens / 1000).toFixed(1)}k tokens`
          }
        }))
      }
    } catch (err) {
      // an exchange must NEVER fail silently — surface it and free both views
      toast(`Co-Director: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' })
    } finally {
      set((s) => ({
        codirRun: { ...s.codirRun, busy: false, status: '', liveTexts: [], pendingUser: null },
        codirLiveStage: null,
        undoTick: s.undoTick + 1 // final reload of any open forms
      }))
      const next = get().codirQueue[0]
      if (next && get().project) {
        set((s) => ({ codirQueue: s.codirQueue.slice(1) }))
        void get().codirSendText(next.text)
      }
    }
  },
  stylesFocusId: null,
  setStylesFocus: (id) => set({ stylesFocusId: id }),
  multiSel: null,
  setMultiSel: (kind, ids, anchor) =>
    set({ multiSel: ids.length ? { kind, ids, anchor: anchor ?? ids[ids.length - 1] } : null }),
  clearMultiSel: () => set({ multiSel: null }),
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
  settingsRev: 0,
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
        Object.assign(patch, { tlPlaying: false, tlTime: 0, seekTick: s.seekTick + 1, editTimelineIndex: null, selectedTlItemId: null })
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
        }
      }
      if (s.selectedClipId && d.removedClipIds?.includes(s.selectedClipId)) patch.selectedClipId = null
      if (s.editorImageId && d.removedImageIds?.includes(s.editorImageId)) patch.editorImageId = null
      if (s.editorSheetId && d.removedCharSheetIds?.includes(s.editorSheetId)) patch.editorSheetId = null
      if (s.multiSel && (d.removedClipIds?.length || d.removedImageIds?.length)) {
        const removed = new Set([...(d.removedClipIds ?? []), ...(d.removedImageIds ?? [])])
        const ids = s.multiSel.ids.filter((id) => !removed.has(id))
        if (ids.length !== s.multiSel.ids.length) patch.multiSel = ids.length ? { ...s.multiSel, ids } : null
      }
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
  setFxDraft: (d) => set({ fxDraft: d }),
  commitItemFx: async (itemId, fx) => {
    // clear a matching draft on EVERY exit — a leaked draft overrides the item in the Monitor
    // forever (even across undo restoring the block). But only clear the exact draft captured
    // now: a NEWER draft written while the IPC is in flight belongs to the next commit.
    const draftAtStart = get().fxDraft
    const dropDraft = (): void => {
      if (get().fxDraft === draftAtStart && draftAtStart?.itemId === itemId) set({ fxDraft: null })
    }
    const p = get().project
    if (!p) {
      dropDraft()
      return
    }
    const items = activeItems(p)
    if (!items.some((it) => it.id === itemId)) {
      dropDraft()
      return
    }
    const packed = packFx2(fx)
    const setFxOn = (it: TimelineItem): TimelineItem => {
      const next = { ...it }
      if (packed) next.fx = packed as unknown as ItemFx
      else delete next.fx
      return next
    }
    // v2 shape rides the whole-array write verbatim; the cast is the one sanctioned bridge —
    // see fx/fxData.ts. (⟲ loop tails need no ripple: repeats are projections of this one item.)
    await get().setTimelineItems(items.map((it) => (it.id === itemId ? setFxOn(it) : it)))
    dropDraft()
  },
  setTlClipboard: (it) => set({ tlClipboard: it }),
  pasteTlClipboard: async (opts) => {
    const s = get()
    const c = s.tlClipboard
    const p = s.project
    if (!c || !p || !p.clips.some((x) => x.id === c.clipId)) return
    const items = activeItems(p)
    const ripple = opts?.ripple ?? true
    const track = Math.max(0, opts?.track ?? c.track ?? 0)
    const len = effDur(c, p.clips)
    let t = Math.max(0, opts?.at ?? s.tlTime)
    if (ripple) {
      // landing INSIDE a block on the target track → snap to its end (we insert, never split)
      const host = items.find((x) => trackOf(x) === track && startOf(x) < t - 0.001 && t < startOf(x) + effDur(x, p.clips) - 0.001)
      if (host) t = startOf(host) + effDur(host, p.clips)
    } else {
      // no ripple: slide right past anything the pasted block would overlap on this track
      let guard = 0
      while (guard++ < 64) {
        const hit = items.find((x) => trackOf(x) === track && startOf(x) < t + len - 0.001 && t < startOf(x) + effDur(x, p.clips) - 0.001)
        if (!hit) break
        t = startOf(hit) + effDur(hit, p.clips)
      }
    }
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const fresh: TimelineItem = { ...c, id, startSec: t, track, audioDetachedId: undefined }
    const next = ripple ? items.map((x) => (startOf(x) >= t - 0.001 ? { ...x, startSec: startOf(x) + len } : x)) : items.slice()
    // video + shifted free audio in ONE mutation — one paste, one Ctrl+Z
    const aud = activeTimeline(p)?.audioItems ?? []
    const shifts = (a: TimelineAudioItem): boolean => !a.link && (a.startSec ?? 0) >= t - 0.001
    const nextAud = ripple && aud.some(shifts) ? aud.map((a) => (shifts(a) ? { ...a, startSec: (a.startSec ?? 0) + len } : a)) : null
    await s.setTimelineBoth([...next, fresh], nextAud)
    s.selectTlItem(id)
  },
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
  createProject: async (baseDir, name) => {
    if (!(await guardCodirSwitch(get))) return false
    const p = await window.vidancer.projectCreateAt(baseDir, name)
    if (p) {
      clearStrips() // filmstrip cache belongs to the previous project's files
      set({ project: p, selectedClipId: null, ...resetPlayback })
      void get().refreshSpend()
    }
    return !!p
  },
  openProject: async () => {
    if (!(await guardCodirSwitch(get))) return
    const p = await window.vidancer.projectOpen()
    if (p) {
      clearStrips()
      set({ project: p, selectedClipId: null, ...resetPlayback })
      void get().refreshSpend()
      void offerQueueRestore(get)
    }
  },
  refresh: async () => {
    const p = await window.vidancer.projectGet()
    set({ project: p })
  },
  openLast: async () => {
    if (!(await guardCodirSwitch(get))) return
    const p = await window.vidancer.projectOpenLast()
    if (p) {
      clearStrips()
      set({ project: p, selectedClipId: null, ...resetPlayback })
      void get().refreshSpend()
      void offerQueueRestore(get)
    }
  },
  openPath: async (dir) => {
    if (!(await guardCodirSwitch(get))) return
    const p = await window.vidancer.projectOpenPath(dir)
    if (p) {
      clearStrips()
      set({ project: p, selectedClipId: null, ...resetPlayback })
      void get().refreshSpend()
      void offerQueueRestore(get)
    } else toast('couldn’t open that project (moved or deleted?)', { kind: 'error' })
  },
  spendTotal: 0,
  refreshSpend: async () => {
    const r = await window.vidancer.spendList()
    set({ spendTotal: r.total })
  },
  addSpend: async (entry) => {
    const r = await window.vidancer.spendAdd(entry)
    if (r) set({ spendTotal: r.total })
  },
  saveState: async (name) => {
    const r = await window.vidancer.projectStateSave(name)
    if (r) toast(`snapshot “${r.name}” saved`, { kind: 'ok' })
    else toast('snapshot save failed', { kind: 'error' })
    return !!r
  },
  restoreState: async (file) => {
    const p = await window.vidancer.projectStateRestore(file)
    if (!p) {
      toast('couldn’t restore that snapshot', { kind: 'error' })
      return
    }
    set((s) => restorePatch(s, p))
    toast('snapshot restored — Ctrl+Z brings the previous state back', { kind: 'ok' })
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
  importVideo: async () => {
    const r = await window.vidancer.videoImport()
    if (r?.delta) get().applyDelta(r.delta)
    const n = r?.importedIds.length ?? 0
    if (n > 0) toast(`${n} video${n === 1 ? '' : 's'} imported`, { kind: 'ok' })
    if (r?.failed.length) toast(`couldn't import: ${r.failed.join(', ')}`, { kind: 'error' })
  },
  importVideoPaths: async (paths) => {
    const r = await window.vidancer.videoImportPaths(paths)
    if (r?.delta) get().applyDelta(r.delta)
    const n = r?.importedIds.length ?? 0
    if (n > 0) toast(`${n} video${n === 1 ? '' : 's'} imported`, { kind: 'ok' })
    if (r?.failed.length) toast(`couldn't import: ${r.failed.join(', ')}`, { kind: 'error' })
    return r?.importedIds ?? []
  },
  renameVideo: async (id, title) => {
    get().applyDelta(await window.vidancer.videoRename(id, title))
  },
  deleteVideo: async (id) => {
    get().applyDelta(await window.vidancer.videoDelete(id))
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
  cancelExport: () => {
    cancelBake()
    void window.vidancer.exportCancel()
  },
  startExport: async (timelineId) => {
    if (get().exportState.busy) return
    const p = get().project
    const tl = p?.timelines.find((t) => t.id === timelineId)
    if (!p || !tl) return
    set({ exportState: { busy: true, msg: 'export starting…' } })
    // EFFECTS: bake every fx span BEFORE the classic export runs, then hand the baked segments
    // to export:run for splicing. No fx anywhere → bakeFxSpans returns [] instantly. PARITY LAW:
    // a bake failure aborts the export loudly — effects are never silently dropped.
    let bakes: import('./fx/baker').ExportBake[]
    try {
      bakes = await bakeFxSpans(p, tl, (msg) => set((s) => ({ exportState: { ...s.exportState, msg } })))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'cancelled') {
        set({ exportState: { busy: false, msg: '' } })
      } else {
        set({ exportState: { busy: false, msg: `export error: ${msg}` } })
        toast(`export failed (effects bake): ${msg}`, { kind: 'error' })
      }
      return
    }
    const r = await window.vidancer.exportRun(timelineId, bakes.length ? bakes : undefined)
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
  createStyle: async (name) => {
    const r = await window.vidancer.styleNew(name)
    if (!r) return null
    get().applyDelta(r.delta)
    return r.styleId
  },
  createCharSheet: async (name) => {
    const r = await window.vidancer.charSheetNew(name)
    if (!r) return null
    get().applyDelta(r.delta)
    return r.sheetId
  },
  saveCharSheet: async (id, patch) => {
    get().applyDelta(await window.vidancer.charSheetSet(id, patch))
  },
  deleteCharSheet: async (id) => {
    get().applyDelta(await window.vidancer.charSheetDelete(id))
  },
  reorderItems: async (kind, movedIds, targetId) => {
    get().applyDelta(await window.vidancer.itemsReorder(kind, movedIds, targetId))
  },
  saveStyle: async (id, patch) => {
    get().applyDelta(await window.vidancer.styleSet(id, patch))
  },
  deleteStyle: async (id) => {
    get().applyDelta(await window.vidancer.styleDelete(id))
  },
  deleteClip: async (id) => {
    get().applyDelta(await window.vidancer.clipDelete(id))
  },
  deleteClips: async (ids) => {
    get().applyDelta(await window.vidancer.clipsDelete(ids))
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
  deleteImages: async (ids) => {
    get().applyDelta(await window.vidancer.imagesDelete(ids))
  },
  makeClipsFromImages: async (imageIds, insertIndex) => {
    const p = get().project
    if (!p || imageIds.length === 0) return
    const place = insertIndex != null ? { timelineId: p.activeTimelineId, index: insertIndex } : undefined
    const r = await window.vidancer.clipsFromImages(imageIds, place)
    if (!r) return
    get().applyDelta(r.delta)
    const n = r.clipIds.length
    toast(`${n} clip${n === 1 ? '' : 's'} created from image${n === 1 ? '' : 's'}${place ? ' → timeline' : ''}`, { kind: 'ok' })
    if (n === 1) set({ selectedClipId: r.clipIds[0], editTimelineIndex: null })
  },
  makeBeatsClipFromImages: async (imageIds) => {
    if (imageIds.length === 0) return
    const r = await window.vidancer.clipFromImagesAsBeats(imageIds)
    if (!r) return
    get().applyDelta(r.delta)
    toast(`1 clip with ${imageIds.length} beat${imageIds.length === 1 ? '' : 's'} created`, { kind: 'ok' })
    set({ selectedClipId: r.clipId, editTimelineIndex: null })
  },
  cropImage: async (rootImageId, parentNodeId, bytes, label) => {
    const from = get().project?.images.find((i) => i.id === rootImageId)?.file
    const r = await window.vidancer.imageCropSave({ rootImageId, parentId: parentNodeId, bytes, label })
    if (!r) return null
    get().applyDelta(r.delta)
    // same signal setPrimaryNode sends — open editors holding the old file path swap to the new one
    const to = r.delta.images?.[0]?.file
    if (from && to && from !== to) set((st) => ({ fileSwap: { from, to, n: st.fileSwap.n + 1 } }))
    return r.nodeId
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
  moveItems: async (kind, itemIds, folderId) => {
    get().applyDelta(await window.vidancer.itemMove(kind, itemIds, folderId))
  },

  addToTimeline: async (clipId, takeId) => {
    const p = get().project
    if (!p) return
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const cur = activeItems(p)
    // v14: append at the END of the sequence on track V1 (absolute position)
    const end = timelineEnd(cur, p.clips)
    const items = [...cur, { id, clipId, startSec: end, track: 0, ...(takeId ? { takeId } : {}) }]
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
  setClipStoryboard: async (clipId, imageId) => {
    get().applyDelta(await window.vidancer.clipSetStoryboard(clipId, imageId))
  },
  setTakeMeta: async (clipId, takeId, patch) => {
    get().applyDelta(await window.vidancer.takeSetMeta(clipId, takeId, patch))
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
  setTimelineAudioItems: async (audioItems, tlId) => {
    const p = get().project
    if (!p) return
    const targetId = tlId ?? p.activeTimelineId
    const baseRev = p.timelines.find((t) => t.id === targetId)?.rev ?? 0
    get().applyDelta(await window.vidancer.timelineSetAudioItems(targetId, audioItems, baseRev))
  },
  setTimelineBoth: async (items, audioItems, tlId) => {
    const p = get().project
    if (!p) return
    const targetId = tlId ?? p.activeTimelineId
    const baseRev = p.timelines.find((t) => t.id === targetId)?.rev ?? 0
    get().applyDelta(await window.vidancer.timelineSetBoth(targetId, items, audioItems, baseRev))
  },
  // take/S-B switch WITH ripple: the block's footprint delta (new eff − old eff) shifts everything
  // after its old end — every unlocked channel + free audio — so the sequence stays flush. Shorter
  // takes pull left (clamped so nothing collides), longer push right. Trims are untouched here: a
  // cut block keeps its window (clamped downstream by effDur), an S-B switch clears them as always.
  setSlotView: async (itemId, view) => {
    const p = get().project
    if (!p) return
    const tl = activeTimeline(p)
    const items = activeItems(p)
    const it = items.find((x) => x.id === itemId)
    if (!it || !tl) return
    const next: TimelineItem = view.useRecipe
      ? { ...it, useRecipe: true, takeId: undefined, inSec: undefined, outSec: undefined }
      : { ...it, takeId: view.takeId, useRecipe: undefined }
    const oldEff = effDur(it, p.clips)
    const newEff = effDur(next, p.clips)
    const oldEnd = startOf(it) + oldEff
    const locked = new Set(tl.lockedTracks ?? [])
    let delta = newEff - oldEff
    if (delta < -0.001) delta = clampShiftLeft(items, p.clips, oldEnd, delta, { id: it.id, newEnd: startOf(it) + newEff })
    const doShift = Math.abs(delta) > 0.001
    // video + shifted free audio in ONE mutation — a take switch is one action, one Ctrl+Z
    const aud = tl.audioItems ?? []
    const shifts = (a: TimelineAudioItem): boolean => !a.link && (a.startSec ?? 0) >= oldEnd - 0.001
    const nextAud = doShift && aud.some(shifts) ? aud.map((a) => (shifts(a) ? { ...a, startSec: Math.max(0, (a.startSec ?? 0) + delta) } : a)) : null
    await get().setTimelineBoth(
      items.map((x) => {
        if (x.id === itemId) return next
        if (doShift && !locked.has(`v${trackOf(x)}`) && startOf(x) >= oldEnd - 0.001) return { ...x, startSec: Math.max(0, startOf(x) + delta) }
        return x
      }),
      nextAud,
      tl.id
    )
  },
  setTimelineMeta: async (patch, tlId) => {
    const p = get().project
    if (!p) return
    get().applyDelta(await window.vidancer.timelineSetMeta(tlId ?? p.activeTimelineId, patch))
  },
  unlinkAudio: async (itemId) => {
    const p = get().project
    if (!p) return
    const d = await window.vidancer.timelineUnlinkAudio(p.activeTimelineId, itemId)
    if (d) {
      get().applyDelta(d)
      toast('audio detached → lane (video muted) · right-click the audio block to re-link', { kind: 'ok' })
    } else toast('no rendered take on that block — nothing to detach', { kind: 'error' })
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
  setEditorVideo: (root) => set({ editorVideoRoot: root }),
  makeClipFromVideo: async (videoId) => {
    const r = await window.vidancer.videoMakeClip(videoId)
    if (!r) {
      toast('could not make a clip from that video', { kind: 'error' })
      return null
    }
    get().applyDelta(r.delta)
    get().selectClip(r.clipId)
    toast('clip created — the video is take 1', { kind: 'ok' })
    return r.clipId
  },
  addVideoTakeToClip: async (videoId, clipId) => {
    const r = await window.vidancer.videoAddTakeToClip(videoId, clipId)
    if (!r) {
      toast('could not add the video as a take', { kind: 'error' })
      return
    }
    get().applyDelta(r.delta)
    toast('added as a take ✓', { kind: 'ok' })
  },
  setEditorSheet: (id) => set({ editorSheetId: id }),
  setEditTarget: (t) => set({ editTarget: t }),
  setTileZoom: (kind, w) => {
    const v = Math.round(Math.max(56, Math.min(220, w)))
    set((s) => ({ tileZoom: { ...s.tileZoom, [kind]: v } }))
    clearTimeout(zoomPersistTimer)
    zoomPersistTimer = setTimeout(() => {
      const z = get().tileZoom
      void window.vidancer.setSettings({ tileZoomBin: z.bin, tileZoomLib: z.lib })
    }, 600)
  },
  setPreviewH: (kind, h) => {
    const v = Math.round(Math.max(120, Math.min(2000, h))) // real ceiling = the panel, clamped at drag time
    set((s) => ({ previewH: { ...s.previewH, [kind]: v } }))
    clearTimeout(previewHPersistTimer)
    previewHPersistTimer = setTimeout(() => {
      const p = get().previewH
      void window.vidancer.setSettings({ previewHRender: p.render, previewHClipEdit: p.clipEdit })
    }, 600)
  },

  // ----- render queue: enqueue → pump runs the first pending job → on completion pump again -----
  enqueueRender: (job) => {
    // double-fire guard: an accidental double-click (or a re-fired handler) quietly queueing two
    // identical PAID renders is the cheapest money bug to prevent — identical payload within 2s = one job
    const sig = `${job.kind}|${JSON.stringify(job.payload)}`
    const now = Date.now()
    if (lastEnqueue.sig === sig && now - lastEnqueue.at < 2000) {
      toast('already queued (double-click guard)', { kind: 'ok' })
      return
    }
    lastEnqueue.sig = sig
    lastEnqueue.at = now
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const projectDir = get().project?.dir
    set((s) => ({ queue: [...s.queue, { ...job, id, projectDir, status: 'pending' as const, payload: { ...job.payload, jobId: id } }] }))
    openQueue() // the queue is where the money is — surface it whenever something joins
    persistQueueSoon(get)
    get().pumpQueue()
  },
  cancelJob: (id) => {
    const j = get().queue.find((x) => x.id === id)
    if (!j) return
    if (j.status === 'running') {
      // best effort: fal may finish anyway (it's already billing) — the result then still lands
      set((s) => ({ queue: s.queue.map((x) => (x.id === id ? { ...x, status: 'cancelled' as const, msg: 'cancelling…' } : x)) }))
      void window.vidancer.renderCancel(id)
    } else if (j.status === 'pending') {
      set((s) => ({ queue: s.queue.map((x) => (x.id === id ? { ...x, status: 'cancelled' as const, msg: undefined } : x)) }))
    } else {
      set((s) => ({ queue: s.queue.filter((x) => x.id !== id) })) // finished rows: ✕ just removes
    }
    persistQueueSoon(get)
  },
  moveJob: (id, dir) => {
    set((s) => {
      const q = [...s.queue]
      const i = q.findIndex((x) => x.id === id)
      if (i < 0 || q[i].status !== 'pending') return {}
      // swap within the PENDING subsequence — a done/error row sitting between two pending rows
      // must not block reordering (only pending rows are meaningful to order)
      let j = i + dir
      while (j >= 0 && j < q.length && q[j].status !== 'pending') j += dir
      if (j < 0 || j >= q.length) return {}
      ;[q[i], q[j]] = [q[j], q[i]]
      return { queue: q }
    })
    persistQueueSoon(get)
  },
  setQueuePaused: (paused) => {
    set({ queuePaused: paused })
    if (!paused) get().pumpQueue()
  },
  // progress lands on the job whose IPC is actually outstanding — 'running' display status lies
  // during a cancel (the flip happens while the call is still live) and would misattribute
  setRunningJobMsg: (msg) =>
    set((s) => (s.queue.some((j) => j.inFlight) ? { queue: s.queue.map((j) => (j.inFlight ? { ...j, msg } : j)) } : {})),
  consumeJob: (id) => set((s) => ({ queue: s.queue.map((j) => (j.id === id ? { ...j, consumed: true } : j)) })),
  clearFinishedJobs: () => {
    set((s) => ({ queue: s.queue.filter((j) => j.status === 'pending' || j.status === 'running') }))
    persistQueueSoon(get)
  },
  pumpQueue: () => {
    const s = get()
    // one PAID call at a time — gate on the IPC being genuinely outstanding, not on display
    // status (cancelling a running job flips its status while the call is still live; the old
    // status gate then started a SECOND concurrent paid job)
    if (s.queue.some((j) => j.inFlight)) return
    const dir = s.project?.dir
    // jobs stamped for another project PARK (visible, never started here): starting them would
    // render project A's recipe into project B — main would even mint a new clip for it
    const parked = s.queue.filter((j) => j.status === 'pending' && j.projectDir && dir && j.projectDir !== dir)
    if (parked.some((j) => j.msg !== 'parked — belongs to another project')) {
      set((s2) => ({ queue: s2.queue.map((j) => (parked.some((p) => p.id === j.id) ? { ...j, msg: 'parked — belongs to another project' } : j)) }))
    }
    const next = s.queue.find((j) => j.status === 'pending' && (!j.projectDir || !dir || j.projectDir === dir))
    if (!next) {
      // idle-truth BEFORE the paused gate — pausing with nothing running must not latch the busy badges
      if (s.renderBusy) set({ renderBusy: false })
      return
    }
    if (s.queuePaused) {
      if (s.renderBusy) set({ renderBusy: false })
      return
    }
    const history = s.renderStats[statsKeyFor(next)]
    const etaSec = history?.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : undefined
    set({
      queue: s.queue.map((j) => (j.id === next.id ? { ...j, status: 'running' as const, inFlight: true, msg: 'starting…', startedAt: Date.now(), etaSec } : j)),
      renderBusy: true
    })
    void (async () => {
      const job = next
      const r =
        job.kind === 'gen'
          ? await window.vidancer.render(job.payload as RenderArgs)
          : job.kind === 'edit'
            ? await window.vidancer.editRun(job.payload as EditArgs)
            : await window.vidancer.veditRun(job.payload as VeditArgs)
      // the IPC has genuinely returned — only now may the pump start another paid job
      set((s2) => ({ queue: s2.queue.map((j) => (j.id === job.id ? { ...j, inFlight: false } : j)) }))
      const runningJob = get().queue.find((j) => j.id === job.id)
      const wasCancelled = runningJob?.status === 'cancelled'
      if (r.ok && r.delta) {
        // feed the ETA history with what this job REALLY took (kept short, persisted debounced)
        if (runningJob?.startedAt) {
          const took = Math.round((Date.now() - runningJob.startedAt) / 1000)
          const key = statsKeyFor(job)
          const stats = { ...get().renderStats, [key]: [...(get().renderStats[key] ?? []), took].slice(-STATS_KEEP) }
          set({ renderStats: stats })
          clearTimeout(statsPersistTimer)
          statsPersistTimer = setTimeout(() => void window.vidancer.setSettings({ renderStats: get().renderStats }), 1000)
        }
        get().applyDelta(r.delta)
        // gen from an edited timeline slot: adopt the fresh take into THAT slot (by stable id) —
        // through setSlotView so a different-length take ripples what follows, same as any switch
        const doneTakeId = (r as RenderResult).takeId
        if (job.adoptSlotItemId && doneTakeId) {
          const items = activeItems(get().project)
          if (items.some((x) => x.id === job.adoptSlotItemId)) void get().setSlotView(job.adoptSlotItemId, { takeId: doneTakeId })
        }
        set((s2) => ({
          queue: s2.queue.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: 'done' as const,
                  msg: wasCancelled ? 'finished before the cancel landed' : 'done ✓',
                  resultClipId: (r as RenderResult).clipId,
                  resultTakeId: (r as RenderResult).takeId,
                  resultNodeId: (r as VeditResult).nodeId,
                  resultFile: r.file
                }
              : j
          )
        }))
        toast(`${job.label}: ${job.kind === 'gen' ? 'render' : 'edit'} done ✓`, { kind: 'ok' })
        void get().addSpend({ label: job.label, kind: job.kind === 'vedit' ? 'edit' : job.kind, cost: job.estCost ?? 0 }) // ledger: money moved
        void get().refreshCredit()
      } else {
        const baseErr = r.error ?? 'unknown'
        set((s2) => ({
          queue: s2.queue.map((j) =>
            j.id === job.id ? { ...j, status: wasCancelled ? ('cancelled' as const) : ('error' as const), msg: undefined, error: baseErr } : j
          )
        }))
        // a render REFUSED post-completion (project switched mid-render) was still BILLED — the
        // ledger must not under-report; the marker label keeps the attribution honest
        if ((r as { billed?: boolean }).billed) {
          void get().addSpend({ label: `${job.label} (finished after project switch)`, kind: job.kind === 'vedit' ? 'edit' : job.kind, cost: job.estCost ?? 0 })
        }
        if (!wasCancelled) {
          let msg = baseErr
          // auth/billing failure → append the LIVE balance so "no credit" is visible at a glance
          if (/error \((401|402|403)\)/.test(baseErr)) {
            try {
              const cr = await window.vidancer.falCredit()
              if (cr.ok && cr.balance != null) {
                const bal = !cr.currency || cr.currency === 'USD' ? `$${cr.balance.toFixed(2)}` : `${cr.balance.toFixed(2)} ${cr.currency}`
                msg = `${baseErr} · your fal balance: ${bal}`
                set((s2) => ({ queue: s2.queue.map((j) => (j.id === job.id ? { ...j, error: msg } : j)) }))
              }
            } catch {
              /* the balance probe is best-effort */
            }
          }
          toast(`${job.label}: failed — ${msg}`, { kind: 'error' })
        }
      }
      persistQueueSoon(get)
      get().pumpQueue()
    })()
  },
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
  toggleLoop: () => set((s) => ({ tlLoop: !s.tlLoop })),
  // user seek/scrub — the clock jumps and the Monitor hard-seeks its media (playing state unchanged)
  tlSeek: (t) => set((s) => ({ tlTime: Math.max(0, t), seekTick: s.seekTick + 1 })),
  // the playback engine's per-frame clock write — NO seek signal (the media is already there)
  tlSetTime: (t) => set({ tlTime: Math.max(0, t) })
}))
