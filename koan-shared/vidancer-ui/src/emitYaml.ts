// The prompt compile lives in SHARED code now (src/shared/compile.ts — one copy for the
// renderer preview/wire AND the Co-Director's read_compiled_prompt tool; spec:
// docs/COMPILED-PROMPT-SPEC-2026-08-27.md). This file re-exports it so renderer imports
// stay unchanged, and keeps the UI-only helpers that never belonged on main.

export {
  buildYaml,
  buildCombined,
  buildNatural,
  buildProse,
  buildSeedance25,
  buildCombinedFor,
  applyRefTags,
  applyVideoRefTags,
  lintFields,
  readLinkSource,
  resolveCharLinkSource,
  resolveEffective,
  compileClip,
  EMPTY_SCENE,
  EMPTY_PRODUCTION
} from './shared/compile'
export type { StructuredFields, ResolveInput, LinkedSource, CompiledPrompt } from './shared/compile'

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

// a beat's reference image file: the MANUAL placeholder graphic wins (by id — rename-safe,
// display-only), else the first @mention in the beat's own text, else in the clip's prompt
export function beatRefFile(beat: BeatField, freeform: string, images: ProjImage[]): string | undefined {
  if (beat.refImageId) {
    const f = images.find((i) => i.id === beat.refImageId)?.file
    if (f) return f // graphic image deleted → fall through to the auto pick
  }
  const beatText = [beat.camera, beat.action, beat.lighting, beat.dialogue, beat.vfx, beat.reaction, beat.sfx]
    .filter(Boolean)
    .join(' ')
  const m = beatText.match(/@\w+/) ?? (freeform || '').match(/@\w+/)
  if (!m) return undefined
  return images.find((i) => i.title === m[0])?.file
}

export function newBeat(): BeatField {
  const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return { id, name: 'shot', length: 3, camera: '', action: '', lighting: '' }
}
export function newCharacter(): CharacterField {
  return { name: '', base: '', features: '', physics: '', referenceLabel: '' }
}
