// The lora chip + block — ONE copy for Image Gen and Clip Gen (MINIMAX-H3-LOCAL-SPEC §4.1, his
// order 2026-09-22: "redo this local section so it resembles the image gen one with weight
// slider, make them consistent for ltx and h3"). Chip = name · slider 0–2 · weight · ✕. Block =
// the loras switch, the chips, ＋ lora (opens the side panel), the trigger words under it
// (LOAD-BEARING: a style lora barely fires without its word — tap inserts it into the prompt).

export function LoraChip(p: { label: string; weight: number; onWeight: (w: number) => void; onRemove?: () => void; title: string; off?: boolean }): React.JSX.Element {
  return (
    <span title={p.title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-hi)', opacity: p.off ? 0.45 : 1 }}>
      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
      <input type="range" min={0} max={2} step={0.05} value={p.weight} disabled={p.off} onChange={(e) => p.onWeight(Number(e.target.value))} style={{ width: 60, accentColor: 'var(--amber)' }} />
      <span style={{ color: 'var(--muted)', minWidth: 26, textAlign: 'right' }}>{p.weight.toFixed(2)}</span>
      {p.onRemove && (
        <span onClick={p.onRemove} title="remove" style={{ color: 'var(--dim)', cursor: 'pointer' }}>
          ✕
        </span>
      )}
    </span>
  )
}

export function LoraChips(p: {
  on: boolean
  onToggle: (on: boolean) => void
  picks: { name: string; weight: number }[]
  labelOf: (name: string) => string
  titleOf?: (name: string, i: number) => string
  onWeight: (i: number, w: number) => void
  onRemove: (i: number) => void
  onAdd: () => void
  addTitle?: string
  disabled?: boolean // the engine takes no loras — greyed with the reason, picks kept (stable board)
  disabledWhy?: string
  triggerWords?: string[] // the picked loras' words; ✓ when the prompt already carries one
  haystack?: string
  onInsert?: (word: string) => void
  children?: React.ReactNode // a host's own fixed rows (Image Gen's unleashed) ride inside the chip row
}): React.JSX.Element {
  const words = [...new Set(p.triggerWords ?? [])]
  return (
    <div className="field" style={{ marginBottom: 2, ...(p.disabled ? { opacity: 0.45, pointerEvents: 'none' as const } : {}) }} title={p.disabled ? p.disabledWhy : undefined}>
      <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', marginBottom: 6 }} title="loras on = the chips chain into the model in order · off = none, picks kept">
        <input type="checkbox" checked={p.on} onChange={(e) => p.onToggle(e.target.checked)} />
        <span className="lb" style={{ margin: 0 }}>loras</span>
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, opacity: p.on ? 1 : 0.45 }}>
        {p.picks.map((l, i) => (
          <LoraChip key={l.name} label={p.labelOf(l.name)} weight={l.weight} onWeight={(w) => p.onWeight(i, w)} onRemove={() => p.onRemove(i)} title={p.titleOf ? p.titleOf(l.name, i) : l.name} />
        ))}
        <span className="btn koan-hbtn" style={{ fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }} onClick={p.onAdd} title={p.addTitle ?? 'pick from the side panel — local, civit, official'}>
          ＋ lora
        </span>
        {p.children}
      </div>
      {p.on && p.onInsert && words.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
          {words.map((w) => {
            const present = (p.haystack ?? '').toLowerCase().includes(w.toLowerCase())
            return (
              <span
                key={w}
                onClick={() => !present && p.onInsert!(w)}
                title={present ? 'already in the prompt' : 'tap to add — the lora barely fires without its word'}
                style={{ fontFamily: 'var(--mono)', fontSize: 9, border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px', cursor: present ? 'default' : 'pointer', color: present ? 'var(--ok)' : 'var(--amber)' }}
              >
                {present ? '✓ ' : '＋ '}
                {w}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
