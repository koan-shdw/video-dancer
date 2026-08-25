/// <reference types="vite/client" />

// The data model lives in ONE place — src/shared/types.ts — imported by main and renderer alike.
// Renderer code uses the bare global names (BeatField, Clip, …); these aliases keep that working
// while making drift between the two sides impossible.
import type * as Shared from '../../shared/types'

declare global {
  type EngineId = Shared.EngineId
  type ProjImage = Shared.ProjImage
  type ProjAudio = Shared.ProjAudio
  type ProjVideo = Shared.ProjVideo
  type VideoRef = Shared.VideoRef
  type AudioRef = Shared.AudioRef
  type VideoEditSession = Shared.VideoEditSession
  type VideoEditNode = Shared.VideoEditNode
  type VeditArgs = Shared.VeditArgs
  type VeditResult = Shared.VeditResult
  type TimelineMusic = Shared.TimelineMusic
  type TimelineAudioItem = Shared.TimelineAudioItem
  type TimelineMarker = Shared.TimelineMarker
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
  type ScoreClip = Shared.ScoreClip
  type ScoreRenderArgs = Shared.ScoreRenderArgs
  type VoiceRenderArgs = Shared.VoiceRenderArgs
  type VoiceRenderResult = Shared.VoiceRenderResult
  type ScoreRenderResult = Shared.ScoreRenderResult
  type ScoreBeat = Shared.ScoreBeat
  type ScoreRecipe = Shared.ScoreRecipe
  type ScoreTake = Shared.ScoreTake
  type TimelineScoreItem = Shared.TimelineScoreItem
  type VoiceClip = Shared.VoiceClip
  type VoiceTake = Shared.VoiceTake
  type VoiceRecipe = Shared.VoiceRecipe
  type Timeline = Shared.Timeline
  type TimelineItem = Shared.TimelineItem
  type ItemFx = Shared.ItemFx
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
  type CoDirLiveWrite = Shared.CoDirLiveWrite
  type CoDirScreenEvent = Shared.CoDirScreenEvent
  type PeekClip = Shared.PeekClip
  type PeekProject = Shared.PeekProject
  type SendSelection = Shared.SendSelection
  type SendResult = Shared.SendResult
  type EditSession = Shared.EditSession
  type EditNode = Shared.EditNode
  // a recent-project card in the Open picker (name/thumb read live from each project.json)
  type ProjectCard = { dir: string; name: string; thumb?: string; clips: number; images: number }
  // a playground-shelf card (sample project) — cached = the zip already lives in userData
  type PlaygroundCard = { id: string; name: string; blurb: string; bytes: number; cached: boolean; busy: boolean }
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
    editCreateClip: (req: Omit<EditArgs, 'jobId' | 'clipId'>) => Promise<{ delta: ProjectDelta; clipId: string } | null>
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
    playgroundList: () => Promise<PlaygroundCard[]>
    playgroundStamp: (id: string) => Promise<{ ok: boolean; dir?: string; error?: string }>
    playgroundClear: (id: string) => Promise<boolean>
    onPlaygroundProgress: (cb: (p: { id: string; pct: number; msg?: string }) => void) => () => void
    hfValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    arkValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    astriaValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    projectRenameAt: (dir: string, name: string) => Promise<{ ok: boolean; error?: string }>
    projectDuplicateAt: (dir: string) => Promise<{ ok: boolean; dir?: string; error?: string }>
    projectRemoveRecent: (dir: string) => Promise<boolean>
    projectDeleteAt: (dir: string) => Promise<{ ok: boolean; error?: string }>
    projectStateSave: (name: string) => Promise<ProjectStateInfo | null>
    projectStateList: () => Promise<ProjectStateInfo[]>
    projectStateRestore: (file: string) => Promise<Project | null>
    projectStateDelete: (file: string) => Promise<boolean>
    spendAdd: (entry: { label: string; kind: 'gen' | 'edit' | 'image'; cost: number }) => Promise<{ total: number } | null>
    spendList: () => Promise<{ total: number; entries: SpendEntry[] }>
    projectUndo: () => Promise<Project | null>
    queueSave: (rows: unknown[]) => Promise<boolean>
    queueLoad: () => Promise<unknown[] | null>
    onSaveError: (cb: (msg: string | null) => void) => () => void
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
    videoImport: () => Promise<{ delta: ProjectDelta; importedIds: string[]; failed: string[] } | null>
    videoImportPaths: (paths: string[]) => Promise<{ delta: ProjectDelta; importedIds: string[]; failed: string[] } | null>
    videoRename: (id: string, title: string) => Promise<ProjectDelta | null>
    videoDelete: (id: string) => Promise<ProjectDelta | null>
    videoMakeClip: (videoId: string) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    videoAddTakeToClip: (videoId: string, clipId: string) => Promise<{ delta: ProjectDelta; takeId: string } | null>
    veditRun: (req: VeditArgs) => Promise<VeditResult>
    veditBakeLibrary: (sessionId: string, nodeId: string) => Promise<{ delta: ProjectDelta; videoId: string } | null>
    veditBakeClip: (sessionId: string, nodeId: string, target: { clipId?: string; newClipName?: string }) => Promise<{ delta: ProjectDelta; clipId: string; takeId: string } | null>
    veditSetPrimary: (sessionId: string, nodeId: string | null) => Promise<ProjectDelta | null>
    veditDeleteBranch: (sessionId: string, nodeId: string) => Promise<ProjectDelta | null>
    timelineSetMusic: (timelineId: string, music: TimelineMusic | null) => Promise<ProjectDelta | null>
    timelineSetMutes: (timelineId: string, mutes: { videoMuted?: boolean; musicMuted?: boolean }) => Promise<ProjectDelta | null>
    timelineSetExportPrefs: (timelineId: string, prefs: { exportRes?: '480' | '720' | '1080'; exportFps?: 'auto' | '24' | '30'; exportQuality?: 'draft' | 'standard' | 'high' }) => Promise<ProjectDelta | null>
    exportRun: (timelineId: string, bakes?: { start: number; end: number; file: string }[]) => Promise<{ ok: boolean; file?: string; error?: string }>
    exportCancel: () => Promise<boolean>
    appProgress: (v: number) => Promise<void>
    onExportProgress: (cb: (msg: string) => void) => () => void
    // ----- EFFECTS v2 (fx stacks persist via timeline:set; the v16 setItemFx IPC is deleted) -----
    fxSidecars: (takeFile: string) => Promise<{ matte?: string; depth?: string }>
    fxProbe: (file: string) => Promise<{ duration: number; codec: string; width: number; height: number; fps: number }>
    fxEnsureModel: (kind: 'matte' | 'depth') => Promise<{ ok: boolean; path?: string; error?: string }>
    fxDeleteModel: (kind: 'matte' | 'depth') => Promise<boolean>
    fxReadModel: (kind: 'matte' | 'depth') => Promise<Uint8Array | null>
    onFxModelProgress: (cb: (p: { kind: string; pct: number; got: number; total: number }) => void) => () => void
    // ----- Models card (LOCAL-MODELS-PLAN phases 2+3) — the one download surface -----
    modelsList: () => Promise<{
      rows: { id: string; status: 'ready' | 'downloading' | 'none'; bytes: number; pct: number; weightsBytes?: number }[]
      envs: { engine: string; bytes: number }[]
      gpu: { name: string; vramMB: number } | null
    }>
    modelsDownload: (id: string) => Promise<{ ok: boolean; error?: string }>
    modelsCancel: (id: string) => Promise<boolean>
    modelsDelete: (id: string) => Promise<boolean>
    modelsRuntimeTest: () => Promise<{ ok: boolean; detail: string }>
    modelsDiskFree: () => Promise<number | null>
    modelsFreeGpu: () => Promise<number | null>
    wavePeaks: (file: string) => Promise<{ dur: number; pps: number; peaks: Float32Array; beats: number[] } | null>
    onModelsProgress: (cb: (p: { id: string; pct: number; got: number; total: number; note?: string }) => void) => () => void
    onModelsStarted: (cb: (p: { id: string }) => void) => () => void
    onModelsDone: (cb: (p: { id: string; ok: boolean; error?: string }) => void) => () => void
    fxPassStart: (takeFile: string, kind: 'matte' | 'depth', w: number, h: number, fps: number) => Promise<{ ok: boolean; id?: string; error?: string }>
    fxEncodeFrame: (id: string, frame: Uint8Array) => Promise<boolean>
    fxEncodeEnd: (id: string, keep: boolean) => Promise<{ ok: boolean; file?: string; error?: string }>
    exportPlan: (timelineId: string) => Promise<{ W: number; H: number; fps: number } | null>
    fxBakeStart: (w: number, h: number, fps: number) => Promise<{ ok: boolean; id?: string; file?: string; error?: string }>
    clipRename: (clipId: string, name: string) => Promise<ProjectDelta | null>
    clipNew: (name?: string) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    clipSetPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<ProjectDelta | null>
    scoreRender: (req: ScoreRenderArgs) => Promise<ScoreRenderResult>
    scoreCompose: (args: { scoreClipId: string; timelineId?: string; scoreItemId?: string }) => Promise<{ ok: boolean; delta?: ProjectDelta; scoreClipId?: string; created?: boolean; beatCount?: number; error?: string }>
    scoreNew: (name?: string) => Promise<{ delta: ProjectDelta; scoreClipId: string } | null>
    scoreSet: (id: string, patch: { name?: string; beats?: ScoreBeat[]; recipe?: ScoreRecipe }) => Promise<ProjectDelta | null>
    scoreSetKeeper: (id: string, takeId: string) => Promise<ProjectDelta | null>
    scoreTakeMeta: (id: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => Promise<ProjectDelta | null>
    scoreFromTake: (id: string, takeId: string) => Promise<{ delta: ProjectDelta; newScoreClipId: string } | null>
    scoreDelete: (id: string) => Promise<ProjectDelta | null>
    scoreDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newScoreClipId: string } | null>
    charSheetNew: (name?: string) => Promise<{ delta: ProjectDelta; sheetId: string } | null>
    charSheetSet: (id: string, patch: { name?: string; imageId?: string | null; character?: CharacterField; voiceId?: string | null }) => Promise<ProjectDelta | null>
    charSheetDelete: (id: string) => Promise<ProjectDelta | null>
    voiceNew: (name?: string) => Promise<{ delta: ProjectDelta; voiceClipId: string } | null>
    voiceSet: (id: string, patch: { name?: string; recipe?: VoiceRecipe }) => Promise<ProjectDelta | null>
    voiceSetKeeper: (id: string, takeId: string) => Promise<ProjectDelta | null>
    voiceTakeDuration: (id: string, takeId: string, sec: number) => Promise<ProjectDelta | null>
    voiceTakeMeta: (id: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => Promise<ProjectDelta | null>
    voiceFromTake: (id: string, takeId: string) => Promise<{ delta: ProjectDelta; newVoiceClipId: string } | null>
    voiceTakeDelete: (id: string, takeId: string) => Promise<ProjectDelta | null>
    voiceDelete: (id: string) => Promise<ProjectDelta | null>
    voiceRender: (req: VoiceRenderArgs) => Promise<VoiceRenderResult>
    voiceDescribe: (sheetId: string) => Promise<{ ok: boolean; desc?: string; error?: string }>
    itemsReorder: (kind: 'bin' | 'lib', movedIds: string[], targetId: string) => Promise<ProjectDelta | null>
    styleNew: (name?: string) => Promise<{ delta: ProjectDelta; styleId: string } | null>
    styleSet: (id: string, patch: { name?: string; scene?: SceneFields; production?: ProductionFields; enhanced?: string[] }) => Promise<ProjectDelta | null>
    styleDelete: (id: string) => Promise<ProjectDelta | null>
    timelineSet: (timelineId: string, items: TimelineItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineSetBoth: (timelineId: string, items: TimelineItem[], audioItems: TimelineAudioItem[] | null, baseRev?: number) => Promise<ProjectDelta | null>
    timelineSlice: (timelineId: string, itemId: string, cutSec: number) => Promise<ProjectDelta | null>
    timelineSetAudioItems: (timelineId: string, audioItems: TimelineAudioItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineSetScoreItems: (timelineId: string, scoreItems: TimelineScoreItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineUnlinkAudio: (timelineId: string, itemId: string) => Promise<ProjectDelta | null>
    timelineSetMeta: (
      timelineId: string,
      patch: Partial<Pick<Timeline, 'videoTracks' | 'audioTracks' | 'markers' | 'rangeInSec' | 'rangeOutSec' | 'lockedTracks' | 'mutedTracks' | 'soloTracks'>>
    ) => Promise<ProjectDelta | null>
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
    takeSetMeta: (clipId: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => Promise<ProjectDelta | null>
    takeSetDuration: (clipId: string, takeId: string, durationSec: number) => Promise<ProjectDelta | null>
    importPickProject: (title?: string) => Promise<PeekProject | null>
    importClips: (dir: string, clipIds: string[]) => Promise<{ delta: ProjectDelta; imported: number } | null>
    sendAssets: (destDir: string, sel: SendSelection) => Promise<SendResult>
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
    folderAdd: (kind: 'bin' | 'lib' | 'sheet' | 'score' | 'voice' | 'style', name: string, parent: string | null) => Promise<{ delta: ProjectDelta; folderId: string } | null>
    folderRename: (id: string, name: string) => Promise<ProjectDelta | null>
    folderDelete: (id: string) => Promise<ProjectDelta | null>
    itemMove: (kind: 'bin' | 'lib' | 'sheet' | 'score' | 'voice' | 'style', itemId: string | string[], folderId: string | null) => Promise<ProjectDelta | null>
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
    onCodirProgress: (cb: (e: { kind: 'status' | 'text' | 'wrote' | 'live' | 'screen'; text?: string; live?: CoDirLiveWrite; screen?: CoDirScreenEvent }) => void) => () => void
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
