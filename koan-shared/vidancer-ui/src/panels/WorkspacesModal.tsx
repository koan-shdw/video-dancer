import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Ic, Plus, Trash2 } from '../ui/icons'

const ctl: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--txt-hi)',
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

  const add = (): void => {
    const n = newName.trim()
    if (!n) return
    props.onAddCurrent(n)
    setNewName('')
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }

  return (
    <Modal title="Workspaces" width={460} onClose={props.onClose}>
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
          <span className="btn" onClick={add}><Ic i={Plus} size={11} /> Save</span>
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
            <span className="btn" onClick={() => props.onDelete(name)} title="delete workspace"><Ic i={Trash2} size={11} /></span>
          </div>
        ))}
    </Modal>
  )
}
