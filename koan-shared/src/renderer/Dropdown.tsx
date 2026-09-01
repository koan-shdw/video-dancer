import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// THE house dropdown (user order 2026-09-01: native selects look like the browser, not the app).
// One copy for every KOAN app: field-shaped trigger, rounded panel, roomy rows, ✓ on the current
// pick, disabled rows keep their footprint with the reason in the tooltip (law 7), groups
// separate with a ──── row (ch. 03). Portal + viewport clamp = the ContextMenu grammar.
export type DropdownOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
  title?: string
  sep?: boolean // a group divider row — value/label ignored
}

export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  title,
  style,
  placeholder
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  title?: string
  style?: React.CSSProperties // sizing overrides for the trigger (width/flex); colors stay house
  placeholder?: React.ReactNode // shown when value matches no option and is empty
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1) // keyboard highlight (options index)
  const btnRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0, w: 0, up: false })
  const current = options.find((o) => !o.sep && o.value === value)

  const openCard = (): void => {
    if (disabled) return
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: r.left, y: r.bottom + 2, w: r.width, up: false })
    setHi(options.findIndex((o) => !o.sep && o.value === value))
    setOpen(true)
  }
  // clamp to the viewport once measured — flip above the trigger when the bottom has no room
  useLayoutEffect(() => {
    if (!open) return
    const card = cardRef.current?.getBoundingClientRect()
    const btn = btnRef.current?.getBoundingClientRect()
    if (!card || !btn) return
    setPos((p) => {
      const upY = btn.top - card.height - 2
      const up = btn.bottom + card.height > window.innerHeight - 8 && upY > 8
      return {
        ...p,
        x: Math.min(p.x, Math.max(4, window.innerWidth - card.width - 4)),
        y: up ? upY : btn.bottom + 2,
        up
      }
    })
    // scroll the current pick into view
    cardRef.current?.querySelector('[data-cur="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [open])
  // close on any outside interaction — scroll/resize reposition problems just close it (simplest honest)
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const pickable = (i: number): boolean => !options[i]?.sep && !options[i]?.disabled
  const step = (from: number, d: number): number => {
    let i = from
    for (let n = 0; n < options.length; n++) {
      i = (i + d + options.length) % options.length
      if (pickable(i)) return i
    }
    return from
  }
  const pick = (i: number, via: 'mouse' | 'key' = 'mouse'): void => {
    const o = options[i]
    if (!o || o.sep || o.disabled) return
    onChange(o.value)
    setOpen(false)
    // keyboard picks keep focus for the next arrow; mouse picks release it so global keys
    // (spacebar transports) get the keyboard back — the old selects blurred for the same reason
    if (via === 'key') btnRef.current?.focus()
    else btnRef.current?.blur()
  }

  return (
    <>
      <div
        ref={btnRef}
        tabIndex={disabled ? -1 : 0}
        title={title}
        onClick={() => (open ? setOpen(false) : openCard())}
        onKeyDown={(e) => {
          if (disabled) return
          if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault()
            openCard()
          } else if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((h) => step(h, e.key === 'ArrowDown' ? 1 : -1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(hi, 'key')
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setOpen(false)
            }
          }
        }}
        style={{
          background: 'var(--field)',
          color: 'var(--txt-hi)',
          border: '1px solid ' + (open ? 'var(--line2)' : 'var(--line)'),
          borderRadius: 4,
          padding: '5px 8px',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          cursor: disabled ? 'default' : 'pointer',
          userSelect: 'none',
          opacity: disabled ? 0.5 : 1,
          minWidth: 0,
          ...style
        }}
      >
        {/* STABLE WIDTH (user law 2026-09-01): the field is always the width of its LONGEST
            option — changing the pick must never move the controls beside it. Grid-stacked
            invisible copies of every option size the cell; the current pick draws on top. */}
        <span style={{ flex: 1, minWidth: 0, display: 'inline-grid' }}>
          {options.filter((o) => !o.sep).map((o, i) => (
            <span key={'sz' + i} aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden', whiteSpace: 'nowrap' }}>{o.label}</span>
          ))}
          <span style={{ gridArea: '1 / 1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {current?.label ?? (value || placeholder || '')}
          </span>
        </span>
        <span style={{ color: 'var(--dim)', fontSize: 9, flex: '0 0 auto' }}>▾</span>
      </div>
      {open &&
        createPortal(
          <div onMouseDown={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2400 }}>
            <div
              ref={cardRef}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                minWidth: pos.w,
                maxWidth: 420,
                maxHeight: 320,
                overflow: 'auto',
                background: 'var(--bg2)',
                border: '1px solid var(--line2)',
                borderRadius: 6,
                padding: 4,
                boxShadow: '0 10px 30px rgba(0,0,0,.5)'
              }}
            >
              {options.map((o, i) =>
                o.sep ? (
                  <div key={'s' + i} style={{ height: 1, background: 'var(--line2)', margin: '4px 6px' }} />
                ) : (
                  <div
                    key={o.value}
                    data-cur={o.value === value ? '1' : undefined}
                    title={o.title}
                    onMouseEnter={() => !o.disabled && setHi(i)}
                    onClick={() => pick(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: o.disabled ? 'default' : 'pointer',
                      color: o.disabled ? 'var(--dim)' : o.value === value ? 'var(--amber, var(--accent))' : 'var(--txt-hi)',
                      background: i === hi && !o.disabled ? 'color-mix(in srgb, var(--amber, var(--accent)) 12%, transparent)' : 'transparent',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                    {o.value === value && <span style={{ flex: '0 0 auto', fontSize: 11 }}>✓</span>}
                  </div>
                )
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
