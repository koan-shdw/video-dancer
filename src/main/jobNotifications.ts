// Completion records and a saved place for Co-Director to continue. No workflow graph or next-step rules.
import { AsyncLocalStorage } from 'async_hooks'
import { rename, writeFile } from 'fs/promises'
import { readIfExists, swapIn } from './fileSave'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { jobSettled, type AppJob, type CodirPlan, type JobState, type JobOutput } from '@koan/vidancer-ui/shared/jobNotifications'
export type { AppJob, CodirPlan, JobState, JobOutput }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e)
const scope = new AsyncLocalStorage<{ jobs: JobNotifications; job: AppJob }>()
export const currentAppJob = (): AppJob | undefined => scope.getStore()?.job
export const jobProvenance = (): { appJobId?: string; appJobAttempt?: number } => {
  const j = currentAppJob(); return j ? { appJobId: j.id, appJobAttempt: j.attempt } : {}
}
export async function jobGpuWaiting(): Promise<void> { const s = scope.getStore(); if (s) { await s.jobs.assert(s.job); s.job.status = 'waiting'; await s.jobs.save(s.job.projectDir) } }
export async function jobGpuStarting(): Promise<void> {
  const s = scope.getStore(); if (!s) return
  await s.jobs.assert(s.job); s.job.status = 'running'; s.job.startedAt = Date.now(); await s.jobs.save(s.job.projectDir)
}
// THE mark "the supplier has this job" (audit 2026-10-09 batch 2). Every supplier call that hands
// back a job id or a paid answer calls it. A marked job that fails is 'lost', never retried, and the
// window is told `accepted` so it never sends it again.
export function markProviderAccepted(): void {
  const s = scope.getStore(); if (!s || s.job.providerAccepted) return
  s.job.providerAccepted = true
  void s.jobs.save(s.job.projectDir).catch(error => console.error('[job receipt]', error))
}
// ✕ pressed while the job is still uploading or encoding its refs: the paid submit never goes out.
// Every supplier submit calls assertNotStopped() right before sending (audit 2026-10-09 H12).
// ponytail: an id stopped after its job ended stays in the set; ids are unique, so it is only a few bytes
const stopRequested = new Set<string>()
export function requestStop(cancelId: string): void { stopRequested.add(cancelId) }
export function assertNotStopped(): void {
  const j = scope.getStore()?.job
  if (j && !j.providerAccepted && stopRequested.has(j.cancelId ?? j.id)) throw Error('cancelled before it was sent — nothing spent')
}
export async function assertAppJob(): Promise<void> { const s = scope.getStore(); if (s) await s.jobs.assert(s.job) }
export function assertJobProject(): void { const s = scope.getStore(); if (s) s.jobs.assertProject(s.job) }

