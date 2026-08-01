// crash-proof render bookkeeping — <project>/pending-renders.json. Every submitted fal render is
// written here the moment fal ACCEPTS it (request id in hand) and removed when it lands, fails or
// is cancelled. Anything left over means the app died mid-render: on the next project open the
// resume pass asks fal about each entry and collects finished ones as takes. Money spent on a
// render must never be lost to a restart.
import { readFile, writeFile, rename } from 'fs/promises'
import { join } from 'path'
import type { CharacterField, BeatField, SceneFields, ProductionFields, CharacterLink, EngineId, VideoRef, AudioRef } from '../shared/types'

// the recipe needed to LAND a recovered render exactly like a live completion (RenderIpcRequest
// minus the queue jobId; image paths are Library files, re-resolved on resume)
export interface PendingReq {
  clipId?: string
  name?: string
  engine?: EngineId
  mode: 'ref2v' | 'i2v'
  prompt: string
  freeform: string
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
  images: string[]
  endImage?: string
  videoRefs?: VideoRef[] // Seedance @video refs (ids — re-resolved on resume like image paths)
  audioRefs?: AudioRef[]
  duration: string
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  seed?: number
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  fieldLinks?: Record<string, string[]>
  characterLinks?: CharacterLink[]
}

export interface PendingRender {
  requestId: string
  endpoint: string
  provider?: 'fal' | 'higgsfield' | 'modelark' // absent = fal (entries from before multi-provider)
  jobId?: string
  createdAt: number
  req: PendingReq
}

const pendingPath = (dir: string): string => join(dir, 'pending-renders.json')

async function readPending(dir: string): Promise<PendingRender[]> {
  try {
    const raw = JSON.parse(await readFile(pendingPath(dir), 'utf-8')) as { pending?: PendingRender[] }
    return Array.isArray(raw.pending) ? raw.pending : []
  } catch {
    return [] // no file yet / unreadable — nothing pending
  }
}

async function writePending(dir: string, pending: PendingRender[]): Promise<void> {
  const tmp = pendingPath(dir) + '.tmp'
  await writeFile(tmp, JSON.stringify({ pending }, null, 2), 'utf-8')
  await rename(tmp, pendingPath(dir))
}

export async function listPendingRenders(dir: string): Promise<PendingRender[]> {
  return readPending(dir)
}

export async function addPendingRender(dir: string, entry: PendingRender): Promise<void> {
  const pending = (await readPending(dir)).filter((p) => p.requestId !== entry.requestId)
  pending.push(entry)
  await writePending(dir, pending)
}

export async function removePendingRender(dir: string, match: { requestId?: string; jobId?: string }): Promise<void> {
  const pending = await readPending(dir)
  const next = pending.filter((p) => !((match.requestId && p.requestId === match.requestId) || (match.jobId && p.jobId === match.jobId)))
  if (next.length !== pending.length) await writePending(dir, next)
}
