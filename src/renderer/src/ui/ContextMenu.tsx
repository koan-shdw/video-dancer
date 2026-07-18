import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuEntry = { label: React.ReactNode; onClick?: () => void; danger?: boolean; sep?: boolean }

// THE right-click menu (extracted from Foldered so Timeline blocks / T-chips / Bin don't grow
// their own copies). Portal card at the pointer over a fixed-inset catcher; closes on any
// outside mousedown or a second right-click. Position clamps to the viewport — menus opened
// near the bottom/right edge slide in instead of overflowing off-screen.
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const r = cardRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      x: Math.min(x, Math.max(4, window.innerWidth - r.width - 4)),
      y: Math.min(y, Math.max(4, window.innerHeight - r.height - 4))
    })
  }, [x, y])
  return createPortal(
    <div
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 2500 }}
    >
      <div
        ref={cardRef}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', left: pos.x, top: pos.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 170, maxHeight: 320, overflow: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,.55)' }}
      >
        {entries.map((en, i) =>
          en.sep ? (
            <div key={i} style={{ height: 1, background: 'var(--line2)', margin: '4px 0' }} />
          ) : (
            <div
              key={i}
              onClick={() => {
                en.onClick?.()
                onClose()
              }}
              style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: en.danger ? 'var(--bad)' : 'var(--txt-hi)', whiteSpace: 'nowrap' }}
            >
              {en.label}
            </div>
          )
        )}
      </div>
    </div>,
    document.body
  )
}
