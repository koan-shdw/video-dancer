import { vd } from '../api'
// LTX readiness — one shared cache the pickers and the render gate read (the RenderPanel
// ltxSt shape lifted out so imperative code can read it too; sprite-dancer reference,
// bible 12.9). A DISTILLED size on disk = renderable; full (dev bf16) alone is not — its
// sampling recipe is unproven. Refreshed on boot and after every models:done.
import { useEffect, useState } from 'react'
import { LTX_DISTILLED_IDS, localModelFor } from '../shared/localModels'

export interface LtxReadyState {
  renderReady: boolean
  fullOnly: boolean
  devReady: boolean // full (dev bf16) on disk — offered as an explicit experimental pick, never auto
  sizes: { id: string; label: string }[] // installed distilled sizes, ladder (best-first) order — the size entries' options
}

let state: LtxReadyState = { renderReady: false, fullOnly: false, devReady: false, sizes: [] }
const listeners = new Set<(s: LtxReadyState) => void>()
let started = false

export function ltxReady(): LtxReadyState {
  return state
}

export function refreshLtxReady(): void {
  void vd().modelsList().then((l) => {
    const ready = (id: string): boolean => l.rows.find((x) => x.id === id)?.status === 'ready'
    const sizes = LTX_DISTILLED_IDS.filter(ready).map((id) => ({ id, label: localModelFor(id)?.label ?? id }))
    state = { renderReady: sizes.length > 0, fullOnly: sizes.length === 0 && ready('ltx-2.5-full'), devReady: ready('ltx-2.5-full'), sizes }
    for (const cb of listeners) cb(state)
  })
}

// App calls this once at boot so imperative readers see real state even before any picker
// mounts the hook
export function initLtxReady(): void {
  if (started) return
  started = true
  refreshLtxReady()
  vd().onModelsDone(() => refreshLtxReady())
}

// the reason shown before any submit (gating law: reason, never a failed render); null = go
export function ltxGateReason(): string | null {
  if (state.renderReady) return null
  return state.fullOnly
    ? 'only full (dev bf16) is installed — its render recipe is unproven; download a distilled size (quality, standard, …) in the Models card'
    : 'LTX is not installed — download a size in the Models card'
}

export function useLtxReady(): LtxReadyState {
  const [s, setS] = useState(state)
  useEffect(() => {
    initLtxReady()
    setS(state)
    const cb = (v: LtxReadyState): void => setS(v)
    listeners.add(cb)
    return () => void listeners.delete(cb)
  }, [])
  return s
}
