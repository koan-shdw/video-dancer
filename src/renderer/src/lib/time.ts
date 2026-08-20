// SMPTE timecode HH:MM:SS:FF. Clips don't store real fps yet, so the frame field assumes TC_FPS.
export const TC_FPS = 24

// format from an INTEGER frame count — the float-proof path. The ruler labels through this:
// t = i * (1/24) accumulates just below the true frame boundary in binary, and flooring that
// drifted product read one frame low (~1 in 7 labels at frame-level zoom, caught 2026-08-19).
export function smpteFrames(frames: number, fps = TC_FPS): string {
  const F = Math.max(0, Math.round(frames))
  const f = F % fps
  const totS = Math.floor(F / fps)
  const s = totS % 60
  const m = Math.floor(totS / 60) % 60
  const h = Math.floor(totS / 3600)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`
}

// format from seconds — FLOORS to the frame containing t (right for playheads/readouts: a clock
// mid-frame shows that frame, never the next one)
export function smpte(t: number, fps = TC_FPS): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  return smpteFrames(Math.floor(t * fps), fps)
}
