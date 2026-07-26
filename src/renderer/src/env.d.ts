/// <reference types="vite/client" />

// The data model lives in ONE place — src/shared/types.ts — imported by main and renderer alike.
// Renderer code uses the bare global names (BeatField, Clip, …); these aliases keep that working
// while making drift between the two sides impossible.
import type * as Shared from '../../shared/types'

declare global {
  type EngineId = Shared.EngineId
  type ProjImage = Shared.ProjImage
  type ProjAudio = Shared.ProjAudio
  type TimelineMusic = Shared.TimelineMusic
  type TimelineAudioItem = Shared.TimelineAudioItem
  type Folder = Shared.Folder
  type Take = Shared.Take
  type SceneFields = Shared.SceneFields
  type CharacterField = Shared.CharacterField
  type BeatField = Shared.BeatField
  type ProductionFields = Shared.ProductionFields
  type PromptData = Shared.PromptData
  type CharacterLink = Shared.CharacterLink
  type Clip = Shared.Clip
  type ProjectStyle = Shared.ProjectStyle
  type CharSheet = Shared.CharSheet
  type Timeline = Shared.Timeline
  type TimelineItem = Shared.TimelineItem
  type Project = Shared.Project
  type ProjectDelta = Shared.ProjectDelta
  type RenderArgs = Shared.RenderArgs
  type RenderResult = Shared.RenderResult
  type EditArgs = Shared.EditArgs
  type EditResult = Shared.EditResult
  type SourceVideo = Shared.SourceVideo
  type Settings = Shared.Settings
  type FalCredit = Shared.FalCredit
  type MirrorState = Shared.MirrorState
  type CoDirMsg = Shared.CoDirMsg
  type CoDirState = Shared.CoDirState
  type PeekClip = Shared.PeekClip
  type PeekProject = Shared.PeekProject
  type EditSession = Shared.EditSession
  type EditNode = Shared.EditNode
  // a recent-project card in the Open picker (name/thumb read live from each project.json)
  type ProjectCard = { dir: string; name: string; thumb?: string; clips: number; images: number }
  // a named save state (metadata checkpoint in <project>/checkpoints/)
  type ProjectStateInfo = { file: string; name: string; savedAt: number }
  // one paid-job entry in the project's spend ledger (<project>/spend.json, outside undo)
  type SpendEntry = { at: number; label: string; kind: 'gen' | 'edit' | 'image'; cost: number }

  // Mutating calls return a ProjectDelta (only the slices they touched) — the store merges it.
  // Project open/new/get still return the full Project.
  interface VidancerApi {
    appName: string
    getSettings: () => Promise<Settings>
    setSettings: (patch: Record<string, unknown>) => Promise<Settings>
    falCredit: () => Promise<FalCredit>
    pickImages: () => Promise<string[]>
    render: (opts: RenderArgs) => Promise<RenderResult>
    onRenderProgress: (cb: (msg: string) => void) => () => void
    editRun: (req: EditArgs) => Promise<EditResult>
    editCreateClip: (req: { engine?: EngineId; prompt: string; name?: string; source: EditArgs['source'] }) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    onEditProgress: (cb: (msg: string) => void) => () => void
    renderCancel: (jobId: string) => Promise<boolean>
    projectCreateAt: (baseDir: string, name: string) => Promise<Project | null>
    projectDefaultBaseDir: () => Promise<string>
    pickFolder: (defaultPath?: string) => Promise<string | null>
    projectOpen: () => Promise<Project | null>
    projectGet: () => Promise<Project | null>
    projectOpenLast: () => Promise<Project | null>
    projectOpenPath: (dir: string) => Promise<Project | null>
    projectRecents: () => Promise<string[]>
    projectPeekRecents: () => Promise<ProjectCard[]>
    projectStateSave: (name: string) => Promise<ProjectStateInfo | null>
    projectStateList: () => Promise<ProjectStateInfo[]>
    projectStateRestore: (file: string) => Promise<Project | null>
    projectStateDelete: (file: string) => Promise<boolean>
    spendAdd: (entry: { label: string; kind: 'gen' | 'edit' | 'image'; cost: number }) => Promise<{ total: number } | null>
    spendList: () => Promise<{ total: number; entries: SpendEntry[] }>
    projectUndo: () => Promise<Project | null>
    projectRedo: () => Promise<Project | null>
    projectCleanup: (apply: boolean) => Promise<{ files: number; bytes: number; busy?: boolean } | null>
    watchPick: () => Promise<ProjectDelta | null>
    watchClear: () => Promise<ProjectDelta | null>
    watchList: () => Promise<{ file: string; name: string; mtime: number }[]>
    clipExport: (clipId: string, takeId?: string) => Promise<{ ok: boolean; file?: string; error?: string }>
    startFileDrag: (file: string) => void
    revealFile: (p: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    appVersion: () => Promise<string>
    openLogs: () => Promise<void>
    logRenderer: (msg: string) => Promise<void>
    updateRestart: () => Promise<void>
    updateCheck: () => Promise<void>
    onUpdateStatus: (cb: (s: { status: string; info?: { version?: string; percent?: number } }) => void) => () => void
    libraryImport: () => Promise<{ delta?: ProjectDelta; importedIds: string[] }>
    librarySaveFrame: (bytes: Uint8Array, note: string) => Promise<{ delta: ProjectDelta; imageId: string } | null>
    libraryImportPaths: (paths: string[]) => Promise<{ delta?: ProjectDelta; importedIds: string[] }>
    audioImport: () => Promise<{ delta: ProjectDelta; importedIds: string[] } | null>
    audioImportPaths: (paths: string[]) => Promise<{ delta: ProjectDelta; importedIds: string[] } | null>
    audioRename: (id: string, title: string) => Promise<ProjectDelta | null>
    audioSetDuration: (id: string, dur: number) => Promise<ProjectDelta | null>
    audioDelete: (id: string) => Promise<ProjectDelta | null>
    timelineSetMusic: (timelineId: string, music: TimelineMusic | null) => Promise<ProjectDelta | null>
    timelineSetMutes: (timelineId: string, mutes: { videoMuted?: boolean; musicMuted?: boolean }) => Promise<ProjectDelta | null>
    timelineSetExportPrefs: (timelineId: string, prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30' }) => Promise<ProjectDelta | null>
    exportRun: (timelineId: string) => Promise<{ ok: boolean; file?: string; error?: string }>
    onExportProgress: (cb: (msg: string) => void) => () => void
    clipRename: (clipId: string, name: string) => Promise<ProjectDelta | null>
    clipNew: (name?: string) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    clipSetPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<ProjectDelta | null>
    charSheetNew: (name?: string) => Promise<{ delta: ProjectDelta; sheetId: string } | null>
    charSheetSet: (id: string, patch: { name?: string; imageId?: string | null; character?: CharacterField }) => Promise<ProjectDelta | null>
    charSheetDelete: (id: string) => Promise<ProjectDelta | null>
    itemsReorder: (kind: 'bin' | 'lib', movedIds: string[], targetId: string) => Promise<ProjectDelta | null>
    styleNew: (name?: string) => Promise<{ delta: ProjectDelta; styleId: string } | null>
    styleSet: (id: string, patch: { name?: string; scene?: SceneFields; production?: ProductionFields; enhanced?: string[] }) => Promise<ProjectDelta | null>
    styleDelete: (id: string) => Promise<ProjectDelta | null>
    timelineSet: (timelineId: string, items: TimelineItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineSlice: (timelineId: string, itemId: string, cutSec: number) => Promise<ProjectDelta | null>
    timelineSetAudioItems: (timelineId: string, audioItems: TimelineAudioItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineUnlinkAudio: (timelineId: string, itemId: string) => Promise<ProjectDelta | null>
    timelineAdd: (name?: string) => Promise<{ delta: ProjectDelta; timelineId: string } | null>
    timelineRename: (id: string, name: string) => Promise<ProjectDelta | null>
    timelineSetAspect: (id: string, ar: string) => Promise<ProjectDelta | null>
    timelineDuplicate: (id: string) => Promise<{ delta: ProjectDelta; timelineId: string } | null>
    timelineDelete: (id: string) => Promise<ProjectDelta | null>
    timelineSetActive: (id: string) => Promise<ProjectDelta | null>
    clipFromTake: (clipId: string, takeId: string) => Promise<{ delta: ProjectDelta; newClipId: string } | null>
    clipSetKeeper: (clipId: string, takeId: string) => Promise<ProjectDelta | null>
    clipAddTakeFile: (clipId: string) => Promise<{ delta: ProjectDelta; takeId: string } | null>
    clipSetStoryboard: (clipId: string, imageId: string | null) => Promise<ProjectDelta | null>
    takeSetDuration: (clipId: string, takeId: string, durationSec: number) => Promise<ProjectDelta | null>
    importPickProject: () => Promise<PeekProject | null>
    importClips: (dir: string, clipIds: string[]) => Promise<{ delta: ProjectDelta; imported: number } | null>
    imageGenerate: (req: {
      rootImageId: string
      parentNodeId: string | null
      prompt: string
      refIds: string[]
      numImages: number
      seed?: number
      aspectRatio: string
      basePng?: Uint8Array // base composited with the visible draw layer (replaces the upload base only)
    }) => Promise<{ ok: boolean; delta?: ProjectDelta; nodeIds?: string[]; error?: string }>
    imageTagNode: (sessionId: string, nodeId: string) => Promise<{ delta: ProjectDelta; imageId: string } | null>
    imageDeleteBranch: (sessionId: string, nodeId: string) => Promise<ProjectDelta | null>
    onImageProgress: (cb: (msg: string) => void) => () => void
    clipDelete: (id: string) => Promise<ProjectDelta | null>
    clipsDelete: (ids: string[]) => Promise<ProjectDelta | null>
    clipDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newClipId: string } | null>
    clipsFromImages: (imageIds: string[], place?: { timelineId: string; index: number }) => Promise<{ delta: ProjectDelta; clipIds: string[] } | null>
    clipFromImagesAsBeats: (imageIds: string[]) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    imageDelete: (id: string) => Promise<ProjectDelta | null>
    imagesDelete: (ids: string[]) => Promise<ProjectDelta | null>
    imageCropSave: (req: { rootImageId: string; parentId: string | null; bytes: Uint8Array; label: string }) => Promise<{ delta: ProjectDelta; nodeId: string } | null>
    imageDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newId: string } | null>
    imageRename: (id: string, title: string) => Promise<ProjectDelta | null>
    imageAddDynamicStill: (itemId: string, edge: 'first' | 'last') => Promise<{ delta: ProjectDelta; imageId: string } | null>
    imageSetPrimary: (sessionId: string, nodeId: string | null) => Promise<ProjectDelta | null>
    onProjectDelta: (cb: (d: ProjectDelta) => void) => () => void
    folderAdd: (kind: 'bin' | 'lib', name: string, parent: string | null) => Promise<{ delta: ProjectDelta; folderId: string } | null>
    folderRename: (id: string, name: string) => Promise<ProjectDelta | null>
    folderDelete: (id: string) => Promise<ProjectDelta | null>
    itemMove: (kind: 'bin' | 'lib', itemId: string | string[], folderId: string | null) => Promise<ProjectDelta | null>
    layoutSave: (json: unknown) => Promise<boolean>
    layoutLoad: () => Promise<unknown | null>
    codirSend: (req: { text: string; imageIds: string[]; selectedClipId: string | null; focus: { kind: string; ownerId: string; path: string } | null }) => Promise<{
      ok: boolean
      reply?: string
      error?: string
      usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; rounds: number }
      logDelta?: ProjectDelta | null
    }>
    codirCancel: () => Promise<void>
    codirBridgeStatus: (refresh?: boolean) => Promise<{ found: boolean; version?: string; detail: string }>
    codirBridgeModels: () => Promise<{ id: string; label: string }[]>
    codirClearLog: () => Promise<ProjectDelta | null>
    codirSetBrief: (brief: string) => Promise<ProjectDelta | null>
    codirModels: () => Promise<{ id: string; label: string }[]>
    codirGuides: () => Promise<{ id: string; label: string; customised: boolean; hasLearned: boolean; loaded: boolean; path: string }[]>
    codirGuideOpen: (id: string) => Promise<string | null>
    codirGuideRevert: (id: string) => Promise<void>
    codirGuidePurgeLearned: () => Promise<void>
    onCodirProgress: (cb: (e: { kind: 'status' | 'text' | 'wrote'; text?: string }) => void) => () => void
    screenList: () => Promise<{ id: number; label: string; width: number; height: number }[]>
    mirrorOpen: (displayId: number) => Promise<boolean>
    mirrorClose: () => Promise<void>
    mirrorState: (s: MirrorState) => void
    onMirrorState: (cb: (s: MirrorState) => void) => () => void
    onMirrorClosed: (cb: () => void) => () => void
  }

  interface Window {
    vidancer: VidancerApi
  }
}

export {}
