// Beat helpers shared by the Timeline Monitor, Clip Monitor, timeline blocks and the Beats editor.
// (Previously re-implemented in four places — fix here once.)
import { beatRanges, beatRefFile } from '../emitYaml'
import { mediaUrl } from '../media'

// which beat is the playhead inside at time t (clamped to the last beat)
export function beatAtTime(beats: BeatField[], t: number): number {
  if (beats.length === 0) return 0
  const ranges = beatRanges(beats)
  for (let i = 0; i < ranges.length; i++) if (t >= ranges[i].start && t < ranges[i].end) return i
  return ranges.length - 1
}

// a beat's reference image as a streamable media:// url (its @ref, else the prompt's first @ref)
export function beatRefImageUrl(beat: BeatField, freeform: string, images: ProjImage[]): string | undefined {
  const f = beatRefFile(beat, freeform, images)
  return f ? mediaUrl(f) : undefined
}

// per-beat reference image urls for a whole clip
export function beatImgUrls(beats: BeatField[], freeform: string, images: ProjImage[]): (string | undefined)[] {
  return beats.map((b) => beatRefImageUrl(b, freeform, images))
}
