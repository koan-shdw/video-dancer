// TETHER (docs/CODIRECTOR-TETHER-SPEC-2026-09-08.md) — the target registry and the nearest math.
// Anything a prompt can sit in stamps `data-tether="kind|ownerId|path"` on its element via
// tetherAttr(); the floating window scans those rects. Three levels: a FIELD (has a path), a
// HOLDER (a beat, the beat bar, a char sheet, a Library image), a WHOLE THING (a clip, a
// timeline, the library). Fields beat holders beat wholes when they overlap.
import type { Project } from '../shared/types'

export type TetherKind = 'clip' | 'style' | 'sheet' | 'beat' | 'beats' | 'image' | 'timeline' | 'library' | 'bin' | 'imagegen'
export interface FocusRef {
  kind: TetherKind
  ownerId: string
  path?: string
}

export const TETHER_REACH = 320 // px from the WINDOW's nearest edge to a target's nearest edge — beyond it, no tether

// a section holder = a path with no dot that isn't freeform ('prompt' · 'scene' · 'characters' · 'production' · 'beats')
export const isSectionPath = (path?: string): boolean => !!path && !path.includes('.') && path !== 'freeform'

export function tetherAttr(kind: TetherKind, ownerId: string, path?: string): { 'data-tether': string } {
  return { 'data-tether': `${kind}|${ownerId}|${path ?? ''}` }
}

export function parseTether(el: Element): FocusRef | null {
  const v = el.getAttribute('data-tether')
  if (!v) return null
  const [kind, ownerId, path] = v.split('|')
  if (!kind || !ownerId) return null
  return { kind: kind as TetherKind, ownerId, ...(path ? { path } : {}) }
}

// 0 = field, 1 = holder (a section, a beat, the beat bar, an image, a sheet card), 2 = whole thing
export function levelOf(ref: FocusRef): 0 | 1 | 2 {
  if (ref.path) return isSectionPath(ref.path) ? 1 : 0
  if (ref.kind === 'beat' || ref.kind === 'beats' || ref.kind === 'image' || ref.kind === 'sheet') return 1
  return 2
}

export const sameRef = (a: FocusRef | null, b: FocusRef | null): boolean => !!a && !!b && a.kind === b.kind && a.ownerId === b.ownerId && (a.path ?? '') === (b.path ?? '')

// a target's rect CLIPPED to every scrolling / clipping ancestor — a tile scrolled out of its
// panel still has a page rect (getBoundingClientRect ignores overflow), which landed the ring
// over another panel (director, 2026-09-08). null = not visible right now.
export function visibleRect(el: Element): DOMRect | null {
  let r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  let left = r.left
  let top = r.top
  let right = r.right
  let bottom = r.bottom
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p)
    const clips = (v: string): boolean => v === 'auto' || v === 'scroll' || v === 'hidden' || v === 'clip'
    if (clips(cs.overflowX) || clips(cs.overflowY)) {
      const pr = p.getBoundingClientRect()
      if (clips(cs.overflowX)) {
        left = Math.max(left, pr.left)
        right = Math.min(right, pr.right)
      }
      if (clips(cs.overflowY)) {
        top = Math.max(top, pr.top)
        bottom = Math.min(bottom, pr.bottom)
      }
      if (right - left < 2 || bottom - top < 2) return null
    }
  }
  r = new DOMRect(left, top, right - left, bottom - top)
  return r
}

export interface TetherHit {
  ref: FocusRef
  rect: DOMRect
  point: { x: number; y: number } // where the line lands on the target
  dist: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}
// nearest points between two boxes (0 apart when they overlap) — the window's box vs a target's rect
function boxToRect(w: Box, r: DOMRect): { dist: number; point: { x: number; y: number } } {
  const gx = r.left > w.right ? r.left - w.right : w.left > r.right ? w.left - r.right : 0
  const gy = r.top > w.bottom ? r.top - w.bottom : w.top > r.bottom ? w.top - r.bottom : 0
  return { dist: Math.hypot(gx, gy), point: tetherPoint(r) }
}

