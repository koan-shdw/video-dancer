// Streaming URLs for project files. Electron serves them through the main-process `media://`
// protocol (Range-capable, CORS *); the site maps the same file names onto R2 through
// setMediaBase (VIDANCER-UI-PACKAGE-SPEC-2026-09-06 §2.2). Default = byte-identical to before.
// `rev` busts the browser cache for files whose CONTENT changes under the same path
// (dynamic first/last-frame stills are re-extracted in place) — handlers ignore the query.
let base: (file: string) => string = (file) => 'media://x/' + encodeURIComponent(file)
export function setMediaBase(fn: (file: string) => string): void {
  base = fn
}
export const mediaUrl = (file: string, rev?: number): string => base(file) + (rev ? `?r=${rev}` : '')

// tile-sized variant: ?t=1 asks main for a small cached copy of an image — originals stream
// unchanged for video/audio and for anything the thumb cache can't serve
export const thumbUrl = (file: string, rev?: number): string => base(file) + '?t=1' + (rev ? `&r=${rev}` : '')
