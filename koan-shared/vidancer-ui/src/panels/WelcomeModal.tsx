import { vd } from '../api'
// first-launch walkthrough: what an API key is, which suppliers exist, and a paste-and-test box
// per card so a fresh user is rendering in one sitting. Shows once (welcomeSeen); reopenable from
// the About box. Skippable — the amber key banner still guards rendering until a key exists.
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Ic, Settings2 } from '../ui/icons'

const p: React.CSSProperties = { fontSize: 12, color: 'var(--body)', lineHeight: 1.55, margin: '4px 0' }
const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 6, padding: '10px 12px', marginTop: 10, background: 'var(--panel)' }

type KeyState = { value: string; saved: boolean; status: string }

export function WelcomeModal({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }): React.JSX.Element {
  const [fal, setFal] = useState<KeyState>({ value: '', saved: false, status: '' })
  const [ark, setArk] = useState<KeyState>({ value: '', saved: false, status: '' })
  const [hf, setHf] = useState<KeyState>({ value: '', saved: false, status: '' })

  useEffect(() => {
    void vd().getSettings().then((s) => {
      setFal((x) => ({ ...x, saved: !!s?.falKey }))
      setArk((x) => ({ ...x, saved: !!s?.arkKey }))
      setHf((x) => ({ ...x, saved: !!s?.hfKey }))
    })
  }, [])

  const link = (url: string, label: string): React.JSX.Element => (
    <span style={{ color: 'var(--amber)', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => void vd().openExternal(url)}>
      {label}
    </span>
  )
  const chip = (saved: boolean): React.JSX.Element => (
    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: saved ? 'var(--ok)' : 'var(--dim)' }}>
      {saved ? '● connected' : '○ not set'}
    </span>
  )
  // save the key, then run the supplier's free validation where one exists
  const saveKey = async (
    settingsKey: 'falKey' | 'arkKey' | 'hfKey',
    st: KeyState,
    set: (fn: (x: KeyState) => KeyState) => void,
    validate?: (k: string) => Promise<{ ok: boolean; error?: string }>
  ): Promise<void> => {
    const k = st.value.trim()
    if (!k) return set((x) => ({ ...x, status: 'paste a key first' }))
    set((x) => ({ ...x, status: 'saving…' }))
    await vd().setSettings({ [settingsKey]: k })
    if (validate) {
      set((x) => ({ ...x, status: 'testing…' }))
      const r = await validate(k)
      set((x) => ({ ...x, saved: true, value: '', status: r.ok ? 'saved & key works ✓' : `saved · ✕ ${r.error ?? 'key rejected'}` }))
    } else {
      set((x) => ({ ...x, saved: true, value: '', status: 'saved ✓' }))
    }
  }
  const keyRow = (
    st: KeyState,
    set: (fn: (x: KeyState) => KeyState) => void,
    placeholder: string,
    onSave: () => void
  ): React.JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <input
        type="password"
        value={st.value}
        onChange={(e) => set((x) => ({ ...x, value: e.target.value }))}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
        placeholder={st.saved ? 'key saved — paste to replace' : placeholder}
        spellCheck={false}
        style={{ flex: 1, background: 'var(--field)', color: 'var(--txt-hi)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', fontFamily: 'var(--mono)', fontSize: 11 }}
      />
      <span className="btn vd-hbtn" onClick={onSave}>save & test</span>
      {st.status && <span style={{ fontSize: 10, color: st.status.includes('✕') ? 'var(--bad)' : 'var(--muted)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={st.status}>{st.status}</span>}
    </div>
  )

  return (
    <Modal title="Welcome to Video Dancer" width={560} onClose={onClose}>
      <p style={p}>
        Video Dancer generates video through AI platforms — think of them as <b>render farms you pay directly</b>.
        An <b>API key</b> is just a password that lets the app use <i>your</i> account there: you sign up on their
        site, copy the key, paste it here. No middleman, no markup — their prices, your money, your work.
      </p>
      <p style={{ ...p, color: 'var(--muted)' }}>One connected supplier is enough to start. You can add the others any time in ⚙ Settings.</p>

      {/* fal — the recommended everything-supplier */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 12.5, color: 'var(--txt-hi)' }}>fal.ai</b>
          <span style={{ fontSize: 10, color: 'var(--amber)', border: '1px solid var(--amber-dim)', borderRadius: 4, padding: '0 5px' }}>recommended</span>
          {chip(fal.saved)}
        </div>
        <p style={p}>
          The one key that powers <b>everything</b>: Seedance 2 with video/audio refs, Seedance 2.5 (early access),
          Sora 2, Omni video edits, and image generation. Pay-per-use in dollars (roughly $0.14–0.68 per second of
          video depending on resolution) — top up credit, render, done.
        </p>
        <p style={{ ...p, fontSize: 11, color: 'var(--muted)' }}>
          {link('https://fal.ai/dashboard/keys', '1 · create a key at fal.ai → Keys')} (looks like <code style={{ fontFamily: 'var(--mono)' }}>id:secret</code>) ·{' '}
          {link('https://fal.ai/dashboard/billing', '2 · add a few dollars of credit')} · 3 · paste it below
        </p>
        {keyRow(fal, setFal, 'paste fal key (id:secret)', () => void saveKey('falKey', fal, setFal))}
      </div>

      {/* ModelArk — official ByteDance */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 12.5, color: 'var(--txt-hi)' }}>BytePlus ModelArk</b>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>Seedance direct from ByteDance</span>
          {chip(ark.saved)}
        </div>
        <p style={p}>
          The official source. Seedance 2 with image + audio refs, 4K in 10-bit, billed as BytePlus tokens.
          <b> One rule of theirs:</b> reference images must not contain real human faces — for footage of real
          people, use fal. Signup is more corporate (account → activate the model → key), five minutes.
        </p>
        <p style={{ ...p, fontSize: 11, color: 'var(--muted)' }}>
          {link('https://console.byteplus.com/ark', '1 · console.byteplus.com → ModelArk')} · 2 · activate Seedance ·{' '}
          3 · create an API key · 4 · paste it below
        </p>
        {keyRow(ark, setArk, 'paste ModelArk API key', () => void saveKey('arkKey', ark, setArk, (k) => vd().arkValidate(k)))}
      </div>

      {/* Higgsfield — parked but connectable */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 12.5, color: 'var(--txt-hi)' }}>Higgsfield</b>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>subscription credits — waiting on their API</span>
          {chip(hf.saved)}
        </div>
        <p style={p}>
          Bills against a Higgsfield subscription instead of per-render dollars. Honest status: their developer API
          <b> doesn&apos;t serve Seedance yet</b> — connect it now if you have an account, and the engine will light up
          here the day they ship it.
        </p>
        <p style={{ ...p, fontSize: 11, color: 'var(--muted)' }}>
          {link('https://cloud.higgsfield.ai/', '1 · cloud.higgsfield.ai → API keys')} (needs their Creator plan) · 2 · paste{' '}
          <code style={{ fontFamily: 'var(--mono)' }}>api-key:api-secret</code> below
        </p>
        {keyRow(hf, setHf, 'paste api-key:api-secret', () => void saveKey('hfKey', hf, setHf, (k) => vd().hfValidate(k)))}
      </div>

      <p style={{ ...p, color: 'var(--dim)', fontSize: 11, marginTop: 12 }}>
        A fourth supplier — <b>Astria</b> (Seedance 2 on plan credits, t2v + first/last-frame) — connects in
        Settings → api suppliers. Keys are stored encrypted on this machine only — never in project folders,
        exports, or any repo. The Co-Director copilot takes an optional Anthropic key in Settings when you want it.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        {/* onOpenSettings closes this window itself (App owns the close-vs-handoff logic) */}
        <span className="btn" onClick={onOpenSettings}>
          <Ic i={Settings2} size={13} /> Open Settings
        </span>
        <span className="btn" onClick={onClose} title="you can come back any time from the About box">
          {fal.saved || ark.saved || hf.saved ? 'Get started' : 'skip for now'}
        </span>
      </div>
    </Modal>
  )
}
