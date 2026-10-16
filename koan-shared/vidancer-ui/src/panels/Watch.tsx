import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
// Watched — a live window over an EXTERNAL folder (e.g. Forge's outputs), in its OWN dockable
// panel so the Library stays clean. Nothing here is a project member: drag a tile into the
// Library (or onto a clip slot) to import it, double-click imports on the spot. Shows the 200
// newest images; the strip refreshes itself while the panel is open.
// CIVIT (CIVIT-LIKES-SPEC-2026-09-09): a second filter, `local | civit` (the LoRA sidebar's pair) —
// civit lists the images he LIKED on civitai.com; right-click = the PNG reader's menu (send to prompt,
// the loras used, import / open on civitai / send to Co-Director); drag and double-click import
// exactly as local tiles do. A click selects and ~ tags for the Co-Director (useTagSelect, below).
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { toast } from '../ui/Toast'
import { TileZoomSlider, useCtrlWheelZoom } from '../lib/tileZoom'
import { MIME_IMAGE, MIME_WATCH, MIME_CIVIT } from '../lib/dragDrop'
import { Ic, Eye, FolderOpen } from '../ui/icons'
import { ContextMenu, type MenuEntry } from '@koan/shared'
import { buildSettingsMenu } from '../lib/settingsMenu'
import { getLoraByVersion } from '../lib/civitActions'
import { useThumb, useFolderLoras } from './ImageGenSidebar'
import { openCoDirector, openImageGen } from '../panelBus'
import { arrowNav } from '../lib/arrowNav'
import { useTakeMultiSelect } from '../lib/takeSelection'
import { selRing } from '../lib/multiSelect'

type Tab = 'local' | 'civit'

// ~ (CODIR-BATCH-SPEC-2026-10-03 F): the take trays' select on these tiles (click = this one,
// Ctrl/⌘-click = add/remove, Shift-click = range, arrows move) and ~ tags the selected, or the one
// the arrows sit on, for the Co-Director; ~ again untags. A tagged tile wears a lit ★.
function useTagSelect(owner: string, ids: string[], tagOf: (id: string) => CodirTag | null): { sel: ReturnType<typeof useTakeMultiSelect>; nav: ReturnType<typeof arrowNav>; click: (e: React.MouseEvent, id: string) => void; tagged: (key: string) => boolean } {
  const sel = useTakeMultiSelect(owner, ids)
  const tags = useStore((s) => s.codirTags)
  const nav = arrowNav(
    (id) => sel.selectOnly(id),
    (id) => {
      const pick = (sel.selectedIds.length ? sel.selectedIds : id ? [id] : []).map(tagOf).filter((x): x is CodirTag => !!x)
      if (pick.length) useStore.getState().toggleCodirTags(pick)
    }
  )
  // a plain click selects this one (select() answers false: no modifier)
  const click = (e: React.MouseEvent, id: string): void => void (sel.select(e, id) || sel.selectOnly(id))
  return { sel, nav, click, tagged: (key) => tags.some((t) => t.key === key) }
}
// the lit ★ on a tagged tile; a click on it untags (KeeperStar's grammar)
function TagStar({ onUntag }: { onUntag: () => void }): React.JSX.Element {
  return (
    <span
      role="button"
      aria-label="tagged for the Co-Director, click to untag"
      title="tagged for the Co-Director: it sees this picture and its prompt · click the ★ (or ~) to untag"
      onClick={(e) => {
        e.stopPropagation()
        onUntag()
      }}
      style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.72)', color: 'var(--amber)', borderRadius: 4, padding: '0 4px', fontSize: 12, lineHeight: '16px', cursor: 'pointer' }}
    >
      ★
    </span>
  )
}