// every target has ONE tether point: its top corner FACING the window (KOAN.live wires §3 —
// top-left if the window sits to the left, top-right otherwise): a field's corner, a section's
// title, a thumbnail's top corner
export function tetherPoint(r: DOMRect, toward?: { x: number; y: number }): { x: number; y: number } {
  const right = !!toward && toward.x > r.left + r.width / 2
  return { x: right ? r.right - 5 : r.left + 5, y: r.top + 5 }
}

// the target overlapping / nearest the WINDOW within reach — null = no tether
export function nearestTarget(win: Box, reach = TETHER_REACH): TetherHit | null {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let best: (TetherHit & { level: number; area: number }) | null = null
  for (const el of Array.from(document.querySelectorAll('[data-tether]'))) {
    const ref = parseTether(el)
    if (!ref) continue
    const r = visibleRect(el) // clipped to its panel — scrolled-away things never win
    if (!r || r.width < 2 || r.height < 2) continue
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue // off-screen never wins
    const { dist, point } = boxToRect(win, r)
    if (dist > reach) continue
    const level = levelOf(ref)
    const area = r.width * r.height
    // closest wins; inside several (dist 0) → the deepest level, then the smallest rect
    if (!best || dist < best.dist - 0.5 || (Math.abs(dist - best.dist) <= 0.5 && (level < best.level || (level === best.level && area < best.area)))) best = { ref, rect: r, point, dist, level, area }
  }
  return best ? { ref: best.ref, rect: best.rect, point: best.point, dist: best.dist } : null
}

// the element for a ref, for the pinned line (the pinned target may re-render)
export function rectOf(ref: FocusRef): DOMRect | null {
  const want = `${ref.kind}|${ref.ownerId}|${ref.path ?? ''}`
  for (const el of Array.from(document.querySelectorAll('[data-tether]'))) if (el.getAttribute('data-tether') === want) return visibleRect(el)
  return null
}

// what the ref IS, in the app's own words — the window header and the "this one" line
export function labelOf(ref: FocusRef, p: Project | null | undefined): string {
  const clipName = (id: string): string => p?.clips.find((c) => c.id === id)?.name ?? '?'
  switch (ref.kind) {
    case 'clip':
      return ref.path ? (isSectionPath(ref.path) ? `the ${ref.path.toUpperCase()} section of clip ${clipName(ref.ownerId)}` : `${ref.path} on clip ${clipName(ref.ownerId)}`) : `clip ${clipName(ref.ownerId)}`
    case 'style': {
      const n = p?.styles.find((s) => s.id === ref.ownerId)?.name ?? '?'
      return ref.path ? `${ref.path} on style ${n}` : `style ${n}`
    }
    case 'sheet': {
      const n = p?.charSheets.find((s) => s.id === ref.ownerId)?.name ?? '?'
      return ref.path ? `${ref.path} on char sheet ${n}` : `char sheet ${n}`
    }
    case 'beat': {
      for (const c of p?.clips ?? []) {
        const b = c.promptData.beats.find((x) => x.id === ref.ownerId)
        if (b) return `beat "${b.name || 'shot'}" of clip ${c.name}`
      }
      return 'beat'
    }
    case 'beats':
      return `the beats of clip ${clipName(ref.ownerId)}`
    case 'image':
      return `image ${p?.images.find((i) => i.id === ref.ownerId)?.title ?? '?'}`
    case 'timeline':
      return ref.ownerId === '*' ? 'the timeline' : `timeline ${p?.timelines.find((t) => t.id === ref.ownerId)?.name ?? '?'}`
    case 'library':
      return 'the Library'
    case 'bin':
      return 'the Bin'
    case 'imagegen': {
      const n = p?.imageGens?.find((g) => g.id === ref.ownerId)?.name ?? '?'
      return ref.path ? `${ref.path} on image gen ${n}` : `image gen ${n}`
    }
  }
}

// can a proposal be committed into this target? (a section or a whole thing is context only)
export function writable(ref: FocusRef): boolean {
  return !!ref.path && !isSectionPath(ref.path) && (ref.kind === 'clip' || ref.kind === 'style' || ref.kind === 'sheet' || ref.kind === 'imagegen')
}

