import { vd } from './api'
import { useStore } from './store'
import { bakeFxSpans, cancelBake } from './fx/baker'

export function installWatchBridge(): () => void {
  let job: string | null = null
  let controller: AbortController | undefined
  const offBake = vd().onWatchBake?.(async request => {
    if (job || useStore.getState().exportState.busy) {
      vd().watchBakeReply?.({ id: request.id, error: 'An export or timeline watch is already preparing video.' }); return
    }
    job = request.id
    controller = new AbortController()
    const completed: { start: number; end: number; file: string }[] = []
    useStore.setState({ exportState: { busy: true, msg: 'Preparing timeline watch…' } })
    try {
      const bakes = await bakeFxSpans(request.project, request.timeline, msg => useStore.getState().setExportMsg(msg), { plan: request.plan, signal: controller.signal, onBake: b => completed.push(b) })
      vd().watchBakeReply?.({ id: request.id, bakes })
    } catch (e) {
      vd().watchBakeReply?.({ id: request.id, bakes: completed, error: e instanceof Error ? e.message : String(e) })
    }
  })
  const offCancel = vd().onWatchBakeCancel?.(id => { if (job === id) { controller?.abort(); cancelBake() } })
  const offFinish = vd().onWatchFinished?.(() => {
    if (job) { job = null; useStore.setState({ exportState: { busy: false, msg: '' } }); void useStore.getState().refreshSpend() }
  })
  return () => { offBake?.(); offCancel?.(); offFinish?.(); if (job) { controller?.abort(); cancelBake() } }
}
