import { vd } from '../api'
import { toast } from '../ui/Toast'
import { Ic, FolderInput } from '../ui/icons'
import type { MenuEntry } from '@koan/shared'

// ----- EXPORT AS (TODO-2026-09-22 §21): the one "export as…" entry every media right-click shares
// (Library images, videos, music; clip takes in Clip Gen and the Bin). Main opens the save box; the
// format list in it is the choice (Photoshop's Save As grammar). Same format = a copy, another =
// ffmpeg at the highest quality. The toast's click reveals the file. -----
export function exportEntry(file: string, kind: 'image' | 'video' | 'audio', title: string, label = 'export as…'): MenuEntry {
  return {
    label: <><Ic i={FolderInput} size={12} /> {label}</>,
    onClick: async (): Promise<void> => {
      const r = await vd().mediaExportAs(file, kind, title)
      if (r.ok && r.file) toast('exported ✓ — click to show in Explorer', { kind: 'ok', onClick: () => void vd().revealFile(r.file!) })
      else if (r.error !== 'cancelled') toast(`export failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
    }
  }
}
