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
  return (
    <div
      title={props.label}
      onClick={props.onClick}
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
          style={{ position: 'absolute', top: 1, right: 3, color: '#fff', textShadow: '0 1px 2px #000', fontSize: 11, cursor: 'pointer' }}
        >
          ✕
        </span>
      )}
    </div>
  )
}
