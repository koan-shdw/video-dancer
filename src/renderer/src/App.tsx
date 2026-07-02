import { useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview'
import { LibraryPanel, BinPanel, MonitorPanel, SourceMonitor, TimelinePanel, TimelineEditorPanel, ImageEditorPanel, RenderPanel, SettingsModal, WorkspacesModal } from './panels'
import { PanelErrorBoundary } from './ui/PanelErrorBoundary'
import { Toasts } from './ui/Toast'
import { AboutModal } from './panels/AboutModal'
import { CheatSheet } from './panels/CheatSheet'
import { WelcomeModal } from './panels/WelcomeModal'
import { TourOverlay } from './ui/TourOverlay'
import { Ic, Maximize2, Minimize2, Settings2, HelpCircle, RotateCcw, Plus, FolderOpen } from './ui/icons'
import { setFolderOpener, setTimelineEditorOpener, setImageEditorOpener, setClipEditorOpener, setTimelineMonitorOpener } from './panelBus'
import { activeItems } from './lib/timelineUtils'
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
  render: () => guard('Clip Editor', <RenderPanel />),
  folderbin: (props) => {
    const p = (props.params ?? {}) as { folderId?: string; kind?: 'bin' | 'lib' }
    return guard('Folder', p.kind === 'lib' ? <LibraryPanel rootFolder={p.folderId} /> : <BinPanel rootFolder={p.folderId} />)
  }
}

const wsMenuItem: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }

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
  api.addPanel({ id: 'render', component: 'render', title: 'Clip Editor', position: { referencePanel: monitor.id, direction: 'right' } })
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
    } catch {
      defaultLayout(api)
    }
  } else {
    defaultLayout(api)
  }
  if (api.totalPanels === 0) defaultLayout(api) // safety net
  ensureSource(api)
}

