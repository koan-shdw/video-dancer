// THE engine dropdown list — bible 12.9, user spec verbatim: "the drag down and we can
// select the different versions that are installed with the model name in brackets next to
// them. Only whats downloaded, if nothing downloaded yet it brings up the model card."
// One grammar for the Clip Gen model picker: fal/api engines by label, then one entry PER
// INSTALLED LTX size, adjacent, labeled off the Models card rows; nothing installed = one
// 'LTX 2.5 (local)' entry whose pick opens the Models card (sprite-dancer reference copy).
import { MODELS, modelFor } from '../shared/models'
import type { EngineId } from '../shared/types'
import { localModelFor } from '../shared/localModels'
import { ltxReady } from './ltxReady'
import { h3Ready } from './h3Ready'

export interface EngineOpt {
  value: string // engine id, or 'ltx25|<sizeId>' / 'h3local|<tierId>' for an installed local size
  label: string
}

const sizeWord = (sizeLabel: string): string => sizeLabel.replace(/[()]/g, '') // "quality (int8)" → "quality int8"
export const ltxOptLabel = (sizeLabel: string): string => `LTX 2.5 (${sizeWord(sizeLabel)})`
export const h3OptLabel = (tierLabel: string): string => `MiniMax H3 (${sizeWord(tierLabel)})`

// the local engines' size entries (bible 12.9, MINIMAX-H3-LOCAL-SPEC §3): one entry per
// INSTALLED size; nothing installed = the bare engine entry whose pick opens the Models card
function localEntries(): EngineOpt[] {
  const out: EngineOpt[] = []
  const { sizes, devReady } = ltxReady()
  if (sizes.length === 0 && !devReady) out.push({ value: 'ltx25', label: modelFor('ltx25').label })
  else {
    for (const s of sizes) out.push({ value: `ltx25|${s.id}`, label: ltxOptLabel(s.label) })
    if (devReady) out.push({ value: `ltx25|${DEV_ID}`, label: DEV_LABEL })
  }
  const h3 = h3Ready()
  if (h3.bases.length === 0) out.push({ value: 'h3local', label: modelFor('h3local').label })
  else for (const b of h3.bases) out.push({ value: `h3local|${b.id}`, label: h3OptLabel(b.label) })
  return out
}

const DEV_ID = 'ltx-2.5-full'
const DEV_LABEL = 'LTX 2.5 (full dev bf16)' // proven live 2026-08-27 — the auto pick only when no distilled size is installed (list 16)

// ----- MODEL · VIA split (user call 2026-09-01: one flat list "tells us nothing") -----
// MODEL lists model families + installed LTX sizes; VIA lists who actually serves the picked
// family. The stored unit is untouched: a clip still pins one EngineId (+ ltxSize).
interface FamilyMember {
  id: EngineId
  via: string
}
const FAMILIES: Record<string, { label: string; members: FamilyMember[] }> = {
  seedance2: {
    label: 'Seedance 2',
    members: [
      { id: 'seedance2', via: 'fal' },
      { id: 'seedance2ark', via: 'ModelArk' },
      { id: 'seedance2astria', via: 'Astria' },
      { id: 'seedance2venice', via: 'Venice' }, // list 14: the quality row first — the fast tier is a deliberate pick
      { id: 'seedance2venicefast', via: 'Venice (fast)' },
      { id: 'seedance2hfmcp', via: 'Higgsfield Bridge' },
      { id: 'seedance2runway', via: 'Runway Bridge' },
      { id: 'seedance2mag', via: 'Magnific Bridge' },
      { id: 'seedance2pika', via: 'Pika Bridge' },
      { id: 'seedance2bridge', via: 'Bridge (auto)' },
      { id: 'seedance2hf', via: 'Higgsfield API' } // hidden engine — listed only while a clip still pins it
    ]
  },
  seedance25: {
    label: 'Seedance 2.5',
    members: [
      { id: 'seedance25', via: 'fal' },
      { id: 'seedance25ark', via: 'ModelArk' },
      { id: 'seedance25venice', via: 'Venice' },
      { id: 'seedance25hfmcp', via: 'Higgsfield Bridge' },
      { id: 'seedance25runway', via: 'Runway Bridge' },
      { id: 'seedance25mag', via: 'Magnific Bridge' },
      { id: 'seedance25bridge', via: 'Bridge (auto)' }
    ]
  },
  sora2: { label: 'Sora 2', members: [{ id: 'sora2', via: 'fal' }] },
  omniflash11: { label: 'Gemini Omni Flash 1.1', members: [{ id: 'omniflash11', via: 'fal' }] }, // list 13: the newest first
  omniflash: { label: 'Gemini Omni Flash', members: [{ id: 'omniflash', via: 'fal' }] },
  h3maxlipsync: { label: 'H3 Max Lip Sync (a talking still)', members: [{ id: 'h3maxlipsync', via: 'fal' }] } // list 23
}

export const isFamily = (v: string): boolean => v in FAMILIES

export function familyOf(engine: EngineId): string | null {
  for (const [key, f] of Object.entries(FAMILIES)) if (f.members.some((m) => m.id === engine)) return key
  return null
}

