import { useEffect, useState } from 'react'
import './Connections.css'
import { vd } from '../api'
import { useStore } from '../store'
import { confirmDialog } from '../prompt'
import { openSettingsModal, openBridgePanel, openSetupWizard } from '../panelBus'
import { KEY_SUPPLIERS, keySupplier, type KeySupplier } from '../lib/keySuppliers'
import { useConnections, useConnectionSync, refreshConnections, saveConnectionSettings, accountAction, setKeyCheck, connectionReady } from '../lib/connections'
import { CLI_NAMES, CODIR_EFFORTS, codirEngineRow, cliVersionLess, takesEffort, type CodirCli, type CodirEngineId } from '../shared/models'

const failure = (e: unknown): string => e instanceof Error ? e.message : String(e)
export function KeyConnection({ supplier, onSaved }: { supplier: KeySupplier; onSaved?: () => void }): React.JSX.Element {
  const saved = useConnections(s => s.settings?.[supplier.setting]) as string | undefined
  const check = useConnections(s => s.checks[supplier.setting])
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const test = async (key: string, record: boolean): Promise<boolean> => {
    if (!supplier.test) return true
    if (record) setKeyCheck(supplier.setting, { state: 'checking', text: 'Checking…' })
    const result = await supplier.test(key)
    if (record) setKeyCheck(supplier.setting, { state: result.ok ? 'verified' : 'failed', text: result.ok ? 'Verified' : result.error || 'Check failed' })
    if (!result.ok) setError(result.error || 'The provider refused this key.')
    return result.ok
  }
  const run = async (action: 'save' | 'check' | 'remove'): Promise<void> => {
    if (busy) return
    if (action === 'save' && !value.trim()) return
    if (action === 'remove' && !await confirmDialog(`Remove the saved ${supplier.label} API key?`, { confirmLabel: 'Remove', danger: true })) return
    setBusy(true); setError('')
    try {
      if (action === 'check') await test(saved ?? '', true)
      else if (action === 'remove') { await saveConnectionSettings({ [supplier.setting]: '' }); setKeyCheck(supplier.setting); setValue(''); setEditing(false); onSaved?.() }
      else {
        const key = value.trim()
        if (supplier.test && !await test(key, false)) return
        await saveConnectionSettings({ [supplier.setting]: key })
        setKeyCheck(supplier.setting, supplier.test ? { state: 'verified', text: 'Verified' } : undefined)
        setValue(''); setEditing(false); onSaved?.()
      }
      void useStore.getState().refreshCredit()
    } catch (e) { setError(failure(e)); if (action === 'check') setKeyCheck(supplier.setting, { state: 'failed', text: 'Could not finish the key check.' }) }
    finally { setBusy(false) }
  }
  return <div className="vd-connection-method" data-key-connection={supplier.id}>
    <div className="vd-connection-line"><div>API key<div className="vd-connection-hint" role="status">{saved ? check?.text || 'Saved · not checked' : 'Not added'}</div></div>
      <div className="vd-connection-actions">{saved && <>{supplier.test && <button type="button" disabled={busy} onClick={() => void run('check')}>Check</button>}<button type="button" disabled={busy} onClick={() => setEditing(true)}>Replace</button><button type="button" disabled={busy} onClick={() => void run('remove')}>Remove</button></>}</div></div>
    {(!saved || editing) && <div className="vd-connection-key"><label>{supplier.label} API key<input type="password" aria-label={`${supplier.label} API key`} autoComplete="off" spellCheck={false} value={value} disabled={busy} placeholder={supplier.placeholder} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void run('save') } }} /></label>
      <div className="vd-connection-actions"><button type="button" className="primary" disabled={busy || !value.trim()} onClick={() => void run('save')}>{busy ? 'Saving…' : supplier.test ? 'Check and save' : 'Save key'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(false); setValue(''); setError('') }}>Cancel</button>}<button type="button" onClick={() => void vd().openExternal(supplier.url)}>Get a key ↗</button></div></div>}
    {error && <div role="alert" className="vd-connection-error">{error}</div>}
  </div>
}

