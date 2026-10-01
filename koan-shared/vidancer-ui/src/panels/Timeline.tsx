import { vd } from '../api'
import { WatchTimelineModal } from './WatchTimelineModal'
import { TimelineTransitions } from './TimelineTransitions'
import { DissolveModal } from './DissolveModal'
import { hasOpenDialog } from '../ui/dialogFocus'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tetherAttr } from '../lib/tether'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useThumbUrl } from '../Thumbnail'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatImgUrls } from '../lib/beatUtils'
import { effDur, buildSegs, resolveView, resolveTake, sourceDurOf, activeItems, activeTimeline, audioStartOf, startOf, trackOf, timelineEnd, itemAt, sourceTimeAt, clampShiftLeft, audioEndOf, nextOnTrackStart, tailEndOf, carveVideo, overwriteLanes, carveScores, scoreTrackCount, companionSpan, audioLenOf, newId, toggleTrackPair, nestLenOf, nestReaches, nestOfAudio, flattenNests, remapped, srcAtRel, relAtSrc, lenOfWindow, remapAudioOut } from '../lib/timelineUtils'
import { SpeedBand } from '../ui/SpeedBand'
import { remapDeleteKey, remapNew, remapRange, type SpeedRemap } from '../shared/remap'
import type { LaneSpan } from '../lib/timelineUtils'
import { playFileOf } from '../shared/reverse'
import { SpeedModal } from './SpeedModal'
import { enhanceTone, enhanceWords, type EnhanceMark } from '../shared/enhance'
import { depthLabel, DEPTH_TITLE, queueDepth } from '../lib/depthJob'
import { useStrip, sampleStrip } from '../lib/filmstrip'
import { useWave, peakAmp } from '../lib/waveform'
import { mediaUrl } from '../media'
import { MIME_CLIP, MIME_CLIPS, MIME_IMAGES, MIME_TAKE, MIME_TLITEM, MIME_AUDIO, MIME_SCORE, MIME_VIDEO, MIME_VEDITNODE, MIME_TIMELINE } from '../lib/dragDrop'
import { raiseTimelineMonitor, grabProgramFrame, openVideoEditor, openClipMonitor, openEffectsPanel, openScoreCard, openTimelineWindow } from '../panelBus'
import { hasFx2, readFx2 } from '../fx/fxData'
import { Ic, ScoreIcon, Play, Pause, Pencil, PenTool, SkipBack, SkipForward, Repeat, Film, Scissors, Magnet, Music, Volume2, VolumeX, Upload, ZoomIn, ZoomOut, ImageDown, Wand2, Trash2, Monitor as MonitorIcon } from '../ui/icons'
import { toast } from '../ui/Toast'
import { textPrompt } from '../prompt'
import { ContextMenu, type MenuEntry } from '@koan/shared'
import { VolumeBand, toggleKeyframeAt } from '../ui/VolumeBand'
import { FadeHandles, DEFAULT_FADE_SEC } from '../ui/FadeHandles'
import type { FadeShape, VolumePoint } from '../shared/types'
import { resolveAudioSource } from '../shared/audioSource'
import { addDynamicStillFor } from '../lib/dynamicStill'
import { smpte, smpteFrames, TC_FPS } from '../lib/time'
import { Playhead, TimeReadout } from './shared/playback'
import { EmptyState } from '../ui/EmptyState'

