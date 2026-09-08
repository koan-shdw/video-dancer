// the ONE empty-state shape (law 9: teach the next action · law 11: one of everything).
// DOCTRINE: every PANEL-LEVEL empty state renders through this component — never hand-rolled
// markup — so restyling or enriching it here restyles every empty tab at once. Children take
// ANY content: teaching text today; clip/score lists, pickers, actions tomorrow. Row-level
// empties inside lists stay inline hints (a different shape, same law 9 voice).
// Default = the full monitor ground (an empty TAB); `bare` centers the same block inside an
// existing body (list wells, scrollers) without re-wrapping the panel.
export function EmptyState({ title, bare, children }: { title?: React.ReactNode; bare?: boolean; children: React.ReactNode }): React.JSX.Element {
  const block = (
    <div style={{ maxWidth: 460, textAlign: 'center', color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>
      {title != null && (
        <>
          <b style={{ color: 'var(--muted)' }}>{title}</b>
          <br />
        </>
      )}
      {children}
    </div>
  )
  if (bare) return <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>{block}</div>
  return (
    // the panel's own grey ground (the empty Queue's), never monitor black (user call 2026-08-20)
    <div className="vd-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      {block}
    </div>
  )
}
