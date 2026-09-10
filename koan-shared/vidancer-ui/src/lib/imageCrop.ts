// The crop frame keeps the original size; the image moves/scales behind it.
export type CropLayer = { lx: number; ly: number; lw: number; lh: number }
const MAX_SCALE = 10
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))

function cover(l: CropLayer, W: number, H: number): CropLayer {
  return { ...l, lx: clamp(l.lx, W - l.lw, 0), ly: clamp(l.ly, H - l.lh, 0) }
}

export function moveCropLayer(l: CropLayer, W: number, H: number, dx: number, dy: number): CropLayer {
  return cover({ ...l, lx: l.lx + dx, ly: l.ly + dy }, W, H)
}

export function zoomCropLayer(l: CropLayer, W: number, H: number, factor: number, x = W / 2, y = H / 2): CropLayer {
  const k = clamp(factor, Math.max(W / l.lw, H / l.lh), Math.min(MAX_SCALE * W / l.lw, MAX_SCALE * H / l.lh))
  return cover({ lx: x - (x - l.lx) * k, ly: y - (y - l.ly) * k, lw: l.lw * k, lh: l.lh * k }, W, H)
}

export function resizeCropLayer(l: CropLayer, W: number, H: number, handle: string, dx: number, dy: number): CropLayer {
  const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0
  const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0
  // Project a corner drag onto its diagonal; side handles also preserve proportions.
  const k = 1 + (sx * dx * l.lw + sy * dy * l.lh) / ((sx ? l.lw ** 2 : 0) + (sy ? l.lh ** 2 : 0))
  return zoomCropLayer(l, W, H, k, l.lx + l.lw * (sx < 0 ? 1 : sx > 0 ? 0 : .5), l.ly + l.lh * (sy < 0 ? 1 : sy > 0 ? 0 : .5))
}

export function cropSrcRect(l: CropLayer, W: number, H: number): { sx: number; sy: number; sw: number; sh: number } {
  return { sx: -l.lx * W / l.lw, sy: -l.ly * H / l.lh, sw: W * W / l.lw, sh: H * H / l.lh }
}