// ---- one timeline block (filmstrip of frames from the clip's take) ----
function TlBlock(props: {
  flex: number
  current: boolean // the playhead is inside this block
  note?: string // ASSEMBLY: which outline shot this block serves — shown in the tooltip
  enhanced?: EnhanceMark // list 52: the take it plays is an ENHANCE copy — his outline, inside the selection ring
  selected: boolean // click-selected (Del removes) — the amber ring
  dropActive: boolean
  name: string
  durLabel: string
  takeLabel: string
  dynamic: boolean // no pinned takeId — follows the clip's ★ keeper (dotted ring + ★ label)
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
  onEditVideo?: () => void // ⑂ — open this instance's take in the Video Editor (v2v)
  contextEntries?: MenuEntry[] // right-click menu (frame stills / edit / remove) — built per-instance by the parent
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  nest?: boolean // NEST (list 3): this block plays a timeline — its own tint, no take picker
  nestFace?: TimelineItem // NEST (part 2): draw what shows inside it (its clips' own frames)
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
      className={'vd-clip' + (props.selected ? ' sel' : '') + (props.dynamic ? ' vd-clip-dyn' : '')}
      style={{
        flex: props.flex,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 44,
        // playhead-in-this-block gets a quiet marker; the loud amber ring belongs to SELECTION
        borderColor: props.selected ? undefined : props.current ? 'var(--amber-dim)' : undefined,
        borderLeft: props.dropActive ? '3px solid var(--amber)' : undefined,
        outline: !props.videoFile && !props.nest ? '1px dashed var(--amber-dim)' : undefined,
        outlineOffset: -1,
        ...(props.nest ? { background: 'linear-gradient(180deg, color-mix(in srgb, var(--alink) 40%, var(--bg2)), color-mix(in srgb, var(--alink) 18%, var(--bg2)))' } : {}),
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
      title={props.sliceMode ? (props.canSlice ? 'click to cut here' : 'no take to cut (render first)') : props.nest ? '⧉ nest — plays its timeline live · double-click opens it · drag to move' : `${props.note ? `${props.note}\n` : ''}${props.enhanced ? `${enhanceWords(props.enhanced)} — an enhanced copy\n` : ''}double-click to edit · drag to reorder`}
    >
      {props.nestFace ? (
        <NestFace it={props.nestFace} w={size.w} h={size.h} />
      ) : frames.length > 1 ? (
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
      {props.nest ? (
        <div style={{ position: 'absolute', top: 17, left: 5, fontSize: 9, color: 'var(--muted)', textShadow: '0 1px 2px #000', zIndex: 5 }}>⧉ nest · double-click opens</div>
      ) : (
      <div
        style={{ position: 'absolute', top: 17, left: 5, fontSize: 9, color: 'var(--muted)', cursor: 'pointer', textShadow: '0 1px 2px #000', zIndex: 5 }}
        onClick={(e) => {
          e.stopPropagation()
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
        title={props.dynamic ? 'follows the ★ keeper — click a take in Clip Gen to change this shot · pick here to pin one' : "pick this instance's take"}
      >
        {props.dynamic ? <span style={{ color: 'var(--amber)' }}>★ </span> : null}
        {props.takeLabel} ▾{props.muted ? <Ic i={VolumeX} size={9} style={{ marginLeft: 3 }} /> : null}
      </div>
      )}
      <div style={{ position: 'absolute', bottom: 8, left: 5, fontSize: 9, color: 'var(--body)', textShadow: '0 1px 2px #000', zIndex: 5 }}>
        {props.nest ? '⧉' : props.videoFile ? '▶' : '▦'} {props.durLabel}
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
      {/* list 52 (his ask 10-01): an enhanced copy wears its outline on the timeline too — drawn over the
          filmstrip, inside the block's border so the amber selection ring still shows */}
      {props.enhanced && <div data-enhanced style={{ position: 'absolute', inset: 0, border: `2px solid ${enhanceTone(props.enhanced)}`, borderRadius: 'inherit', pointerEvents: 'none', zIndex: 5 }} />}
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
          <Ic i={ScoreIcon} size={10} /> audio — drag music from the Library
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
            onChange={(r) => void setTimelineMusic(tl.id, { ...music, gain: r.gain === 1 ? undefined : r.gain, volume: r.points.length ? r.points : undefined })}
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
// list 57 (10-01): right-click the timeline → "create beat in score": a blank beat in the score
// under that spot, at that second of its span (the beat bands' own reckoning); the Score card opens
// on it with the new row ready to type in. No score on the timeline = no entry; none under the
// spot = greyed; two stacked on S tracks = a submenu naming each.
function scoreBeatEntries(tl: Timeline | undefined, at: number, onlyItemId?: string): MenuEntry[] {
  const spans = (tl?.scoreItems ?? []).filter((x) => !onlyItemId || x.id === onlyItemId)
  if (!spans.length) return []
  const scores = useStore.getState().project?.scoreClips ?? []
  const nameOf = (it: TimelineScoreItem): string => scores.find((s) => s.id === it.scoreClipId)?.name ?? 'score'
  const under = spans.filter((x) => at >= x.startSec && at < x.startSec + x.spanSec).sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0))
  const add = (it: TimelineScoreItem): void => {
    const st = useStore.getState()
    const sc = st.project?.scoreClips.find((s) => s.id === it.scoreClipId)
    if (!sc) return
    const id = newId()
    const sec = Math.round(Math.max(0, Math.min(it.spanSec, at - it.startSec)) * 10) / 10
    void st.saveScoreClip(sc.id, { beats: [...sc.beats, { id, at: sec, text: '' }] }).then(() => {
      st.setEditorScore(sc.id)
      openScoreCard()
      // the new row's text box takes the keys once the card shows it
      let n = 0
      const focus = (): void => {
        const el = document.querySelector<HTMLInputElement>(`[data-beat-text="${id}"]`)
        if (el) {
          el.scrollIntoView({ block: 'nearest' })
          el.focus()
        } else if (++n < 60) requestAnimationFrame(focus)
      }
      requestAnimationFrame(focus)
    })
  }
  const label = <>♪ create beat in score</>
  if (!under.length) return [{ label, disabled: true, title: 'no score under this spot — right-click over a score’s span' }]
  if (under.length === 1) return [{ label, title: `a blank beat in ${nameOf(under[0])} at ${Math.round((at - under[0].startSec) * 10) / 10}s of its span`, onClick: () => add(under[0]) }]
  return [{ label, title: 'more than one score plays here — pick the one', sub: under.map((it): MenuEntry => ({ label: <>{nameOf(it)} · S{(it.lane ?? 0) + 1}</>, onClick: () => add(it) })) }]
}

// list 2 (2026-09-29): the S (score) tracks — ♪ blocks live ONLY here, below the A lanes, with the
// A-lane grammar (move · trim · stretch · razor · fades · volume view), and only scores ever land here
function ScoreBlocks(props: { tl: Timeline; total: number; scoreClips: ScoreClip[]; laneH: number; sCount: number; snap: SnapKit; sliceMode: boolean; onSlice: (id: string, T: number) => void }): React.JSX.Element {
  const setTimelineScoreItems = useStore((s) => s.setTimelineScoreItems)
  const [drag, setDrag] = useState<TimelineScoreItem | null>(null) // local preview during move/stretch
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; at: number } | null>(null)
  const laneRef = useRef<HTMLDivElement>(null) // the S-track container (x scale + rows)
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number; at: number } | null>(null)
  const atX = (clientX: number): number => {
    const r = laneRef.current?.getBoundingClientRect()
    return r ? Math.max(0, Math.min(props.total, ((clientX - r.left) / Math.max(1, r.width)) * props.total)) : 0
  }
  const { tl, total, laneH, sCount: laneCount } = props
  const items = tl.scoreItems ?? []
  const selectedScoreItemId = useStore((s) => s.selectedScoreItemId)
  const expandedLanes = useStore((s) => s.expandedScoreLanes) // per-track tall volume view
  const menuItem = menu ? items.find((x) => x.id === menu.id) : undefined
  const gainOf = (s: TimelineScoreItem): number => s.gain ?? 1
  // per-track heights (ONE track expands, Premiere-style) — must mirror the rail's S rows
  const hOf = (l: number): number => (expandedLanes.includes(l) ? 64 : laneH)
  const topOf = (l: number): number => {
    let t = 0
    for (let i = 0; i < l; i++) t += hOf(i)
    return t
  }
  // below the last S track = a new one when allowNew (until the 8-track cap) — the Premiere
  // new-track drop, same grammar as the A lanes
  const laneAtY = (clientY: number, allowNew = false): number => {
    const top = laneRef.current?.getBoundingClientRect().top ?? 0
    let y = clientY - top
    for (let l = 0; l < laneCount; l++) {
      y -= hOf(l)
      if (y < 0) return l
    }
    return allowNew && laneCount < 8 ? laneCount : laneCount - 1
  }
  const secPerPx = (): number => total / (laneRef.current?.getBoundingClientRect().width ?? 1)
  const commit = (next: TimelineScoreItem[]): void => void setTimelineScoreItems(tl.id, next, tl.rev)
  const growTo = (lane: number): void => {
    if (lane >= laneCount) void useStore.getState().setTimelineMeta({ scoreTracks: lane + 1 }, tl.id)
  }
  // collision walls for trims: the other scores on the same S track (nothing else lives here)
  const occ = items.map((x) => ({ lane: x.lane ?? 0, start: x.startSec, end: x.startSec + x.spanSec, id: x.id }))
  const startDrag = (it: TimelineScoreItem, kind: 'move' | 'span' | 'in', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if ((props.tl.lockedTracks ?? []).includes(`s${it.lane ?? 0}`)) return // a locked S track rejects edits
    if (props.sliceMode) {
      // 41: the razor on a ♪ span — cut at the click, snapped like the video razor
      if (kind !== 'move') return
      const r = laneRef.current?.getBoundingClientRect()
      if (!r) return
      const raw = Math.max(0, Math.min(props.total, ((e.clientX - r.left) / r.width) * props.total))
      const res = props.snap.apply(raw, props.snap.targets(new Set([it.id])))
      props.onSlice(it.id, res.hit != null ? res.t : raw)
      return
    }
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
    const nextStart = Math.min(...occ.filter((o) => o.lane === wallLane && o.id !== it.id && o.start > it.startSec + 0.05).map((o) => o.start), Infinity)
    const prevEnd = Math.max(...occ.filter((o) => o.lane === wallLane && o.id !== it.id && o.end < it.startSec + it.spanSec - 0.05).map((o) => o.end), 0)
    const pen = useStore.getState().tlTool === 'pen' // list 4: the Pen never moves or trims a clip
    const move = (ev: MouseEvent): void => {
      if (pen) return
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
        // vertical = change lane, same grammar as the green blocks (per-lane heights aware);
        // below the last lane = new-lane intent (the release creates it)
        const nLane = Math.max(0, laneAtY(ev.clientY, true))
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
        if (kind === 'move') {
          // OVERWRITE on the S track: the landing carves the scores under it, never hops (list 2:
          // only scores live here, so nothing else is ever touched)
          growTo(final.lane ?? 0)
          const next = carveScores(items.map((x) => (x.id === it.id ? final : x)), [{ lane: final.lane ?? 0, start: final.startSec, end: final.startSec + final.spanSec }], new Set([it.id]), new Set(tl.lockedTracks ?? []))
          void setTimelineScoreItems(tl.id, next, tl.rev).then(() => setDrag(null))
        } else void setTimelineScoreItems(tl.id, items.map((x) => (x.id === it.id ? final : x)), tl.rev).then(() => setDrag(null))
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
    <div
      ref={laneRef}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes(MIME_SCORE)) e.preventDefault() // scores only
      }}
      onDrop={(e) => {
        const scoreId = e.dataTransfer.getData(MIME_SCORE)
        if (!scoreId) return
        e.preventDefault()
        const sc = props.scoreClips.find((x) => x.id === scoreId)
        const r = laneRef.current?.getBoundingClientRect()
        if (!sc || !r) return
        const start = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total
        const keeper = sc.takes.find((t) => t.id === sc.keeperTakeId) ?? sc.takes[sc.takes.length - 1]
        const span = Math.max(5, Math.round(keeper?.durationSec ?? 30))
        // lands on the S track under the cursor (below the last = a new one) and carves the
        // scores already there, the Premiere way
        const lane = Math.max(0, laneAtY(e.clientY, true))
        growTo(lane)
        const it: TimelineScoreItem = { id: newId(), scoreClipId: sc.id, startSec: start, spanSec: span, lane: lane || undefined }
        void setTimelineScoreItems(tl.id, carveScores([...items, it], [{ lane, start, end: start + span }], new Set([it.id]), new Set(tl.lockedTracks ?? [])), tl.rev)
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return // blocks own their menus
        e.preventDefault()
        setBgMenu({ x: e.clientX, y: e.clientY, at: atX(e.clientX) })
      }}
      style={{ position: 'relative', height: topOf(laneCount), background: 'var(--bg0)' }}
    >
      {Array.from({ length: Math.max(0, laneCount - 1) }, (_, i) => i + 1).map((l) => (
        <div key={l} style={{ position: 'absolute', left: 0, right: 0, top: topOf(l), borderTop: '1px dashed var(--line)', opacity: 0.5, pointerEvents: 'none' }} />
      ))}
      <span style={{ position: 'absolute', left: 4, top: 0, fontSize: 8, color: 'var(--dim)', pointerEvents: 'none' }}>♪ scores</span>
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
              // double-click = the tall volume view for THIS S track only. The Score card
              // lives on click-sync, right-click, and the Bin.
              e.stopPropagation()
              useStore.getState().toggleScoreLane(it.lane ?? 0)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, id: raw.id, at: atX(e.clientX) })
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
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--score) 40%, transparent), color-mix(in srgb, var(--score) 22%, transparent))',
              border: `1px ${hasTake ? 'solid' : 'dashed'} color-mix(in srgb, var(--score) 65%, transparent)`,
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
            {/* audio transitions on the edges (Premiere): drag the inner edge · double-click = length · right-click = shape */}
            <FadeHandles
              lenSec={Math.max(0.25, it.spanSec)}
              fadeIn={it.fadeInSec}
              fadeOut={it.fadeOutSec}
              inShape={it.fadeInShape}
              outShape={it.fadeOutShape}
              editable
              onChange={(p) => commit(items.map((x) => (x.id === raw.id ? { ...x, ...p } : x)))}
            />
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
                  style={{ position: 'absolute', left: `${(avail / it.spanSec) * 100}%`, right: 0, top: 0, bottom: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,.45) 4px 8px)', borderLeft: '1px dashed var(--score-txt)' }}
                />
              )
            })()}
            <span style={{ fontSize: 9.5, color: 'var(--score-txt)', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', textShadow: '0 1px 2px #000', position: 'relative' }}>
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
              onChange={(r) => commit(items.map((x) => (x.id === raw.id ? { ...x, gain: r.gain === 1 ? undefined : r.gain, volume: r.points.length ? r.points : undefined } : x)))}
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
            ...scoreBeatEntries(tl, menu.at, menuItem.id),
            {
              label: menuItem.muted ? 'unmute' : 'mute',
              onClick: () => commit(items.map((x) => (x.id === menuItem.id ? { ...x, muted: !x.muted || undefined } : x)))
            },
            {
              // Premiere's default audio transition on both free edges (Ctrl+Shift+D); shape + length live on the wedge
              label: <>audio transition · {DEFAULT_FADE_SEC}s constant power both ends</>,
              onClick: () => commit(items.map((x) => (x.id === menuItem.id ? { ...x, ...(x.fadeInSec ? {} : { fadeInSec: DEFAULT_FADE_SEC, fadeInShape: 'power' as FadeShape }), ...(x.fadeOutSec ? {} : { fadeOutSec: DEFAULT_FADE_SEC, fadeOutShape: 'power' as FadeShape }) } : x)))
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
      {bgMenu && (
        <ContextMenu
          x={bgMenu.x}
          y={bgMenu.y}
          entries={[{ label: <>＋ add score track</>, onClick: () => void (laneCount < 8 && useStore.getState().setTimelineMeta({ scoreTracks: laneCount + 1 }, tl.id)) }, ...scoreBeatEntries(tl, bgMenu.at)]}
          onClose={() => setBgMenu(null)}
        />
      )}
    </div>
  )
}

// v20 LAW: sound is VISIBLE — one waveform painter for every lane block that lacked one
// (blue companions, ♪ score blocks; green/teal draw their own). Window = [inSec, inSec+lenSec]
// in SOURCE seconds; the canvas repaints on size/window changes.
// NEST (list 3, part 2): a nest block's face — what shows inside it, each clip's own frames over
// its stretch of the block (the topmost piece wins, like playback)
function NestFace({ it, w, h }: { it: TimelineItem; w: number; h: number }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const parts = useMemo(() => {
    if (!project) return []
    const clips = project.clips
    const n: TimelineItem = { ...it, startSec: 0, track: 0, fx: undefined, transitionOutSec: undefined, disabled: undefined }
    const f = flattenNests({ id: '~face', name: '', aspectRatio: '16:9', items: [n] }, project)
    const len = effDur(n, clips)
    const cuts = [...new Set([0, len, ...f.items.flatMap((x) => [startOf(x), startOf(x) + effDur(x, clips)])])].filter((t) => t >= 0 && t <= len).sort((a, b) => a - b)
    const out: { id: string; file: string; inSec: number; outSec: number; t0: number; t1: number }[] = []
    for (let i = 0; i < cuts.length - 1; i++) {
      const [t0, t1] = [cuts[i], cuts[i + 1]]
      if (t1 - t0 < 1e-3) continue
      const top = itemAt(f.items, clips, (t0 + t1) / 2)
      const c = top ? clips.find((x) => x.id === top.clipId) : undefined
      const f0 = top && c ? resolveView(c, top).take?.file : undefined
      const file = f0 && top ? playFileOf(f0, top) : undefined
      if (!top || !file) continue
      const prev = out[out.length - 1]
      if (prev && prev.id === top.id && Math.abs(prev.t1 - t0) < 1e-3) {
        prev.t1 = t1
        prev.outSec = sourceTimeAt(top, clips, t1)
      } else out.push({ id: top.id, file, inSec: sourceTimeAt(top, clips, t0), outSec: sourceTimeAt(top, clips, t1), t0, t1 })
    }
    return out.map((x) => ({ ...x, left: (x.t0 / len) * 100, width: ((x.t1 - x.t0) / len) * 100 }))
  }, [project, it])
  return (
    <>
      {parts.map((x) => (
        <StripPart key={`${x.id}@${x.t0}`} file={x.file} inSec={x.inSec} outSec={x.outSec} left={x.left} width={x.width} w={w} h={h} />
      ))}
    </>
  )
}
function StripPart(p: { file: string; inSec: number; outSec: number; left: number; width: number; w: number; h: number }): React.JSX.Element {
  const showFilmstrip = useStore((s) => s.showFilmstrips)
  const strip = useStrip(p.file, showFilmstrip)
  const pw = (p.w * p.width) / 100
  const frameW = p.h * (strip?.aspect ?? 16 / 9)
  const count = pw > 0 && frameW > 0 ? Math.max(1, Math.min(20, Math.ceil(pw / frameW))) : 0
  const frames = useMemo(() => sampleStrip(strip, count, p.inSec, p.outSec), [strip, count, p.inSec, p.outSec])
  return (
    <div data-nest-part style={{ position: 'absolute', top: 0, bottom: 0, left: `${p.left}%`, width: `${p.width}%`, display: 'flex', overflow: 'hidden', borderLeft: p.left > 0 ? '1px solid rgba(0,0,0,.5)' : undefined }}>
      {frames.map((f, i) => (
        <img key={i} src={f} alt="" decoding="async" style={{ height: '100%', width: 'auto', flex: '0 0 auto', objectFit: 'cover', opacity: 0.95 }} />
      ))}
    </div>
  )
}
// NEST (list 3, part 2): the waveform of a nest's sound — every sound inside its window, each
// drawn over its own stretch of the block
function NestWave({ nestId, inSec, outSec, speed, h, muted }: { nestId: string; inSec: number; outSec: number; speed?: number; h: number; muted?: boolean }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const parts = useMemo(() => {
    if (!project) return []
    const host: TimelineAudioItem = { id: 'w', lane: 0, source: { nestId }, startSec: 0, inSec, outSec, ...(speed && speed !== 1 ? { speed } : {}) }
    const f = flattenNests({ id: '~wave', name: '', aspectRatio: '16:9', items: [], audioItems: [host] }, project)
    const len = audioLenOf(host)
    const lanes = (f.audioItems ?? []).map((a) => ({ id: a.id, file: resolveAudioSource(a, project.clips, project.audio ?? []).file, inSec: a.inSec, srcLen: a.outSec - a.inSec, t0: a.startSec, dur: audioLenOf(a) }))
    const scores = (f.scoreItems ?? []).map((x) => {
      const sc = project.scoreClips.find((c) => c.id === x.scoreClipId)
      const take = sc?.takes.find((t) => t.id === (x.takeId ?? sc?.keeperTakeId)) ?? sc?.takes[sc.takes.length - 1]
      return { id: x.id, file: take?.file, inSec: x.inSec ?? 0, srcLen: x.spanSec * (x.speed ?? 1), t0: x.startSec, dur: x.spanSec }
    })
    return [...lanes, ...scores].filter((x) => x.file).map((x) => ({ ...x, left: (x.t0 / len) * 100, width: (x.dur / len) * 100 }))
  }, [project, nestId, inSec, outSec, speed])
  return (
    <>
      {parts.map((x) => (
        <div key={x.id} data-nest-wave style={{ position: 'absolute', top: 0, bottom: 0, left: `${x.left}%`, width: `${x.width}%`, pointerEvents: 'none' }}>
          <LaneWave file={x.file} inSec={x.inSec} lenSec={x.srcLen} h={h} muted={muted} />
        </div>
      ))}
    </>
  )
}

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
  // NEST (list 3, part 2): a nest's unlinked sound — named for its timeline, the nest tint, the
  // waveform of everything that sounds inside its window
  const nestId = nestOfAudio(a)
  const nestName = useStore((s) => (nestId ? `⧉ ${s.project?.timelines.find((t) => t.id === nestId)?.name ?? 'missing timeline'}` : ''))
  const isSel = useStore((s) => s.selectedAudioItemId) === a.id
  const wave = useWave(file, true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const start = audioStartOf(a, segs, tl.items)
  const len = Math.max(0.25, a.outSec - a.inSec)
  const tint = isFile ? '--music' : nestId ? '--alink' : '--ok'
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
      title={`${nestId ? `${nestName} · the nest's sound` : res.name}${isFile ? ' · ♫ Library track' : nestId ? '' : ' audio'}${a.link ? ' · 🔗 linked — rides its video block' : ' · free (absolute time)'}${a.beatGrid ? ' · ♫ beat grid source' : ''}${a.muted ? ' · MUTED' : ''} · drag = move (up/down = lane) · edges = trim · double-click = volume view · right-click = actions`}
      style={{
        position: 'absolute',
        top: laneTop + 2,
        height: laneH - 4,
        left: `${(start / total) * 100}%`,
        width: `${(len / total) * 100}%`,
        minWidth: 16,
        // green = clip-take audio · teal (--music) = Library file, the merged music lane · a nest's
        // sound wears the nest tint (list 3)
        background: a.muted
          ? `color-mix(in srgb, var(${tint}) 14%, transparent)`
          : `linear-gradient(180deg, color-mix(in srgb, var(${tint}) 45%, transparent), color-mix(in srgb, var(${tint}) 26%, transparent))`,
        border: `1px solid color-mix(in srgb, var(${tint}) ${a.muted ? 35 : 65}%, transparent)`,
        borderRadius: 3,
        cursor: 'grab',
        overflow: 'hidden',
        outline: isSel ? '2px solid var(--amber)' : 'none',
        outlineOffset: 1
      }}
    >
      {/* explicit CSS size — a positioned canvas ignores inset stretching (intrinsic 300×150) */}
      <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 2, width: '100%', height: 'calc(100% - 4px)', pointerEvents: 'none', opacity: a.muted ? 0.35 : 1 }} />
      {nestId && <NestWave nestId={nestId} inSec={a.inSec} outSec={a.outSec} speed={a.speed} h={laneH} muted={a.muted} />}
      <span style={{ position: 'relative', fontSize: 8.5, color: isFile ? 'var(--music-txt)' : '#fff', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', textShadow: '0 1px 2px #000', lineHeight: `${laneH - 4}px` }}>
        {a.link ? '🔗 ' : ''}
        {isFile ? '♫ ' : ''}
        {a.beatGrid ? '⋮⋮ ' : ''}
        {nestId ? nestName : res.name}
      </span>
      {/* v19 rubber band — editable in the tall (expanded) lane view */}
      <VolumeBand
        lenSec={len}
        gain={a.gain ?? 1}
        points={a.volume}
        editable={laneH >= 48}
        onChange={(r) => onPatch(a.id, { gain: r.gain === 1 ? undefined : r.gain, volume: r.points.length ? r.points : undefined })}
      />
      <FadeHandles lenSec={len} fadeIn={a.fadeInSec} fadeOut={a.fadeOutSec} inShape={a.fadeInShape} outShape={a.fadeOutShape} editable onChange={(p) => onPatch(a.id, p)} />
      <div onMouseDown={(e) => onGesture('in', a, e)} title="trim start" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
      <div onMouseDown={(e) => onGesture('out', a, e)} title="trim end" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 4, background: 'linear-gradient(270deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent)' }} />
    </div>
  )
}

