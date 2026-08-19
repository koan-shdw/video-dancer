import { join, extname, basename, isAbsolute, relative, resolve, sep } from 'path'
import { readFile, writeFile, mkdir, copyFile, rename, unlink, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { resolveTake, extractFrame, probeVideo, normalizeVideo } from './export'
import {
  SCHEMA_VERSION,
  normalizeImageTitle,
  type Project,
  type ProjectDelta,
  type ProjImage,
  type ProjAudio,
  type ProjVideo,
  type Folder,
  type Take,
  type Clip,
  type ProjectStyle,
  type CharSheet,
  type CharacterField,
  type ScoreClip,
  type ScoreBeat,
  type ScoreRecipe,
  type ScoreTake,
  type Timeline,
  type TimelineItem,
  type TimelineAudioItem,
  type TimelineScoreItem,
  type TimelineMusic,
  type PromptData,
  type VideoRef,
  type AudioRef,
  type SendSelection,
  type SendResult,
  type EditSession,
  type EditNode,
  type VideoEditSession,
  type VideoEditNode,
  type CoDirMsg
} from '../shared/types'

// model types come from the single shared source; re-export so existing main-side imports keep working
export type {
  Project,
  ProjectDelta,
  ProjImage,
  Folder,
  Take,
  Clip,
  ProjectStyle,
  TimelineItem,
  ItemFx,
  PromptData,
  SceneFields,
  CharacterField,
  BeatField,
  ProductionFields
} from '../shared/types'

let current: Project | null = null

// ---- undo/redo: snapshot-based history of the in-memory project (metadata only; media files are
// never deleted by mutations, so restoring a snapshot is always valid). Each saveProject() that
// actually changes state pushes the PREVIOUS state. ----
const HISTORY_MAX = 80
let undoStack: string[] = [] // JSON snapshots you can step BACK to (oldest first)
let redoStack: string[] = [] // JSON snapshots you can step FORWARD to
let lastSnapshot: string | null = null // JSON of `current` as of the last save/load
let restoring = false // true while undo/redo writes — don't record that write as a new history step

function resetHistory(): void {
  undoStack = []
  redoStack = []
  lastSnapshot = current ? JSON.stringify(current) : null
}

const jsonPath = (dir: string): string => join(dir, 'project.json')

function toAbsolute(p: Project): Project {
  const abs = (f: string): string => (isAbsolute(f) ? f : join(p.dir, f))
  return {
    ...p,
    images: p.images.map((i) => ({ ...i, file: abs(i.file) })),
    audio: (p.audio ?? []).map((a) => ({ ...a, file: abs(a.file) })),
    videos: (p.videos ?? []).map((v) => ({ ...v, file: abs(v.file) })),
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: abs(t.file) }))
    })),
    scoreClips: (p.scoreClips ?? []).map((sc) => ({
      ...sc,
      takes: sc.takes.map((t) => ({ ...t, file: abs(t.file) }))
    })),
    voices: (p.voices ?? []).map((v) => ({ ...v, file: abs(v.file) })),
    voiceSessions: (p.voiceSessions ?? []).map((s) => ({
      ...s,
      nodes: s.nodes.map((n) => ({ ...n, file: abs(n.file) }))
    })),
    editSessions: (p.editSessions ?? []).map((s) => ({
      ...s,
      ...(s.originalFile ? { originalFile: abs(s.originalFile) } : {}),
      nodes: s.nodes.map((n) => ({ ...n, file: abs(n.file) }))
    })),
    videoEditSessions: (p.videoEditSessions ?? []).map((s) => ({
      ...s,
      ...(s.originalFile ? { originalFile: abs(s.originalFile) } : {}),
      nodes: s.nodes.map((n) => ({ ...n, file: abs(n.file) }))
    }))
  }
}

function toRelative(p: Project): Omit<Project, 'dir'> {
  const rel = (f: string): string => (isAbsolute(f) ? relative(p.dir, f) : f)
  const out = {
    ...p,
    images: p.images.map((i) => ({ ...i, file: rel(i.file) })),
    audio: (p.audio ?? []).map((a) => ({ ...a, file: rel(a.file) })),
    videos: (p.videos ?? []).map((v) => ({ ...v, file: rel(v.file) })),
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: rel(t.file) }))
    })),
    scoreClips: (p.scoreClips ?? []).map((sc) => ({
      ...sc,
      takes: sc.takes.map((t) => ({ ...t, file: rel(t.file) }))
    })),
    voices: (p.voices ?? []).map((v) => ({ ...v, file: rel(v.file) })),
    voiceSessions: (p.voiceSessions ?? []).map((s) => ({
      ...s,
      nodes: s.nodes.map((n) => ({ ...n, file: rel(n.file) }))
    })),
    editSessions: (p.editSessions ?? []).map((s) => ({
      ...s,
      ...(s.originalFile ? { originalFile: rel(s.originalFile) } : {}),
      nodes: s.nodes.map((n) => ({ ...n, file: rel(n.file) }))
    })),
    videoEditSessions: (p.videoEditSessions ?? []).map((s) => ({
      ...s,
      ...(s.originalFile ? { originalFile: rel(s.originalFile) } : {}),
      nodes: s.nodes.map((n) => ({ ...n, file: rel(n.file) }))
    }))
  }
  const { dir: _dir, ...rest } = out
  return rest
}

// fill defaults / upgrade older project.json files to the current schema
function migrate(raw: Partial<Omit<Project, 'dir'>> & { timeline?: TimelineItem[] }): Omit<Project, 'dir'> {
  const fileVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  if (fileVersion > SCHEMA_VERSION)
    console.warn(`[project] file schema v${fileVersion} is newer than app v${SCHEMA_VERSION} — opening best-effort`)
  // v≤2 → v3: the single `timeline` array becomes "Timeline 1"
  let timelines: Timeline[] = (raw.timelines ?? []).map((t) => ({
    ...t,
    aspectRatio: t.aspectRatio || '16:9',
    items: t.items ?? []
  }))
  if (timelines.length === 0)
    timelines = [{ id: randomUUID(), name: 'Timeline 1', aspectRatio: '16:9', items: raw.timeline ?? [] }]
  const activeTimelineId =
    typeof raw.activeTimelineId === 'string' && timelines.some((t) => t.id === raw.activeTimelineId)
      ? raw.activeTimelineId
      : timelines[0].id
  // v≤5 → v6: fieldLinks values were single clip ids — wrap into one-element stacks. Applies to
  // clips' live promptData AND every take's frozen snapshot (both are PromptData on disk).
  const migLinks = (pd: PromptData): PromptData => {
    if (!pd.fieldLinks) return pd
    const fl: Record<string, string[]> = {}
    for (const [path, v] of Object.entries(pd.fieldLinks)) {
      const stack = (Array.isArray(v) ? v : [v as unknown as string]).filter((x): x is string => typeof x === 'string' && !!x)
      if (stack.length) fl[path] = stack
    }
    return { ...pd, fieldLinks: Object.keys(fl).length ? fl : undefined }
  }
  // v≤10 → v11: every beat gets a stable id (anchors display-only data across whole-array rewrites)
  const migBeats = (pd: PromptData): PromptData =>
    pd.beats?.some((b) => !b.id) ? { ...pd, beats: pd.beats.map((b) => (b.id ? b : { ...b, id: randomUUID() })) } : pd
  const clips = (raw.clips ?? []).map((c) => {
    // ONE malformed clip (missing promptData) must never refuse the whole project — synthesize
    // an empty recipe and salvage the rest (the old `c.promptData.engine` threw here)
    const basePd = (c.promptData ?? {
      mode: 'ref2v',
      freeform: '',
      scene: {},
      characters: [],
      beats: [],
      production: {},
      imageIds: [],
      duration: '5',
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: true
    }) as PromptData
    return {
      ...c,
      promptData: migBeats(migLinks({ ...basePd, engine: basePd.engine ?? 'seedance2' })),
      takes: (c.takes ?? []).map((t) => (t.snapshot ? { ...t, snapshot: migBeats(migLinks(t.snapshot)) } : t))
    }
  })
  // v≤13 → v14: absolute-time tracks — stamp startSec from the old gapless sequence so every
  // project looks IDENTICAL on open; track defaults to V1; lane counts get their defaults
  const effOf = (it: TimelineItem): number => {
    const c = clips.find((x) => x.id === it.clipId)
    let src = 5
    if (c) {
      const takeId = it.takeId ?? c.keeperTakeId ?? c.takes[c.takes.length - 1]?.id
      const take = it.useRecipe ? undefined : (c.takes.find((t) => t.id === takeId) ?? c.takes[c.takes.length - 1])
      src = take
        ? take.durationSec ?? (parseFloat((take.snapshot ?? c.promptData).duration) || 5)
        : parseFloat(c.promptData.duration) || 5
    }
    if (it.useRecipe) return src
    const out = Math.min(it.outSec ?? src, src)
    const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
    return Math.max(0.25 / (it.speed && it.speed > 0 ? it.speed : 1), (out - inn) / (it.speed && it.speed > 0 ? it.speed : 1)) // source-second floor (mirror of renderer effDur)
  }
  for (const tl of timelines) {
    let cursor = 0
    for (const it of tl.items) {
      if (it.startSec == null) it.startSec = cursor
      if (it.track == null) it.track = 0
      // v17: strip the dead v16-era stamped-loop link key — old copies stay as plain blocks
      delete (it as TimelineItem & { loopOf?: string }).loopOf
      cursor = Math.max(cursor, it.startSec + effOf(it))
    }
    const maxV = tl.items.reduce((m, i) => Math.max(m, (i.track ?? 0) + 1), 1)
    const maxA = (tl.audioItems ?? []).reduce((m, a) => Math.max(m, a.lane + 1), 3)
    tl.videoTracks = tl.videoTracks ?? maxV
    tl.audioTracks = tl.audioTracks ?? maxA
    // v20 ONE LANE SYSTEM: the dedicated music lane dies — tl.music becomes a file-source
    // TimelineAudioItem on its OWN new lane (guaranteed collision-free), carrying every knob;
    // it drives the beat grid. musicMuted folds into the item's mute. One-way, idempotent.
    if (tl.music) {
      const m = tl.music
      const lane = tl.audioTracks
      tl.audioTracks = lane + 1
      tl.audioItems = [
        ...(tl.audioItems ?? []),
        {
          id: randomUUID(),
          lane,
          source: { audioId: m.audioId },
          beatGrid: true,
          startSec: m.startSec,
          inSec: m.inSec ?? 0,
          outSec: m.outSec ?? raw.audio?.find((x) => x.id === m.audioId)?.durationSec ?? 600,
          ...(m.gain != null ? { gain: m.gain } : {}),
          ...(m.volume?.length ? { volume: m.volume } : {}),
          ...(tl.musicMuted ? { muted: true } : {})
        }
      ]
      delete tl.music
      delete tl.musicMuted
    }
  }
  // spread the RAW object first so top-level keys this app version doesn't know (a NEWER app's
  // fields) survive the open→save round-trip instead of being silently destroyed; every known
  // key below overrides the raw copy with its migrated value
  const { timeline: _legacySingleTimeline, ...rawRest } = raw
  return {
    ...(rawRest as Omit<Project, 'dir'>),
    schemaVersion: SCHEMA_VERSION,
    name: raw.name ?? 'Untitled',
    ...(typeof raw.watchFolder === 'string' && raw.watchFolder ? { watchFolder: raw.watchFolder } : {}),
    ...(typeof raw.watchFolderOwner === 'string' && raw.watchFolderOwner ? { watchFolderOwner: raw.watchFolderOwner } : {}),
    createdAt: raw.createdAt ?? Date.now(),
    images: raw.images ?? [],
    audio: raw.audio ?? [], // v5: music files
    videos: raw.videos ?? [], // imported reference videos
    clips,
    styles: raw.styles ?? [], // v6: project styles
    charSheets: raw.charSheets ?? [], // v12: char sheets
    scoreClips: raw.scoreClips ?? [], // v18: score clips
    voices: raw.voices ?? [], // v18: voice assets
    voiceSessions: raw.voiceSessions ?? [], // v18: voice results trees
    timelines,
    activeTimelineId,
    folders: raw.folders ?? [],
    editSessions: raw.editSessions ?? [],
    videoEditSessions: raw.videoEditSessions ?? [], // v2v result trees
    codir: raw.codir ?? { log: [], brief: '' } // v7: Co-Director conversation + brief
  }
}

export function getProject(): Project | null {
  return current
}

// rename the OPEN project's display name (folder untouched — the picker/header show this name)
export async function renameCurrentProject(name: string): Promise<boolean> {
  if (!current || !name.trim()) return false
  current.name = name.trim()
  await saveProject()
  return true
}

// Saves are SERIALIZED (one at a time, in call order) and ATOMIC (write .tmp, then rename) so
// overlapping debounced saves from the renderer can never interleave or leave a half-written file.
// The JSON snapshot is taken synchronously at enqueue time so later mutations don't bleed in.
let saveChain: Promise<void> = Promise.resolve()
// a save failure is a DATA-LOSS condition (disk full, cloud-sync lock, permissions) — it must
// reach the USER, not just the log. index.ts registers the notifier; null = recovered.
let saveFailNotify: ((failingMsg: string | null) => void) | null = null
let saveFailing = false
export function onSaveFailure(cb: (failingMsg: string | null) => void): void {
  saveFailNotify = cb
}
// quit must not cut an in-flight write — index.ts awaits this on before-quit
export function pendingSaves(): Promise<void> {
  return saveChain
}
export function saveProject(): Promise<void> {
  if (!current) return Promise.resolve()
  // record history (skip the writes that undo/redo themselves trigger)
  if (!restoring) {
    const cur = JSON.stringify(current)
    if (lastSnapshot !== null && lastSnapshot !== cur) {
      undoStack.push(lastSnapshot)
      if (undoStack.length > HISTORY_MAX) undoStack.shift()
      redoStack = [] // a fresh action invalidates the redo path
    }
    lastSnapshot = cur
    // any user mutation may have moved a dynamic still's source frame — re-check (debounced, cheap no-op when sigs match)
    if (!reconciling) scheduleDynamicReconcile()
  }
  const path = jsonPath(current.dir)
  const snapshot = JSON.stringify(toRelative(current), null, 2)
  saveChain = saveChain
    .then(async () => {
      const tmp = path + '.tmp'
      await writeFile(tmp, snapshot, 'utf-8')
      await rename(tmp, path)
      if (saveFailing) {
        saveFailing = false
        saveFailNotify?.(null) // recovered — the banner clears
      }
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[project] save failed:', msg)
      saveFailing = true
      saveFailNotify?.(msg)
    })
  return saveChain
}

export async function newProject(baseDir: string, name: string): Promise<Project> {
  let safe = (name || 'Untitled').replace(/[<>:"/\\|?*]+/g, '').trim().replace(/[. ]+$/, '') || 'Untitled'
  // Windows reserved device names (CON, NUL, COM1…) fail mkdir or mismatch the on-disk name
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe)) safe = `${safe}_`
  let dir = join(baseDir, safe)
  let n = 2
  while (existsSync(dir)) dir = join(baseDir, `${safe} ${n++}`)
  await mkdir(join(dir, 'images'), { recursive: true })
  await mkdir(join(dir, 'renders'), { recursive: true })
  const firstTimeline: Timeline = { id: randomUUID(), name: 'Timeline 1', aspectRatio: '16:9', items: [] }
  current = {
    schemaVersion: SCHEMA_VERSION,
    name: safe,
    dir,
    createdAt: Date.now(),
    images: [],
    audio: [],
    videos: [],
    clips: [],
    styles: [],
    charSheets: [],
    scoreClips: [],
    voices: [],
    voiceSessions: [],
    timelines: [firstTimeline],
    activeTimelineId: firstTimeline.id,
    folders: [],
    editSessions: [],
    videoEditSessions: [],
    codir: { log: [], brief: '' }
  }
  resetHistory()
  await saveProject()
  return current
}

