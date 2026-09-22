import { useRef, useState } from 'react'
import { useStore } from '../store'
import { textPrompt, confirmDialog } from '../prompt'
import { openFolderPanel } from '../panelBus'
import { MIME_MOVE } from '../lib/dragDrop'
import { multiClick } from '../lib/multiSelect'
import { selectionMenu, menuSelection } from '../lib/selectionMenu'
import { disableEntryFor } from '../lib/disableEntry'
import { Ic, FolderIcon, Pencil, Plus, Copy, Trash2 } from '../ui/icons'
import { ContextMenu, type MenuEntry } from '@koan/shared'

// re-export: Bin/Library type their item menus against this
export type { MenuEntry } from '@koan/shared'

// folder tree + right-click menus for a clip Bin or image Library. The panel supplies how to draw an item
// and its item-specific menu entries; this adds "move to folder" + folder create/rename/delete + drag-to-folder,
// and MULTI-SELECT: click = select one, ctrl-click = toggle, shift-click = range (display order).
// A right-click inside a >1 selection shows the panel's bulkMenu over the whole selection.
type ProjectKind = 'bin' | 'lib' | 'sheet' | 'score' | 'voice' | 'style' | 'imagegen'
type FolderRow = { id: string; name: string; parent: string | null }

// where folders live when they are NOT the open project's — the Open window keeps its folders in
// settings.json (OPEN-WINDOW-SPEC-2026-09-18). Folders + selection + fold state + the mutations.
// Absent = the project store, exactly as ever.
export interface FolderSource {
  folders: FolderRow[]
  sel: string[]
  setSel: (ids: string[]) => void
  collapsed: string[]
  setCollapsed: (ids: string[]) => void
  add: (name: string, parent: string | null) => Promise<string | null> // resolves to the new folder id
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  move: (itemIds: string[], folderId: string | null) => void
}