function AudioItemLanes({ tl, total, segs, clips, items: videoItems, laneCount, laneH, onUnlink, snap, sliceMode, onSliceAudio, onSliceVideo, onMovePair, onPairPreview }: {
  tl: Timeline
  total: number
  segs: { start: number; dur: number }[]
  clips: Clip[]
  items: TimelineItem[]
  laneCount: number
  laneH: number
  onUnlink: (itemId: string) => void
  snap: SnapKit // ONE MAGNET — the timeline's shared snap machinery
  // 41 (AUDIO-LINK-CUT-PASTE-SPEC): the razor reaches the lanes; a linked drag moves the clip
  sliceMode: boolean
  onSliceAudio: (id: string, T: number) => void
  onSliceVideo: (itemId: string, T: number) => void
  onMovePair: (videoId: string, dT: number, dTrack: number) => void
  onPairPreview: (m: Map<string, { startSec: number; track: number }> | null) => void
}): React.JSX.Element | null {
  const setTimelineAudioItems = useStore((s) => s.setTimelineAudioItems)
  const laneRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<TimelineAudioItem | null>(null) // local gesture preview — commit once on release
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number; at: number } | null>(null) // right-click on empty lane ground
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
  // below the last lane = laneCount when allowNew (until the 8-lane cap): releasing there
  // creates the lane (Premiere: dropping under the bottom audio track makes a new one)
  const laneAtY = (clientY: number, allowNew = false): number => {
    let y = clientY - (laneRef.current?.getBoundingClientRect().top ?? 0)
    for (let l = 0; l < laneCount; l++) {
      y -= hOf(l)
      if (y < 0) return l
    }
    return allowNew && laneCount < 8 ? laneCount : laneCount - 1
  }
  const items = tl.audioItems ?? []
  // COMPANIONS: every video block with a take whose audio is still embedded shows a LINKED audio
  // block (always visible, distinct tint) mirroring it exactly — right-click to unlink
  const projTimelines = useStore((s) => s.project?.timelines)
  const companions = videoItems
    .map((it, i) => {
      // NEST (list 3): the nest's sound — one linked half on its paired lane, with its own level,
      // fades, keyframes and unlink like a clip's (part 2)
      if (it.nestId) {
        if (it.audioDetachedId || it.disabled || it.muted) return null
        const nt = projTimelines?.find((t) => t.id === it.nestId)
        return { it, seg: segs[i] ?? { start: 0, dur: 1 }, name: `⧉ ${nt?.name ?? 'nest'}`, file: undefined as string | undefined, lane: it.track ?? 0, nest: true }
      }
      // muted blocks hide their companion too — silent audio holds no lane ground (the insert-
      // audio verb mutes the block, and its lane copy takes the spot without stacking)
      if (it.audioDetachedId || it.useRecipe || it.disabled || it.muted) return null
      const c = clips.find((x) => x.id === it.clipId)
      const take = c ? resolveTake(c, it) : undefined // same pick as the video block (skips disabled duds)
      if (!take) return null
      return { it, seg: segs[i] ?? { start: 0, dur: 1 }, name: c?.name ?? '?', file: take.file as string | undefined, lane: it.track ?? 0, nest: false } // 41: A-n = V-n
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
    })
  ] // ♪ scores live on their own S tracks (list 2) — never an A-lane neighbor
  const growTo = (lane: number): void => {
    if (lane >= laneCount) void useStore.getState().setTimelineMeta({ audioTracks: lane + 1 }, tl.id)
  }
  const srcDurOf = (a: TimelineAudioItem): number => {
    const p = useStore.getState().project
    const nid = nestOfAudio(a)
    if (nid && p) return Math.max(nestLenOf(p, nid), a.outSec) // a nest's sound reaches as far as its timeline runs (list 3)
    // unknown metadata yet → don't allow extending past what we know
    return resolveAudioSource(a, clips, p?.audio ?? []).durationSec ?? a.outSec
  }
  const onGesture = (kind: 'move' | 'in' | 'out', a0: TimelineAudioItem, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if ((tl.lockedTracks ?? []).includes(`a${a0.lane}`)) return // locked lane rejects edits — the chip means it
    if (sliceMode) {
      // 41: the razor on a lane block — cut at the click, snapped like the video razor
      const r = laneRef.current?.getBoundingClientRect()
      if (!r || kind !== 'move') return
      const raw = Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total))
      const res = snap.apply(raw, snap.targets(new Set([a0.id])))
      onSliceAudio(a0.id, res.hit != null ? res.t : raw)
      return
    }
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
    const pen = useStore.getState().tlTool === 'pen' // list 4: the Pen never moves or trims a clip
    const move = (ev: MouseEvent): void => {
      if (pen) return
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
        const nLane = Math.max(0, laneAtY(ev.clientY, true)) // below the last lane = new-lane intent
        const host = base.link ? tl.items.find((it) => it.id === base.link!.itemId) : undefined
        if (base.link && host) {
          // 41: a LINKED item drags its whole clip (Premiere): the offset stays, the video block
          // previews the same time and the same track step
          final = { ...base, lane: nLane, startSec: nStart }
          onPairPreview(new Map([[host.id, { startSec: Math.max(0, startOf(host) + (nStart - baseStart)), track: Math.max(0, Math.min(7, trackOf(host) + (nLane - base.lane))) }]]))
        } else {
          final = { ...base, lane: nLane, startSec: nStart, link: undefined } // a dangling link moves free
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
      setDrag(final.link ? { ...final, link: undefined } : final) // the preview draws at the dragged spot
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
      // PLACEMENT (user call 2026-08-20 — the Premiere way): landing on other audio ITEMS
      // OVERWRITES them (carve: trim / split / vanish). Companions (the video block's own
      // audio) and ♪ score spans keep their ground — the drop hops off them, as before.
      const next = fresh().map((x) => (x.id === final.id ? final : x))
      if (kind === 'move') {
        growTo(final.lane) // a release below the last lane creates it
        if (final.link && tl.items.some((it) => it.id === final.link!.itemId)) {
          // 41: the whole clip moves — the parent lands video + lanes in one write
          onPairPreview(null)
          onMovePair(final.link.itemId, final.startSec - baseStart, final.lane - base.lane)
          setDrag(null)
          return
        }
        // 41 OVERWRITE: the landing carves whatever sits under it on the lane (items and
        // companions; scores live on the S tracks), never hops — the Premiere way
        const fs = audioStartOf(final, segs, tl.items)
        const st = overwriteLanes({ items: tl.items, audioItems: next, scoreItems: tl.scoreItems ?? [] }, clips, [{ lane: final.lane, start: fs, end: fs + audioLenOf(final) }], new Set([final.id]), new Set(tl.lockedTracks ?? []))
        void useStore.getState().setTimelineAll(st.items, st.audioItems, st.scoreItems, tl.id).then(() => setDrag(null))
        return
      }
      void setTimelineAudioItems(next, tl.id).then(() => setDrag(null))
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
        if (types.includes(MIME_AUDIO)) e.preventDefault() // list 2: a ♪ score only lands on an S track
      }}
      onDrop={(e) => {
        const r = laneRef.current?.getBoundingClientRect()
        const frac = r ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0
        const start = Math.max(0, frac * total)
        const nid = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
        // ♫ Library track drop (v20 — the merged music lane): a teal file block on any lane
        const audioId = e.dataTransfer.getData(MIME_AUDIO)
        if (audioId) {
          e.preventDefault()
          const track = useStore.getState().project?.audio.find((x) => x.id === audioId)
          if (!track) return
          const len = Math.max(1, track.durationSec ?? 60)
          // 41 OVERWRITE: lands under the cursor (below the last lane = a new lane) and carves
          // whatever sits there, the Premiere way
          const lane = Math.max(0, laneAtY(e.clientY, true))
          growTo(lane)
          // the first file item on the timeline drives the beat grid by default
          const hasGrid = (tl.audioItems ?? []).some((x) => x.beatGrid)
          const it: TimelineAudioItem = { id: nid(), lane, source: { audioId }, startSec: start, inSec: 0, outSec: len, ...(hasGrid ? {} : { beatGrid: true }) }
          const st = overwriteLanes({ items: tl.items, audioItems: [...fresh(), it], scoreItems: tl.scoreItems ?? [] }, clips, [{ lane, start, end: start + len }], new Set([it.id]), new Set(tl.lockedTracks ?? []))
          void useStore.getState().setTimelineAll(st.items, st.audioItems, st.scoreItems, tl.id)
        }
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return // blocks own their menus
        e.preventDefault()
        const r = laneRef.current?.getBoundingClientRect()
        setBgMenu({ x: e.clientX, y: e.clientY, at: r ? Math.max(0, Math.min(total, ((e.clientX - r.left) / Math.max(1, r.width)) * total)) : 0 })
      }}
      style={{ position: 'relative', height: topOf(laneCount), background: 'var(--bg0)' }}
    >
      {Array.from({ length: Math.max(0, laneCount - 1) }, (_, i) => i + 1).map((l) => (
        <div key={l} style={{ position: 'absolute', left: 0, right: 0, top: topOf(l), borderTop: '1px dashed var(--line)', opacity: 0.5, pointerEvents: 'none' }} />
      ))}
      <span style={{ position: 'absolute', left: 4, top: 0, fontSize: 8, color: 'var(--dim)', pointerEvents: 'none' }}>audio — clips</span>
      {/* LINKED companions (always visible; blue tint; mirror their video block exactly) */}
      {companions.map((c) => (
        <div
          key={'comp:' + c.it.id}
          onMouseDown={(e) => {
            if (sliceMode) {
              // 41: the razor on the blue half cuts the clip, both halves (Premiere)
              const r = laneRef.current?.getBoundingClientRect()
              if (!r) return
              e.stopPropagation()
              const raw = Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total))
              const res = snap.apply(raw, snap.targets(new Set([c.it.id])))
              onSliceVideo(c.it.id, res.hit != null ? res.t : raw)
              return
            }
            useStore.getState().selectTlItem(c.it.id) // linked selection: the blue half selects the whole clip (Premiere)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            useStore.getState().toggleAudioLane(c.lane) // THIS lane only (per-lane view)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, id: 'comp:' + c.it.id })
          }}
          title={c.nest ? `${c.name} — the nest's sound · 🔗 moves / trims / cuts with its block · double-click = volume view · right-click to unlink` : `${c.name} audio · 🔗 LINKED — moves/trims/cuts with its video block · double-click = volume view · right-click to unlink${c.it.muted ? ' · MUTED' : ''}`}
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
          <LaneWave file={c.file} inSec={c.it.useRecipe ? 0 : (c.it.inSec ?? 0)} lenSec={remapped(c.it) ? Math.max(0.25, remapAudioOut(c.it, clips) - (c.it.inSec ?? 0)) : c.seg.dur * (c.it.speed && c.it.speed > 0 ? c.it.speed : 1)} h={hOf(c.lane)} muted={c.it.muted} />
          {c.nest && c.it.nestId && <NestWave nestId={c.it.nestId} inSec={c.it.inSec ?? 0} outSec={c.it.outSec ?? 0} speed={c.it.speed} h={hOf(c.lane)} muted={c.it.muted} />}
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
            onChange={(r) => {
              const cur = activeTimeline(useStore.getState().project)?.items ?? []
              void useStore.getState().setTimelineItems(cur.map((x) => (x.id === c.it.id ? { ...x, gain: r.gain === 1 ? undefined : r.gain, volume: r.points.length ? r.points : undefined } : x)), tl.id)
            }}
          />
          <FadeHandles
            lenSec={Math.max(0.25, c.seg.dur)}
            fadeIn={c.it.fadeInSec}
            fadeOut={c.it.fadeOutSec}
            inShape={c.it.fadeInShape}
            outShape={c.it.fadeOutShape}
            editable={hOf(c.lane) >= 48}
            onChange={(p) => {
              const cur = activeTimeline(useStore.getState().project)?.items ?? []
              void useStore.getState().setTimelineItems(cur.map((x) => (x.id === c.it.id ? { ...x, ...p } : x)), tl.id)
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
      {bgMenu && (
        <ContextMenu
          x={bgMenu.x}
          y={bgMenu.y}
          entries={[
            // track building lives everywhere the timeline is (user call 2026-08-20)
            {
              label: <>＋ add audio lane</>,
              onClick: () => {
                if (laneCount < 8) void useStore.getState().setTimelineMeta({ audioTracks: laneCount + 1 }, tl.id)
              }
            },
            {
              label: <>＋ add video track</>,
              onClick: () => {
                const n = Math.max(1, tl.videoTracks ?? 1)
                if (n < 8) void useStore.getState().setTimelineMeta({ videoTracks: n + 1 }, tl.id)
              }
            },
            ...scoreBeatEntries(tl, bgMenu.at)
          ]}
          onClose={() => setBgMenu(null)}
        />
      )}
      {menu && menu.id.startsWith('comp:') && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            {
              label: <>♪ unlink audio</>,
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
              label: <>audio transition · {DEFAULT_FADE_SEC}s constant power both ends</>,
              onClick: () =>
                void setTimelineAudioItems(
                  fresh().map((x) => (x.id === menuItem.id ? { ...x, ...(x.fadeInSec ? {} : { fadeInSec: DEFAULT_FADE_SEC, fadeInShape: 'power' as FadeShape }), ...(x.fadeOutSec ? {} : { fadeOutSec: DEFAULT_FADE_SEC, fadeOutShape: 'power' as FadeShape }) } : x)),
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
const S_BAR_H = 3 // list 2: the bar between the A lanes and the S (score) tracks — the rail and the time surface draw the same one
const FPS_NUDGE = 1 / 24
// marker palette — the Premiere eight + the theme default (undefined = --amber). Data colors,
// like BEAT_COLORS: a picked color must survive theme switches, so they stay literal.
const MARKER_COLORS: (string | undefined)[] = [undefined, '#4caf50', '#e53935', '#ab47bc', '#fb8c00', '#fdd835', '#ffffff', '#42a5f5', '#26c6da']

const NO_ITEMS: TimelineItem[] = []

// list 49 — Premiere's sequence tabs: the main Timeline panel holds the open timelines as tabs; a tab
// dragged out opens that timeline in its own panel (timelineId). A press in any timeline panel makes its
// timeline the active one (the Monitor follows, Premiere's Program Monitor) and gives it the keys.
export function TimelinePanel({ timelineId }: { timelineId?: string } = {}): React.JSX.Element {
  const panelKey = timelineId ?? 'main'
  const [watchOpen, setWatchOpen] = useState(false)
  const [dissolveIds, setDissolveIds] = useState<string[] | null>(null)
  const [speedIds, setSpeedIds] = useState<string[] | null>(null) // list 51: the Clip Speed / Duration dialog's blocks
  // list 56: time remapping — a gesture's live line (the block resizes as it drags), the selected
  // keyframe, a keyframe's right-click
  const [remapLive, setRemapLive] = useState<{ id: string; remap: SpeedRemap } | null>(null)
  const [remapKey, setRemapKey] = useState<{ id: string; i: number } | null>(null)
  const [remapKeyMenu, setRemapKeyMenu] = useState<{ x: number; y: number; id: string; i: number } | null>(null)
  // another block (or none) selected = the speed keyframe lets go, so Delete is the selection's again
  const selNow = useStore((s) => s.selectedTlItemId)
  useEffect(() => {
    if (remapKey && remapKey.id !== selNow) setRemapKey(null)
  }, [selNow, remapKey])
  const project = useStore((s) => s.project)
  const clips = project?.clips ?? []
  const tabCurrent = useStore((s) => s.tlTabCurrent)
  const viewId = timelineId ?? tabCurrent
  const tlObj = (viewId ? project?.timelines.find((t) => t.id === viewId) : undefined) ?? activeTimeline(project)
  const timeline = tlObj?.items ?? NO_ITEMS
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
  const sliceAudioItem = useStore((s) => s.sliceAudioItem) // 41: the razor on the lanes
  const sliceScoreItem = useStore((s) => s.sliceScoreItem)
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
  const tlTool = useStore((s) => s.tlTool) // list 4: V Selection · P Pen
  const [railMenu, setRailMenu] = useState<{ x: number; y: number; track: number | null } | null>(null) // right-click on the track rail (null track = rail background)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const trimming = useRef(false)
  const justDragged = useRef(false)

  const vTracks = Math.max(1, tlObj?.videoTracks ?? 1)
  const laneCount = Math.max(1, tlObj?.audioTracks ?? 3, vTracks) // 41: A-n pairs with V-n — never fewer lanes than video tracks
  const sCount = scoreTrackCount(tlObj) // list 2: the S (score) tracks, below the A lanes
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
  const expandedScoreLanes = useStore((s) => s.expandedScoreLanes)
  const sLaneHOf = (l: number): number => (expandedScoreLanes.includes(l) ? 64 : LANE_HV)
  // keyframe navigator (AUDIO-KEYFRAMES-PREMIERE-SPEC §2.2): the blocks on A lane l = free/linked audio items
  // and the linked companions of the video blocks on track l; on S track l = its ♪ scores (list 2);
  // ◇ toggles a keyframe at the playhead, ◁ ▷ walk every keyframe on the track
  type LaneBlock = { start: number; len: number; gain: number; points?: VolumePoint[]; write: (r: { points: VolumePoint[]; gain: number }) => void }
  const laneBlocks = (l: number, kind: 'a' | 's' = 'a'): LaneBlock[] => {
    const st = useStore.getState()
    const tlNow = activeTimeline(st.project)
    if (!tlNow) return []
    const clipsNow = st.project?.clips ?? []
    const segsNow = tlNow.items.map((it) => ({ start: startOf(it), dur: effDur(it, clipsNow) }))
    const vol = (r: { points: VolumePoint[]; gain: number }): { volume?: VolumePoint[]; gain?: number } => ({ volume: r.points.length ? r.points : undefined, gain: r.gain === 1 ? undefined : r.gain })
    const out: LaneBlock[] = []
    if (kind === 's') {
      for (const sc of tlNow.scoreItems ?? [])
        if ((sc.lane ?? 0) === l)
          out.push({
            start: sc.startSec,
            len: Math.max(0.25, sc.spanSec),
            gain: sc.gain ?? 1,
            points: sc.volume,
            write: (r) => void st.setTimelineScoreItems(tlNow.id, (activeTimeline(useStore.getState().project)?.scoreItems ?? []).map((x) => (x.id === sc.id ? { ...x, ...vol(r) } : x)))
          })
      return out
    }
    for (const a of tlNow.audioItems ?? [])
      if (a.lane === l)
        out.push({
          start: audioStartOf(a, segsNow, tlNow.items),
          len: Math.max(0.25, a.outSec - a.inSec),
          gain: a.gain ?? 1,
          points: a.volume,
          write: (r) => void st.setTimelineAudioItems((activeTimeline(useStore.getState().project)?.audioItems ?? []).map((x) => (x.id === a.id ? { ...x, ...vol(r) } : x)), tlNow.id)
        })
    tlNow.items.forEach((it, i) => {
      if ((it.track ?? 0) !== l || it.audioDetachedId || it.useRecipe || it.disabled || it.muted) return
      out.push({
        start: segsNow[i].start,
        len: Math.max(0.25, segsNow[i].dur),
        gain: it.gain ?? 1,
        points: it.volume,
        write: (r) => void st.setTimelineItems((activeTimeline(useStore.getState().project)?.items ?? []).map((x) => (x.id === it.id ? { ...x, ...vol(r) } : x)), tlNow.id)
      })
    })
    return out
  }
  const kfToggle = (l: number, kind: 'a' | 's' = 'a'): void => {
    const T = useStore.getState().tlTime
    const b = laneBlocks(l, kind).find((x) => T >= x.start && T <= x.start + x.len)
    if (!b) return
    b.write(toggleKeyframeAt(b.points, b.gain, T - b.start, b.len))
  }
  const kfJump = (l: number, dir: -1 | 1, kind: 'a' | 's' = 'a'): void => {
    const st = useStore.getState()
    const T = st.tlTime
    const times = laneBlocks(l, kind)
      .flatMap((b) => (b.points ?? []).map((p) => b.start + p.at))
      .sort((a, b) => a - b)
    const next = dir > 0 ? times.find((t) => t > T + 0.001) : [...times].reverse().find((t) => t < T - 0.001)
    if (next != null) st.tlSeek(next)
  }
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
  // block title: pinned blocks carry their take ("KATA - take 3"); dynamic/S-B blocks just the clip name
  const blockNameOf = (it: TimelineItem): string => {
    if (it.nestId) return `⧉ ${project?.timelines.find((t) => t.id === it.nestId)?.name ?? 'missing timeline'}`
    const c = clipOf(it.clipId)
    if (!c) return '?'
    const i = it.takeId && !it.useRecipe ? c.takes.findIndex((t) => t.id === it.takeId) : -1
    return i >= 0 ? `${c.name} - take ${i + 1}` : c.name
  }
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
  const takeFileOf = (it: TimelineItem): string | undefined => {
    const f = viewOf(it)?.take?.file
    return f ? playFileOf(f, it) : undefined // list 51: a reversed block shows its reversed copy
  }
  // a block's source length for trims + slips: a NEST reaches as far as its timeline runs (list 3)
  const srcLenOf = (x: TimelineItem): number => (x.nestId && project ? Math.max(nestLenOf(project, x.nestId), x.outSec ?? 0) : sourceDurOf(x, clips))
  const takeLabel = (it: TimelineItem): string => {
    const c = clipOf(it.clipId)
    if (!c) return '?'
    if (it.useRecipe) return 'S-B · storyboard'
    const take = viewOf(it)?.take
    if (!take) return c.takes.length ? 'S-B · storyboard' : 'no take'
    const idx = Math.max(0, c.takes.findIndex((t) => t.id === take.id))
    const rm = remapped(it) ? remapRange(it.remap!, it.inSec ?? 0, Math.min(it.outSec ?? sourceDurOf(it, clips), sourceDurOf(it, clips))) : null
    return `take ${idx + 1}${c.takes.length > 1 ? '/' + c.takes.length : ''}${rm ? ` · remap ${Math.round(rm[0] * 100)}–${Math.round(rm[1] * 100)}%` : it.speed && it.speed !== 1 ? ` · ${it.speed}×` : ''}`
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
  const musicEnd = audioEndOf(tlObj, project?.audio ?? []) // ⟲ tails + ruler reach the FULL audio end (music, detached audio, ♪ scores)
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
    if (dragTrim && dragTrim.id === it.id) return lenOfWindow(it, dragTrim.inSec, dragTrim.outSec) // list 56: a remapped block's own line
    if (remapLive && remapLive.id === it.id) return effDur({ ...it, remap: remapLive.remap }, clips) // list 56: the line being dragged
    return eff(it)
  }
  // list 56 (SPEED-RAMPS-SPEC-2026-10-01): one remap write. Premiere's rule: the block grows only into
  // free room on its track — at the next block its end is trimmed there; nothing after it moves.
  // `undefined` removes time remapping (the block plays at 100 % again).
  const commitRemap = (id: string, next: SpeedRemap | undefined): void => {
    const items = freshItems()
    const cur = items.find((x) => x.id === id)
    if (!cur || locked.has(`v${trackOf(cur)}`)) return void setRemapLive(null)
    let patched: TimelineItem = { ...cur, remap: next, speed: undefined }
    if (next) {
      const wall = nextOnTrackStart(cur, items)
      if (wall != null && startOf(cur) + effDur(patched, clips) > wall + 1e-6) patched = { ...patched, outSec: srcAtRel(patched, wall - startOf(cur)) }
    }
    void setTimelineItems(items.map((x) => (x.id === id ? patched : x))).then(() => setRemapLive(null))
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
  // 41 (AUDIO-LINK-CUT-PASTE-SPEC): ONE landing for every video move, drop, dup, nudge — the
  // Premiere overwrite on the track (carveVideo), the linked lane audio's track step (A-n
  // follows V-n), the lane overwrite under the block's companion and its riders, the track
  // growth, ONE write = one Ctrl+Z.
  const landVideo = async (before: TimelineItem[], positioned: TimelineItem[], moved: Map<string, { startSec: number; track: number }>, extraAudio?: TimelineAudioItem[]): Promise<void> => {
    let tlNow = activeTimeline(useStore.getState().project)
    if (!tlNow || moved.size === 0) return
    const maxTrack = Math.max(...[...moved.values()].map((p) => p.track))
    if (maxTrack >= Math.max(vTracks, tlNow.videoTracks ?? 1)) {
      await setTimelineMeta({ videoTracks: Math.min(8, maxTrack + 1) }, tlNow.id)
      tlNow = activeTimeline(useStore.getState().project) ?? tlNow
    }
    const items = carveVideo(positioned, moved, clips, locked)
    let audio = [...(tlNow.audioItems ?? []), ...(extraAudio ?? [])]
    const keep = new Set<string>()
    const spans: LaneSpan[] = []
    for (const [id, pos] of moved) {
      keep.add(id)
      const was = before.find((x) => x.id === id)
      const dTrack = was ? pos.track - trackOf(was) : 0
      if (dTrack) audio = audio.map((a) => (a.link?.itemId === id ? { ...a, lane: Math.max(0, Math.min(7, a.lane + dTrack)) } : a))
      const it = items.find((x) => x.id === id)
      const cs = it ? companionSpan(it, clips) : null
      if (cs) spans.push(cs)
    }
    const segsNow = buildSegs(items, clips).segs
    for (const a of audio) {
      if (!a.link || !keep.has(a.link.itemId)) continue
      keep.add(a.id)
      const s0 = audioStartOf(a, segsNow, items)
      spans.push({ lane: a.lane, start: s0, end: s0 + audioLenOf(a) })
    }
    const st = overwriteLanes({ items, audioItems: audio, scoreItems: tlNow.scoreItems ?? [] }, clips, spans, keep, locked)
    await useStore.getState().setTimelineAll(st.items, st.audioItems, st.scoreItems, tlNow.id)
  }
  // 41: a LINKED lane audio dragged = the whole clip dragged (Premiere linked selection): the
  // video block moves by the same time and the same track step, then lands like any move
  const movePair = (videoId: string, dT: number, dTrack: number): void => {
    const cur = freshItems()
    const v = cur.find((x) => x.id === videoId)
    if (!v || locked.has(`v${trackOf(v)}`)) return
    const ns = Math.max(0, startOf(v) + dT)
    const nt = Math.max(0, Math.min(7, trackOf(v) + dTrack))
    void landVideo(cur, cur.map((x) => (x.id === v.id ? { ...x, startSec: ns, track: nt } : x)), new Map([[v.id, { startSec: ns, track: nt }]]))
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
    const pen = useStore.getState().tlTool === 'pen' // list 4: the Pen never moves or trims a clip
    const move = (ev: MouseEvent): void => {
      if (pen) return
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
      // rows render top-down from the HIGHEST track, so dragging UP (negative dY) must RAISE the
      // track. ONE PAST the top is legal (until the 8-track cap): releasing there creates the
      // track and the block lands on it — the Premiere gesture (track made on the drop).
      const capTrack = vTracks < 8 ? vTracks : vTracks - 1
      let aTrack = Math.max(0, Math.min(capTrack, b0.track - dTrack))
      if (aTrack < vTracks && locked.has(`v${aTrack}`)) aTrack = b0.track // a locked row takes no drops
      // wall clamp by the GROUP's minimum, not per member — per-member clamping collapsed
      // relative offsets at the left wall (members landed permanently overlapping on one track)
      let minRel = 0
      for (const [, b] of base) minRel = Math.min(minRel, b.startSec - b0.startSec)
      aStart = Math.max(-minRel, aStart)
      for (const [id, b] of base) {
        const rel = b.startSec - b0.startSec
        const tr = Math.max(0, Math.min(capTrack, b.track + (aTrack - b0.track)))
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
      // released past the top row → make the new track NOW and the block lands on it
      // (Premiere: dropping above the topmost video track creates the track on the drop)
      const maxTrack = Math.max(...[...finalView.values()].map((p) => p.track))
      if (tlObj && maxTrack >= vTracks) void setTimelineMeta({ videoTracks: Math.min(8, maxTrack + 1) }, tlObj.id)
      if (isDup) {
        const fresh: TimelineItem[] = []
        const extra: TimelineAudioItem[] = [] // 41: a linked clip duplicates as one — its riders come along
        const aud = activeTimeline(useStore.getState().project)?.audioItems ?? []
        for (const [id, pos] of finalView) {
          const src = cur.find((x) => x.id === id)
          if (!src) continue
          const nid = newId()
          let detached: string | undefined
          for (const a of aud) {
            if (a.link?.itemId !== id) continue
            const aid = newId()
            if (src.audioDetachedId === a.id) detached = aid
            extra.push({ ...a, id: aid, lane: Math.max(0, Math.min(7, a.lane + (pos.track - trackOf(src)))), link: { itemId: nid, offset: a.link.offset }, beatGrid: undefined })
          }
          fresh.push({ ...src, id: nid, startSec: pos.startSec, track: pos.track, audioDetachedId: detached })
        }
        const mv = new Map(fresh.map((f) => [f.id, { startSec: f.startSec ?? 0, track: f.track ?? 0 }]))
        void landVideo([...cur, ...fresh], [...cur, ...fresh], mv, extra)
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
        void landVideo(cur, positioned, finalView)
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
    if (it.useRecipe || remapped(it) || locked.has(`v${trackOf(it)}`)) return // list 56: a remapped block's speed lives on its source seconds
    const src = srcLenOf(it)
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
    const src = sourceDurOf(it, clips)
    const b = { inSec: it.inSec ?? 0, outSec: Math.min(it.outSec ?? src, src), startSec: startOf(it) }
    const oldEnd = b.startSec + eff(it)
    let patch: Partial<TimelineItem>
    let removed: number // timeline seconds removed
    let fromT: number // ripple start: everything at/after this pulls left
    // list 56: the playhead's source second walks a remapped block's line (srcAtRel / relAtSrc)
    if (side === 'in') {
      const nIn = Math.min(b.outSec - 0.25, srcAtRel(it, T - b.startSec))
      removed = relAtSrc(it, nIn)
      if (removed < 0.02) return
      patch = { inSec: nIn }
      fromT = T
    } else {
      const nOut = Math.max(b.inSec + 0.25, srcAtRel(it, T - b.startSec))
      removed = oldEnd - b.startSec - relAtSrc(it, nOut)
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
    if (locked.has(`v${trackOf(it)}`) || useStore.getState().tlTool === 'pen') return // list 4: the Pen never trims
    const spp = secPerPx()
    const x0 = e.clientX
    const src = srcLenOf(it)
    const b = { inSec: it.inSec ?? 0, outSec: Math.min(it.outSec ?? src, src), startSec: startOf(it) }
    const lenB = lenOfWindow(it, b.inSec, b.outSec) // list 56: a remapped block's length is its line's
    // rolling partner: the block flush against this edge on the same track (Ctrl held)
    const edgeT = side === 'in' ? b.startSec : b.startSec + lenB
    const partner = e.ctrlKey
      ? timeline.find((x) => x.id !== it.id && trackOf(x) === trackOf(it) && Math.abs(side === 'in' ? startOf(x) + eff(x) - edgeT : startOf(x) - edgeT) < 0.05)
      : undefined
    trimming.current = true
    let final = { ...b }
    let pFinal = partner ? { inSec: partner.inSec ?? 0, outSec: Math.min(partner.outSec ?? srcLenOf(partner), srcLenOf(partner)), startSec: startOf(partner) } : null
    // ONE MAGNET: trims snap too — the dragged EDGE (timeline time) pulls to the target set
    // (rebuilt per move so a running playhead stays a LIVE target), then the source-seconds
    // clamps apply. Flash only when the clamped edge actually LANDED on the target — flashing
    // a clamp-rejected snap asserted landings that never happened (review catches 2026-08-19).
    const trimExcl = new Set([it.id, ...(partner ? [partner.id] : [])])
    const edge0 = side === 'in' ? b.startSec : b.startSec + lenB
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
      // source seconds for THIS item: the edge walks its clock (a remapped block's line, list 56)
      if (side === 'in') {
        const nIn = Math.max(0, Math.min(b.outSec - 0.25, srcAtRel(it, dT)))
        final = { inSec: nIn, outSec: b.outSec, startSec: Math.max(0, b.startSec + relAtSrc(it, nIn)) }
      } else {
        const nOut = Math.max(b.inSec + 0.25, Math.min(src, srcAtRel(it, lenB + dT)))
        final = { inSec: b.inSec, outSec: nOut, startSec: b.startSec }
      }
      if (hit != null) {
        const landed = side === 'in' ? final.startSec : final.startSec + lenOfWindow(it, final.inSec, final.outSec)
        if (Math.abs(landed - hit) < 0.002) flashSnap(hit)
      }
      if (partner && pFinal) {
        const pSrc = srcLenOf(partner)
        const pb = { inSec: partner.inSec ?? 0, outSec: Math.min(partner.outSec ?? pSrc, pSrc), startSec: startOf(partner) }
        const pLen = lenOfWindow(partner, pb.inSec, pb.outSec)
        if (side === 'in') {
          // my left edge moved by (final.startSec - b.startSec) → partner's out follows
          const dEdge = final.startSec - b.startSec
          pFinal = { inSec: pb.inSec, outSec: Math.max(pb.inSec + 0.25, Math.min(pSrc, srcAtRel(partner, pLen + dEdge))), startSec: pb.startSec }
        } else {
          const dEdge = lenOfWindow(it, final.inSec, final.outSec) - lenB
          const nIn = Math.max(0, Math.min(pb.outSec - 0.25, srcAtRel(partner, dEdge)))
          pFinal = { inSec: nIn, outSec: pb.outSec, startSec: Math.max(0, pb.startSec + relAtSrc(partner, nIn)) }
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
      const oldEff = lenB
      const newEff = lenOfWindow(it, final.inSec, final.outSec)
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
    // 41: a SELECTED lane block with the playhead inside it cuts first (audio = video)
    const tlNow = activeTimeline(st.project)
    const selA = st.selectedAudioItemId ? (tlNow?.audioItems ?? []).find((a) => a.id === st.selectedAudioItemId) : undefined
    if (selA) {
      const s0 = audioStartOf(selA, buildSegs(items, clips).segs, items)
      if (s0 < T - 0.05 && T < s0 + audioLenOf(selA) - 0.05) {
        void sliceAudioItem(selA.id, T)
        return
      }
    }
    const selS = st.selectedScoreItemId ? (tlNow?.scoreItems ?? []).find((x) => x.id === st.selectedScoreItemId) : undefined
    if (selS && selS.startSec < T - 0.05 && T < selS.startSec + selS.spanSec - 0.05) {
      void sliceScoreItem(selS.id, T)
      return
    }
    // the SELECTED clip wins when the playhead is inside it (stand-in for track targeting)
    const sel = items.find((x) => x.id === st.selectedTlItemId)
    const selHit = sel && startOf(sel) < T - 0.05 && T < startOf(sel) + eff(sel) - 0.05 ? sel : undefined
    const it = selHit ?? itemAt(items, clips, T, hiddenVideoTracks())
    // ⟲ never cut inside a tail — there's no block there, only the projection
    if (it && (takeFileOf(it) || it.nestId) && T < startOf(it) + eff(it) - 0.05) sliceAtTime(it, T)
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
    // NEST (list 3): a Bin timeline tile lands as a nest block (Premiere: drag a sequence in)
    const nestDrop = e.dataTransfer.getData(MIME_TIMELINE)
    if (nestDrop) {
      void addNestAt(nestDrop, T, track)
      return
    }
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
          void vd().veditBakeClip(o.sessionId, o.nodeId, {}).then((r) => {
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
    const cur = activeItems(useStore.getState().project)
    await landVideo(cur, [...cur, { ...probe, startSec: s }], new Map([[id, { startSec: s, track }]]))
    return s + len
  }
  // NEST (list 3): the whole timeline as one block, overwriting what sits under it (the clip drop's
  // grammar); refused when it would put a timeline inside itself
  const addNestAt = async (nestId: string, T: number, track: number): Promise<void> => {
    const p = useStore.getState().project
    const cur = activeTimeline(p)
    if (!p || !cur) return
    if (nestReaches(p.timelines, nestId, cur.id)) {
      toast("a timeline can't go inside itself", { kind: 'error' })
      return
    }
    const len = nestLenOf(p, nestId)
    if (len < 0.05) {
      toast('that timeline is empty — nothing to nest', { kind: 'error' })
      return
    }
    const id = newId()
    const s = Math.max(0, T)
    await landVideo(cur.items, [...cur.items, { id, clipId: '', nestId, startSec: s, track, inSec: 0, outSec: len }], new Map([[id, { startSec: s, track }]]))
  }
  // NEST (list 3): Premiere's right-click → Nest… on the selection — the marquee group when this
  // block is in it, else this block alone
  const nestFrom = async (it: TimelineItem): Promise<void> => {
    const ids = marqueeSel.has(it.id) ? [...marqueeSel] : [it.id]
    const nums = (project?.timelines ?? []).map((t) => /^Nest (\d+)$/.exec(t.name)?.[1]).filter((x): x is string => !!x).map(Number)
    const name = await textPrompt('Name the nest', `Nest ${nums.length ? Math.max(...nums) + 1 : 1}`)
    if (!name || !name.trim()) return
    const r = await useStore.getState().nestSelection(ids, name.trim())
    if (r.error) toast(r.error, { kind: 'error' })
    else setMarqueeSel(new Set())
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
    void landVideo(cur, positioned, moved)
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
    void landVideo(cur, positioned, moved)
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
      if (hasOpenDialog()) return
      if (useStore.getState().tlFocus !== panelKey) return // list 49: one timeline panel has the keys
      if((e.target as HTMLElement|null)?.closest('[data-transition-row]'))return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const st = useStore.getState()
      const K = keyCtxRef.current
      if (!K) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        K.razorAtPlayhead()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'r') {
        // list 51: Premiere's Ctrl+R = Clip Speed / Duration on the selection
        e.preventDefault()
        const ids = marqueeSel.size ? [...marqueeSel] : st.selectedTlItemId ? [st.selectedTlItemId] : []
        if (ids.length) setSpeedIds(ids)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        // Premiere Ctrl+Shift+D: the default audio transition (1 s Constant Power) on the selected block's free edges
        e.preventDefault()
        const tlNow = activeTimeline(st.project)
        if (!tlNow) return
        const fill = <T extends { fadeInSec?: number; fadeOutSec?: number; fadeInShape?: FadeShape; fadeOutShape?: FadeShape }>(x: T): T => ({
          ...x,
          ...(x.fadeInSec ? {} : { fadeInSec: DEFAULT_FADE_SEC, fadeInShape: 'power' as FadeShape }),
          ...(x.fadeOutSec ? {} : { fadeOutSec: DEFAULT_FADE_SEC, fadeOutShape: 'power' as FadeShape })
        })
        if (st.selectedAudioItemId) void st.setTimelineAudioItems((tlNow.audioItems ?? []).map((x) => (x.id === st.selectedAudioItemId ? fill(x) : x)), tlNow.id)
        else if (st.selectedScoreItemId) void st.setTimelineScoreItems(tlNow.id, (tlNow.scoreItems ?? []).map((x) => (x.id === st.selectedScoreItemId ? fill(x) : x)))
        else if (st.selectedTlItemId) void st.setTimelineItems(tlNow.items.map((x) => (x.id === st.selectedTlItemId ? fill(x) : x)), tlNow.id)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const low = e.key.toLowerCase()
      if (low === 'c') {
        setSliceMode((v) => !v)
        st.setTlTool('select') // one tool at a time (Premiere)
      }
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
      } else if (low === 'a') {
        setSelFwd(true)
        st.setTlTool('select')
      } else if (low === 'v') {
        // list 4: Premiere's V = the Selection tool (leaves the Pen, select-forward and the razor)
        setSelFwd(false)
        setSliceMode(false)
        st.setTlTool('select')
      } else if (low === 'p') {
        // list 4: Premiere's P = the Pen tool
        setSelFwd(false)
        setSliceMode(false)
        st.setTlTool('pen')
      }
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
      } else if (e.key === 'l' || e.key === 'L') st.tlShuttle(1) // list 64: Premiere's shuttle, each press faster
      else if (e.key === 'k' || e.key === 'K') st.tlPause()
      else if (e.key === 'j' || e.key === 'J') st.tlShuttle(-1) // … backward
      else if (e.key === '-') applyZoom(zoomRef.current / 1.5)
      else if (e.key === '=' || e.key === '+') applyZoom(zoomRef.current * 1.5)
      else if (e.key === '\\') zoomTo(1, 0)
      else if (/^[1-9]$/.test(e.key)) {
        // list 1: keys 1-9 hide / show track n, V-n's 👁 and A-n's M together (the rail buttons' write)
        const tlNow = activeTimeline(st.project)
        const next = tlNow ? toggleTrackPair(tlNow, Number(e.key) - 1) : null
        if (tlNow && next) void setTimelineMeta({ mutedTracks: next }, tlNow.id)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && marqueeSel.size > 1) {
        e.preventDefault()
        e.stopPropagation() // the marquee group outranks the single-selection delete in App
        const doomed = new Set(marqueeSel)
        setMarqueeSel(new Set())
        // 41: a linked clip goes as one — the riders of the doomed blocks go too
        const aud = activeTimeline(useStore.getState().project)?.audioItems ?? []
        const nextAud = aud.filter((a) => !(a.link && doomed.has(a.link.itemId)))
        void setTimelineBoth(K.freshItems().filter((x) => !doomed.has(x.id)), nextAud.length === aud.length ? null : nextAud)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && gapSel) {
        e.preventDefault()
        e.stopPropagation() // a selected gap outranks the single-selection delete in App
        K.deleteGapSel(gapSel)
      }
    }
    window.addEventListener('keydown', onKey, true) // capture: marquee-delete must beat App's handler
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marqueeSel, gapSel, tlObj?.id, vTracks, panelKey])

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
  // the ruler stays at the top while the tracks scroll down (Premiere, his ask 10-01). It lives in
  // the time surface's own sideways scroller, where position: sticky never sees the vertical
  // scroll, so it and the rail's corner ride the vertical scroller's scrollTop instead
  const rulerRowRef = useRef<HTMLDivElement>(null)
  const railCornerRef = useRef<HTMLDivElement>(null)
  const pinRuler = (e: React.UIEvent<HTMLDivElement>): void => {
    const y = `translateY(${e.currentTarget.scrollTop}px)`
    for (const el of [rulerRowRef.current, railCornerRef.current]) if (el) el.style.transform = y
  }
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


  // list 49: the main panel's tabs — restored per project, the active timeline always among them
  // (unless it has its own panel), deleted timelines dropped
  const tabs = useStore((s) => s.tlTabs)
  const tlWindows = useStore((s) => s.tlWindows)
  const projDir = project?.dir
  const tlIdsKey = (project?.timelines ?? []).map((t) => t.id).join('|')
  useEffect(() => {
    if (timelineId || !projDir) return
    let saved: { tabs?: string[]; current?: string | null } = {}
    try {
      saved = JSON.parse(localStorage.getItem(`vd-tl-tabs:${projDir}`) ?? '{}') as typeof saved
    } catch {
      /* none saved */
    }
    const p = useStore.getState().project
    const ids = new Set((p?.timelines ?? []).map((t) => t.id))
    const keep = (saved.tabs ?? []).filter((id) => ids.has(id))
    const active = p?.activeTimelineId
    if (active && ids.has(active) && !keep.includes(active)) keep.push(active)
    useStore.getState().setTimelineTabs(keep, active && ids.has(active) ? active : (keep[0] ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projDir])
  const activeId = project?.activeTimelineId
  useEffect(() => {
    if (timelineId) return
    const st = useStore.getState()
    const ids = new Set((st.project?.timelines ?? []).map((t) => t.id))
    let next = st.tlTabs.filter((id) => ids.has(id))
    let cur = st.tlTabCurrent && ids.has(st.tlTabCurrent) ? st.tlTabCurrent : null
    if (activeId && ids.has(activeId) && !st.tlWindows.includes(activeId)) {
      if (!next.includes(activeId)) next = [...next, activeId]
      cur = activeId
    }
    if (next.join('|') !== st.tlTabs.join('|') || cur !== st.tlTabCurrent) st.setTimelineTabs(next, cur ?? next[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tlIdsKey, timelineId])
  // a tab: click = show it · drag along the strip = reorder · drag out of the strip = its own panel
  const tabPress = (e: React.MouseEvent, id: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const strip = (e.currentTarget as HTMLElement).parentElement
    const x0 = e.clientX
    const y0 = e.clientY
    let moved = false
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - x0) > 5 || Math.abs(ev.clientY - y0) > 5) moved = true
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const st = useStore.getState()
      if (!moved) {
        void st.selectTimeline(id)
        return
      }
      const r = strip?.getBoundingClientRect()
      const out = !r || ev.clientY > r.bottom + 30 || ev.clientY < r.top - 30
      if (out) {
        const t = st.project?.timelines.find((x) => x.id === id)
        if (!t || st.tlTabs.length < 2) return // the main panel keeps one timeline
        st.closeTimelineTab(id)
        openTimelineWindow(id, t.name, { x: ev.clientX, y: ev.clientY })
        return
      }
      // reorder: land before the tab under the pointer (or at the end)
      const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => (el as HTMLElement).closest?.('[data-tltab]') as HTMLElement | null).find(Boolean)
      const target = over?.dataset.tltab
      if (!target || target === id) return
      const rest = st.tlTabs.filter((x) => x !== id)
      const at = rest.indexOf(target)
      st.setTimelineTabs([...rest.slice(0, at), id, ...rest.slice(at)], st.tlTabCurrent)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const tabStrip = !timelineId && project && (
    <div data-tltabs style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '3px 6px 0', borderBottom: '1px solid var(--line)', overflowX: 'auto', flex: '0 0 auto' }}>
      {tabs.map((id) => {
        const t = project.timelines.find((x) => x.id === id)
        if (!t || tlWindows.includes(id)) return null
        const on = id === tlObj?.id
        return (
          <div
            key={id}
            data-tltab={id}
            onMouseDown={(e) => tabPress(e, id)}
            onAuxClick={(e) => {
              if (e.button === 1 && tabs.length > 1) useStore.getState().closeTimelineTab(id)
            }}
            title={`${t.name} · click = show · drag along = reorder · drag out = its own window · middle-click / × = close the tab (the timeline stays in the Bin)`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px', fontSize: 11, borderRadius: '5px 5px 0 0', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', background: on ? 'var(--raised)' : 'transparent', color: on ? 'var(--txt-hi)' : 'var(--muted)', border: `1px solid ${on ? 'var(--line2)' : 'transparent'}`, borderBottom: 'none' }}
          >
            <span>{t.name}</span>
            {tabs.length > 1 && (
              <span
                role="button"
                aria-label={`close the ${t.name} tab`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  useStore.getState().closeTimelineTab(id)
                }}
                style={{ color: 'var(--dim)', lineHeight: 1 }}
              >
                ×
              </span>
            )}
          </div>
        )
      })}
    </div>
  )

  if (!project) return <EmptyState>open a project to edit its timeline</EmptyState>
  return (
    <div
      className="vd-panel"
      {...tetherAttr('timeline', '*')}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      // the keyboard follows the pointer onto the timeline: blocks cancel a press's default (their
      // drags need it), which also cancelled the browser's focus move — a text box clicked earlier
      // kept the keys, so Ctrl+C / X / V went into it instead of the timeline (his report 09-29)
      onMouseDownCapture={(e) => {
        // list 49: this panel has the keys now, and its timeline is the active one (the edit this
        // press starts reads the active timeline — selectTimeline sets it at once, main follows)
        const st0 = useStore.getState()
        st0.setTlFocus(panelKey)
        if (tlObj && st0.project?.activeTimelineId !== tlObj.id) void st0.selectTimeline(tlObj.id)
        const typingIn = (el: Element | null): boolean => !!el?.closest('input, textarea, select, [contenteditable="true"]')
        if (typingIn(e.target as Element)) return
        if (document.activeElement instanceof HTMLElement && typingIn(document.activeElement)) document.activeElement.blur()
        if (!(document.getSelection()?.isCollapsed ?? true)) document.getSelection()?.removeAllRanges()
      }}
    >
      {tabStrip}
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
        <span
          className="vd-loop"
          style={{ opacity: tlTool === 'pen' ? 1 : 0.8, color: tlTool === 'pen' ? 'var(--amber)' : undefined, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10 }}
          onClick={() => {
            setSliceMode(false)
            setSelFwd(false)
            useStore.getState().setTlTool(tlTool === 'pen' ? 'select' : 'pen')
          }}
          title="pen tool (P, like Premiere) — on a tall audio lane: click the volume line = a keyframe, drag = the line or keyframes, drag a box = select keyframes; clips don't move · V = back to the selection tool"
        >
          <Ic i={PenTool} size={14} /> pen
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
            <button type="button" className="btn vd-hbtn" disabled={!marqueeSel.size&&!selectedTlItemId} onClick={()=>setDissolveIds(marqueeSel.size?[...marqueeSel]:selectedTlItemId?[selectedTlItemId]:[])} title="Add, adjust or remove cross-dissolves on selected clips">Cross-dissolve</button>
            {dissolveIds&&project&&<DissolveModal key={tlObj.id} project={project} timeline={tlObj} itemIds={dissolveIds} onClose={()=>setDissolveIds(null)}/>}
            {speedIds && project && <SpeedModal key={tlObj.id} project={project} timeline={tlObj} itemIds={speedIds} onClose={() => setSpeedIds(null)} />}
            {remapKeyMenu && (
              <ContextMenu
                x={remapKeyMenu.x}
                y={remapKeyMenu.y}
                entries={[
                  {
                    label: <>delete speed keyframe</>,
                    danger: true,
                    onClick: () => {
                      const it = freshItems().find((x) => x.id === remapKeyMenu.id)
                      if (it?.remap) commitRemap(it.id, remapDeleteKey(it.remap, remapKeyMenu.i))
                      setRemapKey(null)
                    }
                  }
                ]}
                onClose={() => setRemapKeyMenu(null)}
              />
            )}
            <button type="button" className="btn vd-hbtn" disabled={exportState.busy || !timeline.length || !vd().watchTimeline} onClick={() => setWatchOpen(true)} title="Review the assembled cut with your video reader">Watch cut</button>
            {watchOpen && <WatchTimelineModal key={tlObj.id} timeline={tlObj} onClose={() => setWatchOpen(false)} />}
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
            const displays = await vd().screenList()
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
                      void vd().mirrorOpen(d.id).then((ok) => {
                        if (ok) setMirrorDisplay(d.id)
                        else toast('couldn’t open that display (unplugged?)', { kind: 'error' })
                      })
                  })
                )),
            { sep: true, label: '' },
            {
              label: <>off — preview in this window only{mirrorDisplayId == null ? ' ✓' : ''}</>,
              onClick: () => {
                void vd().mirrorClose()
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
        <div onScroll={pinRuler} style={{ display: 'flex', overflowY: 'auto', flex: '1 1 auto', minHeight: 0, background: 'var(--bg0)' }}>
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
            <div ref={railCornerRef} title="right-click below for track actions (add / delete / lock)" style={{ position: 'relative', zIndex: 3, height: 18, borderBottom: '1px solid var(--line)', background: 'var(--bg0)' }} />
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
                const laneEmpty = !(tlObj?.audioItems ?? []).some((a) => a.lane === l)
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
                    {expandedAudioLanes.includes(l) && (
                      <div style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
                        {chip('◁', false, 'var(--amber)', 'previous keyframe on this lane', () => kfJump(l, -1))}
                        {chip('◇', false, 'var(--amber)', 'add / remove a keyframe at the playhead (the block under it on this lane)', () => kfToggle(l))}
                        {chip('▷', false, 'var(--amber)', 'next keyframe on this lane', () => kfJump(l, 1))}
                      </div>
                    )}
                    {laneEmpty && laneCount > 1 && l === laneCount - 1 && l >= vTracks && (
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
            {/* list 2: the S (score) tracks — the A rows' grammar, scores only; the bar matches the time surface's */}
            <div style={{ height: S_BAR_H, background: 'var(--raised2)' }} />
            <div>
              {Array.from({ length: sCount }, (_, l) => {
                const sKey = `s${l}`
                const sEmpty = !(tlObj?.scoreItems ?? []).some((x) => (x.lane ?? 0) === l)
                return (
                  <div
                    key={sKey}
                    onDoubleClick={() => useStore.getState().toggleScoreLane(l)}
                    title="double-click = expand/collapse this score track (volume view)"
                    style={{ position: 'relative', height: sLaneHOf(l), display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', boxShadow: 'inset 0 -1px 0 var(--line)', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--score)', width: 22, flex: '0 0 auto' }}>S{l + 1}</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {chip('M', mutedTr.has(sKey), 'var(--bad)', 'mute this score track (playback + export)', () => tlObj && void setTimelineMeta({ mutedTracks: togg(tlObj.mutedTracks, sKey) }, tlObj.id))}
                      {chip('S', soloTr.has(sKey), 'var(--amber)', 'solo this score track (mutes every other audio and score track)', () => tlObj && void setTimelineMeta({ soloTracks: togg(tlObj.soloTracks, sKey) }, tlObj.id))}
                      {chip('🔒', locked.has(sKey), 'var(--amber)', 'lock this score track (rejects edits)', () => tlObj && void setTimelineMeta({ lockedTracks: togg(tlObj.lockedTracks, sKey) }, tlObj.id))}
                    </div>
                    {expandedScoreLanes.includes(l) && (
                      <div style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
                        {chip('◁', false, 'var(--amber)', 'previous keyframe on this track', () => kfJump(l, -1, 's'))}
                        {chip('◇', false, 'var(--amber)', 'add / remove a keyframe at the playhead (the score under it)', () => kfToggle(l, 's'))}
                        {chip('▷', false, 'var(--amber)', 'next keyframe on this track', () => kfJump(l, 1, 's'))}
                      </div>
                    )}
                    {sEmpty && sCount > 1 && l === sCount - 1 && (
                      <span
                        onClick={() => tlObj && void setTimelineMeta({ scoreTracks: sCount - 1, mutedTracks: (tlObj.mutedTracks ?? []).filter((x) => x !== sKey), soloTracks: (tlObj.soloTracks ?? []).filter((x) => x !== sKey), lockedTracks: (tlObj.lockedTracks ?? []).filter((x) => x !== sKey) }, tlObj.id)}
                        title="delete this empty score track"
                        style={{ cursor: 'pointer', marginLeft: 'auto', color: 'var(--dim)' }}
                      >
                        ✕
                      </span>
                    )}
                    <div onMouseDown={(e) => dragHeights(e, 'lane')} title="drag = resize the audio and score tracks" style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 6, cursor: 'ns-resize', zIndex: 2 }} />
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
              {/* ruler: scrub · markers · in/out range. Above the blocks (it stays at the top while
                  the tracks scroll under it), so the playhead draws on it again */}
              <div
                ref={rulerRowRef}
                onPointerDown={onScrubDown}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubEnd}
                onPointerCancel={onScrubEnd}
                style={{ position: 'relative', zIndex: 40, height: RULER_H, borderBottom: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', touchAction: 'none', background: 'var(--bg0)' }}
                title="click or drag to scrub · M = marker at playhead · I/O = in/out range"
              >
                <Playhead total={total} />
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
                      if (t.includes(MIME_CLIP) || t.includes(MIME_CLIPS) || t.includes(MIME_TAKE) || t.includes(MIME_IMAGES) || t.includes(MIME_VIDEO) || t.includes(MIME_VEDITNODE) || t.includes(MIME_TIMELINE)) e.preventDefault()
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
                          ...(it.nestId ? [{ label: <>⧉ open nest</>, onClick: (): void => void useStore.getState().selectTimeline(it.nestId!) } as MenuEntry] : []),
                          { label: <>⧉ nest…{marqueeSel.has(it.id) && marqueeSel.size > 1 ? ` (${marqueeSel.size} clips)` : ''}</>, onClick: (): void => void nestFrom(it) } as MenuEntry,
                          ...(viewOf(it)?.take
                            ? [
                                { label: <><Ic i={ImageDown} size={12} /> ⊢ first frame → Library (live still)</>, onClick: () => void addDynamicStillFor(it.id, 'first') },
                                // current frame = the monitor's 📷 grab (playhead frame, static) — greyed
                                // with the reason when the playhead isn't inside this block's span
                                (() => {
                                  const T = useStore.getState().tlTime
                                  const phOver = T >= pos.start && T <= pos.start + len
                                  return {
                                    label: <><Ic i={ImageDown} size={12} /> current frame → Library (playhead still)</>,
                                    disabled: !phOver,
                                    title: phOver ? 'save the frame under the playhead to the Library (same grab as the monitor 📷)' : "playhead isn't over this clip",
                                    onClick: (): void => {
                                      raiseTimelineMonitor()
                                      if (!grabProgramFrame()) toast('no frame to grab — the monitor may still be opening', { kind: 'error' })
                                    }
                                  } as MenuEntry
                                })(),
                                { label: <><Ic i={ImageDown} size={12} /> last frame → Library (live still) ⊣</>, onClick: () => void addDynamicStillFor(it.id, 'last') },
                                { sep: true, label: '' } as MenuEntry
                              ]
                            : []),
                          ...(editVideo ? [{ label: <><Ic i={Wand2} size={12} /> ⑂ edit this take v2v</>, onClick: editVideo }] : []),
                          // list 23: a Library sound lies under this block (a recorded line) → lip-sync the
                          // take to it. Opens the Video Editor on a lip-sync engine with that sound picked;
                          // the windows are the stretch where block and sound overlap. Nothing renders yet.
                          ...(() => {
                            const take = viewOf(it)?.take
                            const aLen = (a: TimelineAudioItem): number => (a.outSec - a.inSec) / (a.speed && a.speed > 0 ? a.speed : 1)
                            const a = take ? (tlObj?.audioItems ?? []).find((x) => 'audioId' in x.source && !x.disabled && x.startSec < pos.start + len - 0.05 && x.startSec + aLen(x) > pos.start + 0.05) : undefined
                            if (!take || !a || !('audioId' in a.source)) return []
                            const audioId = a.source.audioId
                            const title = project?.audio.find((x) => x.id === audioId)?.title ?? 'the sound under it'
                            return [
                              {
                                label: <>🗣 lip-sync this take to ♫ {title}</>,
                                title: 'opens the Video Editor on a lip-sync engine with this sound picked — nothing renders until you press Generate',
                                onClick: (): void => {
                                  const asp = a.speed && a.speed > 0 ? a.speed : 1
                                  const ovStart = Math.max(pos.start, a.startSec)
                                  const ovEnd = Math.min(pos.start + len, a.startSec + aLen(a))
                                  const plain = !(it.speed && it.speed !== 1) && !it.reverse && !remapped(it) // a sped, reversed or remapped block keeps its own window: he sets it in the editor
                                  const vin = (win.inSec ?? 0) + (plain ? ovStart - pos.start : 0)
                                  useStore.getState().setEditorVideo({
                                    takeRef: { clipId: it.clipId, takeId: take.id },
                                    inSec: vin,
                                    ...(plain ? { outSec: vin + (ovEnd - ovStart) } : win.outSec != null ? { outSec: win.outSec } : {}),
                                    lip: { audioId, inSec: a.inSec + (ovStart - a.startSec) * asp, outSec: a.inSec + (ovEnd - a.startSec) * asp }
                                  })
                                  openVideoEditor()
                                }
                              } as MenuEntry
                            ]
                          })(),
                          ...((viewOf(it)?.take || it.nestId) && !it.audioDetachedId
                            ? [{ label: <>♪ unlink audio</>, onClick: (): void => void unlinkAudio(it.id) } as MenuEntry]
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
                                    // list 56: a remapped block's sound runs at normal speed, its window or the block
                                    const srcLen = remapped(it) ? remapAudioOut(it, st.project?.clips ?? []) - inS : effDur(it, st.project?.clips ?? []) * sp
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
                          // NEST (list 3, part 2): dissolve, speed and effects reach a nest block too;
                          // loop stays on clips (Premiere has none)
                          ...([
                          {
                            label: <>⤬ cross-dissolve…{it.transitionOutSec ? ` (${it.transitionOutSec}s)` : ''}</>,
                            onClick: () => setDissolveIds(marqueeSel.has(it.id)?[...marqueeSel]:[it.id])
                          },
                          {
                            // list 51: Premiere's Clip Speed / Duration (Ctrl+R) on the selection
                            label: <>⚡ speed / duration… ({remapped(it) ? 'remapped' : `${Math.round((it.speed ?? 1) * 100)}%`}{it.reverse ? ' reversed' : ''})</>,
                            onClick: (): void => setSpeedIds(marqueeSel.has(it.id) ? [...marqueeSel] : [it.id])
                          },
                          // list 56: Premiere's Time Remapping — the speed line on the block
                          ...(it.nestId || it.useRecipe
                            ? []
                            : [
                                {
                                  label: <>time remapping</>,
                                  title: 'the speed changes along the block: a line on it, keyframes, ramps (Premiere’s Time Remapping)',
                                  sub: [
                                    it.reverse
                                      ? { label: <>speed</>, disabled: true, title: 'a reversed block: switch Reverse off in speed / duration… first' }
                                      : {
                                          label: <>speed{it.remap ? ' ✓' : ''}</>,
                                          title: it.remap ? 'the speed line is on this block' : 'shows the speed line on the block: drag it = faster or slower · Ctrl-click (or the Pen) = a keyframe · drag a keyframe’s handles apart = a ramp',
                                          onClick: (): void => {
                                            if (!it.remap) commitRemap(it.id, remapNew(it.speed ?? 1))
                                          }
                                        },
                                    { label: <>remove</>, disabled: !it.remap, title: it.remap ? 'the block plays at 100 % again' : 'no time remapping on this block', onClick: (): void => commitRemap(it.id, undefined) }
                                  ]
                                } as MenuEntry
                              ]),
                          // list 52: ENHANCE on the take this block plays (the copy lands as a new take)
                          ...(viewOf(it)?.take && !it.nestId
                            ? [
                                {
                                  label: <>enhance…</>,
                                  title: 'opens ENHANCE on the take this block plays — interpolate (more frames, slow motion) and upscale (more pixels); the result is a copy',
                                  onClick: (): void => useStore.getState().openEnhance({ kind: 'take', clipId: it.clipId, takeId: viewOf(it)!.take!.id })
                                },
                                // list 42: a depth map of the take this block plays
                                {
                                  label: <>{depthLabel(viewOf(it)!.take!.durationSec)}</>,
                                  title: DEPTH_TITLE,
                                  onClick: (): void => {
                                    const t = viewOf(it)!.take!
                                    const c = clipOf(it.clipId)
                                    queueDepth({ kind: 'take', clipId: it.clipId, takeId: t.id }, `${c?.name ?? 'clip'} T${(c?.takes.findIndex((k) => k.id === t.id) ?? 0) + 1}`, t.durationSec)
                                  }
                                },
                                // his ask 10-01: "enhanced" → every enhanced copy of the block's take (and the
                                // original); the block plays the pick, like any take switch (a longer copy ripples)
                                ((): MenuEntry => {
                                  const c = clipOf(it.clipId)!
                                  const t = viewOf(it)!.take!
                                  type T = Clip['takes'][number]
                                  const rootOf = (x: T): T => {
                                    let cur = x
                                    for (let i = 0; i < 50 && cur.enhanced?.of; i++) {
                                      const up = c.takes.find((k) => k.id === cur.enhanced!.of)
                                      if (!up) break
                                      cur = up
                                    }
                                    return cur
                                  }
                                  const root = rootOf(t)
                                  const copies = c.takes.filter((k) => k.id !== root.id && rootOf(k).id === root.id)
                                  if (!copies.length) return { label: <>enhanced</>, disabled: true, title: 'no enhanced copy of this take yet — enhance… makes one' }
                                  const row = (k: T, words: string): MenuEntry => ({
                                    label: (
                                      <span data-enhanced-pick={k.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: 2, flex: '0 0 auto', background: enhanceTone(k.enhanced) ?? 'transparent', border: k.enhanced ? undefined : '1px solid var(--line2)' }} />
                                        T{c.takes.indexOf(k) + 1} · {words}
                                        {k.id === t.id ? ' ✓' : ''}
                                      </span>
                                    ),
                                    title: k.id === t.id ? 'this block plays it' : 'the block plays this one instead',
                                    onClick: (): void => void useStore.getState().setSlotView(it.id, { takeId: k.id })
                                  })
                                  return { label: <>enhanced</>, title: 'the enhanced copies of this take — the block plays the one picked', sub: [row(root, root.enhanced ? enhanceWords(root.enhanced) : 'original'), ...copies.map((k) => row(k, enhanceWords(k.enhanced)))] }
                                })()
                              ]
                            : []),
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
                          ...(it.nestId ? [] : [{
                            label: <>{it.loop ? '⟲ loop off' : '⟲ loop'}</>,
                            onClick: (): void =>
                              // ⟲ v17 tail: one flag — the repeats are PROJECTIONS of this block
                              // (render/play/export resolve through it live). No copies, ever.
                              void setTimelineItems(freshItems().map((x) => (x.id === it.id ? { ...x, loop: !x.loop || undefined, loopTailSec: undefined } : x)))
                          }])
                          ] as MenuEntry[]),
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
                              name={blockNameOf(it)}
                              durLabel={`${Math.round(len * 100) / 100}s`}
                              takeLabel={takeLabel(it)}
                              dynamic={!it.useRecipe && !it.takeId && (clipOf(it.clipId)?.takes.length ?? 0) > 0}
                              note={it.note}
                              enhanced={viewOf(it)?.take?.enhanced}
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
                              beats={it.reverse ? undefined : beatsOf(it)}
                              beatImgs={beatImgsOf(it)}
                              trimmable={!it.useRecipe && !locked.has(`v${tr}`)}
                              sliceMode={sliceMode}
                              canSlice={!!takeFileOf(it) || !!it.nestId}
                              nest={!!it.nestId}
                              nestFace={it.nestId ? it : undefined}
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
                                setRemapKey(null) // list 56: a click on the block lets a speed keyframe go (Delete is the block's again)
                                selectTlItem(it.id)
                              }}
                              onDoubleClick={() => {
                                // NEST (list 3): double-click opens its timeline (Premiere)
                                if (it.nestId) {
                                  void useStore.getState().selectTimeline(it.nestId)
                                  return
                                }
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
                            {/* list 56: the speed line (Premiere's Time Remapping band) */}
                            {remapped(it) && !sliceMode && (
                              <SpeedBand
                                remap={remapLive?.id === it.id ? remapLive.remap : it.remap!}
                                inSec={win.inSec ?? 0}
                                outSec={Math.min(win.outSec ?? srcLenOf(it), srcLenOf(it))}
                                lenSec={len}
                                pen={tlTool === 'pen'}
                                selected={remapKey?.id === it.id ? remapKey.i : null}
                                onSelect={(i) => {
                                  setRemapKey(i == null ? null : { id: it.id, i })
                                  if (i != null) selectTlItem(it.id)
                                }}
                                onLive={(r) => setRemapLive(r ? { id: it.id, remap: r } : null)}
                                onCommit={(r) => commitRemap(it.id, r)}
                                onKeyMenu={(i, x, y) => setRemapKeyMenu({ x, y, id: it.id, i })}
                              />
                            )}
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
                    {project&&tlObj&&<TimelineTransitions project={project} timeline={tlObj} track={tr} total={total} onEdit={id=>setDissolveIds([id])}/>}
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
                {/* new-track intent: the drag is held past the top row — the strip says a
                    release HERE creates the track (law 1: the state is drawn) */}
                {dragView && [...dragView.values()].some((p) => p.track >= vTracks) && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--amber)', boxShadow: '0 0 6px var(--amber)', zIndex: 30, pointerEvents: 'none' }} />
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
                  laneCount={laneCount}
                  laneH={LANE_HV}
                  onUnlink={(itemId) => void unlinkAudio(itemId)}
                  snap={snapKit}
                  sliceMode={sliceMode}
                  onSliceAudio={(id, T) => {
                    void sliceAudioItem(id, T)
                    setSliceMode(false)
                  }}
                  onSliceVideo={(itemId, T) => {
                    const it = freshItems().find((x) => x.id === itemId)
                    if (it) sliceAtTime(it, T)
                  }}
                  onMovePair={movePair}
                  onPairPreview={(m) => {
                    dragViewRef.current = m
                    setDragView(m)
                  }}
                />
              )}
              {/* list 2: the S (score) tracks below the A lanes — scores only, nothing else lands here */}
              {tlObj && <div style={{ height: S_BAR_H, background: 'var(--raised2)' }} />}
              {tlObj && (
                <ScoreBlocks
                  tl={tlObj}
                  total={total}
                  scoreClips={project?.scoreClips ?? []}
                  laneH={LANE_HV}
                  sCount={sCount}
                  snap={snapKit}
                  sliceMode={sliceMode}
                  onSlice={(id, T) => {
                    void sliceScoreItem(id, T)
                    setSliceMode(false)
                  }}
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
                if (laneCount > 1 && laneCount - 1 >= vTracks && !used) void setTimelineMeta({ audioTracks: laneCount - 1 }, tlObj.id)
                else if (used) toast('the last audio lane has blocks on it — clear it first', { kind: 'error' })
              }
            }
            const addS = { label: <>＋ add score track</>, onClick: (): void => void (sCount < 8 && setTimelineMeta({ scoreTracks: sCount + 1 }, tlObj.id)) }
            const delS = {
              label: <>− delete last score track (must be empty)</>,
              onClick: (): void => {
                const used = (tlObj.scoreItems ?? []).some((x) => (x.lane ?? 0) === sCount - 1)
                if (sCount > 1 && !used) void setTimelineMeta({ scoreTracks: sCount - 1 }, tlObj.id)
                else if (used) toast('the last score track has a score on it — clear it first', { kind: 'error' })
              }
            }
            if (railMenu.track == null) return [addV, addA, delA, addS, delS]
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
              label: tlClipboard ? <>▣ paste here (overwrite)</> : <>▣ paste here — copy a block first (Ctrl+C)</>,
              onClick: () => tlClipboard && void pasteTlClipboard({ at: gapMenu.at, track: gapMenu.track })
            },
            { label: <>⇤ close gap (pull everything left)</>, onClick: () => closeGap(gapMenu.track, gapMenu.at) },
            { label: <>◈ marker here</>, onClick: () => tlObj && void setTimelineMeta({ markers: [...(tlObj.markers ?? []), { id: String(Date.now()), at: gapMenu.at }] }, tlObj.id) },
            ...scoreBeatEntries(tlObj, gapMenu.at),
            { sep: true, label: '' },
            // track building lives EVERYWHERE the timeline is (user call 2026-08-20), not just the rail
            { label: <>＋ add video track</>, onClick: () => tlObj && vTracks < 8 && void setTimelineMeta({ videoTracks: vTracks + 1 }, tlObj.id) },
            { label: <>＋ add audio lane</>, onClick: () => tlObj && laneCount < 8 && void setTimelineMeta({ audioTracks: laneCount + 1 }, tlObj.id) }
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
