import { vd } from '../api'
// MiniMax H3 readiness (MINIMAX-H3-LOCAL-SPEC-2026-09-22 §2) — the ltxReady shape, one shared
// cache the pickers and the render gate read: installed base tiers best-first, installed
// encoders best-first, the essentials row, the speed kernels. Refreshed on boot and after
// every models:done. renderReady = one tier + one encoder + essentials.
import { useEffect, useState } from 'react'
import { H3_BASE_IDS, H3_CORE_ID, H3_ENCODER_IDS, H3_KERNELS_ID, localModelFor } from '../shared/localModels'

export interface H3ReadyState {
  renderReady: boolean
  bases: { id: string; label: string }[] // installed tiers, best-first — the dropdown's size entries
  encoders: { id: string; label: string }[] // installed encoders, best-first — the card's encoder pick
  core: boolean
  kernels: boolean // the speed-kernels row is in — the card's kernels pick opens
}

let state: H3ReadyState = { renderReady: false, bases: [], encoders: [], core: false, kernels: false }
const listeners = new Set<(s: H3ReadyState) => void>()
let started = false

export function h3Ready(): H3ReadyState {
  return state
}

export function refreshH3Ready(): void {
  void vd().modelsList().then((l) => {
    const ready = (id: string): boolean => l.rows.find((x) => x.id === id)?.status === 'ready'
    const label = (id: string): string => localModelFor(id)?.label ?? id
    const bases = H3_BASE_IDS.filter(ready).map((id) => ({ id, label: label(id) }))
    const encoders = H3_ENCODER_IDS.filter(ready).map((id) => ({ id, label: label(id) }))
    const core = ready(H3_CORE_ID)
    state = { renderReady: bases.length > 0 && encoders.length > 0 && core, bases, encoders, core, kernels: ready(H3_KERNELS_ID) }
    for (const cb of listeners) cb(state)
  })
}

export function initH3Ready(): void {
  if (started) return
  started = true
  refreshH3Ready()
  vd().onModelsDone(() => refreshH3Ready())
}

// the reason shown before any submit (gating law: reason, never a failed render); null = go
export function h3GateReason(s: H3ReadyState = state): string | null {
  if (s.renderReady) return null
  if (!s.bases.length) return 'MiniMax H3 is not installed — pick a size in the Models card'
  if (!s.encoders.length) return 'MiniMax H3 needs an encoder — download one in the Models card'
  return 'MiniMax H3 essentials are missing — the Models card row installs them'
}

export function useH3Ready(): H3ReadyState {
  const [s, setS] = useState(state)
  useEffect(() => {
    initH3Ready()
    setS(state)
    const cb = (v: H3ReadyState): void => setS(v)
    listeners.add(cb)
    return () => void listeners.delete(cb)
  }, [])
  return s
}
