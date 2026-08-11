import { useStore } from '../store'
import { toast } from '../ui/Toast'
import { alertDialog } from '../prompt'
import { Ic, FolderOutput } from '../ui/icons'
import type { MenuEntry } from '../ui/ContextMenu'

// ----- SEND TO PROJECT (renderer side): the "send to project ▸" entry every right-click site
// shares (clips, images, music, sheets, timelines). The submenu lists recent projects (minus the
// open one) + browse…; the send itself runs in main and never touches the open project. Recents
// refresh in the background on every menu build so the submenu stays synchronous. -----

let recents: string[] = []
const refreshRecents = (): void => {
  void window.vidancer.projectRecents().then((l) => {
    recents = l
  })
}
refreshRecents() // warm at module load — the preload bridge exists before any panel renders

const norm = (d: string): string => d.replace(/[\\/]+$/, '').toLowerCase()
const baseName = (d: string): string => d.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || d

const doSend = async (destDir: string, sel: SendSelection): Promise<void> => {
  const r = await window.vidancer.sendAssets(destDir, sel)
  if (!r.ok) {
    toast(`send failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
    return
  }
  const one = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
  const s = r.sent
  const parts = s
    ? [
        s.clips ? one(s.clips, 'clip') : '',
        s.images ? one(s.images, 'image') : '',
        s.audio ? one(s.audio, 'track') : '',
        s.videos ? one(s.videos, 'video') : '',
        s.sheets ? one(s.sheets, 'sheet') : '',
        s.timelines ? one(s.timelines, 'timeline') : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const skipped = r.skipped ?? []
  const skip = skipped.length ? ` (${skipped.length} skipped: files missing)` : ''
  // the toast is the receipt (no cross-project undo) — skips list on click, never silent
  toast(`sent to ${baseName(destDir)} ✓ — ${parts || 'nothing'}${skip}`, {
    kind: 'ok',
    ...(skipped.length ? { onClick: () => void alertDialog(`Skipped (files missing):\n\n${skipped.join('\n')}`) } : {})
  })
}

// count > 1 labels the entry "send N to project" (bulk rule — the whole selection rides in sel)
export function sendToProjectEntry(sel: SendSelection, count = 1): MenuEntry {
  refreshRecents()
  const here = useStore.getState().project?.dir
  const targets = recents.filter((d) => !here || norm(d) !== norm(here))
  return {
    label: (
      <>
        <Ic i={FolderOutput} size={12} /> send{count > 1 ? ` ${count}` : ''} to project
      </>
    ),
    sub: [
      ...targets.map((d) => ({ label: baseName(d), onClick: () => void doSend(d, sel) })),
      ...(targets.length ? [{ sep: true, label: '' } as MenuEntry] : []),
      {
        label: 'browse…',
        onClick: () => {
          void (async () => {
            const r = await window.vidancer.importPickProject('Send to project — pick a Video Dancer project folder')
            if (!r) {
              await alertDialog('No readable Video Dancer project (project.json) found in that folder.')
              return
            }
            if (here && norm(r.dir) === norm(here)) {
              toast("that's this project — pick another one", { kind: 'error' })
              return
            }
            await doSend(r.dir, sel)
          })()
        }
      }
    ]
  }
}
