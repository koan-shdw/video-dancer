// EFFECTS v2 — how the ordered fx stack rides a TimelineItem TODAY, before schema v17 lands.
//
// The v2 shape ({ v: 2, stack, blend }) is NOT the shared-schema ItemFx (v16's fixed fields).
// It persists verbatim through the whole-array `timeline:set` write, which main stores without
// sanitizing; it must NEVER go through `timelineSetItemFx` — main's v16 whitelist sanitizer
// would silently strip it to {}. When the app can be closed, schema v17 adopts this shape and
// main's sanitizer learns it; until then every read/write of item.fx goes through this file so
// the `as unknown` casts live in exactly one place.

import type { FxStack, FxBlend } from './core/types'

export interface FxV2 extends FxStack {
  v: 2
}

export const readFx2 = (it: TimelineItem | null | undefined): FxV2 | null => {
  const f = it?.fx as unknown
  if (!f || typeof f !== 'object') return null
  // main persists this shape verbatim (no sanitizer), so validate on READ: a hand-edited or
  // foreign-writer fx must never crash the panel or the Monitor's rAF engine
  if ((f as { v?: unknown }).v !== 2 || !Array.isArray((f as { stack?: unknown }).stack)) return null
  return f as FxV2
}

const neutralBlend = (b: FxBlend | undefined): boolean => !b || (b.mode === 'normal' && (b.opacity ?? 1) >= 1)

// does this block's fx change any pixel — drives the Monitor's chain-vs-DOM choice and the badge
export const hasFx2 = (it: TimelineItem | null | undefined): boolean => {
  const f = readFx2(it)
  return !!f && (f.stack.length > 0 || !neutralBlend(f.blend))
}

// a normalized copy for writing: empty stack + neutral blend collapses to undefined so untouched
// blocks stay byte-identical to pre-fx projects
export const packFx2 = (fx: FxV2 | null): FxV2 | undefined => {
  if (!fx) return undefined
  const stack = fx.stack.filter((e) => e && e.type)
  if (stack.length === 0 && neutralBlend(fx.blend)) return undefined
  const out: FxV2 = { v: 2, stack }
  if (!neutralBlend(fx.blend)) out.blend = fx.blend
  return out
}

export const emptyFx2 = (): FxV2 => ({ v: 2, stack: [] })

let idCounter = 0
export const freshEntryId = (): string => `fx${Date.now().toString(36)}${(idCounter++).toString(36)}`

// (the v16-era "linked loops" helpers lived here — stamped copies + loopOf link keys. Dead
// system, replaced by the v17 ⟲ LOOP TAIL projection: see lib/timelineUtils tailEndOf/extentOf.
// migrate() strips any surviving loopOf keys; old copies stay as plain independent blocks.)
