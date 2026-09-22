import type React from 'react'

// ----- ARROW KEYS (TODO-2026-09-22 §19). His words: "using arrow keys to move around library items
// including takes in clip gen alloing keyboard to skip thorugh them and preview". One helper for
// every tile grid and take row: the box takes focus on click and remembers the tile under that
// click; ←/→ step in order, ↑/↓ step by POSITION (a wrapping row and a grid work alike); the landed
// tile scrolls into view and `onLand` does what that surface wants: select, or preview. Never the
// keeper (his call 09-22: "it doesnt change the keeper its just showing a preview"). The next click
// anywhere else takes the focus away and the arrows go back to the timeline scrub (App.tsx). -----

const NAV = 'data-nav'
const BOX = 'data-nav-box'
const current = new WeakMap<HTMLElement, HTMLElement>() // the box → the tile the arrows move from

const tilesOf = (box: HTMLElement): HTMLElement[] => Array.from(box.querySelectorAll<HTMLElement>(`[${NAV}]`)).filter((el) => el.closest(`[${BOX}]`) === box)

function neighbour(tiles: HTMLElement[], cur: HTMLElement, key: string): HTMLElement | null {
  const i = tiles.indexOf(cur)
  if (key === 'ArrowLeft') return tiles[i - 1] ?? null
  if (key === 'ArrowRight') return tiles[i + 1] ?? null
  // ↑/↓: the nearest row in that direction, then the closest column
  const r = cur.getBoundingClientRect()
  const cx = r.left + r.width / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const t of tiles) {
    if (t === cur) continue
    const q = t.getBoundingClientRect()
    const dy = key === 'ArrowDown' ? q.top - r.bottom : r.top - q.bottom
    if (dy < -1) continue
    const score = dy * 10_000 + Math.abs(q.left + q.width / 2 - cx)
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

// spread onto the grid / row container; give every tile `data-nav={id}`
export function arrowNav(onLand: (id: string, e: { shiftKey: boolean }) => void): {
  [BOX]: string
  tabIndex: number
  onMouseDownCapture: (e: React.MouseEvent<HTMLElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
} {
  return {
    [BOX]: '',
    tabIndex: -1,
    onMouseDownCapture: (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>(`[${NAV}]`)
      if (tile && e.currentTarget.contains(tile)) current.set(e.currentTarget, tile)
    },
    onKeyDown: (e) => {
      if (!e.key.startsWith('Arrow')) return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      const box = e.currentTarget
      const tiles = tilesOf(box)
      if (!tiles.length) return
      const cur = current.get(box)
      const next = cur && tiles.includes(cur) ? neighbour(tiles, cur, e.key) : tiles[0]
      e.preventDefault()
      e.stopPropagation() // the timeline's frame step (App.tsx window listener) must not fire too
      if (!next) return
      current.set(box, next)
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      onLand(next.getAttribute(NAV)!, { shiftKey: e.shiftKey })
    }
  }
}
