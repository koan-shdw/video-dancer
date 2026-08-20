// THE audio-take row — the design standard (user law 2026-08-20): the Score card's take row IS
// the one shape for played takes, and every card with audio takes (Score, Voices, whatever
// comes) renders THIS component. Improve it here and every card improves together.
// Grammar: click the row = keeper · ★ = keeper · right-click = the card's menu (color · disable
// · restore recipe) · drag = out to the Bin's section, where it becomes its own item.
import { useRef, useState } from 'react'
import { mediaUrl } from '../../media'
import { mmss } from '../../../../shared/emitScore'
import { Ic, Play, Pause } from '../../ui/icons'

// the v14 take-card palette (same small fixed set the video takes use)
export const TAKE_COLORS = ['#d9534f', '#e7a93c', '#5cb85c', '#5b9bd5']

// themed take player — the native <audio controls> pill ignores the app theme (design catch
// 2026-08-19); this is the house transport instead: play button, thin amber progress, mono time
export function TakePlayer({ file, onDuration }: { file: string; onDuration?: (sec: number) => void }): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const toggle = (): void => {
    const a = ref.current
    if (!a) return
    if (a.paused) void a.play().catch(() => undefined)
    else a.pause()
  }
  return (
    // the player row is the player — its clicks never bubble into card-level actions (keeper)
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <audio
        ref={ref}
        src={mediaUrl(file)}
        preload="metadata"
        style={{ display: 'none' }}
        onTimeUpdate={() => setT(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          const d = ref.current?.duration ?? 0
          setDur(d)
          if (isFinite(d) && d > 0) onDuration?.(d) // cards persist the learned length once
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <span className="btn vd-hbtn" onClick={toggle} title="play / pause">
        <Ic i={playing ? Pause : Play} size={11} />
      </span>
      <div
        ref={barRef}
        onMouseDown={(e) => {
          // press seeks, and dragging SCRUBS until release (Premiere bar feel)
          const seekTo = (clientX: number): void => {
            const r = barRef.current?.getBoundingClientRect()
            const a = ref.current
            if (!r || !a || !dur) return
            a.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur
          }
          seekTo(e.clientX)
          const move = (ev: MouseEvent): void => seekTo(ev.clientX)
          const up = (): void => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
        title="seek / drag to scrub"
        style={{ flex: 1, height: 5, background: 'var(--field)', borderRadius: 3, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${dur ? (t / dur) * 100 : 0}%`, background: 'var(--amber)' }} />
      </div>
      <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--dim)', flex: '0 0 auto' }}>
        {mmss(t)} / {mmss(dur)}
      </span>
    </div>
  )
}

// the take an AudioTakeRow shows — the shared subset of ScoreTake/VoiceTake
export interface AudioTakeLike {
  id: string
  file: string
  durationSec?: number
  engine?: string
  color?: string
  disabled?: boolean
}

export function AudioTakeRow(props: {
  take: AudioTakeLike
  index: number // 0-based position in the card's list
  keeper: boolean
  engineLabel?: string // resolved label for the meta line (cards own their registries)
  dragMime: string // 'vd/score-take' · 'vd/voice-take' — the Bin section that adopts it
  dragPayload: string // JSON the Bin drop expects
  dragHint: string // e.g. 'drag → Bin voices = its own voice'
  onKeeper: () => void
  onMenu: (pos: { x: number; y: number }) => void
  onDuration?: (sec: number) => void // fires once with the decoded length (cards persist it)
}): React.JSX.Element {
  const { take: t, keeper } = props
  return (
    <div
      onClick={props.onKeeper}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(props.dragMime, props.dragPayload)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onMenu({ x: e.clientX, y: e.clientY })
      }}
      title={keeper ? `the keeper — this take is THE one · ${props.dragHint}` : `click = make keeper · ${props.dragHint}`}
      style={{
        border: '1px solid ' + (keeper ? 'var(--amber)' : 'var(--line)'),
        borderLeft: t.color ? `4px solid ${t.color}` : '1px solid ' + (keeper ? 'var(--amber)' : 'var(--line)'),
        borderRadius: 6,
        padding: 6,
        opacity: t.disabled ? 0.45 : 1,
        cursor: 'pointer'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ cursor: 'pointer', color: keeper ? 'var(--amber)' : 'var(--dim)' }} title={keeper ? 'the keeper' : 'make this the keeper'} onClick={props.onKeeper}>
          ★
        </span>
        <span style={{ color: 'var(--txt-hi)' }}>take {props.index + 1}</span>
        <span style={{ color: 'var(--dim)' }}>
          {t.durationSec ? `${Math.round(t.durationSec)}s` : ''}
          {props.engineLabel ? ` · ${props.engineLabel}` : ''}
          {t.disabled ? ' · disabled' : ''}
        </span>
      </div>
      <TakePlayer file={t.file} onDuration={t.durationSec ? undefined : props.onDuration} />
    </div>
  )
}