// last VIA pick per family, remembered per user (localStorage — a per-viewer convenience)
const VIA_LS = 'vd-via-by-family'
function viaMemory(): Record<string, EngineId> {
  try {
    return JSON.parse(localStorage.getItem(VIA_LS) ?? '{}') as Record<string, EngineId>
  } catch {
    return {}
  }
}
export function rememberVia(family: string, engine: EngineId): void {
  try {
    localStorage.setItem(VIA_LS, JSON.stringify({ ...viaMemory(), [family]: engine }))
  } catch {
    // storage unavailable — the pick still works, it just isn't remembered
  }
}

// MODEL list: one row per family, then the installed local sizes exactly as before. A family
// whose every lane is hidden (Sora 2, shut down) shows only while the clip still pins it.
export function modelOptions(currentEngine?: EngineId): EngineOpt[] {
  const out: EngineOpt[] = Object.entries(FAMILIES)
    .filter(([, f]) => f.members.some((m) => !modelFor(m.id).hidden || m.id === currentEngine))
    .map(([key, f]) => ({ value: key, label: f.label }))
  out.push(...localEntries())
  return out
}

export interface ViaOpt {
  value: string // EngineId, or 'bridge-auto' (disabled until the router lands)
  label: string
  disabled?: boolean
  title?: string
}

// VIA list for the picked family — hidden engines only while a clip still pins them; a
// Bridge (auto) row appears disabled wherever a Bridge lane exists (router = a later stage)
export function viaOptions(family: string, currentEngine?: EngineId): ViaOpt[] {
  const f = FAMILIES[family]
  if (!f) return [{ value: currentEngine ?? 'ltx25', label: 'local', disabled: true, title: 'local engine — your GPU runs it' }]
  const out: ViaOpt[] = []
  for (const m of f.members) {
    if (modelFor(m.id).hidden && m.id !== currentEngine) continue
    out.push({ value: m.id, label: m.via })
  }
  return out
}

// the engine a MODEL pick lands on: the remembered VIA for that family, else its first live lane
export function engineForFamily(family: string): EngineId {
  const f = FAMILIES[family]
  if (!f) return 'ltx25'
  const remembered = viaMemory()[family]
  if (remembered && f.members.some((m) => m.id === remembered && !modelFor(m.id).hidden)) return remembered
  const first = f.members.find((m) => !modelFor(m.id).hidden)
  return (first ?? f.members[0]).id
}

// hidden engines stay out of the picker EXCEPT the one the clip already uses (house grammar)
export function engineOptions(currentEngine?: EngineId): EngineOpt[] {
  const out: EngineOpt[] = []
  for (const m of Object.values(MODELS)) {
    if (m.provider === 'local') continue // the local engines render as their size entries below
    if (!m.modes.length) continue // edit-only engines (Kling O3 Edit) live in the Video Editor
    if (m.hidden && m.id !== currentEngine) continue
    out.push({ value: m.id, label: m.label })
  }
  out.push(...localEntries())
  return out
}

// what a stored (engine, ltxSize) pick selects in the dropdown. A local pick with no stored
// size shows the entry that actually renders (best installed); nothing installed = the bare
// local entry.
export function encodeEngine(engine: EngineId, ltxSize?: string): string {
  if (engine === 'h3local') {
    if (ltxSize) return `h3local|${ltxSize}`
    const { bases } = h3Ready()
    return bases.length ? `h3local|${bases[0].id}` : 'h3local'
  }
  if (engine !== 'ltx25') return engine
  if (ltxSize) return `ltx25|${ltxSize}`
  const { sizes } = ltxReady()
  return sizes.length ? `ltx25|${sizes[0].id}` : 'ltx25'
}

export function decodeEngine(v: string): { engine: EngineId; ltxSize?: string } {
  if (v.startsWith('ltx25|')) return { engine: 'ltx25', ltxSize: v.slice('ltx25|'.length) }
  if (v.startsWith('h3local|')) return { engine: 'h3local', ltxSize: v.slice('h3local|'.length) }
  return { engine: v as EngineId }
}

// display label for a stored pick (chips, take footers)
export function engineLabelFor(engine: EngineId, ltxSize?: string): string {
  if (engine === 'h3local') {
    const { bases } = h3Ready()
    const tier = (ltxSize && bases.find((b) => b.id === ltxSize)) || bases[0]
    if (tier) return h3OptLabel(tier.label)
    if (ltxSize) return `MiniMax H3 (${sizeWord(localModelFor(ltxSize)?.label ?? ltxSize)} · not installed)`
    return modelFor('h3local').label
  }
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
  if (engine === 'h3local' && ltxSize) {
    if (h3Ready().bases.some((b) => b.id === ltxSize)) return null
    return { value: `h3local|${ltxSize}`, label: `MiniMax H3 (${sizeWord(localModelFor(ltxSize)?.label ?? ltxSize)} · not installed)` }
  }
  if (engine !== 'ltx25' || !ltxSize) return null
  const { sizes, devReady } = ltxReady()
  if (ltxSize === DEV_ID && devReady) return null
  if (sizes.some((s) => s.id === ltxSize)) return null
  return { value: `ltx25|${ltxSize}`, label: `LTX 2.5 (${sizeWord(localModelFor(ltxSize)?.label ?? ltxSize)} · not installed)` }
}
