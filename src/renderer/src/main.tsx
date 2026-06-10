import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// NOTE: StrictMode intentionally double-invokes effects/mounts in dev. For a media app driving
// imperative <video> elements that caused double play()/double audio, so it's disabled.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