export default function App(): React.JSX.Element {
  const apiRef = useRef<DockviewApi | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const prevEditIdxRef = useRef<number | null>(null) // detects an ACTUAL slot double-click vs a project refresh
  const prevPreviewRef = useRef<string | null>(null) // detects an ACTUAL preview-target change vs a project refresh
  const project = useStore((s) => s.project)
  const newProject = useStore((s) => s.newProject)
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
  const [showCheats, setShowCheats] = useState(false)
  const [recents, setRecents] = useState<string[]>([])
  const [recentsMenu, setRecentsMenu] = useState(false)
  const [update, setUpdate] = useState<{ status: string; version?: string; message?: string } | null>(null)
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
  // first-run guard: rendering needs a fal key — surface that BEFORE the first failed render
  const [hasFalKey, setHasFalKey] = useState<boolean | null>(null) // null = not checked yet
  const [keyBannerHidden, setKeyBannerHidden] = useState(false) // ✕ hides it for this session
  // first-launch onboarding: the API-setup window, then the spotlight tour once it closes
  const [showWelcome, setShowWelcome] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const firstRunChecked = useRef(false) // the effect re-runs when Settings closes — gate onboarding to ONE evaluation
  const tourDoneRef = useRef(true) // whether settings said the tour is done (drives the after-welcome handoff)
  useEffect(() => {
    if (showSettings) return // re-check when the settings modal closes (key may have just been saved)
    void window.vidancer.getSettings().then((s) => {
      setHasFalKey(!!s.falKey)
      if (!firstRunChecked.current) {
        firstRunChecked.current = true
        tourDoneRef.current = !!s.tourDone
        if (!s.welcomeSeen) setShowWelcome(true)
        else if (!s.tourDone) setTourOpen(true)
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
  // main-initiated deltas (dynamic stills re-extracting themselves) merge straight into the store
  useEffect(() => window.vidancer.onProjectDelta((d) => useStore.getState().applyDelta(d)), [])

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
        }
        return
      }
      if (e.key === '?') {
        setShowCheats((v) => !v)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedTlItemId) {
          e.preventDefault()
          void s.deleteSelectedTlItem()
        }
        return
      }
      if (e.key === 'Escape' && s.selectedTlItemId) s.selectTlItem(null)
      // ---- transport (global): Space play/pause · ←/→ prev/next clip · Home/End first/last ----
      const items = activeItems(s.project)
      if (e.key === ' ') {
        if (items.length === 0) return
        e.preventDefault() // stop page scroll / focused-control activation
        if (s.tlPlaying) s.tlPause()
        else s.tlPlay()
      } else if (e.key === 'ArrowLeft' && items.length > 0) {
        e.preventDefault()
        s.tlSetIndex(Math.max(0, s.tlIndex - 1))
      } else if (e.key === 'ArrowRight' && items.length > 0) {
        e.preventDefault()
        s.tlSetIndex(Math.min(items.length - 1, s.tlIndex + 1))
      } else if (e.key === 'Home' && items.length > 0) {
        e.preventDefault()
        s.tlSetIndex(0)
      } else if (e.key === 'End' && items.length > 0) {
        e.preventDefault()
        s.tlSetIndex(items.length - 1)
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

  const onReady = (event: DockviewReadyEvent): void => {
    apiRef.current = event.api
    void initWorkspaces(event.api) // applies the active workspace's layout
    // open a folder as its own panel, docked as a tab next to the Bin/Library
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
    // double-clicking a timeline in the Bin opens/raises the Timeline Editor (tabs next to the Clip Editor)
    setTimelineEditorOpener(() => {
      const api = apiRef.current
      if (!api) return
      const existing = api.getPanel('tleditor')
      if (existing) {
        existing.api.setActive()
        return
      }
      const refId = api.getPanel('render') ? 'render' : api.getPanel('monitor') ? 'monitor' : undefined
      api.addPanel({
        id: 'tleditor',
        component: 'tleditor',
        title: 'Timeline Editor',
        position: refId ? { referencePanel: refId, direction: 'within' } : undefined
      })
    })
    // double-clicking a Library image opens/raises the Image Editor (tabs next to the Clip Editor)
    setImageEditorOpener(() => {
      const api = apiRef.current
      if (!api) return
      const existing = api.getPanel('imageeditor')
      if (existing) {
        existing.api.setActive()
        return
      }
      const refId = api.getPanel('render') ? 'render' : api.getPanel('monitor') ? 'monitor' : undefined
      api.addPanel({
        id: 'imageeditor',
        component: 'imageeditor',
        title: 'Image Editor',
        position: refId ? { referencePanel: refId, direction: 'within' } : undefined
      })
    })
    // scrubbing the timeline ruler raises the Timeline Monitor (same as play: takes over a maximized view)
    setTimelineMonitorOpener(() => {
      const api = apiRef.current
      const monitor = api?.getPanel('monitor')
      if (!api || !monitor) return
      if (api.hasMaximizedGroup()) api.maximizeGroup(monitor)
      monitor.api.setActive()
    })
    // double-clicking a Bin clip raises the Clip Editor (it already loads the selected clip);
    // if the user closed that panel, re-add it — same pattern as the other editor openers
    setClipEditorOpener(() => {
      const api = apiRef.current
      if (!api) return
      const existing = api.getPanel('render')
      if (existing) {
        existing.api.setActive()
        return
      }
      const refId = api.getPanel('monitor') ? 'monitor' : undefined
      api.addPanel({
        id: 'render',
        component: 'render',
        title: 'Clip Editor',
        position: refId ? { referencePanel: refId, direction: 'right' } : undefined
      })
    })
    event.api.onDidMaximizedGroupChange(() => setMaximized(event.api.hasMaximizedGroup()))
    event.api.onDidLayoutChange(() => {
      if (!readyRef.current) return // ignore the initial build
      if (event.api.totalPanels === 0) return // NEVER persist an empty layout
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(persistActiveLayout, 600)
    })
    void useStore.getState().openLast()
  }

  // bring the Clip Monitor forward on double-click + label its tab; also force the renamed panel titles
  // (saved/restored layouts keep their OLD titles, so re-apply the new names here)
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.getPanel('monitor')?.setTitle('Timeline Monitor')
    api.getPanel('render')?.setTitle(useStore.getState().renderBusy ? '⏳ Clip Editor' : 'Clip Editor')
    const panel = api.getPanel('source')
    if (!panel) return
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
    // double-clicking a timeline clip also brings the CLIP EDITOR to front — but only on the
    // double-click itself (the index CHANGING), not on every autosave that refreshes `project`
    if (editTimelineIndex != null && editTimelineIndex !== prevEditIdxRef.current)
      api.getPanel('render')?.api.setActive()
    prevEditIdxRef.current = editTimelineIndex
  }, [editTimelineIndex, selectedClipId, project])

  // busy badges: a render/export in flight marks its panel tab even when tabbed away
  useEffect(() => {
    apiRef.current?.getPanel('render')?.setTitle(renderBusy ? '⏳ Clip Editor' : 'Clip Editor')
  }, [renderBusy])
  useEffect(() => {
    apiRef.current?.getPanel('tleditor')?.setTitle(exportBusy ? '⏳ Timeline Editor' : 'Timeline Editor')
  }, [exportBusy])

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
        <span className="btn vd-hbtn" onClick={() => void newProject()}>New</span>
        <span className="btn vd-hbtn" onClick={() => void openProject()}>Open</span>
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
      </header>
      {hasFalKey === false && !keyBannerHidden && (
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
          <span>⚠ no fal.ai key set — rendering won’t work until you add one (bring your own key; usage bills to your fal account)</span>
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
      {showWelcome && <WelcomeModal onClose={() => closeWelcome(false)} onOpenSettings={() => closeWelcome(true)} />}
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
    </div>
  )
}
