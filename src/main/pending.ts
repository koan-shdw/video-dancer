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
  provider?: 'fal' | 'higgsfield' | 'modelark' | 'astria' | 'venice' | 'local' | 'mcp' // absent = fal (entries from before multi-provider). 'local' = a local render that FINISHED after a project switch: endpoint is its file, landed from disk
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

// list 52: a submitted ENHANCE job on fal — the copy re-lands from the args alone (stage = what that
// request does: a two-stage job's first request lands what it did, honestly marked)
export interface PendingEnhance {
  requestId: string
  endpoint: string
  jobId?: string
  createdAt: number
  stage: 'interp' | 'upscale' | 'both' | 'depth' // depth = list 42's depth map
  args: import('@koan/vidancer-ui/shared/enhance').EnhanceArgs
}

// a Video Editor job (vedit) or a clip edit (edit) a supplier took (audit 2026-10-09 H7): it re-lands
// from the request it was sent with, the way the live run lands it. `file` = the result was already
// downloaded (the project changed before it landed): recovery lands that file, nothing is fetched.
export interface PendingEdit {
  requestId: string
  endpoint: string
  provider: 'fal' | 'higgsfield' | 'venice' | 'mcp' // mcp = the Higgsfield Bridge login; its endpoint says which login ('#2')
  jobId?: string
  createdAt: number
  channel: 'vedit' | 'edit'
  req: Record<string, unknown>
  file?: string
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
  enhances: PendingEnhance[]
  edits: PendingEdit[]
}
const KINDS = ['pending', 'scores', 'voices', 'enhances', 'edits'] as const

async function readAll(dir: string): Promise<PendingFile> {
  try {
    const raw = JSON.parse(await readFile(pendingPath(dir), 'utf-8')) as Partial<PendingFile>
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || KINDS.some((key) => {
      const value = raw[key]
      return value !== undefined && (!Array.isArray(value) || value.some((entry) => !entry || typeof entry.requestId !== 'string'))
    })) throw new Error('invalid recovery ledger')
    return { pending: raw.pending ?? [], scores: raw.scores ?? [], voices: raw.voices ?? [], enhances: raw.enhances ?? [], edits: raw.edits ?? [] }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { pending: [], scores: [], voices: [], enhances: [], edits: [] }
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

// one list / add / remove for every kind of entry (renders, scores, voices, enhances, edits)
type Kind = (typeof KINDS)[number]
type Match = { requestId?: string; jobId?: string }
const list = <K extends Kind>(key: K) => (dir: string): Promise<PendingFile[K]> => serialized(dir, async () => (await readAll(dir))[key])
const add = <K extends Kind>(key: K) => (dir: string, entry: PendingFile[K][number]): Promise<void> =>
  serialized(dir, async () => {
    const all = await readAll(dir)
    const rows = all[key] as { requestId: string }[]
    ;(all[key] as unknown[]) = [...rows.filter((p) => p.requestId !== entry.requestId), entry]
    await writeAll(dir, all)
  })
const remove = <K extends Kind>(key: K) => (dir: string, match: Match): Promise<void> =>
  serialized(dir, async () => {
    const all = await readAll(dir)
    const rows = all[key] as { requestId: string; jobId?: string }[]
    const next = rows.filter((p) => !((match.requestId && p.requestId === match.requestId) || (match.jobId && p.jobId === match.jobId)))
    if (next.length !== rows.length) await writeAll(dir, { ...all, [key]: next })
  })

export const listPendingRenders = list('pending')
export const addPendingRender = add('pending')
export const removePendingRender = remove('pending')
export const listPendingScores = list('scores')
export const addPendingScore = add('scores')
export const removePendingScore = remove('scores')
export const listPendingVoices = list('voices')
export const addPendingVoice = add('voices')
export const removePendingVoice = remove('voices')
export const listPendingEnhances = list('enhances')
export const addPendingEnhance = add('enhances')
export const removePendingEnhance = remove('enhances')
export const listPendingEdits = list('edits')
export const addPendingEdit = add('edits')
export const removePendingEdit = remove('edits')
