import { useEffect, useState } from 'react'
import { vd } from '../api'
import { Modal } from '../ui/Modal'
import { MODELS } from '../shared/models'

type Key = 'falKey' | 'arkKey' | 'astriaKey'
type KeyState = { value: string; saved: boolean; verified: boolean; busy: boolean; error: string }
const empty = (): KeyState => ({ value: '', saved: false, verified: false, busy: false, error: '' })
const suppliers: { provider: string; label: string; key: Key; url: string }[] = [
  { provider: 'fal', label: 'fal.ai', key: 'falKey', url: 'https://fal.ai/dashboard/keys' },
  { provider: 'modelark', label: 'BytePlus ModelArk', key: 'arkKey', url: 'https://console.byteplus.com/ark' },
  { provider: 'astria', label: 'Astria', key: 'astriaKey', url: 'https://www.astria.ai/' }
]
const models = Object.values(MODELS)
const available = suppliers.filter((s) => models.some((m) => (m.provider ?? 'fal') === s.provider))
const bridgeNames = [...new Set(models.filter((m) => m.provider === 'mcp' && m.mcpService !== 'bridge').map((m) => m.mcpService))].filter(Boolean)
const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginTop: 10, background: 'var(--panel)' }

export function WelcomeModal({ onClose, onOpenSettings, onOpenBridge, onOpenModels }: {
  onClose: () => void; onOpenSettings: () => void; onOpenBridge: () => void; onOpenModels: () => void
}): React.JSX.Element {
  const [cloud, setCloud] = useState(false)
  const [keys, setKeys] = useState<Record<Key, KeyState>>({ falKey: empty(), arkKey: empty(), astriaKey: empty() })
  const patch = (key: Key, change: Partial<KeyState>): void => setKeys((prev) => ({ ...prev, [key]: { ...prev[key], ...change } }))
  useEffect(() => {
    let alive = true
    void vd().getSettings().then((s) => {
      if (alive) setKeys((prev) => Object.fromEntries(Object.entries(prev).map(([key, value]) => [key, { ...value, saved: !!s?.[key as Key] }])) as Record<Key, KeyState>)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const save = async (key: Key): Promise<void> => {
    const value = keys[key].value.trim()
    if (!value || keys[key].busy) return
    patch(key, { busy: true, error: '', verified: false })
    try {
      await vd().setSettings({ [key]: value })
      patch(key, { saved: true, value: '' })
      const validate = key === 'arkKey' ? vd().arkValidate : key === 'astriaKey' ? vd().astriaValidate : undefined
      if (validate) {
        const result = await validate(value)
        patch(key, { verified: result.ok, error: result.ok ? '' : result.error ?? 'Key rejected' })
      }
    } catch (e) { patch(key, { error: e instanceof Error ? e.message : String(e) }) }
    finally { patch(key, { busy: false }) }
  }
  return (
    <Modal title="Welcome to Video Dancer" width={560} onClose={onClose}>
      <p style={{ fontSize: 13, lineHeight: 1.5 }}>Start with a storyboard, then generate takes when you are ready. Your project lives on your computer.</p>
      <div style={card}>
        <b>Start a storyboard</b>
        <p>Arrange shots, write beats, and preview your plan. No account or API key required.</p>
        <button type="button" className="btn" onClick={onClose}>Start storyboarding</button>
      </div>
      <div style={card}>
        <b>Connect a cloud supplier</b>
        <p>Use your own subscription login or API key. Generations are billed by the supplier you choose.</p>
        {!!bridgeNames.length && <><p>Bridge logins: {bridgeNames.join(', ')}.</p><button type="button" className="btn" onClick={onOpenBridge}>Open Bridge logins</button>{' '}</>}
        <button type="button" className="btn vd-hbtn" onClick={() => setCloud((v) => !v)} aria-expanded={cloud}>Connect an API key</button>
        {cloud && available.map((s) => {
          const state = keys[s.key]
          return <div key={s.key} style={{ marginTop: 12 }}>
            <label htmlFor={`welcome-${s.key}`}>{s.label} API key</label>{' '}
            <span role="status">{state.busy ? 'Saving…' : state.error ? `Saved: ${state.saved ? 'yes' : 'no'} · ${state.error}` : state.verified ? 'Verified' : state.saved ? 'Saved · not verified' : 'Not set'}</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input id={`welcome-${s.key}`} type="password" autoComplete="off" value={state.value} disabled={state.busy} onChange={(e) => patch(s.key, { value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void save(s.key) }} style={{ flex: 1 }} />
              <button type="button" className="btn" disabled={state.busy || !state.value.trim()} onClick={() => void save(s.key)}>{s.key === 'falKey' ? 'Save key' : 'Save & test'}</button>
              <button type="button" className="btn vd-hbtn" onClick={() => void vd().openExternal(s.url)}>Get a key</button>
            </div>
          </div>
        })}
      </div>
      {models.some((m) => m.provider === 'local') && <div style={card}>
        <b>Render locally</b>
        <p>Set up an engine on a compatible NVIDIA GPU. No cloud rendering key required; model downloads need disk space.</p>
        <button type="button" className="btn" onClick={onOpenModels}>Open local model setup</button>
      </div>}
      <p style={{ fontSize: 12 }}>Keys are kept in this computer’s settings, outside your project files. You can revisit setup from About.</p>
      <button type="button" className="btn vd-hbtn" onClick={onOpenSettings}>All settings</button>
    </Modal>
  )
}
