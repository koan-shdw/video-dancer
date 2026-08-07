import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useThumbUrl } from '../Thumbnail'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatImgUrls } from '../lib/beatUtils'
import { effDur, buildSegs, resolveView, resolveTake, sourceDurOf, activeItems, activeTimeline, audioStartOf, startOf, trackOf, timelineEnd, itemAt, sourceTimeAt, clampShiftLeft } from '../lib/timelineUtils'
import { useStrip, sampleStrip } from '../lib/filmstrip'
import { useWave } from '../lib/waveform'
import { mediaUrl } from '../media'
import { MIME_CLIP, MIME_CLIPS, MIME_IMAGES, MIME_TAKE, MIME_TLITEM, MIME_AUDIO, MIME_VIDEO } from '../lib/dragDrop'
import { raiseTimelineMonitor, openClipEdit, openClipMonitor } from '../panelBus'
import { Ic, Play, Pause, Pencil, SkipBack, SkipForward, Repeat, Film, Scissors, Magnet, Music, Volume2, VolumeX, Clapperboard, Upload, ZoomIn, ZoomOut, ImageDown, Wand2, Trash2, Monitor as MonitorIcon } from '../ui/icons'
import { toast } from '../ui/Toast'
import { textPrompt } from '../prompt'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'
import { addDynamicStillFor } from '../lib/dynamicStill'
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
            <img key={i} src={f} alt="" style={{ height: '100%', width: 'auto', flex: '0 0 auto', objectFit: 'cover', opacity: 0.95 }} />
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
          title="edit this take with AI (v2v) — opens Clip Edit as a draft, timeline untouched"
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

