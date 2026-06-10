import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { textPrompt, confirmDialog } from '../prompt'
import { openFolderPanel } from '../panelBus'
import { MIME_MOVE } from '../lib/dragDrop'

export type MenuEntry = { label: string; onClick?: () => void; danger?: boolean; sep?: boolean }

function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  return createPortal(
    <div
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 2500 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', left: x, top: y, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 170, maxHeight: 320, overflow: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,.55)' }}
      >
        {entries.map((en, i) =>
          en.sep ? (
            <div key={i} style={{ height: 1, background: 'var(--line2)', margin: '4px 0' }} />
          ) : (
            <div
              key={i}
              onClick={() => {
                en.onClick?.()
                onClose()
              }}
              style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: en.danger ? '#e88' : '#e8e8ee', whiteSpace: 'nowrap' }}
            >
              {en.label}
            </div>
          )
        )}
      </div>
    </div>,
    document.body
  )
}

// folder tree + right-click menus for a clip Bin or image Library. The panel supplies how to draw an item
// and its item-specific menu entries; this adds "move to folder" + folder create/rename/delete + drag-to-folder.
export function Foldered<T extends { id: string; folder?: string | null }>(props: {
  kind: 'bin' | 'lib'
  items: T[]
  renderItem: (item: T) => React.ReactNode
  itemMenu: (item: T) => MenuEntry[]
  root?: string | null // when set, this view is scoped to a folder (an "opened" folder tab)
}): React.JSX.Element {
  const { kind, items, renderItem, itemMenu, root = null } = props
  const project = useStore((s) => s.project)
  const addFolder = useStore((s) => s.addFolder)
  const renameFolder = useStore((s) => s.renameFolder)
  const deleteFolder = useStore((s) => s.deleteFolder)
  const moveItem = useStore((s) => s.moveItem)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dropF, setDropF] = useState<string | 'root' | null>(null)

  const allFolders = (project?.folders ?? []).filter((f) => f.kind === kind)
  const childFolders = (parent: string | null): Folder[] => allFolders.filter((f) => (f.parent ?? null) === parent)
  const itemsIn = (folderId: string | null): T[] => items.filter((it) => (it.folder ?? null) === folderId)

  const open = (e: React.MouseEvent, entries: MenuEntry[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, entries })
  }
  const newFolder = async (parent: string | null): Promise<void> => {
    const n = await textPrompt('New folder name', 'New Folder')
    if (n && n.trim()) void addFolder(kind, n.trim(), parent)
  }
  const moveEntries = (item: T): MenuEntry[] => [
    { sep: true, label: '' },
    { label: '↪ move to root', onClick: () => void moveItem(kind, item.id, null) },
    ...allFolders.map((f) => ({ label: '↪ ' + f.name, onClick: () => void moveItem(kind, item.id, f.id) }))
  ]
  const folderMenu = (f: Folder): MenuEntry[] => [
    {
      label: '✎ rename folder',
      onClick: async () => {
        const n = await textPrompt('Rename folder', f.name)
        if (n && n.trim()) void renameFolder(f.id, n.trim())
      }
    },
    { label: '＋ new subfolder', onClick: () => void newFolder(f.id) },
    { label: '⧉ open in new tab', onClick: () => openFolderPanel(f.id, kind, f.name) },
    { sep: true, label: '' },
    {
      label: '🗑 delete folder',
      danger: true,
      onClick: async () => {
        if (await confirmDialog(`Delete folder "${f.name}"? Its contents move to the parent — items are not deleted.`)) void deleteFolder(f.id)
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
      const o = JSON.parse(d) as { kind?: string; id?: string }
      if (o.kind === kind && o.id) void moveItem(kind, o.id, folderId)
    } catch {
      /* ignore */
    }
  }

  const grid = (list: T[]): React.JSX.Element => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {list.map((it) => (
        <div key={it.id} onContextMenu={(e) => open(e, [...itemMenu(it), ...moveEntries(it)])}>
          {renderItem(it)}
        </div>
      ))}
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
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, background: dropF === f.id ? 'rgba(231,169,60,.18)' : 'transparent' }}
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
      onContextMenu={(e) => open(e, [{ label: '＋ new folder', onClick: () => void newFolder(root) }])}
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
