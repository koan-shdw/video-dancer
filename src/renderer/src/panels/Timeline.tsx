import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useThumbUrl } from '../Thumbnail'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatImgUrls } from '../lib/beatUtils'
import { effDur, buildSegs, resolveView, resolveTake, sourceDurOf, activeItems, activeTimeline, audioStartOf, startOf, trackOf, timelineEnd, itemAt, sourceTimeAt, clampShiftLeft, audioEndOf, nextOnTrackStart, tailEndOf } from '../lib/timelineUtils'
import { useStrip, sampleStrip } from '../lib/filmstrip'
import { useWave, peakAmp } from '../lib/waveform'
import { mediaUrl } from '../media'
import { MIME_CLIP, MIME_CLIPS, MIME_IMAGES, MIME_TAKE, MIME_TLITEM, MIME_AUDIO, MIME_SCORE, MIME_VIDEO, MIME_VEDITNODE } from '../lib/dragDrop'
import { raiseTimelineMonitor, openVideoEditor, openClipMonitor, openEffectsPanel, openScoreCard } from '../panelBus'
import { hasFx2, readFx2 } from '../fx/fxData'
import { Ic, Play, Pause, Pencil, SkipBack, SkipForward, Repeat, Film, Scissors, Magnet, Music, Volume2, VolumeX, Upload, ZoomIn, ZoomOut, ImageDown, Wand2, Trash2, Monitor as MonitorIcon } from '../ui/icons'
import { toast } from '../ui/Toast'
import { textPrompt } from '../prompt'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'
import { VolumeBand } from '../ui/VolumeBand'
import { resolveAudioSource } from '../../../shared/audioSource'
import { addDynamicStillFor } from '../lib/dynamicStill'
import { smpte, smpteFrames, TC_FPS } from '../lib/time'
import { Playhead, TimeReadout } from './shared/playback'

// ---- one timeline block (filmstrip of frames from the clip's take) ----
function TlBlock(props: {
  flex: number
  current: boolean // the playhead is inside this block
  selected: boolean // click-selected (Del removes) — the amber ring
  dropActive: boolean
  name: string
  durLabel: string
  takeLabel: string
  takes: { id: string; label: string }[]
  currentTakeId?: string
  onPickTake: (takeId: string) => void
  muted: boolean // this instance's clip audio is muted
  onToggleMute: () => void
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
  snapFracs?: number[] // music beat ticks crossing THIS block (0..1) — slice snaps to them too
  scrubSrc?: string // while trimming THIS block: a seekable <video> url showing the dragged-edge frame
  scrubTime?: number // source-seconds to seek that <video> to
  onSlice: (frac: number) => void
  onTrimStart: (side: 'in' | 'out', e: React.MouseEvent) => void
  onClick: () => void
  onDoubleClick: () => void
  onRemove: () => void
  onEditVideo?: () => void // ⑂ — fork this instance's take into a Clip Edit draft (v2v)
  contextEntries?: MenuEntry[] // right-click menu (frame stills / edit / remove) — built per-instance by the parent
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrubVidRef = useRef<HTMLVideoElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null) // slice-guide x within the block
  const [snapKind, setSnapKind] = useState<'none' | 'play' | 'beat'>('none') // what the guide locked onto
  const SNAP_PX = 10
  // snap the cut to the nearest target within SNAP_PX: the scrubber, or a music beat tick
  const snapX = (x: number, width: number): { x: number; kind: 'none' | 'play' | 'beat' } => {
    if (width <= 0) return { x, kind: 'none' }
    let best: { x: number; kind: 'play' | 'beat'; d: number } | null = null
    if (props.playheadFrac != null) {
      const px = props.playheadFrac * width
      const d = Math.abs(x - px)
      if (d <= SNAP_PX) best = { x: px, kind: 'play', d }
    }
    for (const f of props.snapFracs ?? []) {
      const px = f * width
      const d = Math.abs(x - px)
      if (d <= SNAP_PX && (!best || d < best.d)) best = { x: px, kind: 'beat', d }
    }
    return best ? { x: best.x, kind: best.kind } : { x, kind: 'none' }
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
      const s = snapX(e.clientX - r.left, r.width) // snap the cut to the scrubber / a beat tick if near
      const frac = Math.min(0.999, Math.max(0.001, s.x / r.width))
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
    // DEBOUNCED: committing size per observer tick re-rendered every block per wiggle of a
    // divider drag / maximize — hundreds of <img> remounts, each re-decoding its jpeg = the
    // 2-3s freeze. Strips hold their last layout (clipped by overflow) and repaint at rest.
    let t = 0
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      const w = Math.round(r?.width ?? 0)
      const h = Math.round(r?.height ?? 0)
      window.clearTimeout(t)
      t = window.setTimeout(() => setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h })), 120)
    })
    ro.observe(el)
    return () => {
      window.clearTimeout(t)
      ro.disconnect()
    }
  }, [])
  const showFilmstrip = useStore((s) => s.showFilmstrips)
  const strip = useStrip(props.videoFile, !!props.videoFile && showFilmstrip)
  const aspect = strip?.aspect ?? 16 / 9
  const frameW = size.h * aspect // each frame's on-screen width at the block's height (true aspect)
  // quantized to steps of 2 — every distinct count is a full img-row remount (jpeg re-decodes);
  // halving the distinct values halves the churn on gradual resizes
  const count = size.w > 0 && frameW > 0 ? Math.max(1, Math.min(40, Math.ceil(Math.ceil(size.w / frameW) / 2) * 2)) : 0
  const frames = useMemo(() => sampleStrip(strip, count, props.inSec, props.outSec), [strip, count, props.inSec, props.outSec])
  const fallbackUrl = useThumbUrl(showFilmstrip && !props.videoFile ? props.file : undefined)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <div
      ref={wrapRef}
      className={'vd-clip' + (props.selected ? ' sel' : '')}
      style={{
        flex: props.flex,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 44,
        // playhead-in-this-block gets a quiet marker; the loud amber ring belongs to SELECTION
        borderColor: props.selected ? undefined : props.current ? 'var(--amber-dim)' : undefined,
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
      onContextMenu={(e) => {
        if (props.sliceMode) return // let the panel-level handler disarm the razor (right-click cancels slice)
        if (!props.contextEntries?.length) return
        e.preventDefault()
        e.stopPropagation()
        setCtxPos({ x: e.clientX, y: e.clientY })
      }}
      onMouseMove={(e) => {
        if (!props.sliceMode || !props.canSlice) return
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const s = snapX(e.clientX - r.left, r.width)
        setHoverX(s.x)
        setSnapKind(s.kind)
      }}
      onMouseLeave={() => {
        setHoverX(null)
        setSnapKind('none')
      }}
      title={props.sliceMode ? (props.canSlice ? 'click to cut here' : 'no take to cut (render first)') : 'double-click to edit · drag to reorder'}
    >
      {frames.length > 1 ? (
        // Premiere-style: frames butt-jointed from the in-point, full block height, full strength
        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'flex-start', overflow: 'hidden' }}>
          {frames.map((f, i) => (
            // decoding=async keeps the jpeg decode off the input thread — a remounted strip
            // pops in a beat later instead of freezing the whole resize
            <img key={i} src={f} alt="" decoding="async" style={{ height: '100%', width: 'auto', flex: '0 0 auto', objectFit: 'cover', opacity: 0.95 }} />
          ))}
        </div>
      ) : frames.length === 1 ? (
        <img src={frames[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
      ) : fallbackUrl ? (
        <img src={fallbackUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.85 }} />
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
      {/* slim top scrim keeps the name row readable — the frames below stay bright (Premiere fill) */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.18) 34%, rgba(0,0,0,0) 55%)' }} />
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
        {props.takeLabel} ▾{props.muted ? <Ic i={VolumeX} size={9} style={{ marginLeft: 3 }} /> : null}
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 5, fontSize: 9, color: 'var(--body)', textShadow: '0 1px 2px #000', zIndex: 5 }}>
        {props.videoFile ? '▶' : '▦'} {props.durLabel}
      </div>
      {props.beats &&
        props.beats.length > 0 &&
        (() => {
          // the in/out trim CLIPS the clip; beats keep their absolute SOURCE-time positions and are
          // windowed to [inSec, outSec]. Mapping in source time keeps them right under speed changes
          // (props.seconds is the speed-adjusted timeline length — wrong axis for beats).
          const inS = props.inSec ?? 0
          const srcLen = Math.max(0.0001, (props.outSec ?? inS + props.seconds) - inS)
          const outS = inS + srcLen
          const ranges = beatRanges(props.beats)
          const vis: { i: number; name: string; img?: string; left: number; width: number }[] = []
          props.beats.forEach((b, i) => {
            const vs = Math.max(ranges[i].start, inS)
            const ve = Math.min(ranges[i].end, outS)
            if (ve <= vs) return
            vis.push({ i, name: b.name, img: props.beatImgs?.[i], left: ((vs - inS) / srcLen) * 100, width: ((ve - vs) / srcLen) * 100 })
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
      {props.onEditVideo && (
        <span
          style={{ position: 'absolute', top: 1, right: 20, cursor: 'pointer', color: '#fff', textShadow: '0 1px 2px #000', fontSize: 11 }}
          title="edit this take v2v — opens the Video Editor tree on it, timeline untouched"
          onClick={(e) => {
            e.stopPropagation()
            props.onEditVideo?.()
          }}
        >
          ⑂
        </span>
      )}
      {props.sliceMode && props.canSlice && hoverX != null && (
        // the cut guide while slicing: red free · amber = locked to the scrubber · green = locked to a beat
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: hoverX,
            width: snapKind !== 'none' ? 3 : 2,
            marginLeft: snapKind !== 'none' ? -1.5 : -1,
            background: snapKind === 'beat' ? 'var(--music)' : snapKind === 'play' ? 'var(--amber)' : 'var(--bad)',
            boxShadow: `0 0 4px ${snapKind === 'beat' ? 'var(--music)' : snapKind === 'play' ? 'var(--amber)' : 'var(--bad)'}`,
            zIndex: 9,
            pointerEvents: 'none'
          }}
        />
      )}
      {props.trimmable && !props.sliceMode && (
        <>
          <div
            data-noblockdrag
            onMouseDown={(e) => props.onTrimStart('in', e)}
            onClick={(e) => e.stopPropagation()}
            title="drag to trim start"
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }}
          />
          <div
            data-noblockdrag
            onMouseDown={(e) => props.onTrimStart('out', e)}
            onClick={(e) => e.stopPropagation()}
            title="drag to trim end"
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }}
          />
        </>
      )}
      {menuPos &&
        createPortal(
          <div onClick={() => setMenuPos(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: menuPos.x, top: menuPos.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 96, maxHeight: 220, overflow: 'auto' }}
            >
              {props.takes.length === 0 && <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--dim)' }}>no takes</div>}
              {props.takes.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    props.onPickTake(t.id)
                    setMenuPos(null)
                  }}
                  style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: t.id === props.currentTakeId ? 'var(--amber)' : 'var(--body)' }}
                >
                  {t.label}
                  {t.id === props.currentTakeId ? ' ✓' : ''}
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />
              <div
                onClick={() => {
                  props.onToggleMute()
                  setMenuPos(null)
                }}
                title="mute only THIS instance's clip audio (the timeline-wide mute silences all clips)"
                style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: props.muted ? 'var(--bad)' : 'var(--body)' }}
              >
                <Ic i={props.muted ? Volume2 : VolumeX} size={11} /> {props.muted ? 'unmute clip audio' : 'mute clip audio'}
              </div>
            </div>
          </div>,
          document.body
        )}
      {ctxPos && props.contextEntries && <ContextMenu x={ctxPos.x} y={ctxPos.y} entries={props.contextEntries} onClose={() => setCtxPos(null)} />}
    </div>
  )
}

