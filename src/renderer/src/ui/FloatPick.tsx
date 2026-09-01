import { FloatPick as SharedFloatPick } from '@koan/shared'
import { Thumbnail } from '../Thumbnail'

// vi-dancer adapter over the SHARED FloatPick (@koan/shared — one copy, every app): this app's
// items carry media files, so the face is the house Thumbnail; the float/tilt/double-click
// grammar lives in the shared component.
export type FloatItem = {
  id: string
  label: string
  file?: string // image face
  videoFile?: string // video face (thumbnail grabs a frame)
  glyph?: string // fallback face when there is no media
}

export function FloatPick({ items, onOpen, hint }: { items: FloatItem[]; onOpen: (id: string) => void; hint: string }): React.JSX.Element {
  return (
    <SharedFloatPick
      items={items.map((it) => ({
        id: it.id,
        label: it.label,
        glyph: it.glyph,
        face: it.file || it.videoFile ? <Thumbnail file={it.file} videoFile={it.videoFile} w={86} h={52} /> : undefined
      }))}
      onOpen={onOpen}
      hint={hint}
    />
  )
}
