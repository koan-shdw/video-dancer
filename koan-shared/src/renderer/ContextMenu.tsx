import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuEntry = { label: React.ReactNode; onClick?: () => void; danger?: boolean; sep?: boolean; sub?: MenuEntry[]; disabled?: boolean; title?: string }

// flyout card for an "entry ▸" submenu — opens on hover beside its row, clamps to the viewport,
// and flips to the parent card's left edge when the right side has no room
function Flyout({ x, y, parentLeft, entries, onClose }: { x: number; y: number; parentLeft: number; entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      x: x + r.width > window.innerWidth - 4 ? Math.max(4, parentLeft - r.width + 2) : x,
      y: Math.min(y, Math.max(4, window.innerHeight - r.height - 4))
    })
  }, [x, y, parentLeft])
  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', left: pos.x, top: pos.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 150, maxHeight: 320, overflow: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,.55)' }}
    >
      {entries.map((en, i) =>
        en.sep ? (
          <div key={i} style={{ height: 1, background: 'var(--line2)', margin: '4px 0' }} />
        ) : (
          <div
            key={i}
            title={en.title}
            onClick={() => {
              if (en.disabled) return // greyed rows stay put — the title carries the reason
              en.onClick?.()
              onClose()
            }}
            style={{ padding: '6px 10px', borderRadius: 4, cursor: en.disabled ? 'default' : 'pointer', fontSize: 12, color: en.disabled ? 'var(--dim)' : en.danger ? 'var(--bad)' : 'var(--txt-hi)', whiteSpace: 'nowrap' }}
          >
            {en.label}
          </div>
        )
      )}
    </div>
  )
}

// THE right-click menu (extracted from Foldered so Timeline blocks / T-chips / Bin don't grow
// their own copies). Portal card at the pointer over a fixed-inset catcher; closes on any
// outside mousedown or a second right-click. Position clamps to the viewport — menus opened
// near the bottom/right edge slide in instead of overflowing off-screen. Entries with `sub`
// open a hover flyout; their own row is not an action.
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null)
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
              title={en.title}
              onMouseEnter={(e) => {
                if (en.sub) {
                  const r = e.currentTarget.getBoundingClientRect()
                  setSub({ i, x: r.right - 2, y: r.top - 4 })
                } else setSub(null)
              }}
              onClick={() => {
                if (en.sub) return // the flyout carries the actions
                if (en.disabled) return // greyed rows stay put — the title carries the reason
                en.onClick?.()
                onClose()
              }}
              style={{ padding: '6px 10px', borderRadius: 4, cursor: en.disabled ? 'default' : 'pointer', fontSize: 12, color: en.disabled ? 'var(--dim)' : en.danger ? 'var(--bad)' : 'var(--txt-hi)', whiteSpace: 'nowrap', ...(en.sub ? { display: 'flex', alignItems: 'center', gap: 8 } : {}) }}
            >
              {en.label}
              {en.sub && <span style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: 10 }}>▸</span>}
            </div>
          )
        )}
      </div>
      {sub && entries[sub.i]?.sub && (
        <Flyout x={sub.x} y={sub.y} parentLeft={cardRef.current?.getBoundingClientRect().left ?? sub.x} entries={entries[sub.i].sub!} onClose={onClose} />
      )}
    </div>,
    document.body
  )
}