export function Foldered<T extends { id: string; folder?: string | null; disabled?: boolean }>(props: {
  kind: ProjectKind | 'project'
  items: T[]
  renderItem: (item: T) => React.ReactNode
  itemMenu: (item: T) => MenuEntry[]
  bulkMenu?: (items: T[]) => MenuEntry[] // actions over the whole multi-selection (selection order)
  root?: string | null // when set, this view is scoped to a folder (an "opened" folder tab)
  source?: FolderSource // folders that live outside the open project (kind 'project')
  columns?: number // fixed column count (the Open window's 4) — absent = the zoom-slider stretch grid
}): React.JSX.Element {
  const { items, renderItem, itemMenu, bulkMenu, root = null, source, columns } = props
  const kind = props.kind as ProjectKind // store paths only run without a source, where kind IS a project kind
  const project = useStore((s) => s.project)
  const storeAddFolder = useStore((s) => s.addFolder)
  const storeRenameFolder = useStore((s) => s.renameFolder)
  const storeDeleteFolder = useStore((s) => s.deleteFolder)
  const storeMoveItem = useStore((s) => s.moveItem)
  const storeMoveItems = useStore((s) => s.moveItems)
  const multiSel = useStore((s) => s.multiSel)
  const storeSetMultiSel = useStore((s) => s.setMultiSel)
  const storeClearMultiSel = useStore((s) => s.clearMultiSel)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [localCollapsed, setLocalCollapsed] = useState<Record<string, boolean>>({})
  const [dropF, setDropF] = useState<string | 'root' | null>(null)
  const [dropTile, setDropTile] = useState<string | null>(null) // tile-on-tile reorder target (insert BEFORE it)
  const reorderItems = useStore((s) => s.reorderItems)
  const anchor = useRef<string | null>(null) // shift-range anchor for a source's own selection

  // ---- one set of verbs, two homes: the outside source, else the project store ----
  const addFolder = (k: ProjectKind, name: string, parent: string | null): Promise<string | null> => (source ? source.add(name, parent) : storeAddFolder(k, name, parent))
  const renameFolder = (id: string, name: string): void => void (source ? source.rename(id, name) : storeRenameFolder(id, name))
  const deleteFolder = (id: string): void => void (source ? source.remove(id) : storeDeleteFolder(id))
  const moveItem = (k: ProjectKind, id: string, folderId: string | null): void => void (source ? source.move([id], folderId) : storeMoveItem(k, id, folderId))
  const moveItems = (k: ProjectKind, ids: string[], folderId: string | null): void => void (source ? source.move(ids, folderId) : storeMoveItems(k, ids, folderId))
  const setMultiSel = (k: ProjectKind, ids: string[]): void => (source ? source.setSel(ids) : storeSetMultiSel(k, ids))
  const clearMultiSel = (): void => (source ? source.setSel([]) : storeClearMultiSel())
  const collapsed: Record<string, boolean> = source ? Object.fromEntries(source.collapsed.map((id) => [id, true])) : localCollapsed
  const toggleCollapsed = (id: string): void => {
    if (source) source.setCollapsed(source.collapsed.includes(id) ? source.collapsed.filter((x) => x !== id) : [...source.collapsed, id])
    else setLocalCollapsed((c) => ({ ...c, [id]: !c[id] }))
  }

  const allFolders: FolderRow[] = source ? source.folders : (project?.folders ?? []).filter((f) => f.kind === kind)
  const childFolders = (parent: string | null): FolderRow[] => allFolders.filter((f) => (f.parent ?? null) === parent)
  const itemsIn = (folderId: string | null): T[] => items.filter((it) => (it.folder ?? null) === folderId)

  // ---- multi-select ----
  const selIds = source ? source.sel : (multiSel?.sets[kind] ?? [])
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
  // the one gesture (lib/multiSelect.ts) — ctrl-click keeps other cards' picks, a send takes them all
  // a source's own selection runs the SAME three rules (click = one · ctrl = toggle · shift = range)
  const onItemClick = (e: React.MouseEvent, it: T): void => {
    if (!source) return multiClick(e, kind, it.id, flatIds)
    const cur = source.sel
    if (e.ctrlKey || e.metaKey) {
      anchor.current = it.id
      source.setSel(cur.includes(it.id) ? cur.filter((x) => x !== it.id) : [...cur, it.id])
    } else if (e.shiftKey) {
      const flat = flatIds()
      const a = anchor.current ? flat.indexOf(anchor.current) : -1
      const b = flat.indexOf(it.id)
      if (a < 0 || b < 0) {
        anchor.current = it.id
        source.setSel([it.id])
      } else source.setSel(flat.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else {
      anchor.current = it.id
      source.setSel([it.id])
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
    // >1 selected: make a folder and put the selection in it, one gesture (universal grammar 2026-09-08).
    // The Open window (source) offers it on a SINGLE card too — his call 2026-09-18: a card's
    // right-click must always be able to make the folder it goes into.
    const newFolderWith: MenuEntry[] =
      sel.length > 1 || source
        ? [
            {
              label: sel.length > 1 ? <><Ic i={Plus} size={12} /> new folder with {sel.length}</> : <><Ic i={Plus} size={12} /> new folder…</>,
              onClick: async () => {
                const nm = await textPrompt('New folder name', 'New Folder')
                if (!nm || !nm.trim()) return
                const id = await addFolder(kind, nm.trim(), root)
                if (id) void moveItems(kind, sel.map((i) => i.id), id)
              }
            }
          ]
        : []
    return [
      { sep: true, label: '' },
      ...newFolderWith,
      // Open window: a card already at root has nowhere to "move to root" from — the entry hides
      ...(source && sel.every((i) => (i.folder ?? null) === null) ? [] : [{ label: `↪ move${n} to root`, onClick: () => doMove(null) }]),
      ...allFolders.map((f) => ({ label: '↪ ' + f.name, onClick: () => doMove(f.id) }))
    ]
  }
  const folderMenu = (f: FolderRow): MenuEntry[] => [
    {
      label: <><Ic i={Pencil} size={12} /> rename folder</>,
      onClick: async () => {
        const n = await textPrompt('Rename folder', f.name)
        if (n && n.trim()) void renameFolder(f.id, n.trim())
      }
    },
    { label: <><Ic i={Plus} size={12} /> new subfolder</>, onClick: () => void newFolder(f.id) },
    // sheet/score folders have no dedicated panel to open into — the entry only exists for bin/lib
    ...(!source && (kind === 'bin' || kind === 'lib') ? [{ label: <><Ic i={Copy} size={12} /> open in new tab</>, onClick: () => openFolderPanel(f.id, kind, f.name) } as MenuEntry] : []),
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
      if (o.kind !== props.kind) return
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
    kind === 'lib' ? s.tileZoom.lib : kind === 'sheet' ? (s.tileZoom.sheet ?? s.tileZoom.bin) : kind === 'score' ? (s.tileZoom.score ?? s.tileZoom.bin) : kind === 'style' ? (s.tileZoom.style ?? s.tileZoom.bin) : kind === 'imagegen' ? (s.tileZoom.imagegen ?? s.tileZoom.bin) : (s.tileZoom.clips ?? s.tileZoom.bin)
  )
  const grid = (list: T[]): React.JSX.Element => (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) clearMultiSel() // click in the gaps = deselect
      }}
      style={columns ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 10 } : { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${tileMin}px, 100%), 1fr))`, gap: 6 }}
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
              if (!Array.from(e.dataTransfer.types || []).includes(MIME_MOVE)) return
              if (source) {
                // no reorder in a source list: a card dropped among cards joins THEIR folder
                e.preventDefault()
                e.stopPropagation()
                setDropF(it.folder ?? 'root')
              } else if (kind !== 'sheet' && kind !== 'score' && kind !== 'style') {
                e.preventDefault()
                e.stopPropagation() // don't light the folder/root move targets underneath
                setDropTile(it.id)
              }
            }}
            onDragLeave={() => setDropTile((d) => (d === it.id ? null : d))}
            onDrop={(e) => {
              if (source) return onMoveDrop(e, it.folder ?? null)
              const d = e.dataTransfer.getData(MIME_MOVE)
              setDropTile(null)
              if (!d) return
              try {
                const o = JSON.parse(d) as { kind?: string; id?: string; ids?: string[] }
                if (o.kind !== kind || !o.id) return
                e.preventDefault()
                e.stopPropagation()
                if (kind === 'bin' || kind === 'lib') void reorderItems(kind, o.ids?.length ? o.ids : [o.id], it.id)
              } catch {
                /* ignore */
              }
            }}
            onContextMenu={(e) => {
              // right-click INSIDE the selection acts on the whole selection (other cards' picks included —
              // sendEntryFor carries them); outside it re-selects to just this one
              if (source) {
                // an outside source has no send / duplicate / delete-N lane: a multi-selection gets
                // the move block alone (single-item tools never pretend to act on many)
                const sel = selIds.includes(it.id) ? selectedItems() : []
                if (sel.length > 1) return open(e, moveEntries(sel).slice(1))
                setMultiSel(kind, [it.id])
                anchor.current = it.id
                open(e, [...itemMenu(it), ...moveEntries([it])])
              } else if (selIds.includes(it.id)) {
                const sel = selectedItems()
                // a multi-selection's disable / enable row comes from selectionMenu itself; a lone pick gets it here
                const ms = menuSelection(kind, it.id)
                open(e, [...selectionMenu(kind, it.id, itemMenu(it), sel.length > 1 ? bulkMenu?.(sel) : undefined), ...(ms.count > 1 ? [] : disableEntryFor(kind, it.id)), ...(ms.mixed ? [] : moveEntries(sel))])
              } else {
                setMultiSel(kind, [it.id])
                open(e, [...itemMenu(it), ...disableEntryFor(kind, it.id), ...moveEntries([it])])
              }
            }}
            data-tile=""
            style={{
              userSelect: 'none', // shift-click must range-select, not text-select
              borderRadius: 8,
              outline: isSel ? '2px solid var(--amber)' : 'none',
              outlineOffset: 2,
              boxShadow: dropTile === it.id ? '-3px 0 0 0 var(--amber)' : undefined, // insert-before marker
              position: 'relative'
            }}
          >
            {/* benched (DISABLE-ITEMS-SPEC): the takes' dim + a corner mark — one place, every foldered kind */}
            <div style={it.disabled ? { opacity: 0.4 } : undefined} title={it.disabled ? 'disabled — right-click → enable' : undefined}>
              {renderItem(it)}
            </div>
            {it.disabled && (
              <span style={{ position: 'absolute', top: 3, right: 4, fontSize: 11, lineHeight: 1, color: 'var(--txt-hi)', textShadow: '0 0 3px #000, 0 0 3px #000', pointerEvents: 'none' }}>⃠</span>
            )}
          </div>
        )
      })}
    </div>
  )

  const renderFolder = (f: FolderRow, depth: number): React.JSX.Element => {
    const isOpen = !collapsed[f.id]
    return (
      <div key={f.id} style={{ marginTop: 4 }}>
        <div
          data-folder-row=""
          onClick={() => toggleCollapsed(f.id)}
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ic i={FolderIcon} size={11} /> {f.name}</span>
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
      style={{ outline: dropF === 'root' ? '2px dashed var(--amber-dim)' : 'none', outlineOffset: -2, ...(source ? { minHeight: '100%' } : {}) }}
    >
      {childFolders(root).map((f) => renderFolder(f, 0))}
      <div style={{ marginTop: 6 }}>{grid(itemsIn(root))}</div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  )
}
