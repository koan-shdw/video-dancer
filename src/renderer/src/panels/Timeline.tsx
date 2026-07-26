import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useThumbUrl } from '../Thumbnail'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatImgUrls } from '../lib/beatUtils'
import { effDur, buildSegs, resolveView, sourceDurOf, activeItems, activeTimeline, audioStartOf } from '../lib/timelineUtils'
import { useStrip, sampleStrip } from '../lib/filmstrip'
import { useWave } from '../lib/waveform'
import { mediaUrl } from '../media'
import { MIME_CLIP, MIME_CLIPS, MIME_IMAGES, MIME_TAKE, MIME_TLITEM, MIME_AUDIO } from '../lib/dragDrop'
import { raiseTimelineMonitor, openClipEdit, openClipMonitor } from '../panelBus'
import { Ic, Play, Pause, SkipBack, SkipForward, Repeat, Film, Scissors, Magnet, Music, Volume2, VolumeX, Clapperboard, Upload, ZoomIn, ZoomOut, ImageDown, Wand2, Trash2, Monitor as MonitorIcon } from '../ui/icons'
import { toast } from '../ui/Toast'
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
        {props.takeLabel} ▾{props.muted ? <Ic i={VolumeX} size={9} style={{ marginLeft: 3 }} /> : null}
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 5, fontSize: 9, color: 'var(--body)', textShadow: '0 1px 2px #000', zIndex: 5 }}>
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
            onMouseDown={(e) => props.onTrimStart('in', e)}
            onClick={(e) => e.stopPropagation()}
            title="drag to trim start"
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }}
          />
          <div
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

function AudioItemLanes({ tl, total, segs, clips }: { tl: Timeline; total: number; segs: { start: number; dur: number }[]; clips: Clip[] }): React.JSX.Element | null {
  const setTimelineAudioItems = useStore((s) => s.setTimelineAudioItems)
  const laneRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<TimelineAudioItem | null>(null) // local gesture preview — commit once on release
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const LANE_H = 22
  const items = tl.audioItems ?? []
  if (items.length === 0) return null
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
        const nLane = Math.max(0, Math.min(2, base.lane + Math.round((ev.clientY - y0) / LANE_H)))
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
  return (
    <div ref={laneRef} style={{ position: 'relative', height: LANE_H * 3, borderTop: '1px solid var(--line)', background: 'var(--bg0)' }}>
      {[1, 2].map((l) => (
        <div key={l} style={{ position: 'absolute', left: 0, right: 0, top: l * LANE_H, borderTop: '1px dashed var(--line)', opacity: 0.5, pointerEvents: 'none' }} />
      ))}
      <span style={{ position: 'absolute', left: 4, top: 0, fontSize: 8, color: 'var(--dim)', pointerEvents: 'none' }}>clip audio</span>
      {items.map((a) => (
        <AudioItem key={a.id} a={view(a)} tl={tl} segs={segs} total={total} clips={clips} laneH={LANE_H} onGesture={onGesture} onMenu={(x, e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, id: x.id })
        }} />
      ))}
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

