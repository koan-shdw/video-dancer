// Co-Director — the conversational copilot that writes into the project (main process).
// Talks to the Anthropic Messages API over raw fetch: this machine has no npm toolchain, so the
// official SDK can't be installed — the request/loop shapes below follow the documented wire API
// (tool_use loop, prompt caching via cache_control, base64 image blocks). Every project write
// goes through the same project.ts mutators the UI uses, so writes are undoable and delta-merged.
import { readFile, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import {
  getProject,
  newEmptyClip,
  setClipPromptData,
  newStyle,
  setStyle,
  codirAppend,
  codirSetBrief,
  codirSetOpenQuestions,
  codirAddDigest,
  newCharSheet,
  setCharSheet,
  deleteCharSheet,
  deleteClip,
  deleteStyle,
  addTimeline,
  setTimelineItems,
  renameClip,
  renameTimeline,
  duplicateClip,
  duplicateTimeline,
  deleteTimeline,
  setKeeperTake,
  setTimelineAspect,
  setActiveTimeline,
  addFolder,
  moveToFolder,
  renameImage, setImageGenData } from './project'
import { buildSystemGuides, updateGuideText, appendLearned, isGuideId, PROMPTING_GUIDE_IDS } from './guides'
import { runSubCalls } from './subcall'
import { watchVideo, WATCH_MODEL, type WatchOpts } from './watch'
import { saveMood, moodBlock } from './moods'

// what an exchange's tools may need (the WATCH lane: Google key, or the Claude route for the
// frames fallback; the MOOD author name) — stamped by index.ts per exchange like setExchangeDir,
// so runTool never reads settings itself
let exchangeKeys: WatchOpts & { moodAuthor?: string } = {}
export function setExchangeKeys(k: WatchOpts & { moodAuthor?: string }): void {
  exchangeKeys = k
}
import { MODELS } from '@koan/vidancer-ui/shared/models'
import { compileClip } from '@koan/vidancer-ui/shared/compile'
import type { Project, ProjectDelta, Clip, ProjectStyle, PromptData, SceneFields, ProductionFields, CharacterField, CharacterLink, BeatField, TimelineItem, CoDirMsg, CoDirLiveWrite, CoDirScreenEvent } from '@koan/vidancer-ui/shared/types'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const MAX_ROUNDS = 12 // tool-loop safety cap per exchange
const LOG_HISTORY_CAP = 40 // messages of history sent per exchange (full log persists in the project)
const CODIR_IMAGE_CAP = 10 // ref images ATTACHED for vision per message (was 5 — it couldn't see refs past the cap and reported them missing; overflow is now named in-message)

// pricing sanity-checked against the API reference 2026-07-27; Sonnet default per user decision.
// Sonnet 5 is on introductory pricing until 2026-08-31 — revert its label to $3 / $15 after that.
export const CODIR_DEFAULT_MODEL = 'claude-sonnet-5'
export const CODIR_MODELS: { id: string; label: string }[] = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — recommended balance ($2 / $10 per MTok intro, $3 / $15 from Sep 2026)' },
  { id: 'claude-opus-5', label: 'Opus 5 — strongest writing ($5 / $25)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest & cheapest ($1 / $5)' }
]

// same as the bridge: a saved id no longer on the list falls back to the default
// rather than being sent to the API behind a blank dropdown.
export const resolveCodirModel = (id?: string): string =>
  CODIR_MODELS.some((m) => m.id === id) ? (id as string) : CODIR_DEFAULT_MODEL

export interface CoDirUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  rounds: number
  // what the prompt was made of, in characters (÷4 ≈ tokens) — the "what is it stuffing in" line
  sections?: { guides: number; context: number; history: number; message: number; images: number }
}

// the exact prompt of the last exchange, on disk for reading — both engines write it
export const LAST_PROMPT_FILE = (): string => join(app.getPath('userData'), 'codir-last-prompt.txt')

export interface CoDirSendResult {
  ok: boolean
  reply?: string
  error?: string
  usage?: CoDirUsage
  logDelta?: ProjectDelta | null
}

type Progress = (e: { kind: 'status' | 'text' | 'wrote' | 'live' | 'screen'; text?: string; live?: CoDirLiveWrite; screen?: CoDirScreenEvent }) => void

// show_on_screen resolves inside runTool, but the event must reach the renderer through whichever
// engine is running (API loop or bridge MCP) — a take-once slot both call sites drain after each tool.
let pendingScreen: CoDirScreenEvent | null = null
export function takeCodirScreen(): CoDirScreenEvent | null {
  const s = pendingScreen
  pendingScreen = null
  return s
}

// ---- tool schemas: what the Co-Director may write ----
const sceneProps = {
  title: { type: 'string' },
  referenceHandling: { type: 'string', description: 'reference_handling — NAME the specific poses/framings from attached refs to avoid' },
  style: { type: 'string' },
  visualFeel: { type: 'string' }
}
const productionProps = {
  avoid: { type: 'string' },
  audioDesign: { type: 'string' },
  lighting: { type: 'string' },
  criticalConstraint: { type: 'string' },
  subtext: { type: 'string' },
  animationStyle: { type: 'string' }
}
const characterProps = {
  name: { type: 'string', description: 'snake_case' },
  referenceLabel: { type: 'string', description: 'the @title of the Library image this character matches, or empty' },
  base: { type: 'string' },
  features: { type: 'string' },
  physics: { type: 'string' },
  movement: { type: 'string', description: 'movement_in_this_scene — per-clip movement rules' },
  emotionalState: { type: 'string' },
  stateInThisScene: { type: 'string' },
  power: { type: 'string', description: 'power_this_scene' }
}
const beatProps = {
  name: { type: 'string', description: 'snake_case shot name' },
  id: { type: 'string', description: "echo the beat's id from the clip snapshot when EDITING that beat (its display-only placeholder graphic follows the id); omit for brand-new beats" },
  length: { type: 'number', description: 'seconds — stagger by rhythm, total must equal the clip duration' },
  camera: { type: 'string', description: 'one primary move, under 20 words' },
  action: { type: 'string', description: 'choreography, 30-80 words' },
  lighting: { type: 'string', description: '5-15 words' },
  dialogue: { type: 'string' },
  vfx: { type: 'string' },
  reaction: { type: 'string' },
  sfx: { type: 'string' }
}

