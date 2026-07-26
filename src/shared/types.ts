// Single source of truth for the data model — imported by BOTH the main process and the renderer.
// (Previously these shapes were duplicated in src/main/project.ts and src/renderer/src/env.d.ts and
// could drift silently. Renderer code keeps using the bare global names via env.d.ts aliases.)

// bump when the project.json shape changes; openProject() migrates older files forward
// v2: Take gains durationSec (actual rendered length) + snapshot (frozen recipe at render time);
//     TimelineItem gains useRecipe (the "C" live-recipe view). All optional → migration is a stamp.
// v3: MULTIPLE named timelines — Project.timeline: TimelineItem[] becomes Project.timelines: Timeline[]
//     (+ activeTimelineId); the old array migrates into "Timeline 1".
// v4: image-editor results TREE — Project.editSessions[] (one per edited Library image, generated
//     variants as parent→child nodes); ProjImage gains editedFrom/genPrompt lineage. All optional.
// v5: MUSIC — Project.audio: ProjAudio[] (imported music files); Timeline gains music (one item:
//     audioId + startSec + in/out), videoMuted, musicMuted. All additive.
// v6: PROJECT STYLES — Project.styles: ProjectStyle[] (named, clip-independent bundles of the
//     universal fields); PromptData.fieldLinks values become ORDERED ARRAYS of source ids
//     (style or clip) so links stack. Old single-string links migrate to one-element arrays.
// v7: CO-DIRECTOR — Project.codir: { log, brief } (persisted conversation + the AI's project note);
//     PromptData.enhanced / ProjectStyle.enhanced mark AI-written field paths; CharacterField gains
//     movement/emotionalState/stateInThisScene/power; ProductionFields gains animationStyle.
//     All additive/optional → migration is a stamp + codir default.
// v8: Clip.storyboardImageId — which ref image VISUALLY represents a take-less clip (storyboard
//     face) in the monitors/timeline. Display-only (never sent to the model); optional → stamp.
// v9: PromptData.characterLinks — LIVE-linked characters borrowed from other clips (by clip id +
//     character name), each with optional per-field override text appended after the source's
//     value; resolved at emit/render time like fieldLinks. Optional → stamp.
// v10: BeatField.refImageId — a beat's MANUAL placeholder graphic (display-only storyboard frame,
//     never emitted into the prompt; the model keeps the ref loose). Optional → stamp.
// v11: BeatField.id — stable beat identity (stamped by migration, minted on creation). Anchors the
//     display layer across Co-Director rewrites: its beat writes carry graphics over BY ID, exactly.
// v12: CHAR SHEETS — Project.charSheets: CharSheet[] (a character's image + universal description,
//     linkable into clips like a live character); ProjectDelta gains clipsOrder/imagesOrder so
//     manual Bin/Library re-ordering can reach the renderer. All additive → migration is a stamp.
// v13: AUDIO LANES — Timeline.audioItems: TimelineAudioItem[] (a video block's audio detached onto
//     one of 3 absolute-time lanes; linkable back to its block by offset so it follows re-flows).
//     Additive → migration is a stamp.
export const SCHEMA_VERSION = 13

export type EngineId = 'seedance2' | 'sora2' | 'omniflash'

// canonical @title form: leading @, then WORD CHARS ONLY (used by main AND renderer so checks agree).
// the char set must stay in lockstep with the /@\w+/ mention regex (emitYaml) and the rename-rewrite
// regexes (project.ts) — a title with a hyphen would be un-@mentionable, so everything else becomes _
export function normalizeImageTitle(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const body = (t.startsWith('@') ? t.slice(1) : t).replace(/[^\w]+/g, '_')
  return body ? '@' + body : ''
}

