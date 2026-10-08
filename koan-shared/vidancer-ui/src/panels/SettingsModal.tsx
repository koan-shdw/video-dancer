import { useEffect, useRef, useState } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { Ic, Settings2 } from '../ui/icons'
import { confirmDialog, textPrompt } from '../prompt'
import { toast } from '../ui/Toast'
import { ConnectionsSettings, LlmConnections, AccountConnection } from '../components/Connections'
import { useConnections, useConnectionSync, saveConnectionSettings, refreshConnections } from '../lib/connections'
import { CODIR_ENGINES, CLI_NAMES, codirEngineRow, type CodirCli } from '../shared/models'
import { THEME_VARS, PRESET_THEMES, OG_THEME, THEME_RENAMES, applyTheme, resolveTheme, currentColor, type ThemeMap } from '../lib/themes'
import { DEFAULT_WATCH_MODEL, WATCH_MODELS } from '../shared/watch'
import { openProjectControls } from '../panelBus'

type Page = 'connections' | 'codir' | 'watch' | 'appearance' | 'general'
const pages: [Page, string][] = [['connections','Connections'], ['codir','Co-Director'], ['watch','Watch'], ['appearance','Appearance'], ['general','General']]
const report = (e: unknown): void => toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
const save = (patch: Record<string, unknown>): void => { void saveConnectionSettings(patch).catch(report) }

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  useConnectionSync()
  const [page, setPage] = useState<Page>('connections')
  const [provider, setProvider] = useState('')
  const settings = useConnections(s => s.settings)
  const connections = (id = ''): void => { setProvider(id); setPage('connections') }
  return <Modal title={<><Ic i={Settings2} size={15} /> Settings</>} width={900} onClose={onClose}>
    <div className="vd-settings vd-connections"><div className="vd-settings-layout"><nav className="vd-settings-nav" aria-label="Settings pages">{pages.map(([id, label]) => <button type="button" key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>{label}</button>)}</nav>
      <main className="vd-settings-content">{!settings ? <p role="status">Loading settings…</p> : page === 'connections' ? <ConnectionsSettings key={provider} provider={provider} /> : page === 'codir' ? <CoDirectorSettings onConnections={() => connections()} /> : page === 'watch' ? <WatchSettings onConnections={() => connections('google')} /> : page === 'appearance' ? <AppearanceSettings /> : <GeneralSettings onProject={() => { onClose(); openProjectControls() }} />}</main></div>
      <footer className="vd-settings-footer">Choices apply to the next use. Save API keys with their connection controls.</footer>
    </div>
  </Modal>
}

