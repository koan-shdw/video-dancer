import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

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
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
