// STORY-BLOCKING SHEET (director 2026-09-08, from the story-blocking skill): the clip's beats
// become ONE black-and-white blocking-sheet image prompt — equal timecoded panels, loose graphite
// sketch, featureless silhouette mannequins, arrows for camera and motion. Nano draws it; it rides
// the clip's refs LAST as a composition/camera reference only. Never for fights: "blocking refs
// quantize fight motion into pose-holds". The roughness is the mechanism — never improve the sketch.
import type { BeatField } from './types'

export const BLOCKING_REF_LINE =
  'A storyboard blocking sheet is attached (rough black-and-white panels) — take camera angles, framing and staging from it; NOT style, NOT identity, NOT colour.'

// his scope rule: fights are banned — each panel renders as an arrival point and the energy dies
const FIGHT_RE = /\b(fight|fights|fighting|punch|punches|kick|kicks|strike|strikes|slash|slashes|stab|brawl|combat|battle|melee|swordfight|sword fight|duel|uppercut|haymaker|takedown|grapple|gunfight|shoot-?out|firefight|knockout|spar|sparring|beat(?:s|ing)? (?:him|her|them) up)\b/i

export interface BlockingPlan {
  prompt: string
  panels: { n: number; tc: string; angle: string; blocking: string; move: string }[]
  grid: { cols: number; rows: number }
  sheetAspect: string // the Nano render aspect (portrait for 2-column grids)
  fight: boolean
  fightWhy: string
}

const mmss = (s: number): string => {
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
const clean = (s: string): string => s.trim().replace(/[.\s]+$/, '')

export function buildBlockingPrompt(input: { clipName: string; beats: BeatField[]; durationSec: number; aspect: string }): BlockingPlan {
  const beats = input.beats.filter((b) => b.camera.trim() || b.action.trim() || b.name.trim())
  const total = input.durationSec > 0 ? input.durationSec : beats.reduce((s, b) => s + (b.length || 0), 0)
  // one panel per beat (his grid math: ~2.5s per panel, 4–12 panels); more than 12 beats merge in pairs
  let panelsSrc: BeatField[] = beats
  while (panelsSrc.length > 12) {
    const merged: BeatField[] = []
    for (let i = 0; i < panelsSrc.length; i += 2) {
      const a = panelsSrc[i]
      const b = panelsSrc[i + 1]
      merged.push(b ? { ...a, length: (a.length || 0) + (b.length || 0), camera: [a.camera, b.camera].filter(Boolean).join(', then '), action: [a.action, b.action].filter(Boolean).join('; ') } : a)
    }
    panelsSrc = merged
  }
  let cur = 0
  const panels = panelsSrc.map((b, i) => {
    const start = cur
    cur += b.length || 0
    const end = i === panelsSrc.length - 1 && total > 0 ? total : cur
    return {
      n: i + 1,
      tc: `${mmss(start)}–${mmss(end)}`,
      angle: clean(b.camera) || 'eye-level medium (name an angle in the beat to change it)',
      blocking: clean(b.action) || clean(b.name) || 'the subject holds',
      move: clean(b.camera) ? `camera: ${clean(b.camera)}` : 'camera: static'
    }
  })
  const n = panels.length
  const cols = n <= 4 ? 2 : n <= 8 ? 2 : 3
  const rows = Math.max(1, Math.ceil(n / cols))
  const sheetAspect = cols === 2 ? '3:4' : '4:3'
  const panelAspect = input.aspect && input.aspect !== 'auto' ? input.aspect : '16:9'
  const fightHits = beats.map((b) => `${b.camera} ${b.action} ${b.name}`).join(' ').match(FIGHT_RE)
  const fight = !!fightHits
  const fightWhy = fight ? `beat text reads as a fight ("${fightHits![0]}") — a blocking sheet freezes fight motion into pose-holds (his rule: never for fights)` : ''

  const style =
    'Black-and-white storyboard blocking sheet: loose graphite and grease-pencil storyboard sketch on off-white cream paper, gestural sketchy linework, flat greyscale, quick hatching for shadow, smudges. Figures are featureless grey silhouette mannequins — no faces, no hair, no clothing detail, no identity — blocked-in body shapes for position and pose only. Environments as loose line blocking, furniture and buildings as simple shapes. The brightest story elements are blank paper, darker areas hatched.'
  const layout = `LAYOUT: one sheet, ${n} equal panels in a ${cols}×${rows} grid, read left to right then top to bottom, thin black borders, each panel in ${panelAspect} shape, a small handwritten timecode top-left of each panel and a short handwritten camera note in the panel's bottom margin, panel numbers 1–${n}. Directional arrows inside each panel: bright white arrows for camera moves, solid short dark arrows for subject motion.`
  const panelText = panels.map((p) => `PANEL ${p.n} (${p.tc}): angle ${p.angle}. Blocking: ${p.blocking}. Move: ${p.move}, drawn as arrows.`).join('\n')
  const tail = `Every panel a different camera angle. Scene: ${input.clipName}. COLOR: monochrome graphite only. VIBES: rough anime previs storyboard meets director's shot-list thumbnails meets grease-pencil animatic. Semantic negatives: no color, no rendered detail, no facial features, no character identity, no finished illustration, no photorealism, no clean vector look, no text other than the timecodes and camera labels, exactly ${n} panels.`
  return { prompt: [style, layout, panelText, tail].join('\n\n'), panels, grid: { cols, rows }, sheetAspect, fight, fightWhy }
}
