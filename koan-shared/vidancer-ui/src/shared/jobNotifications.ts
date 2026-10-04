export type JobKind = 'image_gen' | 'clip' | 'image_edit' | 'video_edit' | 'score' | 'voice' | 'enhance' | 'export' | 'sheet' | 'compose' | 'voice_description' | 'fx' | 'image_save' | 'media_export' | 'watch' | 'assembly'
export type JobStatus = 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'lost'
export interface JobOutput { id?: string; file: string; ownerId?: string }
export interface AppJob {
  id: string; attempt: number; projectDir: string; kind: JobKind; targetId: string; engine: string; label: string
  status: JobStatus; createdAt: number; startedAt?: number; endedAt?: number; deadlineMs: number
  planId?: string; request?: { channel: string; args: unknown[] }; cancelId?: string
  outputs: JobOutput[]; result?: Record<string, unknown>; error?: string; late?: boolean; previousError?: string; retryQueued?: boolean; providerAccepted?: boolean
  resultVersion?: number
}
export interface CodirPlan {
  id: string; revision: string; text: string; progress: string
  status: 'draft' | 'active' | 'waiting' | 'stopped' | 'done' | 'blocked'
  // These limit authority; Co-Director chooses the next actions in its own plan.
  renders: { kind: JobKind; engine: string; maxJobs: number; settings: Record<string, unknown>; cost: string }[]
  tools: string[]; maxExchanges: number; exchanges: number; noProgress: number
  aiRoute: string; aiCost: string; awaiting: string[]; version: number; seenVersion: number
  approvedAt?: number; reason?: string
  task?: string; next?: string; updates?: string[]; actions?: string[]; seenResults?: Record<string, number>
}
export interface JobState { projectDir?: string; version: 1; jobs: AppJob[]; plan?: CodirPlan }
export const jobSettled = (job: AppJob): boolean => ['done', 'failed', 'cancelled', 'lost'].includes(job.status)