export function AccountConnection({ cli, compact = false }: { cli: CodirCli; compact?: boolean }): React.JSX.Element {
  const { info, busy, settings } = useConnections()
  const running = useStore(s => s.codirRun.busy)
  const data = info[cli], selected = codirEngineRow(settings?.codirEngine).cli === cli
  const account = CLI_NAMES[cli].account, engine = cli === 'claude' ? 'bridge' : cli
  return <div className="vd-connection-method" data-account-connection={cli}>
    <div className="vd-connection-line"><div>{compact ? cli === 'claude' ? 'Anthropic' : cli === 'codex' ? 'OpenAI' : 'Google' : `${account} account`}
      <div className="vd-connection-hint" role="status">{busy === cli ? 'Finish signing in in your browser…' : !data ? 'Checking…' : !data.found ? `${CLI_NAMES[cli].tool} is required` : data.loggedIn === true ? `${data.account || account} · Logged in` : data.loggedIn === false ? 'Not logged in to Video Dancer' : 'Login status unavailable · check again'}</div></div>
      <div className="vd-connection-actions">
        {selected && <span className="vd-connection-pill">{data?.loggedIn ? 'In use' : 'Selected'}</span>}
        {data?.loggedIn && !selected && <button type="button" disabled={!!busy || running} onClick={() => void saveConnectionSettings({ codirEngine: engine }).catch(e => useConnections.setState({ error: failure(e) }))}>Use for Co-Director</button>}
        {busy === cli ? <button type="button" onClick={() => void vd().codirCancelLogin(cli)}>Cancel login</button> : data?.loggedIn ? <>
          {!compact && cli !== 'gemini' && <button type="button" disabled={!!busy || running} onClick={() => void accountAction(cli, 'switch')}>Switch account</button>}
          {cli !== 'gemini' && <button type="button" disabled={!!busy || running} onClick={() => void accountAction(cli, 'logout')}>Log out</button>}
        </> : <button type="button" className="primary" disabled={!!busy || running || !data?.found} onClick={() => void accountAction(cli, 'login')}>Log in{compact ? '' : ` with ${account}`}</button>}
        {!compact && <button type="button" disabled={!!busy} onClick={() => void refreshConnections(true)}>Check</button>}
      </div></div>
    {!compact && data && !data.found && <div className="vd-connection-hint">Install {CLI_NAMES[cli].tool}: <code>{CLI_NAMES[cli].install}</code>, then check again.</div>}
  </div>
}

