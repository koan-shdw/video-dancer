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
export const LORA_MIN = 32
export const LORA_MAX = 160
export const LORA_DEFAULT = 44
// the Image Edit results tree: list rows like the LoRA sidebar, its own range (56 = the old fixed thumb)
export const EDITTREE_MIN = 40
export const EDITTREE_MAX = 200
export const EDITTREE_DEFAULT = 56

export function useCtrlWheelZoom(ref: React.RefObject<HTMLElement | null>, kind: 'bin' | 'lib' | 'lora' | 'edittree'): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const s = useStore.getState()
      const delta = e.deltaY < 0 ? 10 : -10
      if (kind === 'bin') s.zoomAllBin(delta) // panel-level = every Bin section together
      else if (kind === 'lora') s.setTileZoom('lora', (s.tileZoom.lora ?? LORA_DEFAULT) + delta) // Image Gen's LoRA sidebar previews
      else if (kind === 'edittree') s.setTileZoom('edittree', (s.tileZoom.edittree ?? EDITTREE_DEFAULT) + delta) // Image Edit's results tree
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

export function TileZoomSlider({ kind, width = 84 }: { kind: 'bin' | 'lib' | 'lora' | 'edittree'; width?: number }): React.JSX.Element {
  const value = useStore((s) => s.tileZoom[kind] ?? (kind === 'edittree' ? EDITTREE_DEFAULT : LORA_DEFAULT))
  const setTileZoom = useStore((s) => s.setTileZoom)
  const unifyBinZoom = useStore((s) => s.unifyBinZoom)
  return (
    <input
      type="range"
      min={kind === 'lora' ? LORA_MIN : kind === 'edittree' ? EDITTREE_MIN : TILE_MIN}
      max={kind === 'lora' ? LORA_MAX : kind === 'edittree' ? EDITTREE_MAX : TILE_MAX}
      step={4}
      value={value}
      onChange={(e) => (kind === 'bin' ? unifyBinZoom(Number(e.target.value)) : setTileZoom(kind, Number(e.target.value)))}
      title={kind === 'bin' ? 'thumbnail size — one size for every section (ctrl+scroll inside a section zooms just it)' : kind === 'lora' ? 'preview size — drag, or ctrl+scroll over the list' : kind === 'edittree' ? 'thumbnail size — drag, or ctrl+scroll over the tree' : 'thumbnail size (ctrl+scroll works too)'}
      style={{ width, verticalAlign: 'middle', accentColor: 'var(--amber)', cursor: 'ew-resize' }}
    />
  )
}
