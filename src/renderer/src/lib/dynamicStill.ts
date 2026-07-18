import { useStore } from '../store'
import { toast } from '../ui/Toast'

// add a LIVE still of a timeline instance's first/last frame to the Library — main owns the
// extraction and the re-extract-on-edit binding (trim/slice/take swap/undo all track).
// Shared by the Timeline block context menu and the Clip Monitor's slot-edit buttons.
export async function addDynamicStillFor(itemId: string, edge: 'first' | 'last'): Promise<void> {
  const r = await window.vidancer.imageAddDynamicStill(itemId, edge)
  if (r) {
    useStore.getState().applyDelta(r.delta)
    const title = r.delta.images?.[0]?.title ?? ''
    toast(`${title} → Library — live ${edge} frame (tracks this clip's edits)`, { kind: 'ok' })
  } else {
    toast('couldn’t grab that frame (render a take first?)', { kind: 'error' })
  }
}
