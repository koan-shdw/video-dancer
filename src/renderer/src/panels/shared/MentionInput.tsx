import { useRef, useState } from 'react'
import { ctl } from '../../ui/controls'

// a textarea with @-mention autocomplete (same behaviour as the Clip Editor's prompt field) —
// used by the Beats editor's camera/action/lighting fields
export function MentionArea(props: {
  value: string
  onChange: (v: string) => void
  titles: string[]
  rows?: number
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    props.onChange(val)
    const pos = e.target.selectionStart ?? val.length
    const m = val.slice(0, pos).match(/@(\w*)$/)
    setMention(m ? { start: pos - m[0].length, query: m[1].toLowerCase() } : null)
  }
  const matches = mention ? props.titles.filter((t) => t.toLowerCase().includes(mention.query)).slice(0, 8) : []
  const pick = (title: string): void => {
    if (!mention) return
    const ta = ref.current
    const pos = ta?.selectionStart ?? props.value.length
    const before = props.value.slice(0, mention.start)
    const after = props.value.slice(pos)
    props.onChange(before + title + ' ' + after)
    setMention(null)
    setTimeout(() => {
      ta?.focus()
      const c = (before + title + ' ').length
      ta?.setSelectionRange(c, c)
    }, 0)
  }
  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={ref}
        value={props.value}
        onChange={onInput}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        rows={props.rows ?? 2}
        style={{ ...ctl, width: '100%', resize: 'vertical' }}
      />
      {matches.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 160, overflow: 'auto' }}>
          {matches.map((t) => (
            <div
              key={t}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t)
              }}
              style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: '#e7c98c' }}
            >
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
