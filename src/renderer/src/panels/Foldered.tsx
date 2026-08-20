import { useState } from 'react'
import { useStore } from '../store'
import { textPrompt, confirmDialog } from '../prompt'
import { openFolderPanel } from '../panelBus'
import { MIME_MOVE } from '../lib/dragDrop'
import { Ic, Pencil, Plus, Copy, Trash2 } from '../ui/icons'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'

// re-export: Bin/Library type their item menus against this
export type { MenuEntry } from '../ui/ContextMenu'

// folder tree + right-click menus for a clip Bin or image Library. The panel supplies how to draw an item
// and its item-specific menu entries; this adds "move to folder" + folder create/rename/delete + drag-to-folder,
// and MULTI-SELECT: click = select one, ctrl-click = toggle, shift-click = range (display order).
// A right-click inside a >1 selection shows the panel's bulkMenu over the whole selection.
export function Foldered<T extends { id: string; folder?: string | null }>(props: {
  kind: 'bin' | 'lib' | 'sheet' | 'score' | 'voice'
  items: T[]
  renderItem: (item: T) => React.ReactNode
  itemMenu: (item: T) => MenuEntry[]
  bulkMenu?: (items: T[]) => MenuEntry[] // actions over the whole multi-selection (selection order)
  root?: string | null // when set, this view is scoped to a folder (an "opened" folder tab)
}): React.JSX.Element {
  const { kind, items, renderItem, itemMenu, bulkMenu, root = null } = props
  const project = useStore((s) => s.project)
  const addFolder = useStore((s) => s.addFolder)
  const renameFolder = useStore((s) => s.renameFolder)
  const deleteFolder = useStore((s) => s.deleteFolder)
  const moveItem = useStore((s) => s.moveItem)
  const moveItems = useStore((s) => s.moveItems)
  const multiSel = useStore((s) => s.multiSel)
  const setMultiSel = useStore((s) => s.setMultiSel)
  const clearMultiSel = useStore((s) => s.clearMultiSel)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dropF, setDropF] = useState<string | 'root' | null>(null)
  const [dropTile, setDropTile] = useState<string | null>(null) // tile-on-tile reorder target (insert BEFORE it)
  const reorderItems = useStore((s) => s.reorderItems)

  const allFolders = (project?.folders ?? []).filter((f) => f.kind === kind)
  const childFolders = (parent: string | null): Folder[] => allFolders.filter((f) => (f.parent ?? null) === parent)
  const itemsIn = (folderId: string | null): T[] => items.filter((it) => (it.folder ?? null) === folderId)

  // ---- multi-select ----
  const selIds = multiSel && multiSel.kind === kind ? multiSel.ids : []
  // item ids in DISPLAY order (folders depth-first, collapsed subtrees skipped, root items last) —
  // the coordinate system a shift-click range runs over
  const flatIds = (): string[] => {
    const acc: string[] = []
    const walk = (parent: string | null): void => {
      for (const f of childFolders(parent)) {
        if (collapsed[f.id]) continue
        walk(f.id)
        acc.push(...itemsIn(f.id).map((i) => i.id))
      }
    }
    walk(root)
    acc.push(...itemsIn(root).map((i) => i.id))
    return acc
  }
  const onItemClick = (e: React.MouseEvent, it: T): void => {
    if (e.ctrlKey || e.metaKey) {
      const ids = selIds.includes(it.id) ? selIds.filter((x) => x !== it.id) : [...selIds, it.id]
      setMultiSel(kind, ids, it.id)
    } else if (e.shiftKey) {
      const flat = flatIds()
      const a = multiSel && multiSel.kind === kind ? flat.indexOf(multiSel.anchor) : -1
      const b = flat.indexOf(it.id)
      if (a < 0 || b < 0) setMultiSel(kind, [it.id])
      else setMultiSel(kind, flat.slice(Math.min(a, b), Math.max(a, b) + 1), multiSel!.anchor)
    } else {
      setMultiSel(kind, [it.id])
    }
  }
  const selectedItems = (): T[] => selIds.map((id) => items.find((x) => x.id === id)).filter((x): x is T => !!x)

  const open = (e: React.MouseEvent, entries: MenuEntry[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, entries })
  }
  const newFolder = async (parent: string | null): Promise<void> => {
    const n = await textPrompt('New folder name', 'New Folder')
    if (n && n.trim()) void addFolder(kind, n.trim(), parent)
  }
  // "move to folder" entries for one item or a whole selection (one mutation either way)
  const moveEntries = (sel: T[]): MenuEntry[] => {
    const doMove = (folderId: string | null): void => {
      if (sel.length > 1) void moveItems(kind, sel.map((i) => i.id), folderId)
      else void moveItem(kind, sel[0].id, folderId)
    }
    const n = sel.length > 1 ? ` ${sel.length}` : ''
    return [
      { sep: true, label: '' },
      { label: `↪ move${n} to root`, onClick: () => doMove(null) },
      ...allFolders.map((f) => ({ label: '↪ ' + f.name, onClick: () => doMove(f.id) }))
    ]
  }
  const folderMenu = (f: Folder): MenuEntry[] => [
    {
      label: <><Ic i={Pencil} size={12} /> rename folder</>,
      onClick: async () => {
        const n = await textPrompt('Rename folder', f.name)
        if (n && n.trim()) void renameFolder(f.id, n.trim())
      }
    },
    { label: <><Ic i={Plus} size={12} /> new subfolder</>, onClick: () => void newFolder(f.id) },
    // sheet/score folders have no dedicated panel to open into — the entry only exists for bin/lib
    ...(kind === 'bin' || kind === 'lib' ? [{ label: <><Ic i={Copy} size={12} /> open in new tab</>, onClick: () => openFolderPanel(f.id, kind, f.name) } as MenuEntry] : []),
    { sep: true, label: '' },
    {
      label: <><Ic i={Trash2} size={12} /> delete folder</>,
      danger: true,
      onClick: async () => {
        if (await confirmDialog(`Delete folder "${f.name}"? Its contents move to the parent — items are not deleted.`, { confirmLabel: 'Delete', danger: true })) void deleteFolder(f.id)
      }
    }
  ]

  const allowMoveDrag = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types || []).includes(MIME_MOVE)
  const onMoveDrop = (e: React.DragEvent, folderId: string | null): void => {
    const d = e.dataTransfer.getData(MIME_MOVE)
    if (!d) return // not an internal move (e.g. an OS-file or take drop) → let it bubble
    e.preventDefault()
    e.stopPropagation()
    setDropF(null)
    try {
      const o = JSON.parse(d) as { kind?: string; id?: string; ids?: string[] }
      if (o.kind !== kind) return
      if (o.ids && o.ids.length > 1) void moveItems(kind, o.ids, folderId)
      else if (o.id) void moveItem(kind, o.id, folderId)
    } catch {
      /* ignore */
    }
  }

  // stretch grid: the zoom slider sets the MINIMUM tile width; full rows stretch flush to the
  // panel edge instead of leaving a dead gap on the right (user call 2026-08-11)
  // per-kind effective zoom: lib is its own; sheet / score / bin(clips) read their section override ?? the bin master
  const tileMin = useStore((s) =>
    kind === 'lib' ? s.tileZoom.lib : kind === 'sheet' ? (s.tileZoom.sheet ?? s.tileZoom.bin) : kind === 'score' ? (s.tileZoom.score ?? s.tileZoom.bin) : (s.tileZoom.clips ?? s.tileZoom.bin)
  )
  const grid = (list: T[]): React.JSX.Element => (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) clearMultiSel() // click in the gaps = deselect
      }}
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${tileMin}px, 100%), 1fr))`, gap: 6 }}
    >
      {list.map((it) => {
        const isSel = selIds.includes(it.id)
        return (
          <div
            key={it.id}
            onClick={(e) => onItemClick(e, it)}
            onDragOver={(e) => {
              // tile-on-tile = reorder (insert before this tile); the kind check happens at drop.
              // Sheets/scores skip reorder (no order slice in the delta) — folder drops still work.
              if (kind !== 'sheet' && kind !== 'score' && Array.from(e.dataTransfer.types || []).includes(MIME_MOVE)) {
                e.preventDefault()
                e.stopPropagation() // don't light the folder/root move targets underneath
                setDropTile(it.id)
              }
            }}
            onDragLeave={() => setDropTile((d) => (d === it.id ? null : d))}
            onDrop={(e) => {
              const d = e.dataTransfer.getData(MIME_MOVE)
              setDropTile(null)
              if (!d) return
              try {
                const o = JSON.parse(d) as { kind?: string; id?: string; ids?: string[] }
                if (o.kind !== kind || !o.id) return
                e.preventDefault()
                e.stopPropagation()
                if (kind !== 'sheet' && kind !== 'score' && kind !== 'voice') void reorderItems(kind, o.ids?.length ? o.ids : [o.id], it.id)
              } catch {
                /* ignore */
              }
            }}
            onContextMenu={(e) => {
              // right-click INSIDE a >1 selection acts on the whole selection; outside it re-selects
              if (selIds.length > 1 && selIds.includes(it.id)) {
                const sel = selectedItems()
                open(e, [...(bulkMenu ? bulkMenu(sel) : itemMenu(it)), ...moveEntries(sel)])
              } else {
                setMultiSel(kind, [it.id])
                open(e, [...itemMenu(it), ...moveEntries([it])])
              }
            }}
            style={{
              userSelect: 'none', // shift-click must range-select, not text-select
              borderRadius: 8,
              outline: isSel ? '2px solid var(--amber)' : 'none',
              outlineOffset: 2,
              boxShadow: dropTile === it.id ? '-3px 0 0 0 var(--amber)' : undefined // insert-before marker
            }}
          >
            {renderItem(it)}
          </div>
        )
      })}
    </div>
  )

  const renderFolder = (f: Folder, depth: number): React.JSX.Element => {
    const isOpen = !collapsed[f.id]
    return (
      <div key={f.id} style={{ marginTop: 4 }}>
        <div
          onClick={() => setCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }))}
          onContextMenu={(e) => open(e, folderMenu(f))}
          onDragOver={(e) => {
            if (allowMoveDrag(e)) {
              e.preventDefault()
              setDropF(f.id)
            }
          }}
          onDragLeave={() => setDropF((d) => (d === f.id ? null : d))}
          onDrop={(e) => onMoveDrop(e, f.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, background: dropF === f.id ? 'color-mix(in srgb, var(--amber) 18%, transparent)' : 'transparent' }}
        >
          <span>{isOpen ? '▾' : '▸'}</span>
          <span>📁 {f.name}</span>
          <span style={{ color: 'var(--dim)' }}>({itemsIn(f.id).length})</span>
        </div>
        {isOpen && (
          <div style={{ marginLeft: 10, paddingLeft: 4, borderLeft: '1px solid var(--line)' }}>
            {childFolders(f.id).map((cf) => renderFolder(cf, depth + 1))}
            {grid(itemsIn(f.id))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) clearMultiSel()
      }}
      onContextMenu={(e) => open(e, [{ label: <><Ic i={Plus} size={12} /> new folder</>, onClick: () => void newFolder(root) }])}
      onDragOver={(e) => {
        if (allowMoveDrag(e)) {
          e.preventDefault()
          setDropF('root')
        }
      }}
      onDragLeave={() => setDropF((d) => (d === 'root' ? null : d))}
      onDrop={(e) => onMoveDrop(e, null)}
      style={{ outline: dropF === 'root' ? '2px dashed var(--amber-dim)' : 'none', outlineOffset: -2 }}
    >
      {childFolders(root).map((f) => renderFolder(f, 0))}
      <div style={{ marginTop: 6 }}>{grid(itemsIn(root))}</div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  )
}