// step the project back/forward through the snapshot history; returns the restored Project (full).
// null = nothing to step to (empty stack) — the renderer uses that to say "nothing to undo".
export async function undo(): Promise<Project | null> {
  if (!current || undoStack.length === 0) return null
  redoStack.push(JSON.stringify(current))
  const prev = undoStack.pop() as string
  current = JSON.parse(prev) as Project
  lastSnapshot = prev
  restoring = true
  await saveProject()
  restoring = false
  scheduleDynamicReconcile() // the restored state may point dynamic stills at different frames
  return current
}
export async function redo(): Promise<Project | null> {
  if (!current || redoStack.length === 0) return null
  undoStack.push(JSON.stringify(current))
  const next = redoStack.pop() as string
  current = JSON.parse(next) as Project
  lastSnapshot = next
  restoring = true
  await saveProject()
  restoring = false
  scheduleDynamicReconcile()
  return current
}

// read + migrate a project folder WITHOUT making it the current project (used by open and by
// the cross-project clip importer)
async function readProjectData(dir: string): Promise<Project | null> {
  if (!existsSync(jsonPath(dir))) return null
  try {
    const data = JSON.parse(await readFile(jsonPath(dir), 'utf-8')) as Partial<Omit<Project, 'dir'>>
    // one-time safety copy on any schema change (upgrade OR newer-file best-effort open): the
    // first save rewrites the file in THIS app's schema — the original must survive that
    const fileVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0
    if (fileVersion !== SCHEMA_VERSION) {
      const bak = jsonPath(dir) + `.v${fileVersion}.bak`
      if (!existsSync(bak)) await copyFile(jsonPath(dir), bak).catch(() => undefined)
    }
    const p = toAbsolute({ ...migrate(data), dir })
    // a moved/shared/downloaded project must not point media:// at an arbitrary absolute folder
    // it named for a DIFFERENT machine (playgrounds are a distribution channel) — the watch
    // folder only survives when it was picked while the project lived at THIS path
    if (p.watchFolder && p.watchFolderOwner !== dir) {
      console.error('[project] dropping watch folder (project moved/shared):', p.watchFolder)
      delete p.watchFolder
      delete p.watchFolderOwner
    }
    return p
  } catch (e) {
    // corrupted project.json: don't crash the IPC handler — report "couldn't open" and leave the file alone
    console.error('[project] failed to read', jsonPath(dir), e instanceof Error ? e.message : e)
    return null
  }
}

export async function openProject(dir: string): Promise<Project | null> {
  const p = await readProjectData(dir)
  if (p) {
    current = p
    resetHistory()
  }
  return p
}

// ---- watch folder: a live staging strip over an EXTERNAL folder (e.g. Forge outputs) ----
export async function setWatchFolder(dir: string | null): Promise<ProjectDelta | null> {
  if (!current) return null
  if (dir) {
    current.watchFolder = dir
    current.watchFolderOwner = current.dir // picked HERE — a moved/shared copy drops it on open
  } else {
    delete current.watchFolder
    delete current.watchFolderOwner
  }
  await saveProject()
  return { watchFolder: dir }
}

