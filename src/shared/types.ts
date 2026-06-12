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
export const SCHEMA_VERSION = 5

export type EngineId = 'seedance2' | 'sora2'

// canonical @title form: leading @, no whitespace (used by main AND renderer so checks agree)
export function normalizeImageTitle(raw: string): string {
  let t = raw.trim()
  if (!t) return ''
  if (!t.startsWith('@')) t = '@' + t
  return t.replace(/\s+/g, '_')
}

// On disk (project.json) file paths are RELATIVE to the project dir; in memory they're ABSOLUTE.
export interface ProjImage {
  id: string
  title: string
  file: string
  folder?: string | null // library folder id (null/undefined = root)
  editedFrom?: string // lineage: the Library image this one was AI-edited from (tagged tree node)
  genPrompt?: string // the prompt that generated it
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
  engine?: EngineId // generation model; absent = 'seedance2' (filled by migration)
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
  // live-embed ONE other clip's prompt: at render the linked clip's CURRENT freeform is spliced
  // before/after this clip's own. Stored by id (survives renames); a dangling id resolves to nothing.
  promptLink?: { clipId: string; pos: 'before' | 'after' }
  // per-field links: path ('scene.style', 'production.lighting', …) → source clip id. At render the
  // source clip's SAME field is used, then this clip's own text for that field is appended.
  fieldLinks?: Record<string, string>
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
  useRecipe?: boolean // the "C" view: show the LIVE clip recipe (duration setting + current beats + keyframe), not a take
  inSec?: number // trim in-point (seconds into the source); default 0
  outSec?: number // trim out-point; default = source duration
  muted?: boolean // mute THIS instance's clip audio (playback + export) — e.g. gag one Sora clip
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
  music?: TimelineMusic
  videoMuted?: boolean // mute every clip's own audio (playback + export)
  musicMuted?: boolean // mute the music lane (playback + export)
  exportRes?: '480' | '720' | '1080' // export tier — the SHORTER side of the output (default 1080)
  exportFps?: 'auto' | '24' | '30' // export frame rate ('auto' = first rendered clip's fps)
}

export interface Project {
  schemaVersion: number
  name: string
  dir: string
  createdAt: number
  images: ProjImage[]
  audio: ProjAudio[]
  clips: Clip[]
  timelines: Timeline[]
  activeTimelineId: string // which timeline the Timeline panel / monitors show (always valid, ≥1 timeline)
  folders: Folder[]
  editSessions: EditSession[]
}

// What a mutating IPC call returns instead of the whole Project: only the slices it touched.
// clips/images are UPSERTS (matched by id); removed*Ids delete; timeline/folders replace the
// whole (small) slice. The renderer store merges this into its project copy — slices that
// didn't change keep their object identity, so unrelated subscribers don't re-render.
export interface ProjectDelta {
  clips?: Clip[]
  removedClipIds?: string[]
  images?: ProjImage[]
  removedImageIds?: string[]
  audio?: ProjAudio[] // upserts (matched by id)
  removedAudioIds?: string[]
  timelines?: Timeline[] // upserts (matched by id)
  removedTimelineIds?: string[]
  activeTimelineId?: string
  folders?: Folder[]
  editSessions?: EditSession[] // upserts (matched by id)
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
  fieldLinks?: Record<string, string>
}

export interface RenderResult {
  ok: boolean
  bytes?: Uint8Array
  delta?: ProjectDelta
  clipId?: string
  takeId?: string
  error?: string
}

export interface Settings {
  falKey?: string
  falAdminKey?: string
  astriaKey?: string
  anthropicKey?: string
  lastProjectDir?: string
  recentProjects?: string[] // most-recent-first project dirs (capped; header "Open ▾" list)
  workspaces?: Record<string, unknown> // name → dockview layout JSON (global, named layout presets)
  activeWorkspace?: string
  showFilmstrips?: boolean
  [k: string]: unknown
}

export interface FalCredit {
  ok: boolean
  balance?: number
  currency?: string
  error?: string
}
