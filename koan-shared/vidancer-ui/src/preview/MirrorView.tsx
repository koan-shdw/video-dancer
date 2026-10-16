import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'

// the output-mirror window's ENTIRE UI: a black stage with one muted <video> (or a storyboard
// <img>), slave-synced to the main window's Monitor via mirror:state pushes. It never advances
// playback itself — the Monitor stays the sequencing authority; this window only follows.
// Muted always: audio ownership (audioBus) lives in the main window and can't span windows.
export function MirrorView(): React.JSX.Element {
  const vidRef = useRef<HTMLVideoElement>(null)
  const [file, setFile] = useState<string | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    return vd().onMirrorState((s) => {
      setFile(s.url ?? null)
      setImg(s.imgUrl ?? null)
      setPlaying(!!s.playing)
      const v = vidRef.current
      if (v && s.time != null && isFinite(s.time)) {
        // hard-correct only on real drift (same 0.35s tolerance as the music-lane sync)
        if (Math.abs(v.currentTime - s.time) > 0.35) {
          try {
            v.currentTime = s.time
          } catch {
            /* not seekable yet — the next tick corrects */
          }
        }
      }
    })
  }, [])

  // play/pause follows the relayed transport (src changes re-assert via autoPlay-less explicit calls)
  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (playing) void v.play().catch(() => undefined)
    else v.pause()
  }, [playing, file])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'none' }}>
      {file ? (
        <video ref={vidRef} src={file} muted style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      ) : img ? (
        <img src={img} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      ) : (
        <span style={{ color: '#333', fontFamily: 'monospace', fontSize: 13 }}>VIDEO DANCER — output</span>
      )}
    </div>
  )
}