export function WatchPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const watchFolder = useStore((s) => s.project?.watchFolder)
  const importPaths = useStore((s) => s.importPaths)
  const zoom = useStore((s) => s.tileZoom.lib) // shares the Library's tile size (ctrl+scroll works here too)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'lib')
  const [tab, setTab] = useState<Tab>('local')

  const [watched, setWatched] = useState<{ file: string; name: string; mtime: number }[]>([])
  const [tick, setTick] = useState(0) // a drop re-reads the strip now, not at the next 3 s
  useEffect(() => {
    if (!watchFolder) {
      setWatched([])
      return
    }
    let live = true
    const refresh = (): void => {
      void vd().watchList().then((list) => live && setWatched(list))
    }
    refresh()
    const iv = window.setInterval(refresh, 3000)
    return () => {
      live = false
      window.clearInterval(iv)
    }
  }, [watchFolder, tick])

  // item 8 (THE LIST 2026-09-22): a tile dropped here → a copy of its file in the watched folder
  // (a lora's example, a like, a Library image). His words: "drag to watched".
  const [over, setOver] = useState(false)
  const dropTypes = [MIME_WATCH, MIME_CIVIT, MIME_IMAGE]
  const addToWatched = async (file: string): Promise<void> => {
    const r = await vd().watchAdd(file)
    if (!r.ok) return void toast(r.error ?? 'could not copy it', { kind: 'error' })
    toast(`${file.split(/[\\/]/).pop()} → watched`, { kind: 'ok' })
    setTick((t) => t + 1)
  }
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    setOver(false)
    const path = e.dataTransfer.getData(MIME_WATCH) || e.dataTransfer.getData(MIME_IMAGE)
    const civit = e.dataTransfer.getData(MIME_CIVIT)
    if (!path && !civit) return
    e.preventDefault()
    if (path) return addToWatched(path)
    const o = JSON.parse(civit) as { id: number; url: string }
    const r = await vd().civitImageFile(o.id, o.url)
    if (!r.ok || !r.file) return void toast(r.error ?? 'could not fetch the image', { kind: 'error' })
    await addToWatched(r.file)
  }

  const localTag = (file: string): CodirTag | null => {
    const wi = watched.find((x) => x.file === file)
    return wi ? { key: wi.file, name: `${wi.name} (Watched)`, file: wi.file } : null
  }
  const local = useTagSelect(watchFolder ?? '', watched.map((x) => x.file), localTag)

  const pick = async (): Promise<void> => {
    const d = await vd().watchPick()
    if (d) useStore.getState().applyDelta(d)
  }

  if (!project) {
    return <EmptyState>open or create a project first</EmptyState>
  }

  // the LoRA sidebar's pair: two buttons, one lit
  const headBtn = (k: Tab, label: string, title: string): React.JSX.Element => (
    <span className="btn vd-hbtn" onClick={() => setTab(k)} title={title} style={tab === k ? { background: 'var(--amber)', color: 'var(--on-accent)' } : undefined}>
      {label}
    </span>
  )

  return (
    <div ref={panelRef} className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--amber)' }}>
          <Ic i={Eye} size={13} />
        </span>
        {headBtn('local', 'local', 'a folder on this machine — its newest images, live')}
        {headBtn('civit', 'civit', 'the images you liked on civitai.com — right-click one for its prompt and loras')}
        {tab === 'local' ? (
          <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontFamily: 'var(--mono)' }} title={watchFolder}>
            {watchFolder ?? 'no folder watched'}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <TileZoomSlider kind="lib" />
        {tab === 'local' && (
          <span className="btn vd-hbtn" onClick={() => void pick()} title="pick / change the watched folder">
            <Ic i={FolderOpen} size={12} /> {watchFolder ? 'change' : 'pick folder'}
          </span>
        )}
        {tab === 'local' && watchFolder && (
          <span
            className="btn vd-hbtn"
            onClick={async () => {
              const d = await vd().watchClear()
              if (d) useStore.getState().applyDelta(d)
              toast('stopped watching — imported images stay', { kind: 'info' })
            }}
            title="stop watching (imported images stay in the Library)"
          >
            stop
          </span>
        )}
      </div>

      {tab === 'civit' ? (
        <CivitImages zoom={zoom} load={(c) => vd().civitLiked(c)} reading="reading your likes…" empty="nothing liked yet — ♥ an image on civitai and it lands here" refreshMs={60_000} />
      ) : (
        <div
          className="vd-scroll"
          style={{ flex: 1, minHeight: 0, padding: 8, outline: over ? '1px dashed var(--amber)' : undefined, outlineOffset: -4 }}
          onDragOver={(e) => {
            if (!dropTypes.some((t) => e.dataTransfer.types.includes(t))) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void onDrop(e)}
        >
          {!watchFolder && (
            <p className="vd-hint" style={{ margin: 4 }}>
              Watch an external folder — Forge outputs, downloads, anywhere. Its newest images show here live; drag one
              into the Library (or straight onto a clip slot) to bring it into the project. Drop a tile here and a copy
              lands in the folder.
            </p>
          )}
          {watchFolder && watched.length === 0 && (
            <p className="vd-hint" style={{ margin: 4 }}>nothing here yet — new images in the watched folder appear here live</p>
          )}
          <div {...local.nav} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, outline: 'none' }}>
            {watched.map((wi) => (
              <div
                key={wi.file}
                data-nav={wi.file}
                onClick={(e) => local.click(e, wi.file)}
                style={{ position: 'relative', borderRadius: 4, ...selRing(local.sel.isSelected(wi.file)) }}
                draggable
                onDragStart={(e) => {
                  // MIME_IMAGE too: dropping straight onto a ref/start/end slot works — the file
                  // auto-imports at render time (render:run copies + dedups source images)
                  e.dataTransfer.setData(MIME_WATCH, wi.file)
                  e.dataTransfer.setData(MIME_IMAGE, wi.file)
                }}
                onDoubleClick={() =>
                  void importPaths([wi.file]).then(() => toast(`${wi.name} → Library`, { kind: 'ok' }))
                }
                title={`${wi.name} · click = select · ~ = tag for the Co-Director · drag into the Library or a clip slot · double-click = import now`}
              >
                <Thumbnail file={wi.file} label={wi.name} w={zoom} h={Math.round(zoom * 0.643)} />
                {local.tagged(wi.file) && <TagStar onUntag={() => useStore.getState().toggleCodirTags([localTag(wi.file)!])} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- item 8 (THE LIST 2026-09-22): ONE lora's posted examples, in their own window. The tiles are
// Watched's civit tiles: click = the popup, right-click same, drag = Library / a slot / Watched,
// double-click = import. Opened from the LoRA sidebar's right-click → `examples`. ----
export function CivitExamplesPanel({ versionId, name, homepage }: { versionId: number; name: string; homepage?: string }): React.JSX.Element {
  const zoom = useStore((s) => s.tileZoom.lib)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'lib')
  return (
    <div ref={panelRef} className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontFamily: 'var(--mono)' }} title={name}>
          {name}
        </span>
        <TileZoomSlider kind="lib" />
        {homepage && (
          <span className="btn vd-hbtn" onClick={() => void vd().openExternal(homepage)} title="open this lora on civitai.com">
            ↗ civitai
          </span>
        )}
      </div>
      <CivitImages zoom={zoom} load={(c) => vd().civitVersionImages(versionId, c as string | undefined)} reading="reading examples…" empty="nothing posted for this lora yet" />
    </div>
  )
}

// ---- civit tiles: his likes (Watched's civit tab) or one lora's examples (the window above) — ONE
// grid, ONE popup (site lane through main; the key from Settings) ----
type CivitLoad = (cursor?: string | number) => Promise<{ ok: boolean; items?: CivitLikedImage[]; nextCursor?: string | number; error?: string }>
function CivitImages({ zoom, load: fetchPage, reading, empty, refreshMs }: { zoom: number; load: CivitLoad; reading: string; empty: string; refreshMs?: number }): React.JSX.Element {
  const importPaths = useStore((s) => s.importPaths)
  const folderRows = useFolderLoras()
  const [items, setItems] = useState<CivitLikedImage[] | null>(null)
  const [cursor, setCursor] = useState<string | number | undefined>()
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const prefetching = useRef(new Set<number>())
  const civitTag = (id: string): CodirTag | null => {
    const it = items?.find((x) => String(x.id) === id)
    return it ? { key: `civit:${it.id}`, name: `civitai image ${it.id}${it.username ? ` by ${it.username}` : ''}`, civit: { id: it.id, thumbUrl: it.thumbUrl } } : null
  }
  const grid = useTagSelect('civit', (items ?? []).map((x) => String(x.id)), civitTag)

  const load = async (more = false): Promise<void> => {
    const r = await fetchPage(more ? cursor : undefined)
    if (!r.ok) {
      setErr(r.error ?? 'civitai did not answer')
      if (!more) setItems((cur) => cur ?? [])
      return
    }
    setErr('')
    setItems((cur) => (more && cur ? [...cur, ...(r.items ?? [])] : (r.items ?? [])))
    setCursor(r.nextCursor)
  }
  // on open, and (likes) every 60 s while showing — likes change on the site, not here
  useEffect(() => {
    void load()
    if (!refreshMs) return
    const iv = window.setInterval(() => void load(), refreshMs)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the full image to disk through main — once; the tile then drags as a real file (slots take it)
  const fileFor = async (it: CivitLikedImage): Promise<string | null> => {
    if (it.cachedFile) return it.cachedFile
    const r = await vd().civitImageFile(it.id, it.fullUrl)
    if (!r.ok || !r.file) {
      toast(r.error ?? 'could not fetch the image', { kind: 'error' })
      return null
    }
    const file = r.file
    setItems((cur) => cur?.map((x) => (x.id === it.id ? { ...x, cachedFile: file } : x)) ?? cur)
    return file
  }
  const prefetch = (it: CivitLikedImage): void => {
    if (it.cachedFile || prefetching.current.has(it.id)) return
    prefetching.current.add(it.id)
    void fileFor(it)
  }
  const importIt = async (it: CivitLikedImage): Promise<string[]> => {
    const f = await fileFor(it)
    return f ? importPaths([f]) : []
  }
  // import → the Library's civit folder → his @title in the Co-Director's box with the ask; he sends
  const sendToCoDirector = async (it: CivitLikedImage): Promise<void> => {
    const ids = await importIt(it)
    const st = useStore.getState()
    if (!ids.length || !st.project) return
    let folder = st.project.folders.find((f) => f.kind === 'lib' && f.name === 'civit' && !f.parent)?.id ?? null
    if (!folder) folder = await st.addFolder('lib', 'civit', null)
    if (folder) await st.moveItems('lib', ids, folder)
    const title = useStore.getState().project?.images.find((i) => i.id === ids[0])?.title ?? ''
    st.setCodirSeed(`${title} write an image gen prompt from this`.trim())
    openCoDirector()
  }
  const openMenu = async (it: CivitLikedImage, x: number, y: number): Promise<void> => {
    setBusyId(it.id)
    const r = await vd().civitGeneration(it.id)
    setBusyId(null)
    // CIVIT-DRAG-SPEC-2026-09-19 §2: the settings first, import / open under them, and LAST his
    // words — "get Co-Director to make this as a prompt" (the shared menu places both)
    const tail: MenuEntry[] = [
      { label: <>→ import to Library</>, onClick: () => void importIt(it).then((ids) => ids.length && toast('imported → Library', { kind: 'ok' })) },
      { label: <>open on civitai.com</>, onClick: () => void vd().openExternal(`https://civitai.com/images/${it.id}`) }
    ]
    const s: PngSettings = r.ok && r.settings ? r.settings : { source: 'civit', prompt: '', loras: [] }
    const entries = buildSettingsMenu(
      s,
      folderRows,
      {
        tail,
        toCoDirector: () => void sendToCoDirector(it),
        // not in his folders → download it, then hand it to the open image gen's slot
        getLora: (l) => {
          if (!l.versionId) return
          if (!useStore.getState().editorImageGenId) return void toast('open an image gen first — the lora goes into the open one', { kind: 'error' })
          toast(`getting ${l.name}… progress is in Image Gen's lora sidebar`, { kind: 'ok' })
          void getLoraByVersion(l.versionId).then((g) => {
            if (!g.ok) return void toast(g.error, { kind: 'error' })
            useStore.getState().addImageGenUseSeed(g.rel, l.weight)
            openImageGen()
            toast(`${l.name} → image gen`, { kind: 'ok' })
          })
        },
        sendToPrompt: (prompt) => {
          if (useStore.getState().sendPromptToImageGen(prompt)) {
            openImageGen()
            toast('prompt → image gen', { kind: 'ok' })
          } else toast('open an image gen first — the prompt goes into the open one', { kind: 'error' })
        },
        useLora: (rel, weight) => {
          if (useStore.getState().editorImageGenId) {
            useStore.getState().addImageGenUseSeed(rel, weight)
            openImageGen()
          } else toast('open an image gen first', { kind: 'error' })
        },
        searchCivit: (name) => {
          useStore.getState().setImageGenSearchSeed(name)
          openImageGen()
        }
      }
    )
    if (!r.ok && r.error) entries.unshift({ label: <span style={{ color: 'var(--bad)' }}>✕ {r.error}</span>, disabled: true })
    setMenu({ x, y, entries })
  }

  const noKey = /key/i.test(err)
  return (
    <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 8 }}>
      {items === null && !err && <p className="vd-hint" style={{ margin: 4 }}>{reading}</p>}
      {noKey && <EmptyState>paste your Civitai key in Settings to see your likes</EmptyState>}
      {err && !noKey && (
        <div style={{ fontSize: 10.5, color: 'var(--bad)', margin: 4 }} title="local keeps working — this is the civitai side">
          ✕ {err}
        </div>
      )}
      {items && items.length === 0 && !err && <EmptyState>{empty}</EmptyState>}
      <div {...grid.nav} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', outline: 'none' }}>
        {(items ?? []).map((it) => (
          <CivitTile
            key={it.id}
            it={it}
            zoom={zoom}
            busy={busyId === it.id}
            selected={grid.sel.isSelected(String(it.id))}
            tagged={grid.tagged(`civit:${it.id}`)}
            onSelect={(e) => grid.click(e, String(it.id))}
            onUntag={() => useStore.getState().toggleCodirTags([civitTag(String(it.id))!])}
            onOpen={(x, y) => void openMenu(it, x, y)}
            onPrefetch={() => prefetch(it)}
            onImport={() => void importIt(it).then((ids) => ids.length && toast('imported → Library', { kind: 'ok' }))}
          />
        ))}
      </div>
      {items && items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {cursor != null && (
            <span className="btn koan-hbtn" onClick={() => void load(true)} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title="the next page">
              more
            </span>
          )}
          <span className="btn koan-hbtn" onClick={() => void load()} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={refreshMs ? 'read your likes again now (they refresh every minute on their own)' : 'read again now'}>
            ↻
          </span>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  )
}

function CivitTile({ it, zoom, busy, selected, tagged, onSelect, onUntag, onOpen, onPrefetch, onImport }: { it: CivitLikedImage; zoom: number; busy: boolean; selected: boolean; tagged: boolean; onSelect: (e: React.MouseEvent) => void; onUntag: () => void; onOpen: (x: number, y: number) => void; onPrefetch: () => void; onImport: () => void }): React.JSX.Element {
  const data = useThumb(it.thumbUrl)
  const ratio = it.width && it.height ? it.height / it.width : 1.2
  const h = Math.round(zoom * Math.max(0.5, Math.min(1.6, ratio)))
  return (
    <div
      data-nav={String(it.id)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_CIVIT, JSON.stringify({ id: it.id, url: it.fullUrl }))
        if (it.cachedFile) {
          // already on disk → exactly a Watched file: the Library imports it, a clip slot takes it
          e.dataTransfer.setData(MIME_WATCH, it.cachedFile)
          e.dataTransfer.setData(MIME_IMAGE, it.cachedFile)
        }
      }}
      onMouseEnter={onPrefetch}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpen(e.clientX, e.clientY)
      }}
      onDoubleClick={onImport}
      title={`${it.username ? `by ${it.username}` : 'civitai'}${it.hasPrompt ? ' · prompt shared' : ''} · click = select · ~ = tag for the Co-Director · right-click = prompt + loras menu · drag = Library, a slot or Watched · double-click = import`}
      style={{ position: 'relative', width: zoom, height: h, borderRadius: 4, overflow: 'hidden', background: 'var(--field)', border: '1px solid var(--line)', cursor: 'pointer', opacity: busy ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', ...selRing(selected) }}
    >
      {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} /> : <span style={{ fontSize: 14, color: 'var(--dim)' }}>▦</span>}
      {tagged && <TagStar onUntag={onUntag} />}
    </div>
  )
}
