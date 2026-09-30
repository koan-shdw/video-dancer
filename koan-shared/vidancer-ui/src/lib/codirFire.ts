// list 27: the Co-Director's fire_render presses a panel's OWN render button. Main has already
// checked his switch and his go; it asks the window, and the panel that owns that kind of render
// runs the same code a click runs and answers with its status line. One code path means what
// renders is exactly what the form holds.
import { vd } from '../api'
import { useStore } from '../store'
import { openClipEditor, openImageGen } from '../panelBus'

export type FireKind = 'clip' | 'image_gen'
export type FireResult = { ok: boolean; line: string }
type Press = (id: string) => Promise<FireResult>

const presses = new Map<FireKind, Press>()
// a panel registers while it is mounted; the cleanup it gets back unregisters it
export function registerFire(kind: FireKind, press: Press): () => void {
  presses.set(kind, press)
  return () => {
    if (presses.get(kind) === press) presses.delete(kind)
  }
}

// the thing opens in its panel first, the way his own click on it would
const OPEN: Record<FireKind, (id: string) => void> = {
  clip: (id) => {
    if (useStore.getState().selectedClipId !== id) useStore.getState().selectClip(id)
    openClipEditor()
  },
  image_gen: (id) => {
    useStore.getState().setEditorImageGen(id)
    openImageGen()
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

export async function fire(kind: FireKind, id: string): Promise<FireResult> {
  OPEN[kind](id)
  for (let i = 0; i < 40 && !presses.has(kind); i++) await wait(50) // a closed panel mounts first
  const press = presses.get(kind)
  if (!press) return { ok: false, line: 'its panel did not open' }
  return Promise.race([press(id), wait(8000).then(() => ({ ok: false, line: 'its panel did not load it in time' }))])
}

// App subscribes once: main asks, the panel presses, the line goes back
export const listenForFire = (): (() => void) =>
  vd().onCodirFire?.((req) => void fire(req.kind, req.id).then((r) => vd().codirFireDone?.(req.reqId, r))) ?? (() => {})
