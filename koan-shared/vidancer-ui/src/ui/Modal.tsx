import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus } from './dialogFocus'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(dialogRef, onClose)
  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
    >
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
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
          <span id={titleId} style={{ fontSize: 15, fontWeight: 600, flex: 1, color: 'var(--txt)' }}>{title}</span>
          <button type="button" className="btn vd-hbtn" aria-label="Close dialog" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
