// Co-Director — the conversational copilot that writes into the project (main process).
// Talks to the Anthropic Messages API over raw fetch: this machine has no npm toolchain, so the
// official SDK can't be installed — the request/loop shapes below follow the documented wire API
// (tool_use loop, prompt caching via cache_control, base64 image blocks). Every project write
// goes through the same project.ts mutators the UI uses, so writes are undoable and delta-merged.
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import {
  getProject,
  newEmptyClip,
  setClipPromptData,
  newStyle,
  setStyle,
  codirAppend,
  codirSetBrief
} from './project'
import { buildSystemGuides, updateGuideText, appendLearned, isGuideId, PROMPTING_GUIDE_IDS } from './guides'
import type { Project, ProjectDelta, Clip, ProjectStyle, PromptData, SceneFields, ProductionFields, CharacterField, BeatField, CoDirMsg } from '../shared/types'

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
}

export interface CoDirSendResult {
  ok: boolean
  reply?: string
  error?: string
  usage?: CoDirUsage
  logDelta?: ProjectDelta | null
}

type Progress = (e: { kind: 'status' | 'text' | 'wrote'; text?: string }) => void

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
      "Write a clip's prompt fields. Send ONLY what should change: scene/production keys you include are updated individually (others untouched); characters, when included, REPLACES the whole character list (send every character the clip should have); freeform replaces the freeform prompt. Also set duration (seconds, e.g. \"10\") / engine when relevant.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        freeform: { type: 'string', description: 'the top freeform prompt — @mention attached ref titles here' },
        duration: { type: 'string', description: 'seconds as string, e.g. "10", or "auto"' },
        engine: { type: 'string', enum: ['seedance2', 'sora2', 'omniflash'] },
        scene: { type: 'object', properties: sceneProps, additionalProperties: false },
        production: { type: 'object', properties: productionProps, additionalProperties: false },
        characters: { type: 'array', items: { type: 'object', properties: characterProps, required: ['name'], additionalProperties: false } }
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
    name: 'create_style',
    description: 'Create a named Project Style (a clip-independent bundle of universal fields). Returns style_id. Fill/adjust via update_style, then LINK it into clips with set_field_links rather than copying its text.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'update_style',
    description: "Update a Project Style's fields. Scene/production keys you include are updated individually; others untouched. Linked clips update live.",
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
  const lines: string[] = [`- clip "${c.name}" id=${c.id} engine=${pd.engine ?? 'seedance2'} mode=${pd.mode} duration=${pd.duration} takes=${c.takes.length}`]
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
    lines.push(`  links: ${Object.entries(pd.fieldLinks).map(([p, ids]) => `${p}←[${ids.map(nameOf).join(', ')}]`).join('; ')}`)
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

export function buildContext(p: Project, selectedClipId: string | null, focus: { kind: string; ownerId: string; path: string } | null): string {
  const parts: string[] = []
  parts.push(`# Current project: "${p.name}"`)
  parts.push(`\n## Your brief\n${p.codir.brief.trim() || '(empty — update_brief when durable decisions land)'}`)
  parts.push(`\n## Library images (@titles you may attach/reference)\n${p.images.length ? p.images.map((i) => i.title).join(' ') : '(none yet)'}`)
  parts.push(`\n## Project styles\n${p.styles.length ? p.styles.map(snapshotStyle).join('\n') : '(none yet)'}`)
  // char sheets: read-only for you — the user links them into clips from the characters UI
  parts.push(
    `\n## Char sheets (characters' single homes — READ-ONLY for you; no tool writes them)\n${
      (p.charSheets ?? []).length
        ? (p.charSheets ?? [])
            .map((s) => {
              const img = s.imageId ? p.images.find((i) => i.id === s.imageId)?.title ?? '(gone)' : '(no image)'
              return `- sheet "${s.name}" id=${s.id} char=${s.character.name || '(unnamed)'} image=${img}\n  base: ${t(s.character.base, 300)}\n  features: ${t(s.character.features, 300)}`
            })
            .join('\n')
        : '(none yet)'
    }`
  )
  parts.push(`\n## Clips\n${p.clips.length ? p.clips.map((c) => snapshotClip(c, c.id === selectedClipId)).join('\n') : '(none yet)'}`)
  const sel = selectedClipId ? p.clips.find((c) => c.id === selectedClipId) : undefined
  parts.push(`\n## Where the user is\nSelected clip: ${sel ? `"${sel.name}" id=${sel.id} (shown in full above — "the clip I'm on")` : 'none'}`)
  if (focus) {
    const owner = focus.kind === 'style' ? p.styles.find((s) => s.id === focus.ownerId)?.name : p.clips.find((c) => c.id === focus.ownerId)?.name
    parts.push(`Last-clicked field ("this one"): ${focus.path} on ${focus.kind} "${owner ?? '?'}" (id=${focus.ownerId})`)
  }
  return parts.join('\n')
}

