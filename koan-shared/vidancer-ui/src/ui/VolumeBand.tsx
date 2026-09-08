// AUDIO RUBBER BAND (docs/AUDIO-RUBBER-BAND-SPEC.md) — the Premiere volume line, one component
// for every audio-bearing block (free audio, music, ♪ scores, video clips' own sound).
// Geometry: bottom = silence, mid = 100%, top = 200%. The line always draws (low opacity when
// read-only); points edit only when `editable`. FOLD RULE: adding the FIRST point folds the
// block's flat gain into that point (gain resets to 1) — display never jumps, and with points
// present the points ARE the level (drag-the-line-for-gain only exists while pointless).
import { useRef, useState } from 'react'
import type { VolumePoint } from '../shared/types'
import { envGainAt } from '../shared/audioEnv'
import { ContextMenu, type MenuEntry } from '@koan/shared'

const clampG = (g: number): number => Math.max(0, Math.min(2, g))
const mkId = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export function VolumeBand(props: {
  lenSec: number // the block's visible length — the band's x scale
  gain: number // flat fader (multiplies the envelope; 1 with points present, per the fold rule)
  points: VolumePoint[] | undefined
  editable: boolean
  onGain: (g: number) => void
  onPoints: (pts: VolumePoint[]) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<{ pts?: VolumePoint[]; gain?: number } | null>(null) // drag preview
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; pointId: string | null } | null>(null)
  const pts = live?.pts ?? props.points ?? []
  const gain = live?.gain ?? props.gain
  const D = (t: number): number => clampG(gain * envGainAt(pts.length ? pts : undefined, t))
  const yPct = (g: number): number => 100 * (1 - clampG(g) / 2)

  // sampled polyline (in a stretch viewBox; non-scaling stroke keeps the width honest)
  const N = 64
  const linePts: string[] = []
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * props.lenSec
    linePts.push(`${(i / N) * 100},${yPct(D(t))}`)
  }

  const tg = (e: { clientX: number; clientY: number }): { t: number; g: number; x: number; y: number; w: number; h: number } => {
    const r = wrapRef.current?.getBoundingClientRect()
    const w = r?.width ?? 1
    const h = r?.height ?? 1
    const x = Math.max(0, Math.min(w, e.clientX - (r?.left ?? 0)))
    const y = Math.max(0, Math.min(h, e.clientY - (r?.top ?? 0)))
    return { t: (x / w) * props.lenSec, g: clampG(2 * (1 - y / h)), x, y, w, h }
  }
  const hitPoint = (e: { clientX: number; clientY: number }): VolumePoint | undefined => {
    const { x, y, w, h } = tg(e)
    return pts.find((p) => {
      const px = (p.at / props.lenSec) * w
      const py = (yPct(clampG(gain * p.gain)) / 100) * h
      return Math.hypot(px - x, py - y) <= 7
    })
  }
  const nearLine = (e: { clientX: number; clientY: number }): boolean => {
    const { t, y, h } = tg(e)
    return Math.abs((yPct(D(t)) / 100) * h - y) <= 7
  }
  const commit = (): void => {
    if (live?.pts) props.onPoints([...live.pts].sort((a, b) => a.at - b.at))
    if (live?.gain != null) props.onGain(live.gain)
    setLive(null)
    setTip(null)
  }
  const showTip = (e: { clientX: number; clientY: number }, g: number, t: number): void =>
    setTip({ x: e.clientX, y: e.clientY, text: `${Math.round(clampG(g) * 100)}% · ${t.toFixed(1)}s` })

  const dragPoint = (p: VolumePoint, e0: React.MouseEvent): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const move = (ev: MouseEvent): void => {
      const { t, g } = tg(ev)
      const at = ev.shiftKey ? p.at : Math.max(0, Math.min(props.lenSec, t)) // Shift = level only
      const next = (props.points ?? []).map((x) => (x.id === p.id ? { ...x, at, gain: g / (gain || 1) } : x))
      setLive({ pts: next })
      showTip(ev, g, at)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      // read the latest preview via state setter to avoid a stale closure
      setLive((cur) => {
        if (cur?.pts) props.onPoints([...cur.pts].sort((a, b) => a.at - b.at))
        return null
      })
      setTip(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const dragGain = (e0: React.MouseEvent): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const move = (ev: MouseEvent): void => {
      const { g, t } = tg(ev)
      setLive({ gain: g })
      showTip(ev, g, t)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLive((cur) => {
        if (cur?.gain != null) props.onGain(cur.gain)
        return null
      })
      setTip(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const addPoint = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const { t } = tg(e)
    const level = D(t)
    if (!(props.points ?? []).length) {
      // FOLD: flat gain moves into the first point; gain returns to unity
      props.onGain(1)
      props.onPoints([{ id: mkId(), at: Math.max(0, Math.min(props.lenSec, t)), gain: level }])
    } else {
      props.onPoints(
        [...(props.points ?? []), { id: mkId(), at: Math.max(0, Math.min(props.lenSec, t)), gain: level / (gain || 1) }].sort((a, b) => a.at - b.at)
      )
    }
  }

  return (
    <div
      ref={wrapRef}
      onMouseDown={(e) => {
        if (!props.editable || e.button !== 0) return
        const p = hitPoint(e)
        if (p) return dragPoint(p, e)
        if (nearLine(e)) {
          if (e.ctrlKey) return addPoint(e)
          if (!pts.length) return dragGain(e)
        }
        // misses (and the un-grabbable line between points) BUBBLE — the block's own
        // mousedown takes the gesture, so move/select still work over the band
      }}
      onDoubleClick={(e) => {
        if (props.editable && nearLine(e) && !hitPoint(e)) addPoint(e)
      }}
      onContextMenu={(e) => {
        if (!props.editable) return
        const p = hitPoint(e)
        if (p || nearLine(e)) {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, pointId: p?.id ?? null })
        }
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: props.editable ? 'auto' : 'none' }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <polyline
          points={linePts.join(' ')}
          fill="none"
          stroke="var(--amber)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          opacity={props.editable ? 0.95 : 0.5}
        />
      </svg>
      {props.editable &&
        pts.map((p) => (
          <div
            key={p.id}
            title={`${Math.round(clampG(gain * p.gain) * 100)}% · ${p.at.toFixed(1)}s · ${p.curve === 'smooth' ? 'smooth' : 'linear'} — drag (Shift = level only) · right-click: curve / delete`}
            style={{
              position: 'absolute',
              left: `${(p.at / props.lenSec) * 100}%`,
              top: `${yPct(clampG(gain * p.gain))}%`,
              width: 7,
              height: 7,
              marginLeft: -3.5,
              marginTop: -3.5,
              borderRadius: '50%',
              background: 'var(--amber)',
              boxShadow: '0 0 0 1.5px rgba(0,0,0,.6)',
              cursor: 'grab'
            }}
          />
        ))}
      {tip && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 22, zIndex: 9999, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--txt-hi)', pointerEvents: 'none' }}>
          {tip.text}
        </div>
      )}
      {menu &&
        (() => {
          const p = pts.find((x) => x.id === menu.pointId)
          const entries: MenuEntry[] = p
            ? [
                { label: <>{p.curve === 'smooth' ? 'curve → linear' : 'curve → smooth (ease)'}</>, onClick: () => props.onPoints(pts.map((x) => (x.id === p.id ? { ...x, curve: p.curve === 'smooth' ? undefined : 'smooth' } : x))) },
                { label: <>delete point</>, onClick: () => props.onPoints(pts.filter((x) => x.id !== p.id)) },
                { label: <>reset band (clear all points)</>, onClick: () => props.onPoints([]) }
              ]
            : [{ label: <>reset band (clear all points)</>, onClick: () => props.onPoints([]) }]
          return <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} />
        })()}
    </div>
  )
}
