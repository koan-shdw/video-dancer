import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { JobNotifications, CodirExchanges, currentAppJob, type AppJob, type CodirPlan, type JobOutput } from './jobNotifications'
import { getProject } from './project'
import { primaryImageFile } from '@koan/vidancer-ui/shared/imageSources'
import { imageModelFor } from '@koan/vidancer-ui/shared/imageModels'
import { jobSettled, type JobKind, type JobState } from '@koan/vidancer-ui/shared/jobNotifications'

// One registry for every job that can leave a result. Model routing stays in the existing handlers.
export const JOB_CHANNELS: Record<string, JobKind> = {
  'imagegen:render': 'image_gen', 'render:run': 'clip', 'image:generate': 'image_edit',
  'vedit:run': 'video_edit', 'edit:run': 'video_edit', 'score:render': 'score', 'voice:render': 'voice',
  'enhance:run': 'enhance', 'enhance:preview': 'enhance', 'export:run': 'export', 'sheet:build': 'sheet',
  'score:compose': 'compose', 'voice:describe': 'voice_description', 'image:cropSave': 'image_save',
  'media:exportAs': 'media_export', 'watch:timeline': 'watch', 'block:build': 'sheet',
  'media:reverse': 'video_edit', 'library:saveFrame': 'image_save', 'image:addDynamicStill': 'image_save',
  'assembly:concept': 'assembly', 'assembly:assemble': 'assembly'
}
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>
const handlers = new Map<string, Handler>()
let records: JobNotifications | undefined
export const appJobs = (): JobNotifications => { if (!records) throw Error('The job service is not ready.'); return records }

function fileRows(value: unknown, rows: (JobOutput & { appJobId?: string })[] = []): typeof rows {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return rows
  const o = value as Record<string, unknown>
  if (typeof o.file === 'string') rows.push({ file: o.file, ...(typeof o.id === 'string' ? { id: o.id } : {}), ...(typeof o.appJobId === 'string' ? { appJobId: o.appJobId } : {}) })
  for (const v of Object.values(o)) if (v && typeof v === 'object') fileRows(v, rows)
  return rows
}
export function configureAppJobs(options: { enabled: () => Promise<boolean>; notify: (dir: string, state: JobState) => void; cancel: (j: AppJob) => Promise<unknown> }): JobNotifications {
  records = new JobNotifications({ ...options, projectDir: () => getProject()?.dir,
    recover: async j => getProject()?.dir === j.projectDir ? fileRows(getProject()).filter(o => o.appJobId === j.id && existsSync(o.file)) : []
  })
  return records
}