export const TOOLS = [
  {
    name: 'read_compiled_prompt',
    description:
      "READ-ONLY: compile and return the EXACT prompt a clip's render will send — the cascade fully resolved (linked styles/clips spliced into fields, ⛉ char sheet links rendered, prompt-link freeform splice), emitted in the clip's engine flavor (Seedance YAML / natural prose / LTX paragraph), with a size count per part and per linked source. Read it before flagging doubles or stale text, and before any render. Reads the SAVED clip (edits still inside the ~600ms autosave debounce can lag one beat).",
    input_schema: {
      type: 'object',
      properties: { clip_id: { type: 'string', description: 'clip id from the snapshot (an exact clip name also resolves)' } },
      required: ['clip_id'],
      additionalProperties: false
    }
  },
  {
    name: 'watch_take',
    description:
      "READ-ONLY: WATCH a rendered take — Gemini Flash looks at the video and reports what actually happens (subjects, motion, camera, cuts, lighting, sound) and what looks wrong; without a Google key it falls back to spaced still frames read by Claude (no motion, no sound — the result says so). You cannot see video yourself: before you judge a take ('how's the render', 'did it drift', 'is the cut clean') call this and quote what it saw. Never guess a render from its prompt.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string', description: 'clip id from the snapshot (an exact clip name also resolves)' },
        take: { type: 'number', description: '1-based take number; absent = the keeper' },
        question: { type: 'string', description: 'what to look for; absent = the full second-by-second report' }
      },
      required: ['clip_id'],
      additionalProperties: false
    }
  },
  {
    name: 'read_object',
    description:
      "READ-ONLY: the FULL current state of one Bin citizen — clip, char sheet, style, or timeline — by id (or exact name). Every field verbatim, no truncation: fields, beats with ids, refs, links, takes. In RLM mode the index carries names only — this is how you see content. Read before asserting, editing, or contradicting the director (fresh-state law).",
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'object id from the index (an exact name also resolves)' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'read_transcript_range',
    description:
      'READ-ONLY: the raw conversation messages in a timestamp range — the escape hatch behind folded digests (each digest names its [fromAt–toAt] range). Use when a digest is too thin for what you need.',
    input_schema: {
      type: 'object',
      properties: {
        from_at: { type: 'number', description: 'start timestamp (ms) inclusive' },
        to_at: { type: 'number', description: 'end timestamp (ms) inclusive' }
      },
      required: ['from_at', 'to_at'],
      additionalProperties: false
    }
  },
  {
    name: 'create_clip',
    description: 'Create a new empty clip in the Bin. Returns its clip_id. Use when the user wants a new clip (or no clip is selected and one is needed). Fill it afterwards with the other tools.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'short clip name' } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'set_clip_fields',
    description:
      "Write a clip's prompt fields. Send ONLY what should change: scene/production keys you include are updated individually (others untouched); characters, when included, REPLACES the whole inline character list (send every character the clip should have); freeform replaces the freeform prompt. Also set duration (seconds, e.g. \"10\") / engine when relevant. When a character has a ⛉ char sheet, PREFER character_links over pasting an inline copy — the link stays live (sheet edits flow into every linked clip) and the sheet's image rides in as a ref automatically.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        freeform: { type: 'string', description: 'the top freeform prompt — @mention attached ref titles here' },
        duration: { type: 'string', description: 'seconds as string, e.g. "10", or "auto"' },
        // DERIVED from the registry — the hand-typed list drifted twice (2.5, then Ark 2.5 +
        // Astria went missing): the Co-Director literally could not select shipping engines
        engine: { type: 'string', enum: Object.entries(MODELS).filter(([, m]) => !m.hidden).map(([k]) => k) },
        scene: { type: 'object', properties: sceneProps, additionalProperties: false },
        production: { type: 'object', properties: productionProps, additionalProperties: false },
        characters: { type: 'array', items: { type: 'object', properties: characterProps, required: ['name'], additionalProperties: false } },
        character_links: {
          type: 'array',
          description:
            "REPLACES the clip's linked ⛉ char sheets (send every sheet the clip should link; [] unlinks all). Each linked sheet's CURRENT fields render into the clip live and its image joins the refs — no inline copy needed. User-typed per-field override text on an existing link survives a re-link.",
          items: { type: 'object', properties: { sheet_id: { type: 'string' } }, required: ['sheet_id'], additionalProperties: false }
        }
      },
      required: ['clip_id'],
      additionalProperties: false
    }
  },
  {
    name: 'set_beats',
    description:
      "Replace a clip's beats (the cinematic storyboard). Lengths are seconds, staggered by rhythm, and must sum to the clip duration. Every second of the clip must be covered. Echo each existing beat's id (from the clip snapshot) so it keeps its user-set placeholder graphic — the app carries graphics over by id automatically; you cannot remove or set them.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        beats: { type: 'array', items: { type: 'object', properties: beatProps, required: ['name', 'length', 'camera', 'action', 'lighting'], additionalProperties: false } }
      },
      required: ['clip_id', 'beats'],
      additionalProperties: false
    }
  },
  {
    name: 'set_clip_refs',
    description:
      'Attach Library images to a clip as reference images, by @title (with or without the @). ADD-ONLY: images you list are added; existing refs are ALWAYS kept (omitting one never removes it — only the user can remove refs, in the UI). Every @title you mention in prompt text must be attached and must exist in the Library.',
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        image_titles: { type: 'array', items: { type: 'string' } }
      },
      required: ['clip_id', 'image_titles'],
      additionalProperties: false
    }
  },
  {
    name: 'remove_clip_refs',
    description:
      "Detach reference images from a clip by @title — EXPLICIT removal only: the titles you list are removed, nothing else moves (set_clip_refs stays add-only). Only when the director asks; @mentions of a removed image left in the prompt text are yours to clean.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        image_titles: { type: 'array', items: { type: 'string' } }
      },
      required: ['clip_id', 'image_titles'],
      additionalProperties: false
    }
  },
  {
    name: 'set_image_gen_prompt',
    description:
      "Replace an IMAGE GEN job's prompt (Krea 2 on the user's GPU — ONE plain text-to-image field: prose, no YAML, no beats, no negative). Read the job with read_object first. Rendering stays with the user.",
    input_schema: {
      type: 'object',
      properties: {
        image_gen_id: { type: 'string', description: 'image gen id from the index (an exact name also resolves)' },
        prompt: { type: 'string' }
      },
      required: ['image_gen_id', 'prompt'],
      additionalProperties: false
    }
  },
  {
    name: 'set_image_gen_refs',
    description:
      "Set an IMAGE GEN job's reference slots by @title: a = the scene, b = the subject (the identity-edit path keeps who is in them and restages them on the prompt). Pass null to REMOVE a slot; a key you omit is untouched. Titles must exist in the Library. The refs switch, loras, model and render stay with the user.",
    input_schema: {
      type: 'object',
      properties: {
        image_gen_id: { type: 'string' },
        a: { type: ['string', 'null'] },
        b: { type: ['string', 'null'] }
      },
      required: ['image_gen_id'],
      additionalProperties: false
    }
  },
  {
    name: 'create_style',
    description: 'Create a named style sheet (a clip-independent bundle of universal fields; a Bin citizen like char sheets). Returns style_id. Fill/adjust via update_style, then LINK it into clips with set_field_links rather than copying its text.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'update_style',
    description: "Update a style sheet's fields. Scene/production keys you include are updated individually; others untouched. Linked clips update live.",
    input_schema: {
      type: 'object',
      properties: {
        style_id: { type: 'string' },
        name: { type: 'string' },
        scene: { type: 'object', properties: sceneProps, additionalProperties: false },
        production: { type: 'object', properties: productionProps, additionalProperties: false }
      },
      required: ['style_id'],
      additionalProperties: false
    }
  },
  {
    name: 'set_field_links',
    description:
      'Set the link stacks on clip fields. Keys are field paths (scene.style, scene.visualFeel, production.lighting, …); values are ordered arrays of SOURCE NAMES or ids — a Project Style name links that style (preferred, live), a clip name links that clip. Only the paths you send change; send [] to clear a path. Linked values are spliced before the clip’s own text at render.',
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        links: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } }
      },
      required: ['clip_id', 'links'],
      additionalProperties: false
    }
  },
  {
    name: 'update_brief',
    description: 'Replace your standing project brief (the small note shown to you every exchange). Keep it short and factual: durable decisions, character/ref bindings, project-wide rules.',
    input_schema: {
      type: 'object',
      properties: { brief: { type: 'string' } },
      required: ['brief'],
      additionalProperties: false
    }
  },
  {
    name: 'save_mood',
    description:
      "WRITE (go-gated like every write): save a MOOD — a .vmd style brief the user can switch on for you later (MOODS-VMD-SPEC). Use it when the user says 'save this as a mood' or after the + new interview settles. name = short caps title; triggers = the phrases that mean this mood (what the user would say); not_for = asks this mood must NOT be used for; suffix = an always-on closing line for every prompt written in it (a locked spine), or empty; how_to_write = role, the locked template and anchor phrases, banned words, output ritual, feedback style; what_to_know = anchor profiles, keyword pools, registers, pull-bank, proven examples, construction sequence. Write both halves in full — this file is the whole mood.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string', description: 'one sentence: what this mood is' },
        triggers: { type: 'array', items: { type: 'string' } },
        not_for: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        suffix: { type: 'string' },
        how_to_write: { type: 'string' },
        what_to_know: { type: 'string' }
      },
      required: ['name', 'triggers', 'how_to_write', 'what_to_know'],
      additionalProperties: false
    }
  },
  {
    name: 'set_open_questions',
    description:
      'Replace your "still to decide" list — the open creative questions of THIS conversation (shown live to the user in the Director\'s Room). Whole-list replace: send every question still genuinely open, drop the resolved ones, max 8, each one short line. Update it whenever a question is raised or settled; send [] when nothing is open.',
    input_schema: {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'string' } } },
      required: ['questions'],
      additionalProperties: false
    }
  },
  {
    name: 'update_guide',
    description:
      "Edit one of the three PROMPTING guide files (never your own instructions — those change only via remember_instruction). Only when the user asks for a guide change. old_text = an exact excerpt of the guide's current text (it is in your context) to replace with new_text; omit old_text to append new_text at the end as a new section. The first edit forks the user's personal copy; it loads on the next exchange.",
    input_schema: {
      type: 'object',
      properties: {
        guide_id: { type: 'string', enum: [...PROMPTING_GUIDE_IDS] },
        old_text: { type: 'string', description: 'exact excerpt to replace — omit to append' },
        new_text: { type: 'string' }
      },
      required: ['guide_id', 'new_text'],
      additionalProperties: false
    }
  },
  {
    name: 'remember_instruction',
    description:
      'Save ONE short standing rule to the "Learned instructions" section of your own instructions file — ONLY when the user explicitly says remember / save that / keep it in mind. Distill their words into a single imperative sentence. Confirm in your reply that you saved it.',
    input_schema: {
      type: 'object',
      properties: { rule: { type: 'string', description: 'one imperative sentence' } },
      required: ['rule'],
      additionalProperties: false
    }
  },
  {
    name: 'create_char_sheet',
    description: "Create a char sheet — a character's single home in the Bin. Returns sheet_id. Fill it with set_char_sheet_fields.",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: "sheet name — usually the character's name" } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'set_char_sheet_fields',
    description:
      "Write a char sheet's text fields (all seven character fields). Send ONLY what should change; omitted fields are untouched. The sheet's image binding is user-only — you cannot set or clear it.",
    input_schema: {
      type: 'object',
      properties: {
        sheet_id: { type: 'string' },
        name: { type: 'string', description: 'rename the sheet itself' },
        char_name: { type: 'string', description: "the character's name (what linked clips render)" },
        base: { type: 'string' },
        features: { type: 'string' },
        physics: { type: 'string' },
        movement: { type: 'string', description: 'movement_in_this_scene' },
        emotional_state: { type: 'string' },
        state_in_this_scene: { type: 'string' },
        power: { type: 'string', description: 'power_this_scene' },
        reference_label: { type: 'string', description: 'the @ref tag, e.g. @char_ian' }
      },
      required: ['sheet_id'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_char_sheet',
    description: 'Delete a char sheet — only when the user asks. Clip links to it resolve to nothing. Undoable.',
    input_schema: { type: 'object', properties: { sheet_id: { type: 'string' } }, required: ['sheet_id'], additionalProperties: false }
  },
  {
    name: 'delete_clip',
    description: 'Delete a clip from the Bin (its takes and timeline instances go with it) — only when the user asks. Undoable.',
    input_schema: { type: 'object', properties: { clip_id: { type: 'string' } }, required: ['clip_id'], additionalProperties: false }
  },
  {
    name: 'delete_style',
    description: 'Delete a style sheet — only when the user asks. Field links pointing at it resolve to nothing. Undoable.',
    input_schema: { type: 'object', properties: { style_id: { type: 'string' } }, required: ['style_id'], additionalProperties: false }
  },
  {
    name: 'create_timeline',
    description: 'Create a new named timeline (the cut). Returns timeline_id. Lay clips into it with set_timeline_clips.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }
  },
  {
    name: 'set_timeline_clips',
    description:
      "Replace a timeline's cut with a SEQUENCE of clips — in order, back to back, one video track. Each entry: clip (name or id), optional take (1-based; omit = the clip's keeper), optional in_sec/out_sec trim, optional disabled. Whole-list replace: send the full sequence. CAUTION: a multi-track layout the user built by hand gets flattened to this sequence — on a hand-built timeline, prefer create_timeline and cut your version there.",
    input_schema: {
      type: 'object',
      properties: {
        timeline_id: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              clip: { type: 'string', description: 'clip name or id' },
              take: { type: 'number', description: '1-based take number; omit for the keeper take' },
              in_sec: { type: 'number', description: 'trim in-point, seconds into the source' },
              out_sec: { type: 'number', description: 'trim out-point' },
              disabled: { type: 'boolean', description: 'keep the slot but skip it in playback/export' },
              speed: { type: 'number', description: 'playback rate, 1 = normal' },
              muted: { type: 'boolean', description: "mute this instance's clip audio" },
              transition_out_sec: { type: 'number', description: 'cross-dissolve into the NEXT item, seconds' }
            },
            required: ['clip'],
            additionalProperties: false
          }
        }
      },
      required: ['timeline_id', 'items'],
      additionalProperties: false
    }
  },
  {
    name: 'rename_item',
    description: 'Rename a clip or a timeline (styles rename via update_style, char sheets via set_char_sheet_fields).',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['clip', 'timeline'] }, id: { type: 'string' }, name: { type: 'string' } },
      required: ['kind', 'id', 'name'],
      additionalProperties: false
    }
  },
  {
    name: 'duplicate_item',
    description: 'Duplicate a clip (recipe copied, takes NOT) or a whole timeline (the cut, as-is). Returns the new id. The right first move before reworking either.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['clip', 'timeline'] }, id: { type: 'string' } },
      required: ['kind', 'id'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_timeline',
    description: 'Delete a timeline — only when the user asks. The clips themselves stay in the Bin. Undoable.',
    input_schema: { type: 'object', properties: { timeline_id: { type: 'string' } }, required: ['timeline_id'], additionalProperties: false }
  },
  {
    name: 'set_keeper_take',
    description: "Mark a clip's keeper take (1-based) — the take timelines use by default. A pure creative call: 'take 2 is the one'.",
    input_schema: {
      type: 'object',
      properties: { clip_id: { type: 'string' }, take: { type: 'number', description: '1-based take number' } },
      required: ['clip_id', 'take'],
      additionalProperties: false
    }
  },
  {
    name: 'set_timeline_view',
    description: "Timeline chrome: set its canvas aspect ratio (e.g. '16:9', '9:16', '1:1') and/or put it on screen (make it the active timeline). Send only what should change.",
    input_schema: {
      type: 'object',
      properties: {
        timeline_id: { type: 'string' },
        aspect_ratio: { type: 'string', description: "e.g. '16:9'" },
        on_screen: { type: 'boolean', description: 'true = make this the timeline the panels show' }
      },
      required: ['timeline_id'],
      additionalProperties: false
    }
  },
  {
    name: 'create_folder',
    description: 'Create a folder in the Bin (kind=bin, holds clips) or the Library (kind=lib, holds images). Returns folder_id. Organize items into it with move_to_folder.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['bin', 'lib'] },
        name: { type: 'string' },
        parent_id: { type: 'string', description: 'omit for top level' }
      },
      required: ['kind', 'name'],
      additionalProperties: false
    }
  },
  {
    name: 'move_to_folder',
    description: 'Move Bin clips (kind=bin) or Library images (kind=lib) into a folder — or to top level with no folder_id.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['bin', 'lib'] },
        item_ids: { type: 'array', items: { type: 'string' } },
        folder_id: { type: 'string', description: 'omit = move to top level' }
      },
      required: ['kind', 'item_ids'],
      additionalProperties: false
    }
  },
  {
    name: 'rename_image',
    description: "Rename a Library image's @title — identity-preserving: every @mention in every prompt text is rewritten automatically. Titles must stay unique.",
    input_schema: {
      type: 'object',
      properties: { image_id: { type: 'string' }, new_title: { type: 'string', description: "the new @title (with or without the '@')" } },
      required: ['image_id', 'new_title'],
      additionalProperties: false
    }
  },
  {
    name: 'show_on_screen',
    description:
      "Put a take on the Screen — the big floating player behind the chat in the Director's Room. Use it whenever the user wants to watch or review a render ('let's look at the latest take', 'show me take 2 of the rooftop clip', 'put it on the screen'). Omit take for that clip's newest; omit clip_id too and you get the newest render in the whole project. off=true clears the Screen. Display only — it changes nothing in the project.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string', description: 'omit = the newest render project-wide' },
        take: { type: 'number', description: '1-based take number; omit = the newest take of that clip' },
        off: { type: 'boolean', description: 'true = clear the Screen' }
      },
      additionalProperties: false
    }
  }
]

// ---- project snapshot the model sees every exchange ----
const t = (s: string | undefined, n: number): string => {
  const v = (s ?? '').trim()
  return v.length > n ? v.slice(0, n) + '…' : v
}

function snapshotClip(c: Clip, full: boolean): string {
  const pd = c.promptData
  const cap = full ? 4000 : 140
  const keeperN = c.keeperTakeId ? c.takes.findIndex((tk) => tk.id === c.keeperTakeId) + 1 : 0
  const lines: string[] = [`- clip "${c.name}" id=${c.id} engine=${pd.engine ?? 'seedance2'} mode=${pd.mode} duration=${pd.duration} takes=${c.takes.length}${keeperN > 0 ? ` keeper=take${keeperN}` : c.takes.length ? ' keeper=newest' : ''}`]
  if (pd.freeform?.trim()) lines.push(`  freeform: ${t(pd.freeform, cap)}`)
  const sc = pd.scene
  for (const k of ['title', 'referenceHandling', 'style', 'visualFeel'] as (keyof SceneFields)[])
    if (sc?.[k]?.trim()) lines.push(`  scene.${k}: ${t(sc[k], cap)}`)
  const pn = pd.production
  for (const k of ['avoid', 'audioDesign', 'lighting', 'criticalConstraint', 'subtext', 'animationStyle'] as (keyof ProductionFields)[])
    if (pn?.[k]?.trim()) lines.push(`  production.${k}: ${t(pn[k] ?? '', cap)}`)
  if (pd.characters?.length) {
    for (const ch of pd.characters) {
      const bits = full
        ? [`base=${t(ch.base, 400)}`, `features=${t(ch.features, 600)}`, `physics=${t(ch.physics, 400)}`, ch.movement ? `movement=${t(ch.movement, 300)}` : '', ch.emotionalState ? `emotional=${t(ch.emotionalState, 200)}` : '', ch.stateInThisScene ? `state=${t(ch.stateInThisScene, 300)}` : '', ch.power ? `power=${t(ch.power, 200)}` : '']
        : [t(ch.base, 80)]
      lines.push(`  character ${ch.name}${ch.referenceLabel ? ` (${ch.referenceLabel})` : ''}: ${bits.filter(Boolean).join(' | ')}`)
    }
  }
  const proj = getProject()
  const titleOf = (id?: string): string => (id && proj ? proj.images.find((i) => i.id === id)?.title ?? '(gone)' : '')
  if (pd.characterLinks?.length) {
    for (const l of pd.characterLinks) {
      const sh = proj?.charSheets.find((x) => x.id === l.clipId)
      const src = sh ? `⛉ sheet "${sh.name}" sheet_id=${sh.id}` : `clip "${proj?.clips.find((x) => x.id === l.clipId)?.name ?? '(gone)'}" char ${l.charName}`
      lines.push(`  linked char: ${src}${l.override ? ' (+user override text)' : ''}${l.replaced?.length ? ` (user REPLACED: ${l.replaced.join(', ')})` : ''} — live, renders the source's CURRENT fields`)
    }
  }
  if (pd.beats?.length) {
    if (full) {
      let cur = 0
      for (const b of pd.beats) {
        const ph = b.refImageId ? ` | placeholder=${titleOf(b.refImageId)} (display-only, app-managed)` : ''
        lines.push(`  beat id=${b.id ?? '?'} ${b.name} ${cur}-${cur + (b.length || 0)}s: cam=${t(b.camera, 120)} | action=${t(b.action, 300)} | light=${t(b.lighting, 100)}${b.dialogue ? ` | dlg=${t(b.dialogue, 100)}` : ''}${b.vfx ? ` | vfx=${t(b.vfx, 100)}` : ''}${b.sfx ? ` | sfx=${t(b.sfx, 100)}` : ''}${ph}`)
        cur += b.length || 0
      }
    } else lines.push(`  beats: ${pd.beats.length} (${pd.beats.map((b) => b.name).join(', ')})`)
  }
  if (pd.imageIds?.length && proj) {
    const titles = pd.imageIds.map((id) => titleOf(id) || '?').join(' ')
    lines.push(`  refs: ${titles} (attached refs are add-only for you — the user removes)`)
  }
  if (c.storyboardImageId && proj) {
    lines.push(`  storyboard-face: ${titleOf(c.storyboardImageId)} (display-only, user-set — not writable by tools)`)
  }
  if (pd.fieldLinks && Object.keys(pd.fieldLinks).length && proj) {
    const nameOf = (id: string): string => proj.styles.find((s) => s.id === id)?.name ?? proj.clips.find((x) => x.id === id)?.name ?? '(gone)'
    lines.push(`  links: ${Object.entries(pd.fieldLinks).map(([p, ids]) => `${p}←[${ids.map((id) => nameOf(id) + (pd.fieldOverrides?.[p]?.includes(id) ? ' (REPLACED by user field text)' : '')).join(', ')}]`).join('; ')}`)
  }
  return lines.join('\n')
}

