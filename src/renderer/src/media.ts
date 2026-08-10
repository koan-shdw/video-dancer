// Build a streaming URL for a local file served by the main-process `media://` protocol.
// Lets <video>/<img> stream straight from disk instead of reading the whole file over IPC.
// `rev` busts the browser cache for files whose CONTENT changes under the same path
// (dynamic first/last-frame stills are re-extracted in place) — the handler ignores the query.
export const mediaUrl = (file: string, rev?: number): string =>
  'media://x/' + encodeURIComponent(file) + (rev ? `?r=${rev}` : '')

// tile-sized variant: ?t=1 asks main for a small cached copy of an image — originals stream
// unchanged for video/audio and for anything the thumb cache can't serve
export const thumbUrl = (file: string, rev?: number): string =>
  'media://x/' + encodeURIComponent(file) + '?t=1' + (rev ? `&r=${rev}` : '')