// On disk (project.json) file paths are RELATIVE to the project dir; in memory they're ABSOLUTE.
export interface ProjImage {
  id: string
  title: string
  file: string
  srcPath?: string // the EXTERNAL path this was imported from — dedup key so re-drags don't re-copy
  folder?: string | null // library folder id (null/undefined = root)
  editedFrom?: string // lineage: the Library image this one was AI-edited from (tagged tree node)
  genPrompt?: string // the prompt that generated it
  // a LIVE first/last-frame still of a timeline instance: re-extracted whenever that instance's
  // frame moves (trim/slice/take swap/undo). Binding dropped (image freezes static) if the instance
  // is removed. sig = source-file|time of the last extraction; rev busts the renderer's img cache.
  dynamic?: { itemId: string; edge: 'first' | 'last'; sig?: string; rev?: number }
}

export interface Folder {
  id: string
  name: string
  parent: string | null
  kind: 'bin' | 'lib'
}

// an imported music/audio file (lives in <project>/audio/)
export interface ProjAudio {
  id: string
  title: string
  file: string
  srcPath?: string // the EXTERNAL path this was imported from — dedup key so re-drags don't re-copy
  durationSec?: number // learned by the renderer on first metadata load (absent = unknown yet)
}

export interface Take {
  id: string
  file: string
  createdAt: number
  seed?: number
  engine?: EngineId // which model rendered this take (absent on takes from before the registry)
  durationSec?: number // ACTUAL rendered video length — drives the timeline block length (backfilled on first play if missing)
  snapshot?: PromptData // the recipe FROZEN at render time (beats/refs/settings); takes are immutable records.
  // absent on pre-v2 takes → views fall back to the clip's live recipe
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
  // v7 (all optional) — the Seedance guide's conditional character sub-fields: the model parses
  // movement/state rules INSIDE the character block far better than in the avoid list
  movement?: string // movement_in_this_scene — restrictions/shape of movement for THIS clip
  emotionalState?: string // tone/demeanor carried through the clip
  stateInThisScene?: string // starting state (wounds, posture, activity) — multi-clip continuity
  power?: string // mechanical behavior of an ability that activates in this clip
}

export interface BeatField {
  // stable identity — anchors display-only data (the placeholder graphic) across rewrites,
  // including the Co-Director's whole-array beat writes. Never emitted into the prompt.
  id?: string
  name: string
  length: number
  camera: string
  action: string
  lighting: string
  dialogue?: string
  vfx?: string
  reaction?: string
  sfx?: string
  // MANUAL placeholder graphic for this beat's storyboard frame (Library image id) — display-only:
  // it wins over the auto @mention pick everywhere beat thumbs show, but is NEVER written into the
  // emitted prompt, so the model keeps full freedom in how it uses the ref
  refImageId?: string
}

export interface ProductionFields {
  audioDesign: string
  lighting: string
  subtext: string
  criticalConstraint: string
  avoid: string
  animationStyle?: string // v7 — frame-rate cadence, interpolation rules, stop-motion holds
}

// a named, clip-independent bundle of the universal generative fields (scene + production) —
// linkable into any clip's same field exactly like a clip field-link, and the future anchor for
// rules-driven prompt enhancement. No file paths inside → toAbsolute/toRelative skip styles.
export interface ProjectStyle {
  id: string
  name: string
  scene: SceneFields
  production: ProductionFields
  enhanced?: string[] // v7 — field paths last written by the Co-Director (cleared on manual edit)
}

// v2v: which video an edit clip works on. Stored by ids for navigation AND by file path so the
// source survives even if the source clip is later deleted. `file` is PROJECT-RELATIVE in memory
// and on disk (unlike other file fields) — resolve with join(project.dir, file) at use sites; this
// keeps toAbsolute/toRelative from having to walk into PromptData.
export interface SourceVideo {
  clipId: string
  takeId: string
  file: string // project-relative path of the source take's video
  inSec?: number // segment window (absent = whole video)
  outSec?: number
}

// a CHAR SHEET: a character's image + universal description, living OUTSIDE any clip (the
// character version of a Project Style). Character links can point at one (clipId = sheet id);
// its CURRENT fields splice in live, and its @ref resolves from imageId — rename-proof.
export interface CharSheet {
  id: string
  name: string
  imageId?: string // the character's Library image (drives the tile thumb + the linked @ref)
  character: CharacterField
}

