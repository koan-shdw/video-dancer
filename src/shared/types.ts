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
// v14: PREMIERE TRACKS — TimelineItem gains startSec/track/speed/transitionOutSec (absolute-time
//     free positioning, gaps legal, multiple video tracks, dissolves); Timeline gains
//     videoTracks/audioTracks counts, markers, in/out range, per-track lock/mute/solo;
//     TimelineAudioItem gains gain/fades; Take gains color/disabled. Migration stamps startSec
//     from the old gapless sequence (projects look identical on open).
// v15: DIRECTOR'S ROOM — CoDirState.openQuestions: the Co-Director's live "still to decide" list
//     (maintained via its set_open_questions tool, shown in the Director's Room). Optional → stamp.
export const SCHEMA_VERSION = 15

export type EngineId = 'seedance2' | 'seedance25' | 'seedance2hf' | 'seedance2ark' | 'sora2' | 'omniflash'

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

// an imported video file (lives in <project>/videos/). Import normalizes to H.264 mp4 ≤720p when
// the source isn't already friendly (Electron playback + Seedance ref limits want small H.264).
// Titles are PLAIN text (filename-derived) on purpose: the @video1/@audio1 prompt tags belong to
// REF SLOT POSITIONS, and an @-title here would collide with them.
export interface ProjVideo {
  id: string
  title: string
  file: string
  srcPath?: string // the EXTERNAL path this was imported from — dedup key so re-drags don't re-copy
  durationSec?: number // probed at import (ffmpeg)
  transcoded?: boolean // true = import re-encoded it (source wasn't H.264 mp4 ≤720p)
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
  color?: string // v14 — user highlight on the take card (a small fixed palette)
  disabled?: boolean // v14 — marked as a dud: dimmed everywhere, skipped by keeper auto-fallback
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

// one video reference slot (Seedance @video1/@video2/… — bound by POSITION in the array).
// Source is either a Library video (videoId) or a clip's take (takeRef). Optional in/out window:
// the render cuts that range to a temp file before upload (fal caps refs at 15s combined).
export interface VideoRef {
  videoId?: string // Library video id …
  takeRef?: { clipId: string; takeId: string } // … or a take (exactly one of the two is set)
  inSec?: number // optional trim window into the source (absent = whole video)
  outSec?: number
}

// one audio reference slot (@audio1…). Music imports are usually MINUTES long and fal caps audio
// refs at 15s combined — the window is how a usable slice gets sent (cut server-side in main).
export interface AudioRef {
  audioId: string // Library music id
  inSec?: number // optional window (absent = whole file — lint flags it when that's too long)
  outSec?: number
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
  videoRefs?: VideoRef[] // Seedance video references (@video1…) — ref2v only
  audioRefs?: AudioRef[] // Library music as audio references (@audio1…) — ref2v only
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
  useRecipe?: boolean // the "S-B" view: show the LIVE clip recipe (duration setting + current beats + keyframe), not a take
  inSec?: number // trim in-point (seconds into the source); default 0
  outSec?: number // trim out-point; default = source duration
  muted?: boolean // mute THIS instance's clip audio (playback + export) — e.g. gag one Sora clip
  // v14 — absolute-time track model (stamped by migration; treat absent as legacy-sequential):
  startSec?: number // absolute timeline position; gaps between items are legal (play/export black)
  track?: number // 0-based VIDEO track; at any instant the topmost occupied track shows
  speed?: number // playback rate (1 = normal); effective length = (out-in)/speed
  disabled?: boolean // ⊘ clip disable (Premiere Enable off): invisible + silent in playback AND export, but still occupies its slot
  transitionOutSec?: number // cross-dissolve INTO whatever follows, this many seconds
  audioDetachedId?: string // its audio was unlinked → the TimelineAudioItem carrying it (drives tint)
}

// a DETACHED audio block on one of the timeline's audio lanes: plays a take's audio window at an
// absolute position, independent of the video row. `link` locks it to a video block — effective
// start = that block's start + offset, so it follows the sequence through reorders/trims; absent =
// free/absolute. `startSec` is always kept refreshed as the fallback when a link dangles.
export interface TimelineAudioItem {
  id: string
  lane: number // 0-based AUDIO track
  source: { clipId: string; takeId: string } // the take whose AUDIO plays
  startSec: number
  inSec: number // window into the source audio
  outSec: number
  muted?: boolean
  link?: { itemId: string; offset: number }
  gain?: number // 0..2 (1 = unity) — honored in playback + export
  fadeInSec?: number // audio fade-in length
  fadeOutSec?: number // audio fade-out length
}

// one music item per timeline (v1): a Library audio placed at startSec on the sequence, trimmable
export interface TimelineMusic {
  audioId: string
  startSec: number // where on the timeline the music begins
  inSec?: number // trim into the source audio; default 0
  outSec?: number // trim out-point; default = audio end (always clipped to the timeline length)
}

// one ruler marker (M key): a named, colored flag at an absolute time
export interface TimelineMarker {
  id: string
  at: number
  name?: string
  color?: string
}

// a named sequence — lives in the Bin like a clip; the canvas every instance renders into
export interface Timeline {
  id: string
  name: string
  aspectRatio: string // the timeline's canvas, e.g. '16:9' — mismatched clips auto-FILL centered (cropped)
  items: TimelineItem[]
  rev?: number // bumped by main on every items write — compare-and-swap baseline for whole-array sets
  audioItems?: TimelineAudioItem[] // v13: detached clip audio on absolute-time lanes
  // v14 — Premiere-style track chrome:
  videoTracks?: number // how many video tracks exist (default 1); add/delete via the lane rail
  audioTracks?: number // how many audio tracks exist (default 3)
  markers?: TimelineMarker[]
  rangeInSec?: number // in/out work range — export/loop-play just this span when set
  rangeOutSec?: number
  lockedTracks?: string[] // 'v0','a2',… — locked tracks reject edits
  mutedTracks?: string[] // per-track mute (audio tracks; video tracks hide)
  soloTracks?: string[] // per-track solo (wins over mute)
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
  openQuestions?: string[] // v15 — the live "still to decide" list (Director's Room), AI-maintained
}

// one field-level write the Co-Director is making RIGHT NOW — rides the progress channel so the
// Director's Room can show the actual text landing in the project as it happens (the live stage).
// Snippets are display-capped; the full text is already in the project by the time this renders.
export interface CoDirLiveWrite {
  tool: string
  target?: string // human name of what's being written ("clip intro", "style neon_night", …)
  fields: { path: string; snippet: string }[]
}

// show_on_screen resolved — the Director's Room floats this take big behind the chat (the Screen).
// Display-only: never touches the project.
export type CoDirScreenEvent = { off: true } | { off?: false; clipId: string; clipName: string; take: number; file: string }

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
  videos: ProjVideo[] // imported reference videos (migrate() fills [] on older projects)
  clips: Clip[]
  styles: ProjectStyle[] // v6: project styles — universal field bundles, linkable like clips
  charSheets: CharSheet[] // v12: characters as first-class citizens (image + universal description)
  timelines: Timeline[]
  activeTimelineId: string // which timeline the Timeline panel / monitors show (always valid, ≥1 timeline)
  folders: Folder[]
  editSessions: EditSession[]
  videoEditSessions: VideoEditSession[] // v2v result trees (migrate() fills [] on older projects)
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
  videos?: ProjVideo[] // upserts (matched by id)
  removedVideoIds?: string[]
  timelines?: Timeline[] // upserts (matched by id)
  removedTimelineIds?: string[]
  activeTimelineId?: string
  folders?: Folder[]
  editSessions?: EditSession[] // upserts (matched by id)
  videoEditSessions?: VideoEditSession[] // upserts (matched by id)
  removedVideoEditSessionIds?: string[]
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

// ----- video editor: persisted v2v results TREE (one session per SOURCE video) -----
// The video sibling of EditSession: every Generate runs FROM a selected node (or the root source)
// and appends its output as a child. Nothing reaches the Bin/Library until a node is BAKED.
export interface VideoEditNode {
  id: string
  parentId: string | null // null = generated directly from the session source
  file: string // the generated mp4 (lives under <project>/videos/edits/)
  prompt: string
  engine: EngineId // omniflash = true edit · seedance2/25 = reference-guided re-gen
  inSec?: number // window of the SOURCE that was sent (absent = whole video)
  outSec?: number
  refSummary?: string // human-readable refs line for re-gens ("2 images · 1 audio") — inspectability
  durationSec?: number
  createdAt: number
  keptVideoId?: string // set when baked → the Library video it became
}

export interface VideoEditSession {
  id: string
  // the source this tree edits — EXACTLY one of the two is set
  rootVideoId?: string // a Library video …
  rootTake?: { clipId: string; takeId: string } // … or a clip's take (immutable — no primary allowed)
  nodes: VideoEditNode[]
  // "primary" (Library-video roots ONLY): the Library video's current face is this node's render —
  // every @video ref using it follows automatically. Takes are immutable records, so take-rooted
  // sessions never re-face anything; they bake instead.
  primaryNodeId?: string
  originalFile?: string // remembered the first time a primary is chosen, so revert always works
}

// one v2v tree generation (Video Editor) — main resolves the source, cuts the window, runs the
// engine and appends the node in a single round trip
export interface VeditArgs {
  jobId?: string
  engine: EngineId
  prompt: string
  root: { videoId?: string; takeRef?: { clipId: string; takeId: string } }
  parentId: string | null // generate FROM this node's output (null = from the root source)
  inSec?: number // window into the source being edited
  outSec?: number
  // re-gen mode only (seedance engines) — the source rides as @video1, these join it:
  imageRefIds?: string[] // Library image ids (@image refs)
  videoRefs?: VideoRef[] // EXTRA video refs (@video2…)
  audioRefs?: AudioRef[] // audio refs (@audio1…)
  duration?: string
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
}
export interface VeditResult {
  ok: boolean
  delta?: ProjectDelta
  nodeId?: string
  file?: string
  error?: string
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
  videoRefs?: VideoRef[] // Seedance @video refs — main resolves ids → files, cuts windows, uploads
  audioRefs?: AudioRef[] // Library music as @audio refs — main cuts windows / converts to mp3
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
  hfKey?: string // Higgsfield platform key — "api-key:api-secret" combined (cloud.higgsfield.ai)
  arkKey?: string // BytePlus ModelArk API key (console.byteplus.com → ModelArk → API keys)
  lastProjectDir?: string
  recentProjects?: string[] // most-recent-first project dirs (capped; header "Open ▾" list)
  workspaces?: Record<string, unknown> // name → dockview layout JSON (global, named layout presets)
  activeWorkspace?: string
  showFilmstrips?: boolean
  snapPlayhead?: boolean // slice/trim snap to the scrubber
  snapBeats?: boolean // slice/out-trim snap to music beat ticks
  welcomeSeen?: boolean // the first-launch API-setup window was dismissed
  installId?: string // anonymous per-install uuid — fal's Seedance 2.5 terms want an end_user_id
  tourDone?: boolean // the first-run tour was finished, or skipped with "don't show again"
  lastRunVersion?: string // last app version that ran — a bump means "just updated" → What's-New card
  activeTheme?: string // 'OG VDancer' (default) | preset name | custom theme name
  customThemes?: Record<string, Record<string, string>> // name → css-var overrides
  tileZoomBin?: number // Bin thumbnail width (px)
  tileZoomLib?: number // Library thumbnail width (px)
  tileTitleSize?: number // Bin/Library tile TITLE text size (px; default 10 — drives --tile-title)
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
