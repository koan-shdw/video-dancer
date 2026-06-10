import { useStore } from '../../store'
import { smpte } from '../../lib/time'
import type { Seg } from '../../lib/timelineUtils'

// playhead lives in its own component so ONLY it re-renders on the per-frame tlProgress updates,
// not the whole TimelinePanel + every TlBlock (that was the playback lag)
export function Playhead({ segs, total }: { segs: Seg[]; total: number }): React.JSX.Element | null {
  const tlIndex = useStore((s) => s.tlIndex)
  const tlProgress = useStore((s) => s.tlProgress)
  if (segs.length === 0) return null
  const seg = segs[Math.min(tlIndex, segs.length - 1)] ?? { start: 0, dur: 0 }
  const pct = Math.min(100, ((seg.start + tlProgress * seg.dur) / total) * 100)
  return (
    <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--amber)', left: `${pct}%`, pointerEvents: 'none', zIndex: 5 }} />
  )
}

// live sequence timecode (current / total) — its OWN per-frame subscriber so the parent panel doesn't re-render
export function TimeReadout({ segs, total, style }: { segs: Seg[]; total: number; style?: React.CSSProperties }): React.JSX.Element {
  const tlIndex = useStore((s) => s.tlIndex)
  const tlProgress = useStore((s) => s.tlProgress)
  const seg = segs[Math.min(tlIndex, segs.length - 1)] ?? { start: 0, dur: 0 }
  const cur = segs.length ? seg.start + tlProgress * seg.dur : 0
  return (
    <span className="vd-tc" style={{ fontFamily: 'var(--mono)', ...style }}>
      {smpte(cur)} <span style={{ color: 'var(--dim)' }}>/ {smpte(total)}</span>
    </span>
  )
}
