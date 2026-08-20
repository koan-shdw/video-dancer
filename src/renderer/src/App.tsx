import { useEffect, useRef, useState } from 'react'
import { EmptyState } from './ui/EmptyState'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview'
import { LibraryPanel, BinPanel, MonitorPanel, SourceMonitor, TimelinePanel, TimelineEditorPanel, ImageEditorPanel, VideoEditorPanel, RenderPanel, CharSheetPanel, QueuePanel, WatchPanel, SettingsModal, WorkspacesModal, NewProjectModal, ProjectStylesPanel, CoDirectorPanel, DirectorsRoom, EffectsPanel, ScoreCardPanel, VoicesCardPanel, ModelsCardPanel } from './panels'
import { PanelErrorBoundary } from './ui/PanelErrorBoundary'
import { Toasts } from './ui/Toast'
import { AboutModal } from './panels/AboutModal'
import { CheatSheet } from './panels/CheatSheet'
import { WelcomeModal } from './panels/WelcomeModal'
import { TourOverlay } from './ui/TourOverlay'
import { WhatsNewModal } from './ui/WhatsNew'
import { Modal } from './ui/Modal'
import { Ic, Maximize2, Minimize2, Settings2, HelpCircle, RotateCcw, Plus, FolderOpen, Pencil, Copy, Trash2, FolderInput } from './ui/icons'
import { confirmDialog, textPrompt } from './prompt'
import { ContextMenu } from './ui/ContextMenu'
import { toast } from './ui/Toast'
import { setFolderOpener, setTimelineEditorOpener, setImageEditorOpener, setVideoEditorOpener, setClipEditorOpener, setCharSheetOpener, setScoreCardOpener, setVoicesCardOpener, setModelsCardOpener, openModelsCard, setClipMonitorOpener, setQueueOpener, setWatchOpener, setTimelineMonitorOpener, setProjectStylesOpener, setEffectsOpener, toggleClipMonitorPlay, toggleClipGenPlay, markClipGenInOut } from './panelBus'
import { activeItems, activeTimeline, editPoints, audioEndOf, timelineEnd } from './lib/timelineUtils'
import { applyTheme, resolveTheme } from './lib/themes'
import { useStore } from './store'

// every panel gets an error boundary: one panel throwing must not take down the whole layout
const guard = (name: string, node: React.ReactNode): React.JSX.Element => (
  <PanelErrorBoundary name={name}>{node}</PanelErrorBoundary>
)
const components: Record<string, React.FC<IDockviewPanelProps>> = {
  library: () => guard('Library', <LibraryPanel />),
  bin: () => guard('Bin', <BinPanel />),
  monitor: () => guard('Timeline Monitor', <MonitorPanel />),
  source: () => guard('Clip Monitor', <SourceMonitor />),
  timeline: () => guard('Timeline', <TimelinePanel />),
  tleditor: () => guard('Timeline Editor', <TimelineEditorPanel />),
  imageeditor: () => guard('Image Editor', <ImageEditorPanel />),
  videoeditor: () => guard('Video Editor', <VideoEditorPanel />),
  render: () => guard('Clip Gen', <RenderPanel />),
  // retired panel id — kept ONLY so old saved layouts restore without blanking the dock; the
  // sweep in applyWorkspace removes the tab right after restore (only the Video Editor exists)
  clipedit: () =>
    guard(
      'Clip Edit',
      <EmptyState>
        Merged into the <b>Video Editor</b>. ⑂ anywhere opens it.
      </EmptyState>
    ),
  charsheet: () => guard('Char Sheet', <CharSheetPanel />),
  scorecard: () => guard('Score Gen', <ScoreCardPanel />),
  voices: () => guard('Voice Gen', <VoicesCardPanel />),
  models: () => guard('Models', <ModelsCardPanel />),
  queue: () => guard('Queue', <QueuePanel />),
  watch: () => guard('Watched', <WatchPanel />),
  styles: () => guard('Project Styles', <ProjectStylesPanel />),
  codirector: () => guard('Co-Director', <CoDirectorPanel />),
  fx: () => guard('Effects', <EffectsPanel />),
  folderbin: (props) => {
    const p = (props.params ?? {}) as { folderId?: string; kind?: 'bin' | 'lib' }
    return guard('Folder', p.kind === 'lib' ? <LibraryPanel rootFolder={p.folderId} /> : <BinPanel rootFolder={p.folderId} />)
  }
}

const wsMenuItem: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }

// every dockview panel the Window menu (and the panelBus openers) can open or raise.
// prefer = where a re-added panel docks, first live reference wins; none alive → dockview appends.
type PanelDef = { id: string; title: string; prefer: { ref: string; direction: 'within' | 'right' | 'below' | 'left' }[] }
const PANEL_DEFS: PanelDef[] = [
  { id: 'monitor', title: 'Timeline Monitor', prefer: [{ ref: 'source', direction: 'within' }, { ref: 'timeline', direction: 'within' }] },
  { id: 'source', title: 'Clip Monitor', prefer: [{ ref: 'monitor', direction: 'within' }] },
  { id: 'charsheet', title: 'Char Sheet', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'imageeditor', direction: 'within' }] },
  { id: 'scorecard', title: 'Score Gen', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'charsheet', direction: 'within' }, { ref: 'monitor', direction: 'right' }] },
  { id: 'voices', title: 'Voice Gen', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'scorecard', direction: 'within' }, { ref: 'monitor', direction: 'right' }] },
  { id: 'models', title: 'Models', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'scorecard', direction: 'within' }, { ref: 'monitor', direction: 'right' }] },
  { id: 'timeline', title: 'Timeline', prefer: [{ ref: 'monitor', direction: 'below' }] },
  { id: 'render', title: 'Clip Gen', prefer: [{ ref: 'monitor', direction: 'right' }] },
  { id: 'fx', title: 'Effects', prefer: [{ ref: 'tleditor', direction: 'within' }, { ref: 'source', direction: 'within' }, { ref: 'monitor', direction: 'right' }] },
  { id: 'library', title: 'Library', prefer: [{ ref: 'bin', direction: 'within' }, { ref: 'monitor', direction: 'left' }] },
  { id: 'bin', title: 'Bin', prefer: [{ ref: 'library', direction: 'within' }, { ref: 'monitor', direction: 'left' }] },
  { id: 'watch', title: 'Watched', prefer: [{ ref: 'library', direction: 'within' }, { ref: 'bin', direction: 'within' }] },
  { id: 'queue', title: 'Queue', prefer: [{ ref: 'bin', direction: 'within' }, { ref: 'library', direction: 'within' }] },
  { id: 'imageeditor', title: 'Image Editor', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'monitor', direction: 'within' }] },
  { id: 'videoeditor', title: 'Video Editor', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'monitor', direction: 'within' }] },
  { id: 'tleditor', title: 'Timeline Editor', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'monitor', direction: 'within' }] },
  { id: 'styles', title: 'Project Styles', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'monitor', direction: 'within' }] },
  { id: 'codirector', title: 'Co-Director', prefer: [{ ref: 'render', direction: 'within' }, { ref: 'monitor', direction: 'right' }] }
]

function defaultLayout(api: DockviewApi): void {
  api.clear()
  const monitor = api.addPanel({ id: 'monitor', component: 'monitor', title: 'Timeline Monitor' })
  const library = api.addPanel({
    id: 'library',
    component: 'library',
    title: 'Library',
    position: { referencePanel: monitor.id, direction: 'left' }
  })
  api.addPanel({ id: 'bin', component: 'bin', title: 'Bin', position: { referencePanel: library.id, direction: 'below' } })
  api.addPanel({ id: 'render', component: 'render', title: 'Clip Gen', position: { referencePanel: monitor.id, direction: 'right' } })
  api.addPanel({ id: 'source', component: 'source', title: 'Clip Monitor', position: { referencePanel: monitor.id, direction: 'within' } })
  api.addPanel({ id: 'timeline', component: 'timeline', title: 'Timeline', position: { referencePanel: monitor.id, direction: 'below' } })
  monitor.api.setActive() // Program (monitor) is the default-active tab; Source comes forward on double-click
}