function metadata(channel: string, args: unknown[]): { kind: JobKind; targetId: string; engine: string; label: string } {
  const kind = JOB_CHANNELS[channel]
  if (!kind) throw Error('This operation is not a registered result-producing job.')
  const r = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as Record<string, any>
  const p = getProject()
  const targetId = String(r.clipId ?? r.imageGenId ?? r.scoreClipId ?? r.voiceClipId ?? r.rootImageId ?? r.timelineId ?? r.source?.clipId ?? r.source?.videoId ?? r.root?.videoId ?? r.root?.takeRef?.clipId ?? (typeof args[0] === 'string' ? args[0] : ''))
  const owner = [...(p?.clips ?? []), ...(p?.imageGens ?? []), ...(p?.scoreClips ?? []), ...(p?.voiceClips ?? []), ...(p?.timelines ?? [])].find(x => x.id === targetId)
  const gen = p?.imageGens?.find(x => x.id === targetId), voice = p?.voiceClips?.find(x => x.id === targetId)
  const engine = String((r.engine ?? r.model ?? r.recipe?.model ?? [r.interp?.engine, r.upscale?.engine, r.depth?.engine].filter(Boolean).join('+')) || gen?.recipe.model || voice?.recipe.engine || (channel === 'block:build' ? 'nano-banana-pro' : kind === 'image_edit' ? imageModelFor().id : kind === 'clip' ? 'seedance2' : kind))
  return { kind, targetId, engine, label: owner?.name ?? String(r.name ?? r.label ?? kind) }
}
export function summarizeJobResult(raw: unknown, before: Set<string>): { result: Record<string, unknown>; outputs: JobOutput[] } {
  const r: Record<string, unknown> = raw && typeof raw === 'object' ? raw as Record<string, unknown> : typeof raw === 'string' && existsSync(raw) ? { ok: true, file: raw } : { ok: raw != null && raw !== false, value: raw ?? null }
  const ids = new Set([r.takeId, r.imageId, r.nodeId, ...(Array.isArray(r.takeIds) ? r.takeIds : []), ...(Array.isArray(r.nodeIds) ? r.nodeIds : []), ...(Array.isArray(r.videoIds) ? r.videoIds : [])].filter(x => typeof x === 'string'))
  const projectOutputs = fileRows(getProject()).filter(o => (!!o.id && ids.has(o.id)) || (!!currentAppJob()?.id && o.appJobId === currentAppJob()!.id))
  const outputs = [...fileRows(r), ...projectOutputs].filter(o => !before.has(o.file) || (!!o.id && ids.has(o.id)) || o.file === r.file)
  const unique = [...new Map(outputs.map(o => [o.file, o])).values()]
  // The ordinary project delta already reaches the UI. Notifications keep only the result references.
  const result = Object.fromEntries(Object.entries(r).filter(([key, v]) => key !== 'delta' && !ArrayBuffer.isView(v)))
  return { result, outputs: unique }
}
async function execute(j: AppJob, event: IpcMainInvokeEvent, channel: string, args: any[]): Promise<any> {
  const handler = handlers.get(channel); if (!handler) throw Error('The job handler is unavailable.')
  const before = new Set(fileRows(getProject()).map(o => o.file))
  const r = await appJobs().execute(j, () => handler(event, ...args), r => summarizeJobResult(r, before))
  // the supplier took it (markProviderAccepted): the window never sends a failed one again (audit 2026-10-09 batch 2)
  return j.providerAccepted && r && typeof r === 'object' && r.ok === false ? { ...r, accepted: true } : r
}

export function registerJobIpc<A extends any[], R>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: A) => Promise<R>): void {
  if (!JOB_CHANNELS[channel]) throw Error(`Job channel missing from the registry: ${channel}`)
  handlers.set(channel, handler as Handler)
  ipcMain.handle(channel, async (e, ...args) => {
    const p = getProject()
    if (!p) return handler(e, ...args as A)
    const meta = metadata(channel, args), id = randomUUID()
    const req = args[0] as { jobId?: string } | undefined
    const j = await appJobs().add({ ...meta, id, projectDir: p.dir, deadlineMs: 2 * 60 * 60_000, cancelId: req?.jobId })
    return execute(j, e, channel, args)
  })
}
export async function submitAppJob(channel: string, args: unknown[], planId: string): Promise<AppJob> {
  return (await submitAppJobs(channel, [args], planId))[0]
}
export async function submitAppJobs(channel: string, requests: unknown[][], planId: string): Promise<AppJob[]> {
  const p = getProject(); if (!p) throw Error('No project open.')
  return appJobs().addMany(requests.map(args => {
    const meta = metadata(channel, args), id = randomUUID(), frozen = structuredClone(args)
    if (frozen[0] && typeof frozen[0] === 'object') Object.assign(frozen[0], { jobId: id })
    if (channel === 'imagegen:render') {
      const req = frozen[0] as { recipe: { refA?: string; refB?: string }; referenceFiles?: { a?: string; b?: string } }
      req.referenceFiles = { a: req.recipe.refA ? primaryImageFile(p, req.recipe.refA) : undefined, b: req.recipe.refB ? primaryImageFile(p, req.recipe.refB) : undefined }
    }
    return { ...meta, id, projectDir: p.dir, deadlineMs: 2 * 60 * 60_000, planId, cancelId: id, request: { channel, args: frozen } }
  }))
}
let dispatching: AppJob | undefined
export async function dispatchCodirJobs(sender: WebContents): Promise<void> {
  if (dispatching && !jobSettled(dispatching)) return
  const s = await appJobs().read(), p = s.plan
  if (!p || !['active', 'waiting'].includes(p.status)) return
  const j = s.jobs.find(j => j.planId === p.id && j.status === 'queued' && j.request)
  if (!j) return
  dispatching = j
  try {
    const r = await execute(j, { sender } as IpcMainInvokeEvent, j.request!.channel, j.request!.args)
    if (r?.delta && getProject()?.dir === j.projectDir && !sender.isDestroyed()) sender.send('project:delta', r.delta)
  } catch { /* execute saved the failure; Co-Director receives it through the same protocol. */ }
  finally { try { await appJobs().retryFailed(j) } finally { if (dispatching === j) dispatching = undefined } }
}