export function ConnectionModels(): React.JSX.Element {
  const { settings, models, info } = useConnections()
  const engine = codirEngineRow(settings?.codirEngine), list = models[engine.id] ?? []
  const model = list.find(m => m.id === settings?.[engine.modelSetting]) ?? list[0]
  const efforts: readonly string[] = model?.efforts?.length ? model.efforts.filter(e => (CODIR_EFFORTS as readonly string[]).includes(e)) : CODIR_EFFORTS
  const effort = efforts.includes(settings?.codirEffort ?? '') ? settings?.codirEffort : ''
  const disabled = !takesEffort(model?.id ?? '')
  const save = (patch: Record<string, unknown>): void => { void saveConnectionSettings(patch).catch(e => useConnections.setState({ error: failure(e) })) }
  const need = engine.id === 'bridge' ? model?.minCli : undefined, have = info.claude?.version?.match(/\d+\.\d+\.\d+/)?.[0]
  return <><div className="vd-connection-models"><label>Model<select aria-label="Co-Director model" value={model?.id ?? ''} disabled={!list.length} onChange={e => { const next = list.find(m => m.id === e.target.value); save({ [engine.modelSetting]: e.target.value, ...(next?.efforts?.length && settings?.codirEffort && !next.efforts.includes(settings.codirEffort) ? { codirEffort: '' } : {}) }) }}>{list.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <label>Thinking<select aria-label="Co-Director thinking" disabled={disabled} value={disabled ? '' : effort} onChange={e => save({ codirEffort: e.target.value })}><option value="">Auto</option>{efforts.map(e => <option key={e}>{e}</option>)}</select></label></div>
    <div className="vd-connection-hint">{engine.cli ? 'Account plan and limits apply.' : 'Usage is billed to the selected API account.'}{engine.id === 'openai' || engine.id === 'deepseek' ? ' Web research is unavailable on this API connection.' : ''}</div>
    {need && have && cliVersionLess(have, need) && <div className="vd-connection-error">This model needs Claude Code {need} or newer. <button type="button" onClick={() => void useStore.getState().updateClaudeCode().then(() => refreshConnections(true))}>Update Claude Code</button></div>}
  </>
}

export function LlmConnections({ expandable = false, onManage = openSettingsModal }: { expandable?: boolean; onManage?: () => void }): React.JSX.Element {
  useConnectionSync()
  const [open, setOpen] = useState(false)
  const { settings, models, error } = useConnections()
  const engine = codirEngineRow(settings?.codirEngine)
  const list = models[engine.id] ?? [], model = list.find(m => m.id === settings?.[engine.modelSetting]) ?? list[0]
  return <div className="vd-connections" data-llm-connections>
    {expandable && <button type="button" className="vd-llm-summary" aria-expanded={open} onClick={() => setOpen(!open)}><span>{engine.label} · {model?.label.split(' — ')[0] || 'Checking…'}{settings?.codirEffort ? ` · ${settings.codirEffort}` : ''}</span><span>LLM {open ? '▴' : '▾'}</span></button>}
    {(!expandable || open) && <div className="vd-connection-stack"><AccountConnection cli="codex" compact /><AccountConnection cli="claude" compact /><ConnectionModels /><button type="button" onClick={onManage}>Manage connections & API keys</button>{settings && !connectionReady() && <div role="status" className="vd-connection-hint">Reconnect the selected account or choose another connection to continue.</div>}</div>}
    {error && <div role="alert" className="vd-connection-error">{error}</div>}
  </div>
}

function BalanceCredentials({ id }: { id: 'fal' | 'ark' }): React.JSX.Element {
  const settings = useConnections(s => s.settings)
  const [open, setOpen] = useState(false), [first, setFirst] = useState(''), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const saved = !!(id === 'fal' ? settings?.falAdminKey : settings?.byteplusAccessKeyId && settings?.byteplusSecretKey)
  const save = async (remove = false): Promise<void> => {
    setBusy(true); setMessage('')
    try {
      if (id === 'ark' && !remove) { const r = await vd().arkSpendCheck(first.trim(), secret.trim()); if (!r.ok) throw Error(r.error || 'Credentials refused.') }
      await saveConnectionSettings(id === 'fal' ? { falAdminKey: remove ? '' : first.trim() } : { byteplusAccessKeyId: remove ? '' : first.trim(), byteplusSecretKey: remove ? '' : secret.trim() })
      setFirst(''); setSecret(''); setOpen(false); setMessage(remove ? 'Removed' : 'Saved'); void useStore.getState().refreshCredit()
    } catch (e) { setMessage(failure(e)) } finally { setBusy(false) }
  }
  return <div className="vd-connection-method"><div className="vd-connection-line"><div>Balance access <span className="vd-connection-hint">· optional</span><div className="vd-connection-hint">{saved ? 'Credentials saved' : 'Not added'}</div></div><div className="vd-connection-actions"><button type="button" onClick={() => setOpen(!open)}>{open ? 'Cancel' : saved ? 'Replace' : 'Add credentials'}</button>{saved && <button type="button" disabled={busy} onClick={() => void save(true)}>Remove</button>}</div></div>
    {open && <div className="vd-connection-key"><label>{id === 'fal' ? 'fal admin key' : 'BytePlus Access Key ID'}<input aria-label={id === 'fal' ? 'fal admin key' : 'BytePlus Access Key ID'} type="password" value={first} onChange={e => setFirst(e.target.value)} autoComplete="off" /></label>{id === 'ark' && <label>Secret Access Key<input type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="off" /></label>}<div className="vd-connection-actions"><button type="button" disabled={busy || !first.trim() || (id === 'ark' && !secret.trim())} onClick={() => void save()}>{busy ? 'Checking…' : id === 'ark' ? 'Check and save' : 'Save'}</button><button type="button" onClick={() => void vd().openExternal(id === 'fal' ? 'https://fal.ai/dashboard/keys' : 'https://docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey')}>Get credentials ↗</button></div></div>}
    {message && <div className="vd-connection-hint" role="status">{message}</div>}
  </div>
}

export function ConnectionsSettings({ provider = '' }: { provider?: string }): React.JSX.Element {
  useConnectionSync()
  const { settings, info, error } = useConnections()
  const [group, setGroup] = useState(provider && !['openai', 'anthropic'].includes(provider) ? 'media' : 'llm'), [selected, setSelected] = useState(provider), [expanded, setExpanded] = useState(provider)
  const [rows, setRows] = useState<BridgeRow[]>([]), [bridgeError, setBridgeError] = useState('')
  useEffect(() => { let live = true; const pull = (): void => { void vd().bridgeList().then(r => { if (live) setRows(r ?? []) }).catch(e => { if (live) setBridgeError(failure(e)) }) }; pull(); const off = vd().onBridgeChanged(pull); return () => { live = false; off?.() } }, [])
  const media = KEY_SUPPLIERS.filter(s => !['openai', 'anthropic'].includes(s.id))
  const providers = [...media.map(s => ({ id: s.id, name: s.label, supplier: s, bridge: s.id === 'eleven' ? 'elevenlabs' : s.id })), ...['magnific','artlist','runway','pika'].map(id => ({ id, name: rows.find(r => r.id === id)?.service || id[0].toUpperCase() + id.slice(1), supplier: undefined, bridge: id }))]
  const visible = group === 'llm' ? ['openai', 'anthropic'].map(id => ({ id, name: keySupplier(id as 'openai' | 'anthropic').label, supplier: keySupplier(id as 'openai' | 'anthropic'), bridge: '' })) : providers.filter(p => p.id === selected || !!(p.supplier && settings?.[p.supplier.setting]) || rows.some(r => r.id === p.bridge && r.loggedIn))
  const bridgeAction = async (r: BridgeRow): Promise<void> => { try { setBridgeError(''); setRows(await (r.loggedIn ? vd().bridgeLogout(r.id, r.slot) : vd().bridgeLogin(r.id, r.slot))) } catch (e) { setBridgeError(failure(e)) } }
  return <div className="vd-connections"><h2>Connections</h2><p className="vd-connection-hint">Manage provider accounts and API keys.</p><div className="vd-settings-tabs"><button type="button" aria-pressed={group === 'llm'} onClick={() => { setGroup('llm'); setExpanded('') }}>LLM</button><button type="button" aria-pressed={group === 'media'} onClick={() => { setGroup('media'); setExpanded('') }}>Media & other services</button></div>
    {group === 'media' && <label>Provider<select aria-label="Connection provider" value={selected} onChange={e => { setSelected(e.target.value); setExpanded(e.target.value) }}><option value="">Choose a provider…</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <div className="vd-connection-stack">{visible.map(p => {
      const cli = p.id === 'openai' ? 'codex' : p.id === 'anthropic' ? 'claude' : undefined
      const accounts = rows.filter(r => r.id === p.bridge && r.auth !== 'key'), logged = cli ? info[cli]?.loggedIn : accounts.some(r => r.loggedIn)
      const key = !!(p.supplier && settings?.[p.supplier.setting]), engine: CodirEngineId | undefined = p.id === 'openai' ? 'openai' : p.id === 'anthropic' ? 'api' : p.id === 'deepseek' ? 'deepseek' : p.id === 'venice' ? 'venice' : undefined
      return <article className="vd-provider-card" data-provider={p.id} key={p.id}><div className="vd-connection-line"><div><strong>{p.name}</strong><div className="vd-connection-hint">{logged ? '● Logged in' : key ? '○ API key saved' : '○ Not connected'}</div></div><button type="button" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? '' : p.id)}>{expanded === p.id ? 'Close ▴' : 'Manage ▾'}</button></div>
        {expanded === p.id && <div className="vd-provider-details">{cli && <AccountConnection cli={cli} />}
          {accounts.map(r => <div className="vd-connection-method" key={r.key}><div className="vd-connection-line"><div>{r.label}<div className="vd-connection-hint">{r.busy ? 'Waiting for provider…' : r.blocked || (r.loggedIn ? `Logged in${r.balance === undefined ? '' : ` · ${r.balance} ${r.creditUnit}`}` : 'Not connected')}</div></div><button type="button" disabled={r.busy || !!r.blocked} onClick={() => void bridgeAction(r)}>{r.loggedIn ? 'Log out' : 'Log in'}</button></div>{r.error && <div role="alert" className="vd-connection-error">{r.error}</div>}</div>)}
          {!!accounts.length && <button type="button" onClick={openBridgePanel}>Manage accounts in Bridge</button>}
          {p.supplier && <KeyConnection supplier={p.supplier} />}
          {engine && <button type="button" disabled={!key || settings?.codirEngine === engine} onClick={() => void saveConnectionSettings({ codirEngine: engine }).catch(e => useConnections.setState({ error: failure(e) }))}>{settings?.codirEngine === engine ? 'API key in use' : 'Use API key for Co-Director'}</button>}
          {(p.id === 'fal' || p.id === 'ark') && <BalanceCredentials id={p.id} />}
          {cli && <p className="vd-connection-hint">Account login and API key are separate connections.</p>}
        </div>}</article>
    })}</div>
    {(error || bridgeError) && <div role="alert" className="vd-connection-error">{error || bridgeError}</div>}
    <div className="vd-connection-line vd-settings-section"><span className="vd-connection-hint">Credentials stay on this computer.</span><button type="button" data-setup-open onClick={openSetupWizard}>Setup wizard</button></div>
  </div>
}
