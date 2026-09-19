// PASTE-BACK (UI-ROUND-SPEC-2026-09-19 §6.3): a `drawn` model (Nano Banana family, Seedream 5.0
// Pro) has no mask input — it redraws the WHOLE image. The guarantee he was promised ("only
// generates for that area") is kept here: the result is scaled to the base's exact size, ONLY the
// selected area is taken from it, and the ORIGINAL pixels go back everywhere else. The edge
// feathers INWARD only (the blend band sits inside the selection), so nothing outside the line he
// drew ever changes and the red outline the model was shown can't survive at full strength.
// Pure pixel math on Electron's own bitmaps — no native image dependency.
import { nativeImage } from 'electron'
import { writeFile } from 'fs/promises'

const FEATHER_PX = 12

// separable box blur on one 8-bit channel (sliding window — O(n) per pass)
function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return src
  const tmp = new Uint8Array(src.length)
  const out = new Uint8Array(src.length)
  const win = r * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (acc / win) | 0
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = (acc / win) | 0
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

export interface PasteBackResult {
  ok: boolean
  reason?: string // why it was skipped (the node says so — never a silent nothing)
}

// base = the CLEAN image the edit ran from (no draw marks, no outline) · result = the model's raw
// output · mask = white inside the selection, at the base's size · out = where the composite lands
export async function pasteBack(baseFile: string, resultFile: string, maskFile: string, outFile: string): Promise<PasteBackResult> {
  const base = nativeImage.createFromPath(baseFile)
  const result = nativeImage.createFromPath(resultFile)
  const mask = nativeImage.createFromPath(maskFile)
  if (base.isEmpty() || result.isEmpty() || mask.isEmpty()) return { ok: false, reason: 'could not read the images for paste-back' }
  const { width: w, height: h } = base.getSize()
  const rs = result.getSize()
  // the model must hand back the same SHAPE, or the selection no longer points at the same place
  if (Math.abs(rs.width / rs.height - w / h) / (w / h) > 0.02) return { ok: false, reason: `the model changed the frame shape (${rs.width}×${rs.height} vs ${w}×${h}) — paste-back skipped, this is its raw output` }
  const bpx = base.toBitmap() // BGRA, premultiplied — opaque images in practice
  const rpx = (rs.width === w && rs.height === h ? result : result.resize({ width: w, height: h, quality: 'best' })).toBitmap()
  const ms = mask.getSize()
  const mpx = (ms.width === w && ms.height === h ? mask : mask.resize({ width: w, height: h, quality: 'good' })).toBitmap()
  if (bpx.length !== w * h * 4 || rpx.length !== bpx.length || mpx.length !== bpx.length) return { ok: false, reason: 'image sizes did not line up for paste-back' }

  // the selection as one channel → eroded by the feather radius (threshold of its own blur) →
  // blurred again: a soft edge that lives entirely INSIDE the hard line
  const hard = new Uint8Array(w * h)
  for (let i = 0; i < hard.length; i++) hard[i] = mpx[i * 4 + 2] > 127 ? 255 : 0
  const r = Math.max(1, Math.round((FEATHER_PX * Math.max(w, h)) / 2048)) // 12 px at 2K, scaled with the image
  const spread = boxBlur(hard, w, h, r)
  const eroded = new Uint8Array(w * h)
  for (let i = 0; i < eroded.length; i++) eroded[i] = spread[i] >= 250 ? 255 : 0
  let alpha = boxBlur(eroded, w, h, r)
  // a selection thinner than the feather would erode to nothing — fall back to the hard mask, softened
  if (!eroded.some((v) => v === 255)) alpha = boxBlur(hard, w, h, Math.max(1, r >> 2))
  for (let i = 0; i < alpha.length; i++) if (hard[i] === 0) alpha[i] = 0 // never a pixel outside his line

  const out = Buffer.from(bpx)
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const a = alpha[i]
    if (a === 0) continue
    const ia = 255 - a
    out[p] = (rpx[p] * a + bpx[p] * ia) / 255
    out[p + 1] = (rpx[p + 1] * a + bpx[p + 1] * ia) / 255
    out[p + 2] = (rpx[p + 2] * a + bpx[p + 2] * ia) / 255
    out[p + 3] = 255
  }
  await writeFile(outFile, nativeImage.createFromBitmap(out, { width: w, height: h }).toPNG())
  return { ok: true }
}