function snapshotStyle(s: ProjectStyle): string {
  const lines: string[] = [`- style "${s.name}" id=${s.id}`]
  for (const k of ['title', 'referenceHandling', 'style', 'visualFeel'] as (keyof SceneFields)[])
    if (s.scene?.[k]?.trim()) lines.push(`  scene.${k}: ${t(s.scene[k], 400)}`)
  for (const k of ['avoid', 'audioDesign', 'lighting', 'criticalConstraint', 'subtext', 'animationStyle'] as (keyof ProductionFields)[])
    if (s.production?.[k]?.trim()) lines.push(`  production.${k}: ${t(s.production[k] ?? '', 400)}`)
  return lines.join('\n')
}

// ---- read_object: FULL verbatim dumps (no truncation — the RLM content path; snapshot stays capped) ----
const vv = (s: string | undefined): string => (s ?? '').trim()
function dumpClip(p: Project, c: Clip): string {
  const pd = c.promptData
  const titleOf = (id?: string): string => (id ? p.images.find((i) => i.id === id)?.title ?? '(gone)' : '')
  const keeperN = c.keeperTakeId ? c.takes.findIndex((tk) => tk.id === c.keeperTakeId) + 1 : 0
  const lines: string[] = [`clip "${c.name}" id=${c.id} engine=${pd.engine ?? 'seedance2'} mode=${pd.mode} duration=${pd.duration} takes=${c.takes.length}${keeperN > 0 ? ` keeper=take${keeperN}` : c.takes.length ? ' keeper=newest' : ''}`]
  if (vv(pd.freeform)) lines.push(`freeform: ${vv(pd.freeform)}`)
  for (const k of ['title', 'referenceHandling', 'style', 'visualFeel'] as (keyof SceneFields)[]) if (vv(pd.scene?.[k])) lines.push(`scene.${k}: ${vv(pd.scene[k])}`)
  for (const k of ['avoid', 'audioDesign', 'lighting', 'criticalConstraint', 'subtext', 'animationStyle'] as (keyof ProductionFields)[])
    if (vv(pd.production?.[k])) lines.push(`production.${k}: ${vv(pd.production[k])}`)
  for (const ch of pd.characters ?? []) {
    lines.push(`character ${ch.name}${ch.referenceLabel ? ` (${ch.referenceLabel})` : ''}:`)
    for (const [k, v] of [['base', ch.base], ['features', ch.features], ['physics', ch.physics], ['voice', ch.voice], ['movement', ch.movement], ['emotional_state', ch.emotionalState], ['state_in_this_scene', ch.stateInThisScene], ['power', ch.power]] as [string, string | undefined][])
      if (vv(v)) lines.push(`  ${k}: ${vv(v)}`)
  }
  for (const l of pd.characterLinks ?? []) {
    const sh = p.charSheets?.find((x) => x.id === l.clipId)
    const src = sh ? `⛉ sheet "${sh.name}" sheet_id=${sh.id}` : `clip "${p.clips.find((x) => x.id === l.clipId)?.name ?? '(gone)'}" char ${l.charName}`
    lines.push(`linked char: ${src}${l.override ? ` override=${JSON.stringify(l.override)}` : ''}${l.replaced?.length ? ` REPLACED=[${l.replaced.join(', ')}]` : ''} — live`)
  }
  let cur = 0
  for (const b of pd.beats ?? []) {
    lines.push(`beat id=${b.id ?? '?'} "${b.name}" ${cur}-${cur + (b.length || 0)}s:`)
    cur += b.length || 0
    for (const [k, v] of [['camera', b.camera], ['action', b.action], ['lighting', b.lighting], ['dialogue', b.dialogue], ['vfx', b.vfx], ['reaction', b.reaction], ['sfx', b.sfx]] as [string, string | undefined][])
      if (vv(v)) lines.push(`  ${k}: ${vv(v)}`)
    if (b.refImageId) lines.push(`  placeholder=${titleOf(b.refImageId)} (display-only, app-managed)`)
  }
  if (pd.imageIds?.length) lines.push(`refs: ${pd.imageIds.map((id) => titleOf(id) || '?').join(' ')}`)
  if (pd.fieldLinks && Object.keys(pd.fieldLinks).length) {
    const nameOf = (id: string): string => p.styles.find((s) => s.id === id)?.name ?? p.clips.find((x) => x.id === id)?.name ?? '(gone)'
    lines.push(`links: ${Object.entries(pd.fieldLinks).map(([path, ids]) => `${path}←[${ids.map((id) => nameOf(id) + (pd.fieldOverrides?.[path]?.includes(id) ? ' (REPLACED by user field text)' : '')).join(', ')}]`).join('; ')}`)
  }
  return lines.join('\n')
}
function dumpSheet(p: Project, s: NonNullable<Project['charSheets']>[number]): string {
  const ch = s.character
  const img = s.imageId ? p.images.find((i) => i.id === s.imageId)?.title ?? '(gone)' : '(no image)'
  const linked = p.clips.filter((c) => (c.promptData.characterLinks ?? []).some((l) => l.clipId === s.id))
  const lines = [`char sheet "${s.name}" id=${s.id} char=${ch.name || '(unnamed)'} ref=${ch.referenceLabel || '(none)'} image=${img} linked_into=${linked.length ? linked.map((c) => `"${c.name}"`).join(', ') : '(no clips)'}`]
  for (const [k, v] of [['base', ch.base], ['features', ch.features], ['physics', ch.physics], ['voice', ch.voice], ['movement', ch.movement], ['emotional_state', ch.emotionalState], ['state_in_this_scene', ch.stateInThisScene], ['power', ch.power]] as [string, string | undefined][])
    if (vv(v)) lines.push(`${k}: ${vv(v)}`)
  return lines.join('\n')
}
function dumpStyle(s: ProjectStyle): string {
  const lines = [`style "${s.name}" id=${s.id}`]
  for (const k of ['title', 'referenceHandling', 'style', 'visualFeel'] as (keyof SceneFields)[]) if (vv(s.scene?.[k])) lines.push(`scene.${k}: ${vv(s.scene[k])}`)
  for (const k of ['avoid', 'audioDesign', 'lighting', 'criticalConstraint', 'subtext', 'animationStyle'] as (keyof ProductionFields)[])
    if (vv(s.production?.[k])) lines.push(`production.${k}: ${vv(s.production[k])}`)
  return lines.join('\n')
}
function dumpTimeline(p: Project, tl: NonNullable<Project['timelines']>[number]): string {
  const seq = tl.items
    .map((it, n) => {
      const c = p.clips.find((x) => x.id === it.clipId)
      const takeN = it.takeId && c ? c.takes.findIndex((tk) => tk.id === it.takeId) + 1 : 0
      const trim = it.inSec != null || it.outSec != null ? ` trim=[${it.inSec ?? 0}–${it.outSec ?? 'end'}s]` : ''
      return `${n + 1}. "${c?.name ?? '?'}"${takeN > 0 ? ` take${takeN}` : ''}${trim}${it.speed && it.speed !== 1 ? ` speed=${it.speed}` : ''}${it.muted ? ' muted' : ''}${it.disabled ? ' disabled' : ''}`
    })
    .join('\n')
  return [`timeline "${tl.name}" id=${tl.id}${tl.id === p.activeTimelineId ? ' (on screen)' : ''} aspect=${tl.aspectRatio} items=${tl.items.length}`, seq || '(empty)'].join('\n')
}
function dumpObject(p: Project, id: string): string | null {
  const c = p.clips.find((x) => x.id === id) ?? p.clips.find((x) => x.name === id)
  if (c) return dumpClip(p, c)
  const sh = p.charSheets?.find((x) => x.id === id) ?? p.charSheets?.find((x) => x.name === id)
  if (sh) return dumpSheet(p, sh)
  const st = p.styles.find((x) => x.id === id) ?? p.styles.find((x) => x.name === id)
  if (st) return dumpStyle(st)
  const tl = p.timelines?.find((x) => x.id === id) ?? p.timelines?.find((x) => x.name === id)
  if (tl) return dumpTimeline(p, tl)
  const g = (p.imageGens ?? []).find((x) => x.id === id) ?? (p.imageGens ?? []).find((x) => x.name === id)
  if (g) return dumpImageGen(p, g)
  return null
}

// IMAGE GEN (KREA2-LOCAL-SPEC §14): the whole recipe + the takes — what set_image_gen_* writes into
function dumpImageGen(p: Project, g: import('@koan/vidancer-ui/shared/types').ImageGenJob): string {
  const r = g.recipe
  const title = (id?: string): string => (id ? (p.images.find((i) => i.id === id)?.title ?? '(gone)') : '—')
  const lines = [
    `IMAGE GEN "${g.name}" (image_gen_id=${g.id}) — Krea 2 on the user's GPU`,
    `prompt: ${r.prompt || '(empty)'}`,
    `refs (${r.refOn ? 'ON' : 'OFF — plain text-to-image'}): A ${title(r.refA)} (boost ${r.refBoost}) · B ${title(r.refB)} (boost ${r.refBoostB})`,
    `model: ${r.model || '(none)'} · aspect ${r.aspect} · ${r.megapixels} MP · ${r.batch} render${r.batch > 1 ? 's' : ''} · seed ${r.seed || 'random'}`,
    `loras (${r.loraOn ? 'ON' : 'OFF'}): ${r.loras.length ? r.loras.map((l) => `${l.name.split(/[\\/]/).pop()?.replace(/\.safetensors$/i, '')} ×${l.weight}`).join(' · ') : '(none)'}${r.unleashedOn ? ` · unleashed ×${r.unleashedWeight}` : ''}`,
    `takes: ${g.takes.length}${g.takes.length ? '\n' + g.takes.map((t, i) => `  T${i + 1}${t.id === g.keeperTakeId ? ' ★' : ''} · seed ${t.seed} · ${t.width}×${t.height}${t.keptImageId ? ` · in the Library as ${title(t.keptImageId)}` : ''}${t.disabled ? ' · disabled' : ''}`).join('\n') : ''}`
  ]
  return lines.join('\n')
}

// digests ride the project context in BOTH pipe modes — the folded past, with the escape hatch named
function digestBlock(p: Project): string {
  const ds = p.codir.digests ?? []
  if (!ds.length) return ''
  return `\n## Folded conversation (older exchanges digested by COMPACT — read_transcript_range {from_at,to_at} fetches the raw text)\n${ds.map((d) => `- [${d.fromAt}–${d.toAt}] ${d.text}`).join('\n')}`
}
// the raw messages after the last digest — what exchanges send as history once a fold exists
export function liveTail(p: Project): CoDirMsg[] {
  const ds = p.codir.digests
  const lastTo = ds?.length ? ds[ds.length - 1].toAt : 0
  return lastTo ? p.codir.log.filter((m) => m.at > lastTo) : p.codir.log
}

