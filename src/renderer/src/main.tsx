import ReactDOM from 'react-dom/client'
import App from './App'
import { MirrorView } from './preview/MirrorView'
import './styles.css'

// stray file drops (anywhere that isn't a real drop zone) must be NO-OPS — without this,
// Chromium navigates the window to the dropped file and the app appears to die. Panel drop
// handlers run first (bubble phase at their node), so this changes nothing for them.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// forward uncaught renderer errors to the main-process crash log (testers send one file)
window.addEventListener('error', (e) => {
  void window.vidancer?.logRenderer?.(`${e.message} @ ${e.filename}:${e.lineno}\n${e.error?.stack ?? ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  void window.vidancer?.logRenderer?.(`unhandledrejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`)
})

// NOTE: StrictMode intentionally double-invokes effects/mounts in dev. For a media app driving
// imperative <video> elements that caused double play()/double audio, so it's disabled.
// #mirror = the output-mirror window (second display): bare playback view, no app shell.
const isMirror = window.location.hash === '#mirror'
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(isMirror ? <MirrorView /> : <App />)
