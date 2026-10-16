// floating citizens inside an empty panel (user design 2026-09-01, vi-dancer-born, shared for
// every KOAN app): instead of a bare teaching line, the panel's own items drift in the empty
// space — slight tilt, slow float, double-click opens one. Render INSIDE the app's EmptyState
// children (law 9: one EmptyState per app); when no items exist the caller keeps its teaching
// line and never renders this. `face` is the item's visual (the app's own Thumbnail/img);
// absent = the glyph box.
export type FloatItem = {
  id: string
  label: string
  face?: React.ReactNode
  glyph?: string
}

export function FloatPick({ items, onOpen, hint }: { items: FloatItem[]; onOpen: (id: string) => void; hint: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', alignItems: 'flex-start', maxHeight: 300, overflow: 'auto', padding: '10px 2px', margin: '8px 0' }}>
      <style>{`@keyframes koan-float { 0% { transform: translateY(0) } 50% { transform: translateY(-3px) } 100% { transform: translateY(0) } }`}</style>
      {items.map((it, i) => (
        <span key={it.id} style={{ display: 'inline-block', animation: `koan-float ${5 + (i % 4)}s ease-in-out infinite` }}>
          <span
            onDoubleClick={() => onOpen(it.id)}
            title={`${it.label} — ${hint}`}
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: 6,
              borderRadius: 6,
              border: '1px solid var(--line2)',
              background: 'var(--raised2, var(--panel2))',
              cursor: 'pointer',
              transform: `rotate(${(((i * 41) % 5) - 2) * 0.7}deg)`,
              userSelect: 'none'
            }}
          >
            {it.face ?? (
              <span style={{ width: 86, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--muted)', background: 'var(--bg0, var(--bg))', borderRadius: 4 }}>{it.glyph ?? '▦'}</span>
            )}
            <span style={{ fontSize: 10.5, color: 'var(--txt)', maxWidth: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
          </span>
        </span>
      ))}
    </div>
  )
}
