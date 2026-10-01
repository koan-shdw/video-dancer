// list 42 (vi-dancer docs/DEPTH-LANE-SPEC-2026-10-01.md): "make depth video" from a right-click on a
// Library video, a take or a timeline block. One queue row on ENHANCE's road (Depth Anything Video on
// fal, VDA large, grayscale); the depth map lands in the Library next to its source, in grey.
import { useStore } from '../store'
import { toast } from '../ui/Toast'
import { DEPTH_RATE, type EnhanceSourceRef } from '../shared/enhance'

export const depthLabel = (sec?: number): string => `make depth video${sec && sec > 0 ? ` · $${(sec * DEPTH_RATE).toFixed(2)}` : ''}`
export const DEPTH_TITLE = `a depth map of it on fal (Depth Anything, VDA large, $${DEPTH_RATE} a second): drop it in a clip's @video refs, the motion without the look. It lands in the Library next to its source`

export function queueDepth(source: EnhanceSourceRef, name: string, sec?: number): void {
  useStore.getState().enqueueRender({
    kind: 'enhance',
    label: `${name} · depth`,
    engineLabel: 'Depth Anything (VDA large) · fal',
    ...(sec && sec > 0 ? { estCost: sec * DEPTH_RATE } : {}),
    payload: { source, depth: { engine: 'depth-fal', model: 'VDA-Large' } }
  })
  toast(`${name}: the depth video is queued`, { kind: 'ok' })
}
