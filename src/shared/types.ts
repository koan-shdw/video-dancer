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
// v16: EFFECTS — TimelineItem.fx: per-block ItemFx (opacity/transform/depth dial/masks/AIR/FOCUS/
//     PUSH), composited by the WebGL compositor in preview and baked into export. AI sidecar
//     passes (subject matte / depth) live NEXT TO the take file (<file>.matte.mp4 / .depth.mp4),
//     never in the schema — takes stay immutable records. All additive → migration is a stamp.
// v17: LOOP TAIL — TimelineItem gains loop/loopTailSec (⟲ ghost repeats projected after the
//      block; no stamped copies). migrate() strips the dead v16-era `loopOf` link key. Additive.
// v18: 2026-08 FEATURE PACK — one coordinated bump for four features (map: docs/LOCAL-MODELS-PLAN.md).
//      SCORE: Project.scoreClips (music siblings of clips — timestamped beats + takes + keeper) +
//      Timeline.scoreItems (stretched score blocks) + Folder.kind 'score'. VOICES: Project.voices
//      (voice assets) + Project.voiceSessions (results trees) + CharSheet.voiceId. CO-DIRECTOR:
//      CoDirState.digests (folded history spans). LOCAL MODELS: PromptData.loras (weighted LoRA
//      stacks — ride take snapshots) + Take.localVariant + EngineId 'ltx25' (hidden registry
//      placeholder until the local runtime lands). All additive → migration is a stamp + defaults.
// v20: ONE LANE SYSTEM (docs/TIMELINE-AUDIO-SPEC.md) — TimelineAudioItem.source becomes a
//      union (clip-take audio | Library file); TimelineMusic + musicMuted are DEAD (migration
//      converts tl.music into a file-source item on its own new lane, beatGrid: true).
export const SCHEMA_VERSION = 20

export type EngineId = 'seedance2' | 'seedance25' | 'seedance2hf' | 'seedance2ark' | 'seedance25ark' | 'seedance2astria' | 'sora2' | 'omniflash' | 'ltx25'

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
  kind: 'bin' | 'lib' | 'sheet' | 'score' // clips · Library images · char sheets · score clips (v18)
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
  localVariant?: string // v18 — which installed local-model variant rendered this take (local engines only)
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
  folder?: string | null // sheet-kind folder (same system as clips/images)
  voiceId?: string // v18 — the character's voice asset (Project.voices id): linking this sheet into a clip auto-fills an @audio ref role-bound to the character (VOICES-PLAN)
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
  audioId?: string // Library music id …
  voiceId?: string // … or a project voice (VOICES-SPEC) — exactly one of the two is set
  inSec?: number // optional window (absent = whole file — lint flags it when that's too long)
  outSec?: number
  // voice-bearing slots: how Seedance reads the ref (absent = timbre — safe for old recipes).
  // 'dialogue' = the exact audio track, lip-synced (the duration match rule applies);
  // 'timbre' = voice character only, dialogue prompted in text (drift hint in the UI).
  role?: 'dialogue' | 'timbre'
  fromSheetId?: string // auto-added by a char-sheet link — unlinking the sheet removes the slot
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
  // v18 — weighted LoRA stack for engines that declare the capability (local LTX). Names are
  // LoRA file basenames from userData/models/loras/; weight 0-2 (1 = full). Frozen into take
  // snapshots automatically (a snapshot IS PromptData) and restored by take-restore.
  loras?: { name: string; weight: number }[]
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

// EFFECTS v2 — the ordered fx stack riding a timeline block. Persisted VERBATIM through
// timeline:set (main never rewrites it); the renderer validates on READ (fx/fxData readFx2) and
// clamps params at draw time (fx/core/chain), so a hand-edited or foreign value can't crash
// anything. Kept structurally loose here on purpose: the renderer's fx/core owns the real
// member shapes and the module registry defines each entry's params.
// (The v16 fixed-field ItemFx and its timeline:setItemFx sanitizer are DELETED — that shape was
// never written by the shipping panel, and the sanitizer would have silently stripped a v2
// stack to {} for any caller.)
export interface ItemFx {
  v: 2
  stack: { id: string; type: string; params?: Record<string, number> }[]
  blend?: { mode: string; opacity?: number }
}

