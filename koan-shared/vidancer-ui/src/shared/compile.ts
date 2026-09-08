// Shared prompt compile (COMPILED-PROMPT-SPEC-2026-08-27). ONE copy of the emit + cascade
// resolution, callable from the renderer (preview/wire) AND main (the Co-Director's
// read_compiled_prompt). The emitters moved here verbatim from renderer emitYaml.ts, which
// re-exports them; the resolver is the RenderPanel closure logic made pure.

import { modelFor, type ModelDescriptor } from './models'
import type { Project, Clip, PromptData, SceneFields, CharacterField, BeatField, ProductionFields, CharacterLink, CharLinkTextKey } from './types'

function q(s: string): string {
  return JSON.stringify((s ?? '').trim())
}
function snake(s: string): string {
  const r = (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return r || 'x'
}
function fmt(sec: number): string {
  const r = Math.round(sec * 100) / 100
  const str = Number.isInteger(r) ? String(r) : r.toFixed(2)
  return str.length === 1 ? '0' + str : str
}

export interface StructuredFields {
  scene: SceneFields
  characters: CharacterField[]
  beats: BeatField[]
  production: ProductionFields
  duration: string
}

export function buildYaml(d: StructuredFields): string {
  const lines: string[] = []
  const sc = d.scene
  if (sc.title.trim()) lines.push(`title: ${q(sc.title)}`)
  if (sc.referenceHandling.trim()) lines.push(`reference_handling: ${q(sc.referenceHandling)}`)
  if (sc.style.trim()) lines.push(`style: ${q(sc.style)}`)
  if (sc.visualFeel.trim()) lines.push(`visual_feel: ${q(sc.visualFeel)}`)
  if (sc.title.trim() || sc.style.trim()) {
    lines.push(`duration: ${q(d.duration === 'auto' ? 'auto' : d.duration + ' seconds')}`)
  }

  const chars = d.characters.filter((c) => c.name.trim())
  if (chars.length) {
    lines.push('', 'character_modeling:')
    for (const c of chars) {
      lines.push(`  ${snake(c.name)}:`)
      if (c.base.trim()) lines.push(`    base: ${q(c.base)}`)
      if (c.features.trim()) lines.push(`    features: ${q(c.features)}`)
      if (c.physics.trim()) lines.push(`    physics: ${q(c.physics)}`)
      if (c.voice?.trim()) lines.push(`    voice: ${q(c.voice)}`)
      // conditional sub-fields (Seedance guide): movement/state rules parse best INSIDE the block
      if (c.movement?.trim()) lines.push(`    movement_in_this_scene: ${q(c.movement)}`)
      if (c.emotionalState?.trim()) lines.push(`    emotional_state: ${q(c.emotionalState)}`)
      if (c.stateInThisScene?.trim()) lines.push(`    state_in_this_scene: ${q(c.stateInThisScene)}`)
      if (c.power?.trim()) lines.push(`    power_this_scene: ${q(c.power)}`)
    }
  }

  const beats = d.beats.filter((b) => b.name.trim() || b.camera.trim() || b.action.trim() || b.lighting.trim())
  if (beats.length) {
    lines.push('', 'cinematic_storyboard:')
    let cur = 0
    for (const b of beats) {
      const start = cur
      const end = cur + (b.length || 0)
      cur = end
      lines.push(`  ${fmt(start)}_${fmt(end)}_${snake(b.name || 'shot')}:`)
      if (b.camera.trim()) lines.push(`    camera: ${q(b.camera)}`)
      if (b.action.trim()) lines.push(`    action: ${q(b.action)}`)
      if (b.lighting.trim()) lines.push(`    lighting: ${q(b.lighting)}`)
      ;(['dialogue', 'vfx', 'reaction', 'sfx'] as const).forEach((k) => {
        const v = b[k]
        if (v && v.trim()) lines.push(`    ${k}: ${q(v)}`)
      })
    }
  }

  const pn = d.production
  const pnItems: [string, string][] = [
    ['audio_design', pn.audioDesign],
    ['lighting', pn.lighting],
    ['subtext', pn.subtext],
    ['critical_constraint', pn.criticalConstraint],
    ['avoid', pn.avoid],
    ['animation_style', pn.animationStyle ?? '']
  ]
  const present = pnItems.filter(([, v]) => v && v.trim())
  if (present.length) {
    lines.push('', 'production_notes:')
    for (const [k, v] of present) lines.push(`  ${k}: ${q(v)}`)
  }

  return lines.join('\n').trim()
}

export function buildCombined(freeform: string, d: StructuredFields): string {
  return [freeform.trim(), buildYaml(d)].filter(Boolean).join('\n\n')
}

// natural-language emission for models tuned for prose, not Seedance YAML (Gemini Omni Flash).
// Same structured fields, rendered as labeled plain-text lines the model reads as direction.
export function buildNatural(d: StructuredFields): string {
  const lines: string[] = []
  const sc = d.scene
  if (sc.title.trim()) lines.push(`Scene: ${sc.title.trim()}.`)
  if (sc.style.trim() || sc.visualFeel.trim()) lines.push(`Style: ${[sc.style.trim(), sc.visualFeel.trim()].filter(Boolean).join(', ')}.`)
  if (sc.referenceHandling.trim()) lines.push(`References: ${sc.referenceHandling.trim()}`)
  const chars = d.characters.filter((c) => c.name.trim())
  for (const c of chars) {
    const bits = [c.base.trim(), c.features.trim(), c.physics.trim(), c.voice?.trim() && `voice: ${c.voice.trim()}`, c.movement?.trim(), c.emotionalState?.trim(), c.stateInThisScene?.trim(), c.power?.trim()]
      .filter(Boolean)
      .join('; ')
    lines.push(`${c.name.trim()}${c.referenceLabel.trim() ? ` (${c.referenceLabel.trim()})` : ''}: ${bits}`)
  }
  const beats = d.beats.filter((b) => b.name.trim() || b.camera.trim() || b.action.trim() || b.lighting.trim())
  if (beats.length) {
    lines.push('Shot by shot:')
    let cur = 0
    for (const b of beats) {
      const start = cur
      cur += b.length || 0
      const bits = [
        b.camera.trim() && `camera ${b.camera.trim()}`,
        b.action.trim(),
        b.lighting.trim() && `lighting ${b.lighting.trim()}`,
        b.dialogue?.trim() && `dialogue: ${b.dialogue.trim()}`,
        b.vfx?.trim() && `vfx: ${b.vfx.trim()}`,
        b.reaction?.trim() && `reaction: ${b.reaction.trim()}`,
        b.sfx?.trim() && `sound: ${b.sfx.trim()}`
      ].filter(Boolean)
      lines.push(`- ${fmt(start)}s to ${fmt(cur)}s (${b.name.trim() || 'shot'}): ${bits.join('; ')}.`)
    }
  }
  const pn = d.production
  if (pn.audioDesign.trim()) lines.push(`Audio: ${pn.audioDesign.trim()}.`)
  if (pn.lighting.trim()) lines.push(`Overall lighting: ${pn.lighting.trim()}.`)
  if (pn.subtext.trim()) lines.push(`Mood: ${pn.subtext.trim()}.`)
  if (pn.criticalConstraint.trim()) lines.push(`Important: ${pn.criticalConstraint.trim()}.`)
  if (pn.avoid.trim()) lines.push(`Avoid: ${pn.avoid.trim()}.`)
  if (pn.animationStyle?.trim()) lines.push(`Animation cadence: ${pn.animationStyle.trim()}.`)
  return lines.join('\n').trim()
}

// LTX prose emission (LTX-SPEC §5.1, official guide: docs.ltx.io) — ONE flowing paragraph,
// present tense, six ordered elements, prose cuts between shots, dialogue in quotes, no
// sluglines/numbered beats. Pure and deterministic; the freeform stays on top verbatim.
const sentence = (s: string): string => {
  const t = s.trim().replace(/[.;,\s]+$/, '')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : ''
}
export function buildProse(d: StructuredFields): string {
  const parts: string[] = []
  const sc = d.scene
  // opening: shot + scene + look, folded into sentences (style/visualFeel/overall lighting live here)
  const open = [sc.title.trim(), [sc.style.trim(), sc.visualFeel.trim(), d.production.lighting.trim()].filter(Boolean).join(', ')].filter(Boolean)
  if (open.length) parts.push(sentence(open.join(' — ')))
  if (sc.referenceHandling.trim()) parts.push(sentence(sc.referenceHandling))
  // characters weave into their FIRST mention (MSR/multishot law: concrete identifiers inline);
  // never-mentioned characters introduce themselves in the opening instead
  const chars = d.characters.filter((c) => c.name.trim())
  const beats = d.beats.filter((b) => b.name.trim() || b.camera.trim() || b.action.trim() || b.lighting.trim())
  const beatText = (b: BeatField): string => [b.camera, b.action, b.dialogue ?? '', b.reaction ?? ''].join(' ')
  const introduced = new Set<string>()
  const charSentence = (c: CharacterField): string =>
    sentence(`${c.name.trim()} is ${[c.base.trim(), c.features.trim(), c.physics.trim(), c.stateInThisScene?.trim(), c.emotionalState?.trim()].filter(Boolean).join(', ')}`)
  for (const c of chars) {
    if (!beats.some((b) => beatText(b).includes(c.name.trim()))) {
      parts.push(charSentence(c))
      introduced.add(c.name.trim())
    }
  }
  // beats → shots: camera verb sentence, action, lighting; dialogue quoted; sfx as audio
  // sentences. Prose cuts join shots (guide grammar); 1 beat = one continuous take, no cut talk.
  beats.forEach((b, i) => {
    if (i > 0) parts.push(`A hard cut transitions to ${b.camera.trim() ? b.camera.trim().replace(/[.\s]+$/, '') : 'the next shot'}, the audio carrying across the cut.`)
    else if (b.camera.trim()) parts.push(sentence(`the camera ${b.camera}`))
    if (i > 0 && !b.camera.trim() && b.name.trim()) parts.push(sentence(b.name))
    if (b.action.trim()) parts.push(sentence(b.action))
    for (const c of chars) {
      if (!introduced.has(c.name.trim()) && beatText(b).includes(c.name.trim())) {
        parts.push(charSentence(c))
        introduced.add(c.name.trim())
      }
    }
    if (b.lighting.trim()) parts.push(sentence(b.lighting))
    if (b.vfx?.trim()) parts.push(sentence(b.vfx))
    if (b.dialogue?.trim()) {
      const qd = b.dialogue.trim().replace(/^["“]|["”]$/g, '')
      parts.push(`"${qd}"`)
    }
    if (b.reaction?.trim()) parts.push(sentence(b.reaction))
    if (b.sfx?.trim()) parts.push(sentence(`the sound of ${b.sfx}`))
  })
  const pn = d.production
  if (pn.subtext.trim()) parts.push(sentence(`the mood is ${pn.subtext}`))
  if (pn.animationStyle?.trim()) parts.push(sentence(pn.animationStyle))
  if (pn.criticalConstraint.trim()) parts.push(sentence(pn.criticalConstraint))
  if (pn.avoid.trim()) parts.push(...pn.avoid.split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => sentence(`no ${x.replace(/^no\s+/i, '')}`)))
  if (pn.audioDesign.trim()) parts.push(sentence(`the audio carries ${pn.audioDesign}`))
  return parts.filter(Boolean).join(' ').trim()
}

