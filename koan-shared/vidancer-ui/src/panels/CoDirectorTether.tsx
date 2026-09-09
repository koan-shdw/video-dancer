import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { HeatMeter } from '../ui/HeatMeter'
import { nearestTarget, rectOf, visibleRect, labelOf, writable, proposalsOf, sameRef, targetAtPoint, tetherPoint, Rope, type FocusRef } from '../lib/tether'

// ---- the TETHER window (docs/CODIRECTOR-TETHER-SPEC-2026-09-08.md): a floating third view of
// the one Co-Director conversation that gives him ATTENTION — a line to the nearest target
// (field · holder · whole thing), a ⌖ to pin one by hand, a mini prompt that asks for
// proposals, commit buttons that write them through the app's own field writers. Shift+D. ----

const LS_BOX = 'vd-tether-box'
type Box = { x: number; y: number; w: number; h: number }
const DEFAULT_BOX: Box = { x: 140, y: 120, w: 340, h: 280 }
const Z_LINE = 1789
const Z_WIN = 1790

function loadBox(): Box {
  try {
    const raw = localStorage.getItem(LS_BOX)
    if (raw) {
      const b = JSON.parse(raw) as Partial<Box>
      if (typeof b.x === 'number' && typeof b.y === 'number') return { ...DEFAULT_BOX, ...b }
    }
  } catch {
    /* storage unavailable — defaults */
  }
  return DEFAULT_BOX
}
function saveBox(b: Box): void {
  try {
    localStorage.setItem(LS_BOX, JSON.stringify(b))
  } catch {
    /* ignore */
  }
}
const clampBox = (b: Box): Box => ({ ...b, x: Math.max(0, Math.min(b.x, window.innerWidth - 80)), y: Math.max(0, Math.min(b.y, window.innerHeight - 40)) })

