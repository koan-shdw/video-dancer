// first-launch window: what API keys the app needs and how to get them. Shows once (welcomeSeen
// in settings); reopenable from the About box. Dismissing it never blocks the app — the amber
// key banner still guards rendering until a fal key is actually saved.
import { Modal } from '../ui/Modal'
import { Ic, Settings2 } from '../ui/icons'

const h: React.CSSProperties = { fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 4px' }
const p: React.CSSProperties = { fontSize: 12, color: 'var(--body)', lineHeight: 1.55, margin: '4px 0' }

export function WelcomeModal({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }): React.JSX.Element {
  const link = (url: string, label: string): React.JSX.Element => (
    <span
      style={{ color: 'var(--amber)', textDecoration: 'underline', cursor: 'pointer' }}
      onClick={() => void window.vidancer.openExternal(url)}
    >
      {label}
    </span>
  )
  return (
    <Modal title="Welcome to Video Dancer" width={520} onClose={onClose}>
      <p style={p}>
        Video Dancer renders AI video on <b>your own</b> {link('https://fal.ai', 'fal.ai')} account. Nothing runs on a shared
        key — you add yours once and every render or image generation bills fal directly at fal&apos;s rates.
      </p>

      <div style={h}>1 · fal API key — required</div>
      <p style={p}>
        Create a key at {link('https://fal.ai/dashboard/keys', 'fal.ai → Settings → Keys')} (it looks like{' '}
        <code style={{ fontFamily: 'var(--mono)', color: 'var(--txt-hi)' }}>id:secret</code>), then paste it in{' '}
        <b>⚙ Settings → fal API key</b> and hit Save. This one key powers video (Seedance 2, Sora 2) and image
        generation (Nano Banana).
      </p>

      <div style={h}>2 · fal admin key — optional</div>
      <p style={p}>
        A second key with the <i>account/billing</i> scope shows your live credit balance in the header. Skip it if you
        don&apos;t care.
      </p>

      <div style={h}>3 · other keys</div>
      <p style={p}>
        The Astria and Anthropic fields in Settings are for upcoming features — nothing uses them yet.
      </p>

      <p style={{ ...p, color: 'var(--dim)', fontSize: 11, marginTop: 12 }}>
        Keys are stored encrypted on this machine only — never in project folders, exports, or any repo.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        {/* onOpenSettings closes this window itself (App owns the close-vs-handoff logic) */}
        <span className="btn" onClick={onOpenSettings}>
          <Ic i={Settings2} size={13} /> Open Settings
        </span>
        <span className="btn" onClick={onClose}>
          Get started
        </span>
      </div>
    </Modal>
  )
}
