import { useRef, useState } from 'react'
import { mediaUrl } from './media'

// Both hooks now just return a streaming `media://` URL — no IPC read, no Blob.
export function useThumbUrl(file?: string, rev?: number): string | null {
  return file ? mediaUrl(file, rev) : null
}

export function useMediaUrl(file?: string): string | null {
  return file ? mediaUrl(file) : null
}

export function Thumbnail(props: {
  file?: string
  videoFile?: string // show a FRAME of this video instead of an image (metadata-only, streams via media://)
  videoSeek?: number // which second's frame (e.g. an edit window's start) — media fragment, no extraction
  scrubVideo?: string // hover-scrub: moving the mouse across the tile scrubs through THIS video (muted)
  label?: string
  w?: number
  h?: number
  active?: boolean
  warn?: boolean
  rev?: number // cache-bust for files re-extracted in place (dynamic stills)
  onClick?: () => void
  onClear?: () => void
  placeholder?: string
}): React.JSX.Element {
  const url = useThumbUrl(props.file, props.rev)
  const videoUrl = props.videoFile ? mediaUrl(props.videoFile) + `#t=${(props.videoSeek ?? 0) + 0.05}` : null
  const w = props.w ?? 72
  const h = props.h ?? 46
  // hover-scrub: the scrub <video> mounts only while hovered (no decoder cost at rest); mouse X maps
  // to a fraction of the video's duration. Muted always — a hover must never touch audio ownership.
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrubRef = useRef<HTMLVideoElement>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubX, setScrubX] = useState(0) // 0..1 — position line
  const onScrubMove = (e: React.MouseEvent): void => {
    if (!props.scrubVideo) return
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    setScrubX(frac)
    const v = scrubRef.current
    if (v && isFinite(v.duration) && v.duration > 0) v.currentTime = frac * v.duration
  }
  return (
    <div
      ref={wrapRef}
      title={props.label}
      onClick={props.onClick}
      onMouseEnter={props.scrubVideo ? () => setScrubbing(true) : undefined}
      onMouseMove={props.scrubVideo ? onScrubMove : undefined}
      onMouseLeave={props.scrubVideo ? () => setScrubbing(false) : undefined}
      style={{
        width: w,
        height: h,
        flex: '0 0 auto',
        position: 'relative',
        borderRadius: 5,
        overflow: 'hidden',
        border: '1px solid ' + (props.active ? 'var(--amber)' : 'var(--line)'),
        outline: props.warn ? '2px solid var(--amber)' : undefined, // in the ref list but not @mentioned in the prompt
        outlineOffset: -1,
        background: 'var(--field)',
        cursor: props.onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'flex-end'
      }}
    >
      {videoUrl ? (
        <video src={videoUrl} preload="metadata" muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
      ) : url ? (
        <img src={url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : null}
      {props.scrubVideo && scrubbing && (
        <>
          <video
            ref={scrubRef}
            src={mediaUrl(props.scrubVideo)}
            preload="auto"
            muted
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', zIndex: 1, background: '#000' }}
          />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${scrubX * 100}%`, width: 1.5, background: 'rgba(255,255,255,.85)', zIndex: 2, pointerEvents: 'none' }} />
        </>
      )}
      {!url && !videoUrl && props.placeholder && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: 9, textAlign: 'center', padding: 2 }}>
          {props.placeholder}
        </span>
      )}
      {props.label && (
        <span
          style={{
            position: 'relative',
            background: 'rgba(0,0,0,.72)',
            color: 'var(--gold)',
            fontSize: 9,
            fontFamily: 'var(--mono)',
            padding: '1px 4px',
            margin: 2,
            borderRadius: 3,
            maxWidth: 'calc(100% - 4px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {props.label}
        </span>
      )}
      {props.onClear && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            props.onClear?.()
          }}
          style={{ position: 'absolute', top: 1, right: 3, color: '#fff', textShadow: '0 1px 2px #000', fontSize: 11, cursor: 'pointer', zIndex: 3 }}
        >
          ✕
        </span>
      )}
    </div>
  )
}