export function TimelinePanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const tlIndex = useStore((s) => s.tlIndex)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const tlProgress = useStore((s) => s.tlProgress)
  const tlLoop = useStore((s) => s.tlLoop)
  const selectedTlItemId = useStore((s) => s.selectedTlItemId)
  const selectTlItem = useStore((s) => s.selectTlItem)
  const snapPlayhead = useStore((s) => s.snapPlayhead)
  const snapBeats = useStore((s) => s.snapBeats)
  const toggleSnapPlayhead = useStore((s) => s.toggleSnapPlayhead)
  const toggleSnapBeats = useStore((s) => s.toggleSnapBeats)
  const showFilmstrips = useStore((s) => s.showFilmstrips)
  const toggleFilmstrips = useStore((s) => s.toggleFilmstrips)
  const tlPlay = useStore((s) => s.tlPlay)
  const tlPause = useStore((s) => s.tlPause)
  const tlSetIndex = useStore((s) => s.tlSetIndex)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const seek = useStore((s) => s.seek)
  const addToTimeline = useStore((s) => s.addToTimeline)
  const makeClipsFromImages = useStore((s) => s.makeClipsFromImages)
  const setTimelineItems = useStore((s) => s.setTimelineItems)
  const unlinkAudio = useStore((s) => s.unlinkAudio)
  const sliceItem = useStore((s) => s.sliceItem)
  const setTimelineMutes = useStore((s) => s.setTimelineMutes)
  const startExport = useStore((s) => s.startExport)
  const exportState = useStore((s) => s.exportState)
  const editTimelineSlot = useStore((s) => s.editTimelineSlot)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const [dragTrim, setDragTrim] = useState<{ index: number; inSec: number; outSec: number; side: 'in' | 'out' } | null>(null)
  const mirrorDisplayId = useStore((s) => s.mirrorDisplayId)
  const setMirrorDisplay = useStore((s) => s.setMirrorDisplay)
  const [outMenu, setOutMenu] = useState<{ x: number; y: number; displays: { id: number; label: string; width: number; height: number }[] } | null>(null)
  const [sliceMode, setSliceMode] = useState(false) // razor armed: clicking a clip cuts it; one-shot (disarms after a cut)
  const [zoom, setZoom] = useState(1) // 1 = fit; >1 widens the ruler/track/lane inside a h-scroller
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null) // the h-scroller — zoom keeps the viewport-center time fixed
  const trimming = useRef(false)

  // navigator resize-zoom: set zoom AND the visible window's left edge together (Premiere thumb)
  const zoomTo = (nz: number, leftFrac: number): void => {
    const z = Math.min(8, Math.max(1, nz))
    setZoom(z)
    requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (sc) sc.scrollLeft = Math.max(0, leftFrac * sc.clientWidth * z)
    })
  }
  // zoom without anchoring makes the time under the cursor jump — rescale around the viewport center
  const applyZoom = (nz: number): void => {
    const z = Math.min(8, Math.max(1, nz))
    const sc = scrollRef.current
    if (!sc || sc.clientWidth === 0 || z === zoom) {
      setZoom(z)
      return
    }
    const centerFrac = (sc.scrollLeft + sc.clientWidth / 2) / (sc.clientWidth * zoom)
    setZoom(z)
    requestAnimationFrame(() => {
      const s2 = scrollRef.current
      if (s2) s2.scrollLeft = Math.max(0, centerFrac * s2.clientWidth * z - s2.clientWidth / 2)
    })
  }

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
    // the picked storyboard face wins (display-only, set in the Clip Monitor) — but a face whose
    // image was deleted must FALL BACK to the first ref, never blank the block
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
    return `take ${idx + 1}${c.takes.length > 1 ? '/' + c.takes.length : ''}` // 'take N/M' — the one format everywhere
  }
  // the per-instance picker: S-B (storyboard/live recipe) always first, then the real takes.
  // 'C' stays the INTERNAL sentinel id — only the label changed.
  const takesOf = (clipId: string): { id: string; label: string }[] => [
    { id: 'C', label: 'S-B — storyboard' },
    ...(clipOf(clipId)?.takes ?? []).map((t, i) => ({ id: t.id, label: `take ${i + 1}` }))
  ]
  const curTakeId = (it: TimelineItem): string | undefined => {
    if (it.useRecipe) return 'C'
    return viewOf(it)?.take?.id ?? (clipOf(it.clipId)?.takes.length ? undefined : 'C')
  }
  // commits read FRESH store state and match by item id — the render-closure array + index can be
  // stale by the time the click lands (an in-flight delta merge shifts items under the handler)
  const freshItems = (): TimelineItem[] => activeItems(useStore.getState().project)
  const pickTake = (itemId: string, takeId: string): void =>
    void setTimelineItems(
      freshItems().map((x) =>
        x.id === itemId
          ? takeId === 'C'
            ? // C ignores trims (it tracks the live recipe duration) — clear them so stale values can't linger
              { ...x, takeId: undefined, useRecipe: true, inSec: undefined, outSec: undefined }
            : { ...x, takeId, useRecipe: undefined }
          : x
      )
    )

  const { segs, total } = buildSegs(viewTimeline, clips)

  // ---- music beat ticks as snap targets (slice + out-trim land cuts ON the music) ----
  const tlObjForSnap = activeTimeline(project)
  const musicForSnap = tlObjForSnap?.music
  const musicTrackForSnap = musicForSnap ? project?.audio.find((a) => a.id === musicForSnap.audioId) : undefined
  // analyze whenever music is on the timeline (one decode per file, cached) — snapping must not wait
  // for the lane to be expanded first
  const snapWave = useWave(musicTrackForSnap?.file, !!musicForSnap && snapBeats)
  const beatTimesTl = useMemo(() => {
    if (!snapWave || !musicForSnap || !snapBeats) return [] as number[]
    const inS = musicForSnap.inSec ?? 0
    const outS = Math.min(musicForSnap.outSec ?? snapWave.dur, snapWave.dur)
    return snapWave.beats
      .filter((t) => t >= inS && t <= outS)
      .map((t) => musicForSnap.startSec + (t - inS))
      .filter((t) => t > 0 && t < total)
  }, [snapWave, musicForSnap, total, snapBeats])
  // beat ticks crossing block i, as 0..1 fractions of that block's width
  const snapFracsFor = (i: number): number[] | undefined => {
    if (beatTimesTl.length === 0) return undefined
    const seg = segs[i]
    if (!seg || seg.dur <= 0) return undefined
    const out: number[] = []
    for (const t of beatTimesTl) {
      const f = (t - seg.start) / seg.dur
      if (f > 0.005 && f < 0.995) out.push(f)
    }
    return out.length ? out : undefined
  }

  // tick step follows the VISIBLE span, not the total — at 8x a total-based step put labels
  // further apart than the viewport, so the ruler showed no time reference at all
  const visTotal = total / zoom
  const step = visTotal <= 4 ? 0.5 : visTotal <= 12 ? 1 : visTotal <= 40 ? 5 : visTotal <= 120 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(Math.round(t * 10) / 10)

  // drags carry ITEM IDs, not array indices — the array can shift mid-drag (an in-flight
  // mutation's delta merging) and an index would then move, or land on, the wrong block
  const reorderMove = (fromId: string, toId: string): void => {
    const cur = freshItems()
    const from = cur.findIndex((x) => x.id === fromId)
    const to = cur.findIndex((x) => x.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const arr = [...cur]
    const [m] = arr.splice(from, 1)
    arr.splice(from < to ? to - 1 : to, 0, m)
    void setTimelineItems(arr)
  }
  const reorderToEnd = (fromId: string): void => {
    const cur = freshItems()
    const from = cur.findIndex((x) => x.id === fromId)
    if (from < 0) return
    const arr = [...cur]
    const [m] = arr.splice(from, 1)
    arr.push(m)
    void setTimelineItems(arr)
  }
  // clip(s) from the Bin land at `at` (null = append), side by side in payload (= selection) order
  const insertClips = (clipIds: string[], at: number | null): void => {
    const cur = freshItems()
    const idx = at == null ? cur.length : Math.max(0, Math.min(at, cur.length))
    const mk = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    void setTimelineItems([...cur.slice(0, idx), ...clipIds.map((clipId) => ({ id: mk(), clipId })), ...cur.slice(idx)])
  }
  // library image(s) dropped here → auto-make one clip per image (named after its @title, image as
  // ref) AND place them at `at` — one main-side mutation, one undo step
  const dropImages = (e: React.DragEvent, at: number | null): boolean => {
    const raw = e.dataTransfer.getData(MIME_IMAGES)
    if (!raw) return false
    try {
      const ids = JSON.parse(raw) as string[]
      if (Array.isArray(ids) && ids.length) void makeClipsFromImages(ids, at ?? freshItems().length)
    } catch {
      /* ignore malformed payloads */
    }
    return true
  }
  const dropClips = (e: React.DragEvent, at: number | null): boolean => {
    const raw = e.dataTransfer.getData(MIME_CLIPS)
    if (!raw) return false
    try {
      const ids = JSON.parse(raw) as string[]
      if (Array.isArray(ids) && ids.length) insertClips(ids, at)
    } catch {
      /* ignore malformed payloads */
    }
    return true
  }
  const onTrackDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropIdx(null)
    if (dropImages(e, null)) return
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
    if (dropClips(e, null)) return
    const clipId = e.dataTransfer.getData(MIME_CLIP)
    if (clipId) {
      void addToTimeline(clipId)
      return
    }
    const tlItemId = e.dataTransfer.getData(MIME_TLITEM)
    if (tlItemId !== '') reorderToEnd(tlItemId)
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
    raiseTimelineMonitor() // scrubbing means "show me the program" — front the Timeline Monitor
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
    // snap targets: the scrubber's source-frame (when the playhead is in THIS clip), and — for the
    // OUT edge — music beat ticks (the out edge's timeline position = segStart + (out - in), so a
    // beat at timeline T maps to out = T - segStart + in; the in edge never moves in timeline space)
    const playSrc = snapPlayhead && index === tlIndex ? startIn + tlProgress * (startOut - startIn) : null
    const segStart = segs[index]?.start ?? 0
    const beatOutCands = beatTimesTl
      .map((t) => t - segStart + startIn)
      .filter((o) => o > startIn + 0.25 && o <= src)
    const snapSec = 10 * secPerPx
    const nearest = (v: number, cands: number[]): number | null => {
      let best: number | null = null
      for (const c of cands) if (Math.abs(v - c) < snapSec && (best == null || Math.abs(v - c) < Math.abs(v - best))) best = c
      return best
    }
    let final = { inSec: startIn, outSec: startOut }
    const move = (ev: MouseEvent): void => {
      const dSec = (ev.clientX - startX) * secPerPx
      let f =
        side === 'in'
          ? { inSec: Math.min(Math.max(0, startIn + dSec), startOut - 0.25), outSec: startOut }
          : { inSec: startIn, outSec: Math.max(Math.min(src, startOut + dSec), startIn + 0.25) }
      if (side === 'in') {
        if (playSrc != null && Math.abs(f.inSec - playSrc) < snapSec) f = { inSec: Math.min(playSrc, startOut - 0.25), outSec: startOut }
      } else {
        const cands = playSrc != null ? [playSrc, ...beatOutCands] : beatOutCands
        const hit = nearest(f.outSec, cands)
        if (hit != null) f = { inSec: startIn, outSec: Math.max(Math.min(src, hit), startIn + 0.25) }
      }
      final = f
      setDragTrim({ index, side, ...final }) // LOCAL preview only — no store write, no app-wide re-render
    }
    const tlIdAtStart = proj.activeTimelineId // if the active timeline switches mid-drag, commit to THIS one
    const up = (): void => {
      trimming.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      // commit against FRESH state by id — `proj` is from mousedown; a delta landing during the
      // multi-second drag (Del key, queued mutation) would be silently reverted by a stale array
      void setTimelineItems(
        freshItems().map((x) => (x.id === it0.id ? { ...x, inSec: final.inSec, outSec: final.outSec } : x)),
        tlIdAtStart
      ).then(() => setDragTrim(null)) // persist once, then drop the local override
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // cut the clicked clip at frac (0..1 of its visible width) into two contiguous instances.
  // the split + the 'last'-edge dynamic-still remap happen ATOMICALLY in main (one mutation, one
  // save) — two chained IPC writes could leave a binding pointing at a half that never landed
  const sliceAt = (index: number, frac: number): void => {
    const it = timeline[index]
    if (!it) return
    const src = sourceDurOf(it, clips)
    const inS = it.inSec ?? 0
    const outS = Math.min(it.outSec ?? src, src)
    const cut = inS + frac * Math.max(0, outS - inS)
    if (cut - inS < 0.15 || outS - cut < 0.15) return // too thin to be a real cut
    void sliceItem(it.id, cut)
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
        <span style={{ cursor: 'pointer' }} onClick={() => tlSetIndex(Math.max(0, tlIndex - 1))} title="previous clip (←)">
          <Ic i={SkipBack} size={15} />
        </span>
        <span className="vd-play" style={{ cursor: 'pointer' }} onClick={() => (tlPlaying ? tlPause() : tlPlay())} title="play / pause (Space)">
          <Ic i={tlPlaying ? Pause : Play} size={16} />
        </span>
        <span style={{ cursor: 'pointer' }} onClick={() => tlSetIndex(Math.min(timeline.length - 1, tlIndex + 1))} title="next clip (→)">
          <Ic i={SkipForward} size={15} />
        </span>
        <span className="vd-loop" style={{ opacity: tlLoop ? 1 : 0.4, cursor: 'pointer' }} onClick={toggleLoop} title="loop playback">
          <Ic i={Repeat} size={14} />
        </span>
        <span
          className="vd-loop"
          style={{ opacity: showFilmstrips ? 1 : 0.4, cursor: 'pointer' }}
          onClick={toggleFilmstrips}
          title={showFilmstrips ? 'thumbnails on — click for faster plain blocks' : 'thumbnails off (faster)'}
        >
          <Ic i={Film} size={14} />
        </span>
        <span
          className="vd-loop"
          style={{ opacity: sliceMode ? 1 : 0.8, color: sliceMode ? 'var(--bad)' : undefined, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10 }}
          onClick={() => setSliceMode((v) => !v)}
          title="slice tool (S) — click a clip to cut it at that frame (turns off after one cut); Esc / right-click to cancel"
        >
          <Ic i={Scissors} size={14} /> slice
        </span>
        <span
          className="vd-loop"
          style={{ opacity: snapPlayhead ? 1 : 0.35, cursor: 'pointer' }}
          onClick={toggleSnapPlayhead}
          title={snapPlayhead ? 'scrubber snap ON — slice/trims lock to the playhead (click to disable)' : 'scrubber snap OFF — slice/trims move freely (click to enable)'}
        >
          <Ic i={Magnet} size={14} />
        </span>
        <span
          className="vd-loop"
          style={{ opacity: snapBeats ? 1 : 0.35, cursor: 'pointer', whiteSpace: 'nowrap' }}
          onClick={toggleSnapBeats}
          title={snapBeats ? 'beat snap ON — slice/out-trims lock to music beat ticks (click to disable)' : 'beat snap OFF (click to enable)'}
        >
          <Ic i={Magnet} size={14} />
          <Ic i={Music} size={11} />
        </span>
        {(() => {
          const tlObj = activeTimeline(project)
          if (!tlObj) return null
          return (
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
                title={tlObj.musicMuted ? 'music MUTED (playback + export) — click to unmute' : 'mute the music lane (playback + export)'}
              >
                <Ic i={Music} size={13} />
                <Ic i={tlObj.musicMuted ? VolumeX : Volume2} size={13} />
              </span>
              <span
                className="vd-loop"
                style={{ opacity: exportState.busy || timeline.length === 0 ? 0.4 : 0.8, cursor: 'pointer' }}
                onClick={() => !exportState.busy && timeline.length > 0 && void startExport(tlObj.id)}
                title="export this timeline as mp4 (res/fps set in the Timeline Editor)"
              >
                <Ic i={Upload} size={14} />
              </span>
              <span className="vd-loop" style={{ opacity: zoom > 1 ? 0.9 : 0.4, cursor: 'pointer' }} onClick={() => applyZoom(zoom / 1.5)} title="zoom out">
                <Ic i={ZoomOut} size={13} />
              </span>
              <span
                className="vd-loop"
                style={{ opacity: 0.9, fontSize: 10, fontFamily: 'var(--mono)', cursor: zoom > 1 ? 'pointer' : 'default' }}
                onClick={() => applyZoom(1)}
                title={zoom > 1 ? 'click to fit' : 'timeline zoom'}
              >
                {zoom > 1 ? `${Math.round(zoom * 100)}%` : 'fit'}
              </span>
              <span className="vd-loop" style={{ opacity: zoom < 8 ? 0.9 : 0.4, cursor: 'pointer' }} onClick={() => applyZoom(zoom * 1.5)} title="zoom in">
                <Ic i={ZoomIn} size={13} />
              </span>
              <span
                className="vd-loop"
                style={{ opacity: mirrorDisplayId != null ? 1 : 0.5, color: mirrorDisplayId != null ? 'var(--amber)' : undefined, cursor: 'pointer' }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  void window.vidancer.screenList().then((displays) => setOutMenu({ x: r.left, y: r.bottom + 4, displays }))
                }}
                title={mirrorDisplayId != null ? 'output monitor ON — playback mirrors to another display (click to change / turn off)' : 'output monitor — push playback fullscreen to another display'}
              >
                <Ic i={MonitorIcon} size={14} />
              </span>
            </>
          )
        })()}
        {exportState.msg && (
          <span
            className="vd-tc"
            onClick={() => exportState.file && void window.vidancer.revealFile(exportState.file)}
            title={exportState.file ? 'click to show the exported file in Explorer' : undefined}
            style={{ color: exportState.msg.startsWith('export error') ? 'var(--bad)' : 'var(--amber)', cursor: exportState.file ? 'pointer' : undefined }}
          >
            {exportState.msg.length > 48 ? exportState.msg.slice(0, 48) + '…' : exportState.msg}
          </span>
        )}
        <span className="vd-tc" title="active timeline (double-click it in the Bin to edit name/aspect)">
          ▤ {activeTimeline(project)?.name ?? '—'} · {activeTimeline(project)?.aspectRatio ?? ''}
        </span>
        <span className="vd-tc">{timeline.length} clips</span>
        <TimeReadout segs={segs} total={total} />
      </div>
      {outMenu && (
        <ContextMenu
          x={outMenu.x}
          y={outMenu.y}
          entries={[
            ...(outMenu.displays.length === 0
              ? [{ label: <span style={{ color: 'var(--dim)' }}>no other display detected</span> } as MenuEntry]
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

      {/* zoom >1 widens the content; ruler/track/lane/playhead all live inside so they scroll together */}
      <div ref={scrollRef} style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden' }}>
      <div ref={wrapRef} style={{ position: 'relative', width: `${zoom * 100}%` }}>
        <div
          onMouseDown={onScrubDown}
          style={{ position: 'relative', height: 16, borderBottom: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', background: 'var(--bg0)' }}
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
            if (t.includes(MIME_CLIP) || t.includes(MIME_TLITEM) || t.includes(MIME_TAKE) || t.includes(MIME_IMAGES)) e.preventDefault()
          }}
          onDrop={onTrackDrop}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return
            if (sliceMode) setSliceMode(false) // clicked empty track → exit slice
            else selectTlItem(null) // …or clear the block selection
          }}
          style={{ position: 'relative', padding: '4px 0', gap: 0 }}
        >
          {timeline.length === 0 && (
            <span className="vd-sm" style={{ color: 'var(--dim)', alignSelf: 'center', margin: 'auto' }}>drag clips from the Bin (or Library images — they become clips) here →</span>
          )}
          {viewTimeline.map((it, i) => {
            const sf = scrubFor(it, i)
            // ⑂: fork the slot's RESOLVED take into a Clip Edit draft; the slot's trims prefill the window.
            // Shared by the block's ⑂ glyph AND its right-click menu.
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
            // right-click menu: every action on this instance, reachable ON the instance
            const ctxEntries: MenuEntry[] = [
              ...(viewOf(it)?.take
                ? [
                    { label: <><Ic i={ImageDown} size={12} /> ⊢ first frame → Library (live still)</>, onClick: () => void addDynamicStillFor(it.id, 'first') },
                    { label: <><Ic i={ImageDown} size={12} /> last frame → Library (live still) ⊣</>, onClick: () => void addDynamicStillFor(it.id, 'last') },
                    { sep: true, label: '' } as MenuEntry
                  ]
                : []),
              ...(editVideo ? [{ label: <><Ic i={Wand2} size={12} /> edit this take with AI (v2v)</>, onClick: editVideo }] : []),
              ...(viewOf(it)?.take
                ? [
                    {
                      // detach this block's audio onto a lane (video mutes) — edit them separately,
                      // re-link on the audio block to make it ride the video again
                      label: <>♪ unlink audio → lane</>,
                      onClick: (): void => void unlinkAudio(it.id)
                    } as MenuEntry
                  ]
                : []),
              { label: <><Ic i={Trash2} size={12} /> remove from timeline</>, danger: true, onClick: removeBlock }
            ]
            return (
            <TlBlock
              key={`${it.id}-${i}`}
              flex={eff(it)}
              current={i === tlIndex}
              selected={it.id === selectedTlItemId}
              dropActive={dropIdx === i}
              name={nameOf(it.clipId)}
              durLabel={`${Math.round(eff(it) * 100) / 100}s`}
              takeLabel={takeLabel(it)}
              takes={takesOf(it.clipId)}
              currentTakeId={curTakeId(it)}
              onPickTake={(takeId) => pickTake(it.id, takeId)}
              muted={!!it.muted}
              onToggleMute={() => void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, muted: !x.muted || undefined } : x)))}
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
              playheadFrac={snapPlayhead && i === tlIndex ? tlProgress : undefined}
              snapFracs={sliceMode ? snapFracsFor(i) : undefined}
              onSlice={(frac) => sliceAt(i, frac)}
              scrubSrc={sf.src}
              scrubTime={sf.time}
              onTrimStart={(side, e) => onTrimStart(i, side, e)}
              onClick={() => {
                tlSetIndex(i)
                selectTlItem(it.id) // click = playhead here AND select (Del removes)
              }}
              onDoubleClick={() => {
                editTimelineSlot(i, it.clipId)
                openClipMonitor() // ALWAYS surface the Clip Monitor — same slot again, closed panel, whatever
              }}
              onRemove={removeBlock}
              onEditVideo={editVideo}
              contextEntries={ctxEntries}
              onDragStart={(e) => {
                if (trimming.current) {
                  e.preventDefault()
                  return
                }
                e.dataTransfer.setData(MIME_TLITEM, it.id) // stable id — the index can shift mid-drag
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                const t = e.dataTransfer.types
                if (t.includes(MIME_TLITEM) || t.includes(MIME_IMAGES) || t.includes(MIME_CLIPS)) {
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
                  reorderMove(f, it.id)
                  return
                }
                // image(s) / bin clip(s) dropped ON a block insert BEFORE it — the drop point.
                // index re-resolved by id at drop time (the closure `i` can be stale mid-drag)
                if (e.dataTransfer.types.includes(MIME_IMAGES) || e.dataTransfer.types.includes(MIME_CLIPS)) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropIdx(null)
                  const fi = freshItems().findIndex((x) => x.id === it.id)
                  const at = fi < 0 ? null : fi
                  if (!dropImages(e, at)) dropClips(e, at)
                }
              }}
            />
            )
          })}
        </div>

        {(() => {
          const tlObj = activeTimeline(project)
          return tlObj && timeline.length > 0 ? (
            <>
              <AudioItemLanes tl={tlObj} total={total} segs={segs} clips={clips} />
              <AudioLane tl={tlObj} total={total} audio={project?.audio ?? []} />
            </>
          ) : null
        })()}
        {timeline.length > 0 && <Playhead segs={segs} total={total} />}
      </div>
      </div>
      {timeline.length > 0 && <ZoomNav zoom={zoom} zoomTo={zoomTo} scrollRef={scrollRef} />}

      <p className="vd-hint">
        {sliceMode
          ? '✂ slice armed — click a clip to cut it (snaps to the scrubber) · turns off after one cut · Esc / right-click to cancel'
          : 'Click = select (Del removes) · right-click a block = frame stills & actions · drag to reorder · trims snap to the scrubber · ✂ or S to slice · − / + zoom · double-click to edit.'}
      </p>
    </div>
  )
}
