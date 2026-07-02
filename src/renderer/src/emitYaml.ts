// Build the Seedance YAML from the structured fields. The user's freeform prompt
// sits on top; this YAML is appended UNDER it (non-destructive).

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
    ['avoid', pn.avoid]
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
    const bits = [c.base.trim(), c.features.trim(), c.physics.trim()].filter(Boolean).join('; ')
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
  return lines.join('\n').trim()
}

export function buildCombinedFor(promptStyle: 'yaml' | 'natural', freeform: string, d: StructuredFields): string {
  return [freeform.trim(), promptStyle === 'natural' ? buildNatural(d) : buildYaml(d)].filter(Boolean).join('\n\n')
}

// Gemini binds image refs in-prompt via <IMAGE_REF_n> tags — rewrite every @title mention to the
// tag of its position in the ATTACHED refs order (the order image_urls is sent in). Titles are
// canonical @\w+ so the boundary regex can't eat @image10 when replacing @image1.
export function applyRefTags(text: string, orderedTitles: string[]): string {
  let out = text
  orderedTitles.forEach((t, n) => {
    if (!t) return
    out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'g'), `<IMAGE_REF_${n}>`)
  })
  return out
}

export function lintFields(d: StructuredFields, opts: { imageTitles: string[]; combined: string; autoTime?: boolean }): string[] {
  const out: string[] = []
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
  ;['epic', 'amazing', 'beautiful', 'stunning', 'cool'].forEach((w) => {
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
// beat band colors — used by the Beats bar AND the timeline clip bands. The first six ride the
// theme (--b1..--b5 + --ok); the last two are fixed extension hues for long beat lists.
export const BEAT_COLORS = ['var(--b1)', 'var(--b2)', 'var(--b3)', 'var(--b4)', 'var(--b5)', 'var(--ok)', '#d98f4a', '#9aa0e0']
export const MIN_BEAT = 0.25 // seconds, smallest beat length when dragging boundaries

// cumulative [start,end] ranges for a beat list
export function beatRanges(beats: BeatField[]): { start: number; end: number }[] {
  let cur = 0
  return beats.map((b) => {
    const start = cur
    const end = cur + (b.length || 0)
    cur = end
    return { start, end }
  })
}

// a beat's reference image file = first @mention in the beat's own text, else in the clip's prompt
export function beatRefFile(beat: BeatField, freeform: string, images: ProjImage[]): string | undefined {
  const beatText = [beat.camera, beat.action, beat.lighting, beat.dialogue, beat.vfx, beat.reaction, beat.sfx]
    .filter(Boolean)
    .join(' ')
  const m = beatText.match(/@\w+/) ?? (freeform || '').match(/@\w+/)
  if (!m) return undefined
  return images.find((i) => i.title === m[0])?.file
}

export function newBeat(): BeatField {
  return { name: 'shot', length: 3, camera: '', action: '', lighting: '' }
}
export function newCharacter(): CharacterField {
  return { name: '', base: '', features: '', physics: '', referenceLabel: '' }
}
