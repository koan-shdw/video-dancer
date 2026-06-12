// ONE feedback surface for finished work: render done, export done/failed, imports, undo/redo.
// Module-level toast() can be called from anywhere (store actions included); App mounts <Toasts/>
// once. Styled exclusively with CSS variables — a theme swap restyles toasts for free.
import { useEffect, useState } from 'react'

type Kind = 'info' | 'ok' | 'error'
interface ToastItem {
  id: number
  text: string
  kind: Kind
  onClick?: () => void
  hint?: string // small second line, e.g. "click to open folder"
}

let pushFn: ((t: Omit<ToastItem, 'id'>) => void) | null = null
let seq = 0

export function toast(text: string, opts?: { kind?: Kind; onClick?: () => void; hint?: string }): void {
  pushFn?.({ text, kind: opts?.kind ?? 'info', onClick: opts?.onClick, hint: opts?.hint })
}

const KIND_VAR: Record<Kind, string> = { info: 'var(--amber)', ok: 'var(--ok)', error: 'var(--bad)' }

export function Toasts(): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    pushFn = (t) => {
      const id = ++seq
      setItems((arr) => [...arr.slice(-2), { ...t, id }]) // at most 3 on screen
      const ttl = t.kind === 'error' ? 6500 : 3000 // errors linger long enough to read
      window.setTimeout(() => setItems((arr) => arr.filter((x) => x.id !== id)), ttl)
    }
    return () => {
      pushFn = null
    }
  }, [])
  if (items.length === 0) return <></>
  return (
    <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 4000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
      {items.map((t) => (
        <div
          key={t.id}
          onClick={() => {
            t.onClick?.()
            setItems((arr) => arr.filter((x) => x.id !== t.id)) // click always dismisses
          }}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 520,
            padding: '7px 12px',
            background: 'var(--panel2)',
            border: '1px solid var(--line2)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,.45)',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--txt)'
          }}
          title={t.onClick ? undefined : 'click to dismiss'}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: KIND_VAR[t.kind], flex: '0 0 auto' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.text}
            {t.hint && <span style={{ color: 'var(--dim)', marginLeft: 8, fontSize: 11 }}>{t.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
