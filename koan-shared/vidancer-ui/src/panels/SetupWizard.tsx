import { useEffect, useMemo, useState } from 'react'
import { vd } from '../api'
import { Modal } from '../ui/Modal'
import { useStore } from '../store'
import { keySupplier, type KeySupplier } from '../lib/keySuppliers'
import { setupPages, type SetupService } from '../lib/setupServices'
import { CLI_NAMES, type CodirCli } from '../shared/models'

// THE SETUP WIZARD (list 36). His words: "A install and login wizard that lets users log into all
// the servies in a single login wizard the LLM, the video the image it outlines all the serves
// that each will provide and guies them for the login" (09-21). His answers 09-30: it shows on the
// first run and from a button in Settings; it lists every service the app has, with no
// "recommended" tag; it replaces the Welcome card.
//
// A page per kind of work (lib/setupServices.ts reads them off the model registries). Every
// service is one row: its name, whether it is connected, what it gives, and its own way in. The
// ways in are the ones the app already had: a key's three steps (list 37), a Bridge login, a
// command-line tool's own sign-in (list 38, list 35), the Models card for what runs on this PC.

type CliInfo = { found: boolean; version?: string; detail: string; loggedIn?: boolean }
const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', marginTop: 8, background: 'var(--panel)' }
const chip = (on: boolean | 'warn', text: string, title?: string): React.JSX.Element => (
  <span title={title} style={{ fontFamily: 'var(--mono)', fontSize: 10, whiteSpace: 'nowrap', color: on === 'warn' ? 'var(--amber)' : on ? 'var(--ok)' : 'var(--dim)' }}>
    {on === true ? '●' : on === 'warn' ? '✕' : '○'} {text}
  </span>
)

