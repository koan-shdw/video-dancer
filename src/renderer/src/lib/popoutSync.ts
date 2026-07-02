// Pop-out windows (multi-screen, Adobe-style): the Timeline Monitor and the Queue can live in
// their own OS windows. The MAIN window's store stays the single authority — a pop-out is a
// MIRROR plus a remote control: it receives state patches relayed through the main process
// (BroadcastChannel dies on file:// origins, IPC relay works everywhere) and forwards every
// mutating action back to the host instead of running it locally.
import { useStore } from '../store'

export const IS_POPOUT = new URLSearchParams(window.location.search).has('panel')
export const POPOUT_PANEL = new URLSearchParams(window.location.search).get('panel')

type SyncMsg =
  | { type: 'hello' }
  | { type: 'state'; patch: Record<string, unknown> }
  | { type: 'action'; name: string; args?: unknown[] }

// what a pop-out needs to render: project data, playback, queue, selection
const SYNC_KEYS = [
  'project',
  'tlIndex',
  'tlPlaying',
  'tlLoop',
  'seekTick',
  'seekOffset',
  'queue',
  'queuePaused',
  'selectedClipId',
  'editTimelineIndex',
  'tileZoom'
] as const

function slice(): Record<string, unknown> {
  const s = useStore.getState() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of SYNC_KEYS) out[k] = s[k]
  return out
}

// ---- HOST side (the main window) ----
export function startHostSync(): () => void {
  let last: Record<string, unknown> = {}
  const publish = (): void => {
    const cur = slice()
    const patch: Record<string, unknown> = {}
    for (const k of Object.keys(cur)) if (cur[k] !== last[k]) patch[k] = cur[k]
    // tlProgress deliberately NOT broadcast — a popped-out monitor drives its own progress and
    // forwards it back as a throttled action; echoing it would fight the smooth local playback
    if (Object.keys(patch).length) {
      last = cur
      window.vidancer.syncPub({ type: 'state', patch })
    }
  }
  const unsub = useStore.subscribe(publish)
  const off = window.vidancer.onSyncMsg((raw) => {
    const m = raw as SyncMsg
    if (m.type === 'hello') {
      // a pop-out just opened — give it the full picture (including current progress once)
      window.vidancer.syncPub({ type: 'state', patch: { ...slice(), tlProgress: useStore.getState().tlProgress } })
    } else if (m.type === 'action') {
      const s = useStore.getState() as unknown as Record<string, unknown>
      const fn = s[m.name]
      if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown)(...(m.args ?? []))
    }
  })
  return () => {
    unsub()
    off()
  }
}

// ---- POP-OUT side ----
// actions that must run on the HOST (they mutate shared state or talk project IPC)
const REMOTE_ACTIONS = [
  'tlPlay',
  'tlPause',
  'tlNext',
  'tlSetIndex',
  'toggleLoop',
  'seek',
  'setQueuePaused',
  'cancelJob',
  'moveJob',
  'clearFinishedJobs',
  'consumeJob',
  'selectClip',
  'saveFrame',
  'reportTakeDuration'
] as const

export function startPopoutSync(): () => void {
  const off = window.vidancer.onSyncMsg((raw) => {
    const m = raw as SyncMsg
    if (m.type === 'state') useStore.setState(m.patch as never)
  })
  const orig = useStore.getState()
  const overrides: Record<string, unknown> = {}
  for (const name of REMOTE_ACTIONS) {
    overrides[name] = (...args: unknown[]) => {
      window.vidancer.syncPub({ type: 'action', name, args })
      return name === 'saveFrame' ? Promise.resolve(null) : undefined
    }
  }
  // progress stays LOCAL for smooth playback, and streams back to the host throttled so its
  // timeline playhead follows the popped-out monitor
  let lastProg = 0
  overrides.tlSetProgress = (p: number): void => {
    orig.tlSetProgress(p)
    const now = Date.now()
    if (now - lastProg > 150) {
      lastProg = now
      window.vidancer.syncPub({ type: 'action', name: 'tlSetProgress', args: [p] })
    }
  }
  useStore.setState(overrides as never)
  window.vidancer.syncPub({ type: 'hello' })
  return off
}
