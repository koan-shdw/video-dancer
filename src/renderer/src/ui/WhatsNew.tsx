import { Modal } from './Modal'

// ---- What's-New: shown ONCE, on the first launch after an auto-update lands (Settings
// lastRunVersion bump drives it — see the boot effect in App). The list is written by hand per
// release: plain words, only things a user can see and touch. Update BOTH the version and the
// list when cutting a release. ----

export const WHATS_NEW: { version: string; features: string[] } = {
  version: '0.7.2',
  features: [
    'The Co-Director’s hands got finer — keeper takes, per-cut speed / mute / crossfades, duplicating clips and timelines, folders, and @title renames that rewrite every prompt automatically.',
    'It reads the whole cut now — takes, trims, and keepers show in its view of every timeline, and char sheets show all seven character fields.',
    'The writing cloud drifts — while it writes a field, the text floats in at a side of the Director’s Room, lingers, and breathes out. A different side each time.'
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
