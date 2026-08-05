import { Modal } from './Modal'

// ---- What's-New: shown ONCE, on the first launch after an auto-update lands (Settings
// lastRunVersion bump drives it — see the boot effect in App). The list is written by hand per
// release: plain words, only things a user can see and touch. Update BOTH the version and the
// list when cutting a release. ----

export const WHATS_NEW: { version: string; features: string[] } = {
  version: '0.7.3',
  features: [
    'The Screen — say “let’s review the latest take” in the Director’s Room and it floats up big behind the chat, playing with sound, while you keep talking. No clip name needed: you get the newest render in the project.',
    'Click any playing side-pop to put that exact take on the Screen. Mute, go wall-to-wall, or ✕ it from the marquee up top.',
    'The Co-Director can run the Screen too — ask it to show a take and it puts it up (or clears it) itself.',
    'A− / A+ type sizing came to the Co-Director panel — same as the room.'
  ]
}

export function WhatsNewModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title={`new in v${WHATS_NEW.version}`} width={540} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--txt)', lineHeight: 1.6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {WHATS_NEW.features.map((f, i) => {
            const [head, ...rest] = f.split(' — ')
            return (
              <div key={i} style={{ display: 'flex', gap: 9 }}>
                <span style={{ color: 'var(--amber)' }}>◆</span>
                <span>
                  <b style={{ color: 'var(--txt-hi)' }}>{head}</b>
                  {rest.length > 0 && <> — {rest.join(' — ')}</>}
                </span>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>you’re on the newest version — this card shows once per update</span>
          <span className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            nice
          </span>
        </div>
      </div>
    </Modal>
  )
}
