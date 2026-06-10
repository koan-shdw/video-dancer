import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const ctl: React.CSSProperties = {
  background: '#0e0e12',
  color: '#e8e8ee',
  border: '1px solid var(--line2)',
  borderRadius: 5,
  padding: '6px 8px',
  fontSize: 12
}

export function WorkspacesModal(props: {
  names: string[] // user workspaces (excludes the built-in 'Default')
  active: string
  onSwitch: (name: string) => void
  onAddCurrent: (name: string) => void
  onRename: (oldName: string, newName: string) => void
  onDelete: (name: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [newName, setNewName] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose, props])

  const add = (): void => {
    const n = newName.trim()
    if (!n) return
    props.onAddCurrent(n)
    setNewName('')
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }

  return createPortal(
    <div
      onMouseDown={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: '92vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: '#141418',
          border: '1px solid var(--line2)',
          borderRadius: 10,
          padding: 18,
          boxShadow: '0 18px 60px rgba(0,0,0,.6)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Workspaces</span>
          <span className="btn" onClick={props.onClose}>✕</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14 }}>
          Workspaces are global panel layouts shared across all projects. <b>Default</b> is built-in and always restores the
          standard arrangement — rearranging while on Default won&apos;t change it, so save your arrangement as a new workspace.
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          save current layout as…
        </div>
        <div style={{ ...row, marginBottom: 16 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="new workspace name"
            style={{ ...ctl, flex: 1 }}
          />
          <span className="btn" onClick={add}>＋ Save</span>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          workspaces
        </div>

        <div style={{ ...row, opacity: 0.75 }}>
          <span style={{ width: 14 }}>{props.active === 'Default' ? '✓' : ''}</span>
          <span style={{ flex: 1, fontSize: 12 }}>Default</span>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>built-in</span>
          {props.active !== 'Default' && (
            <span className="btn" onClick={() => props.onSwitch('Default')}>use</span>
          )}
        </div>

        {props.names.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--dim)', padding: '4px 0' }}>No custom workspaces yet.</div>
        )}

        {props.names.map((name) => (
          <div key={name} style={row}>
            <span style={{ width: 14 }}>{props.active === name ? '✓' : ''}</span>
            <input
              defaultValue={name}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onRename(name, e.currentTarget.value)
              }}
              onBlur={(e) => props.onRename(name, e.currentTarget.value)}
              style={{ ...ctl, flex: 1 }}
              title="edit to rename (Enter)"
            />
            {props.active !== name && (
              <span className="btn" onClick={() => props.onSwitch(name)}>use</span>
            )}
            <span className="btn" onClick={() => props.onDelete(name)} title="delete workspace">🗑</span>
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}
