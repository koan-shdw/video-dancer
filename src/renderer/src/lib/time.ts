// SMPTE timecode HH:MM:SS:FF. Clips don't store real fps yet, so the frame field assumes TC_FPS.
export const TC_FPS = 24

export function smpte(t: number, fps = TC_FPS): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const f = Math.floor(t * fps) % fps
  const s = Math.floor(t) % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`
}