const WATCH_IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i
// list the watched folder's images, newest first (capped — this is a strip, not a browser)
export async function listWatchFolder(): Promise<{ file: string; name: string; mtime: number }[]> {
  const dir = current?.watchFolder
  if (!dir || !existsSync(dir)) return []
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: { file: string; name: string; mtime: number }[] = []
  for (const name of names) {
    if (!WATCH_IMG_RE.test(name)) continue
    const f = join(dir, name)
    try {
      const st = await stat(f)
      if (st.isFile()) out.push({ file: f, name, mtime: st.mtimeMs })
    } catch {
      /* raced a deletion — skip */
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out.slice(0, 200)
}

// ---- named save states: metadata-only checkpoints in <project>/checkpoints/ ----
// Media files are shared with the live project (the delete convention never unlinks media, and the
// cleanup sweep below protects anything a checkpoint still references), so a save state is instant.
const statesDir = (dir: string): string => join(dir, 'checkpoints')
interface StateFile {
  name: string
  savedAt: number
  project: Partial<Omit<Project, 'dir'>>
}

export async function saveProjectState(name: string): Promise<{ file: string; name: string; savedAt: number } | null> {
  if (!current) return null
  const nm = name.trim() || 'state'
  await mkdir(statesDir(current.dir), { recursive: true })
  const savedAt = Date.now()
  const safe = nm.replace(/[^\w-]+/g, '_').slice(0, 40) || 'state'
  const file = join(statesDir(current.dir), `${savedAt}_${safe}.json`)
  const payload: StateFile = { name: nm, savedAt, project: toRelative(current) }
  // atomic like every other state write — a crash mid-write otherwise leaves a corrupt
  // checkpoint that hides from the list UI yet makes cleanupProject refuse forever
  await writeFile(file + '.tmp', JSON.stringify(payload, null, 2), 'utf-8')
  await rename(file + '.tmp', file)
  return { file, name: nm, savedAt }
}

export async function listProjectStates(): Promise<{ file: string; name: string; savedAt: number }[]> {
  if (!current) return []
  const dir = statesDir(current.dir)
  if (!existsSync(dir)) return []
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: { file: string; name: string; savedAt: number }[] = []
  for (const nm of names) {
    if (!nm.endsWith('.json')) continue
    try {
      const raw = JSON.parse(await readFile(join(dir, nm), 'utf-8')) as StateFile
      if (raw && typeof raw.name === 'string' && raw.project) out.push({ file: join(dir, nm), name: raw.name, savedAt: raw.savedAt ?? 0 })
    } catch {
      /* malformed checkpoint — hide it rather than crash the list */
    }
  }
  out.sort((a, b) => b.savedAt - a.savedAt)
  return out
}

// only paths inside the CURRENT project's checkpoints dir are touchable via IPC.
// Boundary + case rules matter: bare startsWith(base) lets a SIBLING dir ("checkpointsEVIL")
// pass, and Windows paths compare case-insensitively.
function isStateFile(file: string): boolean {
  if (!current) return false
  const norm = (p: string): string => resolve(p).toLowerCase()
  const base = norm(statesDir(current.dir))
  const f = norm(file)
  return (f === base || f.startsWith(base + sep)) && f.endsWith('.json')
}

// swap the whole project state for the checkpoint's — through the normal save path, so the
// pre-restore state lands in the undo history (Ctrl+Z reverts a restore)
export async function restoreProjectState(file: string): Promise<Project | null> {
  if (!current || !isStateFile(file)) return null
  try {
    const raw = JSON.parse(await readFile(file, 'utf-8')) as StateFile
    if (!raw?.project) return null
    current = toAbsolute({ ...migrate(raw.project), dir: current.dir })
    await saveProject()
    return current
  } catch (e) {
    console.error('[project] state restore failed:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function deleteProjectState(file: string): Promise<boolean> {
  if (!isStateFile(file)) return false
  try {
    await unlink(file)
    return true
  } catch {
    return false
  }
}

// ---- spend ledger: per-project money log in <project>/spend.json — DELIBERATELY outside
// project.json: the money was spent regardless of undo, so history restores must never erase it.
// Entries are model-pricing ESTIMATES recorded when a paid job completes (fal billing is
// authoritative); append-only. ----
export interface SpendEntry {
  at: number
  label: string
  kind: 'gen' | 'edit' | 'image'
  cost: number
}
const spendPath = (dir: string): string => join(dir, 'spend.json')

async function readSpend(dir: string): Promise<SpendEntry[]> {
  try {
    const raw = JSON.parse(await readFile(spendPath(dir), 'utf-8')) as { entries?: SpendEntry[] }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return [] // no ledger yet (or unreadable) — start empty
  }
}

// serialized like saveChain: two renders completing together must never lose a ledger entry to
// a read-modify-write race (this file is the MONEY record)
let spendChain: Promise<unknown> = Promise.resolve()
export async function addSpend(entry: { label: string; kind: SpendEntry['kind']; cost: number }): Promise<{ total: number } | null> {
  if (!current) return null
  const dir = current.dir
  const run = async (): Promise<{ total: number }> => {
    const entries = await readSpend(dir)
    entries.push({ at: Date.now(), label: entry.label, kind: entry.kind, cost: Number.isFinite(entry.cost) ? entry.cost : 0 })
    const tmp = spendPath(dir) + '.tmp'
    await writeFile(tmp, JSON.stringify({ entries }, null, 2), 'utf-8')
    await rename(tmp, spendPath(dir))
    return { total: entries.reduce((s, e) => s + (e.cost || 0), 0) }
  }
  const p = spendChain.then(run, run)
  spendChain = p.catch(() => undefined)
  return p
}

export async function listSpend(): Promise<{ total: number; entries: SpendEntry[] }> {
  if (!current) return { total: 0, entries: [] }
  const entries = await readSpend(current.dir)
  return { total: entries.reduce((s, e) => s + (e.cost || 0), 0), entries: [...entries].reverse() } // newest first
}

// ---- media cleanup: sweep files in the project's media folders that nothing references ----
// The delete convention never unlinks media (snapshot undo depends on files outliving their
// entries), so images/, renders/ and audio/ grow forever. This sweep is EXPLICIT (user-triggered,
// confirm-gated in the UI). The live set is the union of every file-holding field in the current
// project AND in every undo/redo history snapshot, so a cleanup can never break an undo.
function liveFilesOf(p: Project): string[] {
  const out: string[] = []
  for (const i of p.images) out.push(i.file)
  for (const a of p.audio ?? []) out.push(a.file)
  for (const v of p.videos ?? []) out.push(v.file)
  for (const c of p.clips) {
    for (const t of c.takes) {
      out.push(t.file)
      // a v2v take's frozen recipe pins its source video (sourceVideo.file is project-RELATIVE)
      const snap = t.snapshot?.sourceVideo
      if (snap?.file) out.push(join(p.dir, snap.file))
    }
    // an edit clip's live recipe pins its source even if the source clip was deleted
    const sv = c.promptData.sourceVideo
    if (sv?.file) out.push(join(p.dir, sv.file))
  }
  for (const s of p.editSessions ?? []) {
    if (s.originalFile) out.push(s.originalFile)
    for (const n of s.nodes) out.push(n.file)
  }
  for (const s of p.videoEditSessions ?? []) {
    if (s.originalFile) out.push(s.originalFile)
    for (const n of s.nodes) out.push(n.file)
  }
  // v18 — score takes, voice assets and voice-tree nodes are live media too
  for (const sc of p.scoreClips ?? []) for (const t of sc.takes) out.push(t.file)
  for (const v of p.voices ?? []) out.push(v.file)
  for (const s of p.voiceSessions ?? []) for (const n of s.nodes) out.push(n.file)
  return out
}

// long-running producers (fal render, image generation, cross-project import) write media files
// SECONDS before the referencing entry lands in `current` — a sweep during that window would
// delete a paid render. They bracket themselves with begin/endMediaWrite; cleanup refuses to run
// while any are in flight.
let mediaWrites = 0
export function beginMediaWrite(): void {
  mediaWrites++
}
export function endMediaWrite(): void {
  mediaWrites = Math.max(0, mediaWrites - 1)
}

export async function cleanupProject(apply: boolean): Promise<{ files: number; bytes: number; busy?: boolean } | null> {
  if (!current) return null
  if (mediaWrites > 0) return { files: 0, bytes: 0, busy: true }
  const dir = current.dir
  const norm = (x: string): string => (process.platform === 'win32' ? resolve(x).toLowerCase() : resolve(x))
  const live = new Set<string>()
  const addAll = (p: Project): void => {
    // snapshots hold in-memory (absolute) paths, but run them through toAbsolute anyway — a no-op
    // on absolute paths, and it protects the sweep if a relative path ever leaks into a snapshot
    for (const f of liveFilesOf(toAbsolute(p))) live.add(norm(f))
  }
  addAll(current)
  for (const snap of [...undoStack, ...redoStack, ...(lastSnapshot ? [lastSnapshot] : [])]) {
    try {
      addAll(JSON.parse(snap) as Project)
    } catch {
      /* a malformed snapshot only shrinks what we may delete — never widen the sweep on error */
      return null
    }
  }
  // saved states pin their media too — a cleanup must never break a checkpoint you could restore
  const cdir = statesDir(dir)
  if (existsSync(cdir)) {
    let names: string[] = []
    try {
      names = await readdir(cdir)
    } catch {
      return null
    }
    for (const nm of names) {
      if (!nm.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await readFile(join(cdir, nm), 'utf-8')) as StateFile
        if (raw?.project) addAll({ ...migrate(raw.project), dir } as Project)
      } catch {
        return null // unreadable checkpoint → never widen the sweep
      }
    }
  }
  // videos/ + videos/edits/ joined the sweep (deleted Library videos — often large, transcoded
  // on import — previously had NO reclamation path at all); exports/.fxbake catches bake temps
  // orphaned by a crash between exports
  const sweepDirs = [
    join(dir, 'images'),
    join(dir, 'images', 'edits'),
    join(dir, 'renders'),
    join(dir, 'audio'),
    join(dir, 'videos'),
    join(dir, 'videos', 'edits'),
    join(dir, 'exports', '.fxbake')
  ]
  // a LIVE take's AI sidecars (<take>.matte.mp4 / <take>.depth.mp4) are derived files the live
  // set doesn't list — deleting them is legal under "existence = cached" but silently discards
  // minutes of GPU work, so they count as live while their take is
  const liveSidecar = (f: string): boolean => {
    const m = f.match(/^(.*)\.(matte|depth)\.mp4$/i)
    return !!m && live.has(norm(m[1]))
  }
  let files = 0
  let bytes = 0
  for (const d of sweepDirs) {
    let names: string[] = []
    try {
      names = await readdir(d)
    } catch {
      continue // folder doesn't exist yet
    }
    for (const name of names) {
      const f = join(d, name)
      try {
        const st = await stat(f)
        if (!st.isFile() || live.has(norm(f)) || liveSidecar(f)) continue
        // the sweep itself awaits I/O, so `current` can gain references mid-run — re-check the
        // cheap current-project live set (no history parse) right before every delete
        if (apply && current && liveFilesOf(toAbsolute(current)).some((lf) => norm(lf) === norm(f))) continue
        files++
        bytes += st.size
        if (apply) await unlink(f)
      } catch (e) {
        console.error('[project] cleanup skip', f, e instanceof Error ? e.message : e)
      }
    }
  }
  return { files, bytes }
}

export async function importImage(localPath: string): Promise<ProjImage> {
  if (!current) throw new Error('no project')
  // dedup by ORIGIN: i.file holds the post-copy destination, so comparing it against the external
  // source path never matched — every drag (and every re-render) minted a fresh copy on disk
  const existing = current.images.find((i) => i.srcPath === localPath || i.file === localPath)
  if (existing) return existing
  const id = randomUUID()
  const ext = extname(localPath) || '.png'
  const destAbs = join(current.dir, 'images', id + ext)
  await copyFile(localPath, destAbs)
  const img: ProjImage = { id, title: nextImageTitle(), file: destAbs, srcPath: localPath }
  current.images.push(img)
  return img
}

// "@image{n}" titles must be unique — images.length+1 collides after deletions, so scan for the gap
function nextImageTitle(): string {
  let n = (current?.images.length ?? 0) + 1
  while (current?.images.some((i) => i.title === `@image${n}`)) n++
  return `@image${n}`
}

export async function addTake(opts: {
  clipId?: string
  name: string
  promptData: PromptData
  takeFile: string
  durationSec?: number // actual rendered length when the provider reports it
}): Promise<{ delta: ProjectDelta; clipId: string; takeId: string }> {
  if (!current) throw new Error('no project')
  let clip = opts.clipId ? current.clips.find((c) => c.id === opts.clipId) : undefined
  if (!clip) {
    clip = { id: randomUUID(), name: opts.name, promptData: opts.promptData, takes: [] }
    current.clips.push(clip)
  }
  // NEVER overwrite an existing clip's LIVE recipe with the render-time payload (workflow law:
  // recipes are live, renders are immutable — the take's snapshot below preserves the frozen
  // copy). Doing so silently reverted every edit made WHILE the render was cooking.
  const take: Take = {
    id: randomUUID(),
    file: opts.takeFile,
    createdAt: Date.now(),
    seed: opts.promptData.seed,
    engine: opts.promptData.engine ?? 'seedance2',
    durationSec: opts.durationSec,
    // freeze the recipe that produced this render — the take is an immutable record; later edits
    // to the clip's live recipe must not change what this take shows on the timeline
    snapshot: JSON.parse(JSON.stringify(opts.promptData)) as PromptData
  }
  clip.takes.push(take)
  clip.keeperTakeId = take.id
  await saveProject()
  return { delta: { clips: [clip] }, clipId: clip.id, takeId: take.id }
}

// backfill a take's ACTUAL video duration (the renderer measures it on first metadata load —
// providers don't always report it at render time)
export async function setTakeDuration(clipId: string, takeId: string, durationSec: number): Promise<ProjectDelta | null> {
  if (!current || !Number.isFinite(durationSec) || durationSec <= 0) return null
  const c = current.clips.find((x) => x.id === clipId)
  const t = c?.takes.find((x) => x.id === takeId)
  if (!c || !t || t.durationSec === durationSec) return null
  t.durationSec = Math.round(durationSec * 1000) / 1000
  await saveProject()
  return { clips: [c] }
}

export function emptyPromptData(): PromptData {
  return {
    engine: 'seedance2',
    mode: 'ref2v',
    freeform: '',
    scene: { title: '', referenceHandling: '', style: '', visualFeel: '' },
    characters: [],
    beats: [],
    production: { audioDesign: '', lighting: '', subtext: '', criticalConstraint: '', avoid: '' },
    imageIds: [],
    duration: '5',
    resolution: '720p',
    aspectRatio: 'auto',
    generateAudio: true
  }
}

// create a clip WITH a full recipe and no takes yet — an edit clip commits the moment the user
// hits Generate, so the prompt/window are on disk before any money moves and survive a shutdown
export async function newClipWithRecipe(name: string, promptData: PromptData): Promise<{ delta: ProjectDelta; clipId: string } | null> {
  if (!current) return null
  const clip: Clip = {
    id: randomUUID(),
    name: name.trim() || `clip ${current.clips.length + 1}`,
    promptData,
    takes: []
  }
  current.clips.push(clip)
  await saveProject()
  return { delta: { clips: [clip] }, clipId: clip.id }
}

// create a blank, unrendered (storyboard) clip
export async function newEmptyClip(name?: string): Promise<{ delta: ProjectDelta; clipId: string } | null> {
  if (!current) return null
  const clip: Clip = {
    id: randomUUID(),
    name: name?.trim() || `clip ${current.clips.length + 1}`,
    promptData: emptyPromptData(),
    takes: []
  }
  current.clips.push(clip)
  await saveProject()
  return { delta: { clips: [clip] }, clipId: clip.id }
}

// persist a clip's prompt data without rendering (so storyboard clips keep their recipe)
export async function setClipPromptData(clipId: string, promptData: Partial<PromptData>): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  if (!c) return null
  c.promptData = { ...c.promptData, ...promptData } // merge so unmanaged fields (e.g. seed) survive
  await saveProject()
  return { clips: [c] }
}

// ---- project styles: named universal-field bundles (scene + production), linkable like clips ----
export async function newStyle(name?: string): Promise<{ delta: ProjectDelta; styleId: string } | null> {
  if (!current) return null
  const style: ProjectStyle = {
    id: randomUUID(),
    name: name?.trim() || `style ${current.styles.length + 1}`,
    scene: { title: '', referenceHandling: '', style: '', visualFeel: '' },
    production: { audioDesign: '', lighting: '', subtext: '', criticalConstraint: '', avoid: '' }
  }
  current.styles.push(style)
  await saveProject()
  return { delta: { styles: [style] }, styleId: style.id }
}

export async function setStyle(id: string, patch: Partial<Pick<ProjectStyle, 'name' | 'scene' | 'production' | 'enhanced'>>): Promise<ProjectDelta | null> {
  if (!current) return null
  const s = current.styles.find((x) => x.id === id)
  if (!s) return null
  if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim()
  if (patch.scene) s.scene = patch.scene
  if (patch.production) s.production = patch.production
  if (patch.enhanced) s.enhanced = patch.enhanced.length ? patch.enhanced : undefined
  await saveProject()
  return { styles: [s] }
}

// ---- Co-Director: persisted conversation + brief (both inside the project → undo reverts an
// exchange together with the field writes it made) ----
const CODIR_LOG_CAP = 300 // messages kept in project.json — old turns fall off the top

export async function codirAppend(msgs: CoDirMsg[]): Promise<ProjectDelta | null> {
  if (!current) return null
  current.codir.log = [...current.codir.log, ...msgs].slice(-CODIR_LOG_CAP)
  await saveProject()
  return { codir: current.codir }
}

export async function codirSetBrief(brief: string): Promise<ProjectDelta | null> {
  if (!current) return null
  current.codir.brief = brief
  await saveProject()
  return { codir: current.codir }
}

export async function codirClearLog(): Promise<ProjectDelta | null> {
  if (!current) return null
  current.codir.log = []
  await saveProject()
  return { codir: current.codir }
}

// v15: the Co-Director's "still to decide" list (Director's Room) — whole-list replace, capped
export async function codirSetOpenQuestions(questions: string[]): Promise<ProjectDelta | null> {
  if (!current) return null
  current.codir.openQuestions = questions.map((q) => q.trim()).filter(Boolean).slice(0, 8)
  await saveProject()
  return { codir: current.codir }
}

// ---- char sheets: a character's image + universal description, linkable into clips live ----
export async function newCharSheet(name?: string): Promise<{ delta: ProjectDelta; sheetId: string } | null> {
  if (!current) return null
  const sheet: CharSheet = {
    id: randomUUID(),
    name: name?.trim() || `character ${current.charSheets.length + 1}`,
    character: { name: '', base: '', features: '', physics: '', referenceLabel: '' }
  }
  current.charSheets.push(sheet)
  await saveProject()
  return { delta: { charSheets: [sheet] }, sheetId: sheet.id }
}

export async function setCharSheet(
  id: string,
  patch: { name?: string; imageId?: string | null; character?: CharacterField }
): Promise<ProjectDelta | null> {
  if (!current) return null
  const s = current.charSheets.find((x) => x.id === id)
  if (!s) return null
  if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim()
  if (patch.imageId !== undefined) {
    if (patch.imageId && !current.images.some((i) => i.id === patch.imageId)) return null
    s.imageId = patch.imageId ?? undefined
  }
  if (patch.character) s.character = patch.character
  await saveProject()
  return { charSheets: [s] }
}

// links pointing at the deleted sheet stay put and resolve to nothing (same as deleted clips)
export async function deleteCharSheet(id: string): Promise<ProjectDelta | null> {
  if (!current) return null
  if (!current.charSheets.some((x) => x.id === id)) return null
  current.charSheets = current.charSheets.filter((x) => x.id !== id)
  await saveProject()
  return { removedCharSheetIds: [id] }
}

// ---- score clips (v18): music siblings of clips — beats + takes + keeper (docs/SCORE-PLAN.md) ----
export async function newScoreClip(name?: string): Promise<{ delta: ProjectDelta; scoreClipId: string } | null> {
  if (!current) return null
  const sc: ScoreClip = {
    id: randomUUID(),
    name: name?.trim() || `score ${current.scoreClips.length + 1}`,
    beats: [],
    recipe: { engine: 'minimax-music-3' }, // the primary API engine (SCORE-PLAN) — the card's registry uses the same id
    takes: []
  }
  current.scoreClips.push(sc)
  await saveProject()
  return { delta: { scoreClips: [sc] }, scoreClipId: sc.id }
}

// name / beats / recipe writes — beats are a whole-list replace, kept sorted by timestamp and
// with ids stamped defensively (a beat's id anchors nothing display-side yet, but the rule from
// video beats holds: identity is the app's to keep, never the caller's to lose)
export async function setScoreClipData(id: string, patch: { name?: string; beats?: ScoreBeat[]; recipe?: ScoreRecipe }): Promise<ProjectDelta | null> {
  if (!current) return null
  const sc = current.scoreClips.find((x) => x.id === id)
  if (!sc) return null
  if (typeof patch.name === 'string' && patch.name.trim()) sc.name = patch.name.trim()
  if (patch.beats) {
    sc.beats = patch.beats
      .map((b) => ({ id: b.id || randomUUID(), at: Math.max(0, Number(b.at) || 0), text: String(b.text ?? '') }))
      .sort((a, b) => a.at - b.at)
  }
  if (patch.recipe) sc.recipe = patch.recipe
  await saveProject()
  return { scoreClips: [sc] }
}

export async function setScoreKeeper(scoreClipId: string, takeId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const sc = current.scoreClips.find((x) => x.id === scoreClipId)
  if (!sc || !sc.takes.some((t) => t.id === takeId)) return null
  sc.keeperTakeId = takeId
  await saveProject()
  return { scoreClips: [sc] }
}

// the score also leaves every timeline span it was stretched over (mirror of deleteClips)
export async function deleteScoreClip(id: string): Promise<ProjectDelta | null> {
  if (!current) return null
  if (!current.scoreClips.some((x) => x.id === id)) return null
  current.scoreClips = current.scoreClips.filter((x) => x.id !== id)
  const touched: Timeline[] = []
  for (const tl of current.timelines) {
    if (!(tl.scoreItems ?? []).some((s) => s.scoreClipId === id)) continue
    tl.scoreItems = (tl.scoreItems ?? []).filter((s) => s.scoreClipId !== id)
    tl.rev = (tl.rev ?? 0) + 1
    touched.push(tl)
  }
  await saveProject()
  return { removedScoreClipIds: [id], ...(touched.length ? { timelines: touched } : {}) }
}

export async function duplicateScoreClip(id: string): Promise<{ delta: ProjectDelta; newScoreClipId: string } | null> {
  if (!current) return null
  const src = current.scoreClips.find((x) => x.id === id)
  if (!src) return null
  const idMap = new Map<string, string>()
  const takes: ScoreTake[] = src.takes.map((t) => {
    const nid = randomUUID()
    idMap.set(t.id, nid)
    return { ...t, id: nid }
  })
  const copy: ScoreClip = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    beats: src.beats.map((b) => ({ ...b, id: randomUUID() })),
    recipe: JSON.parse(JSON.stringify(src.recipe)) as ScoreRecipe,
    takes,
    keeperTakeId: src.keeperTakeId ? idMap.get(src.keeperTakeId) : undefined,
    folder: src.folder ?? null
  }
  current.scoreClips.push(copy)
  await saveProject()
  return { delta: { scoreClips: [copy] }, newScoreClipId: copy.id }
}

// take → its own score clip (the T-chip → Bin grammar): the take's FROZEN snapshot becomes the
// new clip's live plan, the take rides along as its first take. Audio file is SHARED on disk
// (takes are immutable; nothing is copied or re-rendered).
export async function scoreClipFromTake(scoreClipId: string, takeId: string): Promise<{ delta: ProjectDelta; newScoreClipId: string } | null> {
  if (!current) return null
  const src = current.scoreClips.find((x) => x.id === scoreClipId)
  const take = src?.takes.find((t) => t.id === takeId)
  if (!src || !take) return null
  const takeIdx = src.takes.indexOf(take) + 1
  const nid = randomUUID()
  const plan = take.snapshot ?? { beats: src.beats, recipe: src.recipe }
  const copy: ScoreClip = {
    id: randomUUID(),
    name: `${src.name} ·t${takeIdx}`,
    beats: plan.beats.map((b) => ({ ...b, id: randomUUID() })),
    recipe: JSON.parse(JSON.stringify(plan.recipe)) as ScoreRecipe,
    takes: [{ ...take, id: nid }],
    keeperTakeId: nid,
    folder: src.folder ?? null
  }
  current.scoreClips.push(copy)
  await saveProject()
  return { delta: { scoreClips: [copy] }, newScoreClipId: copy.id }
}

// curation marks on a score take (v14 grammar: color highlight + disabled dud-mark) — the
// take's FILE and snapshot stay immutable, only the marks move
export async function setScoreTakeMeta(scoreClipId: string, takeId: string, patch: { color?: string | null; disabled?: boolean }): Promise<ProjectDelta | null> {
  if (!current) return null
  const sc = current.scoreClips.find((x) => x.id === scoreClipId)
  const t = sc?.takes.find((x) => x.id === takeId)
  if (!sc || !t) return null
  if (patch.color !== undefined) t.color = patch.color ?? undefined
  if (patch.disabled !== undefined) t.disabled = patch.disabled || undefined
  await saveProject()
  return { scoreClips: [sc] }
}

// land a rendered score as a take — immutable record with the recipe FROZEN at submit time
export async function addScoreTake(
  scoreClipId: string,
  take: { file: string; engine?: string; durationSec?: number; seed?: number; snapshot?: { beats: ScoreBeat[]; recipe: ScoreRecipe } }
): Promise<{ delta: ProjectDelta; takeId: string } | null> {
  if (!current) return null
  const sc = current.scoreClips.find((x) => x.id === scoreClipId)
  if (!sc) return null
  const t: ScoreTake = {
    id: randomUUID(),
    file: take.file,
    createdAt: Date.now(),
    ...(take.engine ? { engine: take.engine } : {}),
    ...(typeof take.durationSec === 'number' && take.durationSec > 0 ? { durationSec: take.durationSec } : {}),
    ...(typeof take.seed === 'number' ? { seed: take.seed } : {}),
    ...(take.snapshot ? { snapshot: take.snapshot } : {})
  }
  sc.takes.push(t)
  await saveProject()
  return { delta: { scoreClips: [sc] }, takeId: t.id }
}

// ---- manual re-ordering of Bin clips / Library images (drop tile on tile) ----
// The moved items (their relative order kept) are spliced in BEFORE the target, and adopt the
// target's folder — so a cross-folder drop is a move + position in one gesture.
export async function reorderItems(
  kind: 'bin' | 'lib',
  movedIds: string[],
  targetId: string
): Promise<ProjectDelta | null> {
  if (!current) return null
  if (movedIds.includes(targetId)) return null // dropped onto itself / inside the selection — no-op
  const arr: { id: string; folder?: string | null }[] = kind === 'bin' ? current.clips : current.images
  const movedSet = new Set(movedIds)
  const moved = arr.filter((x) => movedSet.has(x.id))
  if (moved.length === 0) return null
  const rest = arr.filter((x) => !movedSet.has(x.id))
  const ti = rest.findIndex((x) => x.id === targetId)
  if (ti < 0) return null
  const targetFolder = rest[ti].folder ?? null
  for (const m of moved) m.folder = targetFolder
  const next = [...rest.slice(0, ti), ...moved, ...rest.slice(ti)]
  if (kind === 'bin') current.clips = next as Clip[]
  else current.images = next as ProjImage[]
  await saveProject()
  return kind === 'bin'
    ? { clips: moved as Clip[], clipsOrder: next.map((x) => x.id) }
    : { images: moved as ProjImage[], imagesOrder: next.map((x) => x.id) }
}

// links pointing at the deleted style stay put and resolve to nothing (same as deleted clips)
export async function deleteStyle(id: string): Promise<ProjectDelta | null> {
  if (!current) return null
  if (!current.styles.some((x) => x.id === id)) return null
  current.styles = current.styles.filter((x) => x.id !== id)
  await saveProject()
  return { removedStyleIds: [id] }
}

export async function renameClip(id: string, name: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === id)
  if (!c) return null
  c.name = name.trim() || c.name
  await saveProject()
  return { clips: [c] }
}

// save a captured timeline/clip frame (PNG bytes) as a new Library image
export async function saveFrameToLibrary(
  bytes: Uint8Array,
  note: string
): Promise<{ delta: ProjectDelta; imageId: string } | null> {
  if (!current) return null
  const id = randomUUID()
  await mkdir(join(current.dir, 'images'), { recursive: true })
  const dest = join(current.dir, 'images', id + '.png')
  await writeFile(dest, Buffer.from(bytes))
  const img: ProjImage = { id, title: nextImageTitle(), file: dest, genPrompt: note }
  current.images.push(img)
  await saveProject()
  return { delta: { images: [img] }, imageId: id }
}