// v19 AUDIO RUBBER BANDS (docs/AUDIO-RUBBER-BAND-SPEC.md): one volume keyframe on a block's
// envelope. `at` = seconds from the BLOCK'S TIMELINE START (post-trim placement time — trims/
// moves don't rewrite points; ones past the block's current length stay but are inert).
// Effective level everywhere = gain × env(t) × fades × mute; no points → env = 1 (untouched
// projects behave and export byte-identical). Sampling lives in shared/audioEnv.ts — the ONE
// truth for preview ticks and ffmpeg export expressions.
export interface VolumePoint {
  id: string
  at: number
  gain: number // 0..2 (1 = unity) — the level AT this point
  curve?: 'linear' | 'smooth' // shape INTO THE NEXT point (default linear; smooth = cosine ease)
}

export interface TimelineItem {
  id: string
  clipId: string
  takeId?: string // optional per-instance take override; falls back to the clip's keeper
  useRecipe?: boolean // the "S-B" view: show the LIVE clip recipe (duration setting + current beats + keyframe), not a take
  inSec?: number // trim in-point (seconds into the source); default 0
  outSec?: number // trim out-point; default = source duration
  muted?: boolean // mute THIS instance's clip audio (playback + export) — e.g. gag one Sora clip
  gain?: number // v19: linked-audio level 0..2 (1 = unity) — the block's own sound finally has a fader
  volume?: VolumePoint[] // v19 rubber band (kept sorted by `at`)
  // v14 — absolute-time track model (stamped by migration; treat absent as legacy-sequential):
  startSec?: number // absolute timeline position; gaps between items are legal (play/export black)
  track?: number // 0-based VIDEO track; at any instant the topmost occupied track shows
  speed?: number // playback rate (1 = normal); effective length = (out-in)/speed
  disabled?: boolean // ⊘ clip disable (Premiere Enable off): invisible + silent in playback AND export, but still occupies its slot
  transitionOutSec?: number // cross-dissolve INTO whatever follows, this many seconds
  audioDetachedId?: string // its audio was unlinked → the TimelineAudioItem carrying it (drives tint)
  fx?: ItemFx // EFFECTS v2 ordered stack (absent = no effects, block plays exactly as before)
  // v17 ⟲ LOOP TAIL — the block PROJECTS faded repeats after itself (no copies; every repeat
  // resolves through this one item, so trims/speed/fx/take edits restyle the whole tail live)
  loop?: boolean // tail on
  loopTailSec?: number // user-set tail LENGTH (timeline sec, rides moves/ripples); absent = elastic fill to the next block on the track / the sequence end (other blocks + music)
}

// a DETACHED audio block on one of the timeline's audio lanes: plays a take's audio window at an
// absolute position, independent of the video row. `link` locks it to a video block — effective
// start = that block's start + offset, so it follows the sequence through reorders/trims; absent =
// free/absolute. `startSec` is always kept refreshed as the fallback when a link dangles.
export interface TimelineAudioItem {
  id: string
  lane: number // 0-based AUDIO track
  // v20: TWO source kinds, one item type — a take's audio window (green) or a Library file
  // (teal ♫, absorbs the old music lane). Discriminate with `'audioId' in source`.
  source: { clipId: string; takeId: string } | { audioId: string }
  beatGrid?: boolean // ♫ this FILE item drives the beat-snap grid (at most one per timeline)
  startSec: number
  inSec: number // window into the source audio
  outSec: number
  muted?: boolean
  link?: { itemId: string; offset: number }
  gain?: number // 0..2 (1 = unity) — honored in playback + export
  fadeInSec?: number // audio fade-in length
  fadeOutSec?: number // audio fade-out length
  volume?: VolumePoint[] // v19 rubber band (kept sorted by `at`)
}

// ----- SCORE (v18): music siblings of clips — the clip grammar (plan → render → takes →
// keeper) applied to soundtrack production. Shapes per docs/SCORE-PLAN.md. -----

// the score recipe: which audio engine renders + its per-engine options. Engine ids live in the
// audio-model registry (shared/audioModels.ts — lands with the Score card build).
export interface ScoreRecipe {
  engine: string
  options?: Record<string, string | number | boolean> // registry-driven per-engine render options
}

// one timestamped musical direction: "at 10s things get intense". Beats are structure guidance
// for the emit layer, not sample-accurate cues (no model obeys exact timestamps reliably).
export interface ScoreBeat {
  id: string
  at: number // seconds from the score's start
  text: string
}

// a rendered score take — same immutable-record rules as video takes
export interface ScoreTake {
  id: string
  file: string // the rendered audio (lives under <project>/scores/)
  createdAt: number
  seed?: number
  engine?: string // which audio engine rendered it
  durationSec?: number
  snapshot?: { beats: ScoreBeat[]; recipe: ScoreRecipe } // the recipe FROZEN at render time
  color?: string
  disabled?: boolean
}

