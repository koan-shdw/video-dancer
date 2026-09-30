// AUDIO KEYFRAMES — the Premiere volume line (docs/AUDIO-KEYFRAMES-PREMIERE-SPEC-2026-09-09.md, on the v19
// rubber band). ONE component for every audio-bearing block (free audio, ♪ scores, a video clip's linked
// companion). Geometry: dB — +6 at the top, 0 dB at the MIDDLE (Premiere), −48 dB at 95 % height, −∞ at the floor.
// Grammar (Premiere's): drag the line = clip level (no keyframes) · Ctrl-click the line = keyframe ·
// Ctrl-click a keyframe = Linear ↔ Auto Bezier, Ctrl-drag out of an Auto Bezier = its handles (Bezier) ·
// click / Shift-click = select · Shift-drag empty space = marquee · drag = move (Shift locks one axis; every
// selected keyframe rides along) · drag the segment between two keyframes = both levels · Delete = the
// selected keyframes · right-click a keyframe = Linear · Bezier · Auto Bezier · Continuous Bezier · Hold ·
// Ease In · Ease Out · handles on the selected keyframe drag (Auto → Continuous, Alt breaks Continuous into
// Bezier). The PEN tool (P, list 4): a plain click on the line = a keyframe, a drag on empty space = a
// marquee. Double-click the line or a keyframe = back to 0 dB (his rule, 09-09). FOLD RULE stays: the
// first keyframe folds the flat gain into itself.
import { useEffect, useRef, useState } from 'react'
import type { VolumePoint, KeyInterp } from '../shared/types'
import { envGainAt, envDbAt, dbOf, gainOfDb, clampG, fmtDb, interpOf, segmentHandles, DB_FLOOR } from '../shared/audioEnv'
import { ContextMenu, type MenuEntry } from '@koan/shared'
import { useStore } from '../store'

const mkId = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

// the dB lane's vertical taper: 0 dB at the MIDDLE of the block (Premiere), +6 dB at the top, linear in dB
// down to −48 dB at 95 % of the height, then to −∞ at the floor
const DB_TOP = 6
const DB_KNEE = -48
const MID_Y = 0.5
const KNEE_Y = 0.95
const dbToY = (db: number): number =>
  db >= 0
    ? ((DB_TOP - Math.min(DB_TOP, db)) / DB_TOP) * MID_Y
    : db >= DB_KNEE
      ? MID_Y + (-db / -DB_KNEE) * (KNEE_Y - MID_Y)
      : KNEE_Y + ((DB_KNEE - Math.max(DB_FLOOR, db)) / (DB_KNEE - DB_FLOOR)) * (1 - KNEE_Y)
const yToDb = (y: number): number =>
  y <= MID_Y
    ? DB_TOP - (y / MID_Y) * DB_TOP
    : y <= KNEE_Y
      ? ((y - MID_Y) / (KNEE_Y - MID_Y)) * DB_KNEE
      : y >= 0.995
        ? DB_FLOOR
        : DB_KNEE - ((y - KNEE_Y) / (1 - KNEE_Y)) * (DB_KNEE - DB_FLOOR)

const INTERPS: { k: KeyInterp; label: string }[] = [
  { k: 'linear', label: 'Linear' },
  { k: 'bezier', label: 'Bezier' },
  { k: 'auto', label: 'Auto Bezier' },
  { k: 'continuous', label: 'Continuous Bezier' },
  { k: 'hold', label: 'Hold' },
  { k: 'easeIn', label: 'Ease In' },
  { k: 'easeOut', label: 'Ease Out' }
]
const hasHandles = (k: KeyInterp): boolean => k === 'bezier' || k === 'continuous' || k === 'auto'

