// Themes = overrides of the :root CSS variables (styles.css is the single theme point, so
// re-skinning the whole app is just setProperty on documentElement). 'OG VDancer' is the
// stylesheet baseline (no overrides); presets + user-made themes are var→color maps saved in
// settings (activeTheme + customThemes).

export const THEME_VARS: { v: string; label: string }[] = [
  { v: '--bg0', label: 'background · deepest' },
  { v: '--bg', label: 'background' },
  { v: '--bg2', label: 'background · raised' },
  { v: '--panel', label: 'panel' },
  { v: '--panel2', label: 'panel · raised' },
  { v: '--raised', label: 'card' },
  { v: '--raised2', label: 'card · raised' },
  { v: '--field', label: 'input field' },
  { v: '--header', label: 'header bar' },
  { v: '--line', label: 'line' },
  { v: '--line2', label: 'line · strong' },
  { v: '--txt-hi', label: 'text · bright' },
  { v: '--txt', label: 'text' },
  { v: '--body', label: 'text · body' },
  { v: '--muted', label: 'text · muted' },
  { v: '--dim', label: 'text · dim' },
  { v: '--amber', label: 'ACCENT' },
  { v: '--amber-dim', label: 'accent · dim' },
  { v: '--gold', label: 'accent · soft' },
  { v: '--on-accent', label: 'text on accent' },
  { v: '--ok', label: 'success' },
  { v: '--bad', label: 'danger' },
  { v: '--music', label: 'music lane' },
  { v: '--music-txt', label: 'music text' },
  { v: '--score', label: 'score tracks' },
  { v: '--score-txt', label: 'score text' },
  // linked-audio blue joined the contract late — presets couldn't restyle it, applyTheme never
  // cleared an override, and the custom editor couldn't offer it (stock blue leaked into every theme)
  { v: '--alink', label: 'linked audio' },
  { v: '--alink-txt', label: 'linked audio text' },
  // list 52: an enhanced copy's outline (take cards, Library tiles) — blue / green / purple by default
  { v: '--enh-interp', label: 'enhanced · interpolated' },
  { v: '--enh-up', label: 'enhanced · upscaled' },
  { v: '--enh-both', label: 'enhanced · both' },
  { v: '--b1', label: 'beat 1' },
  { v: '--b2', label: 'beat 2' },
  { v: '--b3', label: 'beat 3' },
  { v: '--b4', label: 'beat 4' },
  { v: '--b5', label: 'beat 5' }
]

export type ThemeMap = Record<string, string>

export const OG_THEME = 'OG VDancer'

// old preset names live in saved settings — map them forward so nobody boots into the default
export const THEME_RENAMES: Record<string, string> = { Cyberpunk: 'DECK', 'High Tech': 'WINTERMUTE' }

export const PRESET_THEMES: Record<string, ThemeMap> = {
  [OG_THEME]: {}, // the stylesheet itself
  DECK: {
    '--bg0': '#050807',
    '--bg': '#070a08',
    '--bg2': '#0c120e',
    '--panel': '#101713',
    '--panel2': '#16201a',
    '--raised': '#0b110d',
    '--raised2': '#121a15',
    '--field': '#08100b',
    '--header': '#020403',
    '--line': '#1e3327',
    '--line2': '#2c4a38',
    '--txt-hi': '#e6ffe9',
    '--txt': '#d8f5dd',
    '--body': '#b8dfc2',
    '--muted': '#7aa989',
    '--dim': '#4e7360',
    '--amber': '#00ff9f',
    '--amber-dim': '#0a7a52',
    '--gold': '#7dffc7',
    '--on-accent': '#001a10',
    '--ok': '#52e07a',
    '--bad': '#ff5f56',
    '--music': '#39c6a2',
    '--music-txt': '#d8fff0',
    '--b1': '#00e5ff',
    '--b2': '#00ff9f',
    '--b3': '#b967ff',
    '--b4': '#38b6ff',
    '--b5': '#ff5f56'
  },
  WINTERMUTE: {
    '--bg0': '#0a0d12',
    '--bg': '#0d1017',
    '--bg2': '#131722',
    '--panel': '#1a1f2c',
    '--panel2': '#222836',
    '--raised': '#12161f',
    '--raised2': '#191e2a',
    '--field': '#0e1219',
    '--header': '#05070b',
    '--line': '#2a3040',
    '--line2': '#3a4256',
    '--txt-hi': '#eef2fa',
    '--txt': '#e2e8f4',
    '--body': '#c6cfe0',
    '--muted': '#8e99b0',
    '--dim': '#626c82',
    '--amber': '#4fa8ff',
    '--amber-dim': '#2c5f96',
    '--gold': '#9cc8ff',
    '--on-accent': '#00101f',
    '--ok': '#4fd08c',
    '--bad': '#ff6b7a',
    '--music': '#58b8a8',
    '--music-txt': '#dcf5ef',
    '--b1': '#38d0c0',
    '--b2': '#4fa8ff',
    '--b3': '#b06fe0',
    '--b4': '#6fc1ff',
    '--b5': '#ff6b7a'
  },
  // 1970s: cream on smoked walnut, burnt-orange accent, avocado + harvest gold everywhere
  FUCKUP: {
    '--bg0': '#14100c',
    '--bg': '#171310',
    '--bg2': '#201a14',
    '--panel': '#281f17',
    '--panel2': '#32271c',
    '--raised': '#1d1712',
    '--raised2': '#251d16',
    '--field': '#171210',
    '--header': '#0d0a07',
    '--line': '#40342a',
    '--line2': '#55443a',
    '--txt-hi': '#f5ecd9',
    '--txt': '#eee3cf',
    '--body': '#d9c9ae',
    '--muted': '#a8977d',
    '--dim': '#776855',
    '--amber': '#e0762e',
    '--amber-dim': '#8a4a1e',
    '--gold': '#e8b04b',
    '--on-accent': '#1a0d04',
    '--ok': '#7a9a3d',
    '--bad': '#c3402f',
    '--music': '#8a9a4a',
    '--music-txt': '#eef0d8',
    '--b1': '#7a9a3d',
    '--b2': '#e8b04b',
    '--b3': '#4f8f8b',
    '--b4': '#c3672f',
    '--b5': '#a04a68'
  }
}

export function resolveTheme(name: string | undefined, custom: Record<string, ThemeMap> | undefined): ThemeMap {
  const n = name ? THEME_RENAMES[name] ?? name : name
  if (!n || n === OG_THEME) return {}
  return PRESET_THEMES[n] ?? custom?.[n] ?? {}
}

// apply = override the vars the theme names, CLEAR the rest back to the stylesheet baseline
export function applyTheme(overrides: ThemeMap): void {
  const root = document.documentElement
  for (const { v } of THEME_VARS) {
    const val = overrides[v]
    if (val) root.style.setProperty(v, val)
    else root.style.removeProperty(v)
  }
}

// the currently EFFECTIVE color of a var (override or stylesheet baseline) — seeds the editor
export function currentColor(v: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim()
}
