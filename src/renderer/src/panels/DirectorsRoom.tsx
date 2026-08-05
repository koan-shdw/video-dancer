import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { Ic, Theater, Check, RotateCcw, ZoomIn } from '../ui/icons'

// ---- The Director's Room — the Co-Director conversation as a step-away focus experience.
// The app stays visible underneath, lightly blurred: you haven't left, you're floating a moment
// above it. No sheet — every piece (messages, the moodboard, the side stacks, the input bar) is
// its own dark-glass card casting a shadow onto the blurred app. Same store run as the side
// panel — open or close the room mid-exchange and nothing is lost. ----

const EMPTY_LOG: CoDirMsg[] = []
const EMPTY_QS: string[] = []
const FONT_STEPS = [15.5, 18, 21] // chat type scale — big is the point

const CHIPS: { label: string; text: string }[] = [
  { label: 'what’s not working?', text: 'Look at what’s on the table. What’s not working right now? Be specific and blunt.' },
  { label: 'pitch 3 directions', text: 'Pitch three sharply different directions we could take this next — one line each, numbered.' },
  { label: 'tighten the beats', text: 'Tighten the beats on the clip on the table: trim slack, sharpen the actions, keep the total duration.' },
  { label: 'where are we?', text: 'Recap where we are: what’s decided, what’s still open, and what you’d do next. Keep it tight, then update your open-questions list.' }
]

const RECAP_MSG =
  'We’re closing this Director’s Room session. Fold the durable decisions into your brief (update_brief), refresh your open-questions list to only what’s genuinely still open (set_open_questions), and reply with a two-line recap.'

// last "latest take" ask already acted on — module-level so re-entering the room doesn't
// re-summon the Screen off the same old message after a ✕
let lastAutoKey: string | null = null

type WallItem = { key: string; kind: 'image' | 'take'; title: string; file: string; sub?: string }

// dark glass — the room's one material; alpha/blur tuned per surface
const glass = (a = 0.66, blur = 16): React.CSSProperties => ({
  background: `rgba(13,13,17,${a})`,
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
  border: '1px solid rgba(255,255,255,.08)'
})

// seeded scatter for the moodboard — stable per index, no Math.random (re-renders must not reshuffle)
const scatterRot = (i: number): number => ((i * 137) % 7) - 3
const scatterW = (i: number): number => 148 + ((i * 61) % 58)

// typewriter reveal — the cloud's "read along as it lands" effect. The reveal head only ever
// advances (text can GROW mid-write without restarting the type), and the visible window clamps
// to the tail so long fields keep scrolling past instead of overflowing the cloud.
function CloudText({ text, tail = 460, style }: { text: string; tail?: number; style?: React.CSSProperties }): React.JSX.Element {
  const [n, setN] = useState(0)
  useEffect(() => {
    const iv = window.setInterval(() => setN((v) => (v < text.length ? Math.min(v + 3, text.length) : v)), 16)
    return () => window.clearInterval(iv)
  }, [text.length])
  const shown = text.slice(0, n)
  const clipped = shown.length > tail ? '…' + shown.slice(-tail) : shown
  return (
    <span style={style}>
      {clipped}
      {n < text.length && <span style={{ opacity: 0.7 }}>▌</span>}
    </span>
  )
}

// a moodboard/lightbox media element — image, or a paused first frame of a take's video
function Media({ item, big, controls }: { item: WallItem; big?: boolean; controls?: boolean }): React.JSX.Element {
  const fit: React.CSSProperties = big
    ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }
    : { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
  return item.kind === 'take' ? (
    <video src={mediaUrl(item.file) + (controls ? '' : '#t=0.05')} preload="metadata" muted={!controls} controls={controls} loop={controls} autoPlay={controls} style={fit} />
  ) : (
    <img src={mediaUrl(item.file)} alt="" style={fit} />
  )
}

