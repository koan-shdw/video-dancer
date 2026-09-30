import { useState } from 'react'
import type { MenuEntry } from '@koan/shared'
import { keepersOf } from '../shared/keepers'
import { useStore } from '../store'

// list 6 (KEEPERS-SPEC-2026-09-29) — the pieces every takes row shares: the flag toggle, the
// right-click entries, the ~ key and the "★ only" switch (remembered per panel)
export type KeeperKind = 'clip' | 'score' | 'voice' | 'imagegen'

export const toggleKeepers = (kind: KeeperKind, ownerId: string, takeIds: string[], on: boolean | null): void => void useStore.getState().setKeeperFlags(kind, ownerId, takeIds, on)

// right-click on a take (or a selection): flag what isn't, unflag what is
export function keeperEntries(kind: KeeperKind, owner: { id: string; keeperIds?: string[]; keeperTakeId?: string }, takeIds: string[]): MenuEntry[] {
  const k = keepersOf(owner)
  const n = takeIds.length > 1 ? ` ${takeIds.length}` : ''
  const out: MenuEntry[] = []
  if (takeIds.some((id) => !k.includes(id))) out.push({ label: <>★ keeper{n}</>, onClick: () => toggleKeepers(kind, owner.id, takeIds, true) })
  if (takeIds.some((id) => k.includes(id))) out.push({ label: <>☆ not a keeper{n}</>, onClick: () => toggleKeepers(kind, owner.id, takeIds, false) })
  return out
}

// "★ only" — only the keepers show (remembered per panel)
export function useKeepersOnly(panel: string): [boolean, (on: boolean) => void] {
  const key = `vd-keepers-only:${panel}`
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  return [
    on,
    (v) => {
      setOn(v)
      try {
        localStorage.setItem(key, v ? '1' : '0')
      } catch {
        /* a convenience — no storage, no memory */
      }
    }
  ]
}

export function KeepersOnlySwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label="keepers only"
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
      title={on ? 'only the keepers show · click for every take' : 'show only the keepers (★)'}
      style={{ marginLeft: 8, cursor: 'pointer', fontSize: 10, textTransform: 'none', letterSpacing: 0, color: on ? 'var(--amber)' : 'var(--dim)', whiteSpace: 'nowrap' }}
    >
      ★ only
    </span>
  )
}

// a keeper's ★ on a take card: lit = a keeper (click takes the flag off)
export function KeeperStar({ lit, onUnflag }: { lit: boolean; onUnflag: () => void }): React.JSX.Element | null {
  if (!lit) return null
  return (
    <span
      role="button"
      aria-label="keeper — click to take the flag off"
      title="a keeper · click the ★ to take its flag off"
      onClick={(e) => {
        e.stopPropagation()
        onUnflag()
      }}
      style={{ color: 'var(--amber)', cursor: 'pointer' }}
    >
      ★
    </span>
  )
}