// ---- the audio lane: one music block per timeline — drag from the Library's ♪ section.
// Double-click the block: expand (waveform visible) ↔ collapse. While expanded, a plain click
// cycles the view: waveform → beats → both. ----
function AudioLane(props: { tl: Timeline; total: number; audio: ProjAudio[] }): React.JSX.Element {
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
        const half = Math.max(0.7, m * (h / 2 - 2))
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
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true
      if (!moved) return
      const d = (ev.clientX - x0) * spp
      if (kind === 'move') {
        final = { ...base, startSec: Math.max(0, Math.min(total - 0.25, base.startSec + d)) }
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
          {expanded && <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
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
          <div onMouseDown={(e) => startDrag('in', e)} title="trim start" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 2, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
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
            style={{ position: 'absolute', right: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#fff', textShadow: '0 1px 2px #000', fontSize: 10 }}
          >
            ✕
          </span>
          <div onMouseDown={(e) => startDrag('out', e)} title="trim end" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
        </div>
      )}
    </div>
  )
}

// ---- Timeline: ruler/scrubber + track of clip instances + playhead ----
// ---- audio lanes: detached clip audio on 3 absolute-time rows (music keeps its own lane) ----
// A block's right-click "unlink audio" lands here. Linked items (🔗) ride their video block through
// re-flows; free items sit at absolute time. Drag = move (vertical = change lane), edges = trim,
// right-click = link/unlink · mute · delete. Rendered only while the timeline has audio items.
function AudioItem({ a, tl, segs, total, clips, laneH, onGesture, onMenu }: {
  a: TimelineAudioItem
  tl: Timeline
  segs: { start: number; dur: number }[]
  total: number
  clips: Clip[]
  laneH: number
  onGesture: (kind: 'move' | 'in' | 'out', a: TimelineAudioItem, e: React.MouseEvent) => void
  onMenu: (a: TimelineAudioItem, e: React.MouseEvent) => void
}): React.JSX.Element {
  const clip = clips.find((c) => c.id === a.source.clipId)
  const file = clip?.takes.find((t) => t.id === a.source.takeId)?.file
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
      const h = Math.max(1, p * (c.height - 2))
      ctx.fillRect(x, (c.height - h) / 2, 1, h)
    }
  }, [wave, a.inSec, a.outSec, len, laneH, start, total])
  return (
    <div
      onMouseDown={(e) => onGesture('move', a, e)}
      onContextMenu={(e) => onMenu(a, e)}
      title={`${clip?.name ?? '?'} audio${a.link ? ' · 🔗 linked — rides its video block' : ' · free (absolute time)'}${a.muted ? ' · MUTED' : ''} · drag = move (up/down = lane) · edges = trim · right-click = actions`}
      style={{
        position: 'absolute',
        top: a.lane * laneH + 2,
        height: laneH - 4,
        left: `${(start / total) * 100}%`,
        width: `${(len / total) * 100}%`,
        minWidth: 16,
        background: a.muted
          ? 'color-mix(in srgb, var(--ok) 14%, transparent)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ok) 45%, transparent), color-mix(in srgb, var(--ok) 26%, transparent))',
        border: `1px solid color-mix(in srgb, var(--ok) ${a.muted ? 35 : 65}%, transparent)`,
        borderRadius: 3,
        cursor: 'grab',
        overflow: 'hidden'
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: '2px 0', pointerEvents: 'none', opacity: a.muted ? 0.35 : 1 }} />
      <span style={{ position: 'relative', fontSize: 8.5, color: '#fff', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', textShadow: '0 1px 2px #000', lineHeight: `${laneH - 4}px` }}>
        {a.link ? '🔗 ' : ''}
        {clip?.name ?? '?'}
      </span>
      <div onMouseDown={(e) => onGesture('in', a, e)} title="trim start" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 2, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
      <div onMouseDown={(e) => onGesture('out', a, e)} title="trim end" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 2, background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
    </div>
  )
}

function AudioItemLanes({ tl, total, segs, clips, items: videoItems, laneCount, laneH, onUnlink }: {
  tl: Timeline
  total: number
  segs: { start: number; dur: number }[]
  clips: Clip[]
  items: TimelineItem[]
  laneCount: number
  laneH: number
  onUnlink: (itemId: string) => void
}): React.JSX.Element | null {
  const setTimelineAudioItems = useStore((s) => s.setTimelineAudioItems)
  const laneRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<TimelineAudioItem | null>(null) // local gesture preview — commit once on release
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const LANE_H = laneH
  const items = tl.audioItems ?? []
  // COMPANIONS: every video block with a take whose audio is still embedded shows a LINKED audio
  // block (always visible, distinct tint) mirroring it exactly — right-click to unlink
  const companions = videoItems
    .map((it, i) => {
      if (it.audioDetachedId || it.useRecipe || it.disabled) return null // ⊘ disabled = silent
      const c = clips.find((x) => x.id === it.clipId)
      const take = c ? resolveTake(c, it) : undefined // same pick as the video block (skips disabled duds)
      if (!take) return null
      return { it, seg: segs[i] ?? { start: 0, dur: 1 }, name: c?.name ?? '?', file: take.file, lane: Math.min(laneCount - 1, it.track ?? 0) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const view = (a: TimelineAudioItem): TimelineAudioItem => (drag && drag.id === a.id ? drag : a)
  const fresh = (): TimelineAudioItem[] => activeTimeline(useStore.getState().project)?.audioItems ?? []
  const srcDurOf = (a: TimelineAudioItem): number => {
    const t = clips.find((c) => c.id === a.source.clipId)?.takes.find((x) => x.id === a.source.takeId)
    return t?.durationSec ?? a.outSec // unknown metadata yet → don't allow extending past what we know
  }
  const onGesture = (kind: 'move' | 'in' | 'out', a0: TimelineAudioItem, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const lane = laneRef.current
    if (!lane) return
    const spp = total / lane.getBoundingClientRect().width
    const x0 = e.clientX
    const y0 = e.clientY
    const base = { ...a0 }
    const baseStart = audioStartOf(base, segs, tl.items)
    let final = { ...base }
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - x0) * spp
      if (kind === 'move') {
        const len = Math.max(0.25, base.outSec - base.inSec)
        const nStart = Math.max(0, Math.min(Math.max(0, total - 0.25), baseStart + d))
        const nLane = Math.max(0, Math.min(laneCount - 1, base.lane + Math.round((ev.clientY - y0) / LANE_H)))
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
        // head trim: in-point and position move together (the tail stays put) — same as the music lane
        const nIn = Math.max(0, Math.min(base.outSec - 0.25, base.inSec + d))
        const shift = nIn - base.inSec
        final = {
          ...base,
          inSec: nIn,
          startSec: Math.max(0, baseStart + shift),
          ...(base.link ? { link: { ...base.link, offset: base.link.offset + shift } } : {})
        }
      } else {
        final = { ...base, outSec: Math.max(base.inSec + 0.25, Math.min(srcDurOf(base), base.outSec + d)) }
      }
      setDrag(final)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
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
    <div ref={laneRef} style={{ position: 'relative', height: LANE_H * laneCount, background: 'var(--bg0)' }}>
      {Array.from({ length: Math.max(0, laneCount - 1) }, (_, i) => i + 1).map((l) => (
        <div key={l} style={{ position: 'absolute', left: 0, right: 0, top: l * LANE_H, borderTop: '1px dashed var(--line)', opacity: 0.5, pointerEvents: 'none' }} />
      ))}
      <span style={{ position: 'absolute', left: 4, top: 0, fontSize: 8, color: 'var(--dim)', pointerEvents: 'none' }}>clip audio</span>
      {/* LINKED companions (always visible; blue tint; mirror their video block exactly) */}
      {companions.map((c) => (
        <div
          key={'comp:' + c.it.id}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, id: 'comp:' + c.it.id })
          }}
          title={`${c.name} audio · 🔗 LINKED — moves/trims with its video block · right-click to unlink onto a lane${c.it.muted ? ' · MUTED' : ''}`}
          style={{
            position: 'absolute',
            top: c.lane * LANE_H + 2,
            height: LANE_H - 4,
            left: `${(c.seg.start / total) * 100}%`,
            width: `${(c.seg.dur / total) * 100}%`,
            minWidth: 12,
            background: c.it.muted
              ? 'color-mix(in srgb, var(--alink) 12%, transparent)'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--alink) 40%, transparent), color-mix(in srgb, var(--alink) 22%, transparent))',
            border: '1px solid color-mix(in srgb, var(--alink) 60%, transparent)',
            borderRadius: 3,
            overflow: 'hidden',
            cursor: 'context-menu'
          }}
        >
          <span style={{ fontSize: 8.5, color: '#fff', paddingLeft: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px #000', lineHeight: `${LANE_H - 4}px`, display: 'block' }}>
            🔗 {c.name}
          </span>
        </div>
      ))}
      {/* FREE (unlinked) blocks — green tint, fully editable */}
      {items.map((a) => (
        <AudioItem key={a.id} a={view(a)} tl={tl} segs={segs} total={total} clips={clips} laneH={LANE_H} onGesture={onGesture} onMenu={(x, e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, id: x.id })
        }} />
      ))}
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
  const [dragView, setDragView] = useState<Map<string, { startSec: number; track: number }> | null>(null) // live gesture preview
  const [dragTrim, setDragTrim] = useState<{ id: string; inSec: number; outSec: number; startSec: number; side: 'in' | 'out' } | null>(null)
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
  const LANE_HV = useStore((s) => s.tlLaneH) || 22
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
      style={{ cursor: 'pointer', fontSize: 8.5, lineHeight: '14px', padding: '0 5px', borderRadius: 3, border: `1px solid ${on ? color : 'var(--line2)'}`, color: on ? '#000' : 'var(--dim)', background: on ? color : 'transparent', fontWeight: 700, userSelect: 'none' }}
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
  const contentEnd = timelineEnd(timeline, clips)
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
  // snap candidates: every block edge + playhead + beat ticks + markers (Shift bypasses at gesture time)
  const musicForSnap = tlObj?.music
  const musicTrackForSnap = musicForSnap ? project?.audio.find((a) => a.id === musicForSnap.audioId) : undefined
  const snapWave = useWave(musicTrackForSnap?.file, !!musicForSnap && snapBeats)
  const beatTimesTl = useMemo(() => {
    if (!snapWave || !musicForSnap || !snapBeats) return [] as number[]
    const inS = musicForSnap.inSec ?? 0
    const outS = Math.min(musicForSnap.outSec ?? snapWave.dur, snapWave.dur)
    return snapWave.beats.filter((t) => t >= inS && t <= outS).map((t) => musicForSnap.startSec + (t - inS)).filter((t) => t > 0 && t < total)
  }, [snapWave, musicForSnap, total, snapBeats])
  const snapTargets = (excludeIds: Set<string>): number[] => {
    const out: number[] = [0]
    for (const it of timeline) {
      if (excludeIds.has(it.id)) continue
      out.push(startOf(it), startOf(it) + eff(it))
    }
    if (snapPlayhead) out.push(useStore.getState().tlTime)
    out.push(...beatTimesTl)
    for (const m of tlObj?.markers ?? []) out.push(m.at)
    if (tlObj?.rangeInSec != null) out.push(tlObj.rangeInSec)
    if (tlObj?.rangeOutSec != null) out.push(tlObj.rangeOutSec)
    return out
  }
  const applySnap = (t: number, targets: number[], alsoEdge?: number): { t: number; hit: number | null } => {
    const tol = 8 * secPerPx()
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
    const base = new Map(freshItems().filter((x) => group.includes(x.id)).map((x) => [x.id, { startSec: startOf(x), track: trackOf(x) }]))
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
      const aTrack = Math.max(0, Math.min(vTracks - 1, b0.track - dTrack))
      for (const [id, b] of base) {
        const rel = b.startSec - b0.startSec
        const tr = Math.max(0, Math.min(vTracks - 1, b.track + (aTrack - b0.track)))
        // overlap allowed in the preview — the drop overwrites (carves) what's underneath
        next.set(id, { startSec: Math.max(0, aStart + rel), track: tr })
      }
      setDragView(next)
      if (snapHit != null) flashSnap(snapHit)
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.setTimeout(() => (justDragged.current = false), 0)
      const finalView = dragViewRef.current
      setDragView(null)
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
        void setTimelineItems(
          cur.map((x) => {
            if (finalView.has(x.id)) return { ...x, startSec: finalView.get(x.id)!.startSec, track: finalView.get(x.id)!.track }
            if (!locked.has(`v${trackOf(x)}`) && startOf(x) >= lo - 0.001) return { ...x, startSec: startOf(x) + span }
            return x
          })
        )
        shiftFreeAudio(lo, span)
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

  // shift every FREE audio block at/after fromT by delta (linked ones ride their video block)
  const shiftFreeAudio = (fromT: number, delta: number): void => {
    if (Math.abs(delta) < 0.001) return
    const aud = activeTimeline(useStore.getState().project)?.audioItems ?? []
    const shifts = (a: TimelineAudioItem): boolean => !a.link && (a.startSec ?? 0) >= fromT - 0.001
    if (aud.some(shifts)) {
      void useStore.getState().setTimelineAudioItems(aud.map((a) => (shifts(a) ? { ...a, startSec: Math.max(0, (a.startSec ?? 0) + delta) } : a)))
    }
  }

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
    void setTimelineItems(
      items.map((x) => {
        if (x.id === it.id) return { ...x, ...patch }
        if (!locked.has(`v${trackOf(x)}`) && startOf(x) >= fromT - 0.001) return { ...x, startSec: Math.max(0, startOf(x) + shift) }
        return x
      })
    )
    shiftFreeAudio(fromT, shift)
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
    const move = (ev: MouseEvent): void => {
      const dT = (ev.clientX - x0) * spp // timeline seconds
      const dS = dT * sp // source seconds for THIS item
      if (side === 'in') {
        const nIn = Math.max(0, Math.min(b.outSec - 0.25, b.inSec + dS))
        final = { inSec: nIn, outSec: b.outSec, startSec: Math.max(0, b.startSec + (nIn - b.inSec) / sp) }
      } else {
        const nOut = Math.max(b.inSec + 0.25, Math.min(src, b.outSec + dS))
        final = { inSec: b.inSec, outSec: nOut, startSec: b.startSec }
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
      void setTimelineItems(
        freshItems().map((x) => {
          if (x.id === it.id) return { ...x, inSec: final.inSec, outSec: final.outSec, startSec: final.startSec }
          if (partner && pFinal && x.id === partner.id) return { ...x, inSec: pFinal.inSec, outSec: pFinal.outSec, startSec: pFinal.startSec }
          if (doShift && startOf(x) >= oldEnd - 0.001) return { ...x, startSec: Math.max(0, startOf(x) + shift) }
          return x
        })
      ).then(() => setDragTrim(null))
      if (doShift) shiftFreeAudio(oldEnd, shift)
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
    if (it && takeFileOf(it)) sliceAtTime(it, T)
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

  // ---- ripple delete + close gap ----
  const rippleDelete = (it: TimelineItem): void => {
    const len = eff(it)
    const s = startOf(it)
    void setTimelineItems(
      freshItems()
        .filter((x) => x.id !== it.id)
        .map((x) => (!locked.has(`v${trackOf(x)}`) && startOf(x) >= s + len - 0.001 ? { ...x, startSec: Math.max(0, startOf(x) - len) } : x))
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
    const shift = ge - gs
    void setTimelineItems(cur.map((x) => (!locked.has(`v${trackOf(x)}`) && startOf(x) >= ge - 0.001 ? { ...x, startSec: Math.max(0, startOf(x) - shift) } : x)))
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const st = useStore.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        razorAtPlayhead()
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
        rippleToPlayhead(low === 'q' ? 'in' : 'out')
      } else if (e.key === ',' || e.key === '<' || e.key === '.' || e.key === '>') {
        e.preventDefault()
        nudgeSel(e.key === ',' || e.key === '<' ? -1 : 1, e.shiftKey)
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
        if (tlObj) void setTimelineMeta({ rangeInSec: st.tlTime }, tlObj.id)
      } else if (e.key === 'o' || e.key === 'O') {
        if (tlObj) void setTimelineMeta({ rangeOutSec: st.tlTime }, tlObj.id)
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
        void setTimelineItems(freshItems().filter((x) => !doomed.has(x.id)))
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && gapSel) {
        e.preventDefault()
        e.stopPropagation() // a selected gap outranks the single-selection delete in App
        deleteGapSel(gapSel)
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
    void setTimelineItems(items.map((x) => (ids.has(x.id) ? { ...x, startSec: Math.max(0, startOf(x) - L) } : x)))
    const aud = activeTimeline(useStore.getState().project)?.audioItems ?? []
    const shifts = (a: TimelineAudioItem): boolean => !a.link && (a.startSec ?? 0) >= g.t1 - 0.001
    if (aud.some(shifts)) {
      void useStore.getState().setTimelineAudioItems(aud.map((a) => (shifts(a) ? { ...a, startSec: Math.max(0, (a.startSec ?? 0) - L) } : a)))
    }
  }

  // ---- ruler content: ticks + markers + range band ----
  const visTotal = total / zoom
  const step = visTotal <= 4 ? 0.5 : visTotal <= 12 ? 1 : visTotal <= 40 ? 5 : visTotal <= 120 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(Math.round(t * 10) / 10)

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
        <span style={{ cursor: 'pointer' }} onClick={() => tlSeek(total)} title="to end (End)">
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
        <span className="vd-loop" style={{ opacity: snapPlayhead ? 1 : 0.35, cursor: 'pointer' }} onClick={toggleSnapPlayhead} title="snap to playhead + edges (S = toggle all snapping)">
          <Ic i={Magnet} size={14} />
        </span>
        <span className="vd-loop" style={{ opacity: snapBeats ? 1 : 0.35, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={toggleSnapBeats} title="snap to music beat ticks (S = toggle all snapping)">
          <Ic i={Magnet} size={14} />
          <Ic i={Music} size={11} />
        </span>
        {tlObj && (
          <>
            <span
              className="vd-loop"
              style={{ color: tlObj.videoMuted ? 'var(--bad)' : undefined, opacity: tlObj.videoMuted ? 1 : 0.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
              onClick={() => void setTimelineMutes(tlObj.id, { videoMuted: !tlObj.videoMuted })}
              title={tlObj.videoMuted ? 'clip audio MUTED (playback + export) — click to unmute' : 'mute all clip audio (playback + export)'}
            >
              <Ic i={Clapperboard} size={13} />
              <Ic i={tlObj.videoMuted ? VolumeX : Volume2} size={13} />
            </span>
            <span
              className="vd-loop"
              style={{ color: tlObj.musicMuted ? 'var(--bad)' : undefined, opacity: tlObj.musicMuted ? 1 : 0.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
              onClick={() => void setTimelineMutes(tlObj.id, { musicMuted: !tlObj.musicMuted })}
              title={tlObj.musicMuted ? 'music MUTED — click to unmute' : 'mute the music lane'}
            >
              <Ic i={Music} size={13} />
              <Ic i={tlObj.musicMuted ? VolumeX : Volume2} size={13} />
            </span>
            <span
              className="vd-loop"
              style={{ opacity: exportState.busy || timeline.length === 0 ? 0.4 : 0.8, cursor: 'pointer' }}
              onClick={() => !exportState.busy && timeline.length > 0 && void startExport(tlObj.id)}
              title="export this timeline as mp4 (exports just the in/out range when one is set)"
            >
              <Ic i={Upload} size={14} />
            </span>
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
        <TimeReadout total={total} />
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
            style={{ flex: '0 0 auto', width: 96, minHeight: '100%', borderRight: '1px solid var(--line)', background: 'var(--bg0)', fontSize: 9, color: 'var(--muted)', paddingTop: 16 }}
          >
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
                  style={{ position: 'relative', height: ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 6px', borderBottom: '1px solid var(--line)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--txt-hi)' }}>V{tr + 1}</span>
                    {empty && vTracks > 1 && (
                      <span
                        onClick={() => tlObj && void setTimelineMeta({ videoTracks: vTracks - 1, mutedTracks: (tlObj.mutedTracks ?? []).filter((x) => x !== key), soloTracks: (tlObj.soloTracks ?? []).filter((x) => x !== key), lockedTracks: (tlObj.lockedTracks ?? []).filter((x) => x !== key) }, tlObj.id)}
                        title="delete this empty track"
                        style={{ cursor: 'pointer', marginLeft: 'auto', color: 'var(--dim)' }}
                      >
                        ✕
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {chip('👁', isM, 'var(--bad)', 'hide this video track — skipped in playback AND export (lit = hidden)', () => tlObj && void setTimelineMeta({ mutedTracks: togg(tlObj.mutedTracks, key) }, tlObj.id))}
                    {chip('S', isS, 'var(--amber)', 'solo this video track', () => tlObj && void setTimelineMeta({ soloTracks: togg(tlObj.soloTracks, key) }, tlObj.id))}
                    {chip('🔒', isL, 'var(--amber)', 'lock this track (rejects edits)', () => tlObj && void setTimelineMeta({ lockedTracks: togg(tlObj.lockedTracks, key) }, tlObj.id))}
                  </div>
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
            {/* audio lane labels — heights mirror AudioItemLanes (LANE_HV rows) */}
            <div>
              {Array.from({ length: laneCount }, (_, l) => {
                const aKey = `a${l}`
                return (
                  <div key={l} style={{ position: 'relative', height: LANE_HV, display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px', fontFamily: 'var(--mono)', color: 'var(--dim)' }}>
                    <span style={{ marginRight: 1 }}>A{l + 1}</span>
                    {LANE_HV >= 18 && (
                      <>
                        {chip('M', mutedTr.has(aKey), 'var(--bad)', 'mute this audio lane (playback + export)', () => tlObj && void setTimelineMeta({ mutedTracks: togg(tlObj.mutedTracks, aKey) }, tlObj.id))}
                        {chip('S', soloTr.has(aKey), 'var(--amber)', 'solo this audio lane (mutes the others)', () => tlObj && void setTimelineMeta({ soloTracks: togg(tlObj.soloTracks, aKey) }, tlObj.id))}
                      </>
                    )}
                    {/* invisible bottom hot-zone: drag = resize ALL audio lanes (uniform) */}
                    <div onMouseDown={(e) => dragHeights(e, 'lane')} title="drag = resize the audio lanes" style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 6, cursor: 'ns-resize', zIndex: 2 }} />
                  </div>
                )
              })}
            </div>
            {tlObj && timeline.length > 0 && (
              <div style={{ height: 24, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', padding: '0 6px', color: 'var(--dim)' }}>♪</div>
            )}
            <div style={{ display: 'flex', gap: 3, padding: '4px 6px' }}>
              <span className="btn vd-hbtn" style={{ fontSize: 9, padding: '2px 6px', whiteSpace: 'nowrap' }} onClick={() => tlObj && vTracks < 8 && void setTimelineMeta({ videoTracks: vTracks + 1 }, tlObj.id)} title="add a video track">
                +V
              </span>
              <span className="btn vd-hbtn" style={{ fontSize: 9, padding: '2px 6px', whiteSpace: 'nowrap' }} onClick={() => tlObj && laneCount < 8 && void setTimelineMeta({ audioTracks: laneCount + 1 }, tlObj.id)} title="add an audio lane">
                +A
              </span>
              <span
                className="btn vd-hbtn"
                style={{ fontSize: 9, padding: '2px 6px', whiteSpace: 'nowrap' }}
                onClick={() => {
                  const used = (tlObj?.audioItems ?? []).some((a) => a.lane === laneCount - 1)
                  if (tlObj && laneCount > 1 && !used) void setTimelineMeta({ audioTracks: laneCount - 1 }, tlObj.id)
                  else if (used) toast('the last audio lane has blocks on it — clear it first', { kind: 'error' })
                }}
                title="delete the last audio lane (must be empty)"
              >
                −A
              </span>
            </div>
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
                style={{ position: 'relative', height: 16, borderBottom: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', touchAction: 'none', background: 'var(--bg0)' }}
                title="click or drag to scrub · M = marker at playhead · I/O = in/out range"
              >
                {ticks.map((t) => (
                  <div key={t} style={{ position: 'absolute', left: `${(t / total) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--line2)', paddingLeft: 2, fontSize: 8, color: 'var(--dim)' }}>
                    {t}s
                  </div>
                ))}
                {tlObj?.rangeInSec != null && tlObj?.rangeOutSec != null && tlObj.rangeOutSec > tlObj.rangeInSec && (
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(tlObj.rangeInSec / total) * 100}%`, width: `${((tlObj.rangeOutSec - tlObj.rangeInSec) / total) * 100}%`, background: 'color-mix(in srgb, var(--amber) 22%, transparent)', pointerEvents: 'none' }} />
                )}
                {(tlObj?.markers ?? []).map((m) => (
                  <div
                    key={m.id}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      tlSeek(m.at)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMarkerMenu({ x: e.clientX, y: e.clientY, id: m.id })
                    }}
                    title={`${m.name ?? 'marker'} @ ${Math.round(m.at * 100) / 100}s · click = jump · right-click = actions`}
                    style={{ position: 'absolute', left: `${(m.at / total) * 100}%`, top: 0, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `9px solid ${m.color ?? 'var(--amber)'}`, marginLeft: -5, cursor: 'pointer', zIndex: 3 }}
                  />
                ))}
              </div>

              {/* video track rows (top row = highest track) */}
              <div ref={tracksRef} style={{ position: 'relative', cursor: selFwd ? 'e-resize' : undefined }} onMouseDown={(e) => e.target === e.currentTarget && startMarquee(e)}>
                {trackRows.map((tr) => (
                  <div
                    key={tr}
                    onMouseDown={(e) => e.target === e.currentTarget && startMarquee(e)}
                    onDragOver={(e) => {
                      const t = e.dataTransfer.types
                      if (t.includes(MIME_CLIP) || t.includes(MIME_CLIPS) || t.includes(MIME_TAKE) || t.includes(MIME_IMAGES) || t.includes(MIME_VIDEO)) e.preventDefault()
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
                    {timeline
                      .filter((it) => posOf(it).track === tr)
                      .map((it) => {
                        const pos = posOf(it)
                        const win = winOf(it)
                        const len = effView(it)
                        const editVideo = viewOf(it)?.take
                          ? (): void => {
                              const take = viewOf(it)!.take!
                              useStore.getState().setEditTarget({
                                source: { clipId: it.clipId, takeId: take.id, ...(it.inSec != null ? { inSec: it.inSec } : {}), ...(it.outSec != null ? { outSec: it.outSec } : {}) }
                              })
                              openClipEdit()
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
                          ...(editVideo ? [{ label: <><Ic i={Wand2} size={12} /> edit this take with AI (v2v)</>, onClick: editVideo }] : []),
                          ...(viewOf(it)?.take && !it.audioDetachedId
                            ? [{ label: <>♪ unlink audio → lane</>, onClick: (): void => void unlinkAudio(it.id) } as MenuEntry]
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
                              playheadFrac={undefined}
                              snapFracs={undefined}
                              onSlice={(frac) => sliceAtTime(it, pos.start + frac * len)}
                              scrubSrc={showFilmstrips && dragTrim?.id === it.id ? (takeFileOf(it) ? mediaUrl(takeFileOf(it)!) : undefined) : undefined}
                              scrubTime={dragTrim?.id === it.id ? (dragTrim.side === 'in' ? dragTrim.inSec : dragTrim.outSec) : undefined}
                              onTrimStart={(side, e) => onTrimStart(it, side, e)}
                              onClick={() => {
                                selectTlItem(it.id)
                                tlSeek(pos.start)
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
                />
              )}
              {tlObj && timeline.length > 0 && <AudioLane tl={tlObj} total={total} audio={project?.audio ?? []} />}
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
          entries={[
            {
              label: <><Ic i={Pencil} size={12} /> rename marker</>,
              onClick: async (): Promise<void> => {
                const m = (tlObj.markers ?? []).find((x) => x.id === markerMenu.id)
                const n = await textPrompt('Marker name', m?.name ?? '')
                if (n != null) void setTimelineMeta({ markers: (tlObj.markers ?? []).map((x) => (x.id === markerMenu.id ? { ...x, name: n } : x)) }, tlObj.id)
              }
            },
            {
              label: <><Ic i={Trash2} size={12} /> delete marker</>,
              danger: true,
              onClick: () => void setTimelineMeta({ markers: (tlObj.markers ?? []).filter((x) => x.id !== markerMenu.id) }, tlObj.id)
            }
          ]}
          onClose={() => setMarkerMenu(null)}
        />
      )}
    </div>
  )
}
