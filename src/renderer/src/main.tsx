import './bridge' // FIRST: hands window.vidancer to the package before its modules evaluate
import ReactDOM from 'react-dom/client'
import { setKoanBridge, type KoanBridgeApi } from '@koan/shared'
import { App, MirrorView, openModelsCard, confirmDialog } from '@koan/vidancer-ui'
import '@koan/vidancer-ui/styles.css'
import '@koan/shared/koan.css'

// The Electron shell (docs/VIDANCER-UI-PACKAGE-SPEC-2026-09-06.md). The renderer lives in
// @koan/vidancer-ui; ./bridge handed it the preload surface before anything here evaluated.

// the koan-shared bridge (SPEC in koan-shared): shared surfaces talk through this handle,
// never window.vidancer directly. Must run before first render.
setKoanBridge({
  api: window.vidancer as unknown as KoanBridgeApi,
  openModels: openModelsCard,
  confirm: confirmDialog
  // no pathForFile — this app rides legacy File.path (the Library drop grammar)
})

// stray file drops (anywhere that isn't a real drop zone) must be NO-OPS — without this,
// Chromium navigates the window to the dropped file and the app appears to die. Panel drop
// handlers run first (bubble phase at their node), so this changes nothing for them.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// forward uncaught renderer errors to the main-process crash log (testers send one file)
window.addEventListener('error', (e) => {
  void window.vidancer?.logRenderer?.(`${e.message} @ ${e.filename}:${e.lineno}
${e.error?.stack ?? ''}`)
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
