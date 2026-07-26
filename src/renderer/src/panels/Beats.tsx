import { useEffect, useRef, useState } from 'react'
import { BEAT_COLORS, MIN_BEAT, beatRanges, newBeat } from '../emitYaml'
import { mediaUrl } from '../media'
import { useStore } from '../store'
import { ctl as ctlBase } from '../ui/controls'
import { MIME_IMAGES } from '../lib/dragDrop'
import { MentionArea } from './shared/MentionInput'
import { ContextMenu } from '../ui/ContextMenu'
import { Ic, Trash2 } from '../ui/icons'

const ctl: React.CSSProperties = { ...ctlBase, width: '100%' }

// STABLE empty fallback — `?? []` inside a store selector mints a fresh array per snapshot read
// while project is null, which loops React's store sync to "maximum update depth"
const NO_IMAGES: ProjImage[] = []

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
  const [imgOver, setImgOver] = useState(false) // a Library-image drag is over the bar
  const [beatMenu, setBeatMenu] = useState<{ x: number; y: number; i: number } | null>(null) // right-clicked beat
  const [graphicPick, setGraphicPick] = useState(false) // the beat-graphic Library dropdown
  const [graphicOver, setGraphicOver] = useState(false) // an image drag is over the graphic frame
  const libImages = useStore((s) => s.project?.images ?? NO_IMAGES)
  const autoTime = useStore((s) => s.autoTime)
  const toggleAutoTime = useStore((s) => s.toggleAutoTime)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sel > beats.length - 1) setSel(Math.max(0, beats.length - 1))
  }, [beats.length, sel])
  useEffect(() => setGraphicPick(false), [sel]) // the graphic dropdown belongs to the previous beat

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
  // Library image(s) dropped on the bar → one beat each (selection order): the image becomes the
  // beat's PLACEHOLDER GRAPHIC (display-only — no @mention, the model stays free) and, in Clip
  // Gen, the parent's onChange joins it to the clip's refs so the model still receives it
  const addImageBeats = (ids: string[]): void => {
    const images = useStore.getState().project?.images ?? []
    const fresh = ids
      .map((id) => images.find((i) => i.id === id))
      .filter((x): x is ProjImage => !!x)
      .map((im) => ({ ...newBeat(), name: im.title.replace(/^@/, ''), refImageId: im.id }))
    if (fresh.length === 0) return
    const next = [...beats, ...fresh]
    onChange(autoTime ? fitArr(next, dur) : next)
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
    <div
      className="field"
      tabIndex={-1} // clicking anywhere in the beats area focuses it → Delete removes the BEAT…
      onKeyDown={(e) => {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return // …but typing keeps editing text
        if ((e.key === 'Delete' || e.key === 'Backspace') && beats.length > 0) {
          e.preventDefault()
          e.stopPropagation() // consumed here — the global handler must NOT delete the timeline block
          removeBeat(sel)
        }
      }}
      style={{ outline: 'none' }}
    >
      <div className="lb" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>beats</span>
        <span style={{ color: over ? 'var(--bad)' : 'var(--dim)' }}>
          {beats.length} · {Math.round(sum * 100) / 100}/{dur}s
        </span>
        <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={addBeat} title="add a beat">
          ＋ beat
        </span>
        {showAutoTime && (
          <span
            className="btn vd-hbtn"
            style={{ opacity: autoTime ? 1 : 0.45 }}
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
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes(MIME_IMAGES)) {
            e.preventDefault()
            e.stopPropagation()
            setImgOver(true)
          }
        }}
        onDragLeave={() => setImgOver(false)}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(MIME_IMAGES)
          if (!raw) return // not an image drop (beat reorder handles itself) → let it bubble
          e.preventDefault()
          e.stopPropagation()
          setImgOver(false)
          try {
            const ids = JSON.parse(raw) as string[]
            if (Array.isArray(ids) && ids.length) addImageBeats(ids)
          } catch {
            /* ignore malformed payloads */
          }
        }}
        title="＋ beat adds · drag Library images here — one beat each"
        style={{
          position: 'relative',
          display: 'flex',
          height: 40,
          borderRadius: 5,
          overflow: 'hidden',
          background: 'var(--raised)',
          border: '1px dashed ' + (imgOver ? 'var(--amber)' : over ? 'var(--bad)' : 'var(--line2)')
        }}
      >
        {beats.length === 0 && <span style={{ margin: 'auto', color: 'var(--dim)', fontSize: 10 }}>no beats — ＋ to add, or drag Library images here</span>}
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
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSel(i)
              setBeatMenu({ x: e.clientX, y: e.clientY, i })
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
        {/* leftover-time remainder — purely visual (the bar no longer adds beats on click) */}
        {beats.length > 0 && tailPct > 0.5 && <div style={{ width: `${tailPct}%`, background: 'var(--panel)' }} />}
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

      {beatMenu && (
        <ContextMenu
          x={beatMenu.x}
          y={beatMenu.y}
          entries={[
            {
              label: <><Ic i={Trash2} size={12} /> delete beat {beatMenu.i + 1}{beats[beatMenu.i]?.name ? ` — ${beats[beatMenu.i].name}` : ''}</>,
              danger: true,
              onClick: () => removeBeat(beatMenu.i)
            }
          ]}
          onClose={() => setBeatMenu(null)}
        />
      )}

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
              {/* storyboard frame: the MANUAL placeholder graphic (display-only — never in the
                  prompt, so the model keeps the ref loose), else the auto @ref pick */}
              <div style={{ marginBottom: 6 }}>
                <div className="lb" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{beat.refImageId ? 'graphic (manual placeholder — display only, not in the prompt)' : 'reference (auto, from @ref)'}</span>
                  <span style={{ marginLeft: 'auto', position: 'relative' }}>
                    <span className="btn vd-hbtn" onClick={() => setGraphicPick((v) => !v)} title="set this beat's storyboard graphic by hand — shows here and on the timeline, but is NOT written into the prompt (drag a Library image onto the frame works too)">
                      {beat.refImageId ? 'change' : 'set graphic'}
                    </span>
                    {graphicPick && (
                      <span style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 220, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, display: 'block' }}>
                        {libImages.length === 0 && <span style={{ display: 'block', padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no Library images yet</span>}
                        {libImages.map((im) => (
                          <span
                            key={im.id}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setBeat(sel, { refImageId: im.id })
                              setGraphicPick(false)
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}
                          >
                            <img src={mediaUrl(im.file)} alt="" style={{ width: 34, height: 22, objectFit: 'cover', borderRadius: 2, flex: '0 0 auto' }} />
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.title}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {beat.refImageId && (
                    <span className="btn vd-hbtn" onClick={() => setBeat(sel, { refImageId: undefined })} title="clear the manual graphic — back to the auto @ref pick">
                      ✕
                    </span>
                  )}
                </div>
                <div
                  onDragOver={(e) => {
                    if (Array.from(e.dataTransfer.types).includes(MIME_IMAGES)) {
                      e.preventDefault()
                      e.stopPropagation()
                      setGraphicOver(true)
                    }
                  }}
                  onDragLeave={() => setGraphicOver(false)}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData(MIME_IMAGES)
                    setGraphicOver(false)
                    if (!raw) return
                    e.preventDefault()
                    e.stopPropagation()
                    try {
                      const ids = JSON.parse(raw) as string[]
                      if (Array.isArray(ids) && ids[0]) setBeat(sel, { refImageId: ids[0] })
                    } catch {
                      /* ignore malformed payloads */
                    }
                  }}
                  style={{ display: 'inline-block', borderRadius: 4, outline: graphicOver ? '2px dashed var(--amber)' : 'none', outlineOffset: 2 }}
                >
                  {refImageUrl?.(beat) ? (
                    <img src={refImageUrl(beat)} alt="" style={{ width: 96, height: 56, objectFit: 'contain', background: '#000', borderRadius: 4, border: '1px solid ' + (beat.refImageId ? 'var(--amber-dim)' : 'var(--line2)'), display: 'block' }} />
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 96, height: 56, borderRadius: 4, border: '1px dashed var(--line2)', color: 'var(--dim)', fontSize: 9, textAlign: 'center' }}>
                      drop an image here
                    </span>
                  )}
                </div>
              </div>
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
