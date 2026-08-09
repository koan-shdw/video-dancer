// First-run AI model download — a small TOP-RIGHT monitor card (ComfyUI-style), not a modal:
// nothing overlays the work, nothing needs dismissing. Shows per-model progress, closes itself
// the moment the download finishes (the engine-start + pass progress stay in the Effects
// panel's DATA rows). ✕ hides it for THIS download only; a different model shows it again.
// Downloads happen ONCE per model — the file lives in the app's data folder forever after.
import { useState } from 'react'
import { useStore } from '../store'

export function DownloadMonitor(): React.JSX.Element | null {
  const job = useStore((s) => s.fxJob)
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const active = job && job.label.startsWith('downloading') ? job : null
  if (!active || hiddenFor === active.label) return null
  return (
    <div style={{ position: 'fixed', top: 48, right: 12, zIndex: 90, width: 280, pointerEvents: 'auto' }}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line2)', borderRadius: 8, padding: '10px 12px', boxShadow: '0 8px 28px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active.label}
          </span>
          <button
            onClick={() => setHiddenFor(active.label)}
            title="hide · the percent stays in the effects panel"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 12, paddingLeft: 8 }}
          >
            ✕
          </button>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--field)', border: '1px solid var(--line)', overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, active.pct))}%`, background: 'var(--amber)', transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', fontSize: 9, color: 'var(--dim)' }}>
          <span>once per model · app stays usable</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{Math.round(active.pct)}%</span>
        </div>
      </div>
    </div>
  )
}