// the "this one" line — a field (has a path), a holder (a beat, the beat bar, a sheet, an image)
// or a whole thing (a clip, a timeline, the Library). Tether spec 2026-09-08.
export type FocusIn = { kind: string; ownerId: string; path?: string } | null
// the Image Gen panel's open job (KREA2-LOCAL-SPEC §14) — the renderer sends it beside
// selectedClipId; both lanes set it before building context
let openImageGenId: string | null = null
export function setOpenImageGen(id: string | null | undefined): void {
  openImageGenId = id ?? null
}
// what the open image gen SHOWS the model (his order 2026-09-09): its refs A/B (Library images)
// and its ★ take — they ride the exchange like the selected clip's refs, both lanes
export function openImageGenPics(p: Project): { file: string; label: string; imageId?: string }[] {
  const g = openImageGenId ? (p.imageGens ?? []).find((x) => x.id === openImageGenId) : undefined
  if (!g) return []
  const out: { file: string; label: string; imageId?: string }[] = []
  for (const [slot, id] of [['A', g.recipe.refA], ['B', g.recipe.refB]] as const) {
    const im = id ? p.images.find((i) => i.id === id) : undefined
    if (im) out.push({ file: im.file, label: `${im.title} — ref ${slot} of image gen "${g.name}"`, imageId: im.id })
  }
  const keeper = g.takes.find((t) => t.id === g.keeperTakeId) ?? g.takes[g.takes.length - 1]
  if (keeper) out.push({ file: keeper.file, label: `the ★ take (T${g.takes.indexOf(keeper) + 1}, seed ${keeper.seed}) of image gen "${g.name}" — what its prompt rendered` })
  return out
}
export function focusLine(p: Project, focus: NonNullable<FocusIn>): string {
  const clipName = (id: string): string => p.clips.find((c) => c.id === id)?.name ?? '?'
  let what = ''
  switch (focus.kind) {
    case 'clip':
      what = `clip "${clipName(focus.ownerId)}" (id=${focus.ownerId})`
      break
    case 'style':
      what = `style "${p.styles.find((s) => s.id === focus.ownerId)?.name ?? '?'}" (id=${focus.ownerId})`
      break
    case 'sheet':
      what = `char sheet "${p.charSheets?.find((s) => s.id === focus.ownerId)?.name ?? '?'}" (sheet_id=${focus.ownerId})`
      break
    case 'beat': {
      const c = p.clips.find((x) => x.promptData.beats.some((b) => b.id === focus.ownerId))
      const b = c?.promptData.beats.find((x) => x.id === focus.ownerId)
      what = `beat "${b?.name || 'shot'}" (beat id=${focus.ownerId}) of clip "${c?.name ?? '?'}"${c ? ` (clip id=${c.id})` : ''}`
      break
    }
    case 'beats':
      what = `the beat bar of clip "${clipName(focus.ownerId)}" (id=${focus.ownerId})`
      break
    case 'image':
      what = `Library image ${p.images.find((i) => i.id === focus.ownerId)?.title ?? '?'}`
      break
    case 'imagegen': {
      const g = (p.imageGens ?? []).find((x) => x.id === focus.ownerId)
      what = `image gen "${g?.name ?? '?'}" (image_gen_id=${focus.ownerId}) — its prompt`
      break
    }
    case 'timeline': {
      const tl = focus.ownerId === '*' ? p.timelines?.find((t) => t.id === p.activeTimelineId) : p.timelines?.find((t) => t.id === focus.ownerId)
      what = tl ? `timeline "${tl.name}" (id=${tl.id})` : 'the timeline'
      break
    }
    case 'library':
      what = 'the Library'
      break
    case 'bin':
      what = 'the Bin'
      break
    default:
      what = `${focus.kind} ${focus.ownerId}`
  }
  const section = !!focus.path && !focus.path.includes('.') && focus.path !== 'freeform' // 'prompt' · 'scene' · 'characters' · 'production' · 'beats'
  if (section) return `This one (the SECTION the user is on — all of its fields): ${focus.path} of ${what}`
  return focus.path ? `This one (the field the user is on): ${focus.path} on ${what}` : `This one (the thing the user is on — the whole of it): ${what}`
}
// HEAT (tether spec §6): how HARD field text is written, never how much — one line when set
export function heatLine(heat: number | undefined): string {
  if (!heat || heat < 1 || heat > 5) return ''
  return `\n## HEAT ${heat}/5\nWrite field text at this heat: 1 = plain, restrained, literal · 3 = full craft · 5 = maximum force, sensory stacking, the least-likely read. Heat is how HARD you write, never how MUCH — statute 6 still governs length.`
}

export function buildContext(p: Project, selectedClipId: string | null, focus: FocusIn, heat?: number): string {
  const parts: string[] = []
  parts.push(`# Current project: "${p.name}"`)
  parts.push(`\n## Your brief\n${p.codir.brief.trim() || '(empty — update_brief when durable decisions land)'}`)
  parts.push(
    `\n## Still to decide (your open-questions list — set_open_questions keeps it current)\n${
      p.codir.openQuestions?.length ? p.codir.openQuestions.map((q) => `- ${q}`).join('\n') : '(empty)'
    }`
  )
  parts.push(`\n## Library images (@titles you may attach/reference)\n${p.images.length ? p.images.map((i) => i.title).join(' ') : '(none yet)'}`)
  parts.push(`\n## Style sheets (project styles — Bin citizens like char sheets)\n${p.styles.length ? p.styles.map(snapshotStyle).join('\n') : '(none yet)'}`)
  // char sheets: writable via create_char_sheet / set_char_sheet_fields; the image binding stays user-only
  parts.push(
    `\n## Char sheets (characters' single homes — write text fields with set_char_sheet_fields; link one into a clip with set_clip_fields.character_links; the image binding is user-only)\n${
      (p.charSheets ?? []).length
        ? (p.charSheets ?? [])
            .map((s) => {
              const img = s.imageId ? p.images.find((i) => i.id === s.imageId)?.title ?? '(gone)' : '(no image)'
              const linked = p.clips.filter((c) => (c.promptData.characterLinks ?? []).some((l) => l.clipId === s.id))
              const ch = s.character
              const opt = [
                ch.movement?.trim() ? `  movement: ${t(ch.movement, 300)}` : '',
                ch.emotionalState?.trim() ? `  emotional_state: ${t(ch.emotionalState, 200)}` : '',
                ch.stateInThisScene?.trim() ? `  state_in_this_scene: ${t(ch.stateInThisScene, 300)}` : '',
                ch.power?.trim() ? `  power: ${t(ch.power, 200)}` : ''
              ].filter(Boolean)
              return [`- sheet "${s.name}" id=${s.id} char=${ch.name || '(unnamed)'} ref=${ch.referenceLabel || '(none)'} image=${img} linked_into=${linked.length ? linked.map((c) => `"${c.name}"`).join(', ') : '(no clips yet)'}`, `  base: ${t(ch.base, 300)}`, `  features: ${t(ch.features, 300)}`, `  physics: ${t(ch.physics, 300)}`, ...opt].join('\n')
            })
            .join('\n')
        : '(none yet — create_char_sheet starts one)'
    }`
  )
  parts.push(
    `\n## Timelines (the cuts — create_timeline / set_timeline_clips; takes are 1-based)\n${
      (p.timelines ?? []).length
        ? (p.timelines ?? [])
            .map((tl) => {
              const seq = tl.items
                .map((it) => {
                  const c = p.clips.find((x) => x.id === it.clipId)
                  const takeN = it.takeId && c ? c.takes.findIndex((tk) => tk.id === it.takeId) + 1 : 0
                  const trim = it.inSec != null || it.outSec != null ? `[${it.inSec ?? 0}–${it.outSec ?? 'end'}s]` : ''
                  const extras = `${takeN > 0 ? `@take${takeN}` : ''}${trim}${it.speed && it.speed !== 1 ? `×${it.speed}` : ''}${it.muted ? '🔇' : ''}${it.disabled ? '⊘' : ''}`
                  return `"${c?.name ?? '?'}"${extras}`
                })
                .join(' → ')
              return `- timeline "${tl.name}" id=${tl.id}${tl.id === p.activeTimelineId ? ' (on screen)' : ''} aspect=${tl.aspectRatio} · ${tl.items.length} item${tl.items.length === 1 ? '' : 's'}${seq ? `: ${seq}` : ' (empty)'}`
            })
            .join('\n')
        : '(none yet)'
    }`
  )
  if (p.folders?.length)
    parts.push(
      `\n## Folders (bin = clips, lib = images — create_folder / move_to_folder)\n${p.folders
        .map((f) => `- [${f.kind}] "${f.name}" id=${f.id}${f.parent ? ` in=${f.parent}` : ''}`)
        .join('\n')}`
    )
  parts.push(`\n## Clips\n${p.clips.length ? p.clips.map((c) => snapshotClip(c, c.id === selectedClipId)).join('\n') : '(none yet)'}`)
  // Image Gen jobs (KREA2-LOCAL-SPEC §14) — the full context carries the whole recipe of each
  const gensFull = p.imageGens ?? []
  parts.push(`\n## Image gens (Krea 2 on the user's GPU — set_image_gen_prompt / set_image_gen_refs)\n${gensFull.length ? gensFull.map((g) => dumpImageGen(p, g)).join('\n\n') : '(none yet)'}`)
  const sel = selectedClipId ? p.clips.find((c) => c.id === selectedClipId) : undefined
  parts.push(`\n## Where the user is\nSelected clip: ${sel ? `"${sel.name}" id=${sel.id} (shown in full above — "the clip I'm on")` : 'none'}`)
  const openGenFull = openImageGenId ? gensFull.find((g) => g.id === openImageGenId) : undefined
  if (openGenFull) parts.push(`Open image gen: "${openGenFull.name}" id=${openGenFull.id} (the Image Gen panel has it open)`)
  if (focus) parts.push(focusLine(p, focus))
  const hl = heatLine(heat)
  if (hl) parts.push(hl)
  const dg = digestBlock(p)
  if (dg) parts.push(dg)
  return parts.join('\n')
}

// ---- RLM core context (CODIRECTOR-RLM-COMPACT-SPEC-2026-08-27): the INDEX, not the content.
// Names, ids and shape only — read_object / read_compiled_prompt / read_transcript_range fetch
// the rest on demand, always fresh off disk. Turn 100 costs what turn 5 costs. ----
export function buildCoreContext(p: Project, selectedClipId: string | null, focus: FocusIn, heat?: number): string {
  const parts: string[] = []
  parts.push(`# Current project: "${p.name}" — RLM context: this is the INDEX, not the content`)
  parts.push(
    'State lives on disk; this index carries names, not field text. Before asserting, quoting, editing, flagging, or contradicting the director: read_object the thing (full verbatim state), read_compiled_prompt for the assembled prompt, read_transcript_range for folded conversation. Never work from memory of an earlier read.'
  )
  parts.push(`\n## Your brief\n${p.codir.brief.trim() || '(empty — update_brief when durable decisions land)'}`)
  parts.push(
    `\n## Still to decide (set_open_questions keeps it current)\n${p.codir.openQuestions?.length ? p.codir.openQuestions.map((q) => `- ${q}`).join('\n') : '(empty)'}`
  )
  parts.push(`\n## Library images (@titles you may attach/reference)\n${p.images.length ? p.images.map((i) => i.title).join(' ') : '(none yet)'}`)
  parts.push(`\n## Style sheets\n${p.styles.length ? p.styles.map((s) => `- style "${s.name}" id=${s.id}`).join('\n') : '(none yet)'}`)
  parts.push(
    `\n## Char sheets\n${
      (p.charSheets ?? []).length
        ? (p.charSheets ?? [])
            .map((s) => {
              const img = s.imageId ? p.images.find((i) => i.id === s.imageId)?.title ?? '(gone)' : '(no image)'
              const linked = p.clips.filter((c) => (c.promptData.characterLinks ?? []).some((l) => l.clipId === s.id))
              return `- sheet "${s.name}" id=${s.id} char=${s.character.name || '(unnamed)'} image=${img} linked_into=${linked.length ? linked.map((c) => `"${c.name}"`).join(', ') : '(none)'}`
            })
            .join('\n')
        : '(none yet — create_char_sheet starts one)'
    }`
  )
  parts.push(
    `\n## Timelines\n${
      (p.timelines ?? []).length
        ? (p.timelines ?? []).map((tl) => `- timeline "${tl.name}" id=${tl.id}${tl.id === p.activeTimelineId ? ' (on screen)' : ''} aspect=${tl.aspectRatio} items=${tl.items.length}`).join('\n')
        : '(none yet)'
    }`
  )
  if (p.folders?.length)
    parts.push(`\n## Folders (bin = clips, lib = images)\n${p.folders.map((f) => `- [${f.kind}] "${f.name}" id=${f.id}${f.parent ? ` in=${f.parent}` : ''}`).join('\n')}`)
  parts.push(
    `\n## Clips (index — read_object for fields/beats, read_compiled_prompt for the assembled prompt)\n${
      p.clips.length
        ? p.clips
            .map((c) => {
              const pd = c.promptData
              const keeperN = c.keeperTakeId ? c.takes.findIndex((tk) => tk.id === c.keeperTakeId) + 1 : 0
              const sheets = (pd.characterLinks ?? []).map((l) => p.charSheets?.find((x) => x.id === l.clipId)?.name).filter(Boolean)
              const links = pd.fieldLinks ? Object.keys(pd.fieldLinks) : []
              return `- clip "${c.name}" id=${c.id} engine=${pd.engine ?? 'seedance2'} mode=${pd.mode} duration=${pd.duration} beats=${pd.beats?.length ?? 0} takes=${c.takes.length}${keeperN > 0 ? ` keeper=take${keeperN}` : ''}${sheets.length ? ` sheets=[${sheets.join(', ')}]` : ''}${links.length ? ` linked_fields=[${links.join(', ')}]` : ''}${pd.imageIds?.length ? ` refs=${pd.imageIds.length}` : ''}`
            })
            .join('\n')
        : '(none yet)'
    }`
  )
  // Image Gen jobs (KREA2-LOCAL-SPEC §14) — one line each; read_object gives the whole recipe
  const gens = p.imageGens ?? []
  parts.push(
    `\n## Image gens (Krea 2 on the user's GPU — set_image_gen_prompt / set_image_gen_refs)\n${
      gens.length
        ? gens.map((g) => `- image gen "${g.name}" id=${g.id} · prompt "${g.recipe.prompt.slice(0, 80)}${g.recipe.prompt.length > 80 ? '…' : ''}" · refs A ${g.recipe.refA ? (p.images.find((i) => i.id === g.recipe.refA)?.title ?? '?') : '—'} / B ${g.recipe.refB ? (p.images.find((i) => i.id === g.recipe.refB)?.title ?? '?') : '—'} · ${g.takes.length} take${g.takes.length === 1 ? '' : 's'}`).join('\n')
        : '(none yet)'
    }`
  )
  const sel = selectedClipId ? p.clips.find((c) => c.id === selectedClipId) : undefined
  parts.push(`\n## Where the user is\nSelected clip: ${sel ? `"${sel.name}" id=${sel.id} ("the clip I'm on" — read_object it before discussing its content)` : 'none'}`)
  const openGen = openImageGenId ? gens.find((g) => g.id === openImageGenId) : undefined
  if (openGen) parts.push(`Open image gen: "${openGen.name}" id=${openGen.id} (the Image Gen panel has it open — read_object it before touching its prompt)`)
  if (focus) parts.push(focusLine(p, focus))
  const hl = heatLine(heat)
  if (hl) parts.push(hl)
  const dg = digestBlock(p)
  if (dg) parts.push(dg)
  return parts.join('\n')
}