export async function importImages(paths: string[]): Promise<{ delta: ProjectDelta; importedIds: string[] }> {
  if (!current) throw new Error('no project')
  const imported: ProjImage[] = []
  // per-file tolerance (same as importAudioFiles): one unreadable file mid-batch used to throw
  // AFTER earlier images were pushed into `current` with no save — ghosts materialized after
  // the next unrelated save/restart
  for (const p of paths) {
    try {
      imported.push(await importImage(p))
    } catch (e) {
      console.error('[project] image import failed, skipping:', p, e instanceof Error ? e.message : e)
    }
  }
  await saveProject()
  return { delta: { images: imported }, importedIds: imported.map((i) => i.id) }
}

// ---- audio lanes: main-side sequence math (mirror of the renderer's effDur/buildSegs) ----
function mainSrcDur(it: TimelineItem, clips: Clip[]): number {
  const c = clips.find((x) => x.id === it.clipId)
  if (!c) return 5
  const take = resolveTake(c, it)
  if (take) return take.durationSec ?? Math.max(0.3, parseFloat((take.snapshot ?? c.promptData).duration) || 5)
  const d = parseFloat(c.promptData.duration)
  return Number.isNaN(d) || d <= 0 ? 5 : d
}
export function mainEffDur(it: TimelineItem, clips: Clip[]): number {
  const dur = mainSrcDur(it, clips)
  const sp = it.speed && it.speed > 0 ? it.speed : 1
  if (it.useRecipe) return dur / sp
  const out = Math.min(it.outSec ?? dur, dur)
  const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
  return Math.max(0.25 / sp, (out - inn) / sp) // source-second floor (mirror of renderer effDur)
}
// v14: items carry ABSOLUTE positions; the legacy cumulative walk remains only as the fallback
// for an item that somehow lacks its stamp
function mainItemStarts(tl: Timeline, clips: Clip[]): Map<string, number> {
  const m = new Map<string, number>()
  let acc = 0
  for (const it of tl.items) {
    const s = it.startSec ?? acc
    m.set(it.id, s)
    acc = Math.max(acc, s + mainEffDur(it, clips))
  }
  return m
}
// refresh LINKED audio items' persisted startSec after any items write — linked audio follows its
// block through re-flows, and the stored value is the fallback the moment a link dangles
function syncLinkedAudio(tl: Timeline): void {
  if (!current || !tl.audioItems?.length) return
  const starts = mainItemStarts(tl, current.clips)
  for (const a of tl.audioItems) {
    if (!a.link) continue
    const s = starts.get(a.link.itemId)
    if (s != null) a.startSec = Math.max(0, s + a.link.offset)
  }
}

// detach a video block's audio onto a lane: same position/window, linked (offset 0), block muted.
// From here on the video can be trimmed/sliced/swapped freely — the audio lives its own life.
export async function unlinkAudioFromItem(timelineId: string, itemId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  const it = tl.items.find((x) => x.id === itemId)
  if (!it) return null
  const clip = current.clips.find((c) => c.id === it.clipId)
  const take = clip ? resolveTake(clip, it) : undefined
  if (!clip || !take) return null // storyboard blocks have no audio to detach
  const starts = mainItemStarts(tl, current.clips)
  const srcDur = mainSrcDur(it, current.clips)
  const a: TimelineAudioItem = {
    id: randomUUID(),
    lane: 0,
    source: { clipId: clip.id, takeId: take.id },
    startSec: starts.get(it.id) ?? 0,
    inSec: it.inSec ?? 0,
    outSec: Math.min(it.outSec ?? srcDur, srcDur),
    link: { itemId: it.id, offset: 0 }
  }
  // first audio track with no overlap at this span
  const len = Math.max(0.25, a.outSec - a.inSec)
  const overlaps = (x: TimelineAudioItem): boolean => x.startSec < a.startSec + len && a.startSec < x.startSec + Math.max(0.25, x.outSec - x.inSec)
  const laneCount = Math.max(1, tl.audioTracks ?? 3)
  for (let lane = 0; lane < laneCount; lane++) {
    if (!(tl.audioItems ?? []).some((x) => x.lane === lane && overlaps(x))) {
      a.lane = lane
      break
    }
  }
  it.muted = true // its embedded audio now lives on the lane
  it.audioDetachedId = a.id // the companion block renders as FREE (unlinked tint) from now on
  tl.audioItems = [...(tl.audioItems ?? []), a]
  tl.rev = (tl.rev ?? 0) + 1
  await saveProject()
  return { timelines: [tl] }
}

// track chrome + markers + in/out range — one writer for everything that isn't items/audioItems
export async function setTimelineMeta(
  timelineId: string,
  patch: Partial<Pick<Timeline, 'videoTracks' | 'audioTracks' | 'markers' | 'rangeInSec' | 'rangeOutSec' | 'lockedTracks' | 'mutedTracks' | 'soloTracks'>>
): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (patch.videoTracks !== undefined) tl.videoTracks = Math.max(1, Math.min(8, patch.videoTracks ?? 1))
  if (patch.audioTracks !== undefined) tl.audioTracks = Math.max(1, Math.min(8, patch.audioTracks ?? 1))
  if (patch.markers !== undefined) tl.markers = patch.markers?.length ? patch.markers : undefined
  if ('rangeInSec' in patch) tl.rangeInSec = patch.rangeInSec ?? undefined
  if ('rangeOutSec' in patch) tl.rangeOutSec = patch.rangeOutSec ?? undefined
  if (patch.lockedTracks !== undefined) tl.lockedTracks = patch.lockedTracks?.length ? patch.lockedTracks : undefined
  if (patch.mutedTracks !== undefined) tl.mutedTracks = patch.mutedTracks?.length ? patch.mutedTracks : undefined
  if (patch.soloTracks !== undefined) tl.soloTracks = patch.soloTracks?.length ? patch.soloTracks : undefined
  await saveProject()
  return { timelines: [tl] }
}

// whole-array write for the audio lanes (drag/trim/lane/mute/delete/link edits) — same CAS rev as items
export async function setTimelineAudioItems(timelineId: string, audioItems: TimelineAudioItem[], baseRev?: number): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (baseRev != null && baseRev !== (tl.rev ?? 0)) {
    console.warn(`[project] stale audio-lane write rejected (rev ${baseRev} vs ${tl.rev ?? 0})`)
    return { timelines: [tl] }
  }
  tl.audioItems = audioItems
  tl.rev = (tl.rev ?? 0) + 1
  syncLinkedAudio(tl) // a link toggle may have just landed — re-derive linked starts
  await saveProject()
  return { timelines: [tl] }
}

// v18 — the score lane's whole-array write, same CAS contract as the audio lanes
export async function setTimelineScoreItems(timelineId: string, scoreItems: TimelineScoreItem[], baseRev?: number): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (baseRev != null && baseRev !== (tl.rev ?? 0)) {
    console.warn(`[project] stale score-lane write rejected (rev ${baseRev} vs ${tl.rev ?? 0})`)
    return { timelines: [tl] }
  }
  tl.scoreItems = scoreItems.length ? scoreItems : undefined
  tl.rev = (tl.rev ?? 0) + 1
  await saveProject()
  return { timelines: [tl] }
}

export async function setTimelineItems(timelineId: string, items: TimelineItem[], baseRev?: number): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  // compare-and-swap: the payload is a WHOLE replacement array built from renderer state — if the
  // timeline moved since that state was read (a concurrent commit), applying it would silently
  // revert the other write. Reject and return the authoritative timeline so the renderer re-syncs.
  if (baseRev != null && baseRev !== (tl.rev ?? 0)) {
    console.warn(`[project] stale timeline write rejected (rev ${baseRev} vs ${tl.rev ?? 0})`)
    return { timelines: [tl] }
  }
  // defense: any item arriving without its v14 stamps gets them (cumulative fallback), so a
  // legacy-shaped write can never mix stamped and unstamped positioning
  let acc = 0
  for (const it of items) {
    if (it.startSec == null) it.startSec = acc
    if (it.track == null) it.track = 0
    acc = Math.max(acc, it.startSec + mainEffDur(it, current.clips))
  }
  tl.items = items
  tl.rev = (tl.rev ?? 0) + 1
  syncLinkedAudio(tl) // linked audio follows its block through the re-flow
  await saveProject()
  return { timelines: [tl] }
}

// ONE user action = ONE undo step: ripple operations move video items AND free audio together.
// As two separate IPC writes they were two history entries — the first Ctrl+Z reverted only the
// audio shift, leaving lanes visibly desynced from the blocks until a second Ctrl+Z.
export async function setTimelineBoth(
  timelineId: string,
  items: TimelineItem[],
  audioItems: TimelineAudioItem[] | null,
  baseRev?: number
): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (baseRev != null && baseRev !== (tl.rev ?? 0)) {
    console.warn(`[project] stale combined write rejected (rev ${baseRev} vs ${tl.rev ?? 0})`)
    return { timelines: [tl] }
  }
  let acc = 0
  for (const it of items) {
    if (it.startSec == null) it.startSec = acc
    if (it.track == null) it.track = 0
    acc = Math.max(acc, it.startSec + mainEffDur(it, current.clips))
  }
  tl.items = items
  if (audioItems) tl.audioItems = audioItems
  tl.rev = (tl.rev ?? 0) + 1
  syncLinkedAudio(tl)
  await saveProject()
  return { timelines: [tl] }
}

// atomic slice: split an instance at cutSec (source time) AND remap its 'last'-edge dynamic stills
// to the right half in ONE mutation + save — two separate IPC writes could leave a binding pointing
// at an item id that never landed (the still would silently freeze on the next reconcile)
export async function sliceTimelineItem(
  timelineId: string,
  itemId: string,
  cutSec: number
): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  const idx = tl.items.findIndex((it) => it.id === itemId)
  if (idx < 0) return null
  const it = tl.items[idx]
  const sp = it.speed && it.speed > 0 ? it.speed : 1
  const inn = it.inSec ?? 0
  // v14: halves live at absolute positions — the right half starts exactly where the cut lands
  // in TIMELINE time; the tail keeps any dissolve, the head loses it (its cut is now hard)
  const left: TimelineItem = { ...it, outSec: cutSec, transitionOutSec: undefined }
  const right: TimelineItem = {
    ...it,
    id: randomUUID(),
    inSec: cutSec,
    startSec: (it.startSec ?? 0) + Math.max(0, (cutSec - inn) / sp)
  }
  tl.items = [...tl.items.slice(0, idx), left, right, ...tl.items.slice(idx + 1)]
  tl.rev = (tl.rev ?? 0) + 1
  syncLinkedAudio(tl) // linked audio keeps riding the LEFT half (same item id)
  // a dynamic LAST-frame still bound to the sliced instance follows the RIGHT half (the true clip end)
  const changed = current.images.filter((i) => i.dynamic?.itemId === itemId && i.dynamic.edge === 'last')
  for (const img of changed) img.dynamic!.itemId = right.id
  await saveProject()
  return { timelines: [tl], ...(changed.length ? { images: changed } : {}) }
}

// ----- timeline entities: Bin citizens (create / rename / duplicate / delete / settings) -----
export async function addTimeline(name?: string): Promise<{ delta: ProjectDelta; timelineId: string } | null> {
  if (!current) return null
  const tl: Timeline = {
    id: randomUUID(),
    name: name?.trim() || `Timeline ${current.timelines.length + 1}`,
    aspectRatio: '16:9',
    items: []
  }
  current.timelines.push(tl)
  current.activeTimelineId = tl.id
  await saveProject()
  return { delta: { timelines: [tl], activeTimelineId: tl.id }, timelineId: tl.id }
}

export async function renameTimeline(id: string, name: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === id)
  if (!tl) return null
  tl.name = name.trim() || tl.name
  await saveProject()
  return { timelines: [tl] }
}

export async function setTimelineAspect(id: string, aspectRatio: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === id)
  if (!tl) return null
  tl.aspectRatio = aspectRatio
  await saveProject()
  return { timelines: [tl] }
}

export async function duplicateTimeline(id: string): Promise<{ delta: ProjectDelta; timelineId: string } | null> {
  if (!current) return null
  const src = current.timelines.find((t) => t.id === id)
  if (!src) return null
  const itemIdMap = new Map<string, string>()
  const copy: Timeline = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    aspectRatio: src.aspectRatio,
    items: src.items.map((it) => {
      const nid = randomUUID()
      itemIdMap.set(it.id, nid)
      return { ...it, id: nid } // instances get fresh ids
    }),
    // audio lanes ride along; links re-point at the copied instances (dangling links go absolute)
    ...(src.audioItems?.length
      ? {
          audioItems: src.audioItems.map((a) => ({
            ...a,
            id: randomUUID(),
            link: a.link && itemIdMap.has(a.link.itemId) ? { itemId: itemIdMap.get(a.link.itemId)!, offset: a.link.offset } : undefined
          }))
        }
      : {})
  }
  current.timelines.push(copy)
  await saveProject()
  return { delta: { timelines: [copy] }, timelineId: copy.id }
}

export async function deleteTimeline(id: string): Promise<ProjectDelta | null> {
  if (!current) return null
  if (!current.timelines.some((t) => t.id === id)) return null
  current.timelines = current.timelines.filter((t) => t.id !== id)
  const added: Timeline[] = []
  if (current.timelines.length === 0) {
    // never zero timelines — the panels always have a canvas to show
    const fresh: Timeline = { id: randomUUID(), name: 'Timeline 1', aspectRatio: '16:9', items: [] }
    current.timelines.push(fresh)
    added.push(fresh)
  }
  if (current.activeTimelineId === id) current.activeTimelineId = current.timelines[0].id
  await saveProject()
  return {
    removedTimelineIds: [id],
    ...(added.length ? { timelines: added } : {}),
    activeTimelineId: current.activeTimelineId
  }
}

export async function setActiveTimeline(id: string): Promise<ProjectDelta | null> {
  if (!current) return null
  if (!current.timelines.some((t) => t.id === id)) return null
  current.activeTimelineId = id
  await saveProject()
  return { activeTimelineId: id }
}

export async function cloneClipFromTake(
  clipId: string,
  takeId: string
): Promise<{ delta: ProjectDelta; newClipId: string } | null> {
  if (!current) return null
  const src = current.clips.find((c) => c.id === clipId)
  const take = src?.takes.find((t) => t.id === takeId)
  if (!src || !take) return null
  const newTakeId = randomUUID()
  // the new clip's recipe comes from the TAKE's frozen snapshot (what actually made that render),
  // not the source clip's current recipe — the user may have edited the recipe since
  const recipe = take.snapshot ?? src.promptData
  const newClip: Clip = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    promptData: JSON.parse(JSON.stringify(recipe)) as PromptData,
    takes: [{ ...take, id: newTakeId, createdAt: Date.now() }],
    keeperTakeId: newTakeId
  }
  current.clips.push(newClip)
  await saveProject()
  return { delta: { clips: [newClip] }, newClipId: newClip.id }
}

// pick which ref image VISUALLY represents a take-less clip (null = back to auto). Display-only.
export async function setClipStoryboard(clipId: string, imageId: string | null): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  if (!c) return null
  if (imageId && !current.images.some((i) => i.id === imageId)) return null
  c.storyboardImageId = imageId ?? undefined
  await saveProject()
  return { clips: [c] }
}

// rescue path: attach an EXTERNAL video file (e.g. downloaded from the fal dashboard after a
// restart ate an in-flight render) to a clip as a real take — copied in, set as keeper
export async function addTakeFromFile(clipId: string, srcPath: string): Promise<{ delta: ProjectDelta; takeId: string } | null> {
  if (!current) return null
  const clip = current.clips.find((c) => c.id === clipId)
  if (!clip || !existsSync(srcPath)) return null
  await mkdir(join(current.dir, 'renders'), { recursive: true })
  const dest = join(current.dir, 'renders', `import_${randomUUID()}${extname(srcPath) || '.mp4'}`)
  await copyFile(srcPath, dest)
  const r = await addTake({ clipId, name: clip.name, promptData: clip.promptData, takeFile: dest })
  return { delta: r.delta, takeId: r.takeId }
}

