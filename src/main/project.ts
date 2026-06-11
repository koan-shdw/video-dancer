import { join, extname, isAbsolute, relative } from 'path'
import { readFile, writeFile, mkdir, copyFile, rename, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import {
  SCHEMA_VERSION,
  type Project,
  type ProjectDelta,
  type ProjImage,
  type Folder,
  type Take,
  type Clip,
  type Timeline,
  type TimelineItem,
  type PromptData,
  type EditSession,
  type EditNode
} from '../shared/types'

// model types come from the single shared source; re-export so existing main-side imports keep working
export type {
  Project,
  ProjectDelta,
  ProjImage,
  Folder,
  Take,
  Clip,
  TimelineItem,
  PromptData,
  SceneFields,
  CharacterField,
  BeatField,
  ProductionFields
} from '../shared/types'

let current: Project | null = null

const jsonPath = (dir: string): string => join(dir, 'project.json')

function toAbsolute(p: Project): Project {
  const abs = (f: string): string => (isAbsolute(f) ? f : join(p.dir, f))
  return {
    ...p,
    images: p.images.map((i) => ({ ...i, file: abs(i.file) })),
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: abs(t.file) }))
    })),
    editSessions: (p.editSessions ?? []).map((s) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n, file: abs(n.file) })) }))
  }
}

function toRelative(p: Project): Omit<Project, 'dir'> {
  const rel = (f: string): string => (isAbsolute(f) ? relative(p.dir, f) : f)
  const out = {
    ...p,
    images: p.images.map((i) => ({ ...i, file: rel(i.file) })),
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: rel(t.file) }))
    })),
    editSessions: (p.editSessions ?? []).map((s) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n, file: rel(n.file) })) }))
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
  return {
    schemaVersion: SCHEMA_VERSION,
    name: raw.name ?? 'Untitled',
    createdAt: raw.createdAt ?? Date.now(),
    images: raw.images ?? [],
    clips: (raw.clips ?? []).map((c) => ({
      ...c,
      promptData: { ...c.promptData, engine: c.promptData.engine ?? 'seedance2' }
    })),
    timelines,
    activeTimelineId,
    folders: raw.folders ?? [],
    editSessions: raw.editSessions ?? []
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
    clips: [],
    timelines: [firstTimeline],
    activeTimelineId: firstTimeline.id,
    folders: [],
    editSessions: []
  }
  await saveProject()
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
  if (p) current = p
  return p
}

export async function importImage(localPath: string): Promise<ProjImage> {
  if (!current) throw new Error('no project')
  const existing = current.images.find((i) => i.file === localPath)
  if (existing) return existing
  const id = randomUUID()
  const ext = extname(localPath) || '.png'
  const destAbs = join(current.dir, 'images', id + ext)
  await copyFile(localPath, destAbs)
  const img: ProjImage = { id, title: nextImageTitle(), file: destAbs }
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

function emptyPromptData(): PromptData {
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

export async function renameClip(id: string, name: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === id)
  if (!c) return null
  c.name = name.trim() || c.name
  await saveProject()
  return { clips: [c] }
}

export async function importImages(paths: string[]): Promise<{ delta: ProjectDelta; importedIds: string[] }> {
  if (!current) throw new Error('no project')
  const imported: ProjImage[] = []
  for (const p of paths) imported.push(await importImage(p))
  await saveProject()
  return { delta: { images: imported }, importedIds: imported.map((i) => i.id) }
}

export async function setTimelineItems(timelineId: string, items: TimelineItem[]): Promise<ProjectDelta | null> {
  if (!current) return null
  const tl = current.timelines.find((t) => t.id === timelineId)
  if (!tl) return null
  tl.items = items
  await saveProject()
  return { timelines: [tl] }
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
  const copy: Timeline = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    aspectRatio: src.aspectRatio,
    items: src.items.map((it) => ({ ...it, id: randomUUID() })) // instances get fresh ids
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

export async function setKeeperTake(clipId: string, takeId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  if (!c || !c.takes.some((t) => t.id === takeId)) return null
  c.keeperTakeId = takeId
  await saveProject()
  return { clips: [c] }
}

// ----- delete / duplicate / folders (Premiere-style organize) -----
export async function deleteClip(clipId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  current.clips = current.clips.filter((c) => c.id !== clipId)
  // the clip also leaves EVERY timeline it was placed on
  const touched: Timeline[] = []
  for (const tl of current.timelines) {
    if (!tl.items.some((it) => it.clipId === clipId)) continue
    tl.items = tl.items.filter((it) => it.clipId !== clipId)
    touched.push(tl)
  }
  await saveProject()
  return { removedClipIds: [clipId], ...(touched.length ? { timelines: touched } : {}) }
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

export async function deleteImage(imageId: string): Promise<ProjectDelta | null> {
  if (!current) return null
  current.images = current.images.filter((i) => i.id !== imageId)
  const touched: Clip[] = []
  for (const c of current.clips) {
    const hadRef = (c.promptData.imageIds ?? []).includes(imageId)
    const wasEnd = c.promptData.endImageId === imageId
    if (!hadRef && !wasEnd) continue
    c.promptData.imageIds = (c.promptData.imageIds ?? []).filter((id) => id !== imageId)
    if (wasEnd) c.promptData.endImageId = undefined
    touched.push(c)
  }
  // the image's edit tree dies with it (it's part of the image's data) — node files removed;
  // TAGGED children survive: they're independent Library images with their own copied files
  const deadSessions = current.editSessions.filter((s) => s.rootImageId === imageId)
  if (deadSessions.length) {
    current.editSessions = current.editSessions.filter((s) => s.rootImageId !== imageId)
    for (const s of deadSessions)
      for (const n of s.nodes) {
        try {
          await unlink(n.file)
        } catch {
          /* already gone */
        }
      }
  }
  await saveProject() // the image file itself stays on disk in images/
  return {
    removedImageIds: [imageId],
    ...(touched.length ? { clips: touched } : {}),
    ...(deadSessions.length ? { removedEditSessionIds: deadSessions.map((s) => s.id) } : {})
  }
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

export async function renameImage(imageId: string, title: string): Promise<ProjectDelta | null> {
  if (!current) return null
  const i = current.images.find((x) => x.id === imageId)
  if (!i) return null
  let t = title.trim()
  if (!t) return null
  if (!t.startsWith('@')) t = '@' + t
  i.title = t.replace(/\s+/g, '_')
  await saveProject()
  return { images: [i] }
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

  const remapPromptData = async (pd: PromptData): Promise<PromptData> => {
    const out = JSON.parse(JSON.stringify(pd)) as PromptData
    const ids: string[] = []
    for (const id of out.imageIds ?? []) {
      const nid = await ensureImage(id)
      if (nid) ids.push(nid)
    }
    out.imageIds = ids
    out.endImageId = await ensureImage(out.endImageId)
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
  itemId: string,
  folderId: string | null
): Promise<ProjectDelta | null> {
  if (!current) return null
  if (kind === 'bin') {
    const c = current.clips.find((x) => x.id === itemId)
    if (!c) return null
    c.folder = folderId
    await saveProject()
    return { clips: [c] }
  }
  const im = current.images.find((x) => x.id === itemId)
  if (!im) return null
  im.folder = folderId
  await saveProject()
  return { images: [im] }
}
