import { vd } from '../api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { TileZoomSlider, useCtrlWheelZoom } from '../lib/tileZoom'
import { mediaUrl } from '../media'
import { smpte } from '../lib/time'
import { MIME_IMAGE, MIME_IMAGES, MIME_MOVE, MIME_AUDIO, MIME_VIDEO, MIME_EDITNODE, MIME_WATCH, MIME_TAKE } from '../lib/dragDrop'
import { toast } from '../ui/Toast'
import { Ic, ImageDown, ImagePlay, ListVideo, Sparkles, Film, Music, Pencil, Trash2, Copy, Wand2, Eye, Person, Scene } from '../ui/icons'
import { openSheetGen } from '../panelBus'
import { Foldered, type MenuEntry } from './Foldered'
import { ContextMenu, dropPath } from '@koan/shared'
import { sendToProjectEntry } from '../lib/sendToProject'
import { textPrompt, confirmDialog, alertDialog } from '../prompt'
import { openImageEditor, openVideoEditor, openWatchPanel } from '../panelBus'

const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv|avi)$/i

// one ♪ row in the music section — draggable onto the timeline's audio lane; right-click for actions
// (same menu convention as images/clips — the hover-button special case is gone)
function AudioRow({ a }: { a: ProjAudio }): React.JSX.Element {
  const renameAudio = useStore((s) => s.renameAudio)
  const deleteAudio = useStore((s) => s.deleteAudio)
  const reportAudioDuration = useStore((s) => s.reportAudioDuration)
  // select the ARRAY (identity stable across playback ticks), derive with a memo — the inline
  // filter ran on every store write including 60fps tlTime, once per audio row
  const tlsForUse = useStore((s) => s.project?.timelines)
  const usedBy = useMemo(() => (tlsForUse ?? []).filter((t) => t.music?.audioId === a.id).length, [tlsForUse, a.id])
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // learn the track's real length once (persisted — the audio lane needs it for block width/trims)
  useEffect(() => {
    if (a.durationSec) return
    const el = new Audio()
    el.preload = 'metadata'
    el.src = mediaUrl(a.file)
    el.onloadedmetadata = () => {
      if (isFinite(el.duration) && el.duration > 0) reportAudioDuration(a.id, el.duration)
    }
    return () => {
      el.removeAttribute('src')
      el.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, a.durationSec])
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_AUDIO, a.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      title="drag onto the timeline's audio lane · right-click for actions"
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 7px', marginBottom: 3, border: '1px solid var(--line)', borderRadius: 5, background: 'var(--panel)', cursor: 'grab', fontSize: 11.5 }}
    >
      <span style={{ color: 'var(--amber)' }}>
        <Ic i={Music} size={12} />
      </span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
      <span style={{ color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 10 }}>
        {a.durationSec ? smpte(a.durationSec) : '…'}
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            {
              label: <><Ic i={Pencil} size={12} /> rename</>,
              onClick: async () => {
                const n = await textPrompt('Rename track', a.title)
                if (n && n.trim()) void renameAudio(a.id, n.trim())
              }
            },
            sendToProjectEntry({ audioIds: [a.id] }),
            {
              label: <><Ic i={Trash2} size={12} /> delete</>,
              danger: true,
              onClick: async () => {
                if (usedBy === 0 || (await confirmDialog(`${a.title} is on ${usedBy} timeline(s) — delete it and clear it there? File stays on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                  void deleteAudio(a.id)
              }
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// one reference-video tile — hover-scrubs, drags into a clip's @video ref slot; right-click for actions.
// Titles are PLAIN (no @) on purpose: @video1-style names belong to ref-slot POSITIONS.
function VideoRow({ v, uses }: { v: ProjVideo; uses: number }): React.JSX.Element {
  const renameVideo = useStore((s) => s.renameVideo)
  const deleteVideo = useStore((s) => s.deleteVideo)
  const makeClipFromVideo = useStore((s) => s.makeClipFromVideo)
  const addVideoTakeToClip = useStore((s) => s.addVideoTakeToClip)
  const zoom = useStore((s) => s.tileZoom.lib)
  const [menu, setMenu] = useState<{ x: number; y: number; sub?: 'clip' } | null>(null)
  const item: React.CSSProperties = { padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: 'var(--body)', whiteSpace: 'nowrap' }
  const editWithAI = (): void => {
    useStore.getState().setEditorVideo({ videoId: v.id })
    openVideoEditor()
  }
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_VIDEO, v.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={editWithAI}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      title={`${v.title}${v.durationSec ? ` · ${smpte(v.durationSec)}` : ''}${v.transcoded ? ' · normalized to H.264 720p at import' : ''}\ndouble-click = edit v2v · drag into a clip's @video ref slot or onto the timeline · right-click for actions`}
      style={{ position: 'relative', cursor: 'grab' }}
    >
      <Thumbnail videoFile={v.file} scrubVideo={v.file} label={v.title} fill w={zoom} h={Math.round(zoom * 0.643)} />
      <span style={{ position: 'absolute', top: 3, left: 3, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--bg2) 78%, transparent)', color: 'var(--amber)', fontSize: 9, pointerEvents: 'none' }}>
        <Ic i={Film} size={10} />
        {v.durationSec ? smpte(v.durationSec) : ''}
      </span>
      {menu &&
        createPortal(
          <div onClick={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: menu.x, top: menu.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 170, maxHeight: 300, overflow: 'auto' }}>
              {menu.sub === 'clip' ? (
                <>
                  <div style={{ ...item, color: 'var(--dim)', cursor: 'default', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1 }}>take on which clip?</div>
                  {(useStore.getState().project?.clips ?? []).map((c) => (
                    <div key={c.id} style={item} onClick={() => { setMenu(null); void addVideoTakeToClip(v.id, c.id) }}>
                      ▶ {c.name}
                    </div>
                  ))}
                  {(useStore.getState().project?.clips ?? []).length === 0 && <div style={{ ...item, color: 'var(--dim)', cursor: 'default' }}>no clips yet</div>}
                </>
              ) : (
                <>
                  <div style={item} onClick={() => { setMenu(null); editWithAI() }}>
                    <Ic i={Wand2} size={11} /> ⑂ edit v2v (tree)
                  </div>
                  <div style={item} onClick={() => { setMenu(null); void makeClipFromVideo(v.id) }}>
                    <Ic i={ImagePlay} size={11} /> make clip — video as take 1
                  </div>
                  <div style={item} onClick={() => setMenu({ ...menu, sub: 'clip' })}>
                    <Ic i={ListVideo} size={11} /> add as take to clip ▸
                  </div>
                  <div
                    style={item}
                    onClick={async () => {
                      setMenu(null)
                      const n = await textPrompt('Rename video', v.title)
                      if (n && n.trim()) void renameVideo(v.id, n.trim())
                    }}
                  >
                    <Ic i={Pencil} size={11} /> rename
                  </div>
                  <div
                    style={{ ...item, color: 'var(--bad)' }}
                    onClick={async () => {
                      setMenu(null)
                      if (uses === 0 || (await confirmDialog(`${v.title} is an @video ref on ${uses} clip(s) — delete it and drop those slots? File stays on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                        void deleteVideo(v.id)
                    }}
                  >
                    <Ic i={Trash2} size={11} /> delete
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

// ---- Library: the project's images, by @title — folders + right-click actions ----
export function LibraryPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const zoom = useStore((s) => s.tileZoom.lib)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'lib') // ctrl+scroll = thumbnail zoom, Explorer-style
  const project = useStore((s) => s.project)
  // watched folder lives in its OWN panel (see Watch.tsx) — the Library only offers the door
  const watchFolder = useStore((s) => s.project?.watchFolder)
  const importAny = useStore((s) => s.importAny) // one dialog: images + music + video
  const importPaths = useStore((s) => s.importPaths)
  const duplicateImage = useStore((s) => s.duplicateImage)
  const deleteImage = useStore((s) => s.deleteImage)
  const deleteImages = useStore((s) => s.deleteImages)
  const makeClipsFromImages = useStore((s) => s.makeClipsFromImages)
  const makeSheetClip = useStore((s) => s.makeSheetClip)
  const makeBeatsClipFromImages = useStore((s) => s.makeBeatsClipFromImages)
  const renameImage = useStore((s) => s.renameImage)
  const setEditorImage = useStore((s) => s.setEditorImage)
  const editImage = (id: string): void => {
    setEditorImage(id)
    openImageEditor()
  }
  const importAudioPaths = useStore((s) => s.importAudioPaths)
  const importVideoPaths = useStore((s) => s.importVideoPaths)
  const [over, setOver] = useState(false)
  const images = project?.images ?? []
  const audio = project?.audio ?? []
  const videos = project?.videos ?? []
  const videoUsesOf = (id: string): number =>
    (project?.clips ?? []).filter((c) => (c.promptData.videoRefs ?? []).some((r) => r.videoId === id)).length

  const usesOf = (id: string): number =>
    (project?.clips ?? []).filter((c) => (c.promptData.imageIds ?? []).includes(id) || c.promptData.endImageId === id).length
  const imageMenu = (im: ProjImage): MenuEntry[] => {
    const uses = usesOf(im.id)
    return [
      { label: <><Ic i={Wand2} size={12} /> edit (image tree)</>, onClick: () => editImage(im.id) },
      {
        label: <><Ic i={ImagePlay} size={12} /> make clip</>,
        onClick: () => void makeClipsFromImages([im.id])
      },
      // Sheet Gen (SHEET-GEN-SPEC-2026-09-08): a capture clip seeded from the Screen Test
      // contract, opened in Sheet Gen. Expression runs best from a pulled face view.
      { label: <><Ic i={Person} size={12} /> make char plate</>, onClick: () => void makeSheetClip(im.id, 'character').then((id) => id && openSheetGen()) },
      { label: <><Ic i={Scene} size={12} /> make scene plate</>, onClick: () => void makeSheetClip(im.id, 'scene').then((id) => id && openSheetGen()) },
      { label: <><Ic i={Person} size={12} /> make expression plate</>, onClick: () => void makeSheetClip(im.id, 'expression').then((id) => id && openSheetGen()) },
      {
        label: <><Ic i={Pencil} size={12} /> rename @title</>,
        onClick: async () => {
          const n = await textPrompt('Rename (@title)', im.title)
          if (n && n.trim() && !(await renameImage(im.id, n.trim())))
            await alertDialog(`That @title is already taken by another image — pick a different one.`)
        }
      },
      { label: <><Ic i={Copy} size={12} /> duplicate</>, onClick: () => void duplicateImage(im.id) },
      sendToProjectEntry({ imageIds: [im.id] }),
      {
        label: <><Ic i={Trash2} size={12} /> delete</>,
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`${im.title} is referenced by ${uses} clip(s). Delete it and drop those refs? File stays on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteImage(im.id)
        }
      }
    ]
  }
  // right-click with several images selected — acts on the WHOLE selection
  const imagesBulkMenu = (sel: ProjImage[]): MenuEntry[] => {
    const ids = sel.map((i) => i.id)
    const uses = ids.reduce((n, id) => n + usesOf(id), 0)
    return [
      { label: <><Ic i={ImagePlay} size={12} /> make {sel.length} clips</>, onClick: () => void makeClipsFromImages(ids) },
      {
        label: <><Ic i={ListVideo} size={12} /> make 1 clip — images as beats</>,
        onClick: () => void makeBeatsClipFromImages(ids)
      },
      sendToProjectEntry({ imageIds: ids }, sel.length),
      {
        label: <><Ic i={Trash2} size={12} /> delete {sel.length}</>,
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`These ${sel.length} images are referenced by ${uses} clip ref(s). Delete them and drop those refs? Files stay on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteImages(ids)
        }
      }
    ]
  }
  const renderImage = (im: ProjImage): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        // dragging an image that's part of a multi-selection carries the WHOLE selection
        // (selection order); dragging an unselected one resets the selection to just it
        const st = useStore.getState()
        let ids = st.multiSel?.kind === 'lib' && st.multiSel.ids.includes(im.id) ? st.multiSel.ids : [im.id]
        if (ids.length === 1) {
          ids = [im.id]
          st.setMultiSel('lib', ids)
        }
        e.dataTransfer.setData(MIME_IMAGE, im.file) // single-image targets (ref slots) keep working
        e.dataTransfer.setData(MIME_IMAGES, JSON.stringify(ids))
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'lib', id: im.id, ids }))
      }}
      onDoubleClick={() => editImage(im.id)}
      title={
        im.dynamic
          ? '⟳ live frame still — re-extracts itself when its timeline clip changes · double-click = edit · right-click for actions'
          : 'double-click = edit · drag into a clip slot · drag onto the timeline = make a clip · ctrl/shift-click = multi-select · right-click for actions'
      }
    >
      <Thumbnail file={im.file} label={(im.dynamic ? '⟳ ' : '') + im.title} rev={im.dynamic?.rev} fill w={zoom} h={Math.round(zoom * 0.643)} />
    </div>
  )

  return (
    <div
      ref={panelRef}
      className="vd-panel vd-scroll"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types || [])
        if (types.includes('Files') || types.includes(MIME_EDITNODE) || types.includes(MIME_WATCH) || types.includes(MIME_TAKE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        // a watched-folder tile dropped here → the real import (copy into the project + @title)
        const watchedPath = e.dataTransfer.getData(MIME_WATCH)
        if (watchedPath) {
          e.preventDefault()
          setOver(false)
          void importPaths([watchedPath])
          return
        }
        // an Image Editor tree node dropped here → save that render as a new Library asset (same as ★)
        const nodeData = e.dataTransfer.getData(MIME_EDITNODE)
        if (nodeData) {
          e.preventDefault()
          setOver(false)
          try {
            const o = JSON.parse(nodeData) as { sessionId?: string; nodeId?: string }
            if (o.sessionId && o.nodeId)
              void useStore
                .getState()
                .tagEditNode(o.sessionId, o.nodeId)
                .then((id) => {
                  const title = id ? useStore.getState().project?.images.find((i) => i.id === id)?.title : null
                  toast(title ? `${title} → Library` : 'saved to Library', { kind: 'ok' })
                })
          } catch {
            /* ignore malformed payloads */
          }
          return
        }
        // a take (T-chip or the Clip Gen preview) dropped here → its render joins the Library as a
        // video, named after clip + take, ready to ride as a @video ref
        const takeData = e.dataTransfer.getData(MIME_TAKE)
        if (takeData) {
          e.preventDefault()
          setOver(false)
          try {
            const o = JSON.parse(takeData) as { clipId?: string; takeId?: string }
            const p = useStore.getState().project
            const c = p?.clips.find((x) => x.id === o.clipId)
            const t = c?.takes.find((x) => x.id === o.takeId)
            if (!c || !t) {
              toast("couldn't find that take anymore", { kind: 'error' })
              return
            }
            const n = c.takes.indexOf(t) + 1
            void importVideoPaths([t.file]).then((ids) => {
              if (ids[0]) void useStore.getState().renameVideo(ids[0], `${c.name} take ${n}`)
            })
          } catch {
            /* ignore malformed payloads */
          }
          return
        }
        const files = Array.from(e.dataTransfer.files || [])
        if (files.length === 0) return // internal drag, not an OS file drop
        e.preventDefault()
        setOver(false)
        // a drop that can't import must SAY WHY — a silent nothing reads as "drag is broken"
        if (!project) {
          toast('open or create a project first — imports live inside the project folder', { kind: 'error' })
          return
        }
        const all = files.map(dropPath).filter((p): p is string => !!p)
        if (all.length === 0) {
          toast("couldn't read those files — drag them from Explorer/Finder, not from a browser", { kind: 'error' })
          return
        }
        const imgs = all.filter((p) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(p))
        const tracks = all.filter((p) => AUDIO_RE.test(p))
        const vids = all.filter((p) => VIDEO_RE.test(p))
        if (!imgs.length && !tracks.length && !vids.length) {
          toast('unsupported file type — images (jpg/png/webp/gif/bmp/avif), audio (mp3/wav/m4a/aac/ogg/flac) or video (mp4/mov/webm/m4v/mkv/avi)', { kind: 'error' })
          return
        }
        if (imgs.length) void importPaths(imgs)
        if (tracks.length) void importAudioPaths(tracks)
        if (vids.length) {
          toast('importing video(s)… (normalizing to H.264 when needed)', { kind: 'ok' })
          void importVideoPaths(vids)
        }
      }}
      onDoubleClick={(e) => {
        // double-click on EMPTY Library space = import (his grammar 2026-09-08); tiles, folder
        // rows, buttons and the slider handle their own double-clicks — only bare space counts
        if (!project) return
        const t = e.target as HTMLElement
        if (t.closest('.btn, [draggable], input, [data-folder-row], [data-tile]')) return
        void importAny()
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -3 }}
    >
      <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importAny()} title="import images, music or video (or drag them in, or double-click empty space)">
        <Ic i={ImageDown} /> import
      </span>{' '}
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => editImage('')} title="generate a new image from scratch with Nano Banana">
          <Ic i={Sparkles} /> new image
        </span>
      )}{' '}
      {project && (
        <span
          className="btn vd-hbtn"
          style={{ display: 'inline-block', marginBottom: 8, ...(watchFolder ? { color: 'var(--amber)' } : {}) }}
          onClick={async () => {
            // no folder yet → pick one first; either way the Watched panel opens with the goods
            if (!watchFolder) {
              const d = await vd().watchPick()
              if (!d) return
              useStore.getState().applyDelta(d)
            }
            openWatchPanel()
          }}
          title={watchFolder ? `watching ${watchFolder} — opens the Watched panel` : 'watch an external folder (e.g. Forge outputs) — opens as its own panel'}
        >
          <Ic i={Eye} /> watch folder
        </span>
      )}{' '}
      {project && <TileZoomSlider kind="lib" />}
      {!project && <p className="vd-hint">Open or create a project first.</p>}
      {project && images.length === 0 && (
        <p className="vd-hint">Import (button or double-click here), drag files in from your desktop, or render — they live here as @titles.</p>
      )}
      {project && <Foldered kind="lib" items={images} renderItem={renderImage} itemMenu={imageMenu} bulkMenu={imagesBulkMenu} root={rootFolder ?? null} />}
      {project && videos.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 5 }}>
            <Ic i={Film} size={10} /> videos — drag into a clip's @video ref slot · right-click for actions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${zoom}px, 100%), 1fr))`, gap: 6 }}>
            {videos.map((v) => (
              <VideoRow key={v.id} v={v} uses={videoUsesOf(v.id)} />
            ))}
          </div>
        </div>
      )}
      {project && audio.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 5 }}>
            ♪ music — drag onto the timeline's audio lane · right-click for actions
          </div>
          {audio.map((a) => (
            <AudioRow key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  )
}
