import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// THE modal shell — every dialog card in the app (Settings / About / CheatSheet / Workspaces…)
// renders through this: one backdrop, one raised surface, one title row with ✕, Esc + backdrop-click
// close. Width is the only per-modal knob; surface/border/radius/shadow/z stay uniform (theme-ready).
export function Modal({
  title,
  width = 480,
  onClose,
  children
}: {
  title: React.ReactNode
  width?: number
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '94vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--raised)',
          border: '1px solid var(--line2)',
          borderRadius: 10,
          padding: 18,
          boxShadow: '0 18px 60px rgba(0,0,0,.6)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1, color: 'var(--txt)' }}>{title}</span>
          <span className="btn vd-hbtn" onClick={onClose}>
            ✕
          </span>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
