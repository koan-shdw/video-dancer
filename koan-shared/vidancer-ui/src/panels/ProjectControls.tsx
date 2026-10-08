import { useState } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { confirmDialog } from '../prompt'
import { toast } from '../ui/Toast'

export function ProjectControls({ onClose }: { onClose: () => void }): React.JSX.Element {
  const hasProject = useStore(s => !!s.project)
  const [cleaning, setCleaning] = useState(false)
  const cleanup = async (): Promise<void> => {
    if (cleaning || !hasProject) return
    setCleaning(true)
    try {
      const scan = await vd().projectCleanup(false)
      if (!scan) throw Error('Could not scan the project.')
      if (scan.busy) throw Error('A render, image generation or import is running. Try again when it finishes.')
      if (!scan.files) { toast('No unused media files found.', { kind: 'ok' }); return }
      if (!await confirmDialog(`Delete ${scan.files} unused media files (${(scan.bytes / 1048576).toFixed(1)} MB)? Nothing in the project or its undo history uses them. This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) return
      const result = await vd().projectCleanup(true)
      if (!result || result.busy) throw Error(result?.busy ? 'A render started. Nothing was deleted.' : 'Cleanup failed.')
      toast(`Cleaned up ${result.files} files (${(result.bytes / 1048576).toFixed(1)} MB).`, { kind: 'ok' })
    } catch (e) { toast(e instanceof Error ? e.message : String(e), { kind: 'error' }) }
    finally { setCleaning(false) }
  }
  return <Modal title="Project controls" width={540} onClose={onClose}><div className="vd-connections"><h2>Clean up unused media</h2><p className="vd-connection-hint">Review files unused by clips, images, tracks, and undo history before deleting.</p><div className="vd-settings-section"><div><button type="button" className="primary" disabled={!hasProject || cleaning} onClick={() => void cleanup()}>{cleaning ? 'Scanning…' : 'Review unused files'}</button></div>{!hasProject && <p>Open a project first.</p>}</div></div></Modal>
}