// ---- tool execution against the project ----
const mergeEnhanced = (cur: string[] | undefined, add: string[]): string[] => Array.from(new Set([...(cur ?? []), ...add]))

export async function runTool(name: string, input: Record<string, unknown>, pushDelta: (d: ProjectDelta) => void): Promise<string> {
  const p = getProject()
  if (!p) return 'ERROR: no project open'
  switch (name) {
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
      const merged = [...cur, ...ids.filter((id) => !cur.includes(id))]
      const d = await setClipPromptData(c.id, { imageIds: merged })
      if (d) pushDelta(d)
      const added = merged.length - cur.length
      return `attached ${titles.join(' ')} to "${c.name}" — ${added} new, ${merged.length} total (existing refs are always kept; only the user can remove refs)`
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
    case 'update_guide': {
      const id = String(input.guide_id ?? '')
      if (!isGuideId(id) || !(PROMPTING_GUIDE_IDS as readonly string[]).includes(id)) return `ERROR: guide_id must be one of ${PROMPTING_GUIDE_IDS.join(', ')}`
      return updateGuideText(id, typeof input.old_text === 'string' ? input.old_text : undefined, String(input.new_text ?? ''))
    }
    case 'remember_instruction': {
      const r = await appendLearned(String(input.rule ?? ''))
      return r === 'saved' ? 'saved to your instructions (Learned section)' : 'already in your instructions'
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

const mediaTypeOf = (file: string): string => {
  const e = extname(file).toLowerCase()
  return e === '.png' ? 'image/png' : e === '.webp' ? 'image/webp' : e === '.gif' ? 'image/gif' : 'image/jpeg'
}

export async function codirSend(
  opts: {
    text: string
    imageIds: string[]
    selectedClipId: string | null
    focus: { kind: string; ownerId: string; path: string } | null
    apiKey: string
    model: string
    guideLoad?: Record<string, boolean>
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
    const guide = await buildSystemGuides(opts.guideLoad)

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

    // history (text only — images aren't re-sent) + the fresh user message
    const history = p.codir.log.slice(-LOG_HISTORY_CAP).map((m) => ({ role: m.role, content: m.text }))
    const messages: unknown[] = [...history, { role: 'user', content: [...imageBlocks, { type: 'text', text: opts.text }] }]

    // system: [stable guide (cached)] + [volatile project context]
    const system = [
      { type: 'text', text: guide, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildContext(p, opts.selectedClipId, opts.focus) }
    ]

    const finalTexts: string[] = []
    for (let round = 0; round < MAX_ROUNDS; round++) {
      usage.rounds = round + 1
      progress({ kind: 'status', text: round === 0 ? 'thinking…' : `working… (round ${round + 1})` })
      const res = await fetch(API_URL, {
        method: 'POST',
        signal: inflight.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': API_VERSION },
        body: JSON.stringify({
          model: opts.model || CODIR_DEFAULT_MODEL,
          max_tokens: 16000,
          system,
          tools: TOOLS,
          messages
        })
      })
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
        break
      }
      if (msg.stop_reason !== 'tool_use') break

      // execute every tool call in this turn; ALL results go back in ONE user message
      messages.push({ role: 'assistant', content: msg.content })
      const results: unknown[] = []
      for (const block of msg.content) {
        if (block.type !== 'tool_use' || !block.id || !block.name) continue
        progress({ kind: 'status', text: `writing: ${block.name.replace(/_/g, ' ')}…` })
        const out = await runTool(block.name, block.input ?? {}, pushDelta)
        progress({ kind: 'wrote', text: out })
        results.push({ type: 'tool_result', tool_use_id: block.id, content: out, ...(out.startsWith('ERROR') ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
    }

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
