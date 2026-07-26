import { join, extname, basename, isAbsolute, relative, resolve } from 'path'
import { readFile, writeFile, mkdir, copyFile, rename, unlink, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { resolveTake, extractFrame } from './export'
import {
  SCHEMA_VERSION,
  normalizeImageTitle,
  type Project,
  type ProjectDelta,
  type ProjImage,
  type ProjAudio,
  type Folder,
  type Take,
  type Clip,
  type ProjectStyle,
  type CharSheet,
  type CharacterField,
  type Timeline,
  type TimelineItem,
  type TimelineAudioItem,
  type TimelineMusic,
  type PromptData,
  type EditSession,
  type EditNode,
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
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: abs(t.file) }))
    })),
    editSessions: (p.editSessions ?? []).map((s) => ({
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
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: rel(t.file) }))
    })),
    editSessions: (p.editSessions ?? []).map((s) => ({
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
  const clips = (raw.clips ?? []).map((c) => ({
    ...c,
    promptData: migBeats(migLinks({ ...c.promptData, engine: c.promptData.engine ?? 'seedance2' })),
    takes: (c.takes ?? []).map((t) => (t.snapshot ? { ...t, snapshot: migBeats(migLinks(t.snapshot)) } : t))
  }))
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
    return Math.max(0.25, (out - inn) / (it.speed && it.speed > 0 ? it.speed : 1))
  }
  for (const tl of timelines) {
    let cursor = 0
    for (const it of tl.items) {
      if (it.startSec == null) it.startSec = cursor
      if (it.track == null) it.track = 0
      cursor = Math.max(cursor, it.startSec + effOf(it))
    }
    const maxV = tl.items.reduce((m, i) => Math.max(m, (i.track ?? 0) + 1), 1)
    const maxA = (tl.audioItems ?? []).reduce((m, a) => Math.max(m, a.lane + 1), 3)
    tl.videoTracks = tl.videoTracks ?? maxV
    tl.audioTracks = tl.audioTracks ?? maxA
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    name: raw.name ?? 'Untitled',
    ...(typeof raw.watchFolder === 'string' && raw.watchFolder ? { watchFolder: raw.watchFolder } : {}),
    createdAt: raw.createdAt ?? Date.now(),
    images: raw.images ?? [],
    audio: raw.audio ?? [], // v5: music files
    clips,
    styles: raw.styles ?? [], // v6: project styles
    charSheets: raw.charSheets ?? [], // v12: char sheets
    timelines,
    activeTimelineId,
    folders: raw.folders ?? [],
    editSessions: raw.editSessions ?? [],
    codir: raw.codir ?? { log: [], brief: '' } // v7: Co-Director conversation + brief
  }
}

export function getProject(): Project | null {
  return current
}

// Saves are SERIALIZED (one at a time, in call order) and ATOMIC (write .tmp, then rename) so
// overlapping debounced saves from the renderer can never interleave or leave a half-written file.
// The JSON snapshot is taken synchronously at enqueue time so later mutations don't bleed in.
let saveChain: Promise<void> = Promise.resolve()
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
    })
    .catch((e) => {
      console.error('[project] save failed:', e instanceof Error ? e.message : e)
    })
  return saveChain
}

