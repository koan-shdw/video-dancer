// list 51 (Premiere's Reverse Speed): a reversed block plays its take's REVERSED copy, made once
// next to the take (main/reverse.ts). Its window counts that copy's seconds, so every trim,
// razor, slip and speed rule stays the forward one; only the file it plays changes.
export const revFileOf = (file: string): string => `${file}.rev.mp4`
export const playFileOf = (file: string, it?: { reverse?: boolean } | null): string => (it?.reverse ? revFileOf(file) : file)

// the same frames the other way round: a window [in, out) of a D-second take ↔ its mirror in the
// reversed copy (frame-exact: the copy's frame at r is the take's frame at D − r, half-open windows)
export const mirrorWindow = (inSec: number, outSec: number, dur: number): { inSec: number; outSec: number } => ({
  inSec: Math.max(0, dur - outSec),
  outSec: Math.min(dur, dur - inSec)
})
