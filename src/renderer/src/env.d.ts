/// <reference types="vite/client" />

interface ProjImage {
  id: string
  title: string
  file: string
  folder?: string | null
}
interface Folder {
  id: string
  name: string
  parent: string | null
  kind: 'bin' | 'lib'
}
interface Take {
  id: string
  file: string
  createdAt: number
  seed?: number
}

interface SceneFields {
  title: string
  referenceHandling: string
  style: string
  visualFeel: string
}
interface CharacterField {
  name: string
  base: string
  features: string
  physics: string
  referenceLabel: string
}
interface BeatField {
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
interface ProductionFields {
  audioDesign: string
  lighting: string
  subtext: string
  criticalConstraint: string
  avoid: string
}

interface PromptData {
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
interface Clip {
  id: string
  name: string
  promptData: PromptData
  takes: Take[]
  keeperTakeId?: string
  folder?: string | null
}
interface TimelineItem {
  id: string
  clipId: string
  takeId?: string // optional per-instance take override; falls back to the clip's keeper
  inSec?: number // trim in-point (seconds into the source); default 0
  outSec?: number // trim out-point; default = clip duration
}
interface Project {
  name: string
  dir: string
  createdAt: number
  images: ProjImage[]
  clips: Clip[]
  timeline: TimelineItem[]
  folders: Folder[]
}

interface RenderArgs {
  mode: 'ref2v' | 'i2v'
  prompt: string // the FINAL combined text (freeform + yaml) sent to fal
  freeform: string
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
  images: string[]
  endImage?: string
  duration: string
  resolution: string
  aspectRatio: string
  generateAudio: boolean
  seed?: number
  clipId?: string
  name?: string
}
interface RenderResult {
  ok: boolean
  bytes?: Uint8Array
  project?: Project
  clipId?: string
  takeId?: string
  error?: string
}
interface Settings {
  falKey?: string
  falAdminKey?: string
  astriaKey?: string
  anthropicKey?: string
  workspaces?: Record<string, unknown> // name → dockview layout JSON (global, named layout presets)
  activeWorkspace?: string
  showFilmstrips?: boolean
  [k: string]: unknown
}
interface FalCredit {
  ok: boolean
  balance?: number
  currency?: string
  error?: string
}

interface VidancerApi {
  appName: string
  version: string
  getSettings: () => Promise<Settings>
  setSettings: (patch: Record<string, unknown>) => Promise<Settings>
  falCredit: () => Promise<FalCredit>
  pickImages: () => Promise<string[]>
  render: (opts: RenderArgs) => Promise<RenderResult>
  onRenderProgress: (cb: (msg: string) => void) => () => void
  projectNew: () => Promise<Project | null>
  projectOpen: () => Promise<Project | null>
  projectGet: () => Promise<Project | null>
  projectOpenLast: () => Promise<Project | null>
  mediaRead: (file: string) => Promise<Uint8Array | null>
  libraryImport: () => Promise<{ project: Project | null; importedIds: string[] }>
  libraryImportPaths: (paths: string[]) => Promise<{ project: Project | null; importedIds: string[] }>
  clipRename: (clipId: string, name: string) => Promise<Project | null>
  clipNew: (name?: string) => Promise<{ project: Project; clipId: string } | null>
  clipSetPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<Project | null>
  timelineSet: (items: TimelineItem[]) => Promise<Project | null>
  clipFromTake: (clipId: string, takeId: string) => Promise<{ project: Project; newClipId: string } | null>
  clipSetKeeper: (clipId: string, takeId: string) => Promise<Project | null>
  clipDelete: (id: string) => Promise<Project | null>
  clipDuplicate: (id: string) => Promise<{ project: Project; newClipId: string } | null>
  imageDelete: (id: string) => Promise<Project | null>
  imageDuplicate: (id: string) => Promise<{ project: Project; newId: string } | null>
  imageRename: (id: string, title: string) => Promise<Project | null>
  folderAdd: (kind: 'bin' | 'lib', name: string, parent: string | null) => Promise<{ project: Project; folderId: string } | null>
  folderRename: (id: string, name: string) => Promise<Project | null>
  folderDelete: (id: string) => Promise<Project | null>
  itemMove: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => Promise<Project | null>
  layoutSave: (json: unknown) => Promise<boolean>
  layoutLoad: () => Promise<unknown | null>
}

interface Window {
  vidancer: VidancerApi
}
