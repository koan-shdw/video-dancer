import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { IS_POPOUT, POPOUT_PANEL, startPopoutSync } from './lib/popoutSync'
import { MonitorPanel, QueuePanel } from './panels'
import { applyTheme, resolveTheme } from './lib/themes'
import './styles.css'

// forward uncaught renderer errors to the main-process crash log (testers send one file)
window.addEventListener('error', (e) => {
  void window.vidancer?.logRenderer?.(`${e.message} @ ${e.filename}:${e.lineno}\n${e.error?.stack ?? ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  void window.vidancer?.logRenderer?.(`unhandledrejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`)
})

// a pop-out window (?panel=monitor|queue) hosts ONE panel as a mirror of the main window's
// state — no dockview, no project IPC of its own; everything syncs through lib/popoutSync
function PopoutRoot(): React.JSX.Element {
  useEffect(() => startPopoutSync(), [])
  useEffect(() => {
    void window.vidancer.getSettings().then((s) => applyTheme(resolveTheme(s.activeTheme, s.customThemes)))
  }, [])
  return <div className="vd-app" style={{ height: '100vh' }}>{POPOUT_PANEL === 'queue' ? <QueuePanel /> : <MonitorPanel />}</div>
}

// NOTE: StrictMode intentionally double-invokes effects/mounts in dev. For a media app driving
// imperative <video> elements that caused double play()/double audio, so it's disabled.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(IS_POPOUT ? <PopoutRoot /> : <App />)
