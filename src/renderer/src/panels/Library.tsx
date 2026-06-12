import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { smpte } from '../lib/time'
import { MIME_IMAGE, MIME_MOVE, MIME_AUDIO } from '../lib/dragDrop'
import { Foldered, type MenuEntry } from './Foldered'
import { textPrompt, confirmDialog, alertDialog } from '../prompt'
import { openImageEditor } from '../panelBus'

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
      <span style={{ color: 'var(--amber)' }}>♪</span>
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
                ✎ rename
              </div>
              <div
                onClick={async () => {
                  setMenu(null)
                  if (usedBy === 0 || (await confirmDialog(`${a.title} is on ${usedBy} timeline(s) — delete it and clear it there? File stays on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                    void deleteAudio(a.id)
                }}
                style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: 'var(--bad)' }}
              >
                🗑 delete
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
  const project = useStore((s) => s.project)
  const importToLibrary = useStore((s) => s.importToLibrary)
  const importPaths = useStore((s) => s.importPaths)
  const duplicateImage = useStore((s) => s.duplicateImage)
  const deleteImage = useStore((s) => s.deleteImage)
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

  const imageMenu = (im: ProjImage): MenuEntry[] => {
    const uses = (project?.clips ?? []).filter(
      (c) => (c.promptData.imageIds ?? []).includes(im.id) || c.promptData.endImageId === im.id
    ).length
    return [
      { label: '🎨 edit with AI', onClick: () => editImage(im.id) },
      {
        label: '✎ rename @title',
        onClick: async () => {
          const n = await textPrompt('Rename (@title)', im.title)
          if (n && n.trim() && !(await renameImage(im.id, n.trim())))
            await alertDialog(`That @title is already taken by another image — pick a different one.`)
        }
      },
      { label: '⧉ duplicate', onClick: () => void duplicateImage(im.id) },
      {
        label: '🗑 delete',
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`${im.title} is referenced by ${uses} clip(s). Delete it and drop those refs? File stays on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteImage(im.id)
        }
      }
    ]
  }
  const renderImage = (im: ProjImage): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_IMAGE, im.file)
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'lib', id: im.id }))
      }}
      onDoubleClick={() => editImage(im.id)}
      title={
        im.dynamic
          ? '⟳ live frame still — re-extracts itself when its timeline clip changes · double-click = edit with AI · right-click for actions'
          : 'double-click = edit with AI · drag into a clip slot · right-click for actions'
      }
    >
      <Thumbnail file={im.file} label={(im.dynamic ? '⟳ ' : '') + im.title} rev={im.dynamic?.rev} w={84} h={54} />
    </div>
  )

  return (
    <div
      className="vd-panel vd-scroll"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files || [])
        if (files.length === 0) return // internal drag, not an OS file drop
        e.preventDefault()
        setOver(false)
        const all = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p)
        const imgs = all.filter((p) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(p))
        const tracks = all.filter((p) => AUDIO_RE.test(p))
        if (imgs.length) void importPaths(imgs)
        if (tracks.length) void importAudioPaths(tracks)
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -3 }}
    >
      <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importToLibrary()}>
        📥 import image
      </span>{' '}
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => editImage('')} title="generate a new image from scratch with Nano Banana">
          ✨ new image
        </span>
      )}{' '}
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importAudio()} title="import mp3/wav/m4a music files (or drag them in)">
          ♪ import music
        </span>
      )}
      {!project && <p className="vd-hint">Open or create a project first.</p>}
      {project && images.length === 0 && (
        <p className="vd-hint">Import images, drag them in from your desktop, or render — they live here as @titles.</p>
      )}
      {project && <Foldered kind="lib" items={images} renderItem={renderImage} itemMenu={imageMenu} root={rootFolder ?? null} />}
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
