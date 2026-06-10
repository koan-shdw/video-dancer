import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 3000,
  background: 'rgba(0,0,0,.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}
const box: React.CSSProperties = { background: '#141418', border: '1px solid var(--line2)', borderRadius: 8, padding: 16, width: 320, boxShadow: '0 18px 60px rgba(0,0,0,.6)' }

function PromptUI({ title, initial, onDone }: { title: string; initial: string; onDone: (v: string | null) => void }): React.JSX.Element {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div onMouseDown={() => onDone(null)} style={backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()} style={box}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{title}</div>
        <input
          ref={ref}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onDone(v)
            if (e.key === 'Escape') onDone(null)
          }}
          style={{ width: '100%', background: '#0e0e12', color: '#e8e8ee', border: '1px solid var(--line2)', borderRadius: 5, padding: '7px 9px', fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <span className="btn vd-hbtn" onClick={() => onDone(null)}>Cancel</span>
          <span className="btn" onClick={() => onDone(v)}>OK</span>
        </div>
      </div>
    </div>
  )
}

function ConfirmUI({ message, onDone }: { message: string; onDone: (ok: boolean) => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDone(false)
      if (e.key === 'Enter') onDone(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])
  return (
    <div onMouseDown={() => onDone(false)} style={backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()} style={box}>
        <div style={{ fontSize: 12.5, color: '#e8e8ee', marginBottom: 12, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <span className="btn vd-hbtn" onClick={() => onDone(false)}>Cancel</span>
          <span className="btn" style={{ background: '#5a2424', color: '#fff' }} onClick={() => onDone(true)}>Delete</span>
        </div>
      </div>
    </div>
  )
}

function mount<T>(render: (done: (v: T) => void) => React.JSX.Element, resolve: (v: T) => void): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const done = (v: T): void => {
    resolve(v)
    setTimeout(() => {
      root.unmount()
      host.remove()
    }, 0)
  }
  root.render(render(done))
}

export function textPrompt(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => mount<string | null>((done) => <PromptUI title={title} initial={initial} onDone={done} />, resolve))
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => mount<boolean>((done) => <ConfirmUI message={message} onDone={done} />, resolve))
}
