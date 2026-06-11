import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useThumbUrl } from '../Thumbnail'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatImgUrls } from '../lib/beatUtils'
import { effDur, buildSegs, resolveView, sourceDurOf, activeItems, activeTimeline } from '../lib/timelineUtils'
import { useStrip, sampleStrip } from '../lib/filmstrip'
import { MIME_CLIP, MIME_TAKE, MIME_TLITEM } from '../lib/dragDrop'
import { Playhead, TimeReadout } from './shared/playback'

// ---- one timeline block (filmstrip of frames from the clip's take) ----
function TlBlock(props: {
  flex: number
  current: boolean
  dropActive: boolean
  name: string
  durLabel: string
  takeLabel: string
  takes: { id: string; label: string }[]
  currentTakeId?: string
  onPickTake: (takeId: string) => void
  file?: string
  videoFile?: string
  seconds: number
  inSec?: number
  outSec?: number
  beats?: BeatField[]
  beatImgs?: (string | undefined)[]
  trimmable: boolean // C (live recipe) instances aren't trimmable — they always span the recipe duration
  onTrimStart: (side: 'in' | 'out', e: React.MouseEvent) => void
  onClick: () => void
  onDoubleClick: () => void
  onRemove: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  // measure the block; frames show at their TRUE aspect (never stretched) and we pack enough of them
  // to fill the width — so the "gaps" between frames are filled by more frames, not letterboxing.
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      const w = Math.round(r?.width ?? 0)
      const h = Math.round(r?.height ?? 0)
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const showFilmstrip = useStore((s) => s.showFilmstrips)
  const strip = useStrip(props.videoFile, !!props.videoFile && showFilmstrip)
  const aspect = strip?.aspect ?? 16 / 9
  const frameW = size.h * aspect // each frame's on-screen width at the block's height (true aspect)
  const count = size.w > 0 && frameW > 0 ? Math.max(1, Math.min(40, Math.ceil(size.w / frameW))) : 0
  const frames = useMemo(() => sampleStrip(strip, count, props.inSec, props.outSec), [strip, count, props.inSec, props.outSec])
  const fallbackUrl = useThumbUrl(showFilmstrip && !props.videoFile ? props.file : undefined)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <div
      ref={wrapRef}
      className={'vd-clip' + (props.current ? ' sel' : '')}
      style={{
        flex: props.flex,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 44,
        borderLeft: props.dropActive ? '3px solid var(--amber)' : undefined,
        outline: !props.videoFile ? '1px dashed var(--amber-dim)' : undefined,
        outlineOffset: -1
      }}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      title="double-click to edit · drag to reorder"
    >
      {frames.length > 1 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          {frames.map((f, i) => (
            <img key={i} src={f} alt="" style={{ height: '100%', width: 'auto', flex: '0 0 auto', objectFit: 'contain', opacity: 0.6 }} />
          ))}
        </div>
      ) : frames.length === 1 ? (
        <img src={frames[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.6 }} />
      ) : fallbackUrl ? (
        <img src={fallbackUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.55 }} />
      ) : null}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.2))' }} />
      <div style={{ position: 'absolute', top: 3, left: 5, right: 16, fontSize: 10, color: '#fff', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', zIndex: 5 }}>
        {props.name}
      </div>
      <div
        style={{ position: 'absolute', top: 17, left: 5, fontSize: 9, color: 'var(--muted)', cursor: 'pointer', textShadow: '0 1px 2px #000', zIndex: 5 }}
        onClick={(e) => {
          e.stopPropagation()
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
        title="pick this instance's take"
      >
        {props.takeLabel} ▾
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 5, fontSize: 9, color: '#cfcfd6', textShadow: '0 1px 2px #000', zIndex: 5 }}>
        {props.videoFile ? '▶' : '▦'} {props.durLabel}
      </div>
      {props.beats &&
        props.beats.length > 0 &&
        (() => {
          // the in/out trim CLIPS the clip; beats keep their absolute positions and are windowed to [in,out]
          const inS = props.inSec ?? 0
          const winLen = Math.max(0.0001, props.seconds) // effective (trimmed) duration
          const outS = inS + winLen
          const ranges = beatRanges(props.beats)
          const vis: { i: number; name: string; img?: string; left: number; width: number }[] = []
          props.beats.forEach((b, i) => {
            const vs = Math.max(ranges[i].start, inS)
            const ve = Math.min(ranges[i].end, outS)
            if (ve <= vs) return
            vis.push({ i, name: b.name, img: props.beatImgs?.[i], left: ((vs - inS) / winLen) * 100, width: ((ve - vs) / winLen) * 100 })
          })
          return (
            <>
              {/* each visible beat's reference image, over its (clipped) span above the band */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 6, zIndex: 2, pointerEvents: 'none' }}>
                {vis.map((v) =>
                  v.img ? (
                    <div key={v.i} title={v.name} style={{ position: 'absolute', top: 0, bottom: 0, left: `${v.left}%`, width: `${v.width}%`, background: `center/contain no-repeat url("${v.img}")` }} />
                  ) : null
                )}
              </div>
              {/* colored beat bands at the bottom — the cut-structure indicator, clipped to the trim window */}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, zIndex: 4, pointerEvents: 'none' }}>
                {vis.map((v) => (
                  <div key={v.i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${v.left}%`, width: `${v.width}%`, background: BEAT_COLORS[v.i % BEAT_COLORS.length], boxShadow: 'inset -1px 0 0 0 rgba(0,0,0,.45)' }} />
                ))}
              </div>
            </>
          )
        })()}
      <span
        style={{ position: 'absolute', top: 1, right: 4, cursor: 'pointer', color: '#fff', textShadow: '0 1px 2px #000' }}
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
      >
        ✕
      </span>
      {props.trimmable && (
        <>
          <div
            onMouseDown={(e) => props.onTrimStart('in', e)}
            onClick={(e) => e.stopPropagation()}
            title="drag to trim start"
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(90deg, rgba(231,169,60,.55), transparent)' }}
          />
          <div
            onMouseDown={(e) => props.onTrimStart('out', e)}
            onClick={(e) => e.stopPropagation()}
            title="drag to trim end"
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(270deg, rgba(231,169,60,.55), transparent)' }}
          />
        </>
      )}
      {menuPos &&
        createPortal(
          <div onClick={() => setMenuPos(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: menuPos.x, top: menuPos.y, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 96, maxHeight: 220, overflow: 'auto' }}
            >
              {props.takes.length === 0 && <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--dim)' }}>no takes</div>}
              {props.takes.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    props.onPickTake(t.id)
                    setMenuPos(null)
                  }}
                  style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: t.id === props.currentTakeId ? 'var(--amber)' : '#cfcfd6' }}
                >
                  {t.label}
                  {t.id === props.currentTakeId ? ' ✓' : ''}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

// ---- Timeline: ruler/scrubber + track of clip instances + playhead ----
export function TimelinePanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const tlIndex = useStore((s) => s.tlIndex)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const tlLoop = useStore((s) => s.tlLoop)
  const showFilmstrips = useStore((s) => s.showFilmstrips)
  const toggleFilmstrips = useStore((s) => s.toggleFilmstrips)
  const tlPlay = useStore((s) => s.tlPlay)
  const tlPause = useStore((s) => s.tlPause)
  const tlSetIndex = useStore((s) => s.tlSetIndex)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const seek = useStore((s) => s.seek)
  const addToTimeline = useStore((s) => s.addToTimeline)
  const setTimelineItems = useStore((s) => s.setTimelineItems)
  const editTimelineSlot = useStore((s) => s.editTimelineSlot)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const [dragTrim, setDragTrim] = useState<{ index: number; inSec: number; outSec: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const trimming = useRef(false)

  const timeline = activeItems(project)
  // during an edge-trim drag, override the dragged item's in/out LOCALLY (no store write) for live preview
  const viewTimeline = dragTrim
    ? timeline.map((it, i) => (i === dragTrim.index ? { ...it, inSec: dragTrim.inSec, outSec: dragTrim.outSec } : it))
    : timeline
  const clips = project?.clips ?? []
  const clipOf = (clipId: string): Clip | undefined => clips.find((c) => c.id === clipId)
  const eff = (it: TimelineItem): number => effDur(it, clips)
  const nameOf = (clipId: string): string => clipOf(clipId)?.name ?? '?'
  // what an item SHOWS comes from its resolved view: a take's frozen snapshot, or the live recipe (C / storyboard)
  const viewOf = (it: TimelineItem): ReturnType<typeof resolveView> | undefined => {
    const c = clipOf(it.clipId)
    return c ? resolveView(c, it) : undefined
  }
  const beatsOf = (it: TimelineItem): BeatField[] => viewOf(it)?.beats ?? []
  const beatImgsOf = (it: TimelineItem): (string | undefined)[] => {
    const v = viewOf(it)
    if (!v) return []
    return beatImgUrls(v.beats, v.beatFreeform, project?.images ?? [])
  }
  const firstImageOf = (it: TimelineItem): string | undefined => {
    const id = viewOf(it)?.recipe.imageIds?.[0]
    return id ? project?.images.find((i) => i.id === id)?.file : undefined
  }
  const takeFileOf = (it: TimelineItem): string | undefined => viewOf(it)?.take?.file
  const takeLabel = (it: TimelineItem): string => {
    const c = clipOf(it.clipId)
    if (!c) return '?'
    if (it.useRecipe) return 'C · recipe'
    const take = viewOf(it)?.take
    if (!take) return c.takes.length ? 'C · recipe' : 'no take'
    const idx = Math.max(0, c.takes.findIndex((t) => t.id === take.id))
    return `take ${idx + 1}${c.takes.length > 1 ? ' / ' + c.takes.length : ''}`
  }
  // the per-instance picker: C (live recipe) always first, then the real takes
  const takesOf = (clipId: string): { id: string; label: string }[] => [
    { id: 'C', label: 'C — live recipe' },
    ...(clipOf(clipId)?.takes ?? []).map((t, i) => ({ id: t.id, label: `take ${i + 1}` }))
  ]
  const curTakeId = (it: TimelineItem): string | undefined => {
    if (it.useRecipe) return 'C'
    return viewOf(it)?.take?.id ?? (clipOf(it.clipId)?.takes.length ? undefined : 'C')
  }
  const pickTake = (index: number, takeId: string): void =>
    void setTimelineItems(
      timeline.map((x, j) =>
        j === index
          ? takeId === 'C'
            ? // C ignores trims (it tracks the live recipe duration) — clear them so stale values can't linger
              { ...x, takeId: undefined, useRecipe: true, inSec: undefined, outSec: undefined }
            : { ...x, takeId, useRecipe: undefined }
          : x
      )
    )

  const { segs, total } = buildSegs(viewTimeline, clips)

  const step = total <= 12 ? 1 : total <= 40 ? 5 : total <= 120 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(Math.round(t))

  const reorderMove = (from: number, to: number): void => {
    if (from === to || Number.isNaN(from)) return
    const arr = [...timeline]
    const [m] = arr.splice(from, 1)
    arr.splice(from < to ? to - 1 : to, 0, m)
    void setTimelineItems(arr)
  }
  const reorderToEnd = (from: number): void => {
    if (Number.isNaN(from)) return
    const arr = [...timeline]
    const [m] = arr.splice(from, 1)
    arr.push(m)
    void setTimelineItems(arr)
  }
  const onTrackDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropIdx(null)
    // a take dragged from the clip editor → add that clip with the take preset as this instance's default
    const takeData = e.dataTransfer.getData(MIME_TAKE)
    if (takeData) {
      try {
        const o = JSON.parse(takeData) as { clipId?: string; takeId?: string }
        if (o.clipId) void addToTimeline(o.clipId, o.takeId)
      } catch {
        /* ignore */
      }
      return
    }
    const clipId = e.dataTransfer.getData(MIME_CLIP)
    if (clipId) {
      void addToTimeline(clipId)
      return
    }
    const tlIdx = e.dataTransfer.getData(MIME_TLITEM)
    if (tlIdx !== '') reorderToEnd(parseInt(tlIdx, 10))
  }

  const seekFromClientX = (clientX: number): void => {
    const el = wrapRef.current
    if (!el || viewTimeline.length === 0) return
    const r = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const time = frac * total
    let a = 0
    for (let i = 0; i < viewTimeline.length; i++) {
      const d = eff(viewTimeline[i])
      if (time < a + d || i === viewTimeline.length - 1) {
        const offset = Math.max(0, Math.min(d, time - a))
        seek(i, offset, d ? offset / d : 0)
        return
      }
      a += d
    }
  }
  const onScrubDown = (e: React.MouseEvent): void => {
    seekFromClientX(e.clientX)
    const move = (ev: MouseEvent): void => seekFromClientX(ev.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onTrimStart = (index: number, side: 'in' | 'out', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const el = wrapRef.current
    const proj = project
    if (!el || !proj) return
    const startX = e.clientX
    const secPerPx = total / el.getBoundingClientRect().width // captured at drag start (stable)
    const it0 = activeItems(proj)[index]
    const src = sourceDurOf(it0, clips) // the ACTIVE view's length (take's real length, or recipe setting)
    const startIn = it0.inSec ?? 0
    const startOut = Math.min(it0.outSec ?? src, src)
    trimming.current = true
    let final = { inSec: startIn, outSec: startOut }
    const move = (ev: MouseEvent): void => {
      const dSec = (ev.clientX - startX) * secPerPx
      final =
        side === 'in'
          ? { inSec: Math.min(Math.max(0, startIn + dSec), startOut - 0.25), outSec: startOut }
          : { inSec: startIn, outSec: Math.max(Math.min(src, startOut + dSec), startIn + 0.25) }
      setDragTrim({ index, ...final }) // LOCAL preview only — no store write, no app-wide re-render
    }
    const up = (): void => {
      trimming.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void setTimelineItems(
        activeItems(proj).map((x, j) => (j === index ? { ...x, inSec: final.inSec, outSec: final.outSec } : x))
      ).then(() => setDragTrim(null)) // persist once, then drop the local override
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="vd-panel vd-timeline">
      <div className="vd-transport">
        <span onClick={() => tlSetIndex(Math.max(0, tlIndex - 1))}>⏮</span>
        <span className="vd-play" onClick={() => (tlPlaying ? tlPause() : tlPlay())}>{tlPlaying ? '⏸' : '▶'}</span>
        <span onClick={() => tlSetIndex(Math.min(timeline.length - 1, tlIndex + 1))}>⏭</span>
        <span className="vd-loop" style={{ opacity: tlLoop ? 1 : 0.4 }} onClick={toggleLoop}>⟲</span>
        <span
          className="vd-loop"
          style={{ opacity: showFilmstrips ? 1 : 0.4 }}
          onClick={toggleFilmstrips}
          title={showFilmstrips ? 'thumbnails on — click for faster plain blocks' : 'thumbnails off (faster)'}
        >
          🎞
        </span>
        <span className="vd-tc" title="active timeline (double-click it in the Bin to edit name/aspect)">
          ▤ {activeTimeline(project)?.name ?? '—'} · {activeTimeline(project)?.aspectRatio ?? ''}
        </span>
        <span className="vd-tc">{timeline.length} clips</span>
        <TimeReadout segs={segs} total={total} />
      </div>

      <div ref={wrapRef} style={{ position: 'relative' }}>
        <div
          onMouseDown={onScrubDown}
          style={{ position: 'relative', height: 16, borderBottom: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', background: '#0c0c0f' }}
          title="click or drag to scrub"
        >
          {ticks.map((t) => (
            <div
              key={t}
              style={{ position: 'absolute', left: `${(t / total) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--line2)', paddingLeft: 2, fontSize: 8, color: 'var(--dim)' }}
            >
              {t}s
            </div>
          ))}
        </div>

        <div
          className="vd-track"
          onDragOver={(e) => {
            const t = e.dataTransfer.types
            if (t.includes(MIME_CLIP) || t.includes(MIME_TLITEM) || t.includes(MIME_TAKE)) e.preventDefault()
          }}
          onDrop={onTrackDrop}
          style={{ position: 'relative', padding: '4px 0', gap: 0 }}
        >
          {timeline.length === 0 && (
            <span className="vd-sm" style={{ color: 'var(--dim)', alignSelf: 'center', margin: 'auto' }}>drag clips from the Bin here →</span>
          )}
          {viewTimeline.map((it, i) => (
            <TlBlock
              key={`${it.id}-${i}`}
              flex={eff(it)}
              current={i === tlIndex}
              dropActive={dropIdx === i}
              name={nameOf(it.clipId)}
              durLabel={`${Math.round(eff(it) * 100) / 100}s`}
              takeLabel={takeLabel(it)}
              takes={takesOf(it.clipId)}
              currentTakeId={curTakeId(it)}
              onPickTake={(takeId) => pickTake(i, takeId)}
              file={firstImageOf(it)}
              videoFile={takeFileOf(it)}
              seconds={eff(it)}
              inSec={it.inSec}
              outSec={it.outSec}
              beats={beatsOf(it)}
              beatImgs={beatImgsOf(it)}
              trimmable={!it.useRecipe}
              onTrimStart={(side, e) => onTrimStart(i, side, e)}
              onClick={() => tlSetIndex(i)}
              onDoubleClick={() => editTimelineSlot(i, it.clipId)}
              onRemove={() => void setTimelineItems(timeline.filter((_, j) => j !== i))}
              onDragStart={(e) => {
                if (trimming.current) {
                  e.preventDefault()
                  return
                }
                e.dataTransfer.setData(MIME_TLITEM, String(i))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(MIME_TLITEM)) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropIdx(i)
                }
              }}
              onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
              onDrop={(e) => {
                const f = e.dataTransfer.getData(MIME_TLITEM)
                if (f !== '') {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropIdx(null)
                  reorderMove(parseInt(f, 10), i)
                }
              }}
            />
          ))}
        </div>

        {timeline.length > 0 && <Playhead segs={segs} total={total} />}
      </div>

      <p className="vd-hint">Click/drag the ruler to scrub · drag blocks to reorder · click `take N` to switch · double-click to edit.</p>
    </div>
  )
}