// the target whose rect contains a point (deepest level, smallest rect) — the ⌖ drop test; a
// rect hit-test beats elementFromPoint, which hover layers and portals can swallow
export function targetAtPoint(x: number, y: number): { ref: FocusRef; el: Element } | null {
  let best: { ref: FocusRef; el: Element; level: number; area: number } | null = null
  for (const el of Array.from(document.querySelectorAll('[data-tether]'))) {
    const ref = parseTether(el)
    if (!ref) continue
    const r = visibleRect(el)
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue
    const level = levelOf(ref)
    const area = r.width * r.height
    if (!best || level < best.level || (level === best.level && area < best.area)) best = { ref, el, level, area }
  }
  return best ? { ref: best.ref, el: best.el } : null
}

// ---- the wire is STRING, not rod: KOAN.live's patch-wire rope (app/src/wires.rs, WIRES-SPEC
// §4) — verlet, 24 nodes, gravity 600, damping 0.985, 4 constraint passes, rest length =
// distance × 1.15 + 40 (visible slack even on short runs), dt clamped to 1/30 so a hitch can't
// fling it, born straight then drops into its sag. The owner steps it every frame with the
// live ends and paints the Catmull-Rom path imperatively. ----
type P = { x: number; y: number }
export class Rope {
  private pts: (P & { px: number; py: number })[] = []
  constructor(
    private n = 24,
    private gravity = 600, // px/s²
    private damping = 0.985,
    private passes = 4
  ) {}
  static restLen(a: P, b: P): number {
    return Math.hypot(b.x - a.x, b.y - a.y) * 1.15 + 40
  }
  private seed(a: P, b: P): void {
    this.pts = Array.from({ length: this.n }, (_, i) => {
      const t = i / (this.n - 1)
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      return { x, y, px: x, py: y }
    })
  }
  reset(): void {
    this.pts = []
  }
  step(a: P, b: P, dt: number): void {
    if (this.pts.length !== this.n) this.seed(a, b)
    const h = Math.min(dt, 1 / 30)
    // integrate (verlet): keep momentum, add gravity
    for (let i = 1; i < this.n - 1; i++) {
      const p = this.pts[i]
      const vx = (p.x - p.px) * this.damping
      const vy = (p.y - p.py) * this.damping
      p.px = p.x
      p.py = p.y
      p.x += vx
      p.y += vy + this.gravity * h * h
    }
    // pin the ends to the live anchor + target, then relax the links toward the rest length
    const rest = Rope.restLen(a, b) / (this.n - 1)
    for (let iter = 0; iter < this.passes; iter++) {
      this.pts[0].x = a.x
      this.pts[0].y = a.y
      this.pts[this.n - 1].x = b.x
      this.pts[this.n - 1].y = b.y
      for (let i = 0; i < this.n - 1; i++) {
        const p = this.pts[i]
        const q = this.pts[i + 1]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d = Math.hypot(dx, dy) || 0.0001
        const diff = (d - rest) / d
        const wp = i === 0 ? 0 : 0.5
        const wq = i + 1 === this.n - 1 ? 0 : 0.5
        const k = wp + wq || 1
        p.x += dx * diff * (wp / k)
        p.y += dy * diff * (wp / k)
        q.x -= dx * diff * (wq / k)
        q.y -= dy * diff * (wq / k)
      }
    }
  }
  // Catmull-Rom through the nodes (wires.rs smooth()), emitted as cubic Béziers
  path(): string {
    const p = this.pts
    if (p.length < 2) return ''
    let d = `M ${p[0].x} ${p[0].y}`
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)]
      const p1 = p[i]
      const p2 = p[i + 1]
      const p3 = p[Math.min(p.length - 1, i + 2)]
      const c1x = p1.x + (p2.x - p0.x) / 6
      const c1y = p1.y + (p2.y - p0.y) / 6
      const c2x = p2.x - (p3.x - p1.x) / 6
      const c2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
    }
    return d
  }
}

// fenced blocks in a reply = the proposals
export function proposalsOf(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g)) {
    // a label line the model put INSIDE the fence ("PROPOSAL A — …") is not field text — drop it
    const t = m[1]
      .trim()
      .replace(/^(proposal|option|version)\s*[a-z0-9]+\s*[—:\-–].*\r?\n+/i, '')
      .trim()
    if (t) out.push(t)
  }
  return out.slice(0, 3)
}
