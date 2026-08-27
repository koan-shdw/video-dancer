// THE engine dropdown list — bible 12.9, user spec verbatim: "the drag down and we can
// select the different versions that are installed with the model name in brackets next to
// them. Only whats downloaded, if nothing downloaded yet it brings up the model card."
// One grammar for the Clip Gen model picker: fal/api engines by label, then one entry PER
// INSTALLED LTX size, adjacent, labeled off the Models card rows; nothing installed = one
// 'LTX 2.5 (local)' entry whose pick opens the Models card (sprite-dancer reference copy).
import { MODELS, modelFor } from '../../../shared/models'
import type { EngineId } from '../../../shared/types'
import { localModelFor } from '../../../shared/localModels'
import { ltxReady } from './ltxReady'

export interface EngineOpt {
  value: string // engine id, or 'ltx25|<sizeId>' for an installed local size
  label: string
}

const sizeWord = (sizeLabel: string): string => sizeLabel.replace(/[()]/g, '') // "quality (int8)" → "quality int8"
export const ltxOptLabel = (sizeLabel: string): string => `LTX 2.5 (${sizeWord(sizeLabel)})`

const DEV_ID = 'ltx-2.5-full'
const DEV_LABEL = 'LTX 2.5 (full dev bf16)' // proven live 2026-08-27 — still never the auto pick

// hidden engines stay out of the picker EXCEPT the one the clip already uses (house grammar)
export function engineOptions(currentEngine?: EngineId): EngineOpt[] {
  const out: EngineOpt[] = []
  for (const m of Object.values(MODELS)) {
    if (m.provider === 'local') continue // the local engine renders as its size entries below
    if (m.hidden && m.id !== currentEngine) continue
    out.push({ value: m.id, label: m.label })
  }
  const { sizes, devReady } = ltxReady()
  if (sizes.length === 0 && !devReady) out.push({ value: 'ltx25', label: modelFor('ltx25').label })
  else {
    for (const s of sizes) out.push({ value: `ltx25|${s.id}`, label: ltxOptLabel(s.label) })
    if (devReady) out.push({ value: `ltx25|${DEV_ID}`, label: DEV_LABEL })
  }
  return out
}

// what a stored (engine, ltxSize) pick selects in the dropdown. A local pick with no stored
// size shows the entry that actually renders (best installed); nothing installed = the bare
// local entry.
export function encodeEngine(engine: EngineId, ltxSize?: string): string {
  if (engine !== 'ltx25') return engine
  if (ltxSize) return `ltx25|${ltxSize}`
  const { sizes } = ltxReady()
  return sizes.length ? `ltx25|${sizes[0].id}` : 'ltx25'
}

export function decodeEngine(v: string): { engine: EngineId; ltxSize?: string } {
  if (v.startsWith('ltx25|')) return { engine: 'ltx25', ltxSize: v.slice('ltx25|'.length) }
  return { engine: v as EngineId }
}

// display label for a stored pick (chips, take footers)
export function engineLabelFor(engine: EngineId, ltxSize?: string): string {
  if (engine !== 'ltx25') return modelFor(engine).label
  const { sizes, devReady } = ltxReady()
  if (ltxSize === DEV_ID && devReady) return DEV_LABEL
  const size = (ltxSize && sizes.find((s) => s.id === ltxSize)) || sizes[0]
  if (size) return ltxOptLabel(size.label)
  if (ltxSize) return `LTX 2.5 (${sizeWord(localModelFor(ltxSize)?.label ?? ltxSize)} · not installed)`
  return modelFor('ltx25').label
}

// a stored pin whose files were deleted stays selectable + visible (store-everything law) —
// the render falls down the ladder and the queue row says so
export function missingPinOption(engine: EngineId | undefined, ltxSize: string | undefined): EngineOpt | null {
  if (engine !== 'ltx25' || !ltxSize) return null
  const { sizes, devReady } = ltxReady()
  if (ltxSize === DEV_ID && devReady) return null
  if (sizes.some((s) => s.id === ltxSize)) return null
  return { value: `ltx25|${ltxSize}`, label: `LTX 2.5 (${sizeWord(localModelFor(ltxSize)?.label ?? ltxSize)} · not installed)` }
}
