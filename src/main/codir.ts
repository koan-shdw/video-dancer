// Co-Director — the conversational copilot that writes into the project (main process).
// Talks to the Anthropic Messages API over raw fetch: this machine has no npm toolchain, so the
// official SDK can't be installed — the request/loop shapes below follow the documented wire API
// (tool_use loop, prompt caching via cache_control, base64 image blocks). Every project write
// goes through the same project.ts mutators the UI uses, so writes are undoable and delta-merged.
import { readFile } from 'fs/promises'
import { extname, join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import {
  getProject,
  newEmptyClip,
  setClipPromptData,
  newStyle,
  setStyle,
  codirAppend,
  codirSetBrief
} from './project'
import { CODIR_DEFAULT_GUIDE } from './codirGuide'
import type { Project, ProjectDelta, Clip, ProjectStyle, PromptData, SceneFields, ProductionFields, CharacterField, BeatField, CoDirMsg } from '../shared/types'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const MAX_ROUNDS = 12 // tool-loop safety cap per exchange
const LOG_HISTORY_CAP = 40 // messages of history sent per exchange (full log persists in the project)

// pricing sanity-checked against the API reference 2026-07-18; Sonnet default per user decision
export const CODIR_DEFAULT_MODEL = 'claude-sonnet-5'
export const CODIR_MODELS: { id: string; label: string }[] = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — recommended balance ($3 in / $15 out per MTok)' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — strongest writing ($5 / $25)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest & cheapest ($1 / $5)' }
]

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

// ---- the custom guide (user's personal copy of the prompting guide) ----
export function customGuidePath(): string {
  return join(app.getPath('userData'), 'codirector-guide.md')
}
export async function readGuide(useCustom: boolean): Promise<string> {
  if (useCustom && existsSync(customGuidePath())) {
    try {
      return await readFile(customGuidePath(), 'utf-8')
    } catch {
      /* unreadable → default */
    }
  }
  return CODIR_DEFAULT_GUIDE
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
    description: "Replace a clip's beats (the cinematic storyboard). Lengths are seconds, staggered by rhythm, and must sum to the clip duration. Every second of the clip must be covered.",
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
    description: "Attach Library images to a clip as its reference images, by @title (with or without the @). Replaces the clip's ref list with exactly these, in order. Every @title you mention in prompt text must be attached here and must exist in the Library.",
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
  if (pd.beats?.length) {
    if (full) {
      let cur = 0
      for (const b of pd.beats) {
        lines.push(`  beat ${b.name} ${cur}-${cur + (b.length || 0)}s: cam=${t(b.camera, 120)} | action=${t(b.action, 300)} | light=${t(b.lighting, 100)}${b.dialogue ? ` | dlg=${t(b.dialogue, 100)}` : ''}${b.vfx ? ` | vfx=${t(b.vfx, 100)}` : ''}${b.sfx ? ` | sfx=${t(b.sfx, 100)}` : ''}`)
        cur += b.length || 0
      }
    } else lines.push(`  beats: ${pd.beats.length} (${pd.beats.map((b) => b.name).join(', ')})`)
  }
  const proj = getProject()
  if (pd.imageIds?.length && proj) {
    const titles = pd.imageIds.map((id) => proj.images.find((i) => i.id === id)?.title ?? '?').join(' ')
    lines.push(`  refs: ${titles}`)
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
      const beats = (input.beats as Partial<BeatField>[]).map((b) => ({
        name: b.name ?? 'shot',
        length: typeof b.length === 'number' ? b.length : 3,
        camera: b.camera ?? '',
        action: b.action ?? '',
        lighting: b.lighting ?? '',
        ...(b.dialogue ? { dialogue: b.dialogue } : {}),
        ...(b.vfx ? { vfx: b.vfx } : {}),
        ...(b.reaction ? { reaction: b.reaction } : {}),
        ...(b.sfx ? { sfx: b.sfx } : {})
      }))
      const d = await setClipPromptData(c.id, { beats, enhanced: mergeEnhanced(c.promptData.enhanced, ['beats']) })
      if (d) pushDelta(d)
      const total = beats.reduce((s, b) => s + b.length, 0)
      return `set ${beats.length} beats (${total}s total) on "${c.name}"`
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
      const d = await setClipPromptData(c.id, { imageIds: ids })
      if (d) pushDelta(d)
      return `attached ${titles.join(' ')} to "${c.name}"`
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
    useCustomGuide: boolean
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
    const guide = await readGuide(opts.useCustomGuide)

    // images the user @mentioned ride the new message (auto-include the selected clip's refs, capped)
    const sel = opts.selectedClipId ? p.clips.find((c) => c.id === opts.selectedClipId) : undefined
    const wantIds = Array.from(new Set([...opts.imageIds, ...(sel?.promptData.imageIds ?? [])])).slice(0, 5)
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
