import { join, extname, isAbsolute, relative } from 'path'
import { readFile, writeFile, mkdir, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'

// On disk (project.json) file paths are RELATIVE to the project dir; in memory they're ABSOLUTE.
export interface ProjImage {
  id: string
  title: string
  file: string
  folder?: string | null // library folder id (null/undefined = root)
}
export interface Folder {
  id: string
  name: string
  parent: string | null
  kind: 'bin' | 'lib'
}
export interface Take {
  id: string
  file: string
  createdAt: number
  seed?: number
}
export interface SceneFields {
  title: string
  referenceHandling: string
  style: string
  visualFeel: string
}
export interface CharacterField {
  name: string
  base: string
  features: string
  physics: string
  referenceLabel: string
}
export interface BeatField {
  name: string
  length: number
  camera: string
  action: string
  lighting: string
  dialogue?: string
  vfx?: string
  reaction?: string
  sfx?: string
}
export interface ProductionFields {
  audioDesign: string
  lighting: string
  subtext: string
  criticalConstraint: string
  avoid: string
}
export interface PromptData {
  mode: 'ref2v' | 'i2v'
  freeform: string
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
  imageIds: string[]
  endImageId?: string
  duration: string
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  seed?: number
}
export interface Clip {
  id: string
  name: string
  promptData: PromptData
  takes: Take[]
  keeperTakeId?: string
  folder?: string | null // bin folder id (null/undefined = root)
}
export interface TimelineItem {
  id: string
  clipId: string
  takeId?: string // optional per-instance take override; falls back to the clip's keeper
  inSec?: number // trim in-point (seconds into the source); default 0
  outSec?: number // trim out-point; default = clip duration
}
export interface Project {
  name: string
  dir: string
  createdAt: number
  images: ProjImage[]
  clips: Clip[]
  timeline: TimelineItem[]
  folders: Folder[]
}

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

export function getProject(): Project | null {
  return current
}

export async function saveProject(): Promise<void> {
  if (!current) return
  await writeFile(jsonPath(current.dir), JSON.stringify(toRelative(current), null, 2), 'utf-8')
}

export async function newProject(baseDir: string, name: string): Promise<Project> {
  const safe = (name || 'Untitled').replace(/[<>:"/\\|?*]+/g, '').trim() || 'Untitled'
  let dir = join(baseDir, safe)
  let n = 2
  while (existsSync(dir)) dir = join(baseDir, `${safe} ${n++}`)
  await mkdir(join(dir, 'images'), { recursive: true })
  await mkdir(join(dir, 'renders'), { recursive: true })
  current = { name: safe, dir, createdAt: Date.now(), images: [], clips: [], timeline: [], folders: [] }
  await saveProject()
  return current
}

export async function openProject(dir: string): Promise<Project | null> {
  if (!existsSync(jsonPath(dir))) return null
  const data = JSON.parse(await readFile(jsonPath(dir), 'utf-8')) as Omit<Project, 'dir'>
  current = toAbsolute({ ...data, dir, timeline: data.timeline ?? [], folders: data.folders ?? [] })
  return current
}

export async function importImage(localPath: string): Promise<ProjImage> {
  if (!current) throw new Error('no project')
  const existing = current.images.find((i) => i.file === localPath)
  if (existing) return existing
  const id = randomUUID()
  const ext = extname(localPath) || '.png'
  const destAbs = join(current.dir, 'images', id + ext)
  await copyFile(localPath, destAbs)
  const img: ProjImage = { id, title: `@image${current.images.length + 1}`, file: destAbs }
  current.images.push(img)
  return img
}

export async function addTake(opts: {
  clipId?: string
  name: string
  promptData: PromptData
  takeFile: string
}): Promise<{ project: Project; clipId: string; takeId: string }> {
  if (!current) throw new Error('no project')
  let clip = opts.clipId ? current.clips.find((c) => c.id === opts.clipId) : undefined
  if (!clip) {
    clip = { id: randomUUID(), name: opts.name, promptData: opts.promptData, takes: [] }
    current.clips.push(clip)
  } else {
    clip.promptData = opts.promptData
  }
  const take: Take = { id: randomUUID(), file: opts.takeFile, createdAt: Date.now(), seed: opts.promptData.seed }
  clip.takes.push(take)
  clip.keeperTakeId = take.id
  await saveProject()
  return { project: current, clipId: clip.id, takeId: take.id }
}

function emptyPromptData(): PromptData {
  return {
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
export async function newEmptyClip(name?: string): Promise<{ project: Project; clipId: string } | null> {
  if (!current) return null
  const clip: Clip = {
    id: randomUUID(),
    name: name?.trim() || `clip ${current.clips.length + 1}`,
    promptData: emptyPromptData(),
    takes: []
  }
  current.clips.push(clip)
  await saveProject()
  return { project: current, clipId: clip.id }
}

// persist a clip's prompt data without rendering (so storyboard clips keep their recipe)
export async function setClipPromptData(clipId: string, promptData: Partial<PromptData>): Promise<Project | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  if (c) {
    c.promptData = { ...c.promptData, ...promptData } // merge so unmanaged fields (e.g. seed) survive
    await saveProject()
  }
  return current
}

export async function renameClip(id: string, name: string): Promise<Project | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === id)
  if (c) {
    c.name = name.trim() || c.name
    await saveProject()
  }
  return current
}

export async function importImages(paths: string[]): Promise<{ project: Project; importedIds: string[] }> {
  if (!current) throw new Error('no project')
  const importedIds: string[] = []
  for (const p of paths) importedIds.push((await importImage(p)).id)
  await saveProject()
  return { project: current, importedIds }
}

export async function setTimeline(items: TimelineItem[]): Promise<Project | null> {
  if (!current) return null
  current.timeline = items
  await saveProject()
  return current
}

export async function cloneClipFromTake(
  clipId: string,
  takeId: string
): Promise<{ project: Project; newClipId: string } | null> {
  if (!current) return null
  const src = current.clips.find((c) => c.id === clipId)
  const take = src?.takes.find((t) => t.id === takeId)
  if (!src || !take) return null
  const newTakeId = randomUUID()
  const newClip: Clip = {
    id: randomUUID(),
    name: `${src.name} ·copy`,
    promptData: JSON.parse(JSON.stringify(src.promptData)) as PromptData,
    takes: [{ id: newTakeId, file: take.file, createdAt: Date.now(), seed: take.seed }],
    keeperTakeId: newTakeId
  }
  current.clips.push(newClip)
  await saveProject()
  return { project: current, newClipId: newClip.id }
}

export async function setKeeperTake(clipId: string, takeId: string): Promise<Project | null> {
  if (!current) return null
  const c = current.clips.find((x) => x.id === clipId)
  if (c && c.takes.some((t) => t.id === takeId)) {
    c.keeperTakeId = takeId
    await saveProject()
  }
  return current
}

// ----- delete / duplicate / folders (Premiere-style organize) -----
export async function deleteClip(clipId: string): Promise<Project | null> {
  if (!current) return null
  current.clips = current.clips.filter((c) => c.id !== clipId)
  current.timeline = current.timeline.filter((it) => it.clipId !== clipId) // also leaves the timeline
  await saveProject()
  return current
}

export async function duplicateClip(clipId: string): Promise<{ project: Project; newClipId: string } | null> {
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
  return { project: current, newClipId: newClip.id }
}

export async function deleteImage(imageId: string): Promise<Project | null> {
  if (!current) return null
  current.images = current.images.filter((i) => i.id !== imageId)
  for (const c of current.clips) {
    c.promptData.imageIds = (c.promptData.imageIds ?? []).filter((id) => id !== imageId)
    if (c.promptData.endImageId === imageId) c.promptData.endImageId = undefined
  }
  await saveProject() // file stays on disk in images/
  return current
}

export async function duplicateImage(imageId: string): Promise<{ project: Project; newId: string } | null> {
  if (!current) return null
  const src = current.images.find((i) => i.id === imageId)
  if (!src) return null
  const id = randomUUID()
  const ext = extname(src.file) || '.png'
  const destAbs = join(current.dir, 'images', id + ext)
  await copyFile(src.file, destAbs)
  const img: ProjImage = { id, title: `@image${current.images.length + 1}`, file: destAbs, folder: src.folder ?? null }
  current.images.push(img)
  await saveProject()
  return { project: current, newId: id }
}

export async function renameImage(imageId: string, title: string): Promise<Project | null> {
  if (!current) return null
  const i = current.images.find((x) => x.id === imageId)
  if (i) {
    let t = title.trim()
    if (t) {
      if (!t.startsWith('@')) t = '@' + t
      i.title = t.replace(/\s+/g, '_')
      await saveProject()
    }
  }
  return current
}

export async function addFolder(
  kind: 'bin' | 'lib',
  name: string,
  parent: string | null
): Promise<{ project: Project; folderId: string } | null> {
  if (!current) return null
  const folder: Folder = { id: randomUUID(), name: name.trim() || 'New Folder', parent: parent ?? null, kind }
  current.folders = [...(current.folders ?? []), folder]
  await saveProject()
  return { project: current, folderId: folder.id }
}

export async function renameFolder(id: string, name: string): Promise<Project | null> {
  if (!current) return null
  const f = (current.folders ?? []).find((x) => x.id === id)
  if (f) {
    f.name = name.trim() || f.name
    await saveProject()
  }
  return current
}

export async function deleteFolder(id: string): Promise<Project | null> {
  if (!current) return null
  const f = (current.folders ?? []).find((x) => x.id === id)
  if (!f) return current
  const np = f.parent ?? null // reparent contents to this folder's parent — never destroys items
  for (const cf of current.folders) if (cf.parent === id) cf.parent = np
  if (f.kind === 'bin') {
    for (const c of current.clips) if ((c.folder ?? null) === id) c.folder = np
  } else {
    for (const im of current.images) if ((im.folder ?? null) === id) im.folder = np
  }
  current.folders = current.folders.filter((x) => x.id !== id)
  await saveProject()
  return current
}

export async function moveToFolder(kind: 'bin' | 'lib', itemId: string, folderId: string | null): Promise<Project | null> {
  if (!current) return null
  if (kind === 'bin') {
    const c = current.clips.find((x) => x.id === itemId)
    if (c) c.folder = folderId
  } else {
    const im = current.images.find((x) => x.id === itemId)
    if (im) im.folder = folderId
  }
  await saveProject()
  return current
}