// take card chrome: highlight color + disabled ("dud") flag
export async function setTakeMeta(
  clipId: string,
  takeId: string,
  patch: { color?: string | null; disabled?: boolean }
): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  const t = c?.takes.find((x) => x.id === takeId)
  if (!c || !t) return null
  if ('color' in patch) t.color = patch.color ?? undefined
  if (patch.disabled !== undefined) t.disabled = patch.disabled || undefined
  await saveProject()
  return { clips: [c] }
}

export async function setKeeperTake(clipId: string, takeId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  if (!c || !c.takes.some((t) => t.id === takeId)) return null
  c.keeperTakeId = takeId
  await saveProject()
  return { clips: [c] }
}

// turn Library images into ready-made clips: one clip per image, named after its @title, with the
// image as the first ref. Optionally also places the fresh clips on a timeline (side by side at
// `index`) — one mutation + save, so drag-image-to-timeline is a single undo step.
export async function newClipsFromImages(
  imageIds: string[],
  place?: { timelineId: string; index: number }
): Promise<{ delta: ProjectDelta; clipIds: string[] } | null> {
  if (!current) return null
  const clips: Clip[] = []
  for (const id of imageIds) {
    const img = current.images.find((i) => i.id === id)
    if (!img) continue
    const pd = emptyPromptData()
    pd.imageIds = [img.id]
    const base = img.title.replace(/^@/, '') || 'clip'
    let name = base
    const taken = (n: string): boolean => current!.clips.some((c) => c.name === n) || clips.some((c) => c.name === n)
    for (let n = 2; taken(name); n++) name = `${base} ${n}` // always a NEW clip — dupes get " 2", " 3"
    clips.push({ id: randomUUID(), name, promptData: pd, takes: [] })
  }
  if (clips.length === 0) return null
  current.clips.push(...clips)
  let tl: Timeline | undefined
  if (place) {
    tl = current.timelines.find((t) => t.id === place.timelineId)
    if (tl) {
      // v14: `index` is read against the time-sorted TRACK-1 view; new blocks land there
      // back-to-back and everything later on that track RIPPLES right (the old insert feel)
      const t0 = tl.items.filter((x) => (x.track ?? 0) === 0).sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
      const at = Math.max(0, Math.min(place.index, t0.length))
      const endOfTrack = t0.reduce((m, x) => Math.max(m, (x.startSec ?? 0) + mainEffDur(x, current!.clips)), 0)
      const insertStart = at < t0.length ? (t0[at].startSec ?? 0) : endOfTrack
      const fresh: TimelineItem[] = []
      let cursor = insertStart
      for (const c of clips) {
        fresh.push({ id: randomUUID(), clipId: c.id, startSec: cursor, track: 0 })
        cursor += 5 // storyboard clips default to the 5s recipe duration
      }
      const added = cursor - insertStart
      for (const x of tl.items) {
        if ((x.track ?? 0) === 0 && (x.startSec ?? 0) >= insertStart - 0.001) x.startSec = (x.startSec ?? 0) + added
      }
      tl.items = [...tl.items, ...fresh]
      tl.rev = (tl.rev ?? 0) + 1
      syncLinkedAudio(tl)
    }
  }
  await saveProject()
  return { delta: { clips, ...(tl ? { timelines: [tl] } : {}) }, clipIds: clips.map((c) => c.id) }
}

// ONE clip from several images: each image becomes a beat's PLACEHOLDER GRAPHIC (display-only —
// no @mention, so the model keeps the ref loose) and every image rides along as a clip ref.
// Beat lengths split the default duration evenly.
export async function newClipFromImagesAsBeats(imageIds: string[]): Promise<{ delta: ProjectDelta; clipId: string } | null> {
  if (!current) return null
  const imgs = imageIds.map((id) => current!.images.find((i) => i.id === id)).filter((x): x is ProjImage => !!x)
  if (imgs.length === 0) return null
  const pd = emptyPromptData()
  pd.imageIds = imgs.map((i) => i.id)
  const dur = parseFloat(pd.duration) || 5
  const len = Math.max(0.5, Math.round((dur / imgs.length) * 10) / 10)
  pd.beats = imgs.map((im) => ({ id: randomUUID(), name: im.title.replace(/^@/, ''), length: len, camera: '', action: '', lighting: '', refImageId: im.id }))
  const base = `${imgs[0].title.replace(/^@/, '')} beats`
  let name = base
  for (let n = 2; current.clips.some((c) => c.name === name); n++) name = `${base} ${n}`
  const clip: Clip = { id: randomUUID(), name, promptData: pd, takes: [] }
  current.clips.push(clip)
  await saveProject()
  return { delta: { clips: [clip] }, clipId: clip.id }
}

// ----- delete / duplicate / folders (Premiere-style organize) -----
export async function deleteClips(clipIds: string[]): Promise<ProjectDelta | null> {
  if (!current) return null
  const doomed = new Set(clipIds)
  current.clips = current.clips.filter((c) => !doomed.has(c.id))
  // the clips also leave EVERY timeline they were placed on — audio lanes included (a detached
  // audio block can't outlive its source take's clip entry)
  const touched: Timeline[] = []
  for (const tl of current.timelines) {
    const hitItems = tl.items.some((it) => doomed.has(it.clipId))
    const hitAudio = (tl.audioItems ?? []).some((a) => 'clipId' in a.source && doomed.has(a.source.clipId))
    if (!hitItems && !hitAudio) continue
    if (hitItems) tl.items = tl.items.filter((it) => !doomed.has(it.clipId))
    if (hitAudio) tl.audioItems = (tl.audioItems ?? []).filter((a) => !('clipId' in a.source) || !doomed.has(a.source.clipId))
    tl.rev = (tl.rev ?? 0) + 1
    syncLinkedAudio(tl)
    touched.push(tl)
  }
  await saveProject()
  return { removedClipIds: clipIds, ...(touched.length ? { timelines: touched } : {}) }
}

export async function deleteClip(clipId: string): Promise<ProjectDelta | null> {
  return deleteClips([clipId])
}

export async function duplicateClip(clipId: string): Promise<{ delta: ProjectDelta; newClipId: string } | null> {
  if (!current) return null
  const src = current.clips.find((c) => c.id === clipId)
  if (!src) return null
  const idMap = new Map<string, string>()
  const takes: Take[] = src.takes.map((t) => {
    const nid = randomUUID()
    idMap.set(t.id, nid)
    return { ...t, id: nid }
  })
  const newClip: Clip = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    promptData: JSON.parse(JSON.stringify(src.promptData)) as PromptData,
    takes,
    keeperTakeId: src.keeperTakeId ? idMap.get(src.keeperTakeId) : undefined,
    folder: src.folder ?? null
  }
  current.clips.push(newClip)
  await saveProject()
  return { delta: { clips: [newClip] }, newClipId: newClip.id }
}

export async function deleteImages(imageIds: string[]): Promise<ProjectDelta | null> {
  if (!current) return null
  const doomed = new Set(imageIds)
  current.images = current.images.filter((i) => !doomed.has(i.id))
  const touched: Clip[] = []
  for (const c of current.clips) {
    const hadRef = (c.promptData.imageIds ?? []).some((id) => doomed.has(id))
    const wasEnd = !!c.promptData.endImageId && doomed.has(c.promptData.endImageId)
    if (!hadRef && !wasEnd) continue
    c.promptData.imageIds = (c.promptData.imageIds ?? []).filter((id) => !doomed.has(id))
    if (wasEnd) c.promptData.endImageId = undefined
    touched.push(c)
  }
  await saveProject() // files stay on disk in images/; the images' edit sessions are NOT touched
  return { removedImageIds: imageIds, ...(touched.length ? { clips: touched } : {}) }
}

export async function deleteImage(imageId: string): Promise<ProjectDelta | null> {
  return deleteImages([imageId])
}

export async function duplicateImage(imageId: string): Promise<{ delta: ProjectDelta; newId: string } | null> {
  if (!current) return null
  const src = current.images.find((i) => i.id === imageId)
  if (!src) return null
  const id = randomUUID()
  const ext = extname(src.file) || '.png'
  const destAbs = join(current.dir, 'images', id + ext)
  await copyFile(src.file, destAbs)
  const img: ProjImage = { id, title: nextImageTitle(), file: destAbs, folder: src.folder ?? null }
  current.images.push(img)
  await saveProject()
  return { delta: { images: [img] }, newId: id }
}

// ---- music: imported audio files (live in <project>/audio/) + per-timeline placement ----
export async function importAudioFiles(paths: string[]): Promise<{ delta: ProjectDelta; importedIds: string[] } | null> {
  if (!current) return null
  await mkdir(join(current.dir, 'audio'), { recursive: true })
  const added: ProjAudio[] = []
  for (const p of paths) {
    // dedup by ORIGIN (a.file is the post-copy destination — comparing it to the source never matched)
    if (current.audio.some((a) => a.srcPath === p || a.file === p)) continue
    const id = randomUUID()
    const ext = extname(p) || '.mp3'
    const destAbs = join(current.dir, 'audio', id + ext)
    try {
      await copyFile(p, destAbs)
    } catch (e) {
      console.error('[project] audio import failed:', e instanceof Error ? e.message : e)
      continue
    }
    const title = basename(p, extname(p)) || 'track'
    added.push({ id, title, file: destAbs, srcPath: p })
  }
  if (added.length === 0) return { delta: {}, importedIds: [] }
  current.audio.push(...added)
  await saveProject()
  return { delta: { audio: added }, importedIds: added.map((a) => a.id) }
}

export async function renameAudio(audioId: string, title: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const a = current.audio.find((x) => x.id === audioId)
  if (!a || !title.trim()) return null
  a.title = title.trim()
  await saveProject()
  return { audio: [a] }
}

// learned lazily by the renderer (first <audio> metadata load) — persists so the lane needs no re-probe
export async function setAudioDuration(audioId: string, durationSec: number): Promise<ProjectDelta | null> {
  if (!current) return null
  const a = current.audio.find((x) => x.id === audioId)
  if (!a || !(durationSec > 0) || a.durationSec === durationSec) return null
  a.durationSec = durationSec
  await saveProject()
  return { audio: [a] }
}

export async function deleteAudio(audioId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  current.audio = current.audio.filter((a) => a.id !== audioId)
  // any timeline using it loses its music (file stays on disk, per the delete convention)
  const touched: Timeline[] = []
  for (const tl of current.timelines) {
    if (tl.music?.audioId !== audioId) continue
    tl.music = undefined
    touched.push(tl)
  }
  // clips using it as an @audio ref drop that slot (LIVE recipes only — frozen take snapshots keep it)
  const touchedClips: Clip[] = []
  for (const c of current.clips) {
    const refs = c.promptData.audioRefs
    if (!refs?.some((r) => r.audioId === audioId)) continue
    const left = refs.filter((r) => r.audioId !== audioId)
    c.promptData.audioRefs = left.length ? left : undefined
    touchedClips.push(c)
  }
  await saveProject()
  return {
    removedAudioIds: [audioId],
    ...(touched.length ? { timelines: touched } : {}),
    ...(touchedClips.length ? { clips: touchedClips } : {})
  }
}

// ---- reference videos: imported files (live in <project>/videos/) used as Seedance @video refs ----
// Import normalizes anything that isn't already H.264 mp4 with its short side ≤720 (Electron
// playback + fal's ref limits). Titles are PLAIN (filename) — @video1-style names are reserved
// for ref-slot positions, and an @title here would collide with them.
export async function importVideoFiles(paths: string[]): Promise<{ delta: ProjectDelta; importedIds: string[]; failed: string[] } | null> {
  if (!current) return null
  await mkdir(join(current.dir, 'videos'), { recursive: true })
  const added: ProjVideo[] = []
  const failed: string[] = []
  for (const p of paths) {
    // dedup by ORIGIN (v.file is the post-copy destination — comparing it to the source never matched)
    if (current.videos.some((v) => v.srcPath === p || v.file === p)) continue
    const id = randomUUID()
    try {
      const probe = await probeVideo(p)
      if (!probe.codec) throw new Error('no video stream found')
      const friendly = probe.codec === 'h264' && extname(p).toLowerCase() === '.mp4' && Math.min(probe.width, probe.height) <= 720
      const destAbs = join(current.dir, 'videos', id + '.mp4')
      if (friendly) await copyFile(p, destAbs)
      else await normalizeVideo(p, destAbs)
      const title = basename(p, extname(p)) || 'video'
      added.push({ id, title, file: destAbs, srcPath: p, durationSec: probe.duration || undefined, ...(friendly ? {} : { transcoded: true }) })
    } catch (e) {
      console.error('[project] video import failed:', p, e instanceof Error ? e.message : e)
      failed.push(basename(p))
      continue
    }
  }
  if (added.length === 0) return { delta: {}, importedIds: [], failed }
  current.videos.push(...added)
  await saveProject()
  return { delta: { videos: added }, importedIds: added.map((v) => v.id), failed }
}

export async function renameVideo(videoId: string, title: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const v = current.videos.find((x) => x.id === videoId)
  if (!v || !title.trim()) return null
  v.title = title.trim()
  await saveProject()
  return { videos: [v] }
}

export async function deleteVideo(videoId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  current.videos = current.videos.filter((v) => v.id !== videoId)
  // clips using it as an @video ref drop that slot (LIVE recipes only — frozen take snapshots keep it)
  const touchedClips: Clip[] = []
  for (const c of current.clips) {
    const refs = c.promptData.videoRefs
    if (!refs?.some((r) => r.videoId === videoId)) continue
    const left = refs.filter((r) => r.videoId !== videoId)
    c.promptData.videoRefs = left.length ? left : undefined
    touchedClips.push(c)
  }
  await saveProject()
  return { removedVideoIds: [videoId], ...(touchedClips.length ? { clips: touchedClips } : {}) }
}

// ---- dynamic stills: LIVE first/last-frame images bound to timeline instances ----
// The image re-extracts itself whenever its instance's frame moves (trim/slice/take swap/undo);
// if the instance disappears, the binding is dropped and the image freezes as a normal static.
let deltaPush: ((d: ProjectDelta) => void) | null = null
export function setDeltaPush(fn: ((d: ProjectDelta) => void) | null): void {
  deltaPush = fn
}

// where an instance's first/last frame lives right now (null = no rendered take to grab from)
function dynamicFrameOf(item: TimelineItem, edge: 'first' | 'last'): { file: string; t: number } | null {
  if (!current) return null
  const clip = current.clips.find((c) => c.id === item.clipId)
  const take = clip ? resolveTake(clip, item) : undefined
  if (!clip || !take) return null
  const srcDur = take.durationSec ?? Math.max(0.3, parseFloat(clip.promptData.duration) || 5)
  const out = Math.min(item.outSec ?? srcDur, srcDur)
  const inn = Math.min(item.inSec ?? 0, Math.max(0, out - 0.05))
  return { file: take.file, t: edge === 'first' ? inn : Math.max(inn, out - 0.05) }
}

