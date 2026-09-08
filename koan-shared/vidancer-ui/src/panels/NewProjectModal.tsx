import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { Ic, FolderOpen, Plus } from '../ui/icons'

const ctl: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--txt-hi)',
  border: '1px solid var(--line2)',
  borderRadius: 5,
  padding: '6px 8px',
  fontSize: 12
}
const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }

// the New Project window: name + where to put it. Creating makes <location>\<name> and everything
// the project owns (project.json, images/, renders/, audio/…) lives inside that folder.
export function NewProjectModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const createProject = useStore((s) => s.createProject)
  const [name, setName] = useState('Untitled')
  const [baseDir, setBaseDir] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void vd().projectDefaultBaseDir().then(setBaseDir)
    // select the placeholder name so typing replaces it
    setTimeout(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    }, 0)
  }, [])

  const browse = async (): Promise<void> => {
    const dir = await vd().pickFolder(baseDir || undefined)
    if (dir) setBaseDir(dir)
  }
  // mirror main's folder-name sanitizing so the preview shows what will really be created
  const safeName = name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Untitled'
  const canCreate = !!baseDir && !busy

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setBusy(true)
    const ok = await createProject(baseDir, name)
    setBusy(false)
    if (ok) onClose()
    else toast('couldn’t create the project there — pick another location', { kind: 'error' })
  }

  return (
    <Modal title="New Project" width={480} onClose={onClose}>
      <div style={{ marginBottom: 12 }}>
        <div style={lb}>project name</div>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
          style={{ ...ctl, width: '100%' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={lb}>save location</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={baseDir}
            onChange={(e) => setBaseDir(e.target.value)}
            placeholder="where the project folder will be created"
            style={{ ...ctl, flex: 1, fontFamily: 'var(--mono)', fontSize: 11.5 }}
          />
          <span className="btn" onClick={() => void browse()}>
            <Ic i={FolderOpen} size={11} /> Browse…
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16 }}>
        A folder named <b style={{ color: 'var(--muted)' }}>{safeName}</b> will be created
        {baseDir ? (
          <>
            {' '}in <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{baseDir}</span>
          </>
        ) : (
          ' at the chosen location'
        )}{' '}
        — imports, renders, music and timelines all live inside it.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <span className="btn vd-hbtn" onClick={onClose}>Cancel</span>
        <span className="btn" style={{ opacity: canCreate ? 1 : 0.45 }} onClick={() => void create()}>
          <Ic i={Plus} size={11} /> {busy ? 'Creating…' : 'Create Project'}
        </span>
      </div>
    </Modal>
  )
}
