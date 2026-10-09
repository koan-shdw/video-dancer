import { useStore } from '../store'
import { timelineHasKeys } from '../panelBus'

// Ctrl+C / X / V on the timeline (Premiere): copy / cut the SELECTED block (video, lane audio or
// ♪ score; a linked clip as one) and paste at the playhead (Ctrl+Shift+V = insert, everything
// after shifts right; the store action owns the rules). A real text copy is never hijacked. The
// app's key handler calls this; returns true when the key was taken.
export function tlClipboardKey(e: KeyboardEvent): boolean {
  const k = e.key.toLowerCase()
  const s = useStore.getState()
  if (!timelineHasKeys()) return false // another panel has the keys: its own copy / paste runs
  if (k === 'c' || k === 'x') {
    if (!(document.getSelection()?.isCollapsed ?? true)) return false
    const has = !!(s.selectedTlItemId || s.selectedAudioItemId || s.selectedScoreItemId)
    if (!(k === 'c' ? s.copyTlSelection() : has)) return false
    e.preventDefault()
    if (k === 'x') void s.cutTlSelection()
    return true
  }
  if (k === 'v' && s.tlClipboard) {
    e.preventDefault()
    void s.pasteTlClipboard({ insert: e.shiftKey })
    return true
  }
  return false
}
