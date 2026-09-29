import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mentionMatches as mentionMatchesOf } from '../lib/disabledItems'
import { confirmDialog } from '../prompt'
import { ctl } from '../ui/controls'
import { Ic, Cable, Clapperboard, Theater, Trash2, Pencil, Minimize2 } from '../ui/icons'
import { ResizeHandle } from '../ui/ResizeHandle'
import { toast } from '../ui/Toast'
import { HeatMeter } from '../ui/HeatMeter'
import { MoodFold, MoodSuggest } from '../ui/MoodFold'
import { caretPosInTextarea } from '../ui/caret'

// stable fallbacks — a `?? []` INSIDE a zustand selector mints a new array every snapshot and
// infinite-loops React while no project is open
const EMPTY_LOG: CoDirMsg[] = []
const PANEL_FONTS = [12, 14, 16.5] // chat type scale — the room's A−/A+, dock-sized

// ---- Co-Director: the conversational copilot. You talk; it writes straight into the project
// (clips, beats, styles, links, refs) through main-process tools — every write is undoable and
// tinted as "enhanced" in the forms. The transcript + its brief persist in the project. ----
export function CoDirectorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const log = useStore((s) => s.project?.codir.log ?? EMPTY_LOG)
  const brief = useStore((s) => s.project?.codir.brief ?? '')
  const applyDelta = useStore((s) => s.applyDelta)

  const [input, setInput] = useState('')
  // a seed from another panel (Watched "send to Co-Director", CIVIT-LIKES-SPEC): lands in the box, focus after it
  const codirSeed = useStore((s) => s.codirSeed)
  useEffect(() => {
    if (!codirSeed) return
    setInput((v) => (v.trim() ? `${v.replace(/\s+$/, '')} ${codirSeed}` : codirSeed))
    useStore.getState().setCodirSeed(null)
    window.setTimeout(() => taRef.current?.focus(), 0)
  }, [codirSeed])
  // the exchange itself lives in the store (codirRun) — the Director's Room renders the same run
  const { busy, status, liveTexts, pendingUser, lastUsage, lastUsageTip } = useStore((s) => s.codirRun)
  const tetherOpen = useStore((s) => s.tetherOpen)
  const setTetherOpen = useStore((s) => s.setTetherOpen)
  // HEAT persists in settings — mirror it into the store once (the meter's two views read the store)
  useEffect(() => {
    void vd()
      .getSettings()
      .then((s) => {
        const h = s?.codirHeat
        if (h === 'auto' || (typeof h === 'number' && h >= 1 && h <= 5)) useStore.setState({ codirHeat: h })
      })
  }, [])
  const queue = useStore((s) => s.codirQueue)
  const codirQueueRemove = useStore((s) => s.codirQueueRemove)
  const codirSendText = useStore((s) => s.codirSendText)
  const setRoomOpen = useStore((s) => s.setRoomOpen)
  const [mention, setMention] = useState<{ start: number; query: string; kind?: 'image' | 'mood' } | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [bridge, setBridge] = useState<{ on: boolean; found: boolean | null; model: string }>({ on: false, found: null, model: '' }) // experimental engine
  const [modelLabel, setModelLabel] = useState('')
  const [showBrief, setShowBrief] = useState(false)
  const [fontIdx, setFontIdx] = useState(0)
  const [inputH, setInputH] = useState(0) // 0 = natural (rows=2); the handle above grows it UPWARD
  const [briefDraft, setBriefDraft] = useState(brief)
  const briefDirty = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const libImages = project?.images ?? []
  const fs = PANEL_FONTS[fontIdx]

  // readiness — re-runs whenever Settings flips the engine or model (settingsRev), so the header
  // badge is live, never only mount-time truth
  const settingsRev = useStore((s) => s.settingsRev)
  useEffect(() => {
    void vd().getSettings().then(async (s) => {
      setHasKey(!!s.anthropicKey)
      if (s.codirEngine === 'bridge') {
        const bms = await vd().codirBridgeModels()
        // an unsaved OR no-longer-offered id lands on the first entry — never show a raw model id
        const bEntry = bms.find((m) => m.id === (s.codirBridgeModel as string)) ?? bms[0]
        const short = bEntry?.label.split(' — ')[0] ?? ''
        setBridge({ on: true, found: null, model: short })
        void vd().codirBridgeStatus().then((b) => setBridge({ on: true, found: b.found, model: short }))
      } else {
        setBridge({ on: false, found: null, model: '' })
      }
      const models = await vd().codirModels()
      const entry = models.find((m) => m.id === (s.codirModel as string)) ?? models[0]
      setModelLabel(entry?.label.split(' — ')[0] ?? '')
    })
  }, [settingsRev])

  // (live progress is subscribed ONCE at App level and lands in the store's codirRun)

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
      void vd().codirSetBrief(briefDraft).then((d) => applyDelta(d))
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefDraft])

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setInput(val)
    const pos = e.target.selectionStart ?? val.length
    // @ = a Library image · # = a MOOD for this one message (MOODS-VMD-SPEC §5)
    const m = val.slice(0, pos).match(/([@#])([\w-]*)$/)
    setMention(m ? { start: pos - m[0].length, query: m[2].toLowerCase(), kind: m[1] === '#' ? 'mood' : 'image' } : null)
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
  const moods = useStore((s) => s.moods)
  const mentionMatches =
    mention && mention.kind !== 'mood'
      ? mentionMatchesOf(libImages, mention.query)
      : mention
        ? moods.filter((md) => md.slug.includes(mention.query) || md.name.toLowerCase().includes(mention.query)).slice(0, 8).map((md) => ({ id: md.slug, title: `#${md.slug}` }))
        : []

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setMention(null)
    await codirSendText(text) // the shared store path — the Room sees this exchange too; mid-run it queues
  }

  const clearLog = async (): Promise<void> => {
    if (await confirmDialog('Clear the Co-Director conversation? Its writes stay in the project (undoable with Ctrl+Z as usual).', { confirmLabel: 'Clear', danger: true }))
      applyDelta(await vd().codirClearLog())
  }

  // COMPACT (spec 2026-08-27): fold the older conversation into the brief + a digest — one
  // press, undoable; the raw log stays on disk. Deltas arrive over project:delta as usual.
  const [compacting, setCompacting] = useState(false)
  const compact = async (): Promise<void> => {
    if (compacting || busy) return
    setCompacting(true)
    try {
      const r = await vd().codirCompact()
      toast(r.ok ? `folded ${r.folded} messages into the brief + a digest` : r.error ?? 'compact failed', { kind: r.ok ? 'ok' : 'error' })
    } finally {
      setCompacting(false)
    }
  }

  if (!project) {
    return (
      <EmptyState>open a project to talk to the Co-Director</EmptyState>
    )
  }

  const bubble = (role: 'user' | 'assistant', text: string, key: string | number, ghost?: boolean): React.JSX.Element => (
    <div key={key} style={{ display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 6, opacity: ghost ? 0.75 : 1 }}>
      <div
        className="vd-copy"
        style={{
          maxWidth: '86%',
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: fs,
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
      {/* header — three rows (director 2026-09-08: the title wrapped and the engine stacked in a
          sliver): title · engine + model on its own row · the buttons on a row that wraps cleanly */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }}>
          <Ic i={Clapperboard} size={12} /> Co-Director
        </span>
        {bridge.on ? (
          // the little bridge badge: this conversation runs on the user's local Claude Code, not the API
          <span
            style={{ fontSize: 10, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}
            title="Bridge mode (experimental) — powered by your local Claude Code on your subscription. Switch back in Settings → experimental."
          >
            <Ic i={Cable} size={11} /> bridge{bridge.model ? ` · ${bridge.model}` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{modelLabel}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span className="btn vd-hbtn" style={{ opacity: fontIdx === 0 ? 0.4 : 1 }} onClick={() => setFontIdx((v) => Math.max(0, v - 1))} title="smaller type">
          A−
        </span>
        <span className="btn vd-hbtn" style={{ opacity: fontIdx === PANEL_FONTS.length - 1 ? 0.4 : 1 }} onClick={() => setFontIdx((v) => Math.min(PANEL_FONTS.length - 1, v + 1))} title="bigger type">
          A+
        </span>
        <span
          className="btn vd-hbtn"
          onClick={() => setRoomOpen(true)}
          title="the Director's Room — this conversation full screen: big type, the images on the wall, writes landing live, open questions"
        >
          <Ic i={Theater} size={11} /> room
        </span>
        <span className="btn vd-hbtn" style={tetherOpen ? { color: 'var(--amber)' } : undefined} onClick={() => setTetherOpen(!tetherOpen)} title="the TETHER — a floating window you park beside a field, a beat, a sheet, an image or a clip; that becomes “this one” (Shift+D)">
          ⌖ tether
        </span>
        <span className="btn vd-hbtn" onClick={() => setShowBrief((v) => !v)} title="the Co-Director's standing note about this project — it reads this every exchange; you can edit it">
          <Ic i={Pencil} size={11} /> brief
        </span>
        <span
          className="btn vd-hbtn"
          style={compacting || busy ? { opacity: 0.4, cursor: 'default' } : undefined}
          onClick={() => void compact()}
          title="COMPACT — fold the older conversation into the brief + a digest; the raw log stays, undo reverts it"
        >
          <Ic i={Minimize2} size={11} /> {compacting ? '…' : 'compact'}
        </span>
        <span className="btn vd-hbtn" onClick={() => void clearLog()} title="clear the conversation (project writes stay)">
          <Ic i={Trash2} size={11} />
        </span>
        </div>
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
          <div style={{ fontSize: fs - 0.5, color: 'var(--dim)', lineHeight: 1.6, padding: '8px 4px' }}>
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
        <CliTooOldBanner />
        {busy && (
          <div style={{ fontSize: 10.5, color: 'var(--dim)', fontFamily: 'var(--mono)', padding: '2px 4px' }}>
            <span className="vd-spin" style={{ display: 'inline-block', marginRight: 6 }}>◐</span>
            {status || 'working…'}
          </div>
        )}
      </div>

      {/* input — the native corner grip grew the box DOWNWARD with no room below (his catch
          2026-09-01); the house handle sits on top instead and drags UP, transcript gives way */}
      <div style={{ padding: '0 8px 8px', borderTop: '1px solid var(--line)', position: 'relative' }}>
        <ResizeHandle value={inputH || 54} min={54} invert maxOf={() => Math.min(420, window.innerHeight * 0.5)} onChange={setInputH} title="drag up to grow the typing box" />
        {/* Waiting messages stay removable and go together after the current reply. */}
        {queue.map((q) => (
          <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 8px', marginBottom: 4, borderRadius: 6, background: 'var(--field)', border: '1px dashed var(--line2)' }}>
            <span style={{ fontSize: 8, fontFamily: 'var(--mono)', letterSpacing: 1.2, color: 'var(--amber)' }}>QUEUED</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={q.text}>
              {q.text}
            </span>
            <span style={{ cursor: 'pointer', color: 'var(--dim)', fontSize: 11 }} onClick={() => codirQueueRemove(q.id)} title="drop this queued message">
              ✕
            </span>
          </div>
        ))}
        {/* MOODS fold ABOVE the intensity pill (MOODS-VMD-SPEC §5), then the "it comes up" chip */}
        <MoodFold />
        <MoodSuggest text={input} />
        {/* INTENSITY meter above the prompt (director, 2026-09-08) — the same meter the tether shows */}
        <div style={{ padding: '2px 0 4px' }}>
          <HeatMeter />
        </div>
        {mentionMatches.length > 0 && (() => {
          // hang the list off the @ being typed, not off the box edge
          const ta = taRef.current
          const c = ta && mention ? caretPosInTextarea(ta, mention.start) : null
          const anchor: React.CSSProperties = c && ta
            ? { left: Math.min(ta.offsetLeft + c.x, Math.max(0, (ta.offsetLeft + ta.offsetWidth) - 220)), top: ta.offsetTop + c.y + c.lineH + 2, width: 220 }
            : { bottom: '100%', left: 8, right: 8 }
          return (
          <div style={{ position: 'absolute', zIndex: 30, ...anchor, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 140, overflow: 'auto' }}>
            {mentionMatches.map((im) => (
              <div key={im.id} onMouseDown={(e) => { e.preventDefault(); pickMention(im.title) }} style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: 'var(--gold)' }}>
                {im.title}
              </div>
            ))}
          </div>
          )
        })()}
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
          placeholder={busy ? 'working… — queued messages go together after this reply' : 'direct me — @ to reference Library images · Enter to send, Shift+Enter for a new line'}
          rows={2}
          style={{ ...ctl, width: '100%', resize: 'none', ...(inputH ? { height: inputH } : {}) }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {busy && <span className="btn vd-hbtn" onClick={() => void vd().codirCancel()}>✕ cancel</span>}
          <span className="btn" style={{ opacity: input.trim() ? 1 : 0.5 }} onClick={() => void send()}>
            {busy ? 'queue' : 'send'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--dim)', fontFamily: 'var(--mono)' }} title={lastUsageTip}>{lastUsage}</span>
        </div>
      </div>
    </div>
  )
}

// 2026-09-29: the installed Claude Code is too old for the picked model — say it plainly and
// offer the update; the store re-sends the waiting message once it lands (panel + Room)
export function CliTooOldBanner({ fontSize = 11.5, shadow }: { fontSize?: number; shadow?: boolean }): React.JSX.Element | null {
  const t = useStore((s) => s.codirCliTooOld)
  const busy = useStore((s) => s.codirRun.busy)
  const update = useStore((s) => s.updateClaudeCode)
  if (!t) return null
  return (
    <div style={{ fontSize, color: 'var(--amber)', padding: '4px 4px 8px', ...(shadow ? { textShadow: '0 1px 8px rgba(0,0,0,.8)' } : {}) }}>
      ⚠ Claude Code {t.have} is too old for this model. It needs {t.need} or newer.{' '}
      <span className="btn vd-hbtn" style={{ opacity: busy ? 0.4 : 1, pointerEvents: busy ? 'none' : undefined }} onClick={() => void update()} title="runs the Claude Code update for you, then sends your message again">
        update claude code
      </span>
    </div>
  )
}
