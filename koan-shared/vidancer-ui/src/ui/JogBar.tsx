// THE jog bar — the Clip Monitor's canon transport widget, extracted from Video Editor so every
// v2v surface runs ONE implementation (law 3: one job, one widget). Clicking ANYWHERE on the bar
// scrubs (the window region is pointerEvents:none); trimming is invisible hot-zones on the in/out
// edges; sliding is the ↔ pill only — its own lane, so it never fights the jog ruler (Premiere
// grammar). Playhead + timecode are set imperatively through the exposed paintTime() handle so
// playback never re-renders the owning panel per frame; the owner's onTimeUpdate calls it (the
// loop-inside-window rule stays owner-side — it needs inS/outS anyway).
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { smpte } from '../lib/time'
import { Ic, Play, Pause, Volume2, VolumeX } from './icons'
import { useStrip, sampleStrip } from '../lib/filmstrip'

export interface JogBarHandle {
  paintTime(t: number): void
}

interface JogBarProps {
  videoRef: React.RefObject<HTMLVideoElement | null> // the preview element (the owner renders it)
  srcDur: number // learned source duration (0 = unknown)
  inS: number
  outS: number
  setInS: (v: number) => void
  setOutS: (v: number) => void
  minSpan: number
  maxSpan: number
  label?: string // center caption of the in/out under-row ("node · name" / "source")
  windowNote?: string // suffix after the window facts (" · sent as @video1"), in the hover text
  stripFile?: string // the video whose frames ride the bar
  playing: boolean
  muted: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
}