function CoDirectorSettings({ onConnections }: { onConnections: () => void }): React.JSX.Element {
  const [tab, setTab] = useState('connection')
  const { settings, info } = useConnections()
  const [guides, setGuides] = useState<Awaited<ReturnType<VidancerApi['codirGuides']>>>([])
  const refreshGuides = (): void => { void vd().codirGuides().then(setGuides).catch(report) }
  useEffect(refreshGuides, [])
  const toggle = async (id: string, on: boolean): Promise<void> => {
    try { await saveConnectionSettings({ codirGuideLoad: Object.fromEntries(guides.filter(g => g.id !== 'codirector').map(g => [g.id, g.id === id ? on : g.loaded])) }); refreshGuides() } catch (e) { report(e) }
  }
  const guideAction = async (id: string, action: 'edit' | 'revert' | 'purge'): Promise<void> => {
    try {
      if (action === 'edit') await vd().codirGuideOpen(id)
      else if (action === 'revert') { if (!await confirmDialog('Discard this customised guide and restore its default?', { confirmLabel: 'Revert', danger: true })) return; await vd().codirGuideRevert(id) }
      else { if (!await confirmDialog('Clear all learned instructions the Co-Director has saved?', { confirmLabel: 'Clear', danger: true })) return; await vd().codirGuidePurgeLearned() }
      refreshGuides()
    } catch (e) { report(e) }
  }
  return <><h2>Co-Director</h2><p className="vd-connection-hint">Choose what runs the next exchange.</p><div className="vd-settings-tabs"><button type="button" aria-pressed={tab === 'connection'} onClick={() => setTab('connection')}>Connection & model</button><button type="button" aria-pressed={tab === 'instructions'} onClick={() => setTab('instructions')}>Instructions & context</button></div>
    {tab === 'connection' ? <><div className="vd-settings-section"><h3>Active connection</h3><div className="vd-connection-hint">{codirEngineRow(settings?.codirEngine).label}</div><LlmConnections onManage={onConnections} /></div>
      <details className="vd-settings-section"><summary>Other existing Co-Director providers</summary><label>Connection<select aria-label="Other Co-Director connection" value={['venice','deepseek','gemini'].includes(settings?.codirEngine ?? '') ? settings?.codirEngine : ''} onChange={e => { if (e.target.value) save({ codirEngine: e.target.value }) }}><option value="">Choose a connection…</option>{CODIR_ENGINES.filter(e => ['venice','deepseek','gemini'].includes(e.id)).map(e => <option key={e.id} value={e.id} disabled={e.key ? !settings?.[e.key] : !info.gemini?.loggedIn}>{e.label}</option>)}</select></label><AccountConnection cli="gemini" /><button type="button" onClick={onConnections}>Manage API keys</button></details>
      <details className="vd-settings-section"><summary>Troubleshooting</summary>{(['claude','codex','gemini'] as CodirCli[]).map(cli => <div key={cli} className="vd-connection-method"><div>{CLI_NAMES[cli].tool}</div><div className="vd-connection-hint">{info[cli]?.detail || 'Checking…'}</div>{!info[cli]?.found && <code>{CLI_NAMES[cli].install}</code>}</div>)}<div className="vd-connection-actions"><button type="button" onClick={() => void refreshConnections(true)}>Re-check</button><button type="button" disabled={!info.claude?.found} onClick={() => void useStore.getState().updateClaudeCode().then(() => refreshConnections(true))}>Update Claude Code</button></div></details></>
      : <><div className="vd-settings-section"><label className="vd-settings-check"><input type="checkbox" checked={settings?.codirRlm !== false} onChange={e => save({ codirRlm: e.target.checked })} /><span>RLM context<span className="vd-connection-hint">Read project state on demand. Off sends the full snapshot each exchange.</span></span></label></div>
        <div className="vd-settings-section"><h3>Guide files</h3><p className="vd-connection-hint">Included files accompany each exchange. Editing creates a personal copy.</p>{guides.map(g => <div key={g.id} className="vd-settings-guide"><label className="vd-settings-check"><input type="checkbox" checked={g.loaded} disabled={g.id === 'codirector'} onChange={e => void toggle(g.id, e.target.checked)} /><span>{g.label}<span className="vd-connection-hint">{g.id === 'codirector' ? 'Always included' : g.customised ? 'Customised' : 'Default'}</span></span></label><div className="vd-connection-actions">{g.customised && <button type="button" onClick={() => void guideAction(g.id, 'revert')}>Revert</button>}<button type="button" onClick={() => void guideAction(g.id, 'edit')}>Edit</button></div>{g.id === 'codirector' && g.hasLearned && <button type="button" onClick={() => void guideAction(g.id, 'purge')}>Clear learned instructions</button>}</div>)}</div></>}
  </>
}

