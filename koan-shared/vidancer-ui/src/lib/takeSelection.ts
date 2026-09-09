import { useEffect, useState, type MouseEvent } from 'react'

// Take trays deliberately keep their own selection: a take only has meaning inside its owning
// clip/job, unlike the project-wide Bin/Library selection. The gesture matches Foldered exactly:
// Ctrl/⌘ toggles one card, Shift selects the visible range from the last anchor.
export function useTakeMultiSelect(ownerId: string | undefined, orderedIds: readonly string[]): {
  selectedIds: string[]
  isSelected: (id: string) => boolean
  select: (e: MouseEvent, id: string) => boolean
  selectOnly: (id: string) => void
  contextIds: (id: string) => string[]
} {
  const [selection, setSelection] = useState<{ ids: string[]; anchor: string } | null>(null)
  const listKey = orderedIds.join('\u0000')

  // Changing the edited clip/job must never leave cards selected in the next one. New/deleted
  // takes only prune the selection, so a landing batch does not throw an existing choice away.
  useEffect(() => setSelection(null), [ownerId])
  useEffect(() => {
    const liveIds = listKey ? listKey.split('\u0000') : []
    setSelection((current) => {
      if (!current) return null
      const ids = current.ids.filter((id) => liveIds.includes(id))
      if (!ids.length) return null
      return { ids, anchor: ids.includes(current.anchor) ? current.anchor : ids[ids.length - 1]! }
    })
  }, [listKey])

  const selectedIds = selection?.ids ?? []
  const selectOnly = (id: string): void => setSelection({ ids: [id], anchor: id })
  const select = (e: MouseEvent, id: string): boolean => {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelection(null)
      return false
    }
    setSelection((current) => {
      const ids = current?.ids ?? []
      if (e.ctrlKey || e.metaKey) {
        return {
          ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
          anchor: id
        }
      }
      const anchor = current?.anchor
      const from = anchor ? orderedIds.indexOf(anchor) : -1
      const to = orderedIds.indexOf(id)
      if (!anchor || from < 0 || to < 0) return { ids: [id], anchor: id }
      return { ids: orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1), anchor }
    })
    return true
  }
  return {
    selectedIds,
    isSelected: (id) => selectedIds.includes(id),
    select,
    selectOnly,
    contextIds: (id) => (selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : [id])
  }
}
