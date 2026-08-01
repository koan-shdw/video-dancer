import { Modal } from './Modal'

// ---- What's-New: shown ONCE, on the first launch after an auto-update lands (Settings
// lastRunVersion bump drives it — see the boot effect in App). The list is written by hand per
// release: plain words, only things a user can see and touch. Update BOTH the version and the
// list when cutting a release. ----

export const WHATS_NEW: { version: string; features: string[] } = {
  version: '0.7.0',
  features: [
    'The Director’s Room — a full-screen space for the Co-Director conversation: big type, the app blurred behind it. Open it from the Co-Director panel header.',
    'Context pops — name a clip in the conversation and its take starts playing in a floating card beside the chat. Say “take 2” to pick that one.',
    'The moodboard — every image and take the conversation touches, scattered like prints on a desk. Click to zoom, mark two to compare.',
    'On the Table · Still to Decide · Changes — the session’s working state floats beside the talk; every Co-Director write becomes a card you can keep or revert.',
    'The writing cloud — while a field is being filled, the text materializes softly behind the chat so you can read along as it lands.',
    'Type while it works — messages sent mid-run queue up and fire in order when the Co-Director frees up.'
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
