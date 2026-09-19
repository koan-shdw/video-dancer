import { vd } from '../api'
import { useStore } from '../store'
import { toast } from '../ui/Toast'
import { confirmDialog } from '../prompt'
import { Ic, FolderOutput } from '../ui/icons'
import type { MenuEntry } from '@koan/shared'

// ----- OPEN IN AN EXTERNAL EDITOR (renderer side, UI-ROUND-SPEC-2026-09-19 §2): the "open in ▸"
// entry every image right-click shares (Library images, Image Gen takes, Image Edit tree results).
// The flyout lists the editors found on this machine (+ his own picks, last used first) and
// "choose another app…". Main opens a COPY and watches it; when he comes back to Video Dancer and
// something was saved, askAboutEdits() puts his question. The list refreshes in the background on
// every menu build so the flyout stays synchronous — sendToProject's pattern. -----

let editors: ExternalEditor[] = []
const refreshEditors = (): void => {
  void vd().editorsList?.().then((l) => {
    editors = l
  })
}
refreshEditors() // warm at module load — the preload bridge exists before any panel renders

const openWith = async (file: string, editorId: string, sourceTitle: string, editedFrom?: string): Promise<void> => {
  let r: { ok: boolean; editor?: string; error?: string } | undefined
  try {
    r = await vd().editorsOpen?.(file, editorId, sourceTitle, editedFrom)
  } catch (e) {
    return void toast(`couldn't open it: ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' })
  }
  if (!r) return void toast('restart Video Dancer to use external editors — this window is still running the older app core', { kind: 'error' })
  if (!r.ok) return void toast(`couldn't open it: ${r.error ?? 'unknown'}`, { kind: 'error' })
  toast(`opened a copy in ${r.editor} — save there, come back here`, { kind: 'ok' })
  refreshEditors() // last-used moves to the top
}

// file = the image on disk (inside the open project) · sourceTitle names the copy and the image it
// becomes · editedFrom = the Library image id when the source IS a Library image (lineage + folder)
export function openInEntry(file: string, sourceTitle: string, editedFrom?: string): MenuEntry {
  refreshEditors()
  return {
    label: <><Ic i={FolderOutput} size={12} /> open in ▸</>,
    title: 'open a copy in an external editor — the original never changes; saving there asks to import it here',
    sub: [
      // the editor half isn't loaded (app started before it existed): the row says so, in place
      ...(!vd().editorsList ? [{ label: <span style={{ color: 'var(--dim)' }}>restart Video Dancer to list your editors</span>, disabled: true } as MenuEntry] : []),
      ...editors.map((e) => ({ label: e.name, title: e.exe, onClick: () => void openWith(file, e.id, sourceTitle, editedFrom) })),
      ...(editors.length ? [{ sep: true, label: '' } as MenuEntry] : []),
      {
        label: 'choose another app…',
        onClick: async () => {
          // never a silent nothing (his catch 2026-09-19: an app started before this build has no
          // editor half loaded — the click did nothing and said nothing)
          if (!vd().editorsPick) return void toast('restart Video Dancer to use external editors — this window is still running the older app core', { kind: 'error' })
          let r: { editors: ExternalEditor[]; picked?: string }
          try {
            r = await vd().editorsPick!()
          } catch (e) {
            return void toast(`couldn't open the app picker: ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' })
          }
          editors = r.editors
          if (r.picked) void openWith(file, r.picked, sourceTitle, editedFrom) // cancelled dialog = no pick = nothing opens
        }
      }
    ]
  }
}

// his question, verbatim, one save at a time. Yes = a NEW Library image; No = nothing until the next save.
export async function askAboutEdits(list: PendingExternalEdit[]): Promise<void> {
  for (const e of list) {
    const owner = useStore.getState().project?.dir
    const yes = await confirmDialog(
      <>
        a new edit was made, want to import it?
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {e.name} · saved from {e.editor}
        </div>
      </>,
      { confirmLabel: 'import' }
    )
    if (useStore.getState().project?.dir !== owner) return // the project changed under the dialog
    if (!yes) {
      await vd().editorsDismiss?.(e.watchId)
      continue
    }
    const r = await vd().editorsImport?.(e.watchId)
    if (r?.ok && r.delta) {
      useStore.getState().applyDelta(r.delta)
      toast('edit imported ✓ — it is in the Library', { kind: 'ok' })
    } else toast(r?.error ?? "couldn't import that edit", { kind: 'error' })
  }
}
