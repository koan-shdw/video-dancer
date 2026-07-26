import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { confirmDialog } from '../prompt'
import { toast } from '../ui/Toast'
import { ctl } from '../ui/controls'
import { Ic, Cable, Clapperboard, Trash2, Pencil } from '../ui/icons'

// stable fallbacks — a `?? []` INSIDE a zustand selector mints a new array every snapshot and
// infinite-loops React while no project is open
const EMPTY_LOG: CoDirMsg[] = []

// ---- Co-Director: the conversational copilot. You talk; it writes straight into the project
// (clips, beats, styles, links, refs) through main-process tools — every write is undoable and
// tinted as "enhanced" in the forms. The transcript + its brief persist in the project. ----
export function CoDirectorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const log = useStore((s) => s.project?.codir.log ?? EMPTY_LOG)
  const brief = useStore((s) => s.project?.codir.brief ?? '')
  const selectedClipId = useStore((s) => s.selectedClipId)
  const applyDelta = useStore((s) => s.applyDelta)

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [liveTexts, setLiveTexts] = useState<string[]>([]) // assistant text arriving mid-exchange
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [bridge, setBridge] = useState<{ on: boolean; found: boolean | null; model: string }>({ on: false, found: null, model: '' }) // experimental engine
  const [modelLabel, setModelLabel] = useState('')
  const [lastUsage, setLastUsage] = useState<string>('')
  const [showBrief, setShowBrief] = useState(false)
  const [briefDraft, setBriefDraft] = useState(brief)
  const briefDirty = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const libImages = project?.images ?? []

  // readiness — re-runs whenever Settings flips the engine or model (settingsRev), so the header
  // badge is live, never only mount-time truth
  const settingsRev = useStore((s) => s.settingsRev)
  useEffect(() => {
    void window.vidancer.getSettings().then(async (s) => {
      setHasKey(!!s.anthropicKey)
      if (s.codirEngine === 'bridge') {
        const bms = await window.vidancer.codirBridgeModels()
        const bid = (s.codirBridgeModel as string) || bms[0]?.id
        const short = bms.find((m) => m.id === bid)?.label.split(' — ')[0] ?? bid ?? ''
        setBridge({ on: true, found: null, model: short })
        void window.vidancer.codirBridgeStatus().then((b) => setBridge({ on: true, found: b.found, model: short }))
      } else {
        setBridge({ on: false, found: null, model: '' })
      }
      const models = await window.vidancer.codirModels()
      const id = (s.codirModel as string) || models[0]?.id
      setModelLabel(models.find((m) => m.id === id)?.label.split(' — ')[0] ?? id ?? '')
    })
  }, [settingsRev])

  // live progress from main while an exchange runs
  useEffect(
    () =>
      window.vidancer.onCodirProgress((e) => {
        if (e.kind === 'status') setStatus(e.text ?? '')
        if (e.kind === 'text' && e.text) setLiveTexts((a) => [...a, e.text!])
        if (e.kind === 'wrote') {
          setStatus(e.text ?? 'wrote')
          // AI wrote into the project — force open forms to reload from the store instead of
          // clobbering the write with their debounced autosave (same signal undo/redo uses)
          useStore.setState((s) => ({ undoTick: s.undoTick + 1 }))
        }
      }),
    []
  )

  // keep the transcript pinned to the bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length, liveTexts.length, pendingUser, status])

  // brief editing (debounced, same 600ms house rhythm)
  useEffect(() => {
    if (!briefDirty.current) setBriefDraft(brief)
  }, [brief])
  useEffect(() => {
    if (!briefDirty.current) return
    const t = window.setTimeout(() => {
      briefDirty.current = false
      void window.vidancer.codirSetBrief(briefDraft).then((d) => applyDelta(d))
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefDraft])

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setInput(val)
    const pos = e.target.selectionStart ?? val.length
    const m = val.slice(0, pos).match(/@(\w*)$/)
    setMention(m ? { start: pos - m[0].length, query: m[1].toLowerCase() } : null)
  }
  const pickMention = (title: string): void => {
    if (!mention) return
    const ta = taRef.current
    const pos = ta?.selectionStart ?? input.length
    const next = input.slice(0, mention.start) + title + ' ' + input.slice(pos)
    setInput(next)
    setMention(null)
    setTimeout(() => {
      ta?.focus()
      const c = (input.slice(0, mention.start) + title + ' ').length
      ta?.setSelectionRange(c, c)
    }, 0)
  }
  const mentionMatches = mention ? libImages.filter((i) => i.title.toLowerCase().includes(mention.query)).slice(0, 8) : []

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMention(null)
    setBusy(true)
    setPendingUser(text)
    setLiveTexts([])
    setStatus('thinking…')
    // any @title in the text ships its image so the model can SEE it
    const imageIds = (text.match(/@\w+/g) ?? [])
      .map((t) => libImages.find((i) => i.title === t)?.id)
      .filter((x): x is string => !!x)
    const focus = useStore.getState().focusField
    try {
      const r = await window.vidancer.codirSend({ text, imageIds, selectedClipId, focus })
      if (r.logDelta) applyDelta(r.logDelta)
      if (!r.ok && r.error && r.error !== 'cancelled') toast(`Co-Director: ${r.error}`, { kind: 'error' })
      if (r.usage) {
        const u = r.usage
        setLastUsage(`last: ${u.rounds} round${u.rounds > 1 ? 's' : ''} · in ${(u.inputTokens / 1000).toFixed(1)}k (${(u.cacheReadTokens / 1000).toFixed(1)}k cached) · out ${(u.outputTokens / 1000).toFixed(1)}k tokens`)
      }
    } catch (err) {
      // an exchange must NEVER fail silently — surface it and free the panel
      toast(`Co-Director: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' })
    } finally {
      setBusy(false)
      setPendingUser(null)
      setLiveTexts([])
      setStatus('')
      useStore.setState((s) => ({ undoTick: s.undoTick + 1 })) // final reload of any open forms
    }
  }

  const clearLog = async (): Promise<void> => {
    if (await confirmDialog('Clear the Co-Director conversation? Its writes stay in the project (undoable with Ctrl+Z as usual).', { confirmLabel: 'Clear', danger: true }))
      applyDelta(await window.vidancer.codirClearLog())
  }

  if (!project) {
    return (
      <div className="vd-panel vd-monitor">
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>open a project to talk to the Co-Director</span>
      </div>
    )
  }

  const bubble = (role: 'user' | 'assistant', text: string, key: string | number, ghost?: boolean): React.JSX.Element => (
    <div key={key} style={{ display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 6, opacity: ghost ? 0.75 : 1 }}>
      <div
        style={{
          maxWidth: '86%',
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          background: role === 'user' ? 'color-mix(in srgb, var(--amber) 16%, var(--panel))' : 'var(--panel)',
          border: '1px solid var(--line)',
          color: 'var(--txt)'
        }}
      >
        {text}
      </div>
    </div>
  )

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* header: brief toggle + clear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: 1 }}>
          <Ic i={Clapperboard} size={12} /> Co-Director
        </span>
        {bridge.on ? (
          // the little bridge badge: this conversation runs on the user's local Claude Code, not the API
          <span
            style={{ fontSize: 10, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
            title="Bridge mode (experimental) — powered by your local Claude Code on your subscription. Switch back in Settings → experimental."
          >
            <Ic i={Cable} size={11} /> bridge{bridge.model ? ` · ${bridge.model}` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>{modelLabel}</span>
        )}
        <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setShowBrief((v) => !v)} title="the Co-Director's standing note about this project — it reads this every exchange; you can edit it">
          <Ic i={Pencil} size={11} /> brief
        </span>
        <span className="btn vd-hbtn" onClick={() => void clearLog()} title="clear the conversation (project writes stay)">
          <Ic i={Trash2} size={11} />
        </span>
      </div>
      {showBrief && (
        <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
          <textarea
            value={briefDraft}
            onChange={(e) => {
              briefDirty.current = true
              setBriefDraft(e.target.value)
            }}
            rows={3}
            placeholder="project decisions the Co-Director should always remember — it maintains this itself, you can correct it"
            style={{ ...ctl, width: '100%', resize: 'vertical', fontSize: 11 }}
          />
        </div>
      )}

      {/* transcript */}
      <div ref={scrollRef} className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 8 }}>
        {log.length === 0 && !pendingUser && (
          <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.6, padding: '8px 4px' }}>
            Direct the project in plain language — I write straight into the fields (marked with a tint until you edit them).
            <br />• &quot;This project is 90s hand-drawn anime, exaggerated movement — set up a style for it.&quot;
            <br />• &quot;@hero runs along @bridge_bg dodging falling rocks, looks at camera and smiles. Fill the clip I&apos;m on, build the beats.&quot;
            <br />• &quot;Change just the cameras — slower, more locked-off.&quot;
            <br />
            <span style={{ color: 'var(--muted)' }}>Type @ to reference Library images (I can see them) · I use styles as links so your project stays dynamic.</span>
          </div>
        )}
        {!bridge.on && hasKey === false && (
          <div style={{ fontSize: 11.5, color: 'var(--amber)', padding: '4px 4px 8px' }}>
            ⚠ no Anthropic key set — add one in Settings to use the Co-Director.
          </div>
        )}
        {bridge.on && bridge.found === false && (
          <div style={{ fontSize: 11.5, color: 'var(--amber)', padding: '4px 4px 8px' }}>
            ⚠ bridge mode is on but Claude Code wasn’t found — install/log in via Settings → experimental, or toggle the bridge off.
          </div>
        )}
        {log.map((m, i) => bubble(m.role, m.text, i))}
        {pendingUser && bubble('user', pendingUser, 'pending')}
        {liveTexts.map((t, i) => bubble('assistant', t, `live-${i}`, true))}
        {busy && (
          <div style={{ fontSize: 10.5, color: 'var(--dim)', fontFamily: 'var(--mono)', padding: '2px 4px' }}>
            <span className="vd-spin" style={{ display: 'inline-block', marginRight: 6 }}>◐</span>
            {status || 'working…'}
          </div>
        )}
      </div>

      {/* input */}
      <div style={{ padding: 8, borderTop: '1px solid var(--line)', position: 'relative' }}>
        {mentionMatches.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: 8, right: 8, zIndex: 30, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 140, overflow: 'auto' }}>
            {mentionMatches.map((im) => (
              <div key={im.id} onMouseDown={(e) => { e.preventDefault(); pickMention(im.title) }} style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: 'var(--gold)' }}>
                {im.title}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          onChange={onInput}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !mention) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={busy ? 'working… — type your next direction, send when done' : 'direct me — @ to reference Library images · Enter to send, Shift+Enter for a new line'}
          rows={2}
          style={{ ...ctl, width: '100%', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {busy ? (
            <span className="btn vd-hbtn" onClick={() => void window.vidancer.codirCancel()}>✕ cancel</span>
          ) : (
            <span className="btn" style={{ opacity: input.trim() ? 1 : 0.5 }} onClick={() => void send()}>send</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{lastUsage}</span>
        </div>
      </div>
    </div>
  )
}