// one LIVE-linked character: the source clip's current character (by name) renders into the
// linking clip; `override` holds optional per-field text appended AFTER the source's value
// ("add text after the linked field" — same splice rule as fieldLinks). An override
// referenceLabel REPLACES the source's @ref instead (two refs on one character make no sense).
export interface CharacterLink {
  clipId: string
  charName: string
  override?: Partial<CharacterField>
}

export interface PromptData {
  engine?: EngineId // generation model; absent = 'seedance2' (filled by migration)
  mode: 'ref2v' | 'i2v' | 'v2v'
  sourceVideo?: SourceVideo // v2v only: the video being edited
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
  // live-embed ONE other clip's prompt: at render the linked clip's CURRENT freeform is spliced
  // before/after this clip's own. Stored by id (survives renames); a dangling id resolves to nothing.
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  // per-field links: path ('scene.style', 'production.lighting', …) → ORDERED STACK of source ids.
  // Each id is a project style or a clip; at render every source's SAME field is spliced in stack
  // order, then this clip's own text for that field is appended. Dangling ids resolve to nothing.
  fieldLinks?: Record<string, string[]>
  // LIVE-linked characters borrowed from other clips: the source clip's CURRENT character block
  // (matched by name) is spliced BEFORE this clip's own characters at emit/render time. Dangling
  // links (clip gone / character renamed) resolve to nothing.
  characterLinks?: CharacterLink[]
  // v7 — field paths last written by the Co-Director ('freeform', 'scene.style', 'beats',
  // 'characters', …). The UI tints these; a manual edit of a field clears its path.
  enhanced?: string[]
}

export interface Clip {
  id: string
  name: string
  promptData: PromptData
  takes: Take[]
  keeperTakeId?: string
  folder?: string | null // bin folder id (null/undefined = root)
  // which ref image VISUALLY represents this clip while it has no render (picked in the Clip
  // Monitor's storyboard strip). Display-only; absent = auto (current beat's @ref, else first ref)
  storyboardImageId?: string
}

export interface TimelineItem {
  id: string
  clipId: string
  takeId?: string // optional per-instance take override; falls back to the clip's keeper
  useRecipe?: boolean // the "C" view: show the LIVE clip recipe (duration setting + current beats + keyframe), not a take
  inSec?: number // trim in-point (seconds into the source); default 0
  outSec?: number // trim out-point; default = source duration
  muted?: boolean // mute THIS instance's clip audio (playback + export) — e.g. gag one Sora clip
}

// a DETACHED audio block on one of the timeline's audio lanes: plays a take's audio window at an
// absolute position, independent of the video row. `link` locks it to a video block — effective
// start = that block's start + offset, so it follows the sequence through reorders/trims; absent =
// free/absolute. `startSec` is always kept refreshed as the fallback when a link dangles.
export interface TimelineAudioItem {
  id: string
  lane: number // 0..2
  source: { clipId: string; takeId: string } // the take whose AUDIO plays
  startSec: number
  inSec: number // window into the source audio
  outSec: number
  muted?: boolean
  link?: { itemId: string; offset: number }
}

// one music item per timeline (v1): a Library audio placed at startSec on the sequence, trimmable
export interface TimelineMusic {
  audioId: string
  startSec: number // where on the timeline the music begins
  inSec?: number // trim into the source audio; default 0
  outSec?: number // trim out-point; default = audio end (always clipped to the timeline length)
}

