import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { Section, Dropdown } from '@koan/shared'
import { Ic, Settings2 } from '../ui/icons'
import { ctl as ctlBase } from '../ui/controls'
import { confirmDialog, textPrompt } from '../prompt'
import { toast } from '../ui/Toast'
import { cliVersionLess } from '../shared/models'
import { THEME_VARS, PRESET_THEMES, OG_THEME, THEME_RENAMES, applyTheme, resolveTheme, currentColor, type ThemeMap } from '../lib/themes'
import { DEFAULT_WATCH_MODEL } from '../shared/watch'

// the ONE input recipe (ui/controls) — modals stopped carrying their own copy (KOAN gap-09)
const ctl: React.CSSProperties = { ...ctlBase, width: '100%' }

// a supplier's bordered sub-row inside the API card — name + status chip + its fields/buttons
const supplierRow: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 4, padding: '8px 10px', marginBottom: 8 }

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const refreshCredit = useStore((s) => s.refreshCredit)
  const hasProject = useStore((s) => !!s.project)
  const [falKey, setFalKey] = useState('')
  const [hfKey, setHfKey] = useState('')
  const [hfStatus, setHfStatus] = useState('') // "test key" result line
  const [arkKey, setArkKey] = useState('')
  const [arkStatus, setArkStatus] = useState('')
  const [civitStatus, setCivitStatus] = useState('') // "signed in as <name>" — the Image Gen sidebar's favorites + downloads ride this key
  const [astriaKey, setAstriaKey] = useState('')
  const [astriaStatus, setAstriaStatus] = useState('')
  const [googleKey, setGoogleKey] = useState('') // the WATCH lane — Gemini Flash sees takes (WATCH-LANE-SPEC-2026-09-08)
  const [googleStatus, setGoogleStatus] = useState('')
  const [googleWatchModel, setGoogleWatchModel] = useState(DEFAULT_WATCH_MODEL)
  const [moodAuthor, setMoodAuthor] = useState('') // the name written into MOODS you save (MOODS-VMD-SPEC §7)
  const [elevenKey, setElevenKey] = useState('') // ElevenLabs — the Music v2 score door (SCORE-WATCH-SPEC §4)
  const [elevenStatus, setElevenStatus] = useState('')
  const [falAdminKey, setFalAdminKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [civitaiKey, setCivitaiKey] = useState('')
  const [status, setStatus] = useState('')
  const [titleSize, setTitleSize] = useState(10) // Bin/Library tile title px — applies live via --tile-title
  const [cleaning, setCleaning] = useState(false)
  const [exportDir, setExportDir] = useState('') // list 5: the default export folder ('' = ask each time)
  // which cards are open — the API card opens itself when NOTHING is connected (empty state teaches)
  const [openSecs, setOpenSecs] = useState<Set<string>>(new Set(['api']))
  const toggleSec = (id: string): void =>
    setOpenSecs((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  // themes: preset or custom var→color maps; edits preview LIVE and only persist on save-as
  const [theme, setTheme] = useState(OG_THEME)
  const [customThemes, setCustomThemes] = useState<Record<string, ThemeMap>>({})
  const [editingTheme, setEditingTheme] = useState(false)
  const [draft, setDraft] = useState<ThemeMap>({})
  // Co-Director: model choice + the 4 guide files (3 prompting guides + his own instructions)
  const [codirModel, setCodirModel] = useState('')
  const [codirModels, setCodirModels] = useState<{ id: string; label: string }[]>([])
  const [guides, setGuides] = useState<{ id: string; label: string; customised: boolean; hasLearned: boolean; loaded: boolean }[]>([])
  // EXPERIMENTAL: Co-Director bridge — engine choice + local Claude Code CLI detection
  const [codirEngine, setCodirEngine] = useState<'api' | 'bridge'>('api')
  const [codirRlm, setCodirRlmState] = useState(true) // RLM context mode — default ON (spec 2026-08-27)
  const [bridgeInfo, setBridgeInfo] = useState<{ found: boolean; version?: string; detail: string; loggedIn?: boolean } | null>(null)
  const [codirBridgeModel, setCodirBridgeModel] = useState('claude-fable-5')
  const [bridgeModels, setBridgeModels] = useState<{ id: string; label: string; minCli?: string }[]>([])
  const refreshGuides = (): void => {
    void vd().codirGuides().then(setGuides)
  }
  const toggleGuideLoad = (id: string, on: boolean): void => {
    setGuides((gs) => gs.map((g) => (g.id === id ? { ...g, loaded: on } : g)))
    const map = Object.fromEntries(guides.filter((g) => g.id !== 'codirector').map((g) => [g.id, g.id === id ? on : g.loaded]))
    void vd().setSettings({ codirGuideLoad: map }).then(refreshGuides)
  }

  const pickTheme = (name: string): void => {
    setTheme(name)
    setEditingTheme(false)
    applyTheme(resolveTheme(name, customThemes))
    void vd().setSettings({ activeTheme: name })
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
    void vd().setSettings({ customThemes: next, activeTheme: name })
    toast(`theme "${name}" saved ✓`, { kind: 'ok' })
  }
  const deleteTheme = async (): Promise<void> => {
    if (PRESET_THEMES[theme]) return
    if (!(await confirmDialog(`Delete the theme "${theme}"?`, { confirmLabel: 'Delete', danger: true }))) return
    const next = { ...customThemes }
    delete next[theme]
    setCustomThemes(next)
    void vd().setSettings({ customThemes: next, activeTheme: OG_THEME })
    pickTheme(OG_THEME)
  }

  // sweep media files nothing references (deletes never unlink, so project folders only grow) —
  // dry-run first, then an explicit confirm with the real count/size before anything is removed
  const cleanup = async (): Promise<void> => {
    if (cleaning) return
    setCleaning(true)
    try {
      const scan = await vd().projectCleanup(false)
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
      const done = await vd().projectCleanup(true)
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
    vd().getSettings().then((s) => {
      setFalKey(s?.falKey ?? '')
      setHfKey(s?.hfKey ?? '')
      setArkKey(s?.arkKey ?? '')
      setAstriaKey(s?.astriaKey ?? '')
      setGoogleKey(s?.googleKey ?? '')
      setGoogleWatchModel(s?.googleWatchModel || DEFAULT_WATCH_MODEL)
      setElevenKey(s?.elevenKey ?? '')
      setMoodAuthor(s?.moodAuthor ?? '')
      setFalAdminKey(s?.falAdminKey ?? '')
      setAnthropicKey(s?.anthropicKey ?? '')
      setCivitaiKey(s?.civitaiKey ?? '')
      setExportDir(s?.exportDir ?? '')
      initial.current = { falKey: s?.falKey ?? '', hfKey: s?.hfKey ?? '', arkKey: s?.arkKey ?? '', astriaKey: s?.astriaKey ?? '', falAdminKey: s?.falAdminKey ?? '', anthropicKey: s?.anthropicKey ?? '', civitaiKey: s?.civitaiKey ?? '', googleKey: s?.googleKey ?? '', elevenKey: s?.elevenKey ?? '' }
      // the API card stays open only while NOTHING is connected — otherwise start tidy
      if (s?.falKey || s?.hfKey || s?.arkKey || s?.astriaKey) setOpenSecs(new Set())
      const saved = s?.activeTheme ?? OG_THEME
      setTheme(THEME_RENAMES[saved] ?? saved) // old preset names map forward
      setCustomThemes((s?.customThemes as Record<string, ThemeMap>) ?? {})
      setTitleSize(s?.tileTitleSize ?? 10)
      void vd().codirModels().then((models) => {
        setCodirModels(models)
        // a saved id that's no longer offered shows as a blank <select>; land on
        // the first entry instead (main resolves the same way before sending)
        const saved = s?.codirModel as string | undefined
        setCodirModel(models.some((m) => m.id === saved) ? (saved as string) : (models[0]?.id ?? ''))
      })
      setCodirEngine((s?.codirEngine as 'api' | 'bridge') ?? 'api')
      setCodirRlmState((s?.codirRlm as boolean | undefined) !== false)
      void vd().codirBridgeStatus().then(setBridgeInfo)
      void vd().codirBridgeModels().then((ms) => {
        setBridgeModels(ms)
        const savedBridge = s?.codirBridgeModel as string | undefined
        setCodirBridgeModel(
          ms.some((m) => m.id === savedBridge) ? (savedBridge as string) : (ms[0]?.id ?? 'claude-fable-5')
        )
      })
      refreshGuides()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // patch only the fields the user actually changed — re-saving an untouched key is pointless, and
  // if one failed to decrypt this session (field loads blank) a full save would wipe its stored blob
  const initial = useRef<{ falKey: string; hfKey: string; arkKey: string; astriaKey: string; falAdminKey: string; anthropicKey: string; civitaiKey: string; googleKey: string; elevenKey: string } | null>(null)
  const save = async (): Promise<void> => {
    const patch: Record<string, string> = {}
    const want = { falKey: falKey.trim(), hfKey: hfKey.trim(), arkKey: arkKey.trim(), astriaKey: astriaKey.trim(), falAdminKey: falAdminKey.trim(), anthropicKey: anthropicKey.trim(), civitaiKey: civitaiKey.trim(), googleKey: googleKey.trim(), elevenKey: elevenKey.trim() }
    for (const k of Object.keys(want) as (keyof typeof want)[]) {
      if (want[k] !== (initial.current?.[k] ?? '')) patch[k] = want[k]
    }
    const watchModel = googleWatchModel.trim().replace(/^models\//, '') || DEFAULT_WATCH_MODEL
    if (!/^[a-zA-Z0-9._-]+$/.test(watchModel)) { setStatus('Enter a valid Gemini model ID.'); return }
    await vd().setSettings({ ...patch, googleWatchModel: watchModel })
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
    mb = 10
  ): React.JSX.Element => (
    <label style={{ display: 'block', marginBottom: mb }}>
      <div className="lb" style={{ marginBottom: 4 }}>
        {label} <span style={{ color: 'var(--dim)' }}>— {hint}</span>
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves (director 2026-09-09) — the same save the button does
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        style={ctl}
      />
    </label>
  )
  const chip = (set: boolean): React.JSX.Element => (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: set ? 'var(--ok)' : 'var(--dim)' }}>{set ? '● connected' : '○ not set'}</span>
  )
  const supplierHead = (name: string, set: boolean): React.JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <b style={{ fontSize: 11.5, color: 'var(--txt-hi)' }}>{name}</b>
      <span style={{ marginLeft: 'auto' }}>{chip(set)}</span>
    </div>
  )
  const testRow = (
    keyVal: string,
    setStat: (s: string) => void,
    stat: string,
    validate: (k: string) => Promise<{ ok: boolean; error?: string }>,
    testTitle: string,
    keyUrl: string,
    keyTitle: string
  ): React.JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        className="btn vd-hbtn"
        title={testTitle}
        onClick={() => {
          const k = keyVal.trim()
          if (!k) return setStat('paste a key first')
          setStat('testing…')
          void validate(k).then((r) => setStat(r.ok ? 'key works ✓' : `✕ ${r.error ?? 'rejected'}`))
        }}
      >
        test key
      </span>
      <span className="btn vd-hbtn" title={keyTitle} onClick={() => void vd().openExternal(keyUrl)}>
        get a key ↗
      </span>
      {stat && <span style={{ fontSize: 11, color: stat.startsWith('✕') ? 'var(--bad)' : 'var(--muted)' }}>{stat}</span>}
    </div>
  )

  const connectedCount = [falKey, arkKey, astriaKey, hfKey].filter((k) => k.trim()).length

  return (
    <Modal title={<><Ic i={Settings2} size={15} /> Settings</>} width={500} onClose={onClose}>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}>
        Keys are stored locally on this machine only (Electron userData) — never in the project folder or repo.
      </div>

      {/* ---- card 1 · API suppliers ---- */}
      <Section
        title="api suppliers"
        collapsible
        open={openSecs.has('api')}
        onToggle={() => toggleSec('api')}
        right={
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: connectedCount ? 'var(--ok)' : 'var(--dim)' }}>
            {connectedCount}/4 connected
          </span>
        }
      >
        <div style={supplierRow}>
          {supplierHead('fal.ai — recommended, powers everything', !!falKey.trim())}
          {field('fal API key', 'Seedance 2/2.5, Sora 2, Omni edits, Nano Banana (id:secret)', falKey, setFalKey, 'paste fal key')}
          {field('fal admin key', 'optional — shows your live $ balance in the header (account/billing scope)', falAdminKey, setFalAdminKey, 'paste fal admin key', 0)}
        </div>
        <div style={supplierRow}>
          {supplierHead('BytePlus ModelArk — Seedance and Seedream direct from ByteDance', !!arkKey.trim())}
          {field('ModelArk API key', 'refs must not contain real human faces (their policy)', arkKey, setArkKey, 'paste ModelArk key', 6)}
          {testRow(arkKey, setArkStatus, arkStatus, (k) => vd().arkValidate(k),
            'authenticated no-op against the ModelArk API — checks the key, never spends tokens',
            'https://console.byteplus.com/ark',
            'opens the BytePlus console — activate Seedance (and Seedream 5.0, for Image Edit) under ModelArk, then create an API key')}
        </div>
        <div style={supplierRow}>
          {supplierHead('Astria — Seedance 2 on plan credits', !!astriaKey.trim())}
          {field('Astria API key', 't2v + first/last-frame i2v (no refs over their API)', astriaKey, setAstriaKey, 'paste Astria key', 6)}
          {testRow(astriaKey, setAstriaStatus, astriaStatus, (k) => vd().astriaValidate(k),
            'authenticated no-op against api.astria.ai — checks the key, never spends credits',
            'https://www.astria.ai/users/edit#api',
            'opens astria.ai — your API key lives under Account → API')}
        </div>
        <div style={supplierRow}>
          {supplierHead('Google AI (Gemini) — the WATCH lane: the Co-Director and Score compose see your takes · Nano Banana in Image Edit', !!googleKey.trim())}
          {field('Google AI Studio key', 'Gemini Flash watches a take on ask (a few thousand tokens each); Score digests read the footage; Image Edit runs Nano Banana 2 and Pro on it (VIA Google)', googleKey, setGoogleKey, 'paste Google AI key', 6)}
          {testRow(googleKey, setGoogleStatus, googleStatus, (k) => vd().googleValidate(k),
            'one models.list call against the Gemini API — checks the key, spends nothing',
            'https://aistudio.google.com/apikey',
            'opens Google AI Studio — Get API key')}
          <label style={{ display: 'block', marginTop: 8 }}>Watch model
            <input aria-label="Watch model" style={ctl} value={googleWatchModel} onChange={e => setGoogleWatchModel(e.target.value)} placeholder={DEFAULT_WATCH_MODEL} />
          </label>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Used for takes, timeline watching and Score compose. If Google fails, Watch can use Claude to read still frames; motion and sound are then unavailable.</div>
        </div>
        <div style={supplierRow}>
          {supplierHead('ElevenLabs — Music v2 in Score Gen', !!elevenKey.trim())}
          {field('ElevenLabs API key', 'the beats become its composition plan; bills your ElevenLabs credits', elevenKey, setElevenKey, 'paste ElevenLabs key', 6)}
          {testRow(elevenKey, setElevenStatus, elevenStatus, (k) => vd().elevenValidate(k),
            'one /v1/user call against the ElevenLabs API — checks the key, spends nothing',
            'https://elevenlabs.io/app/settings/api-keys',
            'opens elevenlabs.io — Profile → API keys')}
        </div>
        <div style={supplierRow}>
          {supplierHead('Higgsfield — waiting on their API', !!hfKey.trim())}
          {field('Higgsfield key', 'no Seedance on their API yet — the engine lights up the day it ships (api-key:api-secret)', hfKey, setHfKey, 'paste api-key:api-secret', 6)}
          {testRow(hfKey, setHfStatus, hfStatus, (k) => vd().hfValidate(k),
            'authenticated no-op against platform.higgsfield.ai — checks the key, never spends credits',
            'https://cloud.higgsfield.ai/',
            'opens cloud.higgsfield.ai — create a key under API keys (Creator plan includes API access)')}
        </div>
        <div style={{ ...supplierRow, marginBottom: 2 }}>
          {supplierHead('Civitai — loras + checkpoints', !!civitaiKey.trim())}
          {field('Civitai API key', 'downloads and your favorites need it — browsing works keyless', civitaiKey, setCivitaiKey, 'paste Civitai key', 6)}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="btn vd-hbtn"
              title="asks civitai.com/api/v1/me who owns this key — spends nothing"
              onClick={() => {
                const k = civitaiKey.trim()
                if (!k) return setCivitStatus('paste a key first')
                setCivitStatus('checking…')
                void vd().civitMe(k).then((r) => setCivitStatus(r.ok ? `signed in as ${r.username}${r.tier && r.tier !== 'free' ? ` · ${r.tier}` : ''} ✓` : `✕ ${r.error ?? 'rejected'}`))
              }}
            >
              sign in check
            </span>
            <span className="btn vd-hbtn" title="opens civitai.com — API keys live under Account settings" onClick={() => void vd().openExternal('https://civitai.com/user/account')}>
              get a key ↗
            </span>
            {civitStatus && <span style={{ fontSize: 11, color: civitStatus.startsWith('✕') ? 'var(--bad)' : 'var(--muted)' }}>{civitStatus}</span>}
          </div>
        </div>
      </Section>

      {/* ---- card 2 · Co-Director ---- */}
      <Section
        title="co-director"
        collapsible
        open={openSecs.has('codir')}
        onToggle={() => toggleSec('codir')}
        right={
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: codirEngine === 'bridge' ? 'var(--amber)' : anthropicKey.trim() ? 'var(--ok)' : 'var(--dim)' }}>
            {codirEngine === 'bridge' ? '⚭ bridge' : anthropicKey.trim() ? '● api' : '○ not set'}
          </span>
        }
      >
        {field('Anthropic API key', 'usage bills per token to your Anthropic account', anthropicKey, setAnthropicKey, 'paste Anthropic key')}
        {/* MOODS author — written into every .vmd you save (MOODS-VMD-SPEC §7); asked again on first save if empty */}
        <label style={{ display: 'block', marginBottom: 10 }}>
          <div className="lb" style={{ marginBottom: 4 }}>
            your name on MOODS <span style={{ color: 'var(--dim)' }}>— credited in every MOOD you save or share</span>
          </div>
          <input
            value={moodAuthor}
            onChange={(e) => setMoodAuthor(e.target.value)}
            onBlur={() => void vd().setSettings({ moodAuthor: moodAuthor.trim() })}
            placeholder="e.g. koan"
            spellCheck={false}
            style={ctl}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="lb" style={{ margin: 0 }}>model</span>
          {codirEngine === 'bridge' ? (
            // bridge = subscription models: no per-token prices on the labels, Fable 5 available
            <Dropdown
              value={codirBridgeModel}
              options={bridgeModels.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => {
                setCodirBridgeModel(v)
                void vd().setSettings({ codirBridgeModel: v })
                useStore.setState((st) => ({ settingsRev: st.settingsRev + 1 }))
              }}
              title="on your subscription — no per-token bill"
            />
          ) : (
            <Dropdown
              value={codirModel}
              options={codirModels.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => {
                setCodirModel(v)
                void vd().setSettings({ codirModel: v })
                useStore.setState((st) => ({ settingsRev: st.settingsRev + 1 }))
              }}
            />
          )}
        </div>
        {(() => {
          // 2026-09-29: the picked bridge model needs a newer Claude Code than this machine has
          const need = codirEngine === 'bridge' ? bridgeModels.find((m) => m.id === codirBridgeModel)?.minCli : undefined
          const have = bridgeInfo?.found ? bridgeInfo.version?.match(/\d+\.\d+\.\d+/)?.[0] : undefined
          if (!need || !have || !cliVersionLess(have, need)) return null
          return (
            <div style={{ fontSize: 11, color: 'var(--amber)', margin: '-4px 0 8px' }}>
              ⚠ Claude Code {have} is too old for this model. It needs {need} or newer.{' '}
              <span
                className="btn vd-hbtn"
                title="runs the Claude Code update for you"
                onClick={() => {
                  setBridgeInfo(null)
                  void useStore
                    .getState()
                    .updateClaudeCode()
                    .then(() => vd().codirBridgeStatus().then(setBridgeInfo))
                }}
              >
                update claude code
              </span>
            </div>
          )
        })()}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11 }}>
          <input
            type="checkbox"
            checked={codirRlm}
            onChange={(e) => {
              setCodirRlmState(e.target.checked)
              void vd().setSettings({ codirRlm: e.target.checked })
            }}
            style={{ margin: 0 }}
          />
          <span style={{ color: 'var(--txt-hi)' }}>RLM context</span>
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>each exchange carries a small index and reads state on demand — long sessions stay cheap and sharp; off = the full project snapshot every turn</span>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div className="lb" style={{ marginBottom: 4 }}>
            guide files <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>— ticked files ride along on every exchange (more text = more tokens); edit forks your personal copy</span>
          </div>
          {guides.map((g) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '3px 0', fontSize: 11 }}>
              <input
                type="checkbox"
                checked={g.loaded}
                disabled={g.id === 'codirector'}
                title={g.id === 'codirector' ? 'his instructions always load' : 'load this file into every exchange'}
                onChange={(e) => toggleGuideLoad(g.id, e.target.checked)}
                style={{ margin: 0 }}
              />
              <span style={{ color: 'var(--txt-hi)' }}>{g.label}</span>
              <span style={{ color: g.customised ? 'var(--amber)' : 'var(--muted)' }}>{g.customised ? 'customised' : 'default'}</span>
              <span
                className="btn vd-hbtn"
                title="open this guide as a Markdown file — edits apply on the next exchange"
                onClick={() =>
                  void vd().codirGuideOpen(g.id).then(() => {
                    toast(`${g.label} opened — edits apply on the next exchange`, { kind: 'ok' })
                    refreshGuides()
                  })
                }
              >
                edit
              </span>
              {g.customised && (
                <span
                  className="btn vd-hbtn"
                  title="delete your personal copy and go back to the built-in default"
                  onClick={() =>
                    void (async () => {
                      if (!(await confirmDialog(`Discard your customised "${g.label}" and go back to the default?`, { confirmLabel: 'Revert', danger: true }))) return
                      await vd().codirGuideRevert(g.id)
                      refreshGuides()
                    })()
                  }
                >
                  revert
                </span>
              )}
              {g.id === 'codirector' && g.hasLearned && (
                <span
                  className="btn vd-hbtn"
                  title="clear only the rules he saved when you said “remember” — hand edits stay"
                  onClick={() =>
                    void (async () => {
                      if (!(await confirmDialog('Clear all learned instructions the Co-Director has saved?', { confirmLabel: 'Purge', danger: true }))) return
                      await vd().codirGuidePurgeLearned()
                      refreshGuides()
                    })()
                  }
                >
                  purge learned
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div className="lb" style={{ marginBottom: 6 }}>experimental</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: bridgeInfo?.found ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={codirEngine === 'bridge'}
              disabled={!bridgeInfo?.found}
              title={bridgeInfo?.found ? 'route Co-Director exchanges through your local Claude Code' : 'install Claude Code first (below)'}
              onChange={(e) => {
                const engine = e.target.checked ? 'bridge' : 'api'
                setCodirEngine(engine)
                void vd().setSettings({ codirEngine: engine })
                useStore.setState((st) => ({ settingsRev: st.settingsRev + 1 })) // Co-Director header re-reads live
              }}
              style={{ margin: 0 }}
            />
            <span style={{ color: 'var(--txt-hi)' }}>Co-Director Bridge — run on your local Claude Code (subscription) instead of the API</span>
          </label>
          <div style={{ fontSize: 11, color: bridgeInfo && (!bridgeInfo.found || bridgeInfo.loggedIn === false) ? 'var(--amber)' : 'var(--dim)', margin: '5px 0 4px 22px' }}>
            {bridgeInfo === null ? (
              'checking for Claude Code…'
            ) : bridgeInfo.found ? (
              <>
                {bridgeInfo.loggedIn === false ? '✕' : '✓'} {bridgeInfo.detail}
                {bridgeInfo.loggedIn === false && (
                  <>
                    {' '}— sign in to Claude Code again, then{' '}
                    <span
                      className="btn vd-hbtn"
                      onClick={() => {
                        setBridgeInfo(null)
                        void vd().codirBridgeStatus(true).then(setBridgeInfo)
                      }}
                    >
                      re-check
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                not found — install with <span style={{ fontFamily: 'var(--mono)', color: 'var(--txt)' }}>npm install -g @anthropic-ai/claude-code</span>, run{' '}
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--txt)' }}>claude</span> once in a terminal to log in, then{' '}
                <span
                  className="btn vd-hbtn"
                  onClick={() => {
                    setBridgeInfo(null)
                    void vd().codirBridgeStatus(true).then(setBridgeInfo)
                  }}
                >
                  re-check
                </span>
              </>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--dim)', margin: '0 0 2px 22px', lineHeight: 1.5 }}>
            Same window, same tools, same undo — but exchanges run on your Claude subscription (shared usage limits, no per-token bill), and the
            Co-Director can additionally READ files on this machine to see any Library image or take. It still writes only through the normal
            project tools. Toggle off to return to the API instantly.
          </div>
        </div>
      </Section>

      {/* ---- card 3 · theme ---- */}
      <Section
        title="theme"
        collapsible
        open={openSecs.has('theme')}
        onToggle={() => toggleSec('theme')}
        right={<span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{theme}</span>}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Dropdown
            value={theme}
            options={[
              ...Object.keys(PRESET_THEMES).map((n) => ({ value: n, label: n })),
              ...Object.keys(customThemes).map((n) => ({ value: n, label: `${n} (custom)` }))
            ]}
            onChange={pickTheme}
          />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span className="lb" title="title text size on Bin & Library tiles">tile titles</span>
          <Dropdown
            value={String(titleSize)}
            options={[
              { value: '10', label: 'normal' },
              { value: '12', label: 'big' },
              { value: '14', label: 'huge' }
            ]}
            onChange={(v) => {
              const n = Number(v)
              setTitleSize(n)
              document.documentElement.style.setProperty('--tile-title', `${n}px`) // live, no restart
              void vd().setSettings({ tileTitleSize: n })
            }}
            title="title text on Bin & Library tiles"
          />
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
      </Section>

      {/* ---- export (list 5): the default folder every export lands in ---- */}
      <Section title="export" collapsible open={openSecs.has('export')} onToggle={() => toggleSec('export')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="lb" style={{ width: 90, margin: 0 }}>export folder</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'var(--mono)', color: exportDir ? 'var(--body)' : 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={exportDir || undefined}>
            {exportDir || 'ask each time'}
          </span>
          <span className="btn vd-hbtn" onClick={() => void vd().settingsPickExportDir().then((d) => d && setExportDir(d))}>choose…</span>
          {exportDir && (
            <span className="btn vd-hbtn" title="go back to the save box on every export" onClick={() => void vd().setSettings({ exportDir: '' }).then(() => setExportDir(''))}>
              ask each time
            </span>
          )}
        </div>
        <div className="vd-hint" style={{ marginTop: 6 }}>
          {exportDir ? 'every export lands here, named after its timeline — no save box; picking several timelines in the Bin exports them all here' : 'each export asks where to save; picking several timelines in the Bin asks for one folder'}
        </div>
      </Section>

      {/* ---- card 4 · project maintenance ---- */}
      <Section title="project maintenance" collapsible open={openSecs.has('maint')} onToggle={() => toggleSec('maint')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="btn" style={hasProject && !cleaning ? undefined : { opacity: 0.5, pointerEvents: 'none' }} onClick={() => void cleanup()}>
            {cleaning ? 'scanning…' : 'Clean up unused media'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {hasProject ? 'deletes files no clip, image, track or undo step still uses' : 'open a project first'}
          </span>
        </div>
      </Section>

      {/* save bar — keys (suppliers + Anthropic) persist on Save; everything else saves as you click */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <span className="btn" onClick={save}>Save</span>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>saves the API keys — theme, model and guide choices apply instantly</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{status}</span>
      </div>
    </Modal>
  )
}
