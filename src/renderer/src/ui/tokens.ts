// Design tokens — the single vocabulary for colors/spacing/type used in inline styles.
// These mirror the CSS custom properties in styles.css (which remain the source of truth for
// class-based styling); inline styles should reference THESE instead of hardcoding hex/px.
// The roadmap-1 design-system pass will grow this file (lucide icons, primitives, spacing scale).
export const color = {
  bg: 'var(--bg)',
  bg2: 'var(--bg2)',
  panel: '#0c0c0f',
  field: '#101014',
  raised: '#15151a',
  raised2: '#1a1a20',
  menu: '#16161a',
  line: 'var(--line)',
  line2: 'var(--line2)',
  text: '#e8e8ee',
  body: '#cfcfd6',
  muted: 'var(--muted)',
  dim: 'var(--dim)',
  amber: 'var(--amber)',
  amberDim: 'var(--amber-dim)',
  bad: 'var(--bad)'
} as const

export const font = {
  mono: 'var(--mono)'
} as const

export const radius = {
  sm: 4,
  md: 6,
  lg: 8
} as const
