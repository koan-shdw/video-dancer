import { useEffect, useRef, useState } from 'react'
import { BEAT_COLORS, MIN_BEAT, beatRanges, newBeat } from '../emitYaml'
import { useStore } from '../store'
import { ctl as ctlBase } from '../ui/controls'
import { MentionArea } from './shared/MentionInput'

const ctl: React.CSSProperties = { ...ctlBase, width: '100%' }

// proportionally scale beat lengths so they sum EXACTLY to `d` (last beat absorbs the rounding remainder)
export function fitArr(arr: BeatField[], d: number): BeatField[] {
  const s = arr.reduce((a, b) => a + (b.length || 0), 0)
  if (s <= 0 || d <= 0) return arr
  let acc = 0
  return arr.map((b, i) => {
    if (i === arr.length - 1) return { ...b, length: Math.round((d - acc) * 100) / 100 }
    const len = Math.round(((b.length || 0) / s) * d * 100) / 100
    acc += len
    return { ...b, length: len }
  })
}

// beats as an always-present proportional timeline — click empty to add, drag boundaries to resize,
// double-click a segment to open its fields. autofit keeps lengths summing to the clip duration.
export function Beats({
  beats,
  duration,
  onChange,
  refImageUrl,
  titles = [],
  playheadRef,
  showAutoTime = true
}: {
  beats: BeatField[]
  duration: number
  onChange: (beats: BeatField[]) => void
  refImageUrl?: (beat: BeatField) => string | undefined
  titles?: string[]
  playheadRef?: React.Ref<HTMLDivElement> // optional playback scrubber line, positioned imperatively by the parent
  showAutoTime?: boolean // the auto-time toggle (shown in the Clip Editor, hidden in the Clip Monitor)
}): React.JSX.Element {
  const [sel, setSel] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [dropBeat, setDropBeat] = useState<number | null>(null)
  const autoTime = useStore((s) => s.autoTime)
  const toggleAutoTime = useStore((s) => s.toggleAutoTime)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sel > beats.length - 1) setSel(Math.max(0, beats.length - 1))
  }, [beats.length, sel])

  const sum = beats.reduce((s, b) => s + (b.length || 0), 0)
  const dur = duration > 0 ? duration : sum > 0 ? sum : 5
  const ranges = beatRanges(beats)
  const tailPct = Math.max(0, ((dur - sum) / dur) * 100)
  const over = sum > dur + 0.01
  const tc = (n: number): string => `${Math.round(n * 100) / 100}s`

  // AUTO TIME: keep beats proportionally summing to the clip duration — fixes any mismatch (on load,
  // on duration change, on a loaded bad clip) by rescaling each beat by its % share.
  useEffect(() => {
    if (!autoTime || beats.length === 0 || dur <= 0) return
    if (Math.abs(sum - dur) > 0.05) onChange(fitArr(beats, dur))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sum, dur, autoTime])

  const setBeat = (i: number, patch: Partial<BeatField>): void => onChange(beats.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  // set a beat's length; with auto-time on, keep this beat exact and rebalance the OTHERS to fill the duration
  const setLength = (i: number, len: number): void => {
    if (!autoTime || beats.length <= 1) {
      setBeat(i, { length: len })
      return
    }
    const otherSum = beats.reduce((a, b, j) => (j === i ? a : a + (b.length || 0)), 0)
    const remain = Math.max(0, dur - len)
    onChange(
      beats.map((b, j) => {
        if (j === i) return { ...b, length: len }
        const share = otherSum > 0 ? (b.length || 0) / otherSum : 1 / (beats.length - 1)
        return { ...b, length: Math.round(share * remain * 100) / 100 }
      })
    )
  }
  const addBeat = (): void => {
    const next = [...beats, newBeat()]
    onChange(autoTime ? fitArr(next, dur) : next) // first beat → 100%; further adds re-fit
    setSel(next.length - 1)
  }
  const removeBeat = (i: number): void => {
    const next = beats.filter((_, j) => j !== i)
    onChange(autoTime ? fitArr(next, dur) : next)
    setSel((s) => Math.max(0, Math.min(s, next.length - 1)))
  }
  // drag a beat to a new position (lengths unchanged → each beat's start/end timecode shifts to suit)
  const reorderBeat = (from: number, to: number): void => {
    if (from === to || Number.isNaN(from)) return
    const arr = [...beats]
    const [m] = arr.splice(from, 1)
    const insert = from < to ? to - 1 : to
    arr.splice(insert, 0, m)
    onChange(arr)
    setSel(insert)
  }

  // drag a boundary between beat idx and idx+1 → redistribute their lengths (pair total constant)
  const onBoundaryDown = (idx: number, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    if (!bar || idx < 0 || idx >= beats.length - 1) return
    const preCum = ranges[idx].start
    const pairTotal = (beats[idx].length || 0) + (beats[idx + 1].length || 0)
    if (pairTotal < 2 * MIN_BEAT) return
    const move = (ev: MouseEvent): void => {
      const r = bar.getBoundingClientRect()
      const t = Math.max(0, Math.min(dur, ((ev.clientX - r.left) / r.width) * dur))
      let left = Math.round((t - preCum) * 4) / 4
      left = Math.max(MIN_BEAT, Math.min(pairTotal - MIN_BEAT, left))
      const right = pairTotal - left
      onChange(beats.map((b, j) => (j === idx ? { ...b, length: left } : j === idx + 1 ? { ...b, length: right } : b)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const beat = beats[sel]
  const camWords = beat ? beat.camera.trim().split(/\s+/).filter(Boolean).length : 0

  return (
    <div className="field">
      <div className="lb" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>beats</span>
        <span style={{ color: over ? 'var(--bad)' : 'var(--dim)' }}>
          {beats.length} · {Math.round(sum * 100) / 100}/{dur}s
        </span>
        {showAutoTime && (
          <span
            className="btn vd-hbtn"
            style={{ marginLeft: 'auto', opacity: autoTime ? 1 : 0.45 }}
            onClick={toggleAutoTime}
            title="auto-time: keep beats filling 100% of the clip duration (each keeps its % share)"
          >
            ↻ auto time {autoTime ? 'on' : 'off'}
          </span>
        )}
      </div>

      {/* always-present beats timeline — click empty space to add a beat; dbl-click a segment to edit it */}
      <div
        ref={barRef}
        onClick={addBeat}
        title={beats.length === 0 ? 'click to add the first beat' : 'click empty space to add a beat'}
        style={{
          position: 'relative',
          display: 'flex',
          height: 40,
          borderRadius: 5,
          overflow: 'hidden',
          background: 'var(--raised)',
          border: '1px dashed ' + (over ? 'var(--bad)' : 'var(--line2)'),
          cursor: 'pointer'
        }}
      >
        {beats.length === 0 && <span style={{ margin: 'auto', color: 'var(--dim)', fontSize: 10 }}>click to add a beat</span>}
        {beats.map((b, i) => (
          <div
            key={i}
            draggable
            onClick={(e) => {
              e.stopPropagation()
              setSel(i)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setSel(i)
              setEditorOpen(true)
            }}
            onDragStart={(e) => {
              e.stopPropagation()
              e.dataTransfer.setData('application/x-vd-beat', String(i))
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes('application/x-vd-beat')) {
                e.preventDefault()
                e.stopPropagation()
                setDropBeat(i)
              }
            }}
            onDragLeave={() => setDropBeat((d) => (d === i ? null : d))}
            onDrop={(e) => {
              const f = e.dataTransfer.getData('application/x-vd-beat')
              if (f === '') return
              e.preventDefault()
              e.stopPropagation()
              setDropBeat(null)
              reorderBeat(parseInt(f, 10), i)
            }}
            title={b.name}
            style={{
              width: `${((b.length || 0) / dur) * 100}%`,
              minWidth: 0,
              background: BEAT_COLORS[i % BEAT_COLORS.length],
              boxShadow: dropBeat === i ? 'inset 3px 0 0 0 var(--amber)' : i === sel ? 'inset 0 0 0 2px #fff' : undefined,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              overflow: 'hidden',
              color: '#fff'
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', padding: '0 2px' }}>
              {b.name || '—'}
            </span>
            <span style={{ fontSize: 8, opacity: 0.85 }}>⏱{Math.round((b.length || 0) * 100) / 100}s</span>
          </div>
        ))}
        {beats.length > 0 && tailPct > 0.5 && (
          <div style={{ width: `${tailPct}%`, background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: 9 }}>
            + add
          </div>
        )}
        {beats.slice(0, -1).map((_, i) => (
          <div
            key={'h' + i}
            onMouseDown={(e) => onBoundaryDown(i, e)}
            onClick={(e) => e.stopPropagation()}
            title="drag to resize"
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${(ranges[i].end / dur) * 100}%`, width: 8, marginLeft: -4, cursor: 'ew-resize', zIndex: 3 }}
          />
        ))}
        {/* playback scrubber line — `left` is set imperatively by the parent (NEVER here, so re-renders don't reset it) */}
        {playheadRef && (
          <div
            ref={playheadRef}
            style={{ position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, background: '#fff', boxShadow: '0 0 4px rgba(0,0,0,.8)', pointerEvents: 'none', zIndex: 6 }}
          />
        )}
      </div>

      {beat && (
        <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 5, padding: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span onClick={() => setEditorOpen((o) => !o)} style={{ cursor: 'pointer', color: 'var(--muted)' }} title="collapse / expand the beat's fields">
              {editorOpen ? '▾' : '▸'}
            </span>
            <input value={beat.name} onChange={(e) => setBeat(sel, { name: e.target.value })} placeholder="beat name" style={{ ...ctl, flex: 1 }} />
            <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{tc(ranges[sel]?.start ?? 0)}</span>
            <input
              type="number"
              step="0.25"
              min="0"
              value={beat.length}
              onChange={(e) => setLength(sel, parseFloat(e.target.value) || 0)}
              title="length (seconds)"
              style={{ ...ctl, width: 58 }}
            />
            <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{tc(ranges[sel]?.end ?? 0)}</span>
            <span className="btn vd-hbtn" onClick={addBeat} title="add a beat">＋</span>
            <span className="btn vd-hbtn" onClick={() => removeBeat(sel)} title="remove this beat">✕</span>
          </div>
          {editorOpen && (
            <div style={{ marginTop: 8 }}>
              {refImageUrl?.(beat) && (
                <div style={{ marginBottom: 6 }}>
                  <div className="lb">reference (auto, from @ref)</div>
                  <img src={refImageUrl(beat)} alt="" style={{ width: 96, height: 56, objectFit: 'contain', background: '#000', borderRadius: 4, border: '1px solid var(--line2)' }} />
                </div>
              )}
              <div className="lb">
                camera <span style={{ color: camWords > 20 ? 'var(--bad)' : 'var(--dim)' }}>{camWords}/20</span>
              </div>
              <MentionArea value={beat.camera} onChange={(v) => setBeat(sel, { camera: v })} titles={titles} rows={2} />
              <div className="lb" style={{ marginTop: 6 }}>action</div>
              <MentionArea value={beat.action} onChange={(v) => setBeat(sel, { action: v })} titles={titles} rows={2} />
              <div className="lb" style={{ marginTop: 6 }}>lighting</div>
              <MentionArea value={beat.lighting} onChange={(v) => setBeat(sel, { lighting: v })} titles={titles} rows={2} />
              {(['dialogue', 'vfx', 'reaction', 'sfx'] as const).map((k) => (
                <div key={k}>
                  <div className="lb" style={{ marginTop: 6 }}>{k}</div>
                  <input value={beat[k] ?? ''} onChange={(e) => setBeat(sel, { [k]: e.target.value } as Partial<BeatField>)} style={ctl} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
