import { vd } from '../api'
// LTX readiness — one shared cache the pickers and the render gate read (the RenderPanel
// ltxSt shape lifted out so imperative code can read it too; sprite-dancer reference,
// bible 12.9). Any size on disk = renderable: a distilled one, or full (dev bf16) — its recipe
// was proven in the app on 2026-08-27 (list 16: the "unproven" block went 2026-09-30).
// Refreshed on boot and after every models:done.
import { useEffect, useState } from 'react'
import { LTX_DISTILLED_IDS, localModelFor } from '../shared/localModels'

export interface LtxReadyState {
  renderReady: boolean
  devReady: boolean // full (dev bf16) on disk — an explicit pick, and the auto pick only when no distilled size is installed
  sizes: { id: string; label: string }[] // installed distilled sizes, ladder (best-first) order — the size entries' options
}

let state: LtxReadyState = { renderReady: false, devReady: false, sizes: [] }
const listeners = new Set<(s: LtxReadyState) => void>()
let started = false

export function ltxReady(): LtxReadyState {
  return state
}

export function refreshLtxReady(): void {
  void vd().modelsList().then((l) => {
    const ready = (id: string): boolean => l.rows.find((x) => x.id === id)?.status === 'ready'
    const sizes = LTX_DISTILLED_IDS.filter(ready).map((id) => ({ id, label: localModelFor(id)?.label ?? id }))
    const devReady = ready('ltx-2.5-full')
    state = { renderReady: sizes.length > 0 || devReady, devReady, sizes }
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
  return state.renderReady ? null : 'LTX is not installed — download a size in the Models card'
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
