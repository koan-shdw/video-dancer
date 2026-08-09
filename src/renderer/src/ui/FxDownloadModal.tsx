// First-run AI model download — a visible window, not a buried label. Non-blocking: the app
// stays usable underneath; ✕ hides it for THIS download (the percent stays in the Effects
// panel). Reappears for a different model, closes itself the moment the download finishes.
import { useState } from 'react'
import { useStore } from '../store'

export function FxDownloadModal(): React.JSX.Element | null {
  const job = useStore((s) => s.fxJob)
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const active = job && job.label.startsWith('downloading') ? job : null
  if (!active || hiddenFor === active.label) return null
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto', background: 'var(--panel)', border: '1px solid var(--line2)', borderRadius: 8, padding: '14px 18px', width: 400, boxShadow: '0 12px 40px rgba(0,0,0,.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)' }}>{active.label}</span>
          <button
            onClick={() => setHiddenFor(active.label)}
            title="hide · the percent stays in the effects panel"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 13 }}
          >
            ✕
          </button>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--field)', border: '1px solid var(--line)', overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, active.pct))}%`, background: 'var(--amber)', transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', fontSize: 10, color: 'var(--dim)' }}>
          <span>the app stays usable · this happens once per model</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{Math.round(active.pct)}%</span>
        </div>
      </div>
    </div>
  )
}