export function buildCombinedFor(promptStyle: 'yaml' | 'natural' | 'prose', freeform: string, d: StructuredFields): string {
  return [freeform.trim(), promptStyle === 'prose' ? buildProse(d) : promptStyle === 'natural' ? buildNatural(d) : buildYaml(d)].filter(Boolean).join('\n\n')
}

// Positional ref grammar — rewrite every @title mention to its position in the ATTACHED refs
// order. Gemini wants <IMAGE_REF_n> (0-based); LTX MSR wants "Image N" (1-based, the LoRA's
// trained labels). Titles are canonical @\w+ so the boundary regex can't eat @image10 when
// replacing @image1.
export function applyRefTags(text: string, orderedTitles: string[], format: 'IMAGE_REF' | 'ImageN'): string {
  let out = text
  orderedTitles.forEach((t, n) => {
    if (!t) return
    const tag = format === 'ImageN' ? `Image ${n + 1}` : `<IMAGE_REF_${n}>`
    out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'g'), tag)
  })
  return out
}

export function lintFields(d: StructuredFields, opts: { imageTitles: string[]; combined: string; autoTime?: boolean; promptStyle?: 'yaml' | 'natural' | 'prose' }): string[] {
  const out: string[] = []
  // LTX prose rules (LTX-SPEC §5.1 — the official guide's avoid list)
  if (opts.promptStyle === 'prose') {
    if (/^\s*(\d+[.)]|[-*•])\s/m.test(opts.combined)) out.push('LTX wants one flowing paragraph — drop numbered/bulleted lines from the prompt')
    const shots = d.beats.filter((b) => b.name.trim() || b.camera.trim() || b.action.trim()).length
    if (shots > 4) out.push(`${shots} beats — the LTX guide prefers 2-4 shots per render`)
    if (/on-?screen text|caption|subtitle|title card/i.test(opts.combined)) out.push('LTX renders on-screen text poorly — the guide says avoid asking for it')
  }
  d.beats.forEach((b, i) => {
    const words = b.camera.trim().split(/\s+/).filter(Boolean).length
    if (words > 20) out.push(`beat ${i + 1}: camera is ${words} words (keep ≤20)`)
  })
  const totalBeats = d.beats.reduce((s, b) => s + (b.length || 0), 0)
  const dur = parseFloat(d.duration)
  // auto-time keeps beats summing to the duration, so the mismatch warning doesn't apply when it's on
  if (!opts.autoTime && !Number.isNaN(dur) && d.beats.length && Math.abs(totalBeats - dur) > 0.01) {
    out.push(`beats sum to ${totalBeats}s but duration is ${dur}s`)
  }
  if (d.beats.length && !d.production.avoid.trim()) {
    out.push('production_notes.avoid is empty (baseline: "Jitter, bent or distorted limbs.")')
  }
  opts.imageTitles.forEach((t) => {
    if (t && !opts.combined.includes(t)) out.push(`${t} is attached but not @referenced in the prompt`)
  })
  ;['epic', 'amazing', 'beautiful', 'stunning', 'cool', 'lots of movement'].forEach((w) => {
    if (new RegExp(`\\b${w}\\b`, 'i').test(opts.combined)) out.push(`drop the filler word "${w}"`)
  })
  return out
}

