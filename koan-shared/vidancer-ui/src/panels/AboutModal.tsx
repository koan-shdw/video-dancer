import { vd } from '../api'
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'

// About: version + the credits we OWE — distributing the bundled GPL ffmpeg binary requires
// attribution, the license name, and a source pointer (ffmpeg.org/legal). Opens from the logo.
// Also the re-entry point for onboarding: the setup guide and the panel tour.
export function AboutModal({
  onClose,
  onShowWelcome,
  onReplayTour
}: {
  onClose: () => void
  onShowWelcome?: () => void
  onReplayTour?: () => void
}): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void vd().appVersion().then(setVersion)
  }, [])
  const link = (url: string, label: string): React.JSX.Element => (
    <span
      onClick={() => void vd().openExternal(url)}
      style={{ color: 'var(--amber)', cursor: 'pointer', textDecoration: 'underline' }}
      title={url}
    >
      {label}
    </span>
  )
  return (
    <Modal title={`Video Dancer ${version ? `v${version}` : ''}`} width={440} onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--txt)', lineHeight: 1.55 }}>
        <p style={{ margin: '0 0 10px', color: 'var(--muted)' }}>
          AI video-generation timeline editor. Local-first — your projects, renders and keys live on this machine; generation runs on your own fal.ai account.
        </p>
        {(onShowWelcome || onReplayTour) && (
          <p style={{ margin: '0 0 10px', fontSize: 11.5 }}>
            New here?{' '}
            {onShowWelcome && (
              <span onClick={onShowWelcome} style={{ color: 'var(--amber)', cursor: 'pointer', textDecoration: 'underline' }}>
                API setup guide
              </span>
            )}
            {onShowWelcome && onReplayTour && ' · '}
            {onReplayTour && (
              <span onClick={onReplayTour} style={{ color: 'var(--amber)', cursor: 'pointer', textDecoration: 'underline' }}>
                replay the tour
              </span>
            )}
          </p>
        )}
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
          <p style={{ margin: '10px 0 0' }}>
            Hit a bug?{' '}
            <span onClick={() => void vd().openLogs()} style={{ color: 'var(--amber)', cursor: 'pointer', textDecoration: 'underline' }} title="open the crash-log folder">
              open the log folder
            </span>{' '}
            and send <code>main.log</code>.
          </p>
        </div>
      </div>
    </Modal>
  )
}
