import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useThumbUrl } from '../Thumbnail'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatImgUrls } from '../lib/beatUtils'
import { effDur, buildSegs, resolveView, sourceDurOf, activeItems, activeTimeline } from '../lib/timelineUtils'
import { useStrip, sampleStrip } from '../lib/filmstrip'
import { mediaUrl } from '../media'
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
  sliceMode: boolean // the slice tool is armed → clicks cut instead of select
  canSlice: boolean // only clips backed by a real take video can be sliced
  playheadFrac?: number // where the scrubber sits across THIS block (0..1) — slice snaps to it
  scrubSrc?: string // while trimming THIS block: a seekable <video> url showing the dragged-edge frame
  scrubTime?: number // source-seconds to seek that <video> to
  onSlice: (frac: number) => void
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
  const scrubVidRef = useRef<HTMLVideoElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null) // slice-guide x within the block
  const [hoverSnapped, setHoverSnapped] = useState(false) // the guide is locked onto the scrubber
  const SNAP_PX = 10
  // snap the cut to the scrubber when the mouse is within SNAP_PX of it
  const snapX = (x: number, width: number): number => {
    if (props.playheadFrac != null && width > 0) {
      const px = props.playheadFrac * width
      if (Math.abs(x - px) <= SNAP_PX) return px
    }
    return x
  }
  // seek the scrub <video> to the exact playhead frame (only mounted for the current, paused block)
  useEffect(() => {
    const v = scrubVidRef.current
    if (v && props.scrubTime != null && isFinite(props.scrubTime)) {
      try {
        v.currentTime = props.scrubTime
      } catch {
        /* not seekable yet — onLoadedMetadata will catch it */
      }
    }
  }, [props.scrubTime, props.scrubSrc])
  const handleClick = (e: React.MouseEvent): void => {
    if (props.sliceMode) {
      if (!props.canSlice) return
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = snapX(e.clientX - r.left, r.width) // snap the cut to the scrubber if near
      const frac = Math.min(0.999, Math.max(0.001, x / r.width))
      e.stopPropagation() // don't let the track's "click empty → exit slice" fire
      props.onSlice(frac)
      return
    }
    props.onClick()
  }
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
        outlineOffset: -1,
        cursor: props.sliceMode ? (props.canSlice ? 'crosshair' : 'not-allowed') : undefined
      }}
      draggable={!props.sliceMode}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onClick={handleClick}
      onDoubleClick={() => {
        if (props.sliceMode) return
        props.onDoubleClick()
      }}
      onMouseMove={(e) => {
        if (!props.sliceMode || !props.canSlice) return
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const raw = e.clientX - r.left
        const sx = snapX(raw, r.width)
        setHoverX(sx)
        setHoverSnapped(sx !== raw)
      }}
      onMouseLeave={() => {
        setHoverX(null)
        setHoverSnapped(false)
      }}
      title={props.sliceMode ? (props.canSlice ? 'click to cut here' : 'no take to cut (render first)') : 'double-click to edit · drag to reorder'}
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
      {props.scrubSrc && (
        // while trimming this block: the frame at the dragged edge, seeked live (covers the filmstrip)
        <video
          ref={scrubVidRef}
          src={props.scrubSrc}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            if (props.scrubTime != null && isFinite(props.scrubTime))
              try {
                e.currentTarget.currentTime = props.scrubTime
              } catch {
                /* ignore */
              }
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1, pointerEvents: 'none', background: '#000' }}
        />
      )}
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
      {props.sliceMode && props.canSlice && hoverX != null && (
        // the cut guide that follows the mouse while the slice tool is armed (amber = snapped to the scrubber)
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: hoverX,
            width: hoverSnapped ? 3 : 2,
            marginLeft: hoverSnapped ? -1.5 : -1,
            background: hoverSnapped ? 'var(--amber)' : '#ff5a5a',
            boxShadow: `0 0 4px ${hoverSnapped ? 'var(--amber)' : '#ff5a5a'}`,
            zIndex: 9,
            pointerEvents: 'none'
          }}
        />
      )}
      {props.trimmable && !props.sliceMode && (
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
  const tlProgress = useStore((s) => s.tlProgress)
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
  const [dragTrim, setDragTrim] = useState<{ index: number; inSec: number; outSec: number; side: 'in' | 'out' } | null>(null)
  const [sliceMode, setSliceMode] = useState(false) // razor armed: clicking a clip cuts it; stays on for multiple cuts
  const wrapRef = useRef<HTMLDivElement>(null)
  const trimming = useRef(false)

  // S toggles the slice tool (when not typing); Esc disarms it
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 's' || e.key === 'S') setSliceMode((v) => !v)
      else if (e.key === 'Escape') setSliceMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    // snap target: the scrubber's source-frame, captured now (only when the playhead is in THIS clip)
    const playSrc = index === tlIndex ? startIn + tlProgress * (startOut - startIn) : null
    const snapSec = 10 * secPerPx
    let final = { inSec: startIn, outSec: startOut }
    const move = (ev: MouseEvent): void => {
      const dSec = (ev.clientX - startX) * secPerPx
      let f =
        side === 'in'
          ? { inSec: Math.min(Math.max(0, startIn + dSec), startOut - 0.25), outSec: startOut }
          : { inSec: startIn, outSec: Math.max(Math.min(src, startOut + dSec), startIn + 0.25) }
      if (playSrc != null) {
        if (side === 'in' && Math.abs(f.inSec - playSrc) < snapSec) f = { inSec: Math.min(playSrc, startOut - 0.25), outSec: startOut }
        else if (side === 'out' && Math.abs(f.outSec - playSrc) < snapSec) f = { inSec: startIn, outSec: Math.max(playSrc, startIn + 0.25) }
      }
      final = f
      setDragTrim({ index, side, ...final }) // LOCAL preview only — no store write, no app-wide re-render
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

  // cut the clicked clip at frac (0..1 of its visible width) into two contiguous instances — stays armed
  const sliceAt = (index: number, frac: number): void => {
    const it = timeline[index]
    if (!it) return
    const src = sourceDurOf(it, clips)
    const inS = it.inSec ?? 0
    const outS = Math.min(it.outSec ?? src, src)
    const cut = inS + frac * Math.max(0, outS - inS)
    if (cut - inS < 0.15 || outS - cut < 0.15) return // too thin to be a real cut
    const left = { ...it, outSec: cut }
    const right = { ...it, id: crypto.randomUUID(), inSec: cut }
    const arr = [...timeline]
    arr.splice(index, 1, left, right)
    void setTimelineItems(arr)
    setSliceMode(false) // one-shot: disarm after a single cut
  }
  // live-seeked frame, ONLY while trimming a block (its dragged edge). Scrubbing the playhead does
  // NOT change the thumbs — blocks keep their static filmstrip thumb.
  const scrubFor = (it: TimelineItem, i: number): { src?: string; time?: number } => {
    if (!showFilmstrips || !dragTrim || dragTrim.index !== i) return {}
    const vf = takeFileOf(it)
    if (!vf) return {}
    const src = sourceDurOf(it, clips)
    const t = dragTrim.side === 'in' ? dragTrim.inSec : dragTrim.outSec
    return { src: mediaUrl(vf), time: Math.min(Math.max(0, t), src) }
  }

  return (
    <div
      className="vd-panel vd-timeline"
      onContextMenu={(e) => {
        if (sliceMode) {
          e.preventDefault()
          setSliceMode(false)
        }
      }}
    >
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
        <span
          className="vd-loop"
          style={{ opacity: sliceMode ? 1 : 0.5, color: sliceMode ? '#ff5a5a' : undefined }}
          onClick={() => setSliceMode((v) => !v)}
          title="slice tool (S) — click a clip to cut it at that frame (turns off after one cut); Esc / right-click to cancel"
        >
          ✂
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
          onClick={(e) => {
            if (sliceMode && e.target === e.currentTarget) setSliceMode(false) // clicked empty track → exit slice
          }}
          style={{ position: 'relative', padding: '4px 0', gap: 0 }}
        >
          {timeline.length === 0 && (
            <span className="vd-sm" style={{ color: 'var(--dim)', alignSelf: 'center', margin: 'auto' }}>drag clips from the Bin here →</span>
          )}
          {viewTimeline.map((it, i) => {
            const sf = scrubFor(it, i)
            return (
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
              sliceMode={sliceMode}
              canSlice={!!takeFileOf(it)}
              playheadFrac={i === tlIndex ? tlProgress : undefined}
              onSlice={(frac) => sliceAt(i, frac)}
              scrubSrc={sf.src}
              scrubTime={sf.time}
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
            )
          })}
        </div>

        {timeline.length > 0 && <Playhead segs={segs} total={total} />}
      </div>

      <p className="vd-hint">
        {sliceMode
          ? '✂ slice armed — click a clip to cut it (snaps to the scrubber) · turns off after one cut · Esc / right-click to cancel'
          : 'Click/drag the ruler to scrub · drag blocks to reorder · trims snap to the scrubber · ✂ or S to slice · double-click to edit.'}
      </p>
    </div>
  )
}
