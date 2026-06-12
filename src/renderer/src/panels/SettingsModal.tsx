import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { Ic, Settings2 } from '../ui/icons'

const ctl: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  color: 'var(--txt-hi)',
  border: '1px solid var(--line2)',
  borderRadius: 5,
  padding: '7px 9px',
  fontSize: 12,
  fontFamily: 'var(--mono)'
}

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const refreshCredit = useStore((s) => s.refreshCredit)
  const [falKey, setFalKey] = useState('')
  const [falAdminKey, setFalAdminKey] = useState('')
  const [astriaKey, setAstriaKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.vidancer.getSettings().then((s) => {
      setFalKey(s?.falKey ?? '')
      setFalAdminKey(s?.falAdminKey ?? '')
      setAstriaKey(s?.astriaKey ?? '')
      setAnthropicKey(s?.anthropicKey ?? '')
    })
  }, [])

  const save = async (): Promise<void> => {
    await window.vidancer.setSettings({
      falKey: falKey.trim(),
      falAdminKey: falAdminKey.trim(),
      astriaKey: astriaKey.trim(),
      anthropicKey: anthropicKey.trim()
    })
    setStatus('saved ✓')
    void refreshCredit()
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    mb = 12
  ): React.JSX.Element => (
    <label style={{ display: 'block', marginBottom: mb }}>
      <div className="lb" style={{ marginBottom: 4 }}>
        {label} <span style={{ color: 'var(--dim)' }}>— {hint}</span>
      </div>
      <input type="password" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} style={ctl} />
    </label>
  )

  return (
    <Modal title={<><Ic i={Settings2} size={15} /> Settings</>} width={480} onClose={onClose}>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14 }}>
          Keys are stored locally on this machine only (Electron userData) — never in the project folder or repo.
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>
          fal.ai
        </div>
        {field('fal API key', 'video + image generation — Seedance 2, Sora 2, Nano Banana (id:secret)', falKey, setFalKey, 'paste fal key')}
        {field('fal admin key', 'reads your credit balance (account/billing scope)', falAdminKey, setFalAdminKey, 'paste fal admin key', 16)}

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>
          future features — not used yet
        </div>
        {field('Astria API key', 'NOT used by Video Dancer (image gen runs on your fal key)', astriaKey, setAstriaKey, 'paste Astria key')}
        {field('Anthropic API key', 'Claude prompt brain — coming later', anthropicKey, setAnthropicKey, 'paste Anthropic key', 18)}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="btn" onClick={save}>Save</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{status}</span>
        </div>
    </Modal>
  )
}