export class JobNotifications {
  private states = new Map<string, JobState>()
  private loading = new Map<string, Promise<JobState>>()
  private writes = new Map<string, Promise<void>>()
  private live = new Set<string>()
  trackLive(job: AppJob, running: boolean): void { if (running) this.live.add(job.id); else this.live.delete(job.id) }
  constructor(private io: {
    projectDir: () => string | undefined
    enabled: () => Promise<boolean>
    notify: (dir: string, state: JobState) => void
    cancel: (job: AppJob) => Promise<unknown>
    recover: (job: AppJob) => Promise<JobOutput[]>
    now?: () => number
  }) {}
  private now(): number { return this.io.now?.() ?? Date.now() }
  assertProject(job: AppJob): void { if (this.io.projectDir() !== job.projectDir) throw Error('The project changed before the result was saved. The output file is kept in its original project.') }
  async read(dir = this.io.projectDir()): Promise<JobState> {
    if (!dir) return { version: 1, jobs: [] }
    if (this.states.has(dir)) return this.states.get(dir)!
    if (this.loading.has(dir)) return this.loading.get(dir)!
    const load = (async () => {
      let state: JobState = { version: 1, jobs: [] }
      const file = join(dir, 'codir-jobs.json')
      let text: string | null
      try { text = await readIfExists(file) } catch (e) { throw Error(`Cannot read job results: ${errorText(e)}`) }
      if (text != null) {
        try {
          state = JSON.parse(text) as JobState
          if (state?.version !== 1 || !Array.isArray(state.jobs)) throw Error('invalid job record')
        } catch (e) {
          // a damaged record must not block every render in this project (audit 2026-10-09 L6):
          // it is kept beside, and a fresh record starts (a plan in it stops; nothing re-runs)
          const aside = join(dir, `codir-jobs.damaged-${Date.now()}.json`)
          await rename(file, aside)
          console.warn(`[jobs] codir-jobs.json was damaged (${errorText(e)}); kept as ${aside}, a fresh record starts`)
          state = { version: 1, jobs: [] }
        }
      }
      state.projectDir = dir
      // Manual jobs are dispatched by their caller, not replayed from this file.
      // A queued record left by an earlier session has no live queue behind it.
      for (const job of state.jobs) if (job.status === 'queued' && !job.planId && !job.request) {
        job.status = job.attempt ? 'lost' : 'cancelled'
        job.error = job.attempt ? 'Interrupted with no confirmed result. It was not submitted again.' : 'This old record was never dispatched. It is not in the current queue.'
        job.endedAt = this.now()
      }
      this.states.set(dir, state); return state
    })()
    this.loading.set(dir, load)
    try { return await load } finally { this.loading.delete(dir) }
  }
  async save(dir: string): Promise<void> {
    const state = clone(await this.read(dir))
    // ponytail: keep 500 recent manual results; an active plan keeps all its jobs.
    const keep = new Set(state.jobs.filter(j => !j.planId && jobSettled(j)).slice(-500).map(j => j.id))
    state.jobs = state.jobs.filter(j => j.planId || !jobSettled(j) || keep.has(j.id))
    const write = (this.writes.get(dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const dest = join(dir, 'codir-jobs.json'), tmp = dest + '.' + randomUUID() + '.tmp'
      const data = JSON.stringify(state, null, 2)
      await writeFile(tmp, data); await swapIn(tmp, dest, data)
    })
    this.writes.set(dir, write); await write; this.io.notify(dir, state)
  }
  async propose(plan: Omit<CodirPlan, 'id' | 'revision' | 'status' | 'progress' | 'exchanges' | 'noProgress' | 'awaiting' | 'version' | 'seenVersion'>): Promise<CodirPlan> {
    const dir = this.io.projectDir(); if (!dir) throw Error('No project open.')
    const s = await this.read(dir)
    if (s.plan && ['active', 'waiting'].includes(s.plan.status)) throw Error('Stop the active plan before replacing it.')
    if (!plan.text.trim() || !Number.isInteger(plan.maxExchanges) || plan.maxExchanges < 1 || plan.maxExchanges > 100) throw Error('Describe the plan and set 1 to 100 Co-Director exchanges.')
    if (plan.renders.some(r => !r.engine || !r.cost.trim() || !Number.isInteger(r.maxJobs) || r.maxJobs < 1 || r.maxJobs > 10000)) throw Error('Each render allowance needs a model, cost and job count (1 to 10000).')
    if (new Set(plan.renders.map(r => r.kind + ':' + r.engine)).size !== plan.renders.length) throw Error('Use one allowance per job kind and model.')
    s.plan = { ...clone(plan), id: randomUUID(), revision: randomUUID(), status: 'draft', progress: '', exchanges: 0, noProgress: 0, awaiting: [], version: 0, seenVersion: -1 }
    await this.save(dir); return clone(s.plan)
  }
  async approve(id: string, revision: string, route: string): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) throw Error('No project open.')
    const s = await this.read(dir), p = s.plan
    if (!p || p.status !== 'draft' || p.id !== id || p.revision !== revision) throw Error('The plan changed. Read it before GO.')
    if (p.aiRoute !== route) throw Error('The Co-Director model changed. Update the plan before GO.')
    if (!await this.io.enabled()) throw Error('Switch on renders before GO.')
    p.status = 'active'; p.approvedAt = this.now(); await this.save(dir)
  }
  async userTurn(route: string, text: string, go: boolean): Promise<CodirPlan | undefined> {
    const dir = this.io.projectDir(); if (!dir) return
    const p = (await this.read(dir)).plan
    if (!p || p.approvedAt === undefined) return
    if (!['active', 'waiting', 'blocked'].includes(p.status)) return
    if (!go && text.trim()) {
      p.updates = [...(p.updates ?? []), text.trim()]
      await this.save(dir)
    }
    if (p.aiRoute !== route) {
      await this.block('Co-Director model changed. Review the plan before continuing.')
      if (go) throw Error('Co-Director model changed. Review the plan before continuing.')
      return
    }
    if (p.status === 'blocked') {
      if (!go) return
      if (p.exchanges >= p.maxExchanges) throw Error('The approved Co-Director exchange limit was reached. Review the plan before increasing it.')
      if (!await this.io.enabled()) throw Error('Switch on renders before continuing.')
      p.status = p.awaiting.length ? 'waiting' : 'active'; p.reason = undefined; p.noProgress = 0
    }
    await this.save(dir)
    return clone(p)
  }
  async assert(job: AppJob): Promise<void> {
    if (jobSettled(job)) throw Error(job.status === 'lost' ? 'lost: this attempt has expired' : 'cancelled')
    if (this.io.projectDir() !== job.projectDir) throw Error('The project changed before dispatch.')
    if (job.planId) {
      const p = (await this.read(job.projectDir)).plan
      if (!p || p.id !== job.planId || !['active', 'waiting'].includes(p.status)) throw Error('cancelled')
      if (!await this.io.enabled()) throw Error('Renders are switched off.')
      if (jobSettled(job) || !['active', 'waiting'].includes(p.status)) throw Error('cancelled')
    }
    this.assertProject(job)
  }
  private checkAllowance(j: AppJob, state: JobState): void {
    if (j.planId) {
      const p = state.plan
      if (!p || p.id !== j.planId || !['active', 'waiting'].includes(p.status)) throw Error('No approved plan is active.')
      const rule = p.renders.find(r => r.kind === j.kind && r.engine === j.engine)
      if (!rule) throw Error('This kind of job and model are outside the approved plan.')
      if (state.jobs.filter(x => x.planId === p.id && x.kind === j.kind && x.engine === j.engine).reduce((n, x) => n + Math.max(1, x.attempt), 0) >= rule.maxJobs) throw Error('The approved render count is used up.')
      const req = j.request?.args[0] as Record<string, unknown> | undefined
      for (const [k, v] of Object.entries(rule.settings)) {
        const actual = k.split('.').reduce<unknown>((o, key) => o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined, req)
        if (JSON.stringify(actual) !== JSON.stringify(v)) throw Error(`The approved ${k} setting differs.`)
      }
    }
  }
  async add(input: Omit<AppJob, 'id' | 'attempt' | 'status' | 'createdAt' | 'outputs'> & { id?: string }): Promise<AppJob> { return (await this.addMany([input]))[0] }
  async addMany(inputs: (Omit<AppJob, 'id' | 'attempt' | 'status' | 'createdAt' | 'outputs'> & { id?: string })[]): Promise<AppJob[]> {
    if (!inputs.length) return []
    const dir = inputs[0].projectDir, state = await this.read(dir)
    if (inputs.some(i => i.projectDir !== dir)) throw Error('A batch must belong to one project.')
    const proposed = { ...state, jobs: [...state.jobs] }
    const jobs = inputs.map(input => {
      const j: AppJob = { ...clone(input), id: input.id ?? randomUUID(), attempt: 0, status: 'queued', createdAt: this.now(), outputs: [] }
      if (proposed.jobs.some(x => x.id === j.id)) throw Error('This job ID is already registered.')
      this.checkAllowance(j, proposed); proposed.jobs.push(j); return j
    })
    state.jobs.push(...jobs)
    if (state.plan && jobs.some(j => j.planId === state.plan!.id)) state.plan.version++
    try { await this.save(dir) } catch (error) {
      for (const job of jobs) if (job.status === 'queued' && job.attempt === 0) {
        job.status = 'cancelled'; job.error = 'Job registration could not be saved; nothing was dispatched.'; job.endedAt = this.now()
      }
      throw error
    }
    return jobs
  }
  async finish(j: AppJob, result: Record<string, unknown>, outputs: JobOutput[] = []): Promise<void> {
    if (jobSettled(j) && j.status !== 'lost' && j.status !== 'cancelled') return
    const late = j.status === 'lost' || j.status === 'cancelled'
    j.late = late; j.outputs = clone(outputs); j.result = clone(result); j.endedAt = this.now()
    j.resultVersion = (j.resultVersion ?? 0) + 1
    if (!late) j.status = result.ok === false ? /cancel+ed|aborted/i.test(String(result.error)) ? 'cancelled' : j.providerAccepted || result.billed || /timeout|timed out|ECONN|fetch failed|network|interrupted/i.test(String(result.error)) ? 'lost' : 'failed' : 'done'
    if (result.error) j.error = String(result.error)
    const state = await this.read(j.projectDir), p = state.plan
    if (p && p.id === j.planId) {
      p.version++
      if (j.status === 'lost') for (const pending of state.jobs) if (pending.planId === p.id && pending.status === 'queued') pending.status = 'cancelled'
    }
    await this.save(j.projectDir)
  }
  async execute<T>(j: AppJob, run: () => Promise<T>, summarize: (r: T) => { result: Record<string, unknown>; outputs: JobOutput[] }): Promise<T> {
    if (this.live.has(j.id)) throw Error('This job is already running.')
    this.live.add(j.id)
    try {
      await this.assert(j)
      if (!j.retryQueued) j.attempt++
      j.retryQueued = false; j.status = 'running'; j.startedAt = this.now(); await this.save(j.projectDir)
      return await scope.run({ jobs: this, job: j }, async () => {
        const result = await run()
        const summary = summarize(result); await this.finish(j, summary.result, summary.outputs)
        return result
      })
    } catch (e) {
      await this.finish(j, { ok: false, error: errorText(e) }); throw e
    } finally { this.live.delete(j.id); stopRequested.delete(j.cancelId ?? j.id) }
  }
  async retryFailed(j: AppJob): Promise<void> {
    if (j.status !== 'failed' || !j.planId) return
    const s = await this.read(j.projectDir), p = s.plan
    if (!p || p.id !== j.planId || !['active', 'waiting'].includes(p.status)) return
    try {
      if (j.attempt >= 2) throw Error(`${j.label} failed twice: ${j.error}`)
      this.checkAllowance(j, s)
      j.previousError = j.error; j.error = undefined; j.result = undefined; j.status = 'queued'
      // Reserve the retry before dispatch so other jobs cannot spend its allowance.
      j.attempt = 2; j.retryQueued = true
    } catch (e) { p.status = 'blocked'; p.reason = errorText(e) }
    await this.save(j.projectDir)
  }
  async settleInterrupted(dir = this.io.projectDir()): Promise<void> {
    if (!dir) return
    const s = await this.read(dir)
    let changed = false
    for (const j of s.jobs) {
      if (jobSettled(j) || j.status === 'queued') continue
      const live = this.live.has(j.id)
      if (live && this.now() - (j.startedAt ?? j.createdAt) < j.deadlineMs) continue
      const outputs = await this.io.recover(j)
      if (outputs.length) { await this.finish(j, { ok: true, recovered: true }, outputs); continue }
      j.status = 'lost'; j.error = live ? 'No result before the job deadline.' : 'Interrupted with no confirmed result. It was not submitted again.'; j.endedAt = this.now()
      changed = true
      if (s.plan && s.plan.id === j.planId) {
        // An uncertain result cannot authorize more work. The fresh ping reports it to Co-Di.
        for (const pending of s.jobs) if (pending.planId === j.planId && pending.status === 'queued') pending.status = 'cancelled'
        s.plan.version++
      }
      if (live) void this.io.cancel(j).catch(() => {})
    }
    if (changed) await this.save(dir)
  }
  async stop(reason = 'Stopped by the director.'): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) return
    const s = await this.read(dir), p = s.plan; if (!p) return
    p.status = 'stopped'; p.reason = reason; p.awaiting = []; p.next = undefined
    const active = s.jobs.filter(j => j.planId === p.id && !jobSettled(j))
    for (const j of active) j.status = 'cancelled'
    await this.save(dir)
    for (const j of active) if (this.live.has(j.id)) void this.io.cancel(j).catch(() => {})
  }
  async wait(ids: string[], progress: string): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) throw Error('No project open.')
    const s = await this.read(dir), p = s.plan
    if (!p || !['active', 'waiting'].includes(p.status)) throw Error('No approved plan is active.')
    if (!ids.length || ids.some(id => !s.jobs.some(j => j.id === id))) throw Error('Use job IDs returned by the app.')
    if (ids.every(id => { const j = s.jobs.find(j => j.id === id)!; return jobSettled(j) && p.seenResults?.[id] === (j.resultVersion ?? j.endedAt ?? 0) })) throw Error('These results were already delivered. Inspect them and save your next task instead of waiting again.')
    if (!progress.trim()) throw Error('Save what is finished and what to do with the results.')
    p.awaiting = [...new Set(ids)]; p.progress = progress; p.actions = []; p.next = undefined; p.status = 'waiting'; await this.save(dir)
  }
  async progress(text: string, done: boolean, next?: string): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) throw Error('No project open.')
    const s = await this.read(dir), p = s.plan
    if (!p || !['active', 'waiting'].includes(p.status)) throw Error('No approved plan is active.')
    if (!text.trim()) throw Error('Save what is finished and what remains.')
    if (done && next) throw Error('A finished plan cannot have a next task.')
    if (next && p.status === 'waiting' && s.jobs.some(j => p.awaiting.includes(j.id) && !jobSettled(j))) throw Error('Wait for the requested job results before scheduling dependent work.')
    if (done && s.jobs.some(j => j.planId === p.id && j.status !== 'done')) throw Error('The plan has unfinished or failed jobs. Report them; do not mark it finished.')
    if (p.progress !== text) p.version++
    p.progress = text
    p.actions = []
    if (next?.trim()) { p.next = next.trim(); p.status = 'active'; p.awaiting = [] }
    if (done) { p.status = 'done'; p.next = undefined }
    await this.save(dir)
  }
  async block(reason: string): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) return
    const p = (await this.read(dir)).plan
    if (p && ['active', 'waiting'].includes(p.status)) { p.status = 'blocked'; p.reason = reason; await this.save(dir) }
  }
  async changed(action: string): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) return
    const s = await this.read(dir)
    if (s.plan) {
      s.plan.version++
      // ponytail: retain 100 recent receipts alongside Co-Di's durable summary; full records remain in the project log.
      s.plan.actions = [...(s.plan.actions ?? []), action].slice(-100)
      await this.save(dir)
    }
  }
  async nextPing(route: string): Promise<{ plan: CodirPlan; jobs: AppJob[] } | null> {
    const dir = this.io.projectDir(); if (!dir || !await this.io.enabled()) return null
    const s = await this.read(dir), p = s.plan
    if (!p || !['active', 'waiting'].includes(p.status)) return null
    if (p.aiRoute !== route) { p.status = 'blocked'; p.reason = 'Co-Director model changed. Review the plan before continuing.'; await this.save(dir); return null }
    const owned = s.jobs.filter(j => j.planId === p.id)
    const awaited = p.awaiting.length ? s.jobs.filter(j => p.awaiting.includes(j.id)) : owned
    if ((!p.next || p.awaiting.length) && awaited.some(j => !jobSettled(j))) return null
    const unseen = awaited.filter(j => jobSettled(j) && p.seenResults?.[j.id] !== (j.resultVersion ?? j.endedAt ?? 0))
    if (!p.next && !unseen.length) return null
    if (p.exchanges >= p.maxExchanges || p.noProgress >= 2) { p.status = 'blocked'; p.reason = p.noProgress >= 2 ? 'No saved progress in two exchanges.' : 'The approved Co-Director exchange limit was reached.'; await this.save(dir); return null }
    return { plan: clone(p), jobs: clone(unseen) }
  }
  async beginPing(id: string, results?: AppJob[]): Promise<number> {
    const dir = this.io.projectDir(); if (!dir) throw Error('No project open.')
    const s = await this.read(dir), p = s.plan
    if (!p || p.id !== id || !['active', 'waiting'].includes(p.status)) throw Error('This plan stopped.')
    const awaited = results ?? s.jobs.filter(j => p.awaiting.length ? p.awaiting.includes(j.id) : j.planId === p.id)
    p.seenResults ??= {}
    for (const j of awaited) if (jobSettled(j)) p.seenResults[j.id] = j.resultVersion ?? j.endedAt ?? 0
    p.task = p.next ?? 'Inspect the new job results and carry out the next step of the plan.'
    p.next = undefined
    p.exchanges++; p.status = 'active'; p.awaiting = []; const before = p.version; await this.save(dir); return before
  }
  async endPing(id: string, before: number): Promise<void> {
    const dir = this.io.projectDir(); if (!dir) return
    const p = (await this.read(dir)).plan
    if (p?.id === id) { p.noProgress = p.version > before ? 0 : p.noProgress + 1; p.seenVersion = p.version; await this.save(dir) }
  }
}

export class CodirExchanges {
  private busy = false
  private users: (() => Promise<void>)[] = []
  private pings: (() => Promise<void>)[] = []
  get active(): boolean { return this.busy || this.users.length > 0 || this.pings.length > 0 }
  enqueue<T>(origin: 'user' | 'job', run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      (origin === 'user' ? this.users : this.pings).push(async () => { try { resolve(await run()) } catch (e) { reject(e) } })
      this.pump()
    })
  }
  private pump(): void {
    if (this.busy) return
    const run = this.users.shift() ?? this.pings.shift(); if (!run) return
    this.busy = true; void run().finally(() => { this.busy = false; setTimeout(() => this.pump(), 50) })
  }
}