// a key's three steps, in one row: get it on their page, paste it, save (checked first where the
// supplier has a free check: a refused key is never saved — list 37's law)
function KeyRow({ supplier, set, onSaved }: { supplier: KeySupplier; set: boolean; onSaved: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<{ ok?: boolean; text: string }>({ text: '' })
  const save = async (): Promise<void> => {
    const key = value.trim()
    if (!key || busy) return
    setBusy(true)
    setState({ text: supplier.test ? 'checking the key…' : 'saving…' })
    try {
      const r = supplier.test ? await supplier.test(key) : { ok: true }
      if (!r.ok) return setState({ ok: false, text: `that key was refused: ${r.error ?? 'rejected'}` })
      await vd().setSettings({ [supplier.setting]: key })
      useStore.setState((st) => ({ settingsRev: st.settingsRev + 1 })) // header chips and panels re-read
      setValue('')
      setOpen(false)
      setState({ ok: true, text: supplier.test ? 'key works and is saved' : 'key saved' })
      onSaved()
    } catch (e) {
      setState({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
      <span className="btn vd-hbtn ghost" title={supplier.where} onClick={() => void vd().openExternal(supplier.url)}>
        get a key ↗
      </span>
      {set && !open ? (
        <span className="btn vd-hbtn ghost" title="paste another key in its place" onClick={() => setOpen(true)}>
          change key
        </span>
      ) : (
        <>
          <input
            type="password"
            aria-label={`${supplier.label} key`}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            placeholder={supplier.placeholder}
            spellCheck={false}
            autoComplete="off"
            style={{ flex: '1 1 160px', minWidth: 0, background: 'var(--field)', color: 'var(--txt-hi)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', fontSize: 12 }}
          />
          <span className="btn vd-hbtn" style={!value.trim() || busy ? { opacity: 0.5, cursor: 'default' } : undefined} onClick={() => void save()} title={supplier.test ? 'checks the key with one free call, then saves it' : 'saves the key'}>
            save key
          </span>
        </>
      )}
      {state.text && (
        <span role="status" style={{ fontSize: 11.5, color: state.ok === false ? 'var(--bad)' : state.ok ? 'var(--ok)' : 'var(--dim)' }}>
          {state.text}
        </span>
      )}
    </div>
  )
}

export function SetupWizard({ onClose, onOpenSettings, onOpenBridge, onOpenModels }: { onClose: () => void; onOpenSettings: () => void; onOpenBridge: () => void; onOpenModels: () => void }): React.JSX.Element {
  const pages = useMemo(setupPages, [])
  const [at, setAt] = useState(-1) // -1 = the start page
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [rows, setRows] = useState<BridgeRow[]>([])
  const [cli, setCli] = useState<Record<CodirCli, CliInfo | null>>({ claude: null, codex: null, gemini: null })
  const [cliBusy, setCliBusy] = useState<CodirCli | null>(null)

  const readSettings = (): void => void vd().getSettings().then((s) => setSettings((s as Record<string, unknown>) ?? {})).catch(() => undefined)
  const readCli = (c: CodirCli, refresh = false): void => void (c === 'claude' ? vd().codirBridgeStatus(refresh) : vd().codirCliStatus(c, refresh)).then((i) => setCli((m) => ({ ...m, [c]: i ?? { found: false, detail: '' } }))).catch(() => undefined)
  useEffect(() => {
    let live = true
    readSettings()
    const pull = (): void => void vd().bridgeList().then((r) => live && setRows(r ?? [])).catch(() => undefined)
    pull()
    for (const c of ['claude', 'codex', 'gemini'] as const) readCli(c)
    const off = vd().onBridgeChanged(pull)
    return () => {
      live = false
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = (c: CodirCli): void => {
    setCliBusy(c)
    void (c === 'claude' ? vd().codirBridgeLogin() : vd().codirCliLogin(c))
      .then((i) => setCli((m) => ({ ...m, [c]: i ?? { found: false, detail: '' } })))
      .catch(() => undefined)
      .finally(() => setCliBusy(null))
  }

  // one service: its name, whether it is connected, what it gives, its own way in
  const service = (s: SetupService, inline?: boolean): React.JSX.Element => {
    let state: React.JSX.Element
    let way: React.JSX.Element
    if ('key' in s.via) {
      const sup = keySupplier(s.via.key)
      const set = !!settings[sup.setting]
      state = chip(set, set ? 'connected' : 'not set')
      way = <KeyRow supplier={sup} set={set} onSaved={readSettings} />
    } else if ('bridge' in s.via) {
      const svc = s.via.bridge
      const mine = rows.filter((r) => r.id === svc)
      const inn = mine.filter((r) => r.loggedIn)
      const row = mine[0]
      const busy = mine.some((r) => r.busy)
      state = inn.length ? chip(true, inn.length > 1 ? `${inn.length} logins` : 'logged in') : row?.blocked ? chip(false, 'not open to apps yet', row.blocked) : chip(false, 'not connected')
      way = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {!inn.length && (
            <span
              className="btn vd-hbtn"
              style={busy || row?.blocked || !row ? { opacity: 0.5, cursor: 'default' } : undefined}
              onClick={() => !busy && row && !row.blocked && void vd().bridgeLogin(svc).then(setRows)}
              title={row?.blocked ?? `log in on ${(row?.site ?? '').replace('https://', '')} — opens your browser, the app stays logged in after`}
            >
              login
            </span>
          )}
          <span className="btn vd-hbtn ghost" onClick={onOpenBridge} title="every login, its credits, and the ＋ that adds another login of the same supplier">
            open the bridge panel
          </span>
          {busy && <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>waiting for the browser login…</span>}
          {!busy && !inn.length && row?.error && <span style={{ fontSize: 11.5, color: 'var(--bad)' }}>{row.error}</span>}
        </div>
      )
    } else if ('cli' in s.via) {
      const c = s.via.cli
      const info = cli[c]
      const n = CLI_NAMES[c]
      state = info === null ? chip(false, 'checking…') : !info.found ? chip('warn', 'not on this PC') : info.loggedIn === false ? chip('warn', 'not signed in') : chip(true, 'signed in', info.detail)
      way = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 11.5 }}>
          {info && !info.found && (
            <span>
              install {n.tool} with <span style={{ fontFamily: 'var(--mono)', color: 'var(--txt-hi)' }}>{n.install}</span>
              {c === 'codex' ? ' (the Codex desktop app carries it too)' : ''}
            </span>
          )}
          {info?.found && info.loggedIn === false && (
            <span
              className="btn vd-hbtn"
              style={cliBusy ? { opacity: 0.5, cursor: 'default' } : undefined}
              onClick={() => !cliBusy && signIn(c)}
              title={c === 'gemini' ? 'opens Gemini CLI in a window — choose Sign in with Google there' : `opens ${n.account}’s sign-in page in your browser — no terminal`}
            >
              sign in to {n.account.toLowerCase()}
            </span>
          )}
          {info?.found && info.loggedIn !== false && <span style={{ color: 'var(--dim)' }}>{info.detail}</span>}
          {info && (!info.found || info.loggedIn === false) && (
            <span className="btn vd-hbtn ghost" onClick={() => (setCli((m) => ({ ...m, [c]: null })), readCli(c, true))} title="look again, after installing or signing in">
              re-check
            </span>
          )}
          {cliBusy === c && <span style={{ color: 'var(--amber)' }}>{c === 'gemini' ? 'choose Sign in with Google in the Gemini CLI window…' : 'finish in your browser…'}</span>}
        </div>
      )
    } else {
      state = chip(false, 'no account')
      way = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <span className="btn vd-hbtn" onClick={onOpenModels} title="each model’s size is on its row; a compatible NVIDIA GPU runs them">
            open the models card
          </span>
        </div>
      )
    }
    return (
      <div key={s.id} data-service={s.id} style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontSize: 12.5, color: 'var(--txt-hi)' }}>{s.name}</b>
          <span style={{ marginLeft: 'auto' }}>{state}</span>
        </div>
        <div data-gives style={{ fontSize: 11.5, color: 'var(--txt)', lineHeight: 1.5, marginTop: 3 }}>
          {inline ? s.gives.join(' · ') : s.gives.map((g, i) => <div key={i}>{g}</div>)}
        </div>
        {way}
      </div>
    )
  }

  const page = at >= 0 ? pages[at] : null
  const pill = (i: number, label: string): React.JSX.Element => (
    <span key={i} className={at === i ? 'btn vd-hbtn' : 'btn vd-hbtn ghost'} data-setup-pill={i} onClick={() => setAt(i)}>
      {label}
    </span>
  )
  return (
    <Modal title="Set up Video Dancer" width={620} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {pill(-1, 'start')}
        {pages.map((p, i) => pill(i, p.title))}
      </div>
      {!page ? (
        <div data-setup-page="start">
          <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 8px' }}>Start with a storyboard, then generate takes when you are ready. Your project lives on your computer.</p>
          <div style={card}>
            <b style={{ fontSize: 12.5, color: 'var(--txt-hi)' }}>Start a storyboard</b>
            <p style={{ fontSize: 12, margin: '4px 0 8px' }}>Arrange shots, write beats, and preview your plan. No account or API key required.</p>
            <span className="btn" onClick={onClose}>
              start storyboarding
            </span>
          </div>
          <div style={card}>
            <b style={{ fontSize: 12.5, color: 'var(--txt-hi)' }}>Connect what you want to use</b>
            <p style={{ fontSize: 12, margin: '4px 0 8px' }}>Every service is optional. Each one is your own key or login, and generations are billed by the service you choose.</p>
            {pages.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '2px 0' }}>
                <span onClick={() => setAt(i)} style={{ color: 'var(--amber)', cursor: 'pointer', width: 120, flex: 'none' }}>
                  {p.title}
                </span>
                <span style={{ color: 'var(--txt)' }}>{p.about}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div data-setup-page={page.id}>
          <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>{page.about}</p>
          <div className="vd-scroll" style={{ maxHeight: '52vh', overflowY: 'auto', paddingRight: 4 }}>{page.services.map((s) => service(s, page.inline))}</div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <span className="btn vd-hbtn ghost" onClick={onOpenSettings} title="every key, the Co-Director’s engine and model, themes">
          all settings
        </span>
        <span style={{ fontSize: 11, color: 'var(--dim)', flex: 1 }}>Keys stay in this computer’s settings, outside your project files.</span>
        {at >= 0 && (
          <span className="btn vd-hbtn ghost" onClick={() => setAt(at - 1)}>
            back
          </span>
        )}
        {at < pages.length - 1 ? (
          <span className="btn vd-hbtn" data-setup-next onClick={() => setAt(at + 1)}>
            next: {pages[at + 1].title}
          </span>
        ) : (
          <span className="btn vd-hbtn" data-setup-done onClick={onClose}>
            done
          </span>
        )}
      </div>
    </Modal>
  )
}
