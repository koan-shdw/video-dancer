import { useStore } from '../../store'
import { smpte } from '../../lib/time'
import type { Seg } from '../../lib/timelineUtils'

// playhead lives in its own component so ONLY it re-renders on the per-frame tlTime updates,
// not the whole TimelinePanel + every TlBlock (that was the playback lag)
export function Playhead({ total }: { segs?: Seg[]; total: number }): React.JSX.Element | null {
  const tlTime = useStore((s) => s.tlTime)
  if (total <= 0) return null
  const pct = Math.min(100, (tlTime / total) * 100)
  return (
    <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--amber)', left: `${pct}%`, pointerEvents: 'none', zIndex: 5 }} />
  )
}

// live sequence timecode (current / total) — its OWN per-frame subscriber so the parent panel doesn't re-render
export function TimeReadout({ total, style }: { segs?: Seg[]; total: number; style?: React.CSSProperties }): React.JSX.Element {
  const tlTime = useStore((s) => s.tlTime)
  return (
    <span className="vd-tc" style={{ fontFamily: 'var(--mono)', ...style }}>
      {/* total rides at .85em so current/total keep the Clip Monitor's 13/11 ratio everywhere */}
      {smpte(Math.min(tlTime, total))} <span style={{ color: 'var(--dim)', fontSize: '.85em' }}>/ {smpte(total)}</span>
    </span>
  )
}
