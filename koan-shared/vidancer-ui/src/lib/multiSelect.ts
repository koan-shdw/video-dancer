import type { CSSProperties } from 'react'
import { useStore, type MultiKind } from '../store'

// ONE multi-select gesture for every Bin and Library card (Foldered grids, timeline tiles, music rows,
// video tiles — SEND-TO-PROJECT-UNIVERSAL-SPEC 2026-09-09): click = just this one (other cards' picks
// drop), ctrl/⌘-click = toggle and KEEP the other cards' picks ("all selected picks get sent"),
// shift-click = range from the anchor in display order (flatIds), keeping the other cards' picks too.
export function multiClick(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, kind: MultiKind, id: string, flatIds: () => string[]): void {
  const s = useStore.getState()
  const ms = s.multiSel
  const cur = ms?.sets[kind] ?? []
  if (e.ctrlKey || e.metaKey) {
    s.setMultiSel(kind, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], id, true)
  } else if (e.shiftKey) {
    const flat = flatIds()
    const a = ms && ms.kind === kind ? flat.indexOf(ms.anchor) : -1
    const b = flat.indexOf(id)
    if (a < 0 || b < 0) s.setMultiSel(kind, [id], id, true)
    else s.setMultiSel(kind, flat.slice(Math.min(a, b), Math.max(a, b) + 1), ms!.anchor, true)
  } else s.setMultiSel(kind, [id])
}

export const isPicked = (ms: { sets: Partial<Record<MultiKind, string[]>> } | null, kind: MultiKind, id: string): boolean => !!ms?.sets[kind]?.includes(id)

// the selection ring every picked tile wears (Foldered's look)
export const selRing = (on: boolean): CSSProperties => (on ? { outline: '2px solid var(--amber)', outlineOffset: 2 } : {})