function WatchSettings({ onConnections }: { onConnections: () => void }): React.JSX.Element {
  const settings = useConnections(s => s.settings)
  const [model, setModel] = useState(settings?.googleWatchModel || DEFAULT_WATCH_MODEL), [message, setMessage] = useState('')
  const apply = async (): Promise<void> => {
    const next = model.trim().replace(/^models\//, '') || DEFAULT_WATCH_MODEL
    if (!/^[a-zA-Z0-9._-]+$/.test(next)) { setMessage('Enter a valid Gemini model ID.'); return }
    try { await saveConnectionSettings({ googleWatchModel: next === DEFAULT_WATCH_MODEL ? '' : next }); setModel(next); setMessage('Watch model saved.') } catch (e) { report(e) }
  }
  return <><h2>Watch</h2><p className="vd-connection-hint">Media understanding for takes, timeline watching, and Score compose.</p><div className="vd-settings-section"><div className="vd-connection-line"><div>Google AI<div className="vd-connection-hint">{settings?.googleKey ? 'API key saved' : 'No API key'}</div></div><button type="button" onClick={onConnections}>Manage connection</button></div><label>Watch model<input aria-label="Watch model" value={model} onChange={e => setModel(e.target.value)} /></label><div className="vd-connection-actions"><button type="button" className="primary" onClick={() => void apply()}>Apply model</button></div><div className="vd-connection-hint">Default: {DEFAULT_WATCH_MODEL}. Also supported: {WATCH_MODELS.slice(1).join(', ')}.</div><div role="status">{message}</div></div><div className="vd-settings-section"><h3>Fallback</h3><p className="vd-connection-hint">When Google is unavailable, the selected Co-Director connection can read still frames. Motion and sound are unavailable in that fallback.</p></div></>
}

function AppearanceSettings(): React.JSX.Element {
  const settings = useConnections(s => s.settings)
  const theme = THEME_RENAMES[settings?.activeTheme ?? ''] ?? settings?.activeTheme ?? OG_THEME
  const custom = (settings?.customThemes ?? {}) as Record<string, ThemeMap>
  const [draft, setDraft] = useState<ThemeMap | null>(null)
  const previewing = useRef(false), savedTheme = useRef({ theme, custom })
  savedTheme.current = { theme, custom }
  useEffect(() => () => { if (previewing.current) applyTheme(resolveTheme(savedTheme.current.theme, savedTheme.current.custom)) }, [])
  const stopPreview = (): void => { applyTheme(resolveTheme(theme, custom)); previewing.current = false; setDraft(null) }
  const pick = async (name: string): Promise<void> => { try { await saveConnectionSettings({ activeTheme: name }); previewing.current = false; setDraft(null); applyTheme(resolveTheme(name, custom)) } catch (e) { report(e) } }
  const saveTheme = async (): Promise<void> => {
    const name = (await textPrompt('Save theme as', 'My theme'))?.trim()
    if (!name || !draft) return
    if (PRESET_THEMES[name]) { toast('Choose a name other than a built-in theme.', { kind: 'error' }); return }
    try { await saveConnectionSettings({ customThemes: { ...custom, [name]: draft }, activeTheme: name }); previewing.current = false; setDraft(null) } catch (e) { report(e) }
  }
  const remove = async (): Promise<void> => {
    if (!await confirmDialog(`Delete the theme "${theme}"?`, { confirmLabel: 'Delete', danger: true })) return
    const next = { ...custom }; delete next[theme]
    try { await saveConnectionSettings({ customThemes: next, activeTheme: OG_THEME }); applyTheme(resolveTheme(OG_THEME, next)) } catch (e) { report(e) }
  }
  return <><h2>Appearance</h2><p className="vd-connection-hint">Theme and readability.</p><div className="vd-settings-section"><label>Theme<select aria-label="Theme" value={theme} onChange={e => void pick(e.target.value)}>{[...Object.keys(PRESET_THEMES), ...Object.keys(custom)].map(n => <option key={n}>{n}</option>)}</select></label><div className="vd-connection-actions">{draft ? <button type="button" onClick={stopPreview}>Revert preview</button> : <button type="button" onClick={() => { previewing.current = true; setDraft(Object.fromEntries(THEME_VARS.map(({ v }) => [v, currentColor(v)]))) }}>Customize colors</button>}{!PRESET_THEMES[theme] && !draft && <button type="button" onClick={() => void remove()}>Delete theme</button>}</div><label>Tile titles<select aria-label="Tile titles" value={settings?.tileTitleSize ?? 10} onChange={e => { const size = Number(e.target.value); void saveConnectionSettings({ tileTitleSize: size }).then(() => document.documentElement.style.setProperty('--tile-title', `${size}px`)).catch(report) }}><option value="10">Normal</option><option value="12">Big</option><option value="14">Huge</option></select></label></div>
    {draft && <div className="vd-settings-section"><h3>Theme colors</h3><div className="vd-settings-colors">{THEME_VARS.map(({ v, label }) => <label key={v}>{label}<input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(draft[v] ?? '') ? draft[v] : '#000000'} onChange={e => { const value = e.target.value; setDraft(d => ({ ...d, [v]: value })); document.documentElement.style.setProperty(v, value) }} /></label>)}</div><div className="vd-connection-actions"><button type="button" className="primary" onClick={() => void saveTheme()}>Save as theme…</button><button type="button" onClick={stopPreview}>Revert</button></div></div>}</>
}

function GeneralSettings({ onProject }: { onProject: () => void }): React.JSX.Element {
  const settings = useConnections(s => s.settings)
  const [author, setAuthor] = useState(settings?.moodAuthor ?? ''), [message, setMessage] = useState('')
  return <><h2>General</h2><p className="vd-connection-hint">App-wide preferences.</p><div className="vd-settings-section"><h3>MOODS</h3><label>Author name<input value={author} onChange={e => setAuthor(e.target.value)} /></label><p className="vd-connection-hint">Credited in MOODS you save or share.</p><div className="vd-connection-actions"><button type="button" className="primary" onClick={() => void saveConnectionSettings({ moodAuthor: author.trim() }).then(() => setMessage('Author name saved.')).catch(report)}>Apply name</button></div><div role="status">{message}</div></div>
    <div className="vd-settings-section"><h3>Export</h3><div className="vd-connection-line"><span className="vd-settings-path">{settings?.exportDir || 'Ask each time'}</span><div className="vd-connection-actions"><button type="button" onClick={() => void vd().settingsPickExportDir().then(() => refreshConnections()).catch(report)}>Choose folder…</button>{settings?.exportDir && <button type="button" onClick={() => save({ exportDir: '' })}>Ask each time</button>}</div></div><p className="vd-connection-hint">{settings?.exportDir ? 'Exports use this folder and are named after their timelines.' : 'Each export asks where to save. Multiple timelines use one chosen folder.'}</p></div>
    <div className="vd-settings-section"><div className="vd-connection-line"><span className="vd-connection-hint">Cleanup applies to the current project.</span><button type="button" onClick={onProject}>Project controls</button></div></div></>
}
