// first-run spotlight tour: dims the app and walks the core panels step by step. Anchors come
// from App (the sole dockview owner) via anchorFor — panels are user-movable, so every step must
// tolerate a missing anchor (the card just centers, the text still teaches). z 3000 sits above
// modals (2000) and below toasts (4000).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type TourStep = { key: string; title: string; body: string }

export const TOUR_STEPS: TourStep[] = [
  {
    key: 'library',
    title: 'Library',
    body: 'Your project’s reference images and music. Import files or drag them straight in — then drag images into prompts, onto clip slots, or the audio lane.'
  },
  {
    key: 'bin',
    title: 'Bin',
    body: 'Your clips live here. “+ clip” starts one; double-click a clip to open its editor. Every render stacks onto the clip as a take.'
  },
  {
    key: 'render',
    title: 'Clip Gen',
    body: 'The recipe: pick an engine, write the prompt with @references, storyboard it beat by beat. ▶ Render sends it to fal on your key — the cost estimate sits next to the button.'
  },
  {
    key: 'timeline',
    title: 'Timeline',
    body: 'Drag clips from the Bin anywhere on the tracks — position is free, gaps are fine. Trim edges, C = slice tool, stack tracks, drop a ♪ track from the Library, then ⬆ exports the sequence as mp4.'
  },
  {
    key: 'monitor',
    title: 'Timeline Monitor',
    body: 'Plays the assembled sequence. Un-rendered storyboard clips show their beat reference frames — so the cut reads before you spend a cent on renders.'
  },
  {
    key: 'settings',
    title: 'Settings',
    body: 'Connect a supplier key here first — rendering needs one (fal recommended; ModelArk, Astria and Higgsfield also work). A banner reminds you until one is saved.'
  },
  {
    key: 'codirector',
    title: 'Co-Director',
    body: 'A copilot that reads the whole project and writes beats, fields and refs with you — every change tinted until you accept it. Needs an Anthropic key (or the bridge) in Settings.'
  },
  {
    key: 'help',
    title: 'Cheat sheet',
    body: 'Press ? anytime for every keyboard shortcut and drag gesture. That’s the tour — make something.'
  }
]

export function TourOverlay({
  anchorFor,
  onClose
}: {
  anchorFor: (key: string) => HTMLElement | null
  onClose: (persisted: boolean) => void // true = tourDone was written (finish, or skip + checkbox)
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cur = TOUR_STEPS[step]

  // re-measure on step change, resize, and a slow poll — panels can be dragged/closed mid-tour.
  // a tabbed-away panel's content element measures 0×0 — treat that as "not visible" so the
  // spotlight doesn't collapse into the top-left corner
  useEffect(() => {
    const measure = (): void => {
      const el = anchorFor(cur.key)
      const r = el?.getBoundingClientRect()
      setRect(r && r.width > 4 && r.height > 4 ? r : null)
    }
    measure()
    window.addEventListener('resize', measure)
    const iv = window.setInterval(measure, 400)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearInterval(iv)
    }
  }, [cur.key, anchorFor])

  const finish = (done: boolean): void => {
    // finishing means the tour served its purpose; skipping only sticks if they asked it to
    const persisted = done || dontShow
    if (persisted) void window.vidancer.setSettings({ tourDone: true })
    onClose(persisted)
  }

  useEffect(() => {
    // capture phase + stopPropagation: while the tour is up, its keys must NOT also drive the
    // app's global shortcuts (arrows move the playhead, Esc exits panel maximize)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '?') {
        // the last step invites pressing ? — close the tour and LET the event through so the
        // cheat sheet opens on top instead of unusably under the scrim
        finish(step === TOUR_STEPS.length - 1)
        return
      }
      if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') finish(false)
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
      else if (step === TOUR_STEPS.length - 1) finish(true) // Enter/→ on the last step = finish
      else setStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dontShow, step])

  // card below the target when there's room, above otherwise; centered when the anchor is gone
  const CARD_W = 320
  const CARD_H = 190
  const pos: React.CSSProperties = rect
    ? {
        left: Math.max(8, Math.min(window.innerWidth - CARD_W - 8, rect.left + rect.width / 2 - CARD_W / 2)),
        top: rect.bottom + CARD_H + 12 < window.innerHeight ? rect.bottom + 10 : Math.max(8, rect.top - CARD_H - 10)
      }
    : { left: window.innerWidth / 2 - CARD_W / 2, top: window.innerHeight / 2 - CARD_H / 2 }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
      {/* spotlight: the hole is the target's rect, the 9999px shadow is the scrim */}
      {rect ? (
        <div
          style={{
            position: 'absolute',
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            border: '1px solid var(--amber)',
            borderRadius: 6,
            boxShadow: '0 0 0 9999px rgba(0,0,0,.55)',
            pointerEvents: 'none',
            transition: 'all .18s ease'
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' }} />
      )}

      <div
        style={{
          position: 'absolute',
          ...pos,
          width: CARD_W,
          background: 'var(--raised)',
          border: '1px solid var(--line2)',
          borderRadius: 10,
          padding: 14,
          boxShadow: '0 18px 60px rgba(0,0,0,.6)',
          transition: 'all .18s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 13 }}>{cur.title}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
            {step + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--body)', lineHeight: 1.5, minHeight: 54 }}>{cur.body}</div>
        {!rect && <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>(this panel isn&apos;t open right now)</div>}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', margin: '10px 0 8px', cursor: 'pointer' }}>
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          don&apos;t show this again
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="btn vd-hbtn" style={{ opacity: step === 0 ? 0.4 : 1 }} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            ◂ back
          </span>
          {step < TOUR_STEPS.length - 1 ? (
            <span className="btn" onClick={() => setStep((s) => s + 1)}>next ▸</span>
          ) : (
            <span className="btn" onClick={() => finish(true)}>finish ✓</span>
          )}
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => finish(false)}>
            skip tour
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}
