import { mkdtemp, rm } from 'fs/promises'
import { join, resolve, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'
import type { Project, Timeline } from '@koan/vidancer-ui/shared/types'
import type { WatchTimelineRequest, WatchTimelineResult } from '@koan/vidancer-ui/shared/watch'
import { getProject, captureProjectSession, assertProjectSession, beginMediaWrite, endMediaWrite } from './project'
import { exportTimeline, probeFile, type ExportBake } from './export'
import { watchVideo, type WatchOpts } from './watch'

type Baker = (p: Project, tl: Timeline, signal: AbortSignal) => Promise<ExportBake[]>
let bake: Baker | undefined
let finished = (): void => {}
export function setWatchBaker(fn: Baker): void { bake = fn }
export function setWatchFinished(fn: () => void): void { finished = fn }
let running: AbortController | undefined
export function cancelTimelineWatch(): boolean { if (!running) return false; running.abort(); return true }
export function timelineWatchBusy(): boolean { return !!running }

export async function watchTimeline(args: WatchTimelineRequest, opts: WatchOpts, progress: (msg: string) => void = () => {}): Promise<WatchTimelineResult> {
  if (running) return { ok: false, error: 'A timeline watch is already running.' }
  const p = getProject()
  const tl = p?.timelines.find(t => t.id === args.timelineId || t.name === args.timelineId)
  if (!p || !tl) return { ok: false, error: 'Timeline not found.' }
  if (!tl.items.length) return { ok: false, error: 'This timeline is empty.' }
  if (!opts.googleKey && !opts.anthropicKey && !opts.bridge) return { ok: false, error: 'Set up Google AI or the Co-Director’s Claude connection in Settings first.' }
  if (args.range === 'selection' && !(tl.rangeInSec != null && tl.rangeOutSec != null && tl.rangeOutSec > tl.rangeInSec))
    return { ok: false, error: 'Set an in/out range on the timeline first.' }
  const owner = captureProjectSession()
  const snapshot = structuredClone(p)
  const shadow: Timeline = { ...structuredClone(tl), exportRes: '480', exportQuality: 'draft' }
  if (args.range !== 'selection') { delete shadow.rangeInSec; delete shadow.rangeOutSec }
  const startSec = shadow.rangeInSec ?? 0
  const controller = new AbortController(); running = controller
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal
  // A project switch cancels preparation/upload; media are always read from the frozen snapshot.
  const ownerTimer = setInterval(() => { try { assertProjectSession(owner) } catch { controller.abort() } }, 250)
  let dir: string | undefined; let bakes: ExportBake[] = []
  beginMediaWrite()
  try {
    signal.throwIfAborted()
    if (!bake) throw new Error('The timeline renderer is not ready. Reopen the app and try again.')
    progress('Preparing the timeline, including effects…')
    bakes = await bake(snapshot, shadow, signal)
    assertProjectSession(owner); signal.throwIfAborted()
    dir = await mkdtemp(join(tmpdir(), 'vd-watch-timeline-'))
    const file = join(dir, 'cut.mp4')
    const rendered = await exportTimeline(snapshot, shadow, file, progress, bakes, { isolated: true, signal })
    if (!rendered.ok) throw new Error(rendered.error ?? 'Could not prepare the timeline.')
    assertProjectSession(owner); signal.throwIfAborted()
    const durationSec = (await probeFile(file)).duration
    progress('Watching the assembled cut…')
    const question = `This is the assembled timeline "${tl.name}". Its video timestamps begin at 0, corresponding to timeline time ${startSec.toFixed(3)} seconds. Report timeline timestamps by adding that offset. Observe the actual cut order, pacing, transitions, motion and sound; do not infer footage from clip names.\n\n${args.question?.trim() || 'Describe the story on screen, the final action, and any continuity or pacing problems.'}`
    const result = await watchVideo(file, question, { ...opts, signal, label: `watch · timeline ${tl.name}` })
    assertProjectSession(owner); signal.throwIfAborted()
    return { ...result, timelineName: tl.name, startSec, durationSec }
  } catch (e) {
    if (e && typeof e === 'object' && 'bakes' in e && Array.isArray(e.bakes)) bakes = e.bakes
    return { ok: false, error: signal.aborted ? 'Timeline watch cancelled.' : e instanceof Error ? e.message : String(e) }
  } finally {
    clearInterval(ownerTimer)
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    // Only discard scratch files made by the existing effects encoder.
    const root = resolve(owner.dir, 'exports', '.fxbake')
    for (const b of bakes) { const rel = relative(root, resolve(b.file)); if (rel && !rel.startsWith('..') && !isAbsolute(rel)) await rm(b.file, { force: true }).catch(() => {}) }
    endMediaWrite(); running = undefined; finished()
  }
}