export const EMPTY_SCENE: SceneFields = { title: '', referenceHandling: '', style: '', visualFeel: '' }
export const EMPTY_PRODUCTION: ProductionFields = {
  audioDesign: '',
  lighting: '',
  subtext: '',
  criticalConstraint: '',
  avoid: ''
}

// ---- cascade resolution (the RenderPanel closures, made pure) ----

// what the resolver needs — the panel passes its LIVE form state, main passes the saved clip's promptData
export type ResolveInput = Pick<PromptData, 'freeform' | 'scene' | 'characters' | 'beats' | 'production' | 'duration' | 'promptLink' | 'fieldLinks' | 'fieldOverrides' | 'characterLinks'> & {
  imageIds?: string[] // attached refs — a sheet-tagged one splices the bible-12.8 identity line
}

// bible 12.8 (2026-09-08): a multi-panel reference sheet is attached for WHO the character is,
// never for how the frame looks. Written once into reference_handling whenever a sheet rides.
export const SHEET_REF_LINE = 'A multi-panel model sheet is attached — take identity from all its panels, copy none of its framings.'

export interface LinkedSource {
  id: string
  name: string
  kind: 'style' | 'clip' | 'sheet'
  chars: number // trimmed characters this source spliced into the assembled prompt
}

const readField = (src: { scene?: SceneFields; production?: ProductionFields }, path: string): string => {
  const [g, k] = path.split('.')
  const grp = g === 'scene' ? src.scene : g === 'production' ? src.production : undefined
  return grp ? (grp as unknown as Record<string, string>)[k] ?? '' : ''
}