// ---- live-write detail: what a tool call is ABOUT to write, as field snippets ----
// Powers the Director's Room live stage — the user watches the actual text land. Built from the
// tool INPUT (the full content is known before execution); snippets are display-capped here so
// the progress channel stays light. Shared by both engines (API loop + bridge MCP).
const snip = (s: unknown, n = 220): string => {
  const v = String(s ?? '').trim()
  return v.length > n ? v.slice(0, n) + '…' : v
}
export function liveDetail(name: string, input: Record<string, unknown>): CoDirLiveWrite | null {
  const p = getProject()
  const clipName = (): string | undefined => {
    const c = p?.clips.find((x) => x.id === input.clip_id)
    return c ? `clip "${c.name}"` : undefined
  }
  const fields: { path: string; snippet: string }[] = []
  const objFields = (obj: unknown, prefix: string): void => {
    if (!obj || typeof obj !== 'object') return
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) fields.push({ path: `${prefix}.${k}`, snippet: snip(v) })
  }
  switch (name) {
    case 'create_clip':
      return { tool: name, target: `new clip "${snip(input.name, 60)}"`, fields }
    case 'set_clip_fields': {
      if (typeof input.freeform === 'string' && input.freeform.trim()) fields.push({ path: 'freeform', snippet: snip(input.freeform) })
      objFields(input.scene, 'scene')
      objFields(input.production, 'production')
      if (Array.isArray(input.characters))
        for (const ch of input.characters as Partial<CharacterField>[])
          fields.push({ path: `character ${ch.name ?? '?'}`, snippet: snip([ch.base, ch.features].filter(Boolean).join(' — ')) })
      if (Array.isArray(input.character_links)) {
        const names = (input.character_links as { sheet_id?: string }[]).map((l) => p?.charSheets.find((s) => s.id === l?.sheet_id)?.name ?? '?')
        fields.push({ path: 'linked sheets', snippet: snip(names.length ? '⛉ ' + names.join(', ') : '(none — all unlinked)') })
      }
      if (typeof input.duration === 'string') fields.push({ path: 'duration', snippet: `${input.duration}s` })
      if (typeof input.engine === 'string') fields.push({ path: 'engine', snippet: String(input.engine) })
      return { tool: name, target: clipName(), fields }
    }
    case 'set_beats': {
      if (Array.isArray(input.beats))
        for (const b of input.beats as Partial<BeatField>[])
          fields.push({ path: `beat ${b.name ?? 'shot'} · ${b.length ?? '?'}s`, snippet: snip([b.camera, b.action].filter(Boolean).join(' — ')) })
      return { tool: name, target: clipName(), fields }
    }
    case 'set_clip_refs':
      return { tool: name, target: clipName(), fields: [{ path: 'refs', snippet: snip((input.image_titles as string[])?.join(' ')) }] }
    case 'remove_clip_refs':
      return { tool: name, target: clipName(), fields: [{ path: 'refs −', snippet: snip((input.image_titles as string[])?.join(' ')) }] }
    case 'set_image_gen_prompt': {
      const g = (p?.imageGens ?? []).find((x) => x.id === input.image_gen_id || x.name === input.image_gen_id)
      return { tool: name, target: g ? `image gen "${g.name}"` : undefined, fields: [{ path: 'prompt', snippet: snip(input.prompt) }] }
    }
    case 'set_image_gen_refs': {
      const g = (p?.imageGens ?? []).find((x) => x.id === input.image_gen_id || x.name === input.image_gen_id)
      const bits: string[] = []
      if ('a' in input) bits.push(`A ${input.a === null ? '—' : String(input.a)}`)
      if ('b' in input) bits.push(`B ${input.b === null ? '—' : String(input.b)}`)
      return { tool: name, target: g ? `image gen "${g.name}"` : undefined, fields: [{ path: 'refs', snippet: snip(bits.join(' · ')) }] }
    }
    case 'create_style':
      return { tool: name, target: `new style "${snip(input.name, 60)}"`, fields }
    case 'update_style': {
      const s = p?.styles.find((x) => x.id === input.style_id)
      objFields(input.scene, 'scene')
      objFields(input.production, 'production')
      return { tool: name, target: s ? `style "${s.name}"` : undefined, fields }
    }
    case 'set_field_links': {
      for (const [path, names] of Object.entries((input.links as Record<string, string[]>) ?? {})) fields.push({ path: `link ${path}`, snippet: snip((names ?? []).join(' + '), 80) })
      return { tool: name, target: clipName(), fields }
    }
    case 'update_brief':
      return { tool: name, target: 'the brief', fields: [{ path: 'brief', snippet: snip(input.brief) }] }
    case 'save_mood':
      return { tool: name, target: `MOOD ${String(input.name ?? '')}`, fields: [{ path: 'mood', snippet: snip(String(input.description ?? input.how_to_write ?? '')) }] }
    case 'set_open_questions':
      return { tool: name, target: 'still to decide', fields: [{ path: 'open questions', snippet: snip((input.questions as string[])?.join(' · ') || '(cleared)') }] }
    case 'update_guide':
      return { tool: name, target: `guide ${String(input.guide_id ?? '')}`, fields: [{ path: 'edit', snippet: snip(input.new_text) }] }
    case 'remember_instruction':
      return { tool: name, target: 'learned instructions', fields: [{ path: 'rule', snippet: snip(input.rule) }] }
    case 'create_char_sheet':
      return { tool: name, target: `new char sheet "${snip(input.name, 60)}"`, fields }
    case 'set_char_sheet_fields': {
      const s = p?.charSheets.find((x) => x.id === input.sheet_id)
      for (const k of ['name', 'char_name', 'base', 'features', 'physics', 'movement', 'emotional_state', 'state_in_this_scene', 'power', 'reference_label'])
        if (typeof input[k] === 'string' && String(input[k]).trim()) fields.push({ path: k, snippet: snip(input[k]) })
      return { tool: name, target: s ? `char sheet "${s.name}"` : undefined, fields }
    }
    case 'delete_char_sheet': {
      const s = p?.charSheets.find((x) => x.id === input.sheet_id)
      return { tool: name, target: s ? `delete char sheet "${s.name}"` : undefined, fields }
    }
    case 'delete_clip': {
      const c = p?.clips.find((x) => x.id === input.clip_id)
      return { tool: name, target: c ? `delete clip "${c.name}"` : undefined, fields }
    }
    case 'delete_style': {
      const s = p?.styles.find((x) => x.id === input.style_id)
      return { tool: name, target: s ? `delete style "${s.name}"` : undefined, fields }
    }
    case 'create_timeline':
      return { tool: name, target: `new timeline "${snip(input.name, 60)}"`, fields }
    case 'set_timeline_clips': {
      const tl = p?.timelines.find((x) => x.id === input.timeline_id)
      if (Array.isArray(input.items)) fields.push({ path: 'sequence', snippet: snip((input.items as { clip?: string }[]).map((i) => i.clip).join(' → '), 300) })
      return { tool: name, target: tl ? `timeline "${tl.name}"` : undefined, fields }
    }
    case 'rename_item':
      return { tool: name, target: `rename ${String(input.kind ?? '')}`, fields: [{ path: 'name', snippet: snip(input.name, 80) }] }
    case 'duplicate_item':
      return { tool: name, target: `duplicate ${String(input.kind ?? '')}`, fields }
    case 'delete_timeline': {
      const tl = p?.timelines.find((x) => x.id === input.timeline_id)
      return { tool: name, target: tl ? `delete timeline "${tl.name}"` : undefined, fields }
    }
    case 'set_keeper_take': {
      const c = p?.clips.find((x) => x.id === input.clip_id)
      return { tool: name, target: c ? `clip "${c.name}"` : undefined, fields: [{ path: 'keeper', snippet: `take ${String(input.take)}` }] }
    }
    case 'set_timeline_view': {
      const tl = p?.timelines.find((x) => x.id === input.timeline_id)
      if (typeof input.aspect_ratio === 'string') fields.push({ path: 'aspect', snippet: String(input.aspect_ratio) })
      if (input.on_screen === true) fields.push({ path: 'on screen', snippet: 'yes' })
      return { tool: name, target: tl ? `timeline "${tl.name}"` : undefined, fields }
    }
    case 'create_folder':
      return { tool: name, target: `new ${String(input.kind)} folder "${snip(input.name, 60)}"`, fields }
    case 'move_to_folder':
      return { tool: name, target: `${String(input.kind)} housekeeping`, fields: [{ path: 'move', snippet: `${Array.isArray(input.item_ids) ? input.item_ids.length : 0} item(s)` }] }
    case 'rename_image': {
      const im = p?.images.find((x) => x.id === input.image_id)
      return { tool: name, target: im ? `image ${im.title}` : undefined, fields: [{ path: 'new title', snippet: snip(input.new_title, 80) }] }
    }
    default:
      return null
  }
}

// ---- tool execution against the project ----
const mergeEnhanced = (cur: string[] | undefined, add: string[]): string[] => Array.from(new Set([...(cur ?? []), ...add]))

// the project the CURRENT exchange started against (API and bridge engines both stamp it via
// index.ts). Tools resolve getProject() fresh at every call, so an exchange outliving a project
// switch would otherwise write into whichever project happens to be open — silently.
let exchangeDir: string | null = null
export function setExchangeDir(dir: string | null): void {
  exchangeDir = dir
}

