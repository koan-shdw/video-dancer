// OS-window-style thumbnail zoom for the Bin and Library: a slider in the panel header plus
// ctrl+mouse-wheel (Explorer muscle memory). The width lives in the store (tileZoom.bin /
// tileZoom.lib) and persists to settings, so folder tabs of the same kind zoom together and the
// size survives restarts. Bin sections (clips / timelines / sheets / scores) can carry their own
// override: ctrl+scroll INSIDE a section zooms just it, anywhere else in the panel zooms all
// (offsets kept), and the slider unifies everything back to one size. Overrides are feel-test
// only for now — in-memory, not persisted.
import { useEffect } from 'react'
import { useStore } from '../store'

export const TILE_MIN = 56
export const TILE_MAX = 220

export type SectionZoomKind = 'clips' | 'tl' | 'sheet' | 'score' | 'voice' | 'style' | 'imagegen'

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
      const delta = e.deltaY < 0 ? 10 : -10
      if (kind === 'bin') s.zoomAllBin(delta) // panel-level = every Bin section together
      else s.setTileZoom('lib', s.tileZoom.lib + delta)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, kind])
}

// per-section ctrl+wheel: zooms ONLY this section (stopPropagation keeps the panel-level
// listener above from also firing — both are native bubble-phase listeners)
export function useSectionWheelZoom(ref: React.RefObject<HTMLElement | null>, kind: SectionZoomKind): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const s = useStore.getState()
      const cur = s.tileZoom[kind] ?? s.tileZoom.bin
      s.setTileZoom(kind, cur + (e.deltaY < 0 ? 10 : -10))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, kind])
}

export function TileZoomSlider({ kind }: { kind: 'bin' | 'lib' }): React.JSX.Element {
  const value = useStore((s) => s.tileZoom[kind])
  const setTileZoom = useStore((s) => s.setTileZoom)
  const unifyBinZoom = useStore((s) => s.unifyBinZoom)
  return (
    <input
      type="range"
      min={TILE_MIN}
      max={TILE_MAX}
      step={4}
      value={value}
      onChange={(e) => (kind === 'bin' ? unifyBinZoom(Number(e.target.value)) : setTileZoom(kind, Number(e.target.value)))}
      title={kind === 'bin' ? 'thumbnail size — one size for every section (ctrl+scroll inside a section zooms just it)' : 'thumbnail size (ctrl+scroll works too)'}
      style={{ width: 84, verticalAlign: 'middle', accentColor: 'var(--amber)', cursor: 'ew-resize' }}
    />
  )
}