// older / restored layouts may predate the Source panel — make sure it exists
function ensureSource(api: DockviewApi): void {
  if (!api.getPanel('source') && api.getPanel('monitor')) {
    api.addPanel({ id: 'source', component: 'source', title: 'Clip Monitor', position: { referencePanel: 'monitor', direction: 'within' } })
    api.getPanel('monitor')?.api.setActive()
  }
}

// apply a named workspace's layout ('Default' = the built-in arrangement; never restore an empty layout)
function applyWorkspace(api: DockviewApi, name: string, ws: Record<string, unknown>): void {
  const lay = name === 'Default' ? null : (ws[name] as { panels?: Record<string, unknown> } | undefined)
  const hasPanels = !!lay && !!lay.panels && Object.keys(lay.panels).length > 0
  if (hasPanels) {
    try {
      api.fromJSON(lay as Parameters<DockviewApi['fromJSON']>[0])
      // layouts saved before the panel renames restore their OLD tab titles — re-apply here (the
      // title effect only fires on selection/project changes, not on a workspace switch)
      api.getPanel('render')?.setTitle(useStore.getState().renderBusy ? '⏳ Clip Gen' : 'Clip Gen')
      api.getPanel('monitor')?.setTitle('Timeline Monitor')
      api.getPanel('scorecard')?.setTitle('Score Gen') // renamed 2026-08-20 — the Gen family
      api.getPanel('voices')?.setTitle('Voice Gen')
    } catch {
      defaultLayout(api)
    }
  } else {
    defaultLayout(api)
  }
  if (api.totalPanels === 0) defaultLayout(api) // safety net
  ensureSource(api)
  // Clip Edit is GONE (merged into the Video Editor 2026-08-11) — a saved layout that still
  // carries its tab gets it swept on restore instead of showing a tombstone (user call
  // 2026-08-20: only the Video Editor exists)
  const dead = api.getPanel('clipedit')
  if (dead) api.removePanel(dead)
}

