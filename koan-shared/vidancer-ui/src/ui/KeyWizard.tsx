import { useEffect, useState } from 'react'
import { vd } from '../api'
import { Modal } from './Modal'
import { openSettingsModal } from '../panelBus'
import { useStore } from '../store'
import type { KeySupplier } from '../lib/keySuppliers'

// ---- The key steps (list 37): a job that needs an API key he hasn't saved opens this instead
// of failing in a toast. Three steps in one card: get the key on their page, paste it, save (the
// supplier's own free check runs where there is one). App mounts <KeyWizard/> once; anything can
// call openKeyWizard — the toast does, for every error that names a missing key. ----

let openFn: ((s: KeySupplier, why: string) => void) | null = null
export function openKeyWizard(supplier: KeySupplier, why: string): boolean {
  if (!openFn) return false
  openFn(supplier, why)
  return true
}

export function KeyWizard(): React.JSX.Element | null {
  const [ask, setAsk] = useState<{ supplier: KeySupplier; why: string } | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<{ ok?: boolean; text: string }>({ text: '' })
  useEffect(() => {
    openFn = (supplier, why) => {
      setAsk({ supplier, why })
      setValue('')
      setBusy(false)
      setState({ text: '' })
    }
    return () => {
      openFn = null
    }
  }, [])
  if (!ask) return null
  const s = ask.supplier
  const close = (): void => setAsk(null)
  const save = async (): Promise<void> => {
    const key = value.trim()
    if (!key || busy) return
    setBusy(true)
    setState({ text: s.test ? 'checking the key…' : 'saving…' })
    try {
      // checked first where the supplier offers a free check: a wrong key is never saved
      const r = s.test ? await s.test(key) : { ok: true }
      if (!r.ok) return setState({ ok: false, text: `that key was refused: ${r.error ?? 'rejected'}` })
      await vd().setSettings({ [s.setting]: key })
      useStore.setState((st) => ({ settingsRev: st.settingsRev + 1 })) // header chips and panels re-read
      setValue('')
      setState({ ok: true, text: s.test ? 'key works and is saved. run it again.' : 'key saved. run it again.' })
    } catch (e) {
      setState({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  const step: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 12 }
  const num: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', width: 14, flex: 'none' }
  return (
    <Modal title={`${s.label} key needed`} width={460} onClose={close}>
      <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--txt)', margin: 0 }}>{ask.why}</p>
      <div style={step}>
        <span style={num}>1</span>
        <span style={{ fontSize: 12 }}>
          <span className="btn vd-hbtn" title={s.where} onClick={() => void vd().openExternal(s.url)}>
            get a key ↗
          </span>
          <span style={{ color: 'var(--dim)', marginLeft: 8 }}>{s.where.replace(/^opens /, '')}</span>
        </span>
      </div>
      <div style={step}>
        <span style={num}>2</span>
        <input
          type="password"
          aria-label={`${s.label} key`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder={s.placeholder}
          spellCheck={false}
          autoFocus
          style={{ flex: 1, minWidth: 0, background: 'var(--field)', color: 'var(--txt-hi)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', fontSize: 12 }}
        />
      </div>
      <div style={step}>
        <span style={num}>3</span>
        <span className="btn vd-hbtn" style={!value.trim() || busy ? { opacity: 0.5, cursor: 'default' } : undefined} onClick={() => void save()} title={s.test ? 'checks the key with one free call, then saves it' : 'saves the key'}>
          save key
        </span>
        {state.text && (
          <span role="status" style={{ fontSize: 11.5, color: state.ok === false ? 'var(--bad)' : state.ok ? 'var(--ok)' : 'var(--dim)' }}>
            {state.text}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <span
          className="btn vd-hbtn"
          title="every supplier and key lives in Settings"
          onClick={() => {
            close()
            openSettingsModal()
          }}
        >
          open settings
        </span>
        <span className="btn vd-hbtn" onClick={close}>
          {state.ok ? 'done' : 'not now'}
        </span>
      </div>
    </Modal>
  )
}
