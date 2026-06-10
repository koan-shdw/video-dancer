import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

const ctl: React.CSSProperties = {
  width: '100%',
  background: '#0e0e12',
  color: '#e8e8ee',
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  return createPortal(
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '92vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: '#141418',
          border: '1px solid var(--line2)',
          borderRadius: 10,
          padding: 18,
          boxShadow: '0 18px 60px rgba(0,0,0,.6)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>⚙ Settings</span>
          <span className="btn" onClick={onClose}>✕</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14 }}>
          Keys are stored locally on this machine only (Electron userData) — never in the project folder or repo.
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>
          fal.ai
        </div>
        {field('fal API key', 'rendering — Seedance 2 (id:secret)', falKey, setFalKey, 'paste fal key')}
        {field('fal admin key', 'reads your credit balance (account/billing scope)', falAdminKey, setFalAdminKey, 'paste fal admin key', 16)}

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>
          later
        </div>
        {field('Astria API key', 'image gen / edit (Nano Banana)', astriaKey, setAstriaKey, 'paste Astria key')}
        {field('Anthropic API key', 'Claude prompt brain', anthropicKey, setAnthropicKey, 'paste Anthropic key', 18)}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="btn" onClick={save}>Save</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{status}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
