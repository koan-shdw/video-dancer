import { appJobs, submitAppJob, submitAppJobs } from './appJobs'
import { getProject } from './project'
import { buildFireJob } from './codirReach'
import { compileClip, applyRefTags, applyVideoRefTags } from '@koan/vidancer-ui/shared/compile'
import { primaryImageFile } from '@koan/vidancer-ui/shared/imageSources'
import { modelFor, unknownEngineError } from '@koan/vidancer-ui/shared/models'
import type { CodirPlan, JobKind } from '@koan/vidancer-ui/shared/jobNotifications'

let planId: string | null = null
let route = ''
let aiCost = ''
export const continuationId = (): string | null => planId
export function setContinuationContext(id: string | null, aiRoute: string, cost: string): void { planId = id; route = aiRoute; aiCost = cost }
const readonly = new Set(['read_object', 'read_compiled_prompt', 'read_render_failures', 'list_image_gen_options', 'read_jobs'])
const controls = new Set(['wait_for_jobs', 'plan_progress', 'stop_plan'])
export async function continuationGuard(name: string): Promise<void> {
  if (!planId) return
  const p = (await appJobs().read()).plan
  if (!p || p.id !== planId || !['active', 'waiting'].includes(p.status)) throw Error('The approved plan stopped.')
  if (readonly.has(name) || controls.has(name)) return
  if (p.status === 'waiting') throw Error('You are waiting for jobs. End this exchange; their results will ping you.')
  if (!p.tools.includes(name)) throw Error(`The approved plan does not authorize ${name}.`)
}
export async function continuationChanged(name: string, result: string): Promise<void> {
  if (planId && !readonly.has(name) && !controls.has(name) && !result.startsWith('ERROR')) await appJobs().changed()
}
const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const str = { type: 'string' }, integer = { type: 'integer' }
export const CONTINUATION_TOOLS = [
  { name: 'save_work_plan', description: 'Before asking for GO on work with follow-up steps, save your complete plan in plain English: the brief, sources, picture descriptions, counts, models, destinations, costs and creative work the director delegates. You own and carry out this plan. The app only tracks jobs and pings you when they finish. Scope is this project. List the app tools you need, render allowances and fixed settings (keys as sent in the app request). Counts include one permitted retry per job. The plan and every allowance appear for the director to approve. Never call this from an automatic continuation.', input_schema: obj({ plan: str, renders: { type: 'array', items: obj({ kind: { type: 'string', enum: ['image_gen', 'clip', 'image_edit', 'video_edit', 'score', 'voice', 'enhance', 'export', 'compose'] }, engine: str, max_jobs: integer, settings: { type: 'object' }, cost: str }, ['kind', 'engine', 'max_jobs', 'settings', 'cost']) }, tools: { type: 'array', items: str }, max_exchanges: integer }, ['plan', 'renders', 'tools', 'max_exchanges']) },
  { name: 'read_jobs', description: 'Read this project’s job IDs, pending work, completed results, failures, output IDs/files and the approved plan. Results use the same format for every model. Page with offset/limit; follow next_offset until null. Use existing read_object and watch tools to inspect actual content before deciding what to do next.', input_schema: obj({ job_ids: { type: 'array', items: str }, offset: integer, limit: integer }) },
  { name: 'wait_for_jobs', description: 'Save which jobs you are waiting for and where your plan has reached. End this exchange after calling. The app will ping you in a fresh exchange when all these jobs have a result, with your plan and saved progress. Then inspect the results and carry out your next step. Does not construct or execute a workflow.', input_schema: obj({ job_ids: { type: 'array', items: str }, progress: str }, ['job_ids', 'progress']) },
  { name: 'plan_progress', description: 'Save your place in the approved plan across exchanges. done=true only when you have finished the requested work and all its jobs succeeded. A stopped or failed job is never finished. Save useful decisions and what to inspect or do next.', input_schema: obj({ progress: str, done: { type: 'boolean' } }, ['progress']) },
  { name: 'stop_plan', description: 'Stop the active plan and its pending/running jobs. Keep completed outputs.', input_schema: obj({}) },
  { name: 'enhance_take', description: 'Queue Enhance on an existing take within the approved plan. Its existing interpolation, upscale and depth engines are supported. Returns a job ID; wait_for_jobs will ping you when it finishes. Use the exact approved engine/model/settings.', input_schema: obj({ clip_id: str, take_id: str, interp: { type: 'object' }, upscale: { type: 'object' }, depth: { type: 'object' } }, ['clip_id', 'take_id']) }
]
export async function continuationTool(name: string, input: Record<string, unknown>): Promise<string | undefined> {
  if (!CONTINUATION_TOOLS.some(t => t.name === name)) return undefined
  switch (name) {
    case 'save_work_plan': {
      if (planId) throw Error('An automatic continuation cannot replace its approval.')
      if (!Array.isArray(input.renders) || !Array.isArray(input.tools)) throw Error('List render allowances and app tools.')
      const tools = input.tools.map(String)
      if (tools.some(t => /^(delete_|import_skill|save_mood|save_work_plan)/.test(t))) throw Error('Destructive or external writes need a direct user request.')
      const renders = input.renders.map(value => {
        const r = value as Record<string, unknown>
        return { kind: String(r.kind) as JobKind, engine: String(r.engine ?? ''), maxJobs: Number(r.max_jobs), settings: (r.settings ?? {}) as Record<string, unknown>, cost: String(r.cost ?? '') }
      })
      const p = await appJobs().propose({ text: String(input.plan ?? ''), renders, tools, maxExchanges: Number(input.max_exchanges), aiRoute: route, aiCost })
      return `PLAN SAVED ${p.id} revision ${p.revision}\n${p.text}\n${JSON.stringify({ renders: p.renders, tools: p.tools, maxExchanges: p.maxExchanges, aiRoute: p.aiRoute, aiCost: p.aiCost })}\nPresent the whole plan and wait for the director's GO.`
    }
    case 'read_jobs': {
      const s = await appJobs().read(), ids = Array.isArray(input.job_ids) ? input.job_ids.map(String) : undefined
      const rows = ids ? s.jobs.filter(j => ids.includes(j.id)) : s.jobs.filter(j => j.planId === s.plan?.id || !['done', 'failed', 'cancelled', 'lost'].includes(j.status))
      const offset = Math.max(0, Math.trunc(Number(input.offset)) || 0), limit = Math.min(200, Math.max(1, Math.trunc(Number(input.limit)) || 50))
      return JSON.stringify({ plan: s.plan, total: rows.length, next_offset: offset + limit < rows.length ? offset + limit : null, jobs: rows.slice(offset, offset + limit).map(({ request: _request, ...j }) => j) })
    }
    case 'wait_for_jobs':
      if (!planId) throw Error('Save a plan and obtain GO before unattended continuation.')
      await appJobs().wait(Array.isArray(input.job_ids) ? input.job_ids.map(String) : [], String(input.progress ?? ''))
      return 'Saved. End this exchange. Job completion will ping you to continue your plan.'
    case 'plan_progress':
      if (!planId) throw Error('No approved plan in this exchange.')
      await appJobs().progress(String(input.progress ?? ''), input.done === true); return input.done ? 'Plan complete.' : 'Progress saved.'
    case 'stop_plan': await appJobs().stop(); return 'Plan stopped. Completed files are kept.'
    case 'enhance_take': {
      if (!planId) throw Error('Save a plan and obtain GO before running Enhance.')
      const p = getProject(), c = p?.clips.find(c => c.id === input.clip_id), t = c?.takes.find(t => t.id === input.take_id)
      if (!c || !t) throw Error('The source take does not exist.')
      if (!input.interp && !input.upscale && !input.depth) throw Error('Choose an Enhance operation.')
      const j = await submitAppJob('enhance:run', [{ source: { kind: 'take', clipId: c.id, takeId: t.id }, interp: input.interp, upscale: input.upscale, depth: input.depth }], planId)
      return `queued job_id=${j.id} ${j.label}`
    }
  }
}