export function DirectorsRoom(): React.JSX.Element | null {
  const project = useStore((s) => s.project)
  const log = useStore((s) => s.project?.codir.log ?? EMPTY_LOG)
  const openQuestions = useStore((s) => s.project?.codir.openQuestions ?? EMPTY_QS)
  const { busy, status, liveTexts, pendingUser, lastUsage } = useStore((s) => s.codirRun)
  const writes = useStore((s) => s.codirWrites)
  const liveStage = useStore((s) => s.codirLiveStage)
  const screen = useStore((s) => s.codirScreen)
  const setCodirScreen = useStore((s) => s.setCodirScreen)
  const queue = useStore((s) => s.codirQueue)
  const codirQueueRemove = useStore((s) => s.codirQueueRemove)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const codirSendText = useStore((s) => s.codirSendText)
  const codirDismissWrite = useStore((s) => s.codirDismissWrite)
  const setRoomOpen = useStore((s) => s.setRoomOpen)

  const [input, setInput] = useState('')
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [fontIdx, setFontIdx] = useState(1)
  const [zoom, setZoom] = useState<WallItem | null>(null)
  const [compare, setCompare] = useState<WallItem[]>([])
  const [leaveBar, setLeaveBar] = useState(false)
  const [screenMuted, setScreenMuted] = useState(false) // the Screen opens with sound — review mode
  const [screenBig, setScreenBig] = useState(true) // expanded into the side room ⇄ folded to pop size
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const msgsAtOpen = useRef(log.length) // session boundary — drives the recap-on-leave offer
  const fs = FONT_STEPS[fontIdx]

  const libImages = project?.images ?? []
  const clip = project?.clips.find((c) => c.id === selectedClipId) ?? null

  // the cloud lingers past the write's end — hold the last stage briefly and breathe it out
  const [stage, setStage] = useState(liveStage)
  const [stageFading, setStageFading] = useState(false)
  useEffect(() => {
    if (liveStage) {
      setStage(liveStage)
      setStageFading(false)
      return
    }
    setStageFading(true)
    const t = window.setTimeout(() => setStage(null), 900)
    return () => window.clearTimeout(t)
  }, [liveStage])

  // Esc peels layers: lightbox → compare → the Screen → the room itself
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (zoom) setZoom(null)
      else if (compare.length) setCompare([])
      else if (screen) setCodirScreen(null)
      else setRoomOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, compare.length, screen, setCodirScreen, setRoomOpen])

  // transcript pinned to the bottom — plus a burst of re-pins on open, because images and fonts
  // land after mount and grow scrollHeight under us
  const scrollToEnd = (): void => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }
  useLayoutEffect(() => {
    scrollToEnd()
    const ts = [60, 200, 450, 900].map((ms) => window.setTimeout(scrollToEnd, ms))
    return () => ts.forEach((t) => window.clearTimeout(t))
  }, [])
  useEffect(scrollToEnd, [log.length, liveTexts.length, pendingUser, status])

  // ---- the moodboard: what this conversation is LOOKING at — the on-table clip's refs + takes,
  // then every Library image mentioned anywhere in the transcript, newest first ----
  const wall = useMemo<WallItem[]>(() => {
    if (!project) return []
    const items: WallItem[] = []
    const seen = new Set<string>()
    const pushImg = (im: ProjImage | undefined, sub?: string): void => {
      if (!im) return
      const k = 'i:' + im.id
      if (seen.has(k)) return
      seen.add(k)
      items.push({ key: k, kind: 'image', title: im.title, file: im.file, sub })
    }
    if (clip) {
      for (const id of clip.promptData.imageIds ?? []) pushImg(project.images.find((i) => i.id === id), 'on the table')
      for (const t of [...clip.takes].reverse().slice(0, 6)) {
        const k = 't:' + t.id
        if (!seen.has(k)) {
          seen.add(k)
          items.push({ key: k, kind: 'take', title: `${clip.name} · take`, file: t.file, sub: t.engine ?? 'render' })
        }
      }
    }
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i]
      for (const id of m.imageIds ?? []) pushImg(project.images.find((im) => im.id === id), 'mentioned')
      for (const tag of m.text.match(/@\w+/g) ?? []) pushImg(project.images.find((im) => im.title === tag), 'mentioned')
    }
    return items.slice(0, 48)
  }, [project, clip, log])

  const toggleCompare = (item: WallItem): void =>
    setCompare((cur) => (cur.some((c) => c.key === item.key) ? cur.filter((c) => c.key !== item.key) : [...cur, item].slice(-2)))

  // ---- context pops: the takes the conversation is on RIGHT NOW, playing in floating windows.
  // Scan the freshest messages (streaming text included) for clip names; "take 3" in the same
  // message picks that take, otherwise the clip's newest. Two most recent stay; older fade off. ----
  const pops = useMemo<(WallItem & { clipId: string; takeN: number })[]>(() => {
    if (!project) return []
    const msgs = [...log.slice(-6).map((m) => m.text), ...(pendingUser ? [pendingUser] : []), ...liveTexts]
    const found: (WallItem & { clipId: string; takeN: number })[] = []
    for (let i = msgs.length - 1; i >= 0 && found.length < 2; i--) {
      const lower = msgs[i].toLowerCase()
      const tm = lower.match(/take\s*#?\s*(\d+)/)
      for (const c of project.clips) {
        if (found.length === 2) break
        if (c.name.length < 3 || !c.takes.length || !lower.includes(c.name.toLowerCase())) continue
        const idx = tm ? Math.min(Math.max(parseInt(tm[1], 10) - 1, 0), c.takes.length - 1) : c.takes.length - 1
        const t = c.takes[idx]
        const key = 'pop:' + c.id + ':' + t.id
        if (!found.some((f) => f.key === key)) found.push({ key, kind: 'take', title: c.name, file: t.file, sub: `take ${idx + 1}`, clipId: c.id, takeN: idx + 1 })
      }
    }
    return found
  }, [project, log, liveTexts, pendingUser])

  // ---- "let's review the latest take" — no clip name needed: the newest render in the WHOLE
  // project steps onto the Screen by itself. Keyed to the asking message so it fires once per
  // ask; ✕/Esc stays closed until someone (either of you) asks again. ----
  const latestAsk = useMemo(() => {
    if (!project) return null
    const msgs = [...log.slice(-4).map((m) => m.text), ...(pendingUser ? [pendingUser] : []), ...liveTexts]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (!/\b(?:latest|newest|last)\s+(?:take|render)\b/i.test(msgs[i])) continue
      let best: { c: Clip; i: number } | null = null
      for (const c of project.clips) for (let k = 0; k < c.takes.length; k++) if (!best || c.takes[k].createdAt > best.c.takes[best.i].createdAt) best = { c, i: k }
      if (!best) return null
      return { key: msgs[i].slice(0, 80) + '::' + best.c.takes[best.i].id, clipId: best.c.id, clipName: best.c.name, take: best.i + 1, file: best.c.takes[best.i].file }
    }
    return null
  }, [project, log, liveTexts, pendingUser])
  useEffect(() => {
    if (!latestAsk || lastAutoKey === latestAsk.key) return
    lastAutoKey = latestAsk.key
    setCodirScreen({ clipId: latestAsk.clipId, clipName: latestAsk.clipName, take: latestAsk.take, file: latestAsk.file })
  }, [latestAsk, setCodirScreen])
  // every fresh summon comes up big; a fold sticks until the next one
  useEffect(() => {
    if (screen) setScreenBig(true)
  }, [screen])

  // ---- input: same @mention behavior as the panel ----
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

  const send = (): void => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setMention(null)
    void codirSendText(text) // mid-run → the store queues it and fires it when the run frees up
  }
  const revert = (w: { id: number; text: string }): void => {
    if (busy) return
    codirDismissWrite(w.id)
    void codirSendText(`Revert this change you made: "${w.text}" — restore the previous values exactly, touch nothing else, and confirm what you reverted.`)
  }
  const leave = (recap: boolean): void => {
    if (recap && !busy) void codirSendText(RECAP_MSG) // continues in the panel — the room can go dark
    setRoomOpen(false)
  }

  if (!project) return null

  const sessionHadWork = log.length > msgsAtOpen.current || writes.length > 0

  const railTitle: React.CSSProperties = { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--amber)', padding: '10px 12px 6px', fontFamily: 'var(--mono)' }
  const sideCard: React.CSSProperties = { ...glass(0.58, 14), borderRadius: 14, boxShadow: '0 14px 40px rgba(0,0,0,.42)', overflow: 'hidden', animation: 'vdroom-float-in .35s ease' }
  const pill: React.CSSProperties = { ...glass(0.55, 14), borderRadius: 999, boxShadow: '0 10px 30px rgba(0,0,0,.4)', display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 16px' }

  const bubble = (role: 'user' | 'assistant', text: string, key: string | number, imageIds?: string[], ghost?: boolean): React.JSX.Element => (
    <div key={key} style={{ display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 16, opacity: ghost ? 0.75 : 1 }}>
      <div
        className="vd-copy"
        style={{
          maxWidth: '82%',
          padding: '13px 19px',
          borderRadius: 16,
          fontSize: fs,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          background: role === 'user' ? 'color-mix(in srgb, var(--amber) 15%, rgba(19,18,22,.68))' : 'rgba(13,13,17,.68)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,.09)',
          color: 'var(--txt-hi)',
          boxShadow: '0 16px 44px rgba(0,0,0,.5)',
          animation: 'vdroom-float-in .32s ease'
        }}
      >
        {!!imageIds?.length && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {imageIds.map((id) => {
              const im = libImages.find((i) => i.id === id)
              return im ? <img key={id} src={mediaUrl(im.file)} alt="" title={im.title} style={{ height: 54, borderRadius: 5, border: '1px solid var(--line2)' }} /> : null
            })}
          </div>
        )}
        {text}
      </div>
    </div>
  )

  return createPortal(
    // the app stays visible under a light blur — a moment above the work, not a different place
    <div style={{ position: 'fixed', inset: 0, zIndex: 1800, background: 'rgba(5,5,9,.52)', display: 'flex', flexDirection: 'column', backdropFilter: 'blur(7px) saturate(.9)', WebkitBackdropFilter: 'blur(7px) saturate(.9)' }}>
      {/* keyframes + hover rules for the room's motion — scoped names, injected with the overlay */}
      <style>{`
        @keyframes vdroom-in { from { opacity: 0; transform: translateY(14px) scale(.985) } to { opacity: 1; transform: none } }
        @keyframes vdroom-float-in { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
        @keyframes vdroom-card { from { opacity: 0; transform: translateX(16px) } to { opacity: 1; transform: none } }
        @keyframes vdroom-stage { from { opacity: 0; transform: translateY(26px) scale(.96) } to { opacity: 1; transform: none } }
        @keyframes vdroom-cloud { from { opacity: 0; transform: scale(.96) } }
        @keyframes vdroom-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
        .vdroom-asset-w { position: relative; animation: vdroom-bob 7s ease-in-out infinite }
        .vdroom-asset-w:hover { z-index: 8 }
        .vdroom-screen { transition: transform .3s ease, width .28s ease }
        .vdroom-screen:hover { transform: rotate(0deg) !important }
        .vdroom-asset { transition: transform .25s ease, box-shadow .25s ease }
        .vdroom-asset-w:hover .vdroom-asset { transform: rotate(0deg) scale(1.06) !important; box-shadow: 0 26px 60px rgba(0,0,0,.65) !important }
        @media (max-width: 1180px) { .vdroom-rail { display: none } }
      `}</style>

      {/* ---- header: two floating pills, no bar ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px 6px', animation: 'vdroom-in .28s ease' }}>
        <span style={pill}>
          <span style={{ color: 'var(--amber)', fontFamily: 'var(--mono)', letterSpacing: 3, fontSize: 13 }}>
            <Ic i={Theater} size={15} /> DIRECTOR’S ROOM
          </span>
          <span style={{ color: 'var(--dim)', fontSize: 12 }}>{project.name}</span>
          {busy && (
            <span style={{ fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
              <span className="vd-spin" style={{ display: 'inline-block', marginRight: 6 }}>◐</span>
              {status || 'working…'}
            </span>
          )}
        </span>
        <span style={{ marginLeft: 'auto', ...pill, gap: 6 }}>
          <span className="btn vd-hbtn" style={{ opacity: fontIdx === 0 ? 0.4 : 1 }} onClick={() => setFontIdx((v) => Math.max(0, v - 1))} title="smaller type">
            A−
          </span>
          <span className="btn vd-hbtn" style={{ opacity: fontIdx === FONT_STEPS.length - 1 ? 0.4 : 1 }} onClick={() => setFontIdx((v) => Math.min(FONT_STEPS.length - 1, v + 1))} title="bigger type">
            A+
          </span>
          {leaveBar ? (
            <>
              <span className="btn" onClick={() => leave(true)} title="the Co-Director folds this session's decisions into its brief + refreshes the open questions, then the room closes">
                fold into Brief & leave
              </span>
              <span className="btn vd-hbtn" onClick={() => leave(false)}>just leave</span>
              <span className="btn vd-hbtn" onClick={() => setLeaveBar(false)}>stay</span>
            </>
          ) : (
            <span
              className="btn vd-hbtn"
              onClick={() => (sessionHadWork && !busy ? setLeaveBar(true) : leave(false))}
              title="leave the room (Esc) — the conversation continues in the Co-Director panel"
            >
              ✕ leave
            </span>
          )}
        </span>
      </div>

      {/* ---- body: the chat column fills the room; both rails float mid-height, hugging it ---- */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* THE SCREEN — the take under review, pulled up like a memory: an angled card floating
            at a side of the chat (seeded left/right + tilt per summon), big into whatever room
            the side has, never over the reading line. Hover straightens it. Summoned by
            "latest take", a pop click, or the co-director's verb. */}
        {screen &&
          (() => {
            const leftSide = screen.at % 2 === 0
            const rot = (((screen.at * 7) % 5) - 2 || 1.4) * (leftSide ? 1 : -1) // -2..2°, never dead flat
            const topPct = 9 + (Math.floor(screen.at / 3) % 3) * 5 // 9 / 14 / 19%
            return (
              <div
                key={screen.at}
                className="vdroom-rail vdroom-screen"
                style={{
                  position: 'absolute',
                  top: `${topPct}%`,
                  ...(leftSide ? { right: 'calc(50% + 440px)' } : { left: 'calc(50% + 440px)' }),
                  width: screenBig ? 'min(540px, calc(50vw - 452px))' : 240,
                  zIndex: 3,
                  transform: `rotate(${rot}deg)`,
                  ...glass(0.74, 16),
                  borderRadius: 14,
                  padding: 7,
                  boxShadow: '0 30px 90px rgba(0,0,0,.62)',
                  animation: 'vdroom-stage .45s ease'
                }}
              >
                <video src={mediaUrl(screen.file)} autoPlay loop playsInline muted={screenMuted} style={{ width: '100%', borderRadius: 9, display: 'block' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 4px 2px', fontSize: 10.5, fontFamily: 'var(--mono)' }}>
                  <span style={{ color: 'var(--amber)' }}>▣</span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--txt-hi)' }}>
                    {screen.clipName} · take {screen.take}
                  </span>
                  <span className="btn vd-hbtn" style={{ fontSize: 10 }} onClick={() => setScreenMuted((v) => !v)} title={screenMuted ? 'sound back on' : 'mute the Screen'}>
                    {screenMuted ? 'sound' : 'mute'}
                  </span>
                  <span
                    className="btn vd-hbtn"
                    style={{ fontSize: 10 }}
                    onClick={() => setZoom({ key: 'screen:' + screen.file, kind: 'take', title: `${screen.clipName} · take ${screen.take}`, file: screen.file })}
                    title="wall to wall (Esc comes back here)"
                  >
                    ⛶
                  </span>
                  <span className="btn vd-hbtn" style={{ fontSize: 10 }} onClick={() => setScreenBig((v) => !v)} title={screenBig ? 'fold it down small' : 'bring it up big'}>
                    {screenBig ? '▾' : '▴'}
                  </span>
                  <span className="btn vd-hbtn" style={{ fontSize: 10 }} onClick={() => setCodirScreen(null)} title="clear the Screen (Esc)">
                    ✕
                  </span>
                </div>
              </div>
            )
          })()}
        {/* THE MOODBOARD — floats mid-left against the chat column: prints scattered on a desk */}
        <div className="vdroom-rail" style={{ position: 'absolute', top: 0, bottom: 0, right: 'calc(50% + 448px)', width: 'min(276px, calc(50vw - 460px))', display: 'flex', alignItems: 'center', pointerEvents: 'none', zIndex: 2 }}>
        <div className="vd-scroll" style={{ pointerEvents: 'auto', width: '100%', maxHeight: '76vh', overflowY: 'auto', overflowX: 'hidden', padding: '6px 6px 18px', animation: 'vdroom-in .34s ease' }}>
          {wall.length === 0 && (
            <div style={{ ...glass(0.5, 12), borderRadius: 12, padding: '10px 12px', fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
              nothing on the board yet — @mention Library images, or put a clip on the table
            </div>
          )}
          {wall.map((it, i) => {
            const inCompare = compare.some((c) => c.key === it.key)
            const w = scatterW(i)
            return (
              <div key={it.key} className="vdroom-asset-w" style={{ animationDuration: `${6.5 + (i % 5) * 0.9}s`, animationDelay: `${-((i * 1.7) % 6)}s`, marginTop: i === 0 ? 0 : -8, marginLeft: (i * 37) % 30 }}>
                <div
                  className="vdroom-asset"
                  style={{
                    width: w,
                    transform: `rotate(${scatterRot(i)}deg)`,
                    ...glass(0.62, 12),
                    borderColor: inCompare ? 'var(--amber)' : 'rgba(255,255,255,.1)',
                    borderRadius: 10,
                    boxShadow: '0 14px 36px rgba(0,0,0,.55)',
                    overflow: 'hidden',
                    cursor: 'zoom-in',
                    padding: 5
                  }}
                  onClick={() => setZoom(it)}
                  title={`${it.title} — click to view big`}
                >
                  <div style={{ height: Math.round(w * 0.62), borderRadius: 6, overflow: 'hidden' }}>
                    <Media item={it} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 3px 2px', fontSize: 10, fontFamily: 'var(--mono)' }}>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: it.kind === 'take' ? 'var(--txt)' : 'var(--gold)' }}>{it.title}</span>
                    <span style={{ color: 'var(--dim)', fontSize: 9 }}>{it.sub}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCompare(it)
                      }}
                      title={inCompare ? 'drop from compare' : 'compare — pick two, they go side by side'}
                      style={{ cursor: 'pointer', color: inCompare ? 'var(--amber)' : 'var(--dim)' }}
                    >
                      ◧
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        </div>

        {/* CHAT + LIVE STAGE */}
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* the live stage: the write drifting in at the SIDE — a soft cloud over the top of the
              moodboard or the table stack, never under the reading line. Each write picks a side
              and a height (seeded by its timestamp), lingers, then breathes out. Weather, not UI. */}
          {stage &&
            (() => {
              const f = stage.live.fields[stage.live.fields.length - 1]
              const leftSide = stage.at % 2 === 0
              const topPct = 5 + (Math.floor(stage.at / 7) % 4) * 4 // 5 / 9 / 13 / 17%
              return (
                <div
                  key={stage.at}
                  className="vdroom-rail"
                  style={{
                    position: 'absolute',
                    top: `${topPct}%`,
                    ...(leftSide ? { right: 'calc(50% + 424px)' } : { left: 'calc(50% + 424px)' }),
                    width: 'min(420px, calc(50vw - 436px))',
                    pointerEvents: 'none',
                    zIndex: 3,
                    opacity: stageFading ? 0 : 0.68,
                    transition: 'opacity .8s ease',
                    animation: 'vdroom-cloud .6s ease'
                  }}
                >
                  <div
                    style={{
                      background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--amber) 10%, rgba(13,13,17,.66)) 0%, rgba(13,13,17,.42) 52%, transparent 76%)',
                      WebkitMaskImage: 'radial-gradient(ellipse at center, #000 52%, transparent 84%)',
                      maskImage: 'radial-gradient(ellipse at center, #000 52%, transparent 84%)',
                      padding: '44px 42px',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontFamily: 'var(--mono)', letterSpacing: 2.5, color: 'var(--amber)', textTransform: 'uppercase', marginBottom: 10, textShadow: '0 0 18px rgba(0,0,0,.9)' }}>
                      ✎ {stage.live.target ?? stage.live.tool.replace(/_/g, ' ')}
                      {f ? ` · ${f.path}` : ''}
                    </div>
                    {f && (
                      <div style={{ fontSize: 15, lineHeight: 1.7, fontWeight: 300, color: 'var(--txt-hi)', whiteSpace: 'pre-wrap', textShadow: '0 2px 22px rgba(0,0,0,.9)' }}>
                        <CloudText key={f.path} text={f.snippet} tail={380} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

          {/* transcript — cards floating straight over the blurred app */}
          <div ref={scrollRef} className="vd-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 40px 10px', zIndex: 1 }}>
            <div style={{ maxWidth: 860, margin: '0 auto' }}>
              {log.length === 0 && !pendingUser && (
                <div style={{ fontSize: fs, color: 'var(--txt)', lineHeight: 1.7, textAlign: 'center', paddingTop: '14vh', textShadow: '0 2px 18px rgba(0,0,0,.8)' }}>
                  the room is yours.
                  <br />
                  <span style={{ fontSize: fs - 3, color: 'var(--dim)' }}>a step away from the app — think out loud, everything lands in the fields, live.</span>
                </div>
              )}
              {log.map((m, i) => bubble(m.role, m.text, i, m.imageIds))}
              {pendingUser && bubble('user', pendingUser, 'pending')}
              {liveTexts.map((t, i) => bubble('assistant', t, `live-${i}`, undefined, true))}
              {busy && (
                <div style={{ fontSize: 12, color: 'var(--txt)', fontFamily: 'var(--mono)', padding: '2px 6px', textShadow: '0 1px 8px rgba(0,0,0,.8)' }}>
                  <span className="vd-spin" style={{ display: 'inline-block', marginRight: 8 }}>◐</span>
                  {status || 'working…'}
                </div>
              )}
            </div>
          </div>

          {/* the floating input bar — queue, chips, type box: one glass card, always there */}
          <div style={{ padding: '6px 28px 20px', position: 'relative', zIndex: 2 }}>
            <div style={{ maxWidth: 860, margin: '0 auto', position: 'relative', ...glass(0.72, 20), borderRadius: 16, boxShadow: '0 22px 60px rgba(0,0,0,.55)', padding: '12px 14px', animation: 'vdroom-float-in .38s ease' }}>
              {mentionMatches.length > 0 && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 30, ...glass(0.85, 18), borderRadius: 10, maxHeight: 180, overflow: 'auto', marginBottom: 8, boxShadow: '0 16px 44px rgba(0,0,0,.5)' }}>
                  {mentionMatches.map((im) => (
                    <div
                      key={im.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pickMention(im.title)
                      }}
                      style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 13, cursor: 'pointer', color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <img src={mediaUrl(im.file)} alt="" style={{ width: 30, height: 20, objectFit: 'cover', borderRadius: 3 }} />
                      {im.title}
                    </div>
                  ))}
                </div>
              )}
              {/* queued sends — typed mid-run, they hold here (X to drop) and fire in order when the run frees up */}
              {queue.map((q) => (
                <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 10px', marginBottom: 6, borderRadius: 9, background: 'rgba(255,255,255,.045)', border: '1px dashed rgba(255,255,255,.16)' }}>
                  <span style={{ fontSize: 8.5, fontFamily: 'var(--mono)', letterSpacing: 1.5, color: 'var(--amber)' }}>QUEUED</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={q.text}>
                    {q.text}
                  </span>
                  <span style={{ cursor: 'pointer', color: 'var(--dim)', fontSize: 12 }} onClick={() => codirQueueRemove(q.id)} title="drop this queued message">
                    ✕
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {CHIPS.map((c) => (
                  <span key={c.label} className="btn vd-hbtn" style={{ fontSize: 11, opacity: 0.9 }} onClick={() => void codirSendText(c.text)} title={c.text}>
                    {c.label}
                  </span>
                ))}
              </div>
              <textarea
                ref={taRef}
                value={input}
                onChange={onInput}
                onBlur={() => setTimeout(() => setMention(null), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !mention) {
                    e.preventDefault()
                    send()
                  }
                }}
                autoFocus
                placeholder={busy ? 'working… — Enter queues it for when I’m free' : 'direct me — @ for Library images · Enter to send'}
                rows={2}
                style={{ width: '100%', resize: 'vertical', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, color: 'var(--txt-hi)', fontSize: fs - 1, lineHeight: 1.5, padding: '12px 16px', outline: 'none', fontFamily: 'var(--sans)' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                {busy && <span className="btn vd-hbtn" onClick={() => void window.vidancer.codirCancel()}>✕ cancel</span>}
                <span className="btn" style={{ opacity: input.trim() ? 1 : 0.5 }} onClick={send}>
                  {busy ? 'queue' : 'send'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{lastUsage}</span>
              </div>
            </div>
          </div>
        </div>

        {/* SIDE: context pops on top, then the table · decide · changes — one column hugging the
            chat, centered on the middle like the moodboard; scrolls inside itself when it overflows */}
        <div className="vdroom-rail" style={{ position: 'absolute', top: 0, bottom: 0, left: 'calc(50% + 448px)', width: 'min(292px, calc(50vw - 460px))', display: 'flex', alignItems: 'center', pointerEvents: 'none', zIndex: 2 }}>
        <div className="vd-scroll" style={{ pointerEvents: 'auto', width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '6px 6px 18px', display: 'flex', flexDirection: 'column', gap: 12, animation: 'vdroom-in .4s ease' }}>
          {/* what the conversation is on RIGHT NOW — playing, above everything else on the stack */}
          {pops
            .filter((p) => !screen || p.clipId !== screen.clipId || p.takeN !== screen.take) // the take on the Screen doesn't double as a pop
            .map((p) => (
            <div
              key={p.key}
              style={{ ...glass(0.62, 14), borderRadius: 12, padding: 6, boxShadow: '0 18px 50px rgba(0,0,0,.55)', cursor: 'zoom-in', animation: 'vdroom-stage .35s ease', flexShrink: 0 }}
              onClick={() => setCodirScreen({ clipId: p.clipId, clipName: p.title, take: p.takeN, file: p.file })}
              title="playing because it just came up in the conversation — click to put it on the Screen"
            >
              <video src={mediaUrl(p.file)} autoPlay muted loop playsInline style={{ width: '100%', borderRadius: 8, display: 'block' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 4px 2px', fontSize: 10, fontFamily: 'var(--mono)' }}>
                <span style={{ color: 'var(--amber)' }}>▶</span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--txt-hi)' }}>{p.title}</span>
                <span style={{ color: 'var(--dim)' }}>{p.sub}</span>
              </div>
            </div>
          ))}
          <div style={sideCard}>
            <div style={railTitle}>On the Table</div>
            <div style={{ padding: '0 12px 10px' }}>
              {project.clips.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--dim)' }}>no clips yet — ask for one</div>}
              {project.clips.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      className="btn vd-hbtn"
                      onClick={() => {
                        const i = project.clips.findIndex((c) => c.id === selectedClipId)
                        selectClip(project.clips[(i - 1 + project.clips.length) % project.clips.length].id)
                      }}
                    >
                      ‹
                    </span>
                    <select
                      value={selectedClipId ?? ''}
                      onChange={(e) => selectClip(e.target.value || null)}
                      style={{ flex: 1, background: 'var(--field)', border: '1px solid var(--line2)', borderRadius: 5, color: 'var(--txt-hi)', fontSize: 12, padding: '5px 7px' }}
                    >
                      <option value="">— pick a clip —</option>
                      {project.clips.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <span
                      className="btn vd-hbtn"
                      onClick={() => {
                        const i = project.clips.findIndex((c) => c.id === selectedClipId)
                        selectClip(project.clips[(i + 1) % project.clips.length].id)
                      }}
                    >
                      ›
                    </span>
                  </div>
                  {clip && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.6 }}>
                      {clip.promptData.engine ?? 'seedance2'} · {clip.promptData.duration}s · {clip.promptData.beats?.length ?? 0} beats · {clip.takes.length} take{clip.takes.length === 1 ? '' : 's'}
                      <br />
                      <span style={{ color: 'var(--dim)' }}>the co-director sees this clip in full — “the clip I’m on”</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={sideCard}>
            <div style={railTitle}>Still to Decide</div>
            <div style={{ padding: '0 12px 10px' }}>
              {openQuestions.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>nothing open — the co-director keeps this list as questions come up</div>}
              {openQuestions.map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12, color: 'var(--txt-hi)', lineHeight: 1.45, padding: '3px 0', cursor: 'pointer' }} onClick={() => setInput(q + ' — ')} title="click to answer it">
                  <span style={{ color: 'var(--amber)' }}>?</span>
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={sideCard}>
            <div style={railTitle}>Changes this session</div>
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {writes.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>every write the co-director makes lands here as a card — keep it or send it back</div>}
              {[...writes].reverse().map((w) => (
                <div key={w.id} style={{ border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, padding: '7px 9px', background: 'rgba(255,255,255,.04)', animation: 'vdroom-card .25s ease' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--txt-hi)', lineHeight: 1.45 }}>{w.text}</div>
                  {!!w.live?.fields.length && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                      {w.live.fields.slice(0, 6).map((f, i) => (
                        <span key={i} title={f.snippet} style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--gold)', border: '1px solid var(--line)', borderRadius: 3, padding: '1px 5px' }}>
                          {f.path}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <span className="btn vd-hbtn" style={{ fontSize: 10 }} onClick={() => codirDismissWrite(w.id)} title="good — clear the card (the change is already in the project)">
                      <Ic i={Check} size={10} /> keep
                    </span>
                    <span className="btn vd-hbtn" style={{ fontSize: 10, opacity: busy ? 0.45 : 1 }} onClick={() => revert(w)} title="ask the co-director to precisely reverse this change">
                      <Ic i={RotateCcw} size={10} /> revert
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{new Date(w.at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* ---- compare: two moodboard items side by side ---- */}
      {compare.length === 2 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', animation: 'vdroom-in .2s ease' }} onClick={() => setCompare([])}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: 2, color: 'var(--amber)' }}>◧ COMPARE</span>
            <span style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--dim)' }}>✕ close</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: '0 20px 20px' }} onClick={(e) => e.stopPropagation()}>
            {compare.map((it) => (
              <div key={it.key} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Media item={it} big controls />
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--gold)', padding: '8px 0 0' }}>{it.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- lightbox ---- */}
      {zoom && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: 'rgba(0,0,0,.86)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', cursor: 'zoom-out', animation: 'vdroom-in .18s ease' }} onClick={() => setZoom(null)}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--gold)' }}>
              <Ic i={ZoomIn} size={12} /> {zoom.title}
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--dim)' }}>✕</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px 24px' }}>
            <Media item={zoom} big controls={zoom.kind === 'take'} />
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
