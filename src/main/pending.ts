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
  provider?: 'fal' | 'higgsfield' | 'modelark' | 'astria' | 'local' // absent = fal (entries from before multi-provider). 'local' exists for type flow only — local renders never write pending entries (nothing billed, nothing to recover)
  jobId?: string
  createdAt: number
  req: PendingReq
}

// a submitted SCORE render (v18) — same crash-recovery contract, its own shape (the video
// PendingReq carries nothing a score needs; the take re-lands from the score clip id alone)
export interface PendingScore {
  requestId: string
  endpoint: string
  jobId?: string
  createdAt: number
  scoreClipId: string
  engine: string // audio-registry id
}

const pendingPath = (dir: string): string => join(dir, 'pending-renders.json')

// every mutation is SERIALIZED per directory: two renders submitted or completing concurrently
// are read-modify-writes on one file — unserialized, one drops the other's entry, and a dropped
// entry is a PAID render whose crash recovery silently vanishes (the exact loss this file exists
// to prevent)
const chains = new Map<string, Promise<unknown>>()
function serialized<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const prev = chains.get(dir) ?? Promise.resolve()
  const next = prev.then(run, run)
  chains.set(dir, next.catch(() => undefined))
  return next
}

interface PendingFile {
  pending: PendingRender[]
  scores: PendingScore[]
}

async function readAll(dir: string): Promise<PendingFile> {
  try {
    const raw = JSON.parse(await readFile(pendingPath(dir), 'utf-8')) as { pending?: PendingRender[]; scores?: PendingScore[] }
    return { pending: Array.isArray(raw.pending) ? raw.pending : [], scores: Array.isArray(raw.scores) ? raw.scores : [] }
  } catch {
    return { pending: [], scores: [] } // no file yet / unreadable — nothing pending
  }
}

async function writeAll(dir: string, all: PendingFile): Promise<void> {
  const tmp = pendingPath(dir) + '.tmp'
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf-8')
  await rename(tmp, pendingPath(dir))
}

export async function listPendingRenders(dir: string): Promise<PendingRender[]> {
  return serialized(dir, async () => (await readAll(dir)).pending)
}

export async function addPendingRender(dir: string, entry: PendingRender): Promise<void> {
  return serialized(dir, async () => {
    const all = await readAll(dir)
    all.pending = all.pending.filter((p) => p.requestId !== entry.requestId)
    all.pending.push(entry)
    await writeAll(dir, all)
  })
}

export async function removePendingRender(dir: string, match: { requestId?: string; jobId?: string }): Promise<void> {
  return serialized(dir, async () => {
    const all = await readAll(dir)
    const next = all.pending.filter((p) => !((match.requestId && p.requestId === match.requestId) || (match.jobId && p.jobId === match.jobId)))
    if (next.length !== all.pending.length) await writeAll(dir, { ...all, pending: next })
  })
}

export async function listPendingScores(dir: string): Promise<PendingScore[]> {
  return serialized(dir, async () => (await readAll(dir)).scores)
}

export async function addPendingScore(dir: string, entry: PendingScore): Promise<void> {
  return serialized(dir, async () => {
    const all = await readAll(dir)
    all.scores = all.scores.filter((p) => p.requestId !== entry.requestId)
    all.scores.push(entry)
    await writeAll(dir, all)
  })
}

export async function removePendingScore(dir: string, match: { requestId?: string; jobId?: string }): Promise<void> {
  return serialized(dir, async () => {
    const all = await readAll(dir)
    const next = all.scores.filter((p) => !((match.requestId && p.requestId === match.requestId) || (match.jobId && p.jobId === match.jobId)))
    if (next.length !== all.scores.length) await writeAll(dir, { ...all, scores: next })
  })
}
