// crash-proof render bookkeeping — <project>/pending-renders.json. Every submitted fal render is
// written here the moment fal ACCEPTS it (request id in hand) and removed when it lands, fails or
// is cancelled. Anything left over means the app died mid-render: on the next project open the
// resume pass asks fal about each entry and collects finished ones as takes. Money spent on a
// render must never be lost to a restart.
import { readFile, writeFile, rename } from 'fs/promises'
import { join } from 'path'
import type { CharacterField, BeatField, SceneFields, ProductionFields, CharacterLink, EngineId, VideoRef, AudioRef } from '@koan/vidancer-ui/shared/types'

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
  draft?: boolean // list 17: a Seedance 2.5 Draft — the recovered take keeps the id that finishes it
  draftId?: string // list 17: the finish of a Draft (its recovered take is the 1080p final)
  loras?: { name: string; weight: number }[] // frozen into the recovered take's snapshot
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  fieldLinks?: Record<string, string[]>
  fieldOverrides?: Record<string, string[]>
  characterLinks?: CharacterLink[]
}

export interface PendingRender {
  requestId: string
  endpoint: string
  provider?: 'fal' | 'higgsfield' | 'modelark' | 'astria' | 'venice' | 'local' | 'mcp' // absent = fal (entries from before multi-provider). 'local' exists for type flow only — local renders never write pending entries (nothing billed, nothing to recover)
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
  snapshot?: import('@koan/vidancer-ui/shared/types').ScoreRenderArgs['snapshot']
}

// a submitted VOICE render — same crash-recovery contract as scores (the take re-lands from
// the voice clip id alone; money spent on a render must never be lost to a restart)
export interface PendingVoice {
  requestId: string
  endpoint: string
  jobId?: string
  createdAt: number
  voiceClipId: string
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
  voices: PendingVoice[]
}

async function readAll(dir: string): Promise<PendingFile> {
  try {
    const raw = JSON.parse(await readFile(pendingPath(dir), 'utf-8')) as { pending?: PendingRender[]; scores?: PendingScore[]; voices?: PendingVoice[] }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ['pending', 'scores', 'voices'].some((key) => {
      const value = raw[key as keyof typeof raw]
      return value !== undefined && (!Array.isArray(value) || value.some((entry) => !entry || typeof entry.requestId !== 'string'))
    })) throw new Error('invalid recovery ledger')
    return { pending: raw.pending ?? [], scores: raw.scores ?? [], voices: raw.voices ?? [] }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { pending: [], scores: [], voices: [] }
    // Preserve the original bytes. Never let a later submission overwrite an
    // unreadable record of paid jobs with a plausible-looking empty ledger.
    throw new Error(`Cannot read render recovery records in ${dir}. The original file was preserved. ${e instanceof Error ? e.message : String(e)}`)
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

export async function listPendingVoices(dir: string): Promise<PendingVoice[]> {
  return serialized(dir, async () => (await readAll(dir)).voices)
}

export async function addPendingVoice(dir: string, entry: PendingVoice): Promise<void> {
  return serialized(dir, async () => {
    const all = await readAll(dir)
    all.voices = all.voices.filter((p) => p.requestId !== entry.requestId)
    all.voices.push(entry)
    await writeAll(dir, all)
  })
}

export async function removePendingVoice(dir: string, match: { requestId?: string; jobId?: string }): Promise<void> {
  return serialized(dir, async () => {
    const all = await readAll(dir)
    const next = all.voices.filter((p) => !((match.requestId && p.requestId === match.requestId) || (match.jobId && p.jobId === match.jobId)))
    if (next.length !== all.voices.length) await writeAll(dir, { ...all, voices: next })
  })
}
