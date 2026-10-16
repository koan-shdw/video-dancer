// the aspect-ratio glyph (user order 2026-09-01, shared for every KOAN app): a tiny frame
// shaped like the ratio next to the value, so the pick is readable at a glance. 'auto' (or
// anything not W:H) wears a dashed square — the shape isn't known until render time.
export function AspectGlyph({ ratio, size = 12 }: { ratio: string; size?: number }): React.JSX.Element {
  const m = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  const w = m ? Number(m[1]) : 1
  const h = m ? Number(m[2]) : 1
  const scale = size / Math.max(w, h)
  return (
    <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size + 6, height: size, flex: '0 0 auto' }}>
      <span
        style={{
          width: Math.max(4, Math.round(w * scale)),
          height: Math.max(4, Math.round(h * scale)),
          border: '1px ' + (m ? 'solid' : 'dashed') + ' currentColor',
          borderRadius: 1,
          opacity: 0.75
        }}
      />
    </span>
  )
}

// a ready dropdown label: glyph + the ratio text
export function aspectLabel(ratio: string): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <AspectGlyph ratio={ratio} />
      {ratio}
    </span>
  )
}
