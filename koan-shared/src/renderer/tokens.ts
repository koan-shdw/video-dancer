// Design tokens — the single vocabulary for colors/spacing/type used in INLINE styles.
// Every color here is a var() reference into the :root theme block in styles.css — never a hex.
// That makes the :root block the ONE place a theme lives: repoint the vars, the whole app follows.
export const color = {
  bg: 'var(--bg)',
  bg2: 'var(--bg2)',
  panel: 'var(--bg0)', // deepest surface (timeline bed, monitor chrome) — named before --bg0 existed
  field: 'var(--field)',
  raised: 'var(--raised)',
  raised2: 'var(--raised2)',
  menu: 'var(--bg2)',
  line: 'var(--line)',
  line2: 'var(--line2)',
  text: 'var(--txt-hi)',
  body: 'var(--body)',
  muted: 'var(--muted)',
  dim: 'var(--dim)',
  amber: 'var(--amber)',
  amberDim: 'var(--amber-dim)',
  gold: 'var(--gold)',
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  music: 'var(--music)',
  musicTxt: 'var(--music-txt)'
} as const

export const font = {
  mono: 'var(--mono)'
} as const

export const radius = {
  sm: 4,
  md: 6,
  lg: 8
} as const

// the blessed spacing scale — use these instead of ad-hoc px (P1 token item)
export const spacing = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16
} as const
