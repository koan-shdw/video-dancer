import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// About: version + the credits we OWE — distributing the bundled GPL ffmpeg binary requires
// attribution, the license name, and a source pointer (ffmpeg.org/legal). Opens from the logo.
export function AboutModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.vidancer.appVersion().then(setVersion)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const link = (url: string, label: string): React.JSX.Element => (
    <span
      onClick={() => void window.vidancer.openExternal(url)}
      style={{ color: 'var(--amber)', cursor: 'pointer', textDecoration: 'underline' }}
      title={url}
    >
      {label}
    </span>
  )
  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: '92vw', background: 'var(--panel)', border: '1px solid var(--line2)', borderRadius: 10, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.6)', fontSize: 12, color: 'var(--txt)', lineHeight: 1.55 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Video Dancer {version && `v${version}`}</span>
          <span className="btn vd-hbtn" onClick={onClose}>✕</span>
        </div>
        <p style={{ margin: '0 0 10px', color: 'var(--muted)' }}>
          AI video-generation timeline editor. Local-first — your projects, renders and keys live on this machine; generation runs on your own fal.ai account.
        </p>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 6 }}>credits & licenses</div>
          <p style={{ margin: '0 0 8px' }}>
            This software uses {link('https://ffmpeg.org', 'FFmpeg')} for video export, licensed under the{' '}
            {link('https://www.gnu.org/licenses/gpl-3.0.html', 'GNU GPL')}. The ffmpeg binary is bundled unmodified via{' '}
            {link('https://github.com/eugeneware/ffmpeg-static', 'ffmpeg-static')}; its source code is available at{' '}
            {link('https://ffmpeg.org/download.html', 'ffmpeg.org')}. FFmpeg is a trademark of Fabrice Bellard.
          </p>
          <p style={{ margin: 0 }}>
            Video generation: Seedance 2 (ByteDance) and Sora 2 (OpenAI) via {link('https://fal.ai', 'fal.ai')} · images: Nano Banana (Google). Outputs are subject to those services’ terms.
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
