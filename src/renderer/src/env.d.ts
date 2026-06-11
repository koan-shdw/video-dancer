/// <reference types="vite/client" />

// The data model lives in ONE place — src/shared/types.ts — imported by main and renderer alike.
// Renderer code uses the bare global names (BeatField, Clip, …); these aliases keep that working
// while making drift between the two sides impossible.
import type * as Shared from '../../shared/types'

declare global {
  type EngineId = Shared.EngineId
  type ProjImage = Shared.ProjImage
  type Folder = Shared.Folder
  type Take = Shared.Take
  type SceneFields = Shared.SceneFields
  type CharacterField = Shared.CharacterField
  type BeatField = Shared.BeatField
  type ProductionFields = Shared.ProductionFields
  type PromptData = Shared.PromptData
  type Clip = Shared.Clip
  type Timeline = Shared.Timeline
  type TimelineItem = Shared.TimelineItem
  type Project = Shared.Project
  type ProjectDelta = Shared.ProjectDelta
  type RenderArgs = Shared.RenderArgs
  type RenderResult = Shared.RenderResult
  type Settings = Shared.Settings
  type FalCredit = Shared.FalCredit
  type PeekClip = Shared.PeekClip
  type PeekProject = Shared.PeekProject

  // Mutating calls return a ProjectDelta (only the slices they touched) — the store merges it.
  // Project open/new/get still return the full Project.
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
    libraryImport: () => Promise<{ delta?: ProjectDelta; importedIds: string[] }>
    libraryImportPaths: (paths: string[]) => Promise<{ delta?: ProjectDelta; importedIds: string[] }>
    clipRename: (clipId: string, name: string) => Promise<ProjectDelta | null>
    clipNew: (name?: string) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    clipSetPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<ProjectDelta | null>
    timelineSet: (timelineId: string, items: TimelineItem[]) => Promise<ProjectDelta | null>
    timelineAdd: (name?: string) => Promise<{ delta: ProjectDelta; timelineId: string } | null>
    timelineRename: (id: string, name: string) => Promise<ProjectDelta | null>
    timelineSetAspect: (id: string, ar: string) => Promise<ProjectDelta | null>
    timelineDuplicate: (id: string) => Promise<{ delta: ProjectDelta; timelineId: string } | null>
    timelineDelete: (id: string) => Promise<ProjectDelta | null>
    timelineSetActive: (id: string) => Promise<ProjectDelta | null>
    clipFromTake: (clipId: string, takeId: string) => Promise<{ delta: ProjectDelta; newClipId: string } | null>
    clipSetKeeper: (clipId: string, takeId: string) => Promise<ProjectDelta | null>
    takeSetDuration: (clipId: string, takeId: string, durationSec: number) => Promise<ProjectDelta | null>
    importPickProject: () => Promise<PeekProject | null>
    importClips: (dir: string, clipIds: string[]) => Promise<{ delta: ProjectDelta; imported: number } | null>
    clipDelete: (id: string) => Promise<ProjectDelta | null>
    clipDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newClipId: string } | null>
    imageDelete: (id: string) => Promise<ProjectDelta | null>
    imageDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newId: string } | null>
    imageRename: (id: string, title: string) => Promise<ProjectDelta | null>
    folderAdd: (kind: 'bin' | 'lib', name: string, parent: string | null) => Promise<{ delta: ProjectDelta; folderId: string } | null>
    folderRename: (id: string, name: string) => Promise<ProjectDelta | null>
    folderDelete: (id: string) => Promise<ProjectDelta | null>
    itemMove: (kind: 'bin' | 'lib', itemId: string, folderId: string | null) => Promise<ProjectDelta | null>
    layoutSave: (json: unknown) => Promise<boolean>
    layoutLoad: () => Promise<unknown | null>
  }

  interface Window {
    vidancer: VidancerApi
  }
}

export {}
