// Capture the current frame of a playing <video> as PNG bytes. cropAspect (e.g. '16:9') cover-crops
// centered to that aspect (what the Timeline Monitor shows); omit/​'auto' → the full native frame.
// The monitor <video> elements set crossOrigin='anonymous' (media:// sends CORS headers) so the
// canvas isn't tainted and toBlob works.
export async function framePngBytes(video: HTMLVideoElement | HTMLCanvasElement, cropAspect?: string): Promise<Uint8Array | null> {
  const vw = video instanceof HTMLVideoElement ? video.videoWidth : video.width
  const vh = video instanceof HTMLVideoElement ? video.videoHeight : video.height
  if (!vw || !vh) return null
  let sx = 0
  let sy = 0
  let sw = vw
  let sh = vh
  if (cropAspect && cropAspect !== 'auto') {
    const [aw, ah] = cropAspect.split(':').map(Number)
    const ar = aw > 0 && ah > 0 ? aw / ah : vw / vh
    if (vw / vh > ar) {
      sw = Math.round(vh * ar)
      sx = Math.round((vw - sw) / 2)
    } else {
      sh = Math.round(vw / ar)
      sy = Math.round((vh - sh) / 2)
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return null // tainted canvas (crossOrigin not applied) or decode not ready
  }
}
