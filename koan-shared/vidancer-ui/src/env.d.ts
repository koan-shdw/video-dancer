/// <reference types="vite/client" />

// The data model lives in ONE place — src/shared/types.ts — imported by main and renderer alike.
// Renderer code uses the bare global names (BeatField, Clip, …); these aliases keep that working
// while making drift between the two sides impossible.
import type * as Shared from './shared/types'

declare global {
  // ----- Image Gen wire shapes (mirrors of src/main/{krea2Local,civitai,loraFolders,pngMeta}.ts) -----
  interface ImageGenStatus {
    engine: boolean // the local engine is installed
    pack: boolean // the krea2edit nodes are inside it
    essentials: boolean
    official: string[] // installed official build row ids
    civit: { id: string; versionId: number; file: string; name: string; versionName?: string; baseModel?: string; bytes: number; homepage?: string; thumb?: string }[]
  }
  type LoraFamilyKey = 'krea2' | 'ltx' | 'h3'
  interface LoraFolder {
    path: string
    family: LoraFamilyKey // folder = family (MINIMAX-H3-LOCAL-SPEC §4.2)
  }
  interface FolderLoraRow {
    root: string
    rel: string
    file: string
    bytes: number
    name: string
    baseModel?: string // what Civitai / the installer says
    tag?: LoraFamilyKey // his right-click family — outranks everything
    triggerWords: string[]
    thumb?: string
    sha256?: string
    civitKey?: string
    homepage?: string
    looked: boolean
  }
  // an image he liked on civitai.com (CIVIT-LIKES-SPEC-2026-09-09) — the Watched panel's civit tab
  interface CivitLikedImage {
    id: number
    thumbUrl: string
    fullUrl: string
    width: number
    height: number
    username?: string
    hasPrompt: boolean
    cachedFile?: string
  }
  interface CivitBrowseArgs {
    type: 'LORA' | 'Checkpoint'
    baseModels: string[]
    query?: string
    sort?: 'downloads' | 'newest'
    favorites?: boolean
    cursor?: string
    limit?: number
  }
  interface CivitVersionRow {
    key: string
    modelId: number
    versionId: number
    name: string
    modelName: string
    versionName?: string
    author?: string
    type: string
    baseModel: string
    triggerWords: string[]
    images: string[]
    file: string
    url: string
    bytes?: number
    sha256?: string
    downloads?: number
    homepage: string
    publishedAt?: string
  }
  interface PngSettings {
    source: 'comfy' | 'a1111' | 'none' | 'civit'
    prompt: string
    negative?: string
    model?: string
    width?: number
    height?: number
    seed?: number
    steps?: number
    cfg?: number
    sampler?: string
    scheduler?: string
    loras: { name: string; weight: number; versionId?: number; baseModel?: string }[] // baseModel: the civit lane only (what the lora was made for)
  }
  type EngineId = Shared.EngineId
  type BridgeRow = Shared.BridgeRow
  // list 52: a model of Topaz Video on this PC, read from its own model files (main/enhance.ts)
  type EnhanceTopazModel = { id: string; name: string; desc?: string; sliders: { key: string; label: string; min: number; max: number; def: number }[] }
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
  type LoraRow = Shared.LoraRow
  type LoraCatalogItem = Shared.LoraCatalogItem
  type LoraSidecar = Shared.LoraSidecar
  type CharLinkTextKey = Shared.CharLinkTextKey
  type Clip = Shared.Clip
  type SheetMode = Shared.SheetMode
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
  type ImageGenJob = Shared.ImageGenJob
  type ImageGenRecipe = Shared.ImageGenRecipe
  type CodirTag = { key: string; name: string; file?: string; civit?: { id: number; thumbUrl: string } } // a ~ tag (CODIR-BATCH-SPEC-2026-10-03 F)
  type ImageGenTake = Shared.ImageGenTake
  type ImageGenLora = Shared.ImageGenLora
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
  type ArkSpend = Shared.ArkSpend
  type MirrorState = Shared.MirrorState
  type MoodInfo = Shared.MoodInfo
  type AssemblyState = Shared.AssemblyState
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
  // an installed (or hand-picked) image editor · a save made outside that the app should ask about
  type ExternalEditor = { id: string; name: string; exe: string }
  type PendingExternalEdit = { watchId: string; file: string; name: string; editor: string; mtime: number }
  // a playground-shelf card (sample project) — cached = the zip already lives in userData
  type PlaygroundCard = { id: string; name: string; blurb: string; bytes: number; cached: boolean; busy: boolean }
  // a named save state (metadata checkpoint in <project>/checkpoints/)
  type ProjectStateInfo = { file: string; name: string; savedAt: number }
  // one paid-job entry in the project's spend ledger (<project>/spend.json, outside undo)
  type SpendEntry = { at: number; label: string; kind: 'gen' | 'edit' | 'image' | 'watch'; cost: number }

  // Mutating calls return a ProjectDelta (only the slices they touched) — the store merges it.
  // Project open/new/get still return the full Project.
  interface VidancerApi {
    pathForFile?: (file: File) => string
    getRecoveryStatus?: () => Promise<{ dir: string; count: number; checking: boolean; error: string }>
    appName: string
    getSettings: () => Promise<Settings>
    setSettings: (patch: Record<string, unknown>) => Promise<Settings>
    falCredit: () => Promise<FalCredit>
    arkSpend: () => Promise<ArkSpend> // list 46: this month's BytePlus bill on the Access Key
    arkSpendCheck: (ak: string, sk: string) => Promise<ArkSpend> // the same read, on a pasted pair
    pickImages: () => Promise<string[]>
    render: (opts: RenderArgs) => Promise<RenderResult>
    onRenderProgress: (cb: (p: { msg: string; pct?: number; jobId?: string }) => void) => () => void // jobId = that row only; absent = no Queue row (Assembly and the like listen for their own)
    editRun: (req: EditArgs) => Promise<EditResult>
    editCreateClip: (req: Omit<EditArgs, 'jobId' | 'clipId'>) => Promise<{ delta: ProjectDelta; clipId: string } | null>
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
    projectFindIn: () => Promise<{ ok: boolean; added: number }>
    playgroundList: () => Promise<PlaygroundCard[]>
    playgroundStamp: (id: string) => Promise<{ ok: boolean; dir?: string; error?: string }>
    playgroundClear: (id: string) => Promise<boolean>
    onPlaygroundProgress: (cb: (p: { id: string; pct: number; msg?: string }) => void) => () => void
    hfValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    arkValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    astriaValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    voiceVoices: (engine: string, search?: string) => Promise<{ ok: boolean; voices?: { id: string; label: string; title?: string }[]; error?: string }> // list 19: the ready voices of his account (ElevenLabs) · list 18: Google's library, narrowed by search words
    veniceValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    googleValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    elevenValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    blockBuild: (clipId: string) => Promise<{ ok: boolean; delta?: ProjectDelta; imageId?: string; panels?: number; error?: string }>
    // ASSEMBLY (ASSEMBLY-SPEC-2026-09-09)
    assemblyConcept: (correction?: string) => Promise<{ ok: boolean; delta?: ProjectDelta; outline?: string; error?: string }>
    assemblyLock: (locked: boolean) => Promise<ProjectDelta | null>
    assemblyAssemble: () => Promise<{ ok: boolean; delta?: ProjectDelta; timelineId?: string; placed?: number; holes?: string[]; error?: string }>
    // MOODS (.vmd library) — MOODS-VMD-SPEC-2026-09-08
    moodList: () => Promise<MoodInfo[]>
    moodRead: (slug: string) => Promise<(MoodInfo & { howToWrite: string; whatToKnow: string; text: string }) | null>
    moodSave: (input: { name: string; description?: string; triggers?: string[]; notFor?: string[]; tags?: string[]; author?: string; suffix?: string; howToWrite: string; whatToKnow: string }) => Promise<MoodInfo>
    moodDelete: (slug: string) => Promise<boolean>
    moodReveal: (slug: string) => Promise<void>
    // skills = the picked paths that are skills, not .vmd files — the fold hands those to the Co-Director (list 54)
    moodImport: () => Promise<{ slugs: string[]; errors: string[]; skills?: string[]; existing?: { path: string; slug: string }[] }>
    moodImportPaths: (paths: string[], replace?: boolean) => Promise<{ slugs: string[]; errors: string[]; skills?: string[]; existing?: { path: string; slug: string }[] }>
    moodExport: (slug: string) => Promise<boolean>
    // list 43: the community MOODS (COMMUNITY-MOODS-SPEC-2026-10-01)
    moodCommunity: () => Promise<{ ok: true; moods: import('./shared/communityMoods').CommunityMood[] } | { ok: false; error: string }>
    moodCommunityInstall: (slug: string, replace?: boolean) => Promise<{ ok: true; info: MoodInfo; replaced: boolean } | { ok: false; error: string }>
    moodCommunityShare: (slug: string) => Promise<{ ok: true; file: string } | { ok: false; error: string }>
    codirSetMoodsPinned: (slugs: string[]) => Promise<ProjectDelta | null>
    projectRenameAt: (dir: string, name: string) => Promise<{ ok: boolean; error?: string }>
    projectDuplicateAt: (dir: string) => Promise<{ ok: boolean; dir?: string; error?: string }>
    projectRemoveRecent: (dir: string) => Promise<boolean>
    projectDeleteAt: (dir: string) => Promise<{ ok: boolean; error?: string }>
    projectStateSave: (name: string) => Promise<ProjectStateInfo | null>
    projectStateList: () => Promise<ProjectStateInfo[]>
    projectStateRestore: (file: string) => Promise<Project | null>
    projectStateDelete: (file: string) => Promise<boolean>
    spendAdd: (entry: { label: string; kind: 'gen' | 'edit' | 'image' | 'watch'; cost: number }) => Promise<{ total: number } | null>
    spendList: () => Promise<{ total: number; entries: SpendEntry[] }>
    projectUndo: () => Promise<Project | null>
    queueSave: (dir: string, rows: unknown[]) => Promise<boolean>
    // a failed render, kept in the project (render-failures.json) for the Co-Director to read; optional: an older preload lacks it
    failureAdd?: (f: { label: string; kind: string; engine: string; plain: string; raw: string }) => Promise<boolean>
    queueLoad: () => Promise<unknown[] | null>
    onSaveError: (cb: (msg: string | null) => void) => () => void
    projectRedo: () => Promise<Project | null>
    projectCleanup: (apply: boolean) => Promise<{ files: number; bytes: number; busy?: boolean } | null>
    watchPick: () => Promise<ProjectDelta | null>
    watchClear: () => Promise<ProjectDelta | null>
    watchList: () => Promise<{ file: string; name: string; mtime: number }[]>
    watchAdd: (file: string) => Promise<{ ok: boolean; file?: string; error?: string }>
    mediaExportAs: (file: string, kind: 'image' | 'video' | 'audio', title: string) => Promise<{ ok: boolean; file?: string; error?: string }>
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
    libraryImportAny: () => Promise<{
      images: { delta?: ProjectDelta; importedIds: string[] } | null
      audio: { delta: ProjectDelta; importedIds: string[] } | null
      video: { delta: ProjectDelta; importedIds: string[]; failed: string[] } | null
    } | null>
    librarySaveFrame: (bytes: Uint8Array, note: string) => Promise<{ delta: ProjectDelta; imageId: string } | null>
    // paste / browser drag (UI-ROUND-SPEC §3): bytes, a link, or the clipboard → one Library image; `error` = the reason it did not
    libraryImportBytes: (name: string, bytes: Uint8Array) => Promise<{ delta?: ProjectDelta; importedIds: string[]; error?: string }>
    libraryImportUrl: (url: string) => Promise<{ delta?: ProjectDelta; importedIds: string[]; error?: string }>
    libraryClipboardHasImage: () => Promise<boolean>
    libraryClipboardImage: () => Promise<{ delta?: ProjectDelta; importedIds: string[]; error?: string }>
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
    exportRun: (timelineId: string, bakes?: { start: number; end: number; file: string }[], opts?: { batch?: boolean }) => Promise<{ ok: boolean; file?: string; error?: string }>
    exportPickDir: () => Promise<string | null> // list 5: where a run of several exports lands (the default folder, else picked once)
    settingsPickExportDir: () => Promise<string | null> // list 5: Settings' default export folder
    watchTimeline?: (args: import('./shared/watch').WatchTimelineRequest) => Promise<import('./shared/watch').WatchTimelineResult>
    watchCancel?: () => Promise<boolean>
    onWatchProgress?: (cb: (msg: string) => void) => () => void
    onWatchBake?: (cb: (request: import('./shared/watch').WatchBakeRequest) => void) => () => void
    watchBakeReply?: (reply: import('./shared/watch').WatchBakeReply) => void
    onWatchBakeCancel?: (cb: (id: string) => void) => () => void
    onWatchFinished?: (cb: () => void) => () => void
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
    // ----- BRIDGE — MCP provider logins (BRIDGE-SPEC-2026-09-01) -----
    appBoot: () => Promise<number>
    bridgeList: () => Promise<BridgeRow[]>
    bridgeLogin: (id: string, slot?: number) => Promise<BridgeRow[]>
    bridgeLogout: (id: string, slot?: number) => Promise<BridgeRow[]>
    bridgeAdd: (id: string, copy?: boolean) => Promise<{ rows: BridgeRow[]; error?: string }> // list 33: one more login of the same supplier
    bridgeRename: (id: string, slot: number, name: string) => Promise<BridgeRow[]>
    bridgeRefresh: () => Promise<BridgeRow[]>
    onBridgeChanged: (cb: () => void) => () => void
    onMoodsChanged?: (cb: () => void) => () => void // optional: an older preload (renderer hot-reloaded first) lacks it
    // open in an external editor (UI-ROUND-SPEC-2026-09-19 §2) — optional for the same reason
    editorsList?: () => Promise<ExternalEditor[]>
    editorsPick?: () => Promise<{ editors: ExternalEditor[]; picked?: string }>
    editorsOpen?: (file: string, editorId: string, sourceTitle: string, editedFrom?: string) => Promise<{ ok: boolean; editor?: string; error?: string }>
    editorsImport?: (watchId: string) => Promise<{ ok: boolean; delta?: ProjectDelta; imageId?: string; error?: string }>
    editorsDismiss?: (watchId: string) => Promise<boolean>
    onEditorsPending?: (cb: (list: PendingExternalEdit[]) => void) => () => void
    onBridgeDialog: (cb: (line: { who: 'app' | 'provider' | 'claude'; service: string; text: string }) => void) => () => void
    // ----- Models card (LOCAL-MODELS-PLAN phases 2+3) — the one download surface -----
    modelsList: () => Promise<{
      rows: { id: string; status: 'ready' | 'downloading' | 'none'; bytes: number; pct: number; weightsBytes?: number; filesDone?: number; filesTotal?: number; bytesLeft?: number; updateBytes?: number; error?: string }[]
      envs: { engine: string; bytes: number }[]
      gpu: { name: string; vramMB: number } | null
    }>
    modelsDownload: (id: string) => Promise<{ ok: boolean; error?: string }>
    modelsUpdate: (id: string) => Promise<{ ok: boolean; error?: string }> // list 15: re-fetch the files a row no longer pins
    modelsCancel: (id: string) => Promise<boolean>
    modelsDelete: (id: string) => Promise<boolean>
    modelsRuntimeTest: () => Promise<{ ok: boolean; detail: string }>
    // ----- LoRA shelf (LTX-SPEC §7) -----
    lorasList: () => Promise<{ installed: LoraRow[]; jobs: { file: string; pct: number }[]; errors: Record<string, string> }>
    lorasCivitai: (query: string, sort: 'downloads' | 'newest', baseModels?: string[]) => Promise<{ ok: boolean; items?: LoraCatalogItem[]; error?: string }>
    lorasOfficial: (family?: 'ltx' | 'h3') => Promise<{ ok: boolean; items?: LoraCatalogItem[]; error?: string }>
    lorasInstall: (item: LoraCatalogItem) => Promise<{ ok: boolean; error?: string }>
    lorasCancel: (file: string) => Promise<boolean>
    lorasDelete: (file: string) => Promise<boolean>
    lorasTag: (file: string, baseModel: string) => Promise<boolean>
    lorasThumb: (url: string) => Promise<string | null>
    lorasImport: (path: string) => Promise<{ ok: boolean; file?: string; error?: string }>
    onLorasProgress: (cb: (p: { file: string; pct: number; note?: string }) => void) => () => void
    onLorasDone: (cb: (p: { file: string; ok: boolean; error?: string }) => void) => () => void
    modelsDiskFree: () => Promise<number | null>
    modelsFolder: () => Promise<{ active: string; saved: string }>
    modelsPickFolder: () => Promise<{ active: string; saved: string } | null>
    modelsFreeGpu: () => Promise<number | null>
    wavePeaks: (file: string) => Promise<{ dur: number; pps: number; peaks: Float32Array; beats: number[] } | null>
    onModelsProgress: (cb: (p: { id: string; pct: number; got: number; total: number; note?: string }) => void) => () => void
    onModelsStarted: (cb: (p: { id: string }) => void) => () => void
    onModelsDone: (cb: (p: { id: string; ok: boolean; error?: string }) => void) => () => void
    fxPassStart: (takeFile: string, kind: 'matte' | 'depth', w: number, h: number, fps: number) => Promise<{ ok: boolean; id?: string; error?: string }>
    fxEncodeFrame: (id: string, frame: Uint8Array) => Promise<boolean>
    fxEncodeEnd: (id: string, keep: boolean) => Promise<{ ok: boolean; file?: string; error?: string }>
    exportPlan: (timelineId: string) => Promise<{ W: number; H: number; fps: number } | null>
    assetsDelete?: (selection: SendSelection) => Promise<ProjectDelta | null>
    itemsSetDisabled?: (selection: SendSelection, disabled: boolean) => Promise<ProjectDelta | null> // DISABLE-ITEMS-SPEC (optional: an older app core lacks it)
    fxBakeStart: (w: number, h: number, fps: number, projectDir?: string) => Promise<{ ok: boolean; id?: string; file?: string; error?: string }>
    clipRename: (clipId: string, name: string) => Promise<ProjectDelta | null>
    clipNew: (name?: string) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    clipSetPromptData: (clipId: string, pd: Partial<PromptData>) => Promise<ProjectDelta | null>
    scoreRender: (req: ScoreRenderArgs) => Promise<ScoreRenderResult>
    scoreCompose: (args: { scoreClipId: string; timelineId?: string; scoreItemId?: string }) => Promise<{ ok: boolean; delta?: ProjectDelta; scoreClipId?: string; created?: boolean; beatCount?: number; error?: string }>
    scoreNew: (name?: string, kind?: 'sfx') => Promise<{ delta: ProjectDelta; scoreClipId: string } | null>
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
    // ----- Image Gen (KREA2-LOCAL-SPEC-2026-09-08) -----
    imageGenNew: (name?: string, recipe?: Partial<ImageGenRecipe>) => Promise<{ delta: ProjectDelta; imageGenId: string } | null>
    imageGenSet: (id: string, patch: { name?: string; recipe?: Partial<ImageGenRecipe> }) => Promise<ProjectDelta | null>
    imageGenKeeper: (id: string, takeId: string) => Promise<ProjectDelta | null>
    imageGenTakeMeta: (id: string, takeId: string, patch: { color?: string | null; disabled?: boolean }) => Promise<ProjectDelta | null>
    imageGenTakeDelete: (id: string, takeId: string) => Promise<ProjectDelta | null>
    imageGenDelete: (id: string) => Promise<ProjectDelta | null>
    imageGenDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newId: string } | null>
    imageGenToLibrary: (id: string, takeId: string) => Promise<{ delta: ProjectDelta; imageId: string } | null>
    imageGenStatus: () => Promise<ImageGenStatus>
    imageGenRender: (req: { jobId?: string; imageGenId: string; recipe?: ImageGenRecipe }) => Promise<{ ok: boolean; delta?: ProjectDelta; takeIds?: string[]; error?: string }>
    imageGenCancel: (jobId?: string) => Promise<boolean>
    onImageGenProgress: (cb: (p: { id: string; msg: string; pct?: number }) => void) => () => void
    imageGenReadPng: (path: string) => Promise<{ ok: boolean; settings?: PngSettings; error?: string }>
    imageGenPickPng: () => Promise<string | null>
    imageGenFolders: () => Promise<LoraFolder[]>
    imageGenPickFolder: (family: LoraFamilyKey) => Promise<LoraFolder[] | null>
    imageGenForgetFolder: (dir: string) => Promise<LoraFolder[]>
    onImageGenFolders: (cb: (folders: LoraFolder[]) => void) => () => void // main picked the folder on a first download
    imageGenLoras: () => Promise<FolderLoraRow[]>
    imageGenLoraTag: (root: string, rel: string, family: LoraFamilyKey) => Promise<boolean>
    onImageGenLoraScan: (cb: (p: { done: number; total: number; finished?: boolean }) => void) => () => void
    imageGenCivit: (args: CivitBrowseArgs) => Promise<{ ok: boolean; items?: CivitVersionRow[]; nextCursor?: string; error?: string }>
    civitLiked: (cursor?: string | number) => Promise<{ ok: boolean; items?: CivitLikedImage[]; nextCursor?: string | number; error?: string }>
    civitGeneration: (id: number) => Promise<{ ok: boolean; settings?: PngSettings; error?: string }>
    civitVersionImages: (versionId: number, cursor?: string) => Promise<{ ok: boolean; items?: CivitLikedImage[]; nextCursor?: string; error?: string }>
    civitImageFile: (id: number, url: string) => Promise<{ ok: boolean; file?: string; error?: string }>
    civitMe: (key: string) => Promise<{ ok: boolean; username?: string; tier?: string; error?: string }>
    imageGenCivitDownload: (row: CivitVersionRow, family?: LoraFamilyKey) => Promise<{ ok: boolean; file?: string; error?: string }> // a lora lands in the family's first folder
    // a liked image's lora, by Civitai version id → the row the downloader takes (optional: an older app core lacks it)
    imageGenCivitGetVersion?: (versionId: number) => Promise<{ ok: boolean; row?: CivitVersionRow; error?: string }>
    imageGenCivitCancel: (key: string) => Promise<boolean>
    imageGenCivitDelete: (id: string) => Promise<boolean>
    onImageGenDlProgress: (cb: (p: { key: string; pct: number; note?: string }) => void) => () => void
    onImageGenDlDone: (cb: (p: { key: string; ok: boolean; error?: string }) => void) => () => void
    imageGenThumb: (url: string) => Promise<string | null>
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
    // AUDIO-PARITY-SPEC §4.3: video + audio lanes + ♪ scores in ONE mutation (null = untouched)
    timelineSetAll: (timelineId: string, items: TimelineItem[], audioItems: TimelineAudioItem[] | null, scoreItems: TimelineScoreItem[] | null, baseRev?: number) => Promise<ProjectDelta | null>
    // NEST (list 3): the new inner timeline + the parent after the cut, in ONE save (one Ctrl+Z)
    nestCreate: (parentId: string, inner: Timeline, items: TimelineItem[], audioItems: TimelineAudioItem[], baseRev?: number) => Promise<ProjectDelta | null>
    mediaReverse: (file: string) => Promise<{ ok: boolean; made?: boolean; error?: string }> // list 51: a take's reversed copy (made once, next to it)
    keepersSet: (kind: 'clip' | 'score' | 'voice' | 'imagegen', ownerId: string, takeIds: string[], on: boolean | null) => Promise<ProjectDelta | null> // list 6: keeper flags
    timelineSlice: (timelineId: string, itemId: string, cutSec: number) => Promise<ProjectDelta | null>
    // 41: the razor on the lanes (AUDIO-LINK-CUT-PASTE-SPEC-2026-09-23)
    timelineSliceAudio: (timelineId: string, audioId: string, cutSec: number) => Promise<ProjectDelta | null>
    timelineSliceScore: (timelineId: string, scoreId: string, cutSec: number) => Promise<ProjectDelta | null>
    timelineSetAudioItems: (timelineId: string, audioItems: TimelineAudioItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineSetScoreItems: (timelineId: string, scoreItems: TimelineScoreItem[], baseRev?: number) => Promise<ProjectDelta | null>
    timelineUnlinkAudio: (timelineId: string, itemId: string) => Promise<ProjectDelta | null>
    timelineSetMeta: (
      timelineId: string,
      patch: Partial<Pick<Timeline, 'videoTracks' | 'audioTracks' | 'scoreTracks' | 'markers' | 'rangeInSec' | 'rangeOutSec' | 'lockedTracks' | 'mutedTracks' | 'soloTracks'>>
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
    takeDelete: (clipId: string, takeId: string) => Promise<ProjectDelta | null>
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
      // MODEL · VIA row + SELECT (UI-ROUND-SPEC-2026-09-19 §6)
      model?: string
      via?: string
      resolution?: string
      quality?: string
      background?: string // list 8: GPT Image 2.5's background dial ('transparent' = a see-through PNG)
      maskPng?: Uint8Array // white inside the selection · black outside · the base's exact pixel size
      jobId?: string // 58: the queue row — its progress lands on that row
      sheetMode?: SheetMode // Sheet Gen's Nano lane: main tags the result into the Library as this sheet
    }) => Promise<{ ok: boolean; delta?: ProjectDelta; nodeIds?: string[]; error?: string }>
    imageTagNode: (sessionId: string, nodeId: string) => Promise<{ delta: ProjectDelta; imageId: string } | null>
    imageDeleteBranch: (sessionId: string, nodeId: string) => Promise<ProjectDelta | null>
    onImageProgress: (cb: (msg: string) => void) => () => void
    clipDelete: (id: string) => Promise<ProjectDelta | null>
    clipsDelete: (ids: string[]) => Promise<ProjectDelta | null>
    clipDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newClipId: string } | null>
    clipsFromImages: (imageIds: string[], place?: { timelineId: string; index: number }) => Promise<{ delta: ProjectDelta; clipIds: string[] } | null>
    // Sheet Gen (SHEET-GEN-SPEC-2026-09-08): a capture clip from an image, the harvest of one of its takes, the sheet tag
    sheetClipNew: (imageId: string, mode: SheetMode) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    sheetBuild: (clipId: string, takeId: string, pick?: number[]) => Promise<{ delta: ProjectDelta; sheetImageId: string; viewImageIds: string[] } | { error: string }>
    imageSetSheet: (imageId: string, mode: SheetMode | null) => Promise<ProjectDelta | null>
    clipFromImagesAsBeats: (imageIds: string[]) => Promise<{ delta: ProjectDelta; clipId: string } | null>
    imageDelete: (id: string) => Promise<ProjectDelta | null>
    imagesDelete: (ids: string[]) => Promise<ProjectDelta | null>
    imageCropSave: (req: { rootImageId: string; parentId: string | null; bytes: Uint8Array; label: string }) => Promise<{ delta: ProjectDelta; nodeId: string } | null>
    imageDuplicate: (id: string) => Promise<{ delta: ProjectDelta; newId: string } | null>
    imageRename: (id: string, title: string) => Promise<ProjectDelta | null>
    imageAddDynamicStill: (itemId: string, edge: 'first' | 'last') => Promise<{ delta: ProjectDelta; imageId: string } | null>
    imageSetPrimary: (sessionId: string, nodeId: string | null) => Promise<ProjectDelta | null>
    onProjectDelta: (cb: (d: ProjectDelta) => void) => () => void
    folderAdd: (kind: 'bin' | 'lib' | 'sheet' | 'score' | 'sfx' | 'voice' | 'style' | 'imagegen', name: string, parent: string | null) => Promise<{ delta: ProjectDelta; folderId: string } | null>
    folderRename: (id: string, name: string) => Promise<ProjectDelta | null>
    folderDelete: (id: string) => Promise<ProjectDelta | null>
    folderMove: (id: string, parent: string | null) => Promise<ProjectDelta | null>
    itemMove: (kind: 'bin' | 'lib' | 'sheet' | 'score' | 'sfx' | 'voice' | 'style' | 'imagegen', itemId: string | string[], folderId: string | null) => Promise<ProjectDelta | null>
    layoutSave: (json: unknown) => Promise<boolean>
    layoutLoad: () => Promise<unknown | null>
    codirSend: (req: { text: string; imageIds: string[]; selectedClipId: string | null; focus: { kind: string; ownerId: string; path?: string } | null; moods?: string[]; openImageGenId?: string | null; tags?: CodirTag[]; planApproval?: { id: string; revision: string } }) => Promise<{
      ok: boolean
      reply?: string
      error?: string
      usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; rounds: number; sections?: { guides: number; context: number; history: number; message: number; images: number } }
      logDelta?: ProjectDelta | null
    }>
    codirCancel: () => Promise<void>
    jobsState?: () => Promise<import('./shared/jobNotifications').JobState>
    onJobsState?: (cb: (state: import('./shared/jobNotifications').JobState) => void) => () => void
    codirStopPlan?: () => Promise<void>
    onCodirJobBusy?: (cb: (busy: boolean) => void) => () => void
    codirBridgeStatus: (refresh?: boolean) => Promise<{ found: boolean; version?: string; detail: string; loggedIn?: boolean }> // loggedIn = `claude auth status`; undefined = the CLI could not say
    // runs `claude update` through the bridge's runner, then re-probes (2026-09-29)
    codirBridgeUpdate: () => Promise<{ found: boolean; version?: string; detail: string; loggedIn?: boolean; updated: boolean; out: string }>
    // runs Claude Code's own `auth login` (his browser, Anthropic's page), waits for it, then re-probes (list 38)
    codirBridgeLogin: () => Promise<{ found: boolean; version?: string; detail: string; loggedIn?: boolean; ok: boolean; out: string }>
    codirBridgeModels: () => Promise<{ id: string; label: string; minCli?: string }[]>
    // list 35: the other command-line engines. cli = 'codex' (a ChatGPT login) | 'gemini' (a Google login)
    codirCliStatus: (cli: string, refresh?: boolean) => Promise<{ found: boolean; version?: string; detail: string; loggedIn?: boolean }>
    codirCliLogin: (cli: string) => Promise<{ found: boolean; version?: string; detail: string; loggedIn?: boolean; ok: boolean; out: string }> // the tool's own sign-in, his browser
    codirCliLogout: (cli: 'claude' | 'codex') => Promise<{ found: boolean; detail: string; loggedIn?: boolean; ok: boolean; out: string }>
    codirCancelLogin: (cli: string) => Promise<void>
    codirOpenaiModels: () => Promise<{ id: string; label: string }[]>
    llmValidateKey: (provider: 'openai' | 'anthropic', key: string) => Promise<{ ok: boolean; error?: string }>
    codirCliModels: (cli: string) => Promise<{ id: string; label: string }[]> // Codex: its own catalog for his login
    codirDeepseekModels: () => Promise<{ id: string; label: string }[]>
    // list 52: ENHANCE (interpolate · upscale)
    enhanceRun: (args: import('./shared/enhance').EnhanceArgs) => Promise<import('./shared/enhance').EnhanceResult>
    enhancePreview: (args: import('./shared/enhance').EnhanceArgs) => Promise<{ ok: boolean; file?: string; error?: string }>
    enhanceTools: (refresh?: boolean) => Promise<{ topaz: { found: boolean; detail: string; interp: EnhanceTopazModel[]; upscale: EnhanceTopazModel[] }; rife: boolean; esrgan: boolean }>
    enhanceFacts: (src: import('./shared/enhance').EnhanceSourceRef) => Promise<{ w: number; h: number; fps: number; sec: number } | null>
    onEnhanceProgress: (cb: (p: { msg: string; pct?: number }) => void) => () => void
    deepseekValidate: (key: string) => Promise<{ ok: boolean; error?: string }>
    codirClearLog: () => Promise<ProjectDelta | null>
    codirCompact: () => Promise<{ ok: boolean; folded?: number; error?: string }>
    codirSetBrief: (brief: string, dir?: string) => Promise<ProjectDelta | null>
    codirModels: () => Promise<{ id: string; label: string }[]>
    codirVeniceModels: () => Promise<{ id: string; label: string }[]>
    codirGuides: () => Promise<{ id: string; label: string; customised: boolean; hasLearned: boolean; loaded: boolean; path: string }[]>
    codirGuideOpen: (id: string) => Promise<string | null>
    codirGuideRevert: (id: string) => Promise<void>
    codirGuidePurgeLearned: () => Promise<void>
    onCodirProgress: (cb: (e: { kind: 'status' | 'text' | 'wrote' | 'live' | 'screen'; text?: string; live?: CoDirLiveWrite; screen?: CoDirScreenEvent }) => void) => () => void
    // list 27: main asks the window to press a render button (fire_render); the panel's status line goes back
    // (list 27: 'job' = a render whose whole recipe rides the request — a score, a voice, an image edit, a video edit)
    onCodirFire?: (cb: (req: { reqId: string } & ({ kind: 'clip'; id: string } | { kind: 'image_gen'; id: string; prompts?: string[] } | { kind: 'job'; job: { kind: 'score' | 'voice' | 'image' | 'vedit'; label: string; engineLabel: string; estCost?: number; payload: unknown } })) => void) => () => void
    codirFireDone?: (reqId: string, r: { ok: boolean; line: string }) => Promise<void>
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