// a named sequence — lives in the Bin like a clip; the canvas every instance renders into
export interface Timeline {
  id: string
  name: string
  aspectRatio: string // the timeline's canvas, e.g. '16:9' — mismatched clips auto-FILL centered (cropped)
  items: TimelineItem[]
  rev?: number // bumped by main on every items write — compare-and-swap baseline for whole-array sets
  audioItems?: TimelineAudioItem[] // v13: detached clip audio on 3 absolute-time lanes
  music?: TimelineMusic
  videoMuted?: boolean // mute every clip's own audio (playback + export)
  musicMuted?: boolean // mute the music lane (playback + export)
  exportRes?: '480' | '720' | '1080' // export tier — the SHORTER side of the output (default 1080)
  exportFps?: 'auto' | '24' | '30' // export frame rate ('auto' = first rendered clip's fps)
}

// one Co-Director chat message; images the user @mentioned ride along by id so the transcript
// can re-render their thumbs (and so re-reads know what the model saw)
export interface CoDirMsg {
  role: 'user' | 'assistant'
  text: string
  at: number
  imageIds?: string[]
}

// the Co-Director's persisted state: the conversation log (capped) + the brief — a small note the
// AI maintains about standing project decisions ("bridge bg = @bridge for all clips"). Both live
// in the project so undo reverts a whole exchange (its writes AND its messages) coherently.
export interface CoDirState {
  log: CoDirMsg[]
  brief: string
}

export interface Project {
  schemaVersion: number
  name: string
  // a folder OUTSIDE the project (e.g. Forge's outputs) shown as a live staging strip in the
  // Library — absolute path, never relativized; files there are NOT project members until dragged in
  watchFolder?: string
  dir: string
  createdAt: number
  images: ProjImage[]
  audio: ProjAudio[]
  clips: Clip[]
  styles: ProjectStyle[] // v6: project styles — universal field bundles, linkable like clips
  charSheets: CharSheet[] // v12: characters as first-class citizens (image + universal description)
  timelines: Timeline[]
  activeTimelineId: string // which timeline the Timeline panel / monitors show (always valid, ≥1 timeline)
  folders: Folder[]
  editSessions: EditSession[]
  codir: CoDirState // v7 — Co-Director conversation + brief
}

// What a mutating IPC call returns instead of the whole Project: only the slices it touched.
// clips/images are UPSERTS (matched by id); removed*Ids delete; timeline/folders replace the
// whole (small) slice. The renderer store merges this into its project copy — slices that
// didn't change keep their object identity, so unrelated subscribers don't re-render.
export interface ProjectDelta {
  clips?: Clip[]
  removedClipIds?: string[]
  styles?: ProjectStyle[] // upserts (matched by id)
  removedStyleIds?: string[]
  charSheets?: CharSheet[] // upserts (matched by id)
  removedCharSheetIds?: string[]
  images?: ProjImage[]
  removedImageIds?: string[]
  // manual re-ordering: the FULL id list in the new order (upserts alone can't express order —
  // the store's merge keeps existing array positions)
  clipsOrder?: string[]
  imagesOrder?: string[]
  audio?: ProjAudio[] // upserts (matched by id)
  removedAudioIds?: string[]
  timelines?: Timeline[] // upserts (matched by id)
  removedTimelineIds?: string[]
  activeTimelineId?: string
  folders?: Folder[]
  editSessions?: EditSession[] // upserts (matched by id)
  watchFolder?: string | null // null = watching stopped; string = the new watched folder
  codir?: CoDirState // whole-slice replace (log is capped, brief is one string)
}

// ----- image editor: persisted results TREE (one session per edited Library image) -----
// Every Generate runs FROM a selected node (or the root image) and appends its outputs as children.
// Nothing reaches the Library until a node is TAGGED. Branches are navigable forever (persisted).
export interface EditNode {
  id: string
  parentId: string | null // null = generated directly from the root Library image
  file: string // the generated PNG (lives under <project>/images/edits/)
  prompt: string
  seed?: number
  refIds: string[] // Library images used as references for this generation
  createdAt: number
  keptImageId?: string // set when tagged → the Library image it became
}

