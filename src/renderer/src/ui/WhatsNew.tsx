import { Modal } from './Modal'

// ---- What's-New: shown ONCE, on the first launch after an auto-update lands (Settings
// lastRunVersion bump drives it — see the boot effect in App). The list is written by hand per
// release: plain words, only things a user can see and touch. Update BOTH the version and the
// list when cutting a release. ----

export const WHATS_NEW: { version: string; features: string[] } = {
  version: '0.7.1',
  features: [
    'The Co-Director builds everything now — char sheets, new timelines, whole cuts (clips in order, takes, trims), renames and deletes. Same access you have, every write undoable and shown as a keep/revert card.',
    'It sees your timelines — ask about the cut and it knows exactly what’s on it, take numbers included.',
    'What stays yours: renders, image generation, and file imports — anything that spends money or needs a picker. It proposes; you fire.'
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
