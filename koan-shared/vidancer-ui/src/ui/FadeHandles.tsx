// AUDIO TRANSITIONS on a block's edges (docs/AUDIO-KEYFRAMES-PREMIERE-SPEC-2026-09-09.md §2.6): Constant
// Power (the default) · Constant Gain · Exponential Fade. Drawn as the fade's own curve over the edge; drag
// the inner edge for length, double-click it to type a length, right-click it for the shape or to remove.
// Ctrl+Shift+D (Timeline) drops the default 1 s Constant Power fade on a selected block's free edges.
import { useState } from 'react'
import type { FadeShape } from '../shared/types'
import { fadeGain } from '../shared/audioEnv'
import { textPrompt } from '../prompt'
import { ContextMenu, type MenuEntry } from '@koan/shared'

export const DEFAULT_FADE_SEC = 1
export const FADE_SHAPES: { k: FadeShape; label: string }[] = [
  { k: 'power', label: 'Constant Power' },
  { k: 'gain', label: 'Constant Gain' },
  { k: 'exp', label: 'Exponential Fade' }
]
export type FadePatch = { fadeInSec?: number; fadeOutSec?: number; fadeInShape?: FadeShape; fadeOutShape?: FadeShape }

export function FadeHandles(props: { lenSec: number; fadeIn?: number; fadeOut?: number; inShape?: FadeShape; outShape?: FadeShape; editable: boolean; onChange: (p: FadePatch) => void }): React.JSX.Element | null {
  const [live, setLive] = useState<{ side: 'in' | 'out'; sec: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; side: 'in' | 'out' } | null>(null)
  const len = Math.max(0.01, props.lenSec)
  const fin = live?.side === 'in' ? live.sec : (props.fadeIn ?? 0)
  const fout = live?.side === 'out' ? live.sec : (props.fadeOut ?? 0)
  if (!fin && !fout) return null

  const drag = (side: 'in' | 'out', e0: React.MouseEvent): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const r = (e0.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
    const w = r?.width ?? 1
    const other = side === 'in' ? fout : fin
    const move = (ev: MouseEvent): void => {
      const x = Math.max(0, Math.min(w, ev.clientX - (r?.left ?? 0)))
      const sec = side === 'in' ? (x / w) * len : ((w - x) / w) * len
      setLive({ side, sec: Math.max(0.1, Math.min(len - other, Math.round(sec * 20) / 20)) })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLive((cur) => {
        if (cur) props.onChange(cur.side === 'in' ? { fadeInSec: cur.sec } : { fadeOutSec: cur.sec })
        return null
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const curvePath = (side: 'in' | 'out', shape: FadeShape | undefined): string => {
    // the fade's own curve as a filled wedge (top = full level)
    const N = 24
    const pts: string[] = []
    for (let i = 0; i <= N; i++) {
      const x = i / N
      const g = fadeGain(shape, side === 'in' ? x : 1 - x)
      pts.push(`${x * 100},${(1 - g) * 100}`)
    }
    return `M0,100 L${pts.join(' L')} L100,100 Z`
  }
  const wedge = (side: 'in' | 'out', sec: number, shape: FadeShape | undefined): React.JSX.Element => {
    const pct = Math.min(100, (sec / len) * 100)
    const label = FADE_SHAPES.find((s) => s.k === (shape ?? 'power'))?.label ?? 'Constant Power'
    return (
      <div
        title={`${side === 'in' ? 'fade in' : 'fade out'} · ${sec.toFixed(2)}s · ${label} — drag the inner edge · double-click = length · right-click = shape / remove`}
        onDoubleClick={(e) => {
          if (!props.editable) return
          e.preventDefault()
          e.stopPropagation()
          void textPrompt(`${side === 'in' ? 'Fade in' : 'Fade out'} length (seconds)`, sec.toFixed(2)).then((v) => {
            const n = v == null ? NaN : Number(v)
            if (!isNaN(n) && n > 0) props.onChange(side === 'in' ? { fadeInSec: Math.min(len, n) } : { fadeOutSec: Math.min(len, n) })
          })
        }}
        onContextMenu={(e) => {
          if (!props.editable) return
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, side })
        }}
        style={{ position: 'absolute', top: 0, bottom: 0, [side === 'in' ? 'left' : 'right']: 0, width: `${pct}%`, pointerEvents: props.editable ? 'auto' : 'none', zIndex: 3 }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d={curvePath(side, shape)} fill="rgba(0,0,0,.45)" />
          <path d={curvePath(side, shape).replace(/^M0,100 L/, 'M').replace(/ L100,100 Z$/, '')} fill="none" stroke="var(--txt-hi)" strokeOpacity={0.7} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        {props.editable && (
          <div
            onMouseDown={(e) => drag(side, e)}
            style={{ position: 'absolute', top: 0, bottom: 0, [side === 'in' ? 'right' : 'left']: -3, width: 6, cursor: 'ew-resize', zIndex: 4 }}
          />
        )}
      </div>
    )
  }
  return (
    <>
      {fin > 0 && wedge('in', fin, props.inShape)}
      {fout > 0 && wedge('out', fout, props.outShape)}
      {menu &&
        (() => {
          const cur = menu.side === 'in' ? (props.inShape ?? 'power') : (props.outShape ?? 'power')
          const entries: MenuEntry[] = [
            ...FADE_SHAPES.map((s) => ({
              label: <>{cur === s.k ? '✓ ' : '  '}{s.label}</>,
              onClick: () => props.onChange(menu.side === 'in' ? { fadeInShape: s.k } : { fadeOutShape: s.k })
            })),
            { sep: true, label: '' },
            { label: <>remove {menu.side === 'in' ? 'fade in' : 'fade out'}</>, onClick: () => props.onChange(menu.side === 'in' ? { fadeInSec: undefined, fadeInShape: undefined } : { fadeOutSec: undefined, fadeOutShape: undefined }) }
          ]
          return <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} />
        })()}
    </>
  )
}