export interface EditSession {
  id: string
  rootImageId: string // the Library image this tree edits ('' for from-scratch generation sessions)
  nodes: EditNode[]
  // "primary": the root image's CURRENT face is this node's render (the image.file points at it, so
  // every clip using the image updates automatically). undefined = the original. The original file
  // is remembered here the first time a primary is chosen, so revert always works.
  primaryNodeId?: string
  originalFile?: string
}

// listing of another project's clips for the "Import from project…" picker
export interface PeekClip {
  id: string
  name: string
  takes: number
  duration: string
  beats: number
  engine?: EngineId
  thumb?: string // data-url of the clip's first reference image (omitted if missing/huge)
}

export interface PeekProject {
  dir: string
  name: string
  clips: PeekClip[]
}

export interface RenderArgs {
  jobId?: string // queue job id — lets the renderer cancel the in-flight fal request
  engine?: EngineId // absent = 'seedance2'
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
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  fieldLinks?: Record<string, string[]>
  characterLinks?: CharacterLink[]
}

export interface RenderResult {
  ok: boolean
  file?: string // the fresh take's absolute path — the renderer streams it via media:// (never bytes over IPC)
  delta?: ProjectDelta
  clipId?: string
  takeId?: string
  error?: string
}

// v2v: one edit generation. clipId absent = first gen of a draft — main creates the edit clip
// and take together (nothing exists in the Bin until a gen succeeds).
export interface EditArgs {
  jobId?: string // queue job id — lets the renderer cancel the in-flight fal request
  engine?: EngineId
  prompt: string
  clipId?: string // existing edit clip (re-roll)
  name?: string
  source: { clipId: string; takeId: string; inSec?: number; outSec?: number }
}
export type EditResult = RenderResult

export interface Settings {
  falKey?: string
  falAdminKey?: string
  anthropicKey?: string
  lastProjectDir?: string
  recentProjects?: string[] // most-recent-first project dirs (capped; header "Open ▾" list)
  workspaces?: Record<string, unknown> // name → dockview layout JSON (global, named layout presets)
  activeWorkspace?: string
  showFilmstrips?: boolean
  snapPlayhead?: boolean // slice/trim snap to the scrubber
  snapBeats?: boolean // slice/out-trim snap to music beat ticks
  welcomeSeen?: boolean // the first-launch API-setup window was dismissed
  tourDone?: boolean // the first-run tour was finished, or skipped with "don't show again"
  activeTheme?: string // 'OG VDancer' (default) | preset name | custom theme name
  customThemes?: Record<string, Record<string, string>> // name → css-var overrides
  tileZoomBin?: number // Bin thumbnail width (px)
  tileZoomLib?: number // Library thumbnail width (px)
  previewHRender?: number // Clip Gen preview height (px, drag-resized)
  previewHClipEdit?: number // Clip Edit preview height (px, drag-resized)
  codirModel?: string // Co-Director Claude model id (default = Sonnet; set in Settings)
  codirGuideLoad?: Record<string, boolean> // guide id → load into every exchange (his instructions always load)
  codirEngine?: 'api' | 'bridge' // EXPERIMENTAL: 'bridge' runs exchanges through the user's local Claude Code CLI (subscription) instead of the API
  codirBridgeModel?: string // bridge-engine model id (default Fable 5 — subscription models, picked in Settings when bridge is on)
  renderStats?: Record<string, number[]> // engine|kind|res|dur → last few real job durations (secs) — drives the queue ETA
  [k: string]: unknown
}

// what the main window's Monitor relays to the output-mirror window: the current item's media +
// transport, as ready-to-use media:// URLs (the protocol is app-wide, so they resolve in the
// mirror window too). `time` arrives on state changes and ~1s drift ticks (never per frame);
// the mirror hard-corrects only on real drift.
export interface MirrorState {
  url?: string // current video's media:// URL (absent → imgUrl, else black)
  imgUrl?: string // storyboard still URL for take-less clips
  time?: number // source-seconds the playhead should be at
  playing?: boolean
}

export interface FalCredit {
  ok: boolean
  balance?: number
  currency?: string
  error?: string
}