// a score clip: lives in the Bin (folder kind 'score'), drags onto the timeline as a stretched block
export interface ScoreClip {
  id: string
  name: string
  folder?: string | null
  beats: ScoreBeat[]
  recipe: ScoreRecipe
  takes: ScoreTake[]
  keeperTakeId?: string
}

// a score block stretched across a timeline span. Audio never time-stretches: a take shorter
// than the span ends early (silence after), a longer one truncates at the span end. The span is
// also compose's read-region (every clip under it feeds the beat suggestions).
export interface TimelineScoreItem {
  id: string
  scoreClipId: string
  takeId?: string // per-instance take override; falls back to the score clip's keeper
  startSec: number
  spanSec: number // the stretch length on the timeline
  inSec?: number // trim window into the take's audio
  outSec?: number
  lane?: number // v19 LANE MERGE: 0-based AUDIO lane (scores live on the shared audio lanes now, Premiere-style; absent = 0)
  gain?: number // 0..2 (1 = unity) — honored in playback + export, like TimelineAudioItem
  volume?: VolumePoint[] // v19 rubber band (kept sorted by `at`)
  fadeInSec?: number
  fadeOutSec?: number
  muted?: boolean
}

// one music item per timeline (v1): a Library audio placed at startSec on the sequence, trimmable
// DEAD as of v20 (kept only so pre-v20 project files typecheck through migration — migrate()
// converts this into a file-source TimelineAudioItem and clears the field)
export interface TimelineMusic {
  audioId: string
  startSec: number
  inSec?: number
  outSec?: number
  gain?: number
  volume?: VolumePoint[]
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
  scoreItems?: TimelineScoreItem[] // v18: stretched score blocks (additive — `music` stays untouched)
  videoMuted?: boolean // mute every clip's own audio (playback + export)
  musicMuted?: boolean // mute the music lane (playback + export)
  exportRes?: '480' | '720' | '1080' // export tier — the SHORTER side of the output (default 1080)
  exportFps?: 'auto' | '24' | '30' // export frame rate ('auto' = first rendered clip's fps)
  exportQuality?: 'draft' | 'standard' | 'high' // encode tier: draft = fast preview, high = slow + cleaner (default standard)
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
  // v18 — folded history spans (the brief mechanism generalized): older conversation ranges
  // digested by a sub-call so the live tail stays short. The raw log persists untouched;
  // read_transcript_range is the escape hatch. Written by CODIRECTOR-RLM-PLAN phase 3.
  digests?: { fromAt: number; toAt: number; text: string }[]
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
  // the project dir the watch folder was picked under — a moved/shared/downloaded copy whose dir
  // no longer matches drops the watch folder on open (media:// must not open arbitrary folders
  // named by a foreign project.json)
  watchFolderOwner?: string
  dir: string
  createdAt: number
  images: ProjImage[]
  audio: ProjAudio[]
  videos: ProjVideo[] // imported reference videos (migrate() fills [] on older projects)
  clips: Clip[]
  styles: ProjectStyle[] // v6: project styles — universal field bundles, linkable like clips
  charSheets: CharSheet[] // v12: characters as first-class citizens (image + universal description)
  scoreClips: ScoreClip[] // v18: score clips (migrate() fills [] on older projects)
  voices: ProjVoice[] // v18: voice assets — <project>/voices/ (migrate() fills [])
  voiceSessions: VoiceSession[] // v18: voice results trees (migrate() fills [])
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
  scoreClips?: ScoreClip[] // v18: upserts (matched by id)
  removedScoreClipIds?: string[]
  voices?: ProjVoice[] // v18: upserts (matched by id)
  removedVoiceIds?: string[]
  voiceSessions?: VoiceSession[] // v18: upserts (matched by id)
  removedVoiceSessionIds?: string[]
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

// ----- VOICES (v18): character voice assets + results trees. Shapes per docs/VOICES-PLAN.md. -----

// a kept voice sample — its own Library kind ON PURPOSE: audio-ref/music pickers must not fill
// with voice samples, and voice pickers must not fill with music (ProjAudio stays music-only)
export interface ProjVoice {
  id: string
  title: string
  file: string // the voice sample (lives under <project>/voices/)
  srcPath?: string // the EXTERNAL path this was imported from — dedup key, same as other imports
  durationSec?: number
  // THE voice description prompt (VOICES-SPEC): written by hand or the describe-voice sub-call,
  // carried into the Seedance YAML as character_modeling.<char>.voice. The desc lives on the
  // voice — every sheet bound to it reads/edits the same words.
  desc?: string
}

// one voice generation — a node in the results tree (Image Editor grammar: branch from any
// node, refine, nothing is real until KEPT)
export interface VoiceNode {
  id: string
  parentId: string | null // null = generated from the session's starting point
  file: string // the generated audio (lives under <project>/voices/tree/)
  engine: string // audio-registry voice engine id
  prompt: string // the voice description, or the refinement on top of the parent
  refAudioId?: string // clone mode: the Library audio the voice was cloned from
  testLine?: string // the spoken test line this node read
  createdAt: number
  keptVoiceId?: string // set when kept → the ProjVoice it became
}

export interface VoiceSession {
  id: string
  sheetId?: string // the char sheet this session designs for (absent = free-standing)
  nodes: VoiceNode[]
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
  // the FROZEN recipe this node was rendered with (re-gen engines; absent on omni + pre-merge
  // nodes) — powers ↻ re-run-as-sibling and rides into the snapshot when the node bakes to a take
  imageRefIds?: string[]
  videoRefs?: VideoRef[]
  audioRefs?: AudioRef[]
  duration?: string
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
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

// ----- SEND TO PROJECT: push assets from the OPEN project into another project on disk (the
// reverse of Import — same copy engine). Not persisted; no schema bump. -----
export interface SendSelection {
  clipIds?: string[]
  imageIds?: string[]
  audioIds?: string[]
  sheetIds?: string[]
  timelineIds?: string[]
}
export interface SendResult {
  ok: boolean
  error?: string
  sent?: { clips: number; images: number; audio: number; sheets: number; timelines: number; videos: number }
  skipped?: string[] // human-readable "didn't make it" lines (dead files) — surfaced in the toast, never silent
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

// SCORE render (v18): main resolves the score clip's CURRENT beats + recipe, emits the
// engine-specific prompt, renders on fal and lands the take — one round trip, snapshot frozen
// at submit (SCORE-PLAN phase 3)
export interface ScoreRenderArgs {
  jobId?: string // queue job id — lets the renderer cancel the in-flight fal request
  scoreClipId: string
  engine: string // audio-registry engine id (shared/audioModels.ts)
  durationSec?: number // ETA-bucket hint for the queue's history key — main reads the RECIPE, not this
}
export interface ScoreRenderResult {
  ok: boolean
  delta?: ProjectDelta
  scoreClipId?: string
  takeId?: string
  file?: string
  error?: string
}

// VOICE render (VOICES-SPEC-2026-08-20): main resolves the clone reference, renders on fal and
// appends the candidate to the session's tree — one round trip, the score pattern.
export interface VoiceRenderArgs {
  jobId?: string // queue job id — lets the renderer cancel the in-flight fal request
  sessionId: string
  parentId?: string | null // branch point (absent/null = a root candidate)
  engine: string // audio-registry voice engine id (shared/audioModels.ts)
  mode: 'design' | 'clone'
  desc?: string // design mode: the voice description (stored as the node's prompt)
  refinement?: string // branching: the refinement on top of the parent (stored as the prompt)
  text?: string // the spoken test line / dialogue
  refVoiceId?: string // clone source: a kept project voice …
  refAudioId?: string // … or a Library track …
  refNodeId?: string // … or another node in this session (iterate on a candidate)
  options?: Record<string, string | number | boolean> // engine dials (exaggeration/cfg/temperature/seed/language)
}
export interface VoiceRenderResult {
  ok: boolean
  delta?: ProjectDelta
  sessionId?: string
  nodeId?: string
  file?: string
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
  // re-gen engines (seedance) only — the source rides as @video1, these join it:
  imageRefIds?: string[] // Library image ids (@image refs)
  videoRefs?: VideoRef[] // EXTRA video refs (@video2…)
  audioRefs?: AudioRef[] // audio refs (@audio1…)
  duration?: string
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
}
export type EditResult = RenderResult

export interface Settings {
  falKey?: string
  falAdminKey?: string
  anthropicKey?: string
  hfKey?: string // Higgsfield platform key — "api-key:api-secret" combined (cloud.higgsfield.ai)
  arkKey?: string // BytePlus ModelArk API key (console.byteplus.com → ModelArk → API keys)
  astriaKey?: string // Astria API key (astria.ai → Account → API) — Seedance 2 on their credits
  lastProjectDir?: string
  recentProjects?: string[] // most-recent-first project dirs (capped; header "Open ▾" list)
  lastExportDirs?: Record<string, string> // project dir → last export folder (dialog reopens there; capped)
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
  tlRowH?: number // timeline video track row height (px, drag-resized; default 56)
  tlLaneH?: number // timeline audio lane height (px, drag-resized; default 22)
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
