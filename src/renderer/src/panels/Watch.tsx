// Watched — a live window over an EXTERNAL folder (e.g. Forge's outputs), in its OWN dockable
// panel so the Library stays clean. Nothing here is a project member: drag a tile into the
// Library (or onto a clip slot) to import it, double-click imports on the spot. Shows the 200
// newest images; the strip refreshes itself while the panel is open.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { toast } from '../ui/Toast'
import { TileZoomSlider, useCtrlWheelZoom } from '../lib/tileZoom'
import { MIME_IMAGE, MIME_WATCH } from '../lib/dragDrop'
import { Ic, Eye, FolderOpen } from '../ui/icons'

export function WatchPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const watchFolder = useStore((s) => s.project?.watchFolder)
  const importPaths = useStore((s) => s.importPaths)
  const zoom = useStore((s) => s.tileZoom.lib) // shares the Library's tile size (ctrl+scroll works here too)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'lib')

  const [watched, setWatched] = useState<{ file: string; name: string; mtime: number }[]>([])
  useEffect(() => {
    if (!watchFolder) {
      setWatched([])
      return
    }
    let live = true
    const refresh = (): void => {
      void window.vidancer.watchList().then((list) => live && setWatched(list))
    }
    refresh()
    const iv = window.setInterval(refresh, 3000)
    return () => {
      live = false
      window.clearInterval(iv)
    }
  }, [watchFolder])

  const pick = async (): Promise<void> => {
    const d = await window.vidancer.watchPick()
    if (d) useStore.getState().applyDelta(d)
  }

  if (!project) {
    return <div className="vd-panel" style={{ padding: 14, color: 'var(--dim)', fontSize: 12 }}>Open or create a project first.</div>
  }

  return (
    <div ref={panelRef} className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--amber)' }}>
          <Ic i={Eye} size={13} />
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontFamily: 'var(--mono)' }} title={watchFolder}>
          {watchFolder ?? 'no folder watched'}
        </span>
        <TileZoomSlider kind="lib" />
        <span className="btn vd-hbtn" onClick={() => void pick()} title="pick / change the watched folder">
          <Ic i={FolderOpen} size={12} /> {watchFolder ? 'change' : 'pick folder'}
        </span>
        {watchFolder && (
          <span
            className="btn vd-hbtn"
            onClick={async () => {
              const d = await window.vidancer.watchClear()
              if (d) useStore.getState().applyDelta(d)
              toast('stopped watching — imported images stay', { kind: 'info' })
            }}
            title="stop watching (imported images stay in the Library)"
          >
            stop
          </span>
        )}
      </div>

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
    </div>
  )
}