// The existing render handlers are called directly for saved Co-Director work. A panel need not be open.
export async function fireContinuation(input: Record<string, unknown>): Promise<string | undefined> {
  if (!planId) return undefined
  const p = getProject(); if (!p) throw Error('No project open.')
  const queued: string[] = []
  if (input.kind === 'image_gen') {
    const g = p.imageGens?.find(g => g.id === input.id || g.name === input.id)
    if (!g) throw Error('No such image gen.')
    const prompts = Array.isArray(input.prompts) ? input.prompts.map(String) : [g.recipe.prompt]
    if (!prompts.length || prompts.some(p => !p.trim())) throw Error('Every image needs its prompt.')
    const requests = prompts.map(prompt => {
      const recipe = { ...structuredClone(g.recipe), prompt, seed: g.recipe.seed || 1 + Math.floor(Math.random() * 0x7ffffffe) }
      return [{ imageGenId: g.id, recipe }]
    })
    queued.push(...(await submitAppJobs('imagegen:render', requests, planId)).map(j => j.id))
  } else if (input.kind === 'clip') {
    const c = p.clips.find(c => c.id === input.id || c.name === input.id)
    if (!c) throw Error('No such clip.')
    const pd = structuredClone(c.promptData), error = unknownEngineError(pd.engine)
    if (error) throw Error(error)
    if (pd.mode === 'v2v') throw Error('Use video_edit for this edit clip.')
    const m = modelFor(pd.engine), refIds = pd.mode === 't2v' ? [] : pd.mode === 'i2v' ? pd.imageIds.slice(0, 1) : pd.imageIds
    const images = refIds.map(id => primaryImageFile(p, id)).filter((f): f is string => !!f)
    if (images.length !== refIds.length) throw Error('A clip reference is missing.')
    let prompt = compileClip(p, c).text
    if (m.refTagPrompt && pd.mode !== 'i2v') prompt = applyRefTags(prompt, pd.imageIds.map(id => p.images.find(i => i.id === id)?.title ?? ''), m.refTagPrompt)
    if (m.refVideoTagPrompt && pd.mode !== 'i2v') prompt = applyVideoRefTags(prompt, m.refVideoTagPrompt)
    const req = { ...pd, mode: pd.mode === 't2v' ? 'ref2v' : pd.mode, prompt, images, imageAssetIds: undefined,
      videoRefs: pd.mode === 'ref2v' && m.maxRefVideos ? pd.videoRefs : undefined, audioRefs: pd.mode === 'ref2v' && m.maxRefAudios ? pd.audioRefs : undefined,
      loras: m.provider === 'local' && pd.loraOn !== false ? pd.loras : undefined,
      endImage: pd.mode === 'i2v' && m.endFrame && pd.endImageId ? primaryImageFile(p, pd.endImageId) : undefined,
      clipId: c.id, name: c.name, seed: pd.seed || 1 + Math.floor(Math.random() * 0x7ffffffe) }
    const j = await submitAppJob('render:run', [req], planId); queued.push(j.id)
  } else {
    const built = buildFireJob(p, input)
    if ('error' in built) throw Error(built.error)
    const channel = { score: 'score:render', voice: 'voice:render', image: 'image:generate', vedit: 'vedit:run' }[built.job.kind]
    const payload = structuredClone(built.job.payload) as Record<string, unknown>
    if (built.job.kind === 'voice') payload.recipe = structuredClone(p.voiceClips.find(v => v.id === payload.voiceClipId)?.recipe)
    const j = await submitAppJob(channel, [payload], planId); queued.push(j.id)
  }
  return `queued ${queued.length} jobs: ${queued.join(', ')}. Save your next step with wait_for_jobs. Their results will ping you.`
}
export const planContextText = (plan: CodirPlan): string => `App job notification. This is a continuation of the director's approved plan, not a new user message or a new GO.\nPLAN:\n${plan.text}\nSAVED PROGRESS:\n${plan.progress}\nUse read_jobs for current outcomes. Inspect actual results using your existing tools before judging, choosing or writing dependent prompts. You decide the next step and carry it out within the saved approval. Use wait_for_jobs after submitting work, plan_progress to save decisions, and done only after completing the plan. If any job is lost, do not duplicate it; report the uncertainty and stop_plan. If a job failed twice, stop_plan.\nALLOWED TOOLS: ${plan.tools.join(', ')}`