// ---- ⟲ loop tail: the faded projection after a looped block — repeats of the SAME block until
// the wall (next block on the track / sequence end) or the user-set length. Not an object:
// pointer-transparent (clicks, marquee and drops all fall through to the row); its one handle
// is the parent-rendered end grip. Strips reuse the block's sampled frames — no new decode work.
function TlTail(props: {
  leftPct: number
  widthPct: number
  cycleFrac: number // one cycle's width as a fraction of the tail
  cycles: number // cells drawn (last may be partial — clipped mid-frame, plays cut, honest)
  cyclePx: number
  videoFile?: string
  inSec?: number
  outSec?: number
}): React.JSX.Element {
  const showFilmstrip = useStore((s) => s.showFilmstrips)
  const stripOn = !!props.videoFile && showFilmstrip && props.cycles <= 24 // long tails go flat — cheap
  const strip = useStrip(props.videoFile, stripOn)
  const aspect = strip?.aspect ?? 16 / 9
  const rowH = useStore((s) => s.tlRowH) || ROW_H_DEF
  const frameW = (rowH - 4) * aspect
  const perCycle = stripOn && frameW > 0 ? Math.max(1, Math.min(8, Math.round(props.cyclePx / frameW))) : 0
  const frames = useMemo(() => (perCycle > 0 ? sampleStrip(strip, perCycle, props.inSec, props.outSec) : []), [strip, perCycle, props.inSec, props.outSec])
  return (
    <div
      style={{
        position: 'absolute',
        top: 2,
        bottom: 2,
        left: `${props.leftPct}%`,
        width: `${props.widthPct}%`,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 1,
        display: 'flex',
        opacity: 0.35,
        borderRadius: 4,
        background: 'color-mix(in srgb, var(--raised2) 55%, transparent)'
      }}
    >
      {Array.from({ length: props.cycles }, (_, k) => (
        <div key={k} style={{ flex: `0 0 ${props.cycleFrac * 100}%`, minWidth: 0, position: 'relative', overflow: 'hidden', display: 'flex', borderLeft: '1px solid var(--line2)' }}>
          {frames.map((f, i) => (
            <img key={i} src={f} alt="" decoding="async" style={{ height: '100%', width: 'auto', flex: '0 0 auto', objectFit: 'cover' }} />
          ))}
          {props.cyclePx >= 24 && <span style={{ position: 'absolute', top: 0, left: 3, fontSize: 8, color: 'var(--txt)', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>⟲</span>}
        </div>
      ))}
    </div>
  )
}

// ---- the audio lane: one music block per timeline — drag from the Library's ♪ section.
// Double-click the block: expand (waveform visible) ↔ collapse. While expanded, a plain click
// cycles the view: waveform → beats → both. ----
function AudioLane(props: { tl: Timeline; total: number; audio: ProjAudio[]; snap: SnapKit }): React.JSX.Element {
  const setTimelineMusic = useStore((s) => s.setTimelineMusic)
  const reportAudioDuration = useStore((s) => s.reportAudioDuration)
  const [over, setOver] = useState(false)
  const [drag, setDrag] = useState<TimelineMusic | null>(null) // local preview during move/trim drags
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'wave' | 'beats' | 'both'>('wave')
  const laneRef = useRef<HTMLDivElement>(null)
  const blockRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const clickTimer = useRef<number | null>(null) // delayed single-click (cancelled by double-click)
  const { tl, total } = props
  const music = drag ?? tl.music
  const track = music ? props.audio.find((a) => a.id === music.audioId) : undefined
  const wave = useWave(track?.file, expanded && !!music) // decode/analyze only when the lane is open
  const srcDur = track?.durationSec ?? wave?.dur ?? 0 // 0 = unknown yet (lazily learned)
  const inS = music?.inSec ?? 0
  const outS = music ? Math.min(music.outSec ?? (srcDur || Infinity), srcDur || Infinity) : 0
  const len = music ? (isFinite(outS) ? Math.max(0.25, outS - inS) : Math.max(0.25, total - music.startSec)) : 0
  const visLen = music ? Math.max(0.1, Math.min(len, total - music.startSec)) : 0 // clipped to the timeline
  const leftPct = music ? (music.startSec / total) * 100 : 0
  const widthPct = music ? (visLen / total) * 100 : 0

  // the decode learns the track's true length — persist it if the Library hasn't yet
  useEffect(() => {
    if (wave && track && !track.durationSec) reportAudioDuration(track.id, wave.dur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave, track?.id])

  // draw the analysis into the block's canvas (windowed to the trim, live during drags)
  const [blockW, setBlockW] = useState(0)
  useEffect(() => {
    const el = blockRef.current
    if (!el || !expanded) return
    const ro = new ResizeObserver((es) => {
      const w = Math.round(es[0]?.contentRect.width ?? 0)
      setBlockW((prev) => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, !!music])
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !expanded || !wave || blockW <= 0) return
    const h = cv.parentElement?.clientHeight ?? 56
    cv.width = blockW
    cv.height = h
    const g = cv.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, blockW, h)
    // canvas can't resolve CSS vars — read the theme at draw time so the waveform re-themes too
    const css = getComputedStyle(document.documentElement)
    const waveCol = css.getPropertyValue('--music-txt').trim() || '#dff0df'
    const tickCol = css.getPropertyValue('--amber').trim() || '#e7a93c'
    const t0 = inS
    const span = Math.max(0.1, visLen)
    if (mode === 'wave' || mode === 'both') {
      g.fillStyle = waveCol
      g.globalAlpha = 0.8
      const mid = h / 2
      for (let x = 0; x < blockW; x++) {
        const a = Math.floor((t0 + (x / blockW) * span) * wave.pps)
        const b = Math.max(a + 1, Math.floor((t0 + ((x + 1) / blockW) * span) * wave.pps))
        let m = 0
        for (let i = a; i < b && i < wave.peaks.length; i++) if (wave.peaks[i] > m) m = wave.peaks[i]
        const half = Math.max(0.7, peakAmp(m) * (h / 2 - 2)) // dB display — fades stay visible
        g.fillRect(x, mid - half, 1, half * 2)
      }
    }
    if (mode === 'beats' || mode === 'both') {
      g.fillStyle = tickCol
      g.globalAlpha = 0.9
      for (const t of wave.beats) {
        if (t < t0 || t > t0 + span) continue
        const x = Math.round(((t - t0) / span) * blockW)
        g.fillRect(x, 0, 2, h)
      }
    }
  }, [wave, mode, inS, visLen, expanded, blockW])

  const secPerPx = (): number => {
    const w = laneRef.current?.getBoundingClientRect().width ?? 1
    return total / w
  }
  // drag the block (move startSec) or a trim edge; commit once on mouseup.
  // A press that never moves is a CLICK: expanded → cycle the view (delayed so dblclick can cancel).
  const startDrag = (kind: 'move' | 'in' | 'out', e: React.MouseEvent): void => {
    if (!tl.music) return
    e.preventDefault()
    e.stopPropagation()
    const base = tl.music
    const spp = secPerPx()
    const x0 = e.clientX
    const bIn = base.inSec ?? 0
    const bOut = Math.min(base.outSec ?? (srcDur || Infinity), srcDur || Infinity)
    let final: TimelineMusic = { ...base }
    let moved = false
    // ONE MAGNET: the legacy lane had ZERO snap — the likely "audio never snaps" path
    // (user catch 2026-08-19). Full target set minus this block; Shift bypasses; targets
    // rebuild per move so a running playhead stays a live target.
    const excl = new Set(['music:legacy'])
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true
      if (!moved) return
      const targets = props.snap.targets(excl)
      let d = (ev.clientX - x0) * spp
      let hit: number | null = null
      // trims: snap the dragged EDGE (timeline time), then the source clamps apply as before
      if (kind !== 'move' && !ev.shiftKey) {
        const edge0 = kind === 'in' ? base.startSec : base.startSec + ((isFinite(bOut) ? bOut : bIn + len) - bIn)
        const res = props.snap.apply(edge0 + d, targets)
        if (res.hit != null) {
          d = res.t - edge0
          hit = res.hit
        }
      }
      if (kind === 'move') {
        let ns = Math.max(0, Math.min(total - 0.25, base.startSec + d))
        if (!ev.shiftKey) {
          const res = props.snap.apply(ns, targets, len)
          if (res.hit != null) props.snap.flash(res.hit)
          ns = Math.max(0, Math.min(total - 0.25, res.t))
        }
        final = { ...base, startSec: ns }
      } else if (kind === 'in') {
        // head trim: in-point and timeline position move together (the rest of the track stays put)
        const maxIn = (isFinite(bOut) ? bOut : bIn + len) - 0.25
        const nIn = Math.max(0, Math.min(maxIn, bIn + d))
        final = { ...base, inSec: nIn, startSec: Math.max(0, base.startSec + (nIn - bIn)) }
      } else {
        const cap = srcDur || Infinity
        const nOut = Math.max(bIn + 0.25, Math.min(cap, (isFinite(bOut) ? bOut : bIn + len) + d))
        final = { ...base, outSec: isFinite(nOut) ? nOut : undefined }
      }
      // flash only when the source clamps let the edge LAND on the target (review catch)
      if (hit != null) {
        const landed = kind === 'in' ? final.startSec : isFinite(final.outSec ?? NaN) ? base.startSec + ((final.outSec as number) - bIn) : NaN
        if (isFinite(landed) && Math.abs(landed - hit) < 0.002) props.snap.flash(hit)
      }
      setDrag(final)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (!moved) {
        setDrag(null)
        if (kind === 'move' && expanded) {
          // plain click → cycle the view, unless a second click (dblclick) lands first
          if (clickTimer.current != null) window.clearTimeout(clickTimer.current)
          clickTimer.current = window.setTimeout(() => {
            clickTimer.current = null
            setMode((m) => (m === 'wave' ? 'beats' : m === 'beats' ? 'both' : 'wave'))
          }, 260)
        }
        return
      }
      void setTimelineMusic(tl.id, final).then(() => setDrag(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      ref={laneRef}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes(MIME_AUDIO)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(MIME_AUDIO)
        if (!id) return
        e.preventDefault()
        setOver(false)
        const r = laneRef.current?.getBoundingClientRect()
        const frac = r ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0
        void setTimelineMusic(tl.id, { audioId: id, startSec: Math.max(0, Math.min(total - 0.25, frac * total)) })
      }}
      style={{ position: 'relative', height: expanded && music ? 64 : 24, borderTop: '1px solid var(--line)', background: over ? 'color-mix(in srgb, var(--amber) 12%, transparent)' : 'var(--bg0)' }}
      title={music ? undefined : 'drag a ♪ track from the Library here'}
    >
      {!music && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 9.5, color: 'var(--dim)', pointerEvents: 'none' }}>
          ♪ audio — drag music from the Library
        </span>
      )}
      {music && (
        <div
          ref={blockRef}
          onMouseDown={(e) => startDrag('move', e)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (clickTimer.current != null) {
              window.clearTimeout(clickTimer.current) // a dblclick is not two view-cycles
              clickTimer.current = null
            }
            setExpanded((v) => !v)
          }}
          title={`${track?.title ?? '?'} — double-click: ${expanded ? 'collapse' : 'waveform view'}${expanded ? ' · click: cycle wave/beats/both' : ''} · drag to move · edges trim · starts at ${Math.round(music.startSec * 10) / 10}s`}
          style={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: 24,
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--music) 50%, transparent), color-mix(in srgb, var(--music) 30%, transparent))',
            border: '1px solid color-mix(in srgb, var(--music) 65%, transparent)',
            borderRadius: 4,
            cursor: 'grab',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          {/* explicit CSS size: an absolutely-positioned CANVAS ignores inset stretching and
              renders at its intrinsic 300×150 — THE original waveform-bunching bug (2026-08-19) */}
          {expanded && <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />}
          {/* v19 rubber band — editable while expanded, read-only line collapsed */}
          <VolumeBand
            lenSec={Math.max(0.25, visLen)}
            gain={music.gain ?? 1}
            points={music.volume}
            editable={expanded}
            onGain={(g) => void setTimelineMusic(tl.id, { ...music, gain: g === 1 ? undefined : g })}
            onPoints={(pts) => void setTimelineMusic(tl.id, { ...music, volume: pts.length ? pts : undefined })}
          />
          {expanded && !wave && (
            <span style={{ position: 'absolute', right: 26, top: 2, fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
              analyzing…
            </span>
          )}
          {expanded && wave && (
            <span style={{ position: 'absolute', right: 26, top: 2, fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
              {mode === 'both' ? 'wave+beats' : mode}
            </span>
          )}
          <div onMouseDown={(e) => startDrag('in', e)} title="trim start" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
          <span style={{ position: 'relative', fontSize: 9.5, color: 'var(--music-txt)', paddingLeft: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', textShadow: '0 1px 2px #000', alignSelf: expanded ? 'flex-start' : 'center', paddingTop: expanded ? 2 : 0 }}>
            ♪ {track?.title ?? '?'} · {Math.round(visLen * 10) / 10}s
          </span>
          <span
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              void setTimelineMusic(tl.id, null)
            }}
            title="remove music from this timeline"
            style={{ position: 'absolute', right: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#fff', textShadow: '0 1px 2px #000', fontSize: 10, zIndex: 4 }}
          >
            ✕
          </span>
          <div onMouseDown={(e) => startDrag('out', e)} title="trim end" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
        </div>
      )}
    </div>
  )
}

// ---- ♪ score blocks (v18, LANE-MERGED v19): stretched score spans living ON the shared audio
// lanes with the green/blue blocks — Premiere-style, one audio area for everything. Rendered
// INSIDE AudioItemLanes' container (absolute overlay; blocks position by their `lane`).
// Span semantics (SCORE-PLAN): audio never time-stretches — the keeper take plays inside the
// span, a shorter take just ends early. The span is also what compose reads. ----
function ScoreBlocks(props: { tl: Timeline; total: number; scoreClips: ScoreClip[]; laneH: number; laneCount: number; occ: OccEntry[]; snap: SnapKit }): React.JSX.Element {
  const setTimelineScoreItems = useStore((s) => s.setTimelineScoreItems)
  const [drag, setDrag] = useState<TimelineScoreItem | null>(null) // local preview during move/stretch
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const laneRef = useRef<HTMLDivElement>(null) // spans the whole lane container (x scale)
  const { tl, total, laneH, laneCount } = props
  const items = tl.scoreItems ?? []
  const selectedScoreItemId = useStore((s) => s.selectedScoreItemId)
  const expandedLanes = useStore((s) => s.expandedAudioLanes) // per-lane tall volume view
  const menuItem = menu ? items.find((x) => x.id === menu.id) : undefined
  const gainOf = (s: TimelineScoreItem): number => s.gain ?? 1
  // per-lane heights (v19: ONE lane expands, Premiere-style) — must mirror AudioItemLanes' math
  const hOf = (l: number): number => (expandedLanes.includes(l) ? 64 : laneH)
  const topOf = (l: number): number => {
    let t = 0
    for (let i = 0; i < l; i++) t += hOf(i)
    return t
  }
  const laneAtY = (clientY: number): number => {
    const top = laneRef.current?.getBoundingClientRect().top ?? 0
    let y = clientY - top
    for (let l = 0; l < laneCount; l++) {
      y -= hOf(l)
      if (y < 0) return l
    }
    return laneCount - 1
  }
  const secPerPx = (): number => total / (laneRef.current?.getBoundingClientRect().width ?? 1)
  const commit = (next: TimelineScoreItem[]): void => void setTimelineScoreItems(tl.id, next, tl.rev)
  // v19 COLLISION LAW: one lane, one occupant (registry shared with the audio items)
  const collides = (lane: number, s: number, e: number, exclude?: string): boolean => props.occ.some((o) => o.lane === lane && o.id !== exclude && s < o.end - 0.05 && e > o.start + 0.05)
  const freeLaneFor = (s: number, e: number, prefer: number, exclude?: string): number => {
    if (!collides(prefer, s, e, exclude)) return prefer
    for (let l = 0; l < laneCount; l++) if (!collides(l, s, e, exclude)) return l
    return laneCount
  }
  const growTo = (lane: number): void => {
    if (lane >= laneCount) void useStore.getState().setTimelineMeta({ audioTracks: lane + 1 }, tl.id)
  }
  // LEGACY NUDGE (one-shot per timeline): pre-merge scores landed on A1 wherever the edit's
  // audio already lived — move any overlapping score to clear ground automatically
  const nudged = useRef<string | null>(null)
  useEffect(() => {
    if (nudged.current === tl.id || !items.length) return
    nudged.current = tl.id
    let changed = false
    let maxLane = 0
    const next = items.map((s) => {
      const l0 = s.lane ?? 0
      if (!collides(l0, s.startSec, s.startSec + s.spanSec, s.id)) return s
      const l2 = freeLaneFor(s.startSec, s.startSec + s.spanSec, l0, s.id)
      changed = true
      if (l2 > maxLane) maxLane = l2
      return { ...s, lane: l2 || undefined }
    })
    if (changed) {
      growTo(maxLane)
      commit(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.id])
  const startDrag = (it: TimelineScoreItem, kind: 'move' | 'span' | 'in', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if ((props.tl.lockedTracks ?? []).includes(`a${it.lane ?? 0}`)) return // locked lane rejects edits
    const spp = secPerPx()
    const x0 = e.clientX
    const y0 = e.clientY
    let final = { ...it }
    let moved = false
    // ONE MAGNET (Premiere grammar, Shift disables): full target set, minus this span; targets
    // rebuild per move so a running playhead stays a live target (review catch 2026-08-19)
    const excl = new Set([it.id])
    // collision walls for trims/stretch: the neighbors on this lane stop them, Premiere-style
    const wallLane = it.lane ?? 0
    const nextStart = Math.min(...props.occ.filter((o) => o.lane === wallLane && o.id !== it.id && o.start > it.startSec + 0.05).map((o) => o.start), Infinity)
    const prevEnd = Math.max(...props.occ.filter((o) => o.lane === wallLane && o.id !== it.id && o.end < it.startSec + it.spanSec - 0.05).map((o) => o.end), 0)
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > laneH / 2) moved = true
      if (!moved) return
      const targets = props.snap.targets(excl)
      let d = (ev.clientX - x0) * spp
      let hit: number | null = null
      // trims/stretch: snap the dragged EDGE (timeline time), then the walls clamp as before
      if (kind !== 'move' && !ev.shiftKey) {
        const edge0 = kind === 'in' ? it.startSec : it.startSec + it.spanSec
        const res = props.snap.apply(edge0 + d, targets)
        if (res.hit != null) {
          d = res.t - edge0
          hit = res.hit
        }
      }
      if (kind === 'move') {
        // vertical = change lane, same grammar as the green blocks (per-lane heights aware)
        const nLane = Math.max(0, Math.min(laneCount - 1, laneAtY(ev.clientY)))
        let ns = Math.max(0, Math.min(total - 0.25, it.startSec + d))
        if (!ev.shiftKey) {
          const res = props.snap.apply(ns, targets, it.spanSec)
          if (res.hit != null) props.snap.flash(res.hit)
          ns = Math.max(0, res.t)
        }
        final = { ...it, startSec: ns, lane: nLane || undefined }
      } else if (kind === 'in') {
        // head trim (music-lane grammar): in-point and position move together, the span
        // shrinks. COLLISION: the head stops at the previous neighbor's end.
        const bIn = it.inSec ?? 0
        const dd = Math.max(Math.max(-bIn, prevEnd - it.startSec), Math.min(it.spanSec - 1, d))
        final = { ...it, inSec: Math.max(0, bIn + dd) || undefined, startSec: Math.max(0, it.startSec + dd), spanSec: it.spanSec - dd }
      } else {
        // COLLISION: the stretch stops at the next neighbor's start
        const maxSpan = isFinite(nextStart) ? nextStart - it.startSec : Infinity
        final = { ...it, spanSec: Math.max(1, Math.min(maxSpan, it.spanSec + d)) }
      }
      // flash only when the walls let the edge LAND on the target (review catch)
      if (hit != null) {
        const landed = kind === 'in' ? final.startSec : final.startSec + final.spanSec
        if (Math.abs(landed - hit) < 0.002) props.snap.flash(hit)
      }
      setDrag(final)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (moved) {
        // COLLISION on placement: an overlapping landing hops to the first clear lane
        if (kind === 'move') {
          const l2 = freeLaneFor(final.startSec, final.startSec + final.spanSec, final.lane ?? 0, it.id)
          growTo(l2)
          final = { ...final, lane: l2 || undefined }
        }
        void setTimelineScoreItems(tl.id, items.map((x) => (x.id === it.id ? final : x)), tl.rev).then(() => setDrag(null))
        // stretching the span IS setting the score's length: the next render targets what you
        // stretched (the emit clamps to the engine's cap; the card's field follows live)
        if (kind === 'span') {
          const sc = props.scoreClips.find((x) => x.id === it.scoreClipId)
          if (sc) void useStore.getState().saveScoreClip(sc.id, { recipe: { ...sc.recipe, options: { ...(sc.recipe.options ?? {}), durationSec: Math.max(5, Math.round(final.spanSec)) } } })
        }
      } else {
        setDrag(null)
        // a press that never moved is a CLICK = select + the Score card follows (the clip-editor
        // grammar: clicking a block points its editor at it without raising the panel)
        useStore.getState().selectScoreItem(it.id)
        useStore.getState().setEditorScore(it.scoreClipId)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    // transparent overlay over the WHOLE audio-lane container — only the blocks take pointer
    // events, so the green/blue blocks underneath stay fully interactive between scores
    <div ref={laneRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {items.map((raw) => {
        const it = drag && drag.id === raw.id ? drag : raw
        const sc = props.scoreClips.find((x) => x.id === it.scoreClipId)
        const hasTake = !!sc?.takes.length
        const kt = sc?.takes.find((t) => t.id === (it.takeId ?? sc?.keeperTakeId)) ?? sc?.takes[sc.takes.length - 1]
        const isSel = selectedScoreItemId === raw.id
        const left = (it.startSec / total) * 100
        const width = (Math.max(0.5, Math.min(it.spanSec, total - it.startSec)) / total) * 100
        // the wave paints only the COVERED stretch (the hatched unrendered tail stays bare)
        const availFrac = kt?.durationSec && it.spanSec > 0 ? Math.min(1, Math.max(0, kt.durationSec - (it.inSec ?? 0)) / it.spanSec) : 1
        return (
          <div
            key={raw.id}
            onMouseDown={(e) => startDrag(raw, 'move', e)}
            onDoubleClick={(e) => {
              // v19 grammar (user call): double-click = the tall volume view for THIS lane
              // only. The Score card lives on click-sync, right-click, and the Bin.
              e.stopPropagation()
              useStore.getState().toggleAudioLane(it.lane ?? 0)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, id: raw.id })
            }}
            title={`${sc?.name ?? '?'} · ${Math.round(it.spanSec)}s span${hasTake ? '' : ' · no render yet (silent)'} · click select (Del removes) · double-click = volume view · drag = move (up/down = lane) · right edge stretches · right-click: card/fades/compose`}
            style={{
              position: 'absolute',
              top: topOf(it.lane ?? 0) + 2,
              height: hOf(it.lane ?? 0) - 4,
              left: `${left}%`,
              width: `${width}%`,
              minWidth: 18,
              pointerEvents: 'auto',
              outline: isSel ? '2px solid var(--amber)' : 'none',
              outlineOffset: 1,
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--music) 40%, transparent), color-mix(in srgb, var(--music) 22%, transparent))',
              border: `1px ${hasTake ? 'solid' : 'dashed'} color-mix(in srgb, var(--music) 65%, transparent)`,
              borderRadius: 4,
              cursor: 'grab',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              opacity: it.muted ? 0.45 : 1
            }}
          >
            {/* beat BANDS — the law: beats stay visible wherever a clip is shown, as colored
                bands (the video-block system). Score beats split the span into regions:
                beat[i] colors [at_i, at_i+1). Hover reads the direction. */}
            {(() => {
              const bs = (sc?.beats ?? []).filter((b) => it.spanSec > 0 && b.at <= it.spanSec)
              return bs.map((b, i) => {
                const start = b.at / it.spanSec
                const end = (bs[i + 1]?.at ?? it.spanSec) / it.spanSec
                return (
                  <div
                    key={b.id}
                    title={`${Math.round(b.at)}s — ${b.text}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: `${start * 100}%`, width: `${Math.max(0, end - start) * 100}%`, background: BEAT_COLORS[i % BEAT_COLORS.length], opacity: 0.35, boxShadow: 'inset -1px 0 0 0 rgba(0,0,0,.45)' }}
                  />
                )
              })
            })()}
            {/* keeper take's waveform over the covered stretch (v20: sound is visible) */}
            {kt && (
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${availFrac * 100}%`, overflow: 'hidden', pointerEvents: 'none' }}>
                <LaneWave file={kt.file} inSec={it.inSec ?? 0} lenSec={Math.max(0.25, it.spanSec * availFrac)} h={hOf(it.lane ?? 0)} muted={it.muted} />
              </div>
            )}
            {/* fade wedges + state badges — a set fade/gain must be VISIBLE on the block */}
            {!!it.fadeInSec && it.spanSec > 0 && (
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, (it.fadeInSec / it.spanSec) * 100)}%`, background: 'linear-gradient(90deg, rgba(0,0,0,.6), transparent)', pointerEvents: 'none' }} />
            )}
            {!!it.fadeOutSec && it.spanSec > 0 && (
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.min(100, (it.fadeOutSec / it.spanSec) * 100)}%`, background: 'linear-gradient(270deg, rgba(0,0,0,.6), transparent)', pointerEvents: 'none' }} />
            )}
            {/* span = intent, take = fact: the stretch past the rendered take's real audio
                draws HATCHED — silent until re-rendered at this length (2026-08-19 model) */}
            {(() => {
              // SAME take as the wave + export resolve (pin ?? keeper ?? last) — this hatch
              // once re-derived from the keeper alone and disagreed with its own block
              if (!sc?.takes.length || it.spanSec <= 0) return null
              if (!kt?.durationSec) return null
              const avail = Math.max(0, kt.durationSec - (it.inSec ?? 0))
              if (avail >= it.spanSec - 0.25) return null
              return (
                <div
                  title={`+${Math.round(it.spanSec - avail)}s past the rendered take — silent until re-rendered at this length`}
                  style={{ position: 'absolute', left: `${(avail / it.spanSec) * 100}%`, right: 0, top: 0, bottom: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,.45) 4px 8px)', borderLeft: '1px dashed var(--music-txt)' }}
                />
              )
            })()}
            <span style={{ fontSize: 9.5, color: 'var(--music-txt)', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', textShadow: '0 1px 2px #000', position: 'relative' }}>
              ♪ {sc?.name ?? '?'} · {Math.round(it.spanSec)}s
            </span>
            <span style={{ position: 'absolute', right: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none', fontSize: 9, color: '#fff', textShadow: '0 1px 2px #000' }}>
              {(it.gain ?? 1) !== 1 && <span>{Math.round((it.gain ?? 1) * 100)}%</span>}
              {it.muted && <span>🔇</span>}
            </span>
            {/* v19 rubber band — editable while THIS lane is expanded */}
            <VolumeBand
              lenSec={Math.max(0.25, it.spanSec)}
              gain={it.gain ?? 1}
              points={it.volume}
              editable={hOf(it.lane ?? 0) >= 48}
              onGain={(g) => commit(items.map((x) => (x.id === raw.id ? { ...x, gain: g === 1 ? undefined : g } : x)))}
              onPoints={(pts) => commit(items.map((x) => (x.id === raw.id ? { ...x, volume: pts.length ? pts : undefined } : x)))}
            />
            <div onMouseDown={(e) => startDrag(raw, 'in', e)} title="trim start (in-point + position move together)" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
            <div onMouseDown={(e) => startDrag(raw, 'span', e)} title="stretch the span" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
          </div>
        )
      })}
      {menu && menuItem && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            {
              label: <>♪ open score card (beats · engine · takes)</>,
              onClick: () => {
                useStore.getState().setEditorScore(menuItem.scoreClipId)
                openScoreCard()
              }
            },
            {
              label: <>✨ compose from this span (reads the clips it covers)</>,
              onClick: () => void useStore.getState().composeScore(menuItem.scoreClipId, { scoreItemId: menuItem.id, timelineId: tl.id })
            },
            {
              label: menuItem.muted ? 'unmute' : 'mute',
              onClick: () => commit(items.map((x) => (x.id === menuItem.id ? { ...x, muted: !x.muted || undefined } : x)))
            },
            {
              // same cycling grammar as the audio-lane blocks: 0 → 0.5 → 1 → 1.5 → 2 → 0
              label: <>fade in: {menuItem.fadeInSec ?? 0}s → {((menuItem.fadeInSec ?? 0) + 0.5) % 2.5}s</>,
              onClick: () => commit(items.map((x) => (x.id === menuItem.id ? { ...x, fadeInSec: ((x.fadeInSec ?? 0) + 0.5) % 2.5 || undefined } : x)))
            },
            {
              label: <>fade out: {menuItem.fadeOutSec ?? 0}s → {((menuItem.fadeOutSec ?? 0) + 0.5) % 2.5}s</>,
              onClick: () => commit(items.map((x) => (x.id === menuItem.id ? { ...x, fadeOutSec: ((x.fadeOutSec ?? 0) + 0.5) % 2.5 || undefined } : x)))
            },
            {
              label: <>gain: {Math.round(gainOf(menuItem) * 100)}% → {Math.round((gainOf(menuItem) >= 2 ? 0.25 : gainOf(menuItem) + 0.25) * 100)}%</>,
              onClick: () =>
                commit(items.map((x) => (x.id === menuItem.id ? { ...x, gain: (gainOf(x) >= 2 ? 0.25 : gainOf(x) + 0.25) === 1 ? undefined : (gainOf(x) >= 2 ? 0.25 : gainOf(x) + 0.25) } : x)))
            },
            {
              label: <>remove score span</>,
              danger: true,
              onClick: () => commit(items.filter((x) => x.id !== menuItem.id))
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// v20 LAW: sound is VISIBLE — one waveform painter for every lane block that lacked one
// (blue companions, ♪ score blocks; green/teal draw their own). Window = [inSec, inSec+lenSec]
// in SOURCE seconds; the canvas repaints on size/window changes.
function LaneWave({ file, inSec, lenSec, h, muted }: { file?: string; inSec: number; lenSec: number; h: number; muted?: boolean }): React.JSX.Element | null {
  const wave = useWave(file, !!file)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !wave) return
    const draw = (): void => {
      const r = c.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return
      c.width = Math.round(r.width)
      c.height = Math.round(r.height)
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.fillStyle = 'rgba(255,255,255,.5)'
      for (let x = 0; x < c.width; x++) {
        const t = inSec + (x / c.width) * lenSec
        if (t > wave.dur) break // never clamp-smear past the real audio (truth over fill)
        const p = wave.peaks[Math.min(wave.peaks.length - 1, Math.max(0, Math.floor(t * wave.pps)))] ?? 0
        const bar = Math.max(1, peakAmp(p) * (c.height - 2)) // dB display — fades stay visible
        ctx.fillRect(x, (c.height - bar) / 2, 1, bar)
      }
    }
    draw()
    // zoom changes the block's PIXEL width with the same lenSec — redraw or the bitmap smears
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [wave, inSec, lenSec, h])
  if (!file) return null
  // explicit CSS size — a positioned canvas ignores inset stretching (intrinsic 300×150)
  return <canvas ref={ref} style={{ position: 'absolute', left: 0, top: 2, width: '100%', height: 'calc(100% - 4px)', pointerEvents: 'none', opacity: muted ? 0.3 : 0.8 }} />
}

// one occupied span on an audio lane — the collision registry entry (v19: one lane, one occupant)
interface OccEntry {
  lane: number
  start: number
  end: number
  id: string
}

// ---- ONE MAGNET (2026-08-19): the timeline's snap machinery, handed to every lane component so
// every move AND every trim — video, audio, score, legacy music, markers, tails — pulls from the
// SAME target set at the SAME 12px. targets() excludes the dragged thing; flash() draws the green
// hit line wherever the magnet catches. ----
interface SnapKit {
  targets: (exclude: Set<string>, excludeMarkerId?: string) => number[]
  apply: (t: number, targets: number[], alsoEdge?: number) => { t: number; hit: number | null }
  flash: (at: number | null) => void
}

// ---- Timeline: ruler/scrubber + track of clip instances + playhead ----
// ---- audio lanes: detached clip audio on 3 absolute-time rows (music keeps its own lane) ----
// A block's right-click "unlink audio" lands here. Linked items (🔗) ride their video block through
// re-flows; free items sit at absolute time. Drag = move (vertical = change lane), edges = trim,
// right-click = link/unlink · mute · delete. Rendered only while the timeline has audio items.
function AudioItem({ a, tl, segs, total, clips, laneH, laneTop, onGesture, onMenu, onPatch }: {
  a: TimelineAudioItem
  tl: Timeline
  segs: { start: number; dur: number }[]
  total: number
  clips: Clip[]
  laneH: number // THIS item's lane height (per-lane expansion)
  laneTop: number // THIS item's lane top offset (lanes have mixed heights)
  onGesture: (kind: 'move' | 'in' | 'out', a: TimelineAudioItem, e: React.MouseEvent) => void
  onMenu: (a: TimelineAudioItem, e: React.MouseEvent) => void
  onPatch: (id: string, patch: Partial<TimelineAudioItem>) => void
}): React.JSX.Element {
  // v20: both source kinds resolve through ONE helper (clip-take audio | Library file ♫)
  const res = resolveAudioSource(a, clips, useStore.getState().project?.audio ?? [])
  const file = res.file
  const isFile = res.kind === 'file'
  const isSel = useStore((s) => s.selectedAudioItemId) === a.id
  const wave = useWave(file, true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const start = audioStartOf(a, segs, tl.items)
  const len = Math.max(0.25, a.outSec - a.inSec)
  // mini waveform for the visible window
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !wave) return
    const r = c.getBoundingClientRect()
    if (r.width < 4) return
    c.width = Math.round(r.width)
    c.height = laneH - 4
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = 'rgba(255,255,255,.55)'
    for (let x = 0; x < c.width; x++) {
      const t = a.inSec + (x / c.width) * len
      const p = wave.peaks[Math.min(wave.peaks.length - 1, Math.max(0, Math.floor(t * wave.pps)))] ?? 0
      const h = Math.max(1, peakAmp(p) * (c.height - 2)) // dB display — fades stay visible
      ctx.fillRect(x, (c.height - h) / 2, 1, h)
    }
  }, [wave, a.inSec, a.outSec, len, laneH, start, total])
  return (
    <div
      onMouseDown={(e) => onGesture('move', a, e)}
      onDoubleClick={(e) => {
        // v19: double-click toggles the tall volume view for THIS lane only (Premiere)
        e.stopPropagation()
        useStore.getState().toggleAudioLane(a.lane)
      }}
      onContextMenu={(e) => onMenu(a, e)}
      title={`${res.name}${isFile ? ' · ♫ Library track' : ' audio'}${a.link ? ' · 🔗 linked — rides its video block' : ' · free (absolute time)'}${a.beatGrid ? ' · ♫ beat grid source' : ''}${a.muted ? ' · MUTED' : ''} · drag = move (up/down = lane) · edges = trim · double-click = volume view · right-click = actions`}
      style={{
        position: 'absolute',
        top: laneTop + 2,
        height: laneH - 4,
        left: `${(start / total) * 100}%`,
        width: `${(len / total) * 100}%`,
        minWidth: 16,
        // green = clip-take audio · teal (--music) = Library file, the merged music lane
        background: a.muted
          ? `color-mix(in srgb, var(${isFile ? '--music' : '--ok'}) 14%, transparent)`
          : `linear-gradient(180deg, color-mix(in srgb, var(${isFile ? '--music' : '--ok'}) 45%, transparent), color-mix(in srgb, var(${isFile ? '--music' : '--ok'}) 26%, transparent))`,
        border: `1px solid color-mix(in srgb, var(${isFile ? '--music' : '--ok'}) ${a.muted ? 35 : 65}%, transparent)`,
        borderRadius: 3,
        cursor: 'grab',
        overflow: 'hidden',
        outline: isSel ? '2px solid var(--amber)' : 'none',
        outlineOffset: 1
      }}
    >
      {/* explicit CSS size — a positioned canvas ignores inset stretching (intrinsic 300×150) */}
      <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 2, width: '100%', height: 'calc(100% - 4px)', pointerEvents: 'none', opacity: a.muted ? 0.35 : 1 }} />
      <span style={{ position: 'relative', fontSize: 8.5, color: isFile ? 'var(--music-txt)' : '#fff', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', textShadow: '0 1px 2px #000', lineHeight: `${laneH - 4}px` }}>
        {a.link ? '🔗 ' : ''}
        {isFile ? '♫ ' : ''}
        {a.beatGrid ? '⋮⋮ ' : ''}
        {res.name}
      </span>
      {/* v19 rubber band — editable in the tall (expanded) lane view */}
      <VolumeBand
        lenSec={len}
        gain={a.gain ?? 1}
        points={a.volume}
        editable={laneH >= 48}
        onGain={(g) => onPatch(a.id, { gain: g === 1 ? undefined : g })}
        onPoints={(pts) => onPatch(a.id, { volume: pts.length ? pts : undefined })}
      />
      <div onMouseDown={(e) => onGesture('in', a, e)} title="trim start" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
      <div onMouseDown={(e) => onGesture('out', a, e)} title="trim end" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
    </div>
  )
}

function AudioItemLanes({ tl, total, segs, clips, items: videoItems, laneCount, laneH, onUnlink, scoreClips, snap }: {
  tl: Timeline
  total: number
  segs: { start: number; dur: number }[]
  clips: Clip[]
  items: TimelineItem[]
  laneCount: number
  laneH: number
  onUnlink: (itemId: string) => void
  scoreClips: ScoreClip[]
  snap: SnapKit // ONE MAGNET — the timeline's shared snap machinery
}): React.JSX.Element | null {
  const setTimelineAudioItems = useStore((s) => s.setTimelineAudioItems)
  const laneRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<TimelineAudioItem | null>(null) // local gesture preview — commit once on release
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const LANE_H = laneH
  // v19 per-lane expansion: ONE lane grows tall (Premiere) — heights are per-lane from here on
  const expandedLanes = useStore((s) => s.expandedAudioLanes)
  const selectedTlItemIdLanes = useStore((s) => s.selectedTlItemId) // linked-selection highlight on blue halves
  const hOf = (l: number): number => (expandedLanes.includes(l) ? 64 : LANE_H)
  const topOf = (l: number): number => {
    let t = 0
    for (let i = 0; i < l; i++) t += hOf(i)
    return t
  }
  const laneAtY = (clientY: number): number => {
    let y = clientY - (laneRef.current?.getBoundingClientRect().top ?? 0)
    for (let l = 0; l < laneCount; l++) {
      y -= hOf(l)
      if (y < 0) return l
    }
    return laneCount - 1
  }
  const items = tl.audioItems ?? []
  // COMPANIONS: every video block with a take whose audio is still embedded shows a LINKED audio
  // block (always visible, distinct tint) mirroring it exactly — right-click to unlink
  const companions = videoItems
    .map((it, i) => {
      // muted blocks hide their companion too — silent audio holds no lane ground (the insert-
      // audio verb mutes the block, and its lane copy takes the spot without stacking)
      if (it.audioDetachedId || it.useRecipe || it.disabled || it.muted) return null
      const c = clips.find((x) => x.id === it.clipId)
      const take = c ? resolveTake(c, it) : undefined // same pick as the video block (skips disabled duds)
      if (!take) return null
      return { it, seg: segs[i] ?? { start: 0, dur: 1 }, name: c?.name ?? '?', file: take.file, lane: Math.min(laneCount - 1, it.track ?? 0) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const view = (a: TimelineAudioItem): TimelineAudioItem => (drag && drag.id === a.id ? drag : a)
  const fresh = (): TimelineAudioItem[] => activeTimeline(useStore.getState().project)?.audioItems ?? []
  // v19 COLLISION LAW (user call, the hard way): one lane, one occupant. Every audio thing on
  // the lanes registers here; placements check it and hop to clear ground — never stack.
  const occ: OccEntry[] = [
    ...companions.map((c) => ({ lane: c.lane, start: c.seg.start, end: c.seg.start + c.seg.dur, id: 'comp:' + c.it.id })),
    ...items.map((a) => {
      const s = audioStartOf(a, segs, tl.items)
      return { lane: a.lane, start: s, end: s + Math.max(0.25, a.outSec - a.inSec), id: a.id }
    }),
    ...(tl.scoreItems ?? []).map((s) => ({ lane: s.lane ?? 0, start: s.startSec, end: s.startSec + s.spanSec, id: s.id }))
  ]
  const collides = (lane: number, s: number, e: number, exclude?: string): boolean => occ.some((o) => o.lane === lane && o.id !== exclude && s < o.end - 0.05 && e > o.start + 0.05)
  // first clear lane for [s,e) — laneCount when every lane is taken (caller grows the rail)
  const freeLaneFor = (s: number, e: number, prefer: number, exclude?: string): number => {
    if (!collides(prefer, s, e, exclude)) return prefer
    for (let l = 0; l < laneCount; l++) if (!collides(l, s, e, exclude)) return l
    return laneCount
  }
  const growTo = (lane: number): void => {
    if (lane >= laneCount) void useStore.getState().setTimelineMeta({ audioTracks: lane + 1 }, tl.id)
  }
  const srcDurOf = (a: TimelineAudioItem): number => {
    // unknown metadata yet → don't allow extending past what we know
    return resolveAudioSource(a, clips, useStore.getState().project?.audio ?? []).durationSec ?? a.outSec
  }
  const onGesture = (kind: 'move' | 'in' | 'out', a0: TimelineAudioItem, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if ((tl.lockedTracks ?? []).includes(`a${a0.lane}`)) return // locked lane rejects edits — the chip means it
    const lane = laneRef.current
    if (!lane) return
    const spp = total / lane.getBoundingClientRect().width
    const x0 = e.clientX
    const y0 = e.clientY
    const base = { ...a0 }
    const baseStart = audioStartOf(base, segs, tl.items)
    let final = { ...base }
    let moved = false
    // ONE MAGNET: full target set, minus this block AND the video block a linked rider sits on
    // (its edges coincide — self-pinning, review catch 2026-08-19); targets rebuild per move so
    // a running playhead stays a live target. Moves snap both edges, trims snap the dragged edge.
    const excl = new Set([base.id, ...(base.link ? [base.link.itemId] : [])])
    // collision walls for trims: the neighbors on this lane (trims stop at them, Premiere-style)
    const baseEnd = baseStart + Math.max(0.25, base.outSec - base.inSec)
    const nextStart = Math.min(...occ.filter((o) => o.lane === base.lane && o.id !== base.id && o.start > baseStart + 0.05).map((o) => o.start), Infinity)
    const prevEnd = Math.max(...occ.filter((o) => o.lane === base.lane && o.id !== base.id && o.end < baseEnd - 0.05).map((o) => o.end), 0)
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 4) moved = true
      if (!moved) return
      const targets = snap.targets(excl)
      let d = (ev.clientX - x0) * spp
      let hit: number | null = null
      // trims: snap the dragged EDGE (timeline time), then the walls clamp as before
      if (kind !== 'move' && !ev.shiftKey) {
        const edge0 = kind === 'in' ? baseStart : baseEnd
        const res = snap.apply(edge0 + d, targets)
        if (res.hit != null) {
          d = res.t - edge0
          hit = res.hit
        }
      }
      if (kind === 'move') {
        const len = Math.max(0.25, base.outSec - base.inSec)
        let nStart = Math.max(0, Math.min(Math.max(0, total - 0.25), baseStart + d))
        // snap BOTH edges (audio items had NO snapping at all — user catch 2026-08-19);
        // Shift bypasses, Premiere grammar
        if (!ev.shiftKey) {
          const res = snap.apply(nStart, targets, len)
          if (res.hit != null) snap.flash(res.hit)
          nStart = Math.max(0, res.t)
        }
        const nLane = Math.max(0, Math.min(laneCount - 1, laneAtY(ev.clientY)))
        if (base.link) {
          // moving a LINKED item re-tunes its offset (it keeps riding the same block)
          const bi = tl.items.findIndex((it) => it.id === base.link!.itemId)
          const bStart = bi >= 0 ? segs[bi]?.start ?? 0 : null
          final = bStart != null ? { ...base, lane: nLane, startSec: nStart, link: { ...base.link, offset: nStart - bStart } } : { ...base, lane: nLane, startSec: nStart, link: undefined }
        } else {
          final = { ...base, lane: nLane, startSec: nStart }
        }
        void len
      } else if (kind === 'in') {
        // head trim: in-point and position move together (the tail stays put) — same as the
        // music lane. COLLISION: the head stops at the previous neighbor's end.
        const minIn = base.inSec + (prevEnd - baseStart) // startSec may not cross prevEnd
        const nIn = Math.max(Math.max(0, minIn), Math.min(base.outSec - 0.25, base.inSec + d))
        const shift = nIn - base.inSec
        final = {
          ...base,
          inSec: nIn,
          startSec: Math.max(0, baseStart + shift),
          ...(base.link ? { link: { ...base.link, offset: base.link.offset + shift } } : {})
        }
      } else {
        // COLLISION: the tail stops at the next neighbor's start
        const maxOut = isFinite(nextStart) ? base.inSec + (nextStart - baseStart) : Infinity
        final = { ...base, outSec: Math.max(base.inSec + 0.25, Math.min(Math.min(srcDurOf(base), maxOut), base.outSec + d)) }
      }
      // flash only when the walls/source clamps let the edge LAND on the target (review catch)
      if (hit != null) {
        const landed = kind === 'in' ? baseStart + (final.inSec - base.inSec) : baseStart + (final.outSec - base.inSec)
        if (Math.abs(landed - hit) < 0.002) snap.flash(hit)
      }
      setDrag(final)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      // a press that never moved is a CLICK = select (one grammar, every block)
      if (!moved) {
        setDrag(null)
        useStore.getState().selectAudioItem(base.id)
        return
      }
      // COLLISION on placement: an overlapping landing hops to the first clear lane (growing
      // the rail only when every lane is blocked)
      if (kind === 'move') {
        const fs = audioStartOf(final, segs, tl.items)
        const fe = fs + Math.max(0.25, final.outSec - final.inSec)
        const l2 = freeLaneFor(fs, fe, final.lane, final.id)
        growTo(l2)
        final = { ...final, lane: l2 }
      }
      void setTimelineAudioItems(fresh().map((x) => (x.id === final.id ? final : x)), tl.id).then(() => setDrag(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const menuItem = menu ? items.find((x) => x.id === menu.id) : undefined
  const toggleLink = (a: TimelineAudioItem): TimelineAudioItem => {
    const abs = audioStartOf(a, segs, tl.items)
    if (a.link) return { ...a, link: undefined, startSec: abs } // unlink → freeze at the current absolute spot
    // link → the block under the audio's start (else the nearest block)
    let idx = segs.findIndex((s) => abs >= s.start && abs < s.start + s.dur)
    if (idx < 0 && segs.length) idx = abs < segs[0].start ? 0 : segs.length - 1
    if (idx < 0) return a
    return { ...a, startSec: abs, link: { itemId: tl.items[idx].id, offset: abs - segs[idx].start } }
  }
  const gainOf = (a: TimelineAudioItem): number => a.gain ?? 1
  return (
    <div
      ref={laneRef}
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types || [])
        if (types.includes(MIME_SCORE) || types.includes(MIME_AUDIO)) e.preventDefault()
      }}
      onDrop={(e) => {
        const r = laneRef.current?.getBoundingClientRect()
        const frac = r ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0
        const start = Math.max(0, frac * total)
        const nid = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
        // ♪ score drop (v19 lane merge): lands on whichever lane the cursor is over
        const scoreId = e.dataTransfer.getData(MIME_SCORE)
        if (scoreId) {
          e.preventDefault()
          const sc = scoreClips.find((x) => x.id === scoreId)
          if (!sc) return
          const keeper = sc.takes.find((t) => t.id === sc.keeperTakeId) ?? sc.takes[sc.takes.length - 1]
          const span = Math.max(5, Math.round(keeper?.durationSec ?? 30))
          // COLLISION: never land on occupied ground — hop to the first clear lane (grow if none)
          const lane = freeLaneFor(start, start + span, Math.max(0, Math.min(laneCount - 1, laneAtY(e.clientY))))
          growTo(lane)
          void useStore.getState().setTimelineScoreItems(tl.id, [...(tl.scoreItems ?? []), { id: nid(), scoreClipId: sc.id, startSec: start, spanSec: span, lane: lane || undefined }], tl.rev)
          return
        }
        // ♫ Library track drop (v20 — the merged music lane): a teal file block on any lane
        const audioId = e.dataTransfer.getData(MIME_AUDIO)
        if (audioId) {
          e.preventDefault()
          const track = useStore.getState().project?.audio.find((x) => x.id === audioId)
          if (!track) return
          const len = Math.max(1, track.durationSec ?? 60)
          const lane = freeLaneFor(start, start + len, Math.max(0, Math.min(laneCount - 1, laneAtY(e.clientY))))
          growTo(lane)
          // the first file item on the timeline drives the beat grid by default
          const hasGrid = (tl.audioItems ?? []).some((x) => x.beatGrid)
          void setTimelineAudioItems(
            [...fresh(), { id: nid(), lane, source: { audioId }, startSec: start, inSec: 0, outSec: len, ...(hasGrid ? {} : { beatGrid: true }) }],
            tl.id
          )
        }
      }}
      style={{ position: 'relative', height: topOf(laneCount), background: 'var(--bg0)' }}
    >
      {Array.from({ length: Math.max(0, laneCount - 1) }, (_, i) => i + 1).map((l) => (
        <div key={l} style={{ position: 'absolute', left: 0, right: 0, top: topOf(l), borderTop: '1px dashed var(--line)', opacity: 0.5, pointerEvents: 'none' }} />
      ))}
      <span style={{ position: 'absolute', left: 4, top: 0, fontSize: 8, color: 'var(--dim)', pointerEvents: 'none' }}>audio — clips · ♪ scores</span>
      {/* LINKED companions (always visible; blue tint; mirror their video block exactly) */}
      {companions.map((c) => (
        <div
          key={'comp:' + c.it.id}
          onMouseDown={() => useStore.getState().selectTlItem(c.it.id)} // linked selection: the blue half selects the whole clip (Premiere)
          onDoubleClick={(e) => {
            e.stopPropagation()
            useStore.getState().toggleAudioLane(c.lane) // THIS lane only (per-lane view)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, id: 'comp:' + c.it.id })
          }}
          title={`${c.name} audio · 🔗 LINKED — moves/trims with its video block · double-click = volume view · right-click to unlink onto a lane${c.it.muted ? ' · MUTED' : ''}`}
          style={{
            position: 'absolute',
            top: topOf(c.lane) + 2,
            height: hOf(c.lane) - 4,
            left: `${(c.seg.start / total) * 100}%`,
            width: `${(c.seg.dur / total) * 100}%`,
            minWidth: 12,
            background: c.it.muted
              ? 'color-mix(in srgb, var(--alink) 12%, transparent)'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--alink) 40%, transparent), color-mix(in srgb, var(--alink) 22%, transparent))',
            border: '1px solid color-mix(in srgb, var(--alink) 60%, transparent)',
            borderRadius: 3,
            overflow: 'hidden',
            cursor: 'pointer',
            outline: selectedTlItemIdLanes === c.it.id ? '2px solid var(--amber)' : 'none',
            outlineOffset: 1
          }}
        >
          <LaneWave file={c.file} inSec={c.it.useRecipe ? 0 : (c.it.inSec ?? 0)} lenSec={c.seg.dur * (c.it.speed && c.it.speed > 0 ? c.it.speed : 1)} h={hOf(c.lane)} muted={c.it.muted} />
          <span style={{ position: 'relative', fontSize: 8.5, color: '#fff', paddingLeft: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px #000', lineHeight: `${hOf(c.lane) - 4}px`, display: 'block' }}>
            🔗 {c.name}
          </span>
          {/* v19: the VIDEO block's own volume, mixed here on its linked companion (that's the
              Premiere shape — the A-track half of a linked clip carries the audio keyframes) */}
          <VolumeBand
            lenSec={Math.max(0.25, c.seg.dur)}
            gain={c.it.gain ?? 1}
            points={c.it.volume}
            editable={hOf(c.lane) >= 48}
            onGain={(g) => {
              const cur = activeTimeline(useStore.getState().project)?.items ?? []
              void useStore.getState().setTimelineItems(cur.map((x) => (x.id === c.it.id ? { ...x, gain: g === 1 ? undefined : g } : x)), tl.id)
            }}
            onPoints={(pts) => {
              const cur = activeTimeline(useStore.getState().project)?.items ?? []
              void useStore.getState().setTimelineItems(cur.map((x) => (x.id === c.it.id ? { ...x, volume: pts.length ? pts : undefined } : x)), tl.id)
            }}
          />
        </div>
      ))}
      {/* FREE (unlinked) blocks — green tint, fully editable */}
      {items.map((a) => (
        <AudioItem key={a.id} a={view(a)} tl={tl} segs={segs} total={total} clips={clips} laneH={hOf(view(a).lane)} onGesture={onGesture} onMenu={(x, e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, id: x.id })
        }} onPatch={(id, patch) => void setTimelineAudioItems(fresh().map((x) => (x.id === id ? { ...x, ...patch } : x)), tl.id)} laneTop={topOf(view(a).lane)} />
      ))}
      {/* ♪ score blocks — merged onto these same lanes (v19): purple tint, full score grammar */}
      <ScoreBlocks tl={tl} total={total} scoreClips={scoreClips} laneH={LANE_H} laneCount={laneCount} occ={occ} snap={snap} />
      {menu && menu.id.startsWith('comp:') && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            {
              label: <>♪ unlink audio → lane (edit it separately)</>,
              onClick: () => onUnlink(menu.id.slice(5))
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && menuItem && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            {
              label: menuItem.link ? '🔗 unlink — free the audio (absolute time)' : '🔗 link — lock to the video block under it',
              onClick: () => void setTimelineAudioItems(fresh().map((x) => (x.id === menuItem.id ? toggleLink(x) : x)), tl.id)
            },
            // ♫ beat grid: only FILE items can drive beat snapping — flagging one unflags the rest
            ...('audioId' in menuItem.source
              ? [
                  {
                    label: <>{menuItem.beatGrid ? '⋮⋮ beat grid ✓ — turn off' : '⋮⋮ use for the beat grid (snap ticks)'}</>,
                    onClick: () =>
                      void setTimelineAudioItems(
                        fresh().map((x) => (x.id === menuItem.id ? { ...x, beatGrid: !menuItem.beatGrid || undefined } : { ...x, beatGrid: undefined })),
                        tl.id
                      )
                  } as MenuEntry
                ]
              : []),
            {
              label: menuItem.muted ? 'unmute' : 'mute',
              onClick: () => void setTimelineAudioItems(fresh().map((x) => (x.id === menuItem.id ? { ...x, muted: !x.muted || undefined } : x)), tl.id)
            },
            {
              label: <>fade in: {menuItem.fadeInSec ?? 0}s → {((menuItem.fadeInSec ?? 0) + 0.5) % 2.5}s</>,
              onClick: () =>
                void setTimelineAudioItems(
                  fresh().map((x) => (x.id === menuItem.id ? { ...x, fadeInSec: ((x.fadeInSec ?? 0) + 0.5) % 2.5 || undefined } : x)),
                  tl.id
                )
            },
            {
              label: <>fade out: {menuItem.fadeOutSec ?? 0}s → {((menuItem.fadeOutSec ?? 0) + 0.5) % 2.5}s</>,
              onClick: () =>
                void setTimelineAudioItems(
                  fresh().map((x) => (x.id === menuItem.id ? { ...x, fadeOutSec: ((x.fadeOutSec ?? 0) + 0.5) % 2.5 || undefined } : x)),
                  tl.id
                )
            },
            {
              label: <>gain: {Math.round(gainOf(menuItem) * 100)}% → {Math.round((gainOf(menuItem) >= 2 ? 0.25 : gainOf(menuItem) + 0.25) * 100)}%</>,
              onClick: () =>
                void setTimelineAudioItems(
                  fresh().map((x) => (x.id === menuItem.id ? { ...x, gain: (gainOf(x) >= 2 ? 0.25 : gainOf(x) + 0.25) === 1 ? undefined : (gainOf(x) >= 2 ? 0.25 : gainOf(x) + 0.25) } : x)),
                  tl.id
                )
            },
            {
              label: <><Ic i={Trash2} size={12} /> delete audio block</>,
              danger: true,
              onClick: () => void setTimelineAudioItems(fresh().filter((x) => x.id !== menuItem.id), tl.id)
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// ---- Premiere-style zoom navigator: the thumb IS the visible window — drag it to pan, drag its
// ENDS to zoom (resize = zoom), double-click to fit ----
function ZoomNav({ zoom, zoomTo, scrollRef }: { zoom: number; zoomTo: (nz: number, leftFrac: number) => void; scrollRef: React.RefObject<HTMLDivElement> }): React.JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 1 })
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const upd = (): void => {
      const w = sc.clientWidth * zoom
      setView({ left: w > 0 ? sc.scrollLeft / w : 0, width: 1 / zoom })
    }
    upd()
    sc.addEventListener('scroll', upd)
    const ro = new ResizeObserver(upd)
    ro.observe(sc)
    return () => {
      sc.removeEventListener('scroll', upd)
      ro.disconnect()
    }
  }, [zoom, scrollRef])
  const gesture = (kind: 'move' | 'l' | 'r', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    const sc = scrollRef.current
    if (!bar || !sc) return
    const bw = bar.getBoundingClientRect().width
    const x0 = e.clientX
    const startLeft = view.left
    const startW = view.width
    const move = (ev: MouseEvent): void => {
      const df = (ev.clientX - x0) / bw
      if (kind === 'move') {
        const nl = Math.max(0, Math.min(1 - startW, startLeft + df))
        sc.scrollLeft = nl * sc.clientWidth * zoom
      } else if (kind === 'l') {
        const nl = Math.max(0, Math.min(startLeft + startW - 1 / 8, startLeft + df))
        const nw = startLeft + startW - nl // right edge anchored
        zoomTo(1 / nw, nl)
      } else {
        const nw = Math.max(1 / 8, Math.min(1 - startLeft, startW + df)) // left edge anchored
        zoomTo(1 / nw, startLeft)
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div ref={barRef} onDoubleClick={() => zoomTo(1, 0)} title="navigator — drag the bar to pan · drag its ends to zoom (like Premiere) · double-click = fit" style={{ position: 'relative', height: 12, margin: '3px 0 1px', background: 'var(--raised)', borderRadius: 6, overflow: 'hidden' }}>
      <div
        onMouseDown={(e) => gesture('move', e)}
        style={{ position: 'absolute', top: 1, bottom: 1, left: `${view.left * 100}%`, width: `${Math.max(0.02, view.width) * 100}%`, minWidth: 22, background: 'color-mix(in srgb, var(--amber) 35%, var(--raised2))', border: '1px solid var(--amber-dim)', borderRadius: 5, cursor: 'grab' }}
      >
        <div onMouseDown={(e) => gesture('l', e)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'linear-gradient(90deg, var(--amber), transparent)', borderRadius: '5px 0 0 5px' }} />
        <div onMouseDown={(e) => gesture('r', e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'linear-gradient(270deg, var(--amber), transparent)', borderRadius: '0 5px 5px 0' }} />
      </div>
    </div>
  )
}

// ---- Timeline v2: absolute-time Premiere tracks — gaps legal, multiple video tracks, free
// drag with snapping, markers, in/out range, dissolves, speed, rail with add/delete/mute/solo/lock.
// The playhead is the store's GLOBAL CLOCK (tlTime); the Monitor's engine advances it. ----
const ROW_H_DEF = 56 // default video track row height (live value = store tlRowH, drag-resized in the rail)
const FPS_NUDGE = 1 / 24
// marker palette — the Premiere eight + the theme default (undefined = --amber). Data colors,
// like BEAT_COLORS: a picked color must survive theme switches, so they stay literal.
const MARKER_COLORS: (string | undefined)[] = [undefined, '#4caf50', '#e53935', '#ab47bc', '#fb8c00', '#fdd835', '#ffffff', '#42a5f5', '#26c6da']

export function TimelinePanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const clips = project?.clips ?? []
  const tlObj = activeTimeline(project)
  const timeline = activeItems(project)
  const selectedTlItemId = useStore((s) => s.selectedTlItemId)
  const selectTlItem = useStore((s) => s.selectTlItem)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const tlLoop = useStore((s) => s.tlLoop)
  const tlPlay = useStore((s) => s.tlPlay)
  const tlPause = useStore((s) => s.tlPause)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const tlSeek = useStore((s) => s.tlSeek)
  const snapPlayhead = useStore((s) => s.snapPlayhead)
  const snapBeats = useStore((s) => s.snapBeats)
  const toggleSnapPlayhead = useStore((s) => s.toggleSnapPlayhead)
  const toggleSnapBeats = useStore((s) => s.toggleSnapBeats)
  const showFilmstrips = useStore((s) => s.showFilmstrips)
  const toggleFilmstrips = useStore((s) => s.toggleFilmstrips)
  const setTimelineItems = useStore((s) => s.setTimelineItems)
  const setTimelineMeta = useStore((s) => s.setTimelineMeta)
  const setTimelineMutes = useStore((s) => s.setTimelineMutes)
  const unlinkAudio = useStore((s) => s.unlinkAudio)
  const tlClipboard = useStore((s) => s.tlClipboard)
  const pasteTlClipboard = useStore((s) => s.pasteTlClipboard)
  const makeClipsFromImages = useStore((s) => s.makeClipsFromImages)
  const addToTimeline = useStore((s) => s.addToTimeline)
  const sliceItem = useStore((s) => s.sliceItem)
  const editTimelineSlot = useStore((s) => s.editTimelineSlot)
  const startExport = useStore((s) => s.startExport)
  const exportState = useStore((s) => s.exportState)
  const mirrorDisplayId = useStore((s) => s.mirrorDisplayId)
  const setMirrorDisplay = useStore((s) => s.setMirrorDisplay)

  const [zoom, setZoom] = useState(1)
  const [sliceMode, setSliceMode] = useState(false)
  const [outMenu, setOutMenu] = useState<{ x: number; y: number; displays: { id: number; label: string; width: number; height: number }[] } | null>(null)
  const [gapMenu, setGapMenu] = useState<{ x: number; y: number; track: number; at: number } | null>(null)
  const [markerMenu, setMarkerMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [markerDrag, setMarkerDrag] = useState<{ id: string; at: number; x: number; y: number } | null>(null) // live marker drag + its timecode chip
  const [dragView, setDragView] = useState<Map<string, { startSec: number; track: number }> | null>(null) // live gesture preview
  const [dragTrim, setDragTrim] = useState<{ id: string; inSec: number; outSec: number; startSec: number; side: 'in' | 'out' } | null>(null)
  const [dragTail, setDragTail] = useState<{ id: string; endSec: number } | null>(null) // ⟲ live tail-grip drag
  const [snapFlash, setSnapFlash] = useState<number | null>(null) // timeline sec where a drag just snapped
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [marqueeSel, setMarqueeSel] = useState<Set<string>>(new Set())
  const [gapSel, setGapSel] = useState<{ track: number; t0: number; t1: number } | null>(null) // clicked GAP — Del ripple-closes it
  const [selFwd, setSelFwd] = useState(false) // A = select-forward tool armed (one-shot; V/Esc cancels)
  const [railMenu, setRailMenu] = useState<{ x: number; y: number; track: number | null } | null>(null) // right-click on the track rail (null track = rail background)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const trimming = useRef(false)
  const justDragged = useRef(false)

  const vTracks = Math.max(1, tlObj?.videoTracks ?? 1)
  const laneCount = Math.max(1, tlObj?.audioTracks ?? 3)
  const locked = new Set(tlObj?.lockedTracks ?? [])
  const mutedTr = new Set(tlObj?.mutedTracks ?? [])
  const soloTr = new Set(tlObj?.soloTracks ?? [])
  // row heights are live view chrome (persisted app-wide): drag a rail row's bottom edge to resize
  // that kind uniformly; drag the video/audio divider to rebalance. Shadows the module default.
  const ROW_H = useStore((s) => s.tlRowH) || ROW_H_DEF
  // v19: expanded lanes (double-click an audio block) grow tall PER LANE so volume bands edit
  const expandedAudioLanes = useStore((s) => s.expandedAudioLanes)
  const LANE_HV = useStore((s) => s.tlLaneH) || 22
  const laneHOf = (l: number): number => (expandedAudioLanes.includes(l) ? 64 : LANE_HV)
  const setTlHeights = useStore((s) => s.setTlHeights)
  const dragHeights = (e: React.MouseEvent, kind: 'row' | 'lane' | 'divider'): void => {
    e.preventDefault()
    e.stopPropagation()
    const y0 = e.clientY
    const r0 = ROW_H
    const l0 = LANE_HV
    const move = (ev: MouseEvent): void => {
      const dy = ev.clientY - y0
      if (kind === 'row') setTlHeights({ rowH: Math.round(Math.min(120, Math.max(28, r0 + dy))) })
      else if (kind === 'lane') setTlHeights({ laneH: Math.round(Math.min(56, Math.max(14, l0 + dy))) })
      // the Premiere middle bar: dragging the split resizes the video rows so the boundary follows the mouse
      else setTlHeights({ rowH: Math.round(Math.min(120, Math.max(28, r0 + dy / Math.max(1, vTracks)))) })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // rail chip (👁/M/S/🔒) + toggle-in-list helpers — shared by the video rows AND the audio lanes
  const togg = (list: string[] | undefined, k: string): string[] => (list?.includes(k) ? (list ?? []).filter((x) => x !== k) : [...(list ?? []), k])
  const chip = (label: string, on: boolean, color: string, title: string, onClick: () => void): React.JSX.Element => (
    <span
      onClick={onClick}
      title={title}
      // ONE chip box — 18×14, glyph centered: emoji and letters render identical squares
      // (user catch 2026-08-19: content-sized chips made every square a different size)
      style={{ cursor: 'pointer', width: 18, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, borderRadius: 3, border: `1px solid ${on ? color : 'var(--line2)'}`, color: on ? '#000' : 'var(--dim)', background: on ? color : 'transparent', fontWeight: 700, userSelect: 'none', flex: '0 0 auto' }}
    >
      {label}
    </span>
  )
  const clipOf = (clipId: string): Clip | undefined => clips.find((c) => c.id === clipId)
  const eff = (it: TimelineItem): number => effDur(it, clips)
  const nameOf = (clipId: string): string => clipOf(clipId)?.name ?? '?'
  const viewOf = (it: TimelineItem): ReturnType<typeof resolveView> | undefined => {
    const c = clipOf(it.clipId)
    return c ? resolveView(c, it) : undefined
  }
  const beatsOf = (it: TimelineItem): BeatField[] => viewOf(it)?.beats ?? []
  const beatImgsOf = (it: TimelineItem): (string | undefined)[] => {
    const v = viewOf(it)
    return v ? beatImgUrls(v.beats, v.beatFreeform, project?.images ?? []) : []
  }
  const firstImageOf = (it: TimelineItem): string | undefined => {
    const faceId = clipOf(it.clipId)?.storyboardImageId
    const faceFile = faceId ? project?.images.find((i) => i.id === faceId)?.file : undefined
    if (faceFile) return faceFile
    const id = viewOf(it)?.recipe.imageIds?.[0]
    return id ? project?.images.find((i) => i.id === id)?.file : undefined
  }
  const takeFileOf = (it: TimelineItem): string | undefined => viewOf(it)?.take?.file
  const takeLabel = (it: TimelineItem): string => {
    const c = clipOf(it.clipId)
    if (!c) return '?'
    if (it.useRecipe) return 'S-B · storyboard'
    const take = viewOf(it)?.take
    if (!take) return c.takes.length ? 'S-B · storyboard' : 'no take'
    const idx = Math.max(0, c.takes.findIndex((t) => t.id === take.id))
    return `take ${idx + 1}${c.takes.length > 1 ? '/' + c.takes.length : ''}${it.speed && it.speed !== 1 ? ` · ${it.speed}×` : ''}`
  }
  const takesOf = (clipId: string): { id: string; label: string }[] => [
    { id: 'C', label: 'S-B — storyboard' },
    ...(clipOf(clipId)?.takes ?? []).map((t, i) => ({ id: t.id, label: `take ${i + 1}${t.disabled ? ' (disabled)' : ''}` }))
  ]
  const curTakeId = (it: TimelineItem): string | undefined => {
    if (it.useRecipe) return 'C'
    return viewOf(it)?.take?.id ?? (clipOf(it.clipId)?.takes.length ? undefined : 'C')
  }
  const freshItems = (): TimelineItem[] => activeItems(useStore.getState().project)
  // view length = content + breathing room: the ruler always runs past the last clip so there
  // is empty track to scroll into and drop on (drops past the end just land there and extend
  // the next tail). Playback/export still use the true content end — this is view-only.
  const musicEnd = audioEndOf(activeTimeline(project), project?.audio ?? []) // ⟲ tails + ruler reach the FULL audio end (music, detached audio, ♪ scores)
  const contentEnd = timelineEnd(timeline, clips, musicEnd)
  const total = Math.max(contentEnd, 1) + Math.max(8, contentEnd * 0.15)
  const segs = timeline.map((it) => ({ start: startOf(it), dur: eff(it) })) // index-aligned with `timeline`

  // gesture-preview overlay: geometry with any in-flight drag applied
  const posOf = (it: TimelineItem): { start: number; track: number } => {
    const d = dragView?.get(it.id)
    if (d) return { start: d.startSec, track: d.track }
    if (dragTrim && dragTrim.id === it.id) return { start: dragTrim.startSec, track: trackOf(it) }
    return { start: startOf(it), track: trackOf(it) }
  }
  const winOf = (it: TimelineItem): { inSec?: number; outSec?: number } =>
    dragTrim && dragTrim.id === it.id ? { inSec: dragTrim.inSec, outSec: dragTrim.outSec } : { inSec: it.inSec, outSec: it.outSec }
  const effView = (it: TimelineItem): number => {
    if (dragTrim && dragTrim.id === it.id) {
      const sp = it.speed && it.speed > 0 ? it.speed : 1
      return Math.max(0.25, (dragTrim.outSec - dragTrim.inSec) / sp)
    }
    return eff(it)
  }
  // ⟲ loop tail end (with any in-flight grip drag applied)
  const tailEndView = (it: TimelineItem): number => {
    const base = posOf(it).start + effView(it)
    if (dragTail && dragTail.id === it.id) {
      const next = nextOnTrackStart(it, timeline)
      return Math.max(base, Math.min(dragTail.endSec, next ?? Infinity))
    }
    return tailEndOf(it, timeline, clips, musicEnd)
  }

  // ---- geometry helpers ----
  const secPerPx = (): number => {
    const w = wrapRef.current?.getBoundingClientRect().width ?? 1
    return total / Math.max(1, w)
  }
  const timeAtClientX = (clientX: number): number => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(total, ((clientX - r.left) / Math.max(1, r.width)) * total))
  }
  // ONE MAGNET: the master snap toggle gates the WHOLE target set — magnet off, nothing snaps
  // (the Premiere model; edges used to snap unconditionally, which made the button a lie).
  // Beats ride their OWN toggle: ungated they flood the list every half second.
  // v20: the beat grid comes from the file-audio item flagged ♫ beatGrid (the merged music);
  // pre-migration tl.music still feeds it until the app restarts and converts.
  const beatItem = (tlObj?.audioItems ?? []).find((a) => a.beatGrid && 'audioId' in a.source)
  const legacyMusic = tlObj?.music
  const gridSrc = beatItem
    ? { audioId: (beatItem.source as { audioId: string }).audioId, startSec: beatItem.startSec, inSec: beatItem.inSec, outSec: beatItem.outSec as number | undefined }
    : legacyMusic
      ? { audioId: legacyMusic.audioId, startSec: legacyMusic.startSec, inSec: legacyMusic.inSec ?? 0, outSec: legacyMusic.outSec }
      : undefined
  const musicTrackForSnap = gridSrc ? project?.audio.find((a) => a.id === gridSrc.audioId) : undefined
  const snapWave = useWave(musicTrackForSnap?.file, !!gridSrc && snapBeats)
  const beatTimesTl = useMemo(() => {
    if (!snapWave || !gridSrc || !snapBeats) return [] as number[]
    const inS = gridSrc.inSec ?? 0
    const outS = Math.min(gridSrc.outSec ?? snapWave.dur, snapWave.dur)
    return snapWave.beats.filter((t) => t >= inS && t <= outS).map((t) => gridSrc.startSec + (t - inS)).filter((t) => t > 0 && t < total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapWave, gridSrc?.audioId, gridSrc?.startSec, gridSrc?.inSec, gridSrc?.outSec, total, snapBeats])
  const snapTargets = (excludeIds: Set<string>, excludeMarkerId?: string): number[] => {
    const out: number[] = []
    if (snapPlayhead) {
      out.push(0)
      for (const it of timeline) {
        if (excludeIds.has(it.id)) continue
        out.push(startOf(it), startOf(it) + eff(it))
      }
      // audio + score edges are targets too — "everything snaps to everything" (user law 2026-08-19)
      for (const a of tlObj?.audioItems ?? []) {
        // a linked rider RIDES the excluded video block — its edges sit exactly on that block's
        // edges and would pin the block to its own origin (12px dead zone, review catch)
        if (excludeIds.has(a.id) || (a.link && excludeIds.has(a.link.itemId))) continue
        const s = audioStartOf(a, segs, tlObj!.items)
        out.push(s, s + Math.max(0.25, a.outSec - a.inSec))
      }
      for (const sIt of tlObj?.scoreItems ?? []) {
        if (excludeIds.has(sIt.id)) continue
        out.push(sIt.startSec, sIt.startSec + sIt.spanSec)
      }
      // legacy (un-migrated) music block — start edge only, its length is lazily learned
      if (tlObj?.music && !excludeIds.has('music:legacy')) out.push(tlObj.music.startSec)
      for (const m of tlObj?.markers ?? []) if (m.id !== excludeMarkerId) out.push(m.at)
      if (tlObj?.rangeInSec != null) out.push(tlObj.rangeInSec)
      if (tlObj?.rangeOutSec != null) out.push(tlObj.rangeOutSec)
      out.push(useStore.getState().tlTime)
    }
    if (snapBeats) out.push(...beatTimesTl)
    return out
  }
  const applySnap = (t: number, targets: number[], alsoEdge?: number): { t: number; hit: number | null } => {
    const tol = 12 * secPerPx() // 12px of magnet — 8 was too shy to feel
    let best: number | null = null
    let bd = tol
    for (const c of targets) {
      const d1 = Math.abs(t - c)
      if (d1 < bd) {
        bd = d1
        best = c
      }
      if (alsoEdge != null) {
        const d2 = Math.abs(t + alsoEdge - c)
        if (d2 < bd) {
          bd = d2
          best = c - alsoEdge
        }
      }
    }
    return best != null ? { t: best, hit: best } : { t, hit: null }
  }
  const flashSnap = (at: number | null): void => {
    setSnapFlash(at)
    if (at != null) window.setTimeout(() => setSnapFlash((v) => (v === at ? null : v)), 260)
  }
  // ---- marker drag: >3px = move (snapping, exact timecode chip riding above); a still press
  // stays a CLICK = jump (the old behavior). One write on release, one undo.
  // POINTER listeners, not mouse: a canceled pointerdown sets Chromium's prevent-mouse-event
  // flag, so window mouse listeners never fire during the press and then LEAK onto later
  // hovers/clicks (review catch 2026-08-19 — markers were dead AND haunted). ----
  const startMarkerDrag = (m: TimelineMarker, e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation() // the ruler underneath must not start a scrub
    const x0 = e.clientX
    let moved = false
    let finalAt = m.at
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      moved = true
      let t = timeAtClientX(ev.clientX)
      if (!ev.shiftKey) {
        const res = applySnap(t, snapTargets(new Set(), m.id))
        t = res.t
        if (res.hit != null) flashSnap(res.hit)
      }
      finalAt = Math.max(0, Math.min(total, t))
      const r = wrapRef.current?.getBoundingClientRect()
      const px = r ? r.left + (finalAt / total) * r.width : ev.clientX
      setMarkerDrag({ id: m.id, at: finalAt, x: px, y: (r?.top ?? ev.clientY) - 24 })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarkerDrag(null)
      if (!moved) {
        tlSeek(m.at) // click = jump, unchanged
        return
      }
      // commit against FRESH state — the render-time tlObj is a gesture-start snapshot, and a
      // whole-array write from it deletes markers added mid-drag (M key, review catch)
      const tlNow = activeTimeline(useStore.getState().project)
      if (tlNow) void setTimelineMeta({ markers: (tlNow.markers ?? []).map((x) => (x.id === m.id ? { ...x, at: finalAt } : x)) }, tlNow.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // ONE MAGNET, handed to the lanes (audio items, scores, legacy music) — same targets, 12px, flash
  const snapKit: SnapKit = { targets: snapTargets, apply: applySnap, flash: flashSnap }
  // ⟲ tail grip drag — the same edge grammar as a block trim: grab, drag, snap, release.
  // Release against the wall (the elastic fill end) = back to auto-fill; anywhere else stores
  // the tail LENGTH (rides moves/ripples). One write, one undo.
  const startTailDrag = (it: TimelineItem, e: React.MouseEvent): void => {
    if (locked.has(`v${trackOf(it)}`)) return
    e.preventDefault()
    e.stopPropagation()
    const base = startOf(it) + eff(it)
    const next = nextOnTrackStart(it, timeline)
    let moved = false
    const move = (ev: MouseEvent): void => {
      moved = true
      justDragged.current = true
      let t = timeAtClientX(ev.clientX)
      let hit: number | null = null
      if (!ev.shiftKey) {
        const res = applySnap(t, snapTargets(new Set()))
        t = res.t
        hit = res.hit
      }
      t = Math.max(base, Math.min(t, next ?? total))
      dragTailRef.current = { id: it.id, endSec: t }; setDragTail(dragTailRef.current) // ref written SYNC — a micro-drag mouseup can beat the passive effect sync
      if (hit != null) flashSnap(hit)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.setTimeout(() => (justDragged.current = false), 0)
      const fin = dragTailRef.current
      dragTailRef.current = null; setDragTail(null)
      if (!moved || !fin) return
      const items = freshItems()
      const live = items.find((x) => x.id === it.id)
      if (!live) return
      const elastic = tailEndOf({ ...live, loopTailSec: undefined }, items, clips, musicEnd)
      const tol = Math.max(0.03, 6 * secPerPx())
      const tail = Math.abs(fin.endSec - elastic) < tol ? undefined : Math.max(0, Math.round((fin.endSec - base) * 1000) / 1000)
      void setTimelineItems(items.map((x) => (x.id === it.id ? { ...x, loopTailSec: tail } : x)))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // PREMIERE OVERWRITE: dropped blocks carve their spans out of whatever sits under them on the
  // target track — middle hits split into remnants, edge hits trim, covered blocks vanish.
  // Storyboard (S-B) blocks can't be trimmed, so instead of carving they get pushed right.
  const carve = (items: TimelineItem[], moving: Map<string, { startSec: number; track: number }>): TimelineItem[] => {
    const spans: { track: number; t0: number; t1: number }[] = []
    for (const [id, pos] of moving) {
      const src = items.find((x) => x.id === id)
      if (src) spans.push({ track: pos.track, t0: pos.startSec, t1: pos.startSec + eff(src) })
    }
    const out: TimelineItem[] = []
    for (const x of items) {
      if (moving.has(x.id)) {
        out.push(x)
        continue
      }
      // a LOCKED track's blocks are untouchable — a drop landing over them must never trim or
      // split them (the mover simply overlaps; topmost-track-wins keeps playback deterministic)
      if (locked.has(`v${trackOf(x)}`)) {
        out.push(x)
        continue
      }
      let pieces: TimelineItem[] = [x]
      for (const s of spans) {
        const next: TimelineItem[] = []
        for (const p of pieces) {
          const p0 = startOf(p)
          const p1 = p0 + eff(p)
          if (trackOf(p) !== s.track || p1 <= s.t0 + 0.001 || p0 >= s.t1 - 0.001) {
            next.push(p)
            continue
          }
          if (p.useRecipe) {
            next.push({ ...p, startSec: s.t1 }) // untrimmable — slide past instead
            continue
          }
          const sp = p.speed && p.speed > 0 ? p.speed : 1
          const srcD = sourceDurOf(p, clips)
          const inS = p.inSec ?? 0
          const outS = Math.min(p.outSec ?? srcD, srcD)
          const left = s.t0 - p0 > 0.15
          if (left) next.push({ ...p, outSec: inS + (s.t0 - p0) * sp, transitionOutSec: undefined })
          if (p1 - s.t1 > 0.15) {
            const nid = left ? (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`) : p.id
            next.push({ ...p, id: nid, inSec: inS + (s.t1 - p0) * sp, outSec: outS, startSec: s.t1 })
          }
        }
        pieces = next
      }
      out.push(...pieces)
    }
    return out
  }

  // ---- block gestures: mouse-based free drag (move / Alt=duplicate / group via marquee set) ----
  const startMove = (it: TimelineItem, e: React.MouseEvent): void => {
    if (sliceMode || trimming.current) return
    if (locked.has(`v${trackOf(it)}`)) return
    e.preventDefault()
    setGapSel(null)
    const spp = secPerPx()
    const x0 = e.clientX
    const y0 = e.clientY
    const isDup = e.altKey
    const group = marqueeSel.has(it.id) && marqueeSel.size > 1 ? [...marqueeSel] : [it.id]
    // members on LOCKED tracks stay put — a marquee sweeping a locked row must not drag it along
    const base = new Map(
      freshItems()
        .filter((x) => group.includes(x.id) && !locked.has(`v${trackOf(x)}`))
        .map((x) => [x.id, { startSec: startOf(x), track: trackOf(x) }])
    )
    if (base.size === 0) return
    let moved = false
    let dupIds: Map<string, string> | null = null // original → duplicate id (Alt-drag)
    const move = (ev: MouseEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return
      moved = true
      justDragged.current = true
      const dt = (ev.clientX - x0) * spp
      const dTrack = Math.round((ev.clientY - y0) / ROW_H)
      const next = new Map<string, { startSec: number; track: number }>()
      let snapHit: number | null = null
      // anchor snapping on the grabbed item; the group keeps relative offsets.
      // Shift = HOLD TIME (Premiere): the block only changes track, its start is locked.
      const b0 = base.get(it.id)!
      let aStart = Math.max(0, b0.startSec + dt)
      if (ev.shiftKey) {
        aStart = b0.startSec
      } else {
        const res = applySnap(aStart, snapTargets(new Set(group)), eff(it))
        aStart = Math.max(0, res.t)
        snapHit = res.hit
      }
      // rows render top-down from the HIGHEST track, so dragging UP (negative dY) must RAISE the track
      let aTrack = Math.max(0, Math.min(vTracks - 1, b0.track - dTrack))
      if (locked.has(`v${aTrack}`)) aTrack = b0.track // a locked row takes no drops
      // wall clamp by the GROUP's minimum, not per member — per-member clamping collapsed
      // relative offsets at the left wall (members landed permanently overlapping on one track)
      let minRel = 0
      for (const [, b] of base) minRel = Math.min(minRel, b.startSec - b0.startSec)
      aStart = Math.max(-minRel, aStart)
      for (const [id, b] of base) {
        const rel = b.startSec - b0.startSec
        const tr = Math.max(0, Math.min(vTracks - 1, b.track + (aTrack - b0.track)))
        // overlap allowed in the preview — the drop overwrites (carves) what's underneath
        next.set(id, { startSec: Math.max(0, aStart + rel), track: tr })
      }
      dragViewRef.current = next; setDragView(next) // ref written SYNC — a micro-drag mouseup can beat the passive effect sync
      if (snapHit != null) flashSnap(snapHit)
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.setTimeout(() => (justDragged.current = false), 0)
      const finalView = dragViewRef.current
      dragViewRef.current = null; setDragView(null)
      if (!moved || !finalView) return
      const cur = freshItems()
      if (isDup) {
        const fresh: TimelineItem[] = []
        for (const [id, pos] of finalView) {
          const src = cur.find((x) => x.id === id)
          if (!src) continue
          const nid = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
          fresh.push({ ...src, id: nid, startSec: pos.startSec, track: pos.track, audioDetachedId: undefined })
        }
        const mv = new Map(fresh.map((f) => [f.id, { startSec: f.startSec ?? 0, track: f.track ?? 0 }]))
        void setTimelineItems(carve([...cur, ...fresh], mv))
      } else if (ev.ctrlKey || ev.metaKey) {
        // Ctrl-drop = INSERT (Premiere): instead of overwriting, everything at/after the drop
        // point shoves right by the dropped span — every unlocked channel + free audio
        let lo = Infinity
        let hi = 0
        for (const [id, pos] of finalView) {
          const src = cur.find((x) => x.id === id)
          if (!src) continue
          lo = Math.min(lo, pos.startSec)
          hi = Math.max(hi, pos.startSec + eff(src))
        }
        const span = Math.max(0, hi - lo)
        if (!isFinite(lo) || span < 0.001) return
        void setTimelineBoth(
          cur.map((x) => {
            if (finalView.has(x.id)) return { ...x, startSec: finalView.get(x.id)!.startSec, track: finalView.get(x.id)!.track }
            if (!locked.has(`v${trackOf(x)}`) && startOf(x) >= lo - 0.001) return { ...x, startSec: startOf(x) + span }
            return x
          }),
          freeAudioShifted(lo, span)
        )
      } else {
        const positioned = cur.map((x) => (finalView.has(x.id) ? { ...x, startSec: finalView.get(x.id)!.startSec, track: finalView.get(x.id)!.track } : x))
        void setTimelineItems(carve(positioned, finalView))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const dragViewRef = useRef<Map<string, { startSec: number; track: number }> | null>(null)
  useEffect(() => {
    dragViewRef.current = dragView
  }, [dragView])
  const dragTailRef = useRef<{ id: string; endSec: number } | null>(null)
  useEffect(() => {
    dragTailRef.current = dragTail
  }, [dragTail])

  // the shifted FREE-audio lane array for a ripple (linked ones ride their video block).
  // Returns null when nothing shifts. Callers hand it to setTimelineBoth so one user action
  // lands as ONE main mutation = ONE undo step (two writes made Ctrl+Z visibly desync lanes).
  const freeAudioShifted = (fromT: number, delta: number): TimelineAudioItem[] | null => {
    if (Math.abs(delta) < 0.001) return null
    const aud = activeTimeline(useStore.getState().project)?.audioItems ?? []
    const shifts = (a: TimelineAudioItem): boolean => !a.link && (a.startSec ?? 0) >= fromT - 0.001
    return aud.some(shifts) ? aud.map((a) => (shifts(a) ? { ...a, startSec: Math.max(0, (a.startSec ?? 0) + delta) } : a)) : null
  }
  const setTimelineBoth = useStore((s) => s.setTimelineBoth)

  // ---- SLIP (Ctrl+Alt+drag the body): shift WHICH part of the take plays — in/out move together,
  // the block itself never moves and nothing ripples (length unchanged). Premiere's slip tool. ----
  const startSlip = (it: TimelineItem, e: React.MouseEvent): void => {
    if (it.useRecipe || locked.has(`v${trackOf(it)}`)) return
    const src = sourceDurOf(it, clips)
    const sp = it.speed && it.speed > 0 ? it.speed : 1
    const b = { inSec: it.inSec ?? 0, outSec: Math.min(it.outSec ?? src, src) }
    const win = b.outSec - b.inSec
    if (win >= src - 0.01) return // full clip on show — nothing to slip
    e.preventDefault()
    trimming.current = true
    const x0 = e.clientX
    const spp = secPerPx()
    let final = { ...b }
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - x0) * spp * sp // drag right = show LATER source (Premiere slip direction)
      const nIn = Math.max(0, Math.min(src - win, b.inSec + d))
      final = { inSec: nIn, outSec: nIn + win }
      setDragTrim({ id: it.id, side: 'in', inSec: final.inSec, outSec: final.outSec, startSec: startOf(it) })
    }
    const up = (): void => {
      trimming.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, inSec: final.inSec, outSec: final.outSec } : x))).then(() => setDragTrim(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- Q/W (Premiere): ripple-trim the clip under the playhead — Q removes [its start → playhead],
  // W removes [playhead → its end] — and everything after pulls left to close the span (all
  // unlocked channels + free audio, clamped so nothing collides). Selected clip wins if the
  // playhead is inside it; else the topmost visible clip. ----
  const rippleToPlayhead = (side: 'in' | 'out'): void => {
    const st = useStore.getState()
    const T = st.tlTime
    const items = freshItems()
    const inside = (x: TimelineItem): boolean => startOf(x) < T - 0.05 && T < startOf(x) + eff(x) - 0.05
    const sel = items.find((x) => x.id === st.selectedTlItemId)
    const it = sel && inside(sel) ? sel : itemAt(items, clips, T, hiddenVideoTracks())
    if (!it || !inside(it) || it.useRecipe || locked.has(`v${trackOf(it)}`)) return
    const sp = it.speed && it.speed > 0 ? it.speed : 1
    const src = sourceDurOf(it, clips)
    const b = { inSec: it.inSec ?? 0, outSec: Math.min(it.outSec ?? src, src), startSec: startOf(it) }
    const oldEnd = b.startSec + (b.outSec - b.inSec) / sp
    let patch: Partial<TimelineItem>
    let removed: number // timeline seconds removed
    let fromT: number // ripple start: everything at/after this pulls left
    if (side === 'in') {
      const nIn = Math.min(b.outSec - 0.25, b.inSec + (T - b.startSec) * sp)
      removed = (nIn - b.inSec) / sp
      if (removed < 0.02) return
      patch = { inSec: nIn }
      fromT = T
    } else {
      const nOut = Math.max(b.inSec + 0.25, b.outSec - (oldEnd - T) * sp)
      removed = (b.outSec - nOut) / sp
      if (removed < 0.02) return
      patch = { outSec: nOut }
      fromT = oldEnd
    }
    const shift = clampShiftLeft(items, clips, fromT, -removed, { id: it.id, newEnd: oldEnd - removed })
    void setTimelineBoth(
      items.map((x) => {
        if (x.id === it.id) return { ...x, ...patch }
        if (!locked.has(`v${trackOf(x)}`) && startOf(x) >= fromT - 0.001) return { ...x, startSec: Math.max(0, startOf(x) + shift) }
        return x
      }),
      freeAudioShifted(fromT, shift)
    )
  }

  // ---- trims: 'in' moves the left edge (startSec + inSec together); 'out' the right; Ctrl on a
  // flush boundary = ROLLING trim (both neighbors adjust, the join slides) ----
  const onTrimStart = (it: TimelineItem, side: 'in' | 'out', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (locked.has(`v${trackOf(it)}`)) return
    const spp = secPerPx()
    const x0 = e.clientX
    const sp = it.speed && it.speed > 0 ? it.speed : 1
    const src = sourceDurOf(it, clips)
    const b = { inSec: it.inSec ?? 0, outSec: Math.min(it.outSec ?? src, src), startSec: startOf(it) }
    // rolling partner: the block flush against this edge on the same track (Ctrl held)
    const edgeT = side === 'in' ? b.startSec : b.startSec + (b.outSec - b.inSec) / sp
    const partner = e.ctrlKey
      ? timeline.find((x) => x.id !== it.id && trackOf(x) === trackOf(it) && Math.abs(side === 'in' ? startOf(x) + eff(x) - edgeT : startOf(x) - edgeT) < 0.05)
      : undefined
    trimming.current = true
    let final = { ...b }
    let pFinal = partner ? { inSec: partner.inSec ?? 0, outSec: Math.min(partner.outSec ?? sourceDurOf(partner, clips), sourceDurOf(partner, clips)), startSec: startOf(partner) } : null
    // ONE MAGNET: trims snap too — the dragged EDGE (timeline time) pulls to the target set
    // (rebuilt per move so a running playhead stays a LIVE target), then the source-seconds
    // clamps apply. Flash only when the clamped edge actually LANDED on the target — flashing
    // a clamp-rejected snap asserted landings that never happened (review catches 2026-08-19).
    const trimExcl = new Set([it.id, ...(partner ? [partner.id] : [])])
    const edge0 = side === 'in' ? b.startSec : b.startSec + (b.outSec - b.inSec) / sp
    const move = (ev: MouseEvent): void => {
      let dT = (ev.clientX - x0) * spp // timeline seconds
      let hit: number | null = null
      if (!ev.shiftKey) {
        const res = applySnap(edge0 + dT, snapTargets(trimExcl))
        if (res.hit != null) {
          dT = res.t - edge0
          hit = res.hit
        }
      }
      const dS = dT * sp // source seconds for THIS item
      if (side === 'in') {
        const nIn = Math.max(0, Math.min(b.outSec - 0.25, b.inSec + dS))
        final = { inSec: nIn, outSec: b.outSec, startSec: Math.max(0, b.startSec + (nIn - b.inSec) / sp) }
      } else {
        const nOut = Math.max(b.inSec + 0.25, Math.min(src, b.outSec + dS))
        final = { inSec: b.inSec, outSec: nOut, startSec: b.startSec }
      }
      if (hit != null) {
        const landed = side === 'in' ? final.startSec : final.startSec + (final.outSec - final.inSec) / sp
        if (Math.abs(landed - hit) < 0.002) flashSnap(hit)
      }
      if (partner && pFinal) {
        const psp = partner.speed && partner.speed > 0 ? partner.speed : 1
        const pSrc = sourceDurOf(partner, clips)
        const pb = { inSec: partner.inSec ?? 0, outSec: Math.min(partner.outSec ?? pSrc, pSrc), startSec: startOf(partner) }
        if (side === 'in') {
          // my left edge moved by (final.startSec - b.startSec) → partner's out follows
          const dEdge = final.startSec - b.startSec
          pFinal = { inSec: pb.inSec, outSec: Math.max(pb.inSec + 0.25, Math.min(pSrc, pb.outSec + dEdge * psp)), startSec: pb.startSec }
        } else {
          const dEdge = (final.outSec - b.outSec) / sp
          const nIn = Math.max(0, Math.min(pb.outSec - 0.25, pb.inSec + dEdge * psp))
          pFinal = { inSec: nIn, outSec: pb.outSec, startSec: Math.max(0, pb.startSec + (nIn - pb.inSec) / psp) }
        }
      }
      setDragTrim({ id: it.id, side, ...final })
    }
    const up = (ev: MouseEvent): void => {
      trimming.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      // END trims RIPPLE: everything after the old end follows the edge (all channels + free
      // audio), keeping the sequence flush. Alt = leave the gap; rolling trims never ripple.
      const oldEff = (b.outSec - b.inSec) / sp
      const newEff = (final.outSec - final.inSec) / sp
      const oldEnd = b.startSec + oldEff
      let shift = side === 'out' && !partner && !ev.altKey ? newEff - oldEff : 0
      // pulling left — clamp so nothing collides with a block spanning the region on another track
      shift = clampShiftLeft(freshItems(), clips, oldEnd, shift, { id: it.id, newEnd: b.startSec + newEff })
      const doShift = Math.abs(shift) > 0.001
      void setTimelineBoth(
        freshItems().map((x) => {
          if (x.id === it.id) return { ...x, inSec: final.inSec, outSec: final.outSec, startSec: final.startSec }
          if (partner && pFinal && x.id === partner.id) return { ...x, inSec: pFinal.inSec, outSec: pFinal.outSec, startSec: pFinal.startSec }
          if (doShift && startOf(x) >= oldEnd - 0.001) return { ...x, startSec: Math.max(0, startOf(x) + shift) }
          return x
        }),
        doShift ? freeAudioShifted(oldEnd, shift) : null
      ).then(() => setDragTrim(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- slice ----
  const sliceAtTime = (it: TimelineItem, T: number): void => {
    const cutSrc = sourceTimeAt(it, clips, T)
    const src = sourceDurOf(it, clips)
    const inS = it.inSec ?? 0
    const outS = Math.min(it.outSec ?? src, src)
    if (cutSrc - inS < 0.15 || outS - cutSrc < 0.15) return
    void sliceItem(it.id, cutSrc)
    setSliceMode(false)
  }
  const razorAtPlayhead = (): void => {
    const st = useStore.getState()
    const T = st.tlTime
    const items = freshItems()
    // the SELECTED clip wins when the playhead is inside it (stand-in for track targeting)
    const sel = items.find((x) => x.id === st.selectedTlItemId)
    const selHit = sel && startOf(sel) < T - 0.05 && T < startOf(sel) + eff(sel) - 0.05 ? sel : undefined
    const it = selHit ?? itemAt(items, clips, T, hiddenVideoTracks())
    // ⟲ never cut inside a tail — there's no block there, only the projection
    if (it && takeFileOf(it) && T < startOf(it) + eff(it) - 0.05) sliceAtTime(it, T)
  }
  const hiddenVideoTracks = (): Set<number> => {
    const hidden = new Set<number>()
    const solos = [...soloTr].filter((t) => t.startsWith('v'))
    for (let t = 0; t < vTracks; t++) {
      const key = `v${t}`
      if (solos.length ? !solos.includes(key) : mutedTr.has(key)) hidden.add(t)
    }
    return hidden
  }

  // ---- ripple delete + close gap — through the SAME collision clamp as Q/W/end-trim/take-
  // switch (one behavior, five verbs): pulling left must stop where a block spanning the region
  // on another track would be overlapped (same-track overlaps have no deterministic winner) ----
  const rippleDelete = (it: TimelineItem): void => {
    const cur = freshItems().filter((x) => x.id !== it.id)
    const len = eff(it)
    const from = startOf(it) + len
    const shift = clampShiftLeft(cur, clips, from, -len)
    if (shift >= -0.001) {
      void setTimelineItems(cur)
      return
    }
    void setTimelineBoth(
      cur.map((x) => (!locked.has(`v${trackOf(x)}`) && startOf(x) >= from - 0.001 ? { ...x, startSec: Math.max(0, startOf(x) + shift) } : x)),
      freeAudioShifted(from, shift)
    )
  }
  const closeGap = (track: number, at: number): void => {
    const cur = freshItems()
    // the gap around `at` on this track: [prev end, next start]
    let gs = 0
    let ge = Infinity
    for (const x of cur) {
      if (trackOf(x) !== track) continue
      const s = startOf(x)
      const e2 = s + eff(x)
      if (e2 <= at && e2 > gs) gs = e2
      if (s >= at && s < ge) ge = s
    }
    if (!isFinite(ge) || ge - gs < 0.01) return
    const shift = clampShiftLeft(cur, clips, ge, -(ge - gs))
    if (shift >= -0.001) return
    void setTimelineBoth(
      cur.map((x) => (!locked.has(`v${trackOf(x)}`) && startOf(x) >= ge - 0.001 ? { ...x, startSec: Math.max(0, startOf(x) + shift) } : x)),
      freeAudioShifted(ge, shift)
    )
  }

  // ---- drops (bins/library) land at drop TIME on the hovered track ----
  const dropOnTrack = (track: number, e: React.DragEvent): void => {
    e.preventDefault()
    const T = timeAtClientX(e.clientX)
    const imgs = e.dataTransfer.getData(MIME_IMAGES)
    if (imgs) {
      try {
        const ids = JSON.parse(imgs) as string[]
        // images become clips appended at the END index-wise; then re-place at the drop time
        if (Array.isArray(ids) && ids.length) void makeClipsFromImages(ids, freshItems().length).then(() => placeLastAt(ids.length, T, track))
      } catch {
        /* ignore */
      }
      return
    }
    const takeData = e.dataTransfer.getData(MIME_TAKE)
    if (takeData) {
      try {
        const o = JSON.parse(takeData) as { clipId?: string; takeId?: string; inSec?: number; outSec?: number }
        if (o.clipId) void addAt(o.clipId, T, track, o.takeId, { inSec: o.inSec, outSec: o.outSec })
      } catch {
        /* ignore */
      }
      return
    }
    // a Video Editor tree node → bake to a NEW clip, block placed at the drop time
    const vnode = e.dataTransfer.getData(MIME_VEDITNODE)
    if (vnode) {
      try {
        const o = JSON.parse(vnode) as { sessionId?: string; nodeId?: string }
        if (o.sessionId && o.nodeId)
          void window.vidancer.veditBakeClip(o.sessionId, o.nodeId, {}).then((r) => {
            if (!r) return
            useStore.getState().applyDelta(r.delta)
            void addAt(r.clipId, T, track)
          })
      } catch {
        /* malformed drag payload — ignore */
      }
      return
    }
    // a Library video → auto-make a footage-first clip (video as take 1), placed at the drop time
    const vid = e.dataTransfer.getData(MIME_VIDEO)
    if (vid) {
      void useStore
        .getState()
        .makeClipFromVideo(vid)
        .then((clipId) => {
          if (clipId) void addAt(clipId, T, track)
        })
      return
    }
    const multi = e.dataTransfer.getData(MIME_CLIPS)
    if (multi) {
      try {
        const ids = JSON.parse(multi) as string[]
        if (Array.isArray(ids) && ids.length) {
          void (async () => {
            let t = T
            for (const cid of ids) {
              // sequential placement back-to-back from the drop point
              // eslint-disable-next-line no-await-in-loop
              t = await addAt(cid, t, track)
            }
          })()
        }
      } catch {
        /* ignore */
      }
      return
    }
    const clipId = e.dataTransfer.getData(MIME_CLIP)
    if (clipId) void addAt(clipId, T, track)
  }
  const addAt = async (clipId: string, T: number, track: number, takeId?: string, trim?: { inSec?: number; outSec?: number }): Promise<number> => {
    const p = useStore.getState().project
    if (!p) return T
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const probe: TimelineItem = {
      id,
      clipId,
      startSec: 0,
      track,
      ...(takeId ? { takeId } : {}),
      // a windowed drag (Clip Gen preview in/out) lands pre-trimmed
      ...(trim?.inSec != null ? { inSec: trim.inSec } : {}),
      ...(trim?.outSec != null ? { outSec: trim.outSec } : {})
    }
    const len = effDur(probe, p.clips)
    const s = Math.max(0, T)
    const withNew = [...activeItems(useStore.getState().project), { ...probe, startSec: s }]
    await get().setTimelineItems(carve(withNew, new Map([[id, { startSec: s, track }]])))
    return s + len
  }
  const get = useStore.getState
  const placeLastAt = (n: number, T: number, track: number): void => {
    // the auto-made clips landed appended — move the LAST n to the drop point, back-to-back
    const cur = freshItems()
    const tail = cur.slice(-n)
    let t = T
    const moved = new Map<string, { startSec: number; track: number }>()
    for (const it of tail) {
      moved.set(it.id, { startSec: t, track })
      t += eff(it)
    }
    const positioned = cur.map((x) => (moved.has(x.id) ? { ...x, startSec: moved.get(x.id)!.startSec, track } : x))
    void setTimelineItems(carve(positioned, moved))
  }

  // ---- nudge (,/. — Premiere): move the selection one frame (Shift = 5) — marquee group or the
  // selected block; drops overwrite (carve), same as a drag ----
  const nudgeSel = (dir: 1 | -1, big: boolean): void => {
    const st = useStore.getState()
    const ids = marqueeSel.size > 0 ? new Set(marqueeSel) : st.selectedTlItemId ? new Set([st.selectedTlItemId]) : null
    if (!ids || ids.size === 0) return
    const step = dir * FPS_NUDGE * (big ? 5 : 1)
    const cur = freshItems()
    const moved = new Map<string, { startSec: number; track: number }>()
    for (const x of cur) {
      if (!ids.has(x.id) || locked.has(`v${trackOf(x)}`)) continue
      moved.set(x.id, { startSec: Math.max(0, startOf(x) + step), track: trackOf(x) })
    }
    if (moved.size === 0) return
    const positioned = cur.map((x) => (moved.has(x.id) ? { ...x, startSec: moved.get(x.id)!.startSec } : x))
    void setTimelineItems(carve(positioned, moved))
  }

  // ---- keys (Premiere layout): C slice · S snap · Q/W ripple-to-playhead · ,/. nudge ·
  // Ctrl+K razor · M marker · I/O range · J/K/L shuttle · -/=/\ zoom ----
  // The handler registers per [marqueeSel, gapSel, tlObj?.id, vTracks] — but its edit closures
  // capture RENDER-time clips/locked/mute state. A user who never marquees would keep the
  // MOUNT-time closures all session: Q/W then ripples with stale take durations (silent
  // geometry corruption) and edits freshly-locked tracks. This ref always holds the CURRENT
  // render's functions, so every keystroke runs against fresh state without re-registering.
  const keyCtxRef = useRef<{
    rippleToPlayhead: typeof rippleToPlayhead
    nudgeSel: typeof nudgeSel
    razorAtPlayhead: typeof razorAtPlayhead
    deleteGapSel: (g: { track: number; t0: number; t1: number }) => void
    freshItems: typeof freshItems
    tlObj: typeof tlObj
  } | null>(null) // populated below deleteGapSel's declaration (TDZ); set fresh every render
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const st = useStore.getState()
      const K = keyCtxRef.current
      if (!K) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        K.razorAtPlayhead()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const low = e.key.toLowerCase()
      if (low === 'c') setSliceMode((v) => !v)
      else if (low === 's') {
        // Premiere S: master snap toggle (both magnets together — any on → all off)
        const on = st.snapPlayhead || st.snapBeats
        if (on) {
          if (st.snapPlayhead) toggleSnapPlayhead()
          if (st.snapBeats) toggleSnapBeats()
        } else {
          toggleSnapPlayhead()
          toggleSnapBeats()
        }
      } else if (low === 'q' || low === 'w') {
        e.preventDefault()
        K.rippleToPlayhead(low === 'q' ? 'in' : 'out')
      } else if (e.key === ',' || e.key === '<' || e.key === '.' || e.key === '>') {
        e.preventDefault()
        K.nudgeSel(e.key === ',' || e.key === '<' ? -1 : 1, e.shiftKey)
      } else if (low === 'a') setSelFwd(true)
      else if (low === 'v') setSelFwd(false)
      else if (e.key === 'Escape') {
        setSliceMode(false)
        setMarqueeSel(new Set())
        setGapSel(null)
        setSelFwd(false)
      } else if (e.key === 'm' || e.key === 'M') {
        const tlNow = activeTimeline(useStore.getState().project)
        if (!tlNow) return
        const id = crypto.randomUUID?.() ?? String(Date.now())
        void setTimelineMeta({ markers: [...(tlNow.markers ?? []), { id, at: st.tlTime }] }, tlNow.id)
      } else if (e.key === 'i' || e.key === 'I') {
        if (K.tlObj) void setTimelineMeta({ rangeInSec: st.tlTime }, K.tlObj.id)
      } else if (e.key === 'o' || e.key === 'O') {
        if (K.tlObj) void setTimelineMeta({ rangeOutSec: st.tlTime }, K.tlObj.id)
      } else if (e.key === 'l' || e.key === 'L') st.tlPlay()
      else if (e.key === 'k' || e.key === 'K') st.tlPause()
      else if (e.key === 'j' || e.key === 'J') st.tlSeek(Math.max(0, st.tlTime - 5))
      else if (e.key === '-') applyZoom(zoomRef.current / 1.5)
      else if (e.key === '=' || e.key === '+') applyZoom(zoomRef.current * 1.5)
      else if (e.key === '\\') zoomTo(1, 0)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && marqueeSel.size > 1) {
        e.preventDefault()
        e.stopPropagation() // the marquee group outranks the single-selection delete in App
        const doomed = new Set(marqueeSel)
        setMarqueeSel(new Set())
        void setTimelineItems(K.freshItems().filter((x) => !doomed.has(x.id)))
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && gapSel) {
        e.preventDefault()
        e.stopPropagation() // a selected gap outranks the single-selection delete in App
        K.deleteGapSel(gapSel)
      }
    }
    window.addEventListener('keydown', onKey, true) // capture: marquee-delete must beat App's handler
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marqueeSel, gapSel, tlObj?.id, vTracks])

  // ---- zoom / wheel / navigator / autoscroll ----
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  const zoomTo = (nz: number, leftFrac: number): void => {
    const z = Math.min(8, Math.max(1, nz))
    setZoom(z)
    requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (sc) sc.scrollLeft = Math.max(0, leftFrac * sc.clientWidth * z)
    })
  }
  const applyZoom = (nz: number): void => {
    const z = Math.min(8, Math.max(1, nz))
    const sc = scrollRef.current
    if (!sc || sc.clientWidth === 0 || z === zoomRef.current) {
      setZoom(z)
      return
    }
    const centerFrac = (sc.scrollLeft + sc.clientWidth / 2) / (sc.clientWidth * zoomRef.current)
    setZoom(z)
    requestAnimationFrame(() => {
      const s2 = scrollRef.current
      if (s2) s2.scrollLeft = Math.max(0, centerFrac * s2.clientWidth * z - s2.clientWidth / 2)
    })
  }
  const onWheel = (e: React.WheelEvent): void => {
    const sc = scrollRef.current
    if (!sc) return
    if (e.ctrlKey || e.altKey) {
      // zoom anchored at the cursor's time
      const r = sc.getBoundingClientRect()
      const cursorFrac = (sc.scrollLeft + (e.clientX - r.left)) / (sc.clientWidth * zoomRef.current)
      const z = Math.min(8, Math.max(1, zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      setZoom(z)
      requestAnimationFrame(() => {
        const s2 = scrollRef.current
        if (s2) s2.scrollLeft = Math.max(0, cursorFrac * s2.clientWidth * z - (e.clientX - r.left))
      })
    } else {
      sc.scrollLeft += e.deltaY + e.deltaX // Premiere: plain wheel pans the timeline
    }
  }
  // playhead autoscroll (page-scroll like Premiere) while playing — NEVER during a scrub drag:
  // jumping scrollLeft mid-drag shifts the wrap under the cursor and the scrub math feeds back
  // (reads as "the ruler is sliding around instead of the playhead")
  const scrubbingRef = useRef(false)
  useEffect(() => {
    if (!tlPlaying) return
    const iv = window.setInterval(() => {
      const sc = scrollRef.current
      if (!sc || zoomRef.current <= 1 || scrubbingRef.current) return
      const px = (useStore.getState().tlTime / total) * sc.clientWidth * zoomRef.current
      if (px < sc.scrollLeft || px > sc.scrollLeft + sc.clientWidth - 24) sc.scrollLeft = Math.max(0, px - 24)
    }, 250)
    return () => window.clearInterval(iv)
  }, [tlPlaying, total])

  // ---- scrub: CAPTURED pointer events — press = seek, move-while-pressed = scrub, and the
  // release is always heard (capture survives leaving the ruler; no native drag can hijack the
  // mouse mid-scrub and leave us stuck in scrub mode). preventDefault kills text-selection /
  // native drag-a-copy starts (the floating "115s" ghost). Scrub can ONLY start on the ruler. ----
  const onScrubDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    raiseTimelineMonitor()
    scrubbingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported → window fallback below still ends the scrub */
    }
    tlSeek(timeAtClientX(e.clientX))
  }
  const onScrubMove = (e: React.PointerEvent): void => {
    if (!scrubbingRef.current) return
    tlSeek(timeAtClientX(e.clientX))
  }
  const onScrubEnd = (): void => {
    scrubbingRef.current = false
  }

  // ---- marquee (drag a box on empty track space) ----
  const startMarquee = (e: React.MouseEvent): void => {
    if (sliceMode || e.button !== 0) return
    const host = tracksRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const x0 = e.clientX - r.left
    const y0 = e.clientY - r.top
    let moved = false
    const move = (ev: MouseEvent): void => {
      const x1 = ev.clientX - r.left
      const y1 = ev.clientY - r.top
      if (!moved && Math.abs(x1 - x0) < 5 && Math.abs(y1 - y0) < 5) return
      moved = true
      setMarquee({ x0, y0, x1, y1 })
      // select every block intersecting the box
      const tSel = new Set<string>()
      const tLo = Math.min(x0, x1) / r.width * total
      const tHi = Math.max(x0, x1) / r.width * total
      const rLo = Math.floor(Math.min(y0, y1) / ROW_H)
      const rHi = Math.floor(Math.max(y0, y1) / ROW_H)
      for (const it of timeline) {
        const row = vTracks - 1 - trackOf(it) // rows render top-down from the highest track
        if (row < rLo || row > rHi) continue
        const s = startOf(it)
        if (s < tHi && tLo < s + eff(it)) tSel.add(it.id)
      }
      setMarqueeSel(tSel)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setMarquee(null)
      if (!moved) {
        // plain click on empty space: select the GAP under the pointer (bounded on the right —
        // Del ripple-closes it); no bounded gap → just clear selections
        const time = (x0 / r.width) * total
        const row = Math.floor(y0 / ROW_H)
        const tr = vTracks - 1 - row
        let gap: { track: number; t0: number; t1: number } | null = null
        if (tr >= 0 && tr < vTracks) {
          const on = timeline.filter((x) => trackOf(x) === tr)
          const inside = on.some((x) => startOf(x) <= time && time < startOf(x) + eff(x))
          if (!inside) {
            let prevEnd = 0
            let nextStart = Infinity
            for (const x of on) {
              const s0 = startOf(x)
              const e0 = s0 + eff(x)
              if (e0 <= time) prevEnd = Math.max(prevEnd, e0)
              if (s0 > time) nextStart = Math.min(nextStart, s0)
            }
            if (Number.isFinite(nextStart) && nextStart - prevEnd > 0.01) gap = { track: tr, t0: prevEnd, t1: nextStart }
          }
        }
        setGapSel(gap)
        setMarqueeSel(new Set())
        selectTlItem(null)
        if (sliceMode) setSliceMode(false)
      } else {
        setGapSel(null)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Del with a gap selected: pull everything after it left by the gap length — every channel +
  // free audio (music stays). The pull clamps so nothing collides with a block spanning the gap
  // on another channel.
  const deleteGapSel = (g: { track: number; t0: number; t1: number }): void => {
    setGapSel(null)
    const items = freshItems()
    const shifting = items.filter((x) => startOf(x) >= g.t1 - 0.001)
    if (!shifting.length) return
    let L = g.t1 - g.t0
    for (let tr2 = 0; tr2 < vTracks; tr2++) {
      const sh = shifting.filter((x) => trackOf(x) === tr2)
      if (!sh.length) continue
      const firstS = Math.min(...sh.map((x) => startOf(x)))
      const staticEnd = Math.max(0, ...items.filter((x) => startOf(x) < g.t1 - 0.001 && trackOf(x) === tr2).map((x) => startOf(x) + eff(x)))
      L = Math.min(L, Math.max(0, firstS - staticEnd))
    }
    if (L <= 0.001) return
    const ids = new Set(shifting.map((x) => x.id))
    void setTimelineBoth(
      items.map((x) => (ids.has(x.id) ? { ...x, startSec: Math.max(0, startOf(x) - L) } : x)),
      freeAudioShifted(g.t1, -L)
    )
  }
  // the keyboard effect reads THIS render's closures through the ref — registering per-dep
  // pinned mount-time clips/locked/mute into Q/W ripples (see the effect's comment)
  keyCtxRef.current = { rippleToPlayhead, nudgeSel, razorAtPlayhead, deleteGapSel, freshItems, tlObj }

  // ---- ruler: Premiere timecode on a canvas — adaptive tick ladder, exact smpte labels ----
  // The canvas is VIEWPORT-sized and sticky at the scroller's left edge; ticks draw with a
  // scrollLeft offset (a full-wrap canvas would blow the browser's bitmap cap at deep zoom).
  const RULER_H = 18
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawRuler = (): void => {
    const cv = rulerCanvasRef.current
    const sc = scrollRef.current
    if (!cv || !sc || sc.clientWidth === 0) return
    const vw = sc.clientWidth
    const dpr = window.devicePixelRatio || 1
    // explicit CSS size — a positioned canvas ignores stretching and stays intrinsic 300×150
    // (THE canvas law, 2026-08-19)
    if (cv.style.width !== `${vw}px`) cv.style.width = `${vw}px`
    if (cv.style.height !== `${RULER_H}px`) cv.style.height = `${RULER_H}px`
    const W = Math.max(2, Math.round(vw * dpr))
    const H = Math.round(RULER_H * dpr)
    if (cv.width !== W || cv.height !== H) {
      cv.width = W
      cv.height = H
    }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, vw, RULER_H)
    // FRACTIONAL width basis — the wrap and every DOM overlay (markers, playhead, range band)
    // resolve percentages against the fractional layout width; integer clientWidth drifted the
    // ticks up to ~4px off the markers at zoom 8 (review catch)
    const wrapW = wrapRef.current?.getBoundingClientRect().width ?? vw * zoom
    const pxPerSec = wrapW / total
    if (!isFinite(pxPerSec) || pxPerSec <= 0) return
    // the ladder: smallest step whose labels sit ≥80px apart — down to single frames at deep zoom
    const LADDER = [1 / 24, 2 / 24, 3 / 24, 6 / 24, 12 / 24, 1, 2, 5, 10, 30, 60, 120, 300, 600]
    const major = LADDER.find((s) => s * pxPerSec >= 80) ?? 600
    let minor = major / 5
    if (minor < 1 / 24 - 1e-9 || minor * pxPerSec < 5) minor = 0 // never below a frame, never denser than 5px
    const t0 = sc.scrollLeft / pxPerSec
    const t1 = (sc.scrollLeft + vw) / pxPerSec
    // canvas can't resolve CSS vars — read the theme at draw time (re-themes on the next redraw)
    const css = getComputedStyle(document.documentElement)
    const cMajor = css.getPropertyValue('--line2').trim() || '#555'
    const cMinor = css.getPropertyValue('--line').trim() || '#333'
    const cLabel = css.getPropertyValue('--dim').trim() || '#777'
    const mono = css.getPropertyValue('--mono').trim() || 'monospace'
    if (minor > 0) {
      g.fillStyle = cMinor
      for (let i = Math.max(0, Math.floor(t0 / minor)); i * minor <= Math.min(total, t1) + 1e-9; i++) {
        const t = i * minor
        if (Math.abs(t / major - Math.round(t / major)) < 1e-6) continue // a major owns this spot
        g.fillRect(Math.round(t * pxPerSec - sc.scrollLeft), RULER_H - 5, 1, 5)
      }
    }
    g.font = `9px ${mono}`
    g.textBaseline = 'middle'
    for (let i = Math.max(0, Math.floor(t0 / major)); i * major <= Math.min(total, t1 + major) + 1e-9; i++) {
      const t = i * major
      const x = Math.round(t * pxPerSec - sc.scrollLeft)
      g.fillStyle = cMajor
      g.fillRect(x, 0, 1, RULER_H)
      g.fillStyle = cLabel
      // label from the ROUNDED frame index — flooring the drifted i*(1/24) product read one
      // frame low at frame-level zoom (review catch)
      g.fillText(smpteFrames(Math.round(t * TC_FPS)), x + 3, RULER_H / 2)
    }
  }
  const drawRulerRef = useRef(drawRuler)
  drawRulerRef.current = drawRuler
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let raf = 0
    const req = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => drawRulerRef.current())
    }
    req()
    sc.addEventListener('scroll', req)
    const ro = new ResizeObserver(req)
    ro.observe(sc)
    return () => {
      cancelAnimationFrame(raf)
      sc.removeEventListener('scroll', req)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, total, tlObj?.id, !!project])

  const trackRows = Array.from({ length: vTracks }, (_, r) => vTracks - 1 - r) // top row = highest track

  if (!project)
    return (
      <div className="vd-panel vd-monitor">
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>open a project to edit its timeline</span>
      </div>
    )

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ---- transport ---- */}
      <div className="vd-transport">
        <span className="vd-play" style={{ cursor: 'pointer' }} onClick={() => (tlPlaying ? tlPause() : tlPlay())} title="play / pause (Space · K/L)">
          <Ic i={tlPlaying ? Pause : Play} size={16} />
        </span>
        <span style={{ cursor: 'pointer' }} onClick={() => tlSeek(0)} title="to start (Home)">
          <Ic i={SkipBack} size={15} />
        </span>
        <span style={{ cursor: 'pointer' }} onClick={() => tlSeek(contentEnd)} title="to end (End)">
          {/* contentEnd, not the padded view total — "to end" used to seek 8s+ past the last frame */}
          <Ic i={SkipForward} size={15} />
        </span>
        <span className="vd-loop" style={{ opacity: tlLoop ? 1 : 0.4, cursor: 'pointer' }} onClick={toggleLoop} title="loop playback (loops the in/out range when one is set)">
          <Ic i={Repeat} size={14} />
        </span>
        <span className="vd-loop" style={{ opacity: showFilmstrips ? 1 : 0.4, cursor: 'pointer' }} onClick={toggleFilmstrips} title={showFilmstrips ? 'thumbnails on — click for faster plain blocks' : 'thumbnails off (faster)'}>
          <Ic i={Film} size={14} />
        </span>
        <span
          className="vd-loop"
          style={{ opacity: sliceMode ? 1 : 0.8, color: sliceMode ? 'var(--bad)' : undefined, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10 }}
          onClick={() => setSliceMode((v) => !v)}
          title="slice tool (C, like Premiere's razor) — click a clip to cut; Ctrl+K cuts at the playhead without arming"
        >
          <Ic i={Scissors} size={14} /> slice
        </span>
        <span className="vd-loop" style={{ opacity: snapPlayhead ? 1 : 0.35, cursor: 'pointer' }} onClick={toggleSnapPlayhead} title="snap — blocks, markers, playhead, range · off = nothing snaps (S = toggle all)">
          <Ic i={Magnet} size={14} />
        </span>
        <span className="vd-loop" style={{ opacity: snapBeats ? 1 : 0.35, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={toggleSnapBeats} title="snap to music beat ticks (S = toggle all snapping)">
          <Ic i={Magnet} size={14} />
          <Ic i={Music} size={11} />
        </span>
        {/* per-lane mixing lives on the RAIL (Premiere) — but the MASTER clip-audio mute is a
            global toggle and belongs here with the other globals (user call 2026-08-19: the
            rail-header version read as debris) */}
        {tlObj && (
          <>
            <span
              className="vd-loop"
              // ONE FACE for the master mute, here and in the Timeline Monitor bar (law 3):
              // live = speaker at 0.6, muted = red crossed speaker at 1
              style={{ opacity: tlObj.videoMuted ? 1 : 0.6, color: tlObj.videoMuted ? 'var(--bad)' : undefined, cursor: 'pointer' }}
              onClick={() => void setTimelineMutes(tlObj.id, { videoMuted: !tlObj.videoMuted })}
              title="mute ALL clip audio (playback + export) — the master switch for every clip’s own sound"
            >
              <Ic i={tlObj.videoMuted ? VolumeX : Volume2} size={14} />
            </span>
            <span
              className="vd-loop"
              style={{ opacity: exportState.busy || timeline.length === 0 ? 0.4 : 0.8, cursor: 'pointer' }}
              onClick={() => !exportState.busy && timeline.length > 0 && void startExport(tlObj.id)}
              title="export this timeline as mp4 (exports just the in/out range when one is set)"
            >
              <Ic i={Upload} size={14} />
            </span>
            {exportState.busy && (
              <span
                className="vd-loop"
                style={{ opacity: 0.9, color: 'var(--bad)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11 }}
                onClick={() => useStore.getState().cancelExport()}
                title="cancel the running export (the half-written file is discarded)"
              >
                ✕
              </span>
            )}
          </>
        )}
        <span className="vd-loop" style={{ opacity: zoom > 1 ? 0.9 : 0.4, cursor: 'pointer' }} onClick={() => applyZoom(zoom / 1.5)} title="zoom out (-)">
          <Ic i={ZoomOut} size={13} />
        </span>
        <span className="vd-loop" style={{ opacity: 0.9, fontSize: 10, fontFamily: 'var(--mono)', cursor: zoom > 1 ? 'pointer' : 'default' }} onClick={() => zoomTo(1, 0)} title="fit (\\)">
          {Math.round(zoom * 100) / 100}×
        </span>
        <span className="vd-loop" style={{ opacity: 0.9, cursor: 'pointer' }} onClick={() => applyZoom(zoom * 1.5)} title="zoom in (=)">
          <Ic i={ZoomIn} size={13} />
        </span>
        <span
          className="vd-loop"
          style={{ marginLeft: 'auto', opacity: mirrorDisplayId != null ? 1 : 0.55, color: mirrorDisplayId != null ? 'var(--amber)' : undefined, cursor: 'pointer' }}
          title="output mirror — fullscreen playback on another display"
          onClick={async (e) => {
            const displays = await window.vidancer.screenList()
            setOutMenu({ x: e.clientX, y: e.clientY, displays })
          }}
        >
          <Ic i={MonitorIcon} size={14} />
        </span>
        <TimeReadout total={contentEnd} /> {/* the SEQUENCE length — the padded total is view geometry only */}
      </div>
      {outMenu && (
        <ContextMenu
          x={outMenu.x}
          y={outMenu.y}
          entries={[
            ...(outMenu.displays.length === 0
              ? ([{ label: 'no other display found' }] as MenuEntry[])
              : outMenu.displays.map(
                  (d): MenuEntry => ({
                    label: (
                      <>
                        <Ic i={MonitorIcon} size={12} /> {d.label} ({d.width}×{d.height}){mirrorDisplayId === d.id ? ' ✓' : ''}
                      </>
                    ),
                    onClick: () =>
                      void window.vidancer.mirrorOpen(d.id).then((ok) => {
                        if (ok) setMirrorDisplay(d.id)
                        else toast('couldn’t open that display (unplugged?)', { kind: 'error' })
                      })
                  })
                )),
            { sep: true, label: '' },
            {
              label: <>off — preview in this window only{mirrorDisplayId == null ? ' ✓' : ''}</>,
              onClick: () => {
                void window.vidancer.mirrorClose()
                setMirrorDisplay(null)
              }
            }
          ]}
          onClose={() => setOutMenu(null)}
        />
      )}

      {/* ---- rail + scrollable tracks: the rail lives INSIDE the vertical scroller so its rows
           stay glued to the track rows; only the time surface scrolls horizontally ---- */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', overflowY: 'auto', flex: '1 1 auto', minHeight: 0, background: 'var(--bg0)' }}>
          {/* track rail: two-line rows (label + M/S/🔒 chips), right-click = track actions */}
          <div
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return
              e.preventDefault()
              setRailMenu({ x: e.clientX, y: e.clientY, track: null })
            }}
            style={{ flex: '0 0 auto', width: 120, minHeight: '100%', borderRight: '1px solid var(--line)', background: 'var(--bg0)', fontSize: 9, color: 'var(--muted)' }}
          >
            {/* rail header — EMPTY strip, height locked to the 18px ruler so rows align.
                Track actions live in the rail's right-click; the master mute lives in the
                toolbar with the other globals (the Premiere way, user law 2026-08-19). */}
            <div title="right-click below for track actions (add / delete / lock)" style={{ height: 18, borderBottom: '1px solid var(--line)' }} />
            {trackRows.map((tr) => {
              const key = `v${tr}`
              const isL = locked.has(key)
              const isM = mutedTr.has(key)
              const isS = soloTr.has(key)
              const empty = !timeline.some((x) => trackOf(x) === tr)
              return (
                <div
                  key={key}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setRailMenu({ x: e.clientX, y: e.clientY, track: tr })
                  }}
                  title="right-click = track actions"
                  // ONE LINE, always (user law 2026-08-19: layout must never depend on state) —
                  // label · chips · ✕, identical at every height, V and A the same grammar
                  style={{ position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderBottom: '1px solid var(--line)' }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--txt-hi)', width: 22, flex: '0 0 auto' }}>V{tr + 1}</span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {chip('👁', isM, 'var(--bad)', 'hide this video track — skipped in playback AND export (lit = hidden)', () => tlObj && void setTimelineMeta({ mutedTracks: togg(tlObj.mutedTracks, key) }, tlObj.id))}
                    {chip('S', isS, 'var(--amber)', 'solo this video track', () => tlObj && void setTimelineMeta({ soloTracks: togg(tlObj.soloTracks, key) }, tlObj.id))}
                    {chip('🔒', isL, 'var(--amber)', 'lock this track (rejects edits)', () => tlObj && void setTimelineMeta({ lockedTracks: togg(tlObj.lockedTracks, key) }, tlObj.id))}
                  </div>
                  {/* ✕ only where it tells the truth: deletion removes the LAST track */}
                  {empty && vTracks > 1 && tr === vTracks - 1 && (
                    <span
                      onClick={() => tlObj && void setTimelineMeta({ videoTracks: vTracks - 1, mutedTracks: (tlObj.mutedTracks ?? []).filter((x) => x !== key), soloTracks: (tlObj.soloTracks ?? []).filter((x) => x !== key), lockedTracks: (tlObj.lockedTracks ?? []).filter((x) => x !== key) }, tlObj.id)}
                      title="delete this empty track"
                      style={{ cursor: 'pointer', marginLeft: 'auto', color: 'var(--dim)' }}
                    >
                      ✕
                    </span>
                  )}
                  {/* invisible bottom hot-zone: drag = resize ALL video track rows (uniform) */}
                  <div onMouseDown={(e) => dragHeights(e, 'row')} title="drag = resize the video tracks" style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 6, cursor: 'ns-resize', zIndex: 2 }} />
                </div>
              )
            })}
            {/* the Premiere middle bar: drag = move the video/audio split (video rows resize) */}
            <div
              onMouseDown={(e) => dragHeights(e, 'divider')}
              title="drag = move the video / audio split, like Premiere (video rows resize)"
              style={{ height: 6, cursor: 'ns-resize', background: 'var(--raised2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
            />
            {/* audio lane labels — heights mirror AudioItemLanes (per-lane expansion aware) */}
            <div>
              {Array.from({ length: laneCount }, (_, l) => {
                const aKey = `a${l}`
                const laneEmpty = !(tlObj?.audioItems ?? []).some((a) => a.lane === l) && !(tlObj?.scoreItems ?? []).some((s) => (s.lane ?? 0) === l)
                // ONE LINE, always — A-rows ARE V-rows: label · [M][S][🔒] · ✕, identical at
                // every height (user law 2026-08-19: layout must never depend on state).
                // Separator = inset line (a real border drifted every row off its lane).
                return (
                  <div
                    key={l}
                    onDoubleClick={() => useStore.getState().toggleAudioLane(l)}
                    title="double-click = expand/collapse this lane (volume view), like Premiere"
                    style={{
                      position: 'relative',
                      height: laneHOf(l),
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0 6px',
                      boxShadow: 'inset 0 -1px 0 var(--line)',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--txt-hi)', width: 22, flex: '0 0 auto' }}>A{l + 1}</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {chip('M', mutedTr.has(aKey), 'var(--bad)', 'mute this audio lane (playback + export)', () => tlObj && void setTimelineMeta({ mutedTracks: togg(tlObj.mutedTracks, aKey) }, tlObj.id))}
                      {chip('S', soloTr.has(aKey), 'var(--amber)', 'solo this audio lane (mutes the others)', () => tlObj && void setTimelineMeta({ soloTracks: togg(tlObj.soloTracks, aKey) }, tlObj.id))}
                      {chip('🔒', locked.has(aKey), 'var(--amber)', 'lock this lane (rejects edits)', () => tlObj && void setTimelineMeta({ lockedTracks: togg(tlObj.lockedTracks, aKey) }, tlObj.id))}
                    </div>
                    {laneEmpty && laneCount > 1 && l === laneCount - 1 && (
                      <span
                        onClick={() => tlObj && void setTimelineMeta({ audioTracks: laneCount - 1, mutedTracks: (tlObj.mutedTracks ?? []).filter((x) => x !== aKey), soloTracks: (tlObj.soloTracks ?? []).filter((x) => x !== aKey), lockedTracks: (tlObj.lockedTracks ?? []).filter((x) => x !== aKey) }, tlObj.id)}
                        title="delete this empty lane"
                        style={{ cursor: 'pointer', marginLeft: 'auto', color: 'var(--dim)' }}
                      >
                        ✕
                      </span>
                    )}
                    {/* invisible bottom hot-zone: drag = resize ALL audio lanes (uniform) */}
                    <div onMouseDown={(e) => dragHeights(e, 'lane')} title="drag = resize the audio lanes" style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 6, cursor: 'ns-resize', zIndex: 2 }} />
                  </div>
                )
              })}
            </div>
            {/* LEGACY ♪ row — only while un-migrated music exists (a restart converts it to a
                lane block and this row never returns) */}
            {tlObj && tlObj.music && (
              <div style={{ height: 24, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                <span>♪</span>
                {chip('M', !!tlObj.musicMuted, 'var(--bad)', 'mute the music lane (playback + export)', () => void setTimelineMutes(tlObj.id, { musicMuted: !tlObj.musicMuted }))}
              </div>
            )}
          </div>

          {/* horizontal scroll — the time surface only. dragstart preventDefault + no text-select:
              the browser must NEVER start a native drag-a-copy here (filmstrip imgs, tick labels) —
              a hijacked drag eats the mouse-release and reads as "the ruler got dragged" */}
          <div ref={scrollRef} onWheel={onWheel} style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden', flex: 1, minWidth: 0 }}>
            <div ref={wrapRef} onDragStart={(e) => e.preventDefault()} style={{ position: 'relative', width: `${zoom * 100}%`, minHeight: '100%', userSelect: 'none' }}>
              {/* ruler: scrub · markers · in/out range */}
              <div
                onPointerDown={onScrubDown}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubEnd}
                onPointerCancel={onScrubEnd}
                style={{ position: 'relative', height: RULER_H, borderBottom: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', touchAction: 'none', background: 'var(--bg0)' }}
                title="click or drag to scrub · M = marker at playhead · I/O = in/out range"
              >
                {/* the tick canvas — sticky at the viewport's left edge, visual only */}
                <canvas ref={rulerCanvasRef} style={{ position: 'sticky', left: 0, display: 'block', pointerEvents: 'none' }} />
                {tlObj?.rangeInSec != null && tlObj?.rangeOutSec != null && tlObj.rangeOutSec > tlObj.rangeInSec && (
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(tlObj.rangeInSec / total) * 100}%`, width: `${((tlObj.rangeOutSec - tlObj.rangeInSec) / total) * 100}%`, background: 'color-mix(in srgb, var(--amber) 22%, transparent)', pointerEvents: 'none' }} />
                )}
                {(tlObj?.markers ?? []).map((m) => {
                  const at = markerDrag?.id === m.id ? markerDrag.at : m.at // live drag preview
                  return (
                    <div
                      key={m.id}
                      onPointerDown={(e) => startMarkerDrag(m, e)}
                      onClick={(e) => e.stopPropagation()}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setMarkerMenu({ x: e.clientX, y: e.clientY, id: m.id })
                      }}
                      title={`${m.name ?? 'marker'} @ ${smpte(m.at)} · click = jump · drag = move · right-click = color / rename / delete`}
                      style={{ position: 'absolute', left: `${(at / total) * 100}%`, top: 0, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `9px solid ${m.color ?? 'var(--amber)'}`, marginLeft: -5, cursor: markerDrag?.id === m.id ? 'ew-resize' : 'pointer', zIndex: 3 }}
                    />
                  )
                })}
                {/* the dragged marker's exact-timecode chip — a body portal, so nothing clips it */}
                {markerDrag &&
                  createPortal(
                    <div style={{ position: 'fixed', left: markerDrag.x, top: Math.max(4, markerDrag.y), transform: 'translateX(-50%)', zIndex: 3000, pointerEvents: 'none', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-hi)', background: 'rgba(0,0,0,.8)', border: '1px solid var(--line2)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
                      {smpte(markerDrag.at)}
                    </div>,
                    document.body
                  )}
              </div>

              {/* video track rows (top row = highest track) */}
              <div ref={tracksRef} style={{ position: 'relative', cursor: selFwd ? 'e-resize' : undefined }} onMouseDown={(e) => e.target === e.currentTarget && startMarquee(e)}>
                {trackRows.map((tr) => (
                  <div
                    key={tr}
                    onMouseDown={(e) => e.target === e.currentTarget && startMarquee(e)}
                    onDragOver={(e) => {
                      const t = e.dataTransfer.types
                      if (t.includes(MIME_CLIP) || t.includes(MIME_CLIPS) || t.includes(MIME_TAKE) || t.includes(MIME_IMAGES) || t.includes(MIME_VIDEO) || t.includes(MIME_VEDITNODE)) e.preventDefault()
                    }}
                    onDrop={(e) => dropOnTrack(tr, e)}
                    onContextMenu={(e) => {
                      if (e.target !== e.currentTarget) return
                      e.preventDefault()
                      setGapMenu({ x: e.clientX, y: e.clientY, track: tr, at: timeAtClientX(e.clientX) })
                    }}
                    style={{ position: 'relative', height: ROW_H, borderBottom: '1px dashed var(--line)', background: mutedTr.has(`v${tr}`) && !soloTr.size ? 'color-mix(in srgb, var(--bad) 6%, var(--bg0))' : 'var(--bg0)' }}
                  >
                    {timeline.length === 0 && tr === 0 && (
                      <span className="vd-sm" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', pointerEvents: 'none' }}>
                        drag clips from the Bin (or Library images — they become clips) here →
                      </span>
                    )}
                    {/* ⟲ loop tails — faded projections UNDER the blocks; the row still owns the mouse */}
                    {timeline
                      .filter((it) => posOf(it).track === tr && it.loop)
                      .map((it) => {
                        const pos = posOf(it)
                        const len = effView(it)
                        const base = pos.start + len
                        const E = tailEndView(it)
                        const w = E - base
                        if (w < 0.05) return null
                        const cyc = Math.max(0.05, len)
                        const win = winOf(it)
                        return (
                          <TlTail
                            key={`tail-${it.id}`}
                            leftPct={(base / total) * 100}
                            widthPct={(w / total) * 100}
                            cycleFrac={Math.min(1, cyc / Math.max(0.001, w))}
                            cycles={Math.max(1, Math.min(200, Math.ceil(w / cyc)))}
                            cyclePx={cyc / secPerPx()}
                            videoFile={takeFileOf(it)}
                            inSec={win.inSec}
                            outSec={win.outSec}
                          />
                        )
                      })}
                    {timeline
                      .filter((it) => posOf(it).track === tr)
                      .map((it) => {
                        const pos = posOf(it)
                        const win = winOf(it)
                        const len = effView(it)
                        const editVideo = viewOf(it)?.take
                          ? (): void => {
                              const take = viewOf(it)!.take!
                              useStore.getState().setEditorVideo({
                                takeRef: { clipId: it.clipId, takeId: take.id },
                                ...(it.inSec != null ? { inSec: it.inSec } : {}),
                                ...(it.outSec != null ? { outSec: it.outSec } : {})
                              })
                              openVideoEditor()
                            }
                          : undefined
                        const removeBlock = (): void => void setTimelineItems(freshItems().filter((x) => x.id !== it.id))
                        const ctxEntries: MenuEntry[] = [
                          ...(viewOf(it)?.take
                            ? [
                                { label: <><Ic i={ImageDown} size={12} /> ⊢ first frame → Library (live still)</>, onClick: () => void addDynamicStillFor(it.id, 'first') },
                                { label: <><Ic i={ImageDown} size={12} /> last frame → Library (live still) ⊣</>, onClick: () => void addDynamicStillFor(it.id, 'last') },
                                { sep: true, label: '' } as MenuEntry
                              ]
                            : []),
                          ...(editVideo ? [{ label: <><Ic i={Wand2} size={12} /> ⑂ edit this take v2v</>, onClick: editVideo }] : []),
                          ...(viewOf(it)?.take && !it.audioDetachedId
                            ? [{ label: <>♪ unlink audio → lane</>, onClick: (): void => void unlinkAudio(it.id) } as MenuEntry]
                            : []),
                          // v19 INSERT AUDIO (user feature): a COPY of this block's audio window
                          // lands on the matching A-lane at the exact same timecode — trims and
                          // all. The block's own sound mutes so nothing doubles (unmute = layer).
                          // Speed-changed blocks: the copy plays the same source window at
                          // natural speed.
                          ...(viewOf(it)?.take
                            ? [
                                {
                                  label: <>♪ insert audio → A{(it.track ?? 0) + 1} (copy, same timecode + trims)</>,
                                  onClick: (): void => {
                                    const st = useStore.getState()
                                    const tlNow = activeTimeline(st.project)
                                    const take = viewOf(it)?.take
                                    if (!tlNow || !take) return
                                    const sp = it.speed && it.speed > 0 ? it.speed : 1
                                    const inS = it.useRecipe ? 0 : (it.inSec ?? 0)
                                    const srcLen = effDur(it, st.project?.clips ?? []) * sp
                                    const lane = it.track ?? 0
                                    if (lane >= (tlNow.audioTracks ?? 3)) void st.setTimelineMeta({ audioTracks: lane + 1 }, tlNow.id)
                                    const nid = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
                                    void st.setTimelineAudioItems(
                                      [...(tlNow.audioItems ?? []), { id: nid, lane, source: { clipId: it.clipId, takeId: take.id }, startSec: startOf(it), inSec: inS, outSec: inS + Math.max(0.25, srcLen) }],
                                      tlNow.id
                                    )
                                    void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, muted: true } : x)))
                                  }
                                } as MenuEntry
                              ]
                            : []),
                          {
                            label: <>{it.transitionOutSec ? '⤬ remove dissolve' : '⤬ add 0.5s dissolve out'}</>,
                            onClick: () =>
                              void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, transitionOutSec: it.transitionOutSec ? undefined : 0.5 } : x)))
                          },
                          {
                            label: <>⚡ speed… ({it.speed ?? 1}×)</>,
                            onClick: async (): Promise<void> => {
                              const v = await textPrompt('Playback speed (0.25 – 4)', String(it.speed ?? 1))
                              const n = v ? parseFloat(v) : NaN
                              if (!Number.isNaN(n) && n >= 0.25 && n <= 4)
                                void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, speed: n === 1 ? undefined : n } : x)))
                            }
                          },
                          {
                            label: <>✦ effects…{hasFx2(it) ? ` (${readFx2(it)?.stack.length ?? 0})` : ''}</>,
                            onClick: (): void => {
                              selectTlItem(it.id)
                              // jump the playhead onto the block — the Monitor must SHOW what the
                              // panel edits, or slider moves look like nothing happened
                              useStore.getState().tlSeek(startOf(it) + 0.01)
                              raiseTimelineMonitor()
                              openEffectsPanel()
                            }
                          },
                          {
                            label: <>{it.loop ? '⟲ loop off' : '⟲ loop'}</>,
                            onClick: (): void =>
                              // ⟲ v17 tail: one flag — the repeats are PROJECTIONS of this block
                              // (render/play/export resolve through it live). No copies, ever.
                              void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, loop: !x.loop || undefined, loopTailSec: undefined } : x)))
                          },
                          {
                            label: <>{it.disabled ? '✓ enable clip' : '⊘ disable clip (mute + hide)'}</>,
                            onClick: () => void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, disabled: !x.disabled || undefined } : x)))
                          },
                          { sep: true, label: '' },
                          { label: <><Ic i={Trash2} size={12} /> remove (leave gap)</>, danger: true, onClick: removeBlock },
                          { label: <><Ic i={Trash2} size={12} /> ripple delete (close up)</>, danger: true, onClick: () => rippleDelete(it) }
                        ]
                        return (
                          <div
                            key={it.id}
                            onMouseDownCapture={(e) => {
                              // free drag starts here unless a handle/menu target claims the press
                              const el = e.target as HTMLElement
                              if (el.closest('[data-noblockdrag]')) return
                              if (selFwd && e.button === 0) {
                                // A tool: this clip + everything after it, every channel — then back to normal
                                e.preventDefault()
                                e.stopPropagation()
                                const from = startOf(it) - 0.001
                                setMarqueeSel(new Set(freshItems().filter((x) => startOf(x) >= from).map((x) => x.id)))
                                setSelFwd(false)
                                justDragged.current = true // swallow the follow-up click-select
                                window.setTimeout(() => (justDragged.current = false), 0)
                                return
                              }
                              if (e.button === 0 && !sliceMode) {
                                if (e.ctrlKey && e.altKey) {
                                  e.stopPropagation()
                                  startSlip(it, e) // Ctrl+Alt+drag body = slip the source window
                                } else startMove(it, e)
                              }
                            }}
                            onClickCapture={(e) => {
                              if (justDragged.current) {
                                e.stopPropagation()
                                e.preventDefault()
                              }
                            }}
                            style={{
                              position: 'absolute',
                              top: 2,
                              bottom: 2,
                              left: `${(pos.start / total) * 100}%`,
                              width: `${(len / total) * 100}%`,
                              display: 'flex',
                              outline: marqueeSel.has(it.id) ? '2px solid var(--amber)' : undefined,
                              outlineOffset: 1,
                              // ⊘ disabled: ghosted but fully editable — it still owns its slot
                              opacity: dragView?.has(it.id) ? 0.75 : it.disabled ? 0.35 : 1,
                              filter: it.disabled ? 'grayscale(0.85)' : undefined,
                              zIndex: dragView?.has(it.id) ? 8 : undefined
                            }}
                            title={it.disabled ? '⊘ disabled — invisible + silent (right-click to enable)' : undefined}
                          >
                            <TlBlock
                              flex={1}
                              current={false}
                              selected={it.id === selectedTlItemId}
                              dropActive={false}
                              name={nameOf(it.clipId)}
                              durLabel={`${Math.round(len * 100) / 100}s`}
                              takeLabel={takeLabel(it)}
                              takes={takesOf(it.clipId)}
                              currentTakeId={curTakeId(it)}
                              onPickTake={(takeId) => void useStore.getState().setSlotView(it.id, takeId === 'C' ? { useRecipe: true } : { takeId })}
                              muted={!!it.muted}
                              onToggleMute={() => void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, muted: !x.muted || undefined } : x)))}
                              file={firstImageOf(it)}
                              videoFile={takeFileOf(it)}
                              seconds={len}
                              inSec={win.inSec}
                              outSec={win.outSec}
                              beats={beatsOf(it)}
                              beatImgs={beatImgsOf(it)}
                              trimmable={!it.useRecipe && !locked.has(`v${tr}`)}
                              sliceMode={sliceMode}
                              canSlice={!!takeFileOf(it)}
                              // slice-snap targets RECONNECTED (hardwired undefined since the
                              // v14 rewrite made the whole snap machinery dead code): scrubber
                              // + music beat ticks mapped into block space, gated by the snap
                              // toggles. Render-time read — exact in the paused razor flow.
                              playheadFrac={(() => {
                                if (!snapPlayhead || !sliceMode) return undefined
                                const T = useStore.getState().tlTime
                                return T > pos.start + 0.01 && T < pos.start + len - 0.01 ? (T - pos.start) / len : undefined
                              })()}
                              snapFracs={
                                snapBeats && sliceMode && beatTimesTl.length
                                  ? beatTimesTl.filter((t) => t > pos.start + 0.01 && t < pos.start + len - 0.01).map((t) => (t - pos.start) / len)
                                  : undefined
                              }
                              onSlice={(frac) => sliceAtTime(it, pos.start + frac * len)}
                              scrubSrc={showFilmstrips && dragTrim?.id === it.id ? (takeFileOf(it) ? mediaUrl(takeFileOf(it)!) : undefined) : undefined}
                              scrubTime={dragTrim?.id === it.id ? (dragTrim.side === 'in' ? dragTrim.inSec : dragTrim.outSec) : undefined}
                              onTrimStart={(side, e) => onTrimStart(it, side, e)}
                              onClick={() => {
                                // click = SELECT, nothing else (2026-08-09) — the old cue-to-start
                                // yanked the playhead/monitor on every selection while editing fx
                                selectTlItem(it.id)
                              }}
                              onDoubleClick={() => {
                                const idx = freshItems().findIndex((x) => x.id === it.id)
                                if (idx >= 0) editTimelineSlot(idx, it.clipId)
                                openClipMonitor()
                              }}
                              onRemove={removeBlock}
                              onEditVideo={editVideo}
                              contextEntries={ctxEntries}
                              onDragStart={(e) => e.preventDefault()}
                              onDragOver={() => undefined}
                              onDragLeave={() => undefined}
                              onDrop={() => undefined}
                            />
                            {/* dissolve wedge on the tail */}
                            {it.transitionOutSec ? (
                              <div
                                title={`${it.transitionOutSec}s dissolve out`}
                                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.min(100, (it.transitionOutSec / Math.max(0.01, len)) * 100)}%`, background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--amber) 45%, transparent))', pointerEvents: 'none', zIndex: 7 }}
                              />
                            ) : null}
                            {/* fx badge — this block has effects (right-click → effects) */}
                            {hasFx2(it) ? (
                              <div
                                title={`${readFx2(it)?.stack.length ?? 0} effect(s) · right-click → effects`}
                                style={{ position: 'absolute', right: 3, bottom: 2, fontSize: 8, lineHeight: '10px', padding: '0 3px', borderRadius: 3, color: 'var(--on-accent)', background: 'var(--amber)', fontWeight: 700, pointerEvents: 'none', zIndex: 8 }}
                              >
                                fx
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    {/* ⟲ tail end grips — the tail's ONE handle. Release on the wall = auto-fill */}
                    {timeline
                      .filter((it) => posOf(it).track === tr && it.loop)
                      .map((it) => {
                        const E = tailEndView(it)
                        const set = it.loopTailSec != null || dragTail?.id === it.id
                        return (
                          <div
                            key={`grip-${it.id}`}
                            onMouseDown={(e) => {
                              if (e.button === 0) startTailDrag(it, e)
                            }}
                            title={
                              set
                                ? '⟲ tail end — drag · release against the wall = back to auto-fill'
                                : '⟲ tail auto-fills to the next clip / sequence end — drag to set where it stops'
                            }
                            style={{
                              position: 'absolute',
                              top: 2,
                              bottom: 2,
                              left: `${(E / total) * 100}%`,
                              width: 10,
                              marginLeft: -1,
                              cursor: 'ew-resize',
                              zIndex: 9,
                              borderRadius: '0 4px 4px 0',
                              background: `linear-gradient(90deg, color-mix(in srgb, var(--amber) ${set ? 55 : 30}%, transparent), transparent)`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <span style={{ fontSize: 8, color: 'var(--amber)', opacity: 0.9, pointerEvents: 'none' }}>⟲</span>
                          </div>
                        )
                      })}
                  </div>
                ))}
                {/* selected gap — Del ripple-closes it */}
                {gapSel && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${(gapSel.t0 / total) * 100}%`,
                      width: `${((gapSel.t1 - gapSel.t0) / total) * 100}%`,
                      top: (vTracks - 1 - gapSel.track) * ROW_H + 2,
                      height: ROW_H - 4,
                      border: '1px dashed var(--amber)',
                      background: 'color-mix(in srgb, var(--amber) 12%, transparent)',
                      borderRadius: 4,
                      pointerEvents: 'none',
                      zIndex: 6
                    }}
                  />
                )}
                {/* marquee box */}
                {marquee && (
                  <div
                    style={{
                      position: 'absolute',
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1),
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0),
                      border: '1px dashed var(--amber)',
                      background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
                      pointerEvents: 'none',
                      zIndex: 20
                    }}
                  />
                )}
              </div>

              {/* the divider's time-surface half — same 6px, same drag, so the bar spans the full panel */}
              <div
                onMouseDown={(e) => dragHeights(e, 'divider')}
                title="drag = move the video / audio split, like Premiere (video rows resize)"
                style={{ height: 6, cursor: 'ns-resize', background: 'var(--raised2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
              />
              {/* audio lanes (companions + detached) · music · playhead · snap flash */}
              {tlObj && (
                <AudioItemLanes
                  tl={tlObj}
                  total={total}
                  segs={segs}
                  clips={clips}
                  items={timeline}
                  laneCount={Math.max(1, tlObj.audioTracks ?? 3)}
                  laneH={LANE_HV}
                  onUnlink={(itemId) => void unlinkAudio(itemId)}
                  scoreClips={project?.scoreClips ?? []}
                  snap={snapKit}
                />
              )}
              {/* LEGACY music strip — only while un-migrated music exists (restart converts it) */}
              {tlObj && tlObj.music && <AudioLane tl={tlObj} total={total} audio={project?.audio ?? []} snap={snapKit} />}
              <Playhead total={total} />
              {snapFlash != null && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(snapFlash / total) * 100}%`, width: 2, marginLeft: -1, background: 'var(--ok)', boxShadow: '0 0 6px var(--ok)', pointerEvents: 'none', zIndex: 12 }} />
              )}
            </div>
          </div>
        </div>
        <ZoomNav zoom={zoom} zoomTo={zoomTo} scrollRef={scrollRef} />
        <p className="vd-hint" style={{ flex: '0 0 auto' }}>
          {sliceMode
            ? '✂ slice armed — click a clip to cut it · Esc cancels'
            : selFwd
              ? '⇥ select-forward armed — click a clip to select it + everything after (V / Esc cancels)'
              : gapSel
                ? '▭ gap selected — Del closes it (ripples every channel) · Esc clears'
                : 'drag = move, drop overwrites (Alt = duplicate · Ctrl-drop = insert, shoves right · Shift = keep time, change track) · Ctrl+Alt+drag body = slip · edges trim, end trims ripple (Alt = leave gap · Ctrl = rolling) · Q/W = trim to playhead · ,/. = nudge · C = slice · S = snap · switching a take ripples too · right-click everything · ? = all keys'}
        </p>
      </div>

      {railMenu && tlObj && (
        <ContextMenu
          x={railMenu.x}
          y={railMenu.y}
          entries={(() => {
            const addV = { label: <>＋ add video track</>, onClick: (): void => void (vTracks < 8 && setTimelineMeta({ videoTracks: vTracks + 1 }, tlObj.id)) }
            const addA = { label: <>＋ add audio lane</>, onClick: (): void => void (laneCount < 8 && setTimelineMeta({ audioTracks: laneCount + 1 }, tlObj.id)) }
            const delA = {
              label: <>− delete last audio lane (must be empty)</>,
              onClick: (): void => {
                const used = (tlObj.audioItems ?? []).some((a) => a.lane === laneCount - 1)
                if (laneCount > 1 && !used) void setTimelineMeta({ audioTracks: laneCount - 1 }, tlObj.id)
                else if (used) toast('the last audio lane has blocks on it — clear it first', { kind: 'error' })
              }
            }
            if (railMenu.track == null) return [addV, addA, delA]
            const tr = railMenu.track
            const key = `v${tr}`
            const togg = (list: string[] | undefined, k: string): string[] => (list?.includes(k) ? (list ?? []).filter((x) => x !== k) : [...(list ?? []), k])
            const empty = !timeline.some((x) => trackOf(x) === tr)
            return [
              { label: <>{mutedTr.has(key) ? '👁 show' : '👁 hide'} V{tr + 1} (playback + export)</>, onClick: (): void => void setTimelineMeta({ mutedTracks: togg(tlObj.mutedTracks, key) }, tlObj.id) },
              { label: <>{soloTr.has(key) ? '◇ unsolo' : '◆ solo'} V{tr + 1}</>, onClick: (): void => void setTimelineMeta({ soloTracks: togg(tlObj.soloTracks, key) }, tlObj.id) },
              { label: <>{locked.has(key) ? '🔓 unlock' : '🔒 lock'} V{tr + 1}</>, onClick: (): void => void setTimelineMeta({ lockedTracks: togg(tlObj.lockedTracks, key) }, tlObj.id) },
              { sep: true, label: '' },
              addV,
              addA,
              ...(empty && vTracks > 1
                ? [{ label: <>✕ delete V{tr + 1} (empty)</>, danger: true, onClick: (): void => void setTimelineMeta({ videoTracks: vTracks - 1, mutedTracks: (tlObj.mutedTracks ?? []).filter((x) => x !== key), soloTracks: (tlObj.soloTracks ?? []).filter((x) => x !== key), lockedTracks: (tlObj.lockedTracks ?? []).filter((x) => x !== key) }, tlObj.id) }]
                : [])
            ]
          })()}
          onClose={() => setRailMenu(null)}
        />
      )}
      {gapMenu && (
        <ContextMenu
          x={gapMenu.x}
          y={gapMenu.y}
          entries={[
            {
              label: tlClipboard ? <>▣ paste here (this track, no ripple)</> : <>▣ paste here — copy a block first (Ctrl+C)</>,
              onClick: () => tlClipboard && void pasteTlClipboard({ at: gapMenu.at, track: gapMenu.track, ripple: false })
            },
            { label: <>⇤ close gap (pull everything left)</>, onClick: () => closeGap(gapMenu.track, gapMenu.at) },
            { label: <>◈ marker here</>, onClick: () => tlObj && void setTimelineMeta({ markers: [...(tlObj.markers ?? []), { id: String(Date.now()), at: gapMenu.at }] }, tlObj.id) }
          ]}
          onClose={() => setGapMenu(null)}
        />
      )}
      {markerMenu && tlObj && (
        <ContextMenu
          x={markerMenu.x}
          y={markerMenu.y}
          entries={(() => {
            const mm = (tlObj.markers ?? []).find((x) => x.id === markerMenu.id)
            return [
              {
                // the color row: 9 swatches in one entry — a swatch click sets the color, then
                // bubbles to the row and the menu closes itself (the row has no action of its own)
                label: (
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {MARKER_COLORS.map((c, i) => (
                      <span
                        key={i}
                        title={c ? 'marker color' : 'default (theme accent)'}
                        onClick={() => void setTimelineMeta({ markers: (tlObj.markers ?? []).map((x) => (x.id === markerMenu.id ? { ...x, color: c } : x)) }, tlObj.id)}
                        style={{ width: 14, height: 14, borderRadius: 3, background: c ?? 'var(--amber)', cursor: 'pointer', outline: (mm?.color ?? undefined) === c ? '2px solid var(--txt-hi)' : '1px solid rgba(0,0,0,.4)', outlineOffset: 1, flex: '0 0 auto' }}
                      />
                    ))}
                  </span>
                )
              },
              {
                label: <><Ic i={Pencil} size={12} /> rename marker</>,
                onClick: async (): Promise<void> => {
                  const n = await textPrompt('Marker name', mm?.name ?? '')
                  if (n != null) void setTimelineMeta({ markers: (tlObj.markers ?? []).map((x) => (x.id === markerMenu.id ? { ...x, name: n } : x)) }, tlObj.id)
                }
              },
              {
                label: <><Ic i={Trash2} size={12} /> delete marker</>,
                danger: true,
                onClick: () => void setTimelineMeta({ markers: (tlObj.markers ?? []).filter((x) => x.id !== markerMenu.id) }, tlObj.id)
              },
              { sep: true, label: '' },
              {
                label: <><Ic i={Trash2} size={12} /> delete all markers ({(tlObj.markers ?? []).length})</>,
                danger: true,
                onClick: () => void setTimelineMeta({ markers: [] }, tlObj.id)
              }
            ] as MenuEntry[]
          })()}
          onClose={() => setMarkerMenu(null)}
        />
      )}
    </div>
  )
}