export async function addDynamicStill(
  itemId: string,
  edge: 'first' | 'last'
): Promise<{ delta: ProjectDelta; imageId: string } | null> {
  if (!current) return null
  let item: TimelineItem | undefined
  let owner: Timeline | undefined
  for (const tl of current.timelines) {
    item = tl.items.find((it) => it.id === itemId)
    if (item) {
      owner = tl
      break
    }
  }
  if (!item || !owner) return null
  const clip = current.clips.find((c) => c.id === item!.clipId)
  const src = dynamicFrameOf(item, edge)
  if (!clip || !src) return null
  const id = randomUUID()
  await mkdir(join(current.dir, 'images'), { recursive: true })
  const dest = join(current.dir, 'images', id + '.png')
  if (!(await extractFrame(src.file, src.t, dest))) return null
  // @clipname_N_first — N = which instance of this clip on its timeline (same clip placed twice
  // gets _1/_2), unique-suffixed if the title is somehow taken
  const ordinal = owner.items.filter((it) => it.clipId === clip.id).findIndex((it) => it.id === itemId) + 1
  const base = normalizeImageTitle(`${clip.name}_${ordinal}_${edge}`)
  let title = base
  for (let n = 2; current.images.some((i) => i.title === title); n++) title = `${base}_${n}`
  const img: ProjImage = {
    id,
    title,
    file: dest,
    genPrompt: `live ${edge} frame · ${clip.name} (instance ${ordinal})`,
    dynamic: { itemId, edge, sig: `${src.file}|${src.t.toFixed(3)}`, rev: 1 }
  }
  current.images.push(img)
  await saveProject()
  return { delta: { images: [img] }, imageId: id }
}

// slice support: the LAST-frame binding of a sliced instance follows the RIGHT half (per design —
// first frame of the first half stays put, last frame of the second half stays the true clip end)
// (remapDynamicStills removed — slice remaps its 'last' bindings atomically in sliceTimelineItem)

let reconcileTimer: ReturnType<typeof setTimeout> | null = null
let reconciling = false
export function scheduleDynamicReconcile(): void {
  if (!current?.images.some((i) => i.dynamic)) return
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    void reconcileDynamicStills()
  }, 400)
}

// re-extract every dynamic still whose source frame moved; freeze the ones whose instance is gone.
// The save it makes is a DERIVED write — kept out of the undo history (lastSnapshot updated so the
// next user action diffs against the reconciled state).
async function reconcileDynamicStills(): Promise<void> {
  if (!current || reconciling) return
  const bound = current.images.filter((i) => i.dynamic)
  if (bound.length === 0) return
  reconciling = true
  try {
    const changed: ProjImage[] = []
    for (const img of bound) {
      if (!current) break
      const d = img.dynamic!
      let item: TimelineItem | undefined
      for (const tl of current.timelines) {
        item = tl.items.find((it) => it.id === d.itemId)
        if (item) break
      }
      if (!item) {
        img.dynamic = undefined // instance removed → the image freezes as a normal static
        changed.push(img)
        continue
      }
      const src = dynamicFrameOf(item, d.edge)
      if (!src) continue // C/storyboard right now — keep the last frame; re-syncs when a take returns
      const sig = `${src.file}|${src.t.toFixed(3)}`
      if (d.sig === sig) {
        // signature current — but heal a still whose png never landed (the old extractor trusted
        // ffmpeg's exit code; a past-EOF seek exits 0 having written zero frames → ENOENT later)
        let broken = false
        try {
          broken = (await stat(img.file)).size <= 100
        } catch {
          broken = true // missing file entirely
        }
        if (!broken) continue
      }
      if (await extractFrame(src.file, src.t, img.file)) {
        d.sig = sig
        d.rev = (d.rev ?? 0) + 1
        changed.push(img)
      }
    }
    if (changed.length && current) {
      restoring = true // derived write: not an undo step
      const p = saveProject()
      restoring = false
      lastSnapshot = JSON.stringify(current)
      await p
      deltaPush?.({ images: changed.map((i) => ({ ...i })) })
    }
  } finally {
    reconciling = false
  }
}

export async function setTimelineMusic(timelineId: string, music: TimelineMusic | null): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (music && !current.audio.some((a) => a.id === music.audioId)) return null
  tl.music = music ?? undefined
  await saveProject()
  return { timelines: [tl] }
}

export async function setTimelineExportPrefs(
  timelineId: string,
  prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30'; exportQuality?: 'draft' | 'standard' | 'high' }
): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (prefs.exportRes) tl.exportRes = prefs.exportRes
  if (prefs.exportFps) tl.exportFps = prefs.exportFps
  if (prefs.exportQuality) tl.exportQuality = prefs.exportQuality
  await saveProject()
  return { timelines: [tl] }
}

export async function setTimelineMutes(
  timelineId: string,
  mutes: { videoMuted?: boolean; musicMuted?: boolean }
): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (typeof mutes.videoMuted === 'boolean') tl.videoMuted = mutes.videoMuted
  if (typeof mutes.musicMuted === 'boolean') tl.musicMuted = mutes.musicMuted
  await saveProject()
  return { timelines: [tl] }
}

// (setItemFx — the v16 fixed-field fx sanitizer — is DELETED. EFFECTS v2 stacks persist
// VERBATIM through timeline:set; the renderer validates on read and clamps at draw time.
// The old whitelist here would have silently stripped a v2 stack to {}.)

export async function renameImage(imageId: string, title: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const i = current.images.find((x) => x.id === imageId)
  if (!i) return null
  const t = normalizeImageTitle(title)
  if (!t) return null
  const old = i.title
  if (t === old) return null
  // GUARD: @titles must stay unique — a duplicate would make every @mention of it ambiguous
  if (current.images.some((x) => x.id !== imageId && x.title === t)) return null
  i.title = t

  // a rename is identity-preserving: rewrite @old → @new in EVERY prompt text that mentions it —
  // clip recipes AND frozen take snapshots (their text resolves beat thumbs; same prompt, new name).
  // '(?!\w)' word boundary so @image1 can never eat @image10.
  const pattern = new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'g')
  const sub = (s: string): string => s.replace(pattern, t)
  const rewritePromptData = (pd: PromptData): boolean => {
    let hit = false
    const swap = (s: string): string => {
      const r = sub(s)
      if (r !== s) hit = true
      return r
    }
    pd.freeform = swap(pd.freeform)
    pd.scene.referenceHandling = swap(pd.scene.referenceHandling)
    for (const ch of pd.characters) ch.referenceLabel = swap(ch.referenceLabel)
    for (const b of pd.beats) {
      b.camera = swap(b.camera)
      b.action = swap(b.action)
      b.lighting = swap(b.lighting)
      if (b.dialogue) b.dialogue = swap(b.dialogue)
      if (b.vfx) b.vfx = swap(b.vfx)
      if (b.reaction) b.reaction = swap(b.reaction)
      if (b.sfx) b.sfx = swap(b.sfx)
    }
    return hit
  }
  const touched: Clip[] = []
  for (const c of current.clips) {
    let hit = rewritePromptData(c.promptData)
    for (const take of c.takes) if (take.snapshot && rewritePromptData(take.snapshot)) hit = true
    if (hit) touched.push(c)
  }

  await saveProject()
  return { images: [i], ...(touched.length ? { clips: touched } : {}) }
}

export async function addFolder(
  kind: Folder['kind'],
  name: string,
  parent: string | null
): Promise<{ delta: ProjectDelta; folderId: string } | null> {
  if (!current) return null
  const folder: Folder = { id: randomUUID(), name: name.trim() || 'New Folder', parent: parent ?? null, kind }
  current.folders = [...(current.folders ?? []), folder]
  await saveProject()
  return { delta: { folders: current.folders }, folderId: folder.id }
}

export async function renameFolder(id: string, name: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const f = (current.folders ?? []).find((x) => x.id === id)
  if (!f) return null
  f.name = name.trim() || f.name
  await saveProject()
  return { folders: current.folders }
}

export async function deleteFolder(id: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const f = (current.folders ?? []).find((x) => x.id === id)
  if (!f) return { folders: current.folders }
  const np = f.parent ?? null // reparent contents to this folder's parent — never destroys items
  const touchedClips: Clip[] = []
  const touchedImages: ProjImage[] = []
  const touchedSheets: CharSheet[] = []
  const touchedScores: ScoreClip[] = []
  for (const cf of current.folders) if (cf.parent === id) cf.parent = np
  if (f.kind === 'bin') {
    for (const c of current.clips)
      if ((c.folder ?? null) === id) {
        c.folder = np
        touchedClips.push(c)
      }
  } else if (f.kind === 'lib') {
    for (const im of current.images)
      if ((im.folder ?? null) === id) {
        im.folder = np
        touchedImages.push(im)
      }
  } else if (f.kind === 'score') {
    for (const sc of current.scoreClips ?? [])
      if ((sc.folder ?? null) === id) {
        sc.folder = np
        touchedScores.push(sc)
      }
  } else {
    for (const sh of current.charSheets ?? [])
      if ((sh.folder ?? null) === id) {
        sh.folder = np
        touchedSheets.push(sh)
      }
  }
  current.folders = current.folders.filter((x) => x.id !== id)
  await saveProject()
  return {
    folders: current.folders,
    ...(touchedClips.length ? { clips: touchedClips } : {}),
    ...(touchedImages.length ? { images: touchedImages } : {}),
    ...(touchedSheets.length ? { charSheets: touchedSheets } : {}),
    ...(touchedScores.length ? { scoreClips: touchedScores } : {})
  }
}

// ----- image editor: persisted results tree (generate → pick → tag to Library) -----

// append freshly generated images as child nodes of `parentId` (null = the root image itself);
// creates the session on first generation for that root
export async function appendEditNodes(opts: {
  rootImageId: string
  parentId: string | null
  files: string[]
  prompt: string
  seed?: number
  refIds: string[]
}): Promise<{ delta: ProjectDelta; nodeIds: string[] } | null> {
  if (!current) return null
  let session = current.editSessions.find((s) => s.rootImageId === opts.rootImageId)
  if (!session) {
    session = { id: randomUUID(), rootImageId: opts.rootImageId, nodes: [] }
    current.editSessions.push(session)
  }
  const nodes: EditNode[] = opts.files.map((file) => ({
    id: randomUUID(),
    parentId: opts.parentId,
    file,
    prompt: opts.prompt,
    seed: opts.seed,
    refIds: opts.refIds,
    createdAt: Date.now()
  }))
  session.nodes.push(...nodes)
  await saveProject()
  return { delta: { editSessions: [session] }, nodeIds: nodes.map((n) => n.id) }
}

// TAG a node → it becomes a real Library image (file COPIED into images/ so pruning the branch
// later never breaks the Library); lineage recorded on the new image
export async function tagEditNode(sessionId: string, nodeId: string): Promise<{ delta: ProjectDelta; imageId: string } | null> {
  if (!current) return null
  const session = current.editSessions.find((s) => s.id === sessionId)
  const node = session?.nodes.find((n) => n.id === nodeId)
  if (!session || !node) return null
  if (node.keptImageId && current.images.some((i) => i.id === node.keptImageId))
    return { delta: {}, imageId: node.keptImageId } // already tagged
  const id = randomUUID()
  const dest = join(current.dir, 'images', id + (extname(node.file) || '.png'))
  await copyFile(node.file, dest)
  const img: ProjImage = {
    id,
    title: nextImageTitle(),
    file: dest,
    editedFrom: session.rootImageId || undefined,
    genPrompt: node.prompt
  }
  current.images.push(img)
  node.keptImageId = id
  await saveProject()
  return { delta: { images: [img], editSessions: [session] }, imageId: id }
}

// delete a node AND all its descendants; their files go too (tagged Library copies survive)
// make a tree node's render the PRIMARY face of the root image (nodeId null = revert to original).
// The image's file POINTS at the node's render — clips reference images by id and resolve the file
// at display/render time, so every usage updates automatically. Branch + renders stay untouched.
export async function setPrimaryNode(sessionId: string, nodeId: string | null): Promise<ProjectDelta | null> {
  if (!current) return null
  const session = current.editSessions.find((s) => s.id === sessionId)
  if (!session || !session.rootImageId) return null // from-scratch sessions have no root image to re-face
  const img = current.images.find((i) => i.id === session.rootImageId)
  if (!img) return null
  if (nodeId) {
    const node = session.nodes.find((n) => n.id === nodeId)
    if (!node) return null
    if (!session.originalFile) session.originalFile = img.file // remember the true original ONCE
    img.file = node.file
    session.primaryNodeId = nodeId
  } else {
    if (session.originalFile) img.file = session.originalFile
    session.primaryNodeId = undefined
  }
  await saveProject()
  return { images: [img], editSessions: [session] }
}

// save a LOCALLY-computed edit (the crop tool's baked PNG) as a tree node — same shape as a
// generated node, but no model call. When the session has a root image the node is also made
// PRIMARY in the same save (the whole point of cropping is fixing the image in place), so the
// crop + face-swap revert together as ONE undo step.
export async function saveLocalEditNode(opts: {
  rootImageId: string
  parentId: string | null
  bytes: Uint8Array
  label: string
}): Promise<{ delta: ProjectDelta; nodeId: string } | null> {
  if (!current) return null
  await mkdir(join(current.dir, 'images', 'edits'), { recursive: true })
  const nodeId = randomUUID()
  const file = join(current.dir, 'images', 'edits', nodeId + '.png')
  await writeFile(file, Buffer.from(opts.bytes))
  let session = current.editSessions.find((s) => s.rootImageId === opts.rootImageId)
  if (!session) {
    session = { id: randomUUID(), rootImageId: opts.rootImageId, nodes: [] }
    current.editSessions.push(session)
  }
  const node: EditNode = {
    id: nodeId,
    parentId: opts.parentId,
    file,
    prompt: opts.label,
    refIds: [],
    createdAt: Date.now()
  }
  session.nodes.push(node)
  const img = session.rootImageId ? current.images.find((i) => i.id === session!.rootImageId) : undefined
  if (img) {
    if (!session.originalFile) session.originalFile = img.file // remember the true original ONCE
    img.file = node.file
    session.primaryNodeId = node.id
  }
  await saveProject()
  return { delta: { editSessions: [session], ...(img ? { images: [img] } : {}) }, nodeId }
}

// ---- video editor sessions (v2v result trees) — the video siblings of the image ops above ----

// find-or-create the session for a source (a Library video OR a take — matched exactly)
function videoSessionFor(root: { videoId?: string; takeRef?: { clipId: string; takeId: string } }): VideoEditSession {
  if (!current) throw new Error('no project')
  let s = current.videoEditSessions.find((x) =>
    root.videoId ? x.rootVideoId === root.videoId : x.rootTake?.clipId === root.takeRef?.clipId && x.rootTake?.takeId === root.takeRef?.takeId
  )
  if (!s) {
    s = { id: randomUUID(), ...(root.videoId ? { rootVideoId: root.videoId } : { rootTake: root.takeRef }), nodes: [] }
    current.videoEditSessions.push(s)
  }
  return s
}

export async function appendVideoEditNode(opts: {
  root: { videoId?: string; takeRef?: { clipId: string; takeId: string } }
  parentId: string | null
  file: string
  prompt: string
  engine: EngineId
  inSec?: number
  outSec?: number
  refSummary?: string
  durationSec?: number
  imageRefIds?: string[]
  videoRefs?: import('../shared/types').VideoRef[]
  audioRefs?: import('../shared/types').AudioRef[]
  duration?: string
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
}): Promise<{ delta: ProjectDelta; nodeId: string } | null> {
  if (!current) return null
  const session = videoSessionFor(opts.root)
  const node: VideoEditNode = {
    id: randomUUID(),
    parentId: opts.parentId,
    file: opts.file,
    prompt: opts.prompt,
    engine: opts.engine,
    inSec: opts.inSec,
    outSec: opts.outSec,
    refSummary: opts.refSummary,
    durationSec: opts.durationSec,
    createdAt: Date.now(),
    // frozen recipe (re-gen only) — sparse keys keep project.json lean
    ...(opts.imageRefIds?.length ? { imageRefIds: opts.imageRefIds } : {}),
    ...(opts.videoRefs?.length ? { videoRefs: opts.videoRefs } : {}),
    ...(opts.audioRefs?.length ? { audioRefs: opts.audioRefs } : {}),
    ...(opts.duration ? { duration: opts.duration } : {}),
    ...(opts.resolution ? { resolution: opts.resolution } : {}),
    ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
    ...(opts.generateAudio != null ? { generateAudio: opts.generateAudio } : {})
  }
  session.nodes.push(node)
  await saveProject()
  return { delta: { videoEditSessions: [session] }, nodeId: node.id }
}

