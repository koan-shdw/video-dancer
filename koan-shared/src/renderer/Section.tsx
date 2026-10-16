// THE section recipe (KOAN one-legend rule, ch. 03/09): uppercase legend + optional ▸/▾ collapse
// + bordered card body. Collapsibility is a prop, not a different design — Settings uses it today;
// panel landmarks (Clip Gen's sec()) migrate onto it in the gap-09 pass.
export function Section(props: {
  title: React.ReactNode
  right?: React.ReactNode // header chip/summary — stays visible even when collapsed
  collapsible?: boolean
  open?: boolean // controlled when collapsible (parent owns the set of open sections)
  onToggle?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const open = props.collapsible ? (props.open ?? true) : true
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        data-fold=""
        onClick={props.collapsible ? props.onToggle : undefined}
        title={props.collapsible ? (open ? 'collapse' : 'expand') : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          padding: '3px 0',
          userSelect: 'none',
          cursor: props.collapsible ? 'pointer' : 'default'
        }}
      >
        {props.collapsible && <span style={{ width: 10, color: 'var(--muted)' }}>{open ? '▾' : '▸'}</span>}
        {props.title}
        {props.right && <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{props.right}</span>}
      </div>
      {open && (
        <div style={{ marginTop: 6, border: '1px solid var(--line)', borderRadius: 6, padding: '10px 12px', background: 'var(--panel)' }}>
          {props.children}
        </div>
      )}
    </div>
  )
}
