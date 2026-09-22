import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
// Watched — a live window over an EXTERNAL folder (e.g. Forge's outputs), in its OWN dockable
// panel so the Library stays clean. Nothing here is a project member: drag a tile into the
// Library (or onto a clip slot) to import it, double-click imports on the spot. Shows the 200
// newest images; the strip refreshes itself while the panel is open.
// CIVIT (CIVIT-LIKES-SPEC-2026-09-09): a second filter, `local | civit` (the LoRA sidebar's pair) —
// civit lists the images he LIKED on civitai.com; click = the PNG reader's menu (send to prompt, the
// loras used), right-click adds import / open on civitai / send to Co-Director; drag and
// double-click import exactly as local tiles do.
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

type Tab = 'local' | 'civit'

export function WatchPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const watchFolder = useStore((s) => s.project?.watchFolder)
  const importPaths = useStore((s) => s.importPaths)
  const zoom = useStore((s) => s.tileZoom.lib) // shares the Library's tile size (ctrl+scroll works here too)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'lib')
  const [tab, setTab] = useState<Tab>('local')

  const [watched, setWatched] = useState<{ file: string; name: string; mtime: number }[]>([])
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
  }, [watchFolder])

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
        {headBtn('civit', 'civit', 'the images you liked on civitai.com — click one for its prompt and loras')}
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
        <CivitLikes zoom={zoom} />
      ) : (
        <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 8 }}>
          {!watchFolder && (
            <p className="vd-hint" style={{ margin: 4 }}>
              Watch an external folder — Forge outputs, downloads, anywhere. Its newest images show here live; drag one
              into the Library (or straight onto a clip slot) to bring it into the project.
            </p>
          )}
          {watchFolder && watched.length === 0 && (
            <p className="vd-hint" style={{ margin: 4 }}>nothing here yet — new images in the watched folder appear here live</p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {watched.map((wi) => (
              <div
                key={wi.file}
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
                title={`${wi.name} · drag into the Library or a clip slot · double-click = import now`}
              >
                <Thumbnail file={wi.file} label={wi.name} w={zoom} h={Math.round(zoom * 0.643)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- civit: the images he liked on civitai.com (site lane through main; the key from Settings) ----
function CivitLikes({ zoom }: { zoom: number }): React.JSX.Element {
  const importPaths = useStore((s) => s.importPaths)
  const folderRows = useFolderLoras()
  const [items, setItems] = useState<CivitLikedImage[] | null>(null)
  const [cursor, setCursor] = useState<string | number | undefined>()
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const prefetching = useRef(new Set<number>())

  const load = async (more = false): Promise<void> => {
    const r = await vd().civitLiked(more ? cursor : undefined)
    if (!r.ok) {
      setErr(r.error ?? 'civitai did not answer')
      if (!more) setItems((cur) => cur ?? [])
      return
    }
    setErr('')
    setItems((cur) => (more && cur ? [...cur, ...(r.items ?? [])] : (r.items ?? [])))
    setCursor(r.nextCursor)
  }
  // on open, and every 60 s while showing — likes change on the site, not here
  useEffect(() => {
    void load()
    const iv = window.setInterval(() => void load(), 60_000)
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
            useStore.getState().setImageGenUseSeed(g.rel)
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
        useLora: (rel) => {
          if (useStore.getState().editorImageGenId) {
            useStore.getState().setImageGenUseSeed(rel)
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
      {items === null && !err && <p className="vd-hint" style={{ margin: 4 }}>reading your likes…</p>}
      {noKey && <EmptyState>paste your Civitai key in Settings to see your likes</EmptyState>}
      {err && !noKey && (
        <div style={{ fontSize: 10.5, color: 'var(--bad)', margin: 4 }} title="local keeps working — this is the civitai side">
          ✕ {err}
        </div>
      )}
      {items && items.length === 0 && !err && <EmptyState>nothing liked yet — ♥ an image on civitai and it lands here</EmptyState>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
        {(items ?? []).map((it) => (
          <CivitTile
            key={it.id}
            it={it}
            zoom={zoom}
            busy={busyId === it.id}
            onOpen={(x, y) => void openMenu(it, x, y)}
            onPrefetch={() => prefetch(it)}
            onImport={() => void importIt(it).then((ids) => ids.length && toast('imported → Library', { kind: 'ok' }))}
          />
        ))}
      </div>
      {items && items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {cursor != null && (
            <span className="btn koan-hbtn" onClick={() => void load(true)} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title="the next page of likes">
              more
            </span>
          )}
          <span className="btn koan-hbtn" onClick={() => void load()} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title="read your likes again now (they refresh every minute on their own)">
            ↻
          </span>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  )
}

function CivitTile({ it, zoom, busy, onOpen, onPrefetch, onImport }: { it: CivitLikedImage; zoom: number; busy: boolean; onOpen: (x: number, y: number) => void; onPrefetch: () => void; onImport: () => void }): React.JSX.Element {
  const data = useThumb(it.thumbUrl)
  const ratio = it.width && it.height ? it.height / it.width : 1.2
  const h = Math.round(zoom * Math.max(0.5, Math.min(1.6, ratio)))
  return (
    <div
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
      onClick={(e) => onOpen(e.clientX, e.clientY)}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpen(e.clientX, e.clientY)
      }}
      onDoubleClick={onImport}
      title={`${it.username ? `by ${it.username}` : 'civitai'}${it.hasPrompt ? ' · prompt shared' : ' · no prompt shared'} · click = prompt + loras menu · drag = Library or a slot · double-click = import`}
      style={{ width: zoom, height: h, borderRadius: 4, overflow: 'hidden', background: 'var(--field)', border: '1px solid var(--line)', cursor: 'pointer', opacity: busy ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} /> : <span style={{ fontSize: 14, color: 'var(--dim)' }}>▦</span>}
    </div>
  )
}