// BAKE a node → a real Library video (file COPIED into videos/ so pruning the branch later never
// breaks the Library); plain title, lineage-free like any import
export async function bakeVideoNodeToLibrary(sessionId: string, nodeId: string): Promise<{ delta: ProjectDelta; videoId: string } | null> {
  if (!current) return null
  const session = current.videoEditSessions.find((s) => s.id === sessionId)
  const node = session?.nodes.find((n) => n.id === nodeId)
  if (!session || !node) return null
  if (node.keptVideoId && current.videos.some((v) => v.id === node.keptVideoId))
    return { delta: {}, videoId: node.keptVideoId } // already baked
  await mkdir(join(current.dir, 'videos'), { recursive: true })
  const id = randomUUID()
  const dest = join(current.dir, 'videos', id + '.mp4')
  await copyFile(node.file, dest)
  const srcName = session.rootVideoId
    ? current.videos.find((v) => v.id === session.rootVideoId)?.title
    : current.clips.find((c) => c.id === session.rootTake?.clipId)?.name
  const vid: ProjVideo = { id, title: `${srcName ?? 'video'} · edit`, file: dest, durationSec: node.durationSec }
  current.videos.push(vid)
  node.keptVideoId = id
  await saveProject()
  return { delta: { videos: [vid], videoEditSessions: [session] }, videoId: id }
}

// BAKE a node → a take: on an existing clip, or a NEW footage-first clip named after the source.
// The take's frozen snapshot records the edit lineage (engine + prompt + source) — inspectable forever.
export async function bakeVideoNodeToClip(
  sessionId: string,
  nodeId: string,
  target: { clipId?: string; newClipName?: string }
): Promise<{ delta: ProjectDelta; clipId: string; takeId: string } | null> {
  if (!current) return null
  const session = current.videoEditSessions.find((s) => s.id === sessionId)
  const node = session?.nodes.find((n) => n.id === nodeId)
  if (!session || !node || !existsSync(node.file)) return null
  await mkdir(join(current.dir, 'renders'), { recursive: true })
  const dest = join(current.dir, 'renders', `vedit_${randomUUID()}.mp4`)
  await copyFile(node.file, dest)
  const srcClip = session.rootTake ? current.clips.find((c) => c.id === session.rootTake!.clipId) : undefined
  const promptData: PromptData = {
    ...emptyPromptData(),
    engine: node.engine,
    mode: 'v2v',
    freeform: node.prompt,
    duration: String(Math.max(1, Math.round(node.durationSec ?? (node.outSec != null && node.inSec != null ? node.outSec - node.inSec : 5)))),
    // the node's frozen recipe rides into the take snapshot — baked takes stay fully re-runnable
    ...(node.imageRefIds?.length ? { imageIds: node.imageRefIds } : {}),
    ...(node.videoRefs?.length ? { videoRefs: node.videoRefs } : {}),
    ...(node.audioRefs?.length ? { audioRefs: node.audioRefs } : {}),
    ...(node.resolution ? { resolution: node.resolution } : {}),
    ...(node.aspectRatio ? { aspectRatio: node.aspectRatio } : {}),
    ...(node.generateAudio != null ? { generateAudio: node.generateAudio } : {}),
    ...(session.rootTake && srcClip
      ? {
          sourceVideo: {
            clipId: session.rootTake.clipId,
            takeId: session.rootTake.takeId,
            file: relative(current.dir, srcClip.takes.find((t) => t.id === session.rootTake!.takeId)?.file ?? ''),
            ...(node.inSec != null ? { inSec: node.inSec } : {}),
            ...(node.outSec != null ? { outSec: node.outSec } : {})
          }
        }
      : {})
  }
  const name =
    target.newClipName?.trim() ||
    (session.rootVideoId ? `${current.videos.find((v) => v.id === session.rootVideoId)?.title ?? 'video'} · edit` : `${srcClip?.name ?? 'video'} · edit`)
  const r = await addTake({ clipId: target.clipId, name, promptData, takeFile: dest, durationSec: node.durationSec })
  return { delta: r.delta, clipId: r.clipId, takeId: r.takeId }
}

// make a tree node's render the PRIMARY face of a LIBRARY-VIDEO root (nodeId null = revert).
// @video refs resolve the file by id at render time, so every use updates automatically.
// Take-rooted sessions have no primary — takes are immutable records (bake instead).
export async function setVideoPrimaryNode(sessionId: string, nodeId: string | null): Promise<ProjectDelta | null> {
  if (!current) return null
  const session = current.videoEditSessions.find((s) => s.id === sessionId)
  if (!session || !session.rootVideoId) return null
  const vid = current.videos.find((v) => v.id === session.rootVideoId)
  if (!vid) return null
  if (nodeId) {
    const node = session.nodes.find((n) => n.id === nodeId)
    if (!node) return null
    if (!session.originalFile) session.originalFile = vid.file // remember the true original ONCE
    vid.file = node.file
    if (node.durationSec) vid.durationSec = node.durationSec
    session.primaryNodeId = nodeId
  } else {
    if (session.originalFile) vid.file = session.originalFile
    session.primaryNodeId = undefined
  }
  await saveProject()
  return { videos: [vid], videoEditSessions: [session] }
}

// delete a node AND all its descendants; their files go too (baked Library/take copies survive)
export async function deleteVideoEditBranch(sessionId: string, nodeId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const session = current.videoEditSessions.find((s) => s.id === sessionId)
  if (!session) return null
  const doomed = new Set<string>([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of session.nodes)
      if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
        doomed.add(n.id)
        grew = true
      }
  }
  // the primary version's file IS the root video's current face — its branch can't go
  if (session.primaryNodeId && doomed.has(session.primaryNodeId)) return null
  const goners = session.nodes.filter((n) => doomed.has(n.id))
  session.nodes = session.nodes.filter((n) => !doomed.has(n.id))
  for (const n of goners) {
    try {
      await unlink(n.file)
    } catch {
      /* file already gone — fine */
    }
  }
  await saveProject()
  return { videoEditSessions: [session] }
}

// make a NEW footage-first clip from a Library video (video copied in as take 1, keeper)
export async function makeClipFromVideo(videoId: string): Promise<{ delta: ProjectDelta; clipId: string } | null> {
  if (!current) return null
  const v = current.videos.find((x) => x.id === videoId)
  if (!v || !existsSync(v.file)) return null
  const clip: Clip = { id: randomUUID(), name: v.title, promptData: { ...emptyPromptData() }, takes: [] }
  current.clips.push(clip)
  const r = await addTakeFromFile(clip.id, v.file)
  if (!r) {
    current.clips = current.clips.filter((c) => c.id !== clip.id)
    return null
  }
  const t = clip.takes.find((x) => x.id === r.takeId)
  if (t && v.durationSec) t.durationSec = v.durationSec
  await saveProject()
  return { delta: { clips: [clip] }, clipId: clip.id }
}

export async function deleteEditBranch(sessionId: string, nodeId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const session = current.editSessions.find((s) => s.id === sessionId)
  if (!session) return null
  const doomed = new Set<string>([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of session.nodes)
      if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
        doomed.add(n.id)
        grew = true
      }
  }
  // GUARD: the primary version's file IS the root image's current face — deleting its branch would
  // kill that file. The UI blocks this with a message; this is the backstop.
  if (session.primaryNodeId && doomed.has(session.primaryNodeId)) return null
  const goners = session.nodes.filter((n) => doomed.has(n.id))
  session.nodes = session.nodes.filter((n) => !doomed.has(n.id))
  for (const n of goners) {
    try {
      await unlink(n.file)
    } catch {
      /* file already gone — fine */
    }
  }
  await saveProject()
  return { editSessions: [session] }
}

// ----- cross-project clip import: every project folder is a browsable, self-contained library -----

// light cards for the Open picker: each recent project's REAL name (from its project.json), a small
// thumbnail (first library image that still exists) and counts. Unreadable dirs are skipped.
export async function peekRecentCards(
  dirs: string[]
): Promise<{ dir: string; name: string; thumb?: string; clips: number; images: number }[]> {
  const out: { dir: string; name: string; thumb?: string; clips: number; images: number }[] = []
  for (const dir of dirs) {
    const p = await readProjectData(dir)
    if (!p) continue
    let thumb: string | undefined
    const first = p.images.find((i) => existsSync(i.file))
    if (first) {
      try {
        const buf = await readFile(first.file)
        if (buf.byteLength <= 4 * 1024 * 1024) {
          const ext = extname(first.file).toLowerCase()
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
          thumb = `data:${mime};base64,${buf.toString('base64')}`
        }
      } catch {
        /* thumb is optional */
      }
    }
    out.push({ dir: p.dir, name: p.name, thumb, clips: p.clips.length, images: p.images.length })
  }
  return out
}

// list another project's clips (with small thumbnails) for the import picker
export async function peekProject(dir: string): Promise<import('../shared/types').PeekProject | null> {
  const src = await readProjectData(dir)
  if (!src) return null
  const clips = await Promise.all(
    src.clips.map(async (c) => {
      let thumb: string | undefined
      const firstImg = src.images.find((i) => i.id === c.promptData.imageIds?.[0])
      if (firstImg && existsSync(firstImg.file)) {
        try {
          const buf = await readFile(firstImg.file)
          if (buf.byteLength <= 4 * 1024 * 1024) {
            const ext = extname(firstImg.file).toLowerCase()
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
            thumb = `data:${mime};base64,${buf.toString('base64')}`
          }
        } catch {
          /* thumb is optional */
        }
      }
      return {
        id: c.id,
        name: c.name,
        takes: c.takes.length,
        duration: c.promptData.duration,
        beats: c.promptData.beats?.length ?? 0,
        engine: c.promptData.engine,
        thumb
      }
    })
  )
  return { dir: src.dir, name: src.name, clips }
}