export async function runTool(name: string, input: Record<string, unknown>, pushDelta: (d: ProjectDelta) => void): Promise<string> {
  const p = getProject()
  if (!p) return 'ERROR: no project open'
  if (exchangeDir && p.dir !== exchangeDir)
    return 'ERROR: the open project changed since this exchange started — write refused. Tell the user to switch back (or start a fresh exchange in the new project).'
  switch (name) {
    case 'watch_take': {
      // read-only — the WATCH lane (watch.ts); the key rides in from the exchange (setExchangeKeys)
      const c = p.clips.find((x) => x.id === input.clip_id) ?? p.clips.find((x) => x.name === input.clip_id)
      if (!c) return `ERROR: no clip with id or name ${String(input.clip_id)}`
      const n = typeof input.take === 'number' && input.take >= 1 ? Math.round(input.take) : 0
      const take = n ? c.takes[n - 1] : (c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1])
      if (!take) return `ERROR: "${c.name}" has no take ${n || '(none rendered yet)'}`
      const r = await watchVideo(take.file, typeof input.question === 'string' ? input.question : undefined, { ...exchangeKeys, label: `watch · ${c.name} T${c.takes.indexOf(take) + 1}` })
      if (!r.ok) return `ERROR: watch failed — ${r.error}`
      const via = r.via === 'gemini' ? WATCH_MODEL : 'still frames read by Claude — no motion or sound (no Google key set)'
      return `WATCHED "${c.name}" take ${c.takes.indexOf(take) + 1} (${via}${r.tokens ? `, ${r.tokens} tokens` : ''}):
${r.text}`
    }
    case 'save_mood': {
      // WRITE: a .vmd into the mood library (MOODS-VMD-SPEC §7); author = Settings "your name on MOODS"
      const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [])
      const saved = await saveMood({
        name: String(input.name ?? '').trim() || 'untitled mood',
        description: typeof input.description === 'string' ? input.description : '',
        triggers: arr(input.triggers),
        notFor: arr(input.not_for),
        tags: arr(input.tags),
        suffix: typeof input.suffix === 'string' ? input.suffix : '',
        author: exchangeKeys.moodAuthor ?? '',
        howToWrite: String(input.how_to_write ?? ''),
        whatToKnow: String(input.what_to_know ?? '')
      })
      return `saved MOOD "${saved.name}" (${saved.slug}.vmd, ~${saved.tokens} tokens) — it is in the MOODS fold now; the user switches it on.`
    }
    case 'read_object': {
      // read-only: no delta, no live-write card, no go-gate — the fresh-state law's tool
      const dump = dumpObject(p, String(input.id ?? ''))
      return dump ?? `ERROR: no clip, char sheet, style, or timeline with id or name ${String(input.id)}`
    }
    case 'read_transcript_range': {
      const from = Number(input.from_at)
      const to = Number(input.to_at)
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 'ERROR: from_at/to_at must be numbers with to_at >= from_at'
      const msgs = p.codir.log.filter((m) => m.at >= from && m.at <= to)
      if (!msgs.length) return '(no raw messages in that range — the log keeps the last 300 messages; older text survives only in digests)'
      let out = msgs.map((m) => `[${m.at}] ${m.role === 'user' ? 'Director' : 'Co-Director'}: ${m.text}`).join('\n\n')
      if (out.length > 30000) out = out.slice(0, 30000) + `\n…(truncated at 30k chars — ${msgs.length} messages in range; narrow the window for the rest)`
      return out
    }
    case 'read_compiled_prompt': {
      // read-only: no delta, no live-write card, no go-gate — statute 2 is the whole point
      const c = p.clips.find((x) => x.id === input.clip_id) ?? p.clips.find((x) => x.name === input.clip_id)
      if (!c) return `ERROR: no clip with id or name ${String(input.clip_id)}`
      const cp = compileClip(p, c)
      const src = cp.linkedSources.length
        ? cp.linkedSources.map((s) => `  ${s.kind} "${s.name}": ${s.chars} chars`).join('\n')
        : '  (none — no live links contribute text)'
      return [
        `COMPILED PROMPT — clip "${cp.clipName}" · ${cp.engineLabel} · ${cp.promptStyle} · duration ${cp.duration}`,
        `sizes (chars): freeform ${cp.parts.freeform} · scene ${cp.parts.scene} · characters ${cp.parts.characters} · beats ${cp.parts.beats} · production ${cp.parts.production} · assembled total ${cp.parts.total}`,
        'linked sources spliced in:',
        src,
        cp.refTagNote ? `note: ${cp.refTagNote}` : '',
        '--- the prompt exactly as the render assembles it ---',
        cp.text || '(empty — the clip has no prompt text yet)'
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'create_clip': {
      const r = await newEmptyClip(String(input.name ?? ''))
      if (!r) return 'ERROR: could not create clip'
      pushDelta(r.delta)
      return `created clip_id=${r.clipId}`
    }
    case 'set_clip_fields': {
      const c = p.clips.find((x) => x.id === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      const patch: Partial<PromptData> = {}
      const marked: string[] = []
      if (typeof input.freeform === 'string') {
        patch.freeform = input.freeform
        marked.push('freeform')
      }
      if (typeof input.duration === 'string') patch.duration = input.duration
      if (typeof input.engine === 'string') patch.engine = input.engine as PromptData['engine']
      if (input.scene && typeof input.scene === 'object') {
        const sc = input.scene as Partial<SceneFields>
        patch.scene = { ...c.promptData.scene }
        for (const k of Object.keys(sc) as (keyof SceneFields)[]) {
          if (typeof sc[k] === 'string') {
            patch.scene[k] = sc[k] as string
            marked.push(`scene.${k}`)
          }
        }
      }
      if (input.production && typeof input.production === 'object') {
        const pn = input.production as Partial<ProductionFields>
        patch.production = { ...c.promptData.production }
        for (const k of Object.keys(pn) as (keyof ProductionFields)[]) {
          if (typeof pn[k] === 'string') {
            patch.production[k] = pn[k] as string
            marked.push(`production.${k}`)
          }
        }
      }
      if (Array.isArray(input.characters)) {
        patch.characters = (input.characters as Partial<CharacterField>[]).map((ch) => ({
          name: ch.name ?? '',
          referenceLabel: ch.referenceLabel ?? '',
          base: ch.base ?? '',
          features: ch.features ?? '',
          physics: ch.physics ?? '',
          ...(ch.movement ? { movement: ch.movement } : {}),
          ...(ch.emotionalState ? { emotionalState: ch.emotionalState } : {}),
          ...(ch.stateInThisScene ? { stateInThisScene: ch.stateInThisScene } : {}),
          ...(ch.power ? { power: ch.power } : {})
        }))
        marked.push('characters')
      }
      if (Array.isArray(input.character_links)) {
        // linked ⛉ char sheets — validated whole-list replace, like `characters`. A CharacterLink's
        // clipId carries the SHEET id (the renderer resolves sheets first); user-typed override
        // text on a still-linked sheet is preserved so a re-link can't eat their words.
        const prev = c.promptData.characterLinks ?? []
        const links: CharacterLink[] = []
        for (const l of input.character_links as { sheet_id?: string }[]) {
          const sid = String(l?.sheet_id ?? '')
          const s = p.charSheets.find((x) => x.id === sid)
          if (!s) return `ERROR: no char sheet with id ${sid} — sheet ids are in the Char sheets section of your context`
          if (links.some((x) => x.clipId === s.id)) continue
          const kept = prev.find((x) => x.clipId === s.id)
          links.push({ clipId: s.id, charName: s.character.name || s.name, ...(kept?.override ? { override: kept.override } : {}), ...(kept?.replaced?.length ? { replaced: kept.replaced } : {}) })
        }
        patch.characterLinks = links.length ? links : undefined
        marked.push('characters')
        // UI parity: linking a sheet pulls its image into the clip's refs (add-only; i2v has no
        // ref slots — its images ARE the start/end frames)
        if (c.promptData.mode !== 'i2v') {
          const cur = c.promptData.imageIds ?? []
          const joins = links.map((l) => p.charSheets.find((x) => x.id === l.clipId)?.imageId).filter((id): id is string => !!id && !cur.includes(id))
          if (joins.length) patch.imageIds = [...cur, ...[...new Set(joins)]]
        }
      }
      patch.enhanced = mergeEnhanced(c.promptData.enhanced, marked)
      const d = await setClipPromptData(c.id, patch)
      if (d) pushDelta(d)
      return `updated ${marked.length ? marked.join(', ') : 'settings'} on "${c.name}"`
    }
    case 'set_beats': {
      const c = p.clips.find((x) => x.id === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      // GUARD RAIL: the display layer (id + placeholder graphic) is NOT the AI's to write. Each
      // incoming beat is matched to the old beat it replaces — exact by echoed id, else by name,
      // else by position — and that beat's graphic is carried over. The AI has no verb that can
      // drop a placeholder; only the user can clear one in the UI.
      const old = c.promptData.beats ?? []
      const used = new Set<BeatField>()
      const claim = (src: BeatField | undefined): BeatField | undefined => {
        if (!src || used.has(src)) return undefined
        used.add(src)
        return src
      }
      const beats = (input.beats as (Partial<BeatField> & { id?: string })[]).map((b, idx) => {
        const src =
          claim(b.id ? old.find((o) => o.id === b.id) : undefined) ??
          claim(old.find((o) => !used.has(o) && o.name === (b.name ?? ''))) ??
          claim(old[idx])
        return {
          id: src?.id ?? randomUUID(),
          name: b.name ?? 'shot',
          length: typeof b.length === 'number' ? b.length : 3,
          camera: b.camera ?? '',
          action: b.action ?? '',
          lighting: b.lighting ?? '',
          ...(b.dialogue ? { dialogue: b.dialogue } : {}),
          ...(b.vfx ? { vfx: b.vfx } : {}),
          ...(b.reaction ? { reaction: b.reaction } : {}),
          ...(b.sfx ? { sfx: b.sfx } : {}),
          ...(src?.refImageId ? { refImageId: src.refImageId } : {}) // display-only — always carried, never AI-written
        }
      })
      const d = await setClipPromptData(c.id, { beats, enhanced: mergeEnhanced(c.promptData.enhanced, ['beats']) })
      if (d) pushDelta(d)
      const total = beats.reduce((s, b) => s + b.length, 0)
      const kept = beats.filter((b) => b.refImageId).length
      // read BACK from the live project — the result reports what actually landed, never assumed success
      const after = getProject()?.clips.find((x) => x.id === c.id)?.promptData.beats ?? []
      return `clip "${c.name}" now has ${after.length} beats (${total}s sent): ${after.map((b) => b.name).join(', ')}${kept ? ` — ${kept} placeholder graphic${kept > 1 ? 's' : ''} preserved` : ''}`
    }
    case 'set_clip_refs': {
      const c = p.clips.find((x) => x.id === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      const titles = (input.image_titles as string[]).map((x) => (x.startsWith('@') ? x : '@' + x))
      const ids: string[] = []
      const missing: string[] = []
      for (const title of titles) {
        const im = p.images.find((i) => i.title === title)
        if (im) ids.push(im.id)
        else missing.push(title)
      }
      if (missing.length) return `ERROR: not in the Library: ${missing.join(' ')} — attach only existing @titles`
      // GUARD RAIL — ADD-ONLY: a partial list must never strip refs the storyboard depends on.
      // Existing refs are always kept; removal is a human-UI action.
      const cur = c.promptData.imageIds ?? []
      // Set dedups within the incoming list too — "@monk @monk" in one call must not double up
      const merged = Array.from(new Set([...cur, ...ids]))
      const d = await setClipPromptData(c.id, { imageIds: merged })
      if (d) pushDelta(d)
      const added = merged.length - cur.length
      return `attached ${titles.join(' ')} to "${c.name}" — ${added} new, ${merged.length} total (existing refs are always kept; only the user can remove refs)`
    }
    case 'remove_clip_refs': {
      const c = p.clips.find((x) => x.id === input.clip_id) ?? p.clips.find((x) => x.name === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      const titles = ((input.image_titles as string[]) ?? []).map((x) => (x.startsWith('@') ? x : '@' + x))
      const ids = titles.map((t) => p.images.find((i) => i.title === t)?.id).filter((x): x is string => !!x)
      const cur = c.promptData.imageIds ?? []
      const left = cur.filter((id) => !ids.includes(id))
      if (left.length === cur.length) return `nothing removed — none of ${titles.join(' ')} were attached to "${c.name}"`
      const d = await setClipPromptData(c.id, { imageIds: left })
      if (d) pushDelta(d)
      return `removed ${cur.length - left.length} ref${cur.length - left.length === 1 ? '' : 's'} from "${c.name}" — ${left.length} left (the user can undo)`
    }
    case 'set_image_gen_prompt': {
      const g = (p.imageGens ?? []).find((x) => x.id === input.image_gen_id) ?? (p.imageGens ?? []).find((x) => x.name === input.image_gen_id)
      if (!g) return `ERROR: no image gen with id or name ${String(input.image_gen_id)}`
      if (typeof input.prompt !== 'string') return 'ERROR: prompt must be a string'
      const d = await setImageGenData(g.id, { recipe: { prompt: input.prompt } })
      if (d) pushDelta(d)
      return `image gen "${g.name}" prompt set (${input.prompt.length} chars; the user can undo)`
    }
    case 'set_image_gen_refs': {
      const g = (p.imageGens ?? []).find((x) => x.id === input.image_gen_id) ?? (p.imageGens ?? []).find((x) => x.name === input.image_gen_id)
      if (!g) return `ERROR: no image gen with id or name ${String(input.image_gen_id)}`
      const patch: { refA?: string; refB?: string } = {}
      const said: string[] = []
      for (const k of ['a', 'b'] as const) {
        if (!(k in input)) continue
        const key = k === 'a' ? 'refA' : 'refB'
        const v = input[k]
        if (v === null || v === '') {
          patch[key] = undefined
          said.push(`${k.toUpperCase()} removed`)
          continue
        }
        const title = String(v).startsWith('@') ? String(v) : '@' + String(v)
        const im = p.images.find((i) => i.title === title)
        if (!im) return `ERROR: not in the Library: ${title} — attach only existing @titles`
        patch[key] = im.id
        said.push(`${k.toUpperCase()} = ${title}`)
      }
      if (!said.length) return 'nothing to do — pass a and/or b'
      // undefined must land as a removal: setImageGenData spreads the patch, so send the key explicitly
      const d = await setImageGenData(g.id, { recipe: patch as Partial<import('@koan/vidancer-ui/shared/types').ImageGenRecipe> })
      if (d) pushDelta(d)
      return `image gen "${g.name}" refs: ${said.join(' · ')} (the user can undo)`
    }
    case 'create_style': {
      const r = await newStyle(String(input.name ?? ''))
      if (!r) return 'ERROR: could not create style'
      pushDelta(r.delta)
      return `created style_id=${r.styleId}`
    }
    case 'update_style': {
      const s = p.styles.find((x) => x.id === input.style_id)
      if (!s) return `ERROR: no style with id ${String(input.style_id)}`
      const marked: string[] = []
      const scene = { ...s.scene }
      const production = { ...s.production }
      if (input.scene && typeof input.scene === 'object') {
        const sc = input.scene as Partial<SceneFields>
        for (const k of Object.keys(sc) as (keyof SceneFields)[])
          if (typeof sc[k] === 'string') {
            scene[k] = sc[k] as string
            marked.push(`scene.${k}`)
          }
      }
      if (input.production && typeof input.production === 'object') {
        const pn = input.production as Partial<ProductionFields>
        for (const k of Object.keys(pn) as (keyof ProductionFields)[])
          if (typeof pn[k] === 'string') {
            production[k] = pn[k] as string
            marked.push(`production.${k}`)
          }
      }
      const d = await setStyle(s.id, {
        ...(typeof input.name === 'string' && input.name ? { name: input.name } : {}),
        scene,
        production,
        enhanced: mergeEnhanced(s.enhanced, marked)
      })
      if (d) pushDelta(d)
      return `updated ${marked.length ? marked.join(', ') : 'name'} on style "${s.name}"`
    }
    case 'set_field_links': {
      const c = p.clips.find((x) => x.id === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      const links = { ...(c.promptData.fieldLinks ?? {}) }
      const unresolved: string[] = []
      for (const [path, names] of Object.entries(input.links as Record<string, string[]>)) {
        const ids: string[] = []
        for (const n of names) {
          const src =
            p.styles.find((s) => s.id === n || s.name.toLowerCase() === n.toLowerCase()) ??
            p.clips.find((x) => x.id === n || x.name.toLowerCase() === n.toLowerCase())
          if (src) ids.push(src.id)
          else unresolved.push(n)
        }
        if (ids.length) links[path] = ids
        else delete links[path]
      }
      if (unresolved.length) return `ERROR: no style or clip named: ${unresolved.join(', ')}`
      const d = await setClipPromptData(c.id, { fieldLinks: Object.keys(links).length ? links : undefined })
      if (d) pushDelta(d)
      return `links set on "${c.name}"`
    }
    case 'update_brief': {
      const d = await codirSetBrief(String(input.brief ?? ''))
      if (d) pushDelta(d)
      return 'brief updated'
    }
    case 'set_open_questions': {
      const qs = Array.isArray(input.questions) ? (input.questions as unknown[]).map((q) => String(q)) : []
      const d = await codirSetOpenQuestions(qs)
      if (d) pushDelta(d)
      const now = getProject()?.codir.openQuestions ?? []
      return now.length ? `open questions set (${now.length}): ${now.join(' · ')}` : 'open questions cleared'
    }
    case 'update_guide': {
      const id = String(input.guide_id ?? '')
      if (!isGuideId(id) || !(PROMPTING_GUIDE_IDS as readonly string[]).includes(id)) return `ERROR: guide_id must be one of ${PROMPTING_GUIDE_IDS.join(', ')}`
      return updateGuideText(id, typeof input.old_text === 'string' ? input.old_text : undefined, String(input.new_text ?? ''))
    }
    case 'remember_instruction': {
      const r = await appendLearned(String(input.rule ?? ''))
      return r === 'saved' ? 'saved to your instructions (Learned section)' : 'already in your instructions'
    }
    case 'create_char_sheet': {
      const r = await newCharSheet(String(input.name ?? ''))
      if (!r) return 'ERROR: could not create char sheet'
      pushDelta(r.delta)
      return `created sheet_id=${r.sheetId}`
    }
    case 'set_char_sheet_fields': {
      const s = p.charSheets.find((x) => x.id === input.sheet_id)
      if (!s) return `ERROR: no char sheet with id ${String(input.sheet_id)}`
      const ch = { ...s.character }
      const marked: string[] = []
      const put = (key: keyof CharacterField, val: unknown, label: string): void => {
        if (typeof val === 'string') {
          ch[key] = val
          marked.push(label)
        }
      }
      put('name', input.char_name, 'char_name')
      put('base', input.base, 'base')
      put('features', input.features, 'features')
      put('physics', input.physics, 'physics')
      put('movement', input.movement, 'movement')
      put('emotionalState', input.emotional_state, 'emotional_state')
      put('stateInThisScene', input.state_in_this_scene, 'state_in_this_scene')
      put('power', input.power, 'power')
      put('referenceLabel', input.reference_label, 'reference_label')
      if (typeof input.name === 'string' && input.name.trim()) marked.push('name')
      const d = await setCharSheet(s.id, { ...(typeof input.name === 'string' ? { name: input.name } : {}), character: ch })
      if (d) pushDelta(d)
      return `updated ${marked.length ? marked.join(', ') : 'nothing'} on sheet "${s.name}" (the image binding stays user-only)`
    }
    case 'delete_char_sheet': {
      const s = p.charSheets.find((x) => x.id === input.sheet_id)
      if (!s) return `ERROR: no char sheet with id ${String(input.sheet_id)}`
      const d = await deleteCharSheet(s.id)
      if (d) pushDelta(d)
      return `deleted char sheet "${s.name}" (the user can undo)`
    }
    case 'delete_clip': {
      const c = p.clips.find((x) => x.id === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      const d = await deleteClip(c.id)
      if (d) pushDelta(d)
      return `deleted clip "${c.name}" (the user can undo)`
    }
    case 'delete_style': {
      const s = p.styles.find((x) => x.id === input.style_id)
      if (!s) return `ERROR: no style with id ${String(input.style_id)}`
      const d = await deleteStyle(s.id)
      if (d) pushDelta(d)
      return `deleted style "${s.name}" (the user can undo)`
    }
    case 'create_timeline': {
      const r = await addTimeline(String(input.name ?? ''))
      if (!r) return 'ERROR: could not create timeline'
      pushDelta(r.delta)
      return `created timeline_id=${r.timelineId}`
    }
    case 'set_timeline_clips': {
      const tl = p.timelines.find((x) => x.id === input.timeline_id)
      if (!tl) return `ERROR: no timeline with id ${String(input.timeline_id)}`
      const reqs = Array.isArray(input.items) ? (input.items as { clip: string; take?: number; in_sec?: number; out_sec?: number; disabled?: boolean; speed?: number; muted?: boolean; transition_out_sec?: number }[]) : []
      const missing: string[] = []
      const items: TimelineItem[] = []
      for (let i = 0; i < reqs.length; i++) {
        const r = reqs[i]
        const c = p.clips.find((x) => x.id === r.clip) ?? p.clips.find((x) => x.name.toLowerCase() === String(r.clip ?? '').toLowerCase())
        if (!c) {
          missing.push(String(r.clip))
          continue
        }
        let takeId: string | undefined
        if (typeof r.take === 'number') {
          const t = c.takes[Math.round(r.take) - 1]
          if (!t) {
            missing.push(`${c.name} take ${r.take} (it has ${c.takes.length})`)
            continue
          }
          takeId = t.id
        }
        // same-slot same-clip keeps its item id (and with it the user's per-item chrome downstream)
        // — INCLUDING the user's effects (v16): the co-director can't set fx, so it must never wipe it
        const prev = tl.items[i]
        items.push({
          id: prev && prev.clipId === c.id ? prev.id : randomUUID(),
          ...(prev && prev.clipId === c.id && prev.fx ? { fx: prev.fx } : {}),
          clipId: c.id,
          ...(takeId ? { takeId } : {}),
          ...(typeof r.in_sec === 'number' ? { inSec: Math.max(0, r.in_sec) } : {}),
          ...(typeof r.out_sec === 'number' ? { outSec: r.out_sec } : {}),
          ...(r.disabled ? { disabled: true } : {}),
          ...(typeof r.speed === 'number' && r.speed > 0 && r.speed !== 1 ? { speed: r.speed } : {}),
          ...(r.muted ? { muted: true } : {}),
          ...(typeof r.transition_out_sec === 'number' && r.transition_out_sec > 0 ? { transitionOutSec: r.transition_out_sec } : {})
        })
      }
      if (missing.length) return `ERROR: not found: ${missing.join(', ')} — nothing written`
      const d = await setTimelineItems(tl.id, items)
      if (d) pushDelta(d)
      const after = getProject()?.timelines.find((x) => x.id === tl.id)?.items ?? []
      return `timeline "${tl.name}" now runs ${after.length} clip${after.length === 1 ? '' : 's'} in sequence: ${after.map((it) => p.clips.find((c) => c.id === it.clipId)?.name ?? '?').join(' → ') || '(empty)'}`
    }
    case 'rename_item': {
      const nm = String(input.name ?? '').trim()
      if (!nm) return 'ERROR: empty name'
      if (input.kind === 'clip') {
        const c = p.clips.find((x) => x.id === input.id)
        if (!c) return `ERROR: no clip with id ${String(input.id)}`
        const d = await renameClip(c.id, nm)
        if (d) pushDelta(d)
        return `renamed clip to "${nm}"`
      }
      const tl = p.timelines.find((x) => x.id === input.id)
      if (!tl) return `ERROR: no timeline with id ${String(input.id)}`
      const d = await renameTimeline(tl.id, nm)
      if (d) pushDelta(d)
      return `renamed timeline to "${nm}"`
    }
    case 'duplicate_item': {
      if (input.kind === 'clip') {
        const c = p.clips.find((x) => x.id === input.id)
        if (!c) return `ERROR: no clip with id ${String(input.id)}`
        const r = await duplicateClip(c.id)
        if (!r) return 'ERROR: could not duplicate clip'
        pushDelta(r.delta)
        return `duplicated "${c.name}" → clip_id=${r.newClipId} (recipe copied, takes not)`
      }
      const tl = p.timelines.find((x) => x.id === input.id)
      if (!tl) return `ERROR: no timeline with id ${String(input.id)}`
      const r = await duplicateTimeline(tl.id)
      if (!r) return 'ERROR: could not duplicate timeline'
      pushDelta(r.delta)
      return `duplicated "${tl.name}" → timeline_id=${r.timelineId}`
    }
    case 'delete_timeline': {
      const tl = p.timelines.find((x) => x.id === input.timeline_id)
      if (!tl) return `ERROR: no timeline with id ${String(input.timeline_id)}`
      if (p.timelines.length <= 1) return 'ERROR: the last timeline cannot be deleted'
      const d = await deleteTimeline(tl.id)
      if (d) pushDelta(d)
      return `deleted timeline "${tl.name}" (clips stay in the Bin; the user can undo)`
    }
    case 'set_keeper_take': {
      const c = p.clips.find((x) => x.id === input.clip_id)
      if (!c) return `ERROR: no clip with id ${String(input.clip_id)}`
      const n = Math.round(Number(input.take))
      const take = c.takes[n - 1]
      if (!take) return `ERROR: "${c.name}" has ${c.takes.length} take${c.takes.length === 1 ? '' : 's'} — no take ${String(input.take)}`
      const d = await setKeeperTake(c.id, take.id)
      if (d) pushDelta(d)
      return `keeper on "${c.name}" is now take ${n}`
    }
    case 'set_timeline_view': {
      const tl = p.timelines.find((x) => x.id === input.timeline_id)
      if (!tl) return `ERROR: no timeline with id ${String(input.timeline_id)}`
      const did: string[] = []
      if (typeof input.aspect_ratio === 'string' && input.aspect_ratio.trim()) {
        const d = await setTimelineAspect(tl.id, input.aspect_ratio.trim())
        if (d) pushDelta(d)
        did.push(`aspect ${input.aspect_ratio.trim()}`)
      }
      if (input.on_screen === true) {
        const d = await setActiveTimeline(tl.id)
        if (d) pushDelta(d)
        did.push('now on screen')
      }
      return did.length ? `timeline "${tl.name}": ${did.join(', ')}` : 'nothing to change'
    }
    case 'create_folder': {
      const kind = input.kind === 'lib' ? 'lib' : 'bin'
      const r = await addFolder(kind, String(input.name ?? ''), typeof input.parent_id === 'string' ? input.parent_id : null)
      if (!r) return 'ERROR: could not create folder'
      pushDelta(r.delta)
      return `created ${kind} folder_id=${r.folderId}`
    }
    case 'move_to_folder': {
      const kind = input.kind === 'lib' ? 'lib' : 'bin'
      const ids = Array.isArray(input.item_ids) ? (input.item_ids as string[]) : []
      if (!ids.length) return 'ERROR: no item_ids'
      const d = await moveToFolder(kind, ids, typeof input.folder_id === 'string' ? input.folder_id : null)
      if (!d) return 'ERROR: nothing moved — check the ids match the kind'
      pushDelta(d)
      return `moved ${ids.length} ${kind} item${ids.length === 1 ? '' : 's'}`
    }
    case 'rename_image': {
      const im = p.images.find((x) => x.id === input.image_id)
      if (!im) return `ERROR: no image with id ${String(input.image_id)}`
      const old = im.title
      const d = await renameImage(im.id, String(input.new_title ?? ''))
      if (!d) return `ERROR: rename failed — the title may collide with an existing @title`
      pushDelta(d)
      const now = getProject()?.images.find((x) => x.id === im.id)?.title
      return `renamed ${old} → ${now} (every @mention in prompts was rewritten)`
    }
    case 'show_on_screen': {
      if (input.off === true) {
        pendingScreen = { off: true }
        return 'the Screen is dark'
      }
      let c: Clip | undefined
      let idx = -1
      if (typeof input.clip_id === 'string') {
        c = p.clips.find((x) => x.id === input.clip_id)
        if (!c) return `ERROR: no clip with id ${input.clip_id}`
        if (!c.takes.length) return `ERROR: clip "${c.name}" has no takes yet`
        const n = input.take === undefined ? c.takes.length : Math.round(Number(input.take))
        if (!Number.isFinite(n) || n < 1 || n > c.takes.length) return `ERROR: clip "${c.name}" has ${c.takes.length} take${c.takes.length === 1 ? '' : 's'} — no take ${String(input.take)}`
        idx = n - 1
      } else {
        // no clip named — the newest render anywhere in the project
        for (const cl of p.clips)
          for (let i = 0; i < cl.takes.length; i++)
            if (!c || cl.takes[i].createdAt > c.takes[idx].createdAt) {
              c = cl
              idx = i
            }
        if (!c) return 'ERROR: no renders in the project yet'
      }
      pendingScreen = { clipId: c.id, clipName: c.name, take: idx + 1, file: c.takes[idx].file }
      return `on the Screen: "${c.name}" take ${idx + 1}`
    }
    default:
      return `ERROR: unknown tool ${name}`
  }
}

// ---- the exchange ----
let inflight: AbortController | null = null

export function cancelCoDir(): void {
  inflight?.abort()
}

// ---- COMPACT (CODIRECTOR-RLM-COMPACT-SPEC-2026-08-27): fold the older conversation into a
// digest + brief additions. Runs on the Co-Director's OWN model — digesting the director's words
// is meaning-bearing work, never the cheap tier (highest-quality law). Raw log untouched. ----
const COMPACT_KEEP_TAIL = 20 // raw messages kept live (~10 exchanges)
export async function codirCompact(
  opts: { engine: 'api' | 'bridge'; apiKey?: string; model: string },
  pushDelta: (d: ProjectDelta) => void
): Promise<{ ok: boolean; folded?: number; error?: string }> {
  const p = getProject()
  if (!p) return { ok: false, error: 'No project open.' }
  if (inflight) return { ok: false, error: 'The Co-Director is working — wait or cancel first.' }
  const tail = liveTail(p)
  const foldable = tail.slice(0, Math.max(0, tail.length - COMPACT_KEEP_TAIL))
  if (foldable.length < 6) return { ok: false, error: 'nothing to fold yet — the live conversation is still short' }
  const span = foldable.map((m) => `${m.role === 'user' ? 'Director' : 'Co-Director'}: ${m.text}`).join('\n\n')
  const prompt = [
    'You are compacting a director/AI conversation from an AI-video production app. Work only from the text given — invent nothing.',
    '\n## The standing brief (already saved — do NOT repeat its facts)',
    p.codir.brief.trim() || '(empty)',
    '\n## The conversation span being folded',
    span,
    '\n## Return EXACTLY these two sections',
    'BRIEF ADDITIONS:',
    "(durable project decisions present in the span and MISSING from the brief — short factual lines in the director's own terms; or the single word NONE)",
    'DIGEST:',
    '(max 150 words, factual: decisions made, project writes done, renders discussed, threads left open)'
  ].join('\n')
  const r = await runSubCalls([{ id: 'compact', prompt, model: opts.model, maxTokens: 3000 }], {
    engine: opts.engine,
    apiKey: opts.apiKey,
    bridgeModel: opts.model
  })
  const res = r.results[0]
  if (!res?.ok || !res.text) return { ok: false, error: res?.error ?? 'compact sub-call failed' }
  const m = res.text.match(/BRIEF ADDITIONS:\s*([\s\S]*?)\s*DIGEST:\s*([\s\S]*)/)
  if (!m) return { ok: false, error: 'compact reply came back malformed — nothing was written, press again' }
  const additions = m[1].trim()
  const digest = m[2].trim()
  if (!digest) return { ok: false, error: 'compact produced an empty digest — nothing was written' }
  if (additions && !/^NONE\b/i.test(additions)) {
    const d = await codirSetBrief([p.codir.brief.trim(), additions].filter(Boolean).join('\n'))
    if (d) pushDelta(d)
  }
  const d2 = await codirAddDigest({ fromAt: foldable[0].at, toAt: foldable[foldable.length - 1].at, text: digest })
  if (d2) pushDelta(d2)
  return { ok: true, folded: foldable.length }
}

const mediaTypeOf = (file: string): string => {
  const e = extname(file).toLowerCase()
  return e === '.png' ? 'image/png' : e === '.webp' ? 'image/webp' : e === '.gif' ? 'image/gif' : 'image/jpeg'
}

export async function codirSend(
  opts: {
    text: string
    imageIds: string[]
    selectedClipId: string | null
    focus: FocusIn
    apiKey: string
    model: string
    guideLoad?: Record<string, boolean>
    rlm?: boolean // RLM context mode — core index instead of the full snapshot (spec 2026-08-27)
    heat?: number // HEAT 1–5 (tether spec §6); absent/auto = no line
    moods?: string[] // MOOD slugs riding this exchange (on + pinned + #one-shot) — MOODS-VMD-SPEC §6
  },
  progress: Progress,
  pushDelta: (d: ProjectDelta) => void
): Promise<CoDirSendResult> {
  const p = getProject()
  if (!p) return { ok: false, error: 'No project open.' }
  if (inflight) return { ok: false, error: 'The Co-Director is already working — wait or cancel first.' }
  inflight = new AbortController()
  const usage: CoDirUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, rounds: 0 }
  try {
    // instructions + the toggled-on guides, one stable block so caching still works
    // the guides + every active MOOD (both halves) — one cached system block
    const guide = [await buildSystemGuides(opts.guideLoad), await moodBlock(opts.moods ?? [])].filter(Boolean).join('\n\n\n')

    // images the user @mentioned ride the new message (auto-include the selected clip's refs, capped)
    const sel = opts.selectedClipId ? p.clips.find((c) => c.id === opts.selectedClipId) : undefined
    const allIds = Array.from(new Set([...opts.imageIds, ...(sel?.promptData.imageIds ?? [])]))
    const wantIds = allIds.slice(0, CODIR_IMAGE_CAP)
    const imageBlocks: unknown[] = []
    for (const id of wantIds) {
      const im = p.images.find((i) => i.id === id)
      if (!im || !existsSync(im.file)) continue
      try {
        const data = (await readFile(im.file)).toString('base64')
        imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaTypeOf(im.file), data } })
        imageBlocks.push({ type: 'text', text: `(the image above is ${im.title})` })
      } catch {
        /* unreadable image → skip */
      }
    }
    // the open image gen's refs + ★ take (his order 2026-09-09) — same cap, named the same way
    for (const pic of openImageGenPics(p)) {
      if (imageBlocks.filter((b) => (b as { type?: string }).type === 'image').length >= CODIR_IMAGE_CAP) break
      if (pic.imageId && wantIds.includes(pic.imageId)) continue // already shown as a Library ref
      if (!existsSync(pic.file)) continue
      try {
        const data = (await readFile(pic.file)).toString('base64')
        imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaTypeOf(pic.file), data } })
        imageBlocks.push({ type: 'text', text: `(the image above is ${pic.label})` })
      } catch {
        /* unreadable → skip */
      }
    }
    // NEVER let "images I was shown" pass for "refs on the clip": when the cap cuts any off,
    // say so by name — the model must know what it can't see (this gap caused phantom-ref chaos)
    if (allIds.length > wantIds.length) {
      const unseen = allIds
        .slice(CODIR_IMAGE_CAP)
        .map((id) => p.images.find((i) => i.id === id)?.title)
        .filter(Boolean)
        .join(' ')
      imageBlocks.push({ type: 'text', text: `(showing ${wantIds.length} of ${allIds.length} ref images — NOT shown but attached to the clip: ${unseen})` })
    }

    // history (text only — images aren't re-sent) + the fresh user message.
    // Two extra cache marks (pure annotation — the prompt bytes don't change):
    // - the history tail: the next exchange re-sends the same prefix → cached read
    // - the fresh user message: rounds 2+ of THIS exchange's tool loop re-send the whole prompt —
    //   without the mark, the base64 image blocks + context were re-billed at full price every round
    const history: { role: string; content: unknown }[] = liveTail(p).slice(-LOG_HISTORY_CAP).map((m) => ({ role: m.role, content: m.text }))
    const last = history[history.length - 1]
    if (last) last.content = [{ type: 'text', text: last.content as string, cache_control: { type: 'ephemeral' } }]
    // volatile project context rides the TAIL of the fresh user message (not system): the system
    // prompt stays byte-stable, so a project write between exchanges no longer busts the cached
    // history prefix — history now cache-reads every turn, not just on quiet ones
    const context = `(app-generated project context — the current state, not the user's words)\n\n${(opts.rlm ? buildCoreContext : buildContext)(p, opts.selectedClipId, opts.focus, opts.heat)}`
    const messages: unknown[] = [...history, { role: 'user', content: [...imageBlocks, { type: 'text', text: context }, { type: 'text', text: opts.text, cache_control: { type: 'ephemeral' } }] }]

    // system: the stable guide alone, cached
    const system = [{ type: 'text', text: guide, cache_control: { type: 'ephemeral' } }]
    const histText = (m: { content: unknown }): string => (typeof m.content === 'string' ? m.content : ((m.content as { text?: string }[])[0]?.text ?? ''))
    usage.sections = {
      guides: guide.length,
      context: context.length,
      history: history.reduce((n, m) => n + histText(m).length, 0),
      message: opts.text.length,
      images: imageBlocks.filter((b) => (b as { type?: string }).type === 'image').length
    }
    // the prompt as sent, minus image bytes, for reading
    void writeFile(
      LAST_PROMPT_FILE(),
      ['## SYSTEM (cached)', guide, '\n## HISTORY (' + history.length + ' messages)', ...history.map((m) => m.role + ': ' + histText(m)), '\n## IMAGES', usage.sections.images + ' attached (bytes omitted)', '\n## CONTEXT', context, '\n## MESSAGE', opts.text].join('\n'),
      'utf-8'
    ).catch(() => {})

    const finalTexts: string[] = []
    let hitRoundCap = true // flipped false on every non-tool exit
    for (let round = 0; round < MAX_ROUNDS; round++) {
      usage.rounds = round + 1
      progress({ kind: 'status', text: round === 0 ? 'thinking…' : `working… (round ${round + 1})` })
      // transport hardening the SDK would have given us: 429/529/5xx retried twice with backoff
      // (a single blip used to fail the whole exchange AND re-bill the uncached prompt on the
      // human's resend), plus a 90s watchdog so a stalled connection can't wedge the panel on
      // "thinking…" forever. User cancel (inflight) still aborts instantly.
      let res: Response
      for (let attempt = 0; ; attempt++) {
        const watchdog = AbortSignal.timeout(90_000)
        try {
          res = await fetch(API_URL, {
            method: 'POST',
            signal: AbortSignal.any([inflight.signal, watchdog]),
            headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': API_VERSION },
            body: JSON.stringify({
              model: opts.model || CODIR_DEFAULT_MODEL,
              max_tokens: 16000,
              system,
              tools: TOOLS,
              messages
            })
          })
        } catch (e) {
          if (inflight.signal.aborted) throw e // user cancel — never retried
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
            continue
          }
          throw watchdog.aborted ? new Error('API request timed out (90s) — try again') : e
        }
        if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 2) {
          const ra = Number(res.headers.get('retry-after') ?? 0)
          await new Promise((r) => setTimeout(r, Math.min(15000, ra > 0 ? ra * 1000 : 1500 * (attempt + 1))))
          continue
        }
        break
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? `API error ${res.status}`)
      }
      const msg = (await res.json()) as {
        content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]
        stop_reason: string
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
      }
      usage.inputTokens += msg.usage?.input_tokens ?? 0
      usage.outputTokens += msg.usage?.output_tokens ?? 0
      usage.cacheReadTokens += msg.usage?.cache_read_input_tokens ?? 0
      usage.cacheWriteTokens += msg.usage?.cache_creation_input_tokens ?? 0

      for (const block of msg.content) {
        if (block.type === 'text' && block.text?.trim()) {
          finalTexts.push(block.text)
          progress({ kind: 'text', text: block.text })
        }
      }

      if (msg.stop_reason === 'refusal') {
        finalTexts.push('(the model declined this request)')
        hitRoundCap = false
        break
      }
      if (msg.stop_reason === 'max_tokens') {
        // a truncated reply presented as complete reads as the model going quiet mid-thought
        finalTexts.push('⚠ reply hit the token ceiling and was cut short — say "continue" to keep going')
        hitRoundCap = false
        break
      }
      if (msg.stop_reason !== 'tool_use') {
        hitRoundCap = false
        break
      }

      // execute every tool call in this turn; ALL results go back in ONE user message
      messages.push({ role: 'assistant', content: msg.content })
      const results: unknown[] = []
      for (const block of msg.content) {
        if (block.type !== 'tool_use' || !block.id || !block.name) continue
        progress({ kind: 'status', text: `writing: ${block.name.replace(/_/g, ' ')}…` })
        // the live stage sees WHAT is being written (field paths + real snippets), not just that a write happened
        const live = liveDetail(block.name, block.input ?? {})
        if (live) progress({ kind: 'live', live })
        const out = await runTool(block.name, block.input ?? {}, pushDelta)
        const scr = takeCodirScreen()
        if (scr) progress({ kind: 'screen', screen: scr })
        // display-only verbs (the Screen) don't land a change card — status line only
        progress({ kind: block.name === 'show_on_screen' ? 'status' : 'wrote', text: out })
        results.push({ type: 'tool_result', tool_use_id: block.id, content: out, ...(out.startsWith('ERROR') ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
    }

    // parity with the bridge: exhausting the round cap right after tool calls used to end the
    // exchange with no closing turn — the reply was literally "(done)" with work half-finished
    if (hitRoundCap) finalTexts.push(`⚠ hit the ${MAX_ROUNDS}-round cap mid-work — say "continue" to let it finish`)
    const reply = finalTexts.join('\n\n').trim() || '(done)'
    const stamp = Date.now()
    const logDelta = await codirAppend([
      { role: 'user', text: opts.text, at: stamp, ...(opts.imageIds.length ? { imageIds: opts.imageIds } : {}) },
      { role: 'assistant', text: reply, at: stamp }
    ])
    return { ok: true, reply, usage, logDelta }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    const emsg = aborted ? 'cancelled' : err instanceof Error ? err.message : String(err)
    // keep the transcript honest — the user's message happened even if the exchange failed
    const stamp = Date.now()
    const logDelta = await codirAppend([
      { role: 'user', text: opts.text, at: stamp },
      { role: 'assistant', text: `⚠ ${emsg}`, at: stamp }
    ]).catch(() => null)
    return { ok: false, error: emsg, usage, logDelta }
  } finally {
    inflight = null
  }
}
