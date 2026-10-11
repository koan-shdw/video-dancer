import { useRef, useState } from 'react'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { TileZoomSlider, useCtrlWheelZoom, EDITTREE_DEFAULT } from '../lib/tileZoom'
import { useStore } from '../store'

// the editors' card size: the tree zoom slider, Clip Gen's 108 px card face at the default
export const useTakeThumbW = (): number => Math.round(((useStore((s) => s.tileZoom.edittree) ?? EDITTREE_DEFAULT) * 108) / 56)

// the editors' right column (Image Gen's sidebar grammar): the left edge drags to resize, › folds
// it to a strip; head = name + buttons, then the takes (ctrl+scroll zooms the cards), foot pins
const sideWidth = new Map<string, number>() // per editor, for the app session
export function EditorSide(p: { label: string; head: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  if (!open)
    return (
      <div onClick={() => setOpen(true)} title="show the takes" style={{ width: 22, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--dim)', fontSize: 10, fontFamily: 'var(--mono)', writingMode: 'vertical-rl' }}>
        ‹ takes
      </div>
    )
  return <SideOpen {...p} onFold={() => setOpen(false)} />
}
function SideOpen(p: { label: string; head: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode; onFold: () => void }): React.JSX.Element {
  const [w, setW] = useState(sideWidth.get(p.label) ?? 240)
  const bodyRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(bodyRef, 'edittree')
  return (
    <div style={{ width: w, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          const x0 = e.clientX
          const move = (ev: MouseEvent): void => {
            const nw = Math.max(200, Math.min(560, w - (ev.clientX - x0)))
            sideWidth.set(p.label, nw)
            setW(nw)
          }
          const up = (): void => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
        title="drag to resize"
        style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 3 }}
      />
      <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
        <div className="lb" style={{ display: 'flex', alignItems: 'center' }}>
          {p.label}
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={p.onFold} title="fold the sidebar away">
            ›
          </span>
        </div>
        {p.head}
      </div>
      <div ref={bodyRef} className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="lb" style={{ flex: 1, margin: 0 }} title="click = view · drag a card out to keep it · right-click = actions">
            takes
          </div>
          <TileZoomSlider kind="edittree" />
        </div>
        {p.children}
      </div>
      {p.foot}
    </div>
  )
}

// THE editors' take tree (Video Editor + Image Editor sidebars, his call 10-11): the original
// card, then every branch as a row of Clip Gen take cards under "from original" / "from T1";
// ▾ folds a branch. Click = select · drag = the editor's own payload · right-click = its menu.
export interface TakeTreeItem {
  id: string
  parentId: string | null
  file: string
  num: number // T number, in the order the takes were made
  meta?: string // right of the number: 10.0s · 864×1184
  line?: string // the model line
  prompt?: string
  primary?: boolean // ◉ the source wears this one
  kept?: boolean // ★ saved to the Library
  title?: string // hover
  refs?: { file: string; title: string }[] // the refs that made it, as mini thumbs (Image Editor)
}
export interface TakeTreeRoot {
  file: string
  name: string
  meta?: string
  primary?: boolean
  title?: string
}

export function TakeTree(p: {
  root: TakeTreeRoot | null
  items: TakeTreeItem[]
  video?: boolean
  selectedId: string | null // null = the original
  thumbW: number
  onSelect: (id: string | null) => void
  onMenu?: (e: React.MouseEvent, id: string | null) => void
  onDrag?: (e: React.DragEvent, id: string) => void
  empty: string
}): React.JSX.Element {
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const thumbH = Math.round((p.thumbW * 61) / 108) // Clip Gen's 108×61 card face at every zoom
  const ids = new Set(p.items.map((x) => x.id))
  const byParent = new Map<string | null, TakeTreeItem[]>()
  for (const it of p.items) {
    const k = it.parentId && ids.has(it.parentId) ? it.parentId : null // a take whose parent is gone hangs off the original
    byParent.set(k, [...(byParent.get(k) ?? []), it])
  }
  const below = (id: string | null): number => (byParent.get(id) ?? []).reduce((n, c) => n + 1 + below(c.id), 0)

  const card = (o: { key: string; id: string | null; file: string; head: string; meta?: string; line?: string; prompt?: string; primary?: boolean; kept?: boolean; title?: string; refs?: TakeTreeItem['refs'] }): React.JSX.Element => {
    const sel = o.id === p.selectedId
    return (
      <div
        key={o.key}
        data-take={o.id ?? 'original'}
        draggable={!!(o.id && p.onDrag)}
        onDragStart={(e) => o.id && p.onDrag?.(e, o.id)}
        onClick={() => p.onSelect(o.id)}
        onContextMenu={(e) => {
          if (!p.onMenu) return
          e.preventDefault()
          p.onMenu(e, o.id)
        }}
        title={o.title}
        style={{ width: p.thumbW + 12, borderRadius: 7, border: `2px solid ${sel ? 'var(--amber)' : 'var(--line2)'}`, background: 'var(--bg2)', padding: 4, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <Thumbnail {...(p.video ? { videoFile: o.file, scrubVideo: o.file } : { file: o.file })} w={p.thumbW} h={thumbH} />
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 11, color: 'var(--txt-hi)' }}>
          <b>{o.head}</b>
          {o.primary && <span title="◉ primary — the source wears this one everywhere" style={{ color: 'var(--amber)' }}>◉</span>}
          {o.kept && <span title="★ saved to the Library" style={{ color: 'var(--amber)' }}>★</span>}
          {o.meta && <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>{o.meta}</span>}
        </span>
        {o.line && <span style={{ fontSize: 8.5, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.line}</span>}
        {o.prompt && <span style={{ fontSize: 8.5, color: 'var(--body)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{o.prompt}</span>}
        {!!o.refs?.length && (
          <span style={{ display: 'flex', gap: 2 }}>
            {o.refs.slice(0, 4).map((r, i) => (
              <img key={i} src={mediaUrl(r.file)} alt="" title={r.title} style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--line)' }} />
            ))}
          </span>
        )}
      </div>
    )
  }

  const branch = (parentId: string | null, from: string): React.JSX.Element | null => {
    const kids = byParent.get(parentId) ?? []
    if (!kids.length) return null
    const key = parentId ?? ''
    const shut = folded.has(key)
    return (
      <div key={`b${key}`}>
        <div
          onClick={() =>
            setFolded((s) => {
              const n = new Set(s)
              if (n.has(key)) n.delete(key)
              else n.add(key)
              return n
            })
          }
          title={shut ? 'show this branch' : 'fold this branch'}
          style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', margin: '8px 0 5px 4px', cursor: 'pointer', userSelect: 'none' }}
        >
          {shut ? '▸' : '▾'} from {from}
          {shut ? ` · ${below(parentId)} folded` : ''}
        </div>
        {!shut && (
          <div style={{ marginLeft: 6, paddingLeft: 8, borderLeft: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {kids.map((k) => card({ key: k.id, id: k.id, file: k.file, head: `T${k.num}`, meta: k.meta, line: k.line, prompt: k.prompt, primary: k.primary, kept: k.kept, title: k.title, refs: k.refs }))}
            </div>
            {kids.map((k) => branch(k.id, `T${k.num}`))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {p.root && (
        <div style={{ display: 'flex' }}>
          {card({ key: 'original', id: null, file: p.root.file, head: 'original', meta: p.root.meta, line: p.root.name, primary: p.root.primary, title: p.root.title })}
        </div>
      )}
      {branch(null, 'original')}
      {p.items.length === 0 && <p className="vd-hint" style={{ marginTop: 8 }}>{p.empty}</p>}
    </div>
  )
}