export const JogBar = forwardRef<JogBarHandle, JogBarProps>(function JogBar(p, ref) {
  const stripRef = useRef<HTMLDivElement>(null)
  const tcRef = useRef<HTMLSpanElement>(null) // live timecode — set imperatively (no per-frame re-render)
  const phRef = useRef<HTMLDivElement>(null) // playhead line — set imperatively (Clip Monitor canon)

  const stripDur = (): number => {
    const v = p.videoRef.current
    return v && isFinite(v.duration) && v.duration > 0 ? v.duration : p.srcDur
  }
  const paintTime = (t: number): void => {
    if (tcRef.current) tcRef.current.textContent = smpte(t)
    const dur = stripDur()
    if (phRef.current && dur > 0) phRef.current.style.left = `calc(${Math.min(1, Math.max(0, t / dur)) * 100}% - 1px)`
  }
  useImperativeHandle(ref, () => ({ paintTime }))

  const seekTo = (clientX: number): void => {
    const v = p.videoRef.current
    const bar = stripRef.current
    const dur = stripDur()
    if (!v || !bar || dur <= 0) return
    const r = bar.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    v.currentTime = frac * dur
    paintTime(v.currentTime)
  }
  const onBarDown = (e: React.MouseEvent): void => {
    e.preventDefault() // scrub-drag must never start a native text selection across the panel
    seekTo(e.clientX) // click = move the head
    const move = (ev: MouseEvent): void => seekTo(ev.clientX) // drag = scrub
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const span = Math.max(0, p.outS - p.inS)
  const overMax = span > p.maxSpan + 0.001
  const onEdgeDrag = (kind: 'in' | 'out', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = stripRef.current
    if (!bar || p.srcDur <= 0) return
    const secPerPx = p.srcDur / bar.getBoundingClientRect().width
    const startX = e.clientX
    const i0 = p.inS
    const o0 = p.outS
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - startX) * secPerPx
      if (kind === 'in') p.setInS(Math.max(Math.max(0, o0 - p.maxSpan), Math.min(o0 - p.minSpan, i0 + d)))
      else p.setOutS(Math.min(Math.min(p.srcDur, i0 + p.maxSpan), Math.max(i0 + p.minSpan, o0 + d)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // slide the whole window — its OWN lane, so it never fights the jog ruler
  const onWindowDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = stripRef.current
    if (!bar || p.srcDur <= 0) return
    const secPerPx = p.srcDur / bar.getBoundingClientRect().width
    const startX = e.clientX
    const i0 = p.inS
    const o0 = p.outS
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - startX) * secPerPx
      const w = o0 - i0
      const ni = Math.max(0, Math.min(p.srcDur - w, i0 + d))
      p.setInS(ni)
      p.setOutS(ni + w)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const winL = p.srcDur > 0 ? (p.inS / p.srcDur) * 100 : 0
  const winW = p.srcDur > 0 ? (span / p.srcDur) * 100 : 100
  const pvDur = stripDur()
  // Clip Gen's bar (his call 10-11): dim brackets at rest, the window lights amber only once it is
  // trimmed (or red when it runs over the model's max); the video's frames ride the bar
  const windowed = p.srcDur > 0 && (p.inS > 0.01 || p.outS < p.srcDur - 0.01)
  const lit = overMax ? 'var(--bad)' : windowed ? 'var(--amber)' : 'var(--amber-dim)'
  const frames = sampleStrip(useStrip(p.stripFile, !!p.stripFile), 8)
  const facts = `window ${span.toFixed(1)}s${p.srcDur > 0 ? ` of ${p.srcDur.toFixed(1)}s` : ''}${p.windowNote ?? ''}`

  return (
    <div className="field">
      {/* transport row: play · mute · the live timecode (current set imperatively, total derived — Clip Monitor canon) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span className="btn vd-hbtn" onClick={p.onTogglePlay} title="play / pause (loops inside the window) — clicking the video works too"><Ic i={p.playing ? Pause : Play} size={11} /></span>
        <span className="btn vd-hbtn" onClick={p.onToggleMute} title="mute / unmute (unmuting claims audio from other players)"><Ic i={p.muted ? VolumeX : Volume2} size={11} /></span>
        <span title={facts} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--txt-hi)', letterSpacing: 0.5 }}>
          <span ref={tcRef}>{smpte(0)}</span>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}> / {pvDur > 0 ? smpte(pvDur) : '…'}</span>
        </span>
        <span style={{ width: 66, flex: '0 0 auto' }} />
      </div>
      {/* THE bar — seek wins everywhere, trim = edge hot-zones, slide = the ↔ pill only */}
      <div
        ref={stripRef}
        onMouseDown={onBarDown}
        title={`click / drag to scrub · drag an edge to trim the window · ↔ slides it\n${facts}`}
        style={{ position: 'relative', height: 22, background: 'var(--raised2)', borderRadius: 4, cursor: 'pointer', overflow: 'hidden', userSelect: 'none' }}
      >
        {/* the video's frames, spaced like Clip Gen's beat pictures — purely visual */}
        {frames.map((f, i) => (
          <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i / frames.length) * 100}%`, width: `${100 / frames.length}%`, background: `center / contain no-repeat url("${f}")`, pointerEvents: 'none' }} />
        ))}
        {/* in/out region: NON-interactive (pointerEvents none) so a click anywhere here still scrubs; tinted only once trimmed */}
        {(windowed || overMax) && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${winL}%`, width: `${winW}%`, background: `color-mix(in srgb, ${overMax ? 'var(--bad)' : 'var(--amber)'} 22%, transparent)`, pointerEvents: 'none', zIndex: 2 }} />
        )}
        {/* the edges: drawn brackets (law 1: visible at rest) over invisible trim hot-zones */}
        {(['in', 'out'] as const).map((k) => (
          <div key={k} onMouseDown={(e) => onEdgeDrag(k, e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${k === 'in' ? winL : winL + winW}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`${k} ${(k === 'in' ? p.inS : p.outS).toFixed(2)}s — drag to trim`}>
            <div style={{ position: 'absolute', [k === 'in' ? 'left' : 'right']: 4, top: 0, bottom: 0, width: 2, background: lit, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', [k === 'in' ? 'left' : 'right']: 4, top: 0, width: 6, height: 2, background: lit, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', [k === 'in' ? 'left' : 'right']: 4, bottom: 0, width: 6, height: 2, background: lit, pointerEvents: 'none' }} />
          </div>
        ))}
        {/* grab handle in the MIDDLE of a trimmed region — only THIS slides the window; everywhere else seeks */}
        {(windowed || overMax) && (
          <div
            onMouseDown={onWindowDown}
            title="grab to slide the in/out window"
            style={{ position: 'absolute', left: `${winL + winW / 2}%`, top: '50%', transform: 'translate(-50%, -50%)', height: 16, minWidth: 22, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', zIndex: 4, color: 'var(--raised)', background: overMax ? 'var(--bad)' : 'var(--amber)', borderRadius: 8, fontSize: 11, fontWeight: 700, lineHeight: 1, userSelect: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' }}
          >
            ↔
          </div>
        )}
        <div ref={phRef} style={{ position: 'absolute', top: 0, bottom: 0, left: '0%', width: 2, background: '#fff', pointerEvents: 'none', zIndex: 5 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 3 }}>
        <span>in {p.inS.toFixed(2)}s</span>
        <span style={{ color: overMax ? 'var(--bad)' : 'var(--muted)' }}>{overMax ? `window ${span.toFixed(1)}s · max ${p.maxSpan}s` : (p.label ?? '')}</span>
        <span>out {p.outS.toFixed(2)}s</span>
      </div>
    </div>
  )
})
