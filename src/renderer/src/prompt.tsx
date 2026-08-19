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
const box: React.CSSProperties = { background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 8, padding: 16, width: 320, boxShadow: '0 18px 60px rgba(0,0,0,.6)' }

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
            if (e.key !== 'Enter' && e.key !== 'Escape') return
            e.stopPropagation() // don't let Esc also close a Modal stacked underneath
            if (e.key === 'Enter') onDone(v)
            else onDone(null)
          }}
          style={{ width: '100%', background: 'var(--bg)', color: 'var(--txt-hi)', border: '1px solid var(--line2)', borderRadius: 5, padding: '7px 9px', fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <span className="btn vd-hbtn" onClick={() => onDone(null)}>Cancel</span>
          <span className="btn" onClick={() => onDone(v)}>OK</span>
        </div>
      </div>
    </div>
  )
}

function ConfirmUI({
  message,
  confirmLabel,
  danger,
  alert,
  onDone
}: {
  message: React.ReactNode // string for one-liners; the model wizard passes structured lines
  confirmLabel: string
  danger: boolean
  alert: boolean // alert = a single OK button (acknowledge), no Cancel
  onDone: (ok: boolean) => void
}): React.JSX.Element {
  useEffect(() => {
    // capture + stop: these dialogs stack over Modals, which ALSO close on a window-level Esc —
    // without this, Esc in the confirm would close the Settings modal underneath it too
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') onDone(alert) // dismissing an alert still counts as acknowledged
      else onDone(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDone, alert])
  return (
    <div onMouseDown={() => onDone(alert)} style={backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()} style={box}>
        <div style={{ fontSize: 12.5, color: 'var(--txt)', marginBottom: 12, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!alert && <span className="btn vd-hbtn" onClick={() => onDone(false)}>Cancel</span>}
          <span className="btn" style={danger ? { background: 'var(--bad)', color: '#fff' } : undefined} onClick={() => onDone(true)}>
            {confirmLabel}
          </span>
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

// confirm: Cancel + a labeled confirm button (danger = red). Default label is OK — destructive
// call sites pass {confirmLabel:'Delete', danger:true} explicitly.
export function confirmDialog(message: React.ReactNode, opts?: { confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    mount<boolean>(
      (done) => <ConfirmUI message={message} confirmLabel={opts?.confirmLabel ?? 'OK'} danger={!!opts?.danger} alert={false} onDone={done} />,
      resolve
    )
  )
}

// alert: a message + OK. For information only — never use confirmDialog to tell the user something.
export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) =>
    mount<boolean>((done) => <ConfirmUI message={message} confirmLabel="OK" danger={false} alert onDone={done} />, () => resolve())
  )
}
