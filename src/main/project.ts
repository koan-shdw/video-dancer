import { join, extname, isAbsolute, relative } from 'path'
import { readFile, writeFile, mkdir, copyFile, rename } from 'fs/promises'
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
  type TimelineItem,
  type PromptData
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
  return {
    ...p,
    images: p.images.map((i) => ({ ...i, file: isAbsolute(i.file) ? i.file : join(p.dir, i.file) })),
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: isAbsolute(t.file) ? t.file : join(p.dir, t.file) }))
    }))
  }
}

function toRelative(p: Project): Omit<Project, 'dir'> {
  const rel = {
    ...p,
    images: p.images.map((i) => ({ ...i, file: isAbsolute(i.file) ? relative(p.dir, i.file) : i.file })),
    clips: p.clips.map((c) => ({
      ...c,
      takes: c.takes.map((t) => ({ ...t, file: isAbsolute(t.file) ? relative(p.dir, t.file) : t.file }))
    }))
  }
  const { dir: _dir, ...rest } = rel
  return rest
}

// fill defaults / upgrade older project.json files to the current schema
function migrate(raw: Partial<Omit<Project, 'dir'>>): Omit<Project, 'dir'> {
  const fileVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  if (fileVersion > SCHEMA_VERSION)
    console.warn(`[project] file schema v${fileVersion} is newer than app v${SCHEMA_VERSION} — opening best-effort`)
  return {
    schemaVersion: SCHEMA_VERSION,
    name: raw.name ?? 'Untitled',
    createdAt: raw.createdAt ?? Date.now(),
    images: raw.images ?? [],
    clips: (raw.clips ?? []).map((c) => ({
      ...c,
      promptData: { ...c.promptData, engine: c.promptData.engine ?? 'seedance2' }
    })),
    timeline: raw.timeline ?? [],
    folders: raw.folders ?? []
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
  current = {
    schemaVersion: SCHEMA_VERSION,
    name: safe,
    dir,
    createdAt: Date.now(),
    images: [],
    clips: [],
    timeline: [],
    folders: []
  }
  await saveProject()
  return current
}

export async function openProject(dir: string): Promise<Project | null> {
  if (!existsSync(jsonPath(dir))) return null
  try {
    const data = JSON.parse(await readFile(jsonPath(dir), 'utf-8')) as Partial<Omit<Project, 'dir'>>
    current = toAbsolute({ ...migrate(data), dir })
    return current
  } catch (e) {
    // corrupted project.json: don't crash the IPC handler — report "couldn't open" and leave the file alone
    console.error('[project] failed to open', jsonPath(dir), e instanceof Error ? e.message : e)
    return null
  }
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
    engine: opts.promptData.engine ?? 'seedance2'
  }
  clip.takes.push(take)
  clip.keeperTakeId = take.id
  await saveProject()
  return { delta: { clips: [clip] }, clipId: clip.id, takeId: take.id }
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

export async function setTimeline(items: TimelineItem[]): Promise<ProjectDelta | null> {
  if (!current) return null
  current.timeline = items
  await saveProject()
  return { timeline: current.timeline }
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
  const newClip: Clip = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    promptData: JSON.parse(JSON.stringify(src.promptData)) as PromptData,
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
  current.timeline = current.timeline.filter((it) => it.clipId !== clipId) // also leaves the timeline
  await saveProject()
  return { removedClipIds: [clipId], timeline: current.timeline }
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
  await saveProject() // file stays on disk in images/
  return { removedImageIds: [imageId], ...(touched.length ? { clips: touched } : {}) }
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