export async function newProject(baseDir: string, name: string): Promise<Project> {
  const safe = (name || 'Untitled').replace(/[<>:"/\\|?*]+/g, '').trim() || 'Untitled'
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
    clips: [],
    styles: [],
    charSheets: [],
    timelines: [firstTimeline],
    activeTimelineId: firstTimeline.id,
    folders: [],
    editSessions: [],
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
    return toAbsolute({ ...migrate(data), dir })
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
  if (dir) current.watchFolder = dir
  else delete current.watchFolder
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
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf-8')
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

// only paths inside the CURRENT project's checkpoints dir are touchable via IPC
function isStateFile(file: string): boolean {
  if (!current) return false
  const base = resolve(statesDir(current.dir))
  const f = resolve(file)
  return f.startsWith(base) && f.endsWith('.json')
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

export async function addSpend(entry: { label: string; kind: SpendEntry['kind']; cost: number }): Promise<{ total: number } | null> {
  if (!current) return null
  const entries = await readSpend(current.dir)
  entries.push({ at: Date.now(), label: entry.label, kind: entry.kind, cost: Number.isFinite(entry.cost) ? entry.cost : 0 })
  const tmp = spendPath(current.dir) + '.tmp'
  await writeFile(tmp, JSON.stringify({ entries }, null, 2), 'utf-8')
  await rename(tmp, spendPath(current.dir))
  return { total: entries.reduce((s, e) => s + (e.cost || 0), 0) }
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
  const sweepDirs = [join(dir, 'images'), join(dir, 'images', 'edits'), join(dir, 'renders'), join(dir, 'audio')]
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
        if (!st.isFile() || live.has(norm(f))) continue
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
  } else {
    clip.promptData = opts.promptData
  }
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
  for (const p of paths) imported.push(await importImage(p))
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
function mainEffDur(it: TimelineItem, clips: Clip[]): number {
  const dur = mainSrcDur(it, clips)
  const sp = it.speed && it.speed > 0 ? it.speed : 1
  if (it.useRecipe) return dur / sp
  const out = Math.min(it.outSec ?? dur, dur)
  const inn = Math.min(it.inSec ?? 0, Math.max(0, out - 0.25))
  return Math.max(0.25, (out - inn) / sp)
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
    const hitAudio = (tl.audioItems ?? []).some((a) => doomed.has(a.source.clipId))
    if (!hitItems && !hitAudio) continue
    if (hitItems) tl.items = tl.items.filter((it) => !doomed.has(it.clipId))
    if (hitAudio) tl.audioItems = (tl.audioItems ?? []).filter((a) => !doomed.has(a.source.clipId))
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
  await saveProject()
  return { removedAudioIds: [audioId], ...(touched.length ? { timelines: touched } : {}) }
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
      if (d.sig === sig) continue
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
  prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30' }
): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  if (prefs.exportRes) tl.exportRes = prefs.exportRes
  if (prefs.exportFps) tl.exportFps = prefs.exportFps
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
  kind: 'bin' | 'lib',
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
  for (const cf of current.folders) if (cf.parent === id) cf.parent = np
  if (f.kind === 'bin') {
    for (const c of current.clips)
      if ((c.folder ?? null) === id) {
        c.folder = np
        touchedClips.push(c)
      }
  } else {
    for (const im of current.images)
      if ((im.folder ?? null) === id) {
        im.folder = np
        touchedImages.push(im)
      }
  }
  current.folders = current.folders.filter((x) => x.id !== id)
  await saveProject()
  return {
    folders: current.folders,
    ...(touchedClips.length ? { clips: touchedClips } : {}),
    ...(touchedImages.length ? { images: touchedImages } : {})
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

// copy selected clips (takes + referenced images + full recipe/snapshots) from another project into
// the CURRENT one. Everything is COPIED (projects stay self-contained); ids are re-minted so the same
// clip can be imported twice; colliding @titles get a _N suffix with all text references rewritten.
export async function importClipsFrom(
  dir: string,
  clipIds: string[]
): Promise<{ delta: ProjectDelta; imported: number } | null> {
  if (!current) return null
  const src = await readProjectData(dir)
  if (!src) return null
  beginMediaWrite() // copies land in renders/ and images/ long before the clip entries do
  try {
    return await importClipsFromInner(src, clipIds)
  } finally {
    endMediaWrite()
  }
}

async function importClipsFromInner(src: Project, clipIds: string[]): Promise<{ delta: ProjectDelta; imported: number } | null> {
  if (!current) return null
  const newImages: ProjImage[] = []
  const imgMap = new Map<string, string>() // source image id → imported image id
  const titleRewrites: Array<[string, string]> = [] // renamed @titles (collisions) → rewrite text refs

  const ensureImage = async (srcId: string | undefined): Promise<string | undefined> => {
    if (!srcId) return undefined
    const known = imgMap.get(srcId)
    if (known) return known
    const srcImg = src.images.find((i) => i.id === srcId)
    if (!srcImg || !existsSync(srcImg.file)) return undefined
    const newId = randomUUID()
    const dest = join(current!.dir, 'images', newId + (extname(srcImg.file) || '.png'))
    await copyFile(srcImg.file, dest)
    let title = srcImg.title
    const taken = (t: string): boolean => current!.images.some((i) => i.title === t) || newImages.some((i) => i.title === t)
    if (taken(title)) {
      let n = 2
      while (taken(`${title}_${n}`)) n++
      titleRewrites.push([title, `${title}_${n}`])
      title = `${title}_${n}`
    }
    newImages.push({ id: newId, title, file: dest })
    imgMap.set(srcId, newId)
    return newId
  }

  // rewrite renamed @titles inside prompt/beat/character text ('(?!\\w)' so @image1 can't eat @image10)
  const rewrite = (s: string): string =>
    titleRewrites.reduce(
      (acc, [from, to]) => acc.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'g'), to),
      s
    )

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
      const dest = join(current!.dir, 'renders', `import_${randomUUID()}${extname(abs) || '.mp4'}`)
      await copyFile(abs, dest)
      destRel = relative(current!.dir, dest)
    }
    svMap.set(sv.file, destRel)
    return { ...sv, clipId: '', takeId: '', file: destRel }
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

  const newClips: Clip[] = []
  for (const cid of clipIds) {
    const c = src.clips.find((x) => x.id === cid)
    if (!c) continue
    const newClip: Clip = {
      id: randomUUID(),
      name: c.name,
      promptData: await remapPromptData(c.promptData),
      takes: [],
      folder: null
    }
    for (const t of c.takes) {
      if (!existsSync(t.file)) continue // render file lost — skip the take, keep the rest
      const nid = randomUUID()
      const dest = join(current.dir, 'renders', `import_${nid}${extname(t.file) || '.mp4'}`)
      await copyFile(t.file, dest)
      newClip.takes.push({
        ...t,
        id: nid,
        file: dest,
        snapshot: t.snapshot ? await remapPromptData(t.snapshot) : undefined
      })
      if (t.id === c.keeperTakeId) newClip.keeperTakeId = nid
    }
    if (!newClip.keeperTakeId && newClip.takes.length) newClip.keeperTakeId = newClip.takes[newClip.takes.length - 1].id
    current.clips.push(newClip)
    newClips.push(newClip)
  }
  current.images.push(...newImages)
  await saveProject()
  return {
    delta: { ...(newClips.length ? { clips: newClips } : {}), ...(newImages.length ? { images: newImages } : {}) },
    imported: newClips.length
  }
}

export async function moveToFolder(
  kind: 'bin' | 'lib',
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
  const touched = current.images.filter((x) => ids.has(x.id))
  if (touched.length === 0) return null
  for (const im of touched) im.folder = folderId
  await saveProject()
  return { images: touched }
}