// ----- ONE copy engine, two directions: Import PULLS (src = foreign, dest = current), Send PUSHES
// (src = current, dest = a loaded foreign project). Everything is COPIED (projects stay
// self-contained); ids re-mint so the same asset can ride twice; colliding @titles get a _N suffix
// with all text references rewritten; missing files are skipped and REPORTED (never silent). -----
function makeAssetCopier(src: Project, dest: Project): {
  newImages: ProjImage[]
  newAudio: ProjAudio[]
  newVideos: ProjVideo[]
  newClips: Clip[]
  newSheets: CharSheet[]
  newTimelines: Timeline[]
  skipped: string[]
  mintClips: (ids: string[]) => Clip[]
  mintSheets: (ids: string[]) => CharSheet[]
  ensureImage: (srcId: string | undefined) => Promise<string | undefined>
  ensureAudio: (srcId: string | undefined) => Promise<string | undefined>
  copyClip: (c: Clip) => Promise<Clip>
  copySheet: (sh: CharSheet) => Promise<CharSheet>
  copyTimeline: (tl: Timeline) => Promise<Timeline>
  commit: () => void
} {
  const newImages: ProjImage[] = []
  const newAudio: ProjAudio[] = []
  const newVideos: ProjVideo[] = []
  const newClips: Clip[] = []
  const newSheets: CharSheet[] = []
  const newTimelines: Timeline[] = []
  const skipped: string[] = [] // human-readable "didn't make it" lines — ride to the toast
  const imgMap = new Map<string, string>() // source id → copied id ('' = known-dead, noted once)
  const audMap = new Map<string, string>()
  const vidMap = new Map<string, string>()
  const clipIdMap = new Map<string, string>() // PRE-minted (mintClips) so intra-batch refs remap in any copy order
  const takeIdMaps = new Map<string, Map<string, string>>() // source clip id → (source take id → new take id)
  const sheetIdMap = new Map<string, string>()
  const titleRewrites: Array<[string, string]> = [] // renamed @titles (collisions) → rewrite text refs

  const madeDirs = new Set<string>()
  const ensureDir = async (sub: string): Promise<void> => {
    if (madeDirs.has(sub)) return
    await mkdir(join(dest.dir, sub), { recursive: true })
    madeDirs.add(sub)
  }

  // plain-title collision (audio / Library videos / timelines — flat rows, no @refs): tag with the
  // source project's name, then number
  const plainTitle = (want: string, taken: (t: string) => boolean): string => {
    if (!taken(want)) return want
    const tagged = `${want} (from ${src.name})`
    if (!taken(tagged)) return tagged
    let n = 2
    while (taken(`${tagged} ${n}`)) n++
    return `${tagged} ${n}`
  }

  const ensureImage = async (srcId: string | undefined): Promise<string | undefined> => {
    if (!srcId) return undefined
    if (imgMap.has(srcId)) return imgMap.get(srcId) || undefined
    const srcImg = src.images.find((i) => i.id === srcId)
    if (!srcImg || !existsSync(srcImg.file)) {
      imgMap.set(srcId, '')
      if (srcImg) skipped.push(`image ${srcImg.title} — file missing`)
      return undefined
    }
    await ensureDir('images')
    const newId = randomUUID()
    const destFile = join(dest.dir, 'images', newId + (extname(srcImg.file) || '.png'))
    await copyFile(srcImg.file, destFile)
    let title = srcImg.title
    const taken = (t: string): boolean => dest.images.some((i) => i.title === t) || newImages.some((i) => i.title === t)
    if (taken(title)) {
      let n = 2
      while (taken(`${title}_${n}`)) n++
      titleRewrites.push([title, `${title}_${n}`])
      title = `${title}_${n}`
    }
    newImages.push({ id: newId, title, file: destFile }) // lineage/dynamic/folder deliberately shed — a fresh standalone image
    imgMap.set(srcId, newId)
    return newId
  }

  const ensureAudio = async (srcId: string | undefined): Promise<string | undefined> => {
    if (!srcId) return undefined
    if (audMap.has(srcId)) return audMap.get(srcId) || undefined
    const a = src.audio.find((x) => x.id === srcId)
    if (!a || !existsSync(a.file)) {
      audMap.set(srcId, '')
      if (a) skipped.push(`music ${a.title} — file missing`)
      return undefined
    }
    await ensureDir('audio')
    const newId = randomUUID()
    const destFile = join(dest.dir, 'audio', newId + (extname(a.file) || '.mp3'))
    await copyFile(a.file, destFile)
    const taken = (t: string): boolean => dest.audio.some((x) => x.title === t) || newAudio.some((x) => x.title === t)
    newAudio.push({ id: newId, title: plainTitle(a.title, taken), file: destFile, ...(a.durationSec != null ? { durationSec: a.durationSec } : {}) })
    audMap.set(srcId, newId)
    return newId
  }

  const ensureVideo = async (srcId: string | undefined): Promise<string | undefined> => {
    if (!srcId) return undefined
    if (vidMap.has(srcId)) return vidMap.get(srcId) || undefined
    const v = src.videos.find((x) => x.id === srcId)
    if (!v || !existsSync(v.file)) {
      vidMap.set(srcId, '')
      if (v) skipped.push(`video ${v.title} — file missing`)
      return undefined
    }
    await ensureDir('videos')
    const newId = randomUUID()
    const destFile = join(dest.dir, 'videos', newId + (extname(v.file) || '.mp4'))
    await copyFile(v.file, destFile)
    const taken = (t: string): boolean => dest.videos.some((x) => x.title === t) || newVideos.some((x) => x.title === t)
    newVideos.push({
      id: newId,
      title: plainTitle(v.title, taken),
      file: destFile,
      ...(v.durationSec != null ? { durationSec: v.durationSec } : {}),
      ...(v.transcoded ? { transcoded: true } : {})
    })
    vidMap.set(srcId, newId)
    return newId
  }

  // rewrite renamed @titles inside prompt/beat/character text ('(?!\\w)' so @image1 can't eat @image10)
  const rewrite = (s: string): string =>
    titleRewrites.reduce(
      (acc, [from, to]) => acc.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'g'), to),
      s
    )

  // clip-id-shaped refs (promptLink / fieldLinks / characterLinks): remap when the target rides in
  // the same batch; otherwise ride verbatim — the model is dangling-tolerant by design
  const remapRefId = (id: string): string => clipIdMap.get(id) ?? sheetIdMap.get(id) ?? id

  // v2v pins: the source project's clip/take ids mean nothing here — copy the pinned source video
  // into renders/ and keep only the file pin (Clip Edit + edit:run fall back to it when the ids
  // don't resolve). One copy per distinct source file, even across recipe + take snapshots.
  const svMap = new Map<string, string>() // source-relative path → destination-relative path
  const remapSourceVideo = async (sv: NonNullable<PromptData['sourceVideo']>): Promise<PromptData['sourceVideo']> => {
    const known = svMap.get(sv.file)
    if (known != null) return { ...sv, clipId: '', takeId: '', file: known }
    const abs = join(src.dir, sv.file)
    let destRel = ''
    if (sv.file && existsSync(abs)) {
      await ensureDir('renders')
      const destFile = join(dest.dir, 'renders', `import_${randomUUID()}${extname(abs) || '.mp4'}`)
      await copyFile(abs, destFile)
      destRel = relative(dest.dir, destFile)
    }
    svMap.set(sv.file, destRel)
    return { ...sv, clipId: '', takeId: '', file: destRel }
  }

  const remapVideoRef = async (vr: VideoRef): Promise<VideoRef> => {
    if (vr.videoId) {
      const nid = await ensureVideo(vr.videoId)
      return nid ? { ...vr, videoId: nid } : { ...vr } // dead file → slot rides verbatim (dangles; lint shows it)
    }
    if (vr.takeRef) {
      const nc = clipIdMap.get(vr.takeRef.clipId)
      if (!nc) return { ...vr } // that clip isn't in this batch — dangling ref, slot POSITION preserved
      const nt = takeIdMaps.get(vr.takeRef.clipId)?.get(vr.takeRef.takeId)
      return { ...vr, takeRef: { clipId: nc, takeId: nt ?? vr.takeRef.takeId } }
    }
    return { ...vr }
  }

  const remapPromptData = async (pd: PromptData): Promise<PromptData> => {
    const out = JSON.parse(JSON.stringify(pd)) as PromptData
    const ids: string[] = []
    for (const id of out.imageIds ?? []) {
      const nid = await ensureImage(id)
      if (nid) ids.push(nid)
    }
    out.imageIds = ids
    out.endImageId = await ensureImage(out.endImageId)
    if (out.sourceVideo) out.sourceVideo = await remapSourceVideo(out.sourceVideo)
    if (out.videoRefs?.length) {
      const vrs: VideoRef[] = []
      for (const vr of out.videoRefs) vrs.push(await remapVideoRef(vr))
      out.videoRefs = vrs
    }
    if (out.audioRefs?.length) {
      const ars: AudioRef[] = []
      for (const ar of out.audioRefs) {
        const nid = await ensureAudio(ar.audioId)
        ars.push(nid ? { ...ar, audioId: nid } : { ...ar })
      }
      out.audioRefs = ars
    }
    if (out.promptLink) out.promptLink = { ...out.promptLink, clipId: remapRefId(out.promptLink.clipId) }
    if (out.fieldLinks) {
      const fl: Record<string, string[]> = {}
      for (const [path, stack] of Object.entries(out.fieldLinks)) fl[path] = stack.map(remapRefId)
      out.fieldLinks = fl
    }
    if (out.characterLinks) out.characterLinks = out.characterLinks.map((cl) => ({ ...cl, clipId: remapRefId(cl.clipId) }))
    out.freeform = rewrite(out.freeform)
    out.scene.referenceHandling = rewrite(out.scene.referenceHandling)
    out.characters = out.characters.map((c) => ({ ...c, referenceLabel: rewrite(c.referenceLabel) }))
    out.beats = out.beats.map((b) => ({
      ...b,
      camera: rewrite(b.camera),
      action: rewrite(b.action),
      lighting: rewrite(b.lighting),
      dialogue: b.dialogue ? rewrite(b.dialogue) : b.dialogue,
      vfx: b.vfx ? rewrite(b.vfx) : b.vfx,
      reaction: b.reaction ? rewrite(b.reaction) : b.reaction,
      sfx: b.sfx ? rewrite(b.sfx) : b.sfx
    }))
    return out
  }

  // pre-mint ids for every clip/sheet in the batch BEFORE copying — intra-batch references
  // (timeline items, videoRef takeRefs, characterLinks) then remap regardless of copy order
  const mintClips = (ids: string[]): Clip[] => {
    const found: Clip[] = []
    for (const id of ids) {
      if (clipIdMap.has(id)) continue
      const c = src.clips.find((x) => x.id === id)
      if (!c) continue
      clipIdMap.set(c.id, randomUUID())
      const tm = new Map<string, string>()
      for (const t of c.takes) if (existsSync(t.file)) tm.set(t.id, randomUUID())
      takeIdMaps.set(c.id, tm)
      found.push(c)
    }
    return found
  }
  const mintSheets = (ids: string[]): CharSheet[] => {
    const found: CharSheet[] = []
    for (const id of ids) {
      if (sheetIdMap.has(id)) continue
      const sh = (src.charSheets ?? []).find((x) => x.id === id)
      if (!sh) continue
      sheetIdMap.set(sh.id, randomUUID())
      found.push(sh)
    }
    return found
  }

  const copyClip = async (c: Clip): Promise<Clip> => {
    const tm = takeIdMaps.get(c.id) ?? new Map<string, string>()
    const newClip: Clip = {
      id: clipIdMap.get(c.id) ?? randomUUID(),
      name: c.name,
      promptData: await remapPromptData(c.promptData),
      takes: [],
      folder: null
    }
    const sb = await ensureImage(c.storyboardImageId)
    if (sb) newClip.storyboardImageId = sb
    for (const t of c.takes) {
      const nid = tm.get(t.id)
      if (!nid || !existsSync(t.file)) {
        skipped.push(`take of "${c.name}" — file missing`)
        continue // render file lost — skip the take, keep the rest
      }
      await ensureDir('renders')
      const destFile = join(dest.dir, 'renders', `import_${nid}${extname(t.file) || '.mp4'}`)
      await copyFile(t.file, destFile)
      // AI sidecar passes live NEXT TO the take file (<file>.matte.mp4 / .depth.mp4) — ride along
      // so fx depth/matte modules don't silently re-run their pass in the destination
      for (const side of ['.matte.mp4', '.depth.mp4']) {
        if (existsSync(t.file + side)) await copyFile(t.file + side, destFile + side)
      }
      newClip.takes.push({
        ...t,
        id: nid,
        file: destFile,
        snapshot: t.snapshot ? await remapPromptData(t.snapshot) : undefined
      })
      if (t.id === c.keeperTakeId) newClip.keeperTakeId = nid
    }
    if (!newClip.keeperTakeId && newClip.takes.length) newClip.keeperTakeId = newClip.takes[newClip.takes.length - 1].id
    newClips.push(newClip)
    return newClip
  }

  const copySheet = async (sh: CharSheet): Promise<CharSheet> => {
    const img = await ensureImage(sh.imageId) // dead image: sheet still sends, skip already noted
    const out: CharSheet = {
      id: sheetIdMap.get(sh.id) ?? randomUUID(),
      name: sh.name,
      character: { ...(JSON.parse(JSON.stringify(sh.character)) as CharacterField), referenceLabel: rewrite(sh.character.referenceLabel) },
      ...(img ? { imageId: img } : {}),
      folder: null
    }
    newSheets.push(out)
    return out
  }

  const copyTimeline = async (tl: Timeline): Promise<Timeline> => {
    const clone = JSON.parse(JSON.stringify(tl)) as Timeline
    const itemIdMap = new Map<string, string>()
    for (const it of clone.items) itemIdMap.set(it.id, randomUUID())
    const audioItemIdMap = new Map<string, string>()
    for (const a of clone.audioItems ?? []) audioItemIdMap.set(a.id, randomUUID())
    clone.id = randomUUID()
    const taken = (t: string): boolean => dest.timelines.some((x) => x.name === t) || newTimelines.some((x) => x.name === t)
    clone.name = plainTitle(tl.name, taken)
    delete clone.rev // fresh compare-and-swap baseline in the destination
    // fx stacks + loop fields ride VERBATIM (self-contained); a skipped take's takeId drops so the
    // instance falls back to the copied clip's keeper
    clone.items = clone.items.map((it) => ({
      ...it,
      id: itemIdMap.get(it.id) ?? it.id,
      clipId: clipIdMap.get(it.clipId) ?? it.clipId,
      ...(it.takeId ? { takeId: takeIdMaps.get(it.clipId)?.get(it.takeId) } : {}),
      ...(it.audioDetachedId ? { audioDetachedId: audioItemIdMap.get(it.audioDetachedId) ?? it.audioDetachedId } : {})
    }))
    const remappedAudio: TimelineAudioItem[] = []
    for (const a of clone.audioItems ?? []) {
      let source = a.source
      if ('audioId' in source) {
        // v20 file-source: the Library track copies across via ensureAudio (dedup'd)
        const nid = await ensureAudio(source.audioId)
        if (!nid) continue // dead file — skipped + reported by ensureAudio
        source = { audioId: nid }
      } else {
        source = { clipId: clipIdMap.get(source.clipId) ?? source.clipId, takeId: takeIdMaps.get(source.clipId)?.get(source.takeId) ?? source.takeId }
      }
      remappedAudio.push({ ...a, id: audioItemIdMap.get(a.id) ?? a.id, source, ...(a.link ? { link: { ...a.link, itemId: itemIdMap.get(a.link.itemId) ?? a.link.itemId } } : {}) })
    }
    clone.audioItems = remappedAudio
    if (clone.music) {
      const nid = await ensureAudio(clone.music.audioId)
      if (nid) clone.music = { ...clone.music, audioId: nid }
      else delete clone.music // dead music file — skipped + reported by ensureAudio
    }
    newTimelines.push(clone)
    return clone
  }

  const commit = (): void => {
    dest.images.push(...newImages)
    dest.audio.push(...newAudio)
    dest.videos.push(...newVideos)
    dest.clips.push(...newClips)
    dest.charSheets.push(...newSheets)
    dest.timelines.push(...newTimelines)
  }

  return { newImages, newAudio, newVideos, newClips, newSheets, newTimelines, skipped, mintClips, mintSheets, ensureImage, ensureAudio, copyClip, copySheet, copyTimeline, commit }
}

// copy selected clips (takes + referenced images/music/videos + full recipe/snapshots) from another
// project into the CURRENT one — the PULL direction of the shared copy engine.
export async function importClipsFrom(
  dir: string,
  clipIds: string[]
): Promise<{ delta: ProjectDelta; imported: number } | null> {
  if (!current) return null
  const src = await readProjectData(dir)
  if (!src) return null
  beginMediaWrite() // copies land in renders/ and images/ long before the clip entries do
  try {
    const cp = makeAssetCopier(src, current)
    for (const c of cp.mintClips(clipIds)) await cp.copyClip(c)
    cp.commit()
    await saveProject()
    return {
      delta: {
        ...(cp.newClips.length ? { clips: cp.newClips } : {}),
        ...(cp.newImages.length ? { images: cp.newImages } : {}),
        ...(cp.newAudio.length ? { audio: cp.newAudio } : {}),
        ...(cp.newVideos.length ? { videos: cp.newVideos } : {})
      },
      imported: cp.newClips.length
    }
  } finally {
    endMediaWrite()
  }
}

// ----- SEND TO PROJECT: the PUSH direction — assets from the OPEN project into another project on
// disk. The source is UNTOUCHED (risk-free by construction); the destination is loaded through the
// same migrate an open would run, mutated in memory, and written atomically behind a one-shot
// project.json.sendbak. No cross-project undo: the toast is the receipt. -----
export async function sendAssetsTo(destDir: string, sel: SendSelection): Promise<SendResult> {
  if (!current) return { ok: false, error: 'no project open' }
  try {
    if (resolve(destDir).toLowerCase() === resolve(current.dir).toLowerCase())
      return { ok: false, error: "that's this project" }
    const dest = await readProjectData(destDir)
    if (!dest) return { ok: false, error: 'no readable project there' }
    const src = current

    // closure: timelines drag their clips along (items + detached-audio sources; music remaps
    // through ensureAudio during copy); clips drag takes/refs; sheets drag their image. The
    // copier's maps dedup every path — an image referenced five ways copies once.
    const clipIds = new Set(sel.clipIds ?? [])
    const timelines = (sel.timelineIds ?? [])
      .map((id) => src.timelines.find((t) => t.id === id))
      .filter((t): t is Timeline => !!t)
    for (const tl of timelines) {
      for (const it of tl.items) clipIds.add(it.clipId)
      for (const a of tl.audioItems ?? []) if ('clipId' in a.source) clipIds.add(a.source.clipId) // file sources copy via ensureAudio inside copyTimeline
    }

    const cp = makeAssetCopier(src, dest)
    const clips = cp.mintClips([...clipIds])
    const sheets = cp.mintSheets(sel.sheetIds ?? [])
    for (const id of sel.imageIds ?? []) await cp.ensureImage(id)
    for (const id of sel.audioIds ?? []) await cp.ensureAudio(id)
    for (const c of clips) await cp.copyClip(c)
    for (const sh of sheets) await cp.copySheet(sh)
    for (const tl of timelines) await cp.copyTimeline(tl)
    cp.commit()

    // copies land in a folder named after the SOURCE project (find-or-create per kind, reused on
    // repeat sends); music / Library videos / timelines are flat sections — plain, collision-suffixed
    const folderFor = (kind: Folder['kind']): string => {
      const have = dest.folders.find((f) => f.kind === kind && f.parent === null && f.name === src.name)
      if (have) return have.id
      const folder: Folder = { id: randomUUID(), name: src.name, parent: null, kind }
      dest.folders.push(folder)
      return folder.id
    }
    if (cp.newClips.length) {
      const fid = folderFor('bin')
      for (const c of cp.newClips) c.folder = fid
    }
    if (cp.newImages.length) {
      const fid = folderFor('lib')
      for (const i of cp.newImages) i.folder = fid
    }
    if (cp.newSheets.length) {
      const fid = folderFor('sheet')
      for (const sh of cp.newSheets) sh.folder = fid
    }

    // write the destination atomically (media files are already on its disk — a crash between here
    // and the rename leaves project.json untouched + sendbak as the pre-send copy)
    const jp = jsonPath(dest.dir)
    await copyFile(jp, jp + '.sendbak')
    const tmp = jp + '.tmp'
    await writeFile(tmp, JSON.stringify(toRelative(dest), null, 2), 'utf-8')
    await rename(tmp, jp)

    return {
      ok: true,
      sent: {
        clips: cp.newClips.length,
        images: cp.newImages.length,
        audio: cp.newAudio.length,
        sheets: cp.newSheets.length,
        timelines: cp.newTimelines.length,
        videos: cp.newVideos.length
      },
      skipped: cp.skipped
    }
  } catch (e) {
    console.error('[send] failed:', e instanceof Error ? e.message : e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function moveToFolder(
  kind: Folder['kind'],
  itemId: string | string[],
  folderId: string | null
): Promise<ProjectDelta | null> {
  if (!current) return null
  const ids = new Set(Array.isArray(itemId) ? itemId : [itemId])
  if (kind === 'bin') {
    const touched = current.clips.filter((x) => ids.has(x.id))
    if (touched.length === 0) return null
    for (const c of touched) c.folder = folderId
    await saveProject()
    return { clips: touched }
  }
  if (kind === 'sheet') {
    const touched = (current.charSheets ?? []).filter((x) => ids.has(x.id))
    if (touched.length === 0) return null
    for (const sh of touched) sh.folder = folderId
    await saveProject()
    return { charSheets: touched }
  }
  if (kind === 'score') {
    const touched = (current.scoreClips ?? []).filter((x) => ids.has(x.id))
    if (touched.length === 0) return null
    for (const sc of touched) sc.folder = folderId
    await saveProject()
    return { scoreClips: touched }
  }
  const touched = current.images.filter((x) => ids.has(x.id))
  if (touched.length === 0) return null
  for (const im of touched) im.folder = folderId
  await saveProject()
  return { images: touched }
}