export function VolumeBand(props: {
  lenSec: number // the block's visible length — the band's x scale
  gain: number // flat fader (multiplies the envelope; 1 with keyframes present, per the fold rule)
  points: VolumePoint[] | undefined
  editable: boolean
  onChange: (r: { gain: number; points: VolumePoint[] }) => void // ONE write — gain and points together
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pen = useStore((s) => s.tlTool === 'pen') // list 4: Premiere's Pen tool
  const [live, setLive] = useState<{ pts?: VolumePoint[]; gain?: number } | null>(null) // drag preview
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; pointId: string | null; t: number } | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<'line' | 'point' | 'handle' | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const pts = live?.pts ?? props.points ?? []
  const gain = live?.gain ?? props.gain
  const len = Math.max(0.01, props.lenSec)
  // level at t as dB (gain × envelope); with keyframes gain = 1 (fold rule) but multiply anyway
  const levelDb = (t: number): number => dbOf(clampG(gain * envGainAt(pts.length ? pts : undefined, t)))
  const pointDb = (p: VolumePoint): number => dbOf(clampG(gain * p.gain))

  // sampled polyline (stretch viewBox; non-scaling stroke keeps the width honest)
  const N = 96
  const linePts: string[] = []
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * len
    linePts.push(`${(i / N) * 100},${dbToY(pts.length ? envDbAt(pts, t) + dbOf(clampG(gain)) : levelDb(t)) * 100}`)
  }

  const geo = (e: { clientX: number; clientY: number }): { t: number; db: number; x: number; y: number; w: number; h: number } => {
    const r = wrapRef.current?.getBoundingClientRect()
    const w = r?.width ?? 1
    const h = r?.height ?? 1
    const x = Math.max(0, Math.min(w, e.clientX - (r?.left ?? 0)))
    const y = Math.max(0, Math.min(h, e.clientY - (r?.top ?? 0)))
    return { t: (x / w) * len, db: yToDb(y / h), x, y, w, h }
  }
  const pxOf = (t: number, db: number, w: number, h: number): { x: number; y: number } => ({ x: (t / len) * w, y: dbToY(db) * h })
  const hitPoint = (e: { clientX: number; clientY: number }): VolumePoint | undefined => {
    const { x, y, w, h } = geo(e)
    return pts.find((p) => {
      const q = pxOf(p.at, pointDb(p), w, h)
      return Math.hypot(q.x - x, q.y - y) <= 7
    })
  }
  const nearLine = (e: { clientX: number; clientY: number }): boolean => {
    const { t, y, h } = geo(e)
    return Math.abs(dbToY(levelDb(t)) * h - y) <= 7
  }

  // ---- handles of the selected keyframes (spec §2.5) ----
  type Handle = { pointId: string; side: 'in' | 'out'; t: number; db: number }
  const handles = (): Handle[] => {
    const out: Handle[] = []
    pts.forEach((p, i) => {
      if (!sel.has(p.id) || !hasHandles(interpOf(p))) return
      const next = pts[i + 1]
      const prev = pts[i - 1]
      if (next) {
        const h = segmentHandles(pts, i)
        if (h) out.push({ pointId: p.id, side: 'out', t: p.at + h.p1.x * (next.at - p.at), db: h.p1.y + dbOf(clampG(gain)) })
      }
      if (prev) {
        const h = segmentHandles(pts, i - 1)
        if (h) out.push({ pointId: p.id, side: 'in', t: prev.at + h.p2.x * (p.at - prev.at), db: h.p2.y + dbOf(clampG(gain)) })
      }
    })
    return out
  }
  const hitHandle = (e: { clientX: number; clientY: number }): Handle | undefined => {
    const { x, y, w, h } = geo(e)
    return handles().find((hd) => {
      const q = pxOf(hd.t, hd.db, w, h)
      return Math.hypot(q.x - x, q.y - y) <= 6
    })
  }

  const showTip = (e: { clientX: number; clientY: number }, db: number, t: number): void => setTip({ x: e.clientX, y: e.clientY, text: `${fmtDb(gainOfDb(db))} · ${t.toFixed(2)}s` })
  const commitPts = (next: VolumePoint[]): void => props.onChange({ gain: props.gain, points: [...next].sort((a, b) => a.at - b.at) })
  const sorted = (a: VolumePoint[]): VolumePoint[] => [...a].sort((x, y) => x.at - y.at)

  // ---- drags ----
  const dragPoints = (grab: VolumePoint, ids: Set<string>, e0: React.MouseEvent): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const base = props.points ?? []
    const g0 = geo(e0)
    let axis: 'x' | 'y' | null = null // Shift: lock to the first direction the drag takes
    const move = (ev: MouseEvent): void => {
      const g = geo(ev)
      let dt = g.t - g0.t
      let ddb = g.db - g0.db
      if (ev.shiftKey) {
        if (!axis && (Math.abs(g.x - g0.x) > 4 || Math.abs(g.y - g0.y) > 4)) axis = Math.abs(g.x - g0.x) >= Math.abs(g.y - g0.y) ? 'x' : 'y'
        if (axis === 'x') ddb = 0
        if (axis === 'y') dt = 0
      } else axis = null
      // keyframes cannot pass their neighbours: clamp the group's shift to the tightest gap
      const moving = base.filter((p) => ids.has(p.id))
      let lo = -Infinity
      let hi = Infinity
      for (const p of moving) {
        const i = base.indexOf(p)
        const prev = [...base].slice(0, i).reverse().find((q) => !ids.has(q.id))
        const next = base.slice(i + 1).find((q) => !ids.has(q.id))
        lo = Math.max(lo, (prev ? prev.at + 0.01 : 0) - p.at)
        hi = Math.min(hi, (next ? next.at - 0.01 : len) - p.at)
      }
      dt = Math.max(lo, Math.min(hi, dt))
      const next = base.map((p) => {
        if (!ids.has(p.id)) return p
        const db = Math.max(DB_FLOOR, Math.min(DB_TOP, pointDb(p) + ddb))
        return { ...p, at: Math.max(0, Math.min(len, p.at + dt)), gain: clampG(gainOfDb(db) / (gain || 1)) }
      })
      setLive({ pts: next })
      const me = next.find((p) => p.id === grab.id)
      if (me) showTip(ev, dbOf(clampG(gain * me.gain)), me.at)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLive((cur) => {
        if (cur?.pts) commitPts(cur.pts)
        return null
      })
      setTip(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // the two keyframes around t (or the nearest end) — what a drag or a double-click on the line moves
  const segmentIds = (t: number): Set<string> => {
    const base = props.points ?? []
    let i = base.findIndex((p, k) => t >= p.at && (!base[k + 1] || t < base[k + 1].at))
    if (t < base[0].at) i = -1
    const ids = new Set<string>()
    if (i < 0) ids.add(base[0].id)
    else {
      ids.add(base[i].id)
      if (base[i + 1]) ids.add(base[i + 1].id)
    }
    return ids
  }
  // `click` = what a press that never moved does (the Pen's keyframe)
  const dragSegment = (t0: number, e0: React.MouseEvent, click?: () => void): void => {
    // the two keyframes around t0 (or the nearest end) move in level together, time fixed
    const base = props.points ?? []
    const ids = segmentIds(t0)
    e0.preventDefault()
    e0.stopPropagation()
    const g0 = geo(e0)
    let moved = false
    const move = (ev: MouseEvent): void => {
      const g = geo(ev)
      if (!moved && Math.hypot(g.x - g0.x, g.y - g0.y) < 3) return
      moved = true
      const ddb = g.db - g0.db
      const next = base.map((p) => (ids.has(p.id) ? { ...p, gain: clampG(gainOfDb(Math.max(DB_FLOOR, Math.min(DB_TOP, pointDb(p) + ddb))) / (gain || 1)) } : p))
      setLive({ pts: next })
      showTip(ev, Math.max(DB_FLOOR, Math.min(DB_TOP, g.db)), g.t)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLive((cur) => {
        if (cur?.pts) commitPts(cur.pts)
        return null
      })
      setTip(null)
      if (!moved) click?.()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const dragGain = (e0: React.MouseEvent, click?: () => void): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const g0 = geo(e0)
    let moved = false
    const move = (ev: MouseEvent): void => {
      const { db, t, x, y } = geo(ev)
      if (!moved && Math.hypot(x - g0.x, y - g0.y) < 3) return
      moved = true
      const g = clampG(gainOfDb(Math.max(DB_FLOOR, Math.min(DB_TOP, db))))
      setLive({ gain: g })
      showTip(ev, dbOf(g), t)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLive((cur) => {
        if (cur?.gain != null) props.onChange({ gain: cur.gain, points: props.points ?? [] })
        return null
      })
      setTip(null)
      if (!moved) click?.()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const dragHandle = (hd: Handle, e0: Pick<React.MouseEvent, 'preventDefault' | 'stopPropagation'>, force?: 'bezier'): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const base = props.points ?? []
    const i = base.findIndex((p) => p.id === hd.pointId)
    const p = base[i]
    const prev = base[i - 1]
    const next = base[i + 1]
    if (!p) return
    const move = (ev: MouseEvent): void => {
      const g = geo(ev)
      const pDb = pointDb(p)
      // Auto → Continuous on the first drag; Alt breaks a Continuous into an independent Bezier
      const kind: KeyInterp = force ?? (ev.altKey ? 'bezier' : interpOf(p) === 'bezier' ? 'bezier' : 'continuous')
      const mirror = kind === 'continuous' || !!force // a pulled-out Bezier starts symmetrical, then each side is its own
      const patch: Partial<VolumePoint> = { interp: kind }
      const segOut = next ? next.at - p.at : 0
      const segIn = prev ? p.at - prev.at : 0
      if (hd.side === 'out' && next) {
        const x = Math.max(0.02, Math.min(0.98, (g.t - p.at) / segOut))
        patch.out = { x, y: g.db - pDb }
        if (mirror && prev) patch.in = { x: Math.max(0.02, Math.min(0.98, (p.at - (g.t - p.at) - prev.at) / segIn)), y: -(g.db - pDb) }
      } else if (hd.side === 'in' && prev) {
        const x = Math.max(0.02, Math.min(0.98, (g.t - prev.at) / segIn))
        patch.in = { x, y: g.db - pDb }
        if (mirror && next) patch.out = { x: Math.max(0.02, Math.min(0.98, (p.at + (p.at - g.t) - p.at) / segOut)), y: -(g.db - pDb) }
      }
      setLive({ pts: base.map((q) => (q.id === p.id ? { ...q, ...patch } : q)) })
      showTip(ev, g.db, g.t)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLive((cur) => {
        if (cur?.pts) commitPts(cur.pts)
        return null
      })
      setTip(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const startMarquee = (e0: React.MouseEvent, add: boolean): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const g0 = geo(e0)
    setMarquee({ x0: g0.x, y0: g0.y, x1: g0.x, y1: g0.y })
    const move = (ev: MouseEvent): void => {
      const g = geo(ev)
      setMarquee({ x0: g0.x, y0: g0.y, x1: g.x, y1: g.y })
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const g = geo(ev)
      const [xa, xb] = [Math.min(g0.x, g.x), Math.max(g0.x, g.x)]
      const [ya, yb] = [Math.min(g0.y, g.y), Math.max(g0.y, g.y)]
      setSel((cur) => {
        const n = new Set(add ? cur : [])
        for (const p of pts) {
          const q = pxOf(p.at, pointDb(p), g.w, g.h)
          if (q.x >= xa && q.x <= xb && q.y >= ya && q.y <= yb) n.add(p.id)
        }
        return n
      })
      setMarquee(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Ctrl on a keyframe, Premiere's way: Linear (or Hold / Ease) → Auto Bezier; Bezier / Continuous → Linear;
  // Auto Bezier → Linear on a click, or a drag pulls out its direction handle (→ Bezier)
  const ctrlPoint = (p: VolumePoint, e0: React.MouseEvent): void => {
    e0.preventDefault()
    e0.stopPropagation()
    const k = interpOf(p)
    const toLinear = (): void => commitPts(pts.map((x) => (x.id === p.id ? { ...x, interp: 'linear', curve: undefined, in: undefined, out: undefined } : x)))
    if (k !== 'auto') {
      if (k === 'bezier' || k === 'continuous') toLinear()
      else commitPts(pts.map((x) => (x.id === p.id ? { ...x, interp: 'auto', curve: undefined, in: undefined, out: undefined } : x)))
      return
    }
    const x0 = e0.clientX
    const y0 = e0.clientY
    const i = pts.findIndex((x) => x.id === p.id)
    const off = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    const move = (ev: MouseEvent): void => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      off()
      const right = ev.clientX >= x0
      const side: 'in' | 'out' = (right && pts[i + 1]) || !pts[i - 1] ? 'out' : 'in'
      setSel(new Set([p.id]))
      dragHandle({ pointId: p.id, side, t: p.at, db: pointDb(p) }, { preventDefault: () => undefined, stopPropagation: () => undefined }, 'bezier')
    }
    const up = (): void => {
      off()
      toLinear()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // double-click = back to 0 dB (his rule, 09-09): a keyframe (with the rest of the selection), the
  // segment under the pointer, or the clip level when there are no keyframes
  const snapZero = (e: React.MouseEvent): void => {
    const p = hitPoint(e)
    if (!pts.length) return props.onChange({ gain: 1, points: [] })
    const ids = p ? (sel.has(p.id) ? sel : new Set([p.id])) : segmentIds(geo(e).t)
    commitPts(pts.map((x) => (ids.has(x.id) ? { ...x, gain: clampG(1 / (gain || 1)) } : x)))
  }

  // ---- add / remove ----
  const addPoint = (t: number, select = true): void => {
    const at = Math.max(0, Math.min(len, t))
    const base = props.points ?? []
    const id = mkId()
    if (!base.length) {
      // FOLD: the flat gain moves into the first keyframe; gain returns to unity — ONE write (two writes
      // raced: the second was built from a stale snapshot and the point was lost)
      props.onChange({ gain: 1, points: [{ id, at, gain: clampG(gain) }] })
    } else commitPts([...base, { id, at, gain: clampG(gainOfDb(levelDb(at)) / (gain || 1)) }])
    if (select) setSel(new Set([id]))
  }
  const removePoints = (ids: Set<string>): void => {
    commitPts((props.points ?? []).filter((p) => !ids.has(p.id)))
    setSel(new Set())
  }
  // Delete / Backspace = the selected keyframes (capture, ahead of the block delete)
  useEffect(() => {
    if (!props.editable || !sel.size) return
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('[aria-modal="true"]')) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      e.stopPropagation()
      removePoints(sel)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.editable, sel, props.points])

  const r0 = wrapRef.current?.getBoundingClientRect()
  const W = r0?.width ?? 1
  const H = r0?.height ?? 1
  const zeroY = dbToY(0) * 100

  return (
    <div
      ref={wrapRef}
      onMouseMove={(e) => {
        if (!props.editable) return
        setHover(hitHandle(e) ? 'handle' : hitPoint(e) ? 'point' : nearLine(e) ? 'line' : null)
      }}
      onMouseLeave={() => setHover(null)}
      onMouseDown={(e) => {
        if (!props.editable || e.button !== 0) return
        const hd = hitHandle(e)
        if (hd) return dragHandle(hd, e)
        const p = hitPoint(e)
        if (p) {
          if (e.ctrlKey || e.metaKey) return ctrlPoint(p, e)
          let ids: Set<string>
          if (e.shiftKey) {
            ids = new Set(sel)
            if (ids.has(p.id)) ids.delete(p.id)
            else ids.add(p.id)
            setSel(ids)
            e.preventDefault()
            e.stopPropagation()
            return
          }
          ids = sel.has(p.id) ? sel : new Set([p.id])
          setSel(ids)
          return dragPoints(p, ids, e)
        }
        if (nearLine(e)) {
          const { t } = geo(e)
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            e.stopPropagation()
            return addPoint(t)
          }
          // the Pen: a press that never moves = a keyframe here; a drag moves the line like the Selection tool
          const click = pen ? (): void => addPoint(t) : undefined
          if (!pts.length) return dragGain(e, click)
          return dragSegment(t, e, click)
        }
        // the Pen boxes keyframes on empty space (and never lets the clip under it move); Shift adds
        if (e.shiftKey || pen) return startMarquee(e, e.shiftKey)
        // empty band space: the selection clears, the gesture BUBBLES — the block's own mousedown
        // (move / select) takes it, so the band never steals the block
        if (sel.size) setSel(new Set())
      }}
      onDoubleClick={(e) => {
        if (!props.editable || (!hitPoint(e) && !nearLine(e))) return
        e.preventDefault()
        e.stopPropagation()
        snapZero(e)
      }}
      onContextMenu={(e) => {
        if (!props.editable) return
        const p = hitPoint(e)
        if (p || nearLine(e)) {
          e.preventDefault()
          e.stopPropagation()
          if (p && !sel.has(p.id)) setSel(new Set([p.id]))
          setMenu({ x: e.clientX, y: e.clientY, pointId: p?.id ?? null, t: geo(e).t })
        }
      }}
      title={props.editable && !pts.length ? (pen ? 'pen: click the line = keyframe · drag = clip level · double-click = 0 dB' : 'drag the line = clip level · ctrl-click the line = keyframe · double-click = 0 dB') : undefined}
      style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: props.editable ? 'auto' : 'none', cursor: hover === 'line' ? 'copy' : hover ? 'grab' : pen && props.editable ? 'crosshair' : undefined }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        {props.editable && <line x1={0} y1={zeroY} x2={100} y2={zeroY} stroke="var(--txt)" strokeOpacity={0.22} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />}
        <polyline points={linePts.join(' ')} fill="none" stroke="var(--amber)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={props.editable ? 0.95 : 0.5} />
      </svg>
      {/* bezier handles of the selected keyframes */}
      {props.editable &&
        handles().map((hd) => {
          const p = pts.find((q) => q.id === hd.pointId)!
          const a = pxOf(p.at, pointDb(p), W, H)
          const b = pxOf(hd.t, hd.db, W, H)
          return (
            <svg key={`${hd.pointId}:${hd.side}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--amber)" strokeOpacity={0.7} strokeWidth={1} />
              <rect x={b.x - 3} y={b.y - 3} width={6} height={6} fill="var(--bg2)" stroke="var(--amber)" strokeWidth={1.2} />
            </svg>
          )
        })}
      {props.editable &&
        pts.map((p) => (
          <div
            key={p.id}
            title={`${fmtDb(gain * p.gain)} · ${p.at.toFixed(2)}s · ${INTERPS.find((x) => x.k === interpOf(p))?.label ?? 'Linear'} — drag (Shift = one axis) · ctrl-click = Linear ↔ Auto Bezier · double-click = 0 dB · Delete / right-click = remove`}
            style={{
              position: 'absolute',
              left: `${(p.at / len) * 100}%`,
              top: `${dbToY(pointDb(p)) * 100}%`,
              width: 7,
              height: 7,
              marginLeft: -3.5,
              marginTop: -3.5,
              borderRadius: interpOf(p) === 'hold' ? 1 : '50%',
              background: sel.has(p.id) ? 'var(--txt-hi)' : 'var(--amber)',
              boxShadow: sel.has(p.id) ? '0 0 0 1.5px var(--amber)' : '0 0 0 1.5px rgba(0,0,0,.6)',
              cursor: 'grab'
            }}
          />
        ))}
      {marquee && (
        <div style={{ position: 'absolute', left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0), border: '1px dashed var(--amber)', background: 'color-mix(in srgb, var(--amber) 12%, transparent)', pointerEvents: 'none' }} />
      )}
      {tip && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 22, zIndex: 9999, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--txt-hi)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {tip.text}
        </div>
      )}
      {menu &&
        (() => {
          const p = pts.find((x) => x.id === menu.pointId)
          const many = p && sel.has(p.id) && sel.size > 1 ? sel.size : 0
          const setInterp = (k: KeyInterp): void => {
            const ids = p && sel.has(p.id) ? sel : new Set(p ? [p.id] : [])
            commitPts(pts.map((x) => (ids.has(x.id) ? { ...x, interp: k, curve: undefined, ...(k === 'bezier' || k === 'continuous' ? {} : { in: undefined, out: undefined }) } : x)))
          }
          const entries: MenuEntry[] = p
            ? [
                ...INTERPS.map((it) => ({ label: <>{interpOf(p) === it.k ? '✓ ' : '  '}{it.label}</>, onClick: () => setInterp(it.k) })),
                { sep: true, label: '' },
                { label: <>delete {many ? `${many} keyframes` : 'keyframe'}</>, onClick: () => removePoints(many ? sel : new Set([p.id])) },
                { label: <>clear all keyframes</>, onClick: () => removePoints(new Set(pts.map((x) => x.id))) }
              ]
            : [
                { label: <>add keyframe here</>, onClick: () => addPoint(menu.t) },
                ...(pts.length ? [{ label: <>clear all keyframes</>, onClick: () => removePoints(new Set(pts.map((x) => x.id))) } as MenuEntry] : [])
              ]
          return <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} />
        })()}
    </div>
  )
}

// exported for the lane-header keyframe navigator (Timeline): toggle a keyframe at block-local t
export function toggleKeyframeAt(points: VolumePoint[] | undefined, gain: number, t: number, len: number): { points: VolumePoint[]; gain: number } {
  const base = points ?? []
  const hit = base.find((p) => Math.abs(p.at - t) <= 0.05)
  if (hit) return { points: sorted(base.filter((p) => p.id !== hit.id)), gain }
  const at = Math.max(0, Math.min(len, t))
  if (!base.length) return { points: [{ id: mkId(), at, gain: clampG(gain) }], gain: 1 }
  const level = clampG(gain * envGainAt(base, at))
  return { points: sorted([...base, { id: mkId(), at, gain: clampG(level / (gain || 1)) }]), gain }
}
const sorted = (a: VolumePoint[]): VolumePoint[] => [...a].sort((x, y) => x.at - y.at)