// a source id is a project style or a clip — both carry the same scene/production groups
export function readLinkSource(project: Project | null | undefined, id: string, path: string): string {
  const st = project?.styles?.find((s) => s.id === id)
  if (st) return readField(st, path)
  const c = project?.clips.find((x) => x.id === id)
  return c ? readField(c.promptData, path) : ''
}

// LIVE-linked characters: a link resolves to the source's CURRENT character block. Char
// sheets first (l.clipId may be a sheet id) with the @ref resolved LIVE from its image by id —
// rename-proof. Dangling links → nothing.
export function resolveCharLinkSource(project: Project | null | undefined, l: CharacterLink): CharacterField | undefined {
  const sheet = project?.charSheets?.find((s) => s.id === l.clipId)
  if (sheet) {
    const title = sheet.imageId ? project?.images.find((i) => i.id === sheet.imageId)?.title ?? '' : ''
    return { ...sheet.character, name: sheet.character.name || sheet.name, referenceLabel: title || sheet.character.referenceLabel }
  }
  return project?.clips.find((c) => c.id === l.clipId)?.promptData.characters.find((ch) => ch.name === l.charName)
}

export function resolveEffective(
  project: Project | null | undefined,
  pd: ResolveInput
): { effectiveFreeform: string; effectiveStructured: StructuredFields; linkedSources: LinkedSource[] } {
  const tally = new Map<string, number>()
  const add = (id: string, n: number): void => {
    if (n > 0) tally.set(id, (tally.get(id) ?? 0) + n)
  }

  // a clip can live-embed ONE other clip's prompt: the linked clip's CURRENT freeform is spliced
  // before/after our own at render. Resolved by id → renames are safe, a deleted clip just drops out.
  const linkedClip = pd.promptLink ? project?.clips.find((c) => c.id === pd.promptLink!.clipId) : undefined
  const linkedText = (linkedClip?.promptData.freeform ?? '').trim()
  if (linkedClip) add(linkedClip.id, linkedText.length)
  const effectiveFreeform =
    pd.promptLink && linkedText
      ? pd.promptLink.pos === 'before'
        ? `${linkedText}\n${pd.freeform}`.trim()
        : `${pd.freeform}\n${linkedText}`.trim()
      : pd.freeform

  // per-field links: a field borrows a STACK of sources' SAME field, then its own text appends.
  const fieldLinks = pd.fieldLinks ?? {}
  const fieldOverrides = pd.fieldOverrides ?? {}
  const splice = (linkedVals: string[], mine: string): string => [...linkedVals, mine].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
  // an OVERRIDDEN source (faded chip) is skipped — the field's own text replaces it in the splice
  const liveStack = (path: string): string[] => (fieldLinks[path] ?? []).filter((id) => !(fieldOverrides[path] ?? []).includes(id))
  const readTallied = (id: string, path: string): string => {
    const v = readLinkSource(project, id, path)
    add(id, v.trim().length)
    return v
  }
  const resolveSceneF = (s: SceneFields): SceneFields => {
    const out: SceneFields = { ...s }
    for (const k of Object.keys(s) as (keyof SceneFields)[]) {
      const vals = liveStack(`scene.${k}`).map((id) => readTallied(id, `scene.${k}`)).filter((v) => v.trim())
      if (vals.length) out[k] = splice(vals, s[k] ?? '')
    }
    return out
  }
  const resolveProductionF = (p: ProductionFields): ProductionFields => {
    const out: ProductionFields = { ...p }
    // CANONICAL key list, never Object.keys(p): optional fields (animationStyle, v7) are ABSENT
    // from the object on clips created before them, and iterating the instance silently skipped
    // their link stacks — a linked style's animation_style never reached the prompt (Co-Director
    // field report 2026-09-01, project MONK; looked engine-correlated, was clip-age-correlated)
    const keys: (keyof ProductionFields)[] = ['audioDesign', 'lighting', 'subtext', 'criticalConstraint', 'avoid', 'animationStyle']
    for (const k of keys) {
      const vals = liveStack(`production.${k}`).map((id) => readTallied(id, `production.${k}`)).filter((v) => v.trim())
      if (vals.length) out[k] = splice(vals, p[k] ?? '')
    }
    return out
  }

  const spliceChar = (src: CharacterField, o?: Partial<CharacterField>, replaced?: CharLinkTextKey[]): CharacterField => {
    const j = (k: CharLinkTextKey, a?: string, b?: string): string =>
      replaced?.includes(k) ? (b ?? '').trim() : [a, b].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
    const app = (a?: string, b?: string): string => [a, b].map((v) => (v ?? '').trim()).filter(Boolean).join(' ')
    const opt = (v: string): string | undefined => v || undefined
    return {
      name: src.name,
      referenceLabel: (o?.referenceLabel ?? '').trim() || src.referenceLabel,
      base: j('base', src.base, o?.base),
      features: j('features', src.features, o?.features),
      physics: j('physics', src.physics, o?.physics),
      voice: opt(app(src.voice ?? '', o?.voice)),
      movement: opt(j('movement', src.movement, o?.movement)),
      emotionalState: opt(j('emotionalState', src.emotionalState, o?.emotionalState)),
      stateInThisScene: opt(j('stateInThisScene', src.stateInThisScene, o?.stateInThisScene)),
      power: opt(j('power', src.power, o?.power))
    }
  }
  const charChars = (c: CharacterField): number =>
    [c.base, c.features, c.physics, c.voice, c.movement, c.emotionalState, c.stateInThisScene, c.power].reduce((s, v) => s + (v ?? '').trim().length, 0)
  const resolvedLinkChars = (pd.characterLinks ?? [])
    .map((l) => {
      const src = resolveCharLinkSource(project, l)
      if (src) add(l.clipId, charChars(src))
      return src ? spliceChar(src, l.override, l.replaced) : undefined
    })
    .filter((ch): ch is CharacterField => !!ch)

  const effectiveStructured: StructuredFields = {
    scene: resolveSceneF(pd.scene),
    characters: [...resolvedLinkChars, ...pd.characters],
    beats: pd.beats,
    production: resolveProductionF(pd.production),
    duration: pd.duration
  }

  const linkedSources: LinkedSource[] = [...tally].map(([id, chars]) => {
    const st = project?.styles?.find((s) => s.id === id)
    if (st) return { id, name: st.name, kind: 'style', chars }
    const sh = project?.charSheets?.find((s) => s.id === id)
    if (sh) return { id, name: sh.name, kind: 'sheet', chars }
    const c = project?.clips.find((x) => x.id === id)
    return { id, name: c?.name ?? '(removed)', kind: 'clip', chars }
  })

  // sheet law (bible 12.8): any attached sheet image → the identity line rides reference_handling
  if (project && pd.imageIds?.some((id) => project.images.find((i) => i.id === id)?.sheet)) {
    const rh = effectiveStructured.scene.referenceHandling
    if (!rh.includes(SHEET_REF_LINE)) effectiveStructured.scene = { ...effectiveStructured.scene, referenceHandling: [rh.trim(), SHEET_REF_LINE].filter(Boolean).join(' ') }
  }

  return { effectiveFreeform, effectiveStructured, linkedSources }
}

