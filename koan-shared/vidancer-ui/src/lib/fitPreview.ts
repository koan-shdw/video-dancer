import { useEffect, useRef } from 'react'
import { useStore } from '../store'

// The editors' preview box takes the picture's height at the box's width (his 10-11 ask, "no
// black bars"), up to the resize handle's own ceiling. It refits on new media (`key`), on a width
// change, and whenever the owner calls the returned fit (img onLoad / video onLoadedMetadata); a
// height-only change is his drag on the handle and stays.
export function useFitPreview(
  boxRef: React.RefObject<HTMLElement | null>,
  size: () => { w: number; h: number } | null,
  kind: 'imageEdit' | 'clipEdit',
  key: unknown,
  halfWidth = false // compare view: the picture gets the right half
): () => void {
  const fit = (): void => {
    const s = size()
    const box = boxRef.current
    if (!s?.w || !s.h || !box) return
    const w = halfWidth ? box.clientWidth / 2 : box.clientWidth
    const max = (box.parentElement?.clientHeight ?? 800) - 160
    const h = Math.max(80, Math.min(max, Math.round((w * s.h) / s.w)))
    if (Math.abs(h - useStore.getState().previewH[kind]) > 1) useStore.getState().setPreviewH(kind, h)
  }
  const fitRef = useRef(fit)
  fitRef.current = fit
  useEffect(() => {
    fitRef.current()
    const box = boxRef.current
    if (!box) return
    let lastW = box.clientWidth
    const ro = new ResizeObserver(() => {
      if (box.clientWidth === lastW) return
      lastW = box.clientWidth
      fitRef.current()
    })
    ro.observe(box)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, halfWidth])
  return () => fitRef.current()
}