export function CoDirectorTether(): React.JSX.Element | null {
  const open = useStore((s) => s.tetherOpen)
  const setOpen = useStore((s) => s.setTetherOpen)
  const pin = useStore((s) => s.tetherPin)
  const setPin = useStore((s) => s.setTetherPin)
  const focus = useStore((s) => s.focusField)
  const setFocus = useStore((s) => s.setFocusField)
  const project = useStore((s) => s.project)
  const log = useStore((s) => s.project?.codir.log)
  const { busy, status } = useStore((s) => s.codirRun)
  const codirSendText = useStore((s) => s.codirSendText)
  const saveClipPromptData = useStore((s) => s.saveClipPromptData)
  const saveStyle = useStore((s) => s.saveStyle)
  const saveCharSheet = useStore((s) => s.saveCharSheet)

  const [box, setBox] = useState<Box>(loadBox)
  const [line, setLine] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; rect: DOMRect } | null>(null)
  const [text, setText] = useState('')
  const [pinCursor, setPinCursor] = useState<{ x: number; y: number } | null>(null) // ⌖ mid-drag: the line follows the cursor
  const anchorRef = useRef<HTMLSpanElement>(null)
  const winRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const scanPending = useRef(false) // one scan per frame while dragging, not one per mouse event
  const pinDrag = useRef<{ x0: number; y0: number; moved: boolean } | null>(null)
  // ⌖ click BREAKS the string: no tether, no focus, until the window next moves (then nearest again)
  const broken = useRef(false)
  // the EXACT element a pin was dropped on — the same beat has a band in Clip Gen AND in the Clip
  // Monitor with the same tag; the string must stay on the one that was dragged to
  const pinEl = useRef<Element | null>(null)
  // the target each ask was FOR — its proposals commit there, whatever the tether does meanwhile;
  // askAt gates the cards: only a reply that came AFTER a tether ask can carry proposals (a fenced
  // YAML quote in normal chat must never grow commit buttons)
  const [askTarget, setAskTarget] = useState<FocusRef | null>(null)
  const [askAt, setAskAt] = useState(0)
  // the string: a verlet rope painted imperatively every frame (no React re-render per frame)
  const rope = useRef(new Rope())
  const pathRef = useRef<SVGPathElement>(null)
  const endsRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)

  // one scan: pinned target → its rect; else the nearest within reach → focus; nothing → none
  const scan = useCallback((): void => {
    const a = anchorRef.current?.getBoundingClientRect()
    if (!a) return
    const anchor = { x: a.left + a.width / 2, y: a.top + a.height / 2 }
    const st = useStore.getState()
    if (broken.current) {
      if (st.focusField) st.setFocusField(null)
      return setLine(null)
    }
    if (st.tetherPin) {
      // a field click elsewhere moves focusField — while pinned, the pin IS "this one", always
      if (!sameRef(st.focusField, st.tetherPin)) st.setFocusField(st.tetherPin)
      const r = pinEl.current?.isConnected ? visibleRect(pinEl.current) : rectOf(st.tetherPin)
      if (r && r.width > 0) return setLine({ from: anchor, to: tetherPoint(r, anchor), rect: r })
      return setLine(null) // pinned thing scrolled away / not on screen — keep the pin, hide the string
    }
    // reach is measured from the WINDOW's edges, not the ⌖ dot — parking beside something counts
    const win = winRef.current?.getBoundingClientRect()
    const hit = nearestTarget(win ? { left: win.left, top: win.top, right: win.right, bottom: win.bottom } : { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y })
    if (hit) {
      if (!sameRef(st.focusField, hit.ref)) st.setFocusField(hit.ref)
      setLine({ from: anchor, to: tetherPoint(hit.rect, anchor), rect: hit.rect })
    } else {
      if (st.focusField) st.setFocusField(null)
      setLine(null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    scan()
    const onAny = (): void => void requestAnimationFrame(scan)
    window.addEventListener('scroll', onAny, true)
    window.addEventListener('resize', onAny)
    const iv = window.setInterval(scan, 400) // layouts move without scroll events (panels, folds)
    return () => {
      window.removeEventListener('scroll', onAny, true)
      window.removeEventListener('resize', onAny)
      window.clearInterval(iv)
    }
    // NOT keyed on box: the drag handler schedules its own per-frame scan; re-arming the
    // listeners + interval on every mouse move was a layout storm
  }, [open, scan])

  // header drag moves the window; ⌖ drag pins a target (a click un-pins)
  useEffect(() => {
    if (!open) return
    const move = (e: MouseEvent): void => {
      const d = drag.current
      if (d) {
        broken.current = false // moving the window re-arms proximity after a break
        // read the offset NOW — the updater runs later, when mouse-up may already have nulled it
        // (that null read took the whole React tree down: the grey screen, 2026-09-08)
        const x = e.clientX - d.dx
        const y = e.clientY - d.dy
        setBox((b) => clampBox({ ...b, x, y }))
        if (!scanPending.current) {
          scanPending.current = true
          requestAnimationFrame(() => {
            scanPending.current = false
            scan()
          })
        }
      }
      if (pinDrag.current) {
        if (Math.hypot(e.clientX - pinDrag.current.x0, e.clientY - pinDrag.current.y0) > 4) pinDrag.current.moved = true
        if (pinDrag.current.moved) setPinCursor({ x: e.clientX, y: e.clientY })
      }
    }
    const up = (e: MouseEvent): void => {
      if (drag.current) {
        drag.current = null
        setBox((b) => {
          saveBox(b)
          return b
        })
      }
      if (pinDrag.current) {
        const moved = pinDrag.current.moved
        pinDrag.current = null
        setPinCursor(null)
        if (moved) {
          // a rect hit-test, deepest target wins — hover layers can't swallow it
          const hit = targetAtPoint(e.clientX, e.clientY)
          if (hit) {
            broken.current = false
            pinEl.current = hit.el
            setPin(hit.ref)
          }
        } else {
          // a plain click = BREAK the string — gone until the window moves again
          broken.current = true
          pinEl.current = null
          setPin(null)
          rope.current.reset()
        }
        requestAnimationFrame(scan)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [open, setPin, scan])

  // the string's frame loop: step the rope between the live ends and paint the path
  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      const ends = endsRef.current
      const el = pathRef.current
      if (ends && el) {
        rope.current.step(ends.a, ends.b, dt)
        el.setAttribute('d', rope.current.path())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Escape closes (drops tether + focus, spec §9)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const target: FocusRef | null = pin ?? focus
  const label = target ? labelOf(target, project) : 'nothing in reach — drag me beside a field, or ⌖ onto one'
  const lastReply = [...(log ?? [])].reverse().find((m) => m.role === 'assistant')
  const proposals = lastReply && askAt && lastReply.at >= askAt ? proposalsOf(lastReply.text) : []
  // proposals commit to the target they were ASKED for (the tether may have moved since)
  const commitTarget: FocusRef | null = askTarget ?? target
  const canCommit = !!commitTarget && writable(commitTarget)
  const commitLabel = commitTarget ? labelOf(commitTarget, project) : ''

  const send = (): void => {
    const t = text.trim()
    if (!t) return
    const where = target ? labelOf(target, project) : 'nothing tethered — answer in general'
    setAskTarget(target)
    setAskAt(Date.now())
    // talk normally by default; proposals only when asked for options/rewrites — and a fenced
    // block holds ONLY the field text, so a commit writes exactly that (director, 2026-09-08)
    codirSendText(
      `⌖ ${where} — ${t}\n(app: sent from the tether, which is parked on that target. Answer normally. Only if the user asks for options, versions, proposals or a rewrite: give up to three, each as its own fenced code block containing ONLY the text that would go into the field — labels and notes outside the fences — and write nothing yourself; the user commits by hand.)`
    )
    setText('')
  }

  // commit = the app writes the proposal through its own field writer (undoable), never the model
  const commit = async (proposal: string): Promise<void> => {
    const target = commitTarget
    if (!target || !writable(target) || !project) return
    const path = target.path!
    const key = path.split('.').pop() ?? ''
    if (target.kind === 'clip') {
      const c = project.clips.find((x) => x.id === target.ownerId)
      if (!c) return
      const pd = c.promptData
      const patch: Partial<PromptData> = {}
      if (path === 'freeform') patch.freeform = proposal
      else if (path.startsWith('scene.')) patch.scene = { ...pd.scene, [key]: proposal }
      else if (path.startsWith('production.')) patch.production = { ...pd.production, [key]: proposal }
      else if (path.startsWith('beats.')) {
        const bid = path.split('.')[1]
        patch.beats = pd.beats.map((b) => (b.id === bid ? { ...b, [key]: proposal } : b))
      } else if (path.startsWith('characters.')) {
        const idx = Number(path.split('.')[1])
        patch.characters = pd.characters.map((ch, i) => (i === idx ? { ...ch, [key]: proposal } : ch))
      } else return void toast(`can't commit into ${path}`, { kind: 'error' })
      patch.enhanced = Array.from(new Set([...(pd.enhanced ?? []), path]))
      await saveClipPromptData(c.id, patch)
    } else if (target.kind === 'imagegen') {
      // Image Gen (KREA2-LOCAL-SPEC §14.3): the one field — the prompt — through the panel's own writer
      if (path !== 'prompt') return void toast(`can't commit into ${path}`, { kind: 'error' })
      await useStore.getState().saveImageGen(target.ownerId, { recipe: { prompt: proposal } })
    } else if (target.kind === 'style') {
      const st = project.styles.find((x) => x.id === target.ownerId)
      if (!st) return
      if (path.startsWith('scene.')) await saveStyle(st.id, { scene: { ...st.scene, [key]: proposal }, enhanced: Array.from(new Set([...(st.enhanced ?? []), path])) })
      else if (path.startsWith('production.')) await saveStyle(st.id, { production: { ...st.production, [key]: proposal }, enhanced: Array.from(new Set([...(st.enhanced ?? []), path])) })
      else return void toast(`can't commit into ${path}`, { kind: 'error' })
    } else if (target.kind === 'sheet') {
      const sh = project.charSheets.find((x) => x.id === target.ownerId)
      if (!sh || !path.startsWith('character.')) return
      await saveCharSheet(sh.id, { character: { ...sh.character, [key]: proposal } })
    }
    // the open form (Clip Gen / Style / Sheet) holds live state — bump undoTick so it reloads from
    // the project, exactly as the Co-Director's own writes do; without it the field looks unchanged
    // and the form's next autosave would write the old text back
    useStore.setState((s) => ({ undoTick: s.undoTick + 1 }))
    toast(`committed → ${labelOf(target, project)}`, { kind: 'ok' })
  }

  const lineTo = pinCursor ?? line?.to ?? null
  const from = line?.from ?? (anchorRef.current ? { x: anchorRef.current.getBoundingClientRect().left + 8, y: anchorRef.current.getBoundingClientRect().top + 8 } : null)
  endsRef.current = from && lineTo ? { a: from, b: lineTo } : null
  if (!endsRef.current) rope.current.reset()

  return createPortal(
    <>
      {/* the tether line + the target's ring — pointer-transparent, under the window */}
      {from && lineTo && (
        <svg style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: Z_LINE }}>
          {line && !pinCursor && <rect x={line.rect.left - 2} y={line.rect.top - 2} width={line.rect.width + 4} height={line.rect.height + 4} rx={4} fill="none" stroke="var(--amber)" strokeWidth={1.5} opacity={0.85} />}
          {/* KOAN.live wire look: 1.5pt at 55%, a 3pt dot on each anchor */}
          <path ref={pathRef} fill="none" stroke="var(--amber)" strokeOpacity={0.55} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pinCursor ? '4 4' : undefined} />
          <circle cx={from.x} cy={from.y} r={3} fill="var(--amber)" />
          <circle cx={lineTo.x} cy={lineTo.y} r={3} fill="var(--amber)" />
        </svg>
      )}
      <div
        ref={winRef}
        style={{ position: 'fixed', left: box.x, top: box.y, width: box.w, height: box.h, zIndex: Z_WIN, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontSize: 11 }}
      >
        {/* header: drag handle · ⌖ · target · heat · ✕ */}
        <div
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-nodrag]')) return
            drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y }
            e.preventDefault()
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderBottom: '1px solid var(--line)', background: 'var(--raised)', cursor: 'grab', userSelect: 'none' }}
        >
          <span
            ref={anchorRef}
            data-nodrag
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              pinDrag.current = { x0: e.clientX, y0: e.clientY, moved: false }
            }}
            title={pin ? 'pinned — click = back to nearest · drag onto anything to pin it there' : 'nearest wins — drag me onto a field, a beat, a sheet, an image, a clip to pin the tether there'}
            style={{ width: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: pin ? 'var(--on-accent)' : 'var(--amber)', background: pin ? 'var(--amber)' : 'transparent', border: '1px solid var(--amber)', cursor: 'crosshair', fontSize: 13, lineHeight: 1 }}
          >
            ⌖
          </span>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: target ? 'var(--txt-hi)' : 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 10 }} title={label}>
            {label}
          </span>
          <span data-nodrag className="btn vd-hbtn" onClick={() => setOpen(false)} title="hide (Shift+D) — drops the tether and the focus">
            ✕
          </span>
        </div>

        {/* body: the last reply with commit buttons, then the mini prompt */}
        <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {busy ? (
            <div style={{ color: 'var(--dim)' }}>⏳ {status || 'thinking…'}</div>
          ) : lastReply ? (
            proposals.length > 0 ? (
              // three separate cards, each its own proposal + commit — never one block to read across
              <>
                {proposals.map((p, i) => (
                  <div key={i} style={{ border: '1px solid var(--line2)', borderRadius: 6, padding: 6, background: 'var(--panel)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--amber)', textTransform: 'uppercase' }}>proposal {i + 1}</span>
                      <span
                        className="btn vd-hbtn"
                        style={{ marginLeft: 'auto', ...(canCommit ? {} : { opacity: 0.4, cursor: 'default' }) }}
                        title={canCommit ? `write this into ${commitLabel} (undoable)` : 'commit needs a field target — a section or a whole thing is context only'}
                        onClick={() => canCommit && void commit(p)}
                      >
                        commit
                      </span>
                    </div>
                    <pre className="vd-copy" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 10.5, color: 'var(--body)' }}>{p}</pre>
                  </div>
                ))}
                {lastReply.text.replace(/```[\s\S]*?```/g, '').trim() && (
                  <pre className="vd-copy" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 10, color: 'var(--dim)' }}>{lastReply.text.replace(/```[\s\S]*?```/g, '').trim()}</pre>
                )}
              </>
            ) : (
              <pre className="vd-copy" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 10.5, color: 'var(--body)' }}>{lastReply.text}</pre>
            )
          ) : (
            <div style={{ color: 'var(--dim)' }}>park me beside something and ask.</div>
          )}
        </div>
        {/* HEAT meter above the prompt (director, 2026-09-08) */}
        <div style={{ padding: '4px 6px 0', borderTop: '1px solid var(--line)' }}>
          <HeatMeter />
        </div>
        <div style={{ padding: 6, display: 'flex', gap: 4 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={target ? `what to do with ${label}? · Enter = ask for proposals` : 'nothing tethered — ask anyway, or park me beside something'}
            style={{ ...ctl, flex: 1, resize: 'none', fontSize: 11 }}
          />
          <span className="btn" style={{ alignSelf: 'stretch', display: 'inline-flex', alignItems: 'center' }} onClick={send} title="ask for up to three proposals">
            {busy ? 'queue' : 'ask'}
          </span>
        </div>
        {/* resize corner */}
        <span
          data-nodrag
          onMouseDown={(e) => {
            e.preventDefault()
            const x0 = e.clientX
            const y0 = e.clientY
            const w0 = box.w
            const h0 = box.h
            const mv = (ev: MouseEvent): void => setBox((b) => ({ ...b, w: Math.max(260, w0 + ev.clientX - x0), h: Math.max(180, h0 + ev.clientY - y0) }))
            const up = (): void => {
              window.removeEventListener('mousemove', mv)
              window.removeEventListener('mouseup', up)
              setBox((b) => {
                saveBox(b)
                return b
              })
            }
            window.addEventListener('mousemove', mv)
            window.addEventListener('mouseup', up)
          }}
          style={{ position: 'absolute', right: 2, bottom: 2, width: 12, height: 12, cursor: 'nwse-resize', borderRight: '2px solid var(--line2)', borderBottom: '2px solid var(--line2)', borderRadius: 2 }}
        />
      </div>
    </>,
    document.body
  )
}