// ---- the compiled prompt, as the Co-Director reads it ----

export interface CompiledPrompt {
  clipId: string
  clipName: string
  engine: ModelDescriptor['id']
  engineLabel: string
  promptStyle: 'yaml' | 'natural' | 'prose'
  duration: string
  text: string // exactly what the render assembles (before the outgoing-only ref-tag rewrite)
  parts: { freeform: number; scene: number; characters: number; beats: number; production: number; total: number }
  linkedSources: LinkedSource[]
  refTagNote?: string
}

export function compileClip(project: Project, clip: Clip): CompiledPrompt {
  const pd = clip.promptData
  const { effectiveFreeform, effectiveStructured, linkedSources } = resolveEffective(project, { ...pd, imageIds: pd.imageIds })
  const m = modelFor(pd.engine)
  const promptStyle = m.promptStyle ?? 'yaml'
  const text = buildCombinedFor(promptStyle, effectiveFreeform, effectiveStructured)
  const len = (...vals: (string | undefined)[]): number => vals.reduce((s, v) => s + (v ?? '').trim().length, 0)
  const sc = effectiveStructured.scene
  const pn = effectiveStructured.production
  const parts = {
    freeform: effectiveFreeform.trim().length,
    scene: len(sc.title, sc.referenceHandling, sc.style, sc.visualFeel),
    characters: effectiveStructured.characters.reduce((s, c) => s + len(c.name, c.base, c.features, c.physics, c.voice, c.movement, c.emotionalState, c.stateInThisScene, c.power), 0),
    beats: effectiveStructured.beats.reduce((s, b) => s + len(b.name, b.camera, b.action, b.lighting, b.dialogue, b.vfx, b.reaction, b.sfx), 0),
    production: len(pn.audioDesign, pn.lighting, pn.subtext, pn.criticalConstraint, pn.avoid, pn.animationStyle),
    total: text.length
  }
  const refTagNote =
    m.refTagPrompt && pd.mode !== 'i2v'
      ? '@titles are rewritten to positional ref tags on the wire (attached-ref order); text order unchanged.'
      : undefined
  return { clipId: clip.id, clipName: clip.name, engine: m.id, engineLabel: m.label, promptStyle, duration: pd.duration, text, parts, linkedSources, refTagNote }
}
