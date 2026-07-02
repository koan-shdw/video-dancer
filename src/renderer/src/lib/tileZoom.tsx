// OS-window-style thumbnail zoom for the Bin and Library: a slider in the panel header plus
// ctrl+mouse-wheel over the panel (Explorer muscle memory). The width lives in the store
// (tileZoom.bin / tileZoom.lib) and persists to settings, so folder tabs of the same kind zoom
// together and the size survives restarts.
import { useEffect } from 'react'
import { useStore } from '../store'

export const TILE_MIN = 56
export const TILE_MAX = 220

// native wheel listener (passive: false) — React's synthetic onWheel is passive, so
// preventDefault there can't stop Chromium's own ctrl-wheel page zoom
export function useCtrlWheelZoom(ref: React.RefObject<HTMLElement | null>, kind: 'bin' | 'lib'): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const s = useStore.getState()
      s.setTileZoom(kind, s.tileZoom[kind] + (e.deltaY < 0 ? 10 : -10))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, kind])
}

export function TileZoomSlider({ kind }: { kind: 'bin' | 'lib' }): React.JSX.Element {
  const value = useStore((s) => s.tileZoom[kind])
  const setTileZoom = useStore((s) => s.setTileZoom)
  return (
    <input
      type="range"
      min={TILE_MIN}
      max={TILE_MAX}
      step={4}
      value={value}
      onChange={(e) => setTileZoom(kind, Number(e.target.value))}
      title="thumbnail size (ctrl+scroll works too)"
      style={{ width: 84, verticalAlign: 'middle', accentColor: 'var(--amber)', cursor: 'ew-resize' }}
    />
  )
}
