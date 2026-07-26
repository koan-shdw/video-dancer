import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { TileZoomSlider, useCtrlWheelZoom } from '../lib/tileZoom'
import { mediaUrl } from '../media'
import { smpte } from '../lib/time'
import { MIME_IMAGE, MIME_IMAGES, MIME_MOVE, MIME_AUDIO, MIME_EDITNODE, MIME_WATCH } from '../lib/dragDrop'
import { toast } from '../ui/Toast'
import { Ic, ImageDown, ImagePlay, ListVideo, Sparkles, FileMusic, Music, Pencil, Trash2, Copy, Wand2, Eye } from '../ui/icons'
import { Foldered, type MenuEntry } from './Foldered'
import { textPrompt, confirmDialog, alertDialog } from '../prompt'
import { openImageEditor, openWatchPanel } from '../panelBus'

const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i

// one ♪ row in the music section — draggable onto the timeline's audio lane; right-click for actions
// (same menu convention as images/clips — the hover-button special case is gone)
function AudioRow({ a }: { a: ProjAudio }): React.JSX.Element {
  const renameAudio = useStore((s) => s.renameAudio)
  const deleteAudio = useStore((s) => s.deleteAudio)
  const reportAudioDuration = useStore((s) => s.reportAudioDuration)
  const usedBy = useStore((s) => (s.project?.timelines ?? []).filter((t) => t.music?.audioId === a.id).length)
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
      {menu &&
        createPortal(
          <div onClick={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: menu.x, top: menu.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 130 }}>
              <div
                onClick={async () => {
                  setMenu(null)
                  const n = await textPrompt('Rename track', a.title)
                  if (n && n.trim()) void renameAudio(a.id, n.trim())
                }}
                style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: 'var(--body)' }}
              >
                <Ic i={Pencil} size={11} /> rename
              </div>
              <div
                onClick={async () => {
                  setMenu(null)
                  if (usedBy === 0 || (await confirmDialog(`${a.title} is on ${usedBy} timeline(s) — delete it and clear it there? File stays on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                    void deleteAudio(a.id)
                }}
                style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: 'var(--bad)' }}
              >
                <Ic i={Trash2} size={11} /> delete
              </div>
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
  const importToLibrary = useStore((s) => s.importToLibrary)
  const importPaths = useStore((s) => s.importPaths)
  const duplicateImage = useStore((s) => s.duplicateImage)
  const deleteImage = useStore((s) => s.deleteImage)
  const deleteImages = useStore((s) => s.deleteImages)
  const makeClipsFromImages = useStore((s) => s.makeClipsFromImages)
  const makeBeatsClipFromImages = useStore((s) => s.makeBeatsClipFromImages)
  const renameImage = useStore((s) => s.renameImage)
  const setEditorImage = useStore((s) => s.setEditorImage)
  const editImage = (id: string): void => {
    setEditorImage(id)
    openImageEditor()
  }
  const importAudio = useStore((s) => s.importAudio)
  const importAudioPaths = useStore((s) => s.importAudioPaths)
  const [over, setOver] = useState(false)
  const images = project?.images ?? []
  const audio = project?.audio ?? []

  const usesOf = (id: string): number =>
    (project?.clips ?? []).filter((c) => (c.promptData.imageIds ?? []).includes(id) || c.promptData.endImageId === id).length
  const imageMenu = (im: ProjImage): MenuEntry[] => {
    const uses = usesOf(im.id)
    return [
      { label: <><Ic i={Wand2} size={12} /> edit with AI</>, onClick: () => editImage(im.id) },
      {
        label: <><Ic i={ImagePlay} size={12} /> make clip</>,
        onClick: () => void makeClipsFromImages([im.id])
      },
      {
        label: <><Ic i={Pencil} size={12} /> rename @title</>,
        onClick: async () => {
          const n = await textPrompt('Rename (@title)', im.title)
          if (n && n.trim() && !(await renameImage(im.id, n.trim())))
            await alertDialog(`That @title is already taken by another image — pick a different one.`)
        }
      },
      { label: <><Ic i={Copy} size={12} /> duplicate</>, onClick: () => void duplicateImage(im.id) },
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
          ? '⟳ live frame still — re-extracts itself when its timeline clip changes · double-click = edit with AI · right-click for actions'
          : 'double-click = edit with AI · drag into a clip slot · drag onto the timeline = make a clip · ctrl/shift-click = multi-select · right-click for actions'
      }
    >
      <Thumbnail file={im.file} label={(im.dynamic ? '⟳ ' : '') + im.title} rev={im.dynamic?.rev} w={zoom} h={Math.round(zoom * 0.643)} />
    </div>
  )

  return (
    <div
      ref={panelRef}
      className="vd-panel vd-scroll"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types || [])
        if (types.includes('Files') || types.includes(MIME_EDITNODE) || types.includes(MIME_WATCH)) {
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
        const files = Array.from(e.dataTransfer.files || [])
        if (files.length === 0) return // internal drag, not an OS file drop
        e.preventDefault()
        setOver(false)
        // a drop that can't import must SAY WHY — a silent nothing reads as "drag is broken"
        if (!project) {
          toast('open or create a project first — imports live inside the project folder', { kind: 'error' })
          return
        }
        const all = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p)
        if (all.length === 0) {
          toast("couldn't read those files — drag them from Explorer/Finder, not from a browser", { kind: 'error' })
          return
        }
        const imgs = all.filter((p) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(p))
        const tracks = all.filter((p) => AUDIO_RE.test(p))
        if (!imgs.length && !tracks.length) {
          toast('unsupported file type — images (jpg/png/webp/gif/bmp/avif) or audio (mp3/wav/m4a/aac/ogg/flac)', { kind: 'error' })
          return
        }
        if (imgs.length) void importPaths(imgs)
        if (tracks.length) void importAudioPaths(tracks)
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -3 }}
    >
      <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importToLibrary()}>
        <Ic i={ImageDown} /> import image
      </span>{' '}
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => editImage('')} title="generate a new image from scratch with Nano Banana">
          <Ic i={Sparkles} /> new image
        </span>
      )}{' '}
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importAudio()} title="import mp3/wav/m4a music files (or drag them in)">
          <Ic i={FileMusic} /> import music
        </span>
      )}{' '}
      {project && (
        <span
          className="btn vd-hbtn"
          style={{ display: 'inline-block', marginBottom: 8, ...(watchFolder ? { color: 'var(--amber)' } : {}) }}
          onClick={async () => {
            // no folder yet → pick one first; either way the Watched panel opens with the goods
            if (!watchFolder) {
              const d = await window.vidancer.watchPick()
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
        <p className="vd-hint">Import images, drag them in from your desktop, or render — they live here as @titles.</p>
      )}
      {project && <Foldered kind="lib" items={images} renderItem={renderImage} itemMenu={imageMenu} bulkMenu={imagesBulkMenu} root={rootFolder ?? null} />}
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
