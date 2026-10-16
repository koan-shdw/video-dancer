// Photoshop's crop (his call 2026-10-14: "we should be able to drag the edges of the crop"): a box in
// the image's own pixels over a picture that never moves. Edges and corners move the box's sides
// (Shift keeps its shape), dragging inside moves it, the wheel shrinks or grows it around the
// cursor, and the result is the box's pixels at their own size. (Until then the frame was always
// the whole picture and the handles only zoomed the picture behind it: inward did nothing.)
export type CropBox = { x: number; y: number; w: number; h: number }
const MIN = 16 // the smallest crop, in image pixels
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))

export const fullCropBox = (W: number, H: number): CropBox => ({ x: 0, y: 0, w: W, h: H })

export function moveCropBox(b: CropBox, W: number, H: number, dx: number, dy: number): CropBox {
  return { ...b, x: clamp(b.x + dx, 0, W - b.w), y: clamp(b.y + dy, 0, H - b.h) }
}

export function resizeCropBox(b: CropBox, W: number, H: number, handle: string, dx: number, dy: number, keepShape = false): CropBox {
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s')
  if (!keepShape) {
    const l = west ? clamp(b.x + dx, 0, b.x + b.w - MIN) : b.x
    const r = east ? clamp(b.x + b.w + dx, b.x + MIN, W) : b.x + b.w
    const t = north ? clamp(b.y + dy, 0, b.y + b.h - MIN) : b.y
    const bo = south ? clamp(b.y + b.h + dy, b.y + MIN, H) : b.y + b.h
    return { x: l, y: t, w: r - l, h: bo - t }
  }
  // Shift: the opposite side or corner stays put (a side handle grows the other axis around its
  // middle); a corner follows the drag along the box's diagonal; the picture's room caps the size
  const ar = b.w / b.h
  const sx = west ? -1 : east ? 1 : 0, sy = north ? -1 : south ? 1 : 0
  const s = sx && sy ? 1 + (sx * dx * b.w + sy * dy * b.h) / (b.w ** 2 + b.h ** 2) : sx ? 1 + (sx * dx) / b.w : 1 + (sy * dy) / b.h
  let w = b.w * s, h = b.h * s
  if (w <= 0 || h <= 0) (w = MIN * Math.max(1, ar)), (h = w / ar) // pulled past the far side
  const ax = west ? b.x + b.w : east ? b.x : b.x + b.w / 2
  const ay = north ? b.y + b.h : south ? b.y : b.y + b.h / 2
  const roomW = west ? ax : east ? W - ax : 2 * Math.min(ax, W - ax)
  const roomH = north ? ay : south ? H - ay : 2 * Math.min(ay, H - ay)
  const k = Math.max(Math.min(1, roomW / w, roomH / h), MIN / Math.min(w, h))
  w *= k
  h *= k
  return { x: west ? ax - w : east ? ax : ax - w / 2, y: north ? ay - h : south ? ay : ay - h / 2, w, h }
}

// factor > 1 = zoom in = a smaller box; the image point under (x, y) stays under it
export function zoomCropBox(b: CropBox, W: number, H: number, factor: number, x = b.x + b.w / 2, y = b.y + b.h / 2): CropBox {
  const k = clamp(1 / factor, MIN / Math.min(b.w, b.h), Math.min(W / b.w, H / b.h))
  const w = b.w * k, h = b.h * k
  return { x: clamp(x - (x - b.x) * k, 0, W - w), y: clamp(y - (y - b.y) * k, 0, H - h), w, h }
}

// the pixels the crop keeps, whole pixels inside the picture
export function cropPixels(b: CropBox, W: number, H: number): CropBox {
  const x = clamp(Math.round(b.x), 0, W - 1), y = clamp(Math.round(b.y), 0, H - 1)
  return { x, y, w: clamp(Math.round(b.w), 1, W - x), h: clamp(Math.round(b.h), 1, H - y) }
}
