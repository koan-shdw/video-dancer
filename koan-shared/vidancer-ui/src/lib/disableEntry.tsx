import { vd } from '../api'
import { useStore, type MultiKind } from '../store'
import { toast } from '../ui/Toast'
import { menuSelection, collections } from './selectionMenu'
import type { MenuEntry } from '@koan/shared'

// ----- DISABLE / ENABLE (DISABLE-ITEMS-SPEC-2026-09-19): the ONE right-click entry every Library and
// Bin item shares — `sendEntryFor`'s pattern. "right click gorup or single": it acts on the WHOLE
// multi-selection (across cards) when the right-clicked item is in it, else on that one item. The
// takes' grammar: ⃠ disable / ✓ enable. Timelines are not part of it (his call). -----

export function disableEntryFor(kind: MultiKind, id: string): MenuEntry[] {
  if (kind === 'tl') return []
  const { sets, selection } = menuSelection(kind, id)
  const p = useStore.getState().project
  if (!p) return []
  const sel: SendSelection = { ...selection }
  delete sel.timelineIds
  const picked: { disabled?: boolean }[] = []
  for (const k of Object.keys(sets) as MultiKind[]) {
    if (k === 'tl') continue
    const pool = (p[collections[k]] ?? []) as { id: string; disabled?: boolean }[]
    picked.push(...pool.filter((x) => sets[k]!.includes(x.id)))
  }
  if (!picked.length) return []
  const allOff = picked.every((x) => x.disabled)
  const n = picked.length > 1 ? ` ${picked.length} selected` : ''
  return [
    {
      label: allOff ? <>✓ enable{n}</> : <>⃠ disable{n}</>,
      title: allOff
        ? 'bring it back: the @ picker suggests it again and the Co-Director sees it with the rest'
        : 'bench it, not delete it: it dims, leaves the @ picker, goes last in pick lists, and the Co-Director works from the enabled items first. Everything already using it keeps working',
      onClick: async () => {
        const call = vd().itemsSetDisabled
        if (!call) return void toast('restart Video Dancer to use disable — this window is still running the older app core', { kind: 'error' })
        const owner = p.dir
        try {
          const delta = await call(sel, !allOff)
          if (delta && useStore.getState().project?.dir === owner) useStore.getState().applyDelta(delta)
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
        }
      }
    }
  ]
}