export default function App(): React.JSX.Element {
  const apiRef = useRef<DockviewApi | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const prevEditIdxRef = useRef<number | null>(null) // detects an ACTUAL slot double-click vs a project refresh
  const prevPreviewRef = useRef<string | null>(null) // detects an ACTUAL preview-target change vs a project refresh
  const project = useStore((s) => s.project)
  const openProject = useStore((s) => s.openProject)
  const editTimelineIndex = useStore((s) => s.editTimelineIndex)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const renderBusy = useStore((s) => s.renderBusy)
  const exportBusy = useStore((s) => s.exportState.busy)
  const falCredit = useStore((s) => s.falCredit)
  const refreshCredit = useStore((s) => s.refreshCredit)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [whatsNew, setWhatsNew] = useState(false) // first launch after an update → the feature card
  const [showCheats, setShowCheats] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [winMenu, setWinMenu] = useState(false) // header Window dropdown — reopen/raise any panel
  const [recents, setRecents] = useState<string[]>([])
  const [recentsMenu, setRecentsMenu] = useState(false)
  // the Open picker: recent projects as thumbnail cards (null = closed)
  const [openPicker, setOpenPicker] = useState<{ loading: boolean; cards: ProjectCard[] } | null>(null)
  const [pickerMenu, setPickerMenu] = useState<{ x: number; y: number; card: ProjectCard } | null>(null) // right-click on an Open-picker card
  // the PLAYGROUND shelf under the picker: sample projects — the shelf card is the factory master
  // (download once), every click stamps a fresh copy into the projects list as a NORMAL project
  const [playgrounds, setPlaygrounds] = useState<PlaygroundCard[]>([])
  const [pgProg, setPgProg] = useState<Record<string, { pct: number; msg?: string }>>({})
  const [pgBusy, setPgBusy] = useState<string | null>(null)
  const [pgMenu, setPgMenu] = useState<{ x: number; y: number; pg: PlaygroundCard } | null>(null)
  const stampPlayground = async (pg: PlaygroundCard): Promise<void> => {
    if (pgBusy) return
    setPgBusy(pg.id)
    setPgProg((m) => ({ ...m, [pg.id]: { pct: 0, msg: pg.cached ? 'stamping a fresh copy…' : 'starting download…' } }))
    try {
      const r = await window.vidancer.playgroundStamp(pg.id)
      if (r.ok && r.dir) {
        setOpenPicker(null)
        await useStore.getState().openPath(r.dir)
        toast('playground stamped ✓ — wreck it freely, the shelf stamps a clean copy anytime', { kind: 'ok' })
      } else if (r.error) {
        toast(`playground: ${r.error}`, { kind: 'error' })
      }
    } finally {
      setPgBusy(null)
      setPgProg((m) => {
        const n = { ...m }
        delete n[pg.id]
        return n
      })
      void window.vidancer.playgroundList().then(setPlaygrounds)
    }
  }
  // "Save as" = named save states of the current project (list + create live in one modal)
  const [statesModal, setStatesModal] = useState<{ states: ProjectStateInfo[]; name: string } | null>(null)
  // SPND: the per-project spend total (chip) + the itemized dropdown
  const spendTotal = useStore((s) => s.spendTotal)
  const [spendMenu, setSpendMenu] = useState<{ entries: SpendEntry[]; loading: boolean } | null>(null)
  const [update, setUpdate] = useState<{ status: string; version?: string; message?: string } | null>(null)
  // a style link-chip double-click (Clip Gen) opens the Project Styles panel on that style
  useEffect(() => {
    setProjectStylesOpener((styleId) => {
      if (styleId) useStore.getState().setStylesFocus(styleId)
      ensurePanel('styles')
    })
    return () => setProjectStylesOpener(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // the output-mirror window was closed on its own display (Esc / Alt+F4) → the toolbar resets
  useEffect(() => window.vidancer.onMirrorClosed(() => useStore.getState().setMirrorDisplay(null)), [])
  // auto-update status from main → a header chip (downloading… → restart to update; errors show too)
  useEffect(
    () =>
      window.vidancer.onUpdateStatus((s) => {
        const info = s.info as { version?: string; message?: string } | undefined
        setUpdate({ status: s.status, version: info?.version, message: info?.message })
      }),
    []
  )
  const [maximized, setMaximized] = useState(false) // a panel group is filling the whole workspace
  // first-run guard: rendering needs at least ONE supplier key — surface that BEFORE the first
  // failed render. Per-supplier flags also drive the header chips (one per connected supplier).
  const [keysSet, setKeysSet] = useState<{ fal: boolean; hf: boolean; ark: boolean; astria: boolean } | null>(null) // null = not checked yet
  const [keyBannerHidden, setKeyBannerHidden] = useState(false) // ✕ hides it for this session
  // SAVES FAILING banner — a persistent save failure is invisible data loss (disk full, cloud
  // lock, permissions); main reports every failure and the recovery (null) when a save lands
  const [saveError, setSaveError] = useState<string | null>(null)
  // first-launch onboarding: the API-setup window, then the spotlight tour once it closes
  const [showWelcome, setShowWelcome] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  // booted with NO project (fresh install, or the last one moved) → prompt to start one instead of
  // an app full of dead panels (a tester dragged a PNG in pre-project and everything was silent)
  const [noProjectAtBoot, setNoProjectAtBoot] = useState(false)
  const firstRunChecked = useRef(false) // the effect re-runs when Settings closes — gate onboarding to ONE evaluation
  const tourDoneRef = useRef(true) // whether settings said the tour is done (drives the after-welcome handoff)
  useEffect(() => {
    if (showSettings) return // re-check when the settings modal closes (key may have just been saved)
    void window.vidancer.getSettings().then((s) => {
      setKeysSet({ fal: !!s.falKey, hf: !!s.hfKey, ark: !!s.arkKey, astria: !!s.astriaKey })
      if (!firstRunChecked.current) {
        firstRunChecked.current = true
        tourDoneRef.current = !!s.tourDone
        applyTheme(resolveTheme(s.activeTheme, s.customThemes)) // the saved theme, before first paint settles
        if (s.tileZoomBin || s.tileZoomLib) useStore.setState({ tileZoom: { bin: s.tileZoomBin ?? 96, lib: s.tileZoomLib ?? 84 } })
        document.documentElement.style.setProperty('--tile-title', `${s.tileTitleSize ?? 10}px`)
        if (s.previewHRender || s.previewHClipEdit)
          useStore.setState({ previewH: { render: s.previewHRender ?? 200, clipEdit: s.previewHClipEdit ?? 260 } })
        if (s.tlRowH || s.tlLaneH) useStore.setState({ tlRowH: s.tlRowH ?? 56, tlLaneH: s.tlLaneH ?? 22 })
        if (s.renderStats) useStore.setState({ renderStats: s.renderStats })
        if (!s.welcomeSeen) setShowWelcome(true)
        else if (!s.tourDone) setTourOpen(true)
        // What's-New: the version changed since the last run → an update landed → the feature
        // card. Settled users only (fresh installs get welcome+tour instead, never both).
        void window.vidancer.appVersion().then((v) => {
          if (v === s.lastRunVersion) return
          if (s.welcomeSeen && s.tourDone) setWhatsNew(true)
          void window.vidancer.setSettings({ lastRunVersion: v })
        })
      }
    })
  }, [showSettings])
  const closeWelcome = (openSettingsAfter: boolean): void => {
    setShowWelcome(false)
    void window.vidancer.setSettings({ welcomeSeen: true })
    if (openSettingsAfter) setShowSettings(true)
    // hand off to the tour — but not over the Settings modal they just asked for (next launch instead)
    else if (!tourDoneRef.current) setTourOpen(true)
  }
  // spotlight anchors: header buttons by data-tour, panels via the dockview api (content > tab).
  // dockview 1.17 puts no panel-id attribute in the DOM, so the api object is the reliable path.
  const tourAnchor = (key: string): HTMLElement | null => {
    if (key === 'settings' || key === 'help') return document.querySelector<HTMLElement>(`[data-tour="${key}"]`)
    const p = apiRef.current?.getPanel(key)
    if (!p) return null
    const v = (p as unknown as { view?: { content?: { element?: HTMLElement }; tab?: { element?: HTMLElement } } }).view
    return v?.content?.element ?? v?.tab?.element ?? null
  }

  // ⛶ maximize the focused panel's group to the whole workspace (dockview-native); Esc or ⛶ restores
  const toggleMaximize = (): void => {
    const api = apiRef.current
    if (!api) return
    if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup()
    } else if (api.activePanel) {
      api.maximizeGroup(api.activePanel)
    }
  }
  // export progress (ffmpeg, main-side) → store, shown by the Timeline + Timeline Editor
  useEffect(() => window.vidancer.onExportProgress((m) => useStore.getState().setExportMsg(m)), [])
  // playground download progress → the shelf card's status line
  useEffect(() => window.vidancer.onPlaygroundProgress((p) => setPgProg((m) => ({ ...m, [p.id]: { pct: p.pct, msg: p.msg } }))), [])
  // live fal/api messages land on the RUNNING queue job (only one runs at a time, so no ambiguity)
  useEffect(() => window.vidancer.onRenderProgress((m) => useStore.getState().setRunningJobMsg(m)), [])
  useEffect(() => window.vidancer.onEditProgress((m) => useStore.getState().setRunningJobMsg(m)), [])
  // main-initiated deltas (dynamic stills re-extracting themselves) merge straight into the store
  useEffect(() => window.vidancer.onProjectDelta((d) => useStore.getState().applyDelta(d)), [])
  // save failures surface as a persistent banner until a save succeeds again
  useEffect(() => window.vidancer.onSaveError((msg) => setSaveError(msg)), [])
  // TEMP [perf] boot-jank tracer — remove after the startup measurement: every main-thread
  // stall >100ms in the first 20s lands in main.log with when + how long
  useEffect(() => {
    const born = performance.now()
    let po: PerformanceObserver | null = null
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (performance.now() - born > 20000) return
          void window.vidancer.logRenderer(`[perf] longtask ${Math.round(e.duration)}ms @ ${Math.round(e.startTime)}ms`)
        }
      })
      po.observe({ entryTypes: ['longtask'] })
    } catch {
      /* longtask unsupported */
    }
    const t = window.setTimeout(() => po?.disconnect(), 20000)
    return () => {
      po?.disconnect()
      window.clearTimeout(t)
    }
  }, [])
  // one-time notice when a project lives inside a cloud-synced folder — sync lock contention is
  // a real corruption/lost-save class (Windows 11 redirects Desktop/Documents into OneDrive by
  // default, so this is the MAINSTREAM setup, not an edge case)
  const projDirForNotice = useStore((s) => s.project?.dir)
  useEffect(() => {
    if (!projDirForNotice) return
    if (!/OneDrive|Dropbox|Google Drive/i.test(projDirForNotice)) return
    const seenKey = 'vd-cloud-notice:' + projDirForNotice
    if (localStorage.getItem(seenKey)) return
    localStorage.setItem(seenKey, '1')
    toast('this project lives in a cloud-synced folder — pause syncing during long sessions to avoid save conflicts', { kind: 'ok' })
  }, [projDirForNotice])
  // Co-Director progress: ONE app-level subscription → the store's shared run state, so the side
  // panel and the Director's Room both see the exchange even if either is closed mid-run
  useEffect(() => window.vidancer.onCodirProgress((e) => useStore.getState().codirProgress(e)), [])
  const roomOpen = useStore((s) => s.roomOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && apiRef.current?.hasMaximizedGroup()) apiRef.current.exitMaximizedGroup()
      // never hijack keys while the user is in a form control (SELECTs use Space/arrows natively)
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing) return
      const s = useStore.getState()
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          e.preventDefault()
          if (e.shiftKey) void s.redo()
          else void s.undo()
        } else if (k === 'y') {
          e.preventDefault()
          void s.redo()
        } else if (k === 'c') {
          // copy the SELECTED timeline block — but never hijack a real text-copy
          const textSelected = !(document.getSelection()?.isCollapsed ?? true)
          const it = activeItems(s.project).find((x) => x.id === s.selectedTlItemId)
          if (it && !textSelected) {
            s.setTlClipboard({ ...it })
            e.preventDefault()
          }
        } else if (k === 'v') {
          // ripple-insert at the playhead on the copied block's track (right-click a track for a
          // no-ripple "paste here"); the store action owns the shift rules
          if (s.tlClipboard) {
            e.preventDefault()
            void s.pasteTlClipboard()
          }
        }
        return
      }
      if (e.key === '?') {
        setShowCheats((v) => !v)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedScoreItemId) {
          e.preventDefault()
          void s.deleteSelectedScoreItem()
          return
        }
        if (s.selectedAudioItemId) {
          e.preventDefault()
          void s.deleteSelectedAudioItem()
          return
        }
        if (s.selectedTlItemId) {
          e.preventDefault()
          void s.deleteSelectedTlItem()
        }
        return
      }
      if (e.key === 'Escape' && s.selectedScoreItemId) s.selectScoreItem(null)
      if (e.key === 'Escape' && s.selectedAudioItemId) s.selectAudioItem(null)
      if (e.key === 'Escape' && s.selectedTlItemId) s.selectTlItem(null)
      // ---- transport (global, Premiere layout): Space play/pause · ←/→ frame step ·
      // ↑/↓ previous/next cut · Home/End first/last (block nudging = ,/. in the Timeline) ----
      const items = activeItems(s.project)
      if (e.key === ' ') {
        // the FRONTED monitor owns the spacebar: Clip Monitor active → its player, Clip Gen
        // active → its take preview, else the timeline
        if (apiRef.current?.activePanel?.id === 'source') {
          e.preventDefault()
          if (toggleClipMonitorPlay()) return // false = nothing previewed → fall through to timeline
        }
        if (apiRef.current?.activePanel?.id === 'render') {
          e.preventDefault()
          if (toggleClipGenPlay()) return // false = no take previewed → fall through to timeline
        }
        if (items.length === 0) return
        e.preventDefault() // stop page scroll / focused-control activation
        if (s.tlPlaying) s.tlPause()
        else s.tlPlay()
      } else if ((e.key === 'i' || e.key === 'o') && !e.ctrlKey && !e.metaKey && apiRef.current?.activePanel?.id === 'render') {
        // I / O mark the Clip Gen take preview's in/out at its playhead (window rides timeline drags)
        if (markClipGenInOut(e.key === 'i' ? 'in' : 'out')) e.preventDefault()
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && items.length > 0) {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        // step the playhead one frame (Shift = 5) — Premiere's arrow keys
        const step = (1 / 24) * (e.shiftKey ? 5 : 1) * dir
        s.tlSeek(Math.max(0, Math.min(timelineEnd(items, s.project?.clips ?? [], audioEndOf(activeTimeline(s.project), s.project?.audio ?? [])), s.tlTime + step)))
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && items.length > 0) {
        e.preventDefault()
        // jump to the previous / next EDIT POINT (block starts and ends) — Premiere's ↑/↓
        const pts = editPoints(items, s.project?.clips ?? [])
        const T = s.tlTime
        if (e.key === 'ArrowUp') s.tlSeek([...pts].reverse().find((t) => t < T - 0.01) ?? 0)
        else s.tlSeek(pts.find((t) => t > T + 0.01) ?? timelineEnd(items, s.project?.clips ?? [], audioEndOf(activeTimeline(s.project), s.project?.audio ?? [])))
      } else if (e.key === 'Home' && items.length > 0) {
        e.preventDefault()
        s.tlSeek(0)
      } else if (e.key === 'End' && items.length > 0) {
        e.preventDefault()
        s.tlSeek(timelineEnd(items, s.project?.clips ?? [], audioEndOf(activeTimeline(s.project), s.project?.audio ?? [])))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- workspaces: global, named panel-layout presets (decoupled from the project) ----
  const [workspaces, setWorkspaces] = useState<Record<string, unknown>>({})
  const [activeWs, setActiveWs] = useState('Default')
  const [wsMenu, setWsMenu] = useState(false)
  const [wsManage, setWsManage] = useState(false)
  const activeRef = useRef('Default')
  const wsRef = useRef<Record<string, unknown>>({})
  const readyRef = useRef(false)
  useEffect(() => {
    activeRef.current = activeWs
  }, [activeWs])
  useEffect(() => {
    wsRef.current = workspaces
  }, [workspaces])

  const persistActiveLayout = (): void => {
    const api = apiRef.current
    if (!api || api.totalPanels === 0) return
    if (activeRef.current === 'Default') return // 'Default' stays pristine (the escape hatch)
    const next = { ...wsRef.current, [activeRef.current]: api.toJSON() }
    wsRef.current = next
    setWorkspaces(next)
    void window.vidancer.setSettings({ workspaces: next })
  }
  const switchWorkspace = (name: string): void => {
    const api = apiRef.current
    if (!api) return
    activeRef.current = name
    setActiveWs(name)
    applyWorkspace(api, name, wsRef.current)
    setWsMenu(false)
    void window.vidancer.setSettings({ activeWorkspace: name })
  }
  const addWorkspace = (raw: string): void => {
    const api = apiRef.current
    const name = raw.trim()
    if (!api || !name || name === 'Default') return
    const next = { ...wsRef.current, [name]: api.toJSON() } // save the CURRENT arrangement under the new name
    wsRef.current = next
    setWorkspaces(next)
    activeRef.current = name
    setActiveWs(name)
    void window.vidancer.setSettings({ workspaces: next, activeWorkspace: name })
  }
  const deleteWorkspace = (name: string): void => {
    if (name === 'Default') return
    const next = { ...wsRef.current }
    delete next[name]
    wsRef.current = next
    setWorkspaces(next)
    void window.vidancer.setSettings({ workspaces: next })
    if (activeRef.current === name) switchWorkspace('Default')
  }
  const renameWorkspace = (oldName: string, raw: string): void => {
    const newName = raw.trim()
    if (!newName || oldName === 'Default' || newName === 'Default' || newName === oldName || wsRef.current[newName]) return
    const next: Record<string, unknown> = {}
    for (const k of Object.keys(wsRef.current)) next[k === oldName ? newName : k] = wsRef.current[k]
    wsRef.current = next
    setWorkspaces(next)
    const active = activeRef.current === oldName ? newName : activeRef.current
    activeRef.current = active
    setActiveWs(active)
    void window.vidancer.setSettings({ workspaces: next, activeWorkspace: active })
  }
  const initWorkspaces = async (api: DockviewApi): Promise<void> => {
    const s = await window.vidancer.getSettings()
    if (typeof s.showFilmstrips === 'boolean') useStore.getState().setShowFilmstrips(s.showFilmstrips)
    useStore.getState().setSnapPrefs({
      ...(typeof s.snapPlayhead === 'boolean' ? { snapPlayhead: s.snapPlayhead } : {}),
      ...(typeof s.snapBeats === 'boolean' ? { snapBeats: s.snapBeats } : {})
    })
    const ws = (s.workspaces as Record<string, unknown> | undefined) ?? {}
    const wanted = typeof s.activeWorkspace === 'string' ? s.activeWorkspace : 'Default'
    const active = wanted === 'Default' || ws[wanted] ? wanted : 'Default'
    wsRef.current = ws
    activeRef.current = active
    setWorkspaces(ws)
    setActiveWs(active)
    applyWorkspace(api, active, ws)
    readyRef.current = true
  }

  // fetch the fal credit balance once on launch
  useEffect(() => {
    void refreshCredit()
  }, [refreshCredit])

  const c = falCredit
  const creditLabel = c.loading
    ? 'FAL …'
    : c.error
      ? 'FAL ⚠'
      : c.balance != null
        ? `FAL ${!c.currency || c.currency === 'USD' ? '$' + c.balance.toFixed(2) : c.balance.toFixed(2) + ' ' + c.currency}`
        : 'FAL —'
  const creditTitle = c.error
    ? c.error + ' — click to retry'
    : c.balance != null
      ? 'fal credit · click to refresh'
      : 'add a fal admin key in Settings to show credit'

  // open-or-raise ANY known panel (Window menu + every panelBus opener funnel through here).
  // Raise transfers into a maximized group when one exists — a panel must never surface "behind" it.
  const ensurePanel = (id: string): void => {
    const api = apiRef.current
    if (!api) return
    const existing = api.getPanel(id)
    if (existing) {
      if (api.hasMaximizedGroup()) api.maximizeGroup(existing)
      existing.api.setActive()
      return
    }
    const def = PANEL_DEFS.find((d) => d.id === id)
    if (!def) return
    const hit = def.prefer.find((p) => api.getPanel(p.ref))
    api.addPanel({ id: def.id, component: def.id, title: def.title, position: hit ? { referencePanel: hit.ref, direction: hit.direction } : undefined })
    // re-added busy panels get their ⏳ badge titles back (the badge effects only fire on state change)
    const st = useStore.getState()
    if (id === 'render') api.getPanel('render')?.setTitle(st.renderBusy ? '⏳ Clip Gen' : 'Clip Gen')
    if (id === 'queue') api.getPanel('queue')?.setTitle(st.renderBusy ? '⏳ Queue' : 'Queue')
    if (id === 'tleditor') api.getPanel('tleditor')?.setTitle(st.exportState.busy ? '⏳ Timeline Editor' : 'Timeline Editor')
  }

  const onReady = (event: DockviewReadyEvent): void => {
    apiRef.current = event.api
    void initWorkspaces(event.api) // applies the active workspace's layout
    // open a folder as its own panel, docked as a tab next to the Bin/Library (parameterized —
    // stays custom; everything else funnels through ensurePanel)
    setFolderOpener((folderId, kind, name) => {
      const api = apiRef.current
      if (!api) return
      const id = 'folder:' + folderId
      const existing = api.getPanel(id)
      if (existing) {
        existing.api.setActive()
        return
      }
      const refId = kind === 'lib' ? (api.getPanel('library') ? 'library' : 'bin') : api.getPanel('bin') ? 'bin' : 'library'
      api.addPanel({
        id,
        component: 'folderbin',
        title: name,
        params: { folderId, kind },
        position: api.getPanel(refId) ? { referencePanel: refId, direction: 'within' } : undefined
      })
    })
    setTimelineEditorOpener(() => ensurePanel('tleditor')) // Bin timeline double-click
    setImageEditorOpener(() => ensurePanel('imageeditor')) // Library image double-click
    setVideoEditorOpener(() => ensurePanel('videoeditor')) // Library video / take → "⑂ edit v2v"
    setTimelineMonitorOpener(() => ensurePanel('monitor')) // play/scrub raises (and re-adds if closed)
    setClipMonitorOpener(() => ensurePanel('source')) // timeline-block double-click ALWAYS surfaces it
    setClipEditorOpener(() => ensurePanel('render')) // Bin clip double-click
    setWatchOpener(() => ensurePanel('watch')) // watch folder picked / 👁 button
    setQueueOpener(() => ensurePanel('queue')) // a paid job joined the queue
    setCharSheetOpener(() => ensurePanel('charsheet')) // Bin ⛉ tile double-click / create
    setScoreCardOpener(() => ensurePanel('scorecard')) // Bin ♪ tile double-click / create
    setVoicesCardOpener(() => ensurePanel('voices')) // a char sheet's 🎤 button (VOICES-SPEC)
    setModelsCardOpener(() => ensurePanel('models')) // a model download started / picker offered an undownloaded model
    setEffectsOpener(() => ensurePanel('fx')) // timeline block right-click → effects
    event.api.onDidMaximizedGroupChange(() => setMaximized(event.api.hasMaximizedGroup()))
    event.api.onDidLayoutChange(() => {
      if (!readyRef.current) return // ignore the initial build
      if (event.api.totalPanels === 0) return // NEVER persist an empty layout
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(persistActiveLayout, 600)
    })
    // TEMP [perf] boot trace — remove after the startup measurement
    const perfT0 = performance.now()
    void window.vidancer.logRenderer(`[perf] dockview ready @ ${Math.round(perfT0)}ms`)
    void useStore
      .getState()
      .openLast()
      .then(() => {
        const p = useStore.getState().project
        const items = p ? (p.timelines.find((t) => t.id === p.activeTimelineId)?.items.length ?? 0) : 0
        void window.vidancer.logRenderer(
          `[perf] project ${p ? `loaded (${p.clips.length} clips, ${items} tl items, ${p.images.length} images)` : 'none'} @ ${Math.round(performance.now())}ms (open took ${Math.round(performance.now() - perfT0)}ms)`
        )
        if (!p) setNoProjectAtBoot(true)
      })
  }

  // bring the Clip Monitor forward on double-click + label its tab; also force the renamed panel titles
  // (saved/restored layouts keep their OLD titles, so re-apply the new names here)
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.getPanel('monitor')?.setTitle('Timeline Monitor')
    api.getPanel('render')?.setTitle(useStore.getState().renderBusy ? '⏳ Clip Gen' : 'Clip Gen')
    const panel = api.getPanel('source')
    if (!panel) return
    // double-clicking a timeline clip also brings the CLIP EDITOR to front — but only on the
    // double-click itself (the index CHANGING), not on every autosave that refreshes `project`.
    // Raised BEFORE the Clip Monitor below, so when the two share a group the MONITOR wins.
    if (editTimelineIndex != null && editTimelineIndex !== prevEditIdxRef.current)
      api.getPanel('render')?.api.setActive()
    prevEditIdxRef.current = editTimelineIndex
    // preview target = a double-clicked timeline slot, else the Bin-selected clip
    const slot = editTimelineIndex != null ? activeItems(project)[editTimelineIndex] : undefined
    const clipId = slot ? slot.clipId : selectedClipId
    const clip = clipId ? project?.clips.find((c) => c.id === clipId) : undefined
    // raise the Clip Monitor only when the preview TARGET actually changed — NOT on every project
    // delta (autosaves/duration backfills used to re-raise it mid-playback, covering the Timeline Monitor)
    const previewKey = clip ? `${editTimelineIndex ?? 'sel'}:${clip.id}` : null
    if (clip) {
      if (previewKey !== prevPreviewRef.current) panel.api.setActive()
      panel.setTitle(`Clip Monitor — ${clip.name}`)
    } else {
      panel.setTitle('Clip Monitor')
    }
    prevPreviewRef.current = previewKey
  }, [editTimelineIndex, selectedClipId, project])

  // busy badges: a render/export in flight marks its panel tab even when tabbed away
  useEffect(() => {
    apiRef.current?.getPanel('render')?.setTitle(renderBusy ? '⏳ Clip Gen' : 'Clip Gen')
    apiRef.current?.getPanel('queue')?.setTitle(renderBusy ? '⏳ Queue' : 'Queue')
  }, [renderBusy])
  useEffect(() => {
    apiRef.current?.getPanel('tleditor')?.setTitle(exportBusy ? '⏳ Timeline Editor' : 'Timeline Editor')
  }, [exportBusy])

  // a model download started ANYWHERE (Models card, an Effects pass, the engine pickers) →
  // the Models card raises: the row is the download UI, nothing else grows download chrome.
  // Progress mirrors into store.modelJobs so any card can gate with the live reason
  // ("model downloading, 42%") without its own listener.
  useEffect(() => {
    const offS = window.vidancer.onModelsStarted(() => openModelsCard())
    const offP = window.vidancer.onModelsProgress((p) => useStore.getState().setModelJob(p.id, Math.max(0, p.pct)))
    const offD = window.vidancer.onModelsDone((p) => useStore.getState().setModelJob(p.id, null))
    return () => {
      offS()
      offP()
      offD()
    }
  }, [])

  // when timeline playback starts, the Timeline Monitor comes to the front — always: raised in its
  // group, and if some other group is maximized, the monitor takes over the maximized view
  useEffect(() => {
    if (!tlPlaying) return
    const api = apiRef.current
    const monitor = api?.getPanel('monitor')
    if (!api || !monitor) return
    if (api.hasMaximizedGroup()) api.maximizeGroup(monitor)
    monitor.api.setActive()
  }, [tlPlaying])

  return (
    <div className="vd-app">
      <header className="vd-header">
        <span className="vd-logo" style={{ cursor: 'pointer' }} onClick={() => setShowAbout(true)} title="about · version · credits">
          Video&nbsp;Dancer
        </span>
        <span className="btn vd-hbtn" onClick={() => setShowNewProject(true)}>New</span>
        <span
          className="btn vd-hbtn"
          title="open a project — pick from recents or browse for a folder"
          onClick={async () => {
            setOpenPicker({ loading: true, cards: [] })
            void window.vidancer.playgroundList().then(setPlaygrounds) // the shelf rides along
            const cards = await window.vidancer.projectPeekRecents()
            setOpenPicker((cur) => (cur ? { loading: false, cards } : cur)) // closed mid-load → stay closed
          }}
        >
          Open
        </span>
        <span style={{ position: 'relative' }}>
          <span
            className="btn vd-hbtn"
            title="recent projects"
            onClick={async () => {
              if (!recentsMenu) setRecents(await window.vidancer.projectRecents())
              setRecentsMenu((v) => !v)
            }}
          >
            ▾
          </span>
          {recentsMenu && (
            <>
              <span onClick={() => setRecentsMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 1500 }} />
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 220, maxWidth: 360, zIndex: 1501, boxShadow: '0 10px 30px rgba(0,0,0,.5)' }}>
                {recents.length === 0 && <div style={{ ...wsMenuItem, color: 'var(--dim)', cursor: 'default' }}>no recent projects</div>}
                {recents.map((dir) => {
                  const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
                  return (
                    <div
                      key={dir}
                      title={dir}
                      onClick={() => {
                        setRecentsMenu(false)
                        void useStore.getState().openPath(dir)
                      }}
                      style={{ ...wsMenuItem, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      <Ic i={FolderOpen} size={12} /> {name}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </span>
        {project && (
          <span
            className="btn vd-hbtn"
            title="snapshots — save a named state of the whole project and come back to it anytime (media stays shared, so it's instant)"
            onClick={async () => {
              setStatesModal({ states: [], name: '' })
              const states = await window.vidancer.projectStateList()
              setStatesModal((cur) => (cur ? { ...cur, states } : cur))
            }}
          >
            Snapshots
          </span>
        )}
        <span className="vd-sub">
          {project ? (
            <>
              <Ic i={FolderOpen} size={11} /> {project.name}
            </>
          ) : (
            'no project — New / Open'
          )}
        </span>
        <span
          className="btn vd-hbtn"
          style={{ marginLeft: 'auto', opacity: maximized ? 1 : 0.7 }}
          onClick={toggleMaximize}
          title={maximized ? 'restore the layout (Esc works too)' : 'maximize the focused panel to the whole workspace'}
        >
          {maximized ? (
            <>
              <Ic i={Minimize2} /> restore
            </>
          ) : (
            <>
              <Ic i={Maximize2} /> max
            </>
          )}
        </span>
        {update && (update.status === 'ready' || update.status === 'downloading' || update.status === 'progress') && (
          <span
            className="btn vd-hbtn"
            style={update.status === 'ready' ? { background: 'var(--amber)', color: 'var(--on-accent)', fontWeight: 700 } : { opacity: 0.8 }}
            onClick={() => update.status === 'ready' && void window.vidancer.updateRestart()}
            title={update.status === 'ready' ? 'a new version was downloaded — click to restart and apply it' : 'downloading the latest version…'}
          >
            <Ic i={RotateCcw} /> {update.status === 'ready' ? `restart to update${update.version ? ` (${update.version})` : ''}` : 'updating…'}
          </span>
        )}
        {update?.status === 'error' && (
          <span
            className="btn vd-hbtn"
            style={{ color: 'var(--bad)', opacity: 0.9 }}
            onClick={() => {
              setUpdate(null)
              void window.vidancer.updateCheck()
            }}
            title={`auto-update failed: ${update.message ?? 'unknown error'} — click to retry`}
          >
            update failed ✕
          </span>
        )}
        <span style={{ position: 'relative' }}>
          <span className="btn vd-hbtn" onClick={() => setWinMenu((v) => !v)} title="open or raise any panel — closed ones come back">
            Window ▾
          </span>
          {winMenu && (
            <>
              <span onClick={() => setWinMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 1500 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 190, zIndex: 1501, boxShadow: '0 10px 30px rgba(0,0,0,.5)' }}>
                {PANEL_DEFS.map((d) => {
                  const isOpen = !!apiRef.current?.getPanel(d.id)
                  return (
                    <div
                      key={d.id}
                      onClick={() => {
                        setWinMenu(false)
                        ensurePanel(d.id)
                      }}
                      style={{ ...wsMenuItem, display: 'flex', gap: 8, alignItems: 'center' }}
                    >
                      <span style={{ width: 12, color: 'var(--ok)' }}>{isOpen ? '●' : ''}</span>
                      <span style={{ color: isOpen ? undefined : 'var(--muted)' }}>{d.title}</span>
                    </div>
                  )
                })}
                {/* the flagship surface was the ONLY major one without a Window row (it lives
                    as an overlay, not a dockview panel — reachable before only via the
                    Co-Director panel header) */}
                <div
                  onClick={() => {
                    setWinMenu(false)
                    useStore.getState().setRoomOpen(true)
                  }}
                  style={{ ...wsMenuItem, display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 6 }}
                >
                  <span style={{ width: 12, color: 'var(--ok)' }}>{roomOpen ? '●' : ''}</span>
                  <span style={{ color: roomOpen ? undefined : 'var(--muted)' }}>Director’s Room</span>
                </div>
              </div>
            </>
          )}
        </span>
        <span className="btn vd-hbtn" data-tour="help" onClick={() => setShowCheats(true)} title="shortcuts & gestures (?)">
          <Ic i={HelpCircle} />
        </span>
        <span className="btn vd-hbtn" data-tour="settings" onClick={() => setShowSettings(true)}>
          <Ic i={Settings2} /> Settings
        </span>
        <span style={{ position: 'relative' }}>
          <span className="vd-ws" style={{ cursor: 'pointer' }} onClick={() => setWsMenu((v) => !v)}>
            workspace: {activeWs} ▾
          </span>
          {wsMenu && (
            <>
              <span onClick={() => setWsMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 1500 }} />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: 'var(--bg2)',
                  border: '1px solid var(--line2)',
                  borderRadius: 6,
                  padding: 4,
                  minWidth: 190,
                  zIndex: 1501,
                  boxShadow: '0 10px 30px rgba(0,0,0,.5)'
                }}
              >
                {['Default', ...Object.keys(workspaces)].map((name) => (
                  <div
                    key={name}
                    onClick={() => switchWorkspace(name)}
                    style={{
                      ...wsMenuItem,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      background: name === activeWs ? 'color-mix(in srgb, var(--amber) 15%, transparent)' : 'transparent'
                    }}
                  >
                    <span style={{ width: 12 }}>{name === activeWs ? '✓' : ''}</span>
                    <span>{name}</span>
                  </div>
                ))}
                <div style={{ height: 1, background: 'var(--line2)', margin: '4px 0' }} />
                <div onClick={() => switchWorkspace('Default')} style={wsMenuItem}>
                  <Ic i={RotateCcw} size={12} /> Reset to Default
                </div>
                <div
                  onClick={() => {
                    setWsMenu(false)
                    setWsManage(true)
                  }}
                  style={wsMenuItem}
                >
                  <Ic i={Plus} size={12} /> Add / Manage…
                </div>
              </div>
            </>
          )}
        </span>
        {/* SPND — this project's paid-job total; click = the itemized ledger. A DIRECT header
            flex child styled byte-identically to the FAL chip (no wrapper — a plain inline
            wrapper doesn't get the flex row's box treatment and the card renders pixels off) */}
        {project && (
          <span
            onClick={async () => {
              if (spendMenu) {
                setSpendMenu(null)
                return
              }
              setSpendMenu({ entries: [], loading: true })
              const r = await window.vidancer.spendList()
              useStore.setState({ spendTotal: r.total })
              setSpendMenu((cur) => (cur ? { entries: r.entries, loading: false } : cur))
            }}
            title="spent on THIS project (estimated from model pricing — fal's billing is authoritative) · click for the itemized list"
            style={{ position: 'relative', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '3px 8px' }}
          >
            SPND ${spendTotal.toFixed(2)}
            {spendMenu && (
              <>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    setSpendMenu(null)
                  }}
                  style={{ position: 'fixed', inset: 0, zIndex: 1500, cursor: 'default' }}
                />
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 6, width: 320, maxHeight: 340, display: 'flex', flexDirection: 'column', zIndex: 1501, boxShadow: '0 10px 30px rgba(0,0,0,.5)', cursor: 'default', fontFamily: 'var(--sans)' }}>
                  <div className="vd-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
                    {spendMenu.loading && <div style={{ padding: 6, fontSize: 11, color: 'var(--dim)' }}>reading ledger…</div>}
                    {!spendMenu.loading && spendMenu.entries.length === 0 && <div style={{ padding: 6, fontSize: 11, color: 'var(--dim)' }}>nothing spent on this project yet</div>}
                    {spendMenu.entries.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 11, borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--dim)', width: 12, flex: '0 0 auto' }}>{e.kind === 'gen' ? '▶' : e.kind === 'edit' ? '⑂' : '▦'}</span>
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--body)' }}>{e.label}</span>
                        <span style={{ color: 'var(--dim)', fontSize: 9, fontFamily: 'var(--mono)', flex: '0 0 auto' }}>{new Date(e.at).toLocaleDateString()}</span>
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--txt-hi)', flex: '0 0 auto' }}>${e.cost.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '5px 4px 1px', fontSize: 11, borderTop: '1px solid var(--line2)' }}>
                    <span style={{ color: 'var(--dim)' }}>{spendMenu.entries.length} paid job{spendMenu.entries.length === 1 ? '' : 's'} · estimates</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--amber)' }}>${spendTotal.toFixed(2)}</span>
                  </div>
                </div>
              </>
            )}
          </span>
        )}
        <span
          onClick={() => void refreshCredit()}
          title={creditTitle}
          style={{
            cursor: 'pointer',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: c.error ? 'var(--bad)' : 'var(--muted)',
            border: '1px solid var(--line2)',
            borderRadius: 5,
            padding: '3px 8px'
          }}
        >
          {creditLabel}
        </span>
        {/* one chip per EXTRA connected supplier — their balances live in their consoles (no API),
            so the chip is the honest link there (law 8: no fake numbers) */}
        {keysSet?.ark && (
          <span
            onClick={() => void window.vidancer.openExternal('https://console.byteplus.com/ark')}
            title="ModelArk connected — token balance lives in the BytePlus console (click to open)"
            style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '3px 8px' }}
          >
            ARK ↗
          </span>
        )}
        {keysSet?.astria && (
          <span
            onClick={() => void window.vidancer.openExternal('https://www.astria.ai/')}
            title="Astria connected — credit balance lives on astria.ai (click to open)"
            style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '3px 8px' }}
          >
            AST ↗
          </span>
        )}
        {keysSet?.hf && (
          <span
            onClick={() => void window.vidancer.openExternal('https://cloud.higgsfield.ai/')}
            title="Higgsfield connected — credit balance lives in their dashboard (click to open) · their API has no Seedance yet"
            style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '3px 8px' }}
          >
            HF ↗
          </span>
        )}
      </header>
      {saveError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '5px 12px',
            background: 'color-mix(in srgb, var(--bad) 22%, var(--bg2))',
            borderBottom: '1px solid var(--bad)',
            fontSize: 12,
            color: 'var(--txt-hi)'
          }}
        >
          <span>⛔ SAVES FAILING — your edits are NOT reaching disk: {saveError}. Free up space / pause cloud sync; this clears the moment a save lands.</span>
        </div>
      )}
      {keysSet && !keysSet.fal && !keysSet.hf && !keysSet.ark && !keysSet.astria && !keyBannerHidden && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '5px 12px',
            background: 'color-mix(in srgb, var(--amber) 14%, var(--bg2))',
            borderBottom: '1px solid var(--amber-dim)',
            fontSize: 12,
            color: 'var(--txt)'
          }}
        >
          <span>⚠ no supplier key set — rendering won’t work until you connect one (fal recommended; usage bills your own account)</span>
          <span className="btn vd-hbtn" onClick={() => setShowSettings(true)}>open Settings</span>
          <span style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--dim)' }} onClick={() => setKeyBannerHidden(true)} title="hide for this session">
            ✕
          </span>
        </div>
      )}
      <div className="vd-dock">
        <DockviewReact className="dockview-theme-abyss" components={components} onReady={onReady} />
      </div>
      <Toasts />
      {roomOpen && <DirectorsRoom />}
      {whatsNew && <WhatsNewModal onClose={() => setWhatsNew(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          onShowWelcome={() => {
            setShowAbout(false)
            setShowWelcome(true)
          }}
          onReplayTour={() => {
            setShowAbout(false)
            setTourOpen(true)
          }}
        />
      )}
      {showCheats && <CheatSheet onClose={() => setShowCheats(false)} />}
      {/* ---- Open picker: recent projects as cards — click one to switch, Browse… for anything else ---- */}
      {openPicker && (
        <div
          onClick={() => setOpenPicker(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: 16, width: 'min(780px, 90vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <span className="lb" style={{ margin: 0 }}>
                open a project <span style={{ color: 'var(--dim)' }}>— recent first</span>
              </span>
              <span
                className="btn vd-hbtn"
                style={{ marginLeft: 'auto' }}
                title="browse for a project folder (anything not in the list)"
                onClick={() => {
                  setOpenPicker(null)
                  void openProject()
                }}
              >
                <Ic i={FolderOpen} size={12} /> Browse…
              </span>
              <span style={{ cursor: 'pointer', color: 'var(--dim)' }} onClick={() => setOpenPicker(null)}>✕</span>
            </div>
            <div className="vd-scroll" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, overflowY: 'auto', flex: 1, alignContent: 'flex-start' }}>
              {openPicker.loading && <p className="vd-hint">reading recent projects…</p>}
              {!openPicker.loading && openPicker.cards.length === 0 && (
                <p className="vd-hint">no recent projects yet — Browse… for a folder, or create a New one.</p>
              )}
              {openPicker.cards.map((c) => {
                const isCurrent = project?.dir === c.dir
                return (
                  <div
                    key={c.dir}
                    title={`${c.dir}\nclick = open · right-click = rename / duplicate / delete…`}
                    onClick={() => {
                      setOpenPicker(null)
                      if (!isCurrent) void useStore.getState().openPath(c.dir)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setPickerMenu({ x: e.clientX, y: e.clientY, card: c })
                    }}
                    style={{ width: 168, cursor: 'pointer', borderRadius: 8, outline: isCurrent ? '2px solid var(--amber)' : '1px solid var(--line)', outlineOffset: -1, padding: 5, background: 'var(--panel)' }}
                  >
                    <div style={{ width: '100%', height: 94, background: 'var(--field)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {c.thumb ? (
                        <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: 'var(--dim)', fontSize: 18 }}>▦</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--txt-hi)', fontWeight: 600, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name}
                      {isCurrent && <span style={{ color: 'var(--amber)', fontWeight: 400 }}> · open</span>}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>{c.dir}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                      {c.clips} clip{c.clips === 1 ? '' : 's'} · {c.images} image{c.images === 1 ? '' : 's'}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* ---- PLAYGROUND shelf: factory masters, not projects — a click stamps a fresh copy
                 into the list above (a normal project: rename it, wreck it, delete it) ---- */}
            {playgrounds.length > 0 && (
              <div style={{ flex: '0 0 auto', marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 6 }}>
                  playground <span style={{ textTransform: 'none', letterSpacing: 0 }}>— sample projects · downloaded once · every open stamps a fresh copy</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {playgrounds.map((pg) => {
                    const prog = pgProg[pg.id]
                    const busy = pg.busy || pgBusy === pg.id
                    const mb = Math.max(1, Math.round(pg.bytes / 1_000_000))
                    return (
                      <div
                        key={pg.id}
                        title={`sample project (${mb} MB)\nclick = ${pg.cached ? 'stamp a fresh copy and open it' : 'download once, then open a fresh copy'} · right-click = actions`}
                        onClick={() => void stampPlayground(pg)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setPgMenu({ x: e.clientX, y: e.clientY, pg })
                        }}
                        style={{ width: 168, cursor: busy ? 'progress' : 'pointer', borderRadius: 8, outline: '1px dashed var(--line2)', outlineOffset: -1, padding: 5, background: 'var(--panel)' }}
                      >
                        <div style={{ width: '100%', height: 56, background: 'var(--field)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 16, letterSpacing: 3, color: 'var(--muted)' }}>
                          {pg.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--txt-hi)', fontWeight: 600, marginTop: 5 }}>
                          {pg.name} <span style={{ color: 'var(--dim)', fontWeight: 400 }}>· sample</span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--dim)', minHeight: 20 }}>{pg.blurb}</div>
                        <div style={{ fontSize: 9, color: busy ? 'var(--amber)' : 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                          {busy ? (prog?.msg ?? `↓ ${prog?.pct ?? 0}%`) : pg.cached ? 'cached ✓ · click = fresh copy' : `↓ ${mb} MB once · click = get + open`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          {/* right-click on a card — the standard suite (rename / duplicate / reveal / remove / delete) */}
          {pickerMenu && (() => {
            const c = pickerMenu.card
            const isCurrent = project?.dir === c.dir
            const refresh = async (): Promise<void> => {
              const cards = await window.vidancer.projectPeekRecents()
              setOpenPicker((cur) => (cur ? { loading: false, cards } : cur))
            }
            return (
              <ContextMenu
                x={pickerMenu.x}
                y={pickerMenu.y}
                entries={[
                  {
                    label: <>▶ open</>,
                    onClick: () => {
                      setOpenPicker(null)
                      if (!isCurrent) void useStore.getState().openPath(c.dir)
                    }
                  },
                  {
                    label: <><Ic i={Pencil} size={12} /> rename…</>,
                    onClick: () =>
                      void (async () => {
                        const n = await textPrompt('Rename project (folder stays put)', c.name)
                        if (!n?.trim() || n.trim() === c.name) return
                        const r = await window.vidancer.projectRenameAt(c.dir, n.trim())
                        if (!r.ok) toast(`rename failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
                        void refresh()
                      })()
                  },
                  {
                    label: <><Ic i={Copy} size={12} /> duplicate</>,
                    onClick: () =>
                      void (async () => {
                        toast('duplicating — copying the whole project folder (media included)…', { kind: 'ok' })
                        const r = await window.vidancer.projectDuplicateAt(c.dir)
                        if (r.ok) toast('duplicate created ✓', { kind: 'ok' })
                        else toast(`duplicate failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
                        void refresh()
                      })()
                  },
                  { label: <><Ic i={FolderInput} size={12} /> reveal in Explorer</>, onClick: () => void window.vidancer.revealFile(c.dir) },
                  { label: '', sep: true },
                  {
                    label: <>remove from this list</>,
                    onClick: () =>
                      void (async () => {
                        await window.vidancer.projectRemoveRecent(c.dir)
                        void refresh()
                      })()
                  },
                  {
                    // law 7: the open project can't be deleted — the entry stays, dimmed, and says why
                    label: isCurrent ? (
                      <span style={{ opacity: 0.5 }} title="this project is open — open another project first"><Ic i={Trash2} size={12} /> delete project…</span>
                    ) : (
                      <><Ic i={Trash2} size={12} /> delete project…</>
                    ),
                    danger: !isCurrent,
                    onClick: () =>
                      void (async () => {
                        if (isCurrent) {
                          toast('this project is open — open another project first', { kind: 'error' })
                          return
                        }
                        if (!(await confirmDialog(`Move "${c.name}" to the Recycle Bin? The whole folder goes — ${c.clips} clip(s), ${c.images} image(s), all media. (recoverable from the Recycle Bin)`, { confirmLabel: 'Delete', danger: true }))) return
                        const r = await window.vidancer.projectDeleteAt(c.dir)
                        if (!r.ok) toast(`delete failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
                        else toast('moved to the Recycle Bin ✓', { kind: 'ok' })
                        void refresh()
                      })()
                  }
                ]}
                onClose={() => setPickerMenu(null)}
              />
            )
          })()}
          {/* right-click on a shelf card — stamp / clear the cached download (the master stays) */}
          {pgMenu && (
            <ContextMenu
              x={pgMenu.x}
              y={pgMenu.y}
              entries={[
                {
                  label: <>⚑ stamp a fresh copy</>,
                  onClick: () => {
                    const pg = pgMenu.pg
                    setPgMenu(null)
                    void stampPlayground(pg)
                  }
                },
                ...(pgMenu.pg.cached
                  ? [
                      {
                        label: <>clear download ({Math.max(1, Math.round(pgMenu.pg.bytes / 1_000_000))} MB — re-downloads on next open)</>,
                        onClick: (): void => {
                          const pg = pgMenu.pg
                          setPgMenu(null)
                          void window.vidancer.playgroundClear(pg.id).then((ok) => {
                            toast(ok ? 'download cleared ✓ — the shelf card stays' : 'busy right now — try again in a moment', { kind: ok ? 'ok' : 'error' })
                            void window.vidancer.playgroundList().then(setPlaygrounds)
                          })
                        }
                      }
                    ]
                  : [])
              ]}
              onClose={() => setPgMenu(null)}
            />
          )}
        </div>
      )}
      {/* ---- Snapshots: named project states — create one, or restore/delete an earlier one ---- */}
      {statesModal && (
        <div
          onClick={() => setStatesModal(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: 16, width: 'min(480px, 90vw)', maxHeight: '78vh', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
              <span className="lb" style={{ margin: 0 }}>
                snapshots <span style={{ color: 'var(--dim)' }}>— named states of the whole project you can come back to</span>
              </span>
              <span style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--dim)' }} onClick={() => setStatesModal(null)}>✕</span>
            </div>
            {(() => {
              const doSave = async (): Promise<void> => {
                const nm = statesModal.name.trim()
                if (!nm) return
                const ok = await useStore.getState().saveState(nm)
                if (ok) {
                  const states = await window.vidancer.projectStateList()
                  setStatesModal((cur) => (cur ? { name: '', states } : cur))
                }
              }
              return (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    autoFocus
                    value={statesModal.name}
                    onChange={(e) => setStatesModal((cur) => (cur ? { ...cur, name: e.target.value } : cur))}
                    onKeyDown={(e) => e.key === 'Enter' && void doSave()}
                    placeholder="name this snapshot — e.g. before recut"
                    style={{ flex: 1, background: 'var(--field)', border: '1px solid var(--line2)', borderRadius: 5, color: 'var(--txt-hi)', fontSize: 12, padding: '6px 9px' }}
                  />
                  <span
                    className="btn"
                    style={{ opacity: statesModal.name.trim() ? 1 : 0.5, pointerEvents: statesModal.name.trim() ? 'auto' : 'none' }}
                    onClick={() => void doSave()}
                  >
                    <Ic i={Plus} size={12} /> Save snapshot
                  </span>
                </div>
              )
            })()}
            <div className="vd-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {statesModal.states.length === 0 && <p className="vd-hint">no snapshots yet — name one above and hit Save.</p>}
              {statesModal.states.map((s) => (
                <div key={s.file} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--txt-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{new Date(s.savedAt).toLocaleString()}</div>
                  </div>
                  <span
                    className="btn vd-hbtn"
                    title="restore — the project becomes this snapshot; Ctrl+Z brings the current state back"
                    onClick={async () => {
                      if (await confirmDialog(`Restore snapshot “${s.name}”? The current state stays one Ctrl+Z away.`, { confirmLabel: 'Restore' })) {
                        setStatesModal(null)
                        void useStore.getState().restoreState(s.file)
                      }
                    }}
                  >
                    <Ic i={RotateCcw} size={11} /> restore
                  </span>
                  <span
                    className="btn vd-hbtn"
                    style={{ color: 'var(--bad)' }}
                    title="delete this snapshot (the project itself is untouched)"
                    onClick={async () => {
                      if (await confirmDialog(`Delete snapshot “${s.name}”?`, { confirmLabel: 'Delete', danger: true })) {
                        await window.vidancer.projectStateDelete(s.file)
                        const states = await window.vidancer.projectStateList()
                        setStatesModal((cur) => (cur ? { ...cur, states } : cur))
                      }
                    }}
                  >
                    ✕
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {showWelcome && <WelcomeModal onClose={() => closeWelcome(false)} onOpenSettings={() => closeWelcome(true)} />}
      {/* start-a-project prompt: only after boot found no project, and never over the onboarding.
          The moment a project exists the condition unmounts it. Dismissible — the header's
          New / Open buttons remain the fallback. */}
      {noProjectAtBoot && !project && !showWelcome && !tourOpen && !showSettings && (
        <Modal title="Start a project" width={400} onClose={() => setNoProjectAtBoot(false)}>
          <p style={{ fontSize: 12, color: 'var(--body)', lineHeight: 1.55, margin: '0 0 14px' }}>
            Everything in Video Dancer lives inside a project folder — imports, renders, music, timelines. Create one
            to get going, or open one you already have.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="btn" onClick={() => setShowNewProject(true)}>
              <Ic i={Plus} /> New project
            </span>
            <span className="btn vd-hbtn" onClick={() => void useStore.getState().openProject()}>
              <Ic i={FolderOpen} /> Open existing
            </span>
          </div>
        </Modal>
      )}
      {tourOpen && (
        <TourOverlay
          anchorFor={tourAnchor}
          onClose={(persisted) => {
            setTourOpen(false)
            if (persisted) tourDoneRef.current = true // keep the after-welcome handoff honest this session
          }}
        />
      )}
      {wsManage && (
        <WorkspacesModal
          names={Object.keys(workspaces)}
          active={activeWs}
          onSwitch={switchWorkspace}
          onAddCurrent={addWorkspace}
          onRename={renameWorkspace}
          onDelete={deleteWorkspace}
          onClose={() => setWsManage(false)}
        />
      )}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  )
}