export function createJobPump(options: {
  exchanges: CodirExchanges
  route: () => Promise<string | null>
  sender: () => WebContents | undefined
  continue: (plan: CodirPlan, jobs: AppJob[]) => Promise<void>
}): () => Promise<void> {
  let polling = false
  return async () => {
    if (polling || !getProject() || !options.sender()) return
    polling = true
    try {
      const dir = getProject()!.dir
      await appJobs().settleInterrupted(dir)
      const route = await options.route()
      if (!route || getProject()?.dir !== dir) return
      // Check authority even when jobs remain queued; a route change cannot start new work.
      const ping = await appJobs().nextPing(route)
      void dispatchCodirJobs(options.sender()!).catch(err => console.error('[job dispatch]', err))
      if (!ping || options.exchanges.active) return
      // Keep the render queue moving while Co-Di works on an independent saved task.
      void options.exchanges.enqueue('job', async () => {
        const routeNow = await options.route()
        if (!routeNow || getProject()?.dir !== dir) return
        const current = await appJobs().nextPing(routeNow)
        if (!current || current.plan.id !== ping.plan.id) return
        const before = await appJobs().beginPing(current.plan.id, current.jobs)
        try { await options.continue(structuredClone((await appJobs().read()).plan!), current.jobs) }
        catch (e) { if (getProject()?.dir === dir) await appJobs().block(String(e)); throw e }
        finally { if (getProject()?.dir === dir) await appJobs().endPing(current.plan.id, before) }
      }).catch(err => console.error('[job continuation]', err))
    } finally { polling = false }
  }
}

// Streaming effects finish at encodeEnd, not when the encoder first returns its handle.
const encodes = new Map<string, AppJob>()
export async function observeEncode<T extends { id: string }>(label: string, start: () => Promise<T>): Promise<T> {
  const p = getProject(); if (!p) return start()
  const j = await appJobs().add({ projectDir: p.dir, kind: 'fx', targetId: '', engine: 'ffmpeg', label, deadlineMs: 2 * 60 * 60_000 })
  j.status = 'running'; j.attempt = 1; j.startedAt = Date.now(); appJobs().trackLive(j, true)
  try {
    await appJobs().save(p.dir); await appJobs().assert(j)
    const result = await start(); j.targetId = result.id; encodes.set(result.id, j); await appJobs().save(p.dir)
    return result
  } catch (e) {
    appJobs().trackLive(j, false); await appJobs().finish(j, { ok: false, error: String(e) }); throw e
  }
}
export async function finishEncode(id: string, keep: boolean, result: { ok: boolean; file?: string; error?: string }): Promise<void> {
  const j = encodes.get(id); if (!j) return
  encodes.delete(id)
  appJobs().trackLive(j, false)
  await appJobs().finish(j, keep ? result : { ok: false, error: 'cancelled' }, result.file ? [{ file: result.file }] : [])
}
export { currentAppJob }

export async function observeWatchTool(targetId: string, label: string, run: () => Promise<string>): Promise<string> {
  const p = getProject()
  if (!records || !p || currentAppJob()) return run()
  const j = await records.add({ projectDir: p.dir, kind: 'watch', targetId, label, engine: 'watch', deadlineMs: 2 * 60 * 60_000 })
  return records.execute(j, run, text => ({ result: { ok: !text.startsWith('ERROR'), ...(text.startsWith('ERROR') ? { error: text } : { text }) }, outputs: [] }))
}
