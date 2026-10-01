import { useEffect, useRef, useState } from 'react'
import { clampSpeed, remapAddKey, remapDeleteKey, remapMoveKey, remapPieces, remapRelAt, remapSegmentAt, remapSetRamp, remapSetSpeed, remapSrcAt, type SpeedRemap } from '../shared/remap'

// list 56 (vi-dancer docs/SPEED-RAMPS-SPEC-2026-10-01.md): Premiere's Time Remapping band on a timeline
// block. The speed line: 100 % in the middle, up = faster (to 1000 %), down = slower (to 10 %); the
// keyframe strip along the block's top. Drag the line = that segment's speed (a tooltip says how
// much); Ctrl-click it, or click it with the Pen = a keyframe; click a keyframe = select it, drag it =
// move it, drag one of its handles = a ramp; Delete (or its right-click) = gone. Every gesture shows
// live (`onLive`) and lands as one write (`onCommit`).
const STRIP = 8 // px: the keyframe strip along the top
const PAD = 5 // px: room under the line at 10 %

export function SpeedBand(p: {
  remap: SpeedRemap
  inSec: number // the block's source window
  outSec: number
  lenSec: number // the block's length on the timeline with this remap
  pen: boolean // the Pen tool: a click on the line adds a keyframe
  selected: number | null // the selected keyframe
  onSelect: (i: number | null) => void
  onLive: (r: SpeedRemap | null) => void
  onCommit: (r: SpeedRemap) => void
  onKeyMenu: (i: number, x: number, y: number) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Delete removes the selected keyframe (and nothing else: the block's own Delete is stopped here)
  const live = useRef(p)
  live.current = p
  useEffect(() => {
    if (p.selected == null) return
    const onKey = (e: KeyboardEvent): void => {
      const q = live.current
      const t = e.target as HTMLElement | null
      if (q.selected == null || (e.key !== 'Delete' && e.key !== 'Backspace') || t?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      q.onCommit(remapDeleteKey(q.remap, q.selected))
      q.onSelect(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p.selected])

  const { w, h } = box
  const top = STRIP + 3
  const yOf = (v: number): number => top + ((1 - Math.log10(clampSpeed(v))) / 2) * Math.max(1, h - top - PAD)
  const vOf = (clientY: number, r: DOMRect): number => {
    const f = Math.min(1, Math.max(0, (clientY - r.top - top) / Math.max(1, r.height - top - PAD)))
    return clampSpeed(Math.pow(10, 1 - 2 * f))
  }
  const xOfSrc = (s: number): number => (p.lenSec > 0 ? (remapRelAt(p.remap, p.inSec, s) / p.lenSec) * w : 0)
  // the source second under a pointer, read on the remap the gesture started from
  const srcAtX = (clientX: number, r: DOMRect, from: SpeedRemap, len: number): number => remapSrcAt(from, p.inSec, ((clientX - r.left) / Math.max(1, r.width)) * len)
  const pts: string[] = []
  for (const pc of remapPieces(p.remap, p.inSec, p.outSec)) {
    const y = yOf(pc.v).toFixed(1)
    pts.push(`${xOfSrc(pc.s0).toFixed(1)},${y}`, `${xOfSrc(pc.s1).toFixed(1)},${y}`)
  }
  const drag = (e: React.MouseEvent, onMove: (ev: MouseEvent, r: DOMRect) => SpeedRemap, tipOf?: (ev: MouseEvent, r: DOMRect) => string): void => {
    e.preventDefault()
    e.stopPropagation()
    const r = ref.current!.getBoundingClientRect()
    const x0 = e.clientX
    const y0 = e.clientY
    let last: SpeedRemap | null = null
    const move = (ev: MouseEvent): void => {
      if (!last && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return
      last = onMove(ev, r)
      p.onLive(last)
      if (tipOf) setTip({ x: ev.clientX, y: ev.clientY, text: tipOf(ev, r) })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setTip(null)
      if (last) p.onCommit(last)
      else p.onLive(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const onLine = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const r = ref.current!.getBoundingClientRect()
    const s = srcAtX(e.clientX, r, p.remap, p.lenSec)
    if (e.ctrlKey || e.metaKey || p.pen) {
      e.preventDefault()
      e.stopPropagation()
      p.onCommit(remapAddKey(p.remap, s))
      return
    }
    const seg = remapSegmentAt(p.remap, s)
    const from = p.remap
    drag(e, (ev, rr) => remapSetSpeed(from, seg, vOf(ev.clientY, rr)), (ev, rr) => `${Math.round(vOf(ev.clientY, rr) * 100)} %`)
  }
  const onKey = (e: React.MouseEvent, i: number): void => {
    if (e.button !== 0) return
    p.onSelect(i)
    const from = p.remap
    const len = p.lenSec
    drag(e, (ev, r) => remapMoveKey(from, i, srcAtX(ev.clientX, r, from, len)))
  }
  const onHandle = (e: React.MouseEvent, i: number): void => {
    if (e.button !== 0) return
    const from = p.remap
    const len = p.lenSec
    const at = from.keys[i].at
    drag(e, (ev, r) => remapSetRamp(from, i, 2 * Math.abs(srcAtX(ev.clientX, r, from, len) - at)))
  }
  const v0 = p.remap.speeds
  return (
    <div ref={ref} data-speedband style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {/* the keyframe strip along the top (Premiere's speed-control track) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: STRIP, background: 'rgba(255,255,255,.16)', borderBottom: '1px solid rgba(0,0,0,.35)' }} />
      {w > 0 && h > 0 && (
        <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          <polyline points={pts.join(' ')} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth={3} />
          <polyline points={pts.join(' ')} fill="none" stroke="var(--txt-hi)" strokeWidth={1.5} />
          {/* the line's grab zone */}
          <polyline
            data-noblockdrag
            data-speedline
            points={pts.join(' ')}
            fill="none"
            stroke="transparent"
            strokeWidth={10}
            style={{ pointerEvents: 'stroke', cursor: p.pen ? 'copy' : 'ns-resize' }}
            onMouseDown={onLine}
          >
            <title>{`speed ${v0.map((v) => `${Math.round(v * 100)} %`).join(' · ')} — drag = that part's speed · Ctrl-click (or the Pen) = a keyframe`}</title>
          </polyline>
        </svg>
      )}
      {w > 0 &&
        p.remap.keys.map((k, i) => {
          const x = xOfSrc(k.at)
          const sel = p.selected === i
          const half = (k.ramp ?? 0) / 2
          const xl = half > 0 ? xOfSrc(k.at - half) : x - 5
          const xr = half > 0 ? xOfSrc(k.at + half) : x + 5
          return (
            <div key={i}>
              {half > 0 && <div style={{ position: 'absolute', left: xl, width: Math.max(1, xr - xl), top: 0, height: STRIP, background: 'rgba(255,255,255,.28)' }} />}
              <div
                data-noblockdrag
                data-remapkey={i}
                title={`speed keyframe · ${k.at.toFixed(2)}s of the take${half > 0 ? ` · a ${(half * 2).toFixed(2)}s ramp` : ''}\nclick = select · drag = move · Delete or right-click = remove`}
                onMouseDown={(e) => onKey(e, i)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  p.onSelect(i)
                  p.onKeyMenu(i, e.clientX, e.clientY)
                }}
                style={{ position: 'absolute', left: x - 4, top: 0, width: 8, height: STRIP, pointerEvents: 'auto', cursor: 'ew-resize', background: sel ? 'var(--amber)' : 'var(--txt-hi)', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}
              />
              {sel &&
                ([
                  ['left', xl],
                  ['right', xr]
                ] as const).map(([side, hx]) => (
                  <div
                    key={side}
                    data-noblockdrag
                    data-ramphandle={side}
                    title="drag apart = a ramp: the speed eases from one part into the next across it"
                    onMouseDown={(e) => onHandle(e, i)}
                    style={{ position: 'absolute', left: hx - 3, top: STRIP + 1, width: 6, height: 6, borderRadius: 1, pointerEvents: 'auto', cursor: 'ew-resize', background: 'var(--amber)', boxShadow: '0 0 0 1px rgba(0,0,0,.5)' }}
                  />
                ))}
            </div>
          )
        })}
      {tip && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 22, zIndex: 3000, pointerEvents: 'none', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-hi)', background: 'rgba(0,0,0,.8)', border: '1px solid var(--line2)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
