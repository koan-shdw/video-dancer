import { useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview'
import { LibraryPanel, BinPanel, MonitorPanel, SourceMonitor, TimelinePanel, TimelineEditorPanel, ImageEditorPanel, RenderPanel, SettingsModal, WorkspacesModal } from './panels'
import { PanelErrorBoundary } from './ui/PanelErrorBoundary'
import { setFolderOpener, setTimelineEditorOpener, setImageEditorOpener } from './panelBus'
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
  const falCredit = useStore((s) => s.falCredit)
  const refreshCredit = useStore((s) => s.refreshCredit)
  const [showSettings, setShowSettings] = useState(false)
  const [maximized, setMaximized] = useState(false) // a panel group is filling the whole workspace

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && apiRef.current?.hasMaximizedGroup()) apiRef.current.exitMaximizedGroup()
      // undo/redo — but let a focused text field run its own native undo first
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing || !(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) void useStore.getState().redo()
        else void useStore.getState().undo()
      } else if (k === 'y') {
        e.preventDefault()
        void useStore.getState().redo()
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
    api.getPanel('render')?.setTitle('Clip Editor')
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
        <span className="vd-logo">Video&nbsp;Dancer</span>
        <span className="btn vd-hbtn" onClick={() => void newProject()}>New</span>
        <span className="btn vd-hbtn" onClick={() => void openProject()}>Open</span>
        <span className="vd-sub">{project ? '📁 ' + project.name : 'no project — New / Open'}</span>
        <span
          className="btn vd-hbtn"
          style={{ marginLeft: 'auto', opacity: maximized ? 1 : 0.7 }}
          onClick={toggleMaximize}
          title={maximized ? 'restore the layout (Esc works too)' : 'maximize the focused panel to the whole workspace'}
        >
          {maximized ? '🗗 restore' : '⛶ max'}
        </span>
        <span className="btn vd-hbtn" onClick={() => setShowSettings(true)}>⚙ Settings</span>
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
                  background: '#16161a',
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
                      background: name === activeWs ? 'rgba(231,169,60,.15)' : 'transparent'
                    }}
                  >
                    <span style={{ width: 12 }}>{name === activeWs ? '✓' : ''}</span>
                    <span>{name}</span>
                  </div>
                ))}
                <div style={{ height: 1, background: 'var(--line2)', margin: '4px 0' }} />
                <div onClick={() => switchWorkspace('Default')} style={wsMenuItem}>↺ Reset to Default</div>
                <div
                  onClick={() => {
                    setWsMenu(false)
                    setWsManage(true)
                  }}
                  style={wsMenuItem}
                >
                  ＋ Add / Manage…
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
            color: c.error ? '#e88' : 'var(--muted)',
            border: '1px solid var(--line2)',
            borderRadius: 5,
            padding: '3px 8px'
          }}
        >
          {creditLabel}
        </span>
      </header>
      <div className="vd-dock">
        <DockviewReact className="dockview-theme-abyss" components={components} onReady={onReady} />
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
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
