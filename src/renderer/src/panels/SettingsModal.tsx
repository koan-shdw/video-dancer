import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { Ic, Settings2 } from '../ui/icons'
import { confirmDialog, textPrompt } from '../prompt'
import { toast } from '../ui/Toast'
import { THEME_VARS, PRESET_THEMES, OG_THEME, THEME_RENAMES, applyTheme, resolveTheme, currentColor, type ThemeMap } from '../lib/themes'

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
  const hasProject = useStore((s) => !!s.project)
  const [falKey, setFalKey] = useState('')
  const [falAdminKey, setFalAdminKey] = useState('')
  const [astriaKey, setAstriaKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [status, setStatus] = useState('')
  const [cleaning, setCleaning] = useState(false)
  // themes: preset or custom var→color maps; edits preview LIVE and only persist on save-as
  const [theme, setTheme] = useState(OG_THEME)
  const [customThemes, setCustomThemes] = useState<Record<string, ThemeMap>>({})
  const [editingTheme, setEditingTheme] = useState(false)
  const [draft, setDraft] = useState<ThemeMap>({})

  const pickTheme = (name: string): void => {
    setTheme(name)
    setEditingTheme(false)
    applyTheme(resolveTheme(name, customThemes))
    void window.vidancer.setSettings({ activeTheme: name })
  }
  const startEditing = (): void => {
    const d: ThemeMap = {}
    for (const { v } of THEME_VARS) d[v] = currentColor(v) // seed from what's on screen right now
    setDraft(d)
    setEditingTheme(true)
  }
  const editColor = (v: string, val: string): void => {
    setDraft((m) => ({ ...m, [v]: val }))
    document.documentElement.style.setProperty(v, val) // live preview
  }
  const revertTheme = (): void => {
    applyTheme(resolveTheme(theme, customThemes))
    setEditingTheme(false)
  }
  const saveThemeAs = async (): Promise<void> => {
    const name = (await textPrompt('Save theme as', theme === OG_THEME ? 'My theme' : `${theme} mod`))?.trim()
    if (!name) return
    if (PRESET_THEMES[name]) {
      toast(`"${name}" is a built-in theme — pick another name`, { kind: 'error' })
      return
    }
    const next = { ...customThemes, [name]: draft }
    setCustomThemes(next)
    setTheme(name)
    setEditingTheme(false)
    void window.vidancer.setSettings({ customThemes: next, activeTheme: name })
    toast(`theme "${name}" saved ✓`, { kind: 'ok' })
  }
  const deleteTheme = async (): Promise<void> => {
    if (PRESET_THEMES[theme]) return
    if (!(await confirmDialog(`Delete the theme "${theme}"?`, { confirmLabel: 'Delete', danger: true }))) return
    const next = { ...customThemes }
    delete next[theme]
    setCustomThemes(next)
    void window.vidancer.setSettings({ customThemes: next, activeTheme: OG_THEME })
    pickTheme(OG_THEME)
  }

  // sweep media files nothing references (deletes never unlink, so project folders only grow) —
  // dry-run first, then an explicit confirm with the real count/size before anything is removed
  const cleanup = async (): Promise<void> => {
    if (cleaning) return
    setCleaning(true)
    try {
      const scan = await window.vidancer.projectCleanup(false)
      if (!scan) return
      if (scan.busy) {
        toast('a render, image generation or import is running — try again when it finishes', { kind: 'error' })
        return
      }
      if (scan.files === 0) {
        toast('no unused media files found', { kind: 'ok' })
        return
      }
      const mb = (scan.bytes / (1024 * 1024)).toFixed(1)
      const ok = await confirmDialog(
        `Delete ${scan.files} unused media file${scan.files === 1 ? '' : 's'} (${mb} MB)? Nothing in the project or its undo history uses them. This cannot be undone.`,
        { confirmLabel: 'Delete', danger: true }
      )
      if (!ok) return
      const done = await window.vidancer.projectCleanup(true)
      if (done?.busy) {
        toast('a render started meanwhile — nothing was deleted, try again later', { kind: 'error' })
        return
      }
      toast(done ? `cleaned up ${done.files} file${done.files === 1 ? '' : 's'} (${(done.bytes / (1024 * 1024)).toFixed(1)} MB) ✓` : 'cleanup failed', { kind: done ? 'ok' : 'error' })
    } finally {
      setCleaning(false)
    }
  }

  useEffect(() => {
    window.vidancer.getSettings().then((s) => {
      setFalKey(s?.falKey ?? '')
      setFalAdminKey(s?.falAdminKey ?? '')
      setAstriaKey(s?.astriaKey ?? '')
      setAnthropicKey(s?.anthropicKey ?? '')
      initial.current = { falKey: s?.falKey ?? '', falAdminKey: s?.falAdminKey ?? '', astriaKey: s?.astriaKey ?? '', anthropicKey: s?.anthropicKey ?? '' }
      const saved = s?.activeTheme ?? OG_THEME
      setTheme(THEME_RENAMES[saved] ?? saved) // old preset names map forward
      setCustomThemes((s?.customThemes as Record<string, ThemeMap>) ?? {})
    })
  }, [])

  // patch only the fields the user actually changed — re-saving an untouched key is pointless, and
  // if one failed to decrypt this session (field loads blank) a full save would wipe its stored blob
  const initial = useRef<{ falKey: string; falAdminKey: string; astriaKey: string; anthropicKey: string } | null>(null)
  const save = async (): Promise<void> => {
    const patch: Record<string, string> = {}
    const want = { falKey: falKey.trim(), falAdminKey: falAdminKey.trim(), astriaKey: astriaKey.trim(), anthropicKey: anthropicKey.trim() }
    for (const k of Object.keys(want) as (keyof typeof want)[]) {
      if (want[k] !== (initial.current?.[k] ?? '')) patch[k] = want[k]
    }
    if (Object.keys(patch).length) await window.vidancer.setSettings(patch)
    initial.current = want
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

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            theme
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={theme} onChange={(e) => pickTheme(e.target.value)} style={{ ...ctl, width: 'auto', padding: '5px 8px' }}>
              {Object.keys(PRESET_THEMES).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
              {Object.keys(customThemes).map((n) => (
                <option key={n} value={n}>{n} (custom)</option>
              ))}
            </select>
            {!editingTheme && (
              <span className="btn vd-hbtn" onClick={startEditing} title="tweak every color — changes preview live, save as a new theme">
                customize colors
              </span>
            )}
            {!PRESET_THEMES[theme] && !editingTheme && (
              <span className="btn vd-hbtn" style={{ color: 'var(--bad)' }} onClick={() => void deleteTheme()}>
                delete
              </span>
            )}
          </div>
          {editingTheme && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px' }}>
                {THEME_VARS.map(({ v, label }) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--muted)' }}>
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(draft[v] ?? '') ? draft[v] : '#000000'}
                      onChange={(e) => editColor(v, e.target.value)}
                      style={{ width: 26, height: 18, padding: 0, border: '1px solid var(--line2)', background: 'transparent', cursor: 'pointer' }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <span className="btn" onClick={() => void saveThemeAs()}>Save as theme…</span>
                <span className="btn vd-hbtn" onClick={revertTheme}>revert</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            project maintenance
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="btn" style={hasProject && !cleaning ? undefined : { opacity: 0.5, pointerEvents: 'none' }} onClick={() => void cleanup()}>
              {cleaning ? 'scanning…' : 'Clean up unused media'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>
              {hasProject ? 'deletes files no clip, image, track or undo step still uses' : 'open a project first'}
            </span>
          </div>
        </div>
    </Modal>
  )
}
