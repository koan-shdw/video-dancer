import { useState } from 'react'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { MIME_IMAGE, MIME_MOVE } from '../lib/dragDrop'
import { Foldered, type MenuEntry } from './Foldered'
import { textPrompt, confirmDialog } from '../prompt'

// ---- Library: the project's images, by @title — folders + right-click actions ----
export function LibraryPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const importToLibrary = useStore((s) => s.importToLibrary)
  const importPaths = useStore((s) => s.importPaths)
  const duplicateImage = useStore((s) => s.duplicateImage)
  const deleteImage = useStore((s) => s.deleteImage)
  const renameImage = useStore((s) => s.renameImage)
  const [over, setOver] = useState(false)
  const images = project?.images ?? []

  const imageMenu = (im: ProjImage): MenuEntry[] => {
    const uses = (project?.clips ?? []).filter(
      (c) => (c.promptData.imageIds ?? []).includes(im.id) || c.promptData.endImageId === im.id
    ).length
    return [
      {
        label: '✎ rename @title',
        onClick: async () => {
          const n = await textPrompt('Rename (@title)', im.title)
          if (n && n.trim()) void renameImage(im.id, n.trim())
        }
      },
      { label: '⧉ duplicate', onClick: () => void duplicateImage(im.id) },
      {
        label: '🗑 delete',
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`${im.title} is referenced by ${uses} clip(s). Delete it and drop those refs? (file stays on disk)`)))
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
      title="drag into a clip slot · right-click for actions"
    >
      <Thumbnail file={im.file} label={im.title} w={84} h={54} />
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
        const paths = files
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => !!p && /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(p))
        if (paths.length) void importPaths(paths)
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -3 }}
    >
      <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importToLibrary()}>
        ⬆ import image
      </span>
      {!project && <p className="vd-hint">Open or create a project first.</p>}
      {project && images.length === 0 && (
        <p className="vd-hint">Import images, drag them in from your desktop, or render — they live here as @titles.</p>
      )}
      {project && <Foldered kind="lib" items={images} renderItem={renderImage} itemMenu={imageMenu} root={rootFolder ?? null} />}
    </div>
  )
}
